"""Migracion ADITIVA a fase 1 del contrato: agrega id / clase / padre.

    python contrato-documentos/migrar-fase1.py                 # regenera los ejemplos
    python contrato-documentos/migrar-fase1.py --check         # solo verifica, no escribe
    python contrato-documentos/migrar-fase1.py --con-resumen   # ademas completa requirementsSummary

El paso aditivo agrega SOLO id/clase/padre. Completar `requirementsSummary`
toca un campo de raiz, asi que es otro paso: va detras de --con-resumen y
muestra su propio diff.

NO toca ningun campo existente (tipo, titulo, filas, numero...). Por eso el
renderer y el numerador legacy, que no conocen `clase` ni `padre`, producen
exactamente la misma salida — lo verifica contrato-documentos/numeracion-test.cjs.

Reglas de parentesco
--------------------
Un elemento es BLOQUE (no numera, cuelga del anterior) si:
  - no tiene titulo, o
  - declara `numero: null` explicito, o
  - su tipo es una caja (`caja-*`)

El resto son SECCIONES. Una `subseccion` cuelga de la ultima seccion RAIZ; las
cajas y tablas sin titulo cuelgan de la ultima seccion (raiz o sub) abierta.

La regla de las cajas es la que corrige el defecto senalado en la revision: una
caja con titulo ("Criterio de aceptacion IQ") se tomaba como seccion raiz y las
subsecciones siguientes (OQ, PQ) terminaban colgando de ella en vez de su
seccion madre real.
"""
import json
import io
import os
import re
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def slug(t):
    t = unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')[:30] or 'bloque'


def es_caja(tipo):
    return isinstance(tipo, str) and tipo.startswith('caja-')


def migrar(secs):
    ultima_raiz = None       # ultima seccion de nivel raiz
    ultima_seccion = None    # ultima seccion abierta (raiz o subseccion)
    usados = {}
    out = []
    for s in secs:
        tit = (s.get('titulo') or '').strip()
        tipo = s.get('tipo')
        tiene_numero_null = ('numero' in s and s['numero'] is None)

        if tipo == 'subseccion':
            clase, padre = 'seccion', ultima_raiz
            base = slug(re.sub(r'^\d+(\.\d+)*\s*', '', tit))
        elif not tit or tiene_numero_null or es_caja(tipo):
            # Bloque: no numera y pertenece al elemento anterior.
            clase, padre = 'bloque', (ultima_seccion or ultima_raiz)
            base = slug(tit) if tit else ((padre or 'x') + '-b')
        else:
            clase, padre = 'seccion', None
            base = slug(tit)

        n = usados.get(base, 0)
        usados[base] = n + 1
        sid = base if n == 0 else f'{base}-{n + 1}'

        nuevo = {'id': sid, 'clase': clase}
        if padre:
            nuevo['padre'] = padre
        nuevo.update(s)          # el original manda, intacto
        out.append(nuevo)

        if clase == 'seccion':
            ultima_seccion = sid
            if not padre:
                ultima_raiz = sid
    return out


def _texto(celda):
    """Valor semantico de una celda: el texto, venga plano o como celda rica."""
    if isinstance(celda, dict):
        return str(celda.get('text') or '').strip()
    return str(celda or '').strip()


def resumen_desde_filas(secs):
    """Calcula requirementsSummary CONTANDO las filas del propio documento.

    El skill generador (claude-desktop-skills/urs-generator.md) lo declara
    obligatorio y dice explicitamente que los conteos se hacen "despues de
    escribir la tabla, no estimados". El fixture historico trae el campo vacio
    ({}), de una epoca anterior a ese requisito, y por eso el validador lo
    rechaza con razon.

    No se inventa ningun numero: todo sale de las filas. Cada valor es
    reproducible recontando el documento.
    """
    def filas_de(sid):
        for s in secs:
            if s.get('id') == sid:
                return [f for f in (s.get('filas') or []) if isinstance(f, list)]
        return []

    fun = filas_de('requerimientos-funcionales')
    nof = filas_de('requerimientos-no-funcionales')
    todas = fun + nof
    tipos = [_texto(f[3]) for f in todas if len(f) > 3]
    crits = [_texto(f[4]) for f in todas if len(f) > 4]
    return {
        'total': len(todas),
        'functional': len(fun),
        'nonFunctional': len(nof),
        'mandatory': tipos.count('M'),
        'desirable': tipos.count('D'),
        'critical': crits.count('CRÍTICO'),
        'high': crits.count('ALTO'),
        'medium': crits.count('MEDIO'),
        'functionalIds': [_texto(f[0]) for f in fun],
        'nonFunctionalIds': [_texto(f[0]) for f in nof],
    }


def cargar(origen):
    tipo, ruta, path_interno = origen
    if path_interno:
        d = json.load(open(os.path.join(RAIZ, ruta), encoding='utf-8-sig'))
        for x in d['documents']:
            c = x.get('content', {}).get('data')
            if isinstance(c, dict) and c.get('type') == tipo:
                return c
        raise SystemExit(f'no se encontro {tipo} en {ruta}')
    return json.load(open(os.path.join(RAIZ, ruta), encoding='utf-8-sig'))


ORIGENES = [
    ('URS', 'SMART_Validation/js/validation-suite/fixtures/urs-drp-sis-001.json', False,
     'contrato-documentos/ejemplos/urs.instancia.valida.json'),
    ('VP', 'proj_1786639073632_2h83bp.project.json', True,
     'contrato-documentos/ejemplos/vp.instancia.valida.json'),
]


def main():
    check = '--check' in sys.argv
    con_resumen = '--con-resumen' in sys.argv
    problemas = 0
    for tipo, ruta, interno, destino in ORIGENES:
        doc = cargar((tipo, ruta, interno))
        secs = migrar(doc['secciones'])

        # Verificacion dura: ningun campo original de las SECCIONES puede cambiar.
        # (El unico campo de raiz que se completa es requirementsSummary, y solo
        # cuando llega vacio; se informa aparte mas abajo.)
        alterados = []
        for o, n in zip(doc['secciones'], secs):
            for k, v in o.items():
                if json.dumps(n.get(k), ensure_ascii=False) != json.dumps(v, ensure_ascii=False):
                    alterados.append((k, (o.get('titulo') or '')[:30]))
        huerfanos = [s['id'] for s in secs if s['clase'] == 'bloque' and not s.get('padre')]

        inst = dict(doc)
        inst['contratoVersion'] = '3.0-aditiva'
        inst['esqueleto'] = {'tipo': tipo, 'version': '3.0',
                             'archivo': f'{tipo.lower()}.skeleton.v3.json'}
        inst['secciones'] = secs

        # Completar el resumen NO es parte de la migracion aditiva: toca un
        # campo de raiz del documento. Va detras de una bandera explicita y con
        # su propio diff, para que el paso aditivo siga siendo solo id/clase/padre.
        resumen_completado = None
        if con_resumen and tipo == 'URS' and not (doc.get('requirementsSummary') or {}):
            resumen_completado = resumen_desde_filas(secs)
            inst['requirementsSummary'] = resumen_completado

        print(f'{tipo}: {len(secs)} elementos | '
              f'{sum(1 for s in secs if s["clase"] == "seccion")} secciones | '
              f'{sum(1 for s in secs if s["clase"] == "bloque")} bloques')
        if alterados:
            print(f'   CAMPOS ORIGINALES ALTERADOS: {alterados[:4]}')
            problemas += 1
        if huerfanos:
            print(f'   BLOQUES SIN PADRE: {huerfanos}')
            problemas += 1
        # Igualdad de RAIZ: todo campo del documento original debe llegar
        # identico, salvo los tres que esta migracion declara que agrega. Antes
        # solo se comprobaban los campos de las secciones, asi que un cambio de
        # raiz (como completar el resumen) pasaba sin quedar comprobado.
        AGREGA_RAIZ = {'contratoVersion', 'esqueleto', 'secciones'}
        if resumen_completado:
            AGREGA_RAIZ = AGREGA_RAIZ | {'requirementsSummary'}
        raiz_alterada = [k for k, v in doc.items()
                         if k not in AGREGA_RAIZ and
                         json.dumps(inst.get(k), ensure_ascii=False, sort_keys=True) !=
                         json.dumps(v, ensure_ascii=False, sort_keys=True)]
        raiz_perdida = [k for k in doc if k not in inst]
        if raiz_alterada or raiz_perdida:
            print(f'   CAMPOS DE RAIZ ALTERADOS: {raiz_alterada} | PERDIDOS: {raiz_perdida}')
            problemas += 1

        if resumen_completado:
            r = resumen_completado
            print(f'   [--con-resumen] DIFF DE RAIZ, fuera del paso aditivo:')
            print(f'     - requirementsSummary: {json.dumps(doc.get("requirementsSummary"), ensure_ascii=False)}')
            print(f'     + requirementsSummary: total {r["total"]} = {r["functional"]} func + '
                  f'{r["nonFunctional"]} nofunc = {r["mandatory"]}M + {r["desirable"]}D '
                  f'= {r["critical"]}crit + {r["high"]}alto + {r["medium"]}medio, '
                  f'{len(r["functionalIds"])}+{len(r["nonFunctionalIds"])} IDs')
            print(f'     (contado de las filas del propio documento; reproducible recontando)')
        if not check:
            io.open(os.path.join(RAIZ, destino), 'w', encoding='utf-8', newline='\n').write(
                json.dumps(inst, ensure_ascii=False, indent=2))
    if check:
        print('\n(--check: no se escribio nada)')
    return 1 if problemas else 0


if __name__ == '__main__':
    sys.exit(main())
