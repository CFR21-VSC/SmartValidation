"""
routers/documents.py — Vista de revisión (Capa 3 / sección 4 del diseño).

Panel izquierdo: JSON fuente cargado a mano por DRP, inmutable durante la
revisión. Panel derecho: comentarios de revisión por sección — varios por
sección, cada uno atribuido a su autor, guardado explícito (no autosave) para
poder avisar por mail sin saturar. Nunca pisan el JSON fuente ni se mezclan
con el contenido en ninguna vista previa (confirmado con el usuario
2026-08-31: "Ver PDF" siempre muestra el original). Ambos requieren
habilitación granular por documento (excepto DRP, que ve todo).
"""
import base64
import hashlib
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from .. import config, email_resend, validacion_bridge
from ..audit import log_event, log_system_event
from ..db import get_db
from ..deps import assert_owner_if_private, check_document_access, ensure_project_active, get_current_user, require_drp
from ..doc_order import sort_docs
from .book import (
    collect_signatures_split, fecha as _fmt_fecha, iniciales as _fmt_iniciales,
    inject_signatures_section, _resolve_consent_ids,
)
from .projects import ensure_project, has_signature_evidence

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])

# Sin prefijo /projects/{project_id} -- es "mis pendientes" cruzando TODOS los proyectos a
# la vez (sección 2026-09-01, mismo criterio que audit_router en projects.py: no depende de
# estar parado dentro de un proyecto).
me_router = APIRouter(prefix="/me", tags=["comments"])


@me_router.get("/pending-comments")
def my_pending_comments(user: dict = Depends(get_current_user)):
    """DRP ve todos los hilos raíz sin resolver del sistema -- es el único rol que puede
    resolver, así que todo pendiente es accionable por él (sección 2026-09-01). Cliente ve
    solo los de los documentos que tiene con grant -- mismo criterio de visibilidad que
    list_documents/check_document_access, sin inventar un concepto de acceso nuevo. Un solo
    SELECT en cada rama, sin loop -- evita el patrón N+1 (mismo criterio pedido por el
    usuario para el bridge)."""
    db = get_db()
    base_select = (
        "SELECT c.id AS comment_id, c.section_key, c.content, c.username AS author, "
        "c.created_at, d.project_id, d.doc_type "
        "FROM rf_section_comments c JOIN rf_documents d ON d.id = c.document_id "
    )
    if user.get("r") == "drp":
        rows = db.execute(
            base_select + "WHERE c.parent_id IS NULL AND c.resolved = 0 ORDER BY c.created_at",
        ).fetchall()
    else:
        rows = db.execute(
            base_select + "JOIN rf_document_access_grants g "
            "ON g.project_id = d.project_id AND g.doc_type = d.doc_type "
            "WHERE g.user_id = ? AND c.parent_id IS NULL AND c.resolved = 0 ORDER BY c.created_at",
            (user.get("uid"),),
        ).fetchall()

    items = []
    for r in rows:
        content = r["content"] or ""
        items.append({
            "project_id": r["project_id"], "doc_type": r["doc_type"], "section_key": r["section_key"],
            "comment_id": r["comment_id"], "author": r["author"], "created_at": r["created_at"],
            "content_preview": content if len(content) <= 200 else content[:200] + "…",
        })
    return {"ok": True, "count": len(items), "items": items}


class LoadDocumentBody(BaseModel):
    json_data: dict[str, Any]


class CommentBody(BaseModel):
    content: str
    parent_id: int | None = None  # None = comentario raíz; si no, responde a esa raíz


class PushToValidacionBody(BaseModel):
    confirmed: bool = False


def _branding_for_document(db, project_id: str, doc: dict) -> dict | None:
    """Marca de partner/cliente a mostrar para ESTE documento. Si está sellado y tiene un
    snapshot fijado al momento de firmar (Ronda 18: branding_captured_at_signing=True), usa
    ESE snapshot tal cual -- incluso si es "sin marca" (se selló sin partner a propósito), sin
    caer al branding actual del proyecto. Antes se inferían las dos cosas ("nunca se capturó"
    vs "se capturó vacío") de lo mismo -- branding_logo_at_signing NULL -- así que un documento
    sellado SIN marca terminaba mostrando la marca ACTUAL si alguien la cargaba después
    (encontrado en segunda revisión de Codex, 2026-09-19). Solo cuando no hay snapshot en
    absoluto (documento sin sellar, o sellado antes de que existiera este campo) cae al
    branding actual del proyecto, gateado por logo -- mismo criterio que get_book_package."""
    if doc.get("locked") and doc.get("branding_captured_at_signing"):
        if doc.get("branding_logo_at_signing"):
            return {"name": doc.get("branding_name_at_signing") or "", "logo": doc["branding_logo_at_signing"]}
        return None  # snapshot fijado explícitamente SIN marca -- no es lo mismo que "desconocido"
    proj = db.execute(
        "SELECT partner_name, partner_logo FROM rf_projects WHERE id=?", (project_id,)
    ).fetchone()
    if proj and proj["partner_logo"]:
        return {"name": proj["partner_name"] or "", "logo": proj["partner_logo"]}
    return None


def _content_fingerprint(json_data_str: str) -> str:
    """sha256 del JSON tal como está guardado (el string exacto, no un re-serializado) --
    tiene que ser el MISMO valor que ve el cliente al leer el documento y el que se
    recalcula acá al firmar/guardar, o el chequeo de contenido cambiado da falso positivo."""
    return hashlib.sha256(json_data_str.encode("utf-8")).hexdigest()


def _upsert_document(db, project_id: str, doc_type: str, json_data: dict, actor: dict) -> dict:
    """Carga o reemplaza el JSON fuente de un documento. Rechaza si el documento ya está
    sellado/inmutable, si ya tiene alguna firma (revisión o aprobación, no solo el sellado
    final -- Ronda 18, 2026-09-19: antes un documento con 3 de 4 aprobadores firmados seguía
    totalmente editable y las firmas ya grabadas quedaban apuntando a contenido reemplazado),
    o si el proyecto está cerrado/archivado. Compartida entre la carga manual (`load_document`,
    sesión DRP) y el bridge de servicio (push automático desde la Suite Documental) -- `actor`
    es el dict a loguear, solo necesita la clave "u". Para volver a editar un documento con
    firmas, ver reopen_document -- es la única vía, invalida las firmas explícitamente en vez
    de dejarlas silenciosamente desactualizadas."""
    ensure_project_active(db, project_id)
    existing = db.execute(
        "SELECT id, locked, edit_locked FROM rf_documents WHERE project_id=? AND doc_type=?",
        (project_id, doc_type)
    ).fetchone()
    if existing and existing["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no puede modificarse")
    if existing and existing["edit_locked"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "El documento ya tiene firmas registradas — un DRP tiene que reabrirlo explícitamente antes de poder editarlo",
        )

    now = time.time()
    if existing:
        # Ronda 18, segunda vuelta (revisión de Codex, 2026-09-19): el chequeo de arriba y
        # este UPDATE eran dos pasos separados -- una firma podía colarse justo entre medio
        # (demostrado por Codex intercalando esta función dentro de sign_review). La condición
        # WHERE hace que el propio UPDATE sea el chequeo: si alguien puso edit_locked=1 o
        # locked=1 entre el SELECT de arriba y acá, esta sentencia no toca ninguna fila
        # (rowcount=0) en vez de pisar el guardia silenciosamente -- una sola sentencia SQL es
        # atómica en sí misma en SQLite y en Postgres, sin necesitar una transacción explícita
        # para esto en particular.
        cur = db.execute(
            "UPDATE rf_documents SET json_data=?, loaded_by=?, updated_at=? "
            "WHERE id=? AND locked=0 AND edit_locked=0",
            (json.dumps(json_data), actor["u"], now, existing["id"]),
        )
        if cur.rowcount == 0:
            fresh = db.execute("SELECT locked, edit_locked FROM rf_documents WHERE id=?", (existing["id"],)).fetchone()
            if fresh and fresh["locked"]:
                raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no puede modificarse")
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "El documento ya tiene firmas registradas — un DRP tiene que reabrirlo explícitamente antes de poder editarlo",
            )
        doc_id = existing["id"]
    else:
        doc_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO rf_documents (id, project_id, doc_type, json_data, loaded_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (doc_id, project_id, doc_type, json.dumps(json_data), actor["u"], now, now),
        )
    created_project = ensure_project(db, project_id, actor["u"])
    db.commit()
    if created_project:
        log_system_event(actor, "project_created", f"{actor['u']} creó el proyecto", project_id=project_id)
    log_event(project_id, doc_type, actor, "document_loaded", f"{actor['u']} cargó {doc_type}")
    return {"ok": True, "document_id": doc_id}


@router.put("/{doc_type}")
def load_document(project_id: str, doc_type: str, body: LoadDocumentBody, user: dict = Depends(require_drp)):
    """DRP carga (o reemplaza) el JSON fuente. Rechaza si el documento ya está sellado/inmutable
    o si el proyecto está cerrado/archivado."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    return _upsert_document(db, project_id, doc_type, body.json_data, user)


@router.delete("/{doc_type}")
def delete_document(project_id: str, doc_type: str, user: dict = Depends(require_drp)):
    """Elimina un documento puntual (no el proyecto entero). Bloqueado si está sellado —
    la inmutabilidad de un documento firmado no se salta borrándolo. El evento queda en
    el audit trail de sistema, no en el People Book (ese es del ciclo GxP del documento,
    no de acciones administrativas — sección 5 de la arquitectura)."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no puede eliminarse")
    # Ronda 18, segunda vuelta (revisión de Codex, 2026-09-19): antes solo miraba `locked` --
    # un documento con una firma de revisión (edit_locked=1, pero locked sigue en 0 porque
    # nunca llegó a sellarse) se borraba igual, y la cascada de la FK se llevaba puesta la
    # firma con él. El bloqueo tiene que depender de que EXISTA evidencia de firma, activa o
    # invalidada -- no del flag de edición actual, que un DRP puede volver a poner en 0 al
    # reabrir sin que eso implique que la historia dejó de importar. has_signature_evidence
    # (projects.py, compartida con delete_project) también excluye designaciones de ronda sin
    # firmar todavía (signed_at IS NULL) -- eso no es evidencia de firma electrónica (tercera
    # devolución de Codex).
    if has_signature_evidence(db, doc["id"]):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "El documento tiene firmas registradas (activas o invalidadas) — no se puede eliminar, "
            "conserva evidencia de firma electrónica",
        )

    db.execute("DELETE FROM rf_documents WHERE id=?", (doc["id"],))  # cascada: corrections/comentarios
    db.commit()
    log_system_event(user, "document_deleted", f"{user['u']} eliminó {doc_type}", project_id=project_id, doc_type=doc_type)
    return {"ok": True}


@router.get("/{doc_type}/grants")
def list_document_grants(project_id: str, doc_type: str, user: dict = Depends(require_drp)):
    """Quién tiene acceso a ESTE documento puntual — usado por el panel "Asignar acceso"
    del dashboard, para no tener que ir a la pantalla de Usuarios a ver/otorgar accesos
    documento por documento."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    rows = db.execute(
        "SELECT g.id, g.user_id, u.username, u.display_name, u.email, u.role, "
        "g.granted_by, g.granted_at "
        "FROM rf_document_access_grants g JOIN rf_users u ON u.id = g.user_id "
        "WHERE g.project_id=? AND g.doc_type=? ORDER BY g.granted_at",
        (project_id, doc_type),
    ).fetchall()
    return {"ok": True, "grants": [dict(r) for r in rows]}


@router.get("")
def list_documents(project_id: str, user: dict = Depends(get_current_user)):
    """DRP ve todos los documentos del proyecto. Cliente solo los que tiene habilitados.

    Orden: el que DRP haya elegido a mano para este proyecto (display_order), o si nunca
    reordenó nada, la cascada GxP por defecto -- no alfabético (doc_order.py; pedido del
    usuario 2026-09-19: alfabético mezclaba tipos sin relación con el ciclo de vida real del
    proyecto, ej. IOQ antes que HLRA, y además quería poder reordenar a mano).

    Privacidad (2026-09-19): un proyecto privado ajeno hace caer a un DRP no-dueño al mismo
    camino que cliente/partner -- mismo criterio que get_dossier (projects.py)."""
    db = get_db()
    proj = db.execute("SELECT is_private, owner_user_id FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    is_owner = bool(proj) and proj["owner_user_id"] == user.get("uid")
    private_and_not_owner = bool(proj) and proj["is_private"] and not is_owner
    if user.get("r") == "drp" and not private_and_not_owner:
        rows = db.execute(
            "SELECT id, doc_type, status, locked, created_at, updated_at, display_order "
            "FROM rf_documents WHERE project_id=?",
            (project_id,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT d.id, d.doc_type, d.status, d.locked, d.created_at, d.updated_at, d.display_order "
            "FROM rf_documents d "
            "JOIN rf_document_access_grants g ON g.project_id=d.project_id AND g.doc_type=d.doc_type "
            "WHERE d.project_id=? AND g.user_id=?",
            (project_id, user.get("uid")),
        ).fetchall()
    return {"ok": True, "documents": sort_docs([dict(r) for r in rows])}


class DocumentsOrderBody(BaseModel):
    doc_types: list[str]  # orden deseado, de arriba a abajo


@router.patch("/order")
def set_documents_order(project_id: str, body: DocumentsOrderBody, user: dict = Depends(require_drp)):
    """Guarda el orden elegido a mano por DRP para los documentos de este proyecto (pedido
    del usuario, 2026-09-19: "el orden lo doy yo, quiero poder reordenar a piacere y que se
    guarde"). display_order queda como el índice dentro de `doc_types` -- se pisa entero en
    cada guardado, no se hace merge con el orden anterior. Solo toca los doc_type que existen
    en este proyecto; cualquier otro valor en la lista se ignora en silencio (defensivo, no
    debería pasar si el frontend manda la lista completa que él mismo mostró)."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    for idx, doc_type in enumerate(body.doc_types):
        db.execute(
            "UPDATE rf_documents SET display_order=? WHERE project_id=? AND doc_type=?",
            (idx, project_id, doc_type),
        )
    db.commit()
    log_system_event(
        user, "documents_reordered", f"{user['u']} reordenó los documentos del proyecto",
        project_id=project_id,
    )
    return {"ok": True}


def _get_document_or_404(db, project_id: str, doc_type: str) -> dict:
    row = db.execute(
        "SELECT * FROM rf_documents WHERE project_id=? AND doc_type=?", (project_id, doc_type)
    ).fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
    return dict(row)


@router.post("/{doc_type}/push-to-validacion")
def push_to_validacion(
    project_id: str, doc_type: str, body: PushToValidacionBody, user: dict = Depends(require_drp),
):
    """Manda el documento tal como está guardado acá (con las correcciones ya aplicadas) de
    vuelta a la Suite Documental (server.py) para que el motor de coherencia lo re-valide
    antes de pisar el documento real allá -- dirección INVERSA del bridge original, que solo
    empujaba Validación -> Firmas. Ver validacion_bridge.py para el detalle del contrato
    (bloqueo por CRITICO nuevo, confirmación por MAYOR/MENOR nuevo)."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    result = validacion_bridge.push_correction(
        project_id, doc_type, json.loads(doc["json_data"]), user["u"], confirmed=body.confirmed,
    )
    if result.get("ok"):
        log_system_event(
            user, "corrected_pushed_to_validacion",
            f"{user['u']} envió una corrección de {doc_type} a la Suite Documental",
            project_id=project_id, doc_type=doc_type,
        )
    return JSONResponse(status_code=result.get("status") or 502, content=result)


@router.get("/{doc_type}")
def get_document(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    comments = db.execute(
        "SELECT id, section_key, content, resolved, user_id, username, created_at, parent_id "
        "FROM rf_section_comments WHERE document_id=? ORDER BY section_key, created_at",
        (doc["id"],),
    ).fetchall()
    # content_fingerprint ANTES de parsear json_data -- tiene que ser el hash del string
    # exacto guardado, no de un re-serializado (Ronda 18: el cliente lo guarda tal cual y lo
    # reenvía al firmar/guardar; el backend recalcula del mismo string al recibirlo).
    content_fingerprint = _content_fingerprint(doc["json_data"])
    branding = _branding_for_document(db, project_id, doc)
    doc["json_data"] = json.loads(doc["json_data"])
    return {
        "ok": True, "document": doc, "comments": [dict(c) for c in comments],
        "partner_branding": branding, "content_fingerprint": content_fingerprint,
    }


@router.get("/{doc_type}/signed-render")
def get_signed_render(
    project_id: str, doc_type: str, include_pending: bool = False, user: dict = Depends(get_current_user),
):
    """JSON del documento con la sección 'firmas-horizontales' rellena con las firmas reales
    (revisión + aprobación, Ronda 20 -- reemplaza a la vieja 'tabla-firmas-final', tipo
    eliminado del sistema de renderizado) — para que "Ver PDF" de un documento suelto muestre
    lo mismo que va a mostrar el Libro compilado, en vez de una tabla vacía o desactualizada.

    `include_pending=true` (usado al generar el PDF que se va a adjuntar en la firma que
    sella) suma también la propia firma del usuario logueado si es firmante de una ronda de
    aprobación abierta y todavía no firmó — esa firma se va a grabar un instante después, en
    la misma acción de sellar, así que el documento hasheado para siempre tiene que mostrarla."""
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    # Del contenido REAL guardado, no de esta proyección (que ya trae firmas/branding
    # inyectados) -- es lo que sign_review/sign_approval van a recalcular para comparar.
    content_fingerprint = _content_fingerprint(doc["json_data"])
    data = json.loads(doc["json_data"])
    firmas_split = collect_signatures_split(db, [doc["id"]])[doc["id"]]
    firmas_revision, firmas_aprobacion = firmas_split["revision"], firmas_split["aprobacion"]

    if include_pending:
        pending = db.execute(
            "SELECT sig.role_label FROM rf_approval_signers sig "
            "JOIN rf_approval_rounds rnd ON rnd.id = sig.round_id "
            "WHERE rnd.document_id=? AND rnd.status='open' AND sig.user_id=? AND sig.signed_at IS NULL",
            (doc["id"], user["uid"]),
        ).fetchone()
        if pending:
            nombre = user["d"] or user["u"]
            # 2026-09-23: previsualización de la firma cursiva propia (todavía no firmó, no
            # hay snapshot -- se lee el valor configurado ahora, en vivo, como preview de lo
            # que va a quedar congelado apenas firme de verdad).
            urow_pending = db.execute(
                "SELECT signature_display_name FROM rf_users WHERE id=?", (user["uid"],)
            ).fetchone()
            firma_cursiva = (urow_pending["signature_display_name"] if urow_pending else None) or nombre
            firmas_aprobacion.append({
                "rol": pending["role_label"] or "Aprobador", "nombre": nombre,
                "iniciales": _fmt_iniciales(nombre), "firmaCursiva": firma_cursiva,
                "fecha": _fmt_fecha(time.time()),
            })

    _resolve_consent_ids(db, firmas_revision, firmas_aprobacion)
    data = inject_signatures_section(data, doc, firmas_revision, firmas_aprobacion)
    # Si está sellado, usa el branding FIJADO al sellar (Ronda 18) -- no el actual del
    # proyecto. Solo en esta proyección de render -- nunca se guarda, `data` acá es lo que ya
    # devuelve inject_signatures_section (firmas incluidas "as of now"), no el documento
    # editable. template-base.js lee este campo para dibujar el segundo logo/nombre.
    branding = _branding_for_document(db, project_id, doc)
    if branding:
        data["_partnerBranding"] = branding
    # is_original=False siempre acá -- esta es una proyección regenerada con datos actuales
    # (firmas "as of now", branding actual), nunca el artefacto exacto que se selló. Ver
    # GET .../original para los bytes reales del PDF sellado, cuando existen.
    return {"ok": True, "data": data, "content_fingerprint": content_fingerprint, "is_original": False}


class ReopenDocumentBody(BaseModel):
    reason: str


@router.post("/{doc_type}/reopen")
def reopen_document(
    project_id: str, doc_type: str, body: ReopenDocumentBody, user: dict = Depends(get_current_user),
):
    """Única vía para volver a editar un documento con firmas (Ronda 18, 2026-09-19). Nunca
    borra una firma -- las marca invalidated_at/invalidated_reason, quedan como evidencia de
    que existieron y de por qué dejaron de valer. Si hay una ronda de aprobación abierta con
    firmantes parciales, se cancela (no queda "medio abierta" sobre contenido que va a
    cambiar). Requiere motivo explícito, no vacío -- se audita.

    DRP siempre puede reabrir. Partner (rol intermedio, 2026-09-19) puede reabrir solo los
    documentos donde tiene un grant explícito -- check_document_access ya hace exactamente
    esa distinción (DRP pasa siempre, cualquier otro rol necesita el grant); cliente queda
    afuera acá explícitamente, aunque tenga grant, porque reabrir no es parte de lo que
    puede hacer ese rol."""
    if user.get("r") not in ("drp", "partner"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere rol DRP o partner con acceso a este documento")
    db = get_db()
    check_document_access(user, project_id, doc_type)
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El motivo de reapertura es obligatorio")
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "El documento está sellado (aprobación completa) — no se puede reabrir",
        )
    if not doc["edit_locked"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El documento no tiene firmas, no hace falta reabrirlo")

    now = time.time()
    # Codex (tercera devolución, 2026-09-19): inyectando un fallo en el UPDATE final
    # (edit_locked=0) con estos como statements sueltos en autocommit (ver db.py), las firmas
    # ya quedaban invalidadas -- committeadas cada una por su cuenta -- mientras edit_locked
    # seguía en 1: reapertura fallida a medias, firmas invalidadas sin poder volver a editar
    # ni reintentar limpio. db.commit() al final no agrupaba nada retroactivamente, cada
    # execute() ya se había confirmado solo. Mismo patrón que sign_review/sign_approval:
    # invalidar + cancelar + desbloquear, todo en una sola transacción real.
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute(
            "UPDATE rf_review_signatures SET invalidated_at=?, invalidated_reason=? "
            "WHERE document_id=? AND invalidated_at IS NULL",
            (now, reason, doc["id"]),
        )
        open_rounds = db.execute(
            "SELECT id FROM rf_approval_rounds WHERE document_id=? AND status='open'", (doc["id"],)
        ).fetchall()
        for rnd in open_rounds:
            db.execute(
                "UPDATE rf_approval_signers SET invalidated_at=?, invalidated_reason=? "
                "WHERE round_id=? AND invalidated_at IS NULL",
                (now, reason, rnd["id"]),
            )
            db.execute("UPDATE rf_approval_rounds SET status='cancelled' WHERE id=?", (rnd["id"],))
        db.execute("UPDATE rf_documents SET edit_locked=0, updated_at=? WHERE id=?", (now, doc["id"]))
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise
    log_system_event(
        user, "document_reopened", f"{user['u']} reabrió {doc_type} para editar — motivo: {reason}",
        project_id=project_id, doc_type=doc_type,
    )
    return {"ok": True}


@router.get("/{doc_type}/original")
def get_original_pdf(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    """Bytes exactos del PDF que se selló, tal cual se guardaron -- nunca regenerado. Distinto
    de /signed-render, que siempre arma una proyección con datos actuales. 404 explícito (no
    un PDF inventado), con un mensaje que distingue el motivo real entre TRES estados
    (revisión de Codex, 2026-09-19, segunda y tercera devolución): documento que todavía no se
    selló; sellado antes de que original_stored existiera (histórico esperado, sin PDF por
    diseño); y original_stored=1 sin pdf_data (inconsistencia de ALMACENAMIENTO -- el sellado
    creyó haber guardado el PDF y no está, un bug o una pérdida de datos, no un documento
    "anterior a la funcionalidad" -- antes los dos últimos casos compartían el mismo mensaje)."""
    check_document_access(user, project_id, doc_type)
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    if not doc["locked"]:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Este documento todavía no está sellado — no existe un PDF original que descargar.",
        )
    if doc["original_stored"] and not doc["pdf_data"]:
        log_system_event(
            user, "original_pdf_missing_inconsistency",
            f"{user['u']} pidió el PDF original de {doc_type}: original_stored=1 pero sin pdf_data "
            "(inconsistencia de almacenamiento, no un documento histórico)",
            project_id=project_id, doc_type=doc_type,
        )
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Este documento debería tener el PDF original guardado pero no está disponible — "
            "es una inconsistencia de almacenamiento, no un documento sellado antes de esta "
            "función. Contactá a soporte, no reintentar el sellado.",
        )
    if not doc["original_stored"]:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Este documento se selló antes de que se empezara a guardar el artefacto original — "
            "solo se conserva su hash, no se puede descargar el PDF original exacto.",
        )
    pdf_bytes = base64.b64decode(doc["pdf_data"])
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{doc_type}-original.pdf"'},
    )


@router.post("/{doc_type}/sections/{section_key}/comments")
def add_comment(
    project_id: str, doc_type: str, section_key: str, body: CommentBody,
    user: dict = Depends(get_current_user),
):
    """Guardado explícito (no autosave) — el revisor escribe y toca "Guardar comentario".
    Cada comentario es una fila nueva, atribuida a su autor; no pisa comentarios de otros
    revisores en la misma sección. Nunca toca rf_documents.json_data.

    Sin `parent_id`: es un comentario raíz nuevo, dispara mail a TODO DRP activo, sin excluir
    al autor — confirmado con el usuario (2026-08-31): con un solo DRP en el sistema, excluir
    al autor significaba que nunca le llegaba nada a él mismo cuando comentaba.

    Con `parent_id`: es una respuesta (hilo plano, sección pedida 2026-09-01) -- notifica SOLO
    al autor del comentario raíz, no a todo DRP, salvo que se esté respondiendo a sí mismo."""
    check_document_access(user, project_id, doc_type)
    db = get_db()
    ensure_project_active(db, project_id)
    doc = _get_document_or_404(db, project_id, doc_type)
    if doc["locked"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "El documento está sellado — no admite comentarios")

    parent = None
    if body.parent_id is not None:
        parent = db.execute(
            "SELECT id, document_id, parent_id, user_id FROM rf_section_comments WHERE id=?",
            (body.parent_id,),
        ).fetchone()
        if not parent or parent["document_id"] != doc["id"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Comentario padre no encontrado en este documento")
        if parent["parent_id"] is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No se puede responder a una respuesta -- respondé al comentario raíz del hilo",
            )

    now = time.time()
    cur = db.execute(
        "INSERT INTO rf_section_comments "
        "(document_id, section_key, content, resolved, user_id, username, created_at, parent_id) "
        "VALUES (?,?,?,0,?,?,?,?)",
        (doc["id"], section_key, body.content, user["uid"], user["u"], now, body.parent_id),
    )
    comment_id = cur.lastrowid
    db.commit()
    log_event(
        project_id, doc_type, user,
        "comment_reply_added" if parent else "comment_added",
        f"{user['u']} " + (
            f"respondió un comentario en la sección '{section_key}'" if parent
            else f"comentó la sección '{section_key}'"
        ),
    )

    doc_link = f"{config.APP_BASE_URL}/app/review.html?project={project_id}&doc={doc_type}"
    if parent:
        if parent["user_id"] and parent["user_id"] != user["uid"]:
            author = db.execute("SELECT email, display_name FROM rf_users WHERE id=?", (parent["user_id"],)).fetchone()
            if author and author["email"]:
                email_resend.send_comment_reply_email(
                    author["email"], author["display_name"], project_id, doc_type,
                    section_key, user["u"], body.content, doc_link,
                )
    else:
        drp_users = db.execute(
            "SELECT email, display_name FROM rf_users WHERE role='drp' AND is_active=1"
        ).fetchall()
        for drp in drp_users:
            email_resend.send_new_comment_email(
                drp["email"], drp["display_name"], project_id, doc_type, section_key, user["u"], body.content, doc_link,
            )

    return {
        "ok": True,
        "comment": {
            "id": comment_id, "section_key": section_key, "content": body.content,
            "resolved": 0, "user_id": user["uid"], "username": user["u"], "created_at": now,
            "parent_id": body.parent_id,
        },
    }


@router.get("/{doc_type}/people-book")
def get_people_book(project_id: str, doc_type: str, user: dict = Depends(require_drp)):
    """Libro de Validación, sección People — audit trail del documento (sección 6).
    Sin interfaz visual todavía: expone los datos crudos para que DRP los consulte."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    rows = db.execute(
        "SELECT username, event_type, description, created_at FROM rf_people_book_events "
        "WHERE project_id=? AND doc_type=? ORDER BY created_at",
        (project_id, doc_type),
    ).fetchall()
    return {"ok": True, "events": [dict(r) for r in rows]}


def _list_comments(db, project_id: str, doc_type: str) -> list[dict]:
    """Comentarios de sección de un documento, más viejo primero por sección. Compartida
    entre el endpoint de usuario (`list_comments`) y el bridge de servicio."""
    doc = _get_document_or_404(db, project_id, doc_type)
    rows = db.execute(
        "SELECT id, section_key, content, resolved, user_id, username, created_at, parent_id "
        "FROM rf_section_comments WHERE document_id=? ORDER BY section_key, created_at",
        (doc["id"],),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/{doc_type}/comments")
def list_comments(project_id: str, doc_type: str, user: dict = Depends(get_current_user)):
    check_document_access(user, project_id, doc_type)
    db = get_db()
    return {"ok": True, "comments": _list_comments(db, project_id, doc_type)}


@router.patch("/{doc_type}/sections/{section_key}/comments/{comment_id}/resolve")
def resolve_comment(
    project_id: str, doc_type: str, section_key: str, comment_id: int, user: dict = Depends(require_drp),
):
    """DRP confirma que ya consideró ese comentario puntual — habilita la firma de revisión
    cuando todos los comentarios del documento están resueltos (sección 5.1). Avisa por mail
    al autor del comentario (sección pedida 2026-09-01), salvo que DRP se esté resolviendo
    un comentario propio."""
    db = get_db()
    doc = _get_document_or_404(db, project_id, doc_type)
    comment = db.execute(
        "SELECT user_id FROM rf_section_comments WHERE id=? AND document_id=? AND section_key=?",
        (comment_id, doc["id"], section_key),
    ).fetchone()
    if not comment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comentario no encontrado")
    db.execute(
        "UPDATE rf_section_comments SET resolved=1 WHERE id=? AND document_id=? AND section_key=?",
        (comment_id, doc["id"], section_key),
    )
    db.commit()
    log_event(project_id, doc_type, user, "comment_resolved", f"DRP resolvió un comentario en la sección '{section_key}'")

    if comment["user_id"] and comment["user_id"] != user["uid"]:
        author = db.execute("SELECT email, display_name FROM rf_users WHERE id=?", (comment["user_id"],)).fetchone()
        if author and author["email"]:
            doc_link = f"{config.APP_BASE_URL}/app/review.html?project={project_id}&doc={doc_type}"
            email_resend.send_comment_resolved_email(
                author["email"], author["display_name"], project_id, doc_type, section_key, doc_link,
            )
    return {"ok": True}
