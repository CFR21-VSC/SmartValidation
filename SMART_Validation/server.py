#!/usr/bin/env python3
"""
Servidor local del Gestor de Evidencias GxP.

Sirve los archivos estaticos de la app y expone endpoints REST para
sincronizar fotos entre la PC y el celular en la misma red WiFi.

Uso:
    python server.py [puerto]

Por defecto escucha en el puerto 11294 y en todas las interfaces (0.0.0.0)
para que dispositivos en la misma red puedan acceder via http://IP-PC:11294
"""

import base64
import hashlib
import hmac
import html as _html_mod
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import urllib.request
import urllib.error
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote

try:
    import r2_adapter as _r2
except ImportError:
    _r2 = None  # type: ignore[assignment]

# Estado en memoria (no persistente; se pierde al reiniciar el servidor)
SESSIONS = {}
SESSION_TTL = 3600  # 1 hora
MAX_SESSION_BYTES = 50 * 1024 * 1024  # 50 MB — límite acumulado de imágenes por sesión
MAX_PHOTO_BYTES = 15 * 1024 * 1024     # 15 MB por foto
MAX_PHOTOS_PER_SESSION = 200           # SEC-FIX-SYNC04: límite de cantidad de fotos por sesión
MAX_SESSIONS = 200                     # SEC-FIX-DOS005: cota dura del dict SESSIONS


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# Cargar .env en os.environ antes de cualquier os.environ.get() (no sobreescribe vars ya seteadas)
_dotenv_path = os.path.join(ROOT_DIR, ".env")
if os.path.isfile(_dotenv_path):
    with open(_dotenv_path, encoding="utf-8") as _dotenv_f:
        for _dotenv_line in _dotenv_f:
            _dotenv_line = _dotenv_line.strip()
            if _dotenv_line and not _dotenv_line.startswith("#") and "=" in _dotenv_line:
                _k, _, _v = _dotenv_line.partition("=")
                _k = _k.strip()
                if _k and _k not in os.environ:
                    os.environ[_k] = _v.strip()

# ── Persistent storage (SQLite + filesystem) ──────────────────────────────────
# Local: <repo>/data/   Docker/Railway: /data  (DATA_DIR env var overrides)
DATA_DIR     = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(ROOT_DIR), "data"))
DB_PATH      = os.path.join(DATA_DIR, "smart_validation.db")
EVIDENCE_DIR = os.path.join(DATA_DIR, "evidence")   # server-side image storage

def _get_db():
    """Return a thread-local database connection.
    SQLite in dev (no DATABASE_URL), PostgreSQL in production (DATABASE_URL set).
    db_adapter is imported here so the .env loader above has already run."""
    import db_adapter  # noqa: PLC0415 — late import intentional (env must be loaded first)
    return db_adapter.get_db()


def _release_db():
    """Return this thread's DB connection to the pool (PostgreSQL) or no-op (SQLite).
    Must be called at the end of every request thread to prevent pool exhaustion."""
    import db_adapter  # noqa: PLC0415
    db_adapter.release_db()


def _db_init():
    """Create tables if they don't exist. Called once at startup."""
    db = _get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            system_name  TEXT,
            system_type  TEXT,
            gamp_category TEXT,
            cliente      TEXT,
            status       TEXT DEFAULT 'in_progress',
            snapshot_json TEXT,
            created_by   TEXT,
            created_at   REAL,
            updated_at   REAL
        );

        CREATE TABLE IF NOT EXISTS documents (
            id           TEXT PRIMARY KEY,
            project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            doc_type     TEXT NOT NULL,
            version      INTEGER DEFAULT 1,
            status       TEXT DEFAULT 'draft',
            json_data    TEXT NOT NULL,
            created_by   TEXT,
            created_at   REAL,
            updated_at   REAL,
            UNIQUE(project_id, doc_type)
        );

        CREATE TABLE IF NOT EXISTS audit_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id   TEXT,
            doc_type     TEXT,
            username     TEXT,
            action       TEXT,
            detail       TEXT,
            ip           TEXT,
            created_at   REAL
        );

        CREATE TABLE IF NOT EXISTS client_users (
            id           TEXT PRIMARY KEY,
            username     TEXT UNIQUE NOT NULL,
            display_name TEXT,
            pin_hash     TEXT,
            pin_set      INTEGER DEFAULT 0,
            created_by   TEXT,
            created_at   REAL,
            updated_at   REAL
        );

        CREATE TABLE IF NOT EXISTS user_project_access (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      TEXT NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
            project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            access_level TEXT DEFAULT 'read',
            granted_by   TEXT,
            granted_at   REAL,
            UNIQUE(user_id, project_id)
        );

        CREATE TABLE IF NOT EXISTS users (
            id                  TEXT PRIMARY KEY,
            username            TEXT UNIQUE NOT NULL,
            display_name        TEXT,
            email               TEXT,
            password_hash       TEXT,
            pin_hash            TEXT,
            pin_set             INTEGER DEFAULT 0,
            role                TEXT NOT NULL DEFAULT 'client',
            is_active           INTEGER DEFAULT 1,
            is_superadmin       INTEGER DEFAULT 0,
            created_by          TEXT,
            created_at          REAL,
            updated_at          REAL,
            last_login          REAL,
            last_login_ip       TEXT
        );

        CREATE TABLE IF NOT EXISTS project_access (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            access_level TEXT DEFAULT 'read',
            granted_by   TEXT,
            granted_at   REAL,
            UNIQUE(user_id, project_id)
        );

        CREATE TABLE IF NOT EXISTS revoked_tokens (
            token_hash  TEXT PRIMARY KEY,
            expires_at  REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_revoked_exp ON revoked_tokens(expires_at);

        CREATE TABLE IF NOT EXISTS auth_sessions (
            nonce       TEXT NOT NULL PRIMARY KEY,
            username    TEXT NOT NULL,
            created_at  REAL NOT NULL,
            ip          TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sess_user ON auth_sessions(username);

        CREATE TABLE IF NOT EXISTS evidence_images (
            compound_id  TEXT PRIMARY KEY,
            project_id   TEXT NOT NULL,
            data         TEXT NOT NULL,
            size_bytes   INTEGER DEFAULT 0,
            updated_at   REAL
        );
        CREATE INDEX IF NOT EXISTS idx_ev_img_proj ON evidence_images(project_id);

        CREATE TABLE IF NOT EXISTS sync_sessions (
            token        TEXT PRIMARY KEY,
            session_data TEXT NOT NULL,
            project_id   TEXT DEFAULT '',
            created_by   TEXT DEFAULT '',
            created_at   REAL,
            expires_at   REAL
        );
        CREATE INDEX IF NOT EXISTS idx_sync_sess_exp ON sync_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS test_executions (
            id           TEXT PRIMARY KEY,
            project_id   TEXT NOT NULL,
            test_id      TEXT NOT NULL,
            status       TEXT,
            notes        TEXT,
            observations TEXT,
            evidence_ids TEXT,
            finalized    INTEGER DEFAULT 0,
            executed_by  TEXT,
            executed_at  REAL,
            updated_at   REAL,
            UNIQUE(project_id, test_id)
        );
        CREATE INDEX IF NOT EXISTS idx_te_proj_upd ON test_executions(project_id, updated_at);
        CREATE TABLE IF NOT EXISTS mapeo_projects (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            owner      TEXT NOT NULL,
            state_json TEXT NOT NULL DEFAULT '{}',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mapeo_owner ON mapeo_projects(owner, updated_at);
    """)
    db.commit()

    # Sistema viejo de firma/revisión interno (rondas, firma directa con PIN, Validation
    # Book/People Book) eliminado 2026-09-02 -- todo el circuito de revisión y firma pasa
    # ahora por la Suite de Revisión y Firmas (servicio separado). Se dropean las tablas
    # (datos de prueba, confirmado con el usuario, nada oficial todavía) -- orden: hijos con
    # FK hacia signing_rounds primero, para no chocar con la integridad referencial en
    # Postgres (SQLite no la enforcea por default, pero el orden es inofensivo igual).
    db.executescript("""
        DROP TABLE IF EXISTS signing_round_signers;
        DROP TABLE IF EXISTS round_comments;
        DROP TABLE IF EXISTS validation_book_blocks;
        DROP TABLE IF EXISTS signing_rounds;
        DROP TABLE IF EXISTS document_versions;
        DROP TABLE IF EXISTS invitations;
        DROP TABLE IF EXISTS document_signatures;
        DROP TABLE IF EXISTS doc_comments;
    """)
    db.commit()
    # Documentos que hayan quedado bloqueados en 'for_review'/'approved' por el sistema
    # viejo (ya no existe nada que revierta ese estado) vuelven a 'draft' -- desbloquea
    # inmediatamente cualquier documento atascado.
    db.execute("UPDATE documents SET status='draft' WHERE status IN ('for_review','approved')")
    db.commit()
    # Migraciones en caliente (idempotentes — ignorar si la columna ya existe)
    for _migration in [
        "ALTER TABLE users ADD COLUMN email TEXT",
        # Lockout por cuenta: contador de intentos fallidos y timestamp de bloqueo
        "ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN locked_until REAL",
        # Cambio obligatorio de credenciales en primer acceso
        "ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0",
        # Carpeta vinculada al proyecto para sincronización automática desde disco
        "ALTER TABLE projects ADD COLUMN folder_path TEXT",
        # Superadmin: único usuario que puede crear/desactivar otros usuarios
        "ALTER TABLE users ADD COLUMN is_superadmin INTEGER DEFAULT 0",
        # IP del último acceso exitoso — para alertas de login desde nueva ubicación
        "ALTER TABLE users ADD COLUMN last_login_ip TEXT",
        # Snapshot del estado completo del proyecto (JSON) para restaurar en otros browsers
        "ALTER TABLE projects ADD COLUMN snapshot_json TEXT",
        # UNIQUE index en documents(project_id, doc_type) — puede faltar si la tabla
        # se creó antes de que el constraint apareciera en el DDL. Idempotente.
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_proj_type ON documents(project_id, doc_type)",
    ]:
        try:
            db.execute(_migration)
        except Exception:
            pass

    # Índices de rendimiento (CREATE INDEX IF NOT EXISTS es idempotente)
    db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_audit_project
            ON audit_events(project_id);
        CREATE INDEX IF NOT EXISTS idx_proj_access_project
            ON project_access(project_id);
    """)


# VULN-12: validación de formato para path params — previene path traversal y SQL injection.
# Se aceptan todos los formatos de project ID generados por el cliente:
#   - UUID v4      → generados por el server (uuid.uuid4())
#   - proj_XXX     → formato timestamp del cliente (projects-manager.js)
#   - __XXX__      → IDs de proyectos demo y especiales
#   - Cualquier combinación de [a-z0-9_-], sin separadores de path ni caracteres de control.
# Lo que se bloquea es: '/', '..', caracteres de control, strings vacíos, strings > 80 chars.
_UUID_RE     = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
_CLI_PROJ_RE = re.compile(r'^[a-z0-9_-]{2,80}$', re.IGNORECASE)

def _is_valid_uuid(v: str) -> bool:
    return bool(v and _UUID_RE.match(v))

def _is_valid_proj_id(v: str) -> bool:
    return bool(v and (_UUID_RE.match(v) or _CLI_PROJ_RE.match(v)))

_DOC_TYPE_RE = re.compile(r'^[a-zA-Z0-9_-]{1,60}$')

def _is_valid_doc_type(v: str) -> bool:
    return bool(v and _DOC_TYPE_RE.match(v))

# ── API route patterns ────────────────────────────────────────────────────────
_RE_PROJ_ID          = re.compile(r'^/api/projects/([^/]+)$')
_RE_PROJ_EXPORT      = re.compile(r'^/api/projects/([^/]+)/export$')
_RE_PROJ_SNAPSHOT    = re.compile(r'^/api/projects/([^/]+)/snapshot$')
_RE_EVIDENCE         = re.compile(r'^/api/evidence/([a-zA-Z0-9_-]{1,300})$')
_RE_EVIDENCE_BATCH   = re.compile(r'^/api/evidence-batch$')
_RE_ANALYTICS        = re.compile(r'^/api/analytics(/.+)?$')
_RE_NOTIFY_DESVIOS   = re.compile(r'^/api/notify-desvios$')
_RE_PROJ_FOLDER      = re.compile(r'^/api/projects/([^/]+)/folder$')
_RE_PROJ_FOLDER_SCAN = re.compile(r'^/api/projects/([^/]+)/folder-scan$')
_RE_PROJ_FOLDER_IMPORT = re.compile(r'^/api/projects/([^/]+)/folder-import$')
_RE_PROJ_DOCS     = re.compile(r'^/api/projects/([^/]+)/documents$')
_RE_COHERENCE_PACK = re.compile(r'^/api/projects/([^/]+)/coherence-pack$')
_RE_PROJ_DOC      = re.compile(r'^/api/projects/([^/]+)/documents/([^/]+)$')
_RE_PROJ_DOC_SEND_FIRMAS     = re.compile(r'^/api/projects/([^/]+)/documents/([^/]+)/send-to-firmas$')
_RE_PROJ_DOC_FIRMAS_COMMENTS = re.compile(r'^/api/projects/([^/]+)/documents/([^/]+)/firmas-comments$')
_RE_PROJ_PHOTOS   = re.compile(r'^/api/projects/([^/]+)/photos$')
_RE_PROJ_PHOTO_ID = re.compile(r'^/api/projects/([^/]+)/photos/([^/]+)$')
_RE_EVIDENCE_BULK = re.compile(r'^/api/projects/([^/]+)/evidence$')
_RE_EVIDENCE_ONE  = re.compile(r'^/api/projects/([^/]+)/evidence/([^/]+)$')
_RE_EXECUTIONS    = re.compile(r'^/api/projects/([^/]+)/executions$')
_RE_EXECUTION_ONE = re.compile(r'^/api/projects/([^/]+)/executions/([^/]+)$')
_RE_MAPEO_LIST    = re.compile(r'^/api/mapeo/projects$')
_RE_MAPEO_ONE     = re.compile(r'^/api/mapeo/projects/([^/]+)$')
_RE_ADMIN_USER_ID = re.compile(r'^/admin/users/([^/]+)$')
_RE_ADMIN_ACCESS  = re.compile(r'^/admin/users/([^/]+)/access$')
_RE_ADMIN_ACC_P      = re.compile(r'^/admin/users/([^/]+)/access/([^/]+)$')
_RE_ADMIN_USR_PIN    = re.compile(r'^/admin/users/([^/]+)/pin$')
_RE_ADMIN_USR_PWD    = re.compile(r'^/admin/users/([^/]+)/password$')
_RE_ADMIN_USR_UNLOCK = re.compile(r'^/admin/users/([^/]+)/unlock$')

# ── Auth ─────────────────────────────────────────────────────────────────────
# Sin AUTH_SECRET_KEY el auth está desactivado (modo dev local).
# En producción Railway setear AUTH_SECRET_KEY + USER*_NAME/HASH/DISPLAY/ROLE.

_AUTH_SECRET = os.environ.get("AUTH_SECRET_KEY", "").strip()
_TOKEN_EXPIRE_H = int(os.environ.get("AUTH_TOKEN_HOURS", "8"))
_IS_PROD = os.environ.get("ENV", "").lower() == "production"
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "").strip()
if not _ALLOWED_ORIGIN:
    _ALLOWED_ORIGIN = "null" if _IS_PROD else "*"  # ALTA-3: no wildcard en producción
_RESEND_API_KEY      = os.environ.get("RESEND_API_KEY", "").strip()
_FROM_EMAIL          = os.environ.get("FROM_EMAIL", "noreply@smart-validation.app").strip()
_SUPERADMIN_USERNAME = os.environ.get("SUPERADMIN_USERNAME", "").strip().lower()
_ALERT_EMAIL         = os.environ.get("ALERT_EMAIL", "").strip().lower()
# URL pública del servidor (Railway/Render/etc). Si se define, el QR del móvil la usa.
# Ejemplo: PUBLIC_URL=https://smart-validation.up.railway.app
# Railway inyecta RAILWAY_PUBLIC_DOMAIN automáticamente (ej: smartvalidation-production.up.railway.app)
_railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
_PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/") or (
    f"https://{_railway_domain}" if _railway_domain else ""
)
# Sync habilitado siempre — usado tanto en LAN (HTTP) como en cloud (HTTPS con token)
_SYNC_ENABLED = True

# Bridge servicio-a-servicio con la Suite de Revisión y Firmas (suite-revision-firmas/).
# BRIDGE_API_KEY debe tener el MISMO valor que en las env vars de ese otro servicio.
# Vacío por default a propósito: sin ambas configuradas, _bridge_push_document /
# _bridge_pull_comments devuelven error en vez de intentar una llamada que va a fallar.
_FIRMAS_BASE_URL = os.environ.get("FIRMAS_BASE_URL", "").rstrip("/")
_BRIDGE_API_KEY = os.environ.get("BRIDGE_API_KEY", "").strip()

# VULN-08: clave HMAC para hashes del audit trail (Validation Book)
# Usar AUDIT_HMAC_KEY dedicada o caer en AUTH_SECRET_KEY como mínimo.
# Sin clave, un atacante con acceso a la DB puede recalcular hashes y falsificar el ledger.
_AUDIT_HMAC_KEY = (os.environ.get("AUDIT_HMAC_KEY", "").strip() or _AUTH_SECRET).encode()
if not _AUDIT_HMAC_KEY:
    # SEC-FIX-SEC05: no usar clave hardcodeada — sin clave el audit HMAC queda sin firma
    print("[WARN] AUDIT_HMAC_KEY no configurada. El Validation Book no tendrá firma HMAC verificable.")
    _AUDIT_HMAC_KEY = b""

# PIN: longitud mínima unificada en todos los paths (VULN-04)
_PIN_MIN_LEN = 6
_PIN_MAX_LEN = 8

# Lockout por cuenta: bloqueo tras N intentos fallidos consecutivos
_MAX_FAILED_LOGINS = 5    # intentos fallidos antes de bloquear
_LOCKOUT_SECONDS   = 900  # 15 minutos de bloqueo

# B5: field-length caps — SQLite TEXT has no inherent limit; enforce at application layer
_MAX_USERNAME_LEN   = 50
_MAX_DISPLAYNAME_LEN = 100
_MAX_EMAIL_LEN      = 254   # RFC 5321 maximum
_MAX_PROJNAME_LEN   = 200
_MAX_FIELD_LEN      = 200   # generic cap for system_name / system_type / cliente etc.

# Rate limiters: ip -> lista de timestamps de intentos
# NEW-01: lock global para hacer las operaciones read-modify-write thread-safe
_RATE_LIMIT_LOCK = threading.Lock()
_LOGIN_ATTEMPTS: dict = {}
_MAX_LOGINS_PER_MIN = 5

_AI_ATTEMPTS: dict = {}
_MAX_AI_PER_MIN = 10          # máximo 10 generaciones AI por IP por minuto

_GENERIC_ATTEMPTS: dict = {}  # para endpoints sensibles genéricos
_SIGN_ATTEMPTS: dict = {}     # rate limit para endpoints de firma con PIN

# NEW-14: blacklist de tokens revocados post-logout (token → expiry_ts)
_REVOKED_TOKENS: dict = {}
_REVOKED_LOCK = threading.Lock()
_MAX_REVOKED_TOKENS = 2000  # C6: cota dura; tokens activos por encima se purgan por orden de expiración

# Anti-scanner: rate limit global para TODAS las rutas (no solo auth)
_GLOBAL_ATTEMPTS: dict = {}
_MAX_GLOBAL_PER_MIN = 200   # legítimo: <4 req/s; un scanner supera 200/min en segundos

# Anti-scanner: IPs baneadas temporalmente (1 hora) por intentar honeypot paths
_BANNED_IPS: dict = {}
_BAN_DURATION = 3600  # 1 hora

# Rutas que NINGÚN usuario legítimo visita — trampa para scanners automáticos.
# Un solo intento a cualquiera de estos paths banea la IP por _BAN_DURATION.
_HONEYPOT_PATHS = frozenset({
    "/.git/config", "/.git/HEAD", "/.git/",
    "/wp-admin", "/wp-admin/", "/wp-login.php", "/wordpress/",
    "/phpinfo.php", "/admin.php", "/config.php",
    "/.htaccess", "/.htpasswd", "/.DS_Store",
    "/phpmyadmin", "/phpmyadmin/", "/adminer.php",
    "/actuator", "/actuator/", "/actuator/health", "/actuator/env",
    "/console", "/shell", "/cmd", "/webshell",
    "/api/swagger", "/swagger-ui.html", "/openapi.json", "/api-docs",
    "/graphql",
    "/backup.sql", "/database.sql", "/dump.sql",
    "/.env.local", "/.env.production", "/.env.backup", "/.env.prod",
    "/server-status", "/server-info",
    "/cgi-bin", "/cgi-bin/",
})

# Substrings (lowercase) de User-Agents de herramientas de escaneo conocidas
_SCANNER_UA_KEYWORDS = (
    "nikto", "nessus", "masscan", "nuclei", "sqlmap",
    "acunetix", "openvas", "metasploit", "burp",
    "zgrab", "gobuster", "dirbuster", "wfuzz", "ffuf",
    "nmap", "hydra", "dirb ", "w3af", "appscan",
)

# VULN-09: nombres de dispositivos reservados en Windows — abrirlos como archivo cuelga el proceso
_WINDOWS_RESERVED_RE = re.compile(
    r'^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)', re.IGNORECASE
)


def _rate_limit(store: dict, ip: str, max_per_min: int) -> bool:
    """Retorna True si el IP puede pasar, False si está limitado.
    Ventana deslizante de 60 segundos. NEW-01: protegido con lock para thread-safety.
    CRIT-3: purga IPs inactivas cuando el store supera 10k entradas (anti-DoS mem)."""
    now = time.time()
    with _RATE_LIMIT_LOCK:
        attempts = [t for t in store.get(ip, []) if now - t < 60]
        if len(attempts) >= max_per_min:
            store[ip] = attempts
            return False
        attempts.append(now)
        store[ip] = attempts
        if len(store) > 10_000:
            dead = [k for k, v in store.items() if not v or now - max(v) > 120]
            for k in dead[:5_000]:
                store.pop(k, None)
        return True


def _load_server_users() -> dict:
    """Lee usuarios desde variables de entorno USER1..5_NAME/HASH/DISPLAY/ROLE/EMAIL."""
    users = {}
    for i in ("1", "2", "3", "4", "5"):
        name = os.environ.get(f"USER{i}_NAME", "").strip().lower()
        phash = os.environ.get(f"USER{i}_HASH", "").strip()
        display = os.environ.get(f"USER{i}_DISPLAY", name)
        role = os.environ.get(f"USER{i}_ROLE", "admin")
        email = os.environ.get(f"USER{i}_EMAIL", "").strip().lower() or None
        if name and phash:
            users[name] = {"hash": phash, "display": display, "role": role, "email": email}
    return users


def _ensure_env_users():
    """Sincroniza usuarios de env vars en cada startup.

    INSERT para usuarios nuevos + UPDATE de password_hash/lockout para existentes.
    Las env vars son siempre fuente de verdad para usuarios del sistema — esto
    permite recuperar acceso cambiando USER{n}_HASH en Railway y redeployando.
    """
    db = _get_db()
    now = time.time()
    for uname, u in _load_server_users().items():
        try:
            db.execute(
                "INSERT OR IGNORE INTO users "
                "(id, username, display_name, email, password_hash, role, is_active, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 1, 'system', ?, ?)",
                (str(uuid.uuid4()), uname, u["display"], u.get("email"),
                 u["hash"], u.get("role", "admin"), now, now)
            )
        except Exception:
            pass
        # Siempre actualizar hash + desbloquear — la env var gana sobre lo que hay en DB.
        # Permite recuperar acceso sin consola solo cambiando USER{n}_HASH en Railway.
        try:
            db.execute(
                "UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL, "
                "updated_at=? WHERE username=?",
                (u["hash"], now, uname)
            )
        except Exception:
            pass


def _migrate_to_unified_users():
    """Migra client_users y user_project_access legados → tablas unificadas. Corre una sola vez."""
    db = _get_db()
    if db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] > 0:
        return  # ya migrado (env users se sincronizan en _ensure_env_users)

    now = time.time()
    # Seed inicial desde env vars (en caso de DB completamente vacía)
    for uname, u in _load_server_users().items():
        uid = str(uuid.uuid4())
        try:
            db.execute(
                "INSERT OR IGNORE INTO users "
                "(id, username, display_name, email, password_hash, role, is_active, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 1, 'system', ?, ?)",
                (uid, uname, u["display"], u.get("email"), u["hash"], u.get("role", "admin"), now, now)
            )
        except Exception:
            pass

    # 2. Migrar client_users legado → users con role='client'
    try:
        legacy = db.execute(
            "SELECT id, username, display_name, pin_hash, pin_set, created_by, created_at "
            "FROM client_users"
        ).fetchall()
    except Exception:
        legacy = []
    for row in legacy:
        try:
            db.execute(
                "INSERT OR IGNORE INTO users "
                "(id, username, display_name, pin_hash, pin_set, role, is_active, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, 'client', 1, ?, ?, ?)",
                (row["id"], row["username"], row["display_name"],
                 row["pin_hash"], row["pin_set"], row["created_by"],
                 row["created_at"], row["created_at"])
            )
        except Exception:
            pass

    # 3. Migrar user_project_access → project_access
    try:
        accesses = db.execute(
            "SELECT user_id, project_id, access_level, granted_by, granted_at "
            "FROM user_project_access"
        ).fetchall()
    except Exception:
        accesses = []
    for a in accesses:
        try:
            db.execute(
                "INSERT OR IGNORE INTO project_access "
                "(user_id, project_id, access_level, granted_by, granted_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (a["user_id"], a["project_id"], a["access_level"],
                 a["granted_by"], a["granted_at"])
            )
        except Exception:
            pass


def _make_audit_hash(data: str) -> str:
    """VULN-08: HMAC-SHA256 con clave secreta para hashes del audit trail.
    A diferencia de SHA-256 plano, no puede ser recalculado por un atacante
    que solo tiene acceso a la DB (necesita también la clave AUDIT_HMAC_KEY)."""
    return hmac.HMAC(_AUDIT_HMAC_KEY, data.encode("utf-8"), hashlib.sha256).hexdigest()


def _pbkdf2_verify(plain: str, stored: str) -> bool:
    """Verifica contraseña contra hash PBKDF2-SHA256 en formato pbkdf2_sha256$iters$salt$hash."""
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def _pbkdf2_hash(plain: str, iters: int = 600000) -> str:
    """Genera hash PBKDF2-SHA256. Mismo formato que _pbkdf2_verify."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, iters)
    return f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"


# Hash dummy pre-computado para ecualizar el tiempo de respuesta en login cuando el usuario
# no existe. Sin esto, "usuario no existe" responde en <1ms y "pass incorrecta" en ~300ms
# (600k iteraciones PBKDF2), lo que permite enumerar usernames por timing.
# Se computa una sola vez al arranque (~300ms); no impacta requests en curso.
_DUMMY_HASH: str = _pbkdf2_hash("__smart_dummy_user_invalid__")


def _create_token(username: str, display: str, role: str) -> str:
    """Crea un token firmado con HMAC-SHA256. Formato: base64(JSON).
    Incluye nonce aleatorio para que dos tokens del mismo usuario creados en el mismo segundo sean distintos."""
    expires = int(time.time()) + _TOKEN_EXPIRE_H * 3600
    nonce = secrets.token_hex(8)
    payload_str = f"{username}:{role}:{expires}:{nonce}"
    sig = hmac.HMAC(_AUTH_SECRET.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
    data = json.dumps({"u": username, "d": display, "r": role, "e": expires, "n": nonce, "s": sig})
    return base64.urlsafe_b64encode(data.encode()).decode()


def _issue_session(username: str) -> str | None:
    """Genera un token de sesión para username y lo registra en auth_sessions.
    Devuelve el header Set-Cookie listo para usar, o None si no hay AUTH_SECRET."""
    if not _AUTH_SECRET:
        return None
    db = _get_db()
    row = db.execute("SELECT display_name, role FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        return None
    display = row["display_name"] or username
    role    = row["role"] or "client"
    token   = _create_token(username, display, role)
    now     = time.time()
    try:
        tok_data = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        nonce    = tok_data.get("n", "")
        if nonce:
            db.execute("DELETE FROM auth_sessions WHERE username=?", (username,))
            db.execute("INSERT INTO auth_sessions (nonce, username, created_at, ip) VALUES (?,?,?,?)",
                       (nonce, username, now, "invite"))
            db.commit()
    except Exception:
        pass
    max_age   = _TOKEN_EXPIRE_H * 3600
    secure    = "; Secure" if _IS_PROD else ""
    same_site = "Strict" if _IS_PROD else "Lax"
    return f"smart_token={token}; HttpOnly{secure}; SameSite={same_site}; Max-Age={max_age}; Path=/"


def _decode_token(token: str) -> dict:
    """Verifica firma HMAC y expiración del token. Devuelve payload o {} si inválido.
    NEW-14: rechaza tokens revocados (blacklist post-logout).
    CRIT-4: revocación persiste en DB para sobrevivir reinicios del servidor."""
    if not token or not _AUTH_SECRET:
        return {}
    # Chequear dict en memoria primero (rápido) — CRIT-4: también chequear DB
    if token in _REVOKED_TOKENS:
        return {}
    try:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        _db = _get_db()
        row = _db.execute(
            "SELECT 1 FROM revoked_tokens WHERE token_hash=? AND expires_at > ?",
            (token_hash, time.time())
        ).fetchone()
        if row:
            return {}
    except Exception:
        pass
    try:
        data = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        if int(time.time()) > data["e"]:
            return {}
        expected = hmac.HMAC(
            _AUTH_SECRET.encode(),
            f"{data['u']}:{data['r']}:{data['e']}:{data.get('n', '')}".encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(data["s"], expected):
            return {}
        return data
    except Exception:
        return {}


def _validate_token_against_db(payload: dict) -> dict:
    """C-2: verifica que el usuario del payload exista en DB, esté activo y rol coincida.
    También verifica el nonce en auth_sessions para sesión única por usuario.
    Devuelve el payload enriquecido con 'sa', _AUTH_SUPERSEDED si la sesión fue reemplazada, o {} si inválido."""
    if not payload:
        return {}
    db = _get_db()
    row = db.execute(
        "SELECT role, is_active, is_superadmin FROM users WHERE username = ?", (payload["u"],)
    ).fetchone()
    if not row or not row["is_active"] or row["role"] != payload["r"]:
        return {}
    nonce = payload.get("n")
    if nonce:
        sess = db.execute("SELECT nonce FROM auth_sessions WHERE nonce=?", (nonce,)).fetchone()
        if not sess:
            return _AUTH_SUPERSEDED
        # Idle timeout: invalidar sesión si lleva más de _IDLE_TIMEOUT sin actividad
        now = time.time()
        last = _SESSION_ACTIVITY.get(nonce, 0)
        if last and now - last > _IDLE_TIMEOUT:
            db.execute("DELETE FROM auth_sessions WHERE nonce=?", (nonce,))
            _SESSION_ACTIVITY.pop(nonce, None)
            return {}
        _SESSION_ACTIVITY[nonce] = now
        # Limpiar nonces expirados del dict en memoria ocasionalmente
        if len(_SESSION_ACTIVITY) > 2000:
            cutoff = now - _IDLE_TIMEOUT
            dead = [k for k, v in list(_SESSION_ACTIVITY.items()) if v < cutoff]
            for k in dead:
                _SESSION_ACTIVITY.pop(k, None)
    return {**payload, "sa": bool(row["is_superadmin"])}


def _get_token(handler) -> str:
    """Extrae el token del header Cookie."""
    for part in handler.headers.get("Cookie", "").split(";"):
        part = part.strip()
        if part.startswith("smart_token="):
            return part[12:]
    return ""


def _check_auth(handler) -> dict:
    """Devuelve payload del usuario autenticado o {} si no autenticado.
    ALLOW_NO_AUTH=true tiene prioridad absoluta (modo dev local).
    En producción (ENV=production) esta variable se ignora — nunca puede bypassear auth.
    Sin AUTH_SECRET_KEY Y sin ALLOW_NO_AUTH, acceso denegado."""
    if os.environ.get("ALLOW_NO_AUTH", "").lower() == "true" and not _IS_PROD:
        return {"u": "dev", "d": "Desarrollador", "r": "admin"}
    if not _AUTH_SECRET:
        return {}  # denegar — no auto-abrir si falta la clave por accidente
    return _validate_token_against_db(_decode_token(_get_token(handler)))


def _is_auth_required() -> bool:
    return bool(_AUTH_SECRET)


def _check_rate_limit(ip: str) -> bool:
    """Retorna True si el IP puede intentar login, False si está bloqueado."""
    return _rate_limit(_LOGIN_ATTEMPTS, ip, _MAX_LOGINS_PER_MIN)


def _is_scanner_ua(ua: str) -> bool:
    low = ua.lower() if ua else ""
    return any(kw in low for kw in _SCANNER_UA_KEYWORDS)


def _is_ip_banned(ip: str) -> bool:
    until = _BANNED_IPS.get(ip, 0)
    if until > time.time():
        return True
    if until:
        _BANNED_IPS.pop(ip, None)
    return False


def _ban_ip(ip: str) -> None:
    _BANNED_IPS[ip] = time.time() + _BAN_DURATION
    if len(_BANNED_IPS) > 5000:
        now = time.time()
        dead = [k for k, v in list(_BANNED_IPS.items()) if v <= now]
        for k in dead[:2500]:
            _BANNED_IPS.pop(k, None)


def _add_sec_headers(handler, *, html: bool = False, allow_camera: bool = False) -> None:
    """Inyecta headers de seguridad en la respuesta activa.
    Llamar antes de end_headers(). html=True añade Content-Security-Policy.
    allow_camera=True usa camera=(self) en lugar de camera=() — necesario para /captura/."""
    if _IS_PROD:
        handler.send_header(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains; preload"
        )
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "SAMEORIGIN")
    handler.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
    _cam_policy = "camera=(self)" if allow_camera else "camera=()"
    handler.send_header("Permissions-Policy", f"{_cam_policy}, microphone=(), geolocation=()")
    if html:
        # ALTA-1: no usar Host del cliente en CSP — un Host malicioso inyectaría orígenes en connect-src.
        # El analytics service (puerto 8765) solo existe en modo local, nunca en producción.
        if _IS_PROD:
            connect_src = "connect-src 'self';"
        else:
            connect_src = "connect-src 'self' http://127.0.0.1:8765 http://localhost:8765;"
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "img-src 'self' data: blob:; "
            "font-src 'self' data: https://fonts.gstatic.com; "
            f"{connect_src} "
            "worker-src blob:; "
            "frame-src 'self' blob:; "
            "frame-ancestors 'self';"
        )
        handler.send_header("Content-Security-Policy", csp)


# ── Email (Resend API) ────────────────────────────────────────────────────────

def _email_html(title: str, body: str, cta_text: str = "", cta_url: str = "") -> str:
    """Genera un email HTML responsivo con branding SMART Validation."""
    cta_block = ""
    if cta_text and cta_url:
        # ADV-20: escapar cta_url para prevenir HTML injection si ALLOWED_ORIGIN contiene chars especiales
        safe_url = _html_mod.escape(cta_url, quote=True)
        safe_text = _html_mod.escape(cta_text)
        cta_block = (
            '<div style="text-align:center;margin:32px 0;">'
            f'<a href="{safe_url}" style="background:#1F3C56;color:#fff;padding:12px 28px;'
            'border-radius:4px;text-decoration:none;font-weight:bold;display:inline-block;">'
            f'{safe_text}</a></div>'
        )
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
        '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">'
        '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
        '<td align="center" style="padding:32px 16px;">'
        '<table width="560" cellpadding="0" cellspacing="0" '
        'style="background:#fff;border-radius:6px;overflow:hidden;'
        'box-shadow:0 2px 8px rgba(0,0,0,.08);">'
        '<tr><td style="background:#1F3C56;padding:20px 28px;">'
        '<span style="color:#fff;font-size:18px;font-weight:bold;">SMART Validation</span>'
        '<span style="color:#a0b4c8;font-size:12px;margin-left:12px;">GxP Document Suite</span>'
        '</td></tr>'
        '<tr><td style="padding:28px;">'
        f'<h2 style="color:#1F3C56;margin:0 0 16px 0;">{_html_mod.escape(title)}</h2>'
        f'<div style="color:#333;font-size:14px;line-height:1.6;">{body}</div>'
        f'{cta_block}'
        '<hr style="border:none;border-top:1px solid #e8e8e8;margin:24px 0;">'
        '<p style="color:#999;font-size:11px;margin:0;">Mensaje automático de SMART Validation. '
        'No respondas a este correo.</p>'
        '</td></tr></table></td></tr></table></body></html>'
    )


def _send_email(to: str, subject: str, html: str) -> None:
    """Envía email via Resend en un thread daemon. No-op si no hay API key configurada."""
    if not _RESEND_API_KEY or not to or "@" not in to:
        return

    def _worker():
        payload = json.dumps({"from": _FROM_EMAIL, "to": [to],
                              "subject": subject, "html": html}).encode("utf-8")
        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=payload,
            headers={"Authorization": f"Bearer {_RESEND_API_KEY}",
                     "Content-Type": "application/json",
                     "User-Agent": "SmartValidation/1.0"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status not in (200, 201):
                    sys.stderr.write(f"[email] HTTP {resp.status} enviando a {to}\n")
        except Exception as exc:
            sys.stderr.write(f"[email] Falló envío a {to}: {exc}\n")

    threading.Thread(target=_worker, daemon=True).start()


def _bridge_request(method: str, path: str, payload: dict | None = None) -> dict:
    """Llamada síncrona al bridge de la Suite de Revisión y Firmas (a diferencia de
    _send_email, acá NO corre en un thread daemon -- quien llama necesita saber si
    funcionó antes de decirle algo al usuario en la respuesta HTTP). Devuelve siempre un
    dict con "ok"; nunca lanza -- errores de red, HTTP o de config vuelven como
    {"ok": False, "error": ..., "status": <código HTTP o None>}."""
    if not _FIRMAS_BASE_URL or not _BRIDGE_API_KEY:
        return {"ok": False, "error": "Bridge no configurado (falta FIRMAS_BASE_URL o BRIDGE_API_KEY)", "status": 503}

    url = f"{_FIRMAS_BASE_URL}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "X-Bridge-Key": _BRIDGE_API_KEY,
                 "User-Agent": "SmartValidation-Bridge/1.0"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read() or b"{}")
            body["ok"] = True
            body["status"] = resp.status
            return body
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read()).get("detail", exc.reason)
        except Exception:
            detail = exc.reason
        return {"ok": False, "error": str(detail), "status": exc.code}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "status": None}


def _bridge_push_document(proj_id: str, doc_type: str) -> dict:
    """Empuja el json_data de un documento propio hacia Firmas. El documento tiene que
    existir localmente -- esta función no valida el proyecto/rol, eso queda del lado
    del endpoint que la invoque (Fase 4)."""
    db = _get_db()
    row = db.execute(
        "SELECT json_data FROM documents WHERE project_id=? AND doc_type=?",
        (proj_id, doc_type)
    ).fetchone()
    if not row:
        return {"ok": False, "error": "Documento no encontrado", "status": 404}
    try:
        content = json.loads(row["json_data"])
    except Exception:
        return {"ok": False, "error": "json_data corrupto, no se pudo parsear", "status": 500}

    path = f"/bridge/projects/{quote(proj_id, safe='')}/documents/{quote(doc_type, safe='')}"
    return _bridge_request("PUT", path, {"json_data": content})


def _bridge_pull_comments(proj_id: str, doc_type: str) -> dict:
    """Trae los comentarios de revisión de un documento desde Firmas. Solo lectura --
    no se persisten acá, Firmas sigue siendo la única fuente de verdad de comentarios."""
    path = f"/bridge/projects/{quote(proj_id, safe='')}/documents/{quote(doc_type, safe='')}/comments"
    return _bridge_request("GET", path)


def _send_security_alert(subject: str, body_html: str) -> None:
    """Envía alerta de seguridad via email. Destino: ALERT_EMAIL env var o email del superadmin."""
    to = _ALERT_EMAIL
    if not to:
        try:
            db = _get_db()
            row = db.execute(
                "SELECT email FROM users WHERE is_superadmin=1 AND is_active=1 "
                "AND email IS NOT NULL AND email != '' LIMIT 1"
            ).fetchone()
            if row:
                to = row["email"]
        except Exception:
            pass
    if to:
        _send_email(to, f"[SMART Validation] {subject}",
                    _email_html(subject, body_html))


def _bootstrap_superadmin() -> None:
    """Marca como superadmin al usuario definido en SUPERADMIN_USERNAME. Idempotente."""
    if not _SUPERADMIN_USERNAME:
        return
    try:
        db = _get_db()
        db.execute(
            "UPDATE users SET is_superadmin=1 WHERE username=?",
            (_SUPERADMIN_USERNAME,)
        )
    except Exception as e:
        sys.stderr.write(f"[superadmin] No se pudo marcar superadmin: {e}\n")


_PROTECTED_USERNAME = "federicosucho"  # superusuario del sistema — indestructible
_AUTH_SUPERSEDED = {"__superseded": True}  # sentinel: sesión válida pero reemplazada por nuevo login
_SESSION_ACTIVITY: dict = {}  # nonce -> last_activity timestamp (idle timeout)
_IDLE_TIMEOUT = 600            # 10 minutos en segundos

def _is_superadmin(user: dict) -> bool:
    return bool(user.get("sa"))


# ── AI Proxy helpers ──────────────────────────────────────────────────────────

def _load_dotenv():
    """Lee pares KEY=VALUE de .env en ROOT_DIR. Ignora comentarios y líneas vacías."""
    env = {}
    env_path = os.path.join(ROOT_DIR, ".env")
    if not os.path.isfile(env_path):
        return env
    with open(env_path, "r", encoding="utf-8-sig") as f:  # utf-8-sig elimina BOM si existe
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            # Limpiar espacios, comillas y caracteres invisibles
            v = v.strip().strip('"').strip("'").strip()
            env[k.strip()] = v
    return env


def _get_api_key():
    """Devuelve ANTHROPIC_API_KEY: primero desde env vars del proceso, luego .env."""
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key
    return _load_dotenv().get("ANTHROPIC_API_KEY", "").strip()


ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
AI_MAX_TOKENS = 96000
AI_REQUEST_TIMEOUT = 300  # segundos; 5 min es suficiente para protocolos grandes (SEC-FIX-DOS002)


_AI_MAX_RETRIES = 3  # reintentos ante conexión interrumpida (WinError 10054, etc.)

def _call_anthropic(api_key, model, system_prompt, user_prompt):
    """Llama a la API de Anthropic con streaming y reintentos. Devuelve (text, stop_reason).

    Usa stream=True para mantener la conexión TCP activa durante documentos largos
    (RRM, MTR, VSR) que tardan varios minutos. Sin streaming, Anthropic puede resetear
    la conexión antes de que la respuesta completa llegue (WinError 10054).
    """
    payload = {
        "model": model,
        "max_tokens": AI_MAX_TOKENS,
        "stream": True,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    if system_prompt and system_prompt.strip():
        payload["system"] = system_prompt

    body = json.dumps(payload).encode("utf-8")
    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }

    for attempt in range(_AI_MAX_RETRIES):
        req = urllib.request.Request(
            ANTHROPIC_ENDPOINT, data=body, headers=headers, method="POST"
        )
        try:
            accumulated = []
            stop_reason = "end_turn"
            with urllib.request.urlopen(req, timeout=AI_REQUEST_TIMEOUT) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").strip()
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    try:
                        event = json.loads(data_str)
                    except (json.JSONDecodeError, ValueError):
                        continue
                    etype = event.get("type", "")
                    if etype == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            accumulated.append(delta.get("text", ""))
                    elif etype == "message_delta":
                        stop_reason = event.get("delta", {}).get("stop_reason", stop_reason)
                    elif etype == "error":
                        err_msg = event.get("error", {}).get("message", str(event))
                        raise RuntimeError(f"Anthropic stream error: {err_msg}")
            text = "".join(accumulated)
            print(f"[Anthropic] Streaming completo: {len(text)} chars, stop_reason={stop_reason}")
            return text, stop_reason
        except urllib.error.HTTPError as e:
            # Errores HTTP (4xx/5xx) no se reintentan
            raw = e.read().decode("utf-8", errors="replace")
            try:
                err_detail = json.loads(raw).get("error", {}).get("message", raw)
            except Exception:
                err_detail = raw[:500]
            raise RuntimeError(f"Anthropic API {e.code}: {err_detail}")
        except (urllib.error.URLError, OSError, ConnectionResetError) as e:
            reason = getattr(e, "reason", str(e))
            if attempt < _AI_MAX_RETRIES - 1:
                delay = 3 * (2 ** attempt)  # 3s, 6s, 12s
                print(f"[Anthropic] Conexión interrumpida ({reason}). "
                      f"Reintento {attempt + 2}/{_AI_MAX_RETRIES} en {delay}s...")
                time.sleep(delay)
            else:
                raise RuntimeError(
                    f"No se pudo conectar a Anthropic tras {_AI_MAX_RETRIES} intentos: {reason}"
                )


def is_private_ip(ip):
    """Determinar si una IP es de rango privado LAN."""
    if not ip or not isinstance(ip, str):
        return False
    parts = ip.split(".")
    if len(parts) != 4:
        return False
    try:
        a, b = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    # 10.0.0.0/8
    if a == 10:
        return True
    # 172.16.0.0/12
    if a == 172 and 16 <= b <= 31:
        return True
    # 192.168.0.0/16
    if a == 192 and b == 168:
        return True
    return False


def is_virtual_ip(ip):
    """Heuristica: detectar IPs virtuales/Docker que no funcionan para LAN real."""
    if not ip:
        return False
    # Docker default ranges
    if ip.startswith("172.17.") or ip.startswith("172.18.") or ip.startswith("172.19."):
        return True
    if ip.startswith("172.2") or ip.startswith("172.3"):  # 172.20-31 docker
        # Permitir si es claramente WiFi (raro pero posible)
        return False
    # WSL2 default
    if ip.startswith("172.16."):
        return True
    # VirtualBox, Hyper-V, VMware
    if ip.startswith("192.168.56.") or ip.startswith("192.168.99."):
        return True
    return False


def get_all_local_ips():
    """Lista todas las IPs IPv4 privadas (LAN) reales. Filtra virtuales."""
    ips = set()
    try:
        hostname = socket.gethostname()
        # gethostbyname_ex devuelve todas las IPs asociadas
        try:
            _, _, addrs = socket.gethostbyname_ex(hostname)
            for a in addrs:
                if is_private_ip(a) and not is_virtual_ip(a):
                    ips.add(a)
        except socket.gaierror:
            pass
    except Exception:
        pass

    # Tambien agregar la IP que usa para el "default route" hacia internet
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if is_private_ip(ip):
            ips.add(ip)
    except Exception:
        pass

    return sorted(ips)


def get_local_ip():
    """Detectar la mejor IP local: prefiere la del default route a internet."""
    # 1) IP que usa para conectar a internet (mas confiable como "WiFi real")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if is_private_ip(ip) and not is_virtual_ip(ip):
            return ip
    except Exception:
        pass

    # 2) Cualquier IP privada no virtual de la lista
    ips = get_all_local_ips()
    for ip in ips:
        if not is_virtual_ip(ip):
            return ip

    # 3) Lo que haya
    if ips:
        return ips[0]

    return "127.0.0.1"


def cleanup_expired_sessions():
    """Eliminar sesiones expiradas de memoria y DB."""
    now = time.time()
    with _RATE_LIMIT_LOCK:
        expired = [t for t, s in list(SESSIONS.items()) if now - s["created_at"] > SESSION_TTL]
        for t in expired:
            SESSIONS.pop(t, None)
    try:
        db = _get_db()
        db.execute("DELETE FROM sync_sessions WHERE expires_at<?", (now,))
    except Exception:
        pass


def _safe_filename(name: str, fallback: str) -> str:
    """VULN-09: sanitiza nombre de archivo bloqueando dispositivos Windows reservados."""
    safe = os.path.basename(name or fallback) or fallback
    if _WINDOWS_RESERVED_RE.match(safe):
        safe = fallback
    return safe or fallback


def _save_photo_to_disk(project_id: str, photo: dict):
    """Persiste foto en DATA_DIR/photos/{project_id}/{photo_id}.json."""
    try:
        safe_proj = _safe_filename(project_id, "unknown_project")
        photos_dir = os.path.join(DATA_DIR, "photos", safe_proj)
        os.makedirs(photos_dir, exist_ok=True)
        safe_id = _safe_filename(photo.get("id", ""), f"photo_{int(time.time() * 1000)}")
        with open(os.path.join(photos_dir, f"{safe_id}.json"), "w", encoding="utf-8") as f:
            json.dump(photo, f, ensure_ascii=False)
    except Exception as e:
        _safe_log_id = str(photo.get('id', '')).replace('\n', ' ').replace('\r', ' ')[:100]
        print(f"[Photo] Error al persistir foto {_safe_log_id}: {e}")


class SyncHandler(BaseHTTPRequestHandler):
    """Handler que sirve archivos estaticos + endpoints /sync/*"""

    # SEC-FIX-DOS001: timeout en lectura de headers (anti-Slowloris)
    timeout = 30

    def version_string(self) -> str:
        return "Server"

    # Silenciar logs ruidosos del polling
    def log_message(self, format, *args):
        if "/sync/photos/" in self.path and "GET" in args[0]:
            return  # silenciar polling
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), format % args))

    # ---------- Helpers ----------

    def _get_client_ip(self) -> str:
        """IP real del cliente. En producción usa el ÚLTIMO elemento de X-Forwarded-For
        (agregado por el proxy de confianza Railway), no el primero (controlable por cliente).
        VULN-03: tomar el primero permite IP spoofing para bypass de rate limiting."""
        if _IS_PROD:
            xff = self.headers.get("X-Forwarded-For", "")
            if xff:
                return xff.split(",")[-1].strip()
        return self.client_address[0]

    def _anti_scanner(self) -> bool:
        """Protección anti-scanner automático. Solo actúa en producción.
        Retorna True si la request fue bloqueada (caller debe hacer return inmediatamente)."""
        if not _IS_PROD:
            return False
        ip   = self._get_client_ip()
        path = urlparse(self.path).path

        # 1. IP ya baneada por intento previo
        if _is_ip_banned(ip):
            self.send_response(404)
            self.end_headers()
            return True

        # 2. User-Agent de herramienta de escaneo conocida
        ua = self.headers.get("User-Agent", "")
        if _is_scanner_ua(ua):
            _ban_ip(ip)
            self.send_response(404)
            self.end_headers()
            return True

        # 3. Honeypot: rutas que ningún usuario legítimo visita
        if path in _HONEYPOT_PATHS or path.lower().startswith("/.git"):
            _ban_ip(ip)
            self.send_response(404)
            self.end_headers()
            return True

        # 4. Rate limit global — solo para API/auth, no para assets estáticos.
        # La SPA carga ~60 JS/CSS en paralelo al abrir; aplicar el límite a estáticos
        # causa 429 en cascada cuando el bucket de IP es compartido (proxy Railway).
        _is_api_path = (path.startswith("/api/") or path.startswith("/auth/")
                        or path.startswith("/ai/") or path.startswith("/admin/"))
        if _is_api_path and not _rate_limit(_GLOBAL_ATTEMPTS, ip, _MAX_GLOBAL_PER_MIN):
            self.send_response(429)
            self.send_header("Retry-After", "60")
            self.end_headers()
            return True

        return False

    def _require_auth(self, user: dict) -> bool:
        """Verifica auth y envía la respuesta de error apropiada. Retorna True si debe abortar."""
        if not _is_auth_required():
            return False
        if not user:
            self._send_json(401, {"ok": False, "error": "No autenticado"})
            return True
        if user.get("__superseded"):
            self._send_json(401, {"ok": False, "error": "Sesión reemplazada. Iniciá sesión nuevamente.", "code": "SUPERSEDED"})
            return True
        return False

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", _ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if _ALLOWED_ORIGIN != "*":
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        _add_sec_headers(self)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ── Auth handlers ─────────────────────────────────────────────────────────

    def _serve_login_page(self):
        login_path = os.path.join(ROOT_DIR, "login.html")
        if not os.path.isfile(login_path):
            self._send_json(503, {"error": "login.html no encontrado"})
            return
        with open(login_path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        _add_sec_headers(self, html=True)
        self.end_headers()
        self.wfile.write(data)

    def _handle_auth_login(self):
        ip = self._get_client_ip()
        if not _check_rate_limit(ip):
            return self._send_json(429, {"ok": False, "error": "Demasiados intentos. Esperá 1 minuto."})
        data = self._read_json_body() or {}
        username = str(data.get("username", "")).strip().lower()
        password = str(data.get("password", ""))
        if not username or not password:
            return self._send_json(400, {"ok": False, "error": "Usuario y contraseña requeridos"})

        db = _get_db()
        row = db.execute(
            "SELECT id, display_name, password_hash, pin_hash, pin_set, role, is_active, "
            "failed_attempts, locked_until, is_superadmin, last_login_ip "
            "FROM users WHERE username=?", (username,)
        ).fetchone()

        if not row or not row["is_active"]:
            # Ecualización de timing: siempre ejecutar PBKDF2 para que la respuesta tarde
            # lo mismo tanto si el usuario existe como si no (previene username enumeration).
            _pbkdf2_verify(password, _DUMMY_HASH)
            return self._send_json(401, {"ok": False, "error": "Credenciales incorrectas"})

        # Lockout por cuenta: verificar si la cuenta está bloqueada
        now = time.time()
        locked_until = row["locked_until"] or 0
        if locked_until > now:
            mins_left = int((locked_until - now) / 60) + 1
            return self._send_json(429, {
                "ok": False,
                "error": f"Cuenta bloqueada por demasiados intentos fallidos. Intentá en {mins_left} minuto{'s' if mins_left != 1 else ''}.",
                "retry_after_minutes": mins_left,
            })

        role    = row["role"]
        display = row["display_name"] or username
        ok      = False

        # P1 — Todos los roles usan password_hash para login.
        # Fallback a pin_hash para clientes legados que aún no tienen password_hash.
        if bool(row["password_hash"]):
            ok = _pbkdf2_verify(password, row["password_hash"])
        elif role == "client" and bool(row["pin_hash"]):
            ok = _pbkdf2_verify(password, row["pin_hash"])
        else:
            ok = False

        if not ok:
            # SEC-FIX-AUTH001: UPDATE atómico para evitar race condition en counter de lockout
            updated = db.execute(
                "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id=? "
                "RETURNING failed_attempts", (row["id"],)
            ).fetchone()
            new_attempts = updated["failed_attempts"] if updated else (row["failed_attempts"] or 0) + 1
            db.commit()
            new_locked   = None
            if new_attempts >= _MAX_FAILED_LOGINS:
                new_locked = now + _LOCKOUT_SECONDS
                db.execute(
                    "UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?",
                    (new_attempts, new_locked, row["id"])
                )
                db.execute("""
                    INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                    VALUES (NULL, NULL, ?, 'login_lockout', ?, ?, ?)
                """, (username, f"Cuenta bloqueada tras {new_attempts} intentos fallidos", ip, now))
                _send_security_alert(
                    f"Cuenta bloqueada: {username}",
                    f"<p>La cuenta <strong>{_html_mod.escape(username)}</strong> fue bloqueada tras "
                    f"<strong>{new_attempts} intentos fallidos</strong> desde la IP "
                    f"<code>{_html_mod.escape(ip)}</code>.</p>"
                    f"<p>El bloqueo dura {_LOCKOUT_SECONDS // 60} minutos.</p>"
                )
                return self._send_json(429, {
                    "ok": False,
                    "error": f"Cuenta bloqueada por {_LOCKOUT_SECONDS // 60} minutos tras demasiados intentos fallidos.",
                    "locked_until": new_locked,
                })
            else:
                db.execute(
                    "UPDATE users SET failed_attempts=? WHERE id=?",
                    (new_attempts, row["id"])
                )
                db.execute("""
                    INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                    VALUES (NULL, NULL, ?, 'login_failed', ?, ?, ?)
                """, (username, f"Intento fallido {new_attempts}/{_MAX_FAILED_LOGINS}", ip, now))
            return self._send_json(401, {"ok": False, "error": "Credenciales incorrectas"})

        now_login = time.time()
        prev_ip = row["last_login_ip"]
        is_sa   = bool(row["is_superadmin"])
        # Resetear contador de intentos al loguearse correctamente
        db.execute(
            "UPDATE users SET last_login=?, last_login_ip=?, failed_attempts=0, locked_until=NULL WHERE id=?",
            (now_login, ip, row["id"])
        )
        # ALCOA+: registrar acceso exitoso al sistema (21 CFR Part 11 §11.10(e))
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (NULL, NULL, ?, 'login', ?, ?, ?)
        """, (username, f"Inicio de sesión exitoso (rol: {role})", ip, now_login))
        # Alertas de seguridad: login de superadmin o desde IP nueva
        if is_sa:
            _send_security_alert(
                "Inicio de sesión como superadministrador",
                f"<p><strong>{_html_mod.escape(display)}</strong> inició sesión desde "
                f"<code>{_html_mod.escape(ip)}</code>.</p>"
                + (f"<p style='color:#B85F0F'>IP anterior registrada: <code>{_html_mod.escape(prev_ip)}</code></p>"
                   if prev_ip and prev_ip != ip else "")
            )
        elif prev_ip and prev_ip != ip:
            _send_security_alert(
                f"Login desde IP nueva: {username}",
                f"<p>El usuario <strong>{_html_mod.escape(display)}</strong> ({_html_mod.escape(role)}) "
                f"inició sesión desde una IP nueva.</p>"
                f"<p>IP actual: <code>{_html_mod.escape(ip)}</code><br>"
                f"IP anterior: <code>{_html_mod.escape(prev_ip)}</code></p>"
            )

        token = _create_token(username, display, role)
        # Sesión única por usuario: invalidar sesión previa, registrar la nueva
        try:
            _tok_data = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
            _nonce = _tok_data.get("n", "")
            if _nonce:
                _sdb = _get_db()
                _sdb.execute("DELETE FROM auth_sessions WHERE username=?", (username,))
                _sdb.execute(
                    "INSERT INTO auth_sessions (nonce, username, created_at, ip) VALUES (?,?,?,?)",
                    (_nonce, username, now_login, ip)
                )
                _sdb.commit()
        except Exception:
            pass
        max_age = _TOKEN_EXPIRE_H * 3600
        secure = "; Secure" if _IS_PROD else ""
        same_site = "Strict" if _IS_PROD else "Lax"
        cookie = f"smart_token={token}; HttpOnly{secure}; SameSite={same_site}; Max-Age={max_age}; Path=/"
        # Determinar si el usuario debe cambiar sus credenciales antes de continuar
        must_change = bool(dict(row).get("must_change_password")) if role != "client" else not bool(row["pin_set"])
        extra = {}
        if role == "client":
            extra["pin_set"] = bool(row["pin_set"])
        if must_change:
            extra["must_change"] = True
        body = json.dumps({"ok": True, "display": display, "role": role, **extra}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _handle_auth_logout(self):
        # NEW-14 + CRIT-4: revocar el token activo — persiste en DB para sobrevivir reinicios
        if _AUTH_SECRET:
            token = _get_token(self)
            if token:
                try:
                    data = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
                    exp = data.get("e", time.time() + _TOKEN_EXPIRE_H * 3600)
                except Exception:
                    exp = time.time() + _TOKEN_EXPIRE_H * 3600
                now = time.time()
                # Actualizar blacklist en memoria
                with _REVOKED_LOCK:
                    expired_keys = [t for t, e in list(_REVOKED_TOKENS.items()) if e < now]
                    for t in expired_keys:
                        _REVOKED_TOKENS.pop(t, None)
                    if len(_REVOKED_TOKENS) >= _MAX_REVOKED_TOKENS:
                        trimmed = sorted(_REVOKED_TOKENS.items(), key=lambda kv: kv[1])
                        _REVOKED_TOKENS.clear()
                        _REVOKED_TOKENS.update(trimmed[-((_MAX_REVOKED_TOKENS // 2)):])
                    _REVOKED_TOKENS[token] = exp
                # CRIT-4: persistir en DB para que revocación sobreviva reinicios
                try:
                    token_hash = hashlib.sha256(token.encode()).hexdigest()
                    _db = _get_db()
                    _db.execute(
                        "INSERT OR IGNORE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)",
                        (token_hash, exp)
                    )
                    _db.execute("DELETE FROM revoked_tokens WHERE expires_at < ?", (now,))
                    # También limpiar auth_sessions para este nonce
                    try:
                        _nonce_logout = json.loads(base64.urlsafe_b64decode(token.encode()).decode()).get("n")
                    except Exception:
                        _nonce_logout = None
                    if _nonce_logout:
                        _db.execute("DELETE FROM auth_sessions WHERE nonce=?", (_nonce_logout,))
                    _db.commit()
                except Exception:
                    pass
        secure = "; Secure" if _IS_PROD else ""
        same_site = "Strict" if _IS_PROD else "Lax"
        cookie = f"smart_token=; HttpOnly{secure}; SameSite={same_site}; Max-Age=0; Path=/"
        body = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _auth_set_signing_pin(self, user):
        """POST /auth/set-signing-pin — configura el PIN de firma (separado del password de login).
        P1: todos los roles pueden tener un PIN de firma independiente de su contraseña.
        """
        data = self._read_json_body()
        if not isinstance(data, dict):
            return self._send_json(400, {"ok": False, "error": "Body JSON requerido"})
        pin = str(data.get("pin", "")).strip()
        if len(pin) < 6 or len(pin) > 8 or not pin.isdigit():
            return self._send_json(400, {"ok": False, "error": "El PIN debe tener entre 6 y 8 dígitos numéricos"})
        db = _get_db()
        row = db.execute("SELECT id FROM users WHERE username=? AND is_active=1", (user.get("u"),)).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        db.execute(
            "UPDATE users SET pin_hash=?, pin_set=1, updated_at=? WHERE id=?",
            (_pbkdf2_hash(pin), time.time(), row["id"])
        )
        db.commit()
        return self._send_json(200, {"ok": True})

    def _auth_change_credentials(self, user):
        """Cambio obligatorio de credenciales en primer acceso (o voluntario posterior).
        Admin/auditor → new_password. Cliente → new_pin."""
        data = self._read_json_body()
        if data is None:
            return
        role = user.get("r")
        db = _get_db()
        row = db.execute(
            "SELECT id, username FROM users WHERE username=? AND is_active=1",
            (user.get("u"),)
        ).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        now = time.time()
        ip  = self._get_client_ip()

        if role in ("admin", "auditor"):
            new_pass = str(data.get("new_password", "")).strip()
            if not new_pass or len(new_pass) < 8 or len(new_pass) > 256:
                return self._send_json(400, {"ok": False, "error": "La contraseña debe tener entre 8 y 256 caracteres"})
            db.execute(
                "UPDATE users SET password_hash=?, must_change_password=0, updated_at=? WHERE id=?",
                (_pbkdf2_hash(new_pass), now, row["id"])
            )
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (NULL, NULL, ?, 'change_credentials', 'Contraseña cambiada en primer ingreso', ?, ?)
            """, (user.get("u"), ip, now))
            return self._send_json(200, {"ok": True})

        elif role == "client":
            new_pin = str(data.get("new_pin", "")).strip()
            if not new_pin or not new_pin.isdigit() or len(new_pin) < _PIN_MIN_LEN or len(new_pin) > _PIN_MAX_LEN:
                return self._send_json(400, {"ok": False,
                    "error": f"El PIN debe ser {_PIN_MIN_LEN}-{_PIN_MAX_LEN} dígitos numéricos"})
            db.execute(
                "UPDATE users SET pin_hash=?, pin_set=1, must_change_password=0, updated_at=? WHERE id=?",
                (_pbkdf2_hash(new_pin), now, row["id"])
            )
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (NULL, NULL, ?, 'change_credentials', 'PIN establecido en primer ingreso', ?, ?)
            """, (user.get("u"), ip, now))
            return self._send_json(200, {"ok": True})

        return self._send_json(400, {"ok": False, "error": "Rol no soportado"})

    def _redirect_to_login(self):
        self.send_response(302)
        self.send_header("Location", "/login.html")
        self.end_headers()

    def _redirect_to_session_ended(self):
        self.send_response(302)
        self.send_header("Location", "/session-ended.html")
        self.end_headers()

    # ── Storage API handlers ──────────────────────────────────────────────────

    def _api_projects_list(self, user):
        db = _get_db()
        role = user.get("r")
        if role in ("admin", "auditor"):
            rows = db.execute(
                "SELECT id, name, system_name, system_type, gamp_category, cliente, "
                "status, created_by, created_at, updated_at "
                "FROM projects ORDER BY updated_at DESC"
            ).fetchall()
        else:
            rows = db.execute("""
                SELECT p.id, p.name, p.system_name, p.system_type, p.gamp_category,
                       p.cliente, p.status, p.created_by, p.created_at, p.updated_at,
                       pa.access_level
                FROM projects p
                INNER JOIN project_access pa ON pa.project_id = p.id
                INNER JOIN users u ON u.id = pa.user_id
                WHERE u.username = ?
                ORDER BY p.updated_at DESC
            """, (user.get("u", ""),)).fetchall()
        return self._send_json(200, {"ok": True, "projects": [dict(r) for r in rows]})

    def _api_projects_create(self, user):
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin puede crear proyectos"})
        data = self._read_json_body()
        if data is None:
            return
        name = str(data.get("name", "")).strip()
        if not name:
            return self._send_json(400, {"ok": False, "error": "name requerido"})
        if len(name) > _MAX_PROJNAME_LEN:
            return self._send_json(400, {"ok": False, "error": f"name demasiado largo (máx {_MAX_PROJNAME_LEN})"})
        system_name = str(data.get("system_name") or "")
        system_type = str(data.get("system_type") or "")
        gamp_cat    = str(data.get("gamp_category") or "")
        cliente     = str(data.get("cliente") or "")
        for _fname, _fval, _fmax in (
            ("system_name", system_name, _MAX_FIELD_LEN),
            ("system_type", system_type, 100),
            ("gamp_category", gamp_cat, 50),
            ("cliente", cliente, _MAX_FIELD_LEN),
        ):
            if len(_fval) > _fmax:
                return self._send_json(400, {"ok": False, "error": f"{_fname} demasiado largo (máx {_fmax})"})

        # Carpeta en disco: se puede pasar folder_path (ruta exacta) o folder_base (raíz donde crear subcarpeta)
        folder_path = str(data.get("folder_path") or "").strip()
        folder_base = str(data.get("folder_base") or "").strip()
        if not folder_path and folder_base:
            # Construye: <folder_base>/<nombre-proyecto>/ai-docs
            safe_name = name.replace("/", "-").replace("\\", "-").replace(":", "-")
            folder_path = os.path.join(folder_base, safe_name, "ai-docs")
        if folder_path:
            try:
                os.makedirs(folder_path, exist_ok=True)
            except Exception as e:
                return self._send_json(400, {"ok": False, "error": f"No se pudo crear la carpeta: {e}"})

        proj_id = str(uuid.uuid4())  # always server-generated; never trust client-supplied id
        now = time.time()
        db = _get_db()
        try:
            db.execute("BEGIN")
            db.execute(
                "INSERT INTO projects "
                "(id, name, system_name, system_type, gamp_category, cliente, "
                "status, folder_path, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (proj_id, name, system_name or None, system_type or None,
                 gamp_cat or None, cliente or None,
                 data.get("status", "in_progress"), folder_path or None,
                 user.get("u"), now, now)
            )
            # ALCOA+: audit trail de creación de proyecto
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, NULL, ?, 'project_create', ?, ?, ?)
            """, (proj_id, user.get("u"), f"Creó proyecto '{name}'", self._get_client_ip(), now))
            db.execute("COMMIT")
        except Exception as e:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            print(f"[DB] Error al crear proyecto: {e}")
            return self._send_json(500, {"ok": False, "error": "Error interno al guardar el proyecto."})
        return self._send_json(201, {"ok": True, "id": proj_id, "name": name, "folder_path": folder_path or None})

    def _api_project_get(self, proj_id, user):
        db = _get_db()
        if user.get("r") not in ("admin", "auditor"):
            access = db.execute("""
                SELECT pa.access_level FROM project_access pa
                INNER JOIN users u ON u.id = pa.user_id
                WHERE u.username = ? AND pa.project_id = ?
            """, (user.get("u", ""), proj_id)).fetchone()
            if not access:
                return self._send_json(403, {"ok": False, "error": "Acceso denegado"})
        row = db.execute(
            "SELECT id, name, system_name, system_type, gamp_category, cliente, "
            "status, folder_path, created_by, created_at, updated_at FROM projects WHERE id=?",
            (proj_id,)
        ).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
        return self._send_json(200, {"ok": True, "project": dict(row)})

    def _api_project_export(self, proj_id, user):
        """Exporta un proyecto completo (metadata + documentos) como bundle JSON portable."""
        if user.get("r") not in ("admin", "auditor"):
            return self._send_json(403, {"ok": False, "error": "Acceso denegado"})
        db = _get_db()
        proj = db.execute(
            "SELECT id, name, system_name, system_type, gamp_category, cliente, "
            "status, created_at, updated_at FROM projects WHERE id=?",
            (proj_id,)
        ).fetchone()
        if not proj:
            return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
        docs = db.execute(
            "SELECT doc_type, version, status, json_data, created_at, updated_at "
            "FROM documents WHERE project_id=? ORDER BY updated_at ASC",
            (proj_id,)
        ).fetchall()
        bundle = {
            "schemaVersion": "2.0",
            "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "project": dict(proj),
            "documents": [
                {
                    "docType": d["doc_type"],
                    "version": d["version"],
                    "status": d["status"],
                    "content": json.loads(d["json_data"]) if d["json_data"] else {},
                    "createdAt": d["created_at"],
                    "updatedAt": d["updated_at"],
                }
                for d in docs
            ],
            "workflow": {},  # el cliente completa esto con localStorage antes de descargar
        }
        proj_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', proj["name"])[:40]
        filename = f"{proj_name}.project.json"
        body = json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(200)
        _add_sec_headers(self)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_project_import(self, user):
        """Importa un proyecto desde un bundle JSON exportado. Crea proyecto y documentos nuevos."""
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin puede importar proyectos"})
        data = self._read_json_body()
        if data is None:
            return
        if data.get("schemaVersion") not in ("1.0", "2.0"):
            return self._send_json(400, {"ok": False, "error": "schemaVersion inválido o no soportado"})
        proj_data = data.get("project", {})
        name = str(proj_data.get("name", "")).strip()
        if not name:
            return self._send_json(400, {"ok": False, "error": "El bundle no contiene nombre de proyecto"})
        if len(name) > _MAX_PROJNAME_LEN:
            name = name[:_MAX_PROJNAME_LEN]
        new_proj_id = str(uuid.uuid4())
        now = time.time()
        db = _get_db()
        documents = data.get("documents", [])
        workflow = data.get("workflow", {})
        try:
            db.execute("BEGIN")
            db.execute(
                "INSERT INTO projects "
                "(id, name, system_name, system_type, gamp_category, cliente, "
                "status, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    new_proj_id, name,
                    proj_data.get("system_name") or None,
                    proj_data.get("system_type") or None,
                    proj_data.get("gamp_category") or None,
                    proj_data.get("cliente") or proj_data.get("client") or None,
                    proj_data.get("status", "in_progress"),
                    user.get("u"), now, now,
                )
            )
            imported = 0
            for doc in documents:
                doc_type = str(doc.get("docType") or doc.get("doc_type") or "").strip().upper()
                if not doc_type or not _is_valid_doc_type(doc_type):
                    continue
                content = doc.get("content", {})
                content_str = json.dumps(content, ensure_ascii=False)
                if len(content_str) > 5 * 1024 * 1024:
                    continue
                # 'for_review'/'approved' eran del sistema viejo de firma/revisión (eliminado
                # 2026-09-02) -- un export viejo puede traerlos, se normalizan a 'draft' para
                # no reintroducir documentos bloqueados sin forma de desbloquearlos.
                doc_status = str(doc.get("status", "draft"))
                if doc_status not in ("draft", "needs_revision"):
                    doc_status = "draft"
                db.execute("""
                    INSERT INTO documents
                      (id, project_id, doc_type, version, status, json_data,
                       created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      json_data=excluded.json_data,
                      status=excluded.status,
                      updated_at=excluded.updated_at
                """, (
                    f"{new_proj_id}_{doc_type}", new_proj_id, doc_type,
                    doc.get("version", 1), doc_status,
                    content_str, user.get("u"), now, now,
                ))
                imported += 1
            db.execute("""
                INSERT INTO audit_events
                  (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, NULL, ?, 'project_import', ?, ?, ?)
            """, (
                new_proj_id, user.get("u"),
                f"Importó proyecto '{name}' con {imported} doc(s)",
                self._get_client_ip(), now,
            ))
            db.execute("COMMIT")
        except Exception as e:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            print(f"[DB] Error al importar proyecto: {e}")
            return self._send_json(500, {"ok": False, "error": "Error interno al importar el proyecto."})
        return self._send_json(201, {
            "ok": True,
            "project_id": new_proj_id,
            "project_name": name,
            "doc_count": imported,
            "workflow": workflow,
        })

    # ── Carpeta vinculada ──────────────────────────────────────────────────

    def _api_project_set_folder(self, proj_id, user):
        """Vincula (o desvincula) una carpeta del disco local al proyecto."""
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin"})
        data = self._read_json_body()
        if data is None:
            return
        folder_path = str(data.get("folder_path", "")).strip()
        if folder_path:
            import pathlib as _pl
            _allowed_root = _pl.Path(DATA_DIR).resolve()
            try:
                _resolved = _pl.Path(folder_path).resolve()
                _resolved.relative_to(_allowed_root)  # ValueError si sale del árbol
            except (ValueError, OSError):
                return self._send_json(400, {"ok": False, "error": "La carpeta debe estar dentro del directorio de datos del servidor"})
            if not os.path.isdir(folder_path):
                return self._send_json(400, {"ok": False, "error": "La carpeta no existe en el servidor"})
        db = _get_db()
        db.execute(
            "UPDATE projects SET folder_path=?, updated_at=? WHERE id=?",
            (folder_path or None, time.time(), proj_id)
        )
        db.commit()
        return self._send_json(200, {"ok": True, "folder_path": folder_path or None})

    def _api_project_folder_scan(self, proj_id, user):
        """Lista los JSON de la carpeta vinculada e indica cuáles ya están importados."""
        if user.get("r") not in ("admin", "auditor"):
            return self._send_json(403, {"ok": False, "error": "Acceso denegado"})
        db = _get_db()
        row = db.execute("SELECT folder_path FROM projects WHERE id=?", (proj_id,)).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
        folder_path = row["folder_path"] if row["folder_path"] else None
        if not folder_path:
            return self._send_json(200, {"ok": True, "folder_path": None, "files": []})
        if not os.path.isdir(folder_path):
            return self._send_json(400, {"ok": False, "error": "La carpeta ya no existe en el servidor"})
        imported_types = {
            r["doc_type"] for r in
            db.execute("SELECT doc_type FROM documents WHERE project_id=?", (proj_id,)).fetchall()
        }
        files = []
        for fname in sorted(os.listdir(folder_path)):
            if not fname.lower().endswith(".json"):
                continue
            fpath = os.path.join(folder_path, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                doc_type = str(data.get("type", "")).upper()
                version  = str(data.get("document", {}).get("version", "")) if isinstance(data.get("document"), dict) else ""
                status   = str(data.get("document", {}).get("status", "")) if isinstance(data.get("document"), dict) else ""
                files.append({
                    "filename": fname,
                    "doc_type": doc_type or None,
                    "version": version or None,
                    "status": status or None,
                    "already_imported": doc_type in imported_types if doc_type else False,
                })
            except Exception as exc:
                files.append({"filename": fname, "doc_type": None, "error": str(exc)})
        return self._send_json(200, {"ok": True, "folder_path": folder_path, "files": files})

    def _api_project_folder_import(self, proj_id, user):
        """Importa uno o más archivos JSON desde la carpeta vinculada al proyecto."""
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin puede importar"})
        data = self._read_json_body()
        if data is None:
            return
        filenames = data.get("filenames", [])
        if not isinstance(filenames, list) or not filenames:
            return self._send_json(400, {"ok": False, "error": "filenames requerido"})
        db = _get_db()
        row = db.execute("SELECT folder_path FROM projects WHERE id=?", (proj_id,)).fetchone()
        if not row or not row["folder_path"]:
            return self._send_json(400, {"ok": False, "error": "Proyecto sin carpeta vinculada"})
        folder_path = row["folder_path"]
        results = []
        now = time.time()
        for fname in filenames:
            # Seguridad: no path traversal
            if any(c in fname for c in ("/", "\\", "..")):
                results.append({"filename": fname, "ok": False, "error": "nombre inválido"})
                continue
            fpath = os.path.join(folder_path, fname)
            if not os.path.isfile(fpath):
                results.append({"filename": fname, "ok": False, "error": "archivo no encontrado"})
                continue
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    json_data = json.load(f)
                doc_type = str(json_data.get("type", "")).upper()
                if not doc_type:
                    results.append({"filename": fname, "ok": False, "error": "sin campo 'type'"})
                    continue
                # SEC-FIX-SVE002: validar doc_type con whitelist (igual que _api_doc_upsert)
                if not _is_valid_doc_type(doc_type):
                    results.append({"filename": fname, "ok": False, "error": "doc_type inválido"})
                    continue
                db.execute("""
                    INSERT INTO documents
                        (id, project_id, doc_type, version, status, json_data, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        json_data=excluded.json_data,
                        updated_at=excluded.updated_at,
                        version=version+1
                """, (f"{proj_id}_{doc_type}", proj_id, doc_type, json.dumps(json_data, ensure_ascii=False),
                      user.get("u"), now, now))
                results.append({"filename": fname, "ok": True, "doc_type": doc_type})
            except Exception as exc:
                results.append({"filename": fname, "ok": False, "error": str(exc)})
        db.execute("UPDATE projects SET updated_at=? WHERE id=?", (now, proj_id))
        db.commit()
        imported = [r for r in results if r.get("ok")]
        return self._send_json(200, {"ok": True, "results": results, "imported": len(imported)})

    def _api_project_delete(self, proj_id, user):
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin puede eliminar proyectos"})
        if not _is_valid_proj_id(proj_id):
            return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
        db = _get_db()
        db.execute("BEGIN IMMEDIATE")
        try:
            proj = db.execute("SELECT name FROM projects WHERE id=?", (proj_id,)).fetchone()
            if not proj:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
            now = time.time()
            db.execute("DELETE FROM projects WHERE id=?", (proj_id,))
            # ADV-19: audit trail de eliminación de proyecto
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (NULL, NULL, ?, 'project_delete', ?, ?, ?)
            """, (user.get("u"), f"Eliminó proyecto '{proj['name']}' (id: {proj_id})",
                  self._get_client_ip(), now))
            db.execute("COMMIT")
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise
        return self._send_json(200, {"ok": True})

    def _api_snapshot_save(self, proj_id, user):
        """Write-through: stores full snapshot + extracts packageDocs (atomic)."""
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin puede sincronizar proyectos"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        data = self._read_json_body()
        if data is None:
            return
        snapshot = data.get("snapshot")
        if not snapshot:
            return self._send_json(400, {"ok": False, "error": "snapshot requerido"})
        now = time.time()
        # Almacenar snapshot sin el campo `data` de cada packageDoc:
        # los documentos ya se persisten en la tabla `documents` líneas abajo,
        # guardarlos también en snapshot_json duplica hasta 1MB+ por proyecto
        # y ese campo nunca es leído por ningún endpoint del servidor.
        _snapshot_light = dict(snapshot)
        if "packageDocs" in _snapshot_light:
            _snapshot_light["packageDocs"] = [
                {k: v for k, v in doc.items() if k != "data"}
                for doc in (_snapshot_light["packageDocs"] or [])
            ]
        snapshot_str = json.dumps(_snapshot_light)
        if len(snapshot_str) > 5 * 1024 * 1024:  # 5 MB max por snapshot
            return self._send_json(413, {"ok": False, "error": "Snapshot demasiado grande (máx 5 MB)"})
        sys_info = snapshot.get("systemInfo") or {}
        # projectName del body tiene prioridad (nombre que el usuario escribió en el wizard)
        _body_name = str(data.get("projectName") or "").strip()
        name = (_body_name
                or sys_info.get("projectName") or sys_info.get("name")
                or sys_info.get("nombreSistema") or sys_info.get("systemName") or proj_id)
        package_docs = (snapshot.get("packageDocs") or [])[:50]  # cap: un paquete GxP tiene ≤ 20 tipos
        db = _get_db()
        try:
            # Defensive: clear any stale aborted transaction left in the pooled connection.
            # get_transaction_status() == TRANSACTION_STATUS_INERROR means aborted.
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            db.execute("BEGIN")
            db.execute("""
                INSERT INTO projects
                  (id, name, system_name, system_type, gamp_category, cliente,
                   status, snapshot_json, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name=excluded.name, system_name=excluded.system_name,
                  system_type=excluded.system_type, gamp_category=excluded.gamp_category,
                  cliente=excluded.cliente, snapshot_json=excluded.snapshot_json,
                  updated_at=excluded.updated_at
            """, (
                proj_id, name,
                sys_info.get("systemName") or sys_info.get("system_name"),
                sys_info.get("systemType") or sys_info.get("system_type"),
                sys_info.get("gampCategory") or sys_info.get("gamp_category"),
                sys_info.get("client") or sys_info.get("cliente"),
                "in_progress", snapshot_str, user.get("u"), now, now
            ))
            synced_types = []
            for doc in package_docs:
                doc_type = doc.get("type") or doc.get("docType")
                if not doc_type:
                    continue
                db.execute("""
                    INSERT INTO documents
                      (id, project_id, doc_type, version, status, json_data,
                       created_by, created_at, updated_at)
                    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      json_data=excluded.json_data, status=excluded.status,
                      updated_at=excluded.updated_at
                """, (
                    f"{proj_id}_{doc_type}", proj_id, doc_type,
                    doc.get("status", "draft"),
                    json.dumps(doc), user.get("u"), now, now
                ))
                synced_types.append(doc_type)
            # ALCOA+: una entrada de audit por sincronización (evita N entradas en bulk)
            if synced_types:
                db.execute("""
                    INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                    VALUES (?, NULL, ?, 'snapshot_sync', ?, ?, ?)
                """, (proj_id, user.get("u"),
                      f"Sincronizó {len(synced_types)} doc(s): {', '.join(synced_types[:20])}",
                      self._get_client_ip(), now))
            db.execute("COMMIT")
        except Exception as e:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            print(f"[DB] Error al sincronizar documentos: {e}")
            return self._send_json(500, {"ok": False, "error": "Error interno al sincronizar documentos."})
        return self._send_json(200, {"ok": True, "docs_synced": len(package_docs), "updated_at": now})

    def _api_snapshot_get(self, proj_id, user):
        """Devuelve el snapshot almacenado para restaurar IndexedDB en un navegador nuevo."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        row = db.execute(
            "SELECT snapshot_json FROM projects WHERE id=?", (proj_id,)
        ).fetchone()
        if not row or not row["snapshot_json"]:
            return self._send_json(404, {"ok": False, "error": "Snapshot no disponible"})
        try:
            snapshot = json.loads(row["snapshot_json"])
        except Exception:
            return self._send_json(500, {"ok": False, "error": "Snapshot corrupto"})
        return self._send_json(200, {"ok": True, "snapshot": snapshot})

    # ── Evidence images (persistencia multi-navegador) ────────────────────────

    _MAX_EVIDENCE_BYTES = 8 * 1024 * 1024   # 8 MB base64 por imagen (~6 MB original)
    _MAX_EVIDENCE_TOTAL = 500 * 1024 * 1024  # 500 MB por proyecto

    # ── Test executions — sync granular por test case ─────────────────────────

    def _api_executions_get(self, proj_id, user):
        """GET /api/projects/{id}/executions?since={ts}
        Devuelve solo las ejecuciones actualizadas después de `since` (0 = todas)."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        try:
            since = float(urlparse(self.path).query.replace("since=", "") or 0)
        except ValueError:
            since = 0.0
        rows = db.execute(
            "SELECT * FROM test_executions WHERE project_id=? AND updated_at>? ORDER BY updated_at ASC",
            (proj_id, since)
        ).fetchall()
        executions = []
        for r in rows:
            e = dict(r)
            if e.get("evidence_ids"):
                try:
                    e["evidence_ids"] = json.loads(e["evidence_ids"])
                except Exception:
                    e["evidence_ids"] = []
            executions.append(e)
        return self._send_json(200, {"ok": True, "executions": executions, "server_ts": time.time()})

    def _api_execution_upsert(self, proj_id, test_id, user):
        """POST /api/projects/{id}/executions/{test_id}
        Guarda el estado de ejecución de un test case. Idempotente."""
        if not _is_valid_doc_type(test_id):
            return self._send_json(400, {"ok": False, "error": "test_id inválido"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        data = self._read_json_body()
        if data is None:
            return
        now = time.time()
        evidence_ids = data.get("evidence_ids") or []
        finalized = 1 if data.get("finalized") else 0
        try:
            db.execute("""
                INSERT INTO test_executions
                  (id, project_id, test_id, status, notes, observations,
                   evidence_ids, finalized, executed_by, executed_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  status=excluded.status,
                  notes=excluded.notes,
                  observations=excluded.observations,
                  evidence_ids=excluded.evidence_ids,
                  finalized=excluded.finalized,
                  executed_by=excluded.executed_by,
                  executed_at=excluded.executed_at,
                  updated_at=excluded.updated_at
            """, (
                f"{proj_id}_{test_id}", proj_id, test_id,
                data.get("status"), data.get("notes"), data.get("observations"),
                json.dumps(evidence_ids), finalized,
                user.get("u"), data.get("executed_at") or now, now
            ))
        except Exception as e:
            print(f"[DB] Error al guardar ejecución {test_id}: {e}")
            return self._send_json(500, {"ok": False, "error": "Error al guardar ejecución."})
        return self._send_json(200, {"ok": True, "updated_at": now})

    def _api_evidence_delete_one(self, proj_id: str, compound_id: str, user):
        """DELETE /api/projects/{id}/evidence/{compound_id} — borra una imagen de R2 y DB."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        # Borrar de R2
        if _r2 and _r2.is_configured():
            _r2.delete_image(compound_id)
        # Borrar del registro en DB
        try:
            db.execute("DELETE FROM evidence_images WHERE compound_id=? AND project_id=?",
                       (compound_id, proj_id))
        except Exception as e:
            print(f"[DB] Error borrando evidencia {compound_id}: {e}")
        return self._send_json(200, {"ok": True})

    # ── MapeoGxP REST endpoints ───────────────────────────────────────────────

    def _api_mapeo_list(self, user):
        """GET /api/mapeo/projects — proyectos del usuario autenticado."""
        db = _get_db()
        rows = db.execute(
            "SELECT id, name, owner, created_at, updated_at FROM mapeo_projects WHERE owner=? ORDER BY updated_at DESC",
            (user["u"],)
        ).fetchall()
        projects = [{"id": r[0], "name": r[1], "owner": r[2], "createdAt": r[3], "updatedAt": r[4]} for r in rows]
        return self._send_json(200, {"ok": True, "projects": projects})

    def _api_mapeo_get(self, mapeo_id: str, user):
        """GET /api/mapeo/projects/{id}."""
        db = _get_db()
        row = db.execute(
            "SELECT id, name, owner, state_json, created_at, updated_at FROM mapeo_projects WHERE id=? AND owner=?",
            (mapeo_id, user["u"])
        ).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
        try:
            state = json.loads(row[3])
        except Exception:
            state = {}
        proj = {"id": row[0], "name": row[1], "owner": row[2], "state": state, "createdAt": row[4], "updatedAt": row[5]}
        return self._send_json(200, {"ok": True, "project": proj})

    def _api_mapeo_save(self, mapeo_id: str, user):
        """POST /api/mapeo/projects/{id} — crear o actualizar."""
        body = self._read_json_body()
        if not body:
            return self._send_json(400, {"ok": False, "error": "Body requerido"})
        name = str(body.get("name", "Sin título"))[:200]
        state_json = json.dumps(body.get("state", {}))
        now = time.time()
        db = _get_db()
        db.execute(
            "INSERT INTO mapeo_projects (id, name, owner, state_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, state_json=excluded.state_json, updated_at=excluded.updated_at "
            "WHERE owner=?",
            (mapeo_id, name, user["u"], state_json, now, now, user["u"])
        )
        return self._send_json(200, {"ok": True, "updatedAt": now})

    def _api_mapeo_delete(self, mapeo_id: str, user):
        """DELETE /api/mapeo/projects/{id}."""
        db = _get_db()
        db.execute("DELETE FROM mapeo_projects WHERE id=? AND owner=?", (mapeo_id, user["u"]))
        return self._send_json(200, {"ok": True})

    def _api_evidence_delete_all(self, proj_id: str, user):
        """DELETE /api/projects/{id}/evidence — borra TODAS las imágenes del proyecto."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        # Borrar de R2
        r2_count = 0
        if _r2 and _r2.is_configured():
            r2_count = _r2.delete_project_images(proj_id)
        # Borrar de DB
        try:
            db.execute("DELETE FROM evidence_images WHERE project_id=?", (proj_id,))
        except Exception as e:
            print(f"[DB] Error borrando evidencias del proyecto {proj_id}: {e}")
        # Borrar también las ejecuciones (se perderían referencias a imágenes inexistentes)
        try:
            db.execute("DELETE FROM test_executions WHERE project_id=?", (proj_id,))
        except Exception as e:
            print(f"[DB] Error borrando ejecuciones del proyecto {proj_id}: {e}")
        print(f"[Evidence] Borradas {r2_count} imágenes R2 + registros DB para proyecto {proj_id}")
        return self._send_json(200, {"ok": True, "r2_deleted": r2_count})

    def _resolve_evidence_data(self, raw_data: str) -> "str | None":
        """Return the data-URI for a stored evidence row.

        If stored as 'r2:{key}', fetches from R2.
        If stored as a data-URI directly (legacy PostgreSQL rows), returns as-is.
        """
        if raw_data and raw_data.startswith("r2:"):
            if _r2 and _r2.is_configured():
                return _r2.get_image(raw_data[3:])
            return None
        return raw_data if raw_data else None

    def _store_evidence(self, db, cid: str, proj_id: str, data_uri: str, now: float) -> bool:
        """Persist one evidence image.
        Always stores the data-URI inline in SQLite (guaranteed retrieval).
        Also uploads to R2 when configured — R2 is a CDN backup, not the source of truth."""
        use_r2 = _r2 is not None and _r2.is_configured()
        if use_r2:
            ok = _r2.put_image(cid, data_uri)
            if not ok:
                print(f"[R2] Fallo al subir {cid} (no crítico — imagen guardada en SQLite)")
        stored_data = data_uri  # siempre inline: SQLite es la fuente de verdad del servidor
        stored_size = len(data_uri)
        try:
            db.execute(
                "INSERT INTO evidence_images (compound_id, project_id, data, size_bytes, updated_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(compound_id) DO UPDATE SET "
                "data=excluded.data, size_bytes=excluded.size_bytes, updated_at=excluded.updated_at",
                (str(cid)[:300], proj_id, stored_data, stored_size, now)
            )
            return True
        except Exception as exc:
            print(f"[DB] Error al registrar evidencia {cid}: {exc}")
            return False

    def _api_evidence_images_get(self, proj_id, user):
        """GET /api/projects/{id}/evidence — todas las imágenes del proyecto."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        rows = db.execute(
            "SELECT compound_id, data FROM evidence_images WHERE project_id=?", (proj_id,)
        ).fetchall()
        images = {}
        for r in rows:
            resolved = self._resolve_evidence_data(r["data"] or "")
            if resolved:
                images[r["compound_id"]] = resolved
        return self._send_json(200, {"ok": True, "images": images})

    def _api_evidence_image_get(self, proj_id, compound_id, user):
        """GET /api/projects/{id}/evidence/{compound_id} — una imagen."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        row = db.execute(
            "SELECT data FROM evidence_images WHERE compound_id=? AND project_id=?",
            (compound_id, proj_id)
        ).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Imagen no encontrada"})
        resolved = self._resolve_evidence_data(row["data"] or "")
        if not resolved:
            return self._send_json(404, {"ok": False, "error": "Imagen no disponible"})
        return self._send_json(200, {"ok": True, "compound_id": compound_id, "data": resolved})

    def _api_evidence_images_upload(self, proj_id, user):
        """POST /api/projects/{id}/evidence — subida masiva {images: {cid: dataUri}}."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        body = self._read_json_body()
        if body is None:
            return
        images = body.get("images") or {}
        if not isinstance(images, dict):
            return self._send_json(400, {"ok": False, "error": "images debe ser un objeto"})
        now = time.time()
        saved = 0
        for cid, data in list(images.items())[:500]:  # cap 500 imágenes por llamada
            if not isinstance(data, str) or not data.startswith("data:"):
                continue
            if len(data) > self._MAX_EVIDENCE_BYTES:
                continue
            if self._store_evidence(db, str(cid)[:300], proj_id, data, now):
                saved += 1
        return self._send_json(200, {"ok": True, "saved": saved})

    def _api_evidence_image_upload(self, proj_id, compound_id, user):
        """POST /api/projects/{id}/evidence/{compound_id} — subida individual."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        body = self._read_json_body()
        if body is None:
            return
        data = body.get("data", "")
        if not isinstance(data, str) or not data.startswith("data:"):
            return self._send_json(400, {"ok": False, "error": "data URI inválida"})
        if len(data) > self._MAX_EVIDENCE_BYTES:
            return self._send_json(413, {"ok": False, "error": "Imagen demasiado grande (máx 8 MB)"})
        now = time.time()
        if not self._store_evidence(db, str(compound_id)[:300], proj_id, data, now):
            return self._send_json(500, {"ok": False, "error": "Error al guardar imagen"})
        return self._send_json(200, {"ok": True})

    @staticmethod
    def _proj_id_from_compound(compound_id: str) -> "str | None":
        """Extract project_id from a compound_id of the form '{proj_id}_{img_id}'.

        Project IDs always have the format 'proj_{digits}_{6chars}', so the
        first three underscore-separated tokens reconstruct the project_id.
        """
        parts = compound_id.split("_")
        if len(parts) >= 3 and parts[0] == "proj":
            return "_".join(parts[:3])
        return None

    def _api_evidence_save(self, compound_id, user):
        """POST /api/evidence/{compound_id} — guarda imagen; usa R2 si configurado."""
        body = self._read_json_body()
        if body is None:
            return
        raw = body.get("data", "")
        if not raw or not isinstance(raw, str) or not raw.startswith("data:"):
            return self._send_json(400, {"ok": False, "error": "data URI inválida"})
        if len(raw) > self._MAX_EVIDENCE_BYTES:
            return self._send_json(413, {"ok": False, "error": "Imagen demasiado grande (máx 8 MB)"})

        if _r2 is not None and _r2.is_configured():
            proj_id = self._proj_id_from_compound(compound_id) or "unknown"
            db = _get_db()
            if not self._store_evidence(db, compound_id, proj_id, raw, time.time()):
                return self._send_json(500, {"ok": False, "error": "Error guardando imagen"})
            return self._send_json(200, {"ok": True})

        # Fallback: filesystem (dev / sin R2)
        mime = "image/jpeg"
        b64 = raw
        if "," in raw:
            header, b64 = raw.split(",", 1)
            if ":" in header and ";" in header:
                mime = header.split(":")[1].split(";")[0].strip()
        if mime not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            mime = "image/jpeg"
        try:
            image_bytes = base64.b64decode(b64 + "==")
        except Exception:
            return self._send_json(400, {"ok": False, "error": "Datos de imagen inválidos"})
        if len(image_bytes) > MAX_PHOTO_BYTES:
            return self._send_json(413, {"ok": False, "error": "Imagen demasiado grande (máx 15 MB)"})
        ext = {"image/jpeg": ".jpg", "image/png": ".png",
               "image/webp": ".webp", "image/gif": ".gif"}.get(mime, ".jpg")
        try:
            os.makedirs(EVIDENCE_DIR, exist_ok=True)
            with open(os.path.join(EVIDENCE_DIR, compound_id + ext), "wb") as f:
                f.write(image_bytes)
            with open(os.path.join(EVIDENCE_DIR, compound_id + ".meta"), "w", encoding="utf-8") as f:
                f.write(mime)
        except OSError as exc:
            print(f"[EVIDENCE] Error guardando {compound_id}: {exc}")
            return self._send_json(500, {"ok": False, "error": "Error guardando imagen"})
        return self._send_json(200, {"ok": True})

    def _api_evidence_get(self, compound_id, user):
        """GET /api/evidence/{compound_id} — recupera imagen; usa R2 si configurado."""
        if _r2 is not None and _r2.is_configured():
            data_uri = _r2.get_image(compound_id)
            if data_uri:
                return self._send_json(200, {"ok": True, "data": data_uri})
            return self._send_json(404, {"ok": False, "error": "Imagen no encontrada"})

        # Fallback: filesystem
        img_path = None
        mime = "image/jpeg"
        for ext in (".jpg", ".png", ".webp", ".gif"):
            candidate = os.path.join(EVIDENCE_DIR, compound_id + ext)
            if os.path.isfile(candidate):
                img_path = candidate
                meta = os.path.join(EVIDENCE_DIR, compound_id + ".meta")
                if os.path.isfile(meta):
                    with open(meta, "r", encoding="utf-8") as f:
                        mime = f.read().strip()
                break
        if not img_path:
            return self._send_json(404, {"ok": False, "error": "Imagen no encontrada"})
        try:
            with open(img_path, "rb") as f:
                image_bytes = f.read()
        except OSError:
            return self._send_json(500, {"ok": False, "error": "Error leyendo imagen"})
        data_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
        return self._send_json(200, {"ok": True, "data": data_url})

    def _api_evidence_batch_get(self, user):
        """POST /api/evidence-batch — devuelve múltiples imágenes en una sola request.
        Body: {ids: ["compound_id_1", ...]}  (máx 500)
        Response: {ok:true, results: {"id": "data:...", ...}}  (null si no existe)
        """
        data = self._read_json_body()
        ids = data.get("ids", []) if isinstance(data, dict) else []
        if not isinstance(ids, list) or len(ids) > 500:
            return self._send_json(400, {"ok": False, "error": "ids debe ser array ≤500"})
        results = {}
        use_r2 = _r2 is not None and _r2.is_configured()
        for raw_id in ids:
            if not isinstance(raw_id, str) or not re.match(r'^[a-zA-Z0-9_-]{1,300}$', raw_id):
                results[raw_id] = None
                continue
            if use_r2:
                results[raw_id] = _r2.get_image(raw_id)
                continue
            # Fallback: filesystem
            img_path = None
            mime = "image/jpeg"
            for ext in (".jpg", ".png", ".webp", ".gif"):
                candidate = os.path.join(EVIDENCE_DIR, raw_id + ext)
                if os.path.isfile(candidate):
                    img_path = candidate
                    meta = os.path.join(EVIDENCE_DIR, raw_id + ".meta")
                    if os.path.isfile(meta):
                        with open(meta, "r", encoding="utf-8") as f:
                            mime = f.read().strip()
                    break
            if not img_path:
                results[raw_id] = None
                continue
            try:
                with open(img_path, "rb") as f:
                    image_bytes = f.read()
                results[raw_id] = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
            except OSError:
                results[raw_id] = None
        return self._send_json(200, {"ok": True, "results": results})

    def _api_notify_desvios(self, user):
        """POST /api/notify-desvios — envía email con desvíos seleccionados.
        Body: {desvios:[{tcId,tcName,step,description,dictamen,observacion}],
               recipients:["email"],projectName:"...",executor:"..."}
        No-op silencioso si RESEND_API_KEY no está configurada.
        """
        import datetime as _dt
        data = self._read_json_body()
        if not isinstance(data, dict):
            return self._send_json(400, {"ok": False, "error": "Body inválido"})

        desvios      = data.get("desvios", [])[:50]
        recipients   = [r for r in data.get("recipients", [])[:10] if r and "@" in r]
        project_name = str(data.get("projectName", ""))[:200]
        executor     = str(data.get("executor", ""))[:100]

        if not desvios:
            return self._send_json(400, {"ok": False, "error": "Sin desvíos seleccionados"})

        now_str = _dt.datetime.now().strftime("%Y-%m-%d %H:%M")

        rows_html = ""
        for d in desvios:
            dictamen = str(d.get("dictamen", "")).upper()
            color    = "#dc2626" if "NO PASA" in dictamen or "FAIL" in dictamen else "#d97706"
            rows_html += (
                f"<tr>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #eee;font-weight:700;'>{_html_mod.escape(str(d.get('tcId',''))[:60])}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #eee;'>{_html_mod.escape(str(d.get('tcName',''))[:120])}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #eee;text-align:center;'>Paso {_html_mod.escape(str(d.get('step',''))[:10])}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #eee;'>"
                f"<span style='background:{color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:700;'>{_html_mod.escape(dictamen[:30])}</span></td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #eee;'>{_html_mod.escape(str(d.get('description',''))[:200])}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #eee;color:#666;'>{_html_mod.escape(str(d.get('observacion',''))[:300])}</td>"
                f"</tr>"
            )

        body = (
            f"<p>Proyecto: <strong>{_html_mod.escape(project_name)}</strong><br>"
            f"Ejecutor: {_html_mod.escape(executor)}<br>"
            f"Fecha: {now_str}</p>"
            f"<table style='width:100%;border-collapse:collapse;font-size:13px;'>"
            f"<thead><tr style='background:#f0f4f9;'>"
            f"<th style='padding:8px 12px;text-align:left;'>TC ID</th>"
            f"<th style='padding:8px 12px;text-align:left;'>Nombre</th>"
            f"<th style='padding:8px 12px;text-align:left;'>Paso</th>"
            f"<th style='padding:8px 12px;text-align:center;'>Resultado</th>"
            f"<th style='padding:8px 12px;text-align:left;'>Descripción</th>"
            f"<th style='padding:8px 12px;text-align:left;'>Observación</th>"
            f"</tr></thead>"
            f"<tbody>{rows_html}</tbody></table>"
        )

        sent = 0
        if _RESEND_API_KEY and recipients:
            subject = f"[SMART Validation] Desvíos detectados — {project_name}"
            for email in recipients:
                _send_email(email, subject, _email_html(f"Desvíos de ejecución — {project_name}", body))
                sent += 1

        warn = "" if sent else ("RESEND_API_KEY no configurada — reporte no enviado por email" if not _RESEND_API_KEY else "Sin destinatarios válidos")
        return self._send_json(200, {"ok": True, "sent": sent, "warn": warn})

    def _api_evidence_batch_upload(self, user):
        """POST /api/evidence-batch-upload — sube múltiples imágenes en una sola request.
        Body: {images: {"compound_id": "data:...", ...}}  (máx 100)
        Útil para el bulk-sync inicial desde IndexedDB.
        """
        data = self._read_json_body()
        images = data.get("images", {}) if isinstance(data, dict) else {}
        if not isinstance(images, dict) or len(images) > 100:
            return self._send_json(400, {"ok": False, "error": "images debe ser objeto ≤100 entradas"})
        saved = 0
        for compound_id, data_url in images.items():
            if not isinstance(compound_id, str) or not re.match(r'^[a-zA-Z0-9_-]{1,300}$', compound_id):
                continue
            if not isinstance(data_url, str) or not data_url.startswith("data:"):
                continue
            try:
                header, b64 = data_url.split(",", 1)
                mime = header.split(";")[0].replace("data:", "") or "image/jpeg"
                image_bytes = base64.b64decode(b64)
            except Exception:
                continue
            if len(image_bytes) > 20 * 1024 * 1024:
                continue
            ext = {"image/jpeg": ".jpg", "image/png": ".png",
                   "image/webp": ".webp", "image/gif": ".gif"}.get(mime, ".jpg")
            try:
                with open(os.path.join(EVIDENCE_DIR, compound_id + ext), "wb") as f:
                    f.write(image_bytes)
                with open(os.path.join(EVIDENCE_DIR, compound_id + ".meta"), "w", encoding="utf-8") as f:
                    f.write(mime)
                saved += 1
            except OSError:
                continue
        return self._send_json(200, {"ok": True, "saved": saved})

    def _proxy_analytics(self, subpath, user):
        """Proxy /api/analytics/* → analytics FastAPI service en 127.0.0.1:8765.
        Permite usar el motor de analytics desde Railway (HTTPS) sin exponer el puerto 8765."""
        import http.client as _http_client
        # Leer body raw (no parsear JSON — lo forwarda intacto)
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (ValueError, TypeError):
            length = 0
        raw_body = None
        if length > 0:
            try:
                self.connection.settimeout(30)
                raw_body = self.rfile.read(min(length, MAX_SESSION_BYTES))
            except Exception:
                return self._send_json(408, {"ok": False, "error": "Timeout leyendo request"})
            finally:
                try:
                    self.connection.settimeout(None)
                except Exception:
                    pass
        target = subpath or "/"
        qs = urlparse(self.path).query
        if qs:
            target += "?" + qs
        try:
            conn = _http_client.HTTPConnection("127.0.0.1", 8765, timeout=120)
            fwd_headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
            conn.request(self.command, target, body=raw_body, headers=fwd_headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.getheader("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", _ALLOWED_ORIGIN)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self._send_json(503, {"ok": False, "error": "Motor de analytics no disponible. Intentá en unos segundos."})

    def _assert_project_access(self, db, user, proj_id) -> bool:
        """Retorna True si admin/auditor o si el cliente tiene acceso. Envía 403 si no.
        VULN-12: valida formato de ID antes de consultar la DB (previene timing oracle)."""
        if not _is_valid_proj_id(proj_id):
            self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
            return False
        if user.get("r") in ("admin", "auditor"):
            return True
        username = user.get("u", "")
        # Chequear is_active antes de cualquier acceso
        active_row = db.execute(
            "SELECT is_active FROM users WHERE username=?", (username,)
        ).fetchone()
        if not active_row or not active_row["is_active"]:
            self._send_json(403, {"ok": False, "error": "Usuario inactivo. Contactá al administrador."})
            return False
        row = db.execute("""
            SELECT 1 FROM project_access pa
            INNER JOIN users u ON u.id = pa.user_id
            WHERE u.username=? AND pa.project_id=?
        """, (username, proj_id)).fetchone()
        if row:
            return True
        self._send_json(403, {"ok": False, "error": "Acceso denegado"})
        return False

    def _api_docs_list(self, proj_id, user):
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        rows = db.execute(
            "SELECT id, doc_type, version, status, created_at, updated_at "
            "FROM documents WHERE project_id=? ORDER BY updated_at DESC",
            (proj_id,)
        ).fetchall()
        return self._send_json(200, {"ok": True, "documents": [dict(r) for r in rows]})

    def _api_coherence_pack(self, proj_id, user):
        """
        GET /api/projects/{id}/coherence-pack[?for=IOQ]
        Lee todos los documentos del proyecto, llama al analytics service
        y devuelve el Context Pack de coherencia listo para inyectar en
        el prompt de generación del siguiente documento.
        """
        import urllib.parse as _up
        import urllib.request as _ur

        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return

        qs = _up.parse_qs(_up.urlparse(self.path).query)
        generating_for = (qs.get('for', [''])[0] or '').upper()

        # Leer todos los documentos CON su json_data
        rows = db.execute(
            "SELECT doc_type, json_data FROM documents WHERE project_id=?",
            (proj_id,)
        ).fetchall()

        documents = {}
        for row in rows:
            try:
                documents[row['doc_type']] = json.loads(row['json_data'])
            except Exception:
                pass

        if not documents:
            return self._send_json(200, {
                "ok": True,
                "projectId": proj_id,
                "generatingFor": generating_for,
                "idInventory": {},
                "validReferenceIds": {"allUrsIds": [], "allRaIds": [], "allFrsIds": []},
                "coverage": {},
                "sequenceGaps": [],
                "referenceErrors": [],
                "isClean": True,
                "note": "No hay documentos en este proyecto aún.",
            })

        analytics_url = "http://127.0.0.1:8765/coherence-pack"
        payload = json.dumps({
            "projectId": proj_id,
            "documents": documents,
            "generatingFor": generating_for,
        }).encode()

        try:
            req = _ur.Request(analytics_url, data=payload,
                              headers={"Content-Type": "application/json"}, method="POST")
            with _ur.urlopen(req, timeout=10) as resp:
                pack = json.loads(resp.read())
            pack["ok"] = True
            return self._send_json(200, pack)
        except Exception as e:
            return self._send_json(503, {
                "ok": False,
                "error": f"Motor de analytics no disponible: {e}. "
                         "Asegurate de que el servicio de analytics esté corriendo (puerto 8765).",
            })

    def _api_doc_get(self, proj_id, doc_type, user):
        if not _is_valid_doc_type(doc_type):
            return self._send_json(400, {"ok": False, "error": "doc_type inválido"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        row = db.execute(
            "SELECT * FROM documents WHERE project_id=? AND doc_type=?",
            (proj_id, doc_type)
        ).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Documento no encontrado"})
        d = dict(row)
        try:
            d["content"] = json.loads(d["json_data"])
        except Exception:
            d["content"] = d["json_data"]
        return self._send_json(200, {"ok": True, "document": d})

    def _api_doc_upsert(self, proj_id, doc_type, user):
        if not _is_valid_doc_type(doc_type):
            return self._send_json(400, {"ok": False, "error": "doc_type inválido"})
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin puede crear o modificar documentos"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        data = self._read_json_body()
        if data is None:
            return
        # ADV-03: el status solo puede ser 'draft' o 'needs_revision' vía upsert; el sistema gestiona los demás
        requested_status = str(data.get("status", "draft")).strip()
        if requested_status not in ("draft", "needs_revision"):
            requested_status = "draft"
        content = data.get("content") or data
        content_str = json.dumps(content)
        if len(content_str) > 5 * 1024 * 1024:  # 5 MB max por documento
            return self._send_json(413, {"ok": False, "error": "Contenido del documento demasiado grande (máx 5 MB)"})
        now = time.time()
        # ADV-01: BEGIN IMMEDIATE para hacer atómica la verificación de estado + escritura
        db.execute("BEGIN IMMEDIATE")
        try:
            # NEW-03: los documentos aprobados inician nuevo ciclo (incrementan versión)
            existing = db.execute(
                "SELECT version, status, json_data FROM documents WHERE project_id=? AND doc_type=?",
                (proj_id, doc_type)
            ).fetchone()
            if existing and existing["status"] == "approved":
                new_version = (existing["version"] or 1) + 1
                requested_status = "draft"
            else:
                new_version = existing["version"] if existing else 1
            doc_action = "doc_update" if existing else "doc_create"
            db.execute("""
                INSERT INTO documents
                  (id, project_id, doc_type, version, status, json_data,
                   created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  json_data=excluded.json_data,
                  status=excluded.status,
                  version=excluded.version,
                  updated_at=excluded.updated_at
            """, (
                f"{proj_id}_{doc_type}", proj_id, doc_type,
                new_version, requested_status,
                content_str, user.get("u"), now, now
            ))
            # ALCOA+: audit trail de creación/modificación de documento GxP
            prev_status = existing["status"] if existing else None
            prev_hash = (
                hashlib.sha256(existing["json_data"].encode("utf-8")).hexdigest()[:16]
                if existing and existing["json_data"] else None
            )
            detail = (
                f"{'Creó' if doc_action == 'doc_create' else 'Modificó'} documento '{doc_type}' "
                f"(estado: {requested_status}"
                + (f", estado previo: {prev_status}" if prev_status else "")
                + (f", hash_previo: {prev_hash}" if prev_hash else "")
                + ")"
            )
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (proj_id, doc_type, user.get("u"), doc_action, detail, self._get_client_ip(), now))
            db.execute("COMMIT")
        except Exception as e:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            print(f"[DB] Error al guardar documento {doc_type}: {e}")
            return self._send_json(500, {"ok": False, "error": "Error interno al guardar documento."})

        return self._send_json(200, {"ok": True, "id": f"{proj_id}_{doc_type}"})

    def _api_doc_send_to_firmas(self, proj_id, doc_type, user):
        """Empuja el documento actual hacia la Suite de Revisión y Firmas (bridge, Fase 4).
        Es el único camino de entrada de un documento a Firmas desde la v1 -- funciona igual
        para la primera versión que para un reenvío tras corregir. Mismo control de acceso
        que _api_doc_upsert: solo admin, y solo con acceso al proyecto."""
        if not _is_valid_doc_type(doc_type):
            return self._send_json(400, {"ok": False, "error": "doc_type inválido"})
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Solo admin puede enviar documentos a Firmas"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        result = _bridge_push_document(proj_id, doc_type)
        if not result.get("ok"):
            return self._send_json(result.get("status") or 502, {"ok": False, "error": result.get("error")})
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (proj_id, doc_type, user.get("u"), "sent_to_firmas",
              f"Envió '{doc_type}' a la Suite de Firmas", self._get_client_ip(), time.time()))
        db.commit()
        return self._send_json(200, {"ok": True})

    def _api_doc_firmas_comments(self, proj_id, doc_type, user):
        """Trae los comentarios de revisión de Firmas para este documento (bridge, Fase 4).
        Solo lectura -- no se persisten acá, Firmas sigue siendo la única fuente de verdad."""
        if not _is_valid_doc_type(doc_type):
            return self._send_json(400, {"ok": False, "error": "doc_type inválido"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        result = _bridge_pull_comments(proj_id, doc_type)
        if not result.get("ok"):
            return self._send_json(result.get("status") or 502, {"ok": False, "error": result.get("error")})
        return self._send_json(200, {"ok": True, "comments": result.get("comments", [])})

    def _api_doc_delete(self, proj_id, doc_type, user):
        if not _is_valid_doc_type(doc_type):
            return self._send_json(400, {"ok": False, "error": "doc_type inválido"})
        if user.get("r") not in ("admin",):
            return self._send_json(403, {"ok": False, "error": "Solo admin puede eliminar documentos"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        doc = db.execute(
            "SELECT status FROM documents WHERE project_id=? AND doc_type=?",
            (proj_id, doc_type)
        ).fetchone()
        if not doc:
            return self._send_json(404, {"ok": False, "error": "Documento no encontrado"})
        # ADV-19: DELETE + audit en una sola transacción — si el proceso muere entre ambos el
        # audit no queda huérfano (ALCOA+ Contemporáneo + ANMAT 4159 integridad de registros)
        now = time.time()
        db.execute("BEGIN")
        try:
            db.execute(
                "DELETE FROM documents WHERE project_id=? AND doc_type=?",
                (proj_id, doc_type)
            )
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, 'doc_delete', ?, ?, ?)
            """, (proj_id, doc_type, user.get("u"),
                  f"Eliminó documento '{doc_type}' (estado previo: {doc['status']})",
                  self._get_client_ip(), now))
            db.execute("COMMIT")
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise
        return self._send_json(200, {"ok": True})

    # ── /api/me handlers ─────────────────────────────────────────────────────

    def _api_me_get(self, user):
        resp = {
            "ok": True,
            "username": user.get("u"),
            "display_name": user.get("d"),
            "role": user.get("r", "admin"),
        }
        if user.get("r") == "client":
            db = _get_db()
            row = db.execute(
                "SELECT pin_set FROM users WHERE username=?", (user.get("u"),)
            ).fetchone()
            resp["pin_set"] = bool(row["pin_set"]) if row else False
        return self._send_json(200, resp)

    def _api_me_pin_set(self, user):
        ip = self._get_client_ip()
        if not _rate_limit(_GENERIC_ATTEMPTS, f"pin:{ip}", 5):
            return self._send_json(429, {"ok": False, "error": "Demasiados intentos. Esperá un minuto."})
        if user.get("r") != "client":
            return self._send_json(403, {"ok": False, "error": "Solo usuarios cliente pueden establecer PIN"})
        data = self._read_json_body()
        if data is None:
            return
        pin = str(data.get("pin", "")).strip()
        if not pin or len(pin) < _PIN_MIN_LEN or len(pin) > _PIN_MAX_LEN or not pin.isdigit():
            return self._send_json(400, {"ok": False, "error": f"PIN debe ser {_PIN_MIN_LEN}-{_PIN_MAX_LEN} dígitos numéricos"})
        db = _get_db()
        now_pin = time.time()
        db.execute(
            "UPDATE users SET pin_hash=?, pin_set=1, updated_at=? WHERE username=?",
            (_pbkdf2_hash(pin), now_pin, user.get("u"))
        )
        # ALCOA+: credencial de firma electrónica modificada (21 CFR Part 11 §11.300(d))
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (NULL, NULL, ?, 'pin_set', 'Estableció su PIN de firma', ?, ?)
        """, (user.get("u"), ip, now_pin))
        return self._send_json(200, {"ok": True})

    # ── Admin handlers (role=admin required) ─────────────────────────────────

    def _admin_users_list(self, user):
        db = _get_db()
        # ADV-08: whitelist de roles válidos para evitar consultas con valores arbitrarios
        _raw_role = parse_qs(urlparse(self.path).query).get("role", [None])[0]
        role_filter = _raw_role if _raw_role in ("admin", "auditor", "client") else None
        base_q = """
            SELECT u.id, u.username, u.display_name, u.email, u.role, u.is_active,
                   u.pin_set, u.created_by, u.created_at, u.last_login,
                   u.failed_attempts, u.locked_until,
                   COUNT(pa.project_id) AS project_count
            FROM users u
            LEFT JOIN project_access pa ON pa.user_id = u.id
        """
        if role_filter:
            rows = db.execute(
                base_q + "WHERE u.role=? GROUP BY u.id ORDER BY u.role, u.created_at DESC",
                (role_filter,)
            ).fetchall()
        else:
            rows = db.execute(
                base_q + "GROUP BY u.id ORDER BY u.role, u.created_at DESC"
            ).fetchall()
        return self._send_json(200, {"ok": True, "users": [dict(r) for r in rows]})

    def _admin_user_get(self, user_id, user):
        # NEW-05: validar UUID para prevenir timing oracle y errores de DB
        if not _is_valid_uuid(user_id):
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        db = _get_db()
        row = db.execute(
            "SELECT id, username, display_name, email, role, is_active, pin_set, "
            "created_by, created_at, updated_at, last_login FROM users WHERE id=?", (user_id,)
        ).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        access = db.execute("""
            SELECT pa.project_id, pa.access_level, pa.granted_at, p.name AS project_name
            FROM project_access pa
            LEFT JOIN projects p ON p.id = pa.project_id
            WHERE pa.user_id = ? ORDER BY pa.granted_at DESC
        """, (user_id,)).fetchall()
        result = dict(row)
        result["access"] = [dict(a) for a in access]
        return self._send_json(200, {"ok": True, "user": result})

    def _admin_user_create(self, user):
        if not _is_superadmin(user):
            return self._send_json(403, {"ok": False, "error": "Solo el superadministrador puede crear usuarios."})
        data = self._read_json_body()
        if data is None:
            return
        username     = str(data.get("username", "")).strip().lower()
        display_name = str(data.get("display_name", "")).strip() or username
        email        = str(data.get("email", "")).strip().lower() or None
        role         = str(data.get("role", "client")).strip()
        password     = str(data.get("password", "")).strip()
        pin          = str(data.get("pin", "")).strip()

        if not username:
            return self._send_json(400, {"ok": False, "error": "username requerido"})
        if len(username) > _MAX_USERNAME_LEN:
            return self._send_json(400, {"ok": False, "error": f"username demasiado largo (máx {_MAX_USERNAME_LEN})"})
        if len(display_name) > _MAX_DISPLAYNAME_LEN:
            return self._send_json(400, {"ok": False, "error": f"display_name demasiado largo (máx {_MAX_DISPLAYNAME_LEN})"})
        if email and len(email) > _MAX_EMAIL_LEN:
            return self._send_json(400, {"ok": False, "error": f"email demasiado largo (máx {_MAX_EMAIL_LEN})"})
        if role not in ("admin", "auditor", "client"):
            return self._send_json(400, {"ok": False, "error": "role debe ser admin, auditor o client"})
        if email and "@" not in email:
            return self._send_json(400, {"ok": False, "error": "email inválido"})

        password_hash = None
        pin_hash      = None

        if role == "client":
            if pin:
                if len(pin) < _PIN_MIN_LEN or len(pin) > _PIN_MAX_LEN or not pin.isdigit():
                    return self._send_json(400, {"ok": False, "error": f"PIN debe ser {_PIN_MIN_LEN}-{_PIN_MAX_LEN} dígitos numéricos"})
                pin_hash = _pbkdf2_hash(pin)
        else:
            if not password:
                return self._send_json(400, {"ok": False, "error": "password requerido para admin/auditor"})
            if len(password) < 8:
                return self._send_json(400, {"ok": False, "error": "password debe tener al menos 8 caracteres"})
            if len(password) > 256:
                return self._send_json(400, {"ok": False, "error": "password demasiado largo"})
            password_hash = _pbkdf2_hash(password)

        user_id = str(uuid.uuid4())
        now     = time.time()
        db      = _get_db()
        try:
            db.execute(
                "INSERT INTO users "
                "(id, username, display_name, email, password_hash, pin_hash, pin_set, role, "
                "is_active, must_change_password, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, 1, ?, ?, ?)",
                (user_id, username, display_name, email, password_hash, pin_hash,
                 role, user.get("u"), now, now)
            )
        except Exception as e:
            if "UNIQUE" in str(e).upper():
                return self._send_json(409, {"ok": False, "error": f"Usuario '{username}' ya existe"})
            print(f"[DB] Error al crear usuario: {e}")
            return self._send_json(500, {"ok": False, "error": "Error interno al crear usuario."})
        # NEW-11: audit trail para creación de usuario
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (NULL, NULL, ?, 'admin_user_create', ?, ?, ?)
        """, (user.get("u"), f"Creó usuario '{username}' con rol '{role}'",
              self._get_client_ip(), now))
        _send_security_alert(
            f"Nuevo usuario creado: {username}",
            f"<p><strong>{_html_mod.escape(user.get('d', user.get('u', '?')))}</strong> creó el usuario "
            f"<strong>{_html_mod.escape(username)}</strong> con rol <strong>{_html_mod.escape(role)}</strong>.</p>"
            f"<p>IP: <code>{_html_mod.escape(self._get_client_ip())}</code></p>"
        )
        return self._send_json(201, {"ok": True, "id": user_id, "username": username, "role": role})

    def _admin_user_update(self, user_id, admin_user):
        if not _is_superadmin(admin_user):
            return self._send_json(403, {"ok": False, "error": "Solo el superadministrador puede modificar usuarios."})
        if not _is_valid_uuid(user_id):
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        data = self._read_json_body()
        if data is None:
            return
        db = _get_db()
        # BEGIN IMMEDIATE: los checks de "último admin" y el UPDATE deben ser atómicos.
        # Sin esto, dos PATCH concurrentes pueden degradar ambos admins simultáneamente (TOCTOU).
        db.execute("BEGIN IMMEDIATE")
        try:
            row = db.execute("SELECT id, username, role, display_name, email, is_active FROM users WHERE id=?", (user_id,)).fetchone()
            if not row:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
            if row["username"] == _PROTECTED_USERNAME and (
                "role" in data or "is_active" in data
            ):
                db.execute("ROLLBACK")
                return self._send_json(403, {
                    "ok": False,
                    "error": "El rol y el estado del superusuario del sistema no pueden modificarse."
                })
            fields, vals = [], []
            audit_details = []
            if "display_name" in data:
                new_dn = str(data["display_name"]).strip()
                if len(new_dn) > _MAX_DISPLAYNAME_LEN:
                    db.execute("ROLLBACK")
                    return self._send_json(400, {"ok": False, "error": f"display_name excede {_MAX_DISPLAYNAME_LEN} caracteres"})
                fields.append("display_name=?"); vals.append(new_dn)
                audit_details.append(f"display_name: '{row['display_name'] or ''}' → '{new_dn}'")
            if "email" in data:
                em = str(data["email"]).strip().lower() or None
                if em and "@" not in em:
                    db.execute("ROLLBACK")
                    return self._send_json(400, {"ok": False, "error": "email inválido"})
                if em and len(em) > _MAX_EMAIL_LEN:
                    db.execute("ROLLBACK")
                    return self._send_json(400, {"ok": False, "error": f"email excede {_MAX_EMAIL_LEN} caracteres"})
                fields.append("email=?"); vals.append(em)
                audit_details.append(f"email: '{row['email'] or ''}' → '{em or ''}'")
            if "role" in data:
                r = str(data["role"]).strip()
                if r not in ("admin", "auditor", "client"):
                    db.execute("ROLLBACK")
                    return self._send_json(400, {"ok": False, "error": "role inválido"})
                # ADV-18: proteger al último admin de ser degradado a otro rol
                if row["role"] == "admin" and r != "admin":
                    admin_count = db.execute(
                        "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND is_active=1"
                    ).fetchone()["n"]
                    if admin_count <= 1:
                        db.execute("ROLLBACK")
                        return self._send_json(400, {
                            "ok": False,
                            "error": "No se puede cambiar el rol del último administrador activo."
                        })
                fields.append("role=?"); vals.append(r)
                if r != row["role"]:
                    audit_details.append(f"rol: {row['role']} → {r}")
            if "is_active" in data:
                new_active = 1 if data["is_active"] else 0
                # ADV-18: no desactivar al último admin
                if row["role"] == "admin" and not new_active:
                    admin_count = db.execute(
                        "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND is_active=1"
                    ).fetchone()["n"]
                    if admin_count <= 1:
                        db.execute("ROLLBACK")
                        return self._send_json(400, {
                            "ok": False,
                            "error": "No se puede desactivar el último administrador activo."
                        })
                fields.append("is_active=?"); vals.append(new_active)
                audit_details.append(f"is_active: {'activo' if row['is_active'] else 'inactivo'} → {'activo' if new_active else 'inactivo'}")
            if not fields:
                db.execute("ROLLBACK")
                return self._send_json(400, {"ok": False, "error": "Nada que actualizar"})
            now = time.time()
            fields.append("updated_at=?"); vals.append(now)
            vals.append(user_id)
            db.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=?", vals)
            # ALCOA+: toda modificación de usuario queda registrada (display_name, email, role, is_active)
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (NULL, NULL, ?, 'admin_user_update', ?, ?, ?)
            """, (admin_user.get("u"),
                  f"Actualizó usuario '{row['username']}': {', '.join(audit_details)}",
                  self._get_client_ip(), now))
            db.execute("COMMIT")
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise
        return self._send_json(200, {"ok": True})

    def _admin_user_delete(self, user_id, admin_user):
        if not _is_superadmin(admin_user):
            return self._send_json(403, {"ok": False, "error": "Solo el superadministrador puede eliminar usuarios."})
        if not _is_valid_uuid(user_id):
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        db = _get_db()
        # BEGIN IMMEDIATE: el check de "último admin" y el DELETE deben ser atómicos (TOCTOU).
        db.execute("BEGIN IMMEDIATE")
        try:
            target = db.execute("SELECT id, username, role FROM users WHERE id=?", (user_id,)).fetchone()
            if not target:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
            if target["username"] == _PROTECTED_USERNAME:
                db.execute("ROLLBACK")
                return self._send_json(403, {"ok": False, "error": "El superusuario del sistema no puede eliminarse."})
            # NEW-07: comparar correctamente por username (admin_user["u"] es username, no UUID)
            if target["username"] == admin_user.get("u"):
                db.execute("ROLLBACK")
                return self._send_json(400, {"ok": False, "error": "No podés borrar tu propio usuario"})
            # NEW-07: proteger el último admin
            if target["role"] == "admin":
                admin_count = db.execute(
                    "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND is_active=1"
                ).fetchone()["n"]
                if admin_count <= 1:
                    db.execute("ROLLBACK")
                    return self._send_json(400, {"ok": False, "error": "No se puede eliminar el último administrador"})
            now = time.time()
            db.execute("DELETE FROM users WHERE id=?", (user_id,))
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (NULL, NULL, ?, 'admin_user_delete', ?, ?, ?)
            """, (admin_user.get("u"), f"Eliminó usuario '{target['username']}' (rol: {target['role']})",
                  self._get_client_ip(), now))
            db.execute("COMMIT")
            _send_security_alert(
                f"Usuario eliminado: {target['username']}",
                f"<p><strong>{_html_mod.escape(admin_user.get('d', admin_user.get('u', '?')))}</strong> eliminó "
                f"al usuario <strong>{_html_mod.escape(target['username'])}</strong> "
                f"(rol: {_html_mod.escape(target['role'])}).</p>"
                f"<p>IP: <code>{_html_mod.escape(self._get_client_ip())}</code></p>"
            )
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise
        return self._send_json(200, {"ok": True})

    def _admin_user_unlock(self, user_id, admin_user):
        """Desbloquea una cuenta bloqueada por intentos fallidos y resetea el contador."""
        # SEC-FIX-AUTH008: solo superadmin puede desbloquear cuentas
        if not _is_superadmin(admin_user):
            return self._send_json(403, {"ok": False, "error": "Solo el superadministrador puede desbloquear cuentas"})
        if not _is_valid_uuid(user_id):
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        db = _get_db()
        row = db.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        now = time.time()
        db.execute(
            "UPDATE users SET failed_attempts=0, locked_until=NULL, updated_at=? WHERE id=?",
            (now, user_id)
        )
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (NULL, NULL, ?, 'admin_user_unlock', ?, ?, ?)
        """, (admin_user.get("u"), f"Desbloqueó cuenta de '{row['username']}'",
              self._get_client_ip(), now))
        return self._send_json(200, {"ok": True, "username": row["username"]})

    def _admin_user_set_password(self, user_id, admin_user):
        # SEC-FIX-AUTH002: solo superadmin puede cambiar contraseñas (incluida la del superadmin)
        if not _is_superadmin(admin_user):
            return self._send_json(403, {"ok": False, "error": "Solo el superadministrador puede cambiar contraseñas"})
        # NEW-05: validar UUID
        if not _is_valid_uuid(user_id):
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        data = self._read_json_body()
        if data is None:
            return
        password = str(data.get("password", "")).strip()
        if not password or len(password) < 8 or len(password) > 256:
            return self._send_json(400, {"ok": False, "error": "password debe tener 8-256 caracteres"})
        db = _get_db()
        row = db.execute("SELECT username, role FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        if row["role"] == "client":
            return self._send_json(400, {"ok": False, "error": "Los clientes usan PIN, no contraseña"})
        now = time.time()
        db.execute(
            "UPDATE users SET password_hash=?, updated_at=? WHERE id=?",
            (_pbkdf2_hash(password), now, user_id)
        )
        # NEW-11: audit trail para cambio de contraseña por admin (mismo timestamp que el UPDATE)
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (NULL, NULL, ?, 'admin_set_password', ?, ?, ?)
        """, (admin_user.get("u"), f"Cambió contraseña de usuario '{row['username']}'",
              self._get_client_ip(), now))
        return self._send_json(200, {"ok": True})

    def _admin_user_pin_set(self, user_id, admin_user):
        # SEC-FIX-F03: solo superadmin puede resetear PIN de clientes (impersonación en firmas electrónicas)
        if not _is_superadmin(admin_user):
            return self._send_json(403, {"ok": False, "error": "Solo el superadministrador puede resetear PINs"})
        if not _is_valid_uuid(user_id):
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        data = self._read_json_body()
        if data is None:
            return
        pin = str(data.get("pin", "")).strip()
        if not pin or len(pin) < _PIN_MIN_LEN or len(pin) > _PIN_MAX_LEN or not pin.isdigit():
            return self._send_json(400, {"ok": False, "error": f"PIN debe ser {_PIN_MIN_LEN}-{_PIN_MAX_LEN} dígitos numéricos"})
        db = _get_db()
        row = db.execute("SELECT username, role FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        if row["role"] != "client":
            return self._send_json(400, {"ok": False, "error": "Solo usuarios cliente usan PIN"})
        now_pr = time.time()
        db.execute(
            "UPDATE users SET pin_hash=?, pin_set=0, updated_at=? WHERE id=?",
            (_pbkdf2_hash(pin), now_pr, user_id)
        )
        # ALCOA+: credencial de firma electrónica resetada por admin (21 CFR Part 11 §11.300(d))
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (NULL, NULL, ?, 'admin_pin_reset', ?, ?, ?)
        """, (admin_user.get("u"),
              f"Reseteó PIN del usuario '{row['username']}'",
              self._get_client_ip(), now_pr))
        return self._send_json(200, {"ok": True})

    def _admin_access_grant(self, user_id, user):
        # NEW-05: validar UUID
        if not _is_valid_uuid(user_id):
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        data = self._read_json_body()
        if data is None:
            return
        project_id   = str(data.get("project_id", "")).strip()
        access_level = str(data.get("access_level", "read")).strip()
        if not project_id or not _is_valid_proj_id(project_id):
            return self._send_json(400, {"ok": False, "error": "project_id requerido o inválido"})
        if access_level not in ("read", "sign"):
            return self._send_json(400, {"ok": False, "error": "access_level debe ser 'read' o 'sign'"})
        db = _get_db()
        target = db.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
        if not target:
            return self._send_json(404, {"ok": False, "error": "Usuario no encontrado"})
        proj = db.execute("SELECT name FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
        now = time.time()
        db.execute("""
            INSERT INTO project_access
              (user_id, project_id, access_level, granted_by, granted_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, project_id) DO UPDATE SET
              access_level=excluded.access_level,
              granted_by=excluded.granted_by,
              granted_at=excluded.granted_at
        """, (user_id, project_id, access_level, user.get("u"), now))
        # NEW-11: audit trail para otorgamiento de acceso
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (?, NULL, ?, 'admin_access_grant', ?, ?, ?)
        """, (project_id, user.get("u"),
              f"Otorgó acceso '{access_level}' a '{target['username']}' en proyecto '{proj['name']}'",
              self._get_client_ip(), now))
        return self._send_json(200, {"ok": True})

    def _admin_access_revoke(self, user_id, project_id, user):
        # NEW-05: validar formato de IDs
        if not _is_valid_uuid(user_id) or not _is_valid_proj_id(project_id):
            return self._send_json(404, {"ok": False, "error": "Recurso no encontrado"})
        db = _get_db()
        target = db.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
        proj = db.execute("SELECT name FROM projects WHERE id=?", (project_id,)).fetchone()
        db.execute(
            "DELETE FROM project_access WHERE user_id=? AND project_id=?",
            (user_id, project_id)
        )
        # NEW-11: audit trail para revocación de acceso
        target_name = target["username"] if target else user_id
        proj_name = proj["name"] if proj else project_id
        db.execute("""
            INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (?, NULL, ?, 'admin_access_revoke', ?, ?, ?)
        """, (project_id, user.get("u"),
              f"Revocó acceso de '{target_name}' en proyecto '{proj_name}'",
              self._get_client_ip(), time.time()))
        return self._send_json(200, {"ok": True})

    # ── Fotos persistidas en filesystem ──────────────────────────────────────

    def _api_photos_list(self, proj_id, user):
        """Lista fotos persistidas de un proyecto (sin campo image, solo metadata)."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        photos_dir = os.path.join(DATA_DIR, "photos", os.path.basename(proj_id))
        if not os.path.isdir(photos_dir):
            return self._send_json(200, {"ok": True, "photos": []})
        photos = []
        for fname in sorted(os.listdir(photos_dir)):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(photos_dir, fname), "r", encoding="utf-8") as f:
                    p = json.load(f)
                photos.append({k: v for k, v in p.items() if k != "image"})
            except Exception as _photo_err:
                print(f"[Photo] Archivo corrupto ignorado ({fname}): {_photo_err}")
                continue
        return self._send_json(200, {"ok": True, "photos": photos})

    def _api_photo_get(self, proj_id, photo_id, user):
        """Devuelve una foto completa (incluyendo imagen base64)."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        safe_id = _safe_filename(photo_id, "unknown_photo")
        fpath = os.path.join(DATA_DIR, "photos", os.path.basename(proj_id),
                             f"{safe_id}.json")
        if not os.path.isfile(fpath):
            return self._send_json(404, {"ok": False, "error": "Foto no encontrada"})
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                photo = json.load(f)
            return self._send_json(200, {"ok": True, "photo": photo})
        except Exception as e:
            print(f"[IO] Error al leer foto: {e}")
            return self._send_json(500, {"ok": False, "error": "Error al acceder al recurso."})

    # ── Firma server-side con PIN ─────────────────────────────────────────────

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (ValueError, TypeError):
            length = 0
        # NEW-10: Content-Length negativo causaría rfile.read(-1) que bloquea el thread leyendo hasta EOF
        if length < 0:
            self._send_json(400, {"error": "Content-Length inválido"})
            return None
        if length > MAX_SESSION_BYTES:
            self._send_json(413, {"error": "Payload demasiado grande"})
            return None
        # ALTA-2: timeout en lectura para prevenir slowloris (cliente lento bloquea el thread)
        try:
            self.connection.settimeout(30)
            raw = self.rfile.read(length)
        except (OSError, Exception):
            self._send_json(408, {"error": "Timeout leyendo request"})
            return None
        finally:
            try:
                self.connection.settimeout(None)
            except Exception:
                pass
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "JSON inválido"})
            return None

    def _serve_static(self):
        """Sirve archivos estaticos desde ROOT_DIR (default index.html)."""
        path = urlparse(self.path).path
        if path in ("/", ""):
            path = "/index.html"
        elif path.endswith("/") and path != "/":
            # Subdirectorio: intentar servir su index.html (ej. /captura/ → /captura/index.html)
            path = path + "index.html"
        elif path in ("/client", "/client/") or path == "/firmas" or path.startswith("/firmas/"):
            # Portales viejos eliminados (2026-09-02: el estático /firmas/ y, antes, /client/)
            # — redirigen a la Suite de Revisión y Firmas real (servicio separado).
            self.send_response(302)
            self.send_header("Location", _FIRMAS_BASE_URL or "/")
            self.end_headers()
            return

        # Sanitizar path — pathlib.resolve() resuelve ../ y symlinks
        # antes de comparar contra ROOT_DIR (inmune a encoding alternativo)
        try:
            import pathlib
            root_resolved = pathlib.Path(ROOT_DIR).resolve()
            full_path_obj = (root_resolved / path.lstrip("/")).resolve()
            # Verificar que el path resuelto siga dentro de ROOT_DIR
            full_path_obj.relative_to(root_resolved)  # lanza ValueError si sale
            full_path = str(full_path_obj)
        except (ValueError, Exception):
            self.send_response(403)
            _add_sec_headers(self)
            self.end_headers()
            return

        # Bloquear extensiones peligrosas aunque estén dentro de ROOT_DIR
        _BLOCKED_EXTS = {".env", ".py", ".pyc", ".db", ".sqlite", ".key", ".pem"}
        if pathlib.Path(full_path).suffix.lower() in _BLOCKED_EXTS:
            self.send_response(403)
            _add_sec_headers(self)
            self.end_headers()
            return

        # Allowlist de extensiones para archivos estáticos.
        # Cualquier extensión fuera de esta lista (incluyendo .bat, .toml, .yml,
        # .txt, .sh, requirements.txt, etc.) recibe 403 en lugar de servirse.
        _STATIC_ALLOWED = {
            ".html": "text/html; charset=utf-8",
            ".css":  "text/css; charset=utf-8",
            ".js":   "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png":  "image/png",
            ".jpg":  "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif":  "image/gif",
            ".svg":  "image/svg+xml",
            ".ico":  "image/x-icon",
            ".woff": "font/woff",
            ".woff2":"font/woff2",
            ".ttf":  "font/ttf",
        }

        ext = os.path.splitext(full_path)[1].lower()

        if not os.path.isfile(full_path):
            _404_body = (
                '<!DOCTYPE html><html lang="es"><head>'
                '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                '<title>Página no encontrada</title>'
                '<style>*{box-sizing:border-box;margin:0;padding:0}'
                'body{font-family:system-ui,sans-serif;background:#0b1621;color:#dde6f0;'
                'display:flex;align-items:center;justify-content:center;min-height:100vh}'
                '.card{text-align:center;padding:48px 32px}'
                'h1{font-size:64px;font-weight:800;color:#1e3550;margin-bottom:8px}'
                'p{color:#5a7a96;margin-bottom:28px}'
                'a{color:#27a459;text-decoration:none;font-weight:600}'
                'a:hover{text-decoration:underline}</style></head>'
                '<body><div class="card">'
                '<h1>404</h1><p>La página que buscás no existe.</p>'
                '<a href="/">Volver al inicio</a>'
                '</div></body></html>'
            ).encode("utf-8")
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(_404_body)))
            _add_sec_headers(self, html=True)
            self.end_headers()
            self.wfile.write(_404_body)
            return

        if ext not in _STATIC_ALLOWED:
            self.send_response(403)
            _add_sec_headers(self)
            self.end_headers()
            return

        ctype = _STATIC_ALLOWED[ext]

        with open(full_path, "rb") as f:
            data = f.read()

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        _is_captura_html = path.startswith("/captura/") and ext == ".html"
        _add_sec_headers(self, html=(ext == ".html"), allow_camera=_is_captura_html)
        self.end_headers()
        self.wfile.write(data)

    # ---------- HTTP methods ----------

    def do_OPTIONS(self):
        if self._anti_scanner():
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", _ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if _ALLOWED_ORIGIN != "*":
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        if self._anti_scanner():
            return
        path = urlparse(self.path).path

        # ── Rutas públicas (sin autenticación) ───────────────────────────────
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        # Assets estáticos — no contienen datos sensibles; la seguridad está
        # en los endpoints /api/ y /auth/. Servirlos sin DB evita pool exhaustion
        # cuando el browser lanza ~70 requests simultáneos al cargar la página.
        _STATIC_PREFIXES = ("/js/", "/css/", "/lib/", "/img/", "/fonts/")
        if any(path.startswith(p) for p in _STATIC_PREFIXES):
            return self._serve_static()

        if path == "/health":
            try:
                _get_db().execute("SELECT 1").fetchone()
                db_ok = True
            except Exception:
                db_ok = False
            status  = "ok" if db_ok else "db_error"
            code    = 200  if db_ok else 503
            return self._send_json(code, {"status": status, "service": "smart-validation"})

        if path == "/api/config":
            # Config pública no sensible -- el frontend la usa para armar el link real a la
            # Suite de Revisión y Firmas (antes apuntaba al portal estático viejo /firmas/).
            return self._send_json(200, {"ok": True, "firmas_url": _FIRMAS_BASE_URL})

        if path in ("/login", "/login.html"):
            if _is_auth_required():
                _u = _check_auth(self)
                # Sesión superseded → NO redirigir a /, mostrar login igual
                if _u and not _u.get("__superseded"):
                    self.send_response(302)
                    self.send_header("Location", "/")
                    self.end_headers()
                    return
            return self._serve_login_page()

        # Página pública — accesible sin auth (sesión expirada o superseded)
        if path == "/session-ended.html":
            return self._serve_static()

        if path == "/auth/session":
            user = _check_auth(self)
            if not user:
                return self._send_json(401, {"ok": False, "error": "No autenticado"})
            if user.get("__superseded"):
                return self._send_json(401, {"ok": False, "error": "Sesión reemplazada", "code": "SUPERSEDED"})
            resp = {
                "ok": True,
                "username": user["u"],
                "displayName": user["d"],
                "role": user.get("r", "admin"),
            }
            if user.get("r") == "client":
                db = _get_db()
                row = db.execute(
                    "SELECT pin_set FROM users WHERE username=?", (user["u"],)
                ).fetchone()
                resp["pin_set"] = bool(row["pin_set"]) if row else False
            return self._send_json(200, resp)

        # Mobile sync - sin cookie (usan token propio en la URL)
        # C-4: en prod requiere SYNC_ENABLED=true + PUBLIC_URL en el entorno
        if path.startswith("/sync/"):
            if not _SYNC_ENABLED:
                return self._send_json(403, {"ok": False, "error": "Sync no habilitado. Setear SYNC_ENABLED=true y PUBLIC_URL."})

        # /sync/info se mueve después del auth (SEC-FIX-SEC01)

        if path.startswith("/sync/session/"):
            token = path[len("/sync/session/"):]
            cleanup_expired_sessions()
            sess = SESSIONS.get(token)
            if not sess:
                # Fallback a DB (sobrevive reinicios del servidor)
                try:
                    db = _get_db()
                    row = db.execute(
                        "SELECT session_data, project_id, created_at FROM sync_sessions WHERE token=? AND expires_at>?",
                        (token, time.time())
                    ).fetchone()
                    if row:
                        SESSIONS[token] = {
                            "session_data": json.loads(row["session_data"]),
                            "project_id": row["project_id"] or "",
                            "photos": [],
                            "created_at": row["created_at"],
                            "created_by": "restored",
                        }
                        sess = SESSIONS[token]
                except Exception:
                    pass
            if not sess:
                return self._send_json(404, {"error": "Sesion no encontrada o expirada"})
            return self._send_json(200, {
                "token": token,
                "session_data": sess["session_data"],
                "photos_count": len(sess.get("photos", [])),
                "created_at": sess["created_at"],
            })

        if path.startswith("/sync/photos/"):
            token = path[len("/sync/photos/"):]
            qs = parse_qs(urlparse(self.path).query)
            # NEW-16: validar que since sea numérico; float("abc") crashearía el thread
            try:
                since = float(qs.get("since", ["0"])[0])
            except (ValueError, TypeError):
                since = 0.0
            sess = SESSIONS.get(token)
            if not sess:
                # Fallback a DB (sobrevive reinicios del servidor)
                try:
                    db = _get_db()
                    row = db.execute(
                        "SELECT session_data, project_id, created_at FROM sync_sessions WHERE token=? AND expires_at>?",
                        (token, time.time())
                    ).fetchone()
                    if row:
                        SESSIONS[token] = {
                            "session_data": json.loads(row["session_data"]),
                            "project_id": row["project_id"] or "",
                            "photos": [],
                            "created_at": row["created_at"],
                            "created_by": "restored",
                        }
                        sess = SESSIONS[token]
                except Exception:
                    pass
            if not sess:
                return self._send_json(404, {"error": "Sesion no encontrada"})
            new_photos = [p for p in sess["photos"] if p["uploaded_at"] > since]
            return self._send_json(200, {"photos": new_photos, "server_time": time.time()})

        # ── Verificar autenticación para el resto ────────────────────────────
        user = _check_auth(self)
        # /firmas y /captura son públicos — cada uno maneja su propia autenticación vía token
        _is_firmas = path in ("/firmas", "/firmas/", "/firmas/index.html")
        _is_captura = path in ("/captura", "/captura/", "/captura/index.html")
        if _is_auth_required() and not _is_firmas and not _is_captura:
            if not user:
                if path in ("/", "", "/client", "/client/") or path.endswith(".html"):
                    return self._redirect_to_login()
                return self._send_json(401, {"ok": False, "error": "No autenticado"})
            if user.get("__superseded"):
                if path in ("/", "", "/client", "/client/") or path.endswith(".html"):
                    return self._redirect_to_session_ended()
                return self._send_json(401, {"ok": False, "error": "Sesión reemplazada. Iniciá sesión nuevamente.", "code": "SUPERSEDED"})

        # ── Route guard por rol ───────────────────────────────────────────────
        # Clientes: la Suite Documental no tiene nada para ellos -- van directo a Firmas.
        if user and user.get("r") == "client":
            is_html = path in ("/", "") or path.endswith(".html")
            if is_html:
                self.send_response(302)
                self.send_header("Location", _FIRMAS_BASE_URL or "/")
                self.end_headers()
                return

        # SEC-FIX-SEC01: /sync/info requiere auth admin (expone IPs LAN y sesiones activas)
        if path == "/sync/info":
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Acceso denegado"})
            return self._send_json(200, {
                "ip": get_local_ip(),
                "sessions": len(SESSIONS),
            })

        # ── /api/me ───────────────────────────────────────────────────────────
        if path == "/api/me":
            return self._api_me_get(user)

        # ── API de almacenamiento (GET) ───────────────────────────────────────
        if path == "/api/projects":
            return self._api_projects_list(user)
        m = _RE_PROJ_EXPORT.match(path)
        if m:
            return self._api_project_export(m.group(1), user)
        m = _RE_PROJ_FOLDER_SCAN.match(path)
        if m:
            return self._api_project_folder_scan(m.group(1), user)
        m = _RE_PROJ_ID.match(path)
        if m:
            return self._api_project_get(m.group(1), user)
        m = _RE_PROJ_DOCS.match(path)
        if m:
            return self._api_docs_list(m.group(1), user)
        m = _RE_COHERENCE_PACK.match(path)
        if m:
            return self._api_coherence_pack(m.group(1), user)
        m = _RE_PROJ_DOC_FIRMAS_COMMENTS.match(path)
        if m:
            return self._api_doc_firmas_comments(m.group(1), m.group(2), user)
        m = _RE_EXECUTIONS.match(path)
        if m:
            return self._api_executions_get(m.group(1), user)
        m = _RE_EVIDENCE_BULK.match(path)
        if m:
            return self._api_evidence_images_get(m.group(1), user)
        m = _RE_EVIDENCE_ONE.match(path)
        if m:
            return self._api_evidence_image_get(m.group(1), m.group(2), user)
        m = _RE_PROJ_PHOTOS.match(path)
        if m:
            return self._api_photos_list(m.group(1), user)
        m = _RE_PROJ_PHOTO_ID.match(path)
        if m:
            return self._api_photo_get(m.group(1), m.group(2), user)
        m = _RE_PROJ_SNAPSHOT.match(path)
        if m:
            return self._api_snapshot_get(m.group(1), user)
        if _RE_MAPEO_LIST.match(path):
            return self._api_mapeo_list(user)
        m = _RE_MAPEO_ONE.match(path)
        if m:
            return self._api_mapeo_get(m.group(1), user)
        m = _RE_ANALYTICS.match(path)
        if m:
            return self._proxy_analytics(m.group(1) or "/", user)
        m = _RE_EVIDENCE.match(path)
        if m:
            return self._api_evidence_get(m.group(1), user)
        if path == "/api/evidence-batch":
            return self._send_json(405, {"ok": False, "error": "Usar POST"})
        m = _RE_PROJ_DOC.match(path)
        if m:
            return self._api_doc_get(m.group(1), m.group(2), user)

        # ── Admin API (GET) — requiere rol admin ─────────────────────────────
        if path.startswith("/admin/"):
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Requiere rol admin"})
            if path == "/admin/users":
                return self._admin_users_list(user)
            m = _RE_ADMIN_USER_ID.match(path)
            if m:
                return self._admin_user_get(m.group(1), user)

        # ── Rutas protegidas ─────────────────────────────────────────────────
        if path == "/ai/status":
            # A-5: solo admin puede ver el estado/prefijo de la API key
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Solo admin puede ver el estado de la API key"})
            key = _get_api_key()
            if key:
                return self._send_json(200, {
                    "ok": True,
                    "key_found": True,
                    "key_prefix": key[:16] + "...",
                    "key_suffix": "..." + key[-4:],
                    "key_length": len(key),
                    "source": "env_var" if os.environ.get("ANTHROPIC_API_KEY") else "dotenv_file"
                })
            else:
                return self._send_json(200, {"ok": False, "key_found": False})

        if path == "/ai/ping":
            key = _get_api_key()
            if not key:
                return self._send_json(500, {"ok": False, "error": "No API key"})
            # Test real contra Anthropic: listar modelos (GET, sin body)
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": key,
                    "anthropic-version": ANTHROPIC_VERSION,
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    return self._send_json(200, {"ok": True, "models_count": len(data.get("data", []))})
            except urllib.error.HTTPError as e:
                # VULN-06: no exponer respuesta interna de Anthropic
                print(f"[AI] /ai/ping HTTP error: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")
                return self._send_json(200, {"ok": False, "http_status": e.code})
            except Exception as e:
                print(f"[AI] /ai/ping error: {e}")
                return self._send_json(200, {"ok": False, "error": "No se pudo contactar el servicio de IA."})

        # ── Archivos estáticos ────────────────────────────────────────────────
        # En producción: proteger la app principal detrás del auth del servidor.
        # Sin esto, en Railway un usuario sin cookie recibe index.html pero todas
        # las llamadas API fallan con 401 (el login modal de IndexedDB no sirve cookies).
        if _is_auth_required() and path in ("/", "/index.html"):
            if not _check_auth(self):
                qs = urlparse(self.path).query
                from urllib.parse import parse_qs, quote as _quote
                params = parse_qs(qs)
                mobile = params.get("mobile", [""])[0]
                # Pasar mobile como parámetro propio para evitar ?next=/?mobile=TOKEN
                # que proxies como traefik pueden cortar en el segundo '?'
                if mobile:
                    loc = f"/login.html?mobile={_quote(mobile, safe='')}"
                else:
                    loc = "/login.html"
                self.send_response(302)
                self.send_header("Location", loc)
                self.end_headers()
                return
        return self._serve_static()

    def do_POST(self):
        if self._anti_scanner():
            return
        path = urlparse(self.path).path

        # ── Rutas públicas de auth ────────────────────────────────────────────
        if path == "/auth/login":
            return self._handle_auth_login()
        if path == "/auth/logout":
            return self._handle_auth_logout()
        if path == "/auth/change-credentials":
            u = _check_auth(self)
            if not u:
                return self._send_json(401, {"ok": False, "error": "No autenticado"})
            return self._auth_change_credentials(u)
        if path == "/auth/set-signing-pin":
            u = _check_auth(self)
            if not u:
                return self._send_json(401, {"ok": False, "error": "No autenticado"})
            return self._auth_set_signing_pin(u)

        # Mobile sync - sin cookie (usan token propio)
        # C-4: en prod requiere SYNC_ENABLED=true + PUBLIC_URL en el entorno
        if path.startswith("/sync/"):
            if not _SYNC_ENABLED:
                return self._send_json(403, {"ok": False, "error": "Sync no habilitado. Setear SYNC_ENABLED=true y PUBLIC_URL."})

        if path == "/sync/photo":
            return self._handle_sync_photo()

        # ── Verificar autenticación para el resto ────────────────────────────
        user = _check_auth(self)
        if self._require_auth(user): return

        # ── /api/me/pin ───────────────────────────────────────────────────────
        if path == "/api/me/pin":
            return self._api_me_pin_set(user)

        # ── API de almacenamiento (POST) ──────────────────────────────────────
        if path == "/api/projects":
            return self._api_projects_create(user)
        if path == "/api/projects/import":
            return self._api_project_import(user)
        m = _RE_PROJ_FOLDER.match(path)
        if m:
            return self._api_project_set_folder(m.group(1), user)
        m = _RE_PROJ_FOLDER_IMPORT.match(path)
        if m:
            return self._api_project_folder_import(m.group(1), user)
        m = _RE_PROJ_SNAPSHOT.match(path)
        if m:
            return self._api_snapshot_save(m.group(1), user)
        m = _RE_EXECUTION_ONE.match(path)
        if m:
            return self._api_execution_upsert(m.group(1), m.group(2), user)
        m = _RE_EVIDENCE_BULK.match(path)
        if m:
            return self._api_evidence_images_upload(m.group(1), user)
        m = _RE_EVIDENCE_ONE.match(path)
        if m:
            return self._api_evidence_image_upload(m.group(1), m.group(2), user)
        m = _RE_ANALYTICS.match(path)
        if m:
            return self._proxy_analytics(m.group(1) or "/", user)
        m = _RE_EVIDENCE.match(path)
        if m:
            return self._api_evidence_save(m.group(1), user)
        if path == "/api/evidence-batch":
            return self._api_evidence_batch_get(user)
        if path == "/api/evidence-batch-upload":
            return self._api_evidence_batch_upload(user)
        m = _RE_MAPEO_ONE.match(path)
        if m:
            return self._api_mapeo_save(m.group(1), user)
        if _RE_NOTIFY_DESVIOS.match(path):
            return self._api_notify_desvios(user)
        m = _RE_PROJ_DOC_SEND_FIRMAS.match(path)
        if m:
            return self._api_doc_send_to_firmas(m.group(1), m.group(2), user)
        m = _RE_PROJ_DOC.match(path)
        if m:
            return self._api_doc_upsert(m.group(1), m.group(2), user)

        # ── Admin API (POST) — requiere rol admin ─────────────────────────────
        if path.startswith("/admin/"):
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Requiere rol admin"})
            if path == "/admin/users":
                return self._admin_user_create(user)
            m = _RE_ADMIN_USR_PIN.match(path)
            if m:
                return self._admin_user_pin_set(m.group(1), user)
            m = _RE_ADMIN_USR_PWD.match(path)
            if m:
                return self._admin_user_set_password(m.group(1), user)
            m = _RE_ADMIN_USR_UNLOCK.match(path)
            if m:
                return self._admin_user_unlock(m.group(1), user)
            m = _RE_ADMIN_ACCESS.match(path)
            if m:
                return self._admin_access_grant(m.group(1), user)

        # ── Rutas protegidas ─────────────────────────────────────────────────
        if path == "/ai/generate":
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Solo admin puede usar la generación IA."})
            ip = self._get_client_ip()
            if not _rate_limit(_AI_ATTEMPTS, ip, _MAX_AI_PER_MIN):
                return self._send_json(429, {"ok": False, "error": "Demasiadas solicitudes. Esperá un momento antes de generar otro documento."})

            data = self._read_json_body()
            if data is None:
                return

            # Límites de tamaño de prompt (evitar abuso / DoS por payloads gigantes)
            _MAX_PROMPT_CHARS = 400_000   # ~100k tokens aprox.
            model = str(data.get("model", "claude-sonnet-4-6"))[:64]
            system_prompt = str(data.get("systemPrompt", ""))[:_MAX_PROMPT_CHARS]
            user_prompt   = str(data.get("userPrompt",   ""))[:_MAX_PROMPT_CHARS]

            # Modelo permitido: solo variantes de claude (no permite URL injection)
            _ALLOWED_MODELS = {"claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"}
            if model not in _ALLOWED_MODELS:
                model = "claude-sonnet-4-6"

            if not user_prompt or not user_prompt.strip():
                return self._send_json(400, {"ok": False, "error": "userPrompt requerido"})

            api_key = _get_api_key()
            if not api_key:
                return self._send_json(503, {"ok": False, "error": "Servicio de IA no disponible."})

            try:
                content, stop_reason = _call_anthropic(api_key, model, system_prompt, user_prompt)
                if stop_reason == "max_tokens":
                    return self._send_json(200, {
                        "ok": False,
                        "truncated": True,
                        "error": f"La respuesta fue cortada por límite de tokens ({AI_MAX_TOKENS}). El documento generado es demasiado largo. Intentá regenerarlo con instrucciones de brevedad.",
                        "partial": content[:2000]
                    })
                return self._send_json(200, {"ok": True, "content": content, "stop_reason": stop_reason})
            except RuntimeError as e:
                # VULN-06: no exponer detalles internos de Anthropic al cliente
                print(f"[AI] Error Anthropic en /ai/generate: {e}")
                return self._send_json(502, {"ok": False, "error": "El servicio de IA no pudo completar la solicitud. Verificá la configuración o intentá nuevamente."})
            except Exception as e:
                print(f"[AI] Error interno en /ai/generate: {e}")
                return self._send_json(500, {"ok": False, "error": "Error interno al generar. Intentá nuevamente."})

        if path == "/ai/key":
            # C-3: solo admin puede cambiar la API key; deshabilitado en producción
            if _IS_PROD:
                return self._send_json(403, {"ok": False, "error": "Operación no disponible en producción"})
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Solo admin puede cambiar la API key"})
            data = self._read_json_body()
            if data is None:
                return
            new_key = re.sub(r"[\r\n\x00]+", "", (data.get("key") or "").strip())
            if not new_key:
                return self._send_json(400, {"ok": False, "error": "Campo 'key' requerido"})
            if not new_key.startswith("sk-ant-"):
                return self._send_json(400, {"ok": False, "error": "La API key debe comenzar con sk-ant-"})
            env_path = os.path.join(ROOT_DIR, ".env")
            try:
                # Preservar otras variables del .env si existen
                lines = []
                key_written = False
                if os.path.isfile(env_path):
                    with open(env_path, "r", encoding="utf-8") as f:
                        for line in f:
                            if line.startswith("ANTHROPIC_API_KEY="):
                                lines.append(f"ANTHROPIC_API_KEY={new_key}\n")
                                key_written = True
                            else:
                                lines.append(line)
                if not key_written:
                    lines.append(f"ANTHROPIC_API_KEY={new_key}\n")
                with open(env_path, "w", encoding="utf-8") as f:
                    f.writelines(lines)
                return self._send_json(200, {
                    "ok": True,
                    "message": "API key guardada en .env"
                })
            except Exception as e:
                print(f"[ENV] Error al escribir .env: {e}")
                return self._send_json(500, {"ok": False, "error": "No se pudo guardar la configuración."})

        if path == "/sync/session":
            # PC sube la sesion al activar modo movil
            # VULN-02: servidor genera el token; ignorar cualquier token que envíe el cliente
            data = self._read_json_body()
            if data is None:
                return

            session_data = data.get("session_data")
            if not session_data:
                return self._send_json(400, {"error": "session_data requerido"})

            token = secrets.token_urlsafe(32)  # criptográficamente seguro, servidor-generado
            # ADV-10: validar que project_id tenga formato válido o vacío — previene contaminación de directorios
            raw_proj = str(data.get("project_id", "") or "")
            safe_project_id = raw_proj if _is_valid_proj_id(raw_proj) else ""
            cleanup_expired_sessions()
            if len(SESSIONS) >= MAX_SESSIONS:
                return self._send_json(503, {"error": f"Demasiadas sesiones activas ({MAX_SESSIONS} máx). Intentá más tarde."})
            now = time.time()
            SESSIONS[token] = {
                "session_data": session_data,
                "project_id": safe_project_id,
                "photos": [],
                "created_at": now,
                "created_by": user.get("u", "unknown"),
            }
            # Persistir en DB para sobrevivir reinicios del servidor
            try:
                db = _get_db()
                db.execute(
                    "INSERT INTO sync_sessions (token, session_data, project_id, created_by, created_at, expires_at) "
                    "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO NOTHING",
                    (token, json.dumps(session_data), safe_project_id,
                     user.get("u", "unknown"), now, now + SESSION_TTL)
                )
            except Exception as _e:
                print(f"[SYNC] Error persistiendo sesion en DB: {_e}")
            best_ip = get_local_ip()
            all_ips = get_all_local_ips()
            if _PUBLIC_URL:
                url_movil = f"{_PUBLIC_URL}/captura/?mobile={token}"
            else:
                # Auto-detectar URL pública desde headers que Railway/Render inyectan
                fwd_host  = self.headers.get("X-Forwarded-Host", "").strip()
                fwd_proto = self.headers.get("X-Forwarded-Proto", "").strip()
                req_host  = self.headers.get("Host", "").strip()
                pub_host  = fwd_host or req_host
                # Solo usar si NO es localhost / IP privada
                import re as _re
                def _is_private(h):
                    h = h.split(":")[0]  # quitar puerto si viene incluido
                    if not h or h == "localhost": return True
                    return bool(_re.match(
                        r'^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)', h
                    ))
                if pub_host and not _is_private(pub_host):
                    proto = fwd_proto or "https"
                    url_movil = f"{proto}://{pub_host}/captura/?mobile={token}"
                else:
                    url_movil = f"http://{best_ip}:{self.server.server_port}/captura/?mobile={token}"
            return self._send_json(200, {
                "ok": True,
                "token": token,
                "ip": best_ip,
                "all_ips": all_ips,
                "url_movil": url_movil,
            })

        return self._send_json(404, {"error": "Endpoint no encontrado"})

    def _handle_sync_photo(self):
        data = self._read_json_body()
        if data is None:
            return
        token = data.get("token")
        sess = SESSIONS.get(token)
        if not sess:
            # Fallback a DB (sobrevive reinicios del servidor)
            try:
                db = _get_db()
                row = db.execute(
                    "SELECT session_data, project_id, created_at FROM sync_sessions WHERE token=? AND expires_at>?",
                    (token, time.time())
                ).fetchone()
                if row:
                    SESSIONS[token] = {
                        "session_data": json.loads(row["session_data"]),
                        "project_id": row["project_id"] or "",
                        "photos": [],
                        "created_at": row["created_at"],
                        "created_by": "restored",
                    }
                    sess = SESSIONS[token]
            except Exception:
                pass
        if not sess:
            return self._send_json(404, {"error": "Sesion no encontrada"})
        photo = {
            "id": data.get("id") or f"photo_{int(time.time() * 1000)}",
            "testId": data.get("testId"),
            "step": data.get("step"),
            "image": data.get("image"),
            "description": data.get("description", ""),
            "operacion": data.get("operacion", ""),
            "resultado": data.get("resultado", "PASA"),
            "executor": data.get("executor", ""),
            "timestamp": data.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%S"),
            "dimensions": data.get("dimensions", ""),
            "size": data.get("size", ""),
            "sourceType": data.get("sourceType", "mobile-camera"),
            "originalDimensions": data.get("originalDimensions", ""),
            "originalFileName": data.get("originalFileName", ""),
            "cameraMake": data.get("cameraMake", ""),
            "cameraModel": data.get("cameraModel", ""),
            "captureDate": data.get("captureDate", ""),
            "gpsLatitude": data.get("gpsLatitude"),
            "gpsLongitude": data.get("gpsLongitude"),
            "gpsLatitudeRef": data.get("gpsLatitudeRef"),
            "gpsLongitudeRef": data.get("gpsLongitudeRef"),
            "orientation": data.get("orientation", 1),
            "uploaded_at": time.time(),
        }
        _ALLOWED_PHOTO_PREFIXES = (
            "data:image/jpeg;base64,", "data:image/png;base64,",
            "data:image/webp;base64,", "data:image/gif;base64,",
        )
        if not photo["image"] or not any(photo["image"].startswith(p) for p in _ALLOWED_PHOTO_PREFIXES):
            return self._send_json(400, {"error": "Formato de imagen no permitido. Solo jpeg, png, webp o gif."})
        if len(photo["image"]) > MAX_PHOTO_BYTES:
            return self._send_json(400, {"error": "Imagen invalida o excede 15MB"})
        # SEC-FIX-SYNC04: verificar límites acumulados de la sesión
        if len(sess["photos"]) >= MAX_PHOTOS_PER_SESSION:
            return self._send_json(413, {"error": f"Límite de {MAX_PHOTOS_PER_SESSION} fotos por sesión alcanzado"})
        session_bytes = sum(len(p.get("image", "")) for p in sess["photos"])
        if session_bytes + len(photo["image"]) > MAX_SESSION_BYTES:
            return self._send_json(413, {"error": "Límite de almacenamiento de sesión alcanzado (50 MB)"})
        sess["photos"].append(photo)
        if sess.get("project_id"):
            _save_photo_to_disk(sess["project_id"], photo)
        return self._send_json(200, {"ok": True, "id": photo["id"]})

    def do_DELETE(self):
        if self._anti_scanner():
            return
        path = urlparse(self.path).path

        # Mobile sync — no cookie required; bloqueado en producción igual que GET/POST
        if path.startswith("/sync/session/"):
            token = path[len("/sync/session/"):]
            found = token in SESSIONS
            SESSIONS.pop(token, None)
            try:
                db = _get_db()
                db.execute("DELETE FROM sync_sessions WHERE token=?", (token,))
            except Exception:
                pass
            return self._send_json(200 if found else 404, {"ok": found})

        # ── Verificar autenticación ───────────────────────────────────────────
        user = _check_auth(self)
        if self._require_auth(user): return

        # ── API de almacenamiento (DELETE) ────────────────────────────────────
        m = _RE_EVIDENCE_ONE.match(path)
        if m:
            return self._api_evidence_delete_one(m.group(1), m.group(2), user)
        m = _RE_EVIDENCE_BULK.match(path)
        if m:
            return self._api_evidence_delete_all(m.group(1), user)
        m = _RE_PROJ_DOC.match(path)
        if m:
            return self._api_doc_delete(m.group(1), m.group(2), user)
        m = _RE_MAPEO_ONE.match(path)
        if m:
            return self._api_mapeo_delete(m.group(1), user)
        m = _RE_PROJ_ID.match(path)
        if m:
            return self._api_project_delete(m.group(1), user)

        # ── Admin API (DELETE) — requiere rol admin ───────────────────────────
        if path.startswith("/admin/"):
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Requiere rol admin"})
            m = _RE_ADMIN_ACC_P.match(path)
            if m:
                return self._admin_access_revoke(m.group(1), m.group(2), user)
            m = _RE_ADMIN_USER_ID.match(path)
            if m:
                return self._admin_user_delete(m.group(1), user)

        return self._send_json(404, {"error": "Endpoint no encontrado"})

    def do_PUT(self):
        """Antes esto era un stub que devolvía 405 en blanco para CUALQUIER PUT -- incluido
        el upsert de documentos, que la doc del propio repo (docstring de
        tests/test_revision_workflow.py) sigue describiendo como PUT. El upsert real vive en
        do_POST (_RE_PROJ_DOC -> _api_doc_upsert); acá se replica esa única ruta (mismo
        chequeo de auth que do_POST) para que PUT funcione como está documentado, en vez de
        fallar en silencio. El resto de PUT sigue sin soportarse, pero ahora con un cuerpo
        JSON explicando por qué."""
        if self._anti_scanner():
            return
        path = urlparse(self.path).path
        user = _check_auth(self)
        if self._require_auth(user): return

        m = _RE_PROJ_DOC.match(path)
        if m:
            return self._api_doc_upsert(m.group(1), m.group(2), user)

        return self._send_json(405, {"ok": False, "error": "Método no soportado para esta ruta"})

    def do_TRACE(self):
        self.send_response(405)
        self.end_headers()

    def do_CONNECT(self):
        self.send_response(405)
        self.end_headers()

    def do_PATCH(self):
        if self._anti_scanner():
            return
        path = urlparse(self.path).path
        user = _check_auth(self)
        if self._require_auth(user): return
        if path.startswith("/admin/"):
            if user.get("r") != "admin":
                return self._send_json(403, {"ok": False, "error": "Requiere rol admin"})
            m = _RE_ADMIN_USER_ID.match(path)
            if m:
                return self._admin_user_update(m.group(1), user)
        return self._send_json(404, {"error": "Endpoint no encontrado"})


# B1: bounded thread server — caps concurrent OS threads to prevent resource exhaustion.
# ThreadingHTTPServer spawns one OS thread per connection with no limit; 50 concurrent
# connections would create 50 threads. This subclass rejects connections beyond _MAX_THREADS.
_MAX_THREADS = 32

class _BoundedServer(ThreadingHTTPServer):
    """ThreadingHTTPServer with a hard cap on concurrent request threads."""
    daemon_threads = True
    _semaphore = threading.Semaphore(_MAX_THREADS)

    def process_request(self, request, client_address):
        if not self._semaphore.acquire(blocking=False):
            try:
                request.close()
            except Exception:
                pass
            return
        t = threading.Thread(target=self._process_bounded, args=(request, client_address))
        t.daemon = True
        t.start()

    def _process_bounded(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            _release_db()
            self._semaphore.release()
            self.shutdown_request(request)


def main():
    # A-4: fail-safe — no arrancar en producción sin AUTH_SECRET_KEY configurada
    if _IS_PROD and not _AUTH_SECRET:
        print("[FATAL] ENV=production pero AUTH_SECRET_KEY no está configurada.")
        print("[FATAL] Configurá AUTH_SECRET_KEY como variable de entorno antes de iniciar.")
        sys.exit(1)

    # SEC-FIX-AUTH007: longitud mínima de AUTH_SECRET_KEY (defensa contra brute-force HMAC)
    if _AUTH_SECRET and len(_AUTH_SECRET) < 32:
        print("[FATAL] AUTH_SECRET_KEY debe tener al menos 32 caracteres.")
        print("[FATAL] Generá una clave segura: python -c \"import secrets; print(secrets.token_hex(32))\"")
        sys.exit(1)

    # Validar AUDIT_HMAC_KEY solo en producción: debe ser independiente de AUTH_SECRET_KEY.
    # Si comparten la misma clave, comprometer AUTH_SECRET_KEY permite también falsificar
    # el audit trail del Validation Book (ambos riesgos deben ser independientes).
    if _IS_PROD:
        audit_key_env = os.environ.get("AUDIT_HMAC_KEY", "").strip()
        if not audit_key_env:
            print("[FATAL] AUDIT_HMAC_KEY no está configurada en producción.")
            print("[FATAL] Generá una clave independiente: python -c \"import secrets; print(secrets.token_hex(32))\"")
            print("[FATAL] Configurá AUDIT_HMAC_KEY en Railway Variables antes de iniciar.")
            sys.exit(1)
        if audit_key_env == os.environ.get("AUTH_SECRET_KEY", "").strip():
            print("[FATAL] AUDIT_HMAC_KEY y AUTH_SECRET_KEY no pueden ser iguales en producción.")
            print("[FATAL] Usá claves independientes para auth tokens y audit trail HMAC.")
            sys.exit(1)

    # Crear directorios de datos necesarios
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(EVIDENCE_DIR, exist_ok=True)

    # Arrancar analytics service como subproceso interno (puerto 8765, solo localhost)
    _analytics_proc = None
    _analytics_dir = os.path.join(ROOT_DIR, "analytics-service")
    if os.path.isdir(_analytics_dir):
        try:
            import subprocess as _subprocess
            _analytics_proc = _subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "app.main:app",
                 "--host", "127.0.0.1", "--port", "8765",
                 "--log-level", "warning", "--no-access-log"],
                cwd=_analytics_dir,
                stdout=_subprocess.DEVNULL,
                stderr=_subprocess.DEVNULL,
            )
            print(f"  Analytics service: arrancando en 127.0.0.1:8765 (PID {_analytics_proc.pid})")
        except Exception as _e:
            print(f"  [WARN] Analytics service no pudo arrancar: {_e}")
    else:
        print(f"  [INFO] analytics-service/ no encontrado — motor de analytics deshabilitado")

    # Puerto: CLI arg > env var PORT > default 11294
    port_arg = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", "11294")
    try:
        port = int(port_arg)
    except ValueError:
        port = 11294

    ip = get_local_ip()
    all_ips = get_all_local_ips()
    print("=" * 60)
    print("  Gestor de Evidencias GxP - Servidor de sincronizacion")
    print("=" * 60)
    print(f"  Acceso local (PC):    http://localhost:{port}")
    print(f"  Acceso LAN (celular): http://{ip}:{port}")
    if len(all_ips) > 1:
        print(f"  IPs alternativas detectadas: {', '.join(a for a in all_ips if a != ip)}")
        print(f"  (Si la principal no funciona, prueba con las alternativas)")
    print("=" * 60)
    if _is_auth_required():
        print("  MODO PRODUCCION: Autenticacion activa")
    else:
        print("  MODO LOCAL: Sin autenticacion (AUTH_SECRET_KEY no configurado)")
    print("  IMPORTANTE:")
    print("  - El celular debe estar en la misma red WiFi")
    print("  - Si Windows pregunta por permitir el acceso, click 'Permitir'")
    print("  - NO cierres esta ventana mientras uses la app")
    print("=" * 60)

    import db_adapter as _dba
    try:
        _db_init()
        _ensure_env_users()
        _migrate_to_unified_users()
        _bootstrap_superadmin()
        db = _get_db()
        n_users = db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        if _dba.USE_PG:
            print(f"  PostgreSQL: {_dba.DATABASE_URL.split('@')[-1]}")
        else:
            print(f"  SQLite: {_dba.SQLITE_PATH}")
        print(f"  Usuarios registrados: {n_users}")
    except Exception as _startup_err:
        sys.stderr.write(f"[startup] ERROR en inicialización de DB: {_startup_err}\n")
        import traceback; traceback.print_exc()
        if _dba.USE_PG:
            sys.stderr.write(f"[startup] DATABASE_URL = {_dba.DATABASE_URL[:40]}...\n")
    print("=" * 60)
    print()

    server = _BoundedServer(("0.0.0.0", port), SyncHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
        server.server_close()


if __name__ == "__main__":
    main()
