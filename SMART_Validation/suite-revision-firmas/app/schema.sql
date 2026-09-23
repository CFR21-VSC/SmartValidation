-- Suite de Revisión y Firmas — esquema de datos (prefijo rf_).
-- Fase 1: Capa 1 (login) + Capa 2 (roles y permisos).
-- Las tablas de documentos/firmas/audit trail se agregan en fases siguientes.

CREATE TABLE IF NOT EXISTS rf_users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    display_name  TEXT,
    role          TEXT NOT NULL DEFAULT 'cliente',  -- 'drp' | 'partner' | 'cliente'
    is_superadmin INTEGER DEFAULT 0,
    password_hash TEXT,               -- NULL hasta que acepta la invitación
    pin_hash      TEXT,               -- NULL hasta que configura su PIN de firma
    pin_set       INTEGER DEFAULT 0,  -- 0 = debe configurar PIN antes de firmar
    is_active     INTEGER DEFAULT 1,
    created_by    TEXT,
    created_at    REAL,
    updated_at    REAL,
    last_login    REAL,
    -- Nombre a mostrar en cursiva al firmar (2026-09-23, pedido del usuario: "nombre y
    -- apellido tipo cursiva como hace Adobe o DocuSign", configurable por cada uno para sí
    -- mismo). NULL = usar display_name tal cual. Nunca se lee en vivo al armar un documento
    -- ya firmado -- se snapshotea en signature_name_at_signing (rf_review_signatures /
    -- rf_approval_signers) al momento de cada firma, mismo criterio que display_name_at_signing.
    signature_display_name TEXT
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

-- Fuerza bruta: intentos fallidos de login por username (sección pedida por el usuario
-- 2026-08-31). Se trackea por el string tal cual se mandó, exista o no la cuenta -- así un
-- atacante no puede distinguir "usuario inexistente" de "contraseña incorrecta" por si el
-- bloqueo se comporta distinto en un caso u otro.
CREATE TABLE IF NOT EXISTS rf_login_attempts (
    username      TEXT PRIMARY KEY,
    fail_count    INTEGER NOT NULL DEFAULT 0,
    first_fail_at REAL,
    locked_until  REAL
);

-- Mismo mecanismo que rf_login_attempts, pero para el PIN de firma (sección pedida por
-- el usuario 2026-09-01, tras auditoría: sign_review/sign_approval verificaban el PIN sin
-- ningún límite de intentos). Clave por user_id (no username): el PIN se verifica siempre
-- con una sesión ya autenticada, así que hay un uid disponible y no hace falta trackear
-- por string libre como en el login previo a autenticarse.
CREATE TABLE IF NOT EXISTS rf_pin_attempts (
    user_id       TEXT PRIMARY KEY,
    fail_count    INTEGER NOT NULL DEFAULT 0,
    first_fail_at REAL,
    locked_until  REAL
);

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
    -- Ronda 18 (2026-09-19): edit_locked se activa con la PRIMERA firma (revisión o
    -- aprobación), no solo con el sellado final -- antes de esto un documento con firmas
    -- parciales seguía totalmente editable. `locked` sigue significando exactamente lo mismo
    -- que antes (sellado final por el último aprobador). Ver reopen_document en documents.py
    -- para la única vía de volver a poner esto en 0.
    edit_locked   INTEGER DEFAULT 0,
    -- Bytes reales del PDF sellado (antes solo se guardaba el hash, nunca el artefacto) y el
    -- branding/marca fijados al momento del sellado (antes se releía rf_projects actual en
    -- cada render, así que cambiar el logo del proyecto alteraba retroactivamente cómo se
    -- veía un documento ya firmado). original_stored=0 para todo lo sellado antes de esto --
    -- no se inventa un original que nunca se guardó.
    original_stored           INTEGER DEFAULT 0,
    pdf_data                  TEXT,
    branding_name_at_signing  TEXT,
    branding_logo_at_signing  TEXT,
    -- branding_captured_at_signing distingue "se selló SIN marca, a propósito" de "se selló
    -- antes de que este campo existiera, no se sabe qué marca regía" -- sin este flag,
    -- ambos casos se ven igual (branding_logo_at_signing NULL) y el código cae al branding
    -- ACTUAL del proyecto en los dos, incluyendo el caso donde en realidad ya había un
    -- snapshot fijado (sin marca) que no debería pisarse (encontrado en revisión de Codex,
    -- 2026-09-19).
    branding_captured_at_signing INTEGER DEFAULT 0,
    -- Orden elegido a mano por DRP dentro del proyecto (pedido del usuario, 2026-09-19: "el
    -- orden lo doy yo, no un orden fijo"). NULL = todavía no se reordenó a mano, cae al orden
    -- de cascada GxP por defecto (doc_order.py). Se pisa entero cada vez que se guarda un
    -- reordenamiento nuevo (PATCH .../documents-order) -- ver sort_docs.
    display_order INTEGER,
    -- Cierre explícito de revisión (2026-09-21, pedido del usuario): acción formal de DRP
    -- que marca la revisión como completa, independientemente de cuántos revisores hayan
    -- firmado -- necesaria porque abrir la ronda de aprobación no exige revisión completa
    -- por diseño (cualquier DRP puede abrirla en cualquier momento), pero SÍ debe exigir que
    -- alguien haya decidido explícitamente "la revisión terminó". NULL = todavía no se cerró.
    review_closed_at REAL,
    review_closed_by TEXT,
    UNIQUE(project_id, doc_type)
);

-- DEPRECATED (2026-08-31) — reemplazada por rf_section_comments (un solo comentario vigente
-- por sección, se pisaba si dos revisores comentaban la misma sección). Se deja la tabla para
-- no perder historial viejo; init_db() migra sus filas una sola vez a rf_section_comments.
-- No se le vuelve a escribir desde código nuevo.
CREATE TABLE IF NOT EXISTS rf_section_corrections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   TEXT NOT NULL REFERENCES rf_documents(id) ON DELETE CASCADE,
    section_key   TEXT NOT NULL,
    content       TEXT NOT NULL,
    resolved      INTEGER DEFAULT 0,
    updated_by    TEXT,
    updated_at    REAL,
    UNIQUE(document_id, section_key)
);

-- Panel derecho: comentarios de revisión por sección — varios por sección, uno por revisor
-- y por vez, cada uno atribuido a su autor (sección 3). Nunca pisa rf_documents.json_data,
-- y nunca se mezcla con el contenido del documento en ninguna vista previa (2026-08-31,
-- confirmado con el usuario: "Ver PDF" siempre muestra el original).
-- parent_id: NULL = comentario raíz; si no, es una respuesta al comentario raíz cuyo id
-- referencia (siempre a la raíz, nunca a otra respuesta -- hilo plano, no anidado, sección
-- pedida por el usuario 2026-09-01: "ida y vuelta" simple, sin árbol). "resolved" es un
-- concepto de la raíz -- las respuestas no se resuelven independientemente.
CREATE TABLE IF NOT EXISTS rf_section_comments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   TEXT NOT NULL REFERENCES rf_documents(id) ON DELETE CASCADE,
    section_key   TEXT NOT NULL,
    content       TEXT NOT NULL,
    resolved      INTEGER DEFAULT 0,  -- DRP lo marca resuelto cuando ya lo consideró/aplicó
    user_id       TEXT,
    username      TEXT,
    created_at    REAL,
    parent_id     INTEGER REFERENCES rf_section_comments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rf_comments_doc ON rf_section_comments(document_id);
-- Usado por GET /me/pending-comments (sección 2026-09-01) -- se consulta en cada login.
CREATE INDEX IF NOT EXISTS idx_rf_comments_pending ON rf_section_comments(resolved, parent_id);

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

-- Consentimiento de firma electrónica (Libro de Firmas, pedido del usuario 2026-09-20):
-- declaración legal estilo 21 CFR Part 11 §11.100 -- "mi firma electrónica basada en PIN es
-- el equivalente legalmente vinculante de mi firma manuscrita". Política de producto: se
-- acepta una sola vez por persona, de por vida, sin importar cuántos proyectos firme
-- después -- sign_review/sign_approval (signatures.py) bloquean con 409 "consent_required"
-- hasta que exista AL MENOS UNA fila para ese user_id (ver has_accepted_consent en
-- signature_consent.py, que NO filtra por versión -- una actualización editorial del texto
-- no exige re-aceptar ni invalida lo ya aceptado, ver Ronda 19 en docs-privados/).
--
-- Ronda 19, revisión de Codex (2026-09-20): la versión original tenía user_id como PRIMARY
-- KEY con INSERT...ON CONFLICT DO UPDATE -- aceptar una versión nueva PISABA la fila
-- anterior, perdiendo qué texto exacto se aceptó la primera vez. Contradice el mismo
-- principio de "nunca borrar, invalidar" que ya rige rf_review_signatures/
-- rf_approval_signers. Ahora es estrictamente insert-only: PK autoincremental,
-- UNIQUE(user_id, statement_version) evita duplicar la aceptación de la MISMA versión
-- (reintento idempotente), pero una versión nueva crea una fila nueva sin tocar las
-- anteriores -- el historial completo de qué se aceptó y cuándo queda íntegro para siempre.
CREATE TABLE IF NOT EXISTS rf_signature_consent (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                   TEXT NOT NULL,
    statement_version         TEXT NOT NULL,
    statement_text_snapshot   TEXT NOT NULL,
    accepted_at               REAL NOT NULL,
    UNIQUE(user_id, statement_version)
);
CREATE INDEX IF NOT EXISTS idx_rf_signature_consent_user ON rf_signature_consent(user_id);

-- Minería de procesos (2026-09-23, pedido del usuario): SOP versionado y editable desde
-- pantalla, para comparar el proceso REAL (timestamps ya existentes de
-- rf_documents/rf_review_signatures/rf_approval_rounds) contra el ideal, sin ninguna IA
-- de por medio -- solo resta de timestamps contra umbrales. Insert-only, igual criterio
-- que rf_signature_consent: nunca se pisa una versión vieja, cada guardado nuevo es una
-- fila nueva con version = MAX(version)+1 -- así "iterar" el SOP no destruye el
-- historial, y en el futuro se puede recalcular el reporte contra una versión anterior.
-- Ver app/process_mining.py para el cálculo de desvíos.
CREATE TABLE IF NOT EXISTS rf_sop_definitions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    version         INTEGER NOT NULL,
    name            TEXT NOT NULL,
    -- {"stages":[{"key","label","max_hours"}, ...], "max_rework_count": N} -- ver
    -- DEFAULT_SOP_DEFINITION en process_mining.py para la forma exacta y los valores
    -- por defecto (usados si esta tabla todavía está vacía, primer arranque).
    definition_json TEXT NOT NULL,
    created_by      TEXT,
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rf_sop_definitions_version ON rf_sop_definitions(version DESC);

-- 5.1 Firma de Revisión: sin orden, uno por firmante.
CREATE TABLE IF NOT EXISTS rf_review_signatures (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   TEXT NOT NULL REFERENCES rf_documents(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    username      TEXT,
    role_label    TEXT,
    signed_at     REAL,
    -- Ronda 18: fingerprint del contenido que el firmante vio (sha256 de json_data en el
    -- momento en que se preparó la firma) -- sign_review rechaza si no coincide con el
    -- contenido actual al momento de escribir. display_name_at_signing fija el nombre a
    -- mostrar (antes book.py releía rf_users.display_name actual siempre). invalidated_*
    -- se llenan solo si un DRP reabre el documento para editar -- la fila NUNCA se borra,
    -- queda como evidencia de que existió y de por qué se invalidó.
    content_fingerprint      TEXT,
    display_name_at_signing  TEXT,
    -- 2026-09-23: mismo criterio que display_name_at_signing -- lo que efectivamente se
    -- muestra en cursiva en el Libro de Firmas / PDF firmado, congelado al momento de esta
    -- firma puntual. NULL para firmas emitidas antes de que este campo existiera (no se
    -- rellena retroactivamente sin evidencia).
    signature_name_at_signing TEXT,
    invalidated_at    REAL,
    invalidated_reason TEXT,
    -- Ronda 19: referencia a la fila de rf_signature_consent vigente al momento de ESTA
    -- firma puntual -- sin esto, el Libro de Firmas no puede vincular temporalmente una
    -- aceptación a la firma que habilitó (Codex, 2026-09-20: "vincular las firmas nuevas a
    -- la evidencia de consentimiento que habilitó su emisión"). NULL para firmas emitidas
    -- antes de que este campo existiera -- no se rellena retroactivamente sin evidencia.
    consent_id        INTEGER REFERENCES rf_signature_consent(id)
    -- Antes: UNIQUE(document_id, user_id) sobre TODA fila -- una firma invalidada por
    -- reapertura seguía ocupando esa clave, así que el mismo revisor nunca podía volver a
    -- firmar después de reabrir (encontrado en revisión de Codex, 2026-09-19). Reemplazado
    -- por un índice único PARCIAL, creado por _migrate_signing_integrity_gaps (db.py) --
    -- NO acá: en una base vieja sin la columna invalidated_at todavía, un CREATE INDEX
    -- incondicional acá (que corre ANTES de que la migración pueda agregar la columna) rompe
    -- init_db() entero con "no such column: invalidated_at" (encontrado probando la migración
    -- contra una copia de la base de datos real de desarrollo, 2026-09-19). La migración es la
    -- única dueña de este índice, en sus tres casos (Postgres, SQLite nueva, SQLite legada que
    -- necesita reconstruir la tabla).
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
    -- Ronda 18: mismo criterio que rf_review_signatures -- ver esa tabla.
    content_fingerprint      TEXT,
    display_name_at_signing  TEXT,
    signature_name_at_signing TEXT,
    invalidated_at    REAL,
    invalidated_reason TEXT,
    consent_id        INTEGER REFERENCES rf_signature_consent(id),
    UNIQUE(round_id, user_id),
    UNIQUE(round_id, sign_order)
);

CREATE INDEX IF NOT EXISTS idx_rf_review_sig_doc ON rf_review_signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_rf_approval_rounds_doc ON rf_approval_rounds(document_id);
CREATE INDEX IF NOT EXISTS idx_rf_approval_signers_round ON rf_approval_signers(round_id);

-- Fase 5: proyectos (ciclo de vida) + dos audit trails separados.

-- Un proyecto se crea implícitamente al cargar su primer documento (sigue sin existir un
-- "crear proyecto" separado — sección 4), pero ahora necesita estado propio para poder
-- cerrarse/archivarse/eliminarse como unidad.
-- display_name: nombre legible opcional, editable por DRP (sección 2026-09-01 -- el `id`
-- real de un proyecto suele ser un identificador técnico feo, ilegible para el cliente).
-- El `id` NUNCA cambia -- es la clave que usa el bridge con la Suite Documental para
-- encontrar el mismo proyecto en cada push; display_name es puramente cosmético, solo
-- para la UI.
CREATE TABLE IF NOT EXISTS rf_projects (
    id            TEXT PRIMARY KEY,
    display_name  TEXT,
    status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'closed' | 'archived'
    created_by    TEXT,
    created_at    REAL,
    updated_at    REAL,
    closed_at     REAL,
    archived_at   REAL,
    -- Proyectos privados (pedido del usuario, 2026-09-19): solo su dueño (owner_user_id) los
    -- ve -- ni siquiera otro DRP, sea o no superadmin él mismo. is_private=0/owner_user_id
    -- NULL para todo lo existente (proyectos "públicos" de siempre, sin cambio de
    -- comportamiento). Ver deps.py (check_document_access, assert_owner_if_private) para
    -- dónde se hace cumplir esto -- NUNCA basta con ocultarlo de un listado, cada endpoint
    -- que devuelve datos de un proyecto puntual tiene que rechazar explícitamente.
    is_private    INTEGER DEFAULT 0,
    owner_user_id TEXT
);

-- Audit trail de SISTEMA — acciones administrativas/operativas (alta de usuarios, accesos,
-- ciclo de vida de proyectos/documentos). Deliberadamente separado del Libro de Validación
-- (rf_people_book_events, sección 6): ese es el que se integra al libro compilado y solo
-- contiene eventos GxP del documento (cargado, corrección, firma, sellado). Este de acá NO
-- se integra a ningún documento — es de uso interno de DRP para trazabilidad operativa.
CREATE TABLE IF NOT EXISTS rf_system_audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT,
    username      TEXT,
    event_type    TEXT NOT NULL,
    project_id    TEXT,
    doc_type      TEXT,
    description   TEXT,
    created_at    REAL
);

CREATE INDEX IF NOT EXISTS idx_rf_system_log_project ON rf_system_audit_log(project_id);
