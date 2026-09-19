"""Identidad canonica de secciones: claves semanticas fijas, no slug ni posicion.

    python contrato-documentos/identidad.py            # asigna sobre los documentos conocidos
    python contrato-documentos/identidad.py --json     # salida en JSON

Por que
-------
La identidad se derivaba del titulo (`slug(titulo)`). Dos URS generados por el
mismo skill dan IDs distintos para el mismo lugar del documento: la tabla final
es `firmas-de-ejecucion` en uno y `conformidad-de-revision-y-apro` en otro, y
las subsecciones sin titulo caen todas a `bloque`, `bloque-2`, `bloque-3`.

Tampoco sirve el indice del array: si se omite una tabla opcional, todo lo que
viene detras se corre y hereda el rol equivocado sin que nada lo note.

Lo que sigue son claves ASIGNADAS por el contrato, no rutas que se recalculen.
Un nodo que se mueve conserva su clave y cambia su padre segun la version del
contrato. El titulo es etiqueta visible, con variantes permitidas declaradas.
El orden se declara aparte y no participa de la identidad.

Como se asigna sobre documentos legacy
--------------------------------------
No se adivina. Cada candidato se puntua por EVIDENCIA declarada en el contrato
(tipo, padre esperado, columnas, contenido) y el titulo/posicion solo cuentan
como evidencia auxiliar. Si quedan dos candidatos igual de buenos, o ninguno,
se reporta AMBIGUO y no se emite asignacion: lo resuelve una persona.
"""
import json
import os
import re
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def norm(t):
    t = unicodedata.normalize('NFKD', str(t or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9 ]+', ' ', t.lower()).strip()


# Prefijo de seccion legacy: "5.2 ", "11) ", "3 - ". Acotado a ese patron para
# no borrar numeros con significado propio (por ejemplo "21 CFR Part 11").
_PREFIJO_LEGACY = re.compile(r'^\s*\d+(?:\.\d+)*\s*[.)\-:]?\s+')


def norm_titulo(t):
    """Titulo normalizado para COMPARAR. El titulo original no se toca.

    Sin esto, "5.3 INTEGRACIONES CON OTROS SISTEMAS" no coincidia con la
    variante declarada "INTEGRACIONES CON OTROS SISTEMAS", y el prefijo numerico
    legacy esquivaba ademas la reserva de titulos: un rol podia quedarse con el
    candidato de otro.
    """
    return norm(_PREFIJO_LEGACY.sub('', str(t or '').strip()))


def palabras(t):
    return [p for p in norm(t).split() if len(p) > 2]


# -- Contrato de identidad del URS ------------------------------------------
# `clave`      : identidad asignada. No se recalcula nunca.
# `tipo`       : tipo de renderer esperado (evidencia fuerte).
# `padre`      : clave del padre, segun esta version del contrato.
# `titulos`    : variantes de titulo permitidas (evidencia auxiliar).
# `columnas`   : etiquetas esperadas (evidencia fuerte para tablas).
# `obligatoria`: si falta, es error; si es opcional, su ausencia NO corre a las demas.
URS_V3 = {
    'version': '3.0',
    'orden': ['proposito', 'alcance', 'responsabilidades', 'definiciones',
              'contexto', 'contexto.general', 'contexto.usuarios',
              'contexto.usuarios.tabla', 'contexto.integraciones',
              'leyenda', 'leyenda.criticidad', 'requerimientos.funcionales',
              'requerimientos.noFuncionales', 'exclusiones', 'criteriosAceptacion',
              'resumen', 'referencias', 'firmas'],
    'secciones': [
        {'clave': 'proposito', 'tipo': 'texto', 'padre': None, 'obligatoria': True,
         'titulos': ['PROPOSITO', 'OBJETIVO']},
        {'clave': 'alcance', 'tipo': 'lista-incluido-excluido', 'padre': None, 'obligatoria': True,
         'titulos': ['ALCANCE']},
        {'clave': 'responsabilidades', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['RESPONSABILIDADES'],
         # Variantes observadas en documentos reales del mismo tipo. Se declaran
         # a proposito, tras mirarlas; no se infieren ni se aceptan en silencio.
         # Misma columna semantica con otra etiqueta: se declara su key para
         # que no se invente una nueva y los extractores sigan encontrandola.
         'columnas': [['Rol', 'Responsabilidad en este URS'],
                      [{'label': 'Rol', 'key': 'rol'},
                       {'label': 'Nombre', 'key': 'nombre'},
                       {'label': 'Responsabilidad principal', 'key': 'responsabilidad'}]]},
        {'clave': 'definiciones', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['DEFINICIONES'], 'columnas': ['Término', 'Definición']},
        {'clave': 'contexto', 'tipo': 'texto', 'padre': None, 'obligatoria': True,
         'titulos': ['CONTEXTO DEL SISTEMA']},
        {'clave': 'contexto.general', 'tipo': 'subseccion', 'padre': 'contexto', 'obligatoria': True,
         'titulos': ['DESCRIPCION GENERAL']},
        {'clave': 'contexto.usuarios', 'tipo': 'subseccion', 'padre': 'contexto', 'obligatoria': True,
         'titulos': ['USUARIOS DEL SISTEMA']},
        {'clave': 'contexto.usuarios.tabla', 'tipo': 'tabla', 'padre': 'contexto.usuarios',
         'obligatoria': False, 'columnas': ['Rol', 'Perfil', 'Acciones principales']},
        {'clave': 'contexto.integraciones', 'tipo': 'subseccion', 'padre': 'contexto',
         'obligatoria': False, 'titulos': ['INTEGRACIONES CON OTROS SISTEMAS']},
        {'clave': 'leyenda', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['LEYENDA DE LA TABLA DE REQUERIMIENTOS'],
         'columnas': ['Campo', 'Valores posibles', 'Significado']},
        {'clave': 'leyenda.criticidad', 'tipo': 'tabla', 'padre': 'leyenda', 'obligatoria': False,
         'sinColumnas': True,
         # Unico rol sin titulo ni columnas: el contrato declara que su
         # contenido son las tres filas de la tabla-leyenda de criticidad, tal
         # como las declara urs-generator.md. Tipo compatible no identifica.
         'contieneTexto': ['Criticidad CRITICA', 'Criticidad ALTA', 'Criticidad MEDIA']},
        {'clave': 'requerimientos.funcionales', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['REQUERIMIENTOS FUNCIONALES'],
         'columnas': [['URS-ID', 'Fuente', 'El sistema DEBERÁ...', 'Tipo', 'Criticidad'],
                      ['URS-ID', 'Fuente', {'label': 'El sistema/proveedor DEBERÁ...',
                                            'key': 'enunciado'}, 'Tipo', 'Criticidad']]},
        {'clave': 'requerimientos.noFuncionales', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['REQUERIMIENTOS NO FUNCIONALES'],
         'columnas': [['URS-ID', 'Fuente', 'El sistema DEBERÁ...', 'Tipo', 'Criticidad'],
                      ['URS-ID', 'Fuente', {'label': 'El sistema/proveedor DEBERÁ...',
                                            'key': 'enunciado'}, 'Tipo', 'Criticidad']]},
        {'clave': 'exclusiones', 'tipo': 'tabla', 'padre': None, 'obligatoria': False,
         'titulos': ['EXCLUSIONES EXPLICITAS'],
         'columnas': ['Funcionalidad excluida', 'Justificación', 'Referencia']},
        {'clave': 'criteriosAceptacion', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['CRITERIOS DE ACEPTACION DEL URS'],
         'columnas': ['#', 'Criterio', 'Verificación']},
        {'clave': 'resumen', 'tipo': 'tabla', 'padre': None, 'obligatoria': False,
         'titulos': ['RESUMEN ESTADISTICO DE REQUERIMIENTOS'],
         'columnas': [['Por tipo', 'Por criticidad', 'Por módulo'],
                      ['Por tipo', 'Por criticidad',
                       {'label': 'Por módulo/categoría', 'key': 'porModulo'}]]},
        {'clave': 'referencias', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['REFERENCIAS'], 'columnas': ['Código / Referencia', 'Título']},
        {'clave': 'firmas', 'tipo': 'tabla-firmas-final', 'padre': None, 'obligatoria': True,
         'titulos': ['FIRMAS DE EJECUCION', 'CONFORMIDAD DE REVISION Y APROBACION']},
    ],
}


# -- Contrato de identidad del VP -------------------------------------------
# Mismo criterio que el URS. El parentesco es el ya acordado: OQ y PQ cuelgan
# de `calificacion`, no de la caja de criterio de IQ, y cada caja cuelga de la
# subseccion que la introduce.
VP_V3 = {
    'version': '3.0',
    'orden': ['proposito', 'alcance', 'responsabilidades', 'definiciones', 'hlra',
              'documentos', 'documentos.nota', 'cronograma', 'cronograma.nota',
              'calificacion', 'calificacion.iq', 'calificacion.iq.tabla',
              'calificacion.iq.criterio', 'calificacion.oq', 'calificacion.oq.tabla',
              'calificacion.oq.criterio', 'calificacion.pq',
              'calificacion.pq.justificacion', 'decisiones.intro', 'decisiones',
              'desviaciones', 'desviaciones.documentacion', 'desviaciones.documentacion.campos',
              'cambios', 'cambios.postValidacion', 'cambios.postValidacion.tabla',
              'criterioValidado', 'criteriosAceptacion', 'referencias', 'firmas'],
    'secciones': [
        {'clave': 'proposito', 'tipo': 'texto', 'padre': None, 'obligatoria': True,
         'titulos': ['PROPOSITO', 'OBJETIVO']},
        {'clave': 'alcance', 'tipo': 'lista-incluido-excluido', 'padre': None, 'obligatoria': True,
         'titulos': ['ALCANCE']},
        {'clave': 'responsabilidades', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['RESPONSABILIDADES'],
         'columnas': [[{'label': 'Rol', 'key': 'rol'},
                       {'label': 'Nombre', 'key': 'nombre'},
                       {'label': 'Responsabilidad principal', 'key': 'responsabilidad'}],
                      [{'label': 'Rol', 'key': 'rol'},
                       {'label': 'Responsabilidad en este VP', 'key': 'responsabilidad'}]]},
        {'clave': 'definiciones', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['DEFINICIONES'], 'columnas': ['Término', 'Definición']},
        {'clave': 'hlra', 'tipo': 'tabla-info', 'padre': None, 'obligatoria': False,
         'titulos': ['REFERENCIA AL HLRA — ESTRATEGIA BASADA EN RIESGO',
                     'REFERENCIA AL HLRA']},
        {'clave': 'documentos', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['DOCUMENTOS DEL PROYECTO DE VALIDACION'],
         'columnas': ['#', 'Código', 'Documento', 'Responsable']},
        {'clave': 'documentos.nota', 'tipo': 'caja-nota', 'padre': 'documentos',
         'obligatoria': False, 'titulos': ['Notas sobre el paquete documental']},
        {'clave': 'cronograma', 'tipo': 'tabla', 'padre': None, 'obligatoria': False,
         'titulos': ['CRONOGRAMA DEL PROYECTO'],
         'columnas': ['Semana', 'Actividades', 'Documentos generados', 'Hito de cierre']},
        # Caja sin titulo: el contrato declara de que habla, porque `caja-nota`
        # no es un tipo unico y el tipo solo no identifica.
        {'clave': 'cronograma.nota', 'tipo': 'caja-nota', 'padre': 'cronograma',
         'obligatoria': False, 'contieneTexto': ['cronograma']},
        {'clave': 'calificacion', 'tipo': 'texto', 'padre': None, 'obligatoria': True,
         'titulos': ['ALCANCE DE CALIFICACION IQ / OQ', 'ALCANCE DE CALIFICACION']},
        {'clave': 'calificacion.iq', 'tipo': 'subseccion', 'padre': 'calificacion',
         'obligatoria': True, 'titulos': ['Installation Qualification (IQ)']},
        {'clave': 'calificacion.iq.tabla', 'tipo': 'tabla', 'padre': 'calificacion.iq',
         'obligatoria': False,
         'columnas': ['Área de verificación IQ', 'Qué se verifica', 'Criterio de aceptación']},
        {'clave': 'calificacion.iq.criterio', 'tipo': 'caja-nota', 'padre': 'calificacion.iq',
         'obligatoria': False, 'titulos': ['Criterio de aceptación IQ']},
        {'clave': 'calificacion.oq', 'tipo': 'subseccion', 'padre': 'calificacion',
         'obligatoria': True, 'titulos': ['Operational Qualification (OQ)']},
        {'clave': 'calificacion.oq.tabla', 'tipo': 'tabla', 'padre': 'calificacion.oq',
         'obligatoria': False,
         'columnas': ['Área funcional OQ', 'Qué se verifica', 'Prioridad']},
        # Presente en dos de los tres ejemplares, con dos titulos distintos.
        {'clave': 'calificacion.oq.criterio', 'tipo': 'caja-nota', 'padre': 'calificacion.oq',
         'obligatoria': False,
         'titulos': ['Criterio de aceptación OQ',
                     'Ratio TC/URS y criterio de aceptación OQ']},
        {'clave': 'calificacion.pq', 'tipo': 'subseccion', 'padre': 'calificacion',
         'obligatoria': False,
         'titulos': ['Performance Qualification (PQ) — No Aplica',
                     'Performance Qualification (PQ)']},
        {'clave': 'calificacion.pq.justificacion', 'tipo': 'caja-justificacion',
         'padre': 'calificacion.pq', 'obligatoria': False,
         'titulos': ['Justificación de exclusión de PQ']},
        # En un ejemplar es una subseccion que introduce la tabla; en los otros
        # dos la tabla trae el titulo. Se declaran las dos piezas y la tabla se
        # identifica por su tipo, que es unico en el contrato.
        {'clave': 'decisiones.intro', 'tipo': 'subseccion', 'padre': None, 'obligatoria': False,
         'titulos': ['Decisiones de ejecución — Criterios de resultado']},
        {'clave': 'decisiones', 'tipo': 'tabla-decisiones-tc', 'padre': None, 'obligatoria': False,
         'titulos': ['DECISIONES DE EJECUCION — CRITERIOS DE RESULTADO',
                     'DECISIONES DE EJECUCION', '']},
        {'clave': 'desviaciones', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['GESTION DE DESVIACIONES Y NO CONFORMIDADES'],
         'columnas': ['Severidad', 'Definición', 'Acción requerida']},
        {'clave': 'desviaciones.documentacion', 'tipo': 'subseccion', 'padre': 'desviaciones',
         'obligatoria': False,
         'titulos': ['Documentación de No Conformidades',
                     'Proceso de documentación y cierre']},
        {'clave': 'desviaciones.documentacion.campos', 'tipo': 'tabla-info',
         'padre': 'desviaciones.documentacion', 'obligatoria': False,
         # En la plantilla vacia no hay contenido del cual sacar evidencia; el
         # contrato declara que este rol no lleva titulo, y es el unico
         # `tabla-info` asi.
         'sinTitulo': True},
        {'clave': 'cambios', 'tipo': 'texto', 'padre': None, 'obligatoria': True,
         'titulos': ['GESTION DE CAMBIOS']},
        {'clave': 'cambios.postValidacion', 'tipo': 'subseccion', 'padre': 'cambios',
         'obligatoria': False,
         'titulos': ['Post-validación',
                     'Post-validación (sistema en producción)',
                     'Sistema en producción (post-validación)']},
        {'clave': 'cambios.postValidacion.tabla', 'tipo': 'tabla',
         'padre': 'cambios.postValidacion', 'obligatoria': False,
         'columnas': [['Tipo de cambio', 'Procedimiento aplicable', 'Responsable'],
                      [{'label': 'Tipo de cambio', 'key': 'tipoCambio'},
                       {'label': 'Evaluación requerida', 'key': 'procedimiento'},
                       {'label': 'Posible acción', 'key': 'responsable'}]]},
        {'clave': 'criterioValidado', 'tipo': 'caja-criterio', 'padre': None,
         'obligatoria': False,
         'titulos': ['El sistema se considera VALIDADO cuando se cumplen TODOS '
                     'los siguientes criterios']},
        {'clave': 'criteriosAceptacion', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['CRITERIOS DE ACEPTACION GENERALES'],
         'columnas': ['#', 'Criterio', 'Verificación']},
        {'clave': 'referencias', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['REFERENCIAS'], 'columnas': ['Código / Referencia', 'Título']},
        {'clave': 'firmas', 'tipo': 'tabla-firmas-final', 'padre': None, 'obligatoria': True,
         'titulos': ['CONFORMIDAD DE REVISION Y APROBACION', 'FIRMAS DE EJECUCION']},
    ],
}


# -- Contrato de identidad del HLRA -----------------------------------------
# Introduce el primer rol REPETIBLE del contrato: las tarjetas de gap. Aparecen
# 2 veces en un ejemplar, 4 en otro y 0 en la plantilla, y cada una trae su
# propio id de dominio (GAP-001, GAP-002). Siguiendo lo acordado en la Ronda 11:
# `definicionId` es el rol del esqueleto y el `id` que ya trae la seccion es el
# de la ocurrencia, estable dentro del documento.
#
# El titulo de `gamp.resultado` es DATO, no identidad: dice "GAMP 4 - Software
# Configurado" en un ejemplar, "GAMP 3 - COTS NO CONFIGURADO" en otro y esta
# vacio en la plantilla. Lo identifica su tipo, unico en el contrato.
HLRA_V3 = {
    'version': '3.0',
    'orden': ['proposito', 'alcance', 'responsabilidades', 'definiciones', 'sistema',
              'gamp', 'gamp.resultado', 'gamp.implicaciones', 'criticidad',
              'criticidad.resultado', 'procesos', 'funciones', 'gaps',
              'estrategia', 'estrategia.documentos', 'conclusion', 'referencias', 'firmas'],
    'secciones': [
        {'clave': 'proposito', 'tipo': 'texto', 'padre': None, 'obligatoria': True,
         'titulos': ['PROPOSITO', 'OBJETIVO']},
        {'clave': 'alcance', 'tipo': 'lista-incluido-excluido', 'padre': None, 'obligatoria': True,
         'titulos': ['ALCANCE']},
        {'clave': 'responsabilidades', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['RESPONSABILIDADES'],
         'columnas': [[{'label': 'Rol', 'key': 'rol'},
                       {'label': 'Nombre', 'key': 'nombre'},
                       {'label': 'Responsabilidad principal', 'key': 'responsabilidad'}],
                      [{'label': 'Rol', 'key': 'rol'},
                       {'label': 'Responsabilidad', 'key': 'responsabilidad'}]]},
        {'clave': 'definiciones', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['DEFINICIONES'], 'columnas': ['Término', 'Definición']},
        {'clave': 'sistema', 'tipo': 'tabla-info', 'padre': None, 'obligatoria': True,
         'titulos': ['DESCRIPCION DEL SISTEMA']},
        {'clave': 'gamp', 'tipo': 'arbol-decision-gamp', 'padre': None, 'obligatoria': True,
         'titulos': ['CATEGORIZACION GAMP']},
        # Titulo variable por diseno (lleva la categoria resultante) y vacio en
        # la plantilla: identifica el tipo, que es unico en el contrato.
        {'clave': 'gamp.resultado', 'tipo': 'caja-resultado', 'padre': 'gamp', 'obligatoria': True},
        {'clave': 'gamp.implicaciones', 'tipo': 'tabla-docs-aplicables', 'padre': 'gamp',
         'obligatoria': False, 'titulos': ['Implicaciones para la Validación']},
        {'clave': 'criticidad', 'tipo': 'formula-rai', 'padre': None, 'obligatoria': True,
         'titulos': ['ANALISIS DE CRITICIDAD OPERATIVA']},
        {'clave': 'criticidad.resultado', 'tipo': 'box-resultado-rai', 'padre': 'criticidad',
         'obligatoria': True, 'titulos': ['Resultado IRO']},
        {'clave': 'procesos', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['PROCESOS GxP IMPACTADOS'],
         'columnas': ['Proceso GxP', 'Función del sistema', 'Criticidad']},
        {'clave': 'funciones', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['FUNCIONES CRITICAS GxP'],
         'columnas': ['Función', 'Impacto GxP', 'Criticidad', 'Verif. OQ']},
        # REPETIBLE: 0..N ocurrencias, cada una con su id de dominio.
        {'clave': 'gaps', 'tipo': 'tarjeta-gap', 'padre': None, 'obligatoria': False,
         'repetible': True, 'idOcurrencia': 'id'},
        {'clave': 'estrategia', 'tipo': 'texto', 'padre': None, 'obligatoria': True,
         'titulos': ['ESTRATEGIA DE VALIDACION']},
        {'clave': 'estrategia.documentos', 'tipo': 'tabla', 'padre': 'estrategia',
         'obligatoria': False,
         'titulos': ['Documentos de la Validación', 'Documentos de la Validación — Proyecto'],
         'columnas': ['#', 'Código', 'Documento', 'Responsable']},
        {'clave': 'conclusion', 'tipo': 'caja-conclusion', 'padre': None, 'obligatoria': True,
         'titulos': ['CONCLUSION']},
        {'clave': 'referencias', 'tipo': 'tabla', 'padre': None, 'obligatoria': True,
         'titulos': ['REFERENCIAS'], 'columnas': ['Código / Referencia', 'Título']},
        {'clave': 'firmas', 'tipo': 'tabla-firmas-final', 'padre': None, 'obligatoria': True,
         'titulos': ['CONFORMIDAD DE REVISION Y APROBACION', 'FIRMAS DE EJECUCION']},
    ],
}


CONTRATOS = {'URS': URS_V3, 'VP': VP_V3, 'HLRA': HLRA_V3}

# Evidencia. Un tipo compatible es FILTRO, no prueba de identidad: hay muchas
# subsecciones y muchas tablas. Solo cuentan como identificacion las pruebas
# "fuertes": variante de columnas declarada, titulo/alias declarado, tipo que en
# todo el contrato pertenece a un unico rol, contenido declarado, o un id
# explicito que el documento ya trae.
PESO_TIPO = 1
PESO_TIPO_UNICO = 5
PESO_COLUMNAS = 6
PESO_TITULO = 4
PESO_CONTENIDO = 3
PESO_ID_EXPLICITO = 8


def _textos(o, out, prof=0):
    if prof > 6 or o is None:
        return
    if isinstance(o, str):
        out.append(o)
    elif isinstance(o, dict):
        for v in o.values():
            _textos(v, out, prof + 1)
    elif isinstance(o, list):
        for v in o:
            _textos(v, out, prof + 1)


def etiqueta_de(col):
    """Una columna de variante puede ser la etiqueta suelta o {label, key}."""
    return col.get('label') if isinstance(col, dict) else col


def titulo_visible(sec):
    """El titulo puede venir en `titulo` o en `subtitulo` (asi lo traen las
    subsecciones del URS real). Se devuelve TAL CUAL esta en el documento."""
    return (sec.get('titulo') or sec.get('subtitulo') or '').strip()


def evidencia(defi, sec, tipos_unicos, titulos_ajenos, claves_contrato=(),
              sin_titulo_unicos=()):
    """Evalua un candidato para un rol.

    Devuelve {'ok', 'motivo', 'puntos', 'fuerte', 'detalle'}.
    `fuerte` es lo que decide: sin una prueba fuerte no se asigna identidad,
    aunque el tipo sea compatible y no haya ningun otro candidato.
    """
    def no(m):
        return {'ok': False, 'motivo': m, 'puntos': 0, 'fuerte': False, 'detalle': []}

    pts, det, fuerte = 0, [], False

    # -- id explicito que ya trae el documento ------------------------------
    idexp = str(sec.get('id') or '').strip()
    if idexp == defi['clave']:
        pts += PESO_ID_EXPLICITO
        fuerte = True
        det.append('id explicito del documento')
    elif idexp in claves_contrato:
        # Un id que nombra a OTRO rol del contrato no se reasigna en silencio.
        # Solo cuenta si es una clave canonica: un slug legacy
        # ("documentos-del-proyecto-de-val") no reclama ningun rol y se ignora.
        return no('el documento ya declara id="%s", que es otra clave del contrato' % idexp)

    # -- tipo: filtro, no prueba --------------------------------------------
    if defi.get('tipo'):
        if sec.get('tipo') != defi['tipo']:
            return no('tipo %r != %r' % (sec.get('tipo'), defi['tipo']))
        if defi['tipo'] in tipos_unicos:
            pts += PESO_TIPO_UNICO
            fuerte = True
            det.append('tipo=%s (unico en el contrato)' % defi['tipo'])
        else:
            pts += PESO_TIPO
            det.append('tipo=%s' % defi['tipo'])

    # -- columnas: variantes declaradas -------------------------------------
    variantes_col = defi.get('columnas')
    if variantes_col and isinstance(variantes_col[0], str):
        variantes_col = [variantes_col]
    cols_doc = sec.get('columnas')
    if variantes_col:
        if not cols_doc:
            return no('el contrato declara columnas y la seccion no trae')
        ndoc = [norm(c) for c in cols_doc]
        exacta = None
        for v in variantes_col:
            if [norm(etiqueta_de(c)) for c in v] == ndoc:
                exacta = v
                break
        if exacta is None:
            return no('columnas %s no coinciden con ninguna variante declarada' % cols_doc)
        pts += PESO_COLUMNAS
        fuerte = True
        det.append('%d columnas, variante declarada' % len(exacta))
    elif defi.get('sinColumnas') and cols_doc:
        return no('el contrato la declara sin encabezado y la seccion trae columnas')

    # -- titulo / alias declarados ------------------------------------------
    tit = titulo_visible(sec)
    ntit = norm_titulo(tit)
    variantes = defi.get('titulos')
    propios = set(norm_titulo(v) for v in (variantes or []) if v)
    if ntit and ntit in titulos_ajenos and ntit not in propios:
        return no('el titulo "%s" pertenece a otra clave del contrato' % tit)
    if variantes:
        if ntit and ntit in propios:
            pts += PESO_TITULO
            fuerte = True
            det.append('titulo declarado')
        else:
            # Un parecido parcial informa, pero NO identifica.
            for v in variantes:
                if v and palabras(v) and set(palabras(v)) & set(palabras(ntit)):
                    det.append('titulo parecido a "%s" (no identifica)' % v)
                    break

    # -- el contrato declara que este rol NO lleva titulo --------------------
    # Hace falta para las plantillas vacias: ahi no hay contenido del cual
    # sacar evidencia, y sin esto la seccion quedaba sin asignar. Solo vale si
    # la combinacion (tipo, sin titulo) identifica a un unico rol del contrato.
    if defi.get('sinTitulo'):
        if ntit:
            return no('el contrato declara este rol sin titulo y la seccion trae "%s"' % tit)
        if defi.get('tipo') in sin_titulo_unicos:
            pts += PESO_TITULO
            fuerte = True
            det.append('sin titulo, unico asi en su tipo')

    # -- contenido declarado por el contrato --------------------------------
    exige = defi.get('contieneTexto')
    if exige:
        ts = []
        _textos(sec, ts)
        plano = norm(' '.join(ts))
        if all(norm(x) in plano for x in exige):
            pts += PESO_CONTENIDO
            fuerte = True
            det.append('contenido declarado presente')
        else:
            return no('no contiene el texto que el contrato declara para este rol')

    return {'ok': True, 'motivo': '', 'puntos': pts, 'fuerte': fuerte, 'detalle': det}


def asignar(doc, contrato=URS_V3):
    """Asigna claves canonicas. Devuelve (asignaciones, problemas).

    La asignacion es GLOBAL, no voraz por orden de definiciones: primero se
    evalua cada par (rol, candidato) y despues se reservan las correspondencias
    FUERTES que son las mejores en las dos direcciones. Con la version voraz, un
    rol que iba primero se quedaba con el candidato de otro usando solo el tipo:
    al borrar "5.2 USUARIOS DEL SISTEMA", el rol contexto.usuarios se quedaba con
    "5.3 INTEGRACIONES CON OTROS SISTEMAS" y no se reportaba nada.
    """
    secs = doc.get('secciones') or []
    defs = contrato['secciones']

    tipos = [d.get('tipo') for d in defs if d.get('tipo')]
    tipos_unicos = set(t for t in tipos if tipos.count(t) == 1)
    claves = set(d['clave'] for d in defs)
    st = [d.get('tipo') for d in defs if d.get('sinTitulo')]
    sin_titulo_unicos = set(t for t in st if st.count(t) == 1)
    reservados = {}
    for d2 in defs:
        for v in d2.get('titulos') or []:
            if v:
                reservados.setdefault(norm_titulo(v), set()).add(d2['clave'])

    pares = {}          # clave -> [(puntos, j, detalle, fuerte)]
    porCandidato = {}   # j -> [(puntos, clave, fuerte)]
    for defi in defs:
        ajenos = set(t for t, cs in reservados.items() if defi['clave'] not in cs)
        for j, sec in enumerate(secs):
            r = evidencia(defi, sec, tipos_unicos, ajenos, claves, sin_titulo_unicos)
            if not r['ok']:
                continue
            pares.setdefault(defi['clave'], []).append((r['puntos'], j, r['detalle'], r['fuerte']))
            porCandidato.setdefault(j, []).append((r['puntos'], defi['clave'], r['fuerte']))

    asign, problemas = {}, []
    usados, resueltas = set(), set()

    # Reserva iterativa: solo correspondencias FUERTES, sin empate, y que el
    # candidato tampoco prefiera otro rol con mas evidencia.
    cambio = True
    while cambio:
        cambio = False
        for defi in defs:
            clave = defi['clave']
            if clave in resueltas:
                continue
            libres = sorted([c for c in pares.get(clave, []) if c[1] not in usados and c[3]],
                            key=lambda x: -x[0])
            if not libres:
                continue
            if len(libres) > 1 and libres[0][0] == libres[1][0]:
                continue                       # empate: se reporta al final
            pts, j, det, _ = libres[0]
            otros = sorted([x for x in porCandidato.get(j, [])
                            if x[2] and x[1] not in resueltas and x[1] != clave],
                           key=lambda x: -x[0])
            if otros and otros[0][0] > pts:
                continue                       # otro rol lo reclama con mas evidencia
            asign[clave] = {'indice': j, 'puntos': pts, 'evidencia': det,
                            'titulo': titulo_visible(secs[j]),
                            'padreContrato': defi.get('padre')}
            usados.add(j)
            resueltas.add(clave)
            cambio = True

    # Roles REPETIBLES: 0..N ocurrencias. Se resuelven despues de los unicos,
    # para no quitarles candidatos a un rol de una sola ocurrencia.
    for defi in defs:
        if not defi.get('repetible'):
            continue
        clave = defi['clave']
        libres = sorted([c for c in pares.get(clave, []) if c[1] not in usados and c[3]],
                        key=lambda x: x[1])
        ocurrencias = []
        for pts, j, det, _ in libres:
            usados.add(j)
            ocurrencias.append({'indice': j, 'puntos': pts, 'evidencia': det,
                                'titulo': titulo_visible(secs[j]),
                                'idOcurrencia': str(secs[j].get(defi.get('idOcurrencia') or 'id') or '') or None})
        resueltas.add(clave)
        if ocurrencias:
            asign[clave] = {'repetible': True, 'ocurrencias': ocurrencias,
                            'indice': ocurrencias[0]['indice'],
                            'puntos': ocurrencias[0]['puntos'],
                            'evidencia': ['%d ocurrencia(s)' % len(ocurrencias)],
                            'titulo': ocurrencias[0]['titulo'],
                            'padreContrato': defi.get('padre')}
            sin_id = [o['indice'] for o in ocurrencias if not o['idOcurrencia']]
            if sin_id:
                problemas.append(('OCURRENCIA', clave,
                                  'ocurrencias sin id propio en los indices %s: no se pueden '
                                  'distinguir entre revisiones' % sin_id))
            ids = [o['idOcurrencia'] for o in ocurrencias if o['idOcurrencia']]
            if len(set(ids)) != len(ids):
                problemas.append(('OCURRENCIA', clave, 'ids de ocurrencia repetidos: %s' % ids))
        elif defi.get('obligatoria'):
            problemas.append(('FALTA', clave, 'rol repetible obligatorio sin ninguna ocurrencia'))

    # Lo no resuelto se REPORTA. Nunca se completa con evidencia debil.
    for defi in defs:
        clave = defi['clave']
        if clave in resueltas:
            continue
        libres = [c for c in pares.get(clave, []) if c[1] not in usados]
        fuertes = [c for c in libres if c[3]]
        if fuertes:
            tope = max(f[0] for f in fuertes)
            empatados = [f for f in fuertes if f[0] == tope]
            if len(empatados) > 1:
                problemas.append(('AMBIGUO', clave,
                                  '%d candidatos con la misma evidencia fuerte (indices %s); '
                                  'la posicion no desempata'
                                  % (len(empatados), [e[1] for e in empatados])))
            else:
                problemas.append(('DISPUTADO', clave,
                                  'su mejor candidato (indice %d) lo reclama otro rol con mas evidencia'
                                  % empatados[0][1]))
        elif libres:
            problemas.append(('SIN EVIDENCIA', clave,
                              'hay %d candidato(s) compatibles por tipo (indices %s) pero ninguno '
                              'con prueba de identidad' % (len(libres), [c[1] for c in libres])))
        if defi.get('obligatoria'):
            problemas.append(('FALTA', clave,
                              'obligatoria y sin candidato identificable' if libres
                              else 'ningun candidato compatible'))

    for j, sec in enumerate(secs):
        if j not in usados:
            problemas.append(('SIN ASIGNAR', 'indice %d' % j,
                              'tipo=%r titulo=%r' % (sec.get('tipo'), titulo_visible(sec)[:40])))

    # Parentesco: el contrato PROPONE un padre; aca se comprueba contra el
    # documento. Un padre propuesto no es un parentesco verificado.
    for clave, a in asign.items():
        esperado = a['padreContrato']
        declarado = str(secs[a['indice']].get('padre') or '').strip()
        if esperado is None:
            a['padreVerificado'] = not declarado
            if declarado:
                problemas.append(('PADRE', clave,
                                  'el contrato la pone en la raiz y el documento la cuelga de "%s"'
                                  % declarado))
            continue
        pa = asign.get(esperado)
        if not pa:
            a['padreVerificado'] = False
            problemas.append(('PADRE', clave,
                              'el contrato lo cuelga de "%s", que no quedo asignado' % esperado))
            continue
        if declarado:
            idPadre = str(secs[pa['indice']].get('id') or '')
            a['padreVerificado'] = declarado in (esperado, idPadre)
            if not a['padreVerificado']:
                problemas.append(('PADRE', clave,
                                  'el documento lo cuelga de "%s" y el contrato de "%s"'
                                  % (declarado, esperado)))
        else:
            # Sin padre explicito solo se puede comprobar el orden. Es una
            # comprobacion debil y queda dicho en el resultado.
            a['padreVerificado'] = 'porOrden' if pa['indice'] < a['indice'] else False
            if a['padreVerificado'] is False:
                problemas.append(('PADRE', clave,
                                  '"%s" aparece despues en el documento' % esperado))
    return asign, problemas


DOCUMENTOS = [
    ('fixture URS', 'URS', 'SMART_Validation/js/validation-suite/fixtures/urs-drp-sis-001.json'),
    ('URS real', 'URS', 'C:/Users/fjbon/OneDrive/Escritorio/EMQC_Emara/Proyecto demo 1 - Emara/ai-docs/URS-EMQC-001.json'),
    ('VP real', 'VP', 'contrato-documentos/ejemplos/vp.instancia.valida.json'),
]


def main():
    salida_json = '--json' in sys.argv
    resultado = {}
    hubo = 0
    for etiqueta, tipo, ruta in DOCUMENTOS:
        p = ruta if os.path.isabs(ruta) else os.path.join(RAIZ, ruta)
        if not os.path.exists(p):
            print(f'(no existe) {ruta}')
            continue
        doc = json.load(open(p, encoding='utf-8-sig'))
        asign, problemas = asignar(doc, CONTRATOS[tipo])
        resultado[etiqueta] = {'asignaciones': asign, 'problemas': problemas}
        if salida_json:
            continue
        print(f'\n=== {etiqueta} | {len(doc.get("secciones", []))} secciones ===')
        for clave in CONTRATOS[tipo]['orden']:
            a = asign.get(clave)
            if a:
                print(f'  {clave:32s} <- [{a["indice"]:2d}] {a["titulo"][:34]!r:38s} '
                      f'{a["puntos"]:2d}pts | {", ".join(a["evidencia"])}')
            else:
                print(f'  {clave:32s} <- (sin asignar)')
        for tipo, clave, det in problemas:
            print(f'  {tipo}: {clave} - {det}')
            hubo += 1
    if salida_json:
        print(json.dumps(resultado, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
