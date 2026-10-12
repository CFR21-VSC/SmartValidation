"""
Pruebas de Local File Inclusion / path traversal contra server.py real (vía
el fixture live_server). Cubre tanto el servidor de archivos estáticos
(_serve_static) como los endpoints que construyen paths de archivo a partir
de IDs del request (fotos persistidas en filesystem).

Criterio de éxito en TODOS los casos: nunca 200 con contenido de un archivo
fuera de ROOT_DIR, nunca 200 con una extensión fuera del allowlist, y nunca
una excepción sin manejar (500 con traceback filtrado).
"""
import requests

STATIC_TRAVERSAL_PAYLOADS = [
    "/../server.py",
    "/../../server.py",
    "/css/../../server.py",
    "/css/../../../server.py",
    "/%2e%2e/server.py",
    "/%2e%2e%2fserver.py",
    "/css/%2e%2e%2f%2e%2e%2fserver.py",
    "/..%2f..%2fserver.py",
    "/..%252f..%252fserver.py",       # doble-encoding
    "/..%5c..%5cserver.py",            # backslash encoded (estilo Windows)
    "/....//....//server.py",          # bypass de filtros naive que solo quitan "../" una vez
    "/C%3A/Windows/win.ini",           # intento de reanclar a una unidad (Windows)
]

# Archivos que SÍ existen dentro de ROOT_DIR pero deben seguir bloqueados por
# el blocklist de extensiones o por no estar en el allowlist.
BLOCKED_EXTENSION_PATHS = [
    "/server.py",            # existe, extensión bloqueada explícitamente
    "/requirements.txt",     # existe, .txt no está en el allowlist
]

SENSITIVE_MARKERS = ["AUTH_SECRET", "DATA_DIR", "_r2", "def _api_", "import sqlite3"]


def _assert_not_leaked(resp: requests.Response, label: str):
    assert resp.status_code in (403, 404), (
        f"{label}: se esperaba 403/404, devolvió {resp.status_code}"
    )
    body = resp.text
    for marker in SENSITIVE_MARKERS:
        assert marker not in body, (
            f"{label}: la respuesta contiene '{marker}' -- posible fuga de código fuente"
        )


def test_static_traversal_payloads_never_leak_source(live_server):
    for payload in STATIC_TRAVERSAL_PAYLOADS:
        resp = requests.get(live_server + payload, timeout=5, allow_redirects=False)
        _assert_not_leaked(resp, payload)


def test_blocked_extensions_stay_blocked_even_inside_root(live_server):
    for payload in BLOCKED_EXTENSION_PATHS:
        resp = requests.get(live_server + payload, timeout=5)
        _assert_not_leaked(resp, payload)


def test_legit_static_file_still_served(live_server):
    """Control: confirmar que el bloqueo es específico de traversal/extensión,
    no que _serve_static esté devolviendo 403 a TODO (lo que haría pasar los
    tests de arriba por la razón equivocada)."""
    resp = requests.get(live_server + "/index.html", timeout=5)
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("Content-Type", "")


def test_health_endpoint_reachable(live_server):
    resp = requests.get(live_server + "/health", timeout=5)
    assert resp.status_code == 200


# ── LFI vía IDs de proyecto/foto en endpoints dinámicos ──────────────────────

MALFORMED_PROJ_IDS = [
    "../../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "proj_123/../../secret",
    "proj_123\\..\\..\\windows",
]


def test_photo_endpoints_reject_traversal_in_project_id(live_server):
    for bad_id in MALFORMED_PROJ_IDS:
        resp = requests.get(
            f"{live_server}/api/projects/{bad_id}/photos", timeout=5
        )
        # _is_valid_proj_id rechaza el formato -> 404 "Proyecto no encontrado"
        # (nunca 200, nunca 500 con traceback)
        assert resp.status_code in (400, 403, 404), (
            f"proj_id malformado '{bad_id}' devolvió {resp.status_code} en vez de un rechazo"
        )
        assert "Traceback" not in resp.text


def test_evidence_compound_id_with_traversal_chars_is_rejected(live_server):
    """_RE_EVIDENCE exige [a-zA-Z0-9_-] -- cualquier otro carácter ni siquiera
    matchea la ruta, así que el servidor debe responder 404 (no encontró
    ninguna ruta), nunca intentar abrir un archivo con ese nombre."""
    for bad_id in ["../../etc/passwd", "foo/bar", "foo%2fbar", "foo..bar/../x"]:
        resp = requests.get(f"{live_server}/api/evidence/{bad_id}", timeout=5)
        assert resp.status_code in (400, 404), (
            f"compound_id '{bad_id}' devolvió {resp.status_code}"
        )
        assert "Traceback" not in resp.text
