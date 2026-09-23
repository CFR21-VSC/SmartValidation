"""
routers/auth.py — Login, sesión, logout, y aceptación de invitación.

Capa 1 (login) + parte de Capa 2 (PIN de firma obligatorio desde el primer
login) del diseño de la Suite de Revisión y Firmas.
"""
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from .. import security
from ..audit import log_system_event
from ..db import get_db
from ..deps import get_current_user
from ..signature_consent import CURRENT_CONSENT_VERSION, SIGNATURE_CONSENT_STATEMENT_V1, get_consent, record_consent

router = APIRouter(tags=["auth"])

# Fuerza bruta (sección pedida por el usuario 2026-08-31): 5 intentos fallidos en una
# ventana de 15 minutos bloquean ese username por otros 15 minutos.
MAX_LOGIN_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW_S = 15 * 60
LOGIN_LOCKOUT_S = 15 * 60


class LoginBody(BaseModel):
    username: str
    password: str
    # Honeypot: campo oculto en el form real (login.html), invisible para una persona pero
    # que un bot que autocompleta todos los campos del <form> sí llena. Si llega con algo
    # adentro, se rechaza como si fuera credenciales inválidas sin tocar la DB de usuarios
    # ni contar como intento fallido real (para no poder usarlo para bloquear a otra
    # persona a propósito).
    website: str = ""


def _check_login_lockout(db, username: str) -> float | None:
    """Devuelve segundos restantes de bloqueo, o None si puede intentar loguearse."""
    row = db.execute("SELECT locked_until FROM rf_login_attempts WHERE username=?", (username,)).fetchone()
    if row and row["locked_until"] and row["locked_until"] > time.time():
        return row["locked_until"] - time.time()
    return None


def _register_failed_login(db, username: str) -> None:
    now = time.time()
    row = db.execute(
        "SELECT fail_count, first_fail_at FROM rf_login_attempts WHERE username=?", (username,)
    ).fetchone()
    if row and row["first_fail_at"] and (now - row["first_fail_at"]) < LOGIN_ATTEMPT_WINDOW_S:
        fail_count = row["fail_count"] + 1
        first_fail_at = row["first_fail_at"]
    else:
        fail_count = 1
        first_fail_at = now
    locked_until = now + LOGIN_LOCKOUT_S if fail_count >= MAX_LOGIN_ATTEMPTS else None
    db.execute(
        "INSERT INTO rf_login_attempts (username, fail_count, first_fail_at, locked_until) VALUES (?,?,?,?) "
        "ON CONFLICT(username) DO UPDATE SET fail_count=excluded.fail_count, "
        "first_fail_at=excluded.first_fail_at, locked_until=excluded.locked_until",
        (username, fail_count, first_fail_at, locked_until),
    )
    db.commit()


def _clear_login_attempts(db, username: str) -> None:
    db.execute("DELETE FROM rf_login_attempts WHERE username=?", (username,))
    db.commit()


class AcceptInviteBody(BaseModel):
    password: str
    pin: str


class SetPinBody(BaseModel):
    pin: str
    current_pin: str = ""


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


def _issue_session(response: Response, row: dict) -> None:
    token, nonce = security.create_token(
        row["id"], row["username"], row["display_name"] or row["username"],
        row["role"], bool(row["is_superadmin"]),
    )
    db = get_db()
    db.execute("DELETE FROM rf_sessions WHERE username=?", (row["username"],))
    db.execute(
        "INSERT INTO rf_sessions (nonce, username, created_at) VALUES (?,?,?)",
        (nonce, row["username"], time.time()),
    )
    db.commit()
    response.headers["Set-Cookie"] = security.build_set_cookie(token)


@router.post("/auth/login")
def login(body: LoginBody, response: Response):
    db = get_db()

    if body.website.strip():
        # Honeypot lleno -> bot. Mismo error genérico que credenciales inválidas, pero sin
        # tocar rf_users ni el contador de intentos fallidos (no debe poder usarse para
        # bloquear la cuenta de otra persona a propósito).
        log_system_event(
            {"uid": None, "u": body.username or "?"}, "login_honeypot_triggered",
            f"Intento de login con honeypot lleno (username enviado: {body.username!r})",
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")

    remaining = _check_login_lockout(db, body.username)
    if remaining is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Demasiados intentos fallidos. Probá de nuevo en {int(remaining // 60) + 1} minuto(s).",
        )

    row = db.execute(
        "SELECT * FROM rf_users WHERE username=? AND is_active=1", (body.username,)
    ).fetchone()
    if not row or not row["password_hash"]:
        security.dummy_verify_delay()
        _register_failed_login(db, body.username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")
    if not security.pbkdf2_verify(body.password, row["password_hash"]):
        _register_failed_login(db, body.username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")

    _clear_login_attempts(db, body.username)
    db.execute("UPDATE rf_users SET last_login=? WHERE id=?", (time.time(), row["id"]))
    db.commit()
    _issue_session(response, dict(row))
    log_system_event({"uid": row["id"], "u": row["username"]}, "login", f"{row['username']} inició sesión")
    return {
        "ok": True,
        "display_name": row["display_name"],
        "role": row["role"],
        "pin_set": bool(row["pin_set"]),
    }


@router.post("/auth/logout")
def logout(response: Response, user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute(
        "UPDATE rf_sessions SET revoked_at=? WHERE nonce=?",
        (time.time(), user.get("n", "")),
    )
    db.commit()
    response.headers["Set-Cookie"] = security.build_clear_cookie()
    log_system_event(user, "logout", f"{user['u']} cerró sesión")
    return {"ok": True}


@router.get("/auth/session")
def session(user: dict = Depends(get_current_user)):
    # pin_set se lee en vivo (no del token) porque puede cambiar durante la sesión,
    # p. ej. justo después de POST /auth/set-pin.
    db = get_db()
    row = db.execute("SELECT pin_set FROM rf_users WHERE id=?", (user["uid"],)).fetchone()
    return {
        "ok": True,
        "username": user["u"],
        "display_name": user["d"],
        "role": user["r"],
        "is_superadmin": user.get("sa", False),
        "pin_set": bool(row["pin_set"]) if row else False,
    }


@router.post("/auth/set-pin")
def set_pin(body: SetPinBody, user: dict = Depends(get_current_user)):
    """Autoservicio: configurar/cambiar el PIN de firma. Sin PIN previo (primer login,
    p. ej. el superadmin bootstrapeado por env vars, sección 3 Capa 2) no hace falta
    reconfirmar nada. Si ya había un PIN, exige el actual -- si no, una sesión robada
    (cookie) alcanzaría para tomar la credencial de firma electrónica de la cuenta,
    igual que /auth/change-password ya exige la contraseña actual para ese caso.

    Ronda 20 (2026-09-21): el chequeo de `current_pin` pasa por el MISMO lockout de fuerza
    bruta que sign_review/sign_approval (security.check_pin_lockout/register_failed_pin) --
    antes solo esos dos endpoints lo tenían, y una sesión robada podía usar ESTE endpoint para
    descubrir el PIN sin límite de intentos (10.000 combinaciones de 4 dígitos) y recién
    después firmar de verdad con el PIN ya conocido, evadiendo por completo el freno que
    aparentaba proteger la firma electrónica. Un solo contador de intentos por usuario,
    compartido entre ambos puntos de entrada."""
    if len(body.pin) < 4 or not body.pin.isdigit():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El PIN debe tener al menos 4 dígitos")
    db = get_db()
    row = db.execute("SELECT pin_hash, pin_set FROM rf_users WHERE id=?", (user["uid"],)).fetchone()
    if row and row["pin_set"]:
        remaining = security.check_pin_lockout(db, user["uid"])
        if remaining is not None:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Demasiados intentos fallidos. Probá de nuevo en {int(remaining // 60) + 1} minuto(s).",
            )
        if not security.pbkdf2_verify(body.current_pin, row["pin_hash"]):
            security.register_failed_pin(db, user["uid"])
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "El PIN actual es incorrecto")
        security.clear_pin_attempts(db, user["uid"])
    db.execute(
        "UPDATE rf_users SET pin_hash=?, pin_set=1, updated_at=? WHERE id=?",
        (security.pbkdf2_hash(body.pin), time.time(), user["uid"]),
    )
    db.commit()
    return {"ok": True}


@router.post("/auth/change-password")
def change_password(body: ChangePasswordBody, user: dict = Depends(get_current_user)):
    """Autoservicio para CUALQUIER cuenta ya activa (DRP o cliente) — cubre el hueco real
    de no poder rotar la contraseña del superadmin bootstrapeado (o la de cualquier otro
    usuario) después del primer login. Exige la contraseña actual para confirmar identidad."""
    if len(body.new_password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña nueva debe tener al menos 8 caracteres")

    db = get_db()
    row = db.execute("SELECT password_hash FROM rf_users WHERE id=?", (user["uid"],)).fetchone()
    if not row or not security.pbkdf2_verify(body.current_password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "La contraseña actual es incorrecta")

    db.execute(
        "UPDATE rf_users SET password_hash=?, updated_at=? WHERE id=?",
        (security.pbkdf2_hash(body.new_password), time.time(), user["uid"]),
    )
    db.commit()
    return {"ok": True}


class UpdateProfileBody(BaseModel):
    signature_display_name: str


@router.get("/auth/profile")
def get_profile(user: dict = Depends(get_current_user)):
    """Autoservicio (2026-09-23, pedido del usuario: 'cada usuario la configura para sí
    mismo') -- cualquier cuenta activa puede ver y editar solo SU PROPIO nombre de firma
    cursiva, nunca el de otra persona."""
    db = get_db()
    row = db.execute(
        "SELECT display_name, signature_display_name FROM rf_users WHERE id=?", (user["uid"],)
    ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    return {
        "ok": True,
        "display_name": row["display_name"],
        "signature_display_name": row["signature_display_name"] or row["display_name"],
    }


@router.post("/auth/profile")
def update_profile(body: UpdateProfileBody, user: dict = Depends(get_current_user)):
    name = body.signature_display_name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El nombre de firma no puede quedar vacío")
    if len(name) > 80:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El nombre de firma es demasiado largo (máximo 80 caracteres)")

    db = get_db()
    db.execute(
        "UPDATE rf_users SET signature_display_name=?, updated_at=? WHERE id=?",
        (name, time.time(), user["uid"]),
    )
    db.commit()
    log_system_event(user, "signature_name_updated", f"{user['u']} actualizó su nombre de firma a \"{name}\"")
    return {"ok": True, "signature_display_name": name}


@router.get("/auth/signature-consent")
def get_signature_consent(user: dict = Depends(get_current_user)):
    """Estado de la declaración de conformidad de firma electrónica de la sesión actual --
    el frontend la consulta antes de intentar firmar para saber si tiene que mostrar el
    modal, y signatures.py (sign_review/sign_approval) la vuelve a chequear server-side
    como la verdad autoritativa (esto de acá es solo para no mostrar el modal de más).
    `accepted` ya NO filtra por versión (Ronda 19) -- cualquier fila alcanza, ver docstring
    de has_accepted_consent."""
    db = get_db()
    consent = get_consent(db, user["uid"])
    return {
        "ok": True,
        "accepted": consent is not None,
        "consent": consent,
        # Vigente SIEMPRE presente (aceptó o no) -- el modal de consentimiento necesita
        # mostrar el texto antes de que la persona lo acepte por primera vez, y el POST
        # tiene que mandar de vuelta esta MISMA versión (ver accept_signature_consent).
        "current_version": CURRENT_CONSENT_VERSION,
        "current_statement_text": SIGNATURE_CONSENT_STATEMENT_V1,
    }


class AcceptSignatureConsentBody(BaseModel):
    # Ronda 19 (Codex, 2026-09-20): el cliente tiene que mandar EXPLÍCITAMENTE la versión que
    # leyó en el GET, no asumir "la vigente del servidor" -- si el texto cambió entre medio,
    # se rechaza y se lo obliga a releer antes de aceptar. Antes el POST no recibía nada y
    # siempre grababa CURRENT_CONSENT_VERSION, sin importar qué había mostrado el GET previo.
    version: str


@router.post("/auth/signature-consent")
def accept_signature_consent(body: AcceptSignatureConsentBody, user: dict = Depends(get_current_user)):
    """Registra la aceptación de la declaración de conformidad -- una vez por persona, de
    por vida (no por proyecto). Rechaza con 409 si `body.version` no es la vigente (el texto
    cambió entre el GET que lo mostró y este POST); devuelve el texto actual para que el
    cliente lo vuelva a mostrar."""
    db = get_db()
    try:
        record_consent(db, user["uid"], body.version)
    except ValueError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "error": "stale_consent_version",
                "message": "La declaración cambió desde que la leíste -- volvé a revisarla antes de aceptar.",
                "current_version": CURRENT_CONSENT_VERSION,
                "current_statement_text": SIGNATURE_CONSENT_STATEMENT_V1,
            },
        )
    log_system_event(
        user, "signature_consent_accepted",
        f"{user['u']} aceptó la declaración de conformidad de firma electrónica (versión {body.version})",
    )
    return {"ok": True}


@router.get("/invite/{token}")
def get_invite(token: str):
    db = get_db()
    inv = db.execute("SELECT * FROM rf_invites WHERE token=?", (token,)).fetchone()
    if not inv or inv["consumed_at"] or inv["expires_at"] < time.time():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación inválida o expirada")
    u = db.execute("SELECT * FROM rf_users WHERE id=?", (inv["user_id"],)).fetchone()
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación inválida")
    return {"ok": True, "email": u["email"], "display_name": u["display_name"], "role": u["role"]}


@router.post("/invite/{token}/accept")
def accept_invite(token: str, body: AcceptInviteBody, response: Response):
    if len(body.pin) < 4 or not body.pin.isdigit():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El PIN debe tener al menos 4 dígitos")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña debe tener al menos 8 caracteres")

    db = get_db()
    inv = db.execute("SELECT * FROM rf_invites WHERE token=?", (token,)).fetchone()
    if not inv or inv["consumed_at"] or inv["expires_at"] < time.time():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación inválida o expirada")

    u = db.execute("SELECT * FROM rf_users WHERE id=?", (inv["user_id"],)).fetchone()
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación inválida")

    now = time.time()
    db.execute(
        "UPDATE rf_users SET password_hash=?, pin_hash=?, pin_set=1, is_active=1, "
        "last_login=?, updated_at=? WHERE id=?",
        (security.pbkdf2_hash(body.password), security.pbkdf2_hash(body.pin), now, now, u["id"]),
    )
    db.execute("UPDATE rf_invites SET consumed_at=? WHERE token=?", (now, token))
    db.commit()

    fresh = db.execute("SELECT * FROM rf_users WHERE id=?", (u["id"],)).fetchone()
    _issue_session(response, dict(fresh))
    log_system_event(
        {"uid": fresh["id"], "u": fresh["username"]}, "user_activated",
        f"{fresh['username']} activó su cuenta (aceptó la invitación)",
    )
    return {"ok": True, "display_name": fresh["display_name"], "role": fresh["role"]}
