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


def test_add_and_list_comments(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    save = cli.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "Sugerencia: aclarar el alcance en el punto 3."},
    )
    assert save.status_code == 200, save.text
    assert save.json()["comment"]["username"] == "revisor"

    listed = cli.get("/projects/proj-1/documents/HLRA/comments")
    assert listed.status_code == 200
    comments = listed.json()["comments"]
    assert len(comments) == 1
    assert comments[0]["section_key"] == "proposito"
    assert comments[0]["username"] == "revisor"


def test_multiple_comments_on_same_section_do_not_overwrite(drp_client, cliente_client):
    """Antes un segundo comentario en la misma sección pisaba al primero -- ahora cada
    comentario es una fila propia, atribuida a quien lo escribió."""
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    drp_client.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "v1 (drp)"})
    cli.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "v2 (cliente)"})

    comments = drp_client.get("/projects/proj-1/documents/HLRA/comments").json()["comments"]
    assert len(comments) == 2
    assert {c["content"] for c in comments} == {"v1 (drp)", "v2 (cliente)"}
    assert {c["username"] for c in comments} == {"fbongiovanni", "revisor"}


def test_get_document_includes_resolved_flag_in_comments(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    created = drp_client.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "v1"})
    comment_id = created.json()["comment"]["id"]

    doc = drp_client.get("/projects/proj-1/documents/HLRA").json()
    assert doc["comments"][0]["resolved"] == 0

    drp_client.patch(f"/projects/proj-1/documents/HLRA/sections/proposito/comments/{comment_id}/resolve")
    doc2 = drp_client.get("/projects/proj-1/documents/HLRA").json()
    assert doc2["comments"][0]["resolved"] == 1


def test_comment_does_not_touch_source_json(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "comentario"})
    doc = drp_client.get("/projects/proj-1/documents/HLRA").json()["document"]
    assert doc["json_data"] == SAMPLE_JSON


def test_client_without_grant_cannot_add_comment(cliente_client):
    cli, _user_id = cliente_client
    r = cli.post("/projects/proj-1/documents/HLRA/sections/x/comments", json={"content": "no debería poder"})
    # El documento ni siquiera existe todavía en este test — igual debe bloquear por falta de grant.
    assert r.status_code == 403


def test_add_comment_on_missing_document_404(drp_client):
    r = drp_client.post("/projects/proj-1/documents/NOEXISTE/sections/x/comments", json={"content": "x"})
    assert r.status_code == 404


def test_add_comment_notifies_every_active_drp_user_including_the_author(drp_client, cliente_client, monkeypatch):
    """Con un solo DRP en el sistema, excluir al autor significaba que ese DRP nunca se
    enteraba de sus propios comentarios (reportado por el usuario 2026-08-31) — ahora
    siempre se notifica a todo DRP activo, sin excepción por autoría."""
    calls = []
    monkeypatch.setattr(
        "app.routers.documents.email_resend.send_new_comment_email",
        lambda to, display_name, project_id, doc_type, section_key, author, content, link: calls.append((to, author)),
    )
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    # El cliente comenta -> se le avisa a DRP.
    cli.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "c1"})
    assert len(calls) == 1
    assert calls[0][1] == "revisor"

    # DRP comenta -> también se notifica a sí mismo (único DRP activo).
    drp_client.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "c2"})
    assert len(calls) == 2
    assert calls[1][1] == "fbongiovanni"


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


def test_document_grants_lists_who_has_access(drp_client, cliente_client):
    """GET /{doc_type}/grants — usado por el panel "Asignar acceso" del dashboard,
    para poder invitar/otorgar accesos sin salir de la pantalla de carga de documentos."""
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client

    empty = drp_client.get("/projects/proj-1/documents/HLRA/grants")
    assert empty.status_code == 200
    assert empty.json()["grants"] == []

    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    r = drp_client.get("/projects/proj-1/documents/HLRA/grants")
    assert r.status_code == 200
    grants = r.json()["grants"]
    assert len(grants) == 1
    assert grants[0]["user_id"] == user_id
    assert grants[0]["email"] == "revisor@example.com"
    assert grants[0]["role"] == "cliente"


def test_document_grants_requires_drp(cliente_client):
    cli, _user_id = cliente_client
    r = cli.get("/projects/proj-1/documents/HLRA/grants")
    assert r.status_code == 403
