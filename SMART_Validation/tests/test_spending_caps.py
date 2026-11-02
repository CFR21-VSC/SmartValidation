"""
Topes de gasto (2026-10-12): la generación de documentos y el aviso de desvíos tienen un
máximo diario que corta el servicio pago aunque el rate limit por minuto deje pasar.

Levanta un server.py propio (no el de la fixture compartida) con topes bajos. La clave del
proveedor es FALSA a propósito: el pedido llega al proveedor, es rechazado y no cuesta nada --
nunca se usa la clave real del .env.
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


@pytest.fixture(scope="module")
def capped_server():
    port = _free_port()
    tmp = tempfile.mkdtemp(prefix="smart_validation_caps_")
    env = {
        **os.environ,
        "DATA_DIR": tmp,
        # db_adapter.py no mira DATA_DIR: sin DB_PATH el server de test escribe en la base local real.
        "DB_PATH": os.path.join(tmp, "test.db"),
        "ALLOW_NO_AUTH": "true",
        "PORT": str(port),
        "ANTHROPIC_API_KEY": "sk-ant-clave-falsa-de-test",
        "AI_DAILY_LIMIT_PER_USER": "2",
        "NOTIFY_DAILY_LIMIT_PER_USER": "2",
    }
    env.pop("AUTH_SECRET_KEY", None)
    env.pop("RESEND_API_KEY", None)
    log_file = open(os.path.join(tmp, "server.log"), "w", encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, "-u", str(SERVER_PY), str(port)],
        cwd=str(SERVER_PY.parent), env=env, stdout=log_file, stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(60):
            try:
                if requests.get(f"{base}/auth/session", timeout=2).status_code < 500:
                    break
            except requests.RequestException:
                time.sleep(0.5)
        else:
            pytest.fail("server.py de test no levantó")
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log_file.close()


def test_ai_generate_is_cut_at_the_daily_cap(capped_server):
    body = {"userPrompt": "hola", "systemPrompt": "", "model": "claude-haiku-4-5-20251001"}
    first = requests.post(f"{capped_server}/ai/generate", json=body, timeout=120)
    second = requests.post(f"{capped_server}/ai/generate", json=body, timeout=120)
    third = requests.post(f"{capped_server}/ai/generate", json=body, timeout=120)
    # Las dos primeras pasan el tope (después fallan contra el proveedor por la clave falsa).
    assert first.status_code != 429, first.text
    assert second.status_code != 429, second.text
    assert third.status_code == 429, third.text
    assert "tope" in third.json()["error"]


def test_invalid_ai_request_does_not_consume_budget(capped_server):
    """Un pedido inválido (sin prompt) se rechaza antes de descontar del tope."""
    r = requests.post(f"{capped_server}/ai/generate", json={"userPrompt": ""}, timeout=30)
    assert r.status_code == 400


def test_notify_desvios_is_cut_at_the_daily_cap_per_user(capped_server):
    body = {
        "desvios": [{"tcId": "TC-OQ-001", "tcName": "x", "step": 1, "dictamen": "NO PASA"}],
        "recipients": ["alguien@example.com"],
        "projectName": "p",
    }
    codes = [requests.post(f"{capped_server}/api/notify-desvios", json=body, timeout=30).status_code for _ in range(3)]
    assert codes == [200, 200, 429], codes
