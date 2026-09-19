"""
routers/bridge.py — Integración servicio-a-servicio con la Suite Documental (server.py).

Todo acá vive bajo Depends(require_service_token) -- nunca sesión de usuario, nunca cookie.
La Suite Documental es siempre quien llama (push de documentos, lectura de comentarios);
este servicio nunca llama de vuelta. Reusa la misma lógica interna que ya usan los
endpoints de usuario (_upsert_document, _list_comments en documents.py) para no duplicar
validaciones -- documento sellado, proyecto activo, etc. quedan cubiertas igual acá.
"""
import time
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..audit import log_system_event
from ..db import get_db
from ..deps import require_service_token
from .documents import _list_comments, _upsert_document
from .projects import ensure_project

router = APIRouter(prefix="/bridge/projects/{project_id}/documents", tags=["bridge"])

# Sin /documents en el prefijo -- acciones a nivel proyecto, no documento.
project_router = APIRouter(prefix="/bridge/projects", tags=["bridge"])


class EnsureProjectBody(BaseModel):
    display_name: str | None = None  # nombre legible inicial, solo si el proyecto es nuevo acá


@project_router.put("/{project_id}")
def ensure_project_endpoint(
    project_id: str, body: EnsureProjectBody, actor: dict = Depends(require_service_token),
):
    """Crea la fila del proyecto en Firmas sin necesidad de empujar un documento todavía --
    para que un proyecto recién creado en la Suite Documental quede vinculado acá desde el
    principio, no recién cuando llega el primer documento (sección pedida por el usuario
    2026-09-19). No reemplaza la carga manual de un documento en Firmas bajo cualquier
    project_id (eso sigue sin requerir que el proyecto exista de antes -- uso real para demos
    sueltas, confirmado con el usuario): esto es solo el camino AUTOMÁTICO desde Validación.

    display_name solo se aplica si el proyecto es nuevo (created=True) -- si ya existía, puede
    tener un nombre puesto a mano en Firmas (PATCH /projects/{id}/display-name) que no hay que
    pisar con cada creación de proyecto en Validación."""
    db = get_db()
    created = ensure_project(db, project_id, actor["u"])
    if created and body.display_name:
        db.execute("UPDATE rf_projects SET display_name=? WHERE id=?", (body.display_name.strip(), project_id))
    db.commit()
    if created:
        log_system_event(actor, "project_created", f"Proyecto vinculado automáticamente desde la Suite Documental", project_id=project_id)
    return {"ok": True, "created": created}


class BrandingBody(BaseModel):
    name: str
    logo: str | None = None


class PushDocumentBody(BaseModel):
    json_data: dict[str, Any]
    branding: BrandingBody | None = None  # empresa partner/cliente del proyecto, opcional


@router.put("/{doc_type}")
def push_document(
    project_id: str, doc_type: str, body: PushDocumentBody, actor: dict = Depends(require_service_token),
):
    db = get_db()
    result = _upsert_document(db, project_id, doc_type, body.json_data, actor)
    # server.py manda `branding` en TODOS los push, aunque esté vacío -- es la única forma de
    # que una limpieza de logo en Validación se propague acá (si se omitiera cuando no hay
    # logo, esta fila nunca se actualizaba y quedaba con el branding viejo para siempre;
    # encontrado en revisión de Codex, 2026-09-19). No hay edición de branding directa en
    # Firmas (no existe ese endpoint/UI acá), así que no hay nada propio que este UPDATE
    # pueda pisar por accidente.
    if body.branding is not None:
        db.execute(
            "UPDATE rf_projects SET partner_name=?, partner_logo=?, updated_at=? WHERE id=?",
            (body.branding.name or None, body.branding.logo, time.time(), project_id),
        )
        db.commit()
    return result


@router.get("/{doc_type}/comments")
def pull_comments(project_id: str, doc_type: str, actor: dict = Depends(require_service_token)):
    db = get_db()
    return {"ok": True, "comments": _list_comments(db, project_id, doc_type)}
