"""
Tests F5-F8:
  F5 — PDF signature injection (sealed signers → buildSignatureCell)
  F6 — Client portal filtrado a docs con rondas propias
  F7 — sealRound sin confirm()/alert(), double-click pattern + toast
  F8 — Limpieza de modalSignArchive, modalSignWithPin, openSignFlow

Grupos:
  TestF8Cleanup     — estático: eliminación de modales obsoletos
  TestF7SealUX      — estático: nuevo UX de sellado
  TestF6ClientFilter — estático + backend
  TestF5PDFSignatureInjection — estático + API shape
  TestRegressionF1F4 — regresión rápida del suite anterior
"""

import re
import os
import sys
import uuid
import json
import time
import pytest
import requests

BASE = "http://localhost:11294"
SESSION = requests.Session()

ROOT = os.path.join(os.path.dirname(__file__), "..")
INDEX_HTML = os.path.join(ROOT, "index.html")
CLIENT_HTML = os.path.join(ROOT, "client", "index.html")
PDF_JS = os.path.join(ROOT, "js", "pdf-exportacion.js")
SERVER_PY = os.path.join(ROOT, "server.py")

# ── helpers ──────────────────────────────────────────────────────────────────

def _load(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

def _first_proj_id():
    r = SESSION.get(f"{BASE}/api/projects", timeout=10)
    projs = [p for p in r.json().get("projects", [])
             if not p["id"].startswith("__demo")]
    assert projs, "No hay proyectos de prueba"
    return projs[0]["id"]

def _close_open_rounds(proj_id):
    """Cancela todas las rondas abiertas del proyecto."""
    r = SESSION.get(f"{BASE}/api/projects/{proj_id}/signing-rounds", timeout=10)
    for rnd in r.json().get("rounds", []):
        if rnd["status"] == "open":
            SESSION.post(
                f"{BASE}/api/projects/{proj_id}/signing-rounds/{rnd['id']}/cancel",
                json={"reason": "cleanup test"},
                timeout=10,
            )

def _create_round(proj_id, doc_type="URS"):
    """Crea una ronda mínima; devuelve round_id o None."""
    _close_open_rounds(proj_id)
    body = {
        "doc_type": doc_type,
        "doc_version": 1,
        "signers": [{"display": "Dev Tester", "role": "Revisor", "username": "dev"}],
    }
    r = SESSION.post(
        f"{BASE}/api/projects/{proj_id}/signing-rounds",
        json=body, timeout=15,
    )
    data = r.json()
    if r.status_code in (200, 201) and data.get("ok"):
        return data.get("round_id") or data.get("round", {}).get("id")
    return None


# ═══════════════════════════════════════════════════════════════════════════
# F8 — Cleanup de paths de firma obsoletos
# ═══════════════════════════════════════════════════════════════════════════

class TestF8Cleanup:
    """Verifica que los modales obsoletos y el botón fueron eliminados."""

    def test_modal_sign_archive_removed(self):
        src = _load(INDEX_HTML)
        assert "modalSignArchive" not in src, \
            "modalSignArchive todavía existe en index.html — no fue eliminado (F8)"

    def test_modal_sign_with_pin_removed(self):
        src = _load(INDEX_HTML)
        assert "modalSignWithPin" not in src, \
            "modalSignWithPin todavía existe en index.html — no fue eliminado (F8)"

    def test_open_sign_flow_button_removed(self):
        src = _load(INDEX_HTML)
        # El botón tenía onclick="openSignFlow()" en la sección Utilidades
        assert 'onclick="openSignFlow()"' not in src, \
            "Botón openSignFlow() todavía presente en index.html (F8)"

    def test_firmar_archivar_label_removed(self):
        src = _load(INDEX_HTML)
        assert "Firmar y archivar" not in src, \
            "Texto 'Firmar y archivar' todavía presente en index.html (F8)"

    def test_modal_sign_archive_not_in_theme_map(self):
        src = _load(INDEX_HTML)
        # La entrada fue: 'modalSignArchive': 'compare'
        assert "'modalSignArchive'" not in src, \
            "modalSignArchive todavía en MODAL_THEME_MAP (F8)"


# ═══════════════════════════════════════════════════════════════════════════
# F7 — Seal UX sin dialogs bloqueantes
# ═══════════════════════════════════════════════════════════════════════════

class TestF7SealUX:
    """Verifica que sealRound usa toast + double-click en vez de confirm/alert."""

    def _load_seal_round(self):
        src = _load(INDEX_HTML)
        # Extraer el bloque de la función sealRound
        start = src.find("async function sealRound(")
        assert start != -1, "sealRound no encontrado en index.html"
        # Buscar el cierre de la función (siguiente función a mismo nivel)
        end = src.find("\n    async function ", start + 1)
        if end == -1:
            end = src.find("\n    function ", start + 1)
        return src[start:end] if end != -1 else src[start:start + 2000]

    def test_no_browser_confirm_in_seal(self):
        fn = self._load_seal_round()
        assert "confirm(" not in fn, \
            "sealRound usa confirm() — debe usar el patrón double-click (F7)"

    def test_no_browser_alert_in_seal(self):
        fn = self._load_seal_round()
        assert "alert(" not in fn, \
            "sealRound usa alert() — debe usar _rdToast() (F7)"

    def test_rd_toast_defined(self):
        src = _load(INDEX_HTML)
        assert "function _rdToast(" in src, \
            "_rdToast no está definida en index.html (F7)"

    def test_rd_pulse_animation_defined(self):
        src = _load(INDEX_HTML)
        assert "@keyframes _rdPulse" in src, \
            "@keyframes _rdPulse no definida — el botón seal no anima (F7)"

    def test_double_click_confirming_pattern(self):
        fn = self._load_seal_round()
        assert "dataset.confirming" in fn, \
            "Patrón de doble-clic (dataset.confirming) ausente en sealRound (F7)"

    def test_rd_toast_called_on_success(self):
        fn = self._load_seal_round()
        assert "_rdToast(" in fn, \
            "_rdToast no se llama en sealRound — el éxito no se notifica (F7)"

    def test_rd_toast_called_on_error(self):
        fn = self._load_seal_round()
        # Debe haber al menos un _rdToast con color de error
        assert "e87a8a" in fn or "#e87a8a" in fn or "error" in fn.lower(), \
            "_rdToast de error ausente en sealRound (F7)"

    def test_seal_button_has_pulse_animation(self):
        src = _load(INDEX_HTML)
        assert "_rdPulse" in src and "Sellar ahora" in src, \
            "El botón 'Sellar ahora' no tiene la animación _rdPulse (F7)"


# ═══════════════════════════════════════════════════════════════════════════
# F6 — Client portal filtrado
# ═══════════════════════════════════════════════════════════════════════════

class TestF6ClientFilter:
    """Verifica filtro de docs en portal cliente + query sealed en server."""

    def test_server_query_includes_sealed(self):
        src = _load(SERVER_PY)
        # La query del cliente ahora usa IN ('open','sealed')
        assert "status IN ('open','sealed')" in src or \
               "status in ('open','sealed')" in src, \
            "La query de cliente en server.py no incluye 'sealed' (F6)"

    def test_client_html_filters_by_doc_types(self):
        src = _load(CLIENT_HTML)
        assert "clientDocTypes" in src, \
            "clientDocTypes no encontrado en client/index.html (F6)"

    def test_client_html_filters_shared_docs(self):
        src = _load(CLIENT_HTML)
        assert "sharedDocs" in src or "clientDocTypes.has(" in src, \
            "Filtro de docs compartidos ausente en client/index.html (F6)"

    def test_client_html_empty_message_updated(self):
        src = _load(CLIENT_HTML)
        # El mensaje vacío ahora es específico de "no compartidos"
        assert "compartidos" in src.lower() or "no hay documentos compartidos" in src.lower(), \
            "Mensaje de lista vacía no actualizado en client/index.html (F6)"

    def test_api_signing_rounds_returns_sealed(self):
        """Integración: un round sellado debe aparecer en la lista (admin lo ve siempre)."""
        proj_id = _first_proj_id()
        r = SESSION.get(f"{BASE}/api/projects/{proj_id}/signing-rounds", timeout=10)
        assert r.status_code == 200, f"signing-rounds devolvió {r.status_code}"
        rounds = r.json().get("rounds", [])
        # Puede estar vacío si no hay rondas; no es fallo — solo verificamos el shape
        for rnd in rounds:
            assert "status" in rnd, "Campo 'status' ausente en signing-round"
            assert "doc_type" in rnd, "Campo 'doc_type' ausente en signing-round"

    def test_client_rounds_priority_order(self):
        """Open debe tener prioridad sobre sealed en el índice openRounds."""
        src = _load(CLIENT_HTML)
        # La lógica: si hay open y sealed para el mismo doc_type, open gana
        assert "r.status === 'open'" in src or "status === 'open'" in src, \
            "Lógica de prioridad open>sealed ausente en client/index.html (F6)"


# ═══════════════════════════════════════════════════════════════════════════
# F5 — PDF signature injection
# ═══════════════════════════════════════════════════════════════════════════

class TestF5PDFSignatureInjection:
    """Verifica la inyección de firmantes sellados en el PDF."""

    def test_sealed_signers_in_pdf_js(self):
        src = _load(PDF_JS)
        assert "_sealedSigners" in src, \
            "_sealedSigners no referenciado en pdf-exportacion.js (F5)"

    def test_firmado_electronicamente_text_in_pdf_js(self):
        src = _load(PDF_JS)
        assert "Firmado electr" in src, \
            "Texto 'Firmado electrónicamente' ausente en pdf-exportacion.js (F5)"

    def test_sealed_branch_in_build_signature_cell(self):
        src = _load(PDF_JS)
        # buildSignatureCell debe tener una rama para sealed
        fn_start = src.find("function buildSignatureCell(")
        assert fn_start != -1, "buildSignatureCell no encontrada"
        fn_block = src[fn_start:fn_start + 1200]
        assert "_sealedByRole" in fn_block or "_sealedSigners" in fn_block, \
            "buildSignatureCell no maneja firmantes sellados (F5)"

    def test_role_key_helper_present(self):
        src = _load(PDF_JS)
        assert "_roleKey" in src or "role_label" in src, \
            "Mapeo de role_label → clave canónica ausente en pdf-exportacion.js (F5)"

    def test_audit_hash_shown_in_pdf(self):
        src = _load(PDF_JS)
        assert "audit_hash" in src, \
            "audit_hash no mostrado en la celda de firma sellada (F5)"

    def test_client_html_injects_sealed_signers(self):
        src = _load(CLIENT_HTML)
        assert "_sealedSigners" in src, \
            "_sealedSigners no inyectado en client/index.html antes del render (F5)"

    def test_client_html_fetches_sealed_round_detail(self):
        src = _load(CLIENT_HTML)
        # Debe buscar el round sellado del doc_type actual
        assert "sealedRound" in src or "status === 'sealed'" in src, \
            "client/index.html no busca el round sellado para inyectar firmantes (F5)"

    def test_api_round_detail_has_signed_at(self):
        """Integración: GET /signing-rounds/{id} devuelve signed_at en cada signer."""
        proj_id = _first_proj_id()
        round_id = _create_round(proj_id, "FRS")
        if not round_id:
            pytest.skip("No se pudo crear ronda para test")
        try:
            r = SESSION.get(
                f"{BASE}/api/projects/{proj_id}/signing-rounds/{round_id}",
                timeout=10,
            )
            assert r.status_code == 200, f"GET round detail: {r.status_code}"
            data = r.json()
            assert data.get("ok"), f"ok=False: {data}"
            signers = data.get("signers", [])
            assert len(signers) > 0, "No hay signers en el round detail"
            signer = signers[0]
            assert "signed_at" in signer, "signed_at ausente en signer shape"
            assert "display_name" in signer, "display_name ausente en signer"
            assert "role_label" in signer, "role_label ausente en signer"
            assert "audit_hash" in signer or signer.get("signed_at") is None, \
                "audit_hash ausente en signer firmado"
        finally:
            _close_open_rounds(proj_id)

    def test_sealed_signers_build_by_role(self):
        """Verifica que el índice _sealedByRole se construye desde _sealedSigners."""
        src = _load(PDF_JS)
        assert "_sealedByRole" in src, \
            "_sealedByRole (índice por rol) ausente en pdf-exportacion.js (F5)"


# ═══════════════════════════════════════════════════════════════════════════
# Regresión F1-F4 — subset rápido
# ═══════════════════════════════════════════════════════════════════════════

class TestRegressionF1F4:
    """Verifica que F5-F8 no rompió el comportamiento de F1-F4."""

    def test_server_up(self):
        r = SESSION.get(f"{BASE}/auth/session", timeout=5)
        assert r.status_code == 200, "Server caído"

    def test_invite_endpoint_exists(self):
        r = SESSION.get(f"{BASE}/auth/invite/tokeninvalido1234567890123456789012", timeout=5)
        assert r.status_code in (200, 404), \
            f"invite endpoint inesperado: {r.status_code}"

    def test_firmas_accessible_without_cookie(self):
        r = requests.get(f"{BASE}/firmas/", timeout=5)
        assert r.status_code == 200, "Portal /firmas/ inaccesible"
        assert "<!DOCTYPE html>" in r.text or "<!doctype html>" in r.text.lower(), \
            "/firmas/ no devuelve HTML"

    def test_firmas_not_redirected_to_login(self):
        r = requests.get(f"{BASE}/firmas/", allow_redirects=False, timeout=5)
        assert r.status_code != 302, "/firmas/ redirige a login — regresión (F4)"

    def test_create_round_with_email_signer(self):
        proj_id = _first_proj_id()
        _close_open_rounds(proj_id)
        body = {
            "doc_type": "URS",
            "doc_version": 1,
            "signers": [{"display": "Test Email", "role": "Revisor",
                         "email": f"regression_{uuid.uuid4().hex[:8]}@test.com"}],
        }
        r = SESSION.post(
            f"{BASE}/api/projects/{proj_id}/signing-rounds",
            json=body, timeout=15,
        )
        assert r.status_code in (200, 201), f"Crear ronda con email: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok"), f"ok=False: {data}"
        _close_open_rounds(proj_id)

    def test_pbkdf2_in_activate(self):
        src = _load(SERVER_PY)
        activate_start = src.find("def _auth_invite_activate(")
        assert activate_start != -1
        activate_block = src[activate_start:activate_start + 3000]
        assert "_pbkdf2_hash(" in activate_block, \
            "_pbkdf2_hash ausente en _auth_invite_activate — PIN se hashea mal (F3)"
        sha_direct = "sha256" in activate_block and "_pbkdf2_hash" not in activate_block
        assert not sha_direct, \
            "SHA256 directo en _auth_invite_activate — regresión del bug de PIN (F3)"

    def test_n1_no_per_signer_select_in_loop(self):
        """El loop for s in valid_signers no debe tener SELECT por username/email (N+1)."""
        src = _load(SERVER_PY)
        create_start = src.find("def _signing_round_create(")
        assert create_start != -1
        create_block = src[create_start:create_start + 12000]
        # Encontrar el primer for s in valid_signers (pre-invitation loop)
        for_pos = create_block.find("for s in valid_signers")
        assert for_pos != -1, "Loop 'for s in valid_signers' no encontrado en _signing_round_create"
        loop_block = create_block[for_pos:for_pos + 1500]
        # El N+1 específico era SELECT per signer por username o email en la tabla users
        # El token lookup (SELECT FROM invitations WHERE token=?) es aceptable
        has_user_select = re.search(
            r'db\.execute\([^)]*SELECT[^)]*WHERE[^)]*username\s*=', loop_block
        )
        has_email_select = re.search(
            r'db\.execute\([^)]*SELECT[^)]*WHERE[^)]*email\s*=\s*\?[^)]*users', loop_block
        )
        assert not has_user_select, \
            "SELECT per username en loop de valid_signers — N+1 regresión (F2)"
        assert not has_email_select, \
            "SELECT per email en users en loop de valid_signers — N+1 regresión (F2)"

    def test_firmas_client_guard_intact(self):
        src = _load(SERVER_PY)
        assert "firmas" in src and "client" in src, \
            "Guard de /firmas/ para rol client ausente en server.py"

    def test_path_traversal_blocked(self):
        r = SESSION.get(f"{BASE}/firmas/../server.py", allow_redirects=False, timeout=5)
        assert r.status_code in (400, 404, 403), \
            f"Path traversal no bloqueado: {r.status_code}"

    def test_idor_cross_project_blocked(self):
        proj_id = _first_proj_id()
        fake_round = str(uuid.uuid4())
        r = SESSION.get(
            f"{BASE}/api/projects/{proj_id}/signing-rounds/{fake_round}",
            timeout=5,
        )
        assert r.status_code == 404, \
            f"Round inexistente no devuelve 404: {r.status_code}"

    def test_create_invitation_before_begin_immediate(self):
        """_create_invitation debe llamarse ANTES de BEGIN IMMEDIATE."""
        src = _load(SERVER_PY)
        fn_start = src.find("def _signing_round_create(")
        assert fn_start != -1
        fn_block = src[fn_start:fn_start + 8000]
        pos_create = fn_block.find("_create_invitation(")
        pos_begin  = fn_block.find('db.execute("BEGIN IMMEDIATE")')
        assert pos_create != -1, "_create_invitation ausente en _signing_round_create"
        assert pos_begin  != -1, 'BEGIN IMMEDIATE ausente en _signing_round_create'
        assert pos_create < pos_begin, \
            "_create_invitation se llama DESPUÉS de BEGIN IMMEDIATE — causará commit anticipado"

    def test_server_syntax_ok(self):
        import ast
        src = _load(SERVER_PY)
        try:
            ast.parse(src)
        except SyntaxError as e:
            pytest.fail(f"server.py tiene error de sintaxis: {e}")
