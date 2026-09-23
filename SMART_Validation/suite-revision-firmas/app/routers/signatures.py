"""
routers/signatures.py — Firma de Revisión y Firma de Aprobación (sección 5).

5.1 Revisión: sin orden, solo PIN, bloqueada si hay correcciones sin resolver.
5.2 Aprobación: orden configurado por DRP, PIN + texto justificativo obligatorio,
    DRP (superadmin) firma último y esa firma sella e inmoviliza el documento
    (hash de JSON siempre; hash de PDF si se adjunta al firmar el sellado).
"""
import base64
import hashlib
import io
import json
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from pypdf import PdfReader

from ..audit import log_event
from ..db import get_db
from ..deps import check_can_sign, check_document_access, ensure_project_active, get_current_user, require_drp
from ..email_resend import send_email
from ..security import check_pin_lockout, clear_pin_attempts, pbkdf2_verify, register_failed_pin
from ..signature_consent import get_consent_id_for_signing
from .documents import _content_fingerprint

router = APIRouter(prefix="/projects/{project_id}/documents/{doc_type}", tags=["signatures"])

class ReviewSignBody(BaseModel):
    pin: str
    role_label: str | None = None
    content_fingerprint: str  # Ronda 18: sha256 del contenido que el firmante vio al preparar la firma


class CloseReviewBody(BaseModel):
    pin: str


class CreateRoundBody(BaseModel):
    signers: list[dict]  # [{user_id, role_label, sign_order}]


class ApprovalSignBody(BaseModel):
    pin: str
    justification_text: str
    pdf_base64: str | None = None  # obligatorio solo en la firma que sella (última, DRP)
    content_fingerprint: str  # Ronda 18: mismo criterio que ReviewSignBody


def _get_document_or_404(db, project_id: str, doc_type: str) -> dict:
    row = db.execute(
        "SELECT * FROM rf_documents WHERE project_id=? AND doc_type=?", (project_id, doc_type)
    ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
    return dict(row)


def _require_signature_consent(db, user_id: str) -> int:
    """Bloquea CUALQUIER firma (revisión o aprobación) hasta que la persona haya aceptado la
    declaración de conformidad de firma electrónica al menos una vez, en cualquier proyecto
    (ver signature_consent.py). El frontend intercepta este 409 puntual (`consent_required`),
    muestra el modal, llama a POST /auth/signature-consent, y reintenta la firma original --
    por eso el código de error es distinto al resto de los 409 de este archivo. Devuelve el
    id de la fila de consentimiento vigente para grabarlo en la firma (Ronda 19: vincula
    temporalmente cada firma a la evidencia de consentimiento que la habilitó, en vez de que
    el Libro de Firmas lo infiera consultando el estado ACTUAL del usuario sin fecha)."""
    consent_id = get_consent_id_for_signing(db, user_id)
    if consent_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"error": "consent_required", "message": "Falta aceptar la declaración de conformidad de firma electrónica"},
        )
    return consent_id


def _verify_pin(db, user_id: str, pin: str) -> None:
    remaining = check_pin_lockout(db, user_id)
    if remaining is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Demasiados intentos fallidos. Probá de nuevo en {int(remaining // 60) + 1} minuto(s).",
        )
    row = db.execute("SELECT pin_hash, pin_set FROM rf_users WHERE id=?", (user_id,)).fetchone()
    if not row or not row["pin_set"] or not pbkdf2_verify(pin, row["pin_hash"]):
        register_failed_pin(db, user_id)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "PIN incorrecto o no configurado")
    clear_pin_attempts(db, user_id)


# ─── 5.1 Firma de Revisión ────────────────────────────────────────────────────

@router.post("/review-signatures")
def sign_review(
    project_id: str, doc_type: str, body: ReviewSignBody, user: dict = Depends(get_current_user)
):
    # 2026-09-23 (precaución del usuario): ser DRP alcanza para VER un documento no privado,
    # no para firmarlo -- necesita asignación explícita. Ver check_can_sign en deps.py.
    check_can_sign(user, project_id, doc_type)
    db = get_db()
    consent_id = _require_signature_consent(db, user["uid"])
    ensure_project_active(db, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado")

    # parent_id IS NULL: solo cuenta hilos raíz -- una respuesta (sección 2026-09-01) nunca
    # se resuelve por sí sola, así que contarla acá bloquearía la firma para siempre en
    # cuanto un hilo ya resuelto tuviera aunque sea una respuesta colgada.
    pending = db.execute(
        "SELECT COUNT(*) AS n FROM rf_section_comments WHERE document_id=? AND resolved=0 AND parent_id IS NULL",
        (doc["id"],),
    ).fetchone()
    if pending["n"] > 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Hay comentarios sin resolver")

    # Chequeo temprano (fuera de la transacción, no bloqueante) -- evita gastar un intento de
    # PIN sobre algo que de todos modos se va a rechazar por desactualizado. El chequeo que
    # realmente cuenta es el de abajo, DENTRO de la transacción, justo antes de escribir.
    if body.content_fingerprint != _content_fingerprint(doc["json_data"]):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "El contenido del documento cambió desde que se preparó esta firma — recargá y volvé a intentar",
        )

    # _verify_pin hace sus propios commits (tracking de intentos fallidos) -- tiene que correr
    # ANTES de abrir la transacción de abajo, nunca adentro (un commit interno cortaría la
    # transacción a la mitad sin que el código de más abajo se entere).
    _verify_pin(db, user["uid"], body.pin)

    urow = db.execute(
        "SELECT display_name, signature_display_name FROM rf_users WHERE id=?", (user["uid"],)
    ).fetchone()
    display_name_at_signing = (urow["display_name"] if urow else None) or user["u"]
    # 2026-09-23: nombre de firma cursiva configurado por el usuario para sí mismo -- se
    # congela acá, igual criterio que display_name_at_signing (nunca se relee en vivo al
    # armar un documento ya firmado).
    signature_name_at_signing = (urow["signature_display_name"] if urow else None) or display_name_at_signing

    # Ronda 18 (revisión de Codex sobre el commit anterior, 2026-09-19): todo lo de abajo --
    # releer el documento, comprobar fingerprint/lock, y escribir la firma -- tiene que ser
    # una sola unidad atómica. Antes el chequeo de fingerprint y la escritura eran pasos
    # separados sin nada que impidiera un _upsert_document intercalado entre medio (demostrado
    # por Codex interceptando _verify_pin); "están en la misma función" no es "es una
    # transacción" cuando la conexión corre en autocommit (ver db.py). BEGIN IMMEDIATE toma
    # el lock de escritura ACÁ, así que cualquier _upsert_document concurrente sobre el mismo
    # documento queda bloqueado hasta que esta transacción termine, y al reintentar ve el
    # edit_locked ya puesto -- no puede colarse en el medio.
    db.execute("BEGIN IMMEDIATE")
    try:
        fresh = db.execute("SELECT json_data, locked FROM rf_documents WHERE id=?", (doc["id"],)).fetchone()
        if not fresh or fresh["locked"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado")
        if body.content_fingerprint != _content_fingerprint(fresh["json_data"]):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "El contenido del documento cambió desde que se preparó esta firma — recargá y volvé a intentar",
            )
        # Solo firmas ACTIVAS cuentan como "ya firmaste" -- una invalidada por reapertura no
        # tiene que impedir volver a firmar (antes el índice único cubría toda fila, ver
        # migración _migrate_signing_integrity_gaps).
        already = db.execute(
            "SELECT id FROM rf_review_signatures WHERE document_id=? AND user_id=? AND invalidated_at IS NULL",
            (doc["id"], user["uid"]),
        ).fetchone()
        if already:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ya firmaste la revisión de este documento")

        db.execute(
            "INSERT INTO rf_review_signatures "
            "(document_id, user_id, username, role_label, signed_at, content_fingerprint, "
            "display_name_at_signing, signature_name_at_signing, consent_id) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (doc["id"], user["uid"], user["u"], body.role_label, time.time(),
             body.content_fingerprint, display_name_at_signing, signature_name_at_signing, consent_id),
        )
        # Bloquea edición desde la PRIMERA firma (antes solo el sellado final de aprobación lo
        # hacía) -- ver _upsert_document en documents.py.
        db.execute("UPDATE rf_documents SET edit_locked=1 WHERE id=?", (doc["id"],))
        db.execute("COMMIT")
    except HTTPException:
        db.execute("ROLLBACK")
        raise
    except Exception:
        db.execute("ROLLBACK")
        raise

    log_event(project_id, doc_type, user, "review_signed", f"{user['u']} firmó la revisión de {doc_type}")
    return {"ok": True}


@router.get("/review-signatures")
def list_review_signatures(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    # Ronda 18 (revisión de Codex, 2026-09-19): devuelve TODAS las filas, activas e
    # invalidadas -- antes no distinguía, una firma invalidada por reapertura se veía
    # idéntica a una vigente. El campo `active` es lo que el cliente tiene que mirar.
    rows = db.execute(
        "SELECT user_id, username, role_label, signed_at, invalidated_at, invalidated_reason "
        "FROM rf_review_signatures WHERE document_id=? ORDER BY signed_at", (doc["id"],),
    ).fetchall()
    signatures = []
    for r in rows:
        d = dict(r)
        d["active"] = d["invalidated_at"] is None
        signatures.append(d)
    return {"ok": True, "signatures": signatures}


@router.post("/close-review")
def close_review(project_id: str, doc_type: str, body: CloseReviewBody, user: dict = Depends(require_drp)):
    """Cierre explícito de revisión (2026-09-21, pedido del usuario): acción formal de DRP,
    independiente de cuántos revisores hayan firmado -- abrir la ronda de aprobación no exige
    revisión completa por diseño (cualquier DRP la puede abrir en cualquier momento), pero
    SÍ exige que alguien haya cerrado la revisión explícitamente primero (ver el chequeo en
    create_approval_round más abajo). Requiere PIN, igual que una firma -- queda registrada
    en el People Book como cualquier otro evento GxP del documento.

    F-01 (informe de simulación adversarial 2026-09-23): a diferencia de sign_review y
    list_review_signatures, este endpoint no llamaba a check_document_access -- un DRP
    ajeno a un proyecto privado, sin grant, podía cerrar la revisión de un documento que
    ni siquiera podía leer (404 en /signature-book y en el documento, pero 200 acá).

    2026-09-23 (precaución del usuario, mismo día): ese primer fix usó check_document_access,
    que deja pasar a CUALQUIER DRP en un proyecto no privado sin asignación -- cerrar la
    revisión es una acción formal GxP, misma familia que firmar, así que ahora usa
    check_can_sign (ver deps.py): hace falta asignación (o ser superadmin) para poder
    cerrarla, no solo ser DRP."""
    check_can_sign(user, project_id, doc_type)
    db = get_db()
    consent_id = _require_signature_consent(db, user["uid"])
    ensure_project_active(db, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado")
    if doc["review_closed_at"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "La revisión de este documento ya está cerrada")

    pending = db.execute(
        "SELECT COUNT(*) AS n FROM rf_section_comments WHERE document_id=? AND resolved=0 AND parent_id IS NULL",
        (doc["id"],),
    ).fetchone()
    if pending["n"] > 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Hay comentarios sin resolver")

    _verify_pin(db, user["uid"], body.pin)

    now = time.time()
    db.execute(
        "UPDATE rf_documents SET review_closed_at=?, review_closed_by=? WHERE id=?",
        (now, user["u"], doc["id"]),
    )
    db.commit()

    log_event(project_id, doc_type, user, "review_closed", f"{user['u']} cerró la revisión de {doc_type}")
    return {"ok": True, "review_closed_at": now, "review_closed_by": user["u"]}


# ─── 5.2 Firma de Aprobación ──────────────────────────────────────────────────

@router.post("/approval-round")
def create_approval_round(
    project_id: str, doc_type: str, body: CreateRoundBody, user: dict = Depends(require_drp)
):
    # Encontrado al revisar esto (2026-09-23, precaución del usuario sobre firma sin
    # asignación): este endpoint no llamaba a NINGÚN chequeo de acceso para quien abre la
    # ronda -- ni siquiera el laxo de check_document_access. Cualquier DRP podía abrir una
    # ronda de aprobación (eligiendo firmantes) incluso sobre un documento de un proyecto
    # PRIVADO ajeno, algo que ni el chequeo laxo permitía en ningún otro endpoint de este
    # archivo. Mismo check_can_sign que el resto de las acciones formales.
    check_can_sign(user, project_id, doc_type)
    db = get_db()
    ensure_project_active(db, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento ya está sellado")
    if not doc["review_closed_at"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "La revisión todavía no está cerrada -- cerrala antes de abrir la ronda de aprobación",
        )

    open_round = db.execute(
        "SELECT id FROM rf_approval_rounds WHERE document_id=? AND status='open'", (doc["id"],)
    ).fetchone()
    if open_round:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay una ronda de aprobación abierta")

    if not body.signers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La ronda necesita al menos un firmante")

    orders = [s["sign_order"] for s in body.signers]
    if len(set(orders)) != len(orders):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "sign_order duplicado entre firmantes")

    # Todo firmante debe ya tener acceso habilitado a este documento (sección 3, Capa 2) —
    # ser designado firmante de aprobación no es una puerta trasera para saltarse esa regla.
    # Un SELECT agrupado para todos los firmantes (no uno por firmante en un loop) — de paso
    # evita traer la misma fila de rf_users dos veces (antes se volvía a pedir el username
    # en el loop de INSERT de más abajo).
    signer_ids = [s["user_id"] for s in body.signers]
    placeholders = ",".join("?" for _ in signer_ids)
    users_by_id = {
        r["id"]: r for r in db.execute(
            f"SELECT id, username, is_superadmin FROM rf_users WHERE id IN ({placeholders})",
            tuple(signer_ids),
        )
    }
    grants_by_id: dict[str, bool] = {}
    if signer_ids:
        for r in db.execute(
            f"SELECT DISTINCT user_id FROM rf_document_access_grants "
            f"WHERE project_id=? AND doc_type=? AND user_id IN ({placeholders})",
            (project_id, doc_type, *signer_ids),
        ):
            grants_by_id[r["user_id"]] = True

    is_superadmin_by_id: dict[str, bool] = {}
    for s in body.signers:
        urow = users_by_id.get(s["user_id"])
        if not urow:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Usuario {s['user_id']} no encontrado")
        is_superadmin_by_id[s["user_id"]] = bool(urow["is_superadmin"])
        if not urow["is_superadmin"] and not grants_by_id.get(s["user_id"]):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"El firmante {s['user_id']} no tiene acceso habilitado a este documento",
            )

    last_signer = max(body.signers, key=lambda s: s["sign_order"])
    if not is_superadmin_by_id[last_signer["user_id"]]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "El último firmante (mayor sign_order) debe ser DRP (superadmin)"
        )

    now = time.time()
    round_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO rf_approval_rounds (id, document_id, status, created_by, created_at) "
        "VALUES (?,?,'open',?,?)",
        (round_id, doc["id"], user["u"], now),
    )
    for s in body.signers:
        urow = users_by_id.get(s["user_id"])
        db.execute(
            "INSERT INTO rf_approval_signers (round_id, user_id, username, role_label, sign_order) "
            "VALUES (?,?,?,?,?)",
            (round_id, s["user_id"], urow["username"] if urow else None, s.get("role_label"), s["sign_order"]),
        )
    db.commit()
    log_event(project_id, doc_type, user, "approval_round_created", f"DRP abrió ronda de aprobación para {doc_type}")
    return {"ok": True, "round_id": round_id}


@router.get("/approval-round")
def get_current_approval_round(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    rnd = db.execute(
        "SELECT * FROM rf_approval_rounds WHERE document_id=? ORDER BY created_at DESC LIMIT 1", (doc["id"],)
    ).fetchone()
    if not rnd:
        return {"ok": True, "round": None, "signers": []}
    signers = db.execute(
        "SELECT id, user_id, username, role_label, sign_order, signed_at FROM rf_approval_signers "
        "WHERE round_id=? ORDER BY sign_order", (rnd["id"],),
    ).fetchall()
    return {"ok": True, "round": dict(rnd), "signers": [dict(s) for s in signers]}


@router.post("/approval-round/sign")
def sign_approval(
    project_id: str, doc_type: str, body: ApprovalSignBody, user: dict = Depends(get_current_user)
):
    # En la práctica esto ya estaba cubierto de forma transitiva -- create_approval_round exige
    # grant (o superadmin) para designar a alguien firmante, así que nadie llega hasta acá sin
    # eso. Se pone el mismo chequeo explícito igual, en vez de confiar en esa invariante
    # indirecta (defensa en profundidad -- ver check_can_sign en deps.py).
    check_can_sign(user, project_id, doc_type)
    if not body.justification_text or not body.justification_text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El texto justificativo es obligatorio")

    db = get_db()
    consent_id = _require_signature_consent(db, user["uid"])
    ensure_project_active(db, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    rnd = db.execute(
        "SELECT * FROM rf_approval_rounds WHERE document_id=? AND status='open'", (doc["id"],)
    ).fetchone()
    if not rnd:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No hay una ronda de aprobación abierta")

    signers = db.execute(
        "SELECT * FROM rf_approval_signers WHERE round_id=? ORDER BY sign_order", (rnd["id"],)
    ).fetchall()
    me = next((s for s in signers if s["user_id"] == user["uid"]), None)
    if not me:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No sos firmante de esta ronda")
    if me["signed_at"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya firmaste esta ronda")

    earlier_pending = [s for s in signers if s["sign_order"] < me["sign_order"] and not s["signed_at"]]
    if earlier_pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "Todavía no te toca firmar — falta un firmante anterior")

    # Chequeo temprano, no bloqueante -- ver misma nota en sign_review. El que cuenta de
    # verdad es el de adentro de la transacción, más abajo.
    if body.content_fingerprint != _content_fingerprint(doc["json_data"]):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "El contenido del documento cambió desde que se preparó esta firma — recargá y volvé a intentar",
        )

    _verify_pin(db, user["uid"], body.pin)  # tiene sus propios commits -- ver nota en sign_review

    is_last = me["sign_order"] == max(s["sign_order"] for s in signers)
    # No confiar en user["sa"] (viene del token, no cubierto por su firma HMAC -- ver
    # security.py) para una decisión de autorización real. Se relee is_superadmin desde
    # rf_users, igual que ya hace create_round más arriba para el mismo chequeo.
    urow = db.execute(
        "SELECT is_superadmin, display_name, signature_display_name FROM rf_users WHERE id=?",
        (user["uid"],),
    ).fetchone()
    is_superadmin = bool(urow["is_superadmin"]) if urow else False
    display_name_at_signing = (urow["display_name"] if urow else None) or user["u"]
    # 2026-09-23: mismo criterio que sign_review -- ver esa nota.
    signature_name_at_signing = (urow["signature_display_name"] if urow else None) or display_name_at_signing
    if is_last and not is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El último firmante debe ser DRP (superadmin)")
    if is_last and not body.pdf_base64:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "La firma de sellado requiere adjuntar el PDF final (pdf_base64)"
        )

    # Decodificar y validar el formato del PDF ANTES de escribir nada -- un adjunto inválido
    # no puede dejar la firma del signer parcialmente grabada. hashlib.sha256(pdf_base64.
    # encode()) hasheaba el texto base64, nunca el PDF real, y los bytes nunca se guardaban
    # (Codex, 2026-09-19). Ahora se decodifica, se hashea el binario real, y se guardan los
    # bytes.
    #
    # F-02 (informe de simulación adversarial 2026-09-23): el chequeo anterior solo miraba el
    # prefijo `%PDF-` -- cualquier string de bytes que empezara así (sin estructura real de
    # PDF: sin xref, sin trailer, sin una sola página) pasaba y quedaba sellado como "original".
    # Ahora se usa pypdf para exigir un PDF realmente parseable con al menos una página, lo que
    # cierra el caso "artefacto inutilizable" del hallazgo.
    #
    # LÍMITE QUE SIGUE ABIERTO (ya señalado por Codex en Ronda 18, no cerrado acá): esto valida
    # que el adjunto es un PDF ESTRUCTURALMENTE VÁLIDO, no que sea un render fiel del JSON que
    # se está sellando -- nada impide hoy adjuntar un PDF válido de OTRO documento. El
    # fingerprint garantiza que el JSON no cambió; no garantiza que el PDF corresponda a ESE
    # JSON. Cerrarlo de verdad requiere que el servidor genere el PDF (o lo verifique contra el
    # contenido) en vez de confiar en el que manda el cliente -- ver discusión en
    # docs-privados/ronda-18-revision-firma-artefacto-inmutable.md, es una pieza de
    # infraestructura aparte (motor de render del lado del servidor), no un ajuste chico.
    pdf_bytes = None
    if is_last:
        try:
            pdf_bytes = base64.b64decode(body.pdf_base64, validate=True)
        except Exception:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "pdf_base64 no es base64 válido")
        try:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            if len(reader.pages) < 1:
                raise ValueError("PDF sin páginas")
        except Exception:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El adjunto no es un PDF válido")

    # Ronda 18, segunda vuelta: todo el chequeo+escritura en una sola transacción real (ver
    # nota extensa en sign_review) -- releer ronda/firmante/documento adentro, y si esta es
    # la firma que sella, todo el sellado (ronda + documento) en el MISMO commit que la firma
    # del signer. Antes log_event() se llamaba entre medio y hacía su propio commit, cortando
    # la atomicidad justo ahí -- un fallo entre esa llamada y el sellado podía dejar la firma
    # grabada sin sellar el documento.
    now = time.time()
    db.execute("BEGIN IMMEDIATE")
    try:
        fresh_doc = db.execute("SELECT json_data, locked FROM rf_documents WHERE id=?", (doc["id"],)).fetchone()
        if not fresh_doc or fresh_doc["locked"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado")
        if body.content_fingerprint != _content_fingerprint(fresh_doc["json_data"]):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "El contenido del documento cambió desde que se preparó esta firma — recargá y volvé a intentar",
            )
        fresh_rnd = db.execute("SELECT status FROM rf_approval_rounds WHERE id=?", (rnd["id"],)).fetchone()
        if not fresh_rnd or fresh_rnd["status"] != "open":
            raise HTTPException(status.HTTP_409_CONFLICT, "La ronda de aprobación ya no está abierta")
        fresh_me = db.execute("SELECT signed_at FROM rf_approval_signers WHERE id=?", (me["id"],)).fetchone()
        if fresh_me and fresh_me["signed_at"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ya firmaste esta ronda")

        db.execute(
            "UPDATE rf_approval_signers SET signed_at=?, justification_text=?, "
            "content_fingerprint=?, display_name_at_signing=?, signature_name_at_signing=?, "
            "consent_id=? WHERE id=?",
            (now, body.justification_text, body.content_fingerprint, display_name_at_signing,
             signature_name_at_signing, consent_id, me["id"]),
        )
        # Bloquea edición desde la PRIMERA firma, no solo el sellado final -- update
        # idempotente si ya estaba en 1 (p.ej. alguien ya firmó como revisor antes).
        db.execute("UPDATE rf_documents SET edit_locked=1 WHERE id=?", (doc["id"],))

        sealed = False
        if is_last:
            # Ronda 20 (2026-09-21): el sellado es el único evento que reescribe json_data --
            # excepción puntual y documentada a la inmutabilidad del contenido cargado por el
            # DRP (Ronda 18). Se pisa SOLO document.status a "Aprobado", nada más del contenido,
            # para que la portada del PDF y cualquier libro regenerado después dejen de mostrar
            # "Borrador" para siempre en un documento que ya está sellado. json_hash se calcula
            # sobre este contenido YA actualizado -- así el hash guardado siempre coincide con
            # lo que hay en json_data, sin importar cuándo se vuelva a leer.
            sealed_json_data = fresh_doc["json_data"]
            try:
                parsed = json.loads(sealed_json_data)
                parsed.setdefault("document", {})["status"] = "Aprobado"
                sealed_json_data = json.dumps(parsed, ensure_ascii=False)
            except (ValueError, AttributeError):
                pass  # JSON inesperado -- no bloquear el sellado por un campo cosmético
            pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
            json_hash = hashlib.sha256(sealed_json_data.encode()).hexdigest()
            pdf_data_b64 = base64.b64encode(pdf_bytes).decode("ascii")
            proj = db.execute(
                "SELECT partner_name, partner_logo FROM rf_projects WHERE id=?", (project_id,)
            ).fetchone()
            db.execute(
                "UPDATE rf_approval_rounds SET status='sealed', sealed_at=? WHERE id=?", (now, rnd["id"])
            )
            db.execute(
                "UPDATE rf_documents SET locked=1, status='locked', locked_at=?, pdf_hash=?, json_hash=?, "
                "original_stored=1, pdf_data=?, json_data=?, branding_name_at_signing=?, branding_logo_at_signing=?, "
                "branding_captured_at_signing=1 WHERE id=?",
                (
                    now, pdf_hash, json_hash, pdf_data_b64, sealed_json_data,
                    (proj["partner_name"] or "") if proj else "",
                    (proj["partner_logo"] if proj else None),
                    doc["id"],
                ),
            )
            sealed = True
        db.execute("COMMIT")
    except HTTPException:
        db.execute("ROLLBACK")
        raise
    except Exception:
        db.execute("ROLLBACK")
        raise

    log_event(project_id, doc_type, user, "approval_signed", f"{user['u']} firmó la aprobación de {doc_type}")
    if sealed:
        log_event(project_id, doc_type, user, "document_sealed", f"{doc_type} quedó sellado e inmutable")

    signer_ids = [s["user_id"] for s in signers]
    placeholders = ",".join("?" for _ in signer_ids)
    emails_by_id = {
        r["id"]: r["email"] for r in db.execute(
            f"SELECT id, email FROM rf_users WHERE id IN ({placeholders})", tuple(signer_ids)
        )
    } if signer_ids else {}
    for s in signers:
        email = emails_by_id.get(s["user_id"])
        if email:
            if sealed:
                send_email(email, f"{doc_type} sellado", f"<p>{doc_type} quedó firmado y sellado.</p>")
            else:
                send_email(email, f"Firma registrada en {doc_type}", f"<p>{user['u']} firmó {doc_type}.</p>")

    return {"ok": True, "sealed": sealed}
