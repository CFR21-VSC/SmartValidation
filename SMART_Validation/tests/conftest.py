"""
Fixtures compartidas para los tests de integración (LFI, stress) que
necesitan un server.py real corriendo -- no el servidor de desarrollo del
usuario, uno descartable propio con DATA_DIR temporal y puerto libre, para no
tocar la base real en ningún momento.
"""
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest
import requests

SERVER_PY = Path(__file__).resolve().parent.parent / "server.py"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def live_server():
    """Levanta server.py real, en un proceso aparte, con DATA_DIR temporal
    descartable y sin autenticación (ALLOW_NO_AUTH=true) para poder ejercitar
    los endpoints directamente. Se cae solo al terminar la sesión de tests."""
    port = _free_port()
    tmp_data_dir = tempfile.mkdtemp(prefix="smart_validation_test_")
    env = {
        **os.environ,
        "DATA_DIR": tmp_data_dir,
        # db_adapter NO usa DATA_DIR: lee DB_PATH. Sin esto los tests escribían en la base REAL
        # (data/smart_validation.db). Se fuerza una base descartable y se anula DATABASE_URL.
        "DB_PATH": os.path.join(tmp_data_dir, "smart_validation.db"),
        "ALLOW_NO_AUTH": "true",
        "PORT": str(port),
    }
    # Sin AUTH_SECRET_KEY: queda en modo dev (ALLOW_NO_AUTH manda). No heredar
    # una real del entorno del usuario por accidente.
    env.pop("AUTH_SECRET_KEY", None)
    env.pop("DATABASE_URL", None)

    # IMPORTANTE: stdout/stderr van a un ARCHIVO, no a subprocess.PIPE.
    # Un PIPE tiene un buffer chico (el pipe de Windows ronda 64KB) -- si
    # nadie lo drena mientras el subproceso sigue corriendo, el server.py
    # hijo se queda bloqueado en su propio print/log en cuanto el buffer se
    # llena, y empieza a "trabarse" bajo tráfico sostenido aunque su código
    # esté perfecto. (Encontrado en este mismo repaso: con PIPE sin drenar,
    # el server dejaba de responder siempre en la request ~56; con archivo,
    # 150/150 sin un solo fallo.)
    log_path = os.path.join(tmp_data_dir, "server_test.log")
    log_file = open(log_path, "w", encoding="utf-8")

    proc = subprocess.Popen(
        [sys.executable, "-u", str(SERVER_PY), str(port)],
        cwd=str(SERVER_PY.parent),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )

    base_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 15
    last_err = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{base_url}/health", timeout=1)
            if r.status_code == 200:
                break
        except requests.RequestException as e:
            last_err = e
        if proc.poll() is not None:
            log_file.close()
            out = Path(log_path).read_text(encoding="utf-8", errors="replace")
            raise RuntimeError(f"server.py terminó antes de levantar:\n{out}")
        time.sleep(0.3)
    else:
        proc.terminate()
        raise RuntimeError(f"server.py no respondió /health a tiempo ({last_err})")

    yield base_url

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    log_file.close()
    # tmp_data_dir se deja para inspección manual si algo falló; es temporal
    # del sistema, no vive dentro del repo.
