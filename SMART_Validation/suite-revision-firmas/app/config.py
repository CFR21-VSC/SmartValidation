"""
config.py — Variables de entorno de la Suite de Revisión y Firmas.

Servicio Railway independiente de server.py (Suite de Validación). No comparte
ninguna variable de sesión/secreto con el otro servicio.
"""
import os

ENV: str = os.environ.get("ENV", "development")
IS_PROD: bool = ENV == "production"

# Firma HMAC de los tokens de sesión — debe ser distinta de AUTH_SECRET_KEY del otro servicio.
AUTH_SECRET_KEY: str = os.environ.get("RF_AUTH_SECRET_KEY", "")

TOKEN_EXPIRE_H: int = int(os.environ.get("RF_TOKEN_EXPIRE_H", "12"))
COOKIE_NAME: str = "rf_session"

# Bootstrap del primer usuario DRP (superadmin). Igual patrón que SUPERADMIN_USERNAME
# en el servicio de Validación, pero es una cuenta totalmente separada.
SUPERADMIN_USERNAME: str = os.environ.get("RF_SUPERADMIN_USERNAME", "")
SUPERADMIN_EMAIL: str = os.environ.get("RF_SUPERADMIN_EMAIL", "")
SUPERADMIN_PASSWORD: str = os.environ.get("RF_SUPERADMIN_PASSWORD", "")
SUPERADMIN_DISPLAY: str = os.environ.get("RF_SUPERADMIN_DISPLAY", "DRP Admin")

# Email transaccional (Resend) — mismo proveedor que el otro servicio, key propia opcional.
RESEND_API_KEY: str = os.environ.get("RESEND_API_KEY", "").strip()
FROM_EMAIL: str = os.environ.get("RF_FROM_EMAIL", "no-reply@drpassurance.com")

# Base URL pública de este servicio, para armar el link de invitación.
APP_BASE_URL: str = os.environ.get("RF_APP_BASE_URL", "http://localhost:8090")

INVITE_TTL_H: int = int(os.environ.get("RF_INVITE_TTL_H", "72"))
