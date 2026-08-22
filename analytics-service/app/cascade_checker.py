"""
Validador de coherencia en cascada GxP.
Compara pares de documentos consecutivos en el ciclo y detecta inconsistencias
que un auditor marcaría como NC (Non-Conformity) o Observación.

Cadena: HLRA → VP → URS → RA → (IRA → PIQ) → (VP scope → protocolos)
"""

import re
from typing import Any
from .models import CascadeIssue


def _gamp_num(s: str) -> int | None:
    m = re.search(r'GAMP\s*(\d)', str(s or ''), re.I)
    return int(m.group(1)) if m else None


def _pkg(doc: dict, field: str, default: str = '') -> str:
    return str(doc.get('package', {}).get(field, default) or default).strip()


def _docfield(doc: dict, field: str, default: str = '') -> str:
    return str(doc.get('document', {}).get(field, default) or default).strip()


def _extras(doc: dict) -> dict:
    return doc.get('document', {}).get('extras', {}) or {}


def _iro_from_factores(hlra: dict) -> int | None:
    """Calcula el IRO multiplicando los valores de los factores del HLRA."""
    for sec in hlra.get('secciones', []):
        factores = sec.get('factores')
        if not factores:
            continue
        vals = [int(f['valor']) for f in factores if isinstance(f, dict) and 'valor' in f]
        if vals:
            product = 1
            for v in vals:
                product *= v
            return product
    return None


def _iro_from_text(doc: dict) -> int | None:
    """Busca un valor IRO explícito en el texto de las secciones."""
    for sec in doc.get('secciones', []):
        for key in ('bloques', 'items', 'filas'):
            for item in (sec.get(key) or []):
                texts = []
                if isinstance(item, dict):
                    texts = [str(v) for v in item.values() if isinstance(v, str)]
                elif isinstance(item, list):
                    texts = [str(c.get('text', c) if isinstance(c, dict) else c) for c in item]
                for t in texts:
                    m = re.search(r'IRO[^0-9]*?(\d{1,3})', t, re.I)
                    if m:
                        return int(m.group(1))
                # Also check labelCalculo / labelResultado fields
                if isinstance(item, dict):
                    result_text = str(item.get('resultado', item.get('valor', '')))
                    m = re.search(r'(\d{1,3})', result_text)
                    if m and item.get('labelCalculo', '').upper() == 'IRO CALCULADO':
                        return int(m.group(1))
    return None


def _count_urs_ids(urs_doc: dict) -> int:
    count = 0
    pat = re.compile(r'^URS(-NF)?-\d+$')
    for sec in urs_doc.get('secciones', []):
        for fila in sec.get('filas', []):
            if not isinstance(fila, list) or not fila:
                continue
            cell = fila[0]
            txt = str(cell.get('text', cell) if isinstance(cell, dict) else cell).strip()
            if pat.match(txt):
                count += 1
    return count


def _count_components(ira_doc: dict) -> int:
    count = 0
    pat = re.compile(r'^COMP-', re.I)
    for sec in ira_doc.get('secciones', []):
        for fila in sec.get('filas', []):
            comp_id = ''
            if isinstance(fila, dict):
                comp_id = str(fila.get('id', fila.get('componente', ''))).strip()
            elif isinstance(fila, list) and fila:
                cell = fila[0]
                comp_id = str(cell.get('text', cell) if isinstance(cell, dict) else cell).strip()
            if pat.match(comp_id):
                count += 1
    return count


# ── Chequeos por par ──────────────────────────────────────────────────────────

def _check_hlra_vp(hlra: dict, vp: dict, documents: dict) -> list[CascadeIssue]:
    issues = []

    # 1. Categoría GAMP debe ser idéntica
    h_gamp = _gamp_num(_docfield(hlra, 'gampCategory'))
    v_gamp = _gamp_num(_docfield(vp,   'gampCategory'))
    if h_gamp and v_gamp and h_gamp != v_gamp:
        issues.append(CascadeIssue(
            fromDoc='HLRA', toDoc='VP',
            issue=f'Categoría GAMP diferente: HLRA declara GAMP {h_gamp}, VP declara GAMP {v_gamp}.',
            severity='CRITICO',
            detail='La categoría GAMP determina el alcance documental completo. Debe ser idéntica en ambos documentos; una discrepancia invalida la justificación de alcance.',
        ))

    # 2. Sistema: nombre y versión
    h_sys = _pkg(hlra, 'systemName')
    v_sys = _pkg(vp,   'systemName')
    if h_sys and v_sys and h_sys != v_sys:
        issues.append(CascadeIssue(
            fromDoc='HLRA', toDoc='VP',
            issue=f'Nombre del sistema diferente: HLRA="{h_sys}", VP="{v_sys}".',
            severity='MENOR',
            detail='El nombre del sistema validado debe ser consistente en toda la documentación regulatoria.',
        ))

    h_ver = _pkg(hlra, 'systemVersion')
    v_ver = _pkg(vp,   'systemVersion')
    if h_ver and v_ver and h_ver != v_ver:
        issues.append(CascadeIssue(
            fromDoc='HLRA', toDoc='VP',
            issue=f'Versión del sistema diferente: HLRA="{h_ver}", VP="{v_ver}".',
            severity='MAYOR',
            detail='Si la versión cambió entre HLRA y VP, debe existir un documento de control de cambios que justifique el alcance actualizado.',
        ))

    # 3. IRO: calculado en HLRA vs referenciado en VP
    iro_hlra = _iro_from_factores(hlra)
    iro_vp   = _iro_from_text(vp)
    if iro_hlra and iro_vp and iro_hlra != iro_vp:
        issues.append(CascadeIssue(
            fromDoc='HLRA', toDoc='VP',
            issue=f'IRO inconsistente: HLRA calcula {iro_hlra}, VP referencia {iro_vp}.',
            severity='MAYOR',
            detail='El VP debe referenciar el mismo valor IRO aprobado en el HLRA. Una discrepancia indica que el VP no está alineado con el análisis de riesgo original.',
        ))

    # 4. Documentos excluidos en HLRA presentes en el paquete
    for sec in hlra.get('secciones', []):
        for fila in (sec.get('filas') or []):
            if not isinstance(fila, dict):
                continue
            doc_name = str(fila.get('documento', '')).upper()
            estado   = str(fila.get('estado',    '')).upper()
            if 'NO APLICA' not in estado:
                continue
            # Mapeo de nombre de documento HLRA → clave en documents
            key_map = {'PPQ': 'ppq', 'FRS': 'frs', 'DS': 'ds', 'DQ': 'dq'}
            for token, key in key_map.items():
                if token in doc_name and key in documents:
                    issues.append(CascadeIssue(
                        fromDoc='HLRA', toDoc='VP',
                        issue=f'HLRA marca "{fila["documento"]}" como No Aplica, pero existe en el paquete.',
                        severity='MAYOR',
                        detail=f'Un documento excluido en el HLRA no debería generarse. Si se incluyó, requiere justificación formal y actualización del HLRA.',
                    ))

    # 5. VP referencia el código correcto del HLRA
    hlra_code = _docfield(hlra, 'code')
    vp_extras_str = ' '.join(str(v) for v in _extras(vp).values())
    if hlra_code and hlra_code not in vp_extras_str:
        issues.append(CascadeIssue(
            fromDoc='HLRA', toDoc='VP',
            issue=f'VP no referencia el código del HLRA ("{hlra_code}") en sus campos de trazabilidad.',
            severity='MENOR',
            detail='El VP debe citar explícitamente el documento HLRA del que deriva su alcance para garantizar la cadena de trazabilidad regulatoria.',
        ))

    return issues


def _check_vp_urs(vp: dict, urs: dict) -> list[CascadeIssue]:
    issues = []

    # 1. GAMP category
    v_gamp = _gamp_num(_docfield(vp,  'gampCategory'))
    u_gamp = _gamp_num(_docfield(urs, 'gampCategory'))
    if v_gamp and u_gamp and v_gamp != u_gamp:
        issues.append(CascadeIssue(
            fromDoc='VP', toDoc='URS',
            issue=f'Categoría GAMP diferente: VP=GAMP {v_gamp}, URS=GAMP {u_gamp}.',
            severity='CRITICO',
            detail='El URS hereda la categoría GAMP del VP. Una discrepancia afecta la clasificación de criticidad de los requerimientos.',
        ))

    # 2. Nombre y versión del sistema
    v_sys = _pkg(vp,  'systemName')
    u_sys = _pkg(urs, 'systemName')
    if v_sys and u_sys and v_sys != u_sys:
        issues.append(CascadeIssue(
            fromDoc='VP', toDoc='URS',
            issue=f'Nombre del sistema diferente: VP="{v_sys}", URS="{u_sys}".',
            severity='MENOR',
            detail='El sistema validado debe tener el mismo nombre en toda la cadena documental.',
        ))

    v_ver = _pkg(vp,  'systemVersion')
    u_ver = _pkg(urs, 'systemVersion')
    if v_ver and u_ver and v_ver != u_ver:
        issues.append(CascadeIssue(
            fromDoc='VP', toDoc='URS',
            issue=f'Versión del sistema diferente: VP="{v_ver}", URS="{u_ver}".',
            severity='MAYOR',
            detail='Si la versión del sistema cambió entre VP y URS, los requerimientos podrían referirse a una versión distinta a la planificada.',
        ))

    # 3. URS referencia el VP?
    urs_extras_str = ' '.join(str(v) for v in _extras(urs).values())
    vp_code = _docfield(vp, 'code')
    if vp_code and vp_code not in urs_extras_str:
        issues.append(CascadeIssue(
            fromDoc='VP', toDoc='URS',
            issue=f'URS no referencia el código del VP ("{vp_code}") en sus campos de trazabilidad.',
            severity='MENOR',
            detail='El URS debe indicar explícitamente el Plan de Validación que lo rige para garantizar cadena regulatoria.',
        ))

    return issues


def _check_urs_ra(urs: dict, ra: dict) -> list[CascadeIssue]:
    issues = []

    # 1. Cuenta de URS declarada en RA vs real en URS
    ra_extras_vals = ' '.join(str(v) for v in _extras(ra).values())
    m = re.search(r'(\d+)\s+req', ra_extras_vals, re.I)
    declared = int(m.group(1)) if m else None
    actual   = _count_urs_ids(urs)

    if declared and actual and declared != actual:
        diff = actual - declared
        issues.append(CascadeIssue(
            fromDoc='URS', toDoc='RA',
            issue=f'RA declara haber evaluado {declared} requerimientos, pero el URS tiene {actual} ({"+"+str(diff) if diff>0 else str(diff)} diferencia).',
            severity='MAYOR',
            detail='El RA puede haber sido generado sobre una versión anterior del URS. Los requerimientos nuevos o modificados no estarían cubiertos por el análisis de riesgos vigente.',
        ))

    # 2. Categoría GAMP
    u_gamp = _gamp_num(_docfield(urs, 'gampCategory'))
    r_gamp = _gamp_num(_docfield(ra,  'gampCategory'))
    if u_gamp and r_gamp and u_gamp != r_gamp:
        issues.append(CascadeIssue(
            fromDoc='URS', toDoc='RA',
            issue=f'Categoría GAMP diferente: URS=GAMP {u_gamp}, RA=GAMP {r_gamp}.',
            severity='CRITICO',
            detail='El RA debe aplicar la misma categoría GAMP que el URS para que los criterios de criticidad sean consistentes.',
        ))

    # 3. Sistema
    u_sys = _pkg(urs, 'systemName')
    r_sys = _pkg(ra,  'systemName')
    if u_sys and r_sys and u_sys != r_sys:
        issues.append(CascadeIssue(
            fromDoc='URS', toDoc='RA',
            issue=f'Nombre del sistema diferente: URS="{u_sys}", RA="{r_sys}".',
            severity='MENOR',
            detail='Todos los documentos del ciclo deben referirse al mismo sistema.',
        ))

    return issues


def _check_ira_piq(ira: dict, piq: dict) -> list[CascadeIssue]:
    issues = []

    comp_count = _count_components(ira)

    piq_extras_vals = ' '.join(str(v) for v in _extras(piq).values())
    m = re.search(r'(\d+)\s+comp', piq_extras_vals, re.I)
    piq_declared = int(m.group(1)) if m else None

    if comp_count and piq_declared and comp_count != piq_declared:
        issues.append(CascadeIssue(
            fromDoc='IRA', toDoc='PIQ',
            issue=f'PIQ declara {piq_declared} componentes IRA, pero el IRA tiene {comp_count}.',
            severity='MAYOR',
            detail='El número de TCs del PIQ debe reflejar todos los componentes del IRA. Una discrepancia indica componentes sin TC de instalación o TCs sin componente origen.',
        ))

    # GAMP
    i_gamp = _gamp_num(_docfield(ira, 'gampCategory'))
    p_gamp = _gamp_num(_docfield(piq, 'gampCategory'))
    if i_gamp and p_gamp and i_gamp != p_gamp:
        issues.append(CascadeIssue(
            fromDoc='IRA', toDoc='PIQ',
            issue=f'Categoría GAMP diferente: IRA=GAMP {i_gamp}, PIQ=GAMP {p_gamp}.',
            severity='MAYOR',
            detail='El protocolo PIQ debe aplicar los criterios de la categoría GAMP declarada en el IRA.',
        ))

    return issues


def _check_urs_poq(urs: dict, poq: dict) -> list[CascadeIssue]:
    issues = []

    # 1. GAMP category
    u_gamp = _gamp_num(_docfield(urs, 'gampCategory'))
    p_gamp = _gamp_num(_docfield(poq, 'gampCategory'))
    if u_gamp and p_gamp and u_gamp != p_gamp:
        issues.append(CascadeIssue(
            fromDoc='URS', toDoc='POQ',
            issue=f'Categoría GAMP diferente: URS=GAMP {u_gamp}, POQ=GAMP {p_gamp}.',
            severity='MAYOR',
            detail='El POQ debe aplicar los mismos criterios que el URS para que los casos de prueba funcionales sean coherentes con los requerimientos.',
        ))

    # 2. URS count declared in POQ vs real
    poq_extras_vals = ' '.join(str(v) for v in _extras(poq).values())
    m = re.search(r'(\d+)\s+req', poq_extras_vals, re.I)
    declared = int(m.group(1)) if m else None
    actual   = _count_urs_ids(urs)
    if declared and actual and declared != actual:
        diff = actual - declared
        issues.append(CascadeIssue(
            fromDoc='URS', toDoc='POQ',
            issue=f'POQ declara {declared} requerimientos URS, pero el URS tiene {actual} ({"+"+str(diff) if diff>0 else str(diff)} diferencia).',
            severity='MAYOR',
            detail='El POQ puede haber sido generado sobre una versión anterior del URS. Los requerimientos nuevos o modificados podrían no estar cubiertos en la Calificación Operacional.',
        ))

    # 3. URS code referenced in POQ extras
    urs_code = _docfield(urs, 'code')
    if urs_code and urs_code not in poq_extras_vals:
        issues.append(CascadeIssue(
            fromDoc='URS', toDoc='POQ',
            issue=f'POQ no referencia el código del URS ("{urs_code}") en sus campos de trazabilidad.',
            severity='MENOR',
            detail='El POQ debe citar explícitamente el URS del que deriva sus casos de prueba funcionales para garantizar la cadena regulatoria.',
        ))

    # 4. Sistema
    u_sys = _pkg(urs, 'systemName')
    p_sys = _pkg(poq, 'systemName')
    if u_sys and p_sys and u_sys != p_sys:
        issues.append(CascadeIssue(
            fromDoc='URS', toDoc='POQ',
            issue=f'Nombre del sistema diferente: URS="{u_sys}", POQ="{p_sys}".',
            severity='MENOR',
            detail='El sistema validado debe tener el mismo nombre en toda la cadena documental.',
        ))

    return issues


def _check_ra_poq(ra: dict, poq: dict) -> list[CascadeIssue]:
    issues = []

    # 1. RA code referenced in POQ extras
    ra_code = _docfield(ra, 'code')
    poq_extras_vals = ' '.join(str(v) for v in _extras(poq).values())
    if ra_code and ra_code not in poq_extras_vals:
        issues.append(CascadeIssue(
            fromDoc='RA', toDoc='POQ',
            issue=f'POQ no referencia el Análisis de Riesgo ("{ra_code}") en sus campos de trazabilidad.',
            severity='MAYOR',
            detail='El POQ debe derivarse del RA para demostrar que los riesgos de naturaleza operacional tienen cobertura en la Calificación Operacional. Sin esta referencia, el auditor no puede rastrear la justificación del alcance de testing OQ.',
        ))

    # 2. GAMP category
    r_gamp = _gamp_num(_docfield(ra, 'gampCategory'))
    p_gamp = _gamp_num(_docfield(poq, 'gampCategory'))
    if r_gamp and p_gamp and r_gamp != p_gamp:
        issues.append(CascadeIssue(
            fromDoc='RA', toDoc='POQ',
            issue=f'Categoría GAMP diferente: RA=GAMP {r_gamp}, POQ=GAMP {p_gamp}.',
            severity='MAYOR',
            detail='La categoría GAMP debe ser consistente entre el RA y los protocolos derivados. Una discrepancia puede implicar criterios de criticidad diferentes en el análisis y en la ejecución.',
        ))

    return issues


def _check_vp_protocol_scope(vp: dict, documents: dict) -> list[CascadeIssue]:
    """
    Verifica que los protocolos presentes sean coherentes con el alcance del VP.
    Si el VP excluye PQ (PPQ) para GAMP 3, no debería existir un PPQ en el paquete,
    o si existe debería tener justificación.
    """
    issues = []

    vp_gamp = _gamp_num(_docfield(vp, 'gampCategory'))

    # Buscar en secciones del VP si PQ está excluido
    pq_excluded_in_vp = False
    for sec in vp.get('secciones', []):
        for item in (sec.get('bloques') or sec.get('items') or []):
            text = str(item.get('texto', item.get('contenido', ''))).lower()
            if 'ppq' in text and ('no aplica' in text or 'exclu' in text or 'no requer' in text):
                pq_excluded_in_vp = True
                break
        if pq_excluded_in_vp:
            break

    if pq_excluded_in_vp and 'ppq' in documents:
        issues.append(CascadeIssue(
            fromDoc='VP', toDoc='PPQ',
            issue='VP excluye explícitamente el PPQ (PQ no aplica), pero existe un PPQ en el paquete.',
            severity='MAYOR',
            detail='Para la categoría GAMP y el IRO declarados, el PPQ no es requerido. Si se incluye de todas formas, debe justificarse en el VP y en el PPQ con una adenda formal.',
        ))

    # Para GAMP 3, FRS y DS normalmente no aplican
    if vp_gamp == 3:
        for doc_key, doc_label in [('frs', 'FRS'), ('ds', 'DS')]:
            if doc_key in documents:
                # Check if VP explicitly mentions these as excluded
                excluded = False
                for sec in vp.get('secciones', []):
                    sec_text = str(sec).lower()
                    if doc_label.lower() in sec_text and ('no aplica' in sec_text or 'gamp 5' in sec_text):
                        excluded = True
                        break
                if excluded:
                    issues.append(CascadeIssue(
                        fromDoc='VP', toDoc=doc_label,
                        issue=f'VP indica que {doc_label} no aplica para GAMP {vp_gamp}, pero existe un {doc_label} en el paquete.',
                        severity='MENOR',
                        detail=f'Para GAMP {vp_gamp}, el {doc_label} generalmente no es requerido. Verificar si su inclusión está justificada.',
                    ))

    return issues


# ── Función principal ─────────────────────────────────────────────────────────

def check_cascade(documents: dict[str, Any]) -> list[CascadeIssue]:
    """
    Ejecuta todos los chequeos de coherencia en cascada disponibles
    según los documentos presentes en el paquete.
    """
    issues: list[CascadeIssue] = []

    hlra = documents.get('hlra', {})
    vp   = documents.get('vp',   {})
    urs  = documents.get('urs',  {})
    ra   = documents.get('ra',   {})
    ira  = documents.get('ira',  {})
    piq  = documents.get('piq',  {})
    poq  = documents.get('poq',  {})

    if hlra and vp:
        issues.extend(_check_hlra_vp(hlra, vp, documents))
    if vp and urs:
        issues.extend(_check_vp_urs(vp, urs))
    if urs and ra:
        issues.extend(_check_urs_ra(urs, ra))
    if ira and piq:
        issues.extend(_check_ira_piq(ira, piq))
    if urs and poq:
        issues.extend(_check_urs_poq(urs, poq))
    if ra and poq:
        issues.extend(_check_ra_poq(ra, poq))
    if vp:
        issues.extend(_check_vp_protocol_scope(vp, documents))

    return issues
