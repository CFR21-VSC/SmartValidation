"""
routers/projects.py — Listado + ciclo de vida de proyectos (fase 5).

Un proyecto sigue sin "crearse" explícitamente (sección 4) — aparece la primera
vez que se carga un documento bajo ese project_id (ver ensure_project, llamado
desde documents.load_document). Lo que sí es nuevo acá es que ese proyecto
implícito ahora tiene estado propio: activo / cerrado / archivado / eliminado.
"""
import time

from fastapi import APIRouter, Depends, HTTPException, status

from ..audit import log_system_event
from ..db import get_db
from ..deps import get_current_user, require_drp

router = APIRouter(prefix="/projects", tags=["projects"])

# Sin prefijo /projects — es el audit trail de sistema UNIFICADO, cruzando todos los
# proyectos a la vez (confirmado por el usuario 2026-08-30: "no lo logro ver si no estoy
# dentro de un proyecto"). El endpoint scoped por proyecto (/projects/{id}/audit-log) sigue
# existiendo para cuando sí importa filtrar por uno solo.
audit_router = APIRouter(tags=["audit"])


def ensure_project(db, project_id: str, username: str) -> None:
    """Crea la fila rf_projects si no existe todavía. Idempotente."""
    existing = db.execute("SELECT id FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    if existing:
        return
    now = time.time()
    db.execute(
        "INSERT INTO rf_projects (id, status, created_by, created_at, updated_at) "
        "VALUES (?,'active',?,?,?)",
        (project_id, username, now, now),
    )


def _get_project_or_404(db, project_id: str) -> dict:
    row = db.execute("SELECT * FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    if row:
        return dict(row)
    # Migración: proyectos con documentos cargados ANTES de que existiera rf_projects
    # (fase 5) no tienen fila propia todavía — sin este backfill, close/archive/delete
    # les devuelven 404 aunque existan de verdad, y el bloqueo por sellado del DELETE
    # nunca llega a evaluarse (encontrado en QA real 2026-08-30). Self-healing: si tiene
    # al menos un documento, se lo trata como activo y se crea la fila recién ahora.
    has_docs = db.execute("SELECT 1 FROM rf_documents WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
    if not has_docs:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")
    ensure_project(db, project_id, "sistema")
    db.commit()
    return dict(db.execute("SELECT * FROM rf_projects WHERE id=?", (project_id,)).fetchone())


@router.get("")
def list_projects(include_archived: bool = False, user: dict = Depends(get_current_user)):
    """DRP ve todos los proyectos con documentos cargados. Cliente solo los que
    tiene al menos un documento habilitado (sección 3, Capa 2). Los archivados
    quedan afuera del listado por default (siguen existiendo, solo se ocultan)."""
    db = get_db()
    if user.get("r") == "drp":
        rows = db.execute("SELECT DISTINCT project_id FROM rf_documents ORDER BY project_id").fetchall()
    else:
        rows = db.execute(
            "SELECT DISTINCT project_id FROM rf_document_access_grants WHERE user_id=? ORDER BY project_id",
            (user.get("uid"),),
        ).fetchall()
    ids = [r["project_id"] for r in rows]

    statuses = {}
    if ids:
        placeholders = ",".join("?" for _ in ids)
        for r in db.execute(f"SELECT id, status FROM rf_projects WHERE id IN ({placeholders})", tuple(ids)):
            statuses[r["id"]] = r["status"]

    result = []
    for pid in ids:
        st = statuses.get(pid, "active")
        if st == "archived" and not include_archived:
            continue
        result.append({"id": pid, "status": st})

    return {"ok": True, "projects": result}


@router.patch("/{project_id}/close")
def close_project(project_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    proj = _get_project_or_404(db, project_id)
    if proj["status"] == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "El proyecto ya está cerrado")
    now = time.time()
    db.execute("UPDATE rf_projects SET status='closed', closed_at=?, updated_at=? WHERE id=?", (now, now, project_id))
    db.commit()
    log_system_event(user, "project_closed", f"{user['u']} cerró el proyecto", project_id=project_id)
    return {"ok": True}


@router.patch("/{project_id}/archive")
def archive_project(project_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    proj = _get_project_or_404(db, project_id)
    if proj["status"] == "archived":
        raise HTTPException(status.HTTP_409_CONFLICT, "El proyecto ya está archivado")
    now = time.time()
    db.execute("UPDATE rf_projects SET status='archived', archived_at=?, updated_at=? WHERE id=?", (now, now, project_id))
    db.commit()
    log_system_event(user, "project_archived", f"{user['u']} archivó el proyecto", project_id=project_id)
    return {"ok": True}


@router.patch("/{project_id}/reopen")
def reopen_project(project_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    proj = _get_project_or_404(db, project_id)
    if proj["status"] == "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "El proyecto ya está activo")
    now = time.time()
    db.execute(
        "UPDATE rf_projects SET status='active', closed_at=NULL, archived_at=NULL, updated_at=? WHERE id=?",
        (now, project_id),
    )
    db.commit()
    log_system_event(user, "project_reopened", f"{user['u']} reabrió el proyecto", project_id=project_id)
    return {"ok": True}


@router.delete("/{project_id}")
def delete_project(project_id: str, user: dict = Depends(require_drp)):
    """Elimina el proyecto y todo su contenido (documentos, correcciones, firmas,
    accesos). Bloqueado si algún documento ya está sellado — la inmutabilidad
    de un documento firmado no se salta borrando el proyecto entero."""
    db = get_db()
    _get_project_or_404(db, project_id)

    locked = db.execute(
        "SELECT doc_type FROM rf_documents WHERE project_id=? AND locked=1", (project_id,)
    ).fetchall()
    if locked:
        types = ", ".join(r["doc_type"] for r in locked)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"No se puede eliminar: tiene documento(s) sellado(s) ({types})",
        )

    doc_count = db.execute(
        "SELECT COUNT(*) AS n FROM rf_documents WHERE project_id=?", (project_id,)
    ).fetchone()["n"]

    db.execute("DELETE FROM rf_documents WHERE project_id=?", (project_id,))  # cascada: corrections/firmas
    db.execute("DELETE FROM rf_document_access_grants WHERE project_id=?", (project_id,))
    db.execute("DELETE FROM rf_projects WHERE id=?", (project_id,))
    db.commit()

    # El Libro de Validación (People Book) de este proyecto NO se borra — queda como
    # registro histórico de que existió y fue eliminado (no se destruyen audit trails).
    log_system_event(
        user, "project_deleted",
        f"{user['u']} eliminó el proyecto ({doc_count} documento(s))",
        project_id=project_id,
    )
    return {"ok": True}


@router.get("/{project_id}/audit-log")
def get_system_audit_log(project_id: str, user: dict = Depends(require_drp)):
    """Audit trail de sistema de UN proyecto (DRP-only) — separado del Libro de Validación."""
    db = get_db()
    rows = db.execute(
        "SELECT username, event_type, project_id, doc_type, description, created_at "
        "FROM rf_system_audit_log WHERE project_id=? ORDER BY created_at",
        (project_id,),
    ).fetchall()
    return {"ok": True, "events": [dict(r) for r in rows]}


@audit_router.get("/audit-log")
def get_global_audit_log(user: dict = Depends(require_drp)):
    """Audit trail de sistema UNIFICADO — todos los proyectos a la vez, más reciente primero.
    No requiere estar parado dentro de un proyecto para trazar qué pasó en el sistema."""
    db = get_db()
    rows = db.execute(
        "SELECT username, event_type, project_id, doc_type, description, created_at "
        "FROM rf_system_audit_log ORDER BY created_at DESC LIMIT 500"
    ).fetchall()
    return {"ok": True, "events": [dict(r) for r in rows]}
