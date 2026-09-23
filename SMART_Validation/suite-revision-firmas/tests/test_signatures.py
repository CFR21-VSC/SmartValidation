"""Tests de firma de revisión y firma de aprobación (Capa 5)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import accept_signature_consent

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis"}, "secciones": []}


@pytest.fixture
def cliente(drp_client):
    """Cliente invitado, con grant, con PIN configurado, en su propio TestClient."""
    created = drp_client.post(
        "/users",
        json={"username": "firmante", "email": "firmante@example.com", "display_name": "Firmante", "role": "cliente"},
    )
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    accept_signature_consent(cli)
    return cli, user_id


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    accept_signature_consent(drp_client)
    return drp_client


@pytest.fixture
def unassigned_drp(drp_client):
    """Segundo DRP, NO superadmin, invitado por el primero -- sin ningún grant. Precaución
    del usuario 2026-09-23: ser DRP alcanza para ver un documento no privado, pero no para
    firmarlo sin asignación explícita (ver check_can_sign en deps.py). Devuelve (cliente,
    user_id) -- mismo shape que el fixture `cliente`, de arriba."""
    created = drp_client.post(
        "/users",
        json={"username": "otro-drp", "email": "otro-drp@example.com", "display_name": "Otro DRP", "role": "drp"},
    )
    assert created.status_code == 200, created.text
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    accept = cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "5678"})
    assert accept.status_code == 200, accept.text
    accept_signature_consent(cli)
    return cli, user_id


def _fp(drp, project_id="proj-1", doc_type="HLRA"):
    """content_fingerprint vigente del documento -- Ronda 18: review-signatures y
    approval-round/sign lo exigen y lo comparan contra el string guardado. Se usa `drp`
    (superadmin) para leerlo porque siempre tiene acceso, sin depender de grants de cada
    test. Los tests no modifican el documento entre el PUT inicial y las firmas, así que
    un solo fetch alcanza."""
    return drp.get(f"/projects/{project_id}/documents/{doc_type}").json()["content_fingerprint"]


def _superadmin_id(drp_client):
    # El propio DRP no aparece en /users (esa lista es de invitados creados) — lo resolvemos
    # via /auth/session + una consulta indirecta no expuesta; en su lugar los tests usan el uid
    # devuelto en la cookie de sesión, accesible solo server-side. Para tests, lo obtenemos
    # forzando el login y decodificando la respuesta de /auth/session no alcanza (no expone uid).
    # Se resuelve consultando la db directamente desde el test (mismo proceso).
    from app.db import get_db
    row = get_db().execute("SELECT id FROM rf_users WHERE is_superadmin=1").fetchone()
    return row["id"]


def test_review_sign_happy_path(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "role_label": "Revisor", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r.status_code == 200, r.text

    listed = cli.get("/projects/proj-1/documents/HLRA/review-signatures").json()["signatures"]
    assert len(listed) == 1
    assert listed[0]["role_label"] == "Revisor"


def test_review_sign_blocked_by_unresolved_comment(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    created = cli.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "corregir esto"})
    comment_id = created.json()["comment"]["id"]

    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r.status_code == 409

    drp_with_pin.patch(f"/projects/proj-1/documents/HLRA/sections/proposito/comments/{comment_id}/resolve")
    r2 = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r2.status_code == 200


def test_review_sign_not_blocked_by_a_reply_on_a_resolved_thread(drp_with_pin, cliente):
    """Regresión: una respuesta (hilo, sección 2026-09-01) queda siempre con resolved=0 --
    si el conteo de pendientes no filtrara parent_id IS NULL, un hilo ya resuelto con al
    menos una respuesta bloquearía la firma para siempre."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    created = cli.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "pregunta"})
    comment_id = created.json()["comment"]["id"]
    drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "ya lo corrijo", "parent_id": comment_id},
    )
    drp_with_pin.patch(f"/projects/proj-1/documents/HLRA/sections/proposito/comments/{comment_id}/resolve")

    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r.status_code == 200, r.text


def test_review_sign_wrong_pin(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "0000", "content_fingerprint": _fp(drp_with_pin)},
    )
    assert r.status_code == 401


def test_pin_locks_out_after_five_failed_attempts(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin)

    for _ in range(5):
        r = cli.post(
            "/projects/proj-1/documents/HLRA/review-signatures",
            json={"pin": "0000", "content_fingerprint": fp},
        )
        assert r.status_code == 401

    locked = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )  # PIN correcto
    assert locked.status_code == 429
    assert "intentos" in locked.json()["detail"].lower()


def test_pin_lockout_is_shared_between_set_pin_and_signing(drp_with_pin, cliente):
    """Ronda 20 (2026-09-21): antes /auth/set-pin no tenía freno de fuerza bruta propio -- una
    sesión robada podía agotar las 10.000 combinaciones de un PIN ahí sin límite, descubrir el
    PIN real, y recién después firmar de verdad con review-signatures (que sí estaba
    protegido), evadiendo por completo el propósito del freno. Ahora comparten un solo
    contador por usuario: agotar los intentos en UN endpoint bloquea también al otro."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin)

    for _ in range(5):
        r = cli.post("/auth/set-pin", json={"pin": "1111", "current_pin": "0000"})
        assert r.status_code == 401

    # El contador es del USUARIO, no del endpoint -- agotado vía set-pin, review-signatures
    # con el PIN CORRECTO también queda bloqueado.
    locked = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    assert locked.status_code == 429


def test_pin_lockout_is_scoped_per_user(drp_with_pin, cliente):
    """Un firmante bloqueado por PIN no afecta a otro firmante del mismo documento."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin)
    for _ in range(5):
        cli.post(
            "/projects/proj-1/documents/HLRA/review-signatures",
            json={"pin": "0000", "content_fingerprint": fp},
        )

    # DRP (otro usuario, PIN propio) sigue pudiendo firmar sin problema.
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": fp},
    )
    assert r.status_code == 200, r.text


def test_pin_attempts_reset_after_success(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin)

    for _ in range(4):  # justo por debajo del límite (5)
        cli.post(
            "/projects/proj-1/documents/HLRA/review-signatures",
            json={"pin": "0000", "content_fingerprint": fp},
        )
    ok = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    assert ok.status_code == 200


def test_review_sign_duplicate_rejected(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin)
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    assert r.status_code == 409


def test_approval_round_requires_superadmin_last(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": user_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    assert r.status_code == 400
    assert "DRP" in r.text


def test_approval_sign_last_signer_superadmin_checked_live(drp_with_pin, cliente):
    """El chequeo de "último firmante debe ser superadmin" tiene que releer la base en
    el momento de firmar, no confiar en el atributo `sa` fijado en el token al loguearse
    -- si alguien pierde is_superadmin después de loguearse, su sesión ya abierta no debe
    poder sellar igual, tal como is_active ya se revalida en cada request (deps.py)."""
    from app.db import get_db

    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    db = get_db()
    # Promoción temporal: necesaria para poder crear la ronda (el creador ya exige
    # is_superadmin=1 en base para el último firmante) y para que el re-login emita
    # un token con sa=true.
    db.execute("UPDATE rf_users SET is_superadmin=1 WHERE id=?", (user_id,))
    db.commit()
    cli.post("/auth/login", json={"username": "firmante", "password": "password123"})

    created = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": user_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    assert created.status_code == 200, created.text

    # Se revoca is_superadmin en la base sin que la sesión ya emitida de "firmante" se
    # entere -- su token sigue firmado con sa=true.
    db.execute("UPDATE rf_users SET is_superadmin=0 WHERE id=?", (user_id,))
    db.commit()

    r = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={
            "pin": "1234", "justification_text": "Apruebo", "pdf_base64": "JVBERi0xLjQgZmFrZSB0ZXN0IHBkZg==",
            "content_fingerprint": _fp(drp_with_pin),
        },
    )
    assert r.status_code == 403
    assert "DRP" in r.text


def test_approval_round_rejects_signer_without_document_access(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_id = _superadmin_id(drp_with_pin)
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [
            {"user_id": user_id, "role_label": "Revisor", "sign_order": 1},
            {"user_id": drp_id, "role_label": "Aprobador", "sign_order": 2},
        ]},
    )
    assert r.status_code == 400
    assert "acceso" in r.text


def test_full_approval_flow_seals_document(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    drp_id = _superadmin_id(drp_with_pin)

    created = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [
            {"user_id": user_id, "role_label": "Revisor (Key User)", "sign_order": 1},
            {"user_id": drp_id, "role_label": "Aprobador (CEO)", "sign_order": 2},
        ]},
    )
    assert created.status_code == 200, created.text
    fp = _fp(drp_with_pin)

    # El firmante 2 (DRP) no puede firmar todavía — falta el firmante 1.
    early = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={
            "pin": "9999", "justification_text": "Conforme", "pdf_base64": "JVBERi0xLjQgZmFrZSB0ZXN0IHBkZg==",
            "content_fingerprint": fp,
        },
    )
    assert early.status_code == 409

    # Firmante 1 (cliente) firma.
    r1 = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "1234", "justification_text": "De acuerdo con el contenido", "content_fingerprint": fp},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["sealed"] is False

    # DRP firma último sin adjuntar PDF -> rechazado.
    missing_pdf = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "9999", "justification_text": "Apruebo", "content_fingerprint": fp},
    )
    assert missing_pdf.status_code == 400

    # DRP firma último con PDF -> sella.
    r2 = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={
            "pin": "9999", "justification_text": "Apruebo", "pdf_base64": "JVBERi0xLjQgZmFrZSB0ZXN0IHBkZg==",
            "content_fingerprint": fp,
        },
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["sealed"] is True

    doc = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()["document"]
    assert doc["locked"] == 1
    assert doc["pdf_hash"]
    assert doc["json_hash"]

    # Documento sellado: ni cargar una nueva versión ni comentar están permitidos.
    reload_attempt = drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert reload_attempt.status_code == 409
    comment_attempt = cli.post("/projects/proj-1/documents/HLRA/sections/x/comments", json={"content": "tarde"})
    assert comment_attempt.status_code == 409


def test_approval_sign_out_of_turn_rejected(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    drp_id = _superadmin_id(drp_with_pin)
    drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [
            {"user_id": user_id, "role_label": "Revisor", "sign_order": 1},
            {"user_id": drp_id, "role_label": "Aprobador", "sign_order": 2},
        ]},
    )
    r = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={
            "pin": "9999", "justification_text": "x", "pdf_base64": "eA==",
            "content_fingerprint": _fp(drp_with_pin),
        },
    )
    assert r.status_code == 409


def test_approval_sign_twice_rejected(drp_with_pin, cliente):
    """Reportado por el usuario: 'hoy puedo seguir firmando después de haber firmado'."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    drp_id = _superadmin_id(drp_with_pin)
    drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [
            {"user_id": user_id, "role_label": "Revisor", "sign_order": 1},
            {"user_id": drp_id, "role_label": "Aprobador", "sign_order": 2},
        ]},
    )
    fp = _fp(drp_with_pin)
    first = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "1234", "justification_text": "De acuerdo", "content_fingerprint": fp},
    )
    assert first.status_code == 200
    second = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "1234", "justification_text": "De nuevo", "content_fingerprint": fp},
    )
    assert second.status_code == 409
    assert "Ya firmaste" in second.text


def test_people_book_records_full_trail(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    created = cli.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "sugerencia"})
    comment_id = created.json()["comment"]["id"]
    drp_with_pin.patch(f"/projects/proj-1/documents/HLRA/sections/proposito/comments/{comment_id}/resolve")
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )

    events = drp_with_pin.get("/projects/proj-1/documents/HLRA/people-book").json()["events"]
    event_types = [e["event_type"] for e in events]
    assert event_types == [
        "document_loaded", "comment_added", "comment_resolved", "review_signed",
    ]


def test_people_book_requires_drp(cliente):
    cli, _user_id = cliente
    r = cli.get("/projects/proj-1/documents/HLRA/people-book")
    assert r.status_code == 403


def test_cannot_open_second_approval_round_while_one_is_open(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    drp_id = _superadmin_id(drp_with_pin)
    body = {"signers": [
        {"user_id": user_id, "role_label": "Revisor", "sign_order": 1},
        {"user_id": drp_id, "role_label": "Aprobador", "sign_order": 2},
    ]}
    drp_with_pin.post("/projects/proj-1/documents/HLRA/approval-round", json=body)
    r = drp_with_pin.post("/projects/proj-1/documents/HLRA/approval-round", json=body)
    assert r.status_code == 409


# ─── DRP sin asignación no puede firmar (precaución del usuario 2026-09-23) ────

def test_review_sign_rejected_for_drp_without_grant(drp_with_pin, unassigned_drp):
    cli, _user_id = unassigned_drp
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    # Ser DRP alcanza para VER el documento -- el proyecto no es privado.
    seen = cli.get("/projects/proj-1/documents/HLRA")
    assert seen.status_code == 200
    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "5678", "role_label": "Revisor", "content_fingerprint": seen.json()["content_fingerprint"]},
    )
    assert r.status_code == 403
    assert "asignaci" in r.text


def test_close_review_rejected_for_drp_without_grant(drp_with_pin, unassigned_drp):
    cli, _user_id = unassigned_drp
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = cli.post("/projects/proj-1/documents/HLRA/close-review", json={"pin": "5678"})
    assert r.status_code == 403


def test_approval_round_open_rejected_for_drp_without_grant(drp_with_pin, unassigned_drp):
    cli, _user_id = unassigned_drp
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert drp_with_pin.post("/projects/proj-1/documents/HLRA/close-review", json={"pin": "9999"}).status_code == 200
    drp_id = _superadmin_id(drp_with_pin)
    r = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": drp_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    assert r.status_code == 403


def test_drp_can_self_grant_then_sign(drp_with_pin, unassigned_drp):
    """El DRP sin asignación puede autoasignarse el grant (es admin, /grants no exige más
    que require_drp) y a partir de ahí SÍ puede firmar -- la restricción es "necesita
    asignación", no "nunca puede ser DRP", tal como lo pidió el usuario."""
    cli, my_id = unassigned_drp
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    granted = cli.post(f"/users/{my_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    assert granted.status_code == 200, granted.text

    fp = cli.get("/projects/proj-1/documents/HLRA").json()["content_fingerprint"]
    r = cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "5678", "role_label": "Revisor", "content_fingerprint": fp},
    )
    assert r.status_code == 200, r.text


# ─── Ver PDF con firmas reales inyectadas (no solo en el Libro) ────────────

def test_signed_render_shows_no_signatures_before_anyone_signs(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render")
    assert r.status_code == 200
    fh = next(s for s in r.json()["data"]["secciones"] if s.get("tipo") == "firmas-horizontales")
    assert fh["firmasRevision"] == []
    assert fh["firmasAprobacion"] == []


def test_signed_render_shows_review_signature_immediately(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "role_label": "Revisor", "content_fingerprint": _fp(drp_with_pin)},
    )

    r = cli.get("/projects/proj-1/documents/HLRA/signed-render")
    fh = next(s for s in r.json()["data"]["secciones"] if s.get("tipo") == "firmas-horizontales")
    assert len(fh["firmasRevision"]) == 1
    assert fh["firmasRevision"][0]["rol"] == "Revisor"
    assert fh["firmasAprobacion"] == []


def test_signed_render_does_not_persist_injection_into_source(drp_with_pin, cliente):
    """La inyección es al vuelo — el JSON fuente guardado (panel izquierdo) no se toca."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": _fp(drp_with_pin)},
    )
    drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render")

    doc = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()["document"]
    assert doc["json_data"] == SAMPLE_JSON


def test_signed_render_include_pending_adds_own_unsigned_signature(drp_with_pin, cliente):
    """La firma que sella (la última) todavía no está grabada en el momento de generar el
    PDF que se va a adjuntar — include_pending la suma igual, con la fecha de hoy, para que
    el documento hasheado para siempre muestre el circuito completo."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    drp_id = _superadmin_id(drp_with_pin)
    drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [
            {"user_id": user_id, "role_label": "Revisor", "sign_order": 1},
            {"user_id": drp_id, "role_label": "Aprobador CEO", "sign_order": 2},
        ]},
    )
    cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "1234", "justification_text": "ok", "content_fingerprint": _fp(drp_with_pin)},
    )

    without_pending = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render")
    fh = next(s for s in without_pending.json()["data"]["secciones"] if s.get("tipo") == "firmas-horizontales")
    assert len(fh["firmasAprobacion"]) == 1  # solo la del cliente, DRP todavía no firmó
    assert fh["firmasRevision"] == []

    with_pending = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render?include_pending=true")
    fh2 = next(s for s in with_pending.json()["data"]["secciones"] if s.get("tipo") == "firmas-horizontales")
    assert len(fh2["firmasAprobacion"]) == 2
    assert fh2["firmasAprobacion"][1]["rol"] == "Aprobador CEO"
    assert fh2["firmasAprobacion"][1]["fecha"]  # tiene fecha de hoy aunque no esté grabada todavía


def test_signed_render_include_pending_noop_if_not_a_pending_signer(drp_with_pin):
    """DRP pide include_pending pero no es firmante de ninguna ronda abierta — no debe agregar
    nada ni romper."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render?include_pending=true")
    fh = next(s for s in r.json()["data"]["secciones"] if s.get("tipo") == "firmas-horizontales")
    assert fh["firmasRevision"] == []
    assert fh["firmasAprobacion"] == []


def test_signed_render_requires_document_access(cliente):
    cli, _uid = cliente
    r = cli.get("/projects/proj-1/documents/HLRA/signed-render")
    assert r.status_code == 403
