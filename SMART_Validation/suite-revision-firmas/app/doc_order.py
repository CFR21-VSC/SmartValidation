"""Orden canónico de tipos de documento GxP -- mismo criterio de cascada que ya usa la Suite
de Validación (`CASCADE_ORDER` en `js/doc-workflow.js`, cliente), acá del lado del servidor
porque Firmas ordena en SQL/Python, no tiene ese JS cargado.

Reemplaza el `ORDER BY doc_type` alfabético que traía cada listado de documentos -- alfabético
mezclaba, por ejemplo, IOQ antes que HLRA o RA antes que RIQ, sin relación con el orden real en
que un proyecto avanza (reportado por el usuario, 2026-09-19: "quiero que el orden lo dé yo, no
el alfabético, para que no se confunda la gente"). Este es el orden que la gente espera ver --
no un ordenamiento arbitrario por proyecto todavía (eso sería una feature más grande, a pedido
explícito si hace falta)."""

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


def doc_type_sort_key(doc_type: str):
    """Tipos no reconocidos (documentos nuevos que todavía no se agregaron acá) caen al final,
    ordenados alfabéticamente entre sí -- nunca se pierden, solo no tienen posición fija."""
    return (_ORDER_INDEX.get(doc_type, len(DOC_TYPE_ORDER)), doc_type or "")


def sort_docs(rows: list) -> list:
    """Ordena una lista de filas (dict-like, con clave "doc_type") según DOC_TYPE_ORDER."""
    return sorted(rows, key=lambda r: doc_type_sort_key(r["doc_type"]))
