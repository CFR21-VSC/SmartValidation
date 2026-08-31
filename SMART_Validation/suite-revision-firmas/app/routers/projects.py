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


def ensure_project(db, project_id: str, username: str) -> bool:
    """Crea la fila rf_projects si no existe todavía. Idempotente.
    Devuelve True solo si la creó recién ahora (para loguear project_created una sola vez)."""
    existing = db.execute("SELECT id FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    if existing:
        return False
    now = time.time()
    db.execute(
        "INSERT INTO rf_projects (id, status, created_by, created_at, updated_at) "
        "VALUES (?,'active',?,?,?)",
        (project_id, username, now, now),
    )
    return True


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


# Un comentario sin resolver más viejo que esto se marca "atrasado" en el dossier — ayuda
# a detectar cuellos de botella (sección pedida por el usuario 2026-08-31).
STALE_COMMENT_DAYS = 3


@router.get("/{project_id}/dossier")
def get_dossier(project_id: str, user: dict = Depends(get_current_user)):
    """Estado en vivo + KPIs de tiempo por documento (acompañamiento visual del proyecto,
    sección pedida por el usuario 2026-08-31 — inspirado en el "Dossier en vivo" de la Suite
    de Validación, pero con KPIs de ciclo propios: acá sí hay timestamps reales de cada
    etapa). Mismo alcance de visibilidad que el resto de la suite: DRP ve todos los
    documentos del proyecto, cliente solo los que tiene habilitados."""
    db = get_db()
    if user.get("r") == "drp":
        docs = db.execute(
            "SELECT id, doc_type, status, locked, created_at, locked_at "
            "FROM rf_documents WHERE project_id=? ORDER BY doc_type",
            (project_id,),
        ).fetchall()
    else:
        docs = db.execute(
            "SELECT d.id, d.doc_type, d.status, d.locked, d.created_at, d.locked_at "
            "FROM rf_documents d "
            "JOIN rf_document_access_grants g ON g.project_id=d.project_id AND g.doc_type=d.doc_type "
            "WHERE d.project_id=? AND g.user_id=? ORDER BY d.doc_type",
            (project_id, user.get("uid")),
        ).fetchall()

    now = time.time()
    stale_cutoff = now - STALE_COMMENT_DAYS * 86400
    result = []
    for d in docs:
        first_review = db.execute(
            "SELECT MIN(signed_at) AS t FROM rf_review_signatures WHERE document_id=?", (d["id"],)
        ).fetchone()["t"]
        open_round = db.execute(
            "SELECT id FROM rf_approval_rounds WHERE document_id=? AND status='open' LIMIT 1", (d["id"],)
        ).fetchone()
        pending = db.execute(
            "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM rf_section_comments "
            "WHERE document_id=? AND resolved=0",
            (d["id"],),
        ).fetchone()

        sealed_at = d["locked_at"] if d["locked"] else None
        result.append({
            "doc_type": d["doc_type"],
            "status": d["status"],
            "locked": bool(d["locked"]),
            "created_at": d["created_at"],
            "first_review_signed_at": first_review,
            "has_open_approval_round": bool(open_round),
            "sealed_at": sealed_at,
            "kpi_load_to_review_s": (first_review - d["created_at"]) if first_review else None,
            "kpi_review_to_seal_s": (sealed_at - first_review) if (sealed_at and first_review) else None,
            "kpi_total_s": (sealed_at - d["created_at"]) if sealed_at else None,
            "pending_comments": pending["n"],
            "pending_comments_stale": pending["n"] > 0 and pending["oldest"] is not None and pending["oldest"] < stale_cutoff,
            "oldest_pending_comment_at": pending["oldest"],
        })

    return {"ok": True, "stale_comment_days": STALE_COMMENT_DAYS, "documents": result}


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
