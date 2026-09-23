"""
process_mining.py — Minería de procesos determinística (sin IA, pedido explícito del
usuario 2026-09-23): compara el ciclo real de revisión/aprobación de cada documento
contra un SOP versionado y editable desde pantalla (rf_sop_definitions), calculando
desvíos de TIEMPO por etapa y de REWORK (reaperturas). Nada de esto llama a un modelo --
es resta de timestamps que ya existen en rf_documents/rf_review_signatures/
rf_approval_rounds, comparada contra umbrales (`max_hours`) guardados en la SOP activa.

Las 4 etapas están fijas por diseño (v1) -- lo editable por el usuario es el umbral
(`max_hours`) y la etiqueta de cada una, no la lista de etapas en sí, porque cada `key`
mapea a un par de timestamps puntual que este módulo ya sabe calcular (ver STAGE_KEYS/
validate_sop_definition). Como sign_review/close_review/create_approval_round/
sign_approval ya aplican duro en el backend el ORDEN de estos pasos (409/403 si se
intenta fuera de orden, ver signatures.py), una secuencia fuera de orden es
estructuralmente imposible en los datos reales -- lo que esto mide es tiempo (cuellos de
botella / incumplimiento de plazo por etapa) y rework, no "pasos salteados".
"""
import json

STAGE_KEYS = ["carga_a_revision", "revision_a_cierre", "cierre_a_ronda", "ronda_a_sellado"]

DEFAULT_SOP_DEFINITION = {
    "stages": [
        {"key": "carga_a_revision", "label": "Carga → primera firma de revisión", "max_hours": 48},
        {"key": "revision_a_cierre", "label": "Primera firma → cierre de revisión", "max_hours": 72},
        {"key": "cierre_a_ronda", "label": "Cierre de revisión → apertura de ronda", "max_hours": 24},
        {"key": "ronda_a_sellado", "label": "Apertura de ronda → sellado", "max_hours": 120},
    ],
    "max_rework_count": 1,
}


def get_active_sop(db) -> dict:
    """La versión más alta guardada -- insert-only (ver rf_sop_definitions en schema.sql),
    así que la última fila por `version` es siempre la vigente. Si todavía no se guardó
    ninguna (primer arranque), se usa DEFAULT_SOP_DEFINITION sin escribir nada -- se
    persiste recién cuando alguien la guarda explícitamente desde la pantalla."""
    row = db.execute(
        "SELECT id, version, name, definition_json, created_by, created_at "
        "FROM rf_sop_definitions ORDER BY version DESC LIMIT 1"
    ).fetchone()
    if not row:
        return {
            "id": None, "version": 0, "name": "SOP por defecto (todavía no se guardó ninguna versión)",
            "definition": DEFAULT_SOP_DEFINITION, "created_by": None, "created_at": None,
        }
    return {
        "id": row["id"], "version": row["version"], "name": row["name"],
        "definition": json.loads(row["definition_json"]),
        "created_by": row["created_by"], "created_at": row["created_at"],
    }


def validate_sop_definition(definition: dict) -> None:
    """Levanta ValueError con un mensaje claro si la definición no es válida -- el router
    la traduce a 400. Los `key` de etapa tienen que ser EXACTAMENTE los conocidos
    (STAGE_KEYS): una key inventada quedaría sin ningún par de timestamps que calcularle."""
    stages = definition.get("stages")
    if not isinstance(stages, list) or not stages:
        raise ValueError("La definición necesita al menos una etapa")
    seen_keys = set()
    for s in stages:
        key = s.get("key") if isinstance(s, dict) else None
        if key not in STAGE_KEYS:
            raise ValueError(f"Etapa desconocida: {key!r} -- debe ser una de {STAGE_KEYS}")
        if key in seen_keys:
            raise ValueError(f"Etapa duplicada: {key}")
        seen_keys.add(key)
        max_hours = s.get("max_hours")
        if not isinstance(max_hours, (int, float)) or isinstance(max_hours, bool) or max_hours <= 0:
            raise ValueError(f"max_hours de {key} tiene que ser un número positivo")
        if not s.get("label"):
            raise ValueError(f"Falta label para la etapa {key}")
    max_rework = definition.get("max_rework_count")
    if not isinstance(max_rework, int) or isinstance(max_rework, bool) or max_rework < 0:
        raise ValueError("max_rework_count tiene que ser un entero >= 0")


def _hours_between(t_start, t_end):
    if t_start is None or t_end is None:
        return None
    return (t_end - t_start) / 3600.0


def _case_timestamps(db, doc_ids: list) -> dict:
    """Un SELECT agrupado por documento para cada sub-métrica (mismo patrón que
    get_dossier en projects.py) -- evita N+1 aunque el scope sea todo el sistema."""
    out = {d: {"t_first_review": None, "t_round_opened": None} for d in doc_ids}
    if not doc_ids:
        return out
    placeholders = ",".join("?" for _ in doc_ids)

    # invalidated_at IS NULL: una firma ya invalidada por una reapertura no cuenta como
    # "primera firma" de ESTE ciclo -- a diferencia de get_dossier (que no filtra esto),
    # acá sí importa para no mezclar un ciclo viejo con el actual tras un reopen.
    for r in db.execute(
        f"SELECT document_id, MIN(signed_at) AS t FROM rf_review_signatures "
        f"WHERE document_id IN ({placeholders}) AND invalidated_at IS NULL GROUP BY document_id",
        tuple(doc_ids),
    ):
        out[r["document_id"]]["t_first_review"] = r["t"]

    # 'cancelled' se ignora -- una ronda cancelada por una reapertura previa no es la
    # apertura real del ciclo vigente (que sigue en curso o ya selló con una ronda nueva).
    for r in db.execute(
        f"SELECT document_id, MIN(created_at) AS t FROM rf_approval_rounds "
        f"WHERE document_id IN ({placeholders}) AND status IN ('open','sealed') GROUP BY document_id",
        tuple(doc_ids),
    ):
        out[r["document_id"]]["t_round_opened"] = r["t"]

    return out


def _rework_counts(db, project_doc_pairs: list) -> dict:
    """document_reopened se audita en rf_system_audit_log (log_system_event, ver
    reopen_document en documents.py) -- NO en rf_people_book_events (log_event, esa tabla
    es el trail GxP del documento en sí: firmas, sellado; log_system_event es para
    acciones administrativas). Ninguna de las dos tiene FK a document_id, solo
    project_id+doc_type -- se cruza por ese par. Devuelve {(project_id, doc_type): count}.
    El scope típico de este reporte es decenas de documentos, no miles, así que un OR de
    pares por request es aceptable -- no corre en un loop caliente."""
    if not project_doc_pairs:
        return {}
    conditions = " OR ".join("(project_id=? AND doc_type=?)" for _ in project_doc_pairs)
    params = [v for pair in project_doc_pairs for v in pair]
    out = {}
    for r in db.execute(
        f"SELECT project_id, doc_type, COUNT(*) AS n FROM rf_system_audit_log "
        f"WHERE event_type='document_reopened' AND ({conditions}) GROUP BY project_id, doc_type",
        tuple(params),
    ):
        out[(r["project_id"], r["doc_type"])] = r["n"]
    return out


def compute_deviations(db, *, project_id=None, doc_type=None, date_from=None, date_to=None) -> dict:
    """El reporte completo: SOP activa + cada documento del scope con sus 4 duraciones de
    etapa (las que todavía no se puedan calcular -- documento en una etapa anterior --
    quedan en None, nunca se inventa un valor) comparadas contra los umbrales, más el
    conteo de rework. `project_id`/`doc_type` filtran el scope; sin ninguno, es "todo el
    sistema" (alcance pedido por el usuario)."""
    sop = get_active_sop(db)
    definition = sop["definition"]
    stages_by_key = {s["key"]: s for s in definition["stages"]}
    max_rework = definition["max_rework_count"]

    where, params = [], []
    if project_id:
        where.append("project_id=?")
        params.append(project_id)
    if doc_type:
        where.append("doc_type=?")
        params.append(doc_type)
    if date_from is not None:
        where.append("created_at>=?")
        params.append(date_from)
    if date_to is not None:
        where.append("created_at<=?")
        params.append(date_to)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    docs = [dict(d) for d in db.execute(
        f"SELECT id, project_id, doc_type, created_at, review_closed_at, locked, locked_at "
        f"FROM rf_documents {where_sql}",
        tuple(params),
    )]
    doc_ids = [d["id"] for d in docs]
    ts = _case_timestamps(db, doc_ids)
    rework = _rework_counts(db, [(d["project_id"], d["doc_type"]) for d in docs])

    stage_breach_counts = {k: 0 for k in stages_by_key}
    total_hours_values = []
    rework_values = []
    breach_doc_count = 0
    results = []

    for d in docs:
        t = ts.get(d["id"], {})
        t_created = d["created_at"]
        t_first_review = t.get("t_first_review")
        t_review_closed = d["review_closed_at"]
        t_round_opened = t.get("t_round_opened")
        t_sealed = d["locked_at"] if d["locked"] else None

        raw_stage_hours = {
            "carga_a_revision": _hours_between(t_created, t_first_review),
            "revision_a_cierre": _hours_between(t_first_review, t_review_closed),
            "cierre_a_ronda": _hours_between(t_review_closed, t_round_opened),
            "ronda_a_sellado": _hours_between(t_round_opened, t_sealed),
        }

        stage_results = {}
        any_breach = False
        for key, hours in raw_stage_hours.items():
            cfg = stages_by_key.get(key)
            if hours is None or cfg is None:
                stage_results[key] = {"hours": hours, "breached": False, "over_by_hours": None}
                continue
            breached = hours > cfg["max_hours"]
            stage_results[key] = {
                "hours": round(hours, 2), "breached": breached,
                "over_by_hours": round(hours - cfg["max_hours"], 2) if breached else None,
            }
            if breached:
                any_breach = True
                stage_breach_counts[key] += 1

        doc_rework = rework.get((d["project_id"], d["doc_type"]), 0)
        rework_breached = doc_rework > max_rework
        if rework_breached:
            any_breach = True
        if any_breach:
            breach_doc_count += 1
        rework_values.append(doc_rework)

        total_hours = _hours_between(t_created, t_sealed)
        if total_hours is not None:
            total_hours_values.append(total_hours)

        results.append({
            "project_id": d["project_id"], "doc_type": d["doc_type"],
            "created_at": t_created, "sealed_at": t_sealed,
            "stages": stage_results, "rework_count": doc_rework,
            "rework_breached": rework_breached, "any_breach": any_breach,
        })

    n = len(results)
    summary = {
        "total_documents": n,
        "documents_with_any_breach": breach_doc_count,
        "breach_rate": round(breach_doc_count / n, 3) if n else 0.0,
        "avg_total_hours": round(sum(total_hours_values) / len(total_hours_values), 2) if total_hours_values else None,
        "avg_rework_count": round(sum(rework_values) / n, 2) if n else 0.0,
        "max_rework_count": max_rework,
        "breach_rate_by_stage": {k: (round(stage_breach_counts[k] / n, 3) if n else 0.0) for k in stages_by_key},
    }

    return {
        "sop_version": sop["version"], "sop_name": sop["name"], "stages": definition["stages"],
        "summary": summary, "documents": results,
    }
