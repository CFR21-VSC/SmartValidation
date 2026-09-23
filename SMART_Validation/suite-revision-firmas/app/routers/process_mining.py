"""
routers/process_mining.py — Minería de procesos (pedido del usuario 2026-09-23): SOP
versionado/editable desde pantalla + reporte de desvíos de tiempo/rework contra el
proceso real, sistema completo (todos los proyectos a la vez). Ver app/process_mining.py
para el cálculo (determinístico, sin IA).

Acceso: superadmin únicamente (confirmado con el usuario) -- el reporte cruza proyectos
PRIVADOS ajenos, cuya existencia un DRP no-dueño ni debería poder confirmar (mismo motivo
que check_document_access/assert_owner_if_private en el resto del sistema).
"""
import json
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..db import get_db
from ..deps import is_superadmin_fresh, require_drp
from ..process_mining import compute_deviations, get_active_sop, validate_sop_definition

router = APIRouter(tags=["process-mining"])


def _require_superadmin(db, user: dict) -> None:
    if not is_superadmin_fresh(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo superadmin puede acceder a la minería de procesos")


class SopStageBody(BaseModel):
    key: str
    label: str
    max_hours: float


class SaveSopBody(BaseModel):
    name: str
    stages: list[SopStageBody]
    max_rework_count: int


@router.get("/sop")
def get_sop(user: dict = Depends(require_drp)):
    db = get_db()
    _require_superadmin(db, user)
    return {"ok": True, "sop": get_active_sop(db)}


@router.get("/sop/versions")
def list_sop_versions(user: dict = Depends(require_drp)):
    db = get_db()
    _require_superadmin(db, user)
    rows = db.execute(
        "SELECT id, version, name, definition_json, created_by, created_at "
        "FROM rf_sop_definitions ORDER BY version DESC"
    ).fetchall()
    versions = [
        {
            "id": r["id"], "version": r["version"], "name": r["name"],
            "definition": json.loads(r["definition_json"]),
            "created_by": r["created_by"], "created_at": r["created_at"],
        }
        for r in rows
    ]
    return {"ok": True, "versions": versions}


@router.put("/sop")
def save_sop(body: SaveSopBody, user: dict = Depends(require_drp)):
    """Insert-only -- ver rf_sop_definitions en schema.sql. Nunca pisa una versión vieja:
    cada guardado crea una fila nueva con version = MAX(version)+1, así se puede iterar el
    SOP sin perder el historial de qué se consideró "ideal" en cada momento."""
    db = get_db()
    _require_superadmin(db, user)

    definition = {
        "stages": [s.model_dump() for s in body.stages],
        "max_rework_count": body.max_rework_count,
    }
    try:
        validate_sop_definition(definition)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    last = db.execute("SELECT MAX(version) AS v FROM rf_sop_definitions").fetchone()
    next_version = (last["v"] or 0) + 1
    now = time.time()
    db.execute(
        "INSERT INTO rf_sop_definitions (version, name, definition_json, created_by, created_at) "
        "VALUES (?,?,?,?,?)",
        (next_version, body.name.strip() or f"SOP v{next_version}", json.dumps(definition), user["u"], now),
    )
    db.commit()
    return {"ok": True, "version": next_version}


@router.get("/process-mining/deviations")
def get_deviations(
    project_id: str | None = None,
    doc_type: str | None = None,
    date_from: float | None = None,
    date_to: float | None = None,
    user: dict = Depends(require_drp),
):
    db = get_db()
    _require_superadmin(db, user)
    return {"ok": True, **compute_deviations(
        db, project_id=project_id, doc_type=doc_type, date_from=date_from, date_to=date_to,
    )}
