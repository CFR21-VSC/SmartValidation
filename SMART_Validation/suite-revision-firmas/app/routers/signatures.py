"""
routers/signatures.py — Firma de Revisión y Firma de Aprobación (sección 5).

5.1 Revisión: sin orden, solo PIN, bloqueada si hay correcciones sin resolver.
5.2 Aprobación: orden configurado por DRP, PIN + texto justificativo obligatorio,
    DRP (superadmin) firma último y esa firma sella e inmoviliza el documento
    (hash de JSON siempre; hash de PDF si se adjunta al firmar el sellado).
"""
import hashlib
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..audit import log_event
from ..db import get_db
from ..deps import check_document_access, get_current_user, require_drp
from ..email_resend import send_email
from ..security import pbkdf2_verify

router = APIRouter(prefix="/projects/{project_id}/documents/{doc_type}", tags=["signatures"])


class ReviewSignBody(BaseModel):
    pin: str
    role_label: str | None = None


class CreateRoundBody(BaseModel):
    signers: list[dict]  # [{user_id, role_label, sign_order}]


class ApprovalSignBody(BaseModel):
    pin: str
    justification_text: str
    pdf_base64: str | None = None  # obligatorio solo en la firma que sella (última, DRP)


def _get_document_or_404(db, project_id: str, doc_type: str) -> dict:
    row = db.execute(
        "SELECT * FROM rf_documents WHERE project_id=? AND doc_type=?", (project_id, doc_type)
    ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
    return dict(row)


def _verify_pin(db, user_id: str, pin: str) -> None:
    row = db.execute("SELECT pin_hash, pin_set FROM rf_users WHERE id=?", (user_id,)).fetchone()
    if not row or not row["pin_set"] or not pbkdf2_verify(pin, row["pin_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "PIN incorrecto o no configurado")


# ─── 5.1 Firma de Revisión ────────────────────────────────────────────────────

@router.post("/review-signatures")
def sign_review(
    project_id: str, doc_type: str, body: ReviewSignBody, user: dict = Depends(get_current_user)
):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado")

    pending = db.execute(
        "SELECT COUNT(*) AS n FROM rf_section_corrections WHERE document_id=? AND resolved=0",
        (doc["id"],),
    ).fetchone()
    if pending["n"] > 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Hay correcciones sin resolver")

    _verify_pin(db, user["uid"], body.pin)

    already = db.execute(
        "SELECT id FROM rf_review_signatures WHERE document_id=? AND user_id=?", (doc["id"], user["uid"])
    ).fetchone()
    if already:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya firmaste la revisión de este documento")

    db.execute(
        "INSERT INTO rf_review_signatures (document_id, user_id, username, role_label, signed_at) "
        "VALUES (?,?,?,?,?)",
        (doc["id"], user["uid"], user["u"], body.role_label, time.time()),
    )
    db.commit()
    log_event(project_id, doc_type, user, "review_signed", f"{user['u']} firmó la revisión de {doc_type}")
    return {"ok": True}


@router.get("/review-signatures")
def list_review_signatures(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    rows = db.execute(
        "SELECT user_id, username, role_label, signed_at FROM rf_review_signatures "
        "WHERE document_id=? ORDER BY signed_at", (doc["id"],),
    ).fetchall()
    return {"ok": True, "signatures": [dict(r) for r in rows]}


# ─── 5.2 Firma de Aprobación ──────────────────────────────────────────────────

@router.post("/approval-round")
def create_approval_round(
    project_id: str, doc_type: str, body: CreateRoundBody, user: dict = Depends(require_drp)
):
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento ya está sellado")

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
    is_superadmin_by_id: dict[str, bool] = {}
    for s in body.signers:
        urow = db.execute("SELECT is_superadmin FROM rf_users WHERE id=?", (s["user_id"],)).fetchone()
        if not urow:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Usuario {s['user_id']} no encontrado")
        is_superadmin_by_id[s["user_id"]] = bool(urow["is_superadmin"])
        if not urow["is_superadmin"]:
            grant = db.execute(
                "SELECT id FROM rf_document_access_grants WHERE user_id=? AND project_id=? AND doc_type=?",
                (s["user_id"], project_id, doc_type),
            ).fetchone()
            if not grant:
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
        urow = db.execute("SELECT username FROM rf_users WHERE id=?", (s["user_id"],)).fetchone()
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
    check_document_access(user, project_id, doc_type)
    if not body.justification_text or not body.justification_text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El texto justificativo es obligatorio")

    db = get_db()
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

    _verify_pin(db, user["uid"], body.pin)

    is_last = me["sign_order"] == max(s["sign_order"] for s in signers)
    is_superadmin = bool(user.get("sa"))
    if is_last and not is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El último firmante debe ser DRP (superadmin)")
    if is_last and not body.pdf_base64:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "La firma de sellado requiere adjuntar el PDF final (pdf_base64)"
        )

    now = time.time()
    db.execute(
        "UPDATE rf_approval_signers SET signed_at=?, justification_text=? WHERE id=?",
        (now, body.justification_text, me["id"]),
    )
    log_event(project_id, doc_type, user, "approval_signed", f"{user['u']} firmó la aprobación de {doc_type}")
    sealed = False

    if is_last:
        pdf_hash = hashlib.sha256(body.pdf_base64.encode()).hexdigest()
        json_hash = hashlib.sha256(doc["json_data"].encode()).hexdigest()
        db.execute(
            "UPDATE rf_approval_rounds SET status='sealed', sealed_at=? WHERE id=?", (now, rnd["id"])
        )
        db.execute(
            "UPDATE rf_documents SET locked=1, status='locked', locked_at=?, pdf_hash=?, json_hash=? WHERE id=?",
            (now, pdf_hash, json_hash, doc["id"]),
        )
        sealed = True
        log_event(project_id, doc_type, user, "document_sealed", f"{doc_type} quedó sellado e inmutable")

    db.commit()

    for s in signers:
        srow = db.execute("SELECT email FROM rf_users WHERE id=?", (s["user_id"],)).fetchone()
        if srow and srow["email"]:
            if sealed:
                send_email(srow["email"], f"{doc_type} sellado", f"<p>{doc_type} quedó firmado y sellado.</p>")
            else:
                send_email(srow["email"], f"Firma registrada en {doc_type}", f"<p>{user['u']} firmó {doc_type}.</p>")

    return {"ok": True, "sealed": sealed}
