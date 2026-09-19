"""Genera los esqueletos v3 DESDE los documentos reales.

    python contrato-documentos/generar-esqueleto.py             # escribe un CANDIDATO
    python contrato-documentos/generar-esqueleto.py --check     # solo compara, no escribe
    python contrato-documentos/generar-esqueleto.py --publicar  # pisa el contrato vigente

Por defecto ya NO pisa el contrato publicado: escribe `*.candidato.json` al lado.
Un contrato publicado no puede cambiar como efecto secundario de haber elegido
otro documento de muestra; el cambio se mira con diff y se publica a proposito.

Por que existe
--------------
Los esqueletos v3 se habian escrito a mano. Al cerrar el validador aparecieron
14 errores en la instancia URS valida y 13 en la VP, TODOS con la misma causa:
el esqueleto, no la instancia.

  1. `tipo` normalizado a una familia semantica inventada ("texto") donde el
     documento real dice el tipo del renderer ("subseccion").
  2. `padre` calculado con la regla vieja, anterior a la correccion de las cajas
     (OQ y PQ colgaban de "criterio-de-aceptacion-iq" en vez de su seccion madre).
  3. Etiquetas de columna con los acentos borrados ("Termino" por "Termino"
     real, "El sistema DEBERA..." por "DEBERA..."). El mismo defecto que el enum
     CRITICO/CRITICO que ya habia aparecido.

Un esqueleto escrito a mano vuelve a desfasarse en cuanto cambia la regla. Este
generador lo deriva de la misma funcion `migrar()` que produce las instancias,
asi que esqueleto e instancia no pueden discrepar por construccion.

Que se deriva y que se preserva
-------------------------------
DERIVADO del documento real (no se puede editar a mano sin que el generador lo
pise): id, clase, padre, tipo, titulo y las etiquetas de columna.

PRESERVADO del esqueleto anterior por id, porque es criterio humano y no se
deduce del dato: obligatoriedad, admiteNoAplica, y por tabla filaForma,
permiteAgrupacion, minFilasDatos y los atributos de columna
key/rol/idClase/celda/ancho/enum/requerido.
Toda seccion nueva sin criterio previo se emite como `opcional` y se lista al
final para que alguien la decida.
"""
import io
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

_m1 = import_module('migrar-fase1')
migrar, cargar = _m1.migrar, _m1.cargar

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FUENTES = [
    ('URS', 'SMART_Validation/js/validation-suite/fixtures/urs-drp-sis-001.json', False,
     'contrato-documentos/urs.skeleton.v3.json'),
    ('VP', 'proj_1786639073632_2h83bp.project.json', True,
     'contrato-documentos/vp.skeleton.v3.json'),
]

# Campos curados: criterio humano, no derivable del documento.
CURADOS_SEC = ('obligatoriedad', 'admiteNoAplica')
CURADOS_TAB = ('filaForma', 'permiteAgrupacion', 'minFilasDatos', 'sinColumnas')
CURADOS_COL = ('key', 'rol', 'idClase', 'celda', 'ancho', 'enum', 'requerido')


def _norm(t):
    """Etiqueta normalizada para comparar: sin acentos, sin caso, sin espacios de mas."""
    t = unicodedata.normalize('NFKD', str(t or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', t).strip().lower()


def emparejar_columnas(cols_doc, prev_cols, sid, avisos):
    """Empareja cada columna del documento con la del esqueleto anterior.

    Antes se emparejaba por POSICION. Si alguien reordena las columnas del
    documento, el rol `idDefinicion` y los enums se mudan a la columna de al
    lado sin que nada lo note: el contrato pasaria a exigir el patron de ID
    sobre la columna "Fuente". Ahora se empareja por etiqueta normalizada
    (sin acentos, que es como estaban escritas las viejas) y la posicion solo
    se usa cuando la etiqueta no alcanza — y entonces queda avisado.
    """
    por_label = {}
    for c in prev_cols:
        if c.get('label') is not None:
            por_label.setdefault(_norm(c['label']), []).append(c)

    # Una etiqueta repetida DENTRO del documento no identifica a nadie. Si se
    # deja caer a posicion, la segunda "URS-ID" termina heredando la clave de la
    # columna que este en su lugar (paso: heredaba `fuente`). Ambiguo es ambiguo.
    repetidas = {e for e in [_norm(l) for l in cols_doc]
                 if [_norm(l) for l in cols_doc].count(e) > 1}

    salida, usados = [], set()
    for i, label in enumerate(cols_doc):
        if _norm(label) in repetidas:
            avisos.append(f'{sid} col {i}: la etiqueta "{label}" esta repetida en el documento; '
                          f'no identifica una columna, se emite sin rol ni enum')
            salida.append({})
            continue
        cands = por_label.get(_norm(label), [])
        libres = [c for c in cands if id(c) not in usados]
        if len(libres) == 1:
            usados.add(id(libres[0]))
            salida.append(libres[0])
        elif len(libres) > 1:
            avisos.append(f'{sid}: la etiqueta "{label}" aparece {len(libres)} veces en el '
                          f'esqueleto anterior; correspondencia ambigua, no se arrastran roles')
            salida.append({})
        else:
            # Sin etiqueta equivalente. Solo se cae a posicion si la cantidad de
            # columnas no cambio; si cambio, arrastrar por posicion es adivinar.
            if len(cols_doc) == len(prev_cols) and i < len(prev_cols):
                c = prev_cols[i]
                if id(c) not in usados:
                    usados.add(id(c))
                    avisos.append(f'{sid} col {i}: "{label}" no existia antes; se arrastra por '
                                  f'POSICION desde "{c.get("label")}" — verificar')
                    salida.append(c)
                    continue
            avisos.append(f'{sid} col {i}: "{label}" sin correspondencia; se emite sin rol ni enum')
            salida.append({})
    return salida


def seccion_esqueleto(s, previo, avisos):
    """Una seccion del esqueleto: derivada del doc, curada del esqueleto anterior."""
    out = {'id': s['id'], 'clase': s['clase']}
    if s.get('padre'):
        out['padre'] = s['padre']
    out['tipo'] = s.get('tipo')
    if s.get('titulo'):
        out['titulo'] = (s['titulo'] or '').strip()

    for k in CURADOS_SEC:
        if previo and k in previo:
            out[k] = previo[k]
    out.setdefault('obligatoriedad', 'opcional')

    cols_doc = s.get('columnas') or []
    prev_tab = (previo or {}).get('tabla') or {}
    # Una tabla `noHeader` no trae `columnas` y aun asi es una tabla: hay que
    # conservarle el bloque curado (permiteAgrupacion, roles) o se pierde.
    if cols_doc or prev_tab:
        prev_cols = prev_tab.get('columnas') or []
        tabla = {k: prev_tab[k] for k in CURADOS_TAB if k in prev_tab}
        emparejadas = emparejar_columnas(cols_doc, prev_cols, s['id'], avisos) if cols_doc else []
        columnas = []
        for i, label in enumerate(cols_doc):
            # La etiqueta SIEMPRE viene del documento, con sus acentos.
            col = {'label': label if isinstance(label, str) else str(label)}
            pc = emparejadas[i] if i < len(emparejadas) else {}
            for k in CURADOS_COL:
                if k in pc:
                    col[k] = pc[k]
            columnas.append(col)
        if columnas:
            tabla['columnas'] = columnas
        elif prev_cols:
            # Sin encabezado en el documento: se conservan los roles curados,
            # sin inventarles una etiqueta que el documento no declara.
            tabla['columnas'] = [{k: c[k] for k in CURADOS_COL if k in c} for c in prev_cols]
            tabla['sinColumnas'] = True
        out['tabla'] = tabla
    return out


def main():
    check = '--check' in sys.argv
    publicar = '--publicar' in sys.argv
    problemas, sin_criterio = 0, []

    for tipo, ruta, interno, destino in FUENTES:
        dst = os.path.join(RAIZ, destino)
        anterior = json.load(open(dst, encoding='utf-8-sig'))
        prev_por_id = {s['id']: s for s in anterior.get('secciones', [])}

        doc = cargar((tipo, ruta, interno))
        secs = migrar(doc['secciones'])
        avisos = []
        nuevas = [seccion_esqueleto(s, prev_por_id.get(s['id']), avisos) for s in secs]

        nuevo = dict(anterior)
        nuevo['secciones'] = nuevas

        faltan = [s['id'] for s in nuevas if s['id'] not in prev_por_id]
        sin_criterio += [f'{tipo}:{i}' for i in faltan]

        # Una version PUBLICADA no puede perder secciones porque el documento
        # fuente que se uso de muestra ya no las traiga. Si la propuesta borra
        # una seccion del contrato vigente, se informa y no se publica.
        ids_nuevos = {s['id'] for s in nuevas}
        perdidas = [s for s in anterior.get('secciones', []) if s['id'] not in ids_nuevos]
        perdidas_req = [s['id'] for s in perdidas if s.get('obligatoriedad') == 'requerida']

        antes = json.dumps(anterior.get('secciones'), ensure_ascii=False, sort_keys=True)
        ahora = json.dumps(nuevas, ensure_ascii=False, sort_keys=True)
        cambia = antes != ahora

        print(f'{tipo}: {len(nuevas)} secciones | '
              f'{"CAMBIA" if cambia else "sin cambios"}'
              + (f" | {len(faltan)} sin criterio previo" if faltan else ''))

        if perdidas:
            print(f'   LA PROPUESTA BORRA {len(perdidas)} seccion(es) del contrato vigente:')
            for s in perdidas:
                print(f'     - {s["id"]} ({s.get("obligatoriedad")})')
            if perdidas_req:
                print(f'     {len(perdidas_req)} de ellas son REQUERIDAS: no se publica.')
                problemas += 1
        for a in avisos:
            print(f'   aviso | {a}')
        if avisos:
            problemas += 1

        if cambia and check:
            problemas += 1
            # Muestra en que ids difiere, para poder auditarlo.
            for s in nuevas:
                p = prev_por_id.get(s['id'])
                if not p:
                    print(f'   + {s["id"]} (nueva)')
                    continue
                for k in ('tipo', 'padre', 'clase'):
                    if (p.get(k) or None) != (s.get(k) or None):
                        print(f'   ~ {s["id"]}.{k}: {p.get(k)!r} -> {s.get(k)!r}')
                pc = [c.get('label') for c in ((p.get('tabla') or {}).get('columnas') or [])]
                nc = [c.get('label') for c in ((s.get('tabla') or {}).get('columnas') or [])]
                if pc != nc:
                    print(f'   ~ {s["id"]}.columnas: {pc} -> {nc}')

        if not check:
            # Por defecto se escribe un CANDIDATO al lado del contrato vigente.
            # Publicar encima exige --publicar y que la propuesta no borre nada
            # requerido: un contrato publicado no cambia por efecto secundario
            # de haber elegido otro documento de muestra.
            # "Explicito" no es "inmutable": publicar encima solo se permite si
            # no hay NADA sin resolver. Una correspondencia arrastrada por
            # posicion es una propuesta pendiente, no una correspondencia
            # aprobada, asi que tambien bloquea.
            bloqueos = []
            if perdidas_req:
                bloqueos.append(f'{len(perdidas_req)} seccion(es) requeridas que se borrarian')
            if avisos:
                bloqueos.append(f'{len(avisos)} correspondencia(s) de columna sin verificar')
            if publicar and cambia and anterior.get('contrato') == nuevo.get('contrato'):
                bloqueos.append(f'el contrato cambia sin subir de version (sigue en {anterior.get("contrato")})')

            if publicar and not bloqueos:
                destino_real = dst
            else:
                destino_real = dst.replace('.json', '.candidato.json')
                if publicar:
                    print('   --publicar BLOQUEADO:')
                    for b in bloqueos:
                        print(f'     | {b}')
                    problemas += 1
            io.open(destino_real, 'w', encoding='utf-8', newline='\n').write(
                json.dumps(nuevo, ensure_ascii=False, indent=2))
            print(f'   escrito: {os.path.relpath(destino_real, RAIZ)}')

    if sin_criterio:
        print('\nSecciones sin obligatoriedad declarada previamente (quedaron '
              'como `opcional`, hay que decidirlas):')
        for i in sin_criterio:
            print('   ' + i)

    if check:
        print('\n(--check: no se escribio nada)')
    return 1 if problemas else 0


if __name__ == '__main__':
    sys.exit(main())
