"""
Último proyecto abierto por usuario: un navegador/PC nuevo abre solo el proyecto correcto en vez de
adivinar por fecha de modificación (eso abría un proyecto equivocado cuando había varios en el servidor).
"""
import requests

A, B = "proj_test_ultimo_a", "proj_test_ultimo_b"


def _crear(base, pid):
    snap = {"systemInfo": {"nombreSistema": pid}, "tests": [], "groups": [], "protocols": []}
    r = requests.post(f"{base}/api/projects/{pid}/snapshot", json={"snapshot": snap, "baseRev": 0}, timeout=10)
    assert r.status_code == 200


def _marcados(base):
    ps = requests.get(f"{base}/api/projects", timeout=10).json()["projects"]
    return [p["id"] for p in ps if p.get("last_opened_by_me")]


def test_sin_registro_ningun_proyecto_viene_marcado(live_server):
    _crear(live_server, A)
    _crear(live_server, B)
    assert A not in _marcados(live_server) and B not in _marcados(live_server)


def test_registrar_el_ultimo_lo_marca_y_cambiarlo_mueve_la_marca(live_server):
    assert requests.post(f"{live_server}/api/me/last-project", json={"projectId": A}, timeout=10).json()["ok"]
    assert _marcados(live_server) == [A]
    assert requests.post(f"{live_server}/api/me/last-project", json={"projectId": B}, timeout=10).json()["ok"]
    assert _marcados(live_server) == [B]


def test_proyecto_inexistente_o_sin_dato_se_rechaza(live_server):
    r = requests.post(f"{live_server}/api/me/last-project", json={"projectId": "proj_no_existe_x"}, timeout=10)
    assert r.status_code == 404
    r = requests.post(f"{live_server}/api/me/last-project", json={}, timeout=10)
    assert r.status_code == 400
    assert _marcados(live_server) == [B]
