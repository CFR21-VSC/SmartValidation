"""
Sincronización por diferencias con fusión por elemento (sync_delta.py y POST /snapshot/delta).

Escenario que motivó todo esto: una sesión con copia atrasada reabría carpetas/protocolos que otra
sesión había finalizado. Acá se verifica que solo se rechaza lo que OTRA sesión tocó después de la
revisión base, y que dos sesiones que editan elementos distintos no se pisan.
"""
import copy
import sys
import uuid
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sync_delta as sd  # noqa: E402


def _snap():
    return {
        "tests": [{"id": "t1", "name": "uno", "finalized": False}, {"id": "t2", "name": "dos", "finalized": False}],
        "groups": [{"id": "g1", "name": "A", "finalized": False}],
        "protocols": [{"id": "p1", "code": "PIQ", "finalized": False}],
        "projectData": {"finalized": False},
        "systemInfo": {"nombreSistema": "X"},
    }


def _servidor(rev=100.0):
    """Snapshot como lo dejaría un guardado completo en la revisión `rev`."""
    return sd.stamp_entities({}, _snap(), rev)


# ---------------------------------------------------------------- unitarias

def test_guardado_completo_sella_todo_y_conserva_lo_que_no_cambia():
    s1 = _servidor(100.0)
    assert all(t["_srev"] == 100.0 for t in s1["tests"])
    nuevo = copy.deepcopy(_snap())
    nuevo["tests"][0]["finalized"] = True            # solo t1 cambia
    s2 = sd.stamp_entities(s1, nuevo, 200.0)
    assert s2["tests"][0]["_srev"] == 200.0
    assert s2["tests"][1]["_srev"] == 100.0           # t2 conserva su sello
    assert s2["groups"][0]["_srev"] == 100.0


def test_delta_sin_nadie_mas_se_aplica_completo():
    s = _servidor(100.0)
    cambios = {"tests": {"upsert": [{"id": "t1", "name": "uno", "finalized": True}]}}
    conf, changed = sd.apply_delta(s, cambios, base_rev=100.0, cur_rev=100.0, now=150.0)
    assert conf == [] and changed
    assert s["tests"][0]["finalized"] is True and s["tests"][0]["_srev"] == 150.0


def test_sesion_atrasada_no_pisa_lo_que_otra_finalizo():
    """Caso real: B (base 100) intenta guardar su carpeta abierta; A ya la había finalizado (rev 200)."""
    s = _servidor(100.0)
    # A finaliza la carpeta g1 en rev 200
    sd.apply_delta(s, {"groups": {"upsert": [{"id": "g1", "name": "A", "finalized": True}]}}, 100.0, 100.0, 200.0)
    # B, con base 100, manda su copia de g1 (abierta) y además una edición propia de t2
    cambios = {"groups": {"upsert": [{"id": "g1", "name": "A", "finalized": False}]},
               "tests": {"upsert": [{"id": "t2", "name": "dos EDITADO", "finalized": False}]}}
    conf, changed = sd.apply_delta(s, cambios, base_rev=100.0, cur_rev=200.0, now=300.0)
    assert conf == [{"kind": "groups", "id": "g1", "motivo": "modificado"}]
    assert s["groups"][0]["finalized"] is True                 # lo de A se conserva
    assert s["tests"][1]["name"] == "dos EDITADO"              # lo no conflictivo de B sí entra
    assert changed


def test_sesiones_que_editan_elementos_distintos_no_se_pisan():
    s = _servidor(100.0)
    sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "name": "uno A", "finalized": False}]}}, 100.0, 100.0, 200.0)
    conf, _ = sd.apply_delta(s, {"tests": {"upsert": [{"id": "t2", "name": "dos B", "finalized": False}]}}, 100.0, 200.0, 300.0)
    assert conf == []
    assert [t["name"] for t in s["tests"]] == ["uno A", "dos B"]


def test_no_resucita_un_elemento_borrado_por_otra_sesion():
    s = _servidor(100.0)
    sd.apply_delta(s, {"tests": {"remove": ["t2"]}}, 100.0, 100.0, 200.0)
    conf, _ = sd.apply_delta(s, {"tests": {"upsert": [{"id": "t2", "name": "dos", "finalized": False}]}}, 100.0, 200.0, 300.0)
    assert conf and conf[0]["motivo"] == "eliminado"
    assert [t["id"] for t in s["tests"]] == ["t1"]


def test_borrar_algo_que_otra_sesion_modifico_es_conflicto():
    s = _servidor(100.0)
    sd.apply_delta(s, {"tests": {"upsert": [{"id": "t2", "name": "dos EDITADO", "finalized": False}]}}, 100.0, 100.0, 200.0)
    conf, _ = sd.apply_delta(s, {"tests": {"remove": ["t2"]}}, 100.0, 200.0, 300.0)
    assert conf and [t["id"] for t in s["tests"]] == ["t1", "t2"]


def test_metadatos_se_protegen_igual():
    s = _servidor(100.0)
    sd.apply_delta(s, {"meta": {"projectData": {"finalized": True}}}, 100.0, 100.0, 200.0)
    conf, _ = sd.apply_delta(s, {"meta": {"projectData": {"finalized": False}}}, 100.0, 200.0, 300.0)
    assert conf == [{"kind": "meta", "id": "projectData", "motivo": "modificado"}]
    assert s["projectData"]["finalized"] is True


def test_changes_since_devuelve_lo_que_el_cliente_no_tiene():
    s = _servidor(100.0)
    sd.apply_delta(s, {"groups": {"upsert": [{"id": "g1", "name": "A", "finalized": True}]},
                       "tests": {"remove": ["t2"]}, "meta": {"projectData": {"finalized": True}}}, 100.0, 100.0, 200.0)
    sc = sd.changes_since(s, base_rev=100.0)
    assert [g["id"] for g in sc["groups"]] == ["g1"]
    assert sc["removed"]["tests"] == ["t2"]
    assert sc["meta"] == {"projectData": {"finalized": True}}
    assert sc["tests"] == []                                    # t1 no cambió


def test_changes_since_excluye_lo_recien_escrito_por_el_propio_cliente():
    s = _servidor(100.0)
    sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "name": "mio", "finalized": False}]}}, 100.0, 100.0, 200.0)
    assert sd.changes_since(s, 100.0, exclude_rev=200.0)["tests"] == []


def test_elementos_sin_sello_se_tratan_con_criterio_conservador():
    s = _snap()                                                 # snapshot viejo, sin _srev ni _sync
    conf, _ = sd.apply_delta(s, {"tests": {"upsert": [{"id": "t1", "name": "x", "finalized": True}]}},
                             base_rev=50.0, cur_rev=100.0, now=200.0)
    assert conf and conf[0]["id"] == "t1"


def test_ids_invalidos_se_ignoran():
    s = _servidor(100.0)
    conf, changed = sd.apply_delta(s, {"tests": {"upsert": [{"name": "sin id"}, {"id": True}, {"id": ""}], "remove": [None, {}]}},
                                   100.0, 100.0, 200.0)
    assert conf == [] and not changed and len(s["tests"]) == 2


# ---------------------------------------------------------------- integración

PID = "proj_test_delta_" + uuid.uuid4().hex[:8]


def _full(base, snap, base_rev):
    return requests.post(f"{base}/api/projects/{PID}/snapshot", json={"snapshot": snap, "baseRev": base_rev}, timeout=10)


def _delta(base, base_rev, changes):
    return requests.post(f"{base}/api/projects/{PID}/snapshot/delta", json={"baseRev": base_rev, "changes": changes}, timeout=10)


def test_endpoint_flujo_completo_dos_sesiones(live_server):
    r = _full(live_server, _snap(), 0)
    assert r.status_code == 200
    rev0 = r.json()["rev"]

    # A finaliza la carpeta
    ra = _delta(live_server, rev0, {"groups": {"upsert": [{"id": "g1", "name": "A", "finalized": True}]}})
    assert ra.status_code == 200 and ra.json()["conflicts"] == []
    revA = ra.json()["rev"]
    assert revA > rev0

    # B (base rev0) intenta reabrirla y edita t2
    rb = _delta(live_server, rev0, {"groups": {"upsert": [{"id": "g1", "name": "A", "finalized": False}]},
                                    "tests": {"upsert": [{"id": "t2", "name": "dos B", "finalized": False}]}})
    assert rb.status_code == 200
    j = rb.json()
    assert [c["id"] for c in j["conflicts"]] == ["g1"]
    # B recibe la versión del servidor de la carpeta para converger
    assert [g["id"] for g in j["serverChanges"]["groups"]] == ["g1"]
    assert j["serverChanges"]["groups"][0]["finalized"] is True

    got = requests.get(f"{live_server}/api/projects/{PID}/snapshot", timeout=10).json()["snapshot"]
    assert got["groups"][0]["finalized"] is True
    assert got["tests"][1]["name"] == "dos B"


def test_endpoint_sin_snapshot_previo_pide_guardado_completo(live_server):
    r = requests.post(f"{live_server}/api/projects/proj_sin_snapshot_{uuid.uuid4().hex[:6]}/snapshot/delta",
                      json={"baseRev": 5, "changes": {}}, timeout=10)
    assert r.status_code in (403, 409)


def test_endpoint_validacion_de_entrada(live_server):
    assert requests.post(f"{live_server}/api/projects/{PID}/snapshot/delta", json={"changes": {}}, timeout=10).status_code == 400
    assert requests.post(f"{live_server}/api/projects/{PID}/snapshot/delta", json={"baseRev": 1}, timeout=10).status_code == 400
    assert requests.post(f"{live_server}/api/projects/{PID}/snapshot/delta", json={"baseRev": "x", "changes": {}}, timeout=10).status_code == 400


def test_endpoint_delta_sin_cambios_funciona_como_consulta(live_server):
    rev = requests.get(f"{live_server}/api/projects/{PID}/rev", timeout=10).json()["rev"]
    r = _delta(live_server, rev - 1000, {})          # cliente muy atrasado, sin cambios propios: solo "baja"
    j = r.json()
    assert r.status_code == 200 and j["rev"] == rev and j["conflicts"] == []
    assert len(j["serverChanges"]["groups"]) >= 1
