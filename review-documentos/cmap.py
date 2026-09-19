"""Lectura correcta del cmap de las fuentes embebidas en lib/vfs_fonts.js.

Modulo compartido por glifos-test.py. Resuelve format 4 COMPLETO
(idDelta + idRangeOffset) y ademas format 12, y verifica glyphId != 0:
un codepoint mapeado al glifo 0 (.notdef) se dibuja como cuadrito aunque
figure en el rango startCode..endCode.

La version anterior solo expandia startCode..endCode, por lo que podia
contar como presentes glifos ausentes.
"""
import base64
import re
import struct


def _tablas(data):
    n = struct.unpack('>H', data[4:6])[0]
    out = {}
    for i in range(n):
        off = 12 + i * 16
        tag = data[off:off + 4].decode('latin1')
        o, l = struct.unpack('>II', data[off + 8:off + 16])
        out[tag] = (o, l)
    return out


def _format4(sub):
    """Devuelve {codepoint: glyphId} resolviendo idDelta e idRangeOffset."""
    seg_x2 = struct.unpack('>H', sub[6:8])[0]
    seg = seg_x2 // 2
    ends = struct.unpack('>' + 'H' * seg, sub[14:14 + seg_x2])
    starts = struct.unpack('>' + 'H' * seg, sub[16 + seg_x2:16 + 2 * seg_x2])
    deltas = struct.unpack('>' + 'h' * seg, sub[16 + 2 * seg_x2:16 + 3 * seg_x2])
    ro_off = 16 + 3 * seg_x2
    ranges = struct.unpack('>' + 'H' * seg, sub[ro_off:ro_off + seg_x2])

    mapa = {}
    for i in range(seg):
        ini, fin = starts[i], ends[i]
        if ini > fin or fin == 0xFFFF and ini == 0xFFFF:
            continue
        for c in range(ini, min(fin, 0xFFFF) + 1):
            if ranges[i] == 0:
                gid = (c + deltas[i]) & 0xFFFF
            else:
                # idRangeOffset apunta dentro del propio array glyphIdArray
                pos = ro_off + i * 2 + ranges[i] + (c - ini) * 2
                if pos + 2 > len(sub):
                    continue
                gid = struct.unpack('>H', sub[pos:pos + 2])[0]
                if gid != 0:
                    gid = (gid + deltas[i]) & 0xFFFF
            if gid != 0:                 # gid 0 = .notdef -> se dibuja cuadrito
                mapa[c] = gid
    return mapa


def _format12(sub):
    n = struct.unpack('>I', sub[12:16])[0]
    mapa = {}
    for i in range(n):
        off = 16 + i * 12
        ini, fin, gid0 = struct.unpack('>III', sub[off:off + 12])
        for c in range(ini, min(fin, 0x10FFFF) + 1):
            gid = gid0 + (c - ini)
            if gid != 0:
                mapa[c] = gid
    return mapa


def codepoints(data):
    """Conjunto de codepoints con glifo REAL (glyphId != 0)."""
    t = _tablas(data)
    if 'cmap' not in t:
        return set()
    o, l = t['cmap']
    cm = data[o:o + l]
    n = struct.unpack('>H', cm[2:4])[0]
    total = {}
    for i in range(n):
        _pid, _eid, off = struct.unpack('>HHI', cm[4 + i * 8:12 + i * 8])
        sub = cm[off:]
        fmt = struct.unpack('>H', sub[:2])[0]
        if fmt == 4:
            total.update(_format4(sub))
        elif fmt == 12:
            total.update(_format12(sub))
    return set(total)


def fuentes_embebidas(ruta_vfs):
    """[(nombre, set(codepoints))] de cada Roboto embebida."""
    src = open(ruta_vfs, encoding='utf-8', errors='replace').read()
    out = []
    for nombre, b64 in re.findall(r'"(Roboto-[A-Za-z]+\.ttf)"\s*:\s*"([A-Za-z0-9+/=]+)"', src):
        out.append((nombre, codepoints(base64.b64decode(b64))))
    return out
