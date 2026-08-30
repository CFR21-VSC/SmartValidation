"""
routers/book.py — Paquete para el Libro de Validación (Tomo I), sección 7.

Solo arma los datos; la generación del PDF en sí sigue pasando client-side
por book-builder.js (vendorizado tal cual, sin tocar el motor).

Contrato exacto que espera book-builder.js para el "Registro Maestro de
Firmas" (ver core/book-builder.js ~L970): busca, dentro de cada documento,
una sección con tipo 'tabla-firmas-final' y lee su array `firmas`, cada una
con {rol, nombre, iniciales, fecha}. El motor NO sabe nada de nuestras
tablas de firmas — hay que inyectar esa sección al vuelo, sin persistirla
en rf_documents.json_data (el panel izquierdo del documento sigue siendo
el JSON fuente tal cual DRP lo cargó, inmutable).
"""
import json
import time

from fastapi import APIRouter, Depends

from ..db import get_db
from ..deps import require_drp

router = APIRouter(prefix="/projects/{project_id}", tags=["book"])


def iniciales(display_name: str) -> str:
    words = [w for w in (display_name or "").split() if w]
    return "".join(w[0].upper() for w in words[:3]) or "—"


def fecha(epoch: float | None) -> str:
    if not epoch:
        return ""
    return time.strftime("%d/%m/%Y", time.localtime(epoch))


def collect_signatures(db, document_id: str) -> list[dict]:
    """Firmas YA registradas (revisión + aprobación) para un documento. Reusado por el
    paquete del libro y por el render de un documento suelto (Ver PDF) — ambos necesitan
    la misma sección tabla-firmas-final, con la misma forma exacta."""
    firmas = []
    rows = db.execute(
        "SELECT rs.role_label, rs.signed_at, u.display_name, u.username "
        "FROM rf_review_signatures rs JOIN rf_users u ON u.id = rs.user_id "
        "WHERE rs.document_id=? ORDER BY rs.signed_at",
        (document_id,),
    ).fetchall()
    for r in rows:
        nombre = r["display_name"] or r["username"]
        firmas.append({
            "rol": r["role_label"] or "Revisor", "nombre": nombre,
            "iniciales": iniciales(nombre), "fecha": fecha(r["signed_at"]),
        })

    rows = db.execute(
        "SELECT sig.role_label, sig.signed_at, u.display_name, u.username "
        "FROM rf_approval_signers sig "
        "JOIN rf_approval_rounds rnd ON rnd.id = sig.round_id "
        "JOIN rf_users u ON u.id = sig.user_id "
        "WHERE rnd.document_id=? AND sig.signed_at IS NOT NULL ORDER BY sig.sign_order",
        (document_id,),
    ).fetchall()
    for r in rows:
        nombre = r["display_name"] or r["username"]
        firmas.append({
            "rol": r["role_label"] or "Aprobador", "nombre": nombre,
            "iniciales": iniciales(nombre), "fecha": fecha(r["signed_at"]),
        })
    return firmas


def inject_signatures_section(data: dict, firmas: list[dict]) -> dict:
    """Inserta/reemplaza la sección tabla-firmas-final con `firmas`. Muta y devuelve `data`."""
    secciones = data.get("secciones") if isinstance(data.get("secciones"), list) else []
    existing = next((s for s in secciones if isinstance(s, dict) and s.get("tipo") == "tabla-firmas-final"), None)
    if existing is not None:
        existing["firmas"] = firmas
    else:
        secciones.append({"tipo": "tabla-firmas-final", "titulo": "Firmas", "firmas": firmas})
    data["secciones"] = secciones
    return data


@router.get("/book-package")
def get_book_package(project_id: str, user: dict = Depends(require_drp)):
    """Solo documentos SELLADOS — el Libro de Validación es un entregable de
    contenido definitivo y firmado, no de borradores en curso."""
    db = get_db()
    docs = db.execute(
        "SELECT id, doc_type, json_data FROM rf_documents WHERE project_id=? AND locked=1 ORDER BY doc_type",
        (project_id,),
    ).fetchall()

    all_types = db.execute(
        "SELECT doc_type, locked FROM rf_documents WHERE project_id=?", (project_id,)
    ).fetchall()
    skipped = [r["doc_type"] for r in all_types if not r["locked"]]

    package = []
    for doc in docs:
        data = json.loads(doc["json_data"])
        firmas = collect_signatures(db, doc["id"])
        data = inject_signatures_section(data, firmas)
        package.append({"type": doc["doc_type"], "data": data})

    return {"ok": True, "documents": package, "skipped_not_sealed": skipped}
