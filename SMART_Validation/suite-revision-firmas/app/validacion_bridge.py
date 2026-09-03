"""
validacion_bridge.py — Cliente HTTP saliente hacia la Suite Documental (server.py),
dirección INVERSA del bridge (Firmas -> Validación): mandar una corrección para que se
re-valide contra el motor de coherencia y, si pasa (o DRP confirma pese a advertencias),
se persista allá.

Antes de esto solo existía la dirección Validación -> Firmas (server.py `_bridge_request`).
Esta es la contraparte simétrica del lado de Firmas: mismo patrón robusto -- nunca lanza,
siempre devuelve un dict con "ok" -- y el mismo secreto compartido BRIDGE_API_KEY (header
X-Bridge-Key), configurado en ambos servicios.
"""
import json
import urllib.error
import urllib.request

from . import config


def push_correction(
    project_id: str, doc_type: str, json_data: dict, actor_username: str, confirmed: bool = False,
) -> dict:
    """Devuelve el body de respuesta de server.py (siempre con "ok" agregado/confirmado):
    - ok=True: se persistió (puede traer "issues" con advertencias MAYOR/MENOR nuevas igual).
    - ok=False, reason="critical": bloqueado, no se puede enviar (issues CRITICO nuevos).
    - ok=False, reason="needs_confirmation": hay MAYOR/MENOR nuevos -- reintentar con
      confirmed=True si DRP decide mandarlo igual.
    - ok=False sin "reason": error de red/config/servicio no disponible."""
    if not config.VALIDACION_BASE_URL or not config.BRIDGE_API_KEY:
        return {
            "ok": False,
            "error": "Bridge no configurado (falta VALIDACION_BASE_URL o BRIDGE_API_KEY)",
            "status": 503,
        }

    url = (
        f"{config.VALIDACION_BASE_URL}/api/bridge/projects/{project_id}"
        f"/documents/{doc_type}/validate-and-push"
    )
    payload = json.dumps({
        "json_data": json_data,
        "confirmed": confirmed,
        "actor_username": actor_username,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json", "X-Bridge-Key": config.BRIDGE_API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = json.loads(resp.read() or b"{}")
            body["ok"] = True
            body["status"] = resp.status
            return body
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read())
        except Exception:
            body = {}
        body["ok"] = False
        body["status"] = exc.code
        body.setdefault("error", str(exc.reason))
        return body
    except Exception as exc:
        return {"ok": False, "error": str(exc), "status": None}
