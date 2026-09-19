"""Cadena REAL: asignador -> conversion compartida -> validador 3.1 -> consumidores.

    python -X utf8 contrato-documentos/cadena-test.py

Que cambia respecto de la version anterior
------------------------------------------
La anterior calculaba los IDs y la numeracion del ORIGINAL, llamaba al asignador
(que no modifica nada) y volvia a medir el MISMO original. Eso acreditaba que
asignar no muta, y nada mas: no tocaba la conversion candidata, que es lo que se
entrega. Ademas reimplementaba el numerador y el extractor de IDs, con reglas
distintas de las de produccion (el numerador real respeta los overrides enteros
de `numero` y no excluye las cajas; la copia hacia lo contrario).

Ahora:

  1. se convierte con `conversion.convertir`, la MISMA funcion que usa el
     generador de candidatos;
  2. la asignacion se compara con `mapa-esperado.json`, escrito a mano;
  3. el convertido se valida contra el esqueleto candidato 3.1;
  4. se compara ORIGINAL contra CONVERTIDO con los consumidores de produccion:
     `tracer._extract_urs_ids` para los IDs y `VS.shared.createSectionNumberer`
     para la numeracion, mas una proyeccion estructural de lo que produce el
     renderer del tipo ANTES del layout;
  5. aparte, se comprueba que el documento de origen no haya cambiado.

Si falta un documento del perfil, la bateria FALLA: un perfil incompleto no
puede dar el mismo OK que la cadena completa.
"""
import json
import os
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from importlib import import_module

I = import_module('identidad')
convertir = import_module('conversion').convertir
RAIZ = I.RAIZ

sys.path.insert(0, os.path.join(RAIZ, 'analytics-service'))
try:
    from app import tracer
except Exception as e:
    tracer = None
    print('AVISO: no se pudo importar el extractor de produccion (%s)' % e)

ESPERADO = json.load(open(os.path.join(AQUI, 'mapa-esperado.json'), encoding='utf-8-sig'))
CANDIDATO = {'URS': 'contrato-documentos/urs.skeleton.v3.1.candidato.json',
             'VP': 'contrato-documentos/vp.skeleton.v3.1.candidato.json'}

fallos = 0
sin_esqueleto = []


def caso(nombre, ok, detalle=''):
    global fallos
    print('%s  %s' % (' OK ' if ok else 'FALLA', nombre))
    if not ok:
        fallos += 1
        if detalle:
            print('        %s' % detalle)


def ruta(p):
    return p if (os.path.isabs(p) or ':' in p[:3]) else os.path.join(RAIZ, p)


def consumidores(*archivos):
    """Numeracion y proyeccion del renderer, con el codigo de produccion."""
    r = subprocess.run(['node', os.path.join(AQUI, '_consumidores.cjs')] + list(archivos),
                       capture_output=True, text=True, encoding='utf-8', cwd=RAIZ)
    if r.returncode != 0:
        raise SystemExit('los consumidores fallaron:\n%s' % r.stderr[:800])
    return json.loads(r.stdout)


def validar_con_node(esqueleto, instancia):
    r = subprocess.run(['node', os.path.join(AQUI, 'validar.cjs'), esqueleto, instancia],
                       capture_output=True, text=True, encoding='utf-8', cwd=RAIZ)
    return r.returncode, (r.stdout or '')


for etiqueta, info in ESPERADO.items():
    if etiqueta.startswith('_'):
        continue
    p = ruta(info['archivo'])
    print('\n-- %s (%s)' % (etiqueta, info['tipo']))
    if not os.path.exists(p):
        caso('el documento del perfil existe', False, 'falta %s' % info['archivo'])
        continue

    doc = json.load(open(p, encoding='utf-8-sig'))
    antes = json.dumps(doc, ensure_ascii=False, sort_keys=True)
    contrato = I.CONTRATOS[info['tipo']]
    esq = CANDIDATO.get(info['tipo'])
    if info.get('sinEsqueleto') or not esq:
        # Todavia no hay esqueleto publicado para este tipo: se corre toda la
        # cadena menos la validacion, y queda dicho. No es el mismo OK.
        esq = None

    # 1 y 2. Conversion compartida + mapa escrito a mano.
    inst, asign, problemas = convertir(doc, contrato, info['tipo'],
                                       os.path.basename(esq) if esq else '(sin esqueleto)',
                                       I.asignar)
    obtenido = {}
    for k, a in asign.items():
        if a.get('repetible'):
            for o in a['ocurrencias']:
                obtenido[str(o['indice'])] = k
        else:
            obtenido[str(a['indice'])] = k
    difieren = dict((i, (info['mapa'].get(i), obtenido.get(i)))
                    for i in set(info['mapa']) | set(obtenido)
                    if info['mapa'].get(i) != obtenido.get(i))
    caso('la asignacion coincide con el mapa escrito a mano', not difieren, str(difieren))
    caso('la asignacion no reporta problemas', not problemas, str(problemas[:3]))

    # Parentesco: se distingue la comprobacion fuerte de la debil por orden.
    debiles = [k for k, a in asign.items() if a.get('padreVerificado') == 'porOrden']
    malos = [k for k, a in asign.items() if a.get('padreVerificado') is False]
    caso('ningun parentesco quedo contradicho', not malos, str(malos))
    if debiles:
        print('        parentesco verificado SOLO por orden (evidencia debil), %d: %s'
              % (len(debiles), ', '.join(debiles)))
        print('        justificacion: el mapa revisado a mano confirma esos casos')

    # 3. El convertido valida contra el candidato 3.1.
    f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
    json.dump(inst, f, ensure_ascii=False)
    f.close()
    tmp = f.name
    f2 = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
    json.dump(doc, f2, ensure_ascii=False)
    f2.close()
    tmp_orig = f2.name
    try:
        if esq is None:
            print('        SIN VALIDAR: este tipo todavia no tiene esqueleto publicado.')
            print('        Se corre el resto de la cadena, pero NO es el mismo OK.')
            sin_esqueleto.append(etiqueta)
        else:
            rc, salida = validar_con_node(ruta(esq), tmp)
            permitidas = set((info.get('esperaErrores') or {}).get('reglas') or [])
            lineas = [l.strip() for l in salida.splitlines() if l.strip().startswith('[')]
            reglas = set(l.split(']')[0][1:] for l in lineas)
            caso('el convertido valida contra el candidato 3.1'
                 + ((' (salvo %s)' % ', '.join(sorted(permitidas))) if permitidas else ''),
                 not (reglas - permitidas), '; '.join(lineas[:4]))
            if permitidas:
                caso('la excepcion declarada (%s) esta presente' % ', '.join(sorted(permitidas)),
                     bool(reglas & permitidas),
                     'no ocurrio: si ya no aplica, hay que sacarla del mapa')

        # 4. ORIGINAL contra CONVERTIDO, con los consumidores de produccion.
        a, b = consumidores(tmp_orig, tmp)
        caso('el renderer de produccion no falla en ninguno de los dos',
             not a['error'] and not b['error'], '%s / %s' % (a['error'], b['error']))
        caso('la numeracion es identica (numerador real de produccion)',
             a['numeracion'] == b['numeracion'],
             '%s\n        %s' % (a['numeracion'], b['numeracion']))
        if a['proyeccion'] is not None and b['proyeccion'] is not None:
            dif = [(i, x, y) for i, (x, y) in
                   enumerate(zip(a['proyeccion'], b['proyeccion'])) if x != y][:3]
            caso('la salida del renderer es identica (%d nodos proyectados)'
                 % len(a['proyeccion']),
                 a['proyeccion'] == b['proyeccion'],
                 '%d vs %d nodos; %s' % (len(a['proyeccion']), len(b['proyeccion']), dif))
    finally:
        os.unlink(tmp)
        os.unlink(tmp_orig)

    if tracer:
        ia, ib = tracer._extract_urs_ids(doc), tracer._extract_urs_ids(inst)
        caso('los IDs son identicos con el extractor de produccion (%d IDs)' % len(ia),
             ia == ib, '%d vs %d' % (len(ia), len(ib)))

    # 5. Aparte: el original no se toco.
    caso('el documento de origen no se modifico',
         json.dumps(doc, ensure_ascii=False, sort_keys=True) == antes)

    # Campos legacy: todo lo que no es identidad tiene que llegar igual.
    IDENTIDAD = set(['id', 'clase', 'padre', 'obligatoriedad'])
    perdidos = []
    for o, n in zip(doc.get('secciones') or [], inst.get('secciones') or []):
        for k, v in o.items():
            if k in IDENTIDAD:
                continue
            if json.dumps(n.get(k), ensure_ascii=False, sort_keys=True) != \
               json.dumps(v, ensure_ascii=False, sort_keys=True):
                perdidos.append(k)
    caso('los campos legacy de las secciones llegan intactos', not perdidos,
         str(sorted(set(perdidos))))

print()
if sin_esqueleto:
    print('PERFIL PARCIAL: %d documento(s) corrieron SIN validacion de contrato '
          '(no hay esqueleto para su tipo): %s' % (len(sin_esqueleto), ', '.join(sin_esqueleto)))
if fallos:
    print('RESULTADO: FALLA - %d caso(s)' % fallos)
    sys.exit(1)
print('RESULTADO: OK - cadena real verificada con los consumidores de produccion')
