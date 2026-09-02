"""Tests de GET /me/pending-comments (sección 2026-09-01) -- bandeja de pendientes
cruzando proyectos, scoped por rol."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis"}, "secciones": []}


@pytest.fixture
def cliente_client(drp_client):
    """TestClient propio (cookie jar independiente) logueado como cliente invitado."""
    created = drp_client.post(
        "/users",
        json={"username": "revisor", "email": "revisor@example.com", "display_name": "Revisor", "role": "cliente"},
    )
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    accept = cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    assert accept.status_code == 200
    return cli, created.json()["user_id"]


def test_drp_sees_pending_across_all_projects(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-2/documents/URS", json={"json_data": {"type": "URS"}})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-2", "doc_type": "URS"})

    cli.post("/projects/proj-1/documents/HLRA/sections/x/comments", json={"content": "c1"})
    cli.post("/projects/proj-2/documents/URS/sections/y/comments", json={"content": "c2"})

    r = drp_client.get("/me/pending-comments")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["count"] == 2
    assert {(i["project_id"], i["doc_type"]) for i in data["items"]} == {("proj-1", "HLRA"), ("proj-2", "URS")}


def test_client_only_sees_pending_of_granted_documents(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-2/documents/URS", json={"json_data": {"type": "URS"}})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    # Sin grant en proj-2 -- el cliente no debe ver su pendiente aunque exista.

    drp_client.post("/projects/proj-1/documents/HLRA/sections/x/comments", json={"content": "c1"})
    drp_client.post("/projects/proj-2/documents/URS/sections/y/comments", json={"content": "c2"})

    r = cli.get("/me/pending-comments")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["count"] == 1
    assert data["items"][0]["project_id"] == "proj-1"


def test_resolved_comment_does_not_count(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    comment_id = drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/x/comments", json={"content": "c1"}
    ).json()["comment"]["id"]

    before = drp_client.get("/me/pending-comments").json()
    assert before["count"] == 1

    drp_client.patch(f"/projects/proj-1/documents/HLRA/sections/x/comments/{comment_id}/resolve")
    after = drp_client.get("/me/pending-comments").json()
    assert after["count"] == 0


def test_replies_do_not_count_as_separate_items(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    root_id = cli.post(
        "/projects/proj-1/documents/HLRA/sections/x/comments", json={"content": "pregunta"}
    ).json()["comment"]["id"]
    drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/x/comments",
        json={"content": "respuesta", "parent_id": root_id},
    )

    r = drp_client.get("/me/pending-comments").json()
    assert r["count"] == 1  # el hilo cuenta una sola vez, la respuesta no suma


def test_pending_comments_empty_by_default(drp_client):
    r = drp_client.get("/me/pending-comments")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "count": 0, "items": []}


def test_pending_comments_requires_auth(client):
    r = client.get("/me/pending-comments")
    assert r.status_code == 401
