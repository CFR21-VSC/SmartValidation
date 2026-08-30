"""
audit.py — DOS audit trails separados (fase 5, confirmado por el usuario 2026-08-30):

  log_event()        → Libro de Validación, sección People (rf_people_book_events).
                        Solo eventos GxP del documento (cargado, corrección, firma,
                        sellado) — sección 6. Este es el que se integra al libro
                        compilado (book-builder.js), vía la sección tabla-firmas-final
                        que se inyecta al generar el Libro 1.

  log_system_event()  → Audit trail de SISTEMA (rf_system_audit_log). Acciones
                        administrativas/operativas de DRP: alta de usuarios, accesos,
                        ciclo de vida de proyectos/documentos (cerrar/archivar/eliminar).
                        NO se integra a ningún documento ni al libro — es de uso
                        interno para trazabilidad operativa, deliberadamente separado
                        del trail GxP para no mezclar ambos planos.
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


def log_system_event(
    user: dict, event_type: str, description: str,
    project_id: str | None = None, doc_type: str | None = None,
) -> None:
    db = get_db()
    db.execute(
        "INSERT INTO rf_system_audit_log "
        "(user_id, username, event_type, project_id, doc_type, description, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (user.get("uid"), user.get("u"), event_type, project_id, doc_type, description, time.time()),
    )
    db.commit()
