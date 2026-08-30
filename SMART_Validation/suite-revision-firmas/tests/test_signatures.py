"""Tests de firma de revisión y firma de aprobación (Capa 5)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

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
    return cli, user_id


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    return drp_client


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

    r = cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234", "role_label": "Revisor"})
    assert r.status_code == 200, r.text

    listed = cli.get("/projects/proj-1/documents/HLRA/review-signatures").json()["signatures"]
    assert len(listed) == 1
    assert listed[0]["role_label"] == "Revisor"


def test_review_sign_blocked_by_unresolved_correction(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.put("/projects/proj-1/documents/HLRA/sections/proposito", json={"content": "corregir esto"})

    r = cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234"})
    assert r.status_code == 409

    drp_with_pin.patch("/projects/proj-1/documents/HLRA/sections/proposito/resolve")
    r2 = cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234"})
    assert r2.status_code == 200


def test_review_sign_wrong_pin(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    r = cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "0000"})
    assert r.status_code == 401


def test_review_sign_duplicate_rejected(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234"})
    r = cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234"})
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

    # El firmante 2 (DRP) no puede firmar todavía — falta el firmante 1.
    early = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "9999", "justification_text": "Conforme", "pdf_base64": "ZmFrZS1wZGY="},
    )
    assert early.status_code == 409

    # Firmante 1 (cliente) firma.
    r1 = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "1234", "justification_text": "De acuerdo con el contenido"},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["sealed"] is False

    # DRP firma último sin adjuntar PDF -> rechazado.
    missing_pdf = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "9999", "justification_text": "Apruebo"},
    )
    assert missing_pdf.status_code == 400

    # DRP firma último con PDF -> sella.
    r2 = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "9999", "justification_text": "Apruebo", "pdf_base64": "ZmFrZS1wZGY="},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["sealed"] is True

    doc = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()["document"]
    assert doc["locked"] == 1
    assert doc["pdf_hash"]
    assert doc["json_hash"]

    # Documento sellado: ni cargar una nueva versión ni corregir están permitidos.
    reload_attempt = drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert reload_attempt.status_code == 409
    correction_attempt = cli.put("/projects/proj-1/documents/HLRA/sections/x", json={"content": "tarde"})
    assert correction_attempt.status_code == 409


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
        json={"pin": "9999", "justification_text": "x", "pdf_base64": "eA=="},
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
    first = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "1234", "justification_text": "De acuerdo"},
    )
    assert first.status_code == 200
    second = cli.post(
        "/projects/proj-1/documents/HLRA/approval-round/sign",
        json={"pin": "1234", "justification_text": "De nuevo"},
    )
    assert second.status_code == 409
    assert "Ya firmaste" in second.text


def test_people_book_records_full_trail(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.put("/projects/proj-1/documents/HLRA/sections/proposito", json={"content": "sugerencia"})
    drp_with_pin.patch("/projects/proj-1/documents/HLRA/sections/proposito/resolve")
    cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234"})

    events = drp_with_pin.get("/projects/proj-1/documents/HLRA/people-book").json()["events"]
    event_types = [e["event_type"] for e in events]
    assert event_types == [
        "document_loaded", "correction_saved", "correction_resolved", "review_signed",
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


# ─── Ver PDF con firmas reales inyectadas (no solo en el Libro) ────────────

def test_signed_render_shows_no_signatures_before_anyone_signs(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render")
    assert r.status_code == 200
    tff = next(s for s in r.json()["data"]["secciones"] if s.get("tipo") == "tabla-firmas-final")
    assert tff["firmas"] == []


def test_signed_render_shows_review_signature_immediately(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234", "role_label": "Revisor"})

    r = cli.get("/projects/proj-1/documents/HLRA/signed-render")
    tff = next(s for s in r.json()["data"]["secciones"] if s.get("tipo") == "tabla-firmas-final")
    assert len(tff["firmas"]) == 1
    assert tff["firmas"][0]["rol"] == "Revisor"


def test_signed_render_does_not_persist_injection_into_source(drp_with_pin, cliente):
    """La inyección es al vuelo — el JSON fuente guardado (panel izquierdo) no se toca."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    cli.post("/projects/proj-1/documents/HLRA/review-signatures", json={"pin": "1234"})
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
        json={"pin": "1234", "justification_text": "ok"},
    )

    without_pending = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render")
    tff = next(s for s in without_pending.json()["data"]["secciones"] if s.get("tipo") == "tabla-firmas-final")
    assert len(tff["firmas"]) == 1  # solo la del cliente, DRP todavía no firmó

    with_pending = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render?include_pending=true")
    tff2 = next(s for s in with_pending.json()["data"]["secciones"] if s.get("tipo") == "tabla-firmas-final")
    assert len(tff2["firmas"]) == 2
    assert tff2["firmas"][1]["rol"] == "Aprobador CEO"
    assert tff2["firmas"][1]["fecha"]  # tiene fecha de hoy aunque no esté grabada todavía


def test_signed_render_include_pending_noop_if_not_a_pending_signer(drp_with_pin):
    """DRP pide include_pending pero no es firmante de ninguna ronda abierta — no debe agregar
    nada ni romper."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.get("/projects/proj-1/documents/HLRA/signed-render?include_pending=true")
    tff = next(s for s in r.json()["data"]["secciones"] if s.get("tipo") == "tabla-firmas-final")
    assert tff["firmas"] == []


def test_signed_render_requires_document_access(cliente):
    cli, _uid = cliente
    r = cli.get("/projects/proj-1/documents/HLRA/signed-render")
    assert r.status_code == 403
