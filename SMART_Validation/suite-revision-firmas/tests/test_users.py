"""Tests de gestión de usuarios y accesos por documento (Capa 2)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def cliente_client(drp_client):
    created = drp_client.post(
        "/users",
        json={"username": "cli-fix", "email": "cli-fix@example.com", "display_name": "Cli Fix", "role": "cliente"},
    )
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    return cli, created.json()["user_id"]


def test_create_user_requires_auth(client):
    r = client.post("/users", json={"username": "a", "email": "a@a.com", "display_name": "A", "role": "cliente"})
    assert r.status_code == 401


def test_create_user_requires_drp_role(client, drp_client):
    # Invitar a un cliente y loguearlo, luego intentar crear usuarios con esa sesión.
    created = drp_client.post(
        "/users", json={"username": "cli", "email": "cli@example.com", "display_name": "Cli", "role": "cliente"}
    )
    token = created.json()["invite_link"].split("token=")[-1]
    client.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})

    r = client.post(
        "/users", json={"username": "otro", "email": "otro@example.com", "display_name": "Otro", "role": "cliente"}
    )
    assert r.status_code == 403


def test_create_user_rejects_invalid_role(drp_client):
    r = drp_client.post(
        "/users", json={"username": "x", "email": "x@x.com", "display_name": "X", "role": "auditor"}
    )
    assert r.status_code == 400


def test_create_user_rejects_invalid_username(drp_client):
    r = drp_client.post(
        "/users", json={"username": "a b", "email": "ab@x.com", "display_name": "AB", "role": "cliente"}
    )
    assert r.status_code == 400


def test_create_user_duplicate_email_conflict(drp_client):
    body = {"username": "dup", "email": "dup@example.com", "display_name": "Dup", "role": "cliente"}
    r1 = drp_client.post("/users", json=body)
    assert r1.status_code == 200
    r2 = drp_client.post("/users", json={**body, "username": "dup2"})
    assert r2.status_code == 409


def test_create_user_duplicate_username_conflict(drp_client):
    drp_client.post(
        "/users", json={"username": "mismo", "email": "u1@example.com", "display_name": "U1", "role": "cliente"}
    )
    r = drp_client.post(
        "/users", json={"username": "mismo", "email": "u2@example.com", "display_name": "U2", "role": "cliente"}
    )
    assert r.status_code == 409


def test_list_users(drp_client):
    drp_client.post(
        "/users", json={"username": "lu1", "email": "l1@example.com", "display_name": "L1", "role": "cliente"}
    )
    r = drp_client.get("/users")
    assert r.status_code == 200
    users = r.json()["users"]
    assert "l1@example.com" in [u["email"] for u in users]
    assert "lu1" in [u["username"] for u in users]


def test_grant_and_revoke_document_access(drp_client):
    created = drp_client.post(
        "/users", json={"username": "gr1", "email": "g1@example.com", "display_name": "G1", "role": "cliente"}
    )
    user_id = created.json()["user_id"]

    grant = drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    assert grant.status_code == 200

    listed = drp_client.get(f"/users/{user_id}/grants")
    assert listed.status_code == 200
    grants = listed.json()["grants"]
    assert len(grants) == 1
    assert grants[0]["doc_type"] == "HLRA"

    revoke = drp_client.delete(f"/users/{user_id}/grants/{grants[0]['id']}")
    assert revoke.status_code == 200

    listed2 = drp_client.get(f"/users/{user_id}/grants")
    assert listed2.json()["grants"] == []


def test_grant_document_access_unknown_user(drp_client):
    r = drp_client.post("/users/no-existe/grants", json={"project_id": "p", "doc_type": "URS"})
    assert r.status_code == 404


def test_grant_is_idempotent_per_user_project_doctype(drp_client):
    created = drp_client.post(
        "/users", json={"username": "gr2", "email": "g2@example.com", "display_name": "G2", "role": "cliente"}
    )
    user_id = created.json()["user_id"]
    body = {"project_id": "proj-9", "doc_type": "FRS"}
    drp_client.post(f"/users/{user_id}/grants", json=body)
    drp_client.post(f"/users/{user_id}/grants", json=body)  # segunda vez, no debe duplicar
    grants = drp_client.get(f"/users/{user_id}/grants").json()["grants"]
    assert len(grants) == 1


def test_grant_notifies_by_email_only_once(drp_client, monkeypatch):
    """Otorgar acceso a un documento debe avisarle al usuario por mail (si no, nunca se
    entera que tiene algo para revisar/firmar) — pero solo la primera vez, no en cada
    reintento del mismo grant ya existente."""
    calls = []
    monkeypatch.setattr(
        "app.routers.users.email_resend.send_access_granted_email",
        lambda to, display_name, project_id, doc_type, link: calls.append((to, project_id, doc_type)),
    )
    created = drp_client.post(
        "/users", json={"username": "gr3", "email": "g3@example.com", "display_name": "G3", "role": "cliente"}
    )
    user_id = created.json()["user_id"]
    body = {"project_id": "proj-9", "doc_type": "FRS"}

    drp_client.post(f"/users/{user_id}/grants", json=body)
    assert calls == [("g3@example.com", "proj-9", "FRS")]

    drp_client.post(f"/users/{user_id}/grants", json=body)  # ya tenía acceso -> no renotificar
    assert len(calls) == 1


# ─── Desactivar / reactivar / resetear credenciales (sección pedida 2026-09-03) ───

def _invite_and_activate(drp_client, username, email, role="cliente", password="password123", pin="1234"):
    created = drp_client.post(
        "/users", json={"username": username, "email": email, "display_name": username, "role": role}
    )
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    accept = cli.post(f"/invite/{token}/accept", json={"password": password, "pin": pin})
    assert accept.status_code == 200, accept.text
    return user_id, cli


def test_deactivate_blocks_new_login(drp_client):
    user_id, cli = _invite_and_activate(drp_client, "deact1", "deact1@example.com")
    r = drp_client.patch(f"/users/{user_id}/deactivate")
    assert r.status_code == 200, r.text

    relogin = cli.post("/auth/login", json={"username": "deact1", "password": "password123"})
    assert relogin.status_code == 401


def test_deactivate_kills_already_open_session_immediately(drp_client):
    """No alcanza con bloquear un login nuevo -- una sesión YA abierta tiene que cortarse
    al instante, no seguir sirviendo hasta que el token venza solo."""
    user_id, cli = _invite_and_activate(drp_client, "deact2", "deact2@example.com")
    still_works = cli.get("/auth/session")
    assert still_works.status_code == 200

    drp_client.patch(f"/users/{user_id}/deactivate")

    now_blocked = cli.get("/auth/session")
    assert now_blocked.status_code == 401


def test_deactivate_cannot_target_self(drp_client):
    # El propio DRP no aparece en /users (esa lista es de invitados) -- se resuelve
    # directo contra la base, mismo patrón que otros tests de esta suite.
    from app.db import get_db
    me = get_db().execute("SELECT id FROM rf_users WHERE is_superadmin=1").fetchone()
    r = drp_client.patch(f"/users/{me['id']}/deactivate")
    assert r.status_code == 400


def test_deactivate_blocks_last_active_superadmin(drp_client):
    from app.db import get_db
    me = get_db().execute("SELECT id FROM rf_users WHERE is_superadmin=1").fetchone()
    # Otro DRP intenta desactivar al único superadmin -- primero se necesita otro DRP
    # logueado para no chocar con el bloqueo de auto-desactivación de arriba.
    other_id, other_cli = _invite_and_activate(drp_client, "otrodrp", "otrodrp@example.com", role="drp")
    r = other_cli.patch(f"/users/{me['id']}/deactivate")
    assert r.status_code == 400
    assert "superadmin" in r.json()["detail"].lower()


def test_deactivate_unknown_user_404(drp_client):
    r = drp_client.patch("/users/no-existe/deactivate")
    assert r.status_code == 404


def test_deactivate_requires_drp(cliente_client):
    cli, uid = cliente_client
    r = cli.patch(f"/users/{uid}/deactivate")
    assert r.status_code == 403


def test_reactivate_allows_login_again(drp_client):
    user_id, cli = _invite_and_activate(drp_client, "react1", "react1@example.com")
    drp_client.patch(f"/users/{user_id}/deactivate")
    assert cli.post("/auth/login", json={"username": "react1", "password": "password123"}).status_code == 401

    r = drp_client.patch(f"/users/{user_id}/reactivate")
    assert r.status_code == 200, r.text

    relogin = cli.post("/auth/login", json={"username": "react1", "password": "password123"})
    assert relogin.status_code == 200


def test_deactivate_reactivate_preserves_grants(drp_client):
    """Desactivar/reactivar no debe tocar los accesos ya otorgados -- pedido explícito del
    usuario: quiere poder reactivar a alguien que vuelve a trabajar sin re-armarle todo."""
    user_id, _cli = _invite_and_activate(drp_client, "grantskeep", "grantskeep@example.com")
    drp_client.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})

    drp_client.patch(f"/users/{user_id}/deactivate")
    drp_client.patch(f"/users/{user_id}/reactivate")

    grants = drp_client.get(f"/users/{user_id}/grants").json()["grants"]
    assert len(grants) == 1
    assert grants[0]["project_id"] == "proj-1" and grants[0]["doc_type"] == "HLRA"


def test_reset_credentials_invalidates_old_password_and_session(drp_client):
    user_id, cli = _invite_and_activate(drp_client, "reset1", "reset1@example.com")
    assert cli.get("/auth/session").status_code == 200

    r = drp_client.post(f"/users/{user_id}/reset-credentials")
    assert r.status_code == 200, r.text
    assert r.json()["invite_link"]

    # Sesión vieja muerta, contraseña vieja ya no sirve.
    assert cli.get("/auth/session").status_code == 401
    old_login = cli.post("/auth/login", json={"username": "reset1", "password": "password123"})
    assert old_login.status_code == 401


def test_reset_credentials_link_lets_user_set_new_password(drp_client):
    from fastapi.testclient import TestClient
    from app.main import app

    user_id, _cli = _invite_and_activate(drp_client, "reset2", "reset2@example.com")
    r = drp_client.post(f"/users/{user_id}/reset-credentials")
    token = r.json()["invite_link"].split("token=")[-1]

    fresh = TestClient(app)
    accept = fresh.post(f"/invite/{token}/accept", json={"password": "unaClaveNueva123", "pin": "9999"})
    assert accept.status_code == 200, accept.text

    login = fresh.post("/auth/login", json={"username": "reset2", "password": "unaClaveNueva123"})
    assert login.status_code == 200


def test_reset_credentials_unknown_user_404(drp_client):
    r = drp_client.post("/users/no-existe/reset-credentials")
    assert r.status_code == 404


def test_reset_credentials_requires_drp(cliente_client):
    cli, uid = cliente_client
    r = cli.post(f"/users/{uid}/reset-credentials")
    assert r.status_code == 403
