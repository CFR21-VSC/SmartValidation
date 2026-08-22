"""
Motor de trazabilidad GxP.
Analiza documentos JSON del ciclo de validación y produce:
  - Matriz URS ↔ RA ↔ TC (IQ / OQ / PQ)
  - Gaps de cobertura y riesgos sin mitigar
  - Problemas de coherencia de protocolos
  - Elementos huérfanos en el Excel de ejecución
"""

import re
import base64
import io
from typing import Any

import openpyxl

from .models import (
    TraceabilityGap, CoherenceIssue, ExecutionGap,
    TraceabilityStats, MatrixRow,
)

URS_RE    = re.compile(r'^URS-(\d+)$')
URS_NF_RE = re.compile(r'^URS-NF-(\d+)$')
RA_RE     = re.compile(r'^RA-(\d+)$')
TC_RE     = re.compile(r'^TC-(IQ|OQ|PQ)-\d+$')

RISK_DEPTH = {
    'CRÍTICO': 'Exhaustiva',
    'CRITICO': 'Exhaustiva',
    'ALTO':    'Estándar',
    'MEDIO':   'Básica',
    'BAJO':    'Básica',
}

# Algunos protocolos guardan el score del riesgo como profundidad en vez del
# nombre de profundidad. Normalizamos antes de comparar.
_DEPTH_ALIAS = {
    'CRÍTICO': 'Exhaustiva', 'CRITICO': 'Exhaustiva',
    'ALTO':    'Estándar',
    'MEDIO':   'Básica',     'BAJO': 'Básica',
    'EXHAUSTIVA': 'Exhaustiva',
    'ESTÁNDAR': 'Estándar',  'ESTANDAR': 'Estándar',
    'BÁSICA': 'Básica',      'BASICA': 'Básica',
}
_DEPTH_LEVEL = {'Exhaustiva': 3, 'Estándar': 2, 'Básica': 1}


def _text(cell) -> str:
    """Extrae texto de una celda, que puede ser str, dict con 'text', o número."""
    if isinstance(cell, dict):
        return str(cell.get('text', '')).strip()
    return str(cell or '').strip()


def _is_urs(s: str) -> bool:
    return bool(URS_RE.match(s) or URS_NF_RE.match(s))


def _score_from_spd(s, p, d) -> str:
    """Convierte S×P×D en etiqueta de score GxP."""
    ri = int(s or 1) * int(p or 1) * int(d or 1)
    if ri >= 9:
        return 'CRÍTICO'
    if ri >= 5:
        return 'ALTO'
    if ri >= 3:
        return 'MEDIO'
    return 'BAJO'


# ── Extractores ──────────────────────────────────────────────────────────────

def _extract_urs_rows(urs_doc: dict) -> list[dict]:
    """Extrae filas de URS: {ursId, description, tipo}."""
    rows = []
    for sec in urs_doc.get('secciones', []):
        for fila in sec.get('filas', []):
            if not isinstance(fila, list) or not fila:
                continue
            urs_id = _text(fila[0])
            if not _is_urs(urs_id):
                continue
            desc = _text(fila[1]) if len(fila) > 1 else ''
            tipo = 'NF' if URS_NF_RE.match(urs_id) else 'F'
            rows.append({'ursId': urs_id, 'description': desc, 'tipo': tipo})
    return rows


def _extract_urs_ids(urs_doc: dict) -> list[str]:
    return [r['ursId'] for r in _extract_urs_rows(urs_doc)]


def _extract_ra_risks(ra_doc: dict) -> dict[str, dict]:
    """
    Retorna { raId: { score: str, ursIds: [str] } }.
    Soporta filas como objetos { id, urs, S, P, D, RR } O como arrays.
    """
    risks: dict[str, dict] = {}
    for sec in ra_doc.get('secciones', []):
        for fila in sec.get('filas', []):
            if isinstance(fila, dict):
                # Formato objeto: { "id": "RA-001", "urs": "URS-001", "S": 3, "P": 2, "D": 2 }
                ra_id = str(fila.get('id', '')).strip()
                if not RA_RE.match(ra_id):
                    continue
                urs_raw = str(fila.get('urs', ''))
                urs_ids = [u.strip() for u in re.split(r'[|,;/\s]+', urs_raw)
                           if u.strip() and _is_urs(u.strip())]
                score = _score_from_spd(fila.get('S', 1), fila.get('P', 1), fila.get('D', 1))
                risks[ra_id] = {'score': score, 'ursIds': urs_ids}

            elif isinstance(fila, list) and len(fila) >= 2:
                # Formato array heredado: [{ text: "RA-001" }, ..., { text: "CRÍTICO" }]
                ra_id = _text(fila[0])
                if not RA_RE.match(ra_id):
                    continue
                score = _text(fila[-1]).upper()
                risks[ra_id] = {'score': score, 'ursIds': []}

    return risks


def _extract_tcs_from_protocol(proto_doc: dict) -> list[dict]:
    """
    Extrae TCs de un protocolo (PIQ/POQ/PPQ).
    Deduplica por tcId para evitar contar TCs que aparecen en múltiples secciones.
    """
    seen: set[str] = set()
    tcs: list[dict] = []
    for sec in proto_doc.get('secciones', []):
        for tc in sec.get('tcs', []):
            tc_id = str(tc.get('tcId', '')).strip()
            if not TC_RE.match(tc_id) or tc_id in seen:
                continue
            seen.add(tc_id)

            urs_raw = tc.get('ursVinculados', tc.get('ursId', ''))
            if isinstance(urs_raw, list):
                urs_ids = [u.strip() for u in urs_raw if str(u).strip()]
            else:
                urs_ids = [u.strip() for u in re.split(r'[,;/\s]+', str(urs_raw))
                           if u.strip() and _is_urs(u.strip())]

            phase = 'IQ' if '-IQ-' in tc_id else ('OQ' if '-OQ-' in tc_id else 'PQ')
            tcs.append({
                'tcId':          tc_id,
                'ursVinculados': urs_ids,
                'raVinculado':   str(tc.get('raVinculado', tc.get('raId', ''))).strip(),
                'nivel':         str(tc.get('profundidad', tc.get('nivel', tc.get('nivelPrueba', '')))).strip(),
                'phase':         phase,
            })
    return tcs


def _extract_mtr_rows(mtr_doc: dict) -> list[dict]:
    """
    Extrae filas de la MTR.
    Soporta dos formatos:
      - dict moderno: { ursId, tcIq, tcOq, tcPq, raId, criticidad, modulo, ... }
      - array legacy: [{ text: "URS-001" }, ..., tcIq_cell, tcOq_cell, tcPq_cell]
    """
    rows = []
    for sec in mtr_doc.get('secciones', []):
        if sec.get('tipo') not in ('tabla-trazabilidad', 'tabla', None):
            pass  # incluir igualmente — puede ser cualquier sección con filas
        for fila in sec.get('filas', []):
            if isinstance(fila, dict):
                # Formato moderno (tabla-trazabilidad)
                if fila.get('subheader') is not None:
                    continue  # separador de módulo, ignorar
                urs_id = str(fila.get('ursId', '')).strip()
                if not _is_urs(urs_id):
                    continue
                rows.append({
                    'ursId': urs_id,
                    'tcIQ':  str(fila.get('tcIq', fila.get('tcIQ', '—'))).strip(),
                    'tcOQ':  str(fila.get('tcOq', fila.get('tcOQ', '—'))).strip(),
                    'tcPQ':  str(fila.get('tcPq', fila.get('tcPQ', '—'))).strip(),
                })
            elif isinstance(fila, list) and fila:
                # Formato legacy: lista de celdas { text: "..." }
                urs_id = _text(fila[0])
                if not _is_urs(urs_id):
                    continue
                rows.append({
                    'ursId': urs_id,
                    'tcIQ':  _text(fila[2]) if len(fila) > 2 else '—',
                    'tcOQ':  _text(fila[3]) if len(fila) > 3 else '—',
                    'tcPQ':  _text(fila[4]) if len(fila) > 4 else '—',
                })
    return rows


# ── Análisis principal ────────────────────────────────────────────────────────

def analyze(documents: dict[str, Any], excel_b64: str | None) -> dict:
    gaps: list[TraceabilityGap]     = []
    coherence: list[CoherenceIssue] = []
    exec_gaps: list[ExecutionGap]   = []

    urs_doc = documents.get('urs', {})
    ra_doc  = documents.get('ra',  {})
    mtr_doc = documents.get('mtr', {})

    urs_rows    = _extract_urs_rows(urs_doc)
    urs_row_map = {r['ursId']: r for r in urs_rows}
    all_urs_ids = set(urs_row_map.keys())
    ra_risks    = _extract_ra_risks(ra_doc)
    mtr_rows    = _extract_mtr_rows(mtr_doc)

    # Recopilar TCs de todos los protocolos (con deduplicación interna por protocolo)
    proto_keys = [k for k in documents
                  if re.match(r'^(piq|poq|ppq)(-mod\d+)?$', k)]
    all_tcs: list[dict] = []
    global_seen: set[str] = set()
    for k in proto_keys:
        for tc in _extract_tcs_from_protocol(documents[k]):
            if tc['tcId'] not in global_seen:
                global_seen.add(tc['tcId'])
                all_tcs.append(tc)

    tcs_by_id   = {tc['tcId']: tc for tc in all_tcs}

    # Cobertura desde TCs (ursVinculados explícitos en el protocolo)
    urs_with_tc: set[str] = set()
    for tc in all_tcs:
        urs_with_tc.update(tc['ursVinculados'])

    # Cobertura desde MTR (fuente canónica GxP): agrega URS con TC-OQ o TC-IQ asignado.
    # Un URS en la MTR con cualquier TC asignado cuenta como cubierto —
    # la MTR es el documento de trazabilidad oficial, su criterio prevalece.
    NOT_ASSIGNED = {'', '—', '-', '--', 'n/a', 'na'}
    for row in mtr_rows:
        if row['tcOQ'].lower() not in NOT_ASSIGNED or row['tcIQ'].lower() not in NOT_ASSIGNED:
            urs_with_tc.add(row['ursId'])

    tc_by_phase: dict[str, int] = {'IQ': 0, 'OQ': 0, 'PQ': 0}
    for tc in all_tcs:
        tc_by_phase[tc['phase']] = tc_by_phase.get(tc['phase'], 0) + 1

    # Mapa inverso RA → URS y URS → RA
    ra_to_urs: dict[str, list[str]] = {rid: d['ursIds'] for rid, d in ra_risks.items()}
    urs_to_ra: dict[str, list[str]] = {}
    for ra_id, data in ra_risks.items():
        for u in data['ursIds']:
            urs_to_ra.setdefault(u, []).append(ra_id)

    # ── Gap 1: URS sin ningún TC ──────────────────────────────────────────
    # URS-NF (no funcionales) normalmente se verifican por auditoría de
    # configuración / performance / seguridad, no por IQ/OQ clásicos.
    # Se reportan como MENOR para no distorsionar el score.
    for urs_id in sorted(all_urs_ids - urs_with_tc):
        is_nf = bool(URS_NF_RE.match(urs_id))
        gaps.append(TraceabilityGap(
            ursId=urs_id,
            description=(
                f'{urs_id} no tiene TC asignado en la MTR ni en los protocolos.'
                + (' (Req. No Funcional — verificación alternativa aceptable)' if is_nf else '')
            ),
            phase='MTR',
            severity='MENOR' if is_nf else 'CRITICO',
        ))

    # TC sin URS no es un hallazgo: un TC puede verificar infraestructura
    # o componentes sin mapear 1:1 a un URS (es válido GxP).
    orphaned_tc = [tc['tcId'] for tc in all_tcs if not tc['ursVinculados']]

    # ── Gap 3: Riesgos RA sin TC mitigante ───────────────────────────────
    ra_ids_mitigated = {tc['raVinculado'] for tc in all_tcs if tc['raVinculado']}
    unmitigated = [rid for rid in ra_risks if rid not in ra_ids_mitigated]
    for rid in unmitigated:
        score = ra_risks[rid]['score']
        sev   = 'CRITICO' if score in ('CRÍTICO', 'CRITICO') else 'MAYOR' if score == 'ALTO' else 'MENOR'
        gaps.append(TraceabilityGap(
            ursId=rid,
            description=f'Riesgo {rid} ({score}) sin caso de prueba mitigante.',
            phase='RA',
            severity=sev,
        ))

    # ── Gap 4: Coherencia profundidad TC vs score de riesgo ──────────────
    # Solo se flaggea sub-testing (profundidad menor a la requerida).
    # Si el TC declara mayor profundidad (sobre-testing) no es un defecto GxP.
    for tc in all_tcs:
        ra_id = tc['raVinculado']
        if not ra_id or ra_id not in ra_risks:
            continue
        expected_name  = RISK_DEPTH.get(ra_risks[ra_id]['score'].upper())
        if not expected_name:
            continue
        actual_raw     = tc['nivel'].strip().upper()
        actual_name    = _DEPTH_ALIAS.get(actual_raw)
        if not actual_name:
            continue
        actual_level   = _DEPTH_LEVEL.get(actual_name, 0)
        expected_level = _DEPTH_LEVEL.get(expected_name, 0)
        if actual_level < expected_level:
            coherence.append(CoherenceIssue(
                docType='Protocolo',
                tcId=tc['tcId'],
                issue=(f'{tc["tcId"]}: profundidad "{actual_name}" insuficiente — '
                       f'{ra_id} ({ra_risks[ra_id]["score"]}) requiere "{expected_name}".'),
                severity='MAYOR',
            ))

    # ── Gap 5: MTR vs protocolos ──────────────────────────────────────────
    if mtr_rows and all_tcs:
        mtr_urs_ids = {r['ursId'] for r in mtr_rows}
        for urs_id in sorted(urs_with_tc - mtr_urs_ids):
            gaps.append(TraceabilityGap(
                ursId=urs_id,
                description=f'{urs_id} tiene TC en protocolo pero no está en la MTR.',
                phase='MTR',
                severity='MAYOR',
            ))

    # ── Gap 6: Excel de ejecución ─────────────────────────────────────────
    if excel_b64:
        try:
            raw = base64.b64decode(excel_b64)
            wb  = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
            ws  = wb.active
            rows_iter = ws.iter_rows(values_only=True)
            headers   = [str(h or '').strip() for h in next(rows_iter, [])]
            tc_col    = next((h for h in headers if 'tc' in h.lower() or 'caso' in h.lower()), None)
            res_col   = next((h for h in headers if 'result' in h.lower() or 'estado' in h.lower()), None)

            if tc_col and res_col:
                tc_idx, res_idx  = headers.index(tc_col), headers.index(res_col)
                executed_ids: set[str] = set()
                valid_results = {'PASA', 'NO PASA', 'PASA CON OBSERVACIONES', 'N/A'}

                for row in rows_iter:
                    tc_id  = str(row[tc_idx]  or '').strip()
                    result = str(row[res_idx] or '').strip().upper()
                    if tc_id:
                        executed_ids.add(tc_id)
                    if TC_RE.match(tc_id) and result not in valid_results:
                        exec_gaps.append(ExecutionGap(tcId=tc_id, docType='Ejecución', issue='RESULTADO_INVALIDO'))

                for tc_id in sorted(set(tcs_by_id.keys()) - executed_ids):
                    exec_gaps.append(ExecutionGap(
                        tcId=tc_id,
                        docType=tcs_by_id[tc_id]['phase'],
                        issue='SIN_RESULTADO',
                    ))
        except Exception as e:
            coherence.append(CoherenceIssue(docType='Excel', issue=f'Error procesando Excel: {e}', severity='MENOR'))

    # ── Matriz de trazabilidad ────────────────────────────────────────────
    matrix: list[MatrixRow] = []
    for urs_id in sorted(all_urs_ids):
        tcs_for_urs = [tc for tc in all_tcs if urs_id in tc['ursVinculados']]
        tc_iq = sorted({tc['tcId'] for tc in tcs_for_urs if tc['phase'] == 'IQ'})
        tc_oq = sorted({tc['tcId'] for tc in tcs_for_urs if tc['phase'] == 'OQ'})
        tc_pq = sorted({tc['tcId'] for tc in tcs_for_urs if tc['phase'] == 'PQ'})
        ra_ids = urs_to_ra.get(urs_id, [])
        ra_id  = ra_ids[0] if ra_ids else '—'
        ra_scr = ra_risks[ra_id]['score'] if ra_id != '—' else '—'
        urs_meta = urs_row_map.get(urs_id, {})
        matrix.append(MatrixRow(
            ursId=urs_id,
            description=urs_meta.get('description', ''),
            tipo=urs_meta.get('tipo', 'F'),
            raVinculado=ra_id,
            raScore=ra_scr,
            tcIQ=tc_iq,
            tcOQ=tc_oq,
            tcPQ=tc_pq,
            covered=bool(tcs_for_urs),
            covIQ=bool(tc_iq),
            covOQ=bool(tc_oq),
            covPQ=bool(tc_pq),
        ))

    # ── Score y status ────────────────────────────────────────────────────
    # Score: 70% cobertura URS + 30% mitigación de riesgos + penalización por
    # issues de profundidad (max -10 pts). Se premia que lo crítico esté cubierto.
    urs_total_n  = max(len(all_urs_ids), 1)
    ra_total_n   = max(len(ra_risks), 1)
    urs_cov_pct  = len(urs_with_tc & all_urs_ids) / urs_total_n
    risk_mit_pct = (len(ra_risks) - len(unmitigated)) / ra_total_n if ra_risks else 1.0
    depth_penalty = min(10, len(coherence))
    exec_penalty  = min(10, len(exec_gaps))
    base_score   = int(urs_cov_pct * 70 + risk_mit_pct * 30)
    score        = max(0, base_score - depth_penalty - exec_penalty)

    # Riesgos críticos/altos sin mitigar = GAPS_FOUND
    critical_risks_unmitigated = any(
        ra_risks[r]['score'].upper().replace('Í','I') in ('CRITICO', 'ALTO')
        for r in unmitigated
    )
    # Solo los URS funcionales sin TC son GAPS_FOUND.
    # Los URS-NF sin TC son WARNINGS (verificación alternativa aceptable).
    uncovered = all_urs_ids - urs_with_tc
    urs_func_uncovered  = bool(u for u in uncovered if not URS_NF_RE.match(u))
    urs_nf_uncovered    = bool(u for u in uncovered if URS_NF_RE.match(u))

    if urs_func_uncovered or critical_risks_unmitigated:
        status = 'GAPS_FOUND'
    elif urs_nf_uncovered or coherence or exec_gaps or unmitigated:
        status = 'WARNINGS'
    else:
        status = 'OK'

    urs_covered = len(urs_with_tc & all_urs_ids)
    urs_total   = len(all_urs_ids)

    stats = TraceabilityStats(
        ursTotal=urs_total,
        ursWithTC=urs_covered,
        ursCoverage=round(urs_covered / urs_total * 100, 1) if urs_total else 100.0,
        orphanedURS=sorted(all_urs_ids - urs_with_tc),
        orphanedTC=orphaned_tc,
        risksMitigated=len(ra_risks) - len(unmitigated),
        risksTotal=len(ra_risks),
        unmitigatedRisks=unmitigated,
        tcByPhase=tc_by_phase,
    )

    parts = []
    if status == 'OK':
        parts = [f'Trazabilidad completa — {urs_covered}/{urs_total} URS cubiertos, {len(ra_risks)} riesgos mitigados ✓']
    else:
        parts.append(f'Cobertura URS: {stats.ursCoverage}% ({urs_covered}/{urs_total})')
        if stats.orphanedURS:
            parts.append(f'{len(stats.orphanedURS)} URS sin ningún TC asignado')
        parts.append(f'Riesgos mitigados: {len(ra_risks) - len(unmitigated)}/{len(ra_risks)}')
        if unmitigated:
            parts.append(f'{len(unmitigated)} riesgos sin mitigar')
        if coherence:
            parts.append(f'{len(coherence)} observaciones de coherencia')
        if exec_gaps:
            parts.append(f'{len(exec_gaps)} gaps en ejecución')

    return {
        'stats':     stats,
        'matrix':    matrix,
        'gaps':      gaps,
        'coherence': coherence,
        'execGaps':  exec_gaps,
        'score':     score,
        'status':    status,
        'summary':   ' | '.join(parts),
    }
