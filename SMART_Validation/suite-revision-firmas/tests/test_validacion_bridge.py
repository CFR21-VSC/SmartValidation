"""Tests del endpoint DRP-only push-to-validacion (documents.py) y del cliente saliente
validacion_bridge.py -- dirección INVERSA del bridge (Firmas -> Validación, sección pedida
por el usuario 2026-09-01: corregir en Firmas y reenviar re-validado a la Suite Documental).

Mockea validacion_bridge.push_correction para no depender de un server.py real corriendo acá
(eso se cubre aparte con el smoke test manual de los tres servicios juntos)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Demo"}, "secciones": []}


@pytest.fixture
def cliente_client(drp_client):
    created = drp_client.post(
        "/users",
        json={"username": "revisor-vb", "email": "revisor-vb@example.com", "display_name": "Revisor", "role": "cliente"},
    )
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    return cli, created.json()["user_id"]


def test_push_to_validacion_requires_drp(cliente_client):
    cli, _uid = cliente_client
    r = cli.post("/projects/proj-1/documents/HLRA/push-to-validacion", json={})
    assert r.status_code == 403


def test_push_to_validacion_success(drp_client, monkeypatch):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    monkeypatch.setattr(
        "app.routers.documents.validacion_bridge.push_correction",
        lambda project_id, doc_type, json_data, actor_username, confirmed=False: {
            "ok": True, "id": "proj-1_HLRA", "status": 200,
            "issues": {"CRITICO": [], "MAYOR": [], "MENOR": []},
        },
    )
    r = drp_client.post("/projects/proj-1/documents/HLRA/push-to-validacion", json={})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_push_to_validacion_blocked_by_critical(drp_client, monkeypatch):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    monkeypatch.setattr(
        "app.routers.documents.validacion_bridge.push_correction",
        lambda *a, **kw: {
            "ok": False, "blocked": True, "reason": "critical", "status": 409,
            "error": "critico", "issues": {"CRITICO": [{"bucket": "gaps"}], "MAYOR": [], "MENOR": []},
        },
    )
    r = drp_client.post("/projects/proj-1/documents/HLRA/push-to-validacion", json={})
    assert r.status_code == 409
    assert r.json()["reason"] == "critical"


def test_push_to_validacion_needs_confirmation(drp_client, monkeypatch):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    monkeypatch.setattr(
        "app.routers.documents.validacion_bridge.push_correction",
        lambda *a, **kw: {
            "ok": False, "blocked": False, "reason": "needs_confirmation", "status": 409,
            "error": "mayor", "issues": {"CRITICO": [], "MAYOR": [{"bucket": "coherenceIssues"}], "MENOR": []},
        },
    )
    r = drp_client.post("/projects/proj-1/documents/HLRA/push-to-validacion", json={})
    assert r.status_code == 409
    assert r.json()["reason"] == "needs_confirmation"


def test_push_to_validacion_passes_confirmed_flag_through(drp_client, monkeypatch):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    calls = []
    monkeypatch.setattr(
        "app.routers.documents.validacion_bridge.push_correction",
        lambda project_id, doc_type, json_data, actor_username, confirmed=False: (
            calls.append(confirmed) or {"ok": True, "id": "x", "status": 200, "issues": {}}
        ),
    )
    drp_client.post("/projects/proj-1/documents/HLRA/push-to-validacion", json={"confirmed": True})
    assert calls == [True]


def test_push_to_validacion_logs_system_event_only_on_success(drp_client, monkeypatch):
    drp_client.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})

    monkeypatch.setattr(
        "app.routers.documents.validacion_bridge.push_correction",
        lambda *a, **kw: {"ok": False, "reason": "critical", "status": 409, "error": "x", "issues": {}},
    )
    drp_client.post("/projects/proj-1/documents/HLRA/push-to-validacion", json={})
    events_after_block = drp_client.get("/audit-log").json()["events"]
    assert not any(e["event_type"] == "corrected_pushed_to_validacion" for e in events_after_block)

    monkeypatch.setattr(
        "app.routers.documents.validacion_bridge.push_correction",
        lambda *a, **kw: {"ok": True, "id": "x", "status": 200, "issues": {}},
    )
    drp_client.post("/projects/proj-1/documents/HLRA/push-to-validacion", json={})
    events_after_success = drp_client.get("/audit-log").json()["events"]
    assert any(e["event_type"] == "corrected_pushed_to_validacion" for e in events_after_success)


def test_push_to_validacion_missing_document_404(drp_client):
    r = drp_client.post("/projects/proj-1/documents/NOEXISTE/push-to-validacion", json={})
    assert r.status_code == 404


def test_push_correction_client_reports_unavailable_when_not_configured():
    from app import config, validacion_bridge
    old_url = config.VALIDACION_BASE_URL
    config.VALIDACION_BASE_URL = ""
    try:
        result = validacion_bridge.push_correction("proj-1", "HLRA", SAMPLE_JSON, "fbongiovanni")
        assert result["ok"] is False
        assert result["status"] == 503
    finally:
        config.VALIDACION_BASE_URL = old_url
