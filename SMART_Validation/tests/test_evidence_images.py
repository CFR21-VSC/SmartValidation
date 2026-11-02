"""
Imágenes de evidencia: optimización SIN PÉRDIDA (image_opt.py), huellas SHA-256, índice liviano
(GET /evidence?index=1) y revalidación con ETag (GET /evidence/{id} -> 304).
"""
import base64
import hashlib
import io
import sys
import uuid
from pathlib import Path

import pytest
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import image_opt  # noqa: E402


def _png_captura(w=800, h=500, nivel=1):
    """Una 'captura' sintética: bloques de color y texto-ruido (se comprime bien, pero mal con nivel bajo)."""
    im = Image.new("RGB", (w, h), (255, 255, 255))
    px = im.load()
    for y in range(h):
        for x in range(w):
            if (x // 40 + y // 40) % 3 == 0:
                px[x, y] = (30 + (x * 7) % 90, 60, 120 + (y * 3) % 100)
            elif (x * y) % 97 == 0:
                px[x, y] = (0, 0, 0)
    buf = io.BytesIO()
    im.save(buf, "PNG", compress_level=nivel)
    return im, buf.getvalue()


def _uri(raw, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


# ------------------------------------------------------------------ unitarias

def test_png_se_optimiza_sin_perder_un_pixel():
    im, raw = _png_captura(nivel=1)
    uri, info = image_opt.optimizar_data_uri(_uri(raw))
    assert info["optimizado"] and info["bytes"] < info["orig_bytes"]
    salida = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))
    assert salida.mode == im.mode and salida.size == im.size
    assert salida.tobytes() == im.tobytes()                    # píxeles idénticos
    assert info["orig_sha256"] == hashlib.sha256(raw).hexdigest()
    assert info["sha256"] != info["orig_sha256"]


def test_si_no_mejora_se_guarda_tal_cual():
    # ruido aleatorio: ni PNG recomprimido ni WebP sin pérdida ahorran lo suficiente -> se conserva el original
    import os
    im = Image.frombytes("RGB", (120, 90), os.urandom(120 * 90 * 3))
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True, compress_level=9)
    ya_optimo = buf.getvalue()
    uri, info = image_opt.optimizar_data_uri(_uri(ya_optimo))
    assert not info["optimizado"] and uri == _uri(ya_optimo)
    assert info["sha256"] == info["orig_sha256"]


def test_captura_se_guarda_como_webp_sin_perdida_con_pixeles_identicos():
    im, raw = _png_captura(nivel=9)
    uri, info = image_opt.optimizar_data_uri(_uri(raw))
    assert uri.startswith("data:image/webp;base64,") and info["optimizado"] and info.get("formato") == "webp"
    assert info["bytes"] < len(raw) * 0.9
    guardada = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))
    assert guardada.convert("RGBA").tobytes() == im.convert("RGBA").tobytes()
    assert info["orig_sha256"] == hashlib.sha256(raw).hexdigest() and info["sha256"] != info["orig_sha256"]


def test_a_png_bytes_devuelve_los_mismos_pixeles_que_el_original():
    im, raw = _png_captura(nivel=9)
    uri, _ = image_opt.optimizar_data_uri(_uri(raw))
    png = image_opt.a_png_bytes(uri)
    assert png and png[1:4] == b"PNG"
    assert Image.open(io.BytesIO(png)).convert("RGBA").tobytes() == im.convert("RGBA").tobytes()


def test_imagen_enorme_para_webp_se_conserva_como_png():
    big = Image.new("RGB", (16400, 8), (255, 255, 255))
    buf = io.BytesIO(); big.save(buf, "PNG")
    uri, info = image_opt.optimizar_data_uri(_uri(buf.getvalue()))
    assert not uri.startswith("data:image/webp")


def test_jpeg_y_otros_formatos_no_se_tocan():
    im, _ = _png_captura()
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    uri = _uri(buf.getvalue(), "image/jpeg")
    out, info = image_opt.optimizar_data_uri(uri)
    assert out == uri and not info["optimizado"]


def test_entradas_invalidas_no_rompen():
    for malo in ("data:image/png;base64,esto-no-es-base64!!", "data:image/png;base64,AAAA", "no es un data uri", "data:,hola"):
        out, info = image_opt.optimizar_data_uri(malo)
        assert out == malo and not info["optimizado"] and info["sha256"]


def test_png_con_transparencia_conserva_canal_alfa():
    im = Image.new("RGBA", (300, 200), (10, 20, 30, 0))
    for x in range(300):
        for y in range(0, 200, 7):
            im.putpixel((x, y), (200, 100, 50, 255 - x % 200))
    buf = io.BytesIO()
    im.save(buf, "PNG", compress_level=1)
    uri, info = image_opt.optimizar_data_uri(_uri(buf.getvalue()))
    salida = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))
    assert salida.mode == "RGBA" and salida.tobytes() == im.tobytes()


# ------------------------------------------------------------------ endpoints

PID = "proj_" + "9" + uuid.uuid4().hex[:5] + "_" + uuid.uuid4().hex[:6]


def _subir(base, cid, uri):
    return requests.post(f"{base}/api/projects/{PID}/evidence/{PID}_{cid}", json={"data": uri}, timeout=10)


@pytest.fixture(scope="module")
def proyecto(live_server):
    r = requests.post(f"{live_server}/api/projects/{PID}/snapshot", json={"snapshot": {"tests": [], "groups": [], "protocols": []}, "baseRev": 0}, timeout=10)
    assert r.status_code == 200
    return live_server


def test_el_servidor_guarda_la_imagen_optimizada_y_pixel_identica(proyecto):
    im, raw = _png_captura(nivel=1)
    assert _subir(proyecto, "t1_evidence_a", _uri(raw)).status_code == 200
    r = requests.get(f"{proyecto}/api/projects/{PID}/evidence/{PID}_t1_evidence_a", timeout=10)
    assert r.status_code == 200
    data = r.json()["data"]
    guardado = base64.b64decode(data.split(",", 1)[1])
    assert len(guardado) < len(raw)
    assert Image.open(io.BytesIO(guardado)).tobytes() == im.tobytes()
    assert r.json()["sha256"] == hashlib.sha256(guardado).hexdigest()


def test_indice_liviano_no_trae_datos(proyecto):
    _, raw = _png_captura(300, 200)
    _subir(proyecto, "t1_evidence_b", _uri(raw))
    r = requests.get(f"{proyecto}/api/projects/{PID}/evidence?index=1", timeout=10).json()
    assert r["ok"] and set(r) == {"ok", "index"}
    ids = set(r["index"])
    assert f"{PID}_t1_evidence_a" in ids and f"{PID}_t1_evidence_b" in ids
    for v in r["index"].values():
        assert len(v["sha256"]) == 64 and v["size"] > 0 and "data" not in v
    # y es mucho más chico que el listado completo
    completo = requests.get(f"{proyecto}/api/projects/{PID}/evidence", timeout=10)
    assert len(requests.get(f"{proyecto}/api/projects/{PID}/evidence?index=1", timeout=10).content) < len(completo.content) / 5


def test_etag_permite_revalidar_sin_reenviar_la_imagen(proyecto):
    url = f"{proyecto}/api/projects/{PID}/evidence/{PID}_t1_evidence_a"
    r1 = requests.get(url, timeout=10)
    etag = r1.headers.get("ETag")
    assert etag and etag.strip('"') == r1.json()["sha256"]
    r2 = requests.get(url, headers={"If-None-Match": etag}, timeout=10)
    assert r2.status_code == 304 and not r2.content
    r3 = requests.get(url, headers={"If-None-Match": '"otra-version"'}, timeout=10)
    assert r3.status_code == 200 and r3.json()["ok"]


def test_cambiar_la_imagen_cambia_la_huella(proyecto):
    url = f"{proyecto}/api/projects/{PID}/evidence/{PID}_t1_evidence_a"
    antes = requests.get(url, timeout=10).headers["ETag"]
    _, raw2 = _png_captura(640, 480)
    _subir(proyecto, "t1_evidence_a", _uri(raw2))
    despues = requests.get(url, timeout=10).headers["ETag"]
    assert antes != despues


def test_lote_devuelve_varias_imagenes_en_una_peticion(proyecto):
    ids = []
    for i in range(3):
        _, raw = _png_captura(200 + i, 120)
        _subir(proyecto, f"t9_evidence_{i}", _uri(raw))
        ids.append(f"{PID}_t9_evidence_{i}")
    r = requests.post(f"{proyecto}/api/projects/{PID}/evidence/batch", json={"ids": ids + [f"{PID}_no_existe"]}, timeout=10)
    assert r.status_code == 200
    res = r.json()["results"]
    assert all(res[i] and res[i].startswith(("data:image/png;base64,", "data:image/webp;base64,")) for i in ids)
    assert res[f"{PID}_no_existe"] is None


def test_lote_rechaza_listas_invalidas_o_demasiado_largas(proyecto):
    url = f"{proyecto}/api/projects/{PID}/evidence/batch"
    assert requests.post(url, json={"ids": []}, timeout=10).status_code == 400
    assert requests.post(url, json={"ids": ["x"] * 26}, timeout=10).status_code == 400
    assert requests.post(url, json={"ids": "no es lista"}, timeout=10).status_code == 400
    assert requests.post(url, json={}, timeout=10).status_code == 400


def test_lote_ignora_ids_con_caracteres_peligrosos(proyecto):
    r = requests.post(f"{proyecto}/api/projects/{PID}/evidence/batch",
                      json={"ids": ["../../etc/passwd", "a'; DROP TABLE evidence_images;--", 123, None]}, timeout=10)
    assert r.status_code == 200 and r.json()["results"] == {}
    # la tabla sigue ahí
    assert requests.get(f"{proyecto}/api/projects/{PID}/evidence?index=1", timeout=10).json()["ok"]


def test_migracion_convierte_png_guardados_a_webp_con_pixeles_identicos(proyecto):
    import os, sqlite3
    im, raw = _png_captura(nivel=9)
    cid = f"{PID}_t_mig_evidence_a"
    con = sqlite3.connect(os.environ["SV_TEST_DB_PATH"])
    con.execute("INSERT OR REPLACE INTO evidence_images (compound_id, project_id, data, size_bytes, updated_at, sha256, orig_sha256) "
                "VALUES (?,?,?,?,?,?,?)", (cid, PID, _uri(raw), len(_uri(raw)), 1.0, hashlib.sha256(raw).hexdigest(), hashlib.sha256(raw).hexdigest()))
    con.commit(); con.close()
    r = requests.post(f"{proyecto}/admin/evidence/optimize", json={"projectId": PID, "limit": 40}, timeout=60)
    assert r.status_code == 200 and r.json()["ok"] and r.json()["convertidas"] >= 1 and r.json()["done"]
    data = requests.get(f"{proyecto}/api/projects/{PID}/evidence/{cid}", timeout=10).json()["data"]
    assert data.startswith("data:image/webp;base64,")
    assert Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1]))).convert("RGBA").tobytes() == im.convert("RGBA").tobytes()
    idx = requests.get(f"{proyecto}/api/projects/{PID}/evidence?index=1", timeout=10).json()["index"][cid]
    assert idx["orig_sha256"] == hashlib.sha256(raw).hexdigest()    # el navegador que subió el PNG lo reconoce como al día
    # idempotente: una segunda pasada no vuelve a tocar nada
    r2 = requests.post(f"{proyecto}/admin/evidence/optimize", json={"projectId": PID, "limit": 40}, timeout=60).json()
    assert r2["convertidas"] == 0
