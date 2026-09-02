"""
routers/documents.py — Vista de revisión (Capa 3 / sección 4 del diseño).

Panel izquierdo: JSON fuente cargado a mano por DRP, inmutable durante la
revisión. Panel derecho: comentarios de revisión por sección — varios por
sección, cada uno atribuido a su autor, guardado explícito (no autosave) para
poder avisar por mail sin saturar. Nunca pisan el JSON fuente ni se mezclan
con el contenido en ninguna vista previa (confirmado con el usuario
2026-08-31: "Ver PDF" siempre muestra el original). Ambos requieren
habilitación granular por documento (excepto DRP, que ve todo).
"""
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import config, email_resend
from ..audit import log_event, log_system_event
from ..db import get_db
from ..deps import check_document_access, ensure_project_active, get_current_user, require_drp
from .book import collect_signatures, fecha as _fmt_fecha, iniciales as _fmt_iniciales, inject_signatures_section
from .projects import ensure_project

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])

# Sin prefijo /projects/{project_id} -- es "mis pendientes" cruzando TODOS los proyectos a
# la vez (sección 2026-09-01, mismo criterio que audit_router en projects.py: no depende de
# estar parado dentro de un proyecto).
me_router = APIRouter(prefix="/me", tags=["comments"])


@me_router.get("/pending-comments")
def my_pending_comments(user: dict = Depends(get_current_user)):
    """DRP ve todos los hilos raíz sin resolver del sistema -- es el único rol que puede
    resolver, así que todo pendiente es accionable por él (sección 2026-09-01). Cliente ve
    solo los de los documentos que tiene con grant -- mismo criterio de visibilidad que
    list_documents/check_document_access, sin inventar un concepto de acceso nuevo. Un solo
    SELECT en cada rama, sin loop -- evita el patrón N+1 (mismo criterio pedido por el
    usuario para el bridge)."""
    db = get_db()
    base_select = (
        "SELECT c.id AS comment_id, c.section_key, c.content, c.username AS author, "
        "c.created_at, d.project_id, d.doc_type "
        "FROM rf_section_comments c JOIN rf_documents d ON d.id = c.document_id "
    )
    if user.get("r") == "drp":
        rows = db.execute(
            base_select + "WHERE c.parent_id IS NULL AND c.resolved = 0 ORDER BY c.created_at",
        ).fetchall()
    else:
        rows = db.execute(
            base_select + "JOIN rf_document_access_grants g "
            "ON g.project_id = d.project_id AND g.doc_type = d.doc_type "
            "WHERE g.user_id = ? AND c.parent_id IS NULL AND c.resolved = 0 ORDER BY c.created_at",
            (user.get("uid"),),
        ).fetchall()

    items = []
    for r in rows:
        content = r["content"] or ""
        items.append({
            "project_id": r["project_id"], "doc_type": r["doc_type"], "section_key": r["section_key"],
            "comment_id": r["comment_id"], "author": r["author"], "created_at": r["created_at"],
            "content_preview": content if len(content) <= 200 else content[:200] + "…",
        })
    return {"ok": True, "count": len(items), "items": items}


class LoadDocumentBody(BaseModel):
    json_data: dict[str, Any]


class CommentBody(BaseModel):
    content: str
    parent_id: int | None = None  # None = comentario raíz; si no, responde a esa raíz


def _upsert_document(db, project_id: str, doc_type: str, json_data: dict, actor: dict) -> dict:
    """Carga o reemplaza el JSON fuente de un documento. Rechaza si el documento ya está
    sellado/inmutable o si el proyecto está cerrado/archivado. Compartida entre la carga
    manual (`load_document`, sesión DRP) y el bridge de servicio (push automático desde la
    Suite Documental) -- `actor` es el dict a loguear, solo necesita la clave "u"."""
    ensure_project_active(db, project_id)
    existing = db.execute(
        "SELECT id, locked FROM rf_documents WHERE project_id=? AND doc_type=?", (project_id, doc_type)
    ).fetchone()
    if existing and existing["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no puede modificarse")

    now = time.time()
    if existing:
        db.execute(
            "UPDATE rf_documents SET json_data=?, loaded_by=?, updated_at=? WHERE id=?",
            (json.dumps(json_data), actor["u"], now, existing["id"]),
        )
        doc_id = existing["id"]
    else:
        doc_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO rf_documents (id, project_id, doc_type, json_data, loaded_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (doc_id, project_id, doc_type, json.dumps(json_data), actor["u"], now, now),
        )
    created_project = ensure_project(db, project_id, actor["u"])
    db.commit()
    if created_project:
        log_system_event(actor, "project_created", f"{actor['u']} creó el proyecto", project_id=project_id)
    log_event(project_id, doc_type, actor, "document_loaded", f"{actor['u']} cargó {doc_type}")
    return {"ok": True, "document_id": doc_id}


@router.put("/{doc_type}")
def load_document(project_id: str, doc_type: str, body: LoadDocumentBody, user: dict = Depends(require_drp)):
    """DRP carga (o reemplaza) el JSON fuente. Rechaza si el documento ya está sellado/inmutable
    o si el proyecto está cerrado/archivado."""
    db = get_db()
    return _upsert_document(db, project_id, doc_type, body.json_data, user)


@router.delete("/{doc_type}")
def delete_document(project_id: str, doc_type: str, user: dict = Depends(require_drp)):
    """Elimina un documento puntual (no el proyecto entero). Bloqueado si está sellado —
    la inmutabilidad de un documento firmado no se salta borrándolo. El evento queda en
    el audit trail de sistema, no en el People Book (ese es del ciclo GxP del documento,
    no de acciones administrativas — sección 5 de la arquitectura)."""
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no puede eliminarse")

    db.execute("DELETE FROM rf_documents WHERE id=?", (doc["id"],))  # cascada: corrections/firmas
    db.commit()
    log_system_event(user, "document_deleted", f"{user['u']} eliminó {doc_type}", project_id=project_id, doc_type=doc_type)
    return {"ok": True}


@router.get("/{doc_type}/grants")
def list_document_grants(project_id: str, doc_type: str, user: dict = Depends(require_drp)):
    """Quién tiene acceso a ESTE documento puntual — usado por el panel "Asignar acceso"
    del dashboard, para no tener que ir a la pantalla de Usuarios a ver/otorgar accesos
    documento por documento."""
    db = get_db()
    rows = db.execute(
        "SELECT g.id, g.user_id, u.username, u.display_name, u.email, u.role, "
        "g.granted_by, g.granted_at "
        "FROM rf_document_access_grants g JOIN rf_users u ON u.id = g.user_id "
        "WHERE g.project_id=? AND g.doc_type=? ORDER BY g.granted_at",
        (project_id, doc_type),
    ).fetchall()
    return {"ok": True, "grants": [dict(r) for r in rows]}


@router.get("")
def list_documents(project_id: str, user: dict = Depends(get_current_user)):
    """DRP ve todos los documentos del proyecto. Cliente solo los que tiene habilitados."""
    db = get_db()
    if user.get("r") == "drp":
        rows = db.execute(
            "SELECT id, doc_type, status, locked, created_at, updated_at "
            "FROM rf_documents WHERE project_id=? ORDER BY doc_type",
            (project_id,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT d.id, d.doc_type, d.status, d.locked, d.created_at, d.updated_at "
            "FROM rf_documents d "
            "JOIN rf_document_access_grants g ON g.project_id=d.project_id AND g.doc_type=d.doc_type "
            "WHERE d.project_id=? AND g.user_id=? ORDER BY d.doc_type",
            (project_id, user.get("uid")),
        ).fetchall()
    return {"ok": True, "documents": [dict(r) for r in rows]}


def _get_document_or_404(db, project_id: str, doc_type: str) -> dict:
    row = db.execute(
        "SELECT * FROM rf_documents WHERE project_id=? AND doc_type=?", (project_id, doc_type)
    ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
    return dict(row)


@router.get("/{doc_type}")
def get_document(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    comments = db.execute(
        "SELECT id, section_key, content, resolved, user_id, username, created_at, parent_id "
        "FROM rf_section_comments WHERE document_id=? ORDER BY section_key, created_at",
        (doc["id"],),
    ).fetchall()
    doc["json_data"] = json.loads(doc["json_data"])
    return {"ok": True, "document": doc, "comments": [dict(c) for c in comments]}


@router.get("/{doc_type}/signed-render")
def get_signed_render(
    project_id: str, doc_type: str, include_pending: bool = False, user: dict = Depends(get_current_user),
):
    """JSON del documento con la sección tabla-firmas-final rellena con las firmas reales
    (revisión + aprobación) — para que "Ver PDF" de un documento suelto muestre lo mismo que
    va a mostrar el Libro compilado, en vez de una tabla vacía o desactualizada.

    `include_pending=true` (usado al generar el PDF que se va a adjuntar en la firma que
    sella) suma también la propia firma del usuario logueado si es firmante de una ronda de
    aprobación abierta y todavía no firmó — esa firma se va a grabar un instante después, en
    la misma acción de sellar, así que el documento hasheado para siempre tiene que mostrarla."""
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    data = json.loads(doc["json_data"])
    firmas = collect_signatures(db, doc["id"])

    if include_pending:
        pending = db.execute(
            "SELECT sig.role_label FROM rf_approval_signers sig "
            "JOIN rf_approval_rounds rnd ON rnd.id = sig.round_id "
            "WHERE rnd.document_id=? AND rnd.status='open' AND sig.user_id=? AND sig.signed_at IS NULL",
            (doc["id"], user["uid"]),
        ).fetchone()
        if pending:
            nombre = user["d"] or user["u"]
            firmas.append({
                "rol": pending["role_label"] or "Aprobador", "nombre": nombre,
                "iniciales": _fmt_iniciales(nombre), "fecha": _fmt_fecha(time.time()),
            })

    data = inject_signatures_section(data, firmas)
    return {"ok": True, "data": data}


@router.post("/{doc_type}/sections/{section_key}/comments")
def add_comment(
    project_id: str, doc_type: str, section_key: str, body: CommentBody,
    user: dict = Depends(get_current_user),
):
    """Guardado explícito (no autosave) — el revisor escribe y toca "Guardar comentario".
    Cada comentario es una fila nueva, atribuida a su autor; no pisa comentarios de otros
    revisores en la misma sección. Nunca toca rf_documents.json_data.

    Sin `parent_id`: es un comentario raíz nuevo, dispara mail a TODO DRP activo, sin excluir
    al autor — confirmado con el usuario (2026-08-31): con un solo DRP en el sistema, excluir
    al autor significaba que nunca le llegaba nada a él mismo cuando comentaba.

    Con `parent_id`: es una respuesta (hilo plano, sección pedida 2026-09-01) -- notifica SOLO
    al autor del comentario raíz, no a todo DRP, salvo que se esté respondiendo a sí mismo."""
    check_document_access(user, project_id, doc_type)
    db = get_db()
    ensure_project_active(db, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no admite comentarios")

    parent = None
    if body.parent_id is not None:
        parent = db.execute(
            "SELECT id, document_id, parent_id, user_id FROM rf_section_comments WHERE id=?",
            (body.parent_id,),
        ).fetchone()
        if not parent or parent["document_id"] != doc["id"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Comentario padre no encontrado en este documento")
        if parent["parent_id"] is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No se puede responder a una respuesta -- respondé al comentario raíz del hilo",
            )

    now = time.time()
    cur = db.execute(
        "INSERT INTO rf_section_comments "
        "(document_id, section_key, content, resolved, user_id, username, created_at, parent_id) "
        "VALUES (?,?,?,0,?,?,?,?)",
        (doc["id"], section_key, body.content, user["uid"], user["u"], now, body.parent_id),
    )
    comment_id = cur.lastrowid
    db.commit()
    log_event(
        project_id, doc_type, user,
        "comment_reply_added" if parent else "comment_added",
        f"{user['u']} " + (
            f"respondió un comentario en la sección '{section_key}'" if parent
            else f"comentó la sección '{section_key}'"
        ),
    )

    doc_link = f"{config.APP_BASE_URL}/app/review.html?project={project_id}&doc={doc_type}"
    if parent:
        if parent["user_id"] and parent["user_id"] != user["uid"]:
            author = db.execute("SELECT email, display_name FROM rf_users WHERE id=?", (parent["user_id"],)).fetchone()
            if author and author["email"]:
                email_resend.send_comment_reply_email(
                    author["email"], author["display_name"], project_id, doc_type,
                    section_key, user["u"], body.content, doc_link,
                )
    else:
        drp_users = db.execute(
            "SELECT email, display_name FROM rf_users WHERE role='drp' AND is_active=1"
        ).fetchall()
        for drp in drp_users:
            email_resend.send_new_comment_email(
                drp["email"], drp["display_name"], project_id, doc_type, section_key, user["u"], body.content, doc_link,
            )

    return {
        "ok": True,
        "comment": {
            "id": comment_id, "section_key": section_key, "content": body.content,
            "resolved": 0, "user_id": user["uid"], "username": user["u"], "created_at": now,
            "parent_id": body.parent_id,
        },
    }


@router.get("/{doc_type}/people-book")
def get_people_book(project_id: str, doc_type: str, user: dict = Depends(require_drp)):
    """Libro de Validación, sección People — audit trail del documento (sección 6).
    Sin interfaz visual todavía: expone los datos crudos para que DRP los consulte."""
    db = get_db()
    rows = db.execute(
        "SELECT username, event_type, description, created_at FROM rf_people_book_events "
        "WHERE project_id=? AND doc_type=? ORDER BY created_at",
        (project_id, doc_type),
    ).fetchall()
    return {"ok": True, "events": [dict(r) for r in rows]}


def _list_comments(db, project_id: str, doc_type: str) -> list[dict]:
    """Comentarios de sección de un documento, más viejo primero por sección. Compartida
    entre el endpoint de usuario (`list_comments`) y el bridge de servicio."""
    doc = _get_document_or_404(db, project_id, doc_type)
    rows = db.execute(
        "SELECT id, section_key, content, resolved, user_id, username, created_at, parent_id "
        "FROM rf_section_comments WHERE document_id=? ORDER BY section_key, created_at",
        (doc["id"],),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/{doc_type}/comments")
def list_comments(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    return {"ok": True, "comments": _list_comments(db, project_id, doc_type)}


@router.patch("/{doc_type}/sections/{section_key}/comments/{comment_id}/resolve")
def resolve_comment(
    project_id: str, doc_type: str, section_key: str, comment_id: int, user: dict = Depends(require_drp),
):
    """DRP confirma que ya consideró ese comentario puntual — habilita la firma de revisión
    cuando todos los comentarios del documento están resueltos (sección 5.1). Avisa por mail
    al autor del comentario (sección pedida 2026-09-01), salvo que DRP se esté resolviendo
    un comentario propio."""
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    comment = db.execute(
        "SELECT user_id FROM rf_section_comments WHERE id=? AND document_id=? AND section_key=?",
        (comment_id, doc["id"], section_key),
    ).fetchone()
    if not comment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comentario no encontrado")
    db.execute(
        "UPDATE rf_section_comments SET resolved=1 WHERE id=? AND document_id=? AND section_key=?",
        (comment_id, doc["id"], section_key),
    )
    db.commit()
    log_event(project_id, doc_type, user, "comment_resolved", f"DRP resolvió un comentario en la sección '{section_key}'")

    if comment["user_id"] and comment["user_id"] != user["uid"]:
        author = db.execute("SELECT email, display_name FROM rf_users WHERE id=?", (comment["user_id"],)).fetchone()
        if author and author["email"]:
            doc_link = f"{config.APP_BASE_URL}/app/review.html?project={project_id}&doc={doc_type}"
            email_resend.send_comment_resolved_email(
                author["email"], author["display_name"], project_id, doc_type, section_key, doc_link,
            )
    return {"ok": True}
