"""
Script de importación: crea el proyecto EMQC-001 en la DB y carga el HLRA existente.
Ejecutar con: python import_emara.py
"""
import sqlite3
import json
import uuid
import time
import os

_HERE     = os.path.dirname(os.path.abspath(__file__))
DB_PATH   = os.environ.get("DB_PATH", os.path.join(_HERE, "data", "smart_validation.db"))
HLRA_PATH = os.environ.get("HLRA_PATH", os.path.join(_HERE, "ai-docs", "HLRA-EMQC-001.json"))

def main():
    # --- Leer el JSON del HLRA ---
    if not os.path.exists(HLRA_PATH):
        print(f"[ERROR] No se encontró el archivo HLRA: {HLRA_PATH}")
        return
    with open(HLRA_PATH, "r", encoding="utf-8") as f:
        hlra_content = json.load(f)
    hlra_str = json.dumps(hlra_content, ensure_ascii=False)
    print(f"[OK] HLRA leído: {len(hlra_str):,} caracteres")

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    # --- Verificar si ya existe el proyecto ---
    existing = db.execute(
        "SELECT id, name FROM projects WHERE name = ? OR system_name = ?",
        ("emqc® — EMAQC-001", "emqc®")
    ).fetchone()

    if existing:
        proj_id = existing["id"]
        print(f"[INFO] Proyecto ya existe con ID: {proj_id}  ({existing['name']})")
    else:
        proj_id = str(uuid.uuid4())
        now = time.time()
        db.execute("BEGIN")
        db.execute("""
            INSERT INTO projects
              (id, name, system_name, system_type, gamp_category, cliente,
               status, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            proj_id,
            "Validación emqc® — EMQC-001",
            "emqc®",
            "Web SaaS / Cloud (AWS EC2 + SQL Server 2019)",
            "GAMP 4",
            "EMARA (Enlace Molecular SRL)",
            "in_progress",
            "admin",
            now, now
        ))
        db.execute("""
            INSERT INTO audit_events
              (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (?, NULL, ?, 'project_create', ?, ?, ?)
        """, (proj_id, "admin", "Proyecto creado por script de importación", "127.0.0.1", now))
        db.execute("COMMIT")
        print(f"[OK] Proyecto creado con ID: {proj_id}")

    # --- Cargar el HLRA en la tabla documents ---
    now = time.time()
    existing_doc = db.execute(
        "SELECT id, status FROM documents WHERE project_id = ? AND doc_type = ?",
        (proj_id, "HLRA")
    ).fetchone()

    if existing_doc:
        if existing_doc["status"] in ("approved", "for_review"):
            print(f"[WARN] El HLRA ya existe y está en estado '{existing_doc['status']}' — no se sobreescribe.")
        else:
            doc_id = existing_doc["id"]
            db.execute("BEGIN")
            db.execute("""
                UPDATE documents
                SET json_data = ?, version = 1, status = 'draft', updated_at = ?
                WHERE id = ?
            """, (hlra_str, now, doc_id))
            db.execute("""
                INSERT INTO audit_events
                  (project_id, doc_type, username, action, detail, ip, created_at)
                VALUES (?, ?, ?, 'doc_update', ?, ?, ?)
            """, (proj_id, "HLRA", "admin", "HLRA actualizado por script de importación", "127.0.0.1", now))
            db.execute("COMMIT")
            print("[OK] HLRA actualizado en la DB (existía como draft)")
    else:
        doc_id = str(uuid.uuid4())
        db.execute("BEGIN")
        db.execute("""
            INSERT INTO documents
              (id, project_id, doc_type, version, status, json_data,
               created_by, created_at, updated_at)
            VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?)
        """, (doc_id, proj_id, "HLRA", hlra_str, "admin", now, now))
        db.execute("""
            INSERT INTO audit_events
              (project_id, doc_type, username, action, detail, ip, created_at)
            VALUES (?, ?, ?, 'doc_create', ?, ?, ?)
        """, (proj_id, "HLRA", "admin", "HLRA importado por script de importación", "127.0.0.1", now))
        db.execute("COMMIT")
        print("[OK] HLRA importado como nuevo documento en la DB")

    db.close()
    print()
    print("=" * 55)
    print(f"  Proyecto ID : {proj_id}")
    print(f"  Documento   : HLRA-EMQC-001  |  estado: draft")
    print(f"  Abrí el sistema y buscá el proyecto 'Validación emqc®'")
    print("=" * 55)

if __name__ == "__main__":
    main()
