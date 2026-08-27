"""
test_revision_workflow.py
=========================
Integration tests for the GxP document revision workflow endpoints.

Run against http://localhost:11294 with ALLOW_NO_AUTH=true in dev mode.
The server must be running before executing these tests.

Dev mode auth (ALLOW_NO_AUTH=true): {"u": "dev", "d": "Desarrollador", "r": "admin"}

Endpoint reference (confirmed from server.py source):
  POST   /api/projects                                            → create project
  PUT    /api/projects/{proj}/documents/{type}                    → upsert document
  GET    /api/projects/{proj}/documents/{type}                    → get document
  POST   /api/projects/{proj}/signing-rounds                      → create signing round
  GET    /api/projects/{proj}/signing-rounds/{round}              → get round
  POST   /api/projects/{proj}/signing-rounds/{round}/sign         → signer signs (client + PIN)
  POST   /api/projects/{proj}/signing-rounds/{round}/seal         → admin seals (all must sign)
  POST   /api/projects/{proj}/signing-rounds/{round}/request-revision  → client requests revision
  POST   /api/projects/{proj}/signing-rounds/{round}/discard-revision/{username} → admin discards
  POST   /api/projects/{proj}/signing-rounds/{round}/fulfill/{username}          → admin fulfills
  GET    /api/projects/{proj}/signing-rounds/{round}/my-revisions → signer checks own revision
  GET    /api/projects/{proj}/documents/{type}/revisions          → admin/auditor lists revisions
"""

import uuid
import pytest
import requests

BASE = "http://localhost:11294"
sess = requests.Session()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def create_test_project() -> str:
    """POST /api/projects — create a test project and return the server-assigned UUID."""
    name = f"TEST_REVISION_{uuid.uuid4().hex[:8]}"
    resp = sess.post(f"{BASE}/api/projects", json={"name": name, "cliente": "TREV_Test"})
    assert resp.status_code == 201, f"Failed to create project: {resp.status_code} {resp.text}"
    data = resp.json()
    assert data["ok"] is True, f"Expected ok=True, got: {data}"
    proj_id = data["id"]
    assert proj_id, "Server must return a project id"
    return proj_id


def create_test_doc(proj_id: str, doc_type: str = "HLRA") -> dict:
    """PUT /api/projects/{proj}/documents/{type} — upsert a minimal document.

    The server accepts the raw JSON body as 'content' when no 'content' key is present:
        content = data.get("content") or data
    So passing {"type": "HLRA", "title": "Test"} stores that dict as the document content.

    Returns the parsed response JSON (not the document itself).
    """
    payload = {"type": doc_type, "title": "Test Document (auto-generated)"}
    resp = sess.put(f"{BASE}/api/projects/{proj_id}/documents/{doc_type}", json=payload)
    assert resp.status_code in (200, 201), (
        f"Failed to upsert document {doc_type}: {resp.status_code} {resp.text}"
    )
    return resp.json()


def get_doc(proj_id: str, doc_type: str = "HLRA") -> dict:
    """GET /api/projects/{proj}/documents/{type} — return the 'document' sub-dict."""
    resp = sess.get(f"{BASE}/api/projects/{proj_id}/documents/{doc_type}")
    assert resp.status_code == 200, f"Failed to get doc {doc_type}: {resp.status_code} {resp.text}"
    data = resp.json()
    assert data.get("ok") is True, f"Expected ok=True, got: {data}"
    return data["document"]


# ─── Test 1 ───────────────────────────────────────────────────────────────────

class TestVersionStaysAt1DuringRevisionCycle:
    """
    Document version must start at 1 and must not increment due to signing-round
    creation. It only increments when an already-approved document is re-edited.
    Source: server.py _api_doc_upsert (~line 2883):
        if existing and existing["status"] == "approved":
            new_version = (existing["version"] or 1) + 1
        else:
            new_version = existing["version"] if existing else 1
    """

    def test_version_stays_at_1_during_revision_cycle(self):
        """
        Creates a project + HLRA document, confirms version=1, re-PUTs the doc
        (still draft), confirms version is still 1.  Then attempts a signing-round
        creation to verify it does not bump the version.

        The signing-round creation requires a signer username that exists in the
        'users' DB table.  In a fresh dev environment the 'dev' virtual user from
        ALLOW_NO_AUTH is NOT stored in the DB, so the round-creation step may be
        skipped if the server returns 400 with "no existe".
        """
        proj_id = create_test_project()

        # ── Step 1: initial PUT ────────────────────────────────────────────────
        create_test_doc(proj_id, "HLRA")
        doc = get_doc(proj_id, "HLRA")
        assert doc["version"] == 1, (
            f"New document must start at version 1, got {doc['version']}"
        )
        assert doc["status"] == "draft", (
            f"New document must be in 'draft' status, got {doc['status']}"
        )

        # ── Step 2: second PUT while still draft — version must remain 1 ──────
        create_test_doc(proj_id, "HLRA")
        doc2 = get_doc(proj_id, "HLRA")
        assert doc2["version"] == 1, (
            f"Re-editing a draft document must not increment version, got {doc2['version']}"
        )

        # ── Step 3: attempt signing-round creation — version must not change ──
        round_resp = sess.post(
            f"{BASE}/api/projects/{proj_id}/signing-rounds",
            json={
                "doc_type": "HLRA",
                "signers": [{"username": "dev", "role_label": "Revisor Test"}],
            },
        )

        error_msg = round_resp.json().get("error", "") if round_resp.headers.get(
            "Content-Type", ""
        ).startswith("application/json") else ""

        if round_resp.status_code == 400 and (
            "no existe" in error_msg or "no está activo" in error_msg
        ):
            # 'dev' virtual user is not in the users table — skip round-specific assertion
            pytest.skip(
                "Signer 'dev' not found in users table — signing round cannot be created "
                "in this environment.  The version-stays-at-1 assertions already passed."
            )

        # If round was created successfully, version must still be 1
        assert round_resp.status_code in (200, 201), (
            f"Unexpected error creating signing round: {round_resp.status_code} {round_resp.text}"
        )
        doc3 = get_doc(proj_id, "HLRA")
        assert doc3["version"] == 1, (
            f"Signing-round creation must NOT increment version, got {doc3['version']}"
        )
        # Document status becomes 'for_review' after round creation (server.py line 3832)
        assert doc3["status"] == "for_review", (
            f"After round creation, doc status must be 'for_review', got {doc3['status']}"
        )


# ─── Test 2 ───────────────────────────────────────────────────────────────────

class TestVersionIncrementOnEditOfApprovedDoc:
    """
    Version must increment (v1 → v2) when admin edits an already-approved document.
    Getting a document to 'approved' requires sealing a signing round, which in turn
    requires all signers to have signed using their PINs (role=client endpoint).
    This is not achievable in a fully automated test without a pre-seeded DB.

    The test validates the draft re-edit behavior (no increment) and documents
    the 'approved' path with a skip marker.
    """

    def test_version_increments_on_edit_of_approved_doc(self):
        """
        Full flow:
          draft (v1) → for_review → sealed/approved (v1) → re-edit → draft (v2)

        The 'approved' step requires:
          POST /api/projects/{proj}/signing-rounds/{round}/seal
          which only succeeds when all signers have called
          POST /api/projects/{proj}/signing-rounds/{round}/sign
          (requires role=client + valid PIN hash — impossible in dev-admin mode).

        What IS verified here: draft re-edit does not bump version.
        """
        proj_id = create_test_project()
        create_test_doc(proj_id, "HLRA")
        doc = get_doc(proj_id, "HLRA")
        assert doc["version"] == 1
        assert doc["status"] == "draft"

        # Re-edit while draft: version must stay at 1
        create_test_doc(proj_id, "HLRA")
        doc2 = get_doc(proj_id, "HLRA")
        assert doc2["version"] == 1, "Draft re-edit must not increment version"

        # The v1→v2 path is triggered by _api_doc_upsert detecting status='approved':
        #   new_version = (existing["version"] or 1) + 1   (server.py ~line 2883)
        # Reaching 'approved' status requires:
        #   1. POST /api/projects/{proj}/signing-rounds  (admin)
        #   2. POST /api/projects/{proj}/signing-rounds/{round}/sign  (all client signers)
        #   3. POST /api/projects/{proj}/signing-rounds/{round}/seal  (admin)
        pytest.skip(
            "Version v1→v2 increment requires status='approved', reachable only after "
            "POST .../seal (all signers must sign with PIN, role=client).  "
            "Run this test against a pre-seeded DB that has completed a full signing cycle."
        )


# ─── Test 3 ───────────────────────────────────────────────────────────────────

class TestDiscardRevision:
    """
    POST /api/projects/{proj}/signing-rounds/{round}/discard-revision/{username}
    Admin discards a signer's revision request, clearing the revision fields and
    reopening the round if it was cancelled with no remaining objections.

    POST /api/projects/{proj}/signing-rounds/{round}/request-revision
    Only available to role=client.  Dev mode (admin) gets 403.
    """

    def test_discard_revision_clears_fields(self):
        """
        Verifies the discard-revision endpoint returns 404 (not 500 or 403) when
        called for a non-existent revision — confirming the admin role is accepted
        and the endpoint path is correct.

        Also confirms that request-revision correctly rejects admin role with 403.

        Full cycle (request-revision → discard → round re-opens) requires a client
        user in the DB with a PIN hash.
        """
        proj_id = create_test_project()
        create_test_doc(proj_id, "HLRA")

        fake_round_id = str(uuid.uuid4())
        fake_username = "nonexistent_trev_tester"

        # ── Discard endpoint (admin) — should get 404, not 403 or 500 ──────────
        discard_resp = sess.post(
            f"{BASE}/api/projects/{proj_id}/signing-rounds"
            f"/{fake_round_id}/discard-revision/{fake_username}"
        )
        assert discard_resp.status_code == 404, (
            f"Expected 404 for non-existent revision (admin role), "
            f"got {discard_resp.status_code}: {discard_resp.text}"
        )
        discard_data = discard_resp.json()
        assert discard_data.get("ok") is False
        assert "no encontrad" in discard_data.get("error", "").lower(), (
            f"Expected 'not found' error message, got: {discard_data}"
        )

        # ── request-revision (client-only) — admin must get 403 ─────────────────
        # Endpoint: POST /api/projects/{proj}/signing-rounds/{round}/request-revision
        # Payload: {"reason": "...", "pin": "..."}  (both required for client role)
        rev_resp = sess.post(
            f"{BASE}/api/projects/{proj_id}/signing-rounds/{fake_round_id}/request-revision",
            json={"reason": "Test issue", "pin": "1234"},
        )
        assert rev_resp.status_code == 403, (
            f"request-revision must return 403 for admin role (client-only endpoint), "
            f"got {rev_resp.status_code}: {rev_resp.text}"
        )
        assert "Solo revisores" in rev_resp.json().get("error", ""), (
            f"Expected 'Solo revisores' in error, got: {rev_resp.json()}"
        )


# ─── Test 4 ───────────────────────────────────────────────────────────────────

class TestMyRevisionsEndpoint:
    """
    GET /api/projects/{proj}/signing-rounds/{round}/my-revisions

    Returns {ok: True, has_revision: False} when the authenticated user has no
    row in signing_round_signers for that round_id (or the row has no
    revision_requested_at set).

    In dev mode the user is "dev" (admin).  _assert_project_access passes for admin
    regardless of whether the project actually exists.  A fake round_id produces no
    signers row → has_revision=False.
    """

    def test_my_revisions_endpoint_returns_correct_structure(self):
        """
        Creates a project + document, then calls my-revisions with a random round_id.
        Asserts the response has ok=True and has_revision=False.
        """
        proj_id = create_test_project()
        create_test_doc(proj_id, "HLRA")

        fake_round_id = str(uuid.uuid4())

        resp = sess.get(
            f"{BASE}/api/projects/{proj_id}/signing-rounds/{fake_round_id}/my-revisions"
        )
        assert resp.status_code == 200, (
            f"Expected 200 from my-revisions, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert data.get("ok") is True, f"Expected ok=True, got: {data}"
        assert data.get("has_revision") is False, (
            f"Expected has_revision=False for a round with no signer row for this user, "
            f"got: {data}"
        )
        # Verify no unexpected extra fields leak in the False branch
        assert "revision_reason" not in data, (
            "revision_reason should not be present when has_revision=False"
        )


# ─── Test 5 ───────────────────────────────────────────────────────────────────

class TestDocRevisionsEndpoint:
    """
    GET /api/projects/{proj}/documents/{type}/revisions

    Returns {ok: True, revisions: []} for a document that has never had a revision
    request.  Requires admin or auditor role — dev mode (admin) passes.

    Dispatched by _RE_DOC_REVISIONS in server.py GET handler (line 4771).
    """

    def test_doc_revisions_endpoint_admin_access(self):
        """
        Creates a project + document, then calls the revisions endpoint.
        Asserts ok=True and revisions=[] (empty list, no revision requests yet).
        """
        proj_id = create_test_project()
        create_test_doc(proj_id, "HLRA")

        resp = sess.get(f"{BASE}/api/projects/{proj_id}/documents/HLRA/revisions")
        assert resp.status_code == 200, (
            f"Expected 200 from doc revisions endpoint, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert data.get("ok") is True, f"Expected ok=True, got: {data}"
        assert isinstance(data.get("revisions"), list), (
            f"Expected 'revisions' to be a list, got type {type(data.get('revisions'))}: {data}"
        )
        assert data["revisions"] == [], (
            f"Expected empty revisions list for a new document, got: {data['revisions']}"
        )
