"""Ronda 20 (2026-09-21) — unit tests de las funciones puras que reemplazaron la vieja
inyección de 'tabla-firmas-final' (tipo eliminado del sistema de renderizado, ver
docs-privados/ronda-19-libro-de-firmas.md) por 'firmas-horizontales'. Estos tests llaman a
inject_signatures_section() y _resolve_consent_ids() directamente, sin pasar por HTTP/PIN/
sesión -- las rutas de integración (signed-render, book-package) ya están cubiertas en
test_signatures.py y test_projects.py; acá se prueba el contrato exacto de las funciones en
sí, incluyendo casos borde que un test de endpoint no ejercita fácil (reemplazo en vez de
duplicado, limpieza del tipo viejo, hash ausente si no está sellado)."""
from app.db import get_db
from app.routers.book import _resolve_consent_ids, inject_signatures_section


def _doc(**overrides):
    base = {
        "doc_type": "HLRA", "locked": False, "locked_at": None,
        "pdf_hash": None, "json_hash": None,
    }
    base.update(overrides)
    return base


def test_inject_signatures_section_builds_expected_shape():
    data = {"type": "HLRA", "secciones": [{"tipo": "texto", "contenido": "hola"}]}
    revision = [{"rol": "Revisor", "nombre": "Ana", "iniciales": "A", "fecha": "01/01/2026"}]
    aprobacion = []
    out = inject_signatures_section(data, _doc(), revision, aprobacion)

    assert out is data  # muta y devuelve el mismo dict, no una copia
    assert out["secciones"][0]["tipo"] == "texto"  # el resto del contenido queda intacto
    fh = out["secciones"][1]
    assert fh["tipo"] == "firmas-horizontales"
    assert fh["tipoDocumento"] == "HLRA"
    assert fh["sellado"] is False
    assert fh["fechaSellado"] is None
    assert fh["pdfHash"] is None
    assert fh["jsonHash"] is None
    assert fh["firmasRevision"] == revision
    assert fh["firmasAprobacion"] == aprobacion


def test_inject_signatures_section_sealed_document_shows_hash():
    data = {"type": "HLRA", "secciones": []}
    doc = _doc(locked=True, locked_at=1758000000.0, pdf_hash="a" * 64, json_hash="b" * 64)
    out = inject_signatures_section(data, doc, [], [])
    fh = out["secciones"][0]
    assert fh["sellado"] is True
    assert fh["fechaSellado"]  # fecha formateada, no vacía
    assert fh["pdfHash"] == "a" * 64
    assert fh["jsonHash"] == "b" * 64


def test_inject_signatures_section_unsealed_never_shows_hash_even_if_row_has_one():
    """Defensivo: si por lo que sea el row trae pdf_hash/json_hash pero locked=False (no
    debería pasar, pero si pasara), la sección igual tiene que declarar sellado=False y NO
    mostrar el hash -- un hash mostrado como válido en un documento no sellado sería
    engañoso."""
    data = {"type": "HLRA", "secciones": []}
    doc = _doc(locked=False, pdf_hash="c" * 64, json_hash="d" * 64)
    out = inject_signatures_section(data, doc, [], [])
    fh = out["secciones"][0]
    assert fh["sellado"] is False
    assert fh["pdfHash"] is None
    assert fh["jsonHash"] is None


def test_inject_signatures_section_removes_old_tabla_firmas_final():
    """Un documento que todavía tuviera el tipo viejo (dato legado, previo a Ronda 20) no
    debe terminar con las DOS secciones -- la vieja se descarta, no se acumula."""
    data = {"type": "HLRA", "secciones": [
        {"tipo": "tabla-firmas-final", "titulo": "Firmas", "firmas": []},
    ]}
    out = inject_signatures_section(data, _doc(), [], [])
    tipos = [s["tipo"] for s in out["secciones"]]
    assert tipos == ["firmas-horizontales"]


def test_inject_signatures_section_replaces_not_duplicates_on_repeated_calls():
    """signed-render se puede llamar muchas veces sobre el mismo `data` en el mismo proceso
    (no debería, pero la función tiene que ser idempotente en forma) -- nunca se acumulan
    secciones 'firmas-horizontales' de llamadas anteriores."""
    data = {"type": "HLRA", "secciones": []}
    inject_signatures_section(data, _doc(), [{"rol": "Revisor", "nombre": "Ana"}], [])
    inject_signatures_section(data, _doc(), [{"rol": "Revisor", "nombre": "Beto"}], [])
    fh_sections = [s for s in data["secciones"] if s["tipo"] == "firmas-horizontales"]
    assert len(fh_sections) == 1
    assert fh_sections[0]["firmasRevision"][0]["nombre"] == "Beto"  # la última pisa a la primera


def test_resolve_consent_ids_resolves_real_consent():
    db = get_db()
    now = 1758000000.0
    db.execute(
        "INSERT INTO rf_signature_consent (user_id, statement_version, statement_text_snapshot, accepted_at) "
        "VALUES (?,?,?,?)",
        ("user-1", "v1", "Texto de la declaración", now),
    )
    db.commit()
    consent_id = db.execute(
        "SELECT id FROM rf_signature_consent WHERE user_id='user-1'"
    ).fetchone()["id"]

    revision = [{"rol": "Revisor", "nombre": "Ana", "consent_id": consent_id}]
    aprobacion: list[dict] = []
    _resolve_consent_ids(db, revision, aprobacion)

    assert "consent_id" not in revision[0]  # se reemplaza, no se deja crudo
    assert revision[0]["consentimiento"]["version"] == "v1"
    assert revision[0]["consentimiento"]["texto"] == "Texto de la declaración"
    assert revision[0]["consentimiento"]["fecha"]


def test_resolve_consent_ids_none_for_missing_consent_id():
    db = get_db()
    revision = [{"rol": "Revisor", "nombre": "Ana", "consent_id": None}]
    aprobacion = [{"rol": "Aprobador", "nombre": "Beto"}]  # ni siquiera trae la clave
    _resolve_consent_ids(db, revision, aprobacion)

    assert revision[0]["consentimiento"] is None
    assert aprobacion[0]["consentimiento"] is None  # no explota por falta de la clave
    assert "consent_id" not in revision[0]
    assert "consent_id" not in aprobacion[0]


def test_resolve_consent_ids_shared_id_resolves_independently_per_firma():
    """Una misma persona firmando revisión Y aprobación del mismo documento (mismo
    consent_id en ambas listas) tiene que resolver el MISMO consentimiento en las dos --
    nunca perder el vínculo en una de las dos por compartir id."""
    db = get_db()
    db.execute(
        "INSERT INTO rf_signature_consent (user_id, statement_version, statement_text_snapshot, accepted_at) "
        "VALUES (?,?,?,?)",
        ("user-1", "v1", "Texto", 1758000000.0),
    )
    db.commit()
    consent_id = db.execute("SELECT id FROM rf_signature_consent").fetchone()["id"]

    revision = [{"rol": "Revisor", "nombre": "Ana", "consent_id": consent_id}]
    aprobacion = [{"rol": "Aprobador", "nombre": "Ana", "consent_id": consent_id}]
    _resolve_consent_ids(db, revision, aprobacion)

    assert revision[0]["consentimiento"] == aprobacion[0]["consentimiento"]
    assert revision[0]["consentimiento"] is not None


def test_resolve_consent_ids_empty_lists_do_not_query_or_raise():
    db = get_db()
    _resolve_consent_ids(db)  # sin listas
    _resolve_consent_ids(db, [], [])  # listas vacías
    # No debe lanzar excepción -- si llegara acá, pasó.
