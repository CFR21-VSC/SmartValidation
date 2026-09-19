"""Conversion de un documento a la forma del contrato 3.1. Una sola definicion.

La conversion la usaban por separado el generador de candidatos y la prueba de
cadena, cada uno con su copia. Eso hacia que la prueba acreditara su propia
conversion y no la que realmente se entrega. Aca vive una sola, y ambos la usan.

    from conversion import convertir
    inst, asign, problemas = convertir(doc, contrato, tipo, archivoEsqueleto)

No escribe nada y no modifica el documento de entrada.
"""
import copy


def convertir(doc, contrato, tipo, archivo_esqueleto, asignar=None):
    """Devuelve (instancia convertida, asignacion, problemas).

    La instancia es una copia: el documento de origen no se toca. Las secciones
    reciben su clave canonica como `id`, el `padre` que declara el contrato y la
    `clase` que corresponde; se referencia el esqueleto 3.1.
    """
    if asignar is None:
        from importlib import import_module
        asignar = import_module('identidad').asignar

    inst = copy.deepcopy(doc)
    asign, problemas = asignar(inst, contrato)
    por_clave = {d['clave']: d for d in contrato['secciones']}

    # Un rol repetible ocupa VARIOS indices. Su `id` sigue siendo el de la
    # ocurrencia (GAP-001), que es lo que referencia el resto del paquete, y el
    # rol del esqueleto viaja aparte en `definicionId`.
    i2k, repetibles = {}, set()
    for k, a in asign.items():
        if a.get('repetible'):
            repetibles.add(k)
            for o in a['ocurrencias']:
                i2k[o['indice']] = k
        else:
            i2k[a['indice']] = k

    for i, s in enumerate(inst.get('secciones') or []):
        k = i2k.get(i)
        if not k:
            continue
        d = por_clave[k]
        if k in repetibles:
            s['definicionId'] = k          # el rol; el id de ocurrencia no se pisa
            if not str(s.get('id') or '').strip():
                s['id'] = '%s-%d' % (k, i)
        else:
            s['id'] = k
        if d.get('padre'):
            s['padre'] = d['padre']
        else:
            s.pop('padre', None)
        s['clase'] = 'seccion' if (not d.get('padre') or d.get('tipo') == 'subseccion') else 'bloque'
        s.pop('obligatoriedad', None)

    inst['esqueleto'] = {'tipo': tipo, 'version': '3.1', 'archivo': archivo_esqueleto}
    inst['contratoVersion'] = '3.1-identidad-canonica'
    return inst, asign, problemas
