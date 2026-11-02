"""
Optimización SIN PÉRDIDA de imágenes de evidencia (PNG) y huellas para integridad.

Las capturas llegan del navegador con una compresión PNG floja (canvas.toDataURL). Se reencodean con
la compresión máxima y SOLO se acepta el resultado si los píxeles son idénticos (se compara el
contenido decodificado) y si pesa menos. Si además un WebP SIN PÉRDIDA (lossless) reproduce los mismos
píxeles y pesa menos del 90 % del PNG, se guarda ese (las capturas de pantalla bajan ~70 %). Nunca se usa
JPEG ni WebP con pérdida: no es admisible como evidencia GxP. Los PDF (pdfMake) solo leen PNG/JPEG: el
cliente reconvierte el WebP a PNG (idéntico) al exportar, y el ZIP del servidor entrega PNG.

Se devuelve la huella SHA-256 de lo recibido (orig_sha256) y de lo guardado (sha256), para poder
demostrar que lo guardado equivale a lo subido. Si Pillow no está disponible, la imagen se guarda tal cual.
"""
import base64
import hashlib
import io

try:  # Pillow es opcional: sin él solo se calculan las huellas
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 50_000_000      # tope anti "bomba de descompresión"
    _PIL = True
except Exception:  # pragma: no cover
    Image = None
    _PIL = False

MIN_GANANCIA = 0.97   # solo se reemplaza si el PNG nuevo pesa menos del 97 % del original
MIN_GANANCIA_WEBP = 0.90  # el WebP sin pérdida solo se usa si pesa menos del 90 % del PNG recibido
MAX_LADO_WEBP = 16383     # límite del formato WebP


def _rgba_bytes(im):
    return im.convert("RGBA").tobytes()


def _webp_sin_perdida(im, raw_len):
    """Bytes de un WebP lossless con píxeles idénticos al de `im`, o None si no conviene/no es verificable."""
    if im.size[0] > MAX_LADO_WEBP or im.size[1] > MAX_LADO_WEBP:
        return None
    buf = io.BytesIO()
    im.convert("RGBA" if ("A" in im.getbands() or im.mode in ("P", "LA", "PA")) else "RGB").save(
        buf, "WEBP", lossless=True, quality=100, method=4, exact=True)
    nuevo = buf.getvalue()
    if len(nuevo) >= raw_len * MIN_GANANCIA_WEBP:
        return None
    chequeo = Image.open(io.BytesIO(nuevo))
    chequeo.load()
    if chequeo.size != im.size or _rgba_bytes(chequeo) != _rgba_bytes(im):
        return None
    return nuevo


def _split(data_uri):
    if not isinstance(data_uri, str) or not data_uri.startswith("data:") or "," not in data_uri:
        return None, None
    head, b64 = data_uri.split(",", 1)
    if ";base64" not in head:
        return None, None
    mime = head[5:].split(";")[0].strip().lower()
    try:
        return mime, base64.b64decode(b64 + "=" * (-len(b64) % 4), validate=False)
    except Exception:
        return None, None


def sha256_data_uri(data_uri):
    """SHA-256 (hex) de los bytes de la imagen de un data URI, o de todo el texto si no se puede decodificar."""
    _mime, raw = _split(data_uri)
    return hashlib.sha256(raw if raw is not None else str(data_uri).encode("utf-8")).hexdigest()


def optimizar_data_uri(data_uri):
    """Devuelve (data_uri_a_guardar, info). info: orig_sha256, sha256, orig_bytes, bytes, optimizado."""
    mime, raw = _split(data_uri)
    if raw is None:
        h = hashlib.sha256(str(data_uri).encode("utf-8")).hexdigest()
        return data_uri, {"orig_sha256": h, "sha256": h, "orig_bytes": len(str(data_uri)), "bytes": len(str(data_uri)), "optimizado": False}
    h0 = hashlib.sha256(raw).hexdigest()
    info = {"orig_sha256": h0, "sha256": h0, "orig_bytes": len(raw), "bytes": len(raw), "optimizado": False}
    if not _PIL or mime != "image/png":
        return data_uri, info
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        web = _webp_sin_perdida(im, len(raw))
        if web is not None:
            info.update(sha256=hashlib.sha256(web).hexdigest(), bytes=len(web), optimizado=True, formato="webp")
            return "data:image/webp;base64," + base64.b64encode(web).decode("ascii"), info
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True, compress_level=9)
        nuevo = buf.getvalue()
        if len(nuevo) >= len(raw) * MIN_GANANCIA:
            return data_uri, info
        chequeo = Image.open(io.BytesIO(nuevo))
        chequeo.load()
        if chequeo.mode != im.mode or chequeo.size != im.size or chequeo.tobytes() != im.tobytes():
            return data_uri, info                      # los píxeles no coinciden: se conserva el original
        info.update(sha256=hashlib.sha256(nuevo).hexdigest(), bytes=len(nuevo), optimizado=True)
        return "data:image/png;base64," + base64.b64encode(nuevo).decode("ascii"), info
    except Exception:
        return data_uri, info


def a_png_bytes(data_uri):
    """Bytes PNG de una imagen guardada (WebP sin pérdida -> PNG con los mismos píxeles). None si no se puede."""
    mime, raw = _split(data_uri)
    if raw is None:
        return None
    if mime == "image/png":
        return raw
    if not _PIL:
        return None
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=False, compress_level=6)
        return buf.getvalue()
    except Exception:
        return None
