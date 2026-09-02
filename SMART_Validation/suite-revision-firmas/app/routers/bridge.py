"""
routers/bridge.py — Integración servicio-a-servicio con la Suite Documental (server.py).

Todo acá vive bajo Depends(require_service_token) -- nunca sesión de usuario, nunca cookie.
La Suite Documental es siempre quien llama (push de documentos, lectura de comentarios);
este servicio nunca llama de vuelta. Reusa la misma lógica interna que ya usan los
endpoints de usuario (_upsert_document, _list_comments en documents.py) para no duplicar
validaciones -- documento sellado, proyecto activo, etc. quedan cubiertas igual acá.
"""
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..db import get_db
from ..deps import require_service_token
from .documents import _list_comments, _upsert_document

router = APIRouter(prefix="/bridge/projects/{project_id}/documents", tags=["bridge"])


class PushDocumentBody(BaseModel):
    json_data: dict[str, Any]


@router.put("/{doc_type}")
def push_document(
    project_id: str, doc_type: str, body: PushDocumentBody, actor: dict = Depends(require_service_token),
):
    db = get_db()
    return _upsert_document(db, project_id, doc_type, body.json_data, actor)


@router.get("/{doc_type}/comments")
def pull_comments(project_id: str, doc_type: str, actor: dict = Depends(require_service_token)):
    db = get_db()
    return {"ok": True, "comments": _list_comments(db, project_id, doc_type)}
