"""Genera el contrato CANDIDATO v3.1 con identidad canonica.

    python contrato-documentos/candidato-v31.py            # escribe los ARTEFACTOS CANDIDATOS
    python contrato-documentos/candidato-v31.py --check    # no escribe; compara con lo persistido

"En seco" seria impreciso: sin banderas SI escribe, pero solo artefactos
candidatos (`*.candidato.json`), nunca el contrato publicado ni el corpus.
`--check` es el que no escribe nada.

Que hace
--------
1. Asigna identidad canonica a cada documento conocido y emite el MAPA
   origen -> clave con su evidencia, faltantes y ambiguedades.
2. Construye `*.skeleton.v3.1.candidato.json` a partir del 3.0 publicado:
   las secciones pasan a llamarse por su clave canonica, los `padre` tambien, y
   las tablas pasan a declarar VARIANTES de columnas, cada una con sus roles.
3. Construye las instancias candidatas con los ids canonicos.

Que NO hace
-----------
No toca el contrato 3.0 publicado ni los documentos del corpus. El 3.1 es un
candidato: se mira con diff y se publica aparte, con version propia.

Por que variantes de columnas
-----------------------------
Asignar 18 claves no implica que el documento valide completo. El URS real trae
tres columnas en Responsabilidades donde el fixture trae dos, y el enunciado se
titula "El sistema/proveedor DEBERA...". Si el contrato declara una sola forma
de columnas, uno de los dos documentos no valida. Cada variante lleva sus
propios roles (key, rol, enum, requerido), no una lista de etiquetas suelta.
"""
import io
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

I = import_module('identidad')
convertir = import_module('conversion').convertir
RAIZ = I.RAIZ

FUENTES = {
    'URS': {
        'esqueleto': 'contrato-documentos/urs.skeleton.v3.json',
        'candidato': 'contrato-documentos/urs.skeleton.v3.1.candidato.json',
        'documentos': [
            ('fixture', 'SMART_Validation/js/validation-suite/fixtures/urs-drp-sis-001.json'),
            ('real', 'C:/Users/fjbon/OneDrive/Escritorio/EMQC_Emara/Proyecto demo 1 - Emara/ai-docs/URS-EMQC-001.json'),
            ('plantilla', 'SMART_Validation/js/validation-suite/fixtures/urs-template-vacio.json'),
        ],
        'instancia': ('contrato-documentos/ejemplos/urs.instancia.valida.json',
                      'contrato-documentos/ejemplos/urs.instancia.v31.candidata.json'),
    },
    'VP': {
        'esqueleto': 'contrato-documentos/vp.skeleton.v3.json',
        'candidato': 'contrato-documentos/vp.skeleton.v3.1.candidato.json',
        'documentos': [
            ('real', 'contrato-documentos/ejemplos/vp.instancia.valida.json'),
            ('drp-sis', 'SMART_Validation/js/validation-suite/fixtures/vp-drp-sis-001.json'),
            ('plantilla', 'SMART_Validation/js/validation-suite/fixtures/vp-template-vacio.json'),
        ],
        'instancia': ('contrato-documentos/ejemplos/vp.instancia.valida.json',
                      'contrato-documentos/ejemplos/vp.instancia.v31.candidata.json'),
    },
}


def ruta(p):
    return p if (os.path.isabs(p) or ':' in p[:3]) else os.path.join(RAIZ, p)


def slug(t):
    t = unicodedata.normalize('NFKD', str(t or '')).encode('ascii', 'ignore').decode()
    t = re.sub(r'[^a-zA-Z0-9]+', ' ', t).strip().split()
    if not t:
        return 'col'
    return t[0].lower() + ''.join(w.capitalize() for w in t[1:])


def columnas_por_label(esq30, slug_de_clave=None):
    """Columnas curadas del 3.0 para heredar roles.

    Devuelve (global, porSeccion). La busqueda tiene que ser POR SECCION primero:
    "URS-ID" aparece en la tabla funcional y en la no funcional con distinto
    `idClase` (URS y URS-NF). Heredando por etiqueta global, la no funcional se
    quedaba con el patron de la funcional y sus cinco IDs quedaban invalidos.
    """
    glob, por_sec = {}, {}
    for s in esq30.get('secciones', []):
        d = {}
        for c in (s.get('tabla') or {}).get('columnas') or []:
            if c.get('label'):
                glob.setdefault(I.norm(c['label']), c)
                d[I.norm(c['label'])] = c
        por_sec[s['id']] = d
    return glob, por_sec


def variantes_de(defi, curadas, avisos, clave, propias=None):
    """Convierte las variantes de etiquetas del contrato de identidad en
    variantes con roles. Una etiqueta sin equivalente en el 3.0 se emite con
    una key derivada y queda AVISADA: es una propuesta, no un rol aprobado."""
    cols = defi.get('columnas')
    if not cols:
        return None
    if isinstance(cols[0], str):
        cols = [cols]
    HEREDABLES = ('key', 'rol', 'idClase', 'celda', 'ancho', 'enum', 'requerido')
    salida = []
    for v in cols:
        cvs = []
        for entrada in v:
            label = I.etiqueta_de(entrada)
            declarada = entrada.get('key') if isinstance(entrada, dict) else None
            # Primero la propia seccion, despues el resto del contrato.
            base = (propias or {}).get(I.norm(label)) or curadas.get(I.norm(label))
            if base is None and declarada:
                # La variante declara a que columna semantica corresponde: se
                # heredan los roles de esa columna en vez de inventar una key
                # nueva, que dejaria a los extractores sin donde mirar.
                base = (next((c for c in (propias or {}).values() if c.get('key') == declarada), None)
                        or next((c for c in curadas.values() if c.get('key') == declarada), None))
            if base:
                col = {k: base[k] for k in HEREDABLES if k in base}
                col['label'] = label
            else:
                col = {'label': label, 'key': declarada or slug(label)}
                if not declarada:
                    col['_revisar'] = 'key derivada de la etiqueta, sin rol'
                    avisos.append(f'{clave}: la columna "{label}" no existe en el 3.0 ni '
                                  f'declara key; se propone "{col["key"]}" sin rol — revisar')
            cvs.append(col)
        salida.append({'columnas': cvs})
    return salida


def main():
    check = '--check' in sys.argv
    problemas = 0

    for tipo, cfg in FUENTES.items():
        contrato = I.CONTRATOS[tipo]
        esq30 = json.load(open(ruta(cfg['esqueleto']), encoding='utf-8-sig'))
        curadas, curadas_sec = columnas_por_label(esq30)
        avisos = []

        print(f'\n=== {tipo} ===')

        # -- 1. Mapa origen -> clave, con evidencia -------------------------
        mapas = {}
        for etiqueta, rd in cfg['documentos']:
            if not os.path.exists(ruta(rd)):
                print(f'  ({etiqueta}: no existe {rd})')
                continue
            doc = json.load(open(ruta(rd), encoding='utf-8-sig'))
            asign, probs = I.asignar(doc, contrato)
            mapas[etiqueta] = {
                'archivo': rd,
                'asignaciones': {k: {'indice': a['indice'], 'evidencia': a['evidencia'],
                                     'tituloOrigen': a['titulo'],
                                     'padre': a['padreContrato'],
                                     'padreVerificado': a['padreVerificado']}
                                 for k, a in asign.items()},
                'faltantes': [p for p in probs if p[0] == 'FALTA'],
                'ambiguedades': [p for p in probs if p[0] in ('AMBIGUO', 'SIN EVIDENCIA', 'DISPUTADO')],
                'otros': [p for p in probs if p[0] not in ('FALTA', 'AMBIGUO', 'SIN EVIDENCIA', 'DISPUTADO')],
            }
            m = mapas[etiqueta]
            print(f'  {etiqueta:8s} {len(asign)}/{len(contrato["secciones"])} claves | '
                  f'{len(m["faltantes"])} faltante(s) | {len(m["ambiguedades"])} ambiguedad(es) | '
                  f'{len(m["otros"])} otro(s)')
            if probs:
                problemas += 1
                for p in probs[:5]:
                    print(f'     {p[0]}: {p[1]} - {p[2]}')

        # -- 2. Esqueleto candidato 3.1 -------------------------------------
        por_clave = {s['id']: s for s in esq30.get('secciones', [])}
        # El 3.0 nombra por slug; se mapea slug -> clave usando el primer mapa.
        primer = next(iter(mapas.values()), None)
        idx2clave = {}
        if primer:
            idx2clave = {a['indice']: k for k, a in primer['asignaciones'].items()}
        slug2clave = {}
        for i, s in enumerate(esq30.get('secciones', [])):
            if i in idx2clave:
                slug2clave[s['id']] = idx2clave[i]

        nuevas = []
        for defi in contrato['secciones']:
            clave = defi['clave']
            viejo = por_clave.get(next((sl for sl, cl in slug2clave.items() if cl == clave), ''), {})
            sec = {'id': clave,
                   'clase': 'bloque' if defi.get('padre') and not defi.get('tipo') == 'subseccion'
                            else ('seccion' if not defi.get('padre') or defi.get('tipo') == 'subseccion' else 'bloque'),
                   'tipo': defi.get('tipo'),
                   'obligatoriedad': 'requerida' if defi.get('obligatoria') else 'opcional'}
            if defi.get('padre'):
                sec['padre'] = defi['padre']
            if defi.get('titulos'):
                sec['titulosPermitidos'] = defi['titulos']
            if 'admiteNoAplica' in viejo:
                sec['admiteNoAplica'] = viejo['admiteNoAplica']
            slug_prop = next((sl for sl, cl in slug2clave.items() if cl == clave), '')
            vs = variantes_de(defi, curadas, avisos, clave, curadas_sec.get(slug_prop))
            if vs or (viejo.get('tabla')):
                tabla = {k: v for k, v in (viejo.get('tabla') or {}).items()
                         if k in ('filaForma', 'permiteAgrupacion', 'minFilasDatos', 'sinColumnas')}
                if vs:
                    tabla['variantes'] = vs
                elif defi.get('sinColumnas') or (viejo.get('tabla') or {}).get('sinColumnas'):
                    # Sin encabezado VISIBLE no es sin contrato de FILA. El 3.0
                    # declaraba las columnas de esta tabla (key/celda/ancho) y
                    # aca se perdian: quedaba una tabla sin aridad ni roles que
                    # ninguna regla podia comprobar.
                    tabla['sinColumnas'] = True
                    prev_cols = (viejo.get('tabla') or {}).get('columnas') or []
                    if prev_cols:
                        tabla['columnas'] = prev_cols
                sec['tabla'] = tabla
            if defi.get('contieneTexto'):
                sec['contieneTexto'] = defi['contieneTexto']
            nuevas.append(sec)

        cand = dict(esq30)
        cand['contrato'] = '3.1'
        cand['_estado'] = 'CANDIDATO — no publicado. El 3.0 sigue vigente sin cambios.'
        cand['_cambiosRespectoDe30'] = [
            'los id de seccion son claves canonicas asignadas, no slugs del titulo',
            'los padre usan esas claves',
            'las tablas declaran variantes de columnas, cada una con sus roles',
            'los titulos permitidos se declaran por seccion',
        ]
        cand['identidad'] = {'version': contrato['version'], 'orden': contrato['orden']}
        cand['secciones'] = nuevas

        # requirementsSummary: las secciones referidas pasan a claves canonicas.
        rr = cand.get('resumenRequerido')
        if rr and rr.get('derivado'):
            for campo, d in (rr['derivado'].get('campos') or {}).items():
                if isinstance(d, dict) and d.get('secciones'):
                    d['secciones'] = [slug2clave.get(x, x) for x in d['secciones']]

        for a in avisos:
            print(f'  aviso | {a}')
        if avisos:
            problemas += 1

        # -- 3. Instancia candidata, con la conversion COMPARTIDA ------------
        # La misma funcion que usa la prueba de cadena. Con una copia local
        # aca, la prueba acreditaba su propia conversion y no la que se entrega.
        origen, destino = cfg['instancia']
        base = json.load(open(ruta(origen), encoding='utf-8-sig'))
        inst, _, _ = convertir(base, contrato, tipo,
                               os.path.basename(cfg['candidato']), I.asignar)

        if check:
            # --check no escribe: COMPARA lo que generaria contra lo persistido.
            # Informar sin comparar dejaba pasar artefactos desactualizados.
            for etq, calc, dest in (('esqueleto', cand, cfg['candidato']),
                                    ('instancia', inst, destino)):
                d = ruta(dest)
                if not os.path.exists(d):
                    print('  DESFASADO: falta %s' % dest)
                    problemas += 1
                    continue
                viejo = json.load(open(d, encoding='utf-8-sig'))
                igual = (json.dumps(viejo, ensure_ascii=False, sort_keys=True) ==
                         json.dumps(calc, ensure_ascii=False, sort_keys=True))
                print('  %s persistido: %s' % (etq, 'al dia' if igual else 'DESFASADO'))
                if not igual:
                    problemas += 1
        else:
            io.open(ruta(cfg['candidato']), 'w', encoding='utf-8', newline='\n').write(
                json.dumps(cand, ensure_ascii=False, indent=2))
            print(f'  escrito: {cfg["candidato"]}')
            io.open(ruta(destino), 'w', encoding='utf-8', newline='\n').write(
                json.dumps(inst, ensure_ascii=False, indent=2))
            print(f'  escrito: {destino}')

        if not check:
            mp = ruta(cfg['candidato'].replace('.json', '.mapa.json'))
            io.open(mp, 'w', encoding='utf-8', newline='\n').write(
                json.dumps(mapas, ensure_ascii=False, indent=2))
            print(f'  escrito: {os.path.relpath(mp, RAIZ)}')

    if check:
        print('\n(--check: no se escribio nada)')
    return 1 if problemas else 0


if __name__ == '__main__':
    sys.exit(main())
