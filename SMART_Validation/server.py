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
from urllib.parse import urlparse, parse_qs

# Estado en memoria (no persistente; se pierde al reiniciar el servidor)
SESSIONS = {}
SESSION_TTL = 3600  # 1 hora
MAX_SESSION_BYTES = 50 * 1024 * 1024  # 50 MB — límite acumulado de imágenes por sesión
MAX_PHOTO_BYTES = 15 * 1024 * 1024     # 15 MB por foto
MAX_PHOTOS_PER_SESSION = 200           # SEC-FIX-SYNC04: límite de cantidad de fotos por sesión
MAX_SESSIONS = 200                     # SEC-FIX-DOS005: cota dura del dict SESSIONS

# Sync de firmas manuscritas movil → PC (modal de registro de firmante).
# Cada entry: { firmaImage: data:image/png;base64,..., uploaded_at: ts }
# TTL corto: 10 minutos. La PC polea cada 2s; al recibir, limpia el token.
SIGNATURES = {}
SIGNATURE_TTL = 600  # 10 min
MAX_SIGNATURE_BYTES = 2 * 1024 * 1024  # 2 MB

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

        CREATE TABLE IF NOT EXISTS document_signatures (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            doc_type     TEXT NOT NULL,
            username     TEXT NOT NULL,
            display_name TEXT,
            role_label   TEXT DEFAULT 'Firmante',
            audit_hash   TEXT,
            ip           TEXT,
            signed_at    REAL,
            created_at   REAL
        );

        CREATE TABLE IF NOT EXISTS doc_comments (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            doc_type     TEXT NOT NULL,
            username     TEXT NOT NULL,
            display_name TEXT,
            body         TEXT NOT NULL,
            section_ref  TEXT,
            created_at   REAL
        );

        CREATE TABLE IF NOT EXISTS signing_rounds (
            id             TEXT PRIMARY KEY,
            project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            doc_type       TEXT NOT NULL,
            doc_version    INTEGER NOT NULL DEFAULT 1,
            doc_hash       TEXT NOT NULL,
            status         TEXT DEFAULT 'open',
            created_by     TEXT,
            created_at     REAL,
            sealed_at      REAL,
            cancelled_at   REAL,
            cancel_reason  TEXT,
            seal_hash      TEXT,
            prev_block_hash TEXT
        );

        CREATE TABLE IF NOT EXISTS signing_round_signers (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            round_id              TEXT NOT NULL REFERENCES signing_rounds(id) ON DELETE CASCADE,
            username              TEXT NOT NULL,
            display_name          TEXT,
            role_label            TEXT NOT NULL DEFAULT 'Revisor',
            signed_at             REAL,
            audit_hash            TEXT,
            revision_requested_at REAL,
            revision_reason       TEXT,
            ip                    TEXT
        );

        CREATE TABLE IF NOT EXISTS validation_book_blocks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            round_id        TEXT NOT NULL,
            block_number    INTEGER NOT NULL,
            doc_type        TEXT NOT NULL,
            doc_version     INTEGER NOT NULL,
            doc_hash        TEXT NOT NULL,
            block_hash      TEXT NOT NULL,
            prev_block_hash TEXT,
            block_json      TEXT NOT NULL,
            sealed_at       REAL
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
    """)
    db.commit()
    # Migraciones en caliente (idempotentes — ignorar si la columna ya existe)
    for _migration in [
        "ALTER TABLE doc_comments ADD COLUMN section_ref TEXT",
        "ALTER TABLE users ADD COLUMN email TEXT",
        # LO1-FIX: índice único previene firma duplicada a nivel DB (GxP — registro regulado único)
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_sig_unique ON document_signatures(project_id, doc_type, username)",
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
    ]:
        try:
            db.execute(_migration)
        except Exception:
            pass

    # Índices de rendimiento (CREATE INDEX IF NOT EXISTS es idempotente)
    db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_srs_round
            ON signing_round_signers(round_id);
        CREATE INDEX IF NOT EXISTS idx_vbb_project
            ON validation_book_blocks(project_id);
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
_RE_PROJ_DOC_SIGN     = re.compile(r'^/api/projects/([^/]+)/documents/([^/]+)/sign$')
_RE_PROJ_DOC_SIGS     = re.compile(r'^/api/projects/([^/]+)/documents/([^/]+)/signatures$')
_RE_PROJ_DOC_COMMENTS  = re.compile(r'^/api/projects/([^/]+)/documents/([^/]+)/comments$')
_RE_SIGNING_ROUNDS     = re.compile(r'^/api/projects/([^/]+)/signing-rounds$')
_RE_SIGNING_ROUND_ID   = re.compile(r'^/api/projects/([^/]+)/signing-rounds/([^/]+)$')
_RE_SIGNING_ROUND_SIGN = re.compile(r'^/api/projects/([^/]+)/signing-rounds/([^/]+)/sign$')
_RE_SIGNING_ROUND_REV  = re.compile(r'^/api/projects/([^/]+)/signing-rounds/([^/]+)/request-revision$')
_RE_SIGNING_ROUND_SEAL = re.compile(r'^/api/projects/([^/]+)/signing-rounds/([^/]+)/seal$')
_RE_PROJ_PHOTOS   = re.compile(r'^/api/projects/([^/]+)/photos$')
_RE_PROJ_PHOTO_ID = re.compile(r'^/api/projects/([^/]+)/photos/([^/]+)$')
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
_PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
# C-4: sync habilitado en dev siempre; en prod solo si SYNC_ENABLED=true
_SYNC_ENABLED = not _IS_PROD or os.environ.get("SYNC_ENABLED", "").lower() == "true"

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


def _migrate_to_unified_users():
    """Bootstrap tabla users desde .env + client_users legacy. Corre una sola vez."""
    db = _get_db()
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0:
        return  # ya migrado

    now = time.time()
    # 1. Seed admins desde variables de entorno
    env_users = _load_server_users()
    for uname, u in env_users.items():
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
    legacy = db.execute(
        "SELECT id, username, display_name, pin_hash, pin_set, created_by, created_at "
        "FROM client_users"
    ).fetchall()
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
    accesses = db.execute(
        "SELECT user_id, project_id, access_level, granted_by, granted_at "
        "FROM user_project_access"
    ).fetchall()
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


def _add_sec_headers(handler, *, html: bool = False) -> None:
    """Inyecta headers de seguridad en la respuesta activa.
    Llamar antes de end_headers(). html=True añade Content-Security-Policy."""
    if _IS_PROD:
        handler.send_header(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains; preload"
        )
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "SAMEORIGIN")
    handler.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
    handler.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
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
                     "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status not in (200, 201):
                    sys.stderr.write(f"[email] HTTP {resp.status} enviando a {to}\n")
        except Exception as exc:
            sys.stderr.write(f"[email] Falló envío a {to}: {exc}\n")

    threading.Thread(target=_worker, daemon=True).start()


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

def _is_superadmin(user: dict) -> bool:
    return bool(user.get("sa"))


def _notify_round_created(proj_id: str, doc_type: str, round_id: str, admin_display: str) -> None:
    """Email a cada firmante cuando el admin crea una ronda de revisión."""
    if not _RESEND_API_KEY:
        return
    db = _get_db()
    proj = db.execute("SELECT name FROM projects WHERE id=?", (proj_id,)).fetchone()
    proj_name = proj["name"] if proj else proj_id
    signers = db.execute(
        "SELECT srs.display_name, srs.role_label, u.email "
        "FROM signing_round_signers srs "
        "LEFT JOIN users u ON u.username = srs.username "
        "WHERE srs.round_id=?", (round_id,)
    ).fetchall()
    suite_url = (_ALLOWED_ORIGIN.rstrip("/") + "/client/") if _ALLOWED_ORIGIN != "*" else "/client/"
    for s in signers:
        if not s["email"]:
            continue
        # M-3: HTML escape para prevenir inyección en emails
        nombre = _html_mod.escape(s["display_name"] or "Revisor")
        rol    = _html_mod.escape(s["role_label"] or "Revisor")
        adm    = _html_mod.escape(admin_display)
        dtype  = _html_mod.escape(doc_type)
        pname  = _html_mod.escape(proj_name)
        body = (
            f"<p>Hola <strong>{nombre}</strong>,</p>"
            f"<p><strong>{adm}</strong> ha creado una ronda de revisión para el "
            f"documento <strong>{dtype}</strong> del proyecto <strong>{pname}</strong>.</p>"
            f"<p>Tu rol asignado en esta ronda: <strong>{rol}</strong>.</p>"
            "<p>Ingresá a la Suite de Revisión para leer el documento y registrar "
            "tu firma o tus observaciones.</p>"
        )
        _send_email(
            s["email"],
            f"[SMART Validation] Revisión pendiente: {doc_type} — {proj_name}",
            _email_html("Documento pendiente de revisión", body,
                        "Ir a la Suite de Revisión", suite_url)
        )


def _notify_revision_requested(proj_id: str, doc_type: str,
                                reviewer_display: str, reason: str) -> None:
    """Email a todos los admins cuando un revisor solicita modificaciones."""
    if not _RESEND_API_KEY:
        return
    db = _get_db()
    proj = db.execute("SELECT name FROM projects WHERE id=?", (proj_id,)).fetchone()
    proj_name = proj["name"] if proj else proj_id
    admins = db.execute(
        "SELECT email FROM users "
        "WHERE role='admin' AND is_active=1 AND email IS NOT NULL AND email != ''"
    ).fetchall()
    dashboard_url = (_ALLOWED_ORIGIN.rstrip("/") + "/") if _ALLOWED_ORIGIN != "*" else "/"
    # M-3: HTML escape para prevenir inyección en emails
    rev   = _html_mod.escape(reviewer_display)
    dtype = _html_mod.escape(doc_type)
    pname = _html_mod.escape(proj_name)
    rsn   = _html_mod.escape(reason)
    body = (
        f"<p><strong>{rev}</strong> solicitó modificaciones en el documento "
        f"<strong>{dtype}</strong> del proyecto <strong>{pname}</strong>.</p>"
        "<p><strong>Motivo indicado:</strong></p>"
        '<blockquote style="border-left:3px solid #1F3C56;margin:12px 0;padding:8px 16px;'
        f'background:#f4f6f8;color:#333;">{rsn}</blockquote>'
        "<p>La ronda de firma fue cancelada automáticamente. Revisá las observaciones "
        "en el dashboard de revisión.</p>"
    )
    subject = f"[SMART Validation] {reviewer_display} solicitó cambios en {doc_type}"
    html = _email_html("Solicitud de modificaciones recibida", body,
                       "Ver dashboard de revisión", dashboard_url)
    for admin in admins:
        _send_email(admin["email"], subject, html)


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
    """Eliminar sesiones que excedieron el TTL. ADV-17: bajo lock para thread-safety."""
    now = time.time()
    with _RATE_LIMIT_LOCK:
        expired = [t for t, s in list(SESSIONS.items()) if now - s["created_at"] > SESSION_TTL]
        for t in expired:
            SESSIONS.pop(t, None)


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


def cleanup_expired_signatures():
    """Eliminar tokens de firma vencidos. ADV-17: bajo lock para thread-safety."""
    now = time.time()
    with _RATE_LIMIT_LOCK:
        expired = [t for t, s in list(SIGNATURES.items()) if now - s.get("created_at", 0) > SIGNATURE_TTL]
        for t in expired:
            SIGNATURES.pop(t, None)


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

        # 4. Rate limit global — /health excluido para Railway healthcheck
        if path != "/health" and not _rate_limit(_GLOBAL_ATTEMPTS, ip, _MAX_GLOBAL_PER_MIN):
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

        if role == "client":
            ok = bool(row["pin_hash"]) and _pbkdf2_verify(password, row["pin_hash"])
        else:
            ok = bool(row["password_hash"]) and _pbkdf2_verify(password, row["password_hash"])

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
                doc_status = str(doc.get("status", "draft"))
                if doc_status not in ("draft", "needs_revision", "for_review", "approved"):
                    doc_status = "draft"
                db.execute("""
                    INSERT INTO documents
                      (id, project_id, doc_type, version, status, json_data,
                       created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(project_id, doc_type) DO UPDATE SET
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
                # SEC-FIX-F02: no sobreescribir documentos aprobados (inmutabilidad GxP)
                existing = db.execute(
                    "SELECT status FROM documents WHERE project_id=? AND doc_type=?",
                    (proj_id, doc_type)
                ).fetchone()
                if existing and existing["status"] in ("approved", "for_review"):
                    results.append({"filename": fname, "ok": False, "error": f"Documento {doc_type} está {existing['status']} y no puede sobreescribirse"})
                    continue
                db.execute("""
                    INSERT INTO documents
                        (id, project_id, doc_type, version, status, json_data, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?)
                    ON CONFLICT(project_id, doc_type) DO UPDATE SET
                        json_data=excluded.json_data,
                        updated_at=excluded.updated_at,
                        version=version+1
                """, (str(uuid.uuid4()), proj_id, doc_type, json.dumps(json_data, ensure_ascii=False),
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
        # BEGIN IMMEDIATE: el check de documentos aprobados y el DELETE deben ser atómicos.
        # Sin esto, un documento puede ser aprobado entre el SELECT y el DELETE (TOCTOU GxP).
        db.execute("BEGIN IMMEDIATE")
        try:
            proj = db.execute("SELECT name FROM projects WHERE id=?", (proj_id,)).fetchone()
            if not proj:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Proyecto no encontrado"})
            # ADV-05: no eliminar proyectos con documentos aprobados — integridad regulatoria GxP
            approved_count = db.execute(
                "SELECT COUNT(*) AS n FROM documents WHERE project_id=? AND status='approved'",
                (proj_id,)
            ).fetchone()["n"]
            if approved_count > 0:
                db.execute("ROLLBACK")
                return self._send_json(409, {
                    "ok": False,
                    "error": f"El proyecto tiene {approved_count} documento(s) aprobado(s). No se puede eliminar según regulación GxP."
                })
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
        name = (sys_info.get("projectName") or sys_info.get("name") or proj_id)
        package_docs = (snapshot.get("packageDocs") or [])[:50]  # cap: un paquete GxP tiene ≤ 20 tipos
        db = _get_db()
        try:
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
            # NEW-13: pre-cargar en un solo query los docs protegidos (aprobados/en revisión)
            # para evitar N queries dentro del loop (1 query por cada doc del paquete).
            _pkg_types = [
                d.get("type") or d.get("docType")
                for d in package_docs
                if d.get("type") or d.get("docType")
            ]
            if _pkg_types:
                # SECURITY REVIEW [2026-06-24]: _ph contains only '?' characters built from
                # len(_pkg_types) — no user input interpolated. Reviewed and confirmed safe.
                # Pattern is parameterized at execution.
                _ph = ",".join("?" * len(_pkg_types))
                _protected = {
                    r["doc_type"]
                    for r in db.execute(
                        f"SELECT doc_type FROM documents "
                        f"WHERE project_id=? AND status IN ('approved','for_review') "
                        f"AND doc_type IN ({_ph})",
                        (proj_id, *_pkg_types),
                    ).fetchall()
                }
            else:
                _protected = set()

            synced_types = []
            for doc in package_docs:
                doc_type = doc.get("type") or doc.get("docType")
                if not doc_type:
                    continue
                if doc_type in _protected:
                    continue
                db.execute("""
                    INSERT INTO documents
                      (id, project_id, doc_type, version, status, json_data,
                       created_by, created_at, updated_at)
                    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
                    ON CONFLICT(project_id, doc_type) DO UPDATE SET
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
        return self._send_json(200, {"ok": True, "docs_synced": len(package_docs)})

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

    def _api_evidence_save(self, compound_id, user):
        """Guarda una imagen de evidencia en el filesystem del servidor."""
        data = self._read_json_body()
        if data is None:
            return
        raw = data.get("data", "")
        if not raw:
            return self._send_json(400, {"ok": False, "error": "Campo 'data' requerido"})
        # Parse data URL: data:image/jpeg;base64,...
        mime = "image/jpeg"
        b64 = raw
        if raw.startswith("data:") and "," in raw:
            header = raw[:raw.index(",")]
            b64 = raw[raw.index(",") + 1:]
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
        ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(mime, ".jpg")
        try:
            os.makedirs(EVIDENCE_DIR, exist_ok=True)
            with open(os.path.join(EVIDENCE_DIR, compound_id + ext), "wb") as f:
                f.write(image_bytes)
            with open(os.path.join(EVIDENCE_DIR, compound_id + ".meta"), "w", encoding="utf-8") as f:
                f.write(mime)
        except OSError as e:
            print(f"[EVIDENCE] Error guardando {compound_id}: {e}")
            return self._send_json(500, {"ok": False, "error": "Error guardando imagen"})
        return self._send_json(200, {"ok": True})

    def _api_evidence_get(self, compound_id, user):
        """Recupera una imagen de evidencia del filesystem y la devuelve como data URL."""
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
        for raw_id in ids:
            if not isinstance(raw_id, str) or not re.match(r'^[a-zA-Z0-9_-]{1,300}$', raw_id):
                results[raw_id] = None
                continue
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
        row = db.execute("""
            SELECT 1 FROM project_access pa
            INNER JOIN users u ON u.id = pa.user_id
            WHERE u.username=? AND pa.project_id=?
        """, (user.get("u", ""), proj_id)).fetchone()
        if not row:
            self._send_json(403, {"ok": False, "error": "Acceso denegado"})
            return False
        return True

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
            # NEW-03: no permitir sobreescribir documentos aprobados o en revisión
            existing = db.execute(
                "SELECT status, json_data FROM documents WHERE project_id=? AND doc_type=?",
                (proj_id, doc_type)
            ).fetchone()
            if existing and existing["status"] in ("approved", "for_review"):
                db.execute("ROLLBACK")
                return self._send_json(409, {
                    "ok": False,
                    "error": f"El documento está en estado '{existing['status']}' y no puede ser modificado."
                })
            doc_action = "doc_update" if existing else "doc_create"
            db.execute("""
                INSERT INTO documents
                  (id, project_id, doc_type, version, status, json_data,
                   created_by, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, doc_type) DO UPDATE SET
                  json_data=excluded.json_data,
                  status=COALESCE(excluded.status, status),
                  updated_at=excluded.updated_at
            """, (
                f"{proj_id}_{doc_type}", proj_id, doc_type,
                requested_status,
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
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise
        return self._send_json(200, {"ok": True, "id": f"{proj_id}_{doc_type}"})

    def _api_doc_delete(self, proj_id, doc_type, user):
        if not _is_valid_doc_type(doc_type):
            return self._send_json(400, {"ok": False, "error": "doc_type inválido"})
        if user.get("r") not in ("admin",):
            return self._send_json(403, {"ok": False, "error": "Solo admin puede eliminar documentos"})
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        # ADV-04: no permitir eliminar documentos aprobados o en revisión (integridad GxP)
        doc = db.execute(
            "SELECT status FROM documents WHERE project_id=? AND doc_type=?",
            (proj_id, doc_type)
        ).fetchone()
        if not doc:
            return self._send_json(404, {"ok": False, "error": "Documento no encontrado"})
        if doc["status"] in ("approved", "for_review"):
            return self._send_json(409, {
                "ok": False,
                "error": f"No se puede eliminar un documento en estado '{doc['status']}'. Regulación GxP requiere retención de registros."
            })
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

    def _api_doc_sign(self, proj_id, doc_type, user):
        """Verifica PIN del cliente y registra firma con audit hash del contenido."""
        if user.get("r") != "client":
            return self._send_json(403, {"ok": False, "error": "Solo usuarios cliente pueden firmar con PIN"})

        # A-2: rate limit — máx 5 intentos de firma por IP por minuto (protección PIN brute-force)
        ip = self._get_client_ip()
        if not _rate_limit(_SIGN_ATTEMPTS, f"sign:{ip}", 5):
            return self._send_json(429, {"ok": False, "error": "Demasiados intentos. Esperá un minuto."})

        data = self._read_json_body()
        if data is None:
            return
        pin = str(data.get("pin", "")).strip()
        role_label = str(data.get("role_label", "Firmante")).strip()[:200]
        if not pin:
            return self._send_json(400, {"ok": False, "error": "pin requerido"})

        db = _get_db()
        username = user.get("u", "")

        # Verificar nivel de acceso "sign"
        access = db.execute("""
            SELECT pa.access_level FROM project_access pa
            INNER JOIN users u ON u.id = pa.user_id
            WHERE u.username=? AND pa.project_id=?
        """, (username, proj_id)).fetchone()
        if not access:
            return self._send_json(403, {"ok": False, "error": "Sin acceso a este proyecto"})
        if access["access_level"] != "sign":
            return self._send_json(403, {"ok": False, "error": "Se requiere access_level='sign' para firmar"})

        # Verificar PIN con lockout de cuenta (igual que login)
        cu = db.execute(
            "SELECT id, pin_hash, display_name, failed_attempts, locked_until FROM users WHERE username=?",
            (username,)
        ).fetchone()
        now_pin = time.time()
        if not cu or not cu["pin_hash"]:
            return self._send_json(401, {"ok": False, "error": "PIN incorrecto"})
        if (cu["locked_until"] or 0) > now_pin:
            mins_left = int((cu["locked_until"] - now_pin) / 60) + 1
            return self._send_json(429, {"ok": False, "error": f"Cuenta bloqueada. Intentá en {mins_left} minuto{'s' if mins_left != 1 else ''}.", "locked_until": cu["locked_until"]})
        if not _pbkdf2_verify(pin, cu["pin_hash"]):
            new_attempts = (cu["failed_attempts"] or 0) + 1
            if new_attempts >= _MAX_FAILED_LOGINS:
                new_locked = now_pin + _LOCKOUT_SECONDS
                db.execute("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?", (new_attempts, new_locked, cu["id"]))
                db.execute("INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at) VALUES (?, ?, ?, 'sign_lockout', ?, ?, ?)",
                           (proj_id, doc_type, username, f"Cuenta bloqueada tras {new_attempts} intentos fallidos de PIN en firma", ip, now_pin))
            else:
                db.execute("UPDATE users SET failed_attempts=? WHERE id=?", (new_attempts, cu["id"]))
                db.execute("INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at) VALUES (?, ?, ?, 'sign_pin_failed', ?, ?, ?)",
                           (proj_id, doc_type, username, f"PIN incorrecto en firma, intento {new_attempts}/{_MAX_FAILED_LOGINS}", ip, now_pin))
            return self._send_json(401, {"ok": False, "error": "PIN incorrecto"})
        # PIN correcto — resetear contador
        db.execute("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?", (cu["id"],))

        # M-4: lectura del doc + insert de firma en transacción atómica (IMMEDIATE lock)
        # evita TOCTOU: el documento no puede ser modificado entre la lectura del hash y la firma
        db.execute("BEGIN IMMEDIATE")
        try:
            doc = db.execute(
                "SELECT json_data, status FROM documents WHERE project_id=? AND doc_type=?",
                (proj_id, doc_type)
            ).fetchone()
            if not doc:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Documento no encontrado"})
            # NEW-12: solo se puede firmar un documento que esté en estado 'for_review'
            if doc["status"] != "for_review":
                db.execute("ROLLBACK")
                return self._send_json(409, {
                    "ok": False,
                    "error": f"El documento está en estado '{doc['status']}'. Solo se puede firmar en estado 'for_review'."
                })
            # LO1-FIX: idempotencia — previene firma duplicada (21 CFR Part 11 — registro regulado único por firmante)
            existing_sig = db.execute(
                "SELECT id FROM document_signatures WHERE project_id=? AND doc_type=? AND username=?",
                (proj_id, doc_type, username)
            ).fetchone()
            if existing_sig:
                db.execute("ROLLBACK")
                # ALCOA+: registrar intento rechazado fuera de la tx revertida (autocommit post-ROLLBACK)
                db.execute(
                    "INSERT INTO audit_events"
                    " (project_id, doc_type, username, action, detail, ip, created_at)"
                    " VALUES (?, ?, ?, 'doc_sign_pin_rejected_duplicate', ?, ?, ?)",
                    (proj_id, doc_type, username,
                     f"Intento de firma duplicada rechazado — '{doc_type}' ya firmado por este usuario",
                     ip, time.time())
                )
                return self._send_json(409, {"ok": False, "error": "Ya firmaste este documento"})

            ip = self._get_client_ip()
            signed_at = time.time()
            doc_hash = hashlib.sha256(doc["json_data"].encode("utf-8")).hexdigest()
            # VULN-08: HMAC con clave — no recalculable sin _AUDIT_HMAC_KEY
            audit_hash = _make_audit_hash(f"{doc_hash}|{username}|{signed_at}|{ip}")

            db.execute("""
                INSERT INTO document_signatures
                  (project_id, doc_type, username, display_name, role_label,
                   audit_hash, ip, signed_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                proj_id, doc_type, username,
                cu["display_name"] or username, role_label,
                audit_hash, ip, signed_at, signed_at
            ))
            # ALCOA+: firma con PIN en audit_events (21 CFR Part 11 §11.200 — firma electrónica)
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, 'doc_sign_pin', ?, ?, ?)
            """, (proj_id, doc_type, username,
                  f"Firmó documento '{doc_type}' con PIN (rol: {role_label}, audit_hash: {audit_hash[:16]}...)",
                  ip, signed_at))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
        return self._send_json(200, {
            "ok": True,
            "audit_hash": audit_hash,
            "signed_at": signed_at,
            "username": username,
            "display_name": cu["display_name"] or username,
            "role_label": role_label,
        })

    def _api_doc_signatures_list(self, proj_id, doc_type, user):
        """Lista las firmas de un documento. Requiere acceso (read o sign)."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        rows = db.execute("""
            SELECT id, username, display_name, role_label, audit_hash, ip, signed_at
            FROM document_signatures
            WHERE project_id=? AND doc_type=?
            ORDER BY signed_at ASC
        """, (proj_id, doc_type)).fetchall()
        return self._send_json(200, {"ok": True, "signatures": [dict(r) for r in rows]})

    def _api_doc_comments_list(self, proj_id, doc_type, user):
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        role = user.get("r")
        # Revisión individual: cada revisor ve solo sus propios comentarios.
        # Admin y auditor ven todos.
        if role in ("admin", "auditor"):
            rows = db.execute("""
                SELECT id, username, display_name, body, section_ref, created_at
                FROM doc_comments WHERE project_id=? AND doc_type=?
                ORDER BY created_at ASC
            """, (proj_id, doc_type)).fetchall()
        else:
            rows = db.execute("""
                SELECT id, username, display_name, body, section_ref, created_at
                FROM doc_comments WHERE project_id=? AND doc_type=? AND username=?
                ORDER BY created_at ASC
            """, (proj_id, doc_type, user.get("u"))).fetchall()
        return self._send_json(200, {"ok": True, "comments": [dict(r) for r in rows]})

    def _api_doc_comment_add(self, proj_id, doc_type, user):
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        data = self._read_json_body()
        if data is None:
            return
        body = str(data.get("body", "")).strip()
        if not body:
            return self._send_json(400, {"ok": False, "error": "body requerido"})
        if len(body) > 2000:
            return self._send_json(400, {"ok": False, "error": "Comentario demasiado largo (máx 2000 caracteres)"})
        section_ref = str(data.get("section_ref", "")).strip()[:200] or None
        username = user.get("u", "")
        display_name = user.get("d", username)
        now = time.time()
        cur = db.execute("""
            INSERT INTO doc_comments (project_id, doc_type, username, display_name, body, section_ref, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (proj_id, doc_type, username, display_name, body, section_ref, now))
        return self._send_json(200, {"ok": True, "comment": {
            "id": cur.lastrowid,
            "username": username,
            "display_name": display_name,
            "body": body,
            "section_ref": section_ref,
            "created_at": now,
        }})

    # ── Signing Rounds ────────────────────────────────────────────────────────

    def _signing_rounds_list(self, proj_id, user):
        """Lista rondas del proyecto. Admin ve todas; revisor ve solo las suyas."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        role = user.get("r")
        username = user.get("u")
        if role in ("admin", "auditor"):
            rounds = db.execute("""
                SELECT sr.*, COUNT(srs.id) AS total_signers,
                       SUM(CASE WHEN srs.signed_at IS NOT NULL THEN 1 ELSE 0 END) AS signed_count,
                       SUM(CASE WHEN srs.revision_requested_at IS NOT NULL THEN 1 ELSE 0 END) AS revision_count
                FROM signing_rounds sr
                LEFT JOIN signing_round_signers srs ON srs.round_id = sr.id
                WHERE sr.project_id=?
                GROUP BY sr.id
                ORDER BY sr.created_at DESC
            """, (proj_id,)).fetchall()
        else:
            rounds = db.execute("""
                SELECT sr.*, COUNT(srs2.id) AS total_signers,
                       SUM(CASE WHEN srs2.signed_at IS NOT NULL THEN 1 ELSE 0 END) AS signed_count,
                       SUM(CASE WHEN srs2.revision_requested_at IS NOT NULL THEN 1 ELSE 0 END) AS revision_count,
                       me.signed_at AS my_signed_at,
                       me.revision_requested_at AS my_revision_at,
                       me.role_label AS my_role
                FROM signing_rounds sr
                INNER JOIN signing_round_signers me ON me.round_id = sr.id AND me.username=?
                LEFT JOIN signing_round_signers srs2 ON srs2.round_id = sr.id
                WHERE sr.project_id=? AND sr.status='open'
                GROUP BY sr.id
                ORDER BY sr.created_at DESC
            """, (username, proj_id)).fetchall()
        return self._send_json(200, {"ok": True, "rounds": [dict(r) for r in rounds]})

    def _signing_round_get(self, proj_id, round_id, user):
        """Detalle de una ronda. Revisores ven solo su propia fila de firmantes."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        rnd = db.execute(
            "SELECT * FROM signing_rounds WHERE id=? AND project_id=?",
            (round_id, proj_id)
        ).fetchone()
        if not rnd:
            return self._send_json(404, {"ok": False, "error": "Ronda no encontrada"})
        role = user.get("r")
        username = user.get("u")
        if role in ("admin", "auditor"):
            signers = db.execute(
                "SELECT * FROM signing_round_signers WHERE round_id=? ORDER BY id",
                (round_id,)
            ).fetchall()
        else:
            signers = db.execute(
                "SELECT * FROM signing_round_signers WHERE round_id=? AND username=?",
                (round_id, username)
            ).fetchall()
        return self._send_json(200, {
            "ok": True,
            "round": dict(rnd),
            "signers": [dict(s) for s in signers],
        })

    def _signing_round_create(self, proj_id, user):
        """Crea una ronda de firma. Solo admin."""
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Requiere rol admin"})
        db = _get_db()
        data = self._read_json_body()
        if data is None:
            return
        doc_type = str(data.get("doc_type", "")).strip().upper()
        signers  = data.get("signers", [])
        if not doc_type:
            return self._send_json(400, {"ok": False, "error": "doc_type requerido"})
        if not signers or not isinstance(signers, list):
            return self._send_json(400, {"ok": False, "error": "signers requerido (array)"})

        # Verificar que el documento existe
        doc = db.execute(
            "SELECT json_data, version, status FROM documents WHERE project_id=? AND doc_type=?",
            (proj_id, doc_type)
        ).fetchone()
        if not doc:
            return self._send_json(404, {"ok": False, "error": "Documento no encontrado"})
        # LO3-FIX: documentos aprobados son inmutables bajo GxP — bloquear reapertura
        if doc["status"] == "approved":
            return self._send_json(409, {"ok": False, "error": "No se puede crear una ronda de firma para un documento ya aprobado"})

        # ADV-15: verificar que todos los firmantes existen en el sistema
        # Un solo SELECT con IN en lugar de 1 query por firmante (evita N+1).
        _signer_names = [
            str(s.get("username", "")).strip()
            for s in signers[:50]
            if str(s.get("username", "")).strip()
        ]
        if _signer_names:
            # SECURITY REVIEW [2026-06-24]: _ph contains only '?' characters built from
            # len(_signer_names) — no user input interpolated. Reviewed and confirmed safe.
            # Pattern is parameterized at execution.
            _ph = ",".join("?" * len(_signer_names))
            _user_map = {
                r["username"]: r
                for r in db.execute(
                    f"SELECT username, id, display_name FROM users "
                    f"WHERE username IN ({_ph}) AND is_active=1",
                    _signer_names,
                ).fetchall()
            }
        else:
            _user_map = {}

        valid_signers = []
        _seen_signers = set()
        for s in signers[:50]:
            s_username = str(s.get("username", "")).strip()
            s_role     = str(s.get("role_label", "Revisor")).strip()[:200]
            if not s_username or s_username in _seen_signers:
                continue
            _seen_signers.add(s_username)
            u_row = _user_map.get(s_username)
            if not u_row:
                return self._send_json(400, {
                    "ok": False,
                    "error": f"El usuario '{s_username}' no existe o no está activo en el sistema."
                })
            valid_signers.append({"username": s_username, "display": u_row["display_name"] or s_username, "role": s_role})

        if not valid_signers:
            return self._send_json(400, {"ok": False, "error": "signers requerido (array con al menos un firmante válido)"})

        doc_hash = hashlib.sha256(doc["json_data"].encode("utf-8")).hexdigest()
        now = time.time()
        round_id = str(uuid.uuid4())

        # ADV-07: BEGIN IMMEDIATE para hacer atómica la verificación de ronda + creación
        db.execute("BEGIN IMMEDIATE")
        try:
            existing = db.execute(
                "SELECT id FROM signing_rounds WHERE project_id=? AND doc_type=? AND status='open'",
                (proj_id, doc_type)
            ).fetchone()
            if existing:
                db.execute("ROLLBACK")
                return self._send_json(409, {"ok": False, "error": "Ya existe una ronda abierta para este documento"})
            # LO3-FIX: re-verificar dentro del lock para descartar race condition (TOCTOU)
            _doc_status = db.execute(
                "SELECT status FROM documents WHERE project_id=? AND doc_type=?",
                (proj_id, doc_type)
            ).fetchone()
            if not _doc_status or _doc_status["status"] == "approved":
                db.execute("ROLLBACK")
                return self._send_json(409, {"ok": False, "error": "No se puede crear una ronda de firma para un documento ya aprobado"})

            db.execute("""
                INSERT INTO signing_rounds
                  (id, project_id, doc_type, doc_version, doc_hash, status, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
            """, (round_id, proj_id, doc_type, doc["version"] or 1, doc_hash, user.get("u"), now))

            # Bloquear documento → for_review
            db.execute(
                "UPDATE documents SET status='for_review', updated_at=? WHERE project_id=? AND doc_type=?",
                (now, proj_id, doc_type)
            )

            for s in valid_signers:
                db.execute("""
                    INSERT INTO signing_round_signers (round_id, username, display_name, role_label)
                    VALUES (?, ?, ?, ?)
                """, (round_id, s["username"], s["display"], s["role"]))

            # ADV-19: audit trail de creación de ronda de firma
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, 'signing_round_create', ?, ?, ?)
            """, (proj_id, doc_type, user.get("u"),
                  f"Ronda {round_id} creada con {len(valid_signers)} firmante(s)",
                  self._get_client_ip(), now))

            db.execute("COMMIT")
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise

        # Notificar a los firmantes por email (async — no bloquea la respuesta)
        _notify_round_created(proj_id, doc_type, round_id, user.get("d") or user.get("u"))
        return self._send_json(200, {"ok": True, "round_id": round_id})

    def _signing_round_sign(self, proj_id, round_id, user):
        """Firma un revisor con su PIN."""
        if not _is_valid_proj_id(proj_id) or not _is_valid_uuid(round_id):
            return self._send_json(404, {"ok": False, "error": "Ronda no encontrada"})
        if user.get("r") != "client":
            return self._send_json(403, {"ok": False, "error": "Solo revisores pueden firmar aquí"})

        # A-2: rate limit — máx 5 intentos de firma por IP por minuto
        ip = self._get_client_ip()
        if not _rate_limit(_SIGN_ATTEMPTS, f"sign:{ip}", 5):
            return self._send_json(429, {"ok": False, "error": "Demasiados intentos. Esperá un minuto."})

        db = _get_db()
        # Verificar acceso al proyecto antes de revelar si la ronda existe (previene IDOR informativo)
        if not self._assert_project_access(db, user, proj_id):
            return
        data = self._read_json_body()
        if data is None:
            return
        pin = str(data.get("pin", "")).strip()
        if not pin:
            return self._send_json(400, {"ok": False, "error": "pin requerido"})

        username = user.get("u")

        # Pre-check de acceso antes del lock (falla rápido sin cargar la DB bajo lock)
        rnd_pre = db.execute(
            "SELECT id FROM signing_rounds WHERE id=? AND project_id=? AND status='open'",
            (round_id, proj_id)
        ).fetchone()
        if not rnd_pre:
            return self._send_json(404, {"ok": False, "error": "Ronda no encontrada o ya cerrada"})

        # Verificar PIN ANTES del lock (operación lenta ~300ms — no mantener lock durante PBKDF2)
        cu = db.execute(
            "SELECT id, pin_hash, failed_attempts, locked_until FROM users WHERE username=?",
            (username,)
        ).fetchone()
        now = time.time()
        if not cu or not cu["pin_hash"]:
            return self._send_json(401, {"ok": False, "error": "PIN incorrecto"})
        if (cu["locked_until"] or 0) > now:
            mins_left = int((cu["locked_until"] - now) / 60) + 1
            return self._send_json(429, {"ok": False, "error": f"Cuenta bloqueada. Intentá en {mins_left} minuto{'s' if mins_left != 1 else ''}.", "locked_until": cu["locked_until"]})
        if not _pbkdf2_verify(pin, cu["pin_hash"]):
            new_attempts = (cu["failed_attempts"] or 0) + 1
            if new_attempts >= _MAX_FAILED_LOGINS:
                new_locked = now + _LOCKOUT_SECONDS
                db.execute("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?", (new_attempts, new_locked, cu["id"]))
                db.execute("INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at) VALUES (NULL, NULL, ?, 'sign_lockout', ?, ?, ?)",
                           (username, f"Cuenta bloqueada tras {new_attempts} intentos fallidos de PIN en firma", ip, now))
            else:
                db.execute("UPDATE users SET failed_attempts=? WHERE id=?", (new_attempts, cu["id"]))
                db.execute("INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at) VALUES (NULL, NULL, ?, 'sign_pin_failed', ?, ?, ?)",
                           (username, f"PIN incorrecto en firma, intento {new_attempts}/{_MAX_FAILED_LOGINS}", ip, now))
            return self._send_json(401, {"ok": False, "error": "PIN incorrecto"})
        # PIN correcto — resetear contador de intentos
        db.execute("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?", (cu["id"],))

        # VULN-05: BEGIN IMMEDIATE — previene doble-firma por concurrencia (check + update atómico)
        now = time.time()
        db.execute("BEGIN IMMEDIATE")
        try:
            rnd = db.execute(
                "SELECT * FROM signing_rounds WHERE id=? AND project_id=? AND status='open'",
                (round_id, proj_id)
            ).fetchone()
            if not rnd:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Ronda no encontrada o ya cerrada"})

            signer = db.execute(
                "SELECT * FROM signing_round_signers WHERE round_id=? AND username=?",
                (round_id, username)
            ).fetchone()
            if not signer:
                db.execute("ROLLBACK")
                return self._send_json(403, {"ok": False, "error": "No estás en la lista de firmantes de esta ronda"})
            if signer["signed_at"]:
                db.execute("ROLLBACK")
                return self._send_json(409, {"ok": False, "error": "Ya firmaste este documento"})
            if signer["revision_requested_at"]:
                db.execute("ROLLBACK")
                return self._send_json(409, {"ok": False, "error": "Ya solicitaste revisión — no podés firmar"})

            audit_hash = _make_audit_hash(f"{rnd['doc_hash']}|{username}|{now}|{ip}")
            db.execute("""
                UPDATE signing_round_signers
                SET signed_at=?, audit_hash=?, ip=?
                WHERE round_id=? AND username=?
            """, (now, audit_hash, ip, round_id, username))
            # ALCOA+: acción de firma electrónica en audit_events (21 CFR Part 11 §11.10(e))
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, 'signing_round_sign', ?, ?, ?)
            """, (proj_id, rnd["doc_type"], username,
                  f"Firmó documento '{rnd['doc_type']}' en ronda {round_id} (audit_hash: {audit_hash[:16]}...)",
                  ip, now))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
        return self._send_json(200, {"ok": True, "audit_hash": audit_hash, "signed_at": now})

    def _signing_round_request_revision(self, proj_id, round_id, user):
        """Revisor solicita cambios. Cancela la ronda y avisa al admin."""
        if user.get("r") != "client":
            return self._send_json(403, {"ok": False, "error": "Solo revisores pueden solicitar revisión"})
        # NEW-02: rate limit en request-revision (igual que firma con PIN — protección brute-force)
        ip = self._get_client_ip()
        if not _rate_limit(_SIGN_ATTEMPTS, f"sign:{ip}", 5):
            return self._send_json(429, {"ok": False, "error": "Demasiados intentos. Esperá un minuto."})
        db = _get_db()
        # Verificar acceso al proyecto antes de revelar si la ronda existe (previene IDOR informativo)
        if not self._assert_project_access(db, user, proj_id):
            return
        data = self._read_json_body()
        if data is None:
            return
        pin    = str(data.get("pin", "")).strip()
        reason = str(data.get("reason", "")).strip()[:2000]
        if not pin:
            return self._send_json(400, {"ok": False, "error": "pin requerido"})
        if not reason:
            return self._send_json(400, {"ok": False, "error": "Debés indicar el motivo de la revisión"})

        username = user.get("u")

        # Pre-check sin lock (falla rápido)
        rnd_pre = db.execute(
            "SELECT id FROM signing_rounds WHERE id=? AND project_id=? AND status='open'",
            (round_id, proj_id)
        ).fetchone()
        if not rnd_pre:
            return self._send_json(404, {"ok": False, "error": "Ronda no encontrada o ya cerrada"})

        signer_pre = db.execute(
            "SELECT signed_at FROM signing_round_signers WHERE round_id=? AND username=?",
            (round_id, username)
        ).fetchone()
        if not signer_pre:
            return self._send_json(403, {"ok": False, "error": "No estás en la lista de firmantes"})
        if signer_pre["signed_at"]:
            return self._send_json(409, {"ok": False, "error": "Ya firmaste — no podés solicitar revisión"})

        # Verificar PIN ANTES del lock (PBKDF2 ~300ms — no mantener lock durante esto)
        cu = db.execute("SELECT pin_hash FROM users WHERE username=?", (username,)).fetchone()
        if not cu or not cu["pin_hash"] or not _pbkdf2_verify(pin, cu["pin_hash"]):
            return self._send_json(401, {"ok": False, "error": "PIN incorrecto"})

        now = time.time()

        # ADV-06: BEGIN IMMEDIATE para evitar race condition sign/request-revision concurrente
        db.execute("BEGIN IMMEDIATE")
        try:
            rnd = db.execute(
                "SELECT * FROM signing_rounds WHERE id=? AND project_id=? AND status='open'",
                (round_id, proj_id)
            ).fetchone()
            if not rnd:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Ronda no encontrada o ya cerrada"})

            signer = db.execute(
                "SELECT * FROM signing_round_signers WHERE round_id=? AND username=?",
                (round_id, username)
            ).fetchone()
            if not signer:
                db.execute("ROLLBACK")
                return self._send_json(403, {"ok": False, "error": "No estás en la lista de firmantes"})
            if signer["signed_at"]:
                db.execute("ROLLBACK")
                return self._send_json(409, {"ok": False, "error": "Ya firmaste — no podés solicitar revisión"})
            if signer["revision_requested_at"]:
                db.execute("ROLLBACK")
                return self._send_json(409, {"ok": False, "error": "Ya solicitaste revisión anteriormente"})

            # VULN-07: si la mayoría ya firmó, no cancelar automáticamente.
            all_signers = db.execute(
                "SELECT * FROM signing_round_signers WHERE round_id=?", (round_id,)
            ).fetchall()
            total = len(all_signers)
            signed_count = sum(1 for s in all_signers if s["signed_at"])
            majority_signed = total > 1 and signed_count >= (total // 2 + 1)

            db.execute("""
                UPDATE signing_round_signers
                SET revision_requested_at=?, revision_reason=?, ip=?
                WHERE round_id=? AND username=?
            """, (now, reason, ip, round_id, username))

            if majority_signed:
                action_label = "revision_requested_majority"
                db.execute("""
                    INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (proj_id, rnd["doc_type"], username, action_label,
                      f"ALERTA: {signed_count}/{total} firmantes ya aprobaron. Revisión solicitada por {username}: {reason}",
                      ip, now))
                db.execute("COMMIT")
                _notify_revision_requested(proj_id, rnd["doc_type"], user.get("d") or username,
                                           f"[ALERTA: {signed_count}/{total} ya firmaron] {reason}")
                return self._send_json(200, {
                    "ok": True,
                    "warning": "Tu solicitud fue registrada. Dado que la mayoría ya firmó, el admin decidirá si procede la revisión."
                })

            # Minoría firmó: cancelar la ronda
            db.execute("""
                UPDATE signing_rounds SET status='cancelled', cancelled_at=?, cancel_reason=?
                WHERE id=?
            """, (now, f"{username}: {reason}", round_id))
            db.execute(
                "UPDATE documents SET status='needs_revision', updated_at=? WHERE project_id=? AND doc_type=?",
                (now, proj_id, rnd["doc_type"])
            )
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, 'revision_requested', ?, ?, ?)
            """, (proj_id, rnd["doc_type"], username, reason, ip, now))
            db.execute("COMMIT")
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise
        _notify_revision_requested(proj_id, rnd["doc_type"], user.get("d") or username, reason)
        return self._send_json(200, {"ok": True})

    def _signing_round_seal(self, proj_id, round_id, user):
        """Sella una ronda cuando todos firmaron. Solo admin."""
        if user.get("r") != "admin":
            return self._send_json(403, {"ok": False, "error": "Requiere rol admin"})
        db = _get_db()

        # M-4: toda la operación de sellado bajo una transacción IMMEDIATE
        # — previene que dos admins conurrentes sellen la misma ronda dos veces
        db.execute("BEGIN IMMEDIATE")
        try:
            rnd = db.execute(
                "SELECT * FROM signing_rounds WHERE id=? AND project_id=? AND status='open'",
                (round_id, proj_id)
            ).fetchone()
            if not rnd:
                db.execute("ROLLBACK")
                return self._send_json(404, {"ok": False, "error": "Ronda no encontrada o ya cerrada"})

            signers = db.execute(
                "SELECT * FROM signing_round_signers WHERE round_id=? ORDER BY id",
                (round_id,)
            ).fetchall()
            # NEW-04: bloquear sellado si algún firmante tiene una objeción activa (revision_requested)
            with_revision = [s for s in signers if s["revision_requested_at"]]
            if with_revision:
                db.execute("ROLLBACK")
                return self._send_json(409, {
                    "ok": False,
                    "error": f"{len(with_revision)} firmante(s) solicitaron revisión: {', '.join(s['display_name'] or s['username'] for s in with_revision)}. Resolvé la objeción antes de sellar."
                })
            pending = [s for s in signers if not s["signed_at"]]
            if pending:
                db.execute("ROLLBACK")
                return self._send_json(409, {
                    "ok": False,
                    "error": f"Faltan {len(pending)} firmante(s): {', '.join(s['display_name'] or s['username'] for s in pending)}"
                })

            now = time.time()
            last_block = db.execute(
                "SELECT block_hash FROM validation_book_blocks WHERE project_id=? ORDER BY block_number DESC LIMIT 1",
                (proj_id,)
            ).fetchone()
            prev_hash = last_block["block_hash"] if last_block else "0" * 64

            block_payload = {
                "project_id": proj_id,
                "round_id": round_id,
                "doc_type": rnd["doc_type"],
                "doc_version": rnd["doc_version"],
                "doc_hash": rnd["doc_hash"],
                "sealed_at": now,
                "sealed_by": user.get("u"),
                "prev_block_hash": prev_hash,
                "signers": [dict(s) for s in signers],
            }
            block_json = json.dumps(block_payload, sort_keys=True)
            # VULN-08: HMAC con clave — el Validation Book no puede ser falsificado sin la clave
            seal_hash = _make_audit_hash(f"{prev_hash}|{block_json}")

            # VULN-16: usar MAX(block_number) en lugar de COUNT(*) para evitar colisión
            # en sellados concurrentes de distintos documentos del mismo proyecto
            max_row = db.execute(
                "SELECT COALESCE(MAX(block_number), 0) AS m FROM validation_book_blocks WHERE project_id=?",
                (proj_id,)
            ).fetchone()
            block_num = max_row["m"] + 1

            db.execute("""
                INSERT INTO validation_book_blocks
                  (project_id, round_id, block_number, doc_type, doc_version,
                   doc_hash, block_hash, prev_block_hash, block_json, sealed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (proj_id, round_id, block_num, rnd["doc_type"], rnd["doc_version"],
                  rnd["doc_hash"], seal_hash, prev_hash, block_json, now))

            db.execute("""
                UPDATE signing_rounds SET status='sealed', sealed_at=?, seal_hash=?, prev_block_hash=?
                WHERE id=?
            """, (now, seal_hash, prev_hash, round_id))
            db.execute(
                "UPDATE documents SET status='approved', updated_at=? WHERE project_id=? AND doc_type=?",
                (now, proj_id, rnd["doc_type"])
            )
            # ADV-19: audit trail de sellado de ronda (acción regulatoria crítica)
            db.execute("""
                INSERT INTO audit_events (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, 'signing_round_seal', ?, ?, ?)
            """, (proj_id, rnd["doc_type"], user.get("u"),
                  f"Ronda {round_id} sellada — bloque #{block_num} en Validation Book (hash: {seal_hash[:16]}...)",
                  self._get_client_ip(), now))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
        return self._send_json(200, {"ok": True, "seal_hash": seal_hash, "block_number": block_num})

    def _api_pending_signatures(self, user):
        """Retorna todas las rondas abiertas donde el revisor tiene firma pendiente."""
        if user.get("r") != "client":
            return self._send_json(403, {"ok": False, "error": "Solo revisores"})
        db = _get_db()
        username = user.get("u")
        rows = db.execute("""
            SELECT sr.id AS round_id, sr.project_id, sr.doc_type, sr.doc_version,
                   sr.created_at, p.name AS project_name,
                   srs.role_label, srs.signed_at, srs.revision_requested_at
            FROM signing_round_signers srs
            INNER JOIN signing_rounds sr ON sr.id = srs.round_id AND sr.status='open'
            INNER JOIN projects p ON p.id = sr.project_id
            INNER JOIN project_access pa ON pa.project_id = sr.project_id
            INNER JOIN users u ON u.id = pa.user_id AND u.username=?
            WHERE srs.username=?
            ORDER BY sr.created_at ASC
        """, (username, username)).fetchall()
        return self._send_json(200, {"ok": True, "pending": [dict(r) for r in rows]})

    def _admin_review_activity(self, user):
        """Dashboard de actividad de revisión para el admin."""
        if user.get("r") not in ("admin", "auditor"):
            return self._send_json(403, {"ok": False, "error": "Requiere admin o auditor"})
        db = _get_db()
        # Rondas abiertas con progreso
        rounds = db.execute("""
            SELECT sr.id, sr.project_id, sr.doc_type, sr.doc_version, sr.status,
                   sr.created_at, sr.sealed_at, p.name AS project_name,
                   COUNT(srs.id) AS total_signers,
                   SUM(CASE WHEN srs.signed_at IS NOT NULL THEN 1 ELSE 0 END) AS signed_count,
                   SUM(CASE WHEN srs.revision_requested_at IS NOT NULL THEN 1 ELSE 0 END) AS revision_count
            FROM signing_rounds sr
            INNER JOIN projects p ON p.id = sr.project_id
            LEFT JOIN signing_round_signers srs ON srs.round_id = sr.id
            GROUP BY sr.id
            ORDER BY sr.created_at DESC
            LIMIT 100
        """).fetchall()
        # Últimas solicitudes de revisión
        revision_requests = db.execute("""
            SELECT ae.project_id, ae.doc_type, ae.username, ae.detail, ae.created_at,
                   p.name AS project_name
            FROM audit_events ae
            INNER JOIN projects p ON p.id = ae.project_id
            WHERE ae.action='revision_requested'
            ORDER BY ae.created_at DESC
            LIMIT 50
        """).fetchall()
        return self._send_json(200, {
            "ok": True,
            "rounds": [dict(r) for r in rounds],
            "revision_requests": [dict(r) for r in revision_requests],
        })

    def _validation_book_get(self, proj_id, user):
        """Retorna todos los bloques sellados del libro de validación."""
        db = _get_db()
        if not self._assert_project_access(db, user, proj_id):
            return
        blocks = db.execute("""
            SELECT * FROM validation_book_blocks WHERE project_id=? ORDER BY block_number ASC
        """, (proj_id,)).fetchall()
        return self._send_json(200, {"ok": True, "blocks": [dict(b) for b in blocks]})

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
        elif path in ("/client", "/client/"):
            path = "/client/index.html"

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
        _add_sec_headers(self, html=(ext == ".html"))
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
        if path == "/health":
            try:
                _get_db().execute("SELECT 1").fetchone()
                db_ok = True
            except Exception:
                db_ok = False
            status  = "ok" if db_ok else "db_error"
            code    = 200  if db_ok else 503
            return self._send_json(code, {"status": status, "service": "smart-validation"})

        if path in ("/login", "/login.html"):
            if _is_auth_required() and _check_auth(self):
                self.send_response(302)
                self.send_header("Location", "/")
                self.end_headers()
                return
            return self._serve_login_page()

        if path == "/auth/session":
            user = _check_auth(self)
            if not user:
                return self._send_json(401, {"ok": False, "error": "No autenticado"})
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
                return self._send_json(404, {"error": "Sesion no encontrada o expirada"})
            return self._send_json(200, {
                "token": token,
                "session_data": sess["session_data"],
                "photos_count": len(sess["photos"]),
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
                return self._send_json(404, {"error": "Sesion no encontrada"})
            new_photos = [p for p in sess["photos"] if p["uploaded_at"] > since]
            return self._send_json(200, {"photos": new_photos, "server_time": time.time()})

        if path.startswith("/sync/signature/"):
            token = path[len("/sync/signature/"):]
            cleanup_expired_signatures()
            entry = SIGNATURES.get(token)
            if not entry:
                return self._send_json(404, {"error": "Token no encontrado o expirado"})
            return self._send_json(200, {
                "token": token,
                "firmaImage": entry.get("firmaImage"),
                "received_at": entry.get("received_at"),
            })

        # ── Verificar autenticación para el resto ────────────────────────────
        user = _check_auth(self)
        if _is_auth_required():
            if not user:
                if path in ("/", "", "/client", "/client/") or path.endswith(".html"):
                    return self._redirect_to_login()
                return self._send_json(401, {"ok": False, "error": "No autenticado"})
            if user.get("__superseded"):
                if path in ("/", "", "/client", "/client/") or path.endswith(".html"):
                    return self._redirect_to_login()
                return self._send_json(401, {"ok": False, "error": "Sesión reemplazada. Iniciá sesión nuevamente.", "code": "SUPERSEDED"})

        # ── Route guard por rol ───────────────────────────────────────────────
        # Clientes: solo pueden acceder a /client/* (no a la app principal)
        if user and user.get("r") == "client":
            is_html = path in ("/", "") or (path.endswith(".html") and not path.startswith("/client/"))
            if is_html:
                self.send_response(302)
                self.send_header("Location", "/client/")
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
        m = _RE_PROJ_DOC_SIGS.match(path)
        if m:
            return self._api_doc_signatures_list(m.group(1), m.group(2), user)
        m = _RE_PROJ_DOC_COMMENTS.match(path)
        if m:
            return self._api_doc_comments_list(m.group(1), m.group(2), user)
        m = _RE_SIGNING_ROUNDS.match(path)
        if m:
            return self._signing_rounds_list(m.group(1), user)
        m = _RE_SIGNING_ROUND_ID.match(path)
        if m:
            return self._signing_round_get(m.group(1), m.group(2), user)
        if path == "/api/me/pending-signatures":
            return self._api_pending_signatures(user)
        if path == "/admin/review-activity":
            return self._admin_review_activity(user)
        m = re.match(r'^/api/projects/([^/]+)/validation-book$', path)
        if m:
            return self._validation_book_get(m.group(1), user)
        m = _RE_PROJ_PHOTOS.match(path)
        if m:
            return self._api_photos_list(m.group(1), user)
        m = _RE_PROJ_PHOTO_ID.match(path)
        if m:
            return self._api_photo_get(m.group(1), m.group(2), user)
        m = _RE_PROJ_SNAPSHOT.match(path)
        if m:
            return self._api_snapshot_get(m.group(1), user)
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
                self.send_response(302)
                self.send_header("Location", "/login.html")
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

        # Mobile sync - sin cookie (usan token propio)
        # C-4: en prod requiere SYNC_ENABLED=true + PUBLIC_URL en el entorno
        if path.startswith("/sync/"):
            if not _SYNC_ENABLED:
                return self._send_json(403, {"ok": False, "error": "Sync no habilitado. Setear SYNC_ENABLED=true y PUBLIC_URL."})

        if path == "/sync/photo":
            return self._handle_sync_photo()
        if path == "/sync/signature":
            return self._handle_sync_signature()

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
        if _RE_NOTIFY_DESVIOS.match(path):
            return self._api_notify_desvios(user)
        m = _RE_PROJ_DOC_SIGN.match(path)
        if m:
            return self._api_doc_sign(m.group(1), m.group(2), user)
        m = _RE_PROJ_DOC_COMMENTS.match(path)
        if m:
            return self._api_doc_comment_add(m.group(1), m.group(2), user)
        m = _RE_SIGNING_ROUNDS.match(path)
        if m:
            return self._signing_round_create(m.group(1), user)
        m = _RE_SIGNING_ROUND_SIGN.match(path)
        if m:
            return self._signing_round_sign(m.group(1), m.group(2), user)
        m = _RE_SIGNING_ROUND_REV.match(path)
        if m:
            return self._signing_round_request_revision(m.group(1), m.group(2), user)
        m = _RE_SIGNING_ROUND_SEAL.match(path)
        if m:
            return self._signing_round_seal(m.group(1), m.group(2), user)
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
            SESSIONS[token] = {
                "session_data": session_data,
                "project_id": safe_project_id,
                "photos": [],
                "created_at": time.time(),
                "created_by": user.get("u", "unknown"),
            }
            best_ip = get_local_ip()
            all_ips = get_all_local_ips()
            if _PUBLIC_URL:
                url_movil = f"{_PUBLIC_URL}?mobile={token}"
            else:
                url_movil = f"http://{best_ip}:{self.server.server_port}?mobile={token}"
            return self._send_json(200, {
                "ok": True,
                "token": token,
                "ip": best_ip,
                "all_ips": all_ips,
                "url_movil": url_movil,
            })

        # ── PC registra un token para esperar firma del celular ──
        if path == "/sync/signature/register":
            data = self._read_json_body()
            if data is None:
                return
            # VULN-02: servidor genera el token; ignorar token del cliente
            token = secrets.token_urlsafe(32)
            cleanup_expired_signatures()
            SIGNATURES[token] = {
                "firmaImage": None,
                "created_at": time.time(),
                "received_at": None
            }
            return self._send_json(200, {"ok": True, "token": token})

        return self._send_json(404, {"error": "Endpoint no encontrado"})

    def _handle_sync_photo(self):
        data = self._read_json_body()
        if data is None:
            return
        token = data.get("token")
        sess = SESSIONS.get(token)
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

    def _handle_sync_signature(self):
        data = self._read_json_body()
        if data is None:
            return
        token = data.get("token")
        firma = data.get("firmaImage")
        if not token or not firma:
            return self._send_json(400, {"error": "token y firmaImage requeridos"})
        # NEW-08: validar MIME — solo imágenes permitidas, bloquear SVG/HTML/etc.
        _ALLOWED_IMG_PREFIXES = (
            "data:image/jpeg;base64,", "data:image/png;base64,",
            "data:image/webp;base64,", "data:image/gif;base64,",
        )
        if not any(firma.startswith(p) for p in _ALLOWED_IMG_PREFIXES):
            return self._send_json(400, {"error": "Formato de imagen no permitido. Solo jpeg, png, webp o gif."})
        if len(firma) > MAX_SIGNATURE_BYTES:
            return self._send_json(413, {"error": "Firma demasiado grande (max 2 MB)"})
        cleanup_expired_signatures()
        if token not in SIGNATURES:
            return self._send_json(404, {"error": "Token no registrado o expirado"})
        SIGNATURES[token]["firmaImage"] = firma
        SIGNATURES[token]["received_at"] = time.time()
        return self._send_json(200, {"ok": True})

    def do_DELETE(self):
        if self._anti_scanner():
            return
        path = urlparse(self.path).path

        # Mobile sync — no cookie required; bloqueado en producción igual que GET/POST
        if path.startswith("/sync/session/"):
            if _IS_PROD:
                return self._send_json(403, {"ok": False, "error": "Sync no disponible en producción"})
            token = path[len("/sync/session/"):]
            if token in SESSIONS:
                del SESSIONS[token]
                return self._send_json(200, {"ok": True})
            return self._send_json(404, {"error": "Sesion no encontrada"})

        # ── Verificar autenticación ───────────────────────────────────────────
        user = _check_auth(self)
        if self._require_auth(user): return

        # ── API de almacenamiento (DELETE) ────────────────────────────────────
        m = _RE_PROJ_DOC.match(path)
        if m:
            return self._api_doc_delete(m.group(1), m.group(2), user)
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
        self.send_response(405)
        self.end_headers()

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

    _db_init()
    _migrate_to_unified_users()
    _bootstrap_superadmin()
    db = _get_db()
    n_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    import db_adapter as _dba
    if _dba.USE_PG:
        print(f"  PostgreSQL: {_dba.DATABASE_URL.split('@')[-1]}")
    else:
        print(f"  SQLite: {_dba.SQLITE_PATH}")
    print(f"  Usuarios registrados: {n_users}")
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
