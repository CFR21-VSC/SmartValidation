"""
db_adapter.py — Database abstraction layer.

  LOCAL / DEV:  no DATABASE_URL env var  →  SQLite (same as before)
  PRODUCTION:   DATABASE_URL=postgres://…  →  PostgreSQL via psycopg2

The adapter translates ? placeholders → %s, converts AUTOINCREMENT DDL,
and returns dict-like rows in both modes so server.py needs no changes
beyond the _get_db() and _db_init() functions.
"""
import os
import re
import sqlite3
import threading

DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
USE_PG: bool = DATABASE_URL.startswith(("postgres://", "postgresql://"))

_HERE = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_HERE, "..", "data")
SQLITE_PATH: str = os.environ.get(
    "DB_PATH", os.path.join(_DATA_DIR, "smart_validation.db")
)

# ─── DDL adaptation (SQLite → PostgreSQL) ────────────────────────────────────

_DDL_SUBS = [
    # AUTOINCREMENT primary keys → PostgreSQL sequences
    (r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b", "BIGSERIAL PRIMARY KEY"),
    # Floating-point timestamp columns — PostgreSQL REAL is only 4 bytes
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

    class _PGCursor:
        """psycopg2 cursor wrapper: ? → %s, exposes lastrowid."""

        def __init__(self, raw: "psycopg2.extensions.cursor") -> None:
            self._cur = raw
            self.lastrowid: int | None = None

        # ----- execute -------------------------------------------------------
        def execute(self, sql: str, params: tuple = ()) -> "_PGCursor":
            sql = sql.replace("?", "%s")
            self._cur.execute(sql, params or ())
            # Capture last inserted serial id for callers that use cur.lastrowid
            if sql.lstrip().upper().startswith("INSERT"):
                try:
                    probe = self._cur.connection.cursor()
                    probe.execute("SELECT lastval()")
                    row = probe.fetchone()
                    self.lastrowid = row[0] if row else None
                    probe.close()
                except Exception:
                    self.lastrowid = None
            return self

        def executemany(self, sql: str, seq) -> "_PGCursor":
            sql = sql.replace("?", "%s")
            self._cur.executemany(sql, list(seq))
            return self

        # ----- fetch ---------------------------------------------------------
        def fetchone(self):
            return self._cur.fetchone()

        def fetchall(self):
            return self._cur.fetchall()

        @property
        def rowcount(self) -> int:
            return self._cur.rowcount

    class _PGConn:
        """
        psycopg2 connection wrapper that mimics the sqlite3 interface
        used throughout server.py.

        autocommit=True matches SQLite's isolation_level=None.
        Explicit transactions still work via db.execute('BEGIN') / COMMIT / ROLLBACK.
        """

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
            """Execute multi-statement DDL (CREATE TABLE / INDEX …)."""
            adapted = _adapt_ddl(script)
            statements = [s.strip() for s in adapted.split(";") if s.strip()]
            raw_cur = self._raw.cursor()
            for stmt in statements:
                try:
                    raw_cur.execute(stmt)
                except psycopg2.errors.DuplicateTable:
                    # IF NOT EXISTS handles this but be defensive
                    self._raw.rollback()
                except psycopg2.errors.DuplicateObject:
                    self._raw.rollback()
            raw_cur.close()

        def close(self) -> None:
            assert _pg_pool is not None
            _pg_pool.putconn(self._raw)

    _pg_local: threading.local = threading.local()

    def get_db() -> _PGConn:
        """Return a per-thread PostgreSQL connection checked out from the pool."""
        _ensure_pool()
        if not hasattr(_pg_local, "conn") or _pg_local.conn is None:
            assert _pg_pool is not None
            _pg_local.conn = _PGConn(_pg_pool.getconn())
        return _pg_local.conn  # type: ignore[return-value]


# ─── SQLite adapter (dev / local) ────────────────────────────────────────────

else:
    _sqlite_local: threading.local = threading.local()

    def get_db() -> sqlite3.Connection:  # type: ignore[misc]
        """Return a per-thread SQLite connection (unchanged from original)."""
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
