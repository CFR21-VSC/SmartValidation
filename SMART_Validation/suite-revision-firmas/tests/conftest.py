"""
conftest.py — Fixtures de test para la Suite de Revisión y Firmas.

Las variables de entorno se fijan ANTES de importar `app` (config.py las lee
al importarse), apuntando a un SQLite temporal exclusivo de la corrida de
tests — nunca toca ./data/revision_firmas.db.
"""
import os
import tempfile

_TMP_DB = tempfile.NamedTemporaryFile(prefix="rf_test_", suffix=".db", delete=False)
_TMP_DB.close()

os.environ["RF_DB_PATH"] = _TMP_DB.name
os.environ["RF_AUTH_SECRET_KEY"] = "test-secret-key"
# 600k iteraciones (el default de producción) hace que una corrida completa tarde minutos —
# los tests no están probando la fuerza del hashing, así que se baja drásticamente acá.
os.environ["RF_PBKDF2_ITERS"] = "1000"
os.environ["RF_SUPERADMIN_USERNAME"] = "fbongiovanni"
os.environ["RF_SUPERADMIN_PASSWORD"] = "test-superadmin-pw-123"
os.environ["RF_SUPERADMIN_EMAIL"] = "fbongiovanni@test.local"
os.environ.setdefault("RESEND_API_KEY", "")  # sin key → email es no-op en tests
os.environ["BRIDGE_API_KEY"] = "test-bridge-key"
os.environ.pop("DATABASE_URL", None)  # forzar modo SQLite en tests

import pytest
from fastapi.testclient import TestClient

from app.db import get_db, init_db, reset_db_for_tests
from app.main import app, bootstrap_superadmin

init_db()


@pytest.fixture(autouse=True)
def clean_db():
    """Cada test arranca con la DB vacía + superadmin recién sembrado."""
    reset_db_for_tests()
    bootstrap_superadmin()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def superadmin_creds():
    return {"username": os.environ["RF_SUPERADMIN_USERNAME"], "password": os.environ["RF_SUPERADMIN_PASSWORD"]}


@pytest.fixture
def drp_client(client, superadmin_creds):
    """TestClient ya logueado como DRP (superadmin)."""
    r = client.post("/auth/login", json=superadmin_creds)
    assert r.status_code == 200, r.text
    return client
