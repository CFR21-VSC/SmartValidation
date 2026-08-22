"""
Motor de Paquete de Coherencia GxP — SMART Validation.

Se invoca ANTES de generar cualquier documento nuevo. Analiza todos los
documentos existentes en el proyecto y produce un "Context Pack" que Claude
debe usar para garantizar trazabilidad perfecta:

  1. Inventario de IDs existentes por prefijo (URS, RA, TC-IQ, TC-OQ, TC-PQ)
  2. Próximo ID secuencial disponible (nunca puede haber saltos)
  3. Gaps en secuencias actuales (números que faltan)
  4. IDs válidos para referencias cruzadas
  5. Cobertura actual (qué URS ya tienen TC, cuáles les falta)
  6. Errores de coherencia pre-existentes

Regla GxP fundamental: la secuencia de IDs es un documento auditable.
Un salto (RA-001, RA-003 sin RA-002) es una no-conformidad.
"""

import re
from typing import Any


# ── Patrones de ID (deben coincidir con tracer.py) ────────────────────────────

_URS_RE    = re.compile(r'^URS-(\d+)$')
_URS_NF_RE = re.compile(r'^URS-NF-(\d+)$')
_RA_RE     = re.compile(r'^RA-(\d+)$')
_TC_IQ_RE  = re.compile(r'^TC-IQ-(\d+)$')
_TC_OQ_RE  = re.compile(r'^TC-OQ-(\d+)$')
_TC_PQ_RE  = re.compile(r'^TC-PQ-(\d+)$')
_FRS_RE    = re.compile(r'^FRS-(\d+)$')
_FRS_IF_RE = re.compile(r'^FRS-IF-(\d+)$')
_COMP_RE   = re.compile(r'^COMP-(\d+)$')


def _cell(v: Any) -> str:
    if isinstance(v, dict):
        return str(v.get('text', '')).strip()
    return str(v or '').strip()


# ── Extractores de IDs por tipo de documento ─────────────────────────────────

def _ids_urs(doc: dict) -> list[str]:
    ids = []
    for sec in doc.get('secciones', []):
        for fila in sec.get('filas', []):
            if isinstance(fila, list) and fila:
                v = _cell(fila[0])
            elif isinstance(fila, dict):
                v = str(fila.get('id', fila.get('ursId', ''))).strip()
            else:
                continue
            if _URS_RE.match(v) or _URS_NF_RE.match(v):
                ids.append(v)
    return ids


def _ids_ra(doc: dict) -> list[str]:
    ids = []
    for sec in doc.get('secciones', []):
        for fila in sec.get('filas', []):
            if isinstance(fila, dict):
                v = str(fila.get('id', '')).strip()
            elif isinstance(fila, list) and fila:
                v = _cell(fila[0])
            else:
                continue
            if _RA_RE.match(v):
                ids.append(v)
    return ids


def _ids_tc(doc: dict) -> list[str]:
    ids = []
    for sec in doc.get('secciones', []):
        for tc in sec.get('tcs', []):
            v = str(tc.get('tcId', '')).strip()
            if _TC_IQ_RE.match(v) or _TC_OQ_RE.match(v) or _TC_PQ_RE.match(v):
                ids.append(v)
    return ids


def _ids_frs(doc: dict) -> list[str]:
    ids = []
    for sec in doc.get('secciones', []):
        for fila in sec.get('filas', []):
            if isinstance(fila, list) and fila:
                v = _cell(fila[0])
            elif isinstance(fila, dict):
                v = str(fila.get('id', fila.get('frsId', ''))).strip()
            else:
                continue
            if _FRS_RE.match(v) or _FRS_IF_RE.match(v):
                ids.append(v)
    return ids


def _ids_comp(doc: dict) -> list[str]:
    ids = []
    for sec in doc.get('secciones', []):
        for fila in sec.get('filas', []):
            v = _cell(fila[0]) if isinstance(fila, list) and fila else ''
            if not v and isinstance(fila, dict):
                v = str(fila.get('id', '')).strip()
            if _COMP_RE.match(v):
                ids.append(v)
    return ids


# ── Analizador de secuencias ──────────────────────────────────────────────────

def _analyze_sequence(prefix: str, pattern: re.Pattern, raw_ids: list[str]) -> dict:
    """
    Dado un conjunto de IDs con el mismo prefijo, calcula:
    - existing: lista ordenada
    - nums: números extraídos
    - last: último número
    - nextId: próximo ID válido
    - gaps: números faltantes en la secuencia
    - duplicates: IDs repetidos
    """
    nums: list[int] = []
    seen: dict[str, int] = {}
    for raw_id in raw_ids:
        m = pattern.match(raw_id)
        if m:
            n = int(m.group(1))
            nums.append(n)
            seen[raw_id] = seen.get(raw_id, 0) + 1

    duplicates = [k for k, v in seen.items() if v > 1]
    nums_sorted = sorted(set(nums))

    gaps: list[str] = []
    if nums_sorted:
        for expected in range(1, nums_sorted[-1] + 1):
            if expected not in nums_sorted:
                gaps.append(f"{prefix}-{expected:03d}")

    last = nums_sorted[-1] if nums_sorted else 0
    next_num = last + 1

    # Reconstruir existing en orden
    existing = [f"{prefix}-{n:03d}" for n in nums_sorted]

    return {
        'existing':   existing,
        'count':      len(existing),
        'lastNum':    last,
        'nextId':     f"{prefix}-{next_num:03d}",
        'gaps':       gaps,
        'duplicates': duplicates,
    }


# ── Extracción de referencias cruzadas (qué URS cita cada RA / TC) ───────────

def _ra_urs_links(ra_doc: dict) -> dict[str, list[str]]:
    """RA-ID → [URS-IDs que cita]"""
    links: dict[str, list[str]] = {}
    for sec in ra_doc.get('secciones', []):
        for fila in sec.get('filas', []):
            if isinstance(fila, dict):
                ra_id = str(fila.get('id', '')).strip()
                urs_raw = str(fila.get('urs', fila.get('ursVinculados', '')))
            elif isinstance(fila, list) and len(fila) >= 2:
                ra_id = _cell(fila[0])
                urs_raw = _cell(fila[1])
            else:
                continue
            if not _RA_RE.match(ra_id):
                continue
            refs = [u.strip() for u in re.split(r'[|,;/\s]+', urs_raw)
                    if (_URS_RE.match(u.strip()) or _URS_NF_RE.match(u.strip()))]
            links[ra_id] = refs
    return links


def _tc_links(doc: dict) -> list[dict]:
    """Lista de {tcId, ursVinculados, raVinculado} por TC en protocolos."""
    tcs = []
    for sec in doc.get('secciones', []):
        for tc in sec.get('tcs', []):
            tc_id = str(tc.get('tcId', '')).strip()
            if not (_TC_IQ_RE.match(tc_id) or _TC_OQ_RE.match(tc_id) or _TC_PQ_RE.match(tc_id)):
                continue
            urs_raw = tc.get('ursVinculados', tc.get('ursId', ''))
            if isinstance(urs_raw, list):
                urs_ids = [u for u in urs_raw if _URS_RE.match(str(u)) or _URS_NF_RE.match(str(u))]
            else:
                urs_ids = [u.strip() for u in re.split(r'[,;/\s]+', str(urs_raw))
                           if _URS_RE.match(u.strip()) or _URS_NF_RE.match(u.strip())]
            ra_id = str(tc.get('raVinculado', tc.get('raId', ''))).strip()
            tcs.append({'tcId': tc_id, 'ursVinculados': urs_ids, 'raVinculado': ra_id})
    return tcs


# ── Constructor del Context Pack ──────────────────────────────────────────────

def build_coherence_pack(
    documents:        dict[str, Any],
    project_id:       str = '',
    generating_for:   str = '',
) -> dict:
    """
    Entrada: dict doc_type → documento JSON (misma firma que AnalyzeRequest.documents).
    Salida: Context Pack completo para inyectar en el prompt de generación.
    """

    # 1. Cosechar todos los IDs por prefijo
    all_urs:   list[str] = []
    all_urs_nf: list[str] = []
    all_ra:    list[str] = []
    all_tc_iq: list[str] = []
    all_tc_oq: list[str] = []
    all_tc_pq: list[str] = []
    all_frs:   list[str] = []
    all_frs_if: list[str] = []
    all_comp:  list[str] = []

    ra_urs_links:   dict[str, list[str]] = {}
    all_tc_details: list[dict] = []

    # Deduplicar TCs cross-documento: el mismo TC-OQ-001 en POQ e IOQ es esperado,
    # no es un duplicado real. Solo contar cada tcId una vez en el inventario.
    _seen_iq: set[str] = set()
    _seen_oq: set[str] = set()
    _seen_pq: set[str] = set()

    DOC_ORDER = ('URS', 'FRS', 'HLRA', 'RA', 'IRA',
                 'PIQ', 'POQ', 'PPQ', 'IOQ',
                 'MTR', 'VSR', 'ROQ')

    for doc_type in DOC_ORDER:
        doc = documents.get(doc_type)
        if not doc or not isinstance(doc, dict):
            continue

        if doc_type == 'URS':
            for v in _ids_urs(doc):
                (all_urs_nf if _URS_NF_RE.match(v) else all_urs).append(v)

        elif doc_type == 'FRS':
            for v in _ids_frs(doc):
                (all_frs_if if _FRS_IF_RE.match(v) else all_frs).append(v)

        elif doc_type in ('HLRA', 'RA'):
            all_ra.extend(_ids_ra(doc))
            ra_urs_links.update(_ra_urs_links(doc))

        elif doc_type == 'IRA':
            all_comp.extend(_ids_comp(doc))

        elif doc_type in ('PIQ', 'POQ', 'PPQ', 'IOQ'):
            tcs = _ids_tc(doc)
            for v in tcs:
                if _TC_IQ_RE.match(v) and v not in _seen_iq:
                    all_tc_iq.append(v); _seen_iq.add(v)
                elif _TC_OQ_RE.match(v) and v not in _seen_oq:
                    all_tc_oq.append(v); _seen_oq.add(v)
                elif _TC_PQ_RE.match(v) and v not in _seen_pq:
                    all_tc_pq.append(v); _seen_pq.add(v)
            all_tc_details.extend(_tc_links(doc))

    # 2. Analizar secuencias (detectar gaps, duplicados, próximo ID)
    seq_urs    = _analyze_sequence('URS',    _URS_RE,    all_urs)
    seq_urs_nf = _analyze_sequence('URS-NF', _URS_NF_RE, all_urs_nf)
    seq_ra     = _analyze_sequence('RA',     _RA_RE,     all_ra)
    seq_tc_iq  = _analyze_sequence('TC-IQ',  _TC_IQ_RE,  all_tc_iq)
    seq_tc_oq  = _analyze_sequence('TC-OQ',  _TC_OQ_RE,  all_tc_oq)
    seq_tc_pq  = _analyze_sequence('TC-PQ',  _TC_PQ_RE,  all_tc_pq)
    seq_frs    = _analyze_sequence('FRS',    _FRS_RE,    all_frs)
    seq_frs_if = _analyze_sequence('FRS-IF', _FRS_IF_RE, all_frs_if)
    seq_comp   = _analyze_sequence('COMP',   _COMP_RE,   all_comp)

    # 3. Calcular cobertura de URS
    urs_with_iq:  set[str] = set()
    urs_with_oq:  set[str] = set()
    urs_with_pq:  set[str] = set()
    ra_with_tc:   set[str] = set()

    for tc in all_tc_details:
        for urs_id in tc['ursVinculados']:
            if _TC_IQ_RE.match(tc['tcId']):  urs_with_iq.add(urs_id)
            elif _TC_OQ_RE.match(tc['tcId']): urs_with_oq.add(urs_id)
            elif _TC_PQ_RE.match(tc['tcId']): urs_with_pq.add(urs_id)
        if tc['raVinculado'] and _RA_RE.match(tc['raVinculado']):
            ra_with_tc.add(tc['raVinculado'])

    all_urs_ids = seq_urs['existing'] + seq_urs_nf['existing']
    all_ra_ids  = seq_ra['existing']

    urs_without_iq = [u for u in all_urs_ids if u not in urs_with_iq]
    urs_without_oq = [u for u in all_urs_ids if u not in urs_with_oq]
    urs_without_pq = [u for u in all_urs_ids if u not in urs_with_pq]
    ra_without_tc  = [r for r in all_ra_ids  if r not in ra_with_tc]

    # 4. Detectar referencias cruzadas inválidas en TCs existentes
    reference_errors: list[dict] = []
    for tc in all_tc_details:
        for urs_id in tc['ursVinculados']:
            if urs_id not in all_urs_ids:
                reference_errors.append({
                    'tcId':  tc['tcId'],
                    'issue': f"Referencia a {urs_id} que NO existe en el URS",
                    'severity': 'CRITICO',
                })
        ra_id = tc['raVinculado']
        if ra_id and _RA_RE.match(ra_id) and ra_id not in all_ra_ids:
            reference_errors.append({
                'tcId':  tc['tcId'],
                'issue': f"Referencia a {ra_id} que NO existe en el RA",
                'severity': 'CRITICO',
            })

    # 5. Detectar RA con referencias URS inválidas
    for ra_id, urs_refs in ra_urs_links.items():
        for urs_id in urs_refs:
            if urs_id not in all_urs_ids:
                reference_errors.append({
                    'raId':  ra_id,
                    'issue': f"Referencia a {urs_id} que NO existe en el URS",
                    'severity': 'CRITICO',
                })

    # 6. Recopilar todos los gaps de secuencia
    sequence_gaps: list[dict] = []
    for name, seq in [
        ('URS', seq_urs), ('URS-NF', seq_urs_nf), ('RA', seq_ra),
        ('TC-IQ', seq_tc_iq), ('TC-OQ', seq_tc_oq), ('TC-PQ', seq_tc_pq),
        ('FRS', seq_frs), ('FRS-IF', seq_frs_if),
    ]:
        if seq['gaps']:
            sequence_gaps.append({
                'prefix':  name,
                'missing': seq['gaps'],
                'severity': 'CRITICO',
                'detail': (
                    f"Secuencia {name} tiene saltos: faltan {seq['gaps']}. "
                    "Un auditor GxP marcará esto como NC."
                ),
            })
        if seq['duplicates']:
            sequence_gaps.append({
                'prefix':    name,
                'duplicates': seq['duplicates'],
                'severity':  'CRITICO',
                'detail':    f"IDs duplicados en {name}: {seq['duplicates']}",
            })

    # 7. Armar constraints de generación por tipo de documento
    generating_constraints = _constraints_for(
        generating_for,
        seq_urs, seq_urs_nf, seq_ra,
        seq_tc_iq, seq_tc_oq, seq_tc_pq,
        seq_frs, seq_frs_if,
        all_urs_ids, all_ra_ids,
    )

    return {
        'projectId':        project_id,
        'generatingFor':    generating_for,
        'idInventory': {
            'URS':    seq_urs,
            'URS-NF': seq_urs_nf,
            'RA':     seq_ra,
            'TC-IQ':  seq_tc_iq,
            'TC-OQ':  seq_tc_oq,
            'TC-PQ':  seq_tc_pq,
            'FRS':    seq_frs,
            'FRS-IF': seq_frs_if,
            'COMP':   seq_comp,
        },
        'validReferenceIds': {
            'allUrsIds':    all_urs_ids,
            'allRaIds':     all_ra_ids,
            'allFrsIds':    seq_frs['existing'] + seq_frs_if['existing'],
            'raUrsLinks':   ra_urs_links,
        },
        'coverage': {
            'ursWithIQ':    sorted(urs_with_iq),
            'ursWithoutIQ': urs_without_iq,
            'ursWithOQ':    sorted(urs_with_oq),
            'ursWithoutOQ': urs_without_oq,
            'ursWithPQ':    sorted(urs_with_pq),
            'ursWithoutPQ': urs_without_pq,
            'raWithTc':     sorted(ra_with_tc),
            'raWithoutTc':  ra_without_tc,
        },
        'sequenceGaps':      sequence_gaps,
        'referenceErrors':   reference_errors,
        'generationConstraints': generating_constraints,
        'isClean': not sequence_gaps and not reference_errors,
    }


def _constraints_for(
    doc_type: str,
    seq_urs, seq_urs_nf, seq_ra,
    seq_tc_iq, seq_tc_oq, seq_tc_pq,
    seq_frs, seq_frs_if,
    all_urs_ids: list[str],
    all_ra_ids:  list[str],
) -> dict:
    """Reglas específicas para cada tipo de documento a generar."""

    base = {
        'absoluteRules': [
            "Todos los IDs deben ser secuenciales sin saltos. Si el último es X-005, el siguiente es X-006.",
            "Solo se pueden referenciar IDs que existen en 'validReferenceIds'.",
            "Cada TC debe vincular ≥ 1 URS ID existente y ≥ 1 RA ID existente.",
            "No inventar IDs que no estén asignados por este Context Pack.",
            "El texto de los TCs debe ser 100% coherente con la descripción del URS vinculado.",
        ],
    }

    if doc_type in ('PIQ', 'IOQ') or 'IQ' in doc_type:
        base.update({
            'nextTcId':      seq_tc_iq['nextId'],
            'lastTcId':      f"TC-IQ-{seq_tc_iq['lastNum']:03d}" if seq_tc_iq['lastNum'] else None,
            'tcPrefix':      'TC-IQ',
            'ursIdsToUse':   all_urs_ids,
            'raIdsToUse':    all_ra_ids,
            'focusOn':       'Verificar instalación física: hardware, software, infraestructura, accesos',
        })
    elif doc_type in ('POQ', ) or 'OQ' in doc_type:
        base.update({
            'nextTcId':      seq_tc_oq['nextId'],
            'lastTcId':      f"TC-OQ-{seq_tc_oq['lastNum']:03d}" if seq_tc_oq['lastNum'] else None,
            'tcPrefix':      'TC-OQ',
            'ursIdsToUse':   all_urs_ids,
            'raIdsToUse':    all_ra_ids,
            'focusOn':       'Verificar funcionamiento operacional: funcionalidades, flujos, alertas, cálculos',
        })
    elif 'PQ' in doc_type:
        base.update({
            'nextTcId':      seq_tc_pq['nextId'],
            'tcPrefix':      'TC-PQ',
            'ursIdsToUse':   all_urs_ids,
            'raIdsToUse':    all_ra_ids,
            'focusOn':       'Verificar rendimiento en condiciones reales de producción',
        })
    elif doc_type == 'RA':
        base.update({
            'nextRaId':    seq_ra['nextId'],
            'ursIdsToUse': all_urs_ids,
            'focusOn':     'Cada riesgo debe vincularse a ≥ 1 URS ID existente',
        })
    elif doc_type == 'URS':
        base.update({
            'nextUrsId':   seq_urs['nextId'],
            'nextUrNfId':  seq_urs_nf['nextId'],
            'focusOn':     'Requisitos funcionales (URS-NNN) y no funcionales (URS-NF-NNN)',
        })
    elif doc_type == 'FRS':
        base.update({
            'nextFrsId':    seq_frs['nextId'],
            'ursIdsToUse':  all_urs_ids,
            'focusOn':      'Cada requisito FRS debe trazar a ≥ 1 URS existente en columna "URS Origen"',
        })
    elif doc_type == 'MTR':
        base.update({
            'ursIdsToUse': all_urs_ids,
            'raIdsToUse':  all_ra_ids,
            'focusOn':     'La MTR es la fuente canónica GxP. Cada fila = un URS. Completar tcIQ, tcOQ, tcPQ con IDs existentes',
        })

    return base
