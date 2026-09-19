"""Reparacion de canvas con coordenadas absolutas, dirigida por MANIFIESTO.

    python review-documentos/reparar-canvas.py --inventario           # propone y escribe el manifiesto
    python review-documentos/reparar-canvas.py --aplicar <manifiesto> # aplica SOLO lo aprobado

Flujo en dos pasos, a proposito. `--inventario` recorre y propone; no escribe
ningun documento. `--aplicar` no recorre nada: ejecuta exactamente lo que dice
el manifiesto, y solo si cada archivo sigue igual que cuando se lo inventario.
Asi la aplicacion no depende de que la deteccion vuelva a dar lo mismo.

Que arregla y por que
---------------------
pdfMake reescribe los nodos que recibe con el layout que resolvio. Cuando ese
nodo mutado se guardaba, las coordenadas absolutas de pagina quedaban dentro del
documento. El renderer ya entrega una copia profunda (commit 8b5ce99), asi que
no se genera contaminacion nueva; esto es el residuo historico.

La mutacion se reprodujo (review-documentos/canvas-probe.cjs):

    original            x1:0   y1:0        x2:130 y2:0
    tras render         x1:50  y1:711.875  x2:180 y2:711.875   + resetXY

Las X coinciden exactamente con lo guardado en Proyecto_Prueba_2026_RECOVERED
(x1:50, x2:180). Las Y no: 711.875 contra 677.625. Eso es lo esperable —cada
render deja la Y de SU posicion en pagina— y no una coincidencia literal.

De donde sale el valor reparado
-------------------------------
NO de aritmetica sobre el nodo corrupto, ni del fixture. El skill generador
(claude-desktop-skills/urs-generator.md, seccion 11 RESUMEN ESTADISTICO) declara
el nodo textualmente:

    { "canvas": [{ "type": "line", "x1": 0, "y1": 0, "x2": 130, "y2": 0,
                   "lineWidth": 0.5, "lineColor": "#D0D5DB" }] }

Es el contrato con el que se escriben los documentos. El valor propuesto se
compara contra el y se marca si difiere.

Limites, explicitos
-------------------
`abs(y) > 842` es una heuristica de A4, no una prueba universal: dice que esa Y
no cabe en una pagina A4, nada mas. Por eso NO alcanza sola. Se exige ademas
rastro de pdfMake o coincidencia con el nodo que declara el generador. Un canvas
con desplazamiento local legitimo no se toca: se lista para revision humana.
"""
import argparse
import datetime
import glob
import hashlib
import io
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALTO_A4 = 842

DIRECTORIOS = [
    RAIZ,
    r'C:/Users/fjbon/OneDrive/Escritorio/EMQC_Emara/Proyecto demo 1 - Emara/ai-docs',
]

# Nodo canonico segun claude-desktop-skills/urs-generator.md, seccion 11.
CANONICO = {'type': 'line', 'x1': 0, 'y1': 0, 'x2': 130, 'y2': 0,
            'lineWidth': 0.5, 'lineColor': '#D0D5DB'}

# Claves que solo escribe pdfMake al resolver el layout: prueba de procedencia.
INTERNAS_PDFMAKE = ('nodeInfo', 'resetXY', '_margin', '_inlines', '_minWidth',
                    '_maxWidth', 'positions', 'startPosition')


def sha256(p):
    with open(p, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def num(v):
    return int(v) if float(v).is_integer() else v


BORRADOR = ('borrador', 'draft')


def _estado_de(obj):
    """('borrador' | 'firmado' | 'desconocido', motivo) para UN objeto documento."""
    if not isinstance(obj, dict):
        return 'desconocido', 'no es un objeto'
    for a in obj.get('matrizAprobaciones') or []:
        if isinstance(a, dict) and str(a.get('fecha') or '').strip():
            return 'firmado', f'matrizAprobaciones con fecha ({a.get("rol")})'
    for ruta, est in (('document.status', ((obj.get('document') or {}).get('status'))),
                      ('status', obj.get('status') if isinstance(obj.get('status'), str) else None)):
        if est is None:
            continue
        e = str(est).strip().lower()
        if not e:
            return 'desconocido', f'{ruta} vacio'
        return ('borrador', f'{ruta} = "{est}"') if e in BORRADOR else ('firmado', f'{ruta} = "{est}"')
    return 'desconocido', 'sin estado declarado'


def estado_para(raiz, ruta):
    """Estado del documento al que PERTENECE esa ruta, no el de la raiz.

    Un snapshot contiene documentos anidados con su propio estado. Mirar solo la
    raiz devolvia "no firmado" para un snapshot que contuviera un documento
    aprobado. Se sube desde el nodo hacia afuera hasta el primer objeto que
    parezca un documento, y se usa SU estado.

    Ante estado desconocido NO se aplica: queda para revision. La ausencia de
    fecha en el JSON tampoco prueba que no exista una firma en la suite de
    Firmas; este chequeo es una cota inferior, no una garantia.
    """
    pasos = re.findall(r'\.([A-Za-z0-9_]+)|\[(\d+)\]', ruta)
    cadena, cur = [raiz], raiz
    for clave, idx in pasos:
        try:
            cur = cur[clave] if clave else cur[int(idx)]
        except (KeyError, IndexError, TypeError):
            break
        cadena.append(cur)
    # Del nodo hacia la raiz: gana el documento mas cercano que declare estado.
    for obj in reversed(cadena):
        if not isinstance(obj, dict):
            continue
        parece_doc = ('secciones' in obj or 'document' in obj or
                      'matrizAprobaciones' in obj or isinstance(obj.get('status'), str))
        if not parece_doc:
            continue
        est, motivo = _estado_de(obj)
        if est != 'desconocido':
            return est, motivo
    return 'desconocido', 'ningun documento contenedor declara estado'


def recorrer(obj, ruta, visitar):
    """Visita cada forma de canvas pasando el objeto que la CONTIENE."""
    if isinstance(obj, dict):
        if isinstance(obj.get('canvas'), list):
            for i, n in enumerate(obj['canvas']):
                if isinstance(n, dict):
                    visitar(f'{ruta}.canvas[{i}]', obj['canvas'], i, n, obj)
        for k, v in obj.items():
            # nodeInfo es la anotacion interna de pdfMake, no el documento.
            if k == 'nodeInfo':
                continue
            recorrer(v, f'{ruta}.{k}', visitar)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            recorrer(v, f'{ruta}[{i}]', visitar)


def clasificar(n, contenedor):
    """('reparable' | 'revisar' | None, propuesto, motivos)."""
    if n.get('type') != 'line':
        return None, None, []
    try:
        x1, y1, x2, y2 = (float(n[k]) for k in ('x1', 'y1', 'x2', 'y2'))
    except (KeyError, TypeError, ValueError):
        return None, None, []
    if y1 != y2:
        return None, None, []
    if x1 == 0 and y1 == 0:
        return None, None, []

    prop = dict(n)
    prop.update({'x1': 0, 'y1': 0, 'x2': num(x2 - x1), 'y2': 0})
    prop.pop('resetXY', None)

    motivos = []
    rastro = sorted({k for o in (n, contenedor) if isinstance(o, dict)
                     for k in INTERNAS_PDFMAKE if k in o})
    if rastro:
        motivos.append(f'rastro de pdfMake en el nodo o su contenedor: {", ".join(rastro)}')
    if prop == CANONICO:
        motivos.append('el valor propuesto es identico al que declara urs-generator.md')
    fuera = abs(y1) > ALTO_A4
    if fuera:
        motivos.append(f'y={y1} no cabe en una pagina A4 (heuristica, no prueba universal)')

    # Se exige una prueba de procedencia o de contrato. La heuristica A4 sola
    # no alcanza: corrobora, no demuestra.
    if rastro or prop == CANONICO:
        return 'reparable', prop, motivos
    return 'revisar', prop, motivos or ['sin rastro de pdfMake y sin coincidencia con el contrato']


def inventariar(destino):
    entradas, revisar = [], []
    for base in DIRECTORIOS:
        if not os.path.isdir(base):
            print(f'(no existe, se omite) {base}')
            continue
        for p in sorted(glob.glob(os.path.join(base, '**', '*.json'), recursive=True)):
            if 'node_modules' in p or p.endswith('.candidato.json'):
                continue
            try:
                doc = json.load(open(p, encoding='utf-8-sig'))
            except Exception:
                continue
            hallazgos = []
            recorrer(doc, '', lambda ruta, arr, i, n, cont: hallazgos.append((ruta, n, cont)))
            if not hallazgos:
                continue

            for ruta, n, cont in hallazgos:
                clase, prop, motivos = clasificar(n, cont)
                if not clase:
                    continue
                est, por_que = estado_para(doc, ruta)
                fila = {'archivo': os.path.abspath(p), 'sha256': sha256(p), 'ruta': ruta,
                        'valorPrevio': n, 'valorPropuesto': prop,
                        'estadoDocumento': est, 'estadoSegun': por_que,
                        'motivos': motivos, 'aprobada': False}
                if est != 'borrador':
                    fila['motivos'] = motivos + [f'estado del documento: {est} ({por_que})']
                    revisar.append(fila)
                elif clase == 'reparable':
                    entradas.append(fila)
                else:
                    revisar.append(fila)

    manifiesto = {
        'generado': datetime.datetime.now().isoformat(timespec='seconds'),
        'canonicoSegun': 'SMART_Validation/claude-desktop-skills/urs-generator.md, seccion 11',
        '_comoAplicar': ("Estas son PROPUESTAS detectadas, no aprobaciones. Para aplicar una, "
                         "poner \"aprobada\": true en esa entrada. --aplicar ignora todo lo demas."),
        'propuestas': entradas,
        'paraRevisionHumana': revisar,
    }
    io.open(destino, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(manifiesto, ensure_ascii=False, indent=2))

    for e in entradas + revisar:
        marca = 'PROPUESTA' if e in entradas else 'a revisar'
        print(f'\n[{marca}] {os.path.relpath(e["archivo"], RAIZ)}')
        print(f'  {e["ruta"]}')
        print(f'  - {json.dumps(e["valorPrevio"], ensure_ascii=False)}')
        print(f'  + {json.dumps(e["valorPropuesto"], ensure_ascii=False)}')
        for m in e['motivos']:
            print(f'    · {m}')
    print(f'\n{len(entradas)} propuesta(s) detectada(s) · {len(revisar)} para revision humana')
    print(f'manifiesto: {os.path.relpath(destino, RAIZ)}')
    print('NADA fue modificado. Ninguna propuesta viene aprobada: hay que poner')
    print('"aprobada": true en cada una que se acepte, y recien ahi --aplicar.')
    return 0


def respaldo(p):
    """Backup que NUNCA pisa otro: lleva hash del contenido y marca de tiempo."""
    marca = datetime.datetime.now().strftime('%Y%m%dT%H%M%S')
    destino = f'{p}.{sha256(p)[:8]}.{marca}.bak'
    if os.path.exists(destino):
        raise SystemExit(f'el backup ya existe, no se pisa: {destino}')
    with open(p, 'rb') as o, open(destino, 'wb') as d:
        d.write(o.read())
    return destino


def _navegar(doc, ruta):
    """Devuelve (contenedor_lista, indice) para una ruta .a.b[0].canvas[1]."""
    import re
    cur = doc
    pasos = re.findall(r'\.([A-Za-z0-9_]+)|\[(\d+)\]', ruta)
    for clave, idx in pasos[:-1]:
        cur = cur[clave] if clave else cur[int(idx)]
    clave, idx = pasos[-1]
    if clave:
        raise SystemExit(f'ruta inesperada, no termina en indice: {ruta}')
    return cur, int(idx)


def aplicar(ruta_manifiesto):
    man = json.load(open(ruta_manifiesto, encoding='utf-8-sig'))
    todas = (man.get('propuestas') or []) + (man.get('aprobadas') or [])
    entradas = [e for e in todas if e.get('aprobada') is True]
    if not todas:
        print('el manifiesto no tiene propuestas')
        return 0
    if not entradas:
        print(f'{len(todas)} propuesta(s) en el manifiesto y NINGUNA aprobada.')
        print('Una propuesta detectada no es una aprobacion: poner "aprobada": true')
        print('en las que se acepten. No se toco nada.')
        return 0

    porArchivo = {}
    for e in entradas:
        porArchivo.setdefault(e['archivo'], []).append(e)

    aplicados = 0
    for p, es in porArchivo.items():
        if not os.path.exists(p):
            print(f'OMITIDO (no existe): {p}')
            continue
        actual = sha256(p)
        if actual != es[0]['sha256']:
            print(f'OMITIDO (el archivo cambio desde el inventario): {p}')
            print(f'   manifiesto {es[0]["sha256"][:12]} · actual {actual[:12]}')
            continue
        doc = json.load(open(p, encoding='utf-8-sig'))

        cambios = 0
        for e in es:
            # El estado se revalida aca, por ruta: el manifiesto puede ser viejo
            # y el documento puede haberse firmado desde entonces.
            est, por_que = estado_para(doc, e['ruta'])
            if est != 'borrador':
                print(f'OMITIDO (estado {est}: {por_que}): {os.path.basename(p)} {e["ruta"]}')
                continue
            arr, i = _navegar(doc, e['ruta'])
            if arr[i] != e['valorPrevio']:
                print(f'OMITIDO (el nodo ya no es el inventariado): {p} {e["ruta"]}')
                continue
            arr[i] = e['valorPropuesto']
            cambios += 1
        if not cambios:
            continue
        bak = respaldo(p)
        io.open(p, 'w', encoding='utf-8', newline='\n').write(
            json.dumps(doc, ensure_ascii=False, indent=2))
        aplicados += cambios
        print(f'APLICADO ({cambios}): {os.path.relpath(p, RAIZ)}')
        print(f'   respaldo: {os.path.basename(bak)}')
    print(f'\n{aplicados} nodo(s) reparados')
    return 0


def main():
    ap = argparse.ArgumentParser(add_help=True, description=__doc__)
    ap.add_argument('--inventario', action='store_true', help='propone y escribe el manifiesto')
    ap.add_argument('--aplicar', metavar='MANIFIESTO', help='aplica solo lo aprobado del manifiesto')
    ap.add_argument('--salida', default=os.path.join(RAIZ, 'review-documentos/canvas-manifiesto.json'))
    a = ap.parse_args()
    if a.aplicar:
        return aplicar(a.aplicar)
    if a.inventario:
        return inventariar(a.salida)
    ap.print_help()
    print('\nNo se hizo nada: elegir --inventario o --aplicar.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
