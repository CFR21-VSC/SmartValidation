"""
r2_adapter.py — Cloudflare R2 storage for evidence images.

Uses boto3 S3-compatible API. Configured via environment variables:
  R2_ENDPOINT_URL        https://<account_id>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID       R2 API token access key
  R2_SECRET_ACCESS_KEY   R2 API token secret
  R2_BUCKET_NAME         Bucket name (e.g. smart-validation-evidence)

Falls back gracefully when not configured (is_configured() returns False).
"""
import base64
import os

_R2_ENDPOINT  = os.environ.get("R2_ENDPOINT_URL", "").rstrip("/")
_R2_KEY_ID    = os.environ.get("R2_ACCESS_KEY_ID", "")
_R2_SECRET    = os.environ.get("R2_SECRET_ACCESS_KEY", "")
_R2_BUCKET    = os.environ.get("R2_BUCKET_NAME", "")

_client = None


def is_configured() -> bool:
    return bool(_R2_ENDPOINT and _R2_KEY_ID and _R2_SECRET and _R2_BUCKET)


def _get_client():
    global _client
    if _client is not None:
        return _client
    if not is_configured():
        return None
    try:
        import boto3
        _client = boto3.client(
            "s3",
            endpoint_url=_R2_ENDPOINT,
            aws_access_key_id=_R2_KEY_ID,
            aws_secret_access_key=_R2_SECRET,
            region_name="auto",
        )
    except Exception as exc:
        print(f"[R2] Error al crear cliente: {exc}")
        _client = None
    return _client


def put_image(key: str, data_uri: str) -> bool:
    """Store a data-URI image in R2. Returns True on success."""
    c = _get_client()
    if not c:
        return False
    try:
        mime = "image/jpeg"
        b64 = data_uri
        if data_uri.startswith("data:") and "," in data_uri:
            header, b64 = data_uri.split(",", 1)
            if ";" in header:
                mime = header.split(":")[1].split(";")[0].strip()
        image_bytes = base64.b64decode(b64 + "==")
        c.put_object(Bucket=_R2_BUCKET, Key=key, Body=image_bytes, ContentType=mime)
        return True
    except Exception as exc:
        print(f"[R2] Error al subir {key}: {exc}")
        return False


def get_image(key: str) -> "str | None":
    """Fetch an image from R2 and return it as a data-URI, or None."""
    c = _get_client()
    if not c:
        return None
    try:
        resp = c.get_object(Bucket=_R2_BUCKET, Key=key)
        content_type = resp.get("ContentType", "image/jpeg")
        image_bytes = resp["Body"].read()
        b64 = base64.b64encode(image_bytes).decode("ascii")
        return f"data:{content_type};base64,{b64}"
    except Exception as exc:
        print(f"[R2] Error al descargar {key}: {exc}")
        return None


def list_project_keys(proj_id: str) -> "list[str]":
    """List all R2 keys for a project (prefix = proj_id + '_')."""
    c = _get_client()
    if not c:
        return []
    try:
        prefix = proj_id + "_"
        paginator = c.get_paginator("list_objects_v2")
        keys = []
        for page in paginator.paginate(Bucket=_R2_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return keys
    except Exception as exc:
        print(f"[R2] Error al listar {proj_id}: {exc}")
        return []


def delete_image(key: str) -> bool:
    """Delete one image from R2 by key. Returns True on success."""
    c = _get_client()
    if not c:
        return False
    try:
        c.delete_object(Bucket=_R2_BUCKET, Key=key)
        return True
    except Exception as exc:
        print(f"[R2] Error al borrar {key}: {exc}")
        return False


def delete_project_images(proj_id: str) -> int:
    """Delete ALL R2 images for a project. Returns number of keys deleted."""
    keys = list_project_keys(proj_id)
    count = 0
    for key in keys:
        if delete_image(key):
            count += 1
    return count
