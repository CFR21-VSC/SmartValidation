"""
routers/projects.py — Listado + ciclo de vida de proyectos (fase 5).

Un proyecto sigue sin "crearse" explícitamente (sección 4) — aparece la primera
vez que se carga un documento bajo ese project_id (ver ensure_project, llamado
desde documents.load_document). Lo que sí es nuevo acá es que ese proyecto
implícito ahora tiene estado propio: activo / cerrado / archivado / eliminado.
"""
import re
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..audit import log_system_event
from ..db import get_db
from ..deps import assert_owner_if_private, get_current_user, has_any_grant_in_project, is_superadmin_fresh, require_drp
from ..doc_order import sort_docs


def has_signature_evidence(db, document_id: str) -> bool:
    """¿Existe alguna firma real (activa o invalidada) para este documento? Compartida entre
    delete_document (documents.py) y delete_project (acá abajo) -- Codex encontró (tercera
    devolución, 2026-09-19) que delete_project no aplicaba esta protección en absoluto, solo
    chequeaba `locked`, así que un proyecto con un documento con firma de revisión activa se
    borraba entero y la cascada se llevaba la firma puesta.

    rf_review_signatures: toda fila representa una firma YA emitida (sign_review solo inserta
    al firmar, nunca antes) -- no necesita filtro extra. rf_approval_signers es distinto: una
    fila existe desde que se DESIGNA un firmante al crear la ronda, con signed_at NULL hasta
    que esa persona realmente firma -- una ronda configurada pero sin firmar todavía no es
    evidencia de firma electrónica y no debe bloquear el borrado (precisión pedida por Codex
    en la misma devolución)."""
    has_review_sig = db.execute(
        "SELECT 1 FROM rf_review_signatures WHERE document_id=? LIMIT 1", (document_id,)
    ).fetchone()
    if has_review_sig:
        return True
    has_approval_sig = db.execute(
        "SELECT 1 FROM rf_approval_signers sig JOIN rf_approval_rounds rnd ON rnd.id = sig.round_id "
        "WHERE rnd.document_id=? AND sig.signed_at IS NOT NULL LIMIT 1", (document_id,)
    ).fetchone()
    return bool(has_approval_sig)

router = APIRouter(prefix="/projects", tags=["projects"])

# Sin prefijo /projects — es el audit trail de sistema UNIFICADO, cruzando todos los
# proyectos a la vez (confirmado por el usuario 2026-08-30: "no lo logro ver si no estoy
# dentro de un proyecto"). El endpoint scoped por proyecto (/projects/{id}/audit-log) sigue
# existiendo para cuando sí importa filtrar por uno solo.
audit_router = APIRouter(tags=["audit"])


def ensure_project(db, project_id: str, username: str) -> bool:
    """Crea la fila rf_projects si no existe todavía. Idempotente.
    Devuelve True solo si la creó recién ahora (para loguear project_created una sola vez)."""
    existing = db.execute("SELECT id FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    if existing:
        return False
    now = time.time()
    db.execute(
        "INSERT INTO rf_projects (id, status, created_by, created_at, updated_at) "
        "VALUES (?,'active',?,?,?)",
        (project_id, username, now, now),
    )
    return True


def _get_project_or_404(db, project_id: str, user: dict) -> dict:
    """`user` es obligatorio -- todos los llamadores de esta función son endpoints DRP-only
    de ciclo de vida del proyecto (close/archive/reopen/rename/branding/delete), exactamente
    los que necesitan el chequeo de privacidad (pedido del usuario, 2026-09-19: un proyecto
    privado es invisible incluso para otro DRP que no sea su dueño)."""
    row = db.execute("SELECT * FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    if row:
        proj = dict(row)
    else:
        # Migración: proyectos con documentos cargados ANTES de que existiera rf_projects
        # (fase 5) no tienen fila propia todavía — sin este backfill, close/archive/delete
        # les devuelven 404 aunque existan de verdad, y el bloqueo por sellado del DELETE
        # nunca llega a evaluarse (encontrado en QA real 2026-08-30). Self-healing: si tiene
        # al menos un documento, se lo trata como activo y se crea la fila recién ahora.
        has_docs = db.execute("SELECT 1 FROM rf_documents WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
        if not has_docs:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")
        ensure_project(db, project_id, "sistema")
        db.commit()
        proj = dict(db.execute("SELECT * FROM rf_projects WHERE id=?", (project_id,)).fetchone())
    if proj["is_private"] and proj["owner_user_id"] != user.get("uid"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")
    return proj


_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,120}$")


class CreateProjectBody(BaseModel):
    id: str
    is_private: bool = False


@router.post("")
def create_project(body: CreateProjectBody, user: dict = Depends(require_drp)):
    """Creación explícita de un proyecto (pedido del usuario, 2026-09-19) -- antes un
    proyecto solo "aparecía" al cargar su primer documento (ensure_project, llamado desde
    _upsert_document), sin ningún momento donde decidir si es privado. Eso sigue funcionando
    igual para proyectos públicos comunes (no hace falta pasar por acá); esta vía es la única
    forma de crear uno PRIVADO desde el primer instante, sin una ventana donde exista como
    público. is_private=true es exclusivo de superadmin -- releído fresco de la base, nunca
    del token (ver is_superadmin_fresh)."""
    project_id = body.id.strip()
    if not project_id or not _ID_RE.match(project_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El id debe tener 1-120 caracteres: letras, números, punto, guión o guión bajo",
        )
    db = get_db()
    existing = db.execute("SELECT id FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    has_docs = db.execute("SELECT 1 FROM rf_documents WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
    if existing or has_docs:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un proyecto con ese id")
    if body.is_private and not is_superadmin_fresh(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo superadmin puede crear proyectos privados")

    now = time.time()
    owner = user.get("uid") if body.is_private else None
    db.execute(
        "INSERT INTO rf_projects (id, status, created_by, created_at, updated_at, is_private, owner_user_id) "
        "VALUES (?,'active',?,?,?,?,?)",
        (project_id, user["u"], now, now, int(body.is_private), owner),
    )
    db.commit()
    log_system_event(
        user, "project_created",
        f"{user['u']} creó el proyecto" + (" (privado)" if body.is_private else ""),
        project_id=project_id,
    )
    return {"ok": True, "id": project_id, "is_private": body.is_private}


# Un comentario sin resolver más viejo que esto se marca "atrasado" en el dossier — ayuda
# a detectar cuellos de botella (sección pedida por el usuario 2026-08-31).
STALE_COMMENT_DAYS = 3


@router.get("/{project_id}/dossier")
def get_dossier(project_id: str, user: dict = Depends(get_current_user)):
    """Estado en vivo + KPIs de tiempo por documento (acompañamiento visual del proyecto,
    sección pedida por el usuario 2026-08-31 — inspirado en el "Dossier en vivo" de la Suite
    de Validación, pero con KPIs de ciclo propios: acá sí hay timestamps reales de cada
    etapa). DRP ve todos los documentos del proyecto. Partner (rol intermedio, 2026-09-19 --
    una empresa que colabora activamente en el proyecto, ej. EMARA, sin ser DRP) ve el
    dossier COMPLETO del proyecto en cuanto tiene al menos un documento otorgado ahí -- no
    queda limitado a sus documentos puntuales como cliente, que sigue viendo solo lo que
    tiene habilitado uno por uno. Si el proyecto es privado (2026-09-19), el bypass de rol
    drp NO alcanza para un DRP que no sea el dueño -- cae al mismo camino que partner/cliente,
    o sea nada a menos que tenga un grant puntual (mismo criterio que check_document_access)."""
    db = get_db()
    proj = db.execute("SELECT is_private, owner_user_id FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    is_owner = bool(proj) and proj["owner_user_id"] == user.get("uid")
    private_and_not_owner = bool(proj) and proj["is_private"] and not is_owner
    role = user.get("r")
    full_visibility = (not private_and_not_owner and role == "drp") or (
        role == "partner" and not private_and_not_owner and has_any_grant_in_project(db, user.get("uid"), project_id)
    )
    if full_visibility:
        docs = db.execute(
            "SELECT id, doc_type, status, locked, created_at, locked_at, display_order "
            "FROM rf_documents WHERE project_id=?",
            (project_id,),
        ).fetchall()
    else:
        docs = db.execute(
            "SELECT d.id, d.doc_type, d.status, d.locked, d.created_at, d.locked_at, d.display_order "
            "FROM rf_documents d "
            "JOIN rf_document_access_grants g ON g.project_id=d.project_id AND g.doc_type=d.doc_type "
            "WHERE d.project_id=? AND g.user_id=?",
            (project_id, user.get("uid")),
        ).fetchall()
    # Orden por cascada GxP (doc_order.py), no alfabético -- ver list_documents en documents.py.
    docs = sort_docs([dict(d) for d in docs])

    now = time.time()
    stale_cutoff = now - STALE_COMMENT_DAYS * 86400

    # Un SELECT por sub-métrica para TODOS los documentos a la vez (agrupado por
    # document_id), en vez de 3 queries por documento en un loop -- con un proyecto de
    # 20-30 documentos eso son ~60-90 queries evitadas por cada apertura del panel.
    doc_ids = [d["id"] for d in docs]
    first_review_by_doc: dict = {}
    open_round_docs: set = set()
    pending_by_doc: dict = {}
    if doc_ids:
        placeholders = ",".join("?" for _ in doc_ids)
        for r in db.execute(
            f"SELECT document_id, MIN(signed_at) AS t FROM rf_review_signatures "
            f"WHERE document_id IN ({placeholders}) GROUP BY document_id",
            tuple(doc_ids),
        ):
            first_review_by_doc[r["document_id"]] = r["t"]
        for r in db.execute(
            f"SELECT DISTINCT document_id FROM rf_approval_rounds "
            f"WHERE document_id IN ({placeholders}) AND status='open'",
            tuple(doc_ids),
        ):
            open_round_docs.add(r["document_id"])
        # parent_id IS NULL: solo cuenta hilos raíz sin resolver -- una respuesta (sección
        # 2026-09-01) nunca se resuelve por sí sola, así que no debe inflar este contador.
        for r in db.execute(
            f"SELECT document_id, COUNT(*) AS n, MIN(created_at) AS oldest FROM rf_section_comments "
            f"WHERE document_id IN ({placeholders}) AND resolved=0 AND parent_id IS NULL GROUP BY document_id",
            tuple(doc_ids),
        ):
            pending_by_doc[r["document_id"]] = {"n": r["n"], "oldest": r["oldest"]}

    result = []
    for d in docs:
        first_review = first_review_by_doc.get(d["id"])
        pending = pending_by_doc.get(d["id"], {"n": 0, "oldest": None})

        sealed_at = d["locked_at"] if d["locked"] else None
        result.append({
            "doc_type": d["doc_type"],
            "status": d["status"],
            "locked": bool(d["locked"]),
            "created_at": d["created_at"],
            "first_review_signed_at": first_review,
            "has_open_approval_round": d["id"] in open_round_docs,
            "sealed_at": sealed_at,
            "kpi_load_to_review_s": (first_review - d["created_at"]) if first_review else None,
            "kpi_review_to_seal_s": (sealed_at - first_review) if (sealed_at and first_review) else None,
            "kpi_total_s": (sealed_at - d["created_at"]) if sealed_at else None,
            "pending_comments": pending["n"],
            "pending_comments_stale": pending["n"] > 0 and pending["oldest"] is not None and pending["oldest"] < stale_cutoff,
            "oldest_pending_comment_at": pending["oldest"],
        })

    return {"ok": True, "stale_comment_days": STALE_COMMENT_DAYS, "documents": result}


@router.get("")
def list_projects(include_archived: bool = False, user: dict = Depends(get_current_user)):
    """DRP ve todos los proyectos con documentos cargados, MÁS los creados explícitamente
    (POST /projects) aunque todavía no tengan ningún documento -- sin el UNION, un proyecto
    recién creado (típicamente uno privado, que se crea vacío) no aparecía en ningún lado
    hasta el primer documento. Cliente/partner solo los que tienen al menos un documento
    habilitado (sección 3, Capa 2). Los archivados quedan afuera del listado por default
    (siguen existiendo, solo se ocultan).

    Privacidad (2026-09-19): un proyecto privado se excluye del todo para cualquiera que no
    sea su dueño -- incluido otro DRP -- salvo que tenga al menos un grant ahí (mismo criterio
    que el resto: "compartir para firmar" pesa más que "sos DRP pero no el dueño")."""
    db = get_db()
    if user.get("r") == "drp":
        rows = db.execute(
            "SELECT project_id FROM rf_documents "
            "UNION SELECT id AS project_id FROM rf_projects "
            "ORDER BY project_id"
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT DISTINCT project_id FROM rf_document_access_grants WHERE user_id=? ORDER BY project_id",
            (user.get("uid"),),
        ).fetchall()
    ids = [r["project_id"] for r in rows]

    meta = {}
    if ids:
        placeholders = ",".join("?" for _ in ids)
        for r in db.execute(
            f"SELECT id, status, display_name, partner_name, partner_logo, is_private, owner_user_id "
            f"FROM rf_projects WHERE id IN ({placeholders})",
            tuple(ids),
        ):
            meta[r["id"]] = {
                "status": r["status"], "display_name": r["display_name"],
                "partner_name": r["partner_name"], "partner_logo": r["partner_logo"],
                "is_private": r["is_private"], "owner_user_id": r["owner_user_id"],
            }

    result = []
    for pid in ids:
        m = meta.get(pid, {
            "status": "active", "display_name": None, "partner_name": None, "partner_logo": None,
            "is_private": 0, "owner_user_id": None,
        })
        if m["status"] == "archived" and not include_archived:
            continue
        is_owner = m["owner_user_id"] == user.get("uid")
        if m["is_private"] and not is_owner and not has_any_grant_in_project(db, user.get("uid"), pid):
            continue
        result.append({
            "id": pid, "status": m["status"], "display_name": m["display_name"],
            "partner_name": m["partner_name"], "partner_logo": m["partner_logo"],
            "is_private": bool(m["is_private"]), "is_owner": is_owner,
        })

    return {"ok": True, "projects": result}


@router.patch("/{project_id}/close")
def close_project(project_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    proj = _get_project_or_404(db, project_id, user)
    if proj["status"] == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "El proyecto ya está cerrado")
    now = time.time()
    db.execute("UPDATE rf_projects SET status='closed', closed_at=?, updated_at=? WHERE id=?", (now, now, project_id))
    db.commit()
    log_system_event(user, "project_closed", f"{user['u']} cerró el proyecto", project_id=project_id)
    return {"ok": True}


@router.patch("/{project_id}/archive")
def archive_project(project_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    proj = _get_project_or_404(db, project_id, user)
    if proj["status"] == "archived":
        raise HTTPException(status.HTTP_409_CONFLICT, "El proyecto ya está archivado")
    now = time.time()
    db.execute("UPDATE rf_projects SET status='archived', archived_at=?, updated_at=? WHERE id=?", (now, now, project_id))
    db.commit()
    log_system_event(user, "project_archived", f"{user['u']} archivó el proyecto", project_id=project_id)
    return {"ok": True}


@router.patch("/{project_id}/reopen")
def reopen_project(project_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    proj = _get_project_or_404(db, project_id, user)
    if proj["status"] == "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "El proyecto ya está activo")
    now = time.time()
    db.execute(
        "UPDATE rf_projects SET status='active', closed_at=NULL, archived_at=NULL, updated_at=? WHERE id=?",
        (now, project_id),
    )
    db.commit()
    log_system_event(user, "project_reopened", f"{user['u']} reabrió el proyecto", project_id=project_id)
    return {"ok": True}


class RenameProjectBody(BaseModel):
    display_name: str = ""


@router.patch("/{project_id}/display-name")
def rename_project(project_id: str, body: RenameProjectBody, user: dict = Depends(require_drp)):
    """Nombre legible opcional, puramente cosmético (sección 2026-09-01) -- el `id` real
    NUNCA cambia acá, sigue siendo la clave que usa el bridge con la Suite Documental para
    encontrar este mismo proyecto en cada push. Mandar display_name vacío borra el nombre
    (vuelve a mostrarse el id crudo)."""
    db = get_db()
    _get_project_or_404(db, project_id, user)
    name = body.display_name.strip() or None
    now = time.time()
    db.execute(
        "UPDATE rf_projects SET display_name=?, updated_at=? WHERE id=?",
        (name, now, project_id),
    )
    db.commit()
    log_system_event(
        user, "project_renamed",
        f"{user['u']} renombró el proyecto a '{name}'" if name else f"{user['u']} quitó el nombre del proyecto",
        project_id=project_id,
    )
    return {"ok": True, "display_name": name}


class ProjectBrandingBody(BaseModel):
    partner_name: str = ""
    partner_logo: str | None = None  # None = no tocar; "" = quitar; data:image/... = nuevo logo


_MAX_LOGO_B64_LEN = 2_000_000  # mismo tope que _api_project_set_branding en la Suite Documental


@router.patch("/{project_id}/branding")
def set_project_branding(project_id: str, body: ProjectBrandingBody, user: dict = Depends(require_drp)):
    """Marca de partner/cliente editable directamente desde Firmas (pedido del usuario,
    2026-09-19: "agreguemoslo en la suite de firmas así queda todo centralizado") -- antes
    solo se podía cargar desde la Suite de Validación y llegaba acá vía el push de un
    documento (bridge.py, PushDocumentBody.branding). Esta escritura es independiente de esa
    otra vía: si más tarde alguien empuja un documento nuevo desde Validación, ese push sigue
    mandando SU copia de `branding` (aunque esté vacía) y la va a pisar -- Firmas no
    sincroniza este cambio de vuelta hacia Validación, es una escritura local nada más."""
    db = get_db()
    _get_project_or_404(db, project_id, user)

    partner_logo = body.partner_logo
    if partner_logo is not None:
        partner_logo = partner_logo.strip()
        if partner_logo and not partner_logo.startswith("data:image/"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "partner_logo debe ser un data URL de imagen")
        if len(partner_logo) > _MAX_LOGO_B64_LEN:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El logo es demasiado pesado")

    name = body.partner_name.strip()
    now = time.time()
    if partner_logo is None:
        db.execute(
            "UPDATE rf_projects SET partner_name=?, updated_at=? WHERE id=?",
            (name or None, now, project_id),
        )
    else:
        db.execute(
            "UPDATE rf_projects SET partner_name=?, partner_logo=?, updated_at=? WHERE id=?",
            (name or None, partner_logo or None, now, project_id),
        )
    db.commit()
    log_system_event(
        user, "project_branding_updated",
        f"{user['u']} actualizó la marca del partner del proyecto" + (f" a '{name}'" if name else ""),
        project_id=project_id,
    )
    row = db.execute("SELECT partner_name, partner_logo FROM rf_projects WHERE id=?", (project_id,)).fetchone()
    return {"ok": True, "partner_name": row["partner_name"], "partner_logo": row["partner_logo"]}


@router.delete("/{project_id}")
def delete_project(project_id: str, user: dict = Depends(require_drp)):
    """Elimina el proyecto y todo su contenido (documentos, correcciones, firmas,
    accesos). Bloqueado si algún documento ya está sellado, o si algún documento (sellado
    o no) tiene evidencia de firma electrónica -- la inmutabilidad de un documento firmado
    no se salta borrando el proyecto entero en vez del documento puntual."""
    db = get_db()
    _get_project_or_404(db, project_id, user)

    locked = db.execute(
        "SELECT doc_type FROM rf_documents WHERE project_id=? AND locked=1", (project_id,)
    ).fetchall()
    if locked:
        types = ", ".join(r["doc_type"] for r in locked)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"No se puede eliminar: tiene documento(s) sellado(s) ({types})",
        )

    all_docs = db.execute(
        "SELECT id, doc_type FROM rf_documents WHERE project_id=?", (project_id,)
    ).fetchall()
    con_firmas = [d["doc_type"] for d in all_docs if has_signature_evidence(db, d["id"])]
    if con_firmas:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No se puede eliminar: documento(s) con firmas registradas (" + ", ".join(con_firmas) + ") "
            "-- conservan evidencia de firma electrónica, el proyecto entero no se puede borrar "
            "mientras existan (tampoco eliminándolos uno por uno: delete_document aplica el mismo "
            "bloqueo)",
        )

    doc_count = len(all_docs)

    db.execute("DELETE FROM rf_documents WHERE project_id=?", (project_id,))  # cascada: corrections/firmas
    db.execute("DELETE FROM rf_document_access_grants WHERE project_id=?", (project_id,))
    db.execute("DELETE FROM rf_projects WHERE id=?", (project_id,))
    db.commit()

    # El Libro de Validación (People Book) de este proyecto NO se borra — queda como
    # registro histórico de que existió y fue eliminado (no se destruyen audit trails).
    log_system_event(
        user, "project_deleted",
        f"{user['u']} eliminó el proyecto ({doc_count} documento(s))",
        project_id=project_id,
    )
    return {"ok": True}


@router.get("/{project_id}/audit-log")
def get_system_audit_log(project_id: str, user: dict = Depends(require_drp)):
    """Audit trail de sistema de UN proyecto (DRP-only) — separado del Libro de Validación."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    rows = db.execute(
        "SELECT username, event_type, project_id, doc_type, description, created_at "
        "FROM rf_system_audit_log WHERE project_id=? ORDER BY created_at",
        (project_id,),
    ).fetchall()
    return {"ok": True, "events": [dict(r) for r in rows]}


@audit_router.get("/audit-log")
def get_global_audit_log(user: dict = Depends(require_drp)):
    """Audit trail de sistema UNIFICADO — todos los proyectos a la vez, más reciente primero.
    No requiere estar parado dentro de un proyecto para trazar qué pasó en el sistema.

    Sin el filtro de privacidad, este endpoint solo era un atajo para leer TODO lo que pasa en
    cualquier proyecto -- incluidos los privados de otra persona, con project_id y descripción
    en texto plano (encontrado revisando este pedido, 2026-09-19: hubiera dejado sin efecto la
    privacidad entera de un proyecto secreto)."""
    db = get_db()
    rows = db.execute(
        "SELECT a.username, a.event_type, a.project_id, a.doc_type, a.description, a.created_at "
        "FROM rf_system_audit_log a LEFT JOIN rf_projects p ON p.id = a.project_id "
        "WHERE p.id IS NULL OR p.is_private=0 OR p.owner_user_id=? "
        "ORDER BY a.created_at DESC LIMIT 500",
        (user.get("uid"),),
    ).fetchall()
    return {"ok": True, "events": [dict(r) for r in rows]}
