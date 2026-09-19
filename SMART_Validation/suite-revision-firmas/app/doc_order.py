"""Orden de tipos de documento GxP.

Dos niveles: el orden de CASCADA (mismo criterio que ya usa la Suite de Validación,
`CASCADE_ORDER` en `js/doc-workflow.js`, cliente) es el DEFAULT hasta que DRP reordena a mano
un proyecto puntual (`rf_documents.display_order`, pedido explícito del usuario, 2026-09-19:
"quiero poder reordenar a piacere y que se guarde" -- la primera versión de esto solo traía el
orden de cascada fijo, sin poder tocarlo, y no era lo que había pedido). Reemplaza el
`ORDER BY doc_type` alfabético que traía cada listado de documentos -- alfabético mezclaba,
por ejemplo, IOQ antes que HLRA o RA antes que RIQ, sin relación con el orden real en que un
proyecto avanza."""

DOC_TYPE_ORDER = [
    "HLRA", "VP", "URS", "FRS", "DS",
    "RA", "IRA", "RRM",
    "MTR",
    "PIQ", "POQ", "PPQ",
    "IIQ", "IOQ", "IPQ",
    "RIQ", "ROQ", "RPQ",
    "NCR", "VSR",
    "EVRA", "EVPROT", "EVIR",
]

_ORDER_INDEX = {t: i for i, t in enumerate(DOC_TYPE_ORDER)}


def doc_type_sort_key(doc_type: str, display_order=None):
    """Con display_order fijado a mano (DRP reordenó este proyecto), ESE valor manda, por
    encima de la cascada -- documentos custom-ordenados siempre van antes que cualquiera sin
    tocar. Sin display_order (nunca se reordenó, o es un documento nuevo agregado después del
    último reordenamiento), cae a la cascada GxP; tipos no reconocidos ahí caen al final,
    ordenados alfabéticamente entre sí -- nunca se pierden, solo no tienen posición fija."""
    if display_order is not None:
        return (0, display_order, doc_type or "")
    return (1, _ORDER_INDEX.get(doc_type, len(DOC_TYPE_ORDER)), doc_type or "")


def sort_docs(rows: list) -> list:
    """Ordena una lista de filas (dict-like, con claves "doc_type" y opcionalmente
    "display_order") según el criterio de doc_type_sort_key."""
    return sorted(rows, key=lambda r: doc_type_sort_key(r["doc_type"], r.get("display_order")))
