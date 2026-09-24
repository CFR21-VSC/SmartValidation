"""Tests de minería de procesos: SOP versionado (guardar/leer/validar) y reporte de
desvíos de tiempo/rework contra datos reales de un circuito completo de firma."""
import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.process_mining import STAGE_KEYS
from tests.conftest import accept_signature_consent

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Demo"}, "secciones": []}

# PDF mínimo pero estructuralmente válido (una página en blanco, generado con pypdf) --
# necesario desde que sign_approval exige un PDF real (F-02, ver signatures.py). El mismo
# usado en la simulación adversarial de docs-privados/.
VALID_PDF_B64 = (
    "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8"
    "PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9U"
    "eXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVz"
    "b3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgNzIgNzIgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9i"
    "agp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1NCAw"
    "MDAwMCBuIAowMDAwMDAwMTEzIDAwMDAwIG4gCjAwMDAwMDAxNjIgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6"
    "ZSA1Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCj4+CnN0YXJ0eHJlZgoyNTQKJSVFT0YK"
)


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    accept_signature_consent(drp_client)
    return drp_client


@pytest.fixture
def cliente(drp_client):
    created = drp_client.post(
        "/users",
        json={"username": "revisor-pm", "email": "revisor-pm@example.com", "display_name": "Revisor PM", "role": "cliente"},
    )
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    accept_signature_consent(cli)
    return cli, user_id


@pytest.fixture
def second_drp(drp_client):
    """DRP NO superadmin -- para probar el gate de acceso (solo superadmin puede usar
    minería de procesos, ver process_mining.py)."""
    created = drp_client.post(
        "/users",
        json={"username": "otro-drp-pm", "email": "otro-drp-pm@example.com", "display_name": "Otro DRP", "role": "drp"},
    )
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "5678"})
    return cli


def _seal_document(drp_with_pin, cliente_tuple, project_id="proj-1", doc_type="HLRA"):
    """Circuito completo real, incluyendo close-review (F-01/requisito 2026-09-21) y un
    PDF estructuralmente válido (F-02) -- a diferencia del helper de test_projects.py, que
    quedó desactualizado y hoy falla por ambos motivos. Devuelve el id del documento."""
    cli, user_id = cliente_tuple
    drp_with_pin.put(f"/projects/{project_id}/documents/{doc_type}", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": project_id, "doc_type": doc_type})
    drp_id = [u["id"] for u in drp_with_pin.get("/users").json()["users"] if u["is_superadmin"]][0]
    fp = drp_with_pin.get(f"/projects/{project_id}/documents/{doc_type}").json()["content_fingerprint"]

    assert cli.post(
        f"/projects/{project_id}/documents/{doc_type}/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    ).status_code == 200
    assert drp_with_pin.post(
        f"/projects/{project_id}/documents/{doc_type}/close-review", json={"pin": "9999"}
    ).status_code == 200
    assert drp_with_pin.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round",
        json={"signers": [
            {"user_id": user_id, "role_label": "Revisor", "sign_order": 1},
            {"user_id": drp_id, "role_label": "Aprobador", "sign_order": 2},
        ]},
    ).status_code == 200
    assert cli.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round/sign",
        json={"pin": "1234", "justification_text": "ok", "content_fingerprint": fp},
    ).status_code == 200
    sealed = drp_with_pin.post(
        f"/projects/{project_id}/documents/{doc_type}/approval-round/sign",
        json={"pin": "9999", "justification_text": "ok", "pdf_base64": VALID_PDF_B64, "content_fingerprint": fp},
    )
    assert sealed.status_code == 200 and sealed.json()["sealed"] is True, sealed.text

    doc_id = drp_with_pin.get(f"/projects/{project_id}/documents/{doc_type}").json()["document"]["id"]
    return doc_id


def _backdate(doc_id, *, created_at, first_review_at, review_closed_at, round_opened_at, sealed_at):
    """Reescribe los timestamps del ciclo a deltas conocidos, para que los desvíos contra
    un umbral se puedan comprobar de forma determinística en vez de depender de cuánto
    tarda en correr el test real (mismo criterio que otros tests de esta suite que tocan
    la DB directo -- ver test_signing_integrity.py)."""
    db = get_db()
    db.execute("UPDATE rf_documents SET created_at=?, review_closed_at=?, locked_at=? WHERE id=?",
               (created_at, review_closed_at, sealed_at, doc_id))
    db.execute("UPDATE rf_review_signatures SET signed_at=? WHERE document_id=? AND invalidated_at IS NULL",
               (first_review_at, doc_id))
    db.execute("UPDATE rf_approval_rounds SET created_at=? WHERE document_id=?", (round_opened_at, doc_id))
    db.commit()


GENEROUS_SOP = {
    "name": "SOP generoso",
    "stages": [{"key": k, "label": k, "max_hours": 1000} for k in STAGE_KEYS],
    "max_rework_count": 5,
}


# ─── SOP: guardar / leer / versionar ───────────────────────────────────────────

def test_get_sop_returns_default_when_none_saved(drp_with_pin):
    r = drp_with_pin.get("/sop")
    assert r.status_code == 200
    sop = r.json()["sop"]
    assert sop["version"] == 0
    assert {s["key"] for s in sop["definition"]["stages"]} == set(STAGE_KEYS)


def test_save_sop_creates_incrementing_versions(drp_with_pin):
    first = drp_with_pin.put("/sop", json=GENEROUS_SOP)
    assert first.status_code == 200 and first.json()["version"] == 1

    second = drp_with_pin.put("/sop", json={**GENEROUS_SOP, "name": "SOP más estricto"})
    assert second.status_code == 200 and second.json()["version"] == 2

    current = drp_with_pin.get("/sop").json()["sop"]
    assert current["version"] == 2
    assert current["name"] == "SOP más estricto"

    versions = drp_with_pin.get("/sop/versions").json()["versions"]
    assert [v["version"] for v in versions] == [2, 1]


@pytest.mark.parametrize("bad_body,expected_fragment", [
    ({"name": "x", "stages": [], "max_rework_count": 0}, "etapa"),
    ({"name": "x", "stages": [{"key": "no-existe", "label": "x", "max_hours": 10}], "max_rework_count": 0}, "desconocida"),
    ({"name": "x", "stages": [{"key": STAGE_KEYS[0], "label": "x", "max_hours": 0}], "max_rework_count": 0}, "max_hours"),
    ({"name": "x", "stages": [{"key": STAGE_KEYS[0], "label": "x", "max_hours": 10}], "max_rework_count": -1}, "max_rework_count"),
])
def test_save_sop_rejects_invalid_definitions(drp_with_pin, bad_body, expected_fragment):
    r = drp_with_pin.put("/sop", json=bad_body)
    assert r.status_code == 400
    assert expected_fragment in r.text.lower()


def test_process_mining_endpoints_require_superadmin(second_drp):
    assert second_drp.get("/sop").status_code == 403
    assert second_drp.get("/sop/versions").status_code == 403
    assert second_drp.put("/sop", json=GENEROUS_SOP).status_code == 403
    assert second_drp.get("/process-mining/deviations").status_code == 403


# ─── Reporte de desvíos ─────────────────────────────────────────────────────

def test_deviations_document_without_progress_has_null_stages(drp_with_pin):
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/sop", json=GENEROUS_SOP)
    r = drp_with_pin.get("/process-mining/deviations")
    assert r.status_code == 200
    doc = r.json()["documents"][0]
    assert doc["stages"]["carga_a_revision"]["hours"] is None
    assert doc["stages"]["carga_a_revision"]["breached"] is False
    assert doc["any_breach"] is False


def test_deviations_no_breach_within_generous_thresholds(drp_with_pin, cliente):
    doc_id = _seal_document(drp_with_pin, cliente)
    now = 1_700_000_000.0
    _backdate(doc_id, created_at=now, first_review_at=now + 3600, review_closed_at=now + 7200,
              round_opened_at=now + 10800, sealed_at=now + 14400)
    drp_with_pin.put("/sop", json=GENEROUS_SOP)

    r = drp_with_pin.get("/process-mining/deviations")
    doc = r.json()["documents"][0]
    assert doc["any_breach"] is False
    assert doc["stages"]["carga_a_revision"]["hours"] == pytest.approx(1.0)
    assert doc["stages"]["ronda_a_sellado"]["hours"] == pytest.approx(1.0)
    assert r.json()["summary"]["documents_with_any_breach"] == 0


def test_deviations_flags_stage_breach(drp_with_pin, cliente):
    doc_id = _seal_document(drp_with_pin, cliente)
    now = 1_700_000_000.0
    # carga_a_revision se estira a 10h -- el resto queda instantáneo (0h, dentro de umbral).
    _backdate(doc_id, created_at=now, first_review_at=now + 10 * 3600, review_closed_at=now + 10 * 3600,
              round_opened_at=now + 10 * 3600, sealed_at=now + 10 * 3600)
    strict_sop = {
        "name": "SOP estricto en carga",
        "stages": [
            {"key": "carga_a_revision", "label": "x", "max_hours": 2},
            {"key": "revision_a_cierre", "label": "x", "max_hours": 1000},
            {"key": "cierre_a_ronda", "label": "x", "max_hours": 1000},
            {"key": "ronda_a_sellado", "label": "x", "max_hours": 1000},
        ],
        "max_rework_count": 5,
    }
    drp_with_pin.put("/sop", json=strict_sop)

    r = drp_with_pin.get("/process-mining/deviations")
    doc = r.json()["documents"][0]
    assert doc["any_breach"] is True
    assert doc["stages"]["carga_a_revision"]["breached"] is True
    assert doc["stages"]["carga_a_revision"]["over_by_hours"] == pytest.approx(8.0)
    assert doc["stages"]["revision_a_cierre"]["breached"] is False
    assert r.json()["summary"]["breach_rate_by_stage"]["carga_a_revision"] == 1.0
    assert r.json()["summary"]["breach_rate_by_stage"]["revision_a_cierre"] == 0.0


def test_deviations_counts_and_flags_rework(drp_with_pin, cliente):
    cli, user_id = cliente
    drp_with_pin.put("/projects/proj-1/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": "proj-1", "doc_type": "HLRA"})
    fp = drp_with_pin.get("/projects/proj-1/documents/HLRA").json()["content_fingerprint"]
    assert cli.post(
        "/projects/proj-1/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    ).status_code == 200
    reopened = drp_with_pin.post(
        "/projects/proj-1/documents/HLRA/reopen", json={"reason": "corrección pedida"}
    )
    assert reopened.status_code == 200, reopened.text

    strict_rework_sop = {**GENEROUS_SOP, "max_rework_count": 0}
    drp_with_pin.put("/sop", json=strict_rework_sop)
    r = drp_with_pin.get("/process-mining/deviations")
    doc = r.json()["documents"][0]
    assert doc["rework_count"] == 1
    assert doc["rework_breached"] is True
    assert doc["any_breach"] is True
    assert r.json()["summary"]["avg_rework_count"] == pytest.approx(1.0)


def test_deviations_excludes_archived_projects_by_default(drp_with_pin):
    """2026-09-23 (pedido del usuario: "quiero solo datos reales"): archivar un proyecto de
    prueba es el camino recomendado para sacarlo del reporte -- no borrarlo a la fuerza si
    tiene evidencia de firma (eso rompería la protección GxP de delete_project)."""
    drp_with_pin.put("/projects/proj-archived/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/projects/proj-live/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert drp_with_pin.patch("/projects/proj-archived/archive").status_code == 200
    drp_with_pin.put("/sop", json=GENEROUS_SOP)

    default = drp_with_pin.get("/process-mining/deviations")
    ids = {d["project_id"] for d in default.json()["documents"]}
    assert "proj-live" in ids
    assert "proj-archived" not in ids

    with_archived = drp_with_pin.get("/process-mining/deviations", params={"include_archived": "true"})
    ids2 = {d["project_id"] for d in with_archived.json()["documents"]}
    assert {"proj-live", "proj-archived"}.issubset(ids2)


def test_deviations_filters_by_project_vs_system_wide(drp_with_pin):
    drp_with_pin.post("/projects", json={"id": "proj-a"})
    drp_with_pin.post("/projects", json={"id": "proj-b"})
    drp_with_pin.put("/projects/proj-a/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/projects/proj-b/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put("/sop", json=GENEROUS_SOP)

    scoped = drp_with_pin.get("/process-mining/deviations", params={"project_id": "proj-a"})
    assert {d["project_id"] for d in scoped.json()["documents"]} == {"proj-a"}

    system_wide = drp_with_pin.get("/process-mining/deviations")
    assert {"proj-a", "proj-b"}.issubset({d["project_id"] for d in system_wide.json()["documents"]})
