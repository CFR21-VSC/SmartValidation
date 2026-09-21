"""Proyectos privados (2026-09-19, pedido del usuario): "quisiera tener un super
administrador, para manejar proyectos que puedan ser privados que los vea solo yo (ni
siquiera otros usuarios DRP), de hecho ellos no deberían ver mi usuario superadministrador y
que puede crear proyectos secretos (que debo poder compartir para firmar)".

`drp_client` (conftest.py) YA es la cuenta superadmin de bootstrap -- no hace falta
promoverla. Estos tests verifican la propiedad de seguridad central: un proyecto privado es
invisible para cualquier DRP que no sea su dueño, en TODOS los endpoints que devuelven algo
de ese proyecto -- no alcanza con ocultarlo de un solo listado."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import accept_signature_consent

SAMPLE_JSON = {"type": "HLRA", "metadata": {"title": "Análisis"}, "secciones": []}


@pytest.fixture
def drp_with_pin(drp_client):
    drp_client.post("/auth/set-pin", json={"pin": "9999"})
    accept_signature_consent(drp_client)
    return drp_client


def _invite(drp, username, role):
    created = drp.post(
        "/users",
        json={"username": username, "email": f"{username}@example.com", "display_name": username, "role": role},
    )
    assert created.status_code == 200, created.text
    user_id = created.json()["user_id"]
    token = created.json()["invite_link"].split("token=")[-1]
    cli = TestClient(app)
    accept = cli.post(f"/invite/{token}/accept", json={"password": "password123", "pin": "1234"})
    assert accept.status_code == 200, accept.text
    accept_signature_consent(cli)
    return cli, user_id


@pytest.fixture
def other_drp(drp_with_pin):
    """Un segundo DRP normal -- NO superadmin. El actor cuyo punto de vista prueba casi
    todo este archivo: alguien con rol drp de siempre, que hoy vería absolutamente todo."""
    cli, uid = _invite(drp_with_pin, "otro-drp", "drp")
    cli.post("/auth/set-pin", json={"pin": "8888"})
    return cli, uid


@pytest.fixture
def cliente(drp_with_pin):
    return _invite(drp_with_pin, "cliente-priv", "cliente")


def _create_private_project(drp_with_pin, project_id="proyecto-secreto"):
    r = drp_with_pin.post("/projects", json={"id": project_id, "is_private": True})
    assert r.status_code == 200, r.text
    return project_id


# ─── Creación: exclusiva de superadmin ─────────────────────────────────────────

def test_only_superadmin_can_create_private_project(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    r = other_cli.post("/projects", json={"id": "intento-secreto", "is_private": True})
    assert r.status_code == 403


def test_any_drp_can_create_a_normal_public_project(other_drp):
    """Un DRP normal sigue pudiendo crear proyectos públicos comunes -- lo nuevo es
    exclusivamente la opción "privado"."""
    other_cli, _uid = other_drp
    r = other_cli.post("/projects", json={"id": "proyecto-comun"})
    assert r.status_code == 200, r.text
    assert r.json()["is_private"] is False


def test_create_project_rejects_duplicate_id(drp_with_pin):
    drp_with_pin.post("/projects", json={"id": "dup-1"})
    r = drp_with_pin.post("/projects", json={"id": "dup-1"})
    assert r.status_code == 409


def test_create_project_rejects_id_colliding_with_implicit_project(drp_with_pin):
    """Un id que ya tiene documentos (creado a la vieja usanza, cargando un documento
    directo) no se puede "capturar" como privado después -- eso dejaría una ventana donde
    existió como público."""
    drp_with_pin.put("/projects/ya-existe/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = drp_with_pin.post("/projects", json={"id": "ya-existe", "is_private": True})
    assert r.status_code == 409


# ─── Invisibilidad para otro DRP: cada endpoint que toca el proyecto ───────────

def test_private_project_hidden_from_list_projects(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})

    mine = drp_with_pin.get("/projects").json()["projects"]
    assert any(p["id"] == proj for p in mine)

    theirs = other_cli.get("/projects").json()["projects"]
    assert not any(p["id"] == proj for p in theirs)


def test_private_project_dossier_404_for_other_drp(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})

    mine = drp_with_pin.get(f"/projects/{proj}/dossier")
    assert mine.status_code == 200
    assert len(mine.json()["documents"]) == 1

    theirs = other_cli.get(f"/projects/{proj}/dossier")
    # get_dossier no 404ea -- cae al mismo camino que cliente/partner, que da lista vacía
    # sin grants. La propiedad que importa es que NO ve el documento.
    assert theirs.status_code == 200
    assert theirs.json()["documents"] == []


def test_private_project_document_list_empty_for_other_drp(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})

    assert len(drp_with_pin.get(f"/projects/{proj}/documents").json()["documents"]) == 1
    assert other_cli.get(f"/projects/{proj}/documents").json()["documents"] == []


def test_private_project_single_document_404_for_other_drp(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})

    assert drp_with_pin.get(f"/projects/{proj}/documents/HLRA").status_code == 200
    assert other_cli.get(f"/projects/{proj}/documents/HLRA").status_code == 404


def test_private_project_other_drp_cannot_load_document(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    r = other_cli.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    assert r.status_code == 404


def test_private_project_other_drp_cannot_delete_document(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = other_cli.delete(f"/projects/{proj}/documents/HLRA")
    assert r.status_code == 404


def test_private_project_other_drp_cannot_list_grants(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = other_cli.get(f"/projects/{proj}/documents/HLRA/grants")
    assert r.status_code == 404


def test_private_project_other_drp_cannot_reorder_documents(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = other_cli.patch(f"/projects/{proj}/documents/order", json={"doc_types": ["HLRA"]})
    assert r.status_code == 404


def test_private_project_other_drp_cannot_see_people_book(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = other_cli.get(f"/projects/{proj}/documents/HLRA/people-book")
    assert r.status_code == 404


def test_private_project_other_drp_cannot_see_book_package(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    r = other_cli.get(f"/projects/{proj}/book-package")
    assert r.status_code == 404


def test_private_project_other_drp_cannot_rename_close_archive_delete_or_brand(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    assert other_cli.patch(f"/projects/{proj}/display-name", json={"display_name": "x"}).status_code == 404
    assert other_cli.patch(f"/projects/{proj}/branding", json={"partner_name": "x"}).status_code == 404
    assert other_cli.patch(f"/projects/{proj}/close").status_code == 404
    assert other_cli.patch(f"/projects/{proj}/archive").status_code == 404
    assert other_cli.delete(f"/projects/{proj}").status_code == 404


def test_private_project_other_drp_cannot_see_scoped_audit_log(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    r = other_cli.get(f"/projects/{proj}/audit-log")
    assert r.status_code == 404


def test_private_project_hidden_from_global_audit_log(drp_with_pin, other_drp):
    """El audit-log global (todos los proyectos a la vez) es la filtración más fácil de
    pasar por alto -- sin el filtro, listaba project_id + descripción de TODO, privados
    incluidos, a cualquier DRP."""
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})

    mine = drp_with_pin.get("/audit-log").json()["events"]
    assert any(e["project_id"] == proj for e in mine)

    theirs = other_cli.get("/audit-log").json()["events"]
    assert not any(e["project_id"] == proj for e in theirs)


def test_private_project_reopen_document_404_for_other_drp(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = other_cli.post(f"/projects/{proj}/documents/HLRA/reopen", json={"reason": "intento"})
    assert r.status_code == 404


# ─── "Compartir para firmar": un grant explícito pesa más que ser DRP ajeno ────

def test_owner_can_share_a_document_in_private_project_for_signing(drp_with_pin, cliente):
    """El mecanismo de compartir es el de siempre -- otorgarle a un cliente/partner acceso a
    UN documento puntual. Quien firma ve el documento normal, no necesita saber que el
    proyecto es "secreto"."""
    cli, user_id = cliente
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})

    grant = drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": proj, "doc_type": "HLRA"})
    assert grant.status_code == 200, grant.text

    doc = cli.get(f"/projects/{proj}/documents/HLRA")
    assert doc.status_code == 200, doc.text

    fp = doc.json()["content_fingerprint"]
    signed = cli.post(
        f"/projects/{proj}/documents/HLRA/review-signatures",
        json={"pin": "1234", "content_fingerprint": fp},
    )
    assert signed.status_code == 200, signed.text


def test_cliente_without_grant_cannot_see_private_project_document(drp_with_pin, cliente):
    """Para un proyecto privado, sin grant es 404 (no 403) para CUALQUIERA -- mismo criterio
    de "no confirmar existencia" que para otro DRP, no solo para cliente/partner."""
    cli, _user_id = cliente
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    r = cli.get(f"/projects/{proj}/documents/HLRA")
    assert r.status_code == 404


def test_cliente_with_grant_sees_only_that_document_not_the_rest_of_the_private_project(drp_with_pin, cliente):
    """El grant es puntual -- ver UN documento de un proyecto privado no destapa el resto
    del proyecto."""
    cli, user_id = cliente
    proj = _create_private_project(drp_with_pin)
    drp_with_pin.put(f"/projects/{proj}/documents/HLRA", json={"json_data": SAMPLE_JSON})
    drp_with_pin.put(f"/projects/{proj}/documents/URS", json={"json_data": {"type": "URS", "secciones": []}})
    drp_with_pin.post(f"/users/{user_id}/grants", json={"project_id": proj, "doc_type": "HLRA"})

    docs = cli.get(f"/projects/{proj}/documents").json()["documents"]
    assert [d["doc_type"] for d in docs] == ["HLRA"]
    assert cli.get(f"/projects/{proj}/documents/URS").status_code == 404


# ─── Ocultar la cuenta superadmin de otros DRP ─────────────────────────────────

def test_superadmin_hidden_from_users_list_for_other_drp(drp_with_pin, other_drp):
    other_cli, _uid = other_drp
    mine = drp_with_pin.get("/users").json()["users"]
    assert any(u["is_superadmin"] for u in mine)

    theirs = other_cli.get("/users").json()["users"]
    assert not any(u["is_superadmin"] for u in theirs)
    # El usuario "otro-drp" que sí creó DRP tiene que seguir viéndose a sí mismo/otros no-superadmin.
    assert any(u["username"] == "otro-drp" for u in theirs)
