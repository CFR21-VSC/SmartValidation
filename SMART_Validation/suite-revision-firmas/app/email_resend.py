"""
email_resend.py — Envío transaccional vía Resend.

Mismo mecanismo que _send_email en server.py (Suite de Validación): request
HTTP directo a la API de Resend en un thread daemon, no-op silencioso si no
hay API key configurada (permite desarrollar sin cuenta de Resend).
"""
import json
import sys
import threading
import urllib.error
import urllib.request

from . import config


def send_email(to: str, subject: str, html: str) -> None:
    if not config.RESEND_API_KEY or not to or "@" not in to:
        return

    def _worker():
        payload = json.dumps({
            "from": config.FROM_EMAIL, "to": [to], "subject": subject, "html": html,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=payload,
            headers={
                "Authorization": f"Bearer {config.RESEND_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "SuiteRevisionFirmas/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status not in (200, 201):
                    sys.stderr.write(f"[email] HTTP {resp.status} enviando a {to}\n")
        except Exception as exc:
            sys.stderr.write(f"[email] Falló envío a {to}: {exc}\n")

    threading.Thread(target=_worker, daemon=True).start()


def send_invite_email(to: str, display_name: str, invite_link: str) -> None:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#0B2341;">Invitación — Suite de Revisión y Firmas</h2>
      <p>Hola {display_name or to},</p>
      <p>Fuiste invitado a revisar y firmar documentos en la Suite de Revisión y Firmas.</p>
      <p style="margin:24px 0;">
        <a href="{invite_link}" style="background:#C8921A;color:#0B2341;padding:10px 20px;
           border-radius:6px;text-decoration:none;font-weight:700;">Activar mi cuenta</a>
      </p>
      <p style="font-size:12px;color:#666;">Si no esperabas este correo, podés ignorarlo.</p>
    </div>
    """
    send_email(to, "Invitación — Suite de Revisión y Firmas", html)
