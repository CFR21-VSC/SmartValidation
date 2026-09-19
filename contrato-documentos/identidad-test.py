"""Contraejemplos de la asignacion de identidad canonica. No escribe nada.

    python contrato-documentos/identidad-test.py

Los dos primeros casos son los que pidio la Ronda 9/11 explicitamente:

  - omitir una tabla opcional y dejar otra tabla detras: un mapeo por indice
    mas `tipo: tabla` le asigna el rol equivocado sin detectar nada;
  - intercambiar dos subsecciones del mismo tipo sin titulo distinguible: hay
    que exigir evidencia semantica o mandar a revision, no "resolverlo" por la
    posicion nueva.

El resto cubre titulos alternativos, nodos insertados y variantes de columna.
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

I = import_module('identidad')
RAIZ = I.RAIZ

FIXTURE = os.path.join(RAIZ, 'SMART_Validation/js/validation-suite/fixtures/urs-drp-sis-001.json')
BASE = json.load(open(FIXTURE, encoding='utf-8-sig'))

fallos = 0


def caso(nombre, ok, detalle=''):
    global fallos
    print(f'{" OK " if ok else "FALLA"}  {nombre}')
    if not ok:
        fallos += 1
        if detalle:
            print(f'        {detalle}')


def clon():
    return copy.deepcopy(BASE)


def idx_de(asign, clave):
    a = asign.get(clave)
    return a['indice'] if a else None


def problemas_de(problemas, tipo=None, clave=None):
    return [p for p in problemas
            if (tipo is None or p[0] == tipo) and (clave is None or p[1] == clave)]


# -- 0. Linea base: el documento intacto se asigna entero -------------------
a0, p0 = I.asignar(BASE)
caso('base: las 18 claves se asignan sin problemas',
     len(a0) == 18 and not p0, f'{len(a0)} asignadas, problemas={p0}')

# -- 1. Tabla opcional omitida, con otra tabla detras -----------------------
# Se quita `contexto.usuarios.tabla` (opcional). Un mapeo por indice correria
# todo y le daria su rol a la tabla siguiente.
d = clon()
quitado = d['secciones'].pop(7)
a, p = I.asignar(d)
caso('opcional omitida: no se le asigna su rol a la tabla siguiente',
     idx_de(a, 'contexto.usuarios.tabla') is None,
     f'quedo asignada a indice {idx_de(a, "contexto.usuarios.tabla")}')
caso('opcional omitida: las claves posteriores NO se corren',
     a['leyenda']['indice'] == 8 and a['requerimientos.funcionales']['indice'] == 10,
     f'leyenda={idx_de(a, "leyenda")}, funcionales={idx_de(a, "requerimientos.funcionales")}')
caso('opcional omitida: no se reporta como falta (es opcional)',
     not problemas_de(p, 'FALTA', 'contexto.usuarios.tabla'), f'{p}')

# -- 2. Dos subsecciones del mismo tipo intercambiadas ----------------------
# Con sus titulos, la evidencia semantica las distingue y el intercambio se
# refleja en el indice: la clave viaja con el contenido, no con el lugar.
d = clon()
d['secciones'][5], d['secciones'][6] = d['secciones'][6], d['secciones'][5]
a, p = I.asignar(d)
caso('subsecciones intercambiadas CON titulo: la clave sigue al contenido',
     idx_de(a, 'contexto.general') == 6 and idx_de(a, 'contexto.usuarios') == 5,
     f'general={idx_de(a, "contexto.general")}, usuarios={idx_de(a, "contexto.usuarios")}')

# Sin ningun titulo distinguible, el contrato NO puede decidir: debe reportar.
d = clon()
for i in (5, 6):
    d['secciones'][i].pop('titulo', None)
    d['secciones'][i].pop('subtitulo', None)
a, p = I.asignar(d)
# Desde la Ronda 13 el diagnostico es mas preciso: no hay empate de evidencia,
# directamente no hay evidencia. Se reporta SIN EVIDENCIA + FALTA y no se asigna.
caso('subsecciones sin titulo: se reporta y no se resuelve por posicion',
     (problemas_de(p, 'SIN EVIDENCIA', 'contexto.general') or
      problemas_de(p, 'AMBIGUO', 'contexto.general')) and
     idx_de(a, 'contexto.general') is None and idx_de(a, 'contexto.usuarios') is None,
     f'general={idx_de(a, "contexto.general")}, problemas={p}')

# -- 3. Titulo alternativo declarado ----------------------------------------
d = clon()
d['secciones'][17]['titulo'] = 'CONFORMIDAD DE REVISIÓN Y APROBACIÓN'
a, p = I.asignar(d)
caso('titulo alternativo declarado: misma clave `firmas`',
     idx_de(a, 'firmas') == 17, f'firmas={idx_de(a, "firmas")}')

d = clon()
d['secciones'][0]['titulo'] = 'OBJETIVO'
a, p = I.asignar(d)
caso('titulo alternativo `OBJETIVO`: misma clave `proposito`',
     idx_de(a, 'proposito') == 0)

# -- 4. Titulo NO declarado: no se acepta en silencio -----------------------
d = clon()
d['secciones'][17]['titulo'] = 'CIERRE DEL DOCUMENTO'
a, p = I.asignar(d)
caso('titulo no declarado: igual se asigna por tipo, pero sin credito de titulo',
     idx_de(a, 'firmas') == 17 and
     not any('titulo declarado' in e for e in a['firmas']['evidencia']),
     f'evidencia={a.get("firmas", {}).get("evidencia")}')

# -- 5. Nodo insertado que no pertenece al contrato -------------------------
d = clon()
d['secciones'].insert(3, {'tipo': 'texto', 'titulo': 'NOTA DEL EDITOR', 'contenido': 'x'})
a, p = I.asignar(d)
caso('nodo insertado: se reporta SIN ASIGNAR y no desplaza a nadie',
     bool(problemas_de(p, 'SIN ASIGNAR')) and idx_de(a, 'definiciones') == 4,
     f'definiciones={idx_de(a, "definiciones")}, problemas={problemas_de(p, "SIN ASIGNAR")}')

# -- 6. Columnas fuera de toda variante declarada ---------------------------
d = clon()
d['secciones'][11]['columnas'] = ['ID', 'Origen', 'Enunciado', 'T', 'C']
a, p = I.asignar(d)
caso('columnas no declaradas: se reporta FALTA, no se asigna a ciegas',
     idx_de(a, 'requerimientos.funcionales') is None and
     bool(problemas_de(p, 'FALTA', 'requerimientos.funcionales')),
     f'funcionales={idx_de(a, "requerimientos.funcionales")}')

# -- 7. Seccion obligatoria ausente -----------------------------------------
d = clon()
d['secciones'] = [s for i, s in enumerate(d['secciones']) if i != 3]
a, p = I.asignar(d)
caso('obligatoria ausente: se reporta FALTA',
     bool(problemas_de(p, 'FALTA', 'definiciones')), f'{p}')

# -- 8. Estabilidad entre documentos: misma clave, distinto texto -----------
REAL = 'C:/Users/fjbon/OneDrive/Escritorio/EMQC_Emara/Proyecto demo 1 - Emara/ai-docs/URS-EMQC-001.json'
if os.path.exists(REAL):
    ar, pr = I.asignar(json.load(open(REAL, encoding='utf-8-sig')))
    caso('el URS real asigna las 18 claves sin ambiguedad',
         len(ar) == 18 and not pr, f'{len(ar)} asignadas, problemas={pr}')
    caso('`firmas` es la misma clave pese a titulos distintos',
         a0['firmas']['titulo'] != ar['firmas']['titulo'],
         'los titulos deberian diferir entre documentos')
else:
    print('(no se encontro el URS real; se omiten los casos 8)')

# == Casos de la Ronda 13 ===================================================
# El asignador voraz declaraba completo un rol obligatorio usando el contenido
# de otro: al borrar "5.2 USUARIOS DEL SISTEMA", contexto.usuarios se quedaba
# con "5.3 INTEGRACIONES..." usando solo el tipo, y no reportaba nada.

def sin_indice(i):
    d = clon()
    d['secciones'].pop(i)
    return d


d = sin_indice(6)                      # 5.2 USUARIOS DEL SISTEMA
a, p = I.asignar(d)
caso('R13: falta una subseccion obligatoria -> no se la completa con otra',
     a.get('contexto.usuarios') is None and bool(problemas_de(p, 'FALTA', 'contexto.usuarios')),
     f'usuarios={a.get("contexto.usuarios")}, problemas={p}')
caso('R13: el contenido de Integraciones sigue siendo de Integraciones',
     a.get('contexto.integraciones', {}).get('titulo', '').endswith('OTROS SISTEMAS'),
     f'integraciones={a.get("contexto.integraciones")}')

# Mismo caso con las definiciones del contrato reordenadas: el resultado no
# puede depender de cual rol se evalua primero.
import copy as _copy
contrato_revuelto = _copy.deepcopy(I.URS_V3)
contrato_revuelto['secciones'] = list(reversed(contrato_revuelto['secciones']))
a2, p2 = I.asignar(d, contrato_revuelto)
caso('R13: el resultado no depende del orden de las definiciones',
     {k: v['indice'] for k, v in a2.items()} == {k: v['indice'] for k, v in a.items()},
     f'difieren: {set(a2) ^ set(a)}')

# Cada subseccion requerida, borrada de a una.
for i, clave in ((5, 'contexto.general'), (6, 'contexto.usuarios')):
    a3, p3 = I.asignar(sin_indice(i))
    caso(f'R13: borrando {clave} se reporta FALTA y no se reasigna',
         a3.get(clave) is None and bool(problemas_de(p3, 'FALTA', clave)),
         f'{clave}={a3.get(clave)}')

# Una seccion de texto comercial en el lugar de Proposito: tipo compatible,
# identidad ninguna. Antes se aceptaba solo por el tipo.
d = clon()
d['secciones'][0] = {'tipo': 'texto', 'titulo': 'NUESTRA PROPUESTA DE VALOR',
                     'contenido': 'Somos lideres en el mercado.'}
a, p = I.asignar(d)
caso('R13: texto comercial en lugar de Proposito -> FALTA, no se acepta por tipo',
     a.get('proposito') is None and bool(problemas_de(p, 'FALTA', 'proposito')),
     f'proposito={a.get("proposito")}, problemas={problemas_de(p, "FALTA")}')

# El parentesco se comprueba, no se copia del contrato.
a, p = I.asignar(BASE)
caso('R13: el parentesco se informa como verificado, no solo propuesto',
     all('padreVerificado' in v for v in a.values()) and
     a['contexto.general']['padreVerificado'] is not None,
     f'{a["contexto.general"]}')

d = clon()
d['secciones'][5]['padre'] = 'referencias'
a, p = I.asignar(d)
caso('R13: un padre declarado que contradice al contrato se reporta',
     bool(problemas_de(p, 'PADRE', 'contexto.general')), f'{problemas_de(p, "PADRE")}')

# Un id explicito que nombra otra clave no se reasigna en silencio.
d = clon()
d['secciones'][0]['id'] = 'referencias'
a, p = I.asignar(d)
caso('R13: un id explicito de otra clave no se reasigna en silencio',
     a.get('proposito') is None, f'proposito={a.get("proposito")}')

print()
if fallos:
    print(f'RESULTADO: FALLA - {fallos} caso(s)')
    sys.exit(1)
print('RESULTADO: OK - la identidad se asigna por evidencia, y lo indistinguible se reporta')
