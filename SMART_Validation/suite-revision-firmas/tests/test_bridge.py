"""Tests del bridge servicio-a-servicio con la Suite Documental (router bridge.py).

Nunca usa sesión de usuario -- confirma explícitamente que ni una cookie de sesión válida
(DRP incluido) sirve acá, solo el header X-Bridge-Key."""
import pytest

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis de Calificación"}, "secciones": []}


def test_push_document_without_header_rejected(client):
    r = client.put("/bridge/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert r.status_code == 401


def test_push_document_with_wrong_key_rejected(client):
    r = client.put(
        "/bridge/projects/proj-1/documents/HLRA",
        json={"json_data": SAMPLE_JSON},
        headers={"X-Bridge-Key": "no-es-la-key"},
    )
    assert r.status_code == 401


def test_drp_session_cookie_alone_does_not_authorize_bridge(drp_client):
    """Una sesión DRP válida (cookie) no alcanza -- el bridge ni siquiera mira la cookie."""
    r = drp_client.put("/bridge/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert r.status_code == 401


def test_push_document_with_correct_key_creates_document(client):
    r = client.put(
        "/bridge/projects/proj-1/documents/HLRA",
        json={"json_data": SAMPLE_JSON},
        headers={"X-Bridge-Key": "test-bridge-key"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_push_document_replaces_existing_source(client, drp_client):
    client.put(
        "/bridge/projects/proj-1/documents/HLRA",
        json={"json_data": SAMPLE_JSON},
        headers={"X-Bridge-Key": "test-bridge-key"},
    )
    updated = {**SAMPLE_JSON, "metadata": {"title": "Versión corregida vía bridge"}}
    r = client.put(
        "/bridge/projects/proj-1/documents/HLRA",
        json={"json_data": updated},
        headers={"X-Bridge-Key": "test-bridge-key"},
    )
    assert r.status_code == 200

    got = drp_client.get("/projects/proj-1/documents/HLRA")
    assert got.json()["document"]["json_data"]["metadata"]["title"] == "Versión corregida vía bridge"


def test_push_document_rejects_when_locked(client, drp_client):
    """Misma protección que ya tiene la carga manual -- el bridge no la saltea."""
    client.put(
        "/bridge/projects/proj-1/documents/HLRA",
        json={"json_data": SAMPLE_JSON},
        headers={"X-Bridge-Key": "test-bridge-key"},
    )
    from app.db import get_db
    db = get_db()
    db.execute("UPDATE rf_documents SET locked=1 WHERE project_id='proj-1' AND doc_type='HLRA'")
    db.commit()

    r = client.put(
        "/bridge/projects/proj-1/documents/HLRA",
        json={"json_data": SAMPLE_JSON},
        headers={"X-Bridge-Key": "test-bridge-key"},
    )
    assert r.status_code == 409


def test_pull_comments_without_header_rejected(client):
    r = client.get("/bridge/projects/proj-1/documents/HLRA/comments")
    assert r.status_code == 401


def test_pull_comments_matches_what_the_user_endpoint_sees(client, drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "aclarar el alcance"},
    )

    bridge_view = client.get(
        "/bridge/projects/proj-1/documents/HLRA/comments", headers={"X-Bridge-Key": "test-bridge-key"},
    )
    user_view = drp_client.get("/projects/proj-1/documents/HLRA/comments")

    assert bridge_view.status_code == 200
    assert bridge_view.json()["comments"] == user_view.json()["comments"]


def test_pull_comments_missing_document_404(client):
    r = client.get(
        "/bridge/projects/proj-x/documents/NOEXISTE/comments", headers={"X-Bridge-Key": "test-bridge-key"},
    )
    assert r.status_code == 404
