"""Tests de la vista de revisión: carga de documentos y correcciones (Capa 3)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def cliente_client(drp_client):
    """TestClient propio (cookie jar independiente) logueado como cliente invitado,
    sin acceso a ningún documento todavía. Debe ser un TestClient distinto de
    drp_client: si reusaran el mismo, loguear al cliente pisaría la cookie de sesión
    de DRP en el mismo objeto."""
    created = drp_client.post(
        "/users",
        json={"username": "revisor", "email": "revisor@example.com", "display_name": "Revisor", "role": "cliente"},
    )
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    accept = cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    assert accept.status_code == 200
    return cli, created.json()["user_id"]


SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis de Calificación"}, "secciones": []}


def test_drp_can_load_document(drp_client):
    r = drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_load_document_requires_drp(client):
    r = client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert r.status_code == 401


def test_drp_can_reload_document_overwrites_source(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    updated = {**SAMPLE_JSON, "metadata": {"title": "Versión corregida"}}
    r = drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": updated})
    assert r.status_code == 200
    got = drp_client.get("/projects/proj-1/documents/HLRA")
    assert got.json()["document"]["json_data"]["metadata"]["title"] == "Versión corregida"


def test_get_document_not_found(drp_client):
    r = drp_client.get("/projects/proj-x/documents/URS")
    assert r.status_code == 404


def test_client_without_grant_cannot_see_document(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, _user_id = cliente_client
    r = cli.get("/projects/proj-1/documents/HLRA")
    assert r.status_code == 403


def test_client_with_grant_can_see_document(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    r = cli.get("/projects/proj-1/documents/HLRA")
    assert r.status_code == 200
    assert r.json()["document"]["json_data"]["type"] == "HLRA"


def test_client_cannot_load_document(cliente_client):
    cli, _user_id = cliente_client
    r = cli.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert r.status_code == 403


def test_list_documents_scoped_by_role(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS"}})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    drp_list = drp_client.get("/projects/proj-1/documents").json()["documents"]
    assert {d["doc_type"] for d in drp_list} == {"HLRA", "URS"}

    cli_list = cli.get("/projects/proj-1/documents").json()["documents"]
    assert {d["doc_type"] for d in cli_list} == {"HLRA"}


def test_save_and_list_corrections(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    save = cli.put(
        "/projects/proj-1/documents/HLRA/sections/proposito",
        json={"content": "Sugerencia: aclarar el alcance en el punto 3."},
    )
    assert save.status_code == 200, save.text

    listed = cli.get("/projects/proj-1/documents/HLRA/corrections")
    assert listed.status_code == 200
    corr = listed.json()["corrections"]
    assert len(corr) == 1
    assert corr[0]["section_key"] == "proposito"


def test_correction_overwrite_same_section_does_not_duplicate(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-1/documents/HLRA/sections/proposito", json={"content": "v1"})
    drp_client.put("/projects/proj-1/documents/HLRA/sections/proposito", json={"content": "v2"})
    corr = drp_client.get("/projects/proj-1/documents/HLRA/corrections").json()["corrections"]
    assert len(corr) == 1
    assert corr[0]["content"] == "v2"


def test_get_document_includes_resolved_flag_in_corrections(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-1/documents/HLRA/sections/proposito", json={"content": "v1"})
    doc = drp_client.get("/projects/proj-1/documents/HLRA").json()
    assert doc["corrections"][0]["resolved"] == 0

    drp_client.patch("/projects/proj-1/documents/HLRA/sections/proposito/resolve")
    doc2 = drp_client.get("/projects/proj-1/documents/HLRA").json()
    assert doc2["corrections"][0]["resolved"] == 1


def test_correction_does_not_touch_source_json(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-1/documents/HLRA/sections/proposito", json={"content": "corrección"})
    doc = drp_client.get("/projects/proj-1/documents/HLRA").json()["document"]
    assert doc["json_data"] == SAMPLE_JSON


def test_client_without_grant_cannot_save_correction(cliente_client):
    cli, _user_id = cliente_client
    r = cli.put("/projects/proj-1/documents/HLRA/sections/x", json={"content": "no debería poder"})
    # El documento ni siquiera existe todavía en este test — igual debe bloquear por falta de grant.
    assert r.status_code == 403


def test_save_correction_on_missing_document_404(drp_client):
    r = drp_client.put("/projects/proj-1/documents/NOEXISTE/sections/x", json={"content": "x"})
    assert r.status_code == 404


def test_list_projects_scoped_by_role(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-2/documents/URS", json={"json_data": {"type": "URS"}})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    drp_projects = drp_client.get("/projects").json()["projects"]
    assert {p["id"] for p in drp_projects} == {"proj-1", "proj-2"}
    assert all(p["status"] == "active" for p in drp_projects)

    cli_projects = cli.get("/projects").json()["projects"]
    assert [p["id"] for p in cli_projects] == ["proj-1"]
