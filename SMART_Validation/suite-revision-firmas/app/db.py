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
            _pg_pool = psycopg2.pool.ThreadedConnectionPool(2, 20, DATABASE_URL)

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
        "rf_users",
    ):
        db.execute(f"DELETE FROM {table}")
    db.commit()
