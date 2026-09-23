"""
routers/users.py — Alta de usuarios, invitaciones y accesos a documentos.

Todo este router es exclusivo de DRP (require_drp): capa 2 del diseño —
"solo DRP invita, solo DRP decide qué documento ve cada invitado".
"""
import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from .. import config, email_resend, security
from ..audit import log_system_event
from ..db import get_db
from ..deps import is_superadmin_fresh, require_drp

router = APIRouter(prefix="/users", tags=["users"])

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,40}$")


class CreateUserBody(BaseModel):
    username: str
    email: EmailStr
    display_name: str
    role: str  # 'drp' | 'partner' | 'cliente'


class GrantBody(BaseModel):
    project_id: str
    doc_type: str


@router.post("")
def create_user(body: CreateUserBody, user: dict = Depends(require_drp)):
    if body.role not in ("drp", "partner", "cliente"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "role debe ser 'drp', 'partner' o 'cliente'")
    # .lower() -- 2026-09-23, pedido del usuario: "el sistema debe unir todo sea mayúsculas
    # minúsculas, el nombre de usuario no debe ser duplicable" -- antes "Fbongiovanni",
    # "fbongiovanni" y "fBONgiovanni" se guardaban como tres cuentas distintas. Se normaliza
    # SIEMPRE a minúscula al guardar, así el resto del sistema (login, sesiones, etc.) puede
    # seguir comparando con = simple una vez migrados los datos viejos (_migrate_normalize_
    # usernames_lowercase en db.py) -- LOWER() en el chequeo de abajo es además una segunda
    # red de seguridad por si quedara algún dato legado sin migrar.
    username = body.username.strip().lower()
    if not _USERNAME_RE.match(username):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El usuario debe tener 3-40 caracteres: letras, números, punto, guión o guión bajo",
        )

    db = get_db()
    existing_email = db.execute("SELECT id FROM rf_users WHERE email=?", (body.email,)).fetchone()
    if existing_email:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese email")
    existing_username = db.execute("SELECT id FROM rf_users WHERE LOWER(username)=?", (username,)).fetchone()
    if existing_username:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese nombre de usuario")

    now = time.time()
    user_id = str(uuid.uuid4())
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

    # Ronda 20 (2026-09-21): token en el fragmento (#), no en el query string -- un fragmento
    # nunca se manda al servidor, así que no queda expuesto en logs de acceso/proxy ni en el
    # header Referer de pedidos posteriores (a diferencia de ?token=, que sí viaja en la
    # request line). invite.html acepta igual el viejo ?token= como fallback.
    invite_link = f"{config.APP_BASE_URL}/app/invite.html#token={token}"
    email_resend.send_invite_email(body.email, body.display_name, invite_link)

    log_system_event(user, "user_created", f"{user['u']} creó el usuario {body.email} ({body.role})")
    # send_invite_email es fire-and-forget (thread daemon) — no hay forma sincrónica de
    # saber si Resend efectivamente lo entregó. Lo único que se puede confirmar acá es si
    # el envío automático está configurado en este servicio; si no lo está, el frontend debe
    # avisar que hay que mandar el link a mano en vez de decir "invitación enviada" en falso.
    return {
        "ok": True, "user_id": user_id, "invite_link": invite_link,
        "email_configured": bool(config.RESEND_API_KEY),
    }


@router.get("")
def list_users(user: dict = Depends(require_drp)):
    """Un usuario superadmin (pedido del usuario, 2026-09-19: "ellos no deberían ver mi
    usuario superadministrador") queda oculto de este listado para cualquier DRP que no sea
    superadmin él mismo -- ni username, ni email, ni el flag. Antes esta consulta devolvía
    literalmente todas las filas sin ningún filtro."""
    db = get_db()
    query = (
        "SELECT id, username, email, display_name, role, is_active, is_superadmin, pin_set, "
        "created_at, last_login FROM rf_users"
    )
    if not is_superadmin_fresh(db, user):
        query += " WHERE is_superadmin=0"
    query += " ORDER BY created_at DESC"
    rows = db.execute(query).fetchall()
    return {"ok": True, "users": [dict(r) for r in rows]}


def _assert_target_not_hidden_superadmin(db, requester: dict, target: dict) -> None:
    """Ocultar la fila en list_users no alcanza si el ID igual se puede usar a mano contra
    deactivate/reactivate/reset-credentials -- un DRP que consiga el id de otra forma (o lo
    adivine) podría desactivar o resetear la cuenta del superadmin sin verla nunca en la
    lista. 404, no 403, mismo motivo que en todos los demás chequeos de privacidad de esta
    ronda: no confirmar que existe."""
    if target["is_superadmin"] and not is_superadmin_fresh(db, requester):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")


def _revoke_active_sessions(db, username: str) -> None:
    db.execute(
        "UPDATE rf_sessions SET revoked_at=? WHERE username=? AND revoked_at IS NULL",
        (time.time(), username),
    )


@router.patch("/{user_id}/deactivate")
def deactivate_user(user_id: str, user: dict = Depends(require_drp)):
    """Desactiva sin borrar nada -- accesos y firmas quedan intactos por si la persona
    vuelve a trabajar con DRP más adelante (pedido explícito del usuario 2026-09-03:
    "eliminar perfiles (o desactivar mejor y reactivar...)"). Corta cualquier sesión ya
    abierta al instante (ver get_current_user en deps.py) -- no alcanza con solo bloquear
    logins nuevos."""
    db = get_db()
    target = db.execute("SELECT username, display_name, email, is_superadmin, is_active FROM rf_users WHERE id=?", (user_id,)).fetchone()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    _assert_target_not_hidden_superadmin(db, user, target)
    if target["username"] == user["u"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No podés desactivar tu propia cuenta")
    # El chequeo de "no desactivar al último superadmin activo" que vivía acá (contar otros
    # superadmin activos, bloquear si daba 0) quedó como código muerto con el filtro de arriba
    # (2026-09-19): para llegar hasta acá, quien actúa ya tuvo que pasar
    # _assert_target_not_hidden_superadmin, o sea YA es superadmin activo y distinto del
    # target (el self-check de arriba lo garantiza) -- por construcción, ese actor siempre
    # cuenta como "otro superadmin activo", así que el conteo nunca podía dar 0. La única
    # combinación que lo hacía disparar en la práctica (un DRP no-superadmin desactivando al
    # único superadmin) ahora ni siquiera llega hasta acá -- corta antes, oculto como si no
    # existiera.
    db.execute("UPDATE rf_users SET is_active=0, updated_at=? WHERE id=?", (time.time(), user_id))
    _revoke_active_sessions(db, target["username"])
    db.commit()

    target_label = target["display_name"] or target["email"]
    log_system_event(user, "user_deactivated", f"{user['u']} desactivó a {target_label}")
    return {"ok": True}


@router.patch("/{user_id}/reactivate")
def reactivate_user(user_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    target = db.execute("SELECT display_name, email, is_superadmin FROM rf_users WHERE id=?", (user_id,)).fetchone()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    _assert_target_not_hidden_superadmin(db, user, target)

    db.execute("UPDATE rf_users SET is_active=1, updated_at=? WHERE id=?", (time.time(), user_id))
    db.commit()

    target_label = target["display_name"] or target["email"]
    log_system_event(user, "user_reactivated", f"{user['u']} reactivó a {target_label}")
    return {"ok": True}


class UpdateRoleBody(BaseModel):
    role: str  # 'drp' | 'partner' | 'cliente'


@router.patch("/{user_id}/role")
def update_role(user_id: str, body: UpdateRoleBody, user: dict = Depends(require_drp)):
    """El rol quedaba fijo para siempre desde la creación -- pedido del usuario, 2026-09-23:
    "ahora es cliente, pero mañana puede ser partner". Mismas protecciones que ya existen
    para desactivar/eliminar: no tocar al superadmin oculto, no tocar la propia cuenta, y acá
    además no dejar sin ningún DRP activo al sistema (a diferencia de desactivar, esto SÍ
    puede sacarle el rol drp a alguien sin que se note hasta que ya no quede nadie con
    permisos de administración)."""
    if body.role not in ("drp", "partner", "cliente"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "role debe ser 'drp', 'partner' o 'cliente'")

    db = get_db()
    target = db.execute(
        "SELECT username, display_name, email, role, is_superadmin, is_active FROM rf_users WHERE id=?",
        (user_id,),
    ).fetchone()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    _assert_target_not_hidden_superadmin(db, user, target)
    if target["username"] == user["u"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No podés cambiar tu propio rol")
    if target["is_superadmin"] and body.role != "drp":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El superadministrador no puede tener un rol distinto de DRP")

    if target["role"] == "drp" and target["is_active"] and body.role != "drp":
        remaining = db.execute(
            "SELECT COUNT(*) AS n FROM rf_users WHERE role='drp' AND is_active=1 AND id != ?",
            (user_id,),
        ).fetchone()["n"]
        if remaining == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se puede cambiar el rol del último DRP activo")

    old_role = target["role"]
    db.execute("UPDATE rf_users SET role=?, updated_at=? WHERE id=?", (body.role, time.time(), user_id))
    db.commit()

    target_label = target["display_name"] or target["email"]
    log_system_event(
        user, "user_role_changed",
        f"{user['u']} cambió el rol de {target_label} de '{old_role}' a '{body.role}'",
    )
    return {"ok": True, "role": body.role}


@router.delete("/{user_id}")
def delete_user(user_id: str, user: dict = Depends(require_drp)):
    """Borrado duro -- distinto de deactivate (arriba), que es la vía preferida para
    cuentas reales (pedido explícito del usuario 2026-09-03, ver deactivate_user). Este
    endpoint existe puntualmente para poder limpiar cuentas de prueba (QA/testing,
    2026-09-21) sin dejar basura permanente en el listado de usuarios.

    Reservado a superadmin y bloqueado si la cuenta ya firmó algo: rf_review_signatures/
    rf_approval_signers guardan user_id sin FK dura (y con username/display_name_at_signing
    ya snapshoteados) precisamente para sobrevivir sin la fila viva de rf_users, así que
    técnicamente no se pierde evidencia de firma -- pero igual preferimos no borrar la
    entidad de alguien que firmó algo real; para esos casos, desactivar."""
    db = get_db()
    if not is_superadmin_fresh(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el superadministrador puede eliminar usuarios")

    target = db.execute(
        "SELECT id, username, display_name, email, is_superadmin, role, is_active FROM rf_users WHERE id=?",
        (user_id,),
    ).fetchone()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    _assert_target_not_hidden_superadmin(db, user, target)
    if target["username"] == user["u"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No podés eliminar tu propia cuenta")

    has_signed = db.execute(
        "SELECT 1 FROM rf_review_signatures WHERE user_id=? "
        "UNION SELECT 1 FROM rf_approval_signers WHERE user_id=?",
        (user_id, user_id),
    ).fetchone()
    if has_signed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Esta cuenta ya firmó al menos un documento -- no se puede eliminar. Usá Desactivar para conservar la trazabilidad.",
        )

    if target["role"] == "drp" and target["is_active"]:
        remaining = db.execute(
            "SELECT COUNT(*) AS n FROM rf_users WHERE role='drp' AND is_active=1 AND id != ?",
            (user_id,),
        ).fetchone()["n"]
        if remaining == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se puede eliminar el último usuario DRP activo")

    target_label = target["display_name"] or target["email"]
    _revoke_active_sessions(db, target["username"])
    # rf_document_access_grants tiene ON DELETE CASCADE sobre user_id -- se limpia solo.
    db.execute("DELETE FROM rf_signature_consent WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM rf_users WHERE id=?", (user_id,))
    db.commit()

    log_system_event(user, "user_deleted", f"{user['u']} eliminó al usuario {target_label} ({target['role']})")
    return {"ok": True}


@router.post("/{user_id}/reset-credentials")
def reset_credentials(user_id: str, user: dict = Depends(require_drp)):
    """Cubre dos pedidos del usuario a la vez, porque son mecánicamente lo mismo (un link
    nuevo de rf_invites para terminar de configurar la cuenta): "resetear la contraseña" de
    alguien que ya activó su cuenta, y "reenviar invitación" si la original venció sin
    usarse. Invalida la contraseña actual (si tenía) y cualquier sesión abierta al instante
    -- el link viejo también queda inválido porque el token es de un solo uso
    (rf_invites.consumed_at)."""
    db = get_db()
    target = db.execute(
        "SELECT username, email, display_name, is_superadmin FROM rf_users WHERE id=?", (user_id,)
    ).fetchone()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    _assert_target_not_hidden_superadmin(db, user, target)

    now = time.time()
    db.execute("UPDATE rf_users SET password_hash=NULL, updated_at=? WHERE id=?", (now, user_id))
    _revoke_active_sessions(db, target["username"])

    token = security.generate_invite_token()
    db.execute(
        "INSERT INTO rf_invites (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (token, user_id, now, now + config.INVITE_TTL_H * 3600),
    )
    db.commit()

    # Ronda 20 (2026-09-21): token en el fragmento (#), no en el query string -- un fragmento
    # nunca se manda al servidor, así que no queda expuesto en logs de acceso/proxy ni en el
    # header Referer de pedidos posteriores (a diferencia de ?token=, que sí viaja en la
    # request line). invite.html acepta igual el viejo ?token= como fallback.
    invite_link = f"{config.APP_BASE_URL}/app/invite.html#token={token}"
    email_resend.send_credentials_reset_email(target["email"], target["display_name"], invite_link)

    target_label = target["display_name"] or target["email"]
    log_system_event(user, "credentials_reset", f"{user['u']} generó un nuevo link de acceso para {target_label}")
    return {
        "ok": True, "invite_link": invite_link,
        "email_configured": bool(config.RESEND_API_KEY),
    }


@router.post("/{user_id}/grants")
def grant_document_access(user_id: str, body: GrantBody, user: dict = Depends(require_drp)):
    db = get_db()
    target = db.execute("SELECT display_name, email FROM rf_users WHERE id=?", (user_id,)).fetchone()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")

    now = time.time()
    cur = db.execute(
        "INSERT OR IGNORE INTO rf_document_access_grants "
        "(user_id, project_id, doc_type, granted_by, granted_at) VALUES (?,?,?,?,?)",
        (user_id, body.project_id, body.doc_type, user["u"], now),
    )
    db.commit()
    if cur.rowcount:  # ya tenía este acceso -> no volver a notificar
        doc_link = f"{config.APP_BASE_URL}/app/review.html?project={body.project_id}&doc={body.doc_type}"
        email_resend.send_access_granted_email(
            target["email"], target["display_name"], body.project_id, body.doc_type, doc_link,
        )
    target_label = target["display_name"] or target["email"]
    log_system_event(
        user, "grant_created",
        f"{user['u']} otorgó a {target_label} acceso a {body.project_id}/{body.doc_type}",
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
        "SELECT g.project_id, g.doc_type, u.display_name, u.email FROM rf_document_access_grants g "
        "JOIN rf_users u ON u.id = g.user_id WHERE g.id=? AND g.user_id=?",
        (grant_id, user_id),
    ).fetchone()
    db.execute(
        "DELETE FROM rf_document_access_grants WHERE id=? AND user_id=?",
        (grant_id, user_id),
    )
    db.commit()
    if grant:
        target_label = grant["display_name"] or grant["email"]
        log_system_event(
            user, "grant_revoked",
            f"{user['u']} revocó a {target_label} el acceso a {grant['project_id']}/{grant['doc_type']}",
            project_id=grant["project_id"], doc_type=grant["doc_type"],
        )
    return {"ok": True}
