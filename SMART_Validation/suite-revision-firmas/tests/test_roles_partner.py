"""Rol intermedio "partner" (2026-09-19, pedido del usuario): una empresa que colabora
activamente en el proyecto (ej. EMARA) sin ser DRP. A diferencia de cliente, un partner con
al menos un documento otorgado en un proyecto ve el dossier COMPLETO de ese proyecto y puede
reabrir los documentos donde tiene acceso -- todo lo demás (cargar/editar documentos, crear
rondas de aprobación, sellar, borrar, gestionar usuarios) sigue siendo exclusivo de DRP."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import accept_signature_consent

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis"}, "secciones": []}


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    accept_signature_consent(drp_client)
    return drp_client


def _invite(drp, username, role):
    created = drp.post(
        "/users",
        json={"username": username, "email": f"{username}@example.com", "display_name": username, "role": role},
    )
    assert created.status_code == 200, created.text
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    accept = cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    assert accept.status_code == 200, accept.text
    accept_signature_consent(cli)
    return cli, user_id


@pytest.fixture
def partner(drp_client):
    return _invite(drp_client, "partner-co", "partner")


@pytest.fixture
def cliente(drp_client):
    return _invite(drp_client, "cliente-co", "cliente")


def _fp(drp, project_id, doc_type):
    return drp.get(f"/projects/{project_id}/documents/{doc_type}").json()["content_fingerprint"]


# ─── Dossier: visibilidad completa para partner con al menos un grant ─────────

def test_partner_with_one_grant_sees_full_project_dossier(drp_with_pin, partner):
    """A diferencia de cliente, un partner con acceso a CUALQUIER documento del proyecto ve
    TODOS los documentos en el dossier, no solo el que tiene otorgado."""
    part, user_id = partner
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS", "secciones": []}})
    drp_with_pin.put("/projects/proj-1/documents/RA", json={"json_data": {"type": "RA", "secciones": []}})
    # Solo se le otorga UN documento.
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    dossier = part.get("/projects/proj-1/dossier").json()
    assert {d["doc_type"] for d in dossier["documents"]} == {"HLRA", "URS", "RA"}


def test_partner_without_any_grant_sees_empty_dossier(drp_with_pin, partner):
    """Sin ningún documento otorgado en el proyecto, un partner no ve nada -- mismo criterio
    que cliente, la visibilidad ampliada depende de tener PIE en el proyecto."""
    part, user_id = partner
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/projects/proj-2/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-2", "doc_type": "HLRA"})

    dossier = part.get("/projects/proj-1/dossier").json()
    assert dossier["documents"] == []


def test_cliente_still_only_sees_own_granted_documents_in_dossier(drp_with_pin, cliente):
    """Regresión: el dossier ampliado es SOLO para partner, cliente sigue viendo nada más
    que sus documentos puntuales aunque el proyecto tenga más."""
    cli, user_id = cliente
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS", "secciones": []}})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    dossier = cli.get("/projects/proj-1/dossier").json()
    assert {d["doc_type"] for d in dossier["documents"]} == {"HLRA"}


# ─── Reopen: partner con grant puede, sin grant no, cliente nunca ─────────────

def test_partner_with_grant_can_reopen_document(drp_with_pin, partner):
    part, user_id = partner
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin, "proj-1", "HLRA")
    signed = part.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    assert signed.status_code == 200, signed.text

    r = part.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "corregir un dato"})
    assert r.status_code == 200, r.text


def test_partner_without_grant_cannot_reopen_document(drp_with_pin, partner):
    """Partner es un rol, no una llave maestra -- sigue necesitando el grant explícito del
    documento puntual, igual que cliente."""
    part, user_id = partner
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    # Sin grant. Firmamos como DRP para que haya algo que reabrir.
    fp = _fp(drp_with_pin, "proj-1", "HLRA")
    drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "9999", "content_fingerprint": fp},
    )
    r = part.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "corregir"})
    assert r.status_code == 403


def test_cliente_with_grant_still_cannot_reopen_document(drp_with_pin, cliente):
    """Regresión: reabrir no pasa a estar disponible para cliente por tener un grant --
    sigue siendo exclusivo de DRP y partner."""
    cli, user_id = cliente
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = _fp(drp_with_pin, "proj-1", "HLRA")
    cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    r = cli.post("/projects/proj-1/documents/HLRA/reopen", json={"reason": "corregir"})
    assert r.status_code == 403


# ─── Lo que un partner sigue SIN poder hacer -- exclusivo de DRP ──────────────

def test_partner_cannot_load_document(drp_with_pin, partner):
    part, user_id = partner
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    r = part.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert r.status_code == 403


def test_partner_cannot_create_approval_round(drp_with_pin, partner):
    part, user_id = partner
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    r = part.post(
        "/projects/proj-1/documents/HLRA/approval-round",
        json={"signers": [{"user_id": user_id, "role_label": "Aprobador", "sign_order": 1}]},
    )
    assert r.status_code == 403


def test_partner_cannot_delete_document(drp_with_pin, partner):
    part, user_id = partner
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    r = part.delete("/projects/proj-1/documents/HLRA")
    assert r.status_code == 403


def test_partner_cannot_manage_users(drp_with_pin, partner):
    part, _user_id = partner
    r = part.post(
        "/users", json={"username": "otro", "email": "otro@example.com", "display_name": "Otro", "role": "cliente"}
    )
    assert r.status_code == 403
