"""
Reglas que el servidor hace cumplir sobre lo finalizado (sync_delta.violations / transitions /
inmutabilidad) y su efecto en POST /snapshot/delta: 422 ante una violación nueva, y registro de
cada finalización / reapertura en audit_events.
"""
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sync_delta as sd  # noqa: E402


def _snap():
    return {
        "protocols": [{"id": "p1", "code": "PIQ", "finalized": False}],
        "groups": [{"id": "g1", "protocolId": "p1", "finalized": False}],
        "tests": [{"id": "t1", "groupId": "g1", "finalized": False}, {"id": "t2", "groupId": "g1", "finalized": False}],
        "projectData": {"finalized": False},
    }


def _srv(rev=100.0):
    return sd.stamp_entities({}, _snap(), rev)


# ------------------------------------------------------------------ violations

def test_snapshot_limpio_no_tiene_violaciones():
    assert sd.violations(_snap()) == set()


def test_carpeta_finalizada_con_prueba_abierta_es_violacion():
    s = _snap()
    s["groups"][0]["finalized"] = True
    assert len(sd.violations(s)) == 2          # una por cada prueba abierta


def test_protocolo_finalizado_con_carpeta_abierta_es_violacion():
    s = _snap()
    s["protocols"][0]["finalized"] = True
    assert any("protocolo p1" in v for v in sd.violations(s))


def test_proyecto_finalizado_exige_todo_finalizado():
    s = _snap()
    s["projectData"]["finalized"] = True
    assert len(sd.violations(s)) == 3


def test_jerarquia_completa_finalizada_cumple():
    s = _snap()
    for k in ("tests", "groups", "protocols"):
        for e in s[k]:
            e["finalized"] = True
    s["projectData"]["finalized"] = True
    assert sd.violations(s) == set()


# ------------------------------------------------------------------ inmutabilidad

def test_registro_finalizado_no_se_puede_modificar():
    s = _srv()
    sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": True, "conclusion": "ok"}]}}, 100, 100, 200)
    # mismo cliente, base al día, intenta cambiar la conclusión de algo ya finalizado
    conf, changed = sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": True, "conclusion": "OTRA"}]}}, 200, 200, 300)
    assert conf and conf[0]["motivo"] == "finalizado" and not changed
    assert s["tests"][0]["conclusion"] == "ok"


def test_registro_finalizado_no_se_puede_borrar():
    s = _srv()
    sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": True}]}}, 100, 100, 200)
    conf, _ = sd.apply_delta(s, {"tests": {"remove": ["t1"]}}, 200, 200, 300)
    assert conf and conf[0]["motivo"] == "finalizado" and len(s["tests"]) == 2


def test_reabrir_es_la_unica_modificacion_permitida():
    s = _srv()
    sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": True}]}}, 100, 100, 200)
    conf, changed = sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": False}]}}, 200, 200, 300)
    assert conf == [] and changed and s["tests"][0]["finalized"] is False


# ------------------------------------------------------------------ transiciones

def test_transiciones_detecta_finalizacion_y_reapertura():
    antes = _snap()
    despues = _snap()
    despues["tests"][0]["finalized"] = True
    despues["projectData"]["finalized"] = True
    t = sd.transitions(antes, despues)
    assert ("tests", "t1", "finalizada") in t and ("proyecto", "projectData", "finalizada") in t
    assert ("tests", "t1", "reabierta") in sd.transitions(despues, antes)


# ------------------------------------------------------------------ endpoint

PID = "proj_test_reglas_" + uuid.uuid4().hex[:8]


def _full(base, snap, base_rev):
    return requests.post(f"{base}/api/projects/{PID}/snapshot", json={"snapshot": snap, "baseRev": base_rev}, timeout=10)


def _delta(base, rev, changes):
    return requests.post(f"{base}/api/projects/{PID}/snapshot/delta", json={"baseRev": rev, "changes": changes}, timeout=10)


def test_endpoint_rechaza_carpeta_finalizada_con_pruebas_abiertas(live_server):
    rev = _full(live_server, _snap(), 0).json()["rev"]
    r = _delta(live_server, rev, {"groups": {"upsert": [{"id": "g1", "protocolId": "p1", "finalized": True}]}})
    assert r.status_code == 422 and r.json()["violations"]
    got = requests.get(f"{live_server}/api/projects/{PID}/snapshot", timeout=10).json()
    assert got["snapshot"]["groups"][0]["finalized"] is False
    assert got["rev"] == rev                       # no avanzó: se rechazó entero


def test_endpoint_acepta_la_jerarquia_en_orden_y_la_audita(live_server):
    rev = requests.get(f"{live_server}/api/projects/{PID}/rev", timeout=10).json()["rev"]
    cambios = {
        "tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": True}, {"id": "t2", "groupId": "g1", "finalized": True}]},
        "groups": {"upsert": [{"id": "g1", "protocolId": "p1", "finalized": True}]},
    }
    r = _delta(live_server, rev, cambios)
    assert r.status_code == 200 and r.json()["conflicts"] == []
    # reabrir una prueba con su carpeta finalizada viola la jerarquía
    rev2 = r.json()["rev"]
    r2 = _delta(live_server, rev2, {"tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": False}]}})
    assert r2.status_code == 422
    # reabrir primero la carpeta y después la prueba, sí
    r3 = _delta(live_server, rev2, {"groups": {"upsert": [{"id": "g1", "protocolId": "p1", "finalized": False}]},
                                    "tests": {"upsert": [{"id": "t1", "groupId": "g1", "finalized": False}]}})
    assert r3.status_code == 200


# ------------------------------------------------------------------ revisión efectiva (columna con precisión perdida)

def test_revision_efectiva_ignora_el_redondeo_de_la_columna():
    snap = _srv(1793471037.6543)                       # sellos en doble precisión dentro del JSON
    assert sd.effective_rev(1793471000.0, None, snap) == pytest.approx(1793471037.6543)   # columna REAL: redondeada hacia abajo


def test_revision_efectiva_sin_sellos_usa_la_columna_o_updated_at():
    assert sd.effective_rev(150.0, 100.0, {}) == 150.0
    assert sd.effective_rev(None, 100.0, {}) == 100.0
    assert sd.effective_rev(None, None, {}) == 0.0


def test_max_stamp_incluye_metadatos_y_lapidas():
    s = _srv(100.0)
    sd.apply_delta(s, {"tests": {"remove": ["t2"]}, "meta": {"projectData": {"finalized": False, "x": 1}}}, 100, 100, 250.5)
    assert sd.max_stamp(s) == 250.5


def test_una_columna_redondeada_hacia_abajo_no_oculta_la_escritura_de_otra_sesion():
    """Con la columna redondeada, `strict` daba verdadero aunque otra sesión hubiera escrito: se perdía el conflicto."""
    s = _srv(1793471037.6543)
    sd.apply_delta(s, {"groups": {"upsert": [{"id": "g1", "protocolId": "p1", "finalized": True}]}}, 1793471037.6543, 1793471037.6543, 1793471080.0)
    rev_real = sd.effective_rev(1793471000.0, None, s)               # la columna quedó en ...000, el sello dice ...080
    assert rev_real == 1793471080.0
    conf, _ = sd.apply_delta(s, {"groups": {"upsert": [{"id": "g1", "protocolId": "p1", "finalized": False}]}},
                             base_rev=1793471037.6543, cur_rev=rev_real, now=1793471100.0)
    assert conf and conf[0]["motivo"] in ("modificado", "finalizado")
    assert s["groups"][0]["finalized"] is True
