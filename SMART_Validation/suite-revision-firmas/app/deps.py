"""deps.py — Dependencias de FastAPI para autenticación y autorización."""
from fastapi import Cookie, Depends, HTTPException, status

from . import security
from .db import get_db


def get_current_user(rf_session: str | None = Cookie(default=None)) -> dict:
    payload = security.decode_token(rf_session or "")
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado")
    return payload


def require_drp(user: dict = Depends(get_current_user)) -> dict:
    if user.get("r") != "drp":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere rol DRP")
    return user


def check_document_access(user: dict, project_id: str, doc_type: str) -> None:
    """DRP ve todo. Cliente solo si tiene un grant explícito para ese documento puntual
    (sección 3, Capa 2 — habilitación a nivel documento, no a nivel proyecto)."""
    if user.get("r") == "drp":
        return
    db = get_db()
    row = db.execute(
        "SELECT id FROM rf_document_access_grants WHERE user_id=? AND project_id=? AND doc_type=?",
        (user.get("uid"), project_id, doc_type),
    ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés acceso a este documento")


def ensure_project_active(db, project_id: str) -> None:
    """Bloquea escritura (cargar/corregir/firmar) en proyectos cerrados o archivados —
    fase 5. Un proyecto sin fila propia todavía (nunca se creó) se trata como activo:
    sigue sin existir un endpoint de "crear proyecto" separado (sección 4)."""
    row = db.execute("SELECT status FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    if row and row["status"] != "active":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"El proyecto está {row['status']} — no admite cambios",
        )
