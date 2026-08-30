-- Suite de Revisión y Firmas — esquema de datos (prefijo rf_).
-- Fase 1: Capa 1 (login) + Capa 2 (roles y permisos).
-- Las tablas de documentos/firmas/audit trail se agregan en fases siguientes.

CREATE TABLE IF NOT EXISTS rf_users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    display_name  TEXT,
    role          TEXT NOT NULL DEFAULT 'cliente',  -- 'drp' | 'cliente'
    is_superadmin INTEGER DEFAULT 0,
    password_hash TEXT,               -- NULL hasta que acepta la invitación
    pin_hash      TEXT,               -- NULL hasta que configura su PIN de firma
    pin_set       INTEGER DEFAULT 0,  -- 0 = debe configurar PIN antes de firmar
    is_active     INTEGER DEFAULT 1,
    created_by    TEXT,
    created_at    REAL,
    updated_at    REAL,
    last_login    REAL
);

CREATE TABLE IF NOT EXISTS rf_invites (
    token         TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES rf_users(id) ON DELETE CASCADE,
    created_at    REAL,
    expires_at    REAL,
    consumed_at   REAL
);

CREATE TABLE IF NOT EXISTS rf_document_access_grants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES rf_users(id) ON DELETE CASCADE,
    project_id    TEXT NOT NULL,
    doc_type      TEXT NOT NULL,
    granted_by    TEXT,
    granted_at    REAL,
    UNIQUE(user_id, project_id, doc_type)
);

-- Revocación de tokens de sesión (logout / invalidación forzada), mismo patrón
-- que auth_sessions en la Suite de Validación.
CREATE TABLE IF NOT EXISTS rf_sessions (
    nonce         TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    created_at    REAL,
    revoked_at    REAL
);

CREATE INDEX IF NOT EXISTS idx_rf_grants_user ON rf_document_access_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_rf_grants_proj ON rf_document_access_grants(project_id, doc_type);

-- Fase 2: Capa 3 — documentos cargados a mano por DRP + correcciones de revisión.

CREATE TABLE IF NOT EXISTS rf_documents (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL,
    doc_type      TEXT NOT NULL,
    json_data     TEXT NOT NULL,       -- fuente cargada por DRP (panel izquierdo, inmutable en revisión)
    status        TEXT NOT NULL DEFAULT 'in_review',  -- 'in_review' | 'locked'
    locked        INTEGER DEFAULT 0,
    pdf_hash      TEXT,
    json_hash     TEXT,
    locked_at     REAL,
    loaded_by     TEXT,
    created_at    REAL,
    updated_at    REAL,
    UNIQUE(project_id, doc_type)
);

-- Panel derecho: documento corregido, autoguardado por sección. Nunca pisa rf_documents.json_data.
CREATE TABLE IF NOT EXISTS rf_section_corrections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   TEXT NOT NULL REFERENCES rf_documents(id) ON DELETE CASCADE,
    section_key   TEXT NOT NULL,
    content       TEXT NOT NULL,
    resolved      INTEGER DEFAULT 0,  -- DRP la marca resuelta cuando ya la aplicó/consideró
    updated_by    TEXT,
    updated_at    REAL,
    UNIQUE(document_id, section_key)
);

-- Libro de Validación — People / audit trail (capa de datos, sin UI todavía — sección 6).
CREATE TABLE IF NOT EXISTS rf_people_book_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    TEXT NOT NULL,
    doc_type      TEXT,
    user_id       TEXT,
    username      TEXT,
    event_type    TEXT NOT NULL,
    description   TEXT,
    created_at    REAL
);

CREATE INDEX IF NOT EXISTS idx_rf_corrections_doc ON rf_section_corrections(document_id);
CREATE INDEX IF NOT EXISTS idx_rf_events_project ON rf_people_book_events(project_id, doc_type);

-- Fase 3: Firma — dos etapas separadas (sección 5).

-- 5.1 Firma de Revisión: sin orden, uno por firmante.
CREATE TABLE IF NOT EXISTS rf_review_signatures (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   TEXT NOT NULL REFERENCES rf_documents(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    username      TEXT,
    role_label    TEXT,
    signed_at     REAL,
    UNIQUE(document_id, user_id)
);

-- 5.2 Firma de Aprobación: con orden, texto justificativo obligatorio, DRP firma último y sella.
CREATE TABLE IF NOT EXISTS rf_approval_rounds (
    id            TEXT PRIMARY KEY,
    document_id   TEXT NOT NULL REFERENCES rf_documents(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'sealed' | 'cancelled'
    created_by    TEXT,
    created_at    REAL,
    sealed_at     REAL
);

CREATE TABLE IF NOT EXISTS rf_approval_signers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id            TEXT NOT NULL REFERENCES rf_approval_rounds(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL,
    username            TEXT,
    role_label          TEXT,
    sign_order          INTEGER NOT NULL,
    signed_at           REAL,
    justification_text  TEXT,
    UNIQUE(round_id, user_id),
    UNIQUE(round_id, sign_order)
);

CREATE INDEX IF NOT EXISTS idx_rf_review_sig_doc ON rf_review_signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_rf_approval_rounds_doc ON rf_approval_rounds(document_id);
CREATE INDEX IF NOT EXISTS idx_rf_approval_signers_round ON rf_approval_signers(round_id);
