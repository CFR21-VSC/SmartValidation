"""Ronda 19 — Libro de Firmas: declaración de conformidad de firma electrónica.

Regresiones ejecutables para los casos que Codex marcó como prioritarios en su devolución
del 2026-09-20 (docs-privados/ronda-19-libro-de-firmas.md): flujo completo con usuarios
temporales, versión obsoleta rechazada, reintento idempotente, historia preservada entre
versiones, privacidad de /signature-book, y que /book-package solo incluya documentos
sellados en el capítulo LIBRO_FIRMAS."""
import json
import re
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.signature_consent import CURRENT_CONSENT_VERSION, SIGNATURE_CONSENT_STATEMENT_V1
from tests.conftest import accept_signature_consent

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis"}, "secciones": []}


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    return drp_client  # sin aceptar consentimiento -- lo hacen los tests a propósito


def _fp(client, project_id="proj-1", doc_type="HLRA"):
    return client.get(f"/projects/{project_id}/documents/{doc_type}").json()["content_fingerprint"]


# ─── Flujo completo con usuarios temporales, con y sin consentimiento ──────────

def test_sign_review_blocked_without_consent(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "consent_required"


def test_accept_consent_then_sign_review_succeeds(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    accept_signature_consent(drp_with_pin)
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r.status_code == 200, r.text


def test_full_review_and_approval_flow_with_consent(drp_with_pin):
    """Circuito completo (revisión + aprobación que sella) con consentimiento aceptado --
    equivalente al que Codex corrió por API con un usuario de prueba de PIN conocido."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    accept_signature_consent(drp_with_pin)
    fp = _fp(drp_with_pin)

    r1 = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": fp},
    )
    assert r1.status_code == 200, r1.text

    drp_id = get_db().execute("SELECT id FROM rf_users WHERE is_superadmin=1").fetchone()["id"]
    round_r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": drp_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    assert round_r.status_code == 200, round_r.text

    seal_r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={
            "pin": "9999", "justification_text": "ok",
            "pdf_base64": "JVBERi0xLjQgZmFrZSB0ZXN0IHBkZg==",
            "content_fingerprint": fp,
        },
    )
    assert seal_r.status_code == 200, seal_r.text
    assert seal_r.json()["sealed"] is True


# ─── Vinculación de la firma con la evidencia de consentimiento que la habilitó ─

def test_signature_records_the_consent_id_that_enabled_it():
    """Ronda 19 (Codex): "vincular las firmas nuevas a la evidencia de consentimiento que
    habilitó su emisión" -- cada fila de firma tiene que guardar el id de la fila de
    consentimiento vigente al momento de firmar, no inferirlo después consultando el estado
    actual del usuario."""
    client = TestClient(app)
    client.post("/auth/login", json={"username": "fbongiovanni", "password": "test-superadmin-pw-123"})
    client.post("/auth/set-pin", json={"pin": "9999"})
    client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    accept_signature_consent(client)
    fp = _fp(client)
    r = client.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": fp},
    )
    assert r.status_code == 200, r.text

    row = get_db().execute(
        "SELECT rs.consent_id, c.statement_version FROM rf_review_signatures rs "
        "JOIN rf_signature_consent c ON c.id = rs.consent_id"
    ).fetchone()
    assert row is not None
    assert row["statement_version"] == CURRENT_CONSENT_VERSION


def test_mixed_consent_does_not_attribute_one_document_signature_to_another(drp_with_pin):
    """Ronda 19, tercera devolución de Codex (2026-09-21): "el bucle reemplaza el None
    inicial por cualquier consent_id no nulo posterior... no atribuir la aceptación de URS
    a HLRA." Reproduce exactamente el escenario que señalaron: la misma persona firma dos
    documentos -- HLRA con vínculo histórico (consent_id NULL, simula una firma de antes de
    que este campo existiera) y URS con vínculo real -- y HLRA se procesa ANTES que URS en
    el orden de cascada (sort_docs), que es justo el orden en el que el bug original
    atribuía mal la aceptación."""
    from app.routers.book import build_signature_book_data

    drp_with_pin.put("/projects/proj-mixed/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/projects/proj-mixed/documents/URS", json={"json_data": {"type": "URS", "secciones": []}})
    accept_signature_consent(drp_with_pin)

    uid = get_db().execute("SELECT id FROM rf_users WHERE is_superadmin=1").fetchone()["id"]

    fp_hlra = _fp(drp_with_pin, project_id="proj-mixed", doc_type="HLRA")
    r1 = drp_with_pin.post(
        "/projects/proj-mixed/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": fp_hlra},
    )
    assert r1.status_code == 200, r1.text
    # Simula que esta firma es histórica -- de antes de que consent_id existiera.
    hlra_doc_id = get_db().execute(
        "SELECT id FROM rf_documents WHERE project_id='proj-mixed' AND doc_type='HLRA'"
    ).fetchone()["id"]
    get_db().execute(
        "UPDATE rf_review_signatures SET consent_id=NULL WHERE document_id=? AND user_id=?",
        (hlra_doc_id, uid),
    )
    get_db().commit()

    fp_urs = _fp(drp_with_pin, project_id="proj-mixed", doc_type="URS")
    r2 = drp_with_pin.post(
        "/projects/proj-mixed/documents/URS/review-signatures",
        json={"pin": "9999", "content_fingerprint": fp_urs},
    )
    assert r2.status_code == 200, r2.text  # esta SÍ queda con consent_id real

    data = build_signature_book_data(get_db(), "proj-mixed")
    by_tipo = {d["tipo"]: d for d in data["documentos"]}

    assert by_tipo["HLRA"]["firmas_revision"][0]["consentimiento"] is None
    assert by_tipo["URS"]["firmas_revision"][0]["consentimiento"] is not None
    assert by_tipo["URS"]["firmas_revision"][0]["consentimiento"]["version"] == CURRENT_CONSENT_VERSION

    firmante = next(f for f in data["firmantes"] if f["user_id"] == uid)
    assert firmante["consentimiento"] is not None
    assert firmante["consentimiento"]["version"] == CURRENT_CONSENT_VERSION


# ─── Versión obsoleta: el POST tiene que exigir la versión que el cliente leyó ─

def test_post_consent_rejects_stale_version(drp_with_pin):
    r = drp_with_pin.post("/auth/signature-consent", json={"version": "v0-vieja"})
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["error"] == "stale_consent_version"
    assert body["current_version"] == CURRENT_CONSENT_VERSION
    assert body["current_statement_text"] == SIGNATURE_CONSENT_STATEMENT_V1


def test_get_consent_always_returns_current_text_even_if_never_accepted(drp_with_pin):
    r = drp_with_pin.get("/auth/signature-consent")
    assert r.status_code == 200
    data = r.json()
    assert data["accepted"] is False
    assert data["consent"] is None
    assert data["current_version"] == CURRENT_CONSENT_VERSION
    assert data["current_statement_text"] == SIGNATURE_CONSENT_STATEMENT_V1


# ─── Reintento: aceptar la MISMA versión dos veces es un no-op idempotente ─────

def test_reaccepting_same_version_is_idempotent_and_keeps_original_timestamp(drp_with_pin):
    accept_signature_consent(drp_with_pin)
    first = drp_with_pin.get("/auth/signature-consent").json()["consent"]

    r2 = drp_with_pin.post("/auth/signature-consent", json={"version": CURRENT_CONSENT_VERSION})
    assert r2.status_code == 200

    second = drp_with_pin.get("/auth/signature-consent").json()["consent"]
    assert second["accepted_at"] == first["accepted_at"]

    uid = get_db().execute("SELECT id FROM rf_users WHERE is_superadmin=1").fetchone()["id"]
    count = get_db().execute(
        "SELECT COUNT(*) AS n FROM rf_signature_consent WHERE user_id=?", (uid,)
    ).fetchone()["n"]
    assert count == 1


# ─── Historia entre versiones: aceptar una versión nueva NO pisa la anterior ───

def test_accepting_a_new_version_preserves_the_old_acceptance_row(drp_with_pin, monkeypatch):
    """Simula un cambio de versión editorial (v1 -> v2). La aceptación de v1 tiene que
    seguir existiendo, con su texto y fecha originales -- Ronda 19, Codex: "ON CONFLICT
    DO UPDATE pierde la evidencia anterior"."""
    accept_signature_consent(drp_with_pin)
    uid = get_db().execute("SELECT id FROM rf_users WHERE is_superadmin=1").fetchone()["id"]
    v1_row = get_db().execute(
        "SELECT id, accepted_at, statement_text_snapshot FROM rf_signature_consent WHERE user_id=?", (uid,)
    ).fetchone()

    import app.signature_consent as sc
    monkeypatch.setattr(sc, "CURRENT_CONSENT_VERSION", "v2")
    monkeypatch.setattr(sc, "SIGNATURE_CONSENT_STATEMENT_V1", "Texto editorial nuevo de v2.")
    # auth.py importó CURRENT_CONSENT_VERSION por valor al cargar el módulo -- parchear el
    # módulo de origen no alcanza para el router ya importado, así que se llama a
    # record_consent directamente (lo que igualmente prueba la garantía de la tabla, que es
    # el objetivo de este test).
    new_id = sc.record_consent(get_db(), uid, "v2")
    assert new_id != v1_row["id"]

    rows = get_db().execute(
        "SELECT statement_version, accepted_at, statement_text_snapshot FROM rf_signature_consent "
        "WHERE user_id=? ORDER BY accepted_at ASC", (uid,)
    ).fetchall()
    assert len(rows) == 2
    assert rows[0]["statement_version"] == "v1"
    assert rows[0]["accepted_at"] == v1_row["accepted_at"]
    assert rows[0]["statement_text_snapshot"] == v1_row["statement_text_snapshot"]
    assert rows[1]["statement_version"] == "v2"

    # Política "una vez, de por vida": has_accepted_consent/get_consent siguen devolviendo
    # la aceptación MÁS ANTIGUA (v1) como "la" vigente -- una versión nueva no la reemplaza.
    current = sc.get_consent(get_db(), uid)
    assert current["statement_version"] == "v1"
    assert current["id"] == v1_row["id"]


# ─── Privacidad de /signature-book (Codex la probó, queda como regresión) ─────

def test_signature_book_hidden_from_non_owner_drp(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    r = drp_with_pin.post("/projects", json={"id": "proyecto-secreto-firmas", "is_private": True})
    assert r.status_code == 200, r.text

    owner_r = drp_with_pin.get("/projects/proyecto-secreto-firmas/signature-book")
    assert owner_r.status_code == 200

    other_r = other_cli.get("/projects/proyecto-secreto-firmas/signature-book")
    assert other_r.status_code == 404


@pytest.fixture
def other_drp(drp_with_pin):
    created = drp_with_pin.post(
        "/users",
        json={"username": "otro-drp-firmas", "email": "otro-drp-firmas@example.com",
              "display_name": "Otro DRP", "role": "drp"},
    )
    assert created.status_code == 200, created.text
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    accept = cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    assert accept.status_code == 200, accept.text
    return cli, user_id


# ─── /book-package: el capítulo LIBRO_FIRMAS respeta "solo documentos sellados" ─

def test_book_package_signature_chapter_excludes_unsealed_documents(drp_with_pin):
    """Ronda 19 (Codex, hallazgo #1): antes el capítulo se armaba con TODOS los documentos
    con firma activa, aunque get_book_package prometa "solo documentos sellados" -- un
    documento solo revisado (no sellado) no tiene que aportar sus firmas al capítulo dentro
    del libro compilado, aunque sí puede aparecer en la previsualización suelta
    (/signature-book)."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    accept_signature_consent(drp_with_pin)
    fp = _fp(drp_with_pin)
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": fp},
    )
    assert r.status_code == 200, r.text  # HLRA revisado, NO sellado

    # La previsualización suelta SÍ lo incluye (ese es el punto de existir).
    preview = drp_with_pin.get("/projects/proj-1/signature-book").json()
    assert [d["tipo"] for d in preview["documentos"]] == ["HLRA"]

    # El paquete del libro compilado no tiene ningún documento sellado -- no hay nada que
    # amerite un capítulo LIBRO_FIRMAS, y HLRA sigue en skipped_not_sealed como siempre.
    pkg = drp_with_pin.get("/projects/proj-1/book-package").json()
    assert pkg["documents"] == []
    assert pkg["skipped_not_sealed"] == ["HLRA"]


def test_wrap_signature_book_as_document_never_claims_sealed():
    """Ronda 19 (Codex, hallazgo #1): document.status no puede afirmar "Sellado" -- el
    capítulo no es un artefacto sellado propio, se reconstruye en cada consulta."""
    from app.routers.book import wrap_signature_book_as_document
    data = {"firmantes": [], "documentos": [{
        "tipo": "HLRA", "sellado": True, "fecha_sellado": "20/09/2026",
        "pdf_hash": "abc", "json_hash": "def",
        "firmas_revision": [], "firmas_aprobacion": [],
    }]}
    wrapped = wrap_signature_book_as_document(data, "proj-1", only_sealed=True)
    status = wrapped["document"]["status"]
    assert status != "Sellado"
    assert status.startswith("Proyección generada")


# ─── Contrato entre los dos wrappers (Python y JS) — Codex, segunda devolución ─

def _normalize_status(doc: dict) -> dict:
    """El texto de `document.status` incluye la fecha de generación (distinta entre el
    proceso Python y el proceso Node que corren en momentos ligeramente distintos) --
    se reemplaza por un placeholder fijo antes de comparar, todo lo demás tiene que
    coincidir exactamente."""
    doc = json.loads(json.dumps(doc))  # copia profunda
    doc["document"]["status"] = re.sub(r"generada el \S+", "generada el <fecha>", doc["document"]["status"])
    return doc


def test_python_and_js_wrappers_agree_on_the_same_input():
    """Ronda 19, segunda devolución de Codex (2026-09-21): "comparar Python y JS no
    requiere infraestructura nueva... usar el mismo JSON y comparar salida normalizada."
    wrap_signature_book_as_document (book.py) y wrapSignatureBookAsDoc (libro-firmas.js)
    tienen que producir la MISMA forma de documento a partir de la MISMA entrada -- si
    algún día divergen (como pasó con document.status antes de esta ronda), este test
    lo detecta sin depender de inspección manual."""
    from app.routers.book import wrap_signature_book_as_document

    book_data = {
        "firmantes": [
            {"user_id": "u1", "nombre": "Ana Revisora",
             "consentimiento": {"version": "v1", "texto": "Texto de prueba.", "fecha": "20/09/2026"}},
            {"user_id": "u2", "nombre": "Beto Aprobador", "consentimiento": None},
        ],
        "documentos": [
            {"tipo": "HLRA", "sellado": True, "fecha_sellado": "20/09/2026",
             "pdf_hash": "hash-pdf-abc", "json_hash": "hash-json-def",
             "firmas_revision": [{"user_id": "u1", "rol": "Revisor", "nombre": "Ana Revisora",
                                   "iniciales": "AR", "fecha": "20/09/2026"}],
             "firmas_aprobacion": [{"user_id": "u2", "rol": "Aprobador", "nombre": "Beto Aprobador",
                                     "iniciales": "BA", "fecha": "20/09/2026"}]},
            {"tipo": "VP", "sellado": False, "fecha_sellado": None,
             "pdf_hash": None, "json_hash": None,
             "firmas_revision": [{"user_id": "u1", "rol": "Revisor", "nombre": "Ana Revisora",
                                   "iniciales": "AR", "fecha": "21/09/2026"}],
             "firmas_aprobacion": []},
        ],
    }
    project_id = "contract-test-project"

    python_out = _normalize_status(wrap_signature_book_as_document(book_data, project_id, only_sealed=True))

    script = "js/validation-suite/templates/_libro_firmas_wrapper_contract.js"
    project_meta = {"projectId": project_id, "code": project_id, "systemName": "", "client": ""}
    proc = subprocess.run(
        ["node", script, json.dumps(book_data), json.dumps(project_meta), "true"],
        cwd=r"C:\Users\fjbon\OneDrive\Escritorio\SMART Validation\SMART_Validation",
        capture_output=True, timeout=15,
    )
    proc.stdout = proc.stdout.decode("utf-8")
    proc.stderr = proc.stderr.decode("utf-8", errors="replace")
    assert proc.returncode == 0, proc.stderr
    js_out = _normalize_status(json.loads(proc.stdout))

    # `only_sealed` en el wrapper Python solo cambia el TEXTO de document.status (el
    # "alcance" declarado) -- el filtrado real de qué documentos entran pasa antes, en
    # build_signature_book_data (ver test_book_package_signature_chapter_excludes_
    # unsealed_documents). Acá se le pasa a mano la MISMA lista de 2 documentos (uno
    # sellado, uno no) a ambos wrappers -- lo que se compara es la forma que cada uno
    # produce para una entrada idéntica, no el filtro de sellado en sí.
    assert python_out["type"] == js_out["type"] == "LIBRO_FIRMAS"
    assert python_out["package"] == js_out["package"]
    assert set(python_out["document"].keys()) == set(js_out["document"].keys())
    for key in ("titleEs", "titleEn", "code", "version"):
        assert python_out["document"][key] == js_out["document"][key]
    assert python_out["document"]["status"] == js_out["document"]["status"]
    assert python_out["matrizAprobaciones"] == js_out["matrizAprobaciones"] == []
    assert python_out["controlCambios"] == js_out["controlCambios"] == []

    py_secciones = python_out["secciones"]
    js_secciones = js_out["secciones"]
    assert len(py_secciones) == len(js_secciones)
    assert py_secciones[0] == js_secciones[0]  # declaración: misma forma, mismos firmantes
    for py_sec, js_sec in zip(py_secciones[1:], js_secciones[1:]):
        assert py_sec == js_sec


# ─── Modal de consentimiento: carrera de cancelación (Codex, tercera devolución) ──────

def test_consent_modal_cancel_race_condition():
    """Ronda 19, tercera devolución de Codex (2026-09-21): "Aceptar → cancelar antes de
    que termine el POST → llega 200: ejecuta el callback igualmente, abriendo la
    continuación de firma aunque se canceló el modal." Reproduce ese escenario exacto (y
    dos más relacionados: versión obsoleta + reintento, y reemplazar un modal por otro
    antes de que responda el anterior) con las funciones REALES de
    suite-revision-firmas/static/js/signature-consent.js -- el módulo compartido que ahora
    usan review.html y approval.html -- corriendo en Node con DOM/apiFetch simulados y
    controlados a mano (mismo método que usó Codex, ahora como regresión permanente en vez
    de una sonda ad hoc)."""
    script = "static/js/_signature_consent_modal_check.js"
    proc = subprocess.run(
        ["node", script],
        cwd=r"C:\Users\fjbon\OneDrive\Escritorio\SMART Validation\SMART_Validation\suite-revision-firmas",
        capture_output=True, timeout=15,
    )
    stdout = proc.stdout.decode("utf-8")
    stderr = proc.stderr.decode("utf-8", errors="replace")
    payload = json.loads(stdout)
    failed = [r for r in payload["results"] if not r["ok"]]
    assert not failed, f"Escenarios fallidos: {failed}\nstderr: {stderr}"
    assert proc.returncode == 0, stderr
