"""deps.py — Dependencias de FastAPI para autenticación y autorización."""
import hmac

from fastapi import Cookie, Depends, Header, HTTPException, status

from . import config, security
from .db import get_db


def get_current_user(rf_session: str | None = Cookie(default=None)) -> dict:
    payload = security.decode_token(rf_session or "")
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado")
    # El token en sí es válido (firma + vencimiento) hasta acá, pero eso no basta: hay que
    # confirmar que su nonce sigue vigente en rf_sessions. Sin este chequeo, logout() y el
    # borrado de la sesión anterior en cada login (_issue_session, auth.py) no tenían ningún
    # efecto real -- el token viejo seguía sirviendo hasta su vencimiento natural (12h) sin
    # importar cuántas veces se cerrara sesión o se volviera a loguear desde otro dispositivo
    # (reportado por el usuario 2026-08-31: "permite concurrencia de sesiones del mismo
    # usuario"). Como _issue_session borra la fila de sesión anterior al crear una nueva, este
    # chequeo también hace que solo quede una sesión activa por usuario a la vez.
    db = get_db()
    row = db.execute("SELECT revoked_at FROM rf_sessions WHERE nonce=?", (payload.get("n"),)).fetchone()
    if not row or row["revoked_at"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado")
    return payload


def require_drp(user: dict = Depends(get_current_user)) -> dict:
    if user.get("r") != "drp":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere rol DRP")
    return user


def require_service_token(x_bridge_key: str = Header(default="")) -> dict:
    """Auth del bridge servicio-a-servicio (router bridge.py) -- NO mira la cookie de
    sesión en absoluto, solo el header X-Bridge-Key. Un usuario logueado (DRP o cliente)
    no tiene forma de autenticarse acá; solo lo puede hacer quien conozca BRIDGE_API_KEY
    (la Suite Documental). Si el server no tiene BRIDGE_API_KEY configurada, rechaza
    siempre -- nunca queda abierto por falta de configuración.
    Devuelve un actor sintético para loguear en el audit trail (log_event/log_system_event
    solo necesitan la clave "u", y usan .get() para el resto)."""
    if not config.BRIDGE_API_KEY or not hmac.compare_digest(x_bridge_key, config.BRIDGE_API_KEY):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autorizado")
    return {"uid": None, "u": "suite-documental"}


def check_document_access(user: dict, project_id: str, doc_type: str) -> None:
    """DRP ve todo. Cliente solo si tiene un grant explícito para ese documento puntual
    (sección 3, Capa 2 — habilitación a nivel documento, no a nivel proyecto)."""
    if user.get("r") == "drp":
        return
    db = get_db()
    row = db.execute(
        "SELECT id FROM rf_document_access_grants WHERE user_id=? AND project_id=? AND doc_type=?",
        (user.get("uid"), project_id, doc_type),
    ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés acceso a este documento")


def ensure_project_active(db, project_id: str) -> None:
    """Bloquea escritura (cargar/corregir/firmar) en proyectos cerrados o archivados —
    fase 5. Un proyecto sin fila propia todavía (nunca se creó) se trata como activo:
    sigue sin existir un endpoint de "crear proyecto" separado (sección 4)."""
    row = db.execute("SELECT status FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    if row and row["status"] != "active":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"El proyecto está {row['status']} — no admite cambios",
        )
