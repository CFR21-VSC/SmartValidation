"""Tests de seguridad transversales — no cubren una sola capa (auth/documents/etc.),
sino garantías que tienen que valer en TODO el sistema: sin inyección SQL posible con
payloads reales (no solo lectura de código), y las medidas anti fuerza bruta / honeypot
del login (sección pedida por el usuario 2026-08-31)."""
from urllib.parse import quote

from app.db import get_db

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Demo"}, "secciones": []}

SQLI_PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE rf_users; --",
    "x' UNION SELECT username, password_hash, 3, 4, 5, 6, 7, 8, 9, 10, 11 FROM rf_users --",
    "Robert'); DROP TABLE rf_documents;--",
]


def test_login_rejects_sqli_payloads_without_error(client):
    for payload in SQLI_PAYLOADS:
        r = client.post("/auth/login", json={"username": payload, "password": payload})
        assert r.status_code == 401, f"payload {payload!r} dio {r.status_code}, esperaba 401"


def test_sqli_payload_in_project_id_and_doc_type_is_treated_as_literal_string(drp_client):
    """project_id y doc_type vienen de la URL (path params) y se usan tal cual en varias
    queries -- confirma que un payload ahí se guarda/lee como texto literal, no rompe nada,
    y no afecta otros proyectos."""
    payload_project = "proj'; DROP TABLE rf_documents; --"
    r = drp_client.put(
        f"/projects/{quote(payload_project, safe='')}/documents/HLRA",
        json={"json_data": SAMPLE_JSON},
    )
    assert r.status_code == 200, r.text

    # rf_documents sigue existiendo y con el resto de la suite operable -- si el payload
    # hubiera roto algo, esto ya habría fallado con 500 o tabla inexistente.
    listed = drp_client.get("/projects").json()["projects"]
    assert any(p["id"] == payload_project for p in listed)

    other = drp_client.put("/projects/proj-normal/documents/URS", json={"json_data": {"type": "URS"}})
    assert other.status_code == 200


def test_sqli_payload_in_comment_content_is_stored_literally_not_executed(drp_client):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    payload = "'; DROP TABLE rf_users; --"
    r = drp_client.post(
        "/projects/proj-1/documents/HLRA/sections/x/comments", json={"content": payload}
    )
    assert r.status_code == 200, r.text
    assert r.json()["comment"]["content"] == payload

    # Confirma que rf_users sigue intacta (el login del propio DRP sigue andando después).
    still_works = drp_client.get("/auth/session")
    assert still_works.status_code == 200


def test_users_table_survives_every_injection_attempt(drp_client):
    """Chequeo final directo contra la base: después de todos los payloads anteriores en
    esta corrida, rf_users tiene que seguir existiendo con al menos el superadmin."""
    db = get_db()
    row = db.execute("SELECT COUNT(*) AS n FROM rf_users WHERE is_superadmin=1").fetchone()
    assert row["n"] >= 1


# ─── Fuerza bruta + honeypot en el login ────────────────────────────────────

def test_login_locks_out_after_five_failed_attempts(client, superadmin_creds):
    for _ in range(5):
        r = client.post("/auth/login", json={"username": superadmin_creds["username"], "password": "mal"})
        assert r.status_code == 401

    locked = client.post("/auth/login", json=superadmin_creds)  # contraseña CORRECTA
    assert locked.status_code == 429
    assert "intentos" in locked.json()["detail"].lower()


def test_login_lockout_is_scoped_per_username(client, drp_client, superadmin_creds):
    other = drp_client.post(
        "/users", json={"username": "otro", "email": "otro@example.com", "display_name": "Otro", "role": "cliente"}
    )
    token = other.json()["invite_link"].split("token=")[-1]
    from fastapi.testclient import TestClient
    from app.main import app
    other_cli = TestClient(app)
    other_cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})

    fresh = TestClient(app)
    for _ in range(5):
        fresh.post("/auth/login", json={"username": superadmin_creds["username"], "password": "mal"})

    # El superadmin quedó bloqueado, pero "otro" es un username distinto -- no le afecta.
    r = TestClient(app).post("/auth/login", json={"username": "otro", "password": "password123"})
    assert r.status_code == 200


def test_login_attempts_reset_after_success(client, superadmin_creds):
    for _ in range(4):  # justo por debajo del límite (5)
        client.post("/auth/login", json={"username": superadmin_creds["username"], "password": "mal"})

    ok = client.post("/auth/login", json=superadmin_creds)
    assert ok.status_code == 200

    # Después de un login exitoso el contador se resetea -- 4 fallos más no deberían bloquear.
    for _ in range(4):
        client.post("/auth/login", json={"username": superadmin_creds["username"], "password": "mal"})
    still_ok = client.post("/auth/login", json=superadmin_creds)
    assert still_ok.status_code == 200


def test_honeypot_rejects_without_touching_real_lockout_counter(client, superadmin_creds):
    """El honeypot lleno se rechaza como credenciales inválidas, PERO no debe contar como
    intento fallido real -- si contara, cualquiera podría bloquear a otra persona a
    propósito mandando el honeypot lleno con su username muchas veces."""
    for _ in range(10):
        r = client.post(
            "/auth/login",
            json={"username": superadmin_creds["username"], "password": "cualquiera", "website": "http://bot.example"},
        )
        assert r.status_code == 401

    # La cuenta real sigue sin bloquearse -- el honeypot no gastó el cupo de intentos.
    ok = client.post("/auth/login", json=superadmin_creds)
    assert ok.status_code == 200


def test_honeypot_triggers_even_with_correct_password(client, superadmin_creds):
    """El honeypot se chequea ANTES de validar credenciales -- un bot que de casualidad
    manda la contraseña correcta pero llena el campo trampa igual queda bloqueado."""
    r = client.post(
        "/auth/login",
        json={**superadmin_creds, "website": "spam"},
    )
    assert r.status_code == 401
