"""
security.py — Hashing de credenciales y tokens de sesión firmados.

Mismo esquema PBKDF2-SHA256 / HMAC-SHA256 que server.py (Suite de Validación),
copiado para no depender del otro servicio, con secreto y cookie propios.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time

from . import config


def pbkdf2_hash(plain: str, iters: int | None = None) -> str:
    """Formato: pbkdf2_sha256$iters$salt_hex$hash_hex. Sirve tanto para password como PIN."""
    iters = config.PBKDF2_ITERS if iters is None else iters
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, iters)
    return f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"


def pbkdf2_verify(plain: str, stored: str) -> bool:
    if not stored:
        return False
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# Hash dummy pre-computado para ecualizar el tiempo de respuesta en login cuando
# el usuario no existe (evita enumeración de usernames por timing).
_DUMMY_HASH: str = pbkdf2_hash("__rf_dummy_user_invalid__")


def dummy_verify_delay() -> None:
    pbkdf2_verify("__probe__", _DUMMY_HASH)


def generate_invite_token() -> str:
    return secrets.token_urlsafe(32)


def create_token(user_id: str, username: str, display: str, role: str, is_superadmin: bool) -> tuple[str, str]:
    """Crea un token de sesión firmado. Devuelve (token, nonce)."""
    if not config.AUTH_SECRET_KEY:
        raise RuntimeError("RF_AUTH_SECRET_KEY no configurada")
    expires = int(time.time()) + config.TOKEN_EXPIRE_H * 3600
    nonce = secrets.token_hex(8)
    sa_flag = bool(is_superadmin)
    # "sa" tiene que estar dentro de lo firmado -- si no, alcanza con editar el JSON en
    # base64 (no está cifrado) para pasar de sa=false a sa=true sin invalidar la firma.
    payload_str = f"{user_id}:{username}:{role}:{int(sa_flag)}:{expires}:{nonce}"
    sig = hmac.HMAC(config.AUTH_SECRET_KEY.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
    data = json.dumps({
        "uid": user_id, "u": username, "d": display, "r": role,
        "sa": sa_flag, "e": expires, "n": nonce, "s": sig,
    })
    token = base64.urlsafe_b64encode(data.encode()).decode()
    return token, nonce


def decode_token(token: str) -> dict:
    """Verifica firma y expiración. Devuelve el payload o {} si inválido."""
    if not token or not config.AUTH_SECRET_KEY:
        return {}
    try:
        data = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        expected_sig = data.pop("s")
        payload_str = f"{data['uid']}:{data['u']}:{data['r']}:{int(bool(data['sa']))}:{data['e']}:{data['n']}"
        sig = hmac.HMAC(config.AUTH_SECRET_KEY.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return {}
        if int(data["e"]) < int(time.time()):
            return {}
        return data
    except Exception:
        return {}


def build_set_cookie(token: str) -> str:
    max_age = config.TOKEN_EXPIRE_H * 3600
    secure = "; Secure" if config.IS_PROD else ""
    same_site = "Strict" if config.IS_PROD else "Lax"
    return f"{config.COOKIE_NAME}={token}; HttpOnly{secure}; SameSite={same_site}; Max-Age={max_age}; Path=/"


def build_clear_cookie() -> str:
    return f"{config.COOKIE_NAME}=; HttpOnly; Max-Age=0; Path=/"


# ─── Fuerza bruta de PIN ────────────────────────────────────────────────────
# Sección pedida por el usuario 2026-09-01, tras detectar en auditoría que
# sign_review/sign_approval verificaban el PIN sin ningún límite -- cualquier sesión válida
# podía probar las 10.000 combinaciones de un PIN de 4 dígitos sin freno. Originalmente vivía
# solo en routers/signatures.py; movido acá (Ronda 20, 2026-09-21) porque una auditoría de
# seguridad encontró el mismo hueco sin cerrar en POST /auth/set-pin (el chequeo de
# `current_pin`, que también acepta 10.000 intentos): una sesión robada podía usar ESE
# endpoint para descubrir el PIN sin límite, y después firmar de verdad con
# sign_review/sign_approval (que sí tenían el freno) usando el PIN ya conocido -- incumpliendo
# el mismo objetivo que el freno de firma ya cumplía en apariencia. Un solo lockout por
# usuario, compartido entre ambos puntos de entrada (no dos contadores independientes con el
# doble de intentos reales disponibles).
MAX_PIN_ATTEMPTS = 5
PIN_ATTEMPT_WINDOW_S = 30 * 60
PIN_LOCKOUT_S = 30 * 60


def check_pin_lockout(db, user_id: str) -> float | None:
    """Devuelve segundos restantes de bloqueo, o None si puede intentar."""
    row = db.execute("SELECT locked_until FROM rf_pin_attempts WHERE user_id=?", (user_id,)).fetchone()
    if row and row["locked_until"] and row["locked_until"] > time.time():
        return row["locked_until"] - time.time()
    return None


def register_failed_pin(db, user_id: str) -> None:
    now = time.time()
    row = db.execute(
        "SELECT fail_count, first_fail_at FROM rf_pin_attempts WHERE user_id=?", (user_id,)
    ).fetchone()
    if row and row["first_fail_at"] and (now - row["first_fail_at"]) < PIN_ATTEMPT_WINDOW_S:
        fail_count = row["fail_count"] + 1
        first_fail_at = row["first_fail_at"]
    else:
        fail_count = 1
        first_fail_at = now
    locked_until = now + PIN_LOCKOUT_S if fail_count >= MAX_PIN_ATTEMPTS else None
    db.execute(
        "INSERT INTO rf_pin_attempts (user_id, fail_count, first_fail_at, locked_until) VALUES (?,?,?,?) "
        "ON CONFLICT(user_id) DO UPDATE SET fail_count=excluded.fail_count, "
        "first_fail_at=excluded.first_fail_at, locked_until=excluded.locked_until",
        (user_id, fail_count, first_fail_at, locked_until),
    )
    db.commit()


def clear_pin_attempts(db, user_id: str) -> None:
    db.execute("DELETE FROM rf_pin_attempts WHERE user_id=?", (user_id,))
    db.commit()
