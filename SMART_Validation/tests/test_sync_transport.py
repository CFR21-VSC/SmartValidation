"""
Transporte de la sincronización: cuerpos comprimidos (gzip), respuestas comprimidas y consulta
liviana de revisión (/rev).
"""
import gzip
import json
import uuid

import requests

PID = "proj_test_transporte_" + uuid.uuid4().hex[:8]


def _snap(n=0):
    # relleno comprimible, para que el gzip tenga efecto
    return {"systemInfo": {"nombreSistema": "Transporte"}, "tests": [{"id": f"t{i}", "name": "prueba " * 20} for i in range(n)],
            "groups": [], "protocols": []}


def _post_gz(base, body, headers=None):
    raw = gzip.compress(json.dumps(body).encode())
    h = {"Content-Type": "application/json", "Content-Encoding": "gzip"}
    h.update(headers or {})
    return requests.post(f"{base}/api/projects/{PID}/snapshot", data=raw, headers=h, timeout=10)


def test_cuerpo_gzip_se_acepta(live_server):
    r = _post_gz(live_server, {"snapshot": _snap(200), "baseRev": 0})
    assert r.status_code == 200 and r.json()["ok"]


def test_cuerpo_gzip_corrupto_da_400(live_server):
    r = requests.post(f"{live_server}/api/projects/{PID}/snapshot", data=b"esto no es gzip",
                      headers={"Content-Type": "application/json", "Content-Encoding": "gzip"}, timeout=10)
    assert r.status_code == 400


def test_encoding_desconocido_da_415(live_server):
    r = requests.post(f"{live_server}/api/projects/{PID}/snapshot", data=b"{}",
                      headers={"Content-Type": "application/json", "Content-Encoding": "br"}, timeout=10)
    assert r.status_code == 415


def test_bomba_gzip_se_rechaza(live_server):
    # ~60 MB de ceros comprimen a unos KB: el tope debe aplicarse al tamaño descomprimido (50 MB)
    raw = gzip.compress(b"0" * (60 * 1024 * 1024), compresslevel=9)
    assert len(raw) < 1024 * 1024
    r = requests.post(f"{live_server}/api/projects/{PID}/snapshot", data=raw,
                      headers={"Content-Type": "application/json", "Content-Encoding": "gzip"}, timeout=30)
    assert r.status_code == 413


def test_respuesta_grande_viaja_comprimida_si_el_cliente_acepta(live_server):
    rev = requests.get(f"{live_server}/api/projects/{PID}/rev", timeout=10).json()["rev"]
    assert _post_gz(live_server, {"snapshot": _snap(400), "baseRev": rev}).status_code == 200
    r = requests.get(f"{live_server}/api/projects/{PID}/snapshot", headers={"Accept-Encoding": "gzip"}, timeout=10, stream=True)
    assert r.headers.get("Content-Encoding") == "gzip"
    assert json.loads(gzip.decompress(r.raw.read(decode_content=False)))["ok"] is True
    # y sin Accept-Encoding no se comprime
    r2 = requests.get(f"{live_server}/api/projects/{PID}/snapshot", headers={"Accept-Encoding": "identity"}, timeout=10)
    assert r2.headers.get("Content-Encoding") is None and r2.json()["ok"] is True


def test_rev_liviano_coincide_con_el_snapshot(live_server):
    rv = requests.get(f"{live_server}/api/projects/{PID}/rev", timeout=10).json()
    sn = requests.get(f"{live_server}/api/projects/{PID}/snapshot", timeout=10).json()
    assert rv["ok"] and rv["rev"] == sn["rev"] and rv["rev"] > 0


def test_rev_de_proyecto_inexistente_da_404(live_server):
    assert requests.get(f"{live_server}/api/projects/no_existe_{uuid.uuid4().hex[:6]}/rev", timeout=10).status_code in (403, 404)
