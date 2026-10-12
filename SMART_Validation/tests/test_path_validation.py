"""
Unit tests de las funciones de validación que sostienen toda la defensa contra
LFI (path traversal) y acceso cruzado entre proyectos. No levantan servidor --
prueban las funciones puras directamente.
"""
import pytest
import server


# ── _is_valid_proj_id ────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [
    "proj_1791426727620_lalq34",
    "550e8400-e29b-41d4-a716-446655440000",
    "__demo_drp_sis_001__",
    "a1",
])
def test_valid_proj_id_accepts_legit_formats(value):
    assert server._is_valid_proj_id(value) is True


@pytest.mark.parametrize("value", [
    None,
    "",
    "../../../etc/passwd",
    "proj_123/../../secret",
    "proj_123\\..\\..\\windows",
    "proj_123;DROP TABLE projects;",
    "proj 123",            # espacio
    "proj_123\x00etc",     # null byte
    "a" * 81,               # excede el máximo de _CLI_PROJ_RE
])
def test_valid_proj_id_rejects_traversal_and_garbage(value):
    assert server._is_valid_proj_id(value) is False


# ── _safe_filename (VULN-09) ─────────────────────────────────────────────────

@pytest.mark.parametrize("attack,expected_has_no_traversal", [
    ("../../../etc/passwd", True),
    ("..\\..\\..\\windows\\win.ini", True),
    ("/etc/passwd", True),
    ("....//....//etc/passwd", True),
])
def test_safe_filename_strips_directory_components(attack, expected_has_no_traversal):
    safe = server._safe_filename(attack, "fallback")
    assert "/" not in safe
    assert "\\" not in safe
    assert safe not in ("..", ".")


@pytest.mark.parametrize("reserved", ["CON", "con", "PRN", "AUX", "NUL", "COM1", "LPT1"])
def test_safe_filename_blocks_windows_reserved_device_names(reserved):
    # VULN-09: escribir a estos nombres en Windows puede colgar/fallar el proceso.
    assert server._safe_filename(reserved, "fallback") == "fallback"


def test_safe_filename_empty_or_none_uses_fallback():
    assert server._safe_filename("", "fallback") == "fallback"
    assert server._safe_filename(None, "fallback") == "fallback"


def test_safe_filename_normal_name_passes_through():
    assert server._safe_filename("photo_123.json", "fallback") == "photo_123.json"


# ── _proj_id_from_compound ───────────────────────────────────────────────────

def test_proj_id_from_compound_extracts_correctly():
    cid = "proj_1791426727620_lalq34_test_999_evidence_ev_abc123"
    assert server.SyncHandler._proj_id_from_compound(cid) == "proj_1791426727620_lalq34"


@pytest.mark.parametrize("cid", [
    "",
    "no_proj_prefix_here",
    "proj_onlytwoparts",
    "notproj_123_abc_rest",
])
def test_proj_id_from_compound_rejects_malformed(cid):
    assert server.SyncHandler._proj_id_from_compound(cid) is None


# ── _is_valid_doc_type ───────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["URS", "ra", "TC-IQ", "frs_v2"])
def test_valid_doc_type_accepts_legit(value):
    assert server._is_valid_doc_type(value) is True


@pytest.mark.parametrize("value", [
    "../../../etc/passwd",
    "doc type",
    "a" * 61,
    "",
    None,
])
def test_valid_doc_type_rejects_garbage(value):
    assert server._is_valid_doc_type(value) is False
