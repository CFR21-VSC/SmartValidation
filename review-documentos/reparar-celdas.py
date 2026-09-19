"""Reparacion de celdas convertidas en string por el bug del editor (H-6 / N-2).

    python review-documentos/reparar-celdas.py <directorio>              # dry-run
    python review-documentos/reparar-celdas.py <directorio> --aplicar    # escribe

Repara dos danos distintos, ambos deterministas y verificables:

  A) Celda que quedo como el JSON serializado de un objeto limpio
     '{"bullets": ["a","b"]}'  ->  {"bullets": ["a","b"]}
     Causa: fallback JSON.stringify(cell) del editor para celdas sin `text`.

  B) Lo anterior, pero con el objeto contaminado por internos de pdfMake
     (positions, pages, _margin, startPosition, pageBreakCalculated, _minWidth,
     _maxWidth, _inlines...). Causa: pdfMake mutaba el documento en edicion (H-7,
     corregido en 8b5ce99) y la mutacion se persistio.
     Se parsea y ademas se limpian esas claves.

NO toca celdas cuyo string no sea JSON valido. NO toca documentos firmados
(se detiene si el documento declara firmas consignadas).
Con --aplicar escribe un .bak junto al original antes de modificarlo.
"""
import json
import os
import shutil
import sys

# Claves que pdfMake agrega durante el layout y que nunca son contenido de autor.
INTERNOS_PDFMAKE = {
    'positions', 'pages', 'startPosition', 'pageBreakCalculated',
    '_margin', '_minWidth', '_maxWidth', '_inlines', '_width', '_height',
    '_alignment', '_textRef', '_span', '_offsets',
    # nodeInfo/pageNumbers los agrega pdfMake al paginar. Dejarlos adentro NO es
    # cosmetico: inflan el _minWidth calculado de la celda muy por encima del ancho
    # de su columna y pdfMake termina emitiendo la tabla vacia (la seccion
    # "desaparece" del PDF sin ningun error). Es la causa de R-2.
    'nodeInfo', 'pageNumbers',
}


def limpiar(obj):
    """Quita recursivamente las claves internas de pdfMake. Devuelve (limpio, n_quitadas)."""
    quitadas = 0
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in INTERNOS_PDFMAKE or (k.startswith('_') and k not in ('_id',)):
                quitadas += 1
                continue
            vv, q = limpiar(v)
            out[k] = vv
            quitadas += q
        return out, quitadas
    if isinstance(obj, list):
        out = []
        for v in obj:
            vv, q = limpiar(v)
            out.append(vv)
            quitadas += q
        return out, quitadas
    return obj, 0


def parece_celda_serializada(s):
    if not isinstance(s, str):
        return None
    t = s.strip()
    if not (t.startswith('{') and t.endswith('}')):
        return None
    try:
        o = json.loads(t)
    except Exception:
        return None
    if not isinstance(o, dict):
        return None
    # Solo formas de celda pdfMake conocidas, para no "reparar" texto legitimo
    if not ({'bullets', 'stack', 'text', 'ul', 'ol', 'table', 'columns'} & set(o.keys())):
        return None
    return o


def documento_firmado(doc):
    for s in doc.get('secciones', []) or []:
        if not isinstance(s, dict):
            continue
        if s.get('tipo') == 'tabla-firmas-final':
            for f in (s.get('firmas') or []):
                if isinstance(f, dict) and (f.get('firmadoPor') or f.get('signedBy') or f.get('hash')):
                    return True
    return False


def procesar(path, aplicar):
    with open(path, 'r', encoding='utf-8-sig') as f:
        doc = json.load(f)
    if not isinstance(doc.get('secciones'), list):
        return None
    if documento_firmado(doc):
        return {'archivo': os.path.basename(path), 'omitido': 'documento con firmas consignadas'}

    reparadas = []
    for s in doc['secciones']:
        if not isinstance(s, dict):
            continue
        for fi, fila in enumerate(s.get('filas') or []):
            if not isinstance(fila, list):
                continue
            for ci, celda in enumerate(fila):
                o = parece_celda_serializada(celda)
                if o is not None:
                    # Caso A: la celda quedo como el JSON serializado de un objeto.
                    limpio, quitadas = limpiar(o)
                    fila[ci] = limpio
                    reparadas.append({
                        'seccion': (s.get('titulo') or s.get('tipo') or '?')[:34],
                        'fila': fi, 'celda': ci, 'caso': 'string->objeto',
                        'claves': sorted(limpio.keys()),
                        'internos_quitados': quitadas,
                        'chars_antes': len(celda),
                    })
                elif isinstance(celda, dict):
                    # Caso B: la celda YA es objeto pero arrastra internos de pdfMake.
                    limpio, quitadas = limpiar(celda)
                    if quitadas:
                        fila[ci] = limpio
                        reparadas.append({
                            'seccion': (s.get('titulo') or s.get('tipo') or '?')[:34],
                            'fila': fi, 'celda': ci, 'caso': 'limpieza de internos',
                            'claves': sorted(limpio.keys()),
                            'internos_quitados': quitadas,
                            'chars_antes': len(json.dumps(celda, ensure_ascii=False)),
                        })

    if not reparadas:
        return {'archivo': os.path.basename(path), 'reparadas': []}

    if aplicar:
        # No pisar un .bak existente: seria perder el original verdadero.
        if not os.path.exists(path + '.bak'):
            shutil.copy2(path, path + '.bak')
        with open(path, 'w', encoding='utf-8-sig') as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
    return {'archivo': os.path.basename(path), 'reparadas': reparadas, 'escrito': aplicar}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    directorio = sys.argv[1]
    aplicar = '--aplicar' in sys.argv

    print('Reparacion de celdas serializadas')
    print(f'  directorio : {directorio}')
    print(f'  modo       : {"APLICAR (escribe, con .bak)" if aplicar else "dry-run (no escribe nada)"}')
    print()

    total = 0
    archivos = 0
    for nombre in sorted(os.listdir(directorio)):
        if not nombre.lower().endswith('.json'):
            continue
        r = procesar(os.path.join(directorio, nombre), aplicar)
        if not r:
            continue
        archivos += 1
        if r.get('omitido'):
            print(f'  {r["archivo"]}: OMITIDO — {r["omitido"]}')
            continue
        if not r['reparadas']:
            continue
        print(f'  {r["archivo"]}: {len(r["reparadas"])} celda(s)')
        for x in r['reparadas']:
            extra = f', {x["internos_quitados"]} internos de pdfMake quitados' if x['internos_quitados'] else ''
            print(f'      [{x["seccion"]}] fila {x["fila"]} celda {x["celda"]}: '
                  f'{x["chars_antes"]} chars -> objeto {x["claves"]}{extra}')
        total += len(r['reparadas'])

    print()
    print(f'  {archivos} documentos analizados, {total} celdas a reparar.')
    if total and not aplicar:
        print('  Dry-run: no se escribio nada. Agregar --aplicar para reparar (deja .bak).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
