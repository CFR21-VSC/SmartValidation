"""
signature_consent.py — Declaración de conformidad de firma electrónica (Libro de Firmas,
pedido del usuario 2026-09-20).

Certificación estilo 21 CFR Part 11 §11.100: cada firmante, antes de emitir su primera
firma electrónica en el sistema (revisión o aprobación, en cualquier proyecto), tiene que
aceptar explícitamente que su firma basada en PIN es el equivalente legalmente vinculante
de su firma manuscrita.

Política de producto (confirmada con el usuario, revisada por Codex en Ronda 19): se acepta
UNA sola vez por persona, de por vida -- no por proyecto, y una actualización editorial del
texto NO exige re-aceptar ni invalida lo ya aceptado. `has_accepted_consent` por eso no
filtra por versión: cualquier fila existente para ese user_id alcanza. `record_consent`
exige que el cliente mande explícitamente la versión que leyó (no asume "la vigente del
servidor") para poder rechazar si el texto cambió entre el GET que lo mostró y este POST.

rf_signature_consent es estrictamente insert-only (ver schema.sql): aceptar una versión
nueva algún día crearía una fila nueva sin tocar las anteriores, igual que
rf_review_signatures/rf_approval_signers nunca se pisan ni se borran -- el historial
completo de qué se aceptó y cuándo queda íntegro para siempre.
"""
import time

CURRENT_CONSENT_VERSION = "v1"

SIGNATURE_CONSENT_STATEMENT_V1 = (
    "Declaro que las firmas electrónicas que emita en este sistema, autenticadas mediante "
    "mi PIN personal de firma, están destinadas a ser el equivalente legalmente vinculante "
    "de mi firma manuscrita. Entiendo que cada firma queda asociada de forma permanente e "
    "inmutable al documento firmado y a la fecha y hora en que fue emitida, y que soy "
    "responsable de mantener mi PIN en secreto y de no compartirlo con terceros."
)


def get_consent(db, user_id: str) -> dict | None:
    """La aceptación vigente bajo la política actual (una vez, de por vida): la PRIMERA fila
    que esa persona aceptó, cualquiera sea la versión -- una actualización editorial del
    texto no exige ni reemplaza una aceptación anterior."""
    row = db.execute(
        "SELECT id, statement_version, statement_text_snapshot, accepted_at "
        "FROM rf_signature_consent WHERE user_id=? ORDER BY accepted_at ASC LIMIT 1",
        (user_id,),
    ).fetchone()
    return dict(row) if row else None


def has_accepted_consent(db, user_id: str) -> bool:
    return get_consent(db, user_id) is not None


def get_consent_id_for_signing(db, user_id: str) -> int | None:
    """El id de rf_signature_consent a grabar en la firma que se está por emitir (Ronda 19:
    vincula temporalmente cada firma a la evidencia de consentimiento que la habilitó, en
    vez de que el Libro de Firmas infiera esa relación consultando el estado ACTUAL del
    usuario sin fecha de referencia)."""
    consent = get_consent(db, user_id)
    return consent["id"] if consent else None


def record_consent(db, user_id: str, version: str) -> int:
    """Inserta una aceptación de `version`. El llamador tiene que mandar la versión que
    efectivamente LEYÓ (no se asume "la vigente del servidor") -- si no coincide con
    CURRENT_CONSENT_VERSION, se rechaza (ValueError) para que el caller devuelva 409 y el
    cliente vuelva a pedir el texto antes de reintentar. Insert-only vía
    ON CONFLICT(user_id, statement_version) DO NOTHING: repetir la aceptación de la MISMA
    versión es un no-op idempotente que preserva el accepted_at original, nunca lo pisa.
    Devuelve el id de la fila (nueva o preexistente)."""
    if version != CURRENT_CONSENT_VERSION:
        raise ValueError("stale_version")
    db.execute(
        "INSERT INTO rf_signature_consent (user_id, statement_version, statement_text_snapshot, accepted_at) "
        "VALUES (?,?,?,?) ON CONFLICT(user_id, statement_version) DO NOTHING",
        (user_id, version, SIGNATURE_CONSENT_STATEMENT_V1, time.time()),
    )
    db.commit()
    row = db.execute(
        "SELECT id FROM rf_signature_consent WHERE user_id=? AND statement_version=?",
        (user_id, version),
    ).fetchone()
    return row["id"]
