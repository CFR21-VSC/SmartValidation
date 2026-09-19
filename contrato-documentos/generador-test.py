"""Prueba las protecciones del generador de esqueletos. No escribe nada.

    python contrato-documentos/generador-test.py

Por que no alcanza con `--check`
--------------------------------
La idempotencia solo demuestra estabilidad con las MISMAS entradas. No dice nada
sobre que pasa cuando el documento de muestra cambia, que es justamente cuando
un generador puede corromper un contrato publicado en silencio.

Cada caso construye una entrada distinta a proposito y declara el resultado
esperado por separado, sin derivarlo con la misma funcion que se esta probando.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

G = import_module('generar-esqueleto')
RAIZ = G.RAIZ

fallos = 0


def caso(nombre, ok, detalle=''):
    global fallos
    print(f'{" OK " if ok else "FALLA"}  {nombre}')
    if not ok:
        fallos += 1
        if detalle:
            print(f'        {detalle}')


def col_por_label(sec, label):
    for c in (sec.get('tabla') or {}).get('columnas') or []:
        if c.get('label') == label:
            return c
    return None


esq = json.load(open(os.path.join(RAIZ, 'contrato-documentos/urs.skeleton.v3.json'),
                    encoding='utf-8-sig'))
prev = {s['id']: s for s in esq['secciones']}
REQ = 'requerimientos-funcionales'

# -- 1. Columnas reordenadas: el rol de ID no puede mudarse de columna -------
# Resultado esperado, declarado a mano: el rol idDefinicion y el patron URS
# pertenecen a la columna etiquetada "URS-ID", este donde este.
avisos = []
doc_reordenado = {'id': REQ, 'clase': 'seccion', 'tipo': 'tabla',
                  'titulo': 'REQUERIMIENTOS FUNCIONALES',
                  'columnas': ['Fuente', 'URS-ID', 'El sistema DEBERÁ...', 'Tipo', 'Criticidad']}
out = G.seccion_esqueleto(doc_reordenado, prev[REQ], avisos)
c_id = col_por_label(out, 'URS-ID')
c_fuente = col_por_label(out, 'Fuente')
caso('columnas reordenadas: el rol idDefinicion sigue en "URS-ID"',
     c_id and c_id.get('rol') == 'idDefinicion' and c_id.get('idClase') == 'URS',
     f'quedo: {json.dumps(c_id, ensure_ascii=False)}')
caso('columnas reordenadas: "Fuente" NO hereda el rol de ID',
     c_fuente is not None and c_fuente.get('rol') != 'idDefinicion',
     f'quedo: {json.dumps(c_fuente, ensure_ascii=False)}')
c_crit = col_por_label(out, 'Criticidad')
caso('columnas reordenadas: el enum sigue en "Criticidad"',
     c_crit and c_crit.get('enum') == ['CRÍTICO', 'ALTO', 'MEDIO'],
     f'quedo: {json.dumps(c_crit, ensure_ascii=False)}')
caso('columnas reordenadas: no hace falta avisar nada (todas emparejan por etiqueta)',
     avisos == [], f'avisos: {avisos}')

# -- 2. Columna nueva sin correspondencia: se avisa y no se inventa rol ------
avisos = []
doc_nueva = dict(doc_reordenado,
                 columnas=['URS-ID', 'Fuente', 'El sistema DEBERÁ...', 'Tipo', 'Modulo'])
out = G.seccion_esqueleto(doc_nueva, prev[REQ], avisos)
c_mod = col_por_label(out, 'Modulo')
caso('columna nueva: se arrastra por posicion PERO queda avisada',
     any('POSICION' in a for a in avisos), f'avisos: {avisos}')
caso('columna nueva: el rol de ID no se movio',
     col_por_label(out, 'URS-ID').get('rol') == 'idDefinicion')

# -- 3. Menos columnas que antes: no se adivina por posicion -----------------
avisos = []
doc_menos = dict(doc_reordenado, columnas=['URS-ID', 'Observaciones'])
out = G.seccion_esqueleto(doc_menos, prev[REQ], avisos)
c_obs = col_por_label(out, 'Observaciones')
caso('menos columnas: la columna sin correspondencia queda sin rol ni enum',
     c_obs == {'label': 'Observaciones'}, f'quedo: {json.dumps(c_obs, ensure_ascii=False)}')
caso('menos columnas: se avisa la falta de correspondencia',
     any('sin correspondencia' in a for a in avisos), f'avisos: {avisos}')

# -- 4. Etiqueta duplicada: correspondencia ambigua, no se arrastra nada -----
avisos = []
doc_dup = dict(doc_reordenado, columnas=['URS-ID', 'URS-ID', 'El sistema DEBERÁ...', 'Tipo', 'Criticidad'])
out = G.seccion_esqueleto(doc_dup, prev[REQ], avisos)
cols = (out.get('tabla') or {}).get('columnas') or []
caso('etiqueta duplicada: la segunda no hereda el rol de la primera',
     cols[1] == {'label': 'URS-ID'}, f'quedo: {json.dumps(cols[1], ensure_ascii=False)}')

# -- 5. Etiqueta con acentos distintos: empareja igual (era el defecto viejo) -
avisos = []
doc_sin_acento = dict(doc_reordenado,
                      columnas=['URS-ID', 'Fuente', 'El sistema DEBERA...', 'Tipo', 'CRITICIDAD'])
out = G.seccion_esqueleto(doc_sin_acento, prev[REQ], avisos)
caso('acentos y mayusculas no rompen la correspondencia',
     col_por_label(out, 'CRITICIDAD').get('enum') == ['CRÍTICO', 'ALTO', 'MEDIO'] and
     col_por_label(out, 'El sistema DEBERA...').get('key') == 'enunciado',
     f'avisos: {avisos}')

# -- 6. La etiqueta emitida es SIEMPRE la del documento, no la del contrato --
caso('la etiqueta emitida viene del documento (no se le devuelve el acento)',
     col_por_label(out, 'El sistema DEBERA...') is not None and
     col_por_label(out, 'El sistema DEBERÁ...') is None)

print()
if fallos:
    print(f'RESULTADO: FALLA - {fallos} caso(s)')
    sys.exit(1)
print('RESULTADO: OK - las protecciones del generador se disparan y no de mas')
