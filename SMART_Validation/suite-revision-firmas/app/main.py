"""
main.py — Suite de Revisión y Firmas. Servicio FastAPI independiente.

No comparte proceso, base de datos, ni sesión con server.py (Suite de
Validación) — ver docs/suite-revision-firmas-architecture.md.
"""
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config, security
from .db import get_db, init_db, release_db
from .routers import auth, book, bridge, documents, projects, signatures, users
from .routers.documents import me_router
from .routers.projects import audit_router

_HERE = os.path.dirname(os.path.abspath(__file__))
_STATIC_DIR = os.path.join(_HERE, "..", "static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    bootstrap_superadmin()
    yield


app = FastAPI(title="Suite de Revisión y Firmas", lifespan=lifespan)


@app.middleware("http")
async def _release_db_connection(request: Request, call_next):
    """En modo Postgres, get_db() ata una conexión del pool (máx 20) al thread que
    la pidió — sin este middleware nunca se devolvía al pool (release_db() estaba
    definida pero jamás invocada), así que el pool se iba agotando con el uso y las
    escrituras empezaban a fallar de forma intermitente a medida que el proceso
    acumulaba threads distintos. En SQLite release_db() es un no-op."""
    try:
        return await call_next(request)
    finally:
        release_db()


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(documents.router)
app.include_router(signatures.router)
app.include_router(projects.router)
app.include_router(audit_router)
app.include_router(book.router)
app.include_router(bridge.router)
app.include_router(me_router)

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
    esta cuenta es completamente independiente de aquella.

    Logging temporal (2026-08-30): se agregó para diagnosticar un 401 persistente
    en el primer deploy a producción, sin poder inspeccionar la tabla rf_users
    directamente desde el panel de Railway. Sacar una vez confirmado el problema."""
    print(
        f"[bootstrap] RF_SUPERADMIN_USERNAME={config.SUPERADMIN_USERNAME!r} "
        f"password_set={bool(config.SUPERADMIN_PASSWORD)} "
        f"(len={len(config.SUPERADMIN_PASSWORD)})",
        flush=True,
    )
    if not config.SUPERADMIN_USERNAME or not config.SUPERADMIN_PASSWORD:
        print("[bootstrap] omitido: falta RF_SUPERADMIN_USERNAME o RF_SUPERADMIN_PASSWORD", flush=True)
        return
    try:
        db = get_db()
        existing = db.execute(
            "SELECT id FROM rf_users WHERE username=?", (config.SUPERADMIN_USERNAME,)
        ).fetchone()
        if existing:
            print(f"[bootstrap] usuario '{config.SUPERADMIN_USERNAME}' ya existe (id={existing['id']}), omitido", flush=True)
            return
        now = time.time()
        new_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO rf_users (id, username, email, display_name, role, is_superadmin, "
            "password_hash, pin_set, is_active, created_at, updated_at) "
            "VALUES (?,?,?,?,?,1,?,0,1,?,?)",
            (
                new_id, config.SUPERADMIN_USERNAME,
                config.SUPERADMIN_EMAIL or f"{config.SUPERADMIN_USERNAME}@drpassurance.local",
                config.SUPERADMIN_DISPLAY, "drp",
                security.pbkdf2_hash(config.SUPERADMIN_PASSWORD), now, now,
            ),
        )
        db.commit()
        print(f"[bootstrap] usuario '{config.SUPERADMIN_USERNAME}' creado OK (id={new_id})", flush=True)
    except Exception:
        import traceback
        print("[bootstrap] ERROR creando el superadmin:", flush=True)
        traceback.print_exc()


@app.get("/health")
def health():
    return {"ok": True, "service": "suite-revision-firmas"}
