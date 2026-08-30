"""
main.py — Suite de Revisión y Firmas. Servicio FastAPI independiente.

No comparte proceso, base de datos, ni sesión con server.py (Suite de
Validación) — ver docs/suite-revision-firmas-architecture.md.
"""
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config, security
from .db import get_db, init_db
from .routers import auth, book, documents, projects, signatures, users
from .routers.projects import audit_router

_HERE = os.path.dirname(os.path.abspath(__file__))
_STATIC_DIR = os.path.join(_HERE, "..", "static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    bootstrap_superadmin()
    yield


app = FastAPI(title="Suite de Revisión y Firmas", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(documents.router)
app.include_router(signatures.router)
app.include_router(projects.router)
app.include_router(audit_router)
app.include_router(book.router)

app.mount("/app", StaticFiles(directory=_STATIC_DIR, html=True), name="app")

# document-renderer.js pide el logo con una ruta absoluta hardcodeada
# ("/js/validation-suite/assets/logo-drp.png") — no se toca el motor vendorizado
# (se hereda tal cual), así que se monta ese mismo path absoluto acá también.
app.mount("/js", StaticFiles(directory=os.path.join(_STATIC_DIR, "js")), name="engine-js")


@app.get("/")
def root():
    return RedirectResponse(url="/app/login.html")


def bootstrap_superadmin() -> None:
    """Crea la cuenta DRP inicial si no existe, a partir de env vars.
    Mismo patrón que SUPERADMIN_USERNAME en la Suite de Validación, pero
    esta cuenta es completamente independiente de aquella."""
    if not config.SUPERADMIN_USERNAME or not config.SUPERADMIN_PASSWORD:
        return
    db = get_db()
    existing = db.execute(
        "SELECT id FROM rf_users WHERE username=?", (config.SUPERADMIN_USERNAME,)
    ).fetchone()
    if existing:
        return
    now = time.time()
    db.execute(
        "INSERT INTO rf_users (id, username, email, display_name, role, is_superadmin, "
        "password_hash, pin_set, is_active, created_at, updated_at) "
        "VALUES (?,?,?,?,?,1,?,0,1,?,?)",
        (
            str(uuid.uuid4()), config.SUPERADMIN_USERNAME,
            config.SUPERADMIN_EMAIL or f"{config.SUPERADMIN_USERNAME}@drpassurance.local",
            config.SUPERADMIN_DISPLAY, "drp",
            security.pbkdf2_hash(config.SUPERADMIN_PASSWORD), now, now,
        ),
    )
    db.commit()


@app.get("/health")
def health():
    return {"ok": True, "service": "suite-revision-firmas"}
