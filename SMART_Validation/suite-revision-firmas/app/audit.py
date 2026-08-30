"""
audit.py — Libro de Validación, sección People / audit trail (capa de datos, sección 6).

Sin interfaz visual todavía: solo el registro. Cualquier evento relevante del
proyecto (autorización, corrección solicitada, firma, sellado) pasa por acá.
"""
import time

from .db import get_db


def log_event(project_id: str, doc_type: str | None, user: dict, event_type: str, description: str) -> None:
    db = get_db()
    db.execute(
        "INSERT INTO rf_people_book_events "
        "(project_id, doc_type, user_id, username, event_type, description, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (project_id, doc_type, user.get("uid"), user.get("u"), event_type, description, time.time()),
    )
    db.commit()
