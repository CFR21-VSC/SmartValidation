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
from html import escape as _esc

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


def send_access_granted_email(to: str, display_name: str, project_id: str, doc_type: str, link: str) -> None:
    # Todo lo que viene de datos de usuario (nombre, ids) se escapa antes de meterlo en el
    # HTML del mail -- si no, un display_name o doc_type con "<script>" quedaría inyectado
    # tal cual en el correo (Resend lo manda como HTML, no como texto plano).
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#0B2341;">Nuevo documento para revisar/firmar</h2>
      <p>Hola {_esc(display_name or to)},</p>
      <p>Te dieron acceso a <strong>{_esc(doc_type)}</strong> (proyecto <strong>{_esc(project_id)}</strong>)
         en la Suite de Revisión y Firmas.</p>
      <p style="margin:24px 0;">
        <a href="{link}" style="background:#C8921A;color:#0B2341;padding:10px 20px;
           border-radius:6px;text-decoration:none;font-weight:700;">Ver documento</a>
      </p>
      <p style="font-size:12px;color:#666;">Si no esperabas este correo, podés ignorarlo.</p>
    </div>
    """
    send_email(to, f"Acceso otorgado — {doc_type}", html)


def send_new_comment_email(
    to: str, display_name: str, project_id: str, doc_type: str,
    section_key: str, author: str, content: str, link: str,
) -> None:
    preview = content if len(content) <= 300 else content[:300] + "…"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#0B2341;">Nuevo comentario en {_esc(doc_type)}</h2>
      <p>Hola {_esc(display_name or to)},</p>
      <p><strong>{_esc(author)}</strong> dejó un comentario en <strong>{_esc(doc_type)}</strong>
         (proyecto <strong>{_esc(project_id)}</strong>, sección {_esc(section_key)}):</p>
      <p style="background:#f4f4f4;border-left:3px solid #C8921A;padding:10px 14px;
         color:#333;white-space:pre-wrap;">{_esc(preview)}</p>
      <p style="margin:24px 0;">
        <a href="{link}" style="background:#C8921A;color:#0B2341;padding:10px 20px;
           border-radius:6px;text-decoration:none;font-weight:700;">Ver documento</a>
      </p>
    </div>
    """
    send_email(to, f"Nuevo comentario en {doc_type}", html)


def send_invite_email(to: str, display_name: str, invite_link: str) -> None:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#0B2341;">Invitación — Suite de Revisión y Firmas</h2>
      <p>Hola {_esc(display_name or to)},</p>
      <p>Fuiste invitado a revisar y firmar documentos en la Suite de Revisión y Firmas.</p>
      <p style="margin:24px 0;">
        <a href="{invite_link}" style="background:#C8921A;color:#0B2341;padding:10px 20px;
           border-radius:6px;text-decoration:none;font-weight:700;">Activar mi cuenta</a>
      </p>
      <p style="font-size:12px;color:#666;">Si no esperabas este correo, podés ignorarlo.</p>
    </div>
    """
    send_email(to, "Invitación — Suite de Revisión y Firmas", html)
