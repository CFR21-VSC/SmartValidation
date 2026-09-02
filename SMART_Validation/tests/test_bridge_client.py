"""
test_bridge_client.py
======================
Integration tests for the bridge Documental -> Firmas (Fase 4): send-to-firmas and
firmas-comments.

Run against http://localhost:11294 (Suite Documental, ALLOW_NO_AUTH=true) AND against
the Suite de Revision y Firmas running at FIRMAS_BASE_URL (same value the server under
test has configured) -- both must be up before running these tests, same convention as
test_revision_workflow.py.

Endpoint reference:
  POST /api/projects/{proj}/documents/{type}/send-to-firmas    -> push document
  GET  /api/projects/{proj}/documents/{type}/firmas-comments   -> pull comments
"""

import uuid

import requests

BASE = "http://localhost:11294"
sess = requests.Session()


def create_test_project() -> str:
    name = f"TEST_BRIDGE_{uuid.uuid4().hex[:8]}"
    resp = sess.post(f"{BASE}/api/projects", json={"name": name, "cliente": "TBRIDGE_Test"})
    assert resp.status_code == 201, f"Failed to create project: {resp.status_code} {resp.text}"
    return resp.json()["id"]


def upsert_doc(proj_id: str, doc_type: str) -> None:
    # NOTA: server.py enruta el upsert de documentos por POST (do_PUT es un stub que
    # siempre devuelve 405) -- a diferencia de lo que documenta (desactualizado) el
    # docstring de test_revision_workflow.py.
    payload = {"type": doc_type, "title": "Doc de prueba bridge"}
    resp = sess.post(f"{BASE}/api/projects/{proj_id}/documents/{doc_type}", json=payload)
    assert resp.status_code in (200, 201), f"Failed to upsert {doc_type}: {resp.status_code} {resp.text}"


class TestSendToFirmas:
    def test_send_to_firmas_pushes_document(self):
        proj_id = create_test_project()
        upsert_doc(proj_id, "HLRA")

        resp = sess.post(f"{BASE}/api/projects/{proj_id}/documents/HLRA/send-to-firmas")
        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True

    def test_send_to_firmas_missing_local_document_404(self):
        proj_id = create_test_project()
        resp = sess.post(f"{BASE}/api/projects/{proj_id}/documents/URS/send-to-firmas")
        assert resp.status_code == 404

    def test_send_to_firmas_invalid_doc_type_400(self):
        proj_id = create_test_project()
        too_long = "X" * 61  # _DOC_TYPE_RE permite hasta 60 caracteres
        resp = sess.post(f"{BASE}/api/projects/{proj_id}/documents/{too_long}/send-to-firmas")
        assert resp.status_code == 400

    def test_send_to_firmas_can_be_called_again_for_a_revision(self):
        """Confirma explícitamente lo que pidió el usuario: el mismo botón sirve para
        la primera versión y para reenviar una corrección -- sin endpoint separado."""
        proj_id = create_test_project()
        upsert_doc(proj_id, "FRS")
        first = sess.post(f"{BASE}/api/projects/{proj_id}/documents/FRS/send-to-firmas")
        assert first.status_code == 200, first.text

        upsert_doc(proj_id, "FRS")  # simula la corrección
        second = sess.post(f"{BASE}/api/projects/{proj_id}/documents/FRS/send-to-firmas")
        assert second.status_code == 200, second.text


class TestFirmasComments:
    def test_firmas_comments_returns_empty_list_for_fresh_document(self):
        proj_id = create_test_project()
        upsert_doc(proj_id, "URS")
        sess.post(f"{BASE}/api/projects/{proj_id}/documents/URS/send-to-firmas")

        resp = sess.get(f"{BASE}/api/projects/{proj_id}/documents/URS/firmas-comments")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["ok"] is True
        assert data["comments"] == []

    def test_firmas_comments_document_never_sent_404(self):
        """El documento existe localmente pero nunca se envió a Firmas -- Firmas no lo
        conoce, así que propaga su propio 404."""
        proj_id = create_test_project()
        upsert_doc(proj_id, "PIQ")

        resp = sess.get(f"{BASE}/api/projects/{proj_id}/documents/PIQ/firmas-comments")
        assert resp.status_code == 404
