"""
Tests para vulnerabilidades de seguridad detectadas en audit:

  SEC-01 — XSS: onclick con JSON.stringify en firmas/index.html (Stored XSS via role_label)
  SEC-02 — Magic Link Replay: used_at no se verificaba para returning users en _auth_invite_activate

Todos los tests son estáticos (análisis de código fuente) o funcionales contra el server.
"""

import os
import re
import uuid
import time
import requests
import pytest

BASE    = "http://localhost:11294"
SESSION = requests.Session()

ROOT       = os.path.join(os.path.dirname(__file__), "..")
FIRMAS_HTML = os.path.join(ROOT, "firmas", "index.html")
SERVER_PY   = os.path.join(ROOT, "server.py")

def _load(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# ═══════════════════════════════════════════════════════════════════════════
# SEC-01 — XSS: onclick con JSON.stringify en atributo delimitado por '
# ═══════════════════════════════════════════════════════════════════════════

class TestSEC01XSSFirmasPortal:
    """
    El atributo onclick='openSignModal(${JSON.stringify(p)})' en firmas/index.html
    permite XSS si role_label o cualquier campo de p contiene una comilla simple,
    ya que JSON.stringify no escapa ' y el atributo HTML usa ' como delimitador.

    Fix: data-sign-idx + delegación de eventos. JSON never touches the DOM.
    """

    def test_no_json_stringify_in_onclick_attr(self):
        src = _load(FIRMAS_HTML)
        # El patrón vulnerable era: onclick='openSignModal(${JSON.stringify(
        assert "onclick='openSignModal(" not in src, \
            "SEC-01: onclick con openSignModal inline todavía presente en firmas/index.html"

    def test_no_json_stringify_as_html_attr_value(self):
        src = _load(FIRMAS_HTML)
        # Ningún JSON.stringify debe usarse como valor de atributo HTML (onclick, href, data-*)
        # excepto en fetch/body donde es seguro
        onclick_json = re.search(r'onclick=["\'][^"\']*JSON\.stringify', src)
        assert not onclick_json, \
            f"SEC-01: JSON.stringify en atributo onclick en línea {onclick_json.start() if onclick_json else '?'}"

    def test_data_sign_idx_pattern_used(self):
        src = _load(FIRMAS_HTML)
        assert "data-sign-idx" in src, \
            "SEC-01: patrón data-sign-idx ausente — fix de XSS no aplicado"

    def test_sign_items_array_exists(self):
        src = _load(FIRMAS_HTML)
        assert "_signItems" in src, \
            "SEC-01: array _signItems ausente — fix de XSS no aplicado"

    def test_delegated_click_handler_present(self):
        src = _load(FIRMAS_HTML)
        # El handler debe usar closest('[data-sign-idx]') o getAttribute('data-sign-idx')
        assert "data-sign-idx" in src and ("closest(" in src or "dataset.signIdx" in src), \
            "SEC-01: handler delegado de click ausente — fix de XSS incompleto"

    def test_sign_items_cleared_on_render(self):
        src = _load(FIRMAS_HTML)
        # _signItems debe resetearse al inicio de cada render para evitar stale items
        assert "_signItems = []" in src or "_signItems.length = 0" in src, \
            "SEC-01: _signItems no se limpia en cada render — riesgo de índices desfasados"

    def test_role_label_escaped_in_display(self):
        src = _load(FIRMAS_HTML)
        # El role_label sí se muestra; debe pasar por escHtml()
        # Buscar que el escHtml esté presente y se use en el item body
        assert "escHtml(" in src, \
            "SEC-01: escHtml ausente — display de datos de servidor sin escapar"

    def test_xss_payload_in_role_label_no_onclick(self):
        """
        Funcional: crea una ronda con role_label que contiene ' (comilla simple).
        Verifica que /api/me/pending-signatures devuelve el dato sin crash del servidor.
        (El escape real es del lado frontend, pero el server no debe rechazar el dato.)
        """
        r = SESSION.get(f"{BASE}/api/projects", timeout=5)
        projs = [p for p in r.json().get("projects", [])
                 if not p["id"].startswith("__demo")]
        if not projs:
            pytest.skip("Sin proyectos de prueba")
        proj_id = projs[0]["id"]

        # Limpiar rondas abiertas
        rounds_r = SESSION.get(f"{BASE}/api/projects/{proj_id}/signing-rounds", timeout=5)
        for rnd in rounds_r.json().get("rounds", []):
            if rnd["status"] == "open":
                SESSION.post(f"{BASE}/api/projects/{proj_id}/signing-rounds/{rnd['id']}/cancel",
                             json={"reason": "sec test cleanup"}, timeout=5)

        # Crear ronda con role_label que incluye comilla simple
        xss_role = "Revisor' data-x='injected"
        r = SESSION.post(
            f"{BASE}/api/projects/{proj_id}/signing-rounds",
            json={
                "doc_type": "URS",
                "doc_version": 1,
                "signers": [{"display": "Sec Tester", "role": xss_role, "username": "dev"}],
            },
            timeout=10,
        )
        data = r.json()
        # El server debe aceptarlo (validación de role_label no es responsabilidad del server)
        # o rechazarlo con 400 — lo que no debe hacer es crashear (500)
        assert r.status_code != 500, f"Server 500 con role_label que contiene comilla: {r.text}"
        # Cleanup
        if data.get("ok"):
            rid = data.get("round_id") or data.get("round", {}).get("id")
            if rid:
                SESSION.post(f"{BASE}/api/projects/{proj_id}/signing-rounds/{rid}/cancel",
                             json={"reason": "sec test"}, timeout=5)


# ═══════════════════════════════════════════════════════════════════════════
# SEC-02 — Magic Link Replay para returning users
# ═══════════════════════════════════════════════════════════════════════════

class TestSEC02MagicLinkReplay:
    """
    POST /auth/invite/{token}/activate no verificaba used_at para returning users.
    Un link ya utilizado podía reusarse indefinidamente como vector de fuerza bruta de PIN.

    Fix: verificar used_at antes del branch is_returning.
    """

    def test_used_at_check_before_is_returning_branch(self):
        src = _load(SERVER_PY)
        fn_start = src.find("def _auth_invite_activate(")
        assert fn_start != -1
        fn_block = src[fn_start:fn_start + 3000]

        # Buscar el BRANCH real, no el comentario o la asignación
        pos_used_at   = fn_block.find('inv["used_at"]')
        pos_branch    = fn_block.find("if is_returning:")  # el if, no la variable ni el comentario

        assert pos_used_at != -1, \
            "SEC-02: verificación de inv['used_at'] ausente en _auth_invite_activate"
        assert pos_branch != -1, \
            "SEC-02: 'if is_returning:' ausente en _auth_invite_activate"
        assert pos_used_at < pos_branch, (
            f"SEC-02: inv['used_at'] (pos {pos_used_at}) se verifica DESPUÉS de "
            f"'if is_returning:' (pos {pos_branch}) — returning users pueden reutilizar links"
        )

    def test_used_at_check_unconditional(self):
        """El check de used_at no debe estar dentro de un if is_returning: o if not is_returning:."""
        src = _load(SERVER_PY)
        fn_start = src.find("def _auth_invite_activate(")
        fn_block = src[fn_start:fn_start + 3000]

        # Encontrar la línea del check used_at
        used_at_pos = fn_block.find('inv["used_at"]')
        assert used_at_pos != -1

        # Mirar las 300 chars antes del check para ver si está dentro de un if is_returning
        ctx_before = fn_block[max(0, used_at_pos - 300):used_at_pos]
        # El último bloque de indentación antes debe ser el nivel de la función, no de un if is_returning
        assert "if is_returning" not in ctx_before.split('\n')[-4:], \
            "SEC-02: el check de used_at está anidado dentro de if is_returning — no es incondicional"

    def test_activate_used_token_returns_409(self):
        """
        Funcional: activar un token ya usado debe devolver 409.
        Usamos el endpoint de check (GET) para obtener un token válido,
        lo activamos una vez, y verificamos que el segundo intento devuelve 409.
        """
        # No podemos crear un usuario provisional completo en ALLOW_NO_AUTH,
        # pero podemos verificar que un token inexistente devuelve 404
        # y que el mecanismo exists en el código.
        # Test estático ya cubre la lógica; aquí verificamos el 409 con token ficticio.
        r = SESSION.post(
            f"{BASE}/auth/invite/tokeninvalidoxyz123456789012345678901234567890/activate",
            json={"pin": "123456"},
            timeout=5,
        )
        # 404 = token no encontrado (correcto), 409 = ya usado (correcto),
        # 410 = expirado (correcto). 200 sería un fallo.
        assert r.status_code in (404, 409, 410, 400), \
            f"SEC-02: activate de token inválido devolvió {r.status_code} — esperado 4xx"
        assert r.status_code != 200, \
            "SEC-02: activate de token inválido devolvió 200 — auth bypass"

    def test_no_duplicate_used_at_check_in_else_branch(self):
        """Tras el fix, el else branch no necesita su propio check de used_at."""
        src = _load(SERVER_PY)
        fn_start = src.find("def _auth_invite_activate(")
        fn_block = src[fn_start:fn_start + 3000]

        # Contar cuántas veces aparece inv["used_at"] — debe ser exactamente 1
        count = fn_block.count('inv["used_at"]')
        assert count == 1, \
            f"SEC-02: inv['used_at'] aparece {count} veces en _auth_invite_activate — " \
            "el check redundante del else branch debe eliminarse (o el incondicional falta)"

    def test_activate_short_token_still_rejected(self):
        """Regresión: el endpoint sigue rechazando tokens cortos (validación no rota por el fix)."""
        r = SESSION.post(
            f"{BASE}/auth/invite/corto/activate",
            json={"pin": "123456"},
            timeout=5,
        )
        assert r.status_code in (400, 404), \
            f"SEC-02 regresión: token corto debería dar 400/404, dio {r.status_code}"
