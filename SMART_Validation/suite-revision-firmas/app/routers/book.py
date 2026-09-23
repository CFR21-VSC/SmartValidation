"""
routers/book.py — Paquete para el Libro de Validación (Tomo I), sección 7.

Solo arma los datos; la generación del PDF en sí sigue pasando client-side
por book-builder.js (vendorizado tal cual, sin tocar el motor).

Ronda 20 (2026-09-21): el viejo tipo de sección 'tabla-firmas-final' fue eliminado del
sistema de renderizado (era la tabla de firmas manuscritas, siempre vacía en los documentos
reales — reemplazada por el Libro de Firmas, que muestra las firmas electrónicas reales con
hash completo). Contrato ACTUAL que esperan los 23 templates (todos, ver
core/shared-renderers.js `renderFirmasHorizontal`): una sección con tipo
'firmas-horizontales' y forma { tipoDocumento, sellado, fechaSellado, pdfHash, jsonHash,
firmasRevision: [...], firmasAprobacion: [...] } — se inyecta al vuelo, sin persistirla en
rf_documents.json_data (el panel izquierdo del documento sigue siendo el JSON fuente tal
cual DRP lo cargó, inmutable).
"""
import json
import time

from fastapi import APIRouter, Depends

from ..db import get_db
from ..deps import assert_owner_if_private, require_drp
from ..doc_order import sort_docs

router = APIRouter(prefix="/projects/{project_id}", tags=["book"])


def iniciales(display_name: str) -> str:
    words = [w for w in (display_name or "").split() if w]
    return "".join(w[0].upper() for w in words[:3]) or "—"


def fecha(epoch: float | None) -> str:
    if not epoch:
        return ""
    return time.strftime("%d/%m/%Y", time.localtime(epoch))


def collect_signatures_split(db, document_ids: list[str]) -> dict[str, dict[str, list[dict]]]:
    """Firmas YA registradas (revisión + aprobación, en listas separadas) para varios
    documentos a la vez -- usado por el Libro de Firmas, por el paquete del Libro de
    Validación y por el render de un documento suelto (Ver PDF), que ahora comparten el mismo
    contrato de sección 'firmas-horizontales' (Ronda 20). No se mezclan revisión y aprobación
    en una sola lista porque el Libro de Firmas necesita mostrarlas en dos tablas separadas, y
    no alcanza con inferirlo del role_label por defecto porque ese texto puede venir pisado
    por un role_label a medida (p.ej. "QA Reviewer" en vez de "Revisor").

    Ronda 18 (2026-09-19): excluye firmas invalidadas (documento reabierto para editar --
    esas firmas ya no valen, no se muestran como si aprobaran el contenido actual) y prefiere
    display_name_at_signing sobre el display_name ACTUAL de rf_users -- antes, cambiar el
    nombre de un usuario alteraba retroactivamente cómo se veía una firma ya registrada.
    Firmas viejas sin ese campo (previas a esta ronda) siguen cayendo al nombre actual, único
    dato que existe para ellas."""
    result: dict[str, dict[str, list[dict]]] = {
        doc_id: {"revision": [], "aprobacion": []} for doc_id in document_ids
    }
    if not document_ids:
        return result
    placeholders = ",".join("?" for _ in document_ids)

    for r in db.execute(
        f"SELECT rs.document_id, rs.user_id, rs.role_label, rs.signed_at, rs.display_name_at_signing, "
        f"rs.signature_name_at_signing, rs.consent_id, u.display_name, u.username "
        f"FROM rf_review_signatures rs JOIN rf_users u ON u.id = rs.user_id "
        f"WHERE rs.document_id IN ({placeholders}) AND rs.invalidated_at IS NULL ORDER BY rs.signed_at",
        tuple(document_ids),
    ):
        nombre = r["display_name_at_signing"] or r["display_name"] or r["username"]
        # 2026-09-23: signature_name_at_signing es el snapshot correcto; firmas de antes de
        # que existiera ese campo caen a nombre (mismo criterio que display_name_at_signing).
        firma_cursiva = r["signature_name_at_signing"] or nombre
        result[r["document_id"]]["revision"].append({
            "user_id": r["user_id"], "rol": r["role_label"] or "Revisor", "nombre": nombre,
            "iniciales": iniciales(nombre), "firmaCursiva": firma_cursiva,
            "fecha": fecha(r["signed_at"]), "consent_id": r["consent_id"],
        })

    for r in db.execute(
        f"SELECT rnd.document_id, sig.user_id, sig.role_label, sig.signed_at, sig.display_name_at_signing, "
        f"sig.signature_name_at_signing, sig.consent_id, u.display_name, u.username "
        f"FROM rf_approval_signers sig "
        f"JOIN rf_approval_rounds rnd ON rnd.id = sig.round_id "
        f"JOIN rf_users u ON u.id = sig.user_id "
        f"WHERE rnd.document_id IN ({placeholders}) AND sig.signed_at IS NOT NULL "
        f"AND sig.invalidated_at IS NULL ORDER BY sig.sign_order",
        tuple(document_ids),
    ):
        nombre = r["display_name_at_signing"] or r["display_name"] or r["username"]
        firma_cursiva = r["signature_name_at_signing"] or nombre
        result[r["document_id"]]["aprobacion"].append({
            "user_id": r["user_id"], "rol": r["role_label"] or "Aprobador", "nombre": nombre,
            "iniciales": iniciales(nombre), "firmaCursiva": firma_cursiva,
            "fecha": fecha(r["signed_at"]), "consent_id": r["consent_id"],
        })
    return result


def _resolve_consent_ids(db, *firma_lists: list[dict]) -> None:
    """Reemplaza `consent_id` (crudo) por `consentimiento` (resuelto) en cada firma, en el
    lugar, para cualquier cantidad de listas de firmas devueltas por collect_signatures_split.
    Cada firma resuelve SU PROPIO vínculo -- nunca hereda el de otra firma de la misma
    persona (mismo criterio que build_signature_book_data, ver su nota extensa de Ronda 19,
    tercera devolución de Codex, sobre por qué eso importa)."""
    all_ids = {f["consent_id"] for lst in firma_lists for f in lst if f.get("consent_id") is not None}
    consent_by_id: dict[int, dict] = {}
    if all_ids:
        placeholders = ",".join("?" for _ in all_ids)
        for r in db.execute(
            f"SELECT id, statement_version, statement_text_snapshot, accepted_at "
            f"FROM rf_signature_consent WHERE id IN ({placeholders})",
            tuple(all_ids),
        ):
            consent_by_id[r["id"]] = {
                "version": r["statement_version"],
                "texto": r["statement_text_snapshot"],
                "fecha": fecha(r["accepted_at"]),
            }
    for lst in firma_lists:
        for f in lst:
            cid = f.pop("consent_id", None)
            f["consentimiento"] = consent_by_id.get(cid) if cid is not None else None


def inject_signatures_section(
    data: dict, doc: dict, firmas_revision: list[dict], firmas_aprobacion: list[dict]
) -> dict:
    """Inserta/reemplaza la sección 'firmas-horizontales' (Ronda 20 -- reemplaza a la vieja
    'tabla-firmas-final', tipo eliminado del sistema de renderizado) con las firmas reales de
    revisión y aprobación. `doc` es la fila de rf_documents (necesita locked/locked_at/
    pdf_hash/json_hash para que el bloque de hash solo aparezca en documentos realmente
    sellados). Muta y devuelve `data` -- nunca se persiste, es una proyección al vuelo (ver
    docstring del módulo)."""
    secciones = data.get("secciones") if isinstance(data.get("secciones"), list) else []
    secciones = [
        s for s in secciones
        if not (isinstance(s, dict) and s.get("tipo") in ("tabla-firmas-final", "firmas-horizontales"))
    ]
    secciones.append({
        "tipo": "firmas-horizontales",
        "tipoDocumento": doc.get("doc_type"),
        "sellado": bool(doc.get("locked")),
        "fechaSellado": fecha(doc.get("locked_at")) if doc.get("locked") else None,
        "pdfHash": doc.get("pdf_hash") if doc.get("locked") else None,
        "jsonHash": doc.get("json_hash") if doc.get("locked") else None,
        "firmasRevision": firmas_revision,
        "firmasAprobacion": firmas_aprobacion,
    })
    data["secciones"] = secciones
    return data


def build_signature_book_data(db, project_id: str, only_sealed: bool = False) -> dict:
    """Datos del Libro de Firmas (pedido del usuario 2026-09-20). Por defecto (`only_sealed`
    False) NO exige que los documentos estén sellados: incluye cualquier documento con al
    menos una firma activa (revisión o aprobación), para que GET /signature-book pueda
    previsualizar el Libro a medida que el proyecto avanza, no solo al final. El hash
    completo (pdf_hash/json_hash) solo existe una vez que el documento quedó realmente
    sellado -- para los que todavía no, se informa explícitamente `sellado: false` en vez de
    inventar un hash o dejarlo ambiguo.

    `only_sealed=True` (usado por get_book_package, Ronda 19 -- Codex, 2026-09-20:
    "el backend usa todos los documentos con firmas activas... mientras el paquete promete
    solo documentos sellados") filtra a solo documentos con `locked=1` ANTES de recolectar
    firmas/firmantes -- así el capítulo LIBRO_FIRMAS dentro del Libro de Validación compilado
    nunca incluye firmas de un documento todavía no sellado, cumpliendo la misma promesa que
    ya hace el resto de get_book_package."""
    docs = db.execute(
        "SELECT id, doc_type, locked, pdf_hash, json_hash, locked_at, display_order "
        "FROM rf_documents WHERE project_id=?",
        (project_id,),
    ).fetchall()
    docs = sort_docs([dict(d) for d in docs])
    if only_sealed:
        docs = [d for d in docs if d["locked"]]

    firmas_by_doc = collect_signatures_split(db, [d["id"] for d in docs])

    documentos = []
    # Ronda 19, tercera devolución de Codex (2026-09-21): la versión anterior atribuía a la
    # persona ENTERA el primer consent_id no nulo encontrado recorriendo documentos en
    # orden de iteración (no de fecha), y lo aplicaba como si respaldara TODAS sus firmas
    # -- si alguien tenía una firma histórica (consent_id NULL, ej. HLRA de antes de este
    # campo) y otra nueva (consent_id real, ej. URS), la aceptación de URS terminaba
    # mostrándose como si también cubriera la firma de HLRA. Además `consent_id` se
    # eliminaba de cada firma expuesta, así que no había forma de ver el vínculo por firma
    # individual.
    #
    # Ahora cada firma resuelve SU PROPIO consent_id (o None si es histórica) a un objeto
    # `consentimiento` -- ninguna firma hereda evidencia de otra. Para el firmante
    # (declaración general, sección 1 del libro) se junta el conjunto de consent_id reales
    # que aparecen en SUS firmas: bajo la política vigente (una aceptación real por persona,
    # de por vida -- signature_consent.py) ese conjunto nunca debería tener más de un
    # elemento; si igual apareciera más de uno (anomalía que no debería ocurrir), se usa el
    # de menor id (el más antiguo) de forma determinística, no "el primero según el orden en
    # que se iteraron los documentos".
    firmantes_nombre: dict[str, str] = {}
    firmantes_consent_ids: dict[str, set] = {}
    all_consent_ids: set = set()
    for d in docs:
        firmas = firmas_by_doc[d["id"]]
        if not firmas["revision"] and not firmas["aprobacion"]:
            continue  # sin ninguna firma todavía -- no aparece en el Libro de Firmas
        for grupo in ("revision", "aprobacion"):
            for f in firmas[grupo]:
                firmantes_nombre.setdefault(f["user_id"], f["nombre"])
                if f.get("consent_id") is not None:
                    firmantes_consent_ids.setdefault(f["user_id"], set()).add(f["consent_id"])
                    all_consent_ids.add(f["consent_id"])
        documentos.append({
            "tipo": d["doc_type"],
            "sellado": bool(d["locked"]),
            "fecha_sellado": fecha(d["locked_at"]) if d["locked"] else None,
            "pdf_hash": d["pdf_hash"] if d["locked"] else None,
            "json_hash": d["json_hash"] if d["locked"] else None,
            "firmas_revision": firmas["revision"],
            "firmas_aprobacion": firmas["aprobacion"],
        })

    consent_by_id: dict[int, dict] = {}
    if all_consent_ids:
        placeholders = ",".join("?" for _ in all_consent_ids)
        for r in db.execute(
            f"SELECT id, statement_version, statement_text_snapshot, accepted_at "
            f"FROM rf_signature_consent WHERE id IN ({placeholders})",
            tuple(all_consent_ids),
        ):
            consent_by_id[r["id"]] = {
                "version": r["statement_version"],
                "texto": r["statement_text_snapshot"],
                "fecha": fecha(r["accepted_at"]),
            }

    def _resolve(consent_id):
        return consent_by_id.get(consent_id) if consent_id is not None else None

    # Cada firma expuesta lleva su PROPIO estado de vínculo -- `consent_id` crudo se
    # reemplaza por `consentimiento` (resuelto) o None, nunca se elimina sin reemplazo.
    for d in documentos:
        for grupo in ("firmas_revision", "firmas_aprobacion"):
            d[grupo] = [
                {**{k: v for k, v in f.items() if k != "consent_id"}, "consentimiento": _resolve(f.get("consent_id"))}
                for f in d[grupo]
            ]

    firmantes = []
    for uid, nombre in firmantes_nombre.items():
        ids = firmantes_consent_ids.get(uid)
        firmantes.append({
            "user_id": uid, "nombre": nombre,
            "consentimiento": _resolve(min(ids)) if ids else None,
        })

    return {"firmantes": firmantes, "documentos": documentos}


def wrap_signature_book_as_document(book_data: dict, project_id: str, only_sealed: bool = False) -> dict:
    """Envuelve build_signature_book_data() con la forma mínima de un documento GxP
    (package/document/matrizAprobaciones/controlCambios/secciones) para que
    book-builder.js lo trate como CUALQUIER OTRO documento del paquete -- mismo criterio
    que VS.libroFirmas.wrapSignatureBookAsDoc en el frontend (templates/libro-firmas.js),
    replicado acá en Python para que get_book_package pueda insertarlo como un capítulo
    más sin que book-builder.js tenga que aprender a tratar este tipo distinto.

    Ronda 19 (Codex, 2026-09-20): `document.status` decía "Sellado" siempre, sin importar el
    contenido real, y este capítulo se reconstruye en cada consulta -- NO es un artefacto
    sellado con hash/pdf_data propios como los documentos que resume. Nunca se afirma
    "Sellado" acá: se declara que es una proyección generada, con fecha, y el alcance exacto
    (`only_sealed` refleja si get_book_package la llamó ya filtrada a solo documentos
    sellados, o si es la previsualización suelta que puede incluir firmas parciales)."""
    generado = fecha(time.time())
    alcance = (
        "incluye solo documentos sellados de este proyecto" if only_sealed
        else "incluye cualquier documento con al menos una firma, sellado o no"
    )
    estado = f"Proyección generada el {generado} — {alcance}"
    secciones = [{
        "tipo": "libro-firmas-declaracion",
        "titulo": "Declaración de Conformidad de Firma Electrónica",
        "firmantes": book_data["firmantes"],
    }]
    for d in book_data["documentos"]:
        secciones.append({
            "tipo": "libro-firmas-documento",
            "titulo": d["tipo"],
            "tipoDocumento": d["tipo"],
            "sellado": d["sellado"],
            "fechaSellado": d["fecha_sellado"],
            "pdfHash": d["pdf_hash"],
            "jsonHash": d["json_hash"],
            "firmasRevision": d["firmas_revision"],
            "firmasAprobacion": d["firmas_aprobacion"],
        })
    return {
        "type": "LIBRO_FIRMAS",
        "package": {"code": project_id, "systemName": "", "client": ""},
        "document": {
            "titleEs": "Libro de Firmas", "titleEn": "Signature Book",
            "code": f"LIBRO-FIRMAS-{project_id}", "version": "v1.0", "status": estado,
        },
        "matrizAprobaciones": [],
        "controlCambios": [],
        "secciones": secciones,
    }


@router.get("/signature-book")
def get_signature_book(project_id: str, user: dict = Depends(require_drp)):
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    return {"ok": True, **build_signature_book_data(db, project_id)}


@router.get("/book-package")
def get_book_package(project_id: str, user: dict = Depends(require_drp)):
    """Solo documentos SELLADOS — el Libro de Validación es un entregable de
    contenido definitivo y firmado, no de borradores en curso."""
    db = get_db()
    assert_owner_if_private(db, user, project_id)
    docs = db.execute(
        "SELECT id, doc_type, json_data, branding_name_at_signing, branding_logo_at_signing, "
        "branding_captured_at_signing, display_order, locked, locked_at, pdf_hash, json_hash "
        "FROM rf_documents WHERE project_id=? AND locked=1",
        (project_id,),
    ).fetchall()
    # Orden por cascada GxP (doc_order.py), no alfabético -- el Libro de Validación tiene que
    # listar los documentos en el orden real del ciclo de vida, ver list_documents en
    # documents.py para el mismo criterio.
    docs = sort_docs([dict(d) for d in docs])

    all_types = db.execute(
        "SELECT doc_type, locked FROM rf_documents WHERE project_id=?", (project_id,)
    ).fetchall()
    skipped = [r["doc_type"] for r in all_types if not r["locked"]]

    firmas_by_doc = collect_signatures_split(db, [doc["id"] for doc in docs])
    _resolve_consent_ids(db, *(
        lst for doc in docs for lst in (firmas_by_doc[doc["id"]]["revision"], firmas_by_doc[doc["id"]]["aprobacion"])
    ))
    # Branding actual del proyecto, SOLO como respaldo para documentos sellados ANTES de la
    # Ronda 18 (branding_name_at_signing es NULL para esos -- no existía el campo). Para todo
    # lo sellado después, cada documento usa el branding fijado al momento de SU sellado, no
    # el actual del proyecto -- cambiar el logo del proyecto ya no altera retroactivamente el
    # libro de documentos ya firmados.
    proj = db.execute(
        "SELECT partner_name, partner_logo FROM rf_projects WHERE id=?", (project_id,)
    ).fetchone()
    branding_actual = {"name": proj["partner_name"] or "", "logo": proj["partner_logo"]} if proj and proj["partner_logo"] else None

    package = []
    for doc in docs:
        data = json.loads(doc["json_data"])
        data = inject_signatures_section(
            data, doc, firmas_by_doc[doc["id"]]["revision"], firmas_by_doc[doc["id"]]["aprobacion"]
        )
        # Mismo criterio que _branding_for_document (documents.py, Ronda 18 2da vuelta):
        # si el snapshot fue capturado al sellar, se usa TAL CUAL -- incluso "sin marca" a
        # propósito, sin caer al branding actual del proyecto. Solo lo nunca-capturado
        # (sellado antes de que existiera este campo) cae al branding actual.
        if doc["branding_captured_at_signing"]:
            if doc["branding_logo_at_signing"]:
                data["_partnerBranding"] = {"name": doc["branding_name_at_signing"] or "", "logo": doc["branding_logo_at_signing"]}
            # si no hay logo en el snapshot, no se fija _partnerBranding -- sellado sin marca a propósito
        elif branding_actual:
            data["_partnerBranding"] = branding_actual
        package.append({"type": doc["doc_type"], "data": data})

    # Libro de Firmas como capítulo del Libro de Validación compilado (pedido del usuario
    # 2026-09-20) -- va primero en el array; book-builder.js lo reordena igual según
    # PHASE_ORDER (queda al principio, como conformidad legal antes de los documentos del
    # ciclo). Solo se agrega si hay al menos una firma real en el proyecto -- un capítulo
    # vacío no aporta nada y confundiría más que ayudar.
    # only_sealed=True en ambas llamadas (Ronda 19 -- Codex): este capítulo va DENTRO del
    # Libro de Validación compilado, que promete "solo documentos sellados" -- no puede
    # filtrar a firmas parciales de un documento que get_book_package ya excluyó del resto
    # del paquete.
    signature_book = build_signature_book_data(db, project_id, only_sealed=True)
    if signature_book["documentos"]:
        package.insert(0, {
            "type": "LIBRO_FIRMAS",
            "data": wrap_signature_book_as_document(signature_book, project_id, only_sealed=True),
        })

    return {"ok": True, "documents": package, "skipped_not_sealed": skipped}
