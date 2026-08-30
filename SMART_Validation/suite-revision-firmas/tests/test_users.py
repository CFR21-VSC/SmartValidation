"""Tests de gestión de usuarios y accesos por documento (Capa 2)."""


def test_create_user_requires_auth(client):
    r = client.post("/users", json={"email": "a@a.com", "display_name": "A", "role": "cliente"})
    assert r.status_code == 401


def test_create_user_requires_drp_role(client, drp_client):
    # Invitar a un cliente y loguearlo, luego intentar crear usuarios con esa sesión.
    created = drp_client.post("/users", json={"email": "cli@example.com", "display_name": "Cli", "role": "cliente"})
    token = created.json()["invite_link"].split("token=")[-1]
    client.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})

    r = client.post("/users", json={"email": "otro@example.com", "display_name": "Otro", "role": "cliente"})
    assert r.status_code == 403


def test_create_user_rejects_invalid_role(drp_client):
    r = drp_client.post("/users", json={"email": "x@x.com", "display_name": "X", "role": "auditor"})
    assert r.status_code == 400


def test_create_user_duplicate_email_conflict(drp_client):
    body = {"email": "dup@example.com", "display_name": "Dup", "role": "cliente"}
    r1 = drp_client.post("/users", json=body)
    assert r1.status_code == 200
    r2 = drp_client.post("/users", json=body)
    assert r2.status_code == 409


def test_list_users(drp_client):
    drp_client.post("/users", json={"email": "l1@example.com", "display_name": "L1", "role": "cliente"})
    r = drp_client.get("/users")
    assert r.status_code == 200
    emails = [u["email"] for u in r.json()["users"]]
    assert "l1@example.com" in emails


def test_grant_and_revoke_document_access(drp_client):
    created = drp_client.post("/users", json={"email": "g1@example.com", "display_name": "G1", "role": "cliente"})
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
    created = drp_client.post("/users", json={"email": "g2@example.com", "display_name": "G2", "role": "cliente"})
    user_id = created.json()["user_id"]
    body = {"project_id": "proj-9", "doc_type": "FRS"}
    drp_client.post(f"/users/{user_id}/grants", json=body)
    drp_client.post(f"/users/{user_id}/grants", json=body)  # segunda vez, no debe duplicar
    grants = drp_client.get(f"/users/{user_id}/grants").json()["grants"]
    assert len(grants) == 1
