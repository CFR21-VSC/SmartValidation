"""Test de cobertura de glifos.

    python review-documentos/glifos-test.py [directorio ...]

Lee el cmap REAL de las cuatro variantes de Roboto embebidas en lib/vfs_fonts.js
(format 4 completo con idDelta/idRangeOffset + format 12, descartando glyphId 0)
y comprueba tres cosas:

  1. Ningun caracter del corpus queda sin glifo y sin sustitucion declarada.
  2. Los CARACTERES DESTINO de cada sustitucion existen en la fuente
     (sustituir por otro glifo ausente no resolveria nada).
  3. Los pendientes declarados sin equivalente semantico se reportan de forma
     visible en vez de quedar ocultos tras una sustitucion que cambie el sentido.

Sale != 0 si (1) o (2) fallan. Los pendientes de (3) se listan pero no rompen el
test: son una decision abierta, no una regresion.
"""
import glob
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cmap  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VFS = os.path.join(RAIZ, 'SMART_Validation/lib/vfs_fonts.js')
RENDERER = os.path.join(RAIZ, 'SMART_Validation/js/validation-suite/core/document-renderer.js')
# El corpus por defecto incluye los documentos REALES, no solo los fixtures:
# apuntando solo a fixtures/ el test daba OK sin haber mirado los 16 documentos
# que se generan de verdad.
CORPUS_DEFAULT = [
    os.path.join(RAIZ, 'SMART_Validation/js/validation-suite/fixtures'),
    r'C:/Users/fjbon/OneDrive/Escritorio/EMQC_Emara/Proyecto demo 1 - Emara/ai-docs',
]


def _literal(s):
    """'\\u2192' o '->' -> texto real."""
    return re.sub(r'\\u([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), s)


def tabla_de_sustituciones():
    """Devuelve (sustituciones {origen: destino}, pendientes set)."""
    src = open(RENDERER, encoding='utf-8', errors='replace').read()
    sust = {}
    m = re.search(r'GLIFOS_SIN_COBERTURA\s*=\s*\{(.*?)\n\s*\};', src, re.S)
    if m:
        for o, d in re.findall(r"'((?:\\u[0-9A-Fa-f]{4})|[^'])'\s*:\s*'((?:\\u[0-9A-Fa-f]{4}|[^'])*)'", m.group(1)):
            sust[_literal(o)] = _literal(d)
    pend = set()
    m2 = re.search(r'PENDIENTES_SIN_EQUIVALENTE\s*=\s*\[(.*?)\]', src, re.S)
    if m2:
        for c in re.findall(r"'((?:\\u[0-9A-Fa-f]{4})|[^'])'", m2.group(1)):
            pend.add(_literal(c))
    return sust, pend


def textos_visibles(obj, out):
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            textos_visibles(v, out)
    elif isinstance(obj, list):
        for v in obj:
            textos_visibles(v, out)


def nombre(cp):
    try:
        return unicodedata.name(chr(cp))
    except ValueError:
        return '?'


def main():
    dirs = sys.argv[1:] or CORPUS_DEFAULT
    print('Test de cobertura de glifos')

    fuentes = cmap.fuentes_embebidas(VFS)
    if not fuentes:
        print('  ERROR: no se pudieron leer las fuentes de', VFS)
        return 2
    cubiertos = set.intersection(*[s for _, s in fuentes])
    print(f'  fuentes embebidas : {len(fuentes)}')
    print(f'  codepoints con glifo real, comunes a todas : {len(cubiertos)}')

    sust, pendientes = tabla_de_sustituciones()
    print(f'  sustituciones declaradas : {len(sust)}  ' +
          ', '.join(f'U+{ord(o):04X}->{d!r}' for o, d in sust.items()))
    print(f'  pendientes sin equivalente : ' +
          (', '.join(f'U+{ord(c):04X} ({nombre(ord(c))})' for c in pendientes) or 'ninguno'))

    errores = []

    # (2) los destinos de sustitucion deben existir en la fuente
    for origen, destino in sust.items():
        faltan = [c for c in destino if ord(c) not in cubiertos]
        if faltan:
            errores.append(f'la sustitucion U+{ord(origen):04X} -> {destino!r} usa '
                           f'caracteres que tampoco estan en la fuente: ' +
                           ', '.join(f'U+{ord(c):04X}' for c in faltan))

    # (1) cobertura del corpus
    archivos = 0
    sin_cubrir = {}
    en_pendientes = {}
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, '*.json'))):
            try:
                doc = json.load(open(p, encoding='utf-8-sig'))
            except Exception:
                continue
            archivos += 1
            ts = []
            textos_visibles(doc, ts)
            for t in ts:
                for ch in t:
                    cp = ord(ch)
                    if cp < 0x20 or cp in cubiertos or ch in sust:
                        continue
                    destino = en_pendientes if ch in pendientes else sin_cubrir
                    e = destino.setdefault(cp, {'n': 0, 'arch': set()})
                    e['n'] += 1
                    e['arch'].add(os.path.basename(p))

    print(f'  documentos escaneados : {archivos}')
    print()

    if en_pendientes:
        print('  PENDIENTES declarados (se ven como cuadrito; requieren decision):')
        for cp, i in sorted(en_pendientes.items(), key=lambda kv: -kv[1]['n']):
            print(f'    U+{cp:04X}  {i["n"]:4d} uso(s)  {nombre(cp)}  ({", ".join(sorted(i["arch"])[:3])})')
        print('    -> se resuelven embebiendo una fuente con cobertura, no sustituyendo.')
        print()

    for cp, i in sorted(sin_cubrir.items(), key=lambda kv: -kv[1]['n']):
        errores.append(f'U+{cp:04X} ({nombre(cp)}) sin glifo ni sustitucion — '
                       f'{i["n"]} uso(s) en {", ".join(sorted(i["arch"])[:3])}')

    if errores:
        print(f'  RESULTADO: FALLA — {len(errores)} problema(s):')
        for e in errores:
            print('    ' + e)
        return 1

    print('  RESULTADO: OK — sin caracteres nuevos sin cubrir; los destinos de '
          'sustitucion existen en la fuente.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
