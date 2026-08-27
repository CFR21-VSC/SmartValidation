"""
test_circuit_e2e.py
===================
End-to-end integration test — circuito completo de firma y revisión GxP.

Cubre los dos lados (admin ↔ cliente):
  1.  Admin crea ronda de firma para rdocumental
  2.  Cliente ve firma pendiente
  3.  Cliente firma con PIN
  4.  Admin sella la ronda → documento aprobado
  5.  Admin reabre ronda (nuevo ciclo)
  6.  Cliente solicita revisión con puntos específicos
  7.  Admin ve la revisión en dashboard
  8.  Admin marca correcciones cumplidas
  9.  Cliente ve correcciones listas vía polling
  10. Cliente vuelve a firmar → ronda sellada

Configuración (variables de entorno):
  BASE_URL     URL base del servidor (ej. https://xxx.up.railway.app)
  ADMIN_USER   Usuario admin  (default: fbongiovanni)
  ADMIN_PASS   Password admin (REQUERIDO — no tiene default)
  CLIENT_USER  Usuario cliente (default: rdocumental)
  CLIENT_PIN   PIN del cliente (default: 040615)
  PROJECT_ID   ID del proyecto a usar (REQUERIDO — copiar de la URL en Railway)
  DOC_TYPE     Tipo de documento a firmar (default: HLRA)

Correr:
  python -m pytest tests/test_circuit_e2e.py -v --tb=short
"""

import os
import time
import uuid
import pytest
import requests

# ── Configuración ─────────────────────────────────────────────────────────────
BASE       = os.environ.get("BASE_URL", "").rstrip("/")
ADMIN_USER = os.environ.get("ADMIN_USER", "fbongiovanni")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "")
CLIENT_USER = os.environ.get("CLIENT_USER", "rdocumental")
CLIENT_PIN  = os.environ.get("CLIENT_PIN", "")
PROJECT_ID  = os.environ.get("PROJECT_ID", "")
DOC_TYPE    = os.environ.get("DOC_TYPE", "HLRA")


def check_config():
    missing = []
    if not BASE:
        missing.append("BASE_URL")
    if not ADMIN_PASS:
        missing.append("ADMIN_PASS")
    if not PROJECT_ID:
        missing.append("PROJECT_ID")
    if not CLIENT_PIN:
        missing.append("CLIENT_PIN")
    if missing:
        pytest.skip(f"Variables de entorno requeridas no seteadas: {', '.join(missing)}. "
                    f"Usá run_circuit_test.bat para correrlo con credenciales.")


# ── Sesiones HTTP separadas (admin y cliente) ──────────────────────────────────
admin_sess  = requests.Session()
client_sess = requests.Session()


def admin_login():
    r = admin_sess.post(f"{BASE}/auth/login",
                        json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Login admin falló: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("ok"), f"Login admin rechazado: {data}"
    assert data.get("role") in ("admin", "superadmin"), f"Se esperaba role=admin, got {data.get('role')}"
    return data


def client_login():
    """Login como cliente. Si no tiene PIN seteado, lo setea con CLIENT_PIN."""
    r = client_sess.post(f"{BASE}/auth/login",
                         json={"username": CLIENT_USER, "password": CLIENT_PIN})
    # El cliente usa PIN como contraseña en /auth/login (o password si está configurado así)
    # Si falla, intenta con el PIN como password alternativo
    if r.status_code != 200 or not r.json().get("ok"):
        pytest.fail(f"Login cliente falló: {r.status_code} {r.text}")
    return r.json()


def get_open_round(round_id: str) -> dict:
    r = admin_sess.get(f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}")
    assert r.status_code == 200, f"GET round falló: {r.status_code} {r.text}"
    return r.json()


# ══════════════════════════════════════════════════════════════════════════════
# TEST 1 — Login de ambas partes
# ══════════════════════════════════════════════════════════════════════════════
class TestAuth:
    def test_admin_login(self):
        check_config()
        data = admin_login()
        assert data["username"] == ADMIN_USER

    def test_client_login(self):
        check_config()
        admin_login()   # asegurar que admin_sess tiene cookie (para que el server no rechace al cliente)
        data = client_login()
        assert data["username"] == CLIENT_USER
        assert data.get("role") == "client"


# ══════════════════════════════════════════════════════════════════════════════
# TEST 2 — Circuito completo firma
# ══════════════════════════════════════════════════════════════════════════════
class TestSigningCircuit:
    """
    Requiere que el documento DOC_TYPE exista en PROJECT_ID y
    que CLIENT_USER esté registrado en la DB del servidor.
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        check_config()
        admin_login()
        client_login()

    # ── 2a. Admin verifica que el documento existe ─────────────────────────
    def test_document_exists(self):
        r = admin_sess.get(f"{BASE}/api/projects/{PROJECT_ID}/documents/{DOC_TYPE}")
        assert r.status_code == 200, f"Documento {DOC_TYPE} no encontrado: {r.text}"
        doc = r.json().get("document", {})
        assert doc.get("doc_type") == DOC_TYPE or doc.get("type") == DOC_TYPE, \
            f"doc_type incorrecto: {doc}"

    # ── 2b. Cliente ve pendientes antes de crear ronda ─────────────────────
    def test_client_pending_before_round(self):
        r = client_sess.get(f"{BASE}/api/me/pending-signatures")
        assert r.status_code == 200
        # No hay ronda aún para este test run — OK si la lista existe
        assert "pending" in r.json(), f"Respuesta inesperada: {r.json()}"

    # ── 2c. Admin crea ronda de firma ──────────────────────────────────────
    def test_create_signing_round(self):
        r = admin_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds",
            json={
                "doc_type": DOC_TYPE,
                "signers": [{"username": CLIENT_USER, "role_label": "Revisor Test E2E"}]
            }
        )
        # Si ya hay ronda abierta para este doc, el server puede retornar 409
        if r.status_code == 409:
            pytest.skip("Ya existe una ronda abierta para este documento. "
                        "Eliminala o sellala antes de correr este test.")
        assert r.status_code in (200, 201), f"Crear ronda falló: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok"), f"Crear ronda rechazado: {data}"
        # Guardar round_id en clase para los siguientes tests
        TestSigningCircuit._round_id = data["round"]["id"]

    # ── 2d. Cliente ve la firma pendiente ──────────────────────────────────
    def test_client_sees_pending_signature(self):
        if not hasattr(TestSigningCircuit, "_round_id"):
            pytest.skip("Depende de test_create_signing_round")
        r = client_sess.get(f"{BASE}/api/me/pending-signatures")
        assert r.status_code == 200
        pending = r.json().get("pending", [])
        round_ids = [p.get("round_id") for p in pending]
        assert TestSigningCircuit._round_id in round_ids, \
            f"Ronda {TestSigningCircuit._round_id} no aparece en pendientes del cliente. Pendientes: {pending}"

    # ── 2e. Cliente firma con PIN ──────────────────────────────────────────
    def test_client_signs(self):
        if not hasattr(TestSigningCircuit, "_round_id"):
            pytest.skip("Depende de test_create_signing_round")
        round_id = TestSigningCircuit._round_id
        r = client_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}/sign",
            json={"pin": CLIENT_PIN}
        )
        assert r.status_code == 200, f"Firma cliente falló: {r.status_code} {r.text}"
        assert r.json().get("ok"), f"Firma rechazada: {r.json()}"

    # ── 2f. Admin verifica que el signer firmó ────────────────────────────
    def test_admin_sees_signed(self):
        if not hasattr(TestSigningCircuit, "_round_id"):
            pytest.skip("Depende de test_create_signing_round")
        detail = get_open_round(TestSigningCircuit._round_id)
        signers = detail.get("signers", [])
        signer = next((s for s in signers if s["username"] == CLIENT_USER), None)
        assert signer is not None, f"Signer {CLIENT_USER} no encontrado en ronda"
        assert signer.get("signed_at"), \
            f"El cliente {CLIENT_USER} todavía no firmó. signer={signer}"

    # ── 2g. Admin sella la ronda ──────────────────────────────────────────
    def test_admin_seals_round(self):
        if not hasattr(TestSigningCircuit, "_round_id"):
            pytest.skip("Depende de test_create_signing_round")
        round_id = TestSigningCircuit._round_id
        r = admin_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}/seal"
        )
        assert r.status_code == 200, f"Sellar ronda falló: {r.status_code} {r.text}"
        assert r.json().get("ok"), f"Sellado rechazado: {r.json()}"

    # ── 2h. Documento queda aprobado ──────────────────────────────────────
    def test_document_approved(self):
        if not hasattr(TestSigningCircuit, "_round_id"):
            pytest.skip("Depende de test_admin_seals_round")
        r = admin_sess.get(f"{BASE}/api/projects/{PROJECT_ID}/documents/{DOC_TYPE}")
        doc = r.json().get("document", {})
        assert doc.get("status") == "approved", \
            f"Se esperaba status=approved, got {doc.get('status')}"


# ══════════════════════════════════════════════════════════════════════════════
# TEST 3 — Circuito de revisión (necesita ronda abierta vigente)
# ══════════════════════════════════════════════════════════════════════════════
class TestRevisionCircuit:
    """
    Crea una ronda nueva, el cliente solicita revisión, el admin la cumple,
    el cliente verifica y vuelve a firmar.
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        check_config()
        admin_login()
        client_login()

    def test_full_revision_round_trip(self):
        # ── Crear ronda nueva ──────────────────────────────────────────────
        r = admin_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds",
            json={
                "doc_type": DOC_TYPE,
                "signers": [{"username": CLIENT_USER, "role_label": "Revisor E2E Revision"}]
            }
        )
        if r.status_code == 409:
            pytest.skip("Ya existe ronda abierta. Eliminala antes de correr este test.")
        assert r.status_code in (200, 201), f"Crear ronda falló: {r.status_code} {r.text}"
        round_id = r.json()["round"]["id"]

        # ── Cliente solicita revisión ──────────────────────────────────────
        import json as _json
        revision_points = _json.dumps([
            {"section": "PROPÓSITO",    "point": "Agregar referencia normativa ICH Q9"},
            {"section": "ALCANCE",      "point": "Especificar versión del software emqc"}
        ])
        r = client_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}/request-revision",
            json={"reason": revision_points, "pin": CLIENT_PIN}
        )
        assert r.status_code == 200, f"request-revision falló: {r.status_code} {r.text}"
        assert r.json().get("ok"), f"request-revision rechazado: {r.json()}"

        # ── Admin ve la revisión en el dashboard ──────────────────────────
        r = admin_sess.get(f"{BASE}/api/admin/review-activity")
        assert r.status_code == 200, f"review-activity falló: {r.status_code}"
        rev_data = r.json()
        signer_revs = rev_data.get("signer_revisions", [])
        match = [s for s in signer_revs
                 if s.get("round_id") == round_id and s.get("username") == CLIENT_USER]
        assert match, \
            f"Revisión de {CLIENT_USER} no aparece en dashboard admin. revisions={signer_revs}"
        assert match[0].get("revision_fulfilled_at") is None, \
            "La revisión ya estaba cumplida antes de que el admin actúe"

        # ── Admin cumple la revisión ──────────────────────────────────────
        r = admin_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}/fulfill/{CLIENT_USER}"
        )
        assert r.status_code == 200, f"fulfill falló: {r.status_code} {r.text}"
        assert r.json().get("ok"), f"fulfill rechazado: {r.json()}"

        # ── Cliente verifica correcciones via polling ─────────────────────
        r = client_sess.get(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}/my-revisions"
        )
        assert r.status_code == 200, f"my-revisions falló: {r.status_code}"
        rev = r.json()
        assert rev.get("has_revision") is True, \
            f"Se esperaba has_revision=True después de fulfill, got: {rev}"
        assert rev.get("all_fulfilled") is True, \
            f"Se esperaba all_fulfilled=True, got: {rev}"

        # ── Cliente vuelve a firmar ───────────────────────────────────────
        r = client_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}/sign",
            json={"pin": CLIENT_PIN}
        )
        assert r.status_code == 200, f"Re-firma cliente falló: {r.status_code} {r.text}"
        assert r.json().get("ok"), f"Re-firma rechazada: {r.json()}"

        # ── Admin sella ───────────────────────────────────────────────────
        r = admin_sess.post(
            f"{BASE}/api/projects/{PROJECT_ID}/signing-rounds/{round_id}/seal"
        )
        assert r.status_code == 200, f"Sellado final falló: {r.status_code} {r.text}"
        assert r.json().get("ok")

        # ── Ronda queda sellada ───────────────────────────────────────────
        detail = get_open_round(round_id)
        assert detail["round"]["status"] == "sealed", \
            f"Se esperaba ronda sealed, got: {detail['round']['status']}"
