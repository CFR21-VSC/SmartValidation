"""Tests de login, sesión, y aceptación de invitación (Capa 1)."""
from fastapi.testclient import TestClient

from app.main import app


def test_login_ok(client, superadmin_creds):
    r = client.post("/auth/login", json=superadmin_creds)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["role"] == "drp"
    assert "rf_session" in r.cookies


def test_login_wrong_password(client, superadmin_creds):
    r = client.post("/auth/login", json={"username": superadmin_creds["username"], "password": "wrong-pw"})
    assert r.status_code == 401


def test_login_nonexistent_user(client):
    r = client.post("/auth/login", json={"username": "nadie", "password": "x"})
    assert r.status_code == 401


def test_session_requires_cookie(client):
    r = client.get("/auth/session")
    assert r.status_code == 401


def test_session_after_login(client, superadmin_creds):
    client.post("/auth/login", json=superadmin_creds)
    r = client.get("/auth/session")
    assert r.status_code == 200
    assert r.json()["role"] == "drp"
    assert r.json()["pin_set"] is False


def test_session_reflects_pin_set_live(client, superadmin_creds):
    client.post("/auth/login", json=superadmin_creds)
    assert client.get("/auth/session").json()["pin_set"] is False
    client.post("/auth/set-pin", json={"pin": "4321"})
    assert client.get("/auth/session").json()["pin_set"] is True


def test_logout_revokes_session(client, superadmin_creds):
    client.post("/auth/login", json=superadmin_creds)
    r = client.post("/auth/logout")
    assert r.status_code == 200
    # cookie borrada client-side también (TestClient respeta Max-Age=0)
    r2 = client.get("/auth/session")
    assert r2.status_code == 401


def test_invite_accept_full_flow(client, drp_client):
    created = drp_client.post(
        "/users",
        json={"username": "cliente1", "email": "cliente1@example.com", "display_name": "Cliente Uno", "role": "cliente"},
    )
    assert created.status_code == 200, created.text
    invite_link = created.json()["invite_link"]
    token = invite_link.split("token=")[-1]

    # TestClient propio: si reusara drp_client/client, aceptar la invitación pisaría la
    # cookie de sesión de DRP en el mismo objeto (mismo bug ya visto en test_documents.py).
    anon = TestClient(app)
    info = anon.get(f"/invite/{token}")
    assert info.status_code == 200
    assert info.json()["email"] == "cliente1@example.com"

    accepted = anon.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["role"] == "cliente"

    # Activar la cuenta cuenta como el primer acceso real (evita last_login=null en auditoría).
    listed = drp_client.get("/users").json()["users"]
    activated = next(u for u in listed if u["email"] == "cliente1@example.com")
    assert activated["last_login"] is not None

    # El token ya fue consumido — no se puede reusar
    reused = anon.post(f"/invite/{token}/accept", json={"password": "otraClave123", "pin": "5678"})
    assert reused.status_code == 404


def test_accept_invite_rejects_short_pin(client, drp_client):
    created = drp_client.post(
        "/users",
        json={"username": "cliente2", "email": "cliente2@example.com", "display_name": "Cliente Dos", "role": "cliente"},
    )
    token = created.json()["invite_link"].split("token=")[-1]
    r = client.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "12"})
    assert r.status_code == 400


def test_accept_invite_unknown_token(client):
    r = client.get("/invite/token-que-no-existe")
    assert r.status_code == 404


def test_set_pin_requires_auth(client):
    r = client.post("/auth/set-pin", json={"pin": "1234"})
    assert r.status_code == 401


def test_set_pin_happy_path(client, superadmin_creds):
    login = client.post("/auth/login", json=superadmin_creds)
    assert login.json()["pin_set"] is False  # el superadmin bootstrapeado arranca sin PIN

    r = client.post("/auth/set-pin", json={"pin": "9999"})
    assert r.status_code == 200

    relogin = client.post("/auth/login", json=superadmin_creds)
    assert relogin.json()["pin_set"] is True


def test_set_pin_rejects_short_pin(client, superadmin_creds):
    client.post("/auth/login", json=superadmin_creds)
    r = client.post("/auth/set-pin", json={"pin": "12"})
    assert r.status_code == 400


def test_change_password_requires_auth(client):
    r = client.post("/auth/change-password", json={"current_password": "x", "new_password": "newpass123"})
    assert r.status_code == 401


def test_change_password_happy_path_and_relogin(client, superadmin_creds):
    client.post("/auth/login", json=superadmin_creds)
    r = client.post(
        "/auth/change-password",
        json={"current_password": superadmin_creds["password"], "new_password": "nuevaClaveSegura123"},
    )
    assert r.status_code == 200, r.text

    # La contraseña vieja ya no sirve.
    old_login = client.post("/auth/login", json=superadmin_creds)
    assert old_login.status_code == 401

    # La nueva sí.
    new_login = client.post(
        "/auth/login", json={"username": superadmin_creds["username"], "password": "nuevaClaveSegura123"}
    )
    assert new_login.status_code == 200


def test_change_password_rejects_wrong_current_password(client, superadmin_creds):
    client.post("/auth/login", json=superadmin_creds)
    r = client.post(
        "/auth/change-password",
        json={"current_password": "esto-esta-mal", "new_password": "nuevaClaveSegura123"},
    )
    assert r.status_code == 401

    # La contraseña original sigue funcionando — el intento fallido no la tocó.
    still_works = client.post("/auth/login", json=superadmin_creds)
    assert still_works.status_code == 200


def test_change_password_rejects_short_new_password(client, superadmin_creds):
    client.post("/auth/login", json=superadmin_creds)
    r = client.post(
        "/auth/change-password",
        json={"current_password": superadmin_creds["password"], "new_password": "short"},
    )
    assert r.status_code == 400
