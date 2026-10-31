"""
Control de concurrencia optimista del snapshot de proyecto.

Problema que cubre: un navegador con una copia local atrasada (IndexedDB/localStorage) pisaba en
silencio lo que otra sesión había guardado en el servidor (carpetas finalizadas que volvían a
quedar abiertas). Ahora POST /snapshot exige `baseRev` y rechaza con 409 si el servidor ya avanzó.
"""
import requests

PID = "proj_test_conflicto"


def _snap(marca):
    return {"systemInfo": {"nombreSistema": "Sistema de prueba"}, "tests": [], "groups": [], "protocols": [], "marca": marca}


def _post(base, snapshot, base_rev=None):
    body = {"snapshot": snapshot}
    if base_rev is not None:
        body["baseRev"] = base_rev
    return requests.post(f"{base}/api/projects/{PID}/snapshot", json=body, timeout=10)


def test_primera_subida_de_proyecto_nuevo_se_acepta(live_server):
    r = _post(live_server, _snap("v1"), base_rev=0)
    assert r.status_code == 200 and r.json()["ok"] and r.json()["rev"]


def test_subida_con_la_revision_vigente_se_acepta_y_avanza(live_server):
    rev1 = requests.get(f"{live_server}/api/projects/{PID}/snapshot", timeout=10).json()["rev"]
    r = _post(live_server, _snap("v2"), base_rev=rev1)
    assert r.status_code == 200
    assert r.json()["rev"] > rev1


def test_copia_atrasada_se_rechaza_y_no_pisa_el_servidor(live_server):
    rev_actual = requests.get(f"{live_server}/api/projects/{PID}/snapshot", timeout=10).json()["rev"]
    # otra sesión guarda y el servidor avanza
    assert _post(live_server, _snap("de-la-otra-sesion"), base_rev=rev_actual).status_code == 200
    # el navegador atrasado intenta guardar con la revisión vieja
    r = _post(live_server, _snap("copia-vieja"), base_rev=rev_actual)
    assert r.status_code == 409
    assert r.json().get("conflict") is True
    # y el servidor conserva lo de la otra sesión
    got = requests.get(f"{live_server}/api/projects/{PID}/snapshot", timeout=10).json()["snapshot"]
    assert got["marca"] == "de-la-otra-sesion"


def test_subida_sin_baseRev_sobre_proyecto_existente_se_rechaza(live_server):
    r = _post(live_server, _snap("sin-base"))
    assert r.status_code == 409
    got = requests.get(f"{live_server}/api/projects/{PID}/snapshot", timeout=10).json()["snapshot"]
    assert got["marca"] != "sin-base"


def test_baseRev_cero_sobre_proyecto_existente_se_rechaza(live_server):
    """Un navegador que nunca bajó el proyecto (base 0) no puede sobrescribirlo."""
    assert _post(live_server, _snap("navegador-nuevo"), base_rev=0).status_code == 409
