"""routers/projects.py — Listado de proyectos con actividad en esta suite."""
from fastapi import APIRouter, Depends

from ..db import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(user: dict = Depends(get_current_user)):
    """DRP ve todos los proyectos con documentos cargados. Cliente solo los que
    tiene al menos un documento habilitado (sección 3, Capa 2)."""
    db = get_db()
    if user.get("r") == "drp":
        rows = db.execute("SELECT DISTINCT project_id FROM rf_documents ORDER BY project_id").fetchall()
    else:
        rows = db.execute(
            "SELECT DISTINCT project_id FROM rf_document_access_grants WHERE user_id=? ORDER BY project_id",
            (user.get("uid"),),
        ).fetchall()
    return {"ok": True, "projects": [r["project_id"] for r in rows]}
