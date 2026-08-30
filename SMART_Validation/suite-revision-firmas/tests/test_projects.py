"""Tests de ciclo de vida de proyectos, borrado de documentos, audit trail de
sistema (separado del People Book), y el paquete para el Libro de Validación."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Demo"}, "secciones": [
    {"titulo": "Propósito", "contenido": "texto original"}
]}


@pytest.fixture
def cliente(drp_client):
    created = drp_client.post(
        "/users", json={"email": "cliente-proj@example.com", "display_name": "Cliente Proj", "role": "cliente"}
    )
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    return cli, user_id


def _seal_document(drp_with_pin, cliente_tuple, project_id="proj-1", doc_type="HLRA"):
    """Recorre el circuito completo hasta sellar el documento. Devuelve el drp_id."""
    cli, user_id = cliente_tuple
    drp_with_pin.put(f"/projects/{project_id}/documents/{doc_type}", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": project_id, "doc_type": doc_type})
    drp_id = drp_with_pin.get("/users").json()["users"]
    drp_id = [u["id"] for u in drp_id if u["is_superadmin"]][0]

    cli.post(f"/projects/{project_id}/documents/{doc_type}/review-signatures", json={"pin": "1234"})
    drp_with_pin.post(f"/projects/{project_id}/documents/{doc_type}/review-signatures", json={"pin": "9999"})

    drp_with_pin.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round",
        json={"signers": [
            {"user_id": user_id, "role_label": "Revisor", "sign_order": 1},
            {"user_id": drp_id, "role_label": "Aprobador", "sign_order": 2},
        ]},
    )
    cli.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round/sign",
        json={"pin": "1234", "justification_text": "ok"},
    )
    drp_with_pin.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round/sign",
        json={"pin": "9999", "justification_text": "ok", "pdf_base64": "ZmFrZQ=="},
    )
    return drp_id


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    return drp_client


# ─── Ciclo de vida de proyectos ────────────────────────────────────────────

def test_close_project_blocks_new_loads(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.patch("/projects/proj-1/close")
    assert r.status_code == 200

    blocked = drp_with_pin.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS"}})
    assert blocked.status_code == 409


def test_close_nonexistent_project_404(drp_with_pin):
    r = drp_with_pin.patch("/projects/no-existe/close")
    assert r.status_code == 404


def test_close_twice_conflict(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.patch("/projects/proj-1/close")
    r = drp_with_pin.patch("/projects/proj-1/close")
    assert r.status_code == 409


def test_archive_hides_from_default_list_but_reappears_with_flag(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.patch("/projects/proj-1/archive")

    default_list = drp_with_pin.get("/projects").json()["projects"]
    assert "proj-1" not in [p["id"] for p in default_list]

    full_list = drp_with_pin.get("/projects?include_archived=true").json()["projects"]
    proj = next(p for p in full_list if p["id"] == "proj-1")
    assert proj["status"] == "archived"


def test_reopen_project_allows_loads_again(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.patch("/projects/proj-1/close")
    reopened = drp_with_pin.patch("/projects/proj-1/reopen")
    assert reopened.status_code == 200

    r = drp_with_pin.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS"}})
    assert r.status_code == 200


def test_delete_project_blocked_if_sealed_document(drp_with_pin, cliente):
    _seal_document(drp_with_pin, cliente)
    r = drp_with_pin.delete("/projects/proj-1")
    assert r.status_code == 409
    assert "HLRA" in r.text


def test_delete_project_happy_path_removes_everything(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.delete("/projects/proj-1")
    assert r.status_code == 200

    projects = drp_with_pin.get("/projects").json()["projects"]
    assert "proj-1" not in [p["id"] for p in projects]

    gone = drp_with_pin.get("/projects/proj-1/documents/HLRA")
    assert gone.status_code == 404


def test_delete_project_requires_drp(cliente):
    cli, _uid = cliente
    r = cli.delete("/projects/proj-1")
    assert r.status_code == 403


def test_project_lifecycle_requires_drp(cliente):
    cli, _uid = cliente
    assert cli.patch("/projects/proj-1/close").status_code == 403
    assert cli.patch("/projects/proj-1/archive").status_code == 403
    assert cli.patch("/projects/proj-1/reopen").status_code == 403


# ─── Borrado de un documento puntual ────────────────────────────────────────

def test_delete_document_blocked_if_sealed(drp_with_pin, cliente):
    _seal_document(drp_with_pin, cliente)
    r = drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    assert r.status_code == 409


def test_delete_document_happy_path(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    assert r.status_code == 200
    assert drp_with_pin.get("/projects/proj-1/documents/HLRA").status_code == 404


def test_delete_document_requires_drp(cliente):
    cli, _uid = cliente
    r = cli.delete("/projects/proj-1/documents/HLRA")
    assert r.status_code == 403


# ─── Audit trail de sistema (separado del People Book) ─────────────────────

def test_system_audit_log_records_lifecycle_and_admin_actions(drp_with_pin, cliente):
    cli, user_id = cliente
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    grant = drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    grant_id = drp_with_pin.get(f"/users/{user_id}/grants").json()["grants"][0]["id"]
    drp_with_pin.delete(f"/users/{user_id}/grants/{grant_id}")
    drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    drp_with_pin.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS"}})
    drp_with_pin.patch("/projects/proj-1/close")

    events = drp_with_pin.get("/projects/proj-1/audit-log").json()["events"]
    event_types = [e["event_type"] for e in events]
    assert "grant_created" in event_types
    assert "grant_revoked" in event_types
    assert "document_deleted" in event_types
    assert "project_closed" in event_types
    # user_created no lleva project_id (es un evento global), no debería aparecer acá.
    assert "user_created" not in event_types


def test_system_audit_log_requires_drp(cliente):
    cli, _uid = cliente
    r = cli.get("/projects/proj-1/audit-log")
    assert r.status_code == 403


def test_document_deletion_does_not_pollute_people_book(drp_with_pin):
    """El borrado de un documento es una acción administrativa — va al audit trail
    de sistema, no al People Book (ese es del ciclo GxP del documento)."""
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.delete("/projects/proj-1/documents/HLRA")
    # El documento ya no existe, pero el people-book histórico de mientras existió
    # sigue consultable (no se destruyen audit trails) — solo tiene el evento de carga.
    people_book = drp_with_pin.get("/projects/proj-1/documents/HLRA/people-book").json()["events"]
    event_types = [e["event_type"] for e in people_book]
    assert "document_loaded" in event_types
    assert "document_deleted" not in event_types


# ─── Paquete del Libro de Validación (Tomo I) ───────────────────────────────

def test_book_package_only_includes_sealed_documents(drp_with_pin, cliente):
    drp_with_pin.put("/projects/proj-1/documents/URS", json={"json_data": {"type": "URS", "secciones": []}})
    _seal_document(drp_with_pin, cliente)  # sella HLRA

    pkg = drp_with_pin.get("/projects/proj-1/book-package").json()
    assert [d["type"] for d in pkg["documents"]] == ["HLRA"]
    assert pkg["skipped_not_sealed"] == ["URS"]


def test_book_package_injects_signature_section(drp_with_pin, cliente):
    _seal_document(drp_with_pin, cliente)
    pkg = drp_with_pin.get("/projects/proj-1/book-package").json()
    doc = pkg["documents"][0]["data"]
    tff = next(s for s in doc["secciones"] if s.get("tipo") == "tabla-firmas-final")
    assert len(tff["firmas"]) == 4  # 2 firmas de revisión + 2 de aprobación
    roles = {f["rol"] for f in tff["firmas"]}
    assert "Revisor" in roles and "Aprobador" in roles
    for f in tff["firmas"]:
        assert f["nombre"]
        assert f["iniciales"]
        assert f["fecha"]


def test_book_package_preserves_original_sections(drp_with_pin, cliente):
    """La sección inyectada no debe pisar el resto del contenido del documento."""
    _seal_document(drp_with_pin, cliente)
    pkg = drp_with_pin.get("/projects/proj-1/book-package").json()
    doc = pkg["documents"][0]["data"]
    titles = [s.get("titulo") for s in doc["secciones"]]
    assert "Propósito" in titles


def test_book_package_requires_drp(cliente):
    cli, _uid = cliente
    r = cli.get("/projects/proj-1/book-package")
    assert r.status_code == 403
