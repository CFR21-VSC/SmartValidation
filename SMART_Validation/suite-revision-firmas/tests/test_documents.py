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


def test_client_with_grant_in_one_project_cannot_see_a_different_project(drp_client, cliente_client):
    """Confirma explícitamente lo que preguntó el usuario: un cliente con acceso a un
    documento de un proyecto no puede ver NADA de otro proyecto -- ni adivinando la URL, ni
    a través del listado -- aunque ambos proyectos existan y tengan el mismo doc_type."""
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-2/documents/HLRA", json={"json_data": {**SAMPLE_JSON, "metadata": {"title": "Proyecto ajeno"}}})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    # Acceso directo a la URL del documento del otro proyecto -> bloqueado.
    r = cli.get("/projects/proj-2/documents/HLRA")
    assert r.status_code == 403

    # Ni siquiera aparece listado.
    r2 = cli.get("/projects/proj-2/documents")
    assert r2.status_code == 200
    assert r2.json()["documents"] == []

    # Tampoco aparece en la lista de proyectos del cliente.
    projects = cli.get("/projects").json()["projects"]
    assert [p["id"] for p in projects] == ["proj-1"]

    # Y no puede comentar ni firmar ahí.
    assert cli.post("/projects/proj-2/documents/HLRA/sections/x/comments", json={"content": "no debería"}).status_code == 403
    assert cli.post("/projects/proj-2/documents/HLRA/review-signatures", json={"pin": "1234"}).status_code == 403


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


# ─── Hilos de respuesta (parent_id) + emails ─────────────────────────────────

def test_reply_to_comment_keeps_parent_id(drp_client, cliente_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    root = cli.post("/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "pregunta"})
    root_id = root.json()["comment"]["id"]
    assert root.json()["comment"]["parent_id"] is None

    reply = drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "respuesta", "parent_id": root_id},
    )
    assert reply.status_code == 200, reply.text
    assert reply.json()["comment"]["parent_id"] == root_id

    comments = cli.get("/projects/proj-1/documents/HLRA/comments").json()["comments"]
    by_id = {c["id"]: c for c in comments}
    assert by_id[root_id]["parent_id"] is None
    assert by_id[reply.json()["comment"]["id"]]["parent_id"] == root_id


def test_cannot_reply_to_a_reply(drp_client, cliente_client):
    """Hilo plano, no anidado -- una respuesta siempre apunta a la raíz."""
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    root_id = cli.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "pregunta"}
    ).json()["comment"]["id"]
    reply_id = drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "respuesta", "parent_id": root_id},
    ).json()["comment"]["id"]

    r = cli.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "respuesta a la respuesta", "parent_id": reply_id},
    )
    assert r.status_code == 400


def test_cannot_reply_to_comment_of_another_document(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_client.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS"}})
    root_id = drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "pregunta"}
    ).json()["comment"]["id"]

    r = drp_client.post(
        "/projects/proj-1/documents/URS/sections/proposito/comments",
        json={"content": "no debería poder", "parent_id": root_id},
    )
    assert r.status_code == 400


def test_reply_notifies_only_the_parent_author(drp_client, cliente_client, monkeypatch):
    reply_calls = []
    root_calls = []
    monkeypatch.setattr(
        "app.routers.documents.email_resend.send_comment_reply_email",
        lambda to, display_name, project_id, doc_type, section_key, author, content, link: reply_calls.append(to),
    )
    monkeypatch.setattr(
        "app.routers.documents.email_resend.send_new_comment_email",
        lambda to, display_name, project_id, doc_type, section_key, author, content, link: root_calls.append(to),
    )
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    root_id = cli.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "pregunta"}
    ).json()["comment"]["id"]
    assert len(root_calls) == 1  # el comentario raíz notificó a DRP, como siempre

    drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "respuesta", "parent_id": root_id},
    )
    assert reply_calls == ["revisor@example.com"]  # solo al autor del padre (cliente)
    assert len(root_calls) == 1  # la respuesta no dispara el mail de "nuevo comentario"


def test_replying_to_your_own_comment_does_not_notify_yourself(drp_client, monkeypatch):
    reply_calls = []
    monkeypatch.setattr(
        "app.routers.documents.email_resend.send_comment_reply_email",
        lambda *a, **k: reply_calls.append(a),
    )
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    root_id = drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "nota propia"}
    ).json()["comment"]["id"]

    drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments",
        json={"content": "sigo yo mismo", "parent_id": root_id},
    )
    assert reply_calls == []


def test_resolve_notifies_the_comment_author(drp_client, cliente_client, monkeypatch):
    resolved_calls = []
    monkeypatch.setattr(
        "app.routers.documents.email_resend.send_comment_resolved_email",
        lambda to, display_name, project_id, doc_type, section_key, link: resolved_calls.append(to),
    )
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    cli, user_id = cliente_client
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    comment_id = cli.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "pregunta"}
    ).json()["comment"]["id"]

    r = drp_client.patch(f"/projects/proj-1/documents/HLRA/sections/proposito/comments/{comment_id}/resolve")
    assert r.status_code == 200
    assert resolved_calls == ["revisor@example.com"]


def test_resolving_your_own_comment_does_not_notify_yourself(drp_client, monkeypatch):
    resolved_calls = []
    monkeypatch.setattr(
        "app.routers.documents.email_resend.send_comment_resolved_email",
        lambda *a, **k: resolved_calls.append(a),
    )
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    comment_id = drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/proposito/comments", json={"content": "nota propia"}
    ).json()["comment"]["id"]

    drp_client.patch(f"/projects/proj-1/documents/HLRA/sections/proposito/comments/{comment_id}/resolve")
    assert resolved_calls == []


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
