"""
routers/users.py — Alta de usuarios, invitaciones y accesos a documentos.

Todo este router es exclusivo de DRP (require_drp): capa 2 del diseño —
"solo DRP invita, solo DRP decide qué documento ve cada invitado".
"""
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from .. import config, email_resend, security
from ..audit import log_system_event
from ..db import get_db
from ..deps import require_drp

router = APIRouter(prefix="/users", tags=["users"])


class CreateUserBody(BaseModel):
    email: EmailStr
    display_name: str
    role: str  # 'drp' | 'cliente'


class GrantBody(BaseModel):
    project_id: str
    doc_type: str


@router.post("")
def create_user(body: CreateUserBody, user: dict = Depends(require_drp)):
    if body.role not in ("drp", "cliente"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "role debe ser 'drp' o 'cliente'")

    db = get_db()
    existing = db.execute("SELECT id FROM rf_users WHERE email=?", (body.email,)).fetchone()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese email")

    now = time.time()
    user_id = str(uuid.uuid4())
    username = body.email.split("@")[0] + "-" + user_id[:6]
    db.execute(
        "INSERT INTO rf_users (id, username, email, display_name, role, is_active, "
        "created_by, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?,?)",
        (user_id, username, body.email, body.display_name, body.role, user["u"], now, now),
    )

    token = security.generate_invite_token()
    db.execute(
        "INSERT INTO rf_invites (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (token, user_id, now, now + config.INVITE_TTL_H * 3600),
    )
    db.commit()

    invite_link = f"{config.APP_BASE_URL}/app/invite.html?token={token}"
    email_resend.send_invite_email(body.email, body.display_name, invite_link)

    log_system_event(user, "user_created", f"{user['u']} creó el usuario {body.email} ({body.role})")
    return {"ok": True, "user_id": user_id, "invite_link": invite_link}


@router.get("")
def list_users(user: dict = Depends(require_drp)):
    db = get_db()
    rows = db.execute(
        "SELECT id, username, email, display_name, role, is_active, is_superadmin, pin_set, "
        "created_at, last_login FROM rf_users ORDER BY created_at DESC"
    ).fetchall()
    return {"ok": True, "users": [dict(r) for r in rows]}


@router.post("/{user_id}/grants")
def grant_document_access(user_id: str, body: GrantBody, user: dict = Depends(require_drp)):
    db = get_db()
    target = db.execute("SELECT id FROM rf_users WHERE id=?", (user_id,)).fetchone()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    now = time.time()
    db.execute(
        "INSERT OR IGNORE INTO rf_document_access_grants "
        "(user_id, project_id, doc_type, granted_by, granted_at) VALUES (?,?,?,?,?)",
        (user_id, body.project_id, body.doc_type, user["u"], now),
    )
    db.commit()
    log_system_event(
        user, "grant_created", f"{user['u']} otorgó acceso a usuario {user_id} sobre {body.doc_type}",
        project_id=body.project_id, doc_type=body.doc_type,
    )
    return {"ok": True}


@router.get("/{user_id}/grants")
def list_grants(user_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    rows = db.execute(
        "SELECT id, project_id, doc_type, granted_by, granted_at "
        "FROM rf_document_access_grants WHERE user_id=? ORDER BY granted_at DESC",
        (user_id,),
    ).fetchall()
    return {"ok": True, "grants": [dict(r) for r in rows]}


@router.delete("/{user_id}/grants/{grant_id}")
def revoke_grant(user_id: str, grant_id: int, user: dict = Depends(require_drp)):
    db = get_db()
    grant = db.execute(
        "SELECT project_id, doc_type FROM rf_document_access_grants WHERE id=? AND user_id=?",
        (grant_id, user_id),
    ).fetchone()
    db.execute(
        "DELETE FROM rf_document_access_grants WHERE id=? AND user_id=?",
        (grant_id, user_id),
    )
    db.commit()
    if grant:
        log_system_event(
            user, "grant_revoked", f"{user['u']} revocó acceso de usuario {user_id} sobre {grant['doc_type']}",
            project_id=grant["project_id"], doc_type=grant["doc_type"],
        )
    return {"ok": True}
