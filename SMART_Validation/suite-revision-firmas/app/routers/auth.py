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

router = APIRouter(tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


class AcceptInviteBody(BaseModel):
    password: str
    pin: str


class SetPinBody(BaseModel):
    pin: str


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
    row = db.execute(
        "SELECT * FROM rf_users WHERE username=? AND is_active=1", (body.username,)
    ).fetchone()
    if not row or not row["password_hash"]:
        security.dummy_verify_delay()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")
    if not security.pbkdf2_verify(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")

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
    """Autoservicio: configurar/cambiar el PIN de firma. Requerido al primer login
    para cuentas que no pasaron por el flujo de invitación (p. ej. el superadmin
    bootstrapeado por env vars, sección 3 Capa 2)."""
    if len(body.pin) < 4 or not body.pin.isdigit():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El PIN debe tener al menos 4 dígitos")
    db = get_db()
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
