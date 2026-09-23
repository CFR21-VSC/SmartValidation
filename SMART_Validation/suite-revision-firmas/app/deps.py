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
    # Se suma el chequeo de is_active en la MISMA consulta: desactivar un usuario (sección
    # pedida por el usuario 2026-09-03) tiene que cortarle el acceso al instante, no recién
    # cuando el token de sesión vence solo (hasta 12h más tarde) -- sin esto, is_active=0
    # solo bloqueaba un LOGIN nuevo, no una sesión ya abierta.
    db = get_db()
    row = db.execute(
        "SELECT s.revoked_at, u.is_active FROM rf_sessions s "
        "JOIN rf_users u ON u.username = s.username WHERE s.nonce=?",
        (payload.get("n"),),
    ).fetchone()
    if not row or row["revoked_at"] or not row["is_active"]:
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


def is_superadmin_fresh(db, user: dict) -> bool:
    """Nunca confiar en user['sa'] del token para una decisión de autorización real -- queda
    en el token tal como estaba al loguearse, hasta 12h, aunque is_superadmin se revoque
    después en la base (mismo criterio ya establecido para este chequeo puntual en
    sign_approval, ver signatures.py). Se relee siempre fresco de rf_users."""
    row = db.execute("SELECT is_superadmin FROM rf_users WHERE id=?", (user.get("uid"),)).fetchone()
    return bool(row and row["is_superadmin"])


def _has_document_grant(db, user_id: str, project_id: str, doc_type: str) -> bool:
    row = db.execute(
        "SELECT id FROM rf_document_access_grants WHERE user_id=? AND project_id=? AND doc_type=?",
        (user_id, project_id, doc_type),
    ).fetchone()
    return bool(row)


def check_document_access(user: dict, project_id: str, doc_type: str) -> None:
    """DRP ve todo -- salvo que el proyecto sea privado y no sea suyo (rol superadmin, pedido
    del usuario 2026-09-19: "proyectos... que los vea solo yo, ni siquiera otros usuarios
    DRP"). Partner y cliente solo si tienen un grant explícito para ese documento puntual
    (sección 3, Capa 2 — habilitación a nivel documento, no a nivel proyecto); ESE grant
    también es lo que deja entrar a alguien (drp, partner o cliente) a un documento puntual de
    un proyecto privado ajeno -- es la vía explícita de "compartir para firmar" que el dueño
    del proyecto usa a propósito, tiene que pesar más que el bypass de rol drp de abajo.
    404 (no 403) cuando el bloqueo es por privacidad: un 403 confirmaría que el documento
    existe; alguien sin acceso no tiene por qué poder distinguir "no existe" de "existe pero
    es privado de otra persona"."""
    db = get_db()
    proj = db.execute(
        "SELECT is_private, owner_user_id FROM rf_projects WHERE id=?", (project_id,)
    ).fetchone()
    is_owner = bool(proj) and proj["owner_user_id"] == user.get("uid")
    if proj and proj["is_private"] and not is_owner:
        if not _has_document_grant(db, user.get("uid"), project_id, doc_type):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
        return
    if user.get("r") == "drp":
        return
    if not _has_document_grant(db, user.get("uid"), project_id, doc_type):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés acceso a este documento")


def check_can_sign(user: dict, project_id: str, doc_type: str) -> None:
    """Como check_document_access, pero para las acciones formales de firma/cierre de revisión
    (sign_review, close_review, sign_approval) -- pedido explícito del usuario 2026-09-23: ser
    DRP alcanza para VER un documento de un proyecto no privado (bypass de rol de
    check_document_access, sin cambios), pero no para FIRMARLO -- necesita una asignación
    (grant) explícita a ese documento puntual, igual que un partner o un cliente. Un DRP puede
    autoasignarse ese grant (es admin, puede otorgárselo a sí mismo desde Usuarios) pero hasta
    que lo haga, no puede firmar. Superadmin sigue firmando cualquier documento sin grant --
    ya era así para designar firmantes de aprobación (`grants_by_id`, ver create_approval_round
    en signatures.py); esto extiende el MISMO criterio a la firma de revisión y al cierre de
    revisión, que hasta ahora pasaban por el chequeo laxo de check_document_access (cualquier
    DRP, sin asignación). 404 (no 403) para proyecto privado ajeno -- mismo motivo de no
    confirmar existencia que check_document_access; 403 para "sos DRP pero no estás asignado a
    este documento", que no es información sensible (el proyecto ya es visible)."""
    db = get_db()
    proj = db.execute(
        "SELECT is_private, owner_user_id FROM rf_projects WHERE id=?", (project_id,)
    ).fetchone()
    is_owner = bool(proj) and proj["owner_user_id"] == user.get("uid")
    if proj and proj["is_private"] and not is_owner:
        if not _has_document_grant(db, user.get("uid"), project_id, doc_type):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
        return
    if is_owner or is_superadmin_fresh(db, user):
        return
    if not _has_document_grant(db, user.get("uid"), project_id, doc_type):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "No tenés una asignación en este documento -- pedile a un DRP que te otorgue "
            "acceso antes de firmar",
        )


def assert_owner_if_private(db, user: dict, project_id: str) -> None:
    """Para endpoints exclusivos de DRP a nivel PROYECTO, sin mecanismo de grant propio
    (renombrar, cerrar/archivar/borrar, marca del partner, audit-log, libro compilado, listado
    de accesos otorgados, orden de documentos): un proyecto privado es invisible incluso para
    otro DRP que no sea su dueño. 404, mismo motivo que en check_document_access -- no
    confirmar existencia. No hay atajo de "grant" acá porque estos endpoints nunca lo tuvieron
    -- ya eran DRP-only antes de que existiera la privacidad."""
    row = db.execute(
        "SELECT is_private, owner_user_id FROM rf_projects WHERE id=?", (project_id,)
    ).fetchone()
    if row and row["is_private"] and row["owner_user_id"] != user.get("uid"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")


def has_any_grant_in_project(db, user_id: str, project_id: str) -> bool:
    """¿Tiene este usuario AL MENOS UN documento otorgado en este proyecto? Rol "partner"
    (2026-09-19, pedido del usuario -- una empresa que colabora activamente en el proyecto,
    ej. EMARA, sin ser DRP): a diferencia de cliente, un partner con acceso a cualquier
    documento del proyecto ve el dossier/estado COMPLETO de ese proyecto, no solo sus
    documentos puntuales -- usado por get_dossier (projects.py)."""
    row = db.execute(
        "SELECT 1 FROM rf_document_access_grants WHERE user_id=? AND project_id=? LIMIT 1",
        (user_id, project_id),
    ).fetchone()
    return bool(row)


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
