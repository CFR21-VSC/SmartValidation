"""
db.py — Capa de acceso a datos de la Suite de Revisión y Firmas.

  LOCAL / DEV:  sin DATABASE_URL  →  SQLite propio (revision_firmas.db)
  PRODUCCION:   DATABASE_URL=postgres://…  →  PostgreSQL via psycopg2

Copia adaptada de db_adapter.py (Suite de Validación) — mismo patrón probado,
pero completamente independiente: no importa ni comparte estado con el otro
servicio. Todas las tablas usan el prefijo `rf_` para aislarlas lógicamente
dentro de la misma instancia de Postgres (mismo costo, cero cruce de datos).
"""
import os
import re
import sqlite3
import sys
import threading
import time

DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
USE_PG: bool = DATABASE_URL.startswith(("postgres://", "postgresql://"))

_HERE = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_HERE, "..", "data")
SQLITE_PATH: str = os.environ.get(
    "RF_DB_PATH", os.path.join(_DATA_DIR, "revision_firmas.db")
)

_SCHEMA_PATH = os.path.join(_HERE, "schema.sql")

# ─── DDL adaptation (SQLite → PostgreSQL) ────────────────────────────────────

_DDL_SUBS = [
    (r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b", "BIGSERIAL PRIMARY KEY"),
    (r"\bREAL\b", "DOUBLE PRECISION"),
]


def _adapt_ddl(sql: str) -> str:
    for pattern, replacement in _DDL_SUBS:
        sql = re.sub(pattern, replacement, sql, flags=re.IGNORECASE)
    return sql


# ─── PostgreSQL adapter ───────────────────────────────────────────────────────

if USE_PG:
    import psycopg2                    # type: ignore
    import psycopg2.extras             # type: ignore
    import psycopg2.pool               # type: ignore

    _pg_pool: "psycopg2.pool.ThreadedConnectionPool | None" = None

    def _ensure_pool() -> None:
        global _pg_pool
        if _pg_pool is None:
            # sslmode='require' explícito: sin esto, psycopg2 cae a 'prefer' por default y
            # se conecta en texto plano en silencio si el server no ofrece TLS. Si el
            # DATABASE_URL ya trae su propio sslmode, este kwarg tiene precedencia (lo
            # sube a 'require', nunca lo baja) -- ver psycopg2.extensions.make_dsn().
            _pg_pool = psycopg2.pool.ThreadedConnectionPool(2, 20, DATABASE_URL, sslmode="require")

    _OR_IGNORE_RE   = re.compile(r'\bINSERT\s+OR\s+IGNORE\b', re.IGNORECASE)
    _BEGIN_IMMED_RE = re.compile(r'\bBEGIN\s+IMMEDIATE\b', re.IGNORECASE)

    def _adapt_dml(sql: str) -> tuple[str, bool]:
        had = bool(_OR_IGNORE_RE.search(sql))
        if had:
            sql = _OR_IGNORE_RE.sub("INSERT", sql)
            sql = sql.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"
        sql = _BEGIN_IMMED_RE.sub("BEGIN", sql)
        return sql, had

    class _PGCursor:
        def __init__(self, raw: "psycopg2.extensions.cursor") -> None:
            self._cur = raw
            self.lastrowid: int | None = None

        def execute(self, sql: str, params: tuple = ()) -> "_PGCursor":
            sql, had_ignore = _adapt_dml(sql)
            sql = sql.replace("?", "%s")
            self._cur.execute(sql, params or ())
            if sql.lstrip().upper().startswith("INSERT") and not had_ignore:
                conn = self._cur.connection
                try:
                    in_txn = (
                        conn.get_transaction_status()
                        == psycopg2.extensions.TRANSACTION_STATUS_INTRANS
                    )
                    probe = conn.cursor()
                    if in_txn:
                        probe.execute("SAVEPOINT _lastval_probe")
                    try:
                        probe.execute("SELECT lastval()")
                        row = probe.fetchone()
                        self.lastrowid = row[0] if row else None
                        if in_txn:
                            probe.execute("RELEASE SAVEPOINT _lastval_probe")
                    except Exception:
                        self.lastrowid = None
                        if in_txn:
                            try:
                                probe.execute("ROLLBACK TO SAVEPOINT _lastval_probe")
                                probe.execute("RELEASE SAVEPOINT _lastval_probe")
                            except Exception:
                                pass
                    probe.close()
                except Exception:
                    self.lastrowid = None
            return self

        def executemany(self, sql: str, seq) -> "_PGCursor":
            sql, _ = _adapt_dml(sql)
            sql = sql.replace("?", "%s")
            self._cur.executemany(sql, list(seq))
            return self

        def fetchone(self):
            return self._cur.fetchone()

        def fetchall(self):
            return self._cur.fetchall()

        def __iter__(self):
            # sqlite3.Cursor es iterable directamente (for r in db.execute(...)) — sin esto,
            # ese mismo patrón sobre _PGCursor rompe con "TypeError: '_PGCursor' object is
            # not iterable" en modo Postgres (encontrado en list_projects, 2026-08-31).
            return iter(self._cur)

        @property
        def rowcount(self) -> int:
            return self._cur.rowcount

    class _PGConn:
        def __init__(self, raw: "psycopg2.extensions.connection") -> None:
            self._raw = raw
            self._raw.autocommit = True

        def _cursor(self) -> _PGCursor:
            return _PGCursor(
                self._raw.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            )

        def execute(self, sql: str, params: tuple = ()) -> _PGCursor:
            c = self._cursor()
            c.execute(sql, params)
            return c

        def executemany(self, sql: str, seq) -> _PGCursor:
            c = self._cursor()
            c.executemany(sql, seq)
            return c

        def executescript(self, script: str) -> None:
            adapted = _adapt_ddl(script)
            statements = [s.strip() for s in adapted.split(";") if s.strip()]
            raw_cur = self._raw.cursor()
            for stmt in statements:
                try:
                    raw_cur.execute(stmt)
                except Exception as exc:
                    sys.stderr.write(f"[db] DDL warning: {exc}\n")
            raw_cur.close()

        def commit(self) -> None:
            try:
                self._raw.commit()
            except Exception:
                pass

        def rollback(self) -> None:
            try:
                self._raw.rollback()
            except Exception:
                pass

        def close(self) -> None:
            assert _pg_pool is not None
            _pg_pool.putconn(self._raw)

    _pg_local: threading.local = threading.local()

    def get_db() -> _PGConn:
        _ensure_pool()
        if not hasattr(_pg_local, "conn") or _pg_local.conn is None:
            assert _pg_pool is not None
            last_err: "Exception | None" = None
            for attempt in range(5):
                try:
                    _pg_local.conn = _PGConn(_pg_pool.getconn())
                    break
                except psycopg2.pool.PoolError as exc:
                    last_err = exc
                    time.sleep(0.05 * (attempt + 1))
            else:
                raise last_err  # type: ignore[misc]
        return _pg_local.conn  # type: ignore[return-value]

    def release_db() -> None:
        conn: "_PGConn | None" = getattr(_pg_local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            _pg_local.conn = None

# ─── SQLite adapter (dev / local) ────────────────────────────────────────────

else:
    _sqlite_local: threading.local = threading.local()

    def get_db() -> sqlite3.Connection:  # type: ignore[misc]
        if not hasattr(_sqlite_local, "conn"):
            os.makedirs(os.path.dirname(os.path.abspath(SQLITE_PATH)), exist_ok=True)
            conn = sqlite3.connect(
                SQLITE_PATH, check_same_thread=False,
                timeout=30.0, isolation_level=None
            )
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            _sqlite_local.conn = conn
        return _sqlite_local.conn

    def release_db() -> None:  # type: ignore[misc]
        pass


def init_db() -> None:
    """Crea las tablas rf_* si no existen. Idempotente."""
    with open(_SCHEMA_PATH, encoding="utf-8") as f:
        schema = f.read()
    db = get_db()
    db.executescript(schema)
    db.commit()
    _migrate_legacy_corrections(db)
    _migrate_add_comment_parent_id(db)
    _migrate_add_project_display_name(db)
    _migrate_add_project_branding(db)
    _migrate_add_signing_integrity(db)
    _migrate_signing_integrity_gaps(db)
    _migrate_add_document_display_order(db)
    _migrate_add_project_privacy(db)


def _migrate_add_comment_parent_id(db) -> None:
    """Agrega parent_id a rf_section_comments (hilos de respuesta, 2026-09-01) si el schema
    es de antes de este cambio -- CREATE TABLE IF NOT EXISTS no altera tablas que ya existen,
    así que las DB creadas antes de hoy necesitan este ALTER explícito, una sola vez."""
    if USE_PG:
        exists = db.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name='rf_section_comments' AND column_name='parent_id'"
        ).fetchone()
    else:
        cols = db.execute("PRAGMA table_info(rf_section_comments)").fetchall()
        exists = any(c["name"] == "parent_id" for c in cols)
    if not exists:
        db.execute(
            "ALTER TABLE rf_section_comments ADD COLUMN parent_id INTEGER "
            "REFERENCES rf_section_comments(id) ON DELETE CASCADE"
        )
        db.commit()


def _migrate_add_project_display_name(db) -> None:
    """Agrega display_name a rf_projects (nombre legible, 2026-09-01) si el schema es de
    antes de este cambio -- mismo motivo que _migrate_add_comment_parent_id."""
    if USE_PG:
        exists = db.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name='rf_projects' AND column_name='display_name'"
        ).fetchone()
    else:
        cols = db.execute("PRAGMA table_info(rf_projects)").fetchall()
        exists = any(c["name"] == "display_name" for c in cols)
    if not exists:
        db.execute("ALTER TABLE rf_projects ADD COLUMN display_name TEXT")
        db.commit()


def _migrate_add_project_branding(db) -> None:
    """Agrega partner_name/partner_logo a rf_projects (empresa partner/cliente opcional que
    viaja desde la Suite Documental junto con el push de un documento, 2026-09-19) -- mismo
    motivo que las migraciones anteriores."""
    if USE_PG:
        exists = db.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name='rf_projects' AND column_name='partner_name'"
        ).fetchone()
    else:
        cols = db.execute("PRAGMA table_info(rf_projects)").fetchall()
        exists = any(c["name"] == "partner_name" for c in cols)
    if not exists:
        db.execute("ALTER TABLE rf_projects ADD COLUMN partner_name TEXT")
        db.execute("ALTER TABLE rf_projects ADD COLUMN partner_logo TEXT")
        db.commit()


def _add_columns_if_missing(db, table: str, columns: dict) -> None:
    """`columns` es {nombre: definicion_sql_tipo}. Idempotente -- agrega solo las que falten,
    una ALTER TABLE por columna (SQLite no permite agregar varias en un solo ALTER)."""
    if USE_PG:
        existentes = {
            r["column_name"] for r in db.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name=?", (table,)
            ).fetchall()
        }
    else:
        existentes = {c["name"] for c in db.execute(f"PRAGMA table_info({table})").fetchall()}
    tocado = False
    for nombre, tipo in columns.items():
        if nombre not in existentes:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {nombre} {tipo}")
            tocado = True
    if tocado:
        db.commit()


def _migrate_add_signing_integrity(db) -> None:
    """Ronda 18 (2026-09-19): edit_locked (bloqueo desde la PRIMERA firma, no solo el sellado
    final), artefacto PDF real guardado al sellar (antes solo se guardaba el hash), branding/
    nombre del firmante fijados al momento de firmar (antes se releían siempre en vivo). Ver
    docs-privados/ronda-18-revision-firma-artefacto-inmutable.md para el diseño completo."""
    _add_columns_if_missing(db, "rf_documents", {
        "edit_locked": "INTEGER DEFAULT 0",
        "original_stored": "INTEGER DEFAULT 0",
        "pdf_data": "TEXT",
        "branding_name_at_signing": "TEXT",
        "branding_logo_at_signing": "TEXT",
    })
    for tabla in ("rf_review_signatures", "rf_approval_signers"):
        _add_columns_if_missing(db, tabla, {
            "content_fingerprint": "TEXT",
            "display_name_at_signing": "TEXT",
            "invalidated_at": "REAL",
            "invalidated_reason": "TEXT",
        })


def _migrate_signing_integrity_gaps(db) -> None:
    """Ronda 18, segunda vuelta (revisión de Codex sobre el commit 89909cf, 2026-09-19):

    1. branding_captured_at_signing distingue "se selló sin marca, a propósito" de "se selló
       antes de que este campo existiera" -- antes ambos casos se veían igual (logo NULL) y
       caían al branding actual del proyecto en los dos, incluyendo el que en realidad ya
       tenía un snapshot fijado (sin marca) que no debería pisarse.
    2. UNIQUE(document_id, user_id) en rf_review_signatures (TODA fila, no solo las activas)
       impedía volver a firmar después de una reapertura -- la fila invalidada seguía
       ocupando esa clave. Reemplazado por un índice único parcial, solo sobre firmas
       activas. SQLite no permite alterar un UNIQUE inline sin reconstruir la tabla."""
    _add_columns_if_missing(db, "rf_documents", {"branding_captured_at_signing": "INTEGER DEFAULT 0"})
    # Backfill: todo lo que ya tiene original_stored=1 se selló con la lógica de branding-al-
    # sellar ya activa (aunque haya sido con marca vacía) -- se marca como capturado.
    db.execute("UPDATE rf_documents SET branding_captured_at_signing=1 WHERE original_stored=1 AND branding_captured_at_signing=0")
    db.commit()

    if USE_PG:
        db.execute("ALTER TABLE rf_review_signatures DROP CONSTRAINT IF EXISTS rf_review_signatures_document_id_user_id_key")
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_rf_review_sig_active_unique "
            "ON rf_review_signatures(document_id, user_id) WHERE invalidated_at IS NULL"
        )
        db.commit()
        return

    row = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='rf_review_signatures'"
    ).fetchone()
    if not row or "UNIQUE(document_id, user_id)" not in (row["sql"] or ""):
        # Ya reconstruida en una corrida anterior, o tabla nueva (ya nace sin el constraint).
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_rf_review_sig_active_unique "
            "ON rf_review_signatures(document_id, user_id) WHERE invalidated_at IS NULL"
        )
        db.commit()
        return

    # Reconstrucción in-place: renombrar, crear la tabla nueva (sin el UNIQUE inline), copiar
    # filas, borrar la vieja. Todo en una transacción -- o se completa entero, o no se toca
    # nada (confirmado con el usuario: no hay firmas reales en la base local hoy, pero el
    # camino de migración tiene que ser seguro para cuando sí las haya).
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("ALTER TABLE rf_review_signatures RENAME TO rf_review_signatures_old_ronda18")
        db.execute("""
            CREATE TABLE rf_review_signatures (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id   TEXT NOT NULL REFERENCES rf_documents(id) ON DELETE CASCADE,
                user_id       TEXT NOT NULL,
                username      TEXT,
                role_label    TEXT,
                signed_at     REAL,
                content_fingerprint      TEXT,
                display_name_at_signing  TEXT,
                invalidated_at    REAL,
                invalidated_reason TEXT
            )
        """)
        db.execute("""
            INSERT INTO rf_review_signatures
                (id, document_id, user_id, username, role_label, signed_at,
                 content_fingerprint, display_name_at_signing, invalidated_at, invalidated_reason)
            SELECT id, document_id, user_id, username, role_label, signed_at,
                   content_fingerprint, display_name_at_signing, invalidated_at, invalidated_reason
            FROM rf_review_signatures_old_ronda18
        """)
        db.execute("DROP TABLE rf_review_signatures_old_ronda18")
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_rf_review_sig_active_unique "
            "ON rf_review_signatures(document_id, user_id) WHERE invalidated_at IS NULL"
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_rf_review_sig_doc ON rf_review_signatures(document_id)")
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise


def _migrate_add_document_display_order(db) -> None:
    """Orden de documentos elegido a mano por DRP dentro de un proyecto (pedido del usuario,
    2026-09-19: "el orden lo doy yo", no un orden fijo por tipo de documento). NULL en bases
    ya existentes = todavía nadie reordenó nada, cae al orden de cascada GxP por defecto
    (doc_order.py) -- no hace falta backfill."""
    _add_columns_if_missing(db, "rf_documents", {"display_order": "INTEGER"})


def _migrate_add_project_privacy(db) -> None:
    """Proyectos privados (pedido del usuario, 2026-09-19) -- ver comentario en schema.sql.
    0/NULL en bases existentes = todo lo que ya había sigue siendo "público" (visible para
    cualquier DRP, comportamiento sin cambios)."""
    _add_columns_if_missing(db, "rf_projects", {"is_private": "INTEGER DEFAULT 0", "owner_user_id": "TEXT"})


def _migrate_legacy_corrections(db) -> None:
    """Corre una sola vez (mientras rf_section_comments esté vacía): copia lo que hubiera
    en la vieja rf_section_corrections (un comentario por sección, sección 2026-08-31) a la
    nueva rf_section_comments (varios por sección) para no perder comentarios ya cargados
    antes del cambio de modelo."""
    already = db.execute("SELECT 1 FROM rf_section_comments LIMIT 1").fetchone()
    if already:
        return
    legacy = db.execute(
        "SELECT document_id, section_key, content, resolved, updated_by, updated_at "
        "FROM rf_section_corrections"
    ).fetchall()
    for row in legacy:
        db.execute(
            "INSERT INTO rf_section_comments "
            "(document_id, section_key, content, resolved, user_id, username, created_at) "
            "VALUES (?,?,?,?,NULL,?,?)",
            (row["document_id"], row["section_key"], row["content"], row["resolved"],
             row["updated_by"], row["updated_at"]),
        )
    if legacy:
        db.commit()


def reset_db_for_tests() -> None:
    """Solo para tests: vacía todas las tablas rf_* sin borrar el esquema."""
    db = get_db()
    for table in (
        "rf_system_audit_log",
        "rf_projects",
        "rf_people_book_events",
        "rf_approval_signers",
        "rf_approval_rounds",
        "rf_review_signatures",
        "rf_section_comments",
        "rf_section_corrections",
        "rf_documents",
        "rf_document_access_grants",
        "rf_invites",
        "rf_sessions",
        "rf_login_attempts",
        "rf_pin_attempts",
        "rf_users",
    ):
        db.execute(f"DELETE FROM {table}")
    db.commit()
