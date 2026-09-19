"""Ronda 18, segunda vuelta -- regresiones que reproducen, con pytest y TestClient (no
scripts sueltos contra un server vivo), los escenarios exactos que encontró Codex en su
segunda revisión de commit 89909cf: reapertura que no permite refirmar, delete_document que
esquivaba la protección, branding "sin marca a propósito" no distinguido de "desconocido", y
la falta de atomicidad real entre el chequeo de fingerprint y la escritura de la firma."""
import base64

import pytest
from fastapi.testclient import TestClient

from app.main import app

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis"}, "secciones": []}
FAKE_PDF_B64 = base64.b64encode(b"%PDF-1.4 fake test pdf").decode()


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    return drp_client


@pytest.fixture
def cliente(drp_client):
    created = drp_client.post(
        "/users",
        json={"username": "firmante", "email": "firmante@example.com", "display_name": "Firmante", "role": "cliente"},
    )
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    return cli, user_id


def _fp(drp, project_id="proj-1", doc_type="HLRA"):
    return drp.get(f"/projects/{project_id}/documents/{doc_type}").json()["content_fingerprint"]


# ─── ALTA #3: reapertura tiene que permitir volver a firmar ────────────────────

def test_reopen_then_resign_same_user_succeeds(drp_with_pin, cliente):
    """Antes: el índice único (document_id, user_id) bloqueaba una segunda fila para el mismo
    firmante aunque la primera estuviera invalidada, y el chequeo de "ya firmaste" no filtraba
    invalidated_at -- reabrir un documento dejaba al firmante original sin forma de refirmar."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    r1 = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r1.status_code == 200, r1.text

    reopened = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/reopen", json={"reason": "corregir un typo"}
    )
    assert reopened.status_code == 200, reopened.text

    # Firma anterior invalidada, ya no cuenta como "ya firmaste".
    listed = drp_with_pin.get("/projects/proj-1/documents/HLRA/review-signatures").json()["signatures"]
    assert len(listed) == 1
    assert listed[0]["active"] is False
    assert listed[0]["invalidated_reason"] == "corregir un typo"

    r2 = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r2.status_code == 200, r2.text

    listed2 = drp_with_pin.get("/projects/proj-1/documents/HLRA/review-signatures").json()["signatures"]
    assert len(listed2) == 2
    assert sum(1 for s in listed2 if s["active"]) == 1


def test_reopen_requires_reason(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    r = drp_with_pin.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "   "})
    assert r.status_code == 400


def test_reopen_rejected_if_no_signatures_yet(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "motivo"})
    assert r.status_code == 400


def test_reopen_rejected_if_already_sealed(drp_with_pin, cliente):
    """Un documento sellado (locked=1) no se reabre por esta vía -- eso violaría la
    inmutabilidad del artefacto firmado, que es justo lo que Ronda 18 protege."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    drp_id = [u["id"] for u in drp_with_pin.get("/users").json()["users"] if u["is_superadmin"]][0]
    fp = _fp(drp_with_pin)
    drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": drp_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    sealed = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "9999", "justification_text": "ok", "pdf_base64": FAKE_PDF_B64, "content_fingerprint": fp},
    )
    assert sealed.status_code == 200 and sealed.json()["sealed"] is True

    r = drp_with_pin.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "motivo"})
    assert r.status_code == 409


# ─── ALTA #4: delete_document tiene que respetar evidencia de firma ────────────

def test_delete_blocked_with_active_review_signature(drp_with_pin, cliente):
    """Codex reprodujo borrar un documento con una firma de revisión activa -- la cascada de
    la FK se llevaba la firma puesta, perdiendo evidencia de firma electrónica sin pasar por
    reopen. delete_document solo miraba `locked`, nunca la existencia de firmas."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    r = drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    assert r.status_code == 409
    assert "firma" in r.text.lower()


def test_delete_still_blocked_after_reopen_invalidates_signature(drp_with_pin, cliente):
    """La evidencia INVALIDADA sigue siendo evidencia -- reabrir para editar no es una puerta
    trasera para después borrar el documento entero y perder el historial de que alguien
    firmó una versión anterior."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    drp_with_pin.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "corregir"})

    r = drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    assert r.status_code == 409


def test_delete_allowed_with_no_signatures(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    assert r.status_code == 200


def test_delete_not_blocked_by_merely_designated_unsigned_round(drp_with_pin):
    """Precisión pedida por Codex (tercera devolución, 2026-09-19): una fila de
    rf_approval_signers con signed_at IS NULL es una DESIGNACIÓN (alguien fue nombrado
    firmante al crear la ronda), no una firma emitida -- no debe bloquear el borrado por sí
    sola. Acá la ronda existe (DRP designado como único firmante, válido porque el último
    firmante tiene que ser superadmin) pero NADIE firmó todavía."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_id = [u["id"] for u in drp_with_pin.get("/users").json()["users"] if u["is_superadmin"]][0]
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": drp_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    assert r.status_code == 200, r.text

    delete = drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    assert delete.status_code == 200, delete.text


# ─── ALTA #4 (tercera devolución): delete_project no aplicaba la misma protección ─────

def test_delete_project_blocked_with_signature_evidence(drp_with_pin, cliente):
    """Codex reprodujo (tercera devolución, 2026-09-19) borrar el proyecto entero con un
    documento que tiene firma de revisión activa -- delete_project solo miraba `locked`, la
    cascada se llevaba la firma puesta. Mismo criterio que delete_document ahora, vía
    has_signature_evidence compartida (projects.py)."""
    drp_with_pin.put("/projects/delete-proj-r18/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "delete-proj-r18", "doc_type": "HLRA"})
    fp = drp_with_pin.get("/projects/delete-proj-r18/documents/HLRA").json()["content_fingerprint"]
    r = cli.post(
        "/projects/delete-proj-r18/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    assert r.status_code == 200, r.text

    delete = drp_with_pin.delete("/projects/delete-proj-r18")
    assert delete.status_code == 409
    assert "firma" in delete.text.lower()

    from app.db import get_db
    remaining = get_db().execute(
        "SELECT COUNT(*) c FROM rf_review_signatures rs JOIN rf_documents d ON d.id = rs.document_id "
        "WHERE d.project_id='delete-proj-r18'"
    ).fetchone()["c"]
    assert remaining == 1  # nada se borró


def test_delete_project_allowed_with_only_unsigned_documents(drp_with_pin):
    drp_with_pin.put("/projects/delete-proj-r18b/documents/HLRA", json={"json_data": SAMPLE_JSON})
    delete = drp_with_pin.delete("/projects/delete-proj-r18b")
    assert delete.status_code == 200, delete.text


# ─── ALTA #2 (tercera devolución): reopen_document sin transacción real ───────────────

def test_reopen_rolls_back_completely_on_mid_write_failure(drp_with_pin, cliente, monkeypatch):
    """Codex inyectó un fallo en el UPDATE final (edit_locked=0) e inyectando después de
    invalidar la firma de revisión -- encontró la firma invalidada PERSISTIDA con
    edit_locked todavía en 1 (reapertura fallida a medias). reopen_document no tenía
    BEGIN/COMMIT/ROLLACK -- cada UPDATE se confirmaba solo (autocommit, ver db.py). Ahora
    todo corre en una transacción real: si algo falla a mitad de camino, nada de lo que
    escribió esta llamada queda aplicado."""
    from fastapi.testclient import TestClient
    from app.main import app

    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin)
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )

    from app.db import get_db
    from app.routers import documents as documents_module

    class _FailingConnProxy:
        """sqlite3.Connection es un tipo de C inmutable -- no se puede parchear ni en la
        instancia ni en la clase. En cambio, se parchea el símbolo get_db() importado dentro
        de documents.py para que devuelva este proxy, que delega todo salvo el UPDATE que
        Codex usó para inyectar el fallo."""
        def __init__(self, real):
            self._real = real
        def execute(self, sql, *args, **kwargs):
            if "edit_locked=0" in sql:
                raise RuntimeError("fallo inyectado -- simula un crash a mitad de la reapertura")
            return self._real.execute(sql, *args, **kwargs)
        def __getattr__(self, name):
            return getattr(self._real, name)

    real_conn = get_db()
    monkeypatch.setattr(documents_module, "get_db", lambda: _FailingConnProxy(real_conn))

    crashy_client = TestClient(app, raise_server_exceptions=False)
    crashy_client.cookies = drp_with_pin.cookies
    r = crashy_client.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "corregir"})
    assert r.status_code == 500

    monkeypatch.undo()  # restaurar antes de leer -- si no, el propio GET de verificación fallaría

    doc = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()["document"]
    assert doc["edit_locked"] == 1  # NO quedó en 0 a medias

    sigs = drp_with_pin.get("/projects/proj-1/documents/HLRA/review-signatures").json()["signatures"]
    assert len(sigs) == 1
    assert sigs[0]["active"] is True  # la firma NO quedó invalidada a medias


# ─── ALTA #5: ausencia de branding fijada, en las dos direcciones ──────────────

def _seal_solo(drp_with_pin, project_id="proj-1", doc_type="HLRA"):
    """Sella con un único firmante DRP (ronda de un solo aprobador, DRP es superadmin) --
    suficiente para estos tests de branding, que no necesitan el circuito de dos firmantes."""
    drp_id = [u["id"] for u in drp_with_pin.get("/users").json()["users"] if u["is_superadmin"]][0]
    fp = drp_with_pin.get(f"/projects/{project_id}/documents/{doc_type}").json()["content_fingerprint"]
    drp_with_pin.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round",
        json={"signers": [{"user_id": drp_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    r = drp_with_pin.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round/sign",
        json={"pin": "9999", "justification_text": "ok", "pdf_base64": FAKE_PDF_B64, "content_fingerprint": fp},
    )
    assert r.status_code == 200 and r.json()["sealed"] is True


def _set_project_branding(name, logo):
    """No hay endpoint de sesión DRP para editar branding directamente (section docstring
    de bridge.py: solo llega vía el push de Validación) -- se escribe directo en rf_projects,
    igual que ya hacen otros tests de este archivo para is_superadmin (test_signatures.py).
    rf_projects no tiene fila propia hasta que algo la crea (ensure_project_active trata un
    proyecto sin fila como activo, pero no inserta una) -- hay que crearla explícitamente
    antes del UPDATE, o el UPDATE no toca ninguna fila."""
    from app.db import get_db
    from app.routers.projects import ensure_project
    db = get_db()
    ensure_project(db, "proj-1", "test")
    db.execute("UPDATE rf_projects SET partner_name=?, partner_logo=? WHERE id=?", (name, logo, "proj-1"))
    db.commit()


def test_sealed_without_partner_then_partner_added_shows_no_branding(drp_with_pin):
    """Dirección 1 (la que ya estaba probada): se sella SIN partner cargado en el proyecto;
    después se le agrega un partner al proyecto. El documento ya sellado tiene que seguir sin
    mostrar marca -- se selló así a propósito, branding_captured_at_signing lo fija."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    _seal_solo(drp_with_pin)

    _set_project_branding("Cliente Nuevo", "data:image/png;base64,xx")

    doc = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()
    assert doc["partner_branding"] is None

    pkg = drp_with_pin.get("/projects/proj-1/book-package").json()
    assert pkg["documents"][0]["data"].get("_partnerBranding") is None


def test_sealed_with_partner_then_partner_changed_keeps_original_snapshot(drp_with_pin):
    """Dirección 2 (la que Codex marcó como NO cubierta): se sella CON un partner cargado;
    después se cambia el partner del proyecto a otro distinto. El documento ya sellado tiene
    que seguir mostrando el partner ORIGINAL (el que existía al sellar), no el nuevo."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    _set_project_branding("Partner Original", "data:image/png;base64,aa")
    _seal_solo(drp_with_pin)

    _set_project_branding("Partner Nuevo", "data:image/png;base64,bb")

    doc = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()
    assert doc["partner_branding"]["name"] == "Partner Original"
    assert doc["partner_branding"]["logo"] == "data:image/png;base64,aa"

    pkg = drp_with_pin.get("/projects/proj-1/book-package").json()
    branding = pkg["documents"][0]["data"]["_partnerBranding"]
    assert branding["name"] == "Partner Original"
    assert branding["logo"] == "data:image/png;base64,aa"


# ─── BLOQUEANTE #2: atomicidad real entre chequeo y escritura ─────────────────

def test_concurrent_edit_between_pin_check_and_write_is_caught_not_silently_signed(
    drp_with_pin, cliente, monkeypatch
):
    """Reproduce el escenario que demostró Codex: interceptar el punto donde antes corría
    _verify_pin (fuera de cualquier transacción) para colar una edición concurrente del mismo
    documento, simulando otro request de _upsert_document intercalado justo ahí. Antes, la
    firma se grababa igual, apuntando a contenido que ya no era el que el firmante vio. Ahora
    la reescritura dentro de la transacción (BEGIN IMMEDIATE, re-chequeo de fingerprint
    inmediatamente antes de escribir) tiene que detectar el cambio y rechazar con 409, en vez
    de grabar una firma sobre contenido stale."""
    from app import routers as _routers_pkg  # noqa: F401
    from app.routers import signatures as sig_module
    from app.db import get_db

    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp_before_race = _fp(drp_with_pin)

    real_verify_pin = sig_module._verify_pin
    edited = {"done": False}

    def _verify_pin_then_interleave(db, uid, pin):
        real_verify_pin(db, uid, pin)
        if not edited["done"]:
            edited["done"] = True
            # Simula OTRA conexión/request escribiendo directo sobre el documento justo entre
            # el chequeo temprano de fingerprint (ya pasado) y la transacción de escritura de
            # la firma (todavía no abierta) -- el punto exacto que Codex explotó.
            other_conn = get_db()
            other_conn.execute(
                "UPDATE rf_documents SET json_data=? WHERE project_id='proj-1' AND doc_type='HLRA'",
                ('{"type": "HLRA", "metadata": {"title": "Editado a mitad de camino"}, "secciones": []}',),
            )
            other_conn.commit()

    monkeypatch.setattr(sig_module, "_verify_pin", _verify_pin_then_interleave)

    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp_before_race},
    )
    # La firma NUNCA se graba sobre contenido que cambió después de que el firmante lo vio.
    assert r.status_code == 409, r.text
    assert "cambió" in r.text.lower()

    listed = drp_with_pin.get("/projects/proj-1/documents/HLRA/review-signatures").json()["signatures"]
    assert listed == []

    # El documento SÍ quedó con la edición intercalada (eso lo hizo una conexión directa a la
    # db, no pasó por _upsert_document) -- lo que importa es que la firma no se coló encima.
    doc = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()["document"]
    assert doc["json_data"]["metadata"]["title"] == "Editado a mitad de camino"


# ─── Formato de PDF inválido al sellar ─────────────────────────────────────────

def test_seal_rejects_non_pdf_attachment(drp_with_pin):
    """El adjunto tiene que empezar con la firma de archivo %PDF- -- antes se hasheaba y
    guardaba el texto base64 tal cual llegara, sin validar que fuera siquiera un PDF."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_id = [u["id"] for u in drp_with_pin.get("/users").json()["users"] if u["is_superadmin"]][0]
    fp = _fp(drp_with_pin)
    drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": drp_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={
            "pin": "9999", "justification_text": "ok",
            "pdf_base64": base64.b64encode(b"esto no es un pdf").decode(),
            "content_fingerprint": fp,
        },
    )
    assert r.status_code == 400
    assert "PDF" in r.text


def test_original_pdf_download_returns_exact_stored_bytes(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    _seal_solo(drp_with_pin)
    r = drp_with_pin.get("/projects/proj-1/documents/HLRA/original")
    assert r.status_code == 200
    assert r.content == b"%PDF-1.4 fake test pdf"
    assert r.headers["content-type"] == "application/pdf"


def test_original_pdf_404_message_distinguishes_never_sealed_from_sealed_without_original(drp_with_pin):
    """Codex (hallazgo #6): el 404 usaba el mismo texto ("se selló antes de...") para un
    documento que nunca se selló y para uno sellado antes de original_stored -- directamente
    falso para el primer caso."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    never_sealed = drp_with_pin.get("/projects/proj-1/documents/HLRA/original")
    assert never_sealed.status_code == 404
    assert "todavía no está sellado" in never_sealed.json()["detail"]

    from app.db import get_db
    db = get_db()
    doc_id = db.execute("SELECT id FROM rf_documents WHERE project_id='proj-1' AND doc_type='HLRA'").fetchone()["id"]
    # Simula un documento sellado ANTES de que original_stored existiera (Ronda 18) --
    # locked=1 pero sin pdf_data guardado.
    db.execute("UPDATE rf_documents SET locked=1 WHERE id=?", (doc_id,))
    db.commit()
    sealed_no_original = drp_with_pin.get("/projects/proj-1/documents/HLRA/original")
    assert sealed_no_original.status_code == 404
    assert "se selló antes de que se empezara a guardar" in sealed_no_original.json()["detail"]


def test_original_pdf_404_message_distinguishes_storage_inconsistency(drp_with_pin):
    """Codex (tercera devolución, 2026-09-19): un tercer estado -- original_stored=1 pero SIN
    pdf_data -- es una inconsistencia de almacenamiento (el sellado creyó haber guardado el
    PDF y no está), no un documento histórico "anterior a la funcionalidad". El mensaje tiene
    que decir eso, no reciclar el texto de "se selló antes de..."."""
    from app.db import get_db
    db = get_db()
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    doc_id = db.execute("SELECT id FROM rf_documents WHERE project_id='proj-1' AND doc_type='HLRA'").fetchone()["id"]
    db.execute("UPDATE rf_documents SET locked=1, original_stored=1, pdf_data=NULL WHERE id=?", (doc_id,))
    db.commit()

    r = drp_with_pin.get("/projects/proj-1/documents/HLRA/original")
    assert r.status_code == 404
    assert "inconsistencia de almacenamiento" in r.json()["detail"]
    assert "se selló antes de que se empezara a guardar" not in r.json()["detail"]

    last_event = db.execute(
        "SELECT event_type FROM rf_system_audit_log WHERE doc_type='HLRA' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert last_event["event_type"] == "original_pdf_missing_inconsistency"
