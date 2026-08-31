"""
routers/documents.py — Vista de revisión (Capa 3 / sección 4 del diseño).

Panel izquierdo: JSON fuente cargado a mano por DRP, inmutable durante la
revisión. Panel derecho: correcciones autoguardadas por sección — nunca pisan
el JSON fuente. Ambos requieren habilitación granular por documento (excepto
DRP, que ve todo).
"""
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..audit import log_event, log_system_event
from ..db import get_db
from ..deps import check_document_access, ensure_project_active, get_current_user, require_drp
from .book import collect_signatures, fecha as _fmt_fecha, iniciales as _fmt_iniciales, inject_signatures_section
from .projects import ensure_project

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


class LoadDocumentBody(BaseModel):
    json_data: dict[str, Any]


class CorrectionBody(BaseModel):
    content: str


@router.put("/{doc_type}")
def load_document(project_id: str, doc_type: str, body: LoadDocumentBody, user: dict = Depends(require_drp)):
    """DRP carga (o reemplaza) el JSON fuente. Rechaza si el documento ya está sellado/inmutable
    o si el proyecto está cerrado/archivado."""
    db = get_db()
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
            (json.dumps(body.json_data), user["u"], now, existing["id"]),
        )
        doc_id = existing["id"]
    else:
        doc_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO rf_documents (id, project_id, doc_type, json_data, loaded_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (doc_id, project_id, doc_type, json.dumps(body.json_data), user["u"], now, now),
        )
    created_project = ensure_project(db, project_id, user["u"])
    db.commit()
    if created_project:
        log_system_event(user, "project_created", f"{user['u']} creó el proyecto", project_id=project_id)
    log_event(project_id, doc_type, user, "document_loaded", f"{user['u']} cargó {doc_type}")
    return {"ok": True, "document_id": doc_id}


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
    corrections = db.execute(
        "SELECT section_key, content, resolved, updated_by, updated_at FROM rf_section_corrections "
        "WHERE document_id=? ORDER BY section_key",
        (doc["id"],),
    ).fetchall()
    doc["json_data"] = json.loads(doc["json_data"])
    return {"ok": True, "document": doc, "corrections": [dict(c) for c in corrections]}


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


@router.put("/{doc_type}/sections/{section_key}")
def save_correction(
    project_id: str, doc_type: str, section_key: str, body: CorrectionBody,
    user: dict = Depends(get_current_user),
):
    """Autoguardado del panel derecho. Nunca toca rf_documents.json_data."""
    check_document_access(user, project_id, doc_type)
    db = get_db()
    ensure_project_active(db, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no admite correcciones")

    now = time.time()
    db.execute(
        "INSERT INTO rf_section_corrections (document_id, section_key, content, resolved, updated_by, updated_at) "
        "VALUES (?,?,?,0,?,?) "
        "ON CONFLICT(document_id, section_key) DO UPDATE SET content=excluded.content, "
        "resolved=0, updated_by=excluded.updated_by, updated_at=excluded.updated_at",
        (doc["id"], section_key, body.content, user["u"], now),
    )
    db.commit()
    log_event(
        project_id, doc_type, user, "correction_saved",
        f"{user['u']} guardó una corrección en la sección '{section_key}'",
    )
    return {"ok": True}


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


@router.get("/{doc_type}/corrections")
def list_corrections(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    rows = db.execute(
        "SELECT section_key, content, resolved, updated_by, updated_at FROM rf_section_corrections "
        "WHERE document_id=? ORDER BY section_key",
        (doc["id"],),
    ).fetchall()
    return {"ok": True, "corrections": [dict(r) for r in rows]}


@router.patch("/{doc_type}/sections/{section_key}/resolve")
def resolve_correction(project_id: str, doc_type: str, section_key: str, user: dict = Depends(require_drp)):
    """DRP confirma que ya consideró/aplicó la corrección — habilita la firma de revisión
    cuando todas las correcciones del documento están resueltas (sección 5.1)."""
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    result = db.execute(
        "UPDATE rf_section_corrections SET resolved=1 WHERE document_id=? AND section_key=?",
        (doc["id"], section_key),
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Corrección no encontrada")
    db.commit()
    log_event(project_id, doc_type, user, "correction_resolved", f"DRP resolvió la sección '{section_key}'")
    return {"ok": True}
