/**
 * 05_AUDIT_TRAIL.JS
 * Sistema de trazabilidad y audit trail para cumplimiento GxP
 * - Registro automático de todas las acciones
 * - Integridad garantizada con blockchain-lite (SHA-256)
 * - Exportación protegida (JSON + PDF)
 * - Detección de manipulación
 */

/* ====================================================================
   CONFIGURACIÓN Y CONSTANTES
   ==================================================================== */

const AUDIT_CONFIG = {
    dbVersion: 2,  // v2: auditTrail store
    storeName: 'auditTrail',
    sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    enabled: true  // Flag para habilitar/deshabilitar logging
};

// Tipos de acciones registrables (expandido para GxP)
const AUDIT_ACTIONS = {
    // Sistema
    SYSTEM_INIT: 'SYSTEM_INIT',
    SESSION_LOAD: 'SESSION_LOAD',
    SESSION_SAVE: 'SESSION_SAVE',

    // Protocolos
    CREATE_PROTOCOL: 'CREATE_PROTOCOL',
    UPDATE_PROTOCOL: 'UPDATE_PROTOCOL',
    DELETE_PROTOCOL: 'DELETE_PROTOCOL',
    SELECT_PROTOCOL: 'SELECT_PROTOCOL',
    RENAME_PROTOCOL: 'RENAME_PROTOCOL',

    // Carpetas/Grupos
    CREATE_GROUP: 'CREATE_GROUP',
    UPDATE_GROUP: 'UPDATE_GROUP',
    DELETE_GROUP: 'DELETE_GROUP',
    FINALIZE_GROUP: 'FINALIZE_GROUP',
    RENAME_GROUP: 'RENAME_GROUP',
    MOVE_GROUP: 'MOVE_GROUP',

    // Pruebas
    CREATE_TEST: 'CREATE_TEST',
    UPDATE_TEST: 'UPDATE_TEST',
    DELETE_TEST: 'DELETE_TEST',
    FINALIZE_TEST: 'FINALIZE_TEST',
    REOPEN_TEST: 'REOPEN_TEST',
    MOVE_TEST: 'MOVE_TEST',
    SELECT_TEST: 'SELECT_TEST',
    RENAME_TEST: 'RENAME_TEST',

    // Evidencias
    ADD_EVIDENCE: 'ADD_EVIDENCE',
    UPDATE_EVIDENCE: 'UPDATE_EVIDENCE',
    DELETE_EVIDENCE: 'DELETE_EVIDENCE',
    MOVE_EVIDENCE: 'MOVE_EVIDENCE',
    MOVE_EVIDENCE_UP: 'MOVE_EVIDENCE_UP',
    MOVE_EVIDENCE_DOWN: 'MOVE_EVIDENCE_DOWN',
    DUPLICATE_EVIDENCE: 'DUPLICATE_EVIDENCE',
    REPLACE_EVIDENCE: 'REPLACE_EVIDENCE',
    CREATE_EMPTY_EVIDENCE: 'CREATE_EMPTY_EVIDENCE',
    EDIT_IMAGE: 'EDIT_IMAGE',
    PASTE_IMAGE: 'PASTE_IMAGE',
    UPLOAD_IMAGE: 'UPLOAD_IMAGE',
    UPLOAD_MULTIPLE_IMAGES: 'UPLOAD_MULTIPLE_IMAGES',

    // Tablas
    ADD_TABLE: 'ADD_TABLE',
    UPDATE_TABLE: 'UPDATE_TABLE',
    DELETE_TABLE: 'DELETE_TABLE',
    EDIT_TABLE: 'EDIT_TABLE',
    SAVE_TABLE_CHANGES: 'SAVE_TABLE_CHANGES',

    // Exportación
    EXPORT_PDF: 'EXPORT_PDF',
    EXPORT_EXCEL: 'EXPORT_EXCEL',
    EXPORT_JSON: 'EXPORT_JSON',
    IMPORT_JSON: 'IMPORT_JSON',
    EXPORT_AUDIT_JSON: 'EXPORT_AUDIT_JSON',
    EXPORT_AUDIT_PDF: 'EXPORT_AUDIT_PDF',

    // Proyecto
    FINALIZE_PROJECT: 'FINALIZE_PROJECT',

    // Sistema
    CLEAR_CACHE: 'CLEAR_CACHE',

    // Suite Comparación & Firma (Fase A+)
    SUITE_COMPARE_DOCS:   'SUITE_COMPARE_DOCS',   // matriz cruzada multi-doc
    SUITE_DIFF_VERSIONS:  'SUITE_DIFF_VERSIONS',  // diff entre versiones (Fase B)
    SUITE_SIGN_DOC:       'SUITE_SIGN_DOC',       // firma de doc con archivado (Fase C)
    SUITE_OPEN_DOC:       'SUITE_OPEN_DOC',       // abrir doc desde el editor del suite
    SUITE_EXPORT_MATRIX:  'SUITE_EXPORT_MATRIX',  // exportar matriz cruzada (CSV/PDF)
    BOOK_GENERATE:        'BOOK_GENERATE',        // generar libro de validación
    TOMO_III_EXPORT:      'TOMO_III_EXPORT',      // exportar ZIP raw del Tomo III

    // Multi-proyecto (Suite Proyectos)
    SUITE_PROJECT_CREATE:    'SUITE_PROJECT_CREATE',    // nuevo proyecto creado
    SUITE_PROJECT_OPEN:      'SUITE_PROJECT_OPEN',      // switch a proyecto
    SUITE_PROJECT_DUPLICATE: 'SUITE_PROJECT_DUPLICATE', // duplicado
    SUITE_PROJECT_DELETE:    'SUITE_PROJECT_DELETE',    // borrado
    SUITE_PROJECT_IMPORT:    'SUITE_PROJECT_IMPORT',    // import JSON

    // Autenticacion de usuarios
    USER_LOGIN:            'USER_LOGIN',            // login exitoso
    USER_LOGOUT:           'USER_LOGOUT',           // logout manual
    USER_LOGIN_FAILED:     'USER_LOGIN_FAILED',     // intento fallido
    USER_PASSWORD_CHANGE:  'USER_PASSWORD_CHANGE',  // cambio password
    USER_PASSWORD_RESET:   'USER_PASSWORD_RESET',   // reset via secret question
    USER_RECOVERY_FAILED:  'USER_RECOVERY_FAILED',  // respuesta de recovery incorrecta
    USER_CREATE:           'USER_CREATE',           // admin creo nuevo user
    USER_DELETE:           'USER_DELETE',           // admin elimino user

    // Firmantes del paquete (PeopleManager + firma manuscrita)
    SIGNER_REGISTERED:     'SIGNER_REGISTERED',     // nuevo firmante registrado en el paquete
    SIGNER_UPDATED:        'SIGNER_UPDATED',        // datos del firmante editados
    SIGNER_DELETED:        'SIGNER_DELETED',        // firmante eliminado
    SIGNATURE_CAPTURED:    'SIGNATURE_CAPTURED',    // trazado manuscrito guardado
    SIGN_INSERTED:         'SIGN_INSERTED',         // firma insertada en un doc via PIN
    SIGN_PIN_FAILED:       'SIGN_PIN_FAILED',       // intento de firma con PIN incorrecto

    // Edición de docs del proyecto vía Suite Validación
    DOC_UPDATED_IN_PROJECT: 'DOC_UPDATED_IN_PROJECT',  // entry de packageDocs actualizado

    // Document Workflow GxP (Bloque 2)
    DOC_SUBMITTED_FOR_REVIEW: 'DOC_SUBMITTED_FOR_REVIEW',  // draft → in_review
    DOC_RETURNED_TO_DRAFT:    'DOC_RETURNED_TO_DRAFT',     // in_review → draft (reviewer)
    DOC_APPROVED:             'DOC_APPROVED',              // in_review → approved
    DOC_LOCKED:               'DOC_LOCKED',               // approved → locked
    DOC_REOPENED:             'DOC_REOPENED',             // locked/approved → draft (con justificación)
    DOC_SIGNED:               'DOC_SIGNED',               // firma con certification statement
    DOC_SIGNATURES_INVALIDATED: 'DOC_SIGNATURES_INVALIDATED' // firmas invalidadas por edición post-firma
};

/* ====================================================================
   INDEXEDDB - UPGRADE Y GESTIÓN
   ==================================================================== */

/**
 * Inicializar IndexedDB con soporte para Audit Trail
 * Upgrade de v1 a v2 agregando store 'auditTrail'
 */
function initAuditTrailDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('GestorEvidenciasDB', AUDIT_CONFIG.dbVersion);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Store de imágenes (ya existe en v1)
            if (!db.objectStoreNames.contains('images')) {
                db.createObjectStore('images', { keyPath: 'id' });
            }

            // Store de audit trail (v2)
            if (!db.objectStoreNames.contains(AUDIT_CONFIG.storeName)) {
                const auditStore = db.createObjectStore(AUDIT_CONFIG.storeName, { keyPath: 'id' });
                auditStore.createIndex('timestamp', 'timestamp', { unique: false });
                auditStore.createIndex('action', 'action', { unique: false });
                auditStore.createIndex('entityType', 'entityType', { unique: false });
                auditStore.createIndex('user', 'user', { unique: false });
            }

        };
    });
}

/**
 * Guardar entrada de audit en IndexedDB
 */
async function saveAuditEntry(entry) {
    const db = await initAuditTrailDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AUDIT_CONFIG.storeName], 'readwrite');
        const store = transaction.objectStore(AUDIT_CONFIG.storeName);
        const request = store.add(entry);

        request.onsuccess = () => resolve(entry);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Obtener todas las entradas de audit trail
 */
async function getAllAuditEntries() {
    const db = await initAuditTrailDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AUDIT_CONFIG.storeName], 'readonly');
        const store = transaction.objectStore(AUDIT_CONFIG.storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Obtener última entrada de audit (para hash encadenado)
 */
async function getLastAuditEntry() {
    const entries = await getAllAuditEntries();
    if (entries.length === 0) return null;

    // Ordenar por timestamp (la última es la más reciente)
    return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
}

/**
 * Limpiar audit trail — SOLO en entorno de desarrollo (localhost).
 * En producción lanza error para preservar el append-only GxP.
 */
async function clearAuditTrail() {
    const isLocalhost = typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if (!isLocalhost) {
        throw new Error('[AuditTrail] clearAuditTrail() bloqueado en producción — el audit trail es append-only (GxP).');
    }
    const db = await initAuditTrailDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AUDIT_CONFIG.storeName], 'readwrite');
        const store = transaction.objectStore(AUDIT_CONFIG.storeName);
        const request = store.clear();
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

/* ====================================================================
   SISTEMA DE HASHING (BLOCKCHAIN-LITE)
   ==================================================================== */

/**
 * Generar hash SHA-256 de un objeto
 * @param {Object} data - Datos a hashear
 * @returns {Promise<string>} Hash hexadecimal
 */
async function generateHash(data) {
    const jsonString = JSON.stringify(data);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(jsonString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calcular hash de entrada de audit (incluyendo hash anterior)
 * Implementa cadena de integridad tipo blockchain
 */
async function calculateEntryHash(entry, previousHash) {
    const dataToHash = {
        timestamp: entry.timestamp,
        action: entry.action,
        user: entry.user,
        entityType: entry.entityType,
        entityId: entry.entityId,
        details: entry.details,
        previousHash: previousHash || '0'  // Genesis block
    };

    return await generateHash(dataToHash);
}

/**
 * Verificar integridad de toda la cadena de audit trail
 * @returns {Object} { valid: boolean, tamperedEntries: [], message: string }
 */
async function verifyAuditTrailIntegrity() {
    const entries = await getAllAuditEntries();

    if (entries.length === 0) {
        return { valid: true, tamperedEntries: [], message: 'No hay entradas en el audit trail' };
    }

    // Ordenar por timestamp
    entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const tamperedEntries = [];
    let previousHash = null;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        // Recalcular hash esperado
        const expectedHash = await calculateEntryHash(entry, previousHash);

        // Comparar con hash almacenado
        if (entry.hash !== expectedHash) {
            tamperedEntries.push({
                index: i,
                entryId: entry.id,
                action: entry.action,
                timestamp: entry.timestamp,
                storedHash: entry.hash,
                expectedHash: expectedHash
            });
        }

        // Verificar que previousHash coincida (excepto primera entrada)
        if (i > 0 && entry.previousHash !== entries[i - 1].hash) {
            tamperedEntries.push({
                index: i,
                entryId: entry.id,
                action: entry.action,
                timestamp: entry.timestamp,
                issue: 'previousHash no coincide con entrada anterior'
            });
        }

        previousHash = entry.hash;
    }

    return {
        valid: tamperedEntries.length === 0,
        tamperedEntries: tamperedEntries,
        totalEntries: entries.length,
        message: tamperedEntries.length === 0
            ? `Audit trail íntegro: ${entries.length} entradas verificadas`
            : `⚠️ Manipulación detectada: ${tamperedEntries.length} entradas comprometidas`
    };
}

/* ====================================================================
   FUNCIONES DE LOGGING
   ==================================================================== */

/**
 * Obtener jerarquía completa de una entidad
 * Retorna: { protocolId, protocolName, groupId, groupName, testId, testName, hierarchyPath }
 */
function getEntityHierarchy(entityType, entityId, details = {}) {
    const hierarchy = {};

    try {
        // Para evidencias, usar currentTest o buscar en details
        if (entityType === 'evidence' || entityType === 'table') {
            const test = window.currentTest ||
                        (details.after?.testId && window.tests?.find(t => t.id === details.after.testId)) ||
                        (details.before?.testId && window.tests?.find(t => t.id === details.before.testId)) ||
                        window.tests?.find(t => t.id === window.currentTestId);

            if (test) {
                hierarchy.testId = test.id;
                hierarchy.testName = test.name;

                // Buscar grupo/carpeta del test
                if (test.groupId) {
                    const group = window.groups?.find(g => g.id === test.groupId);
                    if (group) {
                        hierarchy.groupId = group.id;
                        hierarchy.groupName = group.name;

                        // Buscar protocolo del grupo
                        if (group.protocolId) {
                            const protocol = window.protocols?.find(p => p.id === group.protocolId);
                            if (protocol) {
                                hierarchy.protocolId = protocol.id;
                                hierarchy.protocolName = protocol.name;
                            }
                        }
                    }
                }
            }
        }

        // Para tests
        if (entityType === 'test') {
            const test = window.tests?.find(t => t.id === entityId) ||
                        (details.after?.entityId && window.tests?.find(t => t.id === details.after.entityId));

            if (test) {
                hierarchy.testId = test.id;
                hierarchy.testName = test.name;

                if (test.groupId) {
                    const group = window.groups?.find(g => g.id === test.groupId);
                    if (group) {
                        hierarchy.groupId = group.id;
                        hierarchy.groupName = group.name;

                        if (group.protocolId) {
                            const protocol = window.protocols?.find(p => p.id === group.protocolId);
                            if (protocol) {
                                hierarchy.protocolId = protocol.id;
                                hierarchy.protocolName = protocol.name;
                            }
                        }
                    }
                }
            }
        }

        // Para grupos/carpetas
        if (entityType === 'group') {
            const group = window.groups?.find(g => g.id === entityId) ||
                         (details.after?.entityId && window.groups?.find(g => g.id === details.after.entityId));

            if (group) {
                hierarchy.groupId = group.id;
                hierarchy.groupName = group.name;

                if (group.protocolId) {
                    const protocol = window.protocols?.find(p => p.id === group.protocolId);
                    if (protocol) {
                        hierarchy.protocolId = protocol.id;
                        hierarchy.protocolName = protocol.name;
                    }
                }
            }
        }

        // Para protocolos
        if (entityType === 'protocol') {
            const protocol = window.protocols?.find(p => p.id === entityId) ||
                            (details.after?.entityId && window.protocols?.find(p => p.id === details.after.entityId));

            if (protocol) {
                hierarchy.protocolId = protocol.id;
                hierarchy.protocolName = protocol.name;
            }
        }

        // Construir path jerárquico
        const pathParts = [];
        if (hierarchy.protocolName) pathParts.push(hierarchy.protocolName);
        if (hierarchy.groupName) pathParts.push(hierarchy.groupName);
        if (hierarchy.testName) pathParts.push(hierarchy.testName);

        hierarchy.hierarchyPath = pathParts.length > 0 ? pathParts.join(' → ') : '-';

    } catch (error) {
        console.warn('Error obteniendo jerarquía:', error);
    }

    return hierarchy;
}

/**
 * Registrar acción en audit trail
 * @param {string} action - Tipo de acción (usar AUDIT_ACTIONS)
 * @param {string} entityType - Tipo de entidad (test, evidence, group, etc)
 * @param {string} entityId - ID de la entidad
 * @param {Object} details - Detalles de la acción (before, after, etc)
 * @param {string} entityName - Nombre legible de la entidad (opcional)
 */
async function logAction(action, entityType, entityId, details = {}, entityName = '') {
    if (!AUDIT_CONFIG.enabled) return;

    try {
        // Obtener usuario actual (ejecutor global)
        const user = document.getElementById('executor')?.value ||
                     (typeof executor !== 'undefined' ? executor : 'Usuario no identificado');

        // Obtener hash de entrada anterior
        const lastEntry = await getLastAuditEntry();
        const previousHash = lastEntry ? lastEntry.hash : null;

        // Obtener jerarquía completa
        const hierarchy = getEntityHierarchy(entityType, entityId, details);

        // Crear entrada
        const entry = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            action: action,
            user: user,
            entityType: entityType,
            entityId: entityId,
            entityName: entityName,
            details: details,
            sessionId: AUDIT_CONFIG.sessionId,
            previousHash: previousHash,
            // Campos de jerarquía (NUEVO)
            hierarchy: hierarchy,
            hierarchyPath: hierarchy.hierarchyPath
        };

        // Calcular hash de esta entrada
        entry.hash = await calculateEntryHash(entry, previousHash);

        // Guardar en IndexedDB
        await saveAuditEntry(entry);

        return entry;
    } catch (error) {
        console.error('Error logging audit action:', error);
        return null;
    }
}

/**
 * Registrar inicialización del sistema
 */
async function logSystemInit() {
    return await logAction(
        AUDIT_ACTIONS.SYSTEM_INIT,
        'system',
        'system',
        {
            version: '3.0',
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        },
        'Sistema de Gestión de Evidencias'
    );
}

/* ====================================================================
   EXPORTACIÓN DE AUDIT TRAIL
   ==================================================================== */

/**
 * Generar hash global del audit trail completo
 */
async function generateGlobalAuditHash() {
    const entries = await getAllAuditEntries();

    if (entries.length === 0) {
        return await generateHash({ message: 'Empty audit trail' });
    }

    // Ordenar por timestamp
    entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Hash de todos los hashes individuales
    const allHashes = entries.map(e => e.hash).join('');
    return await generateHash({ allHashes: allHashes, count: entries.length });
}

/**
 * Exportar audit trail a JSON protegido
 * @returns {Object} JSON con firma digital
 */
async function exportAuditTrailJSON() {
    const entries = await getAllAuditEntries();

    // Ordenar por timestamp
    entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const globalHash = await generateGlobalAuditHash();
    const integrity = await verifyAuditTrailIntegrity();

    const auditTrailExport = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        projectInfo: {
            empresa: systemInfo?.empresa || 'No especificado',
            nombreSistema: systemInfo?.nombreSistema || 'No especificado',
            codigoSistema: systemInfo?.codigoSistema || 'No especificado'
        },
        sessionId: AUDIT_CONFIG.sessionId,
        summary: {
            totalEntries: entries.length,
            firstEntry: entries.length > 0 ? entries[0].timestamp : null,
            lastEntry: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
            integrityValid: integrity.valid
        },
        entries: entries,
        verification: {
            globalHash: globalHash,
            integrityCheck: integrity,
            verificationTimestamp: new Date().toISOString()
        },
        metadata: {
            generator: (function() {
                if (typeof ConfigStore !== 'undefined') {
                    var _cfg = ConfigStore.load();
                    if (_cfg.organizacion && _cfg.organizacion.nombre) {
                        return _cfg.organizacion.nombre + ' — Validation Suite ' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');
                    }
                }
                return 'Validation Suite ' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'v3.0');
            })(),
            format: 'GxP Audit Trail JSON',
            readonly: true,
            warning: 'Este archivo contiene registros de auditoría protegidos. Cualquier modificación invalidará la firma digital.'
        }
    };

    return auditTrailExport;
}

/**
 * Descargar audit trail como archivo JSON
 */
async function downloadAuditTrailJSON() {
    try {
        const entries = await getAllAuditEntries();

        if (entries.length === 0) {
            alert('⚠️ No hay entradas en el audit trail para exportar.\n\nEl sistema registra automáticamente las acciones a medida que trabajas.\n\nSugerencia: Recarga la página (F5) para registrar la entrada inicial del sistema.');
            return false;
        }

        const auditData = await exportAuditTrailJSON();
        const jsonString = JSON.stringify(auditData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const fileName = `AuditTrail_${systemInfo?.codigoSistema || 'SYSTEM'}_${timestamp}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();

        URL.revokeObjectURL(url);

        // Log de exportación
        await logAction(
            AUDIT_ACTIONS.EXPORT_JSON,
            'auditTrail',
            'export',
            {
                fileName: fileName,
                entriesCount: auditData.entries.length,
                globalHash: auditData.verification.globalHash
            },
            'Exportación de Audit Trail JSON'
        );

        return true;
    } catch (error) {
        console.error('Error exportando audit trail JSON:', error);
        alert('❌ Error al exportar audit trail:\n\n' + error.message + '\n\nRevisa la consola (F12) para más detalles.');
        return false;
    }
}

/**
 * Generar PDF de audit trail (usando pdfMake)
 */
async function exportAuditTrailPDF() {
    try {
        const entries = await getAllAuditEntries();

        if (entries.length === 0) {
            alert('⚠️ No hay entradas en el audit trail para exportar.\n\nEl sistema registra automáticamente las acciones a medida que trabajas.\n\nSugerencia: Recarga la página (F5) para registrar la entrada inicial del sistema.');
            return false;
        }

        // Ordenar por timestamp
        entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const globalHash = await generateGlobalAuditHash();
        const integrity = await verifyAuditTrailIntegrity();

        // Construir tabla de entradas
        const tableRows = [
            [
                { text: 'FECHA/HORA', fillColor: '#213B50', color: '#FFFFFF', bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                { text: 'ACCIÓN', fillColor: '#213B50', color: '#FFFFFF', bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                { text: 'USUARIO', fillColor: '#213B50', color: '#FFFFFF', bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                { text: 'ENTIDAD', fillColor: '#213B50', color: '#FFFFFF', bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                { text: 'DETALLES', fillColor: '#213B50', color: '#FFFFFF', bold: true, fontSize: 8, margin: [4, 4, 4, 4] }
            ]
        ];

        entries.forEach((entry, index) => {
            const fecha = new Date(entry.timestamp).toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            const detalles = entry.entityName || JSON.stringify(entry.details).substring(0, 100);

            tableRows.push([
                { text: fecha, fontSize: 7, margin: [3, 3, 3, 3], fillColor: index % 2 === 0 ? '#EEF3F4' : null },
                { text: entry.action, fontSize: 7, margin: [3, 3, 3, 3], fillColor: index % 2 === 0 ? '#EEF3F4' : null },
                { text: entry.user, fontSize: 7, margin: [3, 3, 3, 3], fillColor: index % 2 === 0 ? '#EEF3F4' : null },
                { text: entry.entityType, fontSize: 7, margin: [3, 3, 3, 3], fillColor: index % 2 === 0 ? '#EEF3F4' : null },
                { text: detalles, fontSize: 6, margin: [3, 3, 3, 3], fillColor: index % 2 === 0 ? '#EEF3F4' : null }
            ]);
        });

        // Definición del documento PDF
        const docDefinition = {
            pageSize: 'A4',
            pageOrientation: 'landscape',
            pageMargins: [30, 60, 30, 60],
            content: [
                {
                    text: 'AUDIT TRAIL - REGISTRO DE AUDITORÍA',
                    fontSize: 18,
                    bold: true,
                    color: '#213B50',
                    margin: [0, 0, 0, 10]
                },
                {
                    text: systemInfo?.nombreSistema || 'Sistema de Gestión de Evidencias',
                    fontSize: 12,
                    color: '#405A75',
                    margin: [0, 0, 0, 20]
                },
                {
                    columns: [
                        {
                            width: '50%',
                            stack: [
                                { text: 'Información del Proyecto', fontSize: 10, bold: true, margin: [0, 0, 0, 8] },
                                { text: `Empresa: ${systemInfo?.empresa || 'No especificado'}`, fontSize: 9 },
                                { text: `Código: ${systemInfo?.codigoSistema || 'No especificado'}`, fontSize: 9 },
                                { text: `Sesión: ${AUDIT_CONFIG.sessionId}`, fontSize: 8, color: '#AFBDC8' }
                            ]
                        },
                        {
                            width: '50%',
                            stack: [
                                { text: 'Estadísticas', fontSize: 10, bold: true, margin: [0, 0, 0, 8] },
                                { text: `Total de entradas: ${entries.length}`, fontSize: 9 },
                                { text: `Primera entrada: ${new Date(entries[0].timestamp).toLocaleString('es-AR')}`, fontSize: 8 },
                                { text: `Última entrada: ${new Date(entries[entries.length - 1].timestamp).toLocaleString('es-AR')}`, fontSize: 8 }
                            ]
                        }
                    ],
                    margin: [0, 0, 0, 20]
                },
                {
                    text: 'Registros de Auditoría',
                    fontSize: 12,
                    bold: true,
                    color: '#213B50',
                    margin: [0, 0, 0, 10]
                },
                {
                    table: {
                        headerRows: 1,
                        widths: [80, 100, 80, 80, '*'],
                        body: tableRows
                    },
                    layout: {
                        hLineWidth: () => 0.5,
                        vLineWidth: () => 0.5,
                        hLineColor: () => '#AFBDC8',
                        vLineColor: () => '#AFBDC8'
                    }
                },
                {
                    text: '\nVerificación de Integridad',
                    fontSize: 12,
                    bold: true,
                    color: '#213B50',
                    margin: [0, 20, 0, 10],
                    pageBreak: 'before'
                },
                {
                    table: {
                        widths: ['*'],
                        body: [
                            [
                                {
                                    stack: [
                                        {
                                            text: integrity.valid ? '✓ INTEGRIDAD VERIFICADA' : '⚠ MANIPULACIÓN DETECTADA',
                                            fontSize: 11,
                                            bold: true,
                                            color: integrity.valid ? '#27AE60' : '#E74C3C',
                                            margin: [0, 0, 0, 8]
                                        },
                                        {
                                            text: `Hash Global SHA-256:`,
                                            fontSize: 8,
                                            bold: true,
                                            margin: [0, 0, 0, 3]
                                        },
                                        {
                                            text: globalHash,
                                            fontSize: 7,
                                            color: '#213B50',
                                            margin: [0, 0, 0, 8]
                                        },
                                        {
                                            text: integrity.message,
                                            fontSize: 9,
                                            italics: true,
                                            color: '#405A75'
                                        },
                                        {
                                            text: `\nFecha de verificación: ${new Date().toLocaleString('es-AR')}`,
                                            fontSize: 8,
                                            color: '#AFBDC8',
                                            margin: [0, 10, 0, 0]
                                        }
                                    ],
                                    fillColor: '#EEF3F4',
                                    margin: [15, 15, 15, 15]
                                }
                            ]
                        ]
                    },
                    layout: {
                        hLineWidth: () => 1,
                        vLineWidth: () => 1,
                        hLineColor: () => '#AFBDC8',
                        vLineColor: () => '#AFBDC8'
                    }
                },
                {
                    text: '\nAdvertencia Legal',
                    fontSize: 10,
                    bold: true,
                    margin: [0, 20, 0, 5]
                },
                {
                    text: 'Este documento contiene registros de auditoría protegidos mediante cadena de hashes SHA-256. Cualquier modificación posterior a su generación será detectable mediante verificación de integridad. El hash global garantiza la inmutabilidad del contenido.',
                    fontSize: 8,
                    italics: true,
                    color: '#405A75',
                    alignment: 'justify'
                }
            ],
            footer: function(currentPage, pageCount) {
                return {
                    columns: [
                        {
                            text: `Audit Trail - GxP Compliant`,
                            fontSize: 8,
                            color: '#AFBDC8',
                            width: '*'
                        },
                        {
                            text: `Página ${currentPage} de ${pageCount}`,
                            fontSize: 8,
                            color: '#AFBDC8',
                            width: 'auto',
                            alignment: 'right'
                        }
                    ],
                    margin: [30, 10, 30, 10]
                };
            },
            defaultStyle: {
                fontSize: 9,
                color: '#2C3E50'
            }
        };

        // Generar y descargar PDF
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const fileName = `AuditTrail_${systemInfo?.codigoSistema || 'SYSTEM'}_${timestamp}.pdf`;

        pdfMake.createPdf(docDefinition).download(fileName);

        // Log de exportación
        await logAction(
            AUDIT_ACTIONS.EXPORT_PDF,
            'auditTrail',
            'export',
            {
                fileName: fileName,
                entriesCount: entries.length,
                globalHash: globalHash,
                integrityValid: integrity.valid
            },
            'Exportación de Audit Trail PDF'
        );

        return true;
    } catch (error) {
        console.error('Error exportando audit trail PDF:', error);
        alert('Error al exportar audit trail PDF: ' + error.message);
        return false;
    }
}

/* ====================================================================
   INTERCEPTORES AUTOMÁTICOS (Para integrar con sistema existente)
   ==================================================================== */

/**
 * Wrapper para logging automático en funciones existentes
 * Uso: const originalFunc = func; func = auditWrapper(originalFunc, 'ACTION_TYPE', 'entityType');
 */
function auditWrapper(originalFunction, action, entityType, getDetails) {
    return async function(...args) {
        const before = getDetails ? getDetails('before', ...args) : {};
        const result = await originalFunction.apply(this, args);
        const after = getDetails ? getDetails('after', result, ...args) : {};

        await logAction(action, entityType, after.id || 'unknown', {
            before: before,
            after: after
        }, after.name || '');

        return result;
    };
}

/* ====================================================================
   AUTO-WRAPPING DE FUNCIONES (MONITOREO AUTOMÁTICO)
   ==================================================================== */

/**
 * Lista de funciones a monitorear automáticamente
 * Formato: { name, action, entity, contextExtractor (opcional) }
 */
const MONITORED_FUNCTIONS = [
    // ========== PRUEBAS ==========
    { name: 'addTest', action: 'CREATE_TEST', entity: 'test', wrapper: 'contextual' },
    { name: 'deleteTest', action: 'DELETE_TEST', entity: 'test', wrapper: 'contextual' },
    { name: 'finalizeTest', action: 'FINALIZE_TEST', entity: 'test', wrapper: 'contextual' },
    { name: 'reopenTest', action: 'REOPEN_TEST', entity: 'test', wrapper: 'contextual' },
    { name: 'selectTest', action: 'SELECT_TEST', entity: 'test', wrapper: 'contextual' },
    { name: 'editTestName', action: 'RENAME_TEST', entity: 'test', wrapper: 'contextual' },
    { name: 'moveTestToGroup', action: 'MOVE_TEST', entity: 'test', wrapper: 'contextual' },

    // ========== GRUPOS/CARPETAS ==========
    { name: 'addGroup', action: 'CREATE_GROUP', entity: 'group', wrapper: 'contextual' },
    { name: 'deleteGroup', action: 'DELETE_GROUP', entity: 'group', wrapper: 'contextual' },
    { name: 'finalizeFolder', action: 'FINALIZE_GROUP', entity: 'group', wrapper: 'contextual' },
    { name: 'editGroupName', action: 'RENAME_GROUP', entity: 'group', wrapper: 'contextual' },
    { name: 'moveFolderToProtocol', action: 'MOVE_GROUP', entity: 'group', wrapper: 'contextual' },

    // ========== PROTOCOLOS ==========
    { name: 'addProtocol', action: 'CREATE_PROTOCOL', entity: 'protocol', wrapper: 'contextual' },
    { name: 'deleteProtocol', action: 'DELETE_PROTOCOL', entity: 'protocol', wrapper: 'contextual' },
    { name: 'editProtocolName', action: 'RENAME_PROTOCOL', entity: 'protocol', wrapper: 'contextual' },
    { name: 'selectProtocol', action: 'SELECT_PROTOCOL', entity: 'protocol', wrapper: 'contextual' },

    // ========== EVIDENCIAS ==========
    { name: 'confirmEvidence', action: 'ADD_EVIDENCE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'deleteEvidence', action: 'DELETE_EVIDENCE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'saveEditedEvidence', action: 'UPDATE_EVIDENCE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'confirmImageEditor', action: 'EDIT_IMAGE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'duplicateEvidence', action: 'DUPLICATE_EVIDENCE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'moveEvidenceUp', action: 'MOVE_EVIDENCE_UP', entity: 'evidence', wrapper: 'contextual' },
    { name: 'moveEvidenceDown', action: 'MOVE_EVIDENCE_DOWN', entity: 'evidence', wrapper: 'contextual' },
    { name: 'replaceEvidenceImage', action: 'REPLACE_EVIDENCE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'moveEvidenceToTest', action: 'MOVE_EVIDENCE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'createEmptyEvidence', action: 'CREATE_EMPTY_EVIDENCE', entity: 'evidence', wrapper: 'contextual' },
    { name: 'handlePaste', action: 'PASTE_IMAGE', entity: 'evidence', wrapper: 'simple' },
    { name: 'handleImageUpload', action: 'UPLOAD_IMAGE', entity: 'evidence', wrapper: 'simple' },
    { name: 'handleMultipleImages', action: 'UPLOAD_MULTIPLE_IMAGES', entity: 'evidence', wrapper: 'simple' },

    // ========== TABLAS ==========
    { name: 'addTable', action: 'ADD_TABLE', entity: 'table', wrapper: 'contextual' },
    { name: 'editTable', action: 'EDIT_TABLE', entity: 'table', wrapper: 'contextual' },
    { name: 'deleteTable', action: 'DELETE_TABLE', entity: 'table', wrapper: 'contextual' },
    { name: 'saveTableChanges', action: 'SAVE_TABLE_CHANGES', entity: 'table', wrapper: 'contextual' },

    // ========== EXPORTACIÓN/IMPORTACIÓN ==========
    { name: 'exportSessionJSON', action: 'EXPORT_JSON', entity: 'session', wrapper: 'simple' },
    { name: 'importSessionJSON', action: 'IMPORT_JSON', entity: 'session', wrapper: 'simple' },
    { name: 'exportTest', action: 'EXPORT_PDF', entity: 'test', wrapper: 'contextual' },
    { name: 'exportFolder', action: 'EXPORT_PDF', entity: 'group', wrapper: 'contextual' },
    { name: 'exportToExcel', action: 'EXPORT_EXCEL', entity: 'project', wrapper: 'simple' },

    // ========== PROYECTO ==========
    { name: 'finalizeProject', action: 'FINALIZE_PROJECT', entity: 'project', wrapper: 'contextual' },

    // ========== SISTEMA ==========
    { name: 'confirmClearCache', action: 'CLEAR_CACHE', entity: 'system', wrapper: 'simple' },
    { name: 'clearCache', action: 'CLEAR_CACHE', entity: 'system', wrapper: 'simple' }
];

/**
 * Wrapper SIMPLE - Solo captura éxito/fallo (para funciones sin contexto complejo)
 */
function wrapSimple(fnName, actionType, entityType) {
    const originalFn = window[fnName];

    if (typeof originalFn !== 'function') {
        console.warn(`⚠️ Función ${fnName} no encontrada`);
        return false;
    }

    window[fnName] = async function(...args) {
        const callId = `${entityType}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        let result, error = null;

        try {
            result = await originalFn.apply(this, args);
        } catch (e) {
            error = e;
        }

        // Log simple
        try {
            await logAction(actionType, entityType, callId, {
                function: fnName,
                argsCount: args.length,
                success: !error,
                error: error ? error.message : null
            }, `${fnName}()`);
        } catch (auditError) {
            console.error(`Error logging ${fnName}:`, auditError);
        }

        if (error) throw error;
        return result;
    };

    return true;
}

/**
 * Wrapper CONTEXTUAL - Captura before/after y contexto real (para funciones críticas)
 */
function wrapContextual(fnName, actionType, entityType) {
    const originalFn = window[fnName];

    if (typeof originalFn !== 'function') {
        console.warn(`⚠️ Función ${fnName} no encontrada`);
        return false;
    }

    window[fnName] = async function(...args) {
        // Capturar contexto ANTES
        const beforeContext = captureBeforeContext(fnName, args);

        // Ejecutar función original
        let result, error = null;
        try {
            result = await originalFn.apply(this, args);
        } catch (e) {
            error = e;
        }

        // Capturar contexto DESPUÉS
        const afterContext = captureAfterContext(fnName, result, args, error);

        // Log contextual
        try {
            await logAction(
                actionType,
                entityType,
                afterContext.entityId || beforeContext.entityId || `${entityType}_${Date.now()}`,
                {
                    function: fnName,
                    before: beforeContext,
                    after: afterContext,
                    success: !error,
                    error: error ? error.message : null
                },
                afterContext.entityName || beforeContext.entityName || fnName
            );
        } catch (auditError) {
            console.error(`Error logging ${fnName}:`, auditError);
        }

        if (error) throw error;
        return result;
    };

    return true;
}

/**
 * Capturar contexto ANTES de ejecutar la función
 */
function captureBeforeContext(fnName, args) {
    const context = { timestamp: new Date().toISOString() };

    try {
        // Para funciones de edición/delete que reciben ID
        if (['deleteTest', 'selectTest', 'editTestName', 'deleteGroup', 'editGroupName',
             'deleteProtocol', 'editProtocolName', 'selectProtocol', 'deleteEvidence',
             'duplicateEvidence', 'moveEvidenceUp', 'moveEvidenceDown', 'replaceEvidenceImage',
             'editTable', 'deleteTable'].includes(fnName)) {
            const entityId = args[0];
            context.entityId = entityId;

            // Buscar nombre de la entidad
            if (fnName.includes('Test')) {
                const test = window.tests?.find(t => t.id === entityId);
                if (test) {
                    context.entityName = test.name;
                    context.finalized = test.finalized;
                    context.groupId = test.groupId;
                }
            } else if (fnName.includes('Group')) {
                const group = window.groups?.find(g => g.id === entityId);
                if (group) {
                    context.entityName = group.name;
                    context.finalized = group.finalized;
                }
            } else if (fnName.includes('Protocol')) {
                const protocol = window.protocols?.find(p => p.id === entityId);
                if (protocol) context.entityName = protocol.name;
            } else if (fnName.includes('Evidence')) {
                const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
                if (test && test.evidences && test.evidences[entityId]) {
                    const ev = test.evidences[entityId];
                    context.entityId = entityId;
                    context.step = ev.step;
                    context.description = ev.description;
                    context.resultado = ev.resultado;
                    context.testId = test.id;
                    context.testName = test.name;
                    context.position = entityId; // Índice en el array
                    context.totalEvidences = test.evidences.length;
                    context.hasImage = !!ev.image;
                    context.isTable = !!ev.tableHTML;

                    // Agregar info del grupo
                    if (test.groupId) {
                        const group = window.groups?.find(g => g.id === test.groupId);
                        if (group) {
                            context.groupId = group.id;
                            context.groupName = group.name;
                        }
                    }
                }
            } else if (fnName.includes('Table')) {
                const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
                if (test && test.evidences && test.evidences[entityId]) {
                    const ev = test.evidences[entityId];
                    context.tableIndex = entityId;
                    context.step = ev.step;
                    context.testId = test.id;
                    context.testName = test.name;
                    context.position = entityId;
                    context.totalEvidences = test.evidences.length;
                    context.hasTableHTML = !!ev.tableHTML;

                    // Intentar extraer info de la tabla
                    if (ev.tableHTML) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = ev.tableHTML;
                        const rows = tempDiv.querySelectorAll('tr');
                        context.tableRows = rows.length;
                        if (rows.length > 0) {
                            context.tableCols = rows[0].querySelectorAll('th, td').length;
                        }
                    }
                }
            }
        }

        // Para funciones de movimiento que reciben origen y destino
        if (fnName === 'moveTestToGroup') {
            const testId = args[0];
            const newGroupId = args[1];
            const test = window.tests?.find(t => t.id === testId);
            if (test) {
                context.entityId = testId;
                context.entityName = test.name;
                context.oldGroupId = test.groupId;
                context.newGroupId = newGroupId;
                const oldGroup = window.groups?.find(g => g.id === test.groupId);
                const newGroup = window.groups?.find(g => g.id === newGroupId);
                context.oldGroupName = oldGroup?.name || 'Sin carpeta';
                context.newGroupName = newGroup?.name || 'Sin carpeta';
            }
        }

        if (fnName === 'moveFolderToProtocol') {
            const groupId = args[0];
            const group = window.groups?.find(g => g.id === groupId);
            if (group) {
                context.entityId = groupId;
                context.entityName = group.name;
                context.oldProtocolId = group.protocolId;
            }
        }

        // Para funciones de renombrado
        if (fnName === 'editTestName' || fnName === 'editGroupName' || fnName === 'editProtocolName') {
            const entityId = args[0];
            context.entityId = entityId;

            if (fnName === 'editTestName') {
                const test = window.tests?.find(t => t.id === entityId);
                if (test) context.oldName = test.name;
            } else if (fnName === 'editGroupName') {
                const group = window.groups?.find(g => g.id === entityId);
                if (group) context.oldName = group.name;
            } else if (fnName === 'editProtocolName') {
                const protocol = window.protocols?.find(p => p.id === entityId);
                if (protocol) context.oldName = protocol.name;
            }
        }

    } catch (error) {
        console.warn(`Error capturando contexto before en ${fnName}:`, error);
    }

    return context;
}

/**
 * Capturar contexto DESPUÉS de ejecutar la función
 */
function captureAfterContext(fnName, result, args, error) {
    const context = { timestamp: new Date().toISOString() };

    if (error) {
        context.error = error.message;
        return context;
    }

    try {
        // Para funciones de creación que devuelven la entidad creada
        if (['addTest', 'addGroup', 'addProtocol'].includes(fnName)) {
            if (result) {
                context.entityId = result.id;
                context.entityName = result.name;
                if (fnName === 'addTest' && result.groupId) {
                    context.groupId = result.groupId;
                    const group = window.groups?.find(g => g.id === result.groupId);
                    if (group) context.groupName = group.name;
                }
            }
        }

        // Para addTest (capturar nombre y grupo)
        if (fnName === 'addTest') {
            const testName = args[0];
            const groupId = args[1];
            context.testName = testName;
            context.groupId = groupId;
            if (groupId) {
                const group = window.groups?.find(g => g.id === groupId);
                if (group) context.groupName = group.name;
            }
        }

        // Para addGroup (capturar nombre)
        if (fnName === 'addGroup') {
            const groupName = args[0];
            context.groupName = groupName;
        }

        // Para addProtocol (capturar nombre)
        if (fnName === 'addProtocol') {
            const protocolName = args[0] || document.getElementById('protocolName')?.value;
            context.protocolName = protocolName;
        }

        // Para evidencias
        if (fnName === 'confirmEvidence') {
            const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
            if (test) {
                context.testId = test.id;
                context.testName = test.name;
                context.totalEvidences = test.evidences?.length || 0;

                // Capturar info de la evidencia recién agregada
                const lastEvidence = test.evidences?.[test.evidences.length - 1];
                if (lastEvidence) {
                    context.step = lastEvidence.step;
                    context.description = lastEvidence.description || '';
                    context.resultado = lastEvidence.resultado || '';
                    context.hasImage = !!lastEvidence.image;
                    context.isTable = !!lastEvidence.tableHTML;
                    context.position = test.evidences.length - 1;
                }

                // Info del grupo
                if (test.groupId) {
                    const group = window.groups?.find(g => g.id === test.groupId);
                    if (group) {
                        context.groupId = group.id;
                        context.groupName = group.name;
                    }
                }
            }
        }

        // Para mover evidencias arriba/abajo
        if (fnName === 'moveEvidenceUp' || fnName === 'moveEvidenceDown') {
            const index = args[0];
            const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
            if (test && test.evidences && test.evidences[index]) {
                const ev = test.evidences[index];
                context.oldPosition = index;
                context.newPosition = fnName === 'moveEvidenceUp' ? index - 1 : index + 1;
                context.step = ev.step;
                context.description = ev.description;
                context.testId = test.id;
                context.testName = test.name;
                context.direction = fnName === 'moveEvidenceUp' ? 'up' : 'down';
            }
        }

        // Para duplicar evidencia
        if (fnName === 'duplicateEvidence') {
            const index = args[0];
            const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
            if (test && test.evidences) {
                context.sourcePosition = index;
                context.newPosition = test.evidences.length - 1; // La duplicada va al final
                context.totalEvidences = test.evidences.length;
                context.testId = test.id;
                context.testName = test.name;

                if (test.evidences[index]) {
                    context.sourceStep = test.evidences[index].step;
                    context.sourceDescription = test.evidences[index].description;
                }
            }
        }

        // Para reemplazar imagen de evidencia
        if (fnName === 'replaceEvidenceImage') {
            const index = args[0];
            const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
            if (test && test.evidences && test.evidences[index]) {
                const ev = test.evidences[index];
                context.position = index;
                context.step = ev.step;
                context.description = ev.description;
                context.testId = test.id;
                context.testName = test.name;
                context.imageReplaced = true;
            }
        }

        // Para editar evidencia
        if (fnName === 'saveEditedEvidence') {
            const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
            const editingIndex = window.editingEvidenceIndex;

            if (test && test.evidences && typeof editingIndex !== 'undefined' && test.evidences[editingIndex]) {
                const ev = test.evidences[editingIndex];
                context.position = editingIndex;
                context.step = ev.step;
                context.newDescription = ev.description;
                context.newResultado = ev.resultado;
                context.testId = test.id;
                context.testName = test.name;
            }
        }

        // Para agregar/editar tabla
        if (fnName === 'addTable') {
            const test = window.currentTest || window.tests?.find(t => t.id === window.currentTestId);
            if (test) {
                context.testId = test.id;
                context.testName = test.name;
                context.totalEvidences = test.evidences?.length || 0;
                context.position = test.evidences ? test.evidences.length - 1 : 0;

                // Intentar capturar dimensiones de la tabla agregada
                if (test.evidences && test.evidences.length > 0) {
                    const lastEvidence = test.evidences[test.evidences.length - 1];
                    if (lastEvidence.tableHTML) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = lastEvidence.tableHTML;
                        const rows = tempDiv.querySelectorAll('tr');
                        context.tableRows = rows.length;
                        if (rows.length > 0) {
                            context.tableCols = rows[0].querySelectorAll('th, td').length;
                        }
                        context.step = lastEvidence.step;
                    }
                }
            }
        }

        // Para export functions
        if (['exportTest', 'exportFolder'].includes(fnName)) {
            const entityId = args[0];
            if (fnName === 'exportTest') {
                const test = window.tests?.find(t => t.id === entityId);
                if (test) {
                    context.entityId = entityId;
                    context.entityName = test.name;
                }
            } else if (fnName === 'exportFolder') {
                const group = window.groups?.find(g => g.id === entityId);
                if (group) {
                    context.entityId = entityId;
                    context.entityName = group.name;
                }
            }
        }

        // Para renombrado (capturar nuevo nombre)
        if (fnName === 'editTestName' || fnName === 'editGroupName' || fnName === 'editProtocolName') {
            const entityId = args[0];
            context.entityId = entityId;

            // El nuevo nombre se obtiene después de la ejecución
            if (fnName === 'editTestName') {
                const test = window.tests?.find(t => t.id === entityId);
                if (test) context.newName = test.name;
            } else if (fnName === 'editGroupName') {
                const group = window.groups?.find(g => g.id === entityId);
                if (group) context.newName = group.name;
            } else if (fnName === 'editProtocolName') {
                const protocol = window.protocols?.find(p => p.id === entityId);
                if (protocol) context.newName = protocol.name;
            }
        }

    } catch (error) {
        console.warn(`Error capturando contexto after en ${fnName}:`, error);
    }

    return context;
}

/**
 * Aplicar wrapping a todas las funciones monitoreadas
 */
function initAutoWrapping() {
    console.log('🔧 Iniciando auto-wrapping de funciones...');

    let wrappedCount = 0;
    let skippedCount = 0;

    MONITORED_FUNCTIONS.forEach(({ name, action, entity, wrapper }) => {
        try {
            let success = false;

            if (wrapper === 'contextual') {
                success = wrapContextual(name, action, entity);
            } else {
                success = wrapSimple(name, action, entity);
            }

            if (success) {
                wrappedCount++;
                console.log(`  ✓ ${name} → ${action} (${wrapper})`);
            } else {
                skippedCount++;
            }
        } catch (error) {
            console.error(`  ✗ Error wrapping ${name}:`, error);
            skippedCount++;
        }
    });

    console.log(`✅ Auto-wrapping completado: ${wrappedCount}/${MONITORED_FUNCTIONS.length} funciones monitoreadas (${skippedCount} omitidas)`);
}

/* ====================================================================
   VISUALIZADOR DE AUDIT TRAIL
   ==================================================================== */

/**
 * Mostrar modal con tabla de audit trail (filtrable y exportable)
 */
async function showAuditTrailViewer() {
    try {
        const entries = await getAllAuditEntries();

        if (entries.length === 0) {
            alert('No hay entradas en el audit trail para visualizar.\n\nEl sistema registra automáticamente las acciones a medida que trabajas.');
            return;
        }

        // Ordenar por timestamp (más reciente primero)
        entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Crear modal
        const modal = document.createElement('div');
        modal.id = 'auditTrailViewerModal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            padding: 20px;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            border-radius: 8px;
            width: 95%;
            max-width: 1400px;
            height: 90vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px 30px;
            background: #213B50;
            color: white;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = `
            <div>
                <h2 style="margin: 0; font-size: 22px;">Audit Trail - Historial de Acciones</h2>
                <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">${entries.length} entradas registradas</p>
            </div>
            <button id="closeAuditViewer" style="background: transparent; border: 2px solid white; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;">
                Cerrar [ESC]
            </button>
        `;

        // Filtros
        const filters = document.createElement('div');
        filters.style.cssText = `
            padding: 15px 30px;
            background: #f5f5f5;
            border-bottom: 1px solid #ddd;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        `;
        filters.innerHTML = `
            <input type="text" id="filterSearch" placeholder="Buscar por acción, usuario, entidad..." style="flex: 1; min-width: 250px; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;">

            <select id="filterAction" style="padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; min-width: 180px;">
                <option value="">Todas las acciones</option>
                ${[...new Set(entries.map(e => e.action))].sort().map(action =>
                    `<option value="${action}">${action.replace(/_/g, ' ')}</option>`
                ).join('')}
            </select>

            <select id="filterEntity" style="padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; min-width: 150px;">
                <option value="">Todas las entidades</option>
                ${[...new Set(entries.map(e => e.entityType))].sort().map(entity =>
                    `<option value="${entity}">${entity.charAt(0).toUpperCase() + entity.slice(1)}</option>`
                ).join('')}
            </select>

            <button id="clearFilters" style="padding: 8px 16px; background: #405A75; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600;">
                Limpiar Filtros
            </button>

            <span id="filterCount" style="margin-left: auto; color: #666; font-size: 13px; font-weight: 600;">
                ${entries.length} resultados
            </span>
        `;

        // Tabla container (scrollable)
        const tableContainer = document.createElement('div');
        tableContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 0;
        `;

        const table = document.createElement('table');
        table.id = 'auditTrailTable';
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        `;
        table.innerHTML = `
            <thead style="position: sticky; top: 0; background: #405A75; color: white; z-index: 10;">
                <tr>
                    <th style="padding: 12px 15px; text-align: left; font-weight: 600; border-bottom: 2px solid #213B50; width: 130px;">Timestamp</th>
                    <th style="padding: 12px 15px; text-align: left; font-weight: 600; border-bottom: 2px solid #213B50; width: 160px;">Acción</th>
                    <th style="padding: 12px 15px; text-align: left; font-weight: 600; border-bottom: 2px solid #213B50; width: 110px;">Usuario</th>
                    <th style="padding: 12px 15px; text-align: left; font-weight: 600; border-bottom: 2px solid #213B50; width: 90px;">Tipo</th>
                    <th style="padding: 12px 15px; text-align: left; font-weight: 600; border-bottom: 2px solid #213B50; width: 280px;">Contexto / Jerarquía</th>
                    <th style="padding: 12px 15px; text-align: left; font-weight: 600; border-bottom: 2px solid #213B50;">Detalles</th>
                    <th style="padding: 12px 15px; text-align: center; font-weight: 600; border-bottom: 2px solid #213B50; width: 60px;">✓</th>
                </tr>
            </thead>
            <tbody id="auditTableBody">
                ${entries.map((entry, index) => generateAuditRowHTML(entry, index)).join('')}
            </tbody>
        `;

        tableContainer.appendChild(table);

        // Footer con estadísticas
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 15px 30px;
            background: #f5f5f5;
            border-top: 1px solid #ddd;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-radius: 0 0 8px 8px;
        `;

        const stats = generateAuditStats(entries);
        footer.innerHTML = `
            <div style="font-size: 12px; color: #666;">
                <strong>Estadísticas:</strong>
                ${stats.creates} creaciones | ${stats.updates} modificaciones | ${stats.deletes} eliminaciones | ${stats.exports} exportaciones
            </div>
            <div style="display: flex; gap: 10px;">
                <button id="exportFilteredJSON" style="padding: 8px 16px; background: #C2E03B; color: #213B50; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                    Exportar Resultados (JSON)
                </button>
                <button id="verifyIntegrityViewer" style="padding: 8px 16px; background: #405A75; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                    Verificar Integridad
                </button>
            </div>
        `;

        // Ensamblar modal
        content.appendChild(header);
        content.appendChild(filters);
        content.appendChild(tableContainer);
        content.appendChild(footer);
        modal.appendChild(content);
        document.body.appendChild(modal);

        // Event listeners
        setupAuditViewerListeners(entries);

        // Listeners para click en filas (ver detalles)
        setTimeout(() => {
            const rows = document.querySelectorAll('#auditTrailTable tbody tr');
            rows.forEach((row) => {
                row.addEventListener('click', () => {
                    const entry = entries.find(e => e.id === row.dataset.entryId);
                    if (entry) {
                        showEntryDetailsModal(entry);
                    }
                });
            });
        }, 100);

    } catch (error) {
        console.error('Error mostrando audit trail viewer:', error);
        alert('Error al mostrar el visualizador de audit trail:\n\n' + error.message);
    }
}

/**
 * Generar HTML legible de los detalles (sin JSON técnico)
 */
function generateReadableDetails(entry) {
    const after = entry.details?.after || {};
    const before = entry.details?.before || {};
    const details = entry.details || {};

    let html = '<table style="width: 100%; font-size: 12px; border-collapse: collapse;">';
    let rowIndex = 0;

    // Helper para agregar fila
    const addRow = (label, value, highlight = false) => {
        if (value === undefined || value === null || value === '') return;

        const bgColor = rowIndex % 2 === 0 ? '#f5f5f5' : 'white';
        const valueColor = highlight ? 'color: #4CAF50; font-weight: 600;' : '';
        html += `
            <tr style="background: ${bgColor};">
                <td style="padding: 8px; font-weight: 600; width: 180px;">${label}:</td>
                <td style="padding: 8px; ${valueColor}">${value}</td>
            </tr>
        `;
        rowIndex++;
    };

    // ========== DETALLES ESPECÍFICOS POR TIPO DE ACCIÓN ==========

    // Para evidencias
    if (entry.entityType === 'evidence') {
        if (after.step) addRow('Paso', after.step);
        if (after.position !== undefined) addRow('Posición', `${after.position + 1} de ${after.totalEvidences || '?'}`);
        if (after.description) addRow('Descripción', after.description);
        if (before.description && before.description !== after.description) {
            addRow('Descripción anterior', before.description);
        }
        if (after.resultado) addRow('Resultado', after.resultado, true);
        if (after.hasImage !== undefined) addRow('Tiene imagen', after.hasImage ? 'Sí 🖼️' : 'No');
        if (after.isTable !== undefined) addRow('Es tabla', after.isTable ? 'Sí 📊' : 'No');

        // Para movimientos
        if (after.direction) {
            addRow('Dirección', after.direction === 'up' ? 'Arriba ↑' : 'Abajo ↓');
            addRow('Posición anterior', after.oldPosition + 1);
            addRow('Posición nueva', after.newPosition + 1);
        }

        // Para duplicados
        if (after.sourcePosition !== undefined) {
            addRow('Posición origen', after.sourcePosition + 1);
            addRow('Posición nueva', after.newPosition + 1);
            if (after.sourceStep) addRow('Paso duplicado', after.sourceStep);
        }
    }

    // Para tablas
    if (entry.entityType === 'table') {
        if (after.step) addRow('Paso', after.step);
        if (after.position !== undefined) addRow('Posición', `${after.position + 1} de ${after.totalEvidences || '?'}`);
        if (after.tableRows && after.tableCols) {
            addRow('Dimensiones', `${after.tableRows} filas × ${after.tableCols} columnas`);
        }
    }

    // Para renombrados
    if (after.oldName && after.newName) {
        addRow('Nombre anterior', after.oldName);
        addRow('Nombre nuevo', after.newName, true);
    }

    // Para movimientos de tests
    if (after.oldGroupName && after.newGroupName) {
        addRow('Carpeta anterior', after.oldGroupName);
        addRow('Carpeta nueva', after.newGroupName, true);
    }

    // Para tests
    if (entry.entityType === 'test') {
        if (after.testName) addRow('Nombre del test', after.testName);
        if (after.groupName) addRow('Carpeta', after.groupName);
        if (after.finalized !== undefined) addRow('Finalizado', after.finalized ? 'Sí' : 'No');
    }

    // Para grupos
    if (entry.entityType === 'group') {
        if (after.groupName) addRow('Nombre de carpeta', after.groupName);
        if (after.finalized !== undefined) addRow('Finalizado', after.finalized ? 'Sí' : 'No');
    }

    // Para protocolos
    if (entry.entityType === 'protocol') {
        if (after.protocolName) addRow('Nombre del protocolo', after.protocolName);
    }

    // Para SYSTEM_INIT
    if (entry.action === 'SYSTEM_INIT') {
        if (after.validationTeam) {
            addRow('Ejecutor', after.validationTeam.executor);
            if (after.validationTeam.reviewer && after.validationTeam.reviewer !== 'No asignado') {
                addRow('Revisor', after.validationTeam.reviewer);
            }
            addRow('Rol', after.validationTeam.role);
            if (after.validationTeam.sessionStart) {
                const startDate = new Date(after.validationTeam.sessionStart);
                addRow('Inicio de sesión', startDate.toLocaleString('es-AR'));
            }
        }
        if (after.version) addRow('Versión del sistema', after.version);
        if (after.userAgent) addRow('Navegador', after.userAgent);
    }

    // Estado de la operación
    if (details.success !== undefined) {
        addRow('Estado', details.success ? '✓ Exitoso' : '✗ Falló', details.success);
    }

    // Función ejecutada
    if (details.function) {
        addRow('Función ejecutada', `${details.function}()`);
    }

    // Error si existe
    if (details.error) {
        html += `
            <tr style="background: #FFEBEE;">
                <td colspan="2" style="padding: 12px; color: #F44336; font-weight: 600;">
                    ⚠️ Error: ${details.error}
                </td>
            </tr>
        `;
    }

    html += '</table>';

    // Si no se agregó ninguna fila, mostrar mensaje
    if (rowIndex === 0 && !details.error) {
        html = '<div style="padding: 15px; text-align: center; color: #999; background: #f5f5f5; border-radius: 4px;">No hay detalles adicionales para mostrar</div>';
    }

    return html;
}

/**
 * Mostrar modal con detalles completos de una entrada (VERSIÓN LEGIBLE)
 */
function showEntryDetailsModal(entry) {
    const modal = document.createElement('div');
    modal.id = 'entryDetailsModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 11000;
        padding: 20px;
    `;

    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const readableDetailsHTML = generateReadableDetails(entry);

    modal.innerHTML = `
        <div style="background: white; border-radius: 8px; max-width: 800px; width: 90%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
            <div style="padding: 20px; background: #213B50; color: white; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px;">${entry.action.replace(/_/g, ' ')}</h3>
                    <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.9;">${timeStr}</p>
                </div>
                <button id="closeEntryDetails" style="background: transparent; border: 2px solid white; color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                    Cerrar [ESC]
                </button>
            </div>

            <div style="flex: 1; overflow-y: auto; padding: 20px;">
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px 0; color: #213B50; font-size: 14px; border-bottom: 2px solid #C2E03B; padding-bottom: 5px;">Información General</h4>
                    <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; font-weight: 600; width: 150px;">Usuario:</td>
                            <td style="padding: 8px;">${entry.user}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; font-weight: 600;">Tipo de entidad:</td>
                            <td style="padding: 8px;">${entry.entityType}</td>
                        </tr>
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; font-weight: 600;">ID de entidad:</td>
                            <td style="padding: 8px; font-family: monospace; font-size: 11px;">${entry.entityId}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; font-weight: 600;">Nombre:</td>
                            <td style="padding: 8px;">${entry.entityName || '-'}</td>
                        </tr>
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; font-weight: 600;">Session ID:</td>
                            <td style="padding: 8px; font-family: monospace; font-size: 11px;">${entry.sessionId}</td>
                        </tr>
                        ${entry.hierarchyPath ? `
                        <tr>
                            <td style="padding: 8px; font-weight: 600;">Jerarquía:</td>
                            <td style="padding: 8px; color: #1976d2;">${entry.hierarchyPath}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>

                ${entry.hierarchy && (entry.hierarchy.protocolId || entry.hierarchy.groupId || entry.hierarchy.testId) ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px 0; color: #213B50; font-size: 14px; border-bottom: 2px solid #C2E03B; padding-bottom: 5px;">Contexto Jerárquico</h4>
                    <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                        ${entry.hierarchy.protocolId ? `
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; font-weight: 600; width: 150px;">Protocolo:</td>
                            <td style="padding: 8px;">${entry.hierarchy.protocolName || '-'}</td>
                        </tr>
                        ` : ''}
                        ${entry.hierarchy.groupId ? `
                        <tr>
                            <td style="padding: 8px; font-weight: 600;">Carpeta:</td>
                            <td style="padding: 8px;">${entry.hierarchy.groupName || '-'}</td>
                        </tr>
                        ` : ''}
                        ${entry.hierarchy.testId ? `
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; font-weight: 600;">Prueba:</td>
                            <td style="padding: 8px;">${entry.hierarchy.testName || '-'}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>
                ` : ''}

                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px 0; color: #213B50; font-size: 14px; border-bottom: 2px solid #C2E03B; padding-bottom: 5px;">Detalles de la Acción</h4>
                    ${readableDetailsHTML}
                </div>

                <div>
                    <h4 style="margin: 0 0 10px 0; color: #213B50; font-size: 14px; border-bottom: 2px solid #C2E03B; padding-bottom: 5px;">Hash de Integridad</h4>
                    <div style="background: #e3f2fd; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 10px; word-break: break-all; color: #1976d2;">
                        ${entry.hash}
                    </div>
                    ${entry.previousHash ? `
                    <div style="margin-top: 8px; font-size: 11px; color: #666;">
                        Hash anterior: <code style="font-size: 10px; background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">${entry.previousHash.substring(0, 16)}...</code>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Cerrar modal
    document.getElementById('closeEntryDetails').addEventListener('click', () => {
        modal.remove();
    });

    // ESC para cerrar
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Click fuera del contenido para cerrar
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

/**
 * Generar HTML de fila de audit trail
 */
function generateAuditRowHTML(entry, index) {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const success = entry.details?.success !== false;
    const statusIcon = success ? '✓' : '✗';
    const statusColor = success ? '#4CAF50' : '#F44336';

    // ========== GENERAR CONTEXTO/JERARQUÍA ==========
    let contextHTML = '';

    // Mostrar jerarquía si existe
    if (entry.hierarchyPath && entry.hierarchyPath !== '-') {
        contextHTML += `<div style="font-size: 10px; color: #666; margin-bottom: 3px;">
            📂 ${entry.hierarchyPath}
        </div>`;
    }

    // Info específica por tipo de entidad
    const after = entry.details?.after;
    const before = entry.details?.before;

    if (entry.entityType === 'evidence' || entry.entityType === 'table') {
        if (after?.step) {
            contextHTML += `<div style="font-size: 11px; color: #1976d2; font-weight: 600;">Paso ${after.step}</div>`;
        }
        if (after?.position !== undefined) {
            contextHTML += `<div style="font-size: 10px; color: #999;">Posición: ${after.position + 1} de ${after.totalEvidences || '?'}</div>`;
        }
    }

    if (!contextHTML) {
        contextHTML = '<div style="font-size: 10px; color: #999;">-</div>';
    }

    // ========== GENERAR DETALLES ==========
    let detailsSummary = '';

    // Para renombrados
    if (after?.oldName && after?.newName) {
        detailsSummary = `<strong>${after.oldName}</strong> → <strong style="color: #4CAF50;">${after.newName}</strong>`;
    }
    // Para movimientos de tests
    else if (after?.oldGroupName && after?.newGroupName) {
        detailsSummary = `<strong>${entry.entityName || 'Test'}</strong><br>`;
        detailsSummary += `<span style="font-size: 10px; color: #666;">${after.oldGroupName} → ${after.newGroupName}</span>`;
    }
    // Para evidencias
    else if (entry.entityType === 'evidence') {
        if (after?.description) {
            detailsSummary = `<strong>${after.description.substring(0, 60)}${after.description.length > 60 ? '...' : ''}</strong>`;
        }
        if (after?.resultado) {
            detailsSummary += `<br><span style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${after.resultado === 'OK' ? '#C8E6C9' : '#FFCDD2'}; color: #333;">${after.resultado}</span>`;
        }
        if (after?.hasImage) {
            detailsSummary += ` <span style="font-size: 10px; color: #666;">🖼️</span>`;
        }
        if (after?.isTable) {
            detailsSummary += ` <span style="font-size: 10px; color: #666;">📊</span>`;
        }

        // Para movimientos de evidencias
        if (after?.direction) {
            detailsSummary += `<br><span style="font-size: 10px; color: #666;">Movido ${after.direction === 'up' ? '↑' : '↓'} (pos ${after.oldPosition} → ${after.newPosition})</span>`;
        }
    }
    // Para tablas
    else if (entry.entityType === 'table') {
        if (after?.tableRows && after?.tableCols) {
            detailsSummary = `<strong>Tabla ${after.tableRows}×${after.tableCols}</strong>`;
        }
        if (after?.step) {
            detailsSummary += `<br><span style="font-size: 10px; color: #666;">Paso ${after.step}</span>`;
        }
    }
    // Para creaciones
    else if (entry.action.includes('CREATE')) {
        detailsSummary = `<strong style="color: #4CAF50;">${after?.entityName || entry.entityName || 'Nueva entidad'}</strong>`;
        if (after?.groupName) {
            detailsSummary += `<br><span style="font-size: 10px; color: #666;">En: ${after.groupName}</span>`;
        }
    }
    // Para eliminaciones
    else if (entry.action.includes('DELETE')) {
        detailsSummary = `<strong style="color: #F44336;">${before?.entityName || entry.entityName || 'Entidad eliminada'}</strong>`;
    }
    // Para finalizaciones
    else if (entry.action.includes('FINALIZE')) {
        detailsSummary = `<strong style="color: #FF9800;">${entry.entityName || 'Finalizado'}</strong>`;
    }
    // Para exportaciones
    else if (entry.action.includes('EXPORT')) {
        detailsSummary = `<strong>${after?.entityName || entry.entityName || 'Exportación'}</strong>`;
        if (entry.action === 'EXPORT_PDF') {
            detailsSummary += ` <span style="font-size: 10px; color: #666;">📄</span>`;
        } else if (entry.action === 'EXPORT_JSON' || entry.action === 'EXPORT_AUDIT_JSON') {
            detailsSummary += ` <span style="font-size: 10px; color: #666;">📋</span>`;
        } else if (entry.action === 'EXPORT_EXCEL') {
            detailsSummary += ` <span style="font-size: 10px; color: #666;">📊</span>`;
        }
    }
    // Para importaciones
    else if (entry.action.includes('IMPORT')) {
        detailsSummary = `<strong style="color: #2196F3;">Sesión importada</strong>`;
    }
    // Para acciones de sistema
    else if (entry.action === 'SYSTEM_INIT') {
        detailsSummary = `<strong style="color: #4CAF50;">Sistema iniciado</strong>`;
        if (after?.validationTeam?.executor) {
            detailsSummary += `<br><span style="font-size: 10px; color: #666;">Por: ${after.validationTeam.executor}</span>`;
        }
    }
    else if (entry.action === 'CLEAR_CACHE') {
        detailsSummary = `<strong style="color: #FF9800;">Cache limpiado</strong>`;
    }
    // Para selecciones
    else if (entry.action.includes('SELECT')) {
        detailsSummary = `<strong>${after?.entityName || before?.entityName || entry.entityName || 'Elemento seleccionado'}</strong>`;
    }
    // Para reaperturas
    else if (entry.action === 'REOPEN_TEST') {
        detailsSummary = `<strong style="color: #2196F3;">${entry.entityName || 'Test reabierto'}</strong>`;
    }
    // Fallback mejorado - SIEMPRE mostrar algo
    else {
        // Intentar obtener nombre de after o before
        const name = after?.entityName || after?.testName || after?.groupName ||
                     before?.entityName || before?.testName || before?.groupName ||
                     entry.entityName || entry.entityId;

        if (name) {
            detailsSummary = `<strong>${name}</strong>`;
        } else {
            // Último recurso: mostrar el tipo de acción
            detailsSummary = `<strong style="color: #666;">${entry.action.replace(/_/g, ' ')}</strong>`;
        }

        // Agregar función si está disponible
        if (entry.details?.function && entry.details.function !== name) {
            detailsSummary += `<br><span style="font-size: 10px; color: #999;">${entry.details.function}()</span>`;
        }
    }

    // Agregar errores si existen (SIEMPRE visible)
    if (entry.details?.error) {
        detailsSummary += `<br><span style="color: #F44336; font-weight: 600; font-size: 10px;">⚠️ ${entry.details.error}</span>`;
    }

    // Si aún está vacío (no debería pasar), mostrar algo genérico
    if (!detailsSummary || detailsSummary.trim() === '') {
        detailsSummary = `<span style="color: #999;">Acción registrada</span>`;
    }

    const bgColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9';

    return `
        <tr style="background: ${bgColor}; border-bottom: 1px solid #eee; cursor: pointer;"
            data-entry-id="${entry.id}"
            data-action="${entry.action}"
            data-entity="${entry.entityType}"
            title="Click para ver detalles completos">
            <td style="padding: 8px 12px; color: #666; font-family: 'Courier New', monospace; font-size: 10px;">${timeStr}</td>
            <td style="padding: 8px 12px; font-weight: 600; color: #213B50; font-size: 11px;">${entry.action.replace(/_/g, ' ')}</td>
            <td style="padding: 8px 12px; color: #666; font-size: 11px;">${entry.user || 'Sistema'}</td>
            <td style="padding: 8px 12px;">
                <span style="background: #e3f2fd; color: #1976d2; padding: 3px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;">
                    ${entry.entityType.toUpperCase()}
                </span>
            </td>
            <td style="padding: 8px 12px; color: #444; font-size: 11px; line-height: 1.4;">
                ${contextHTML}
            </td>
            <td style="padding: 8px 12px; color: #333; font-size: 11px; line-height: 1.4;">
                ${detailsSummary}
            </td>
            <td style="padding: 8px 12px; text-align: center;">
                <span style="color: ${statusColor}; font-size: 14px; font-weight: 600;">${statusIcon}</span>
            </td>
        </tr>
    `;
}

/**
 * Generar estadísticas del audit trail
 */
function generateAuditStats(entries) {
    return {
        creates: entries.filter(e => e.action.includes('CREATE')).length,
        updates: entries.filter(e => e.action.includes('UPDATE') || e.action.includes('EDIT') || e.action.includes('RENAME')).length,
        deletes: entries.filter(e => e.action.includes('DELETE')).length,
        exports: entries.filter(e => e.action.includes('EXPORT')).length
    };
}

/**
 * Configurar event listeners del viewer
 */
function setupAuditViewerListeners(allEntries) {
    let filteredEntries = [...allEntries];

    // Cerrar modal
    document.getElementById('closeAuditViewer').addEventListener('click', () => {
        document.getElementById('auditTrailViewerModal').remove();
    });

    // ESC para cerrar
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('auditTrailViewerModal');
            if (modal) {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        }
    };
    document.addEventListener('keydown', escHandler);

    // Función de filtrado
    const applyFilters = () => {
        const searchTerm = document.getElementById('filterSearch').value.toLowerCase();
        const actionFilter = document.getElementById('filterAction').value;
        const entityFilter = document.getElementById('filterEntity').value;

        filteredEntries = allEntries.filter(entry => {
            const matchesSearch = !searchTerm ||
                entry.action.toLowerCase().includes(searchTerm) ||
                entry.user.toLowerCase().includes(searchTerm) ||
                entry.entityType.toLowerCase().includes(searchTerm) ||
                (entry.entityName && entry.entityName.toLowerCase().includes(searchTerm));

            const matchesAction = !actionFilter || entry.action === actionFilter;
            const matchesEntity = !entityFilter || entry.entityType === entityFilter;

            return matchesSearch && matchesAction && matchesEntity;
        });

        // Re-renderizar tabla
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = filteredEntries.map((entry, index) => generateAuditRowHTML(entry, index)).join('');

        // Actualizar contador
        document.getElementById('filterCount').textContent = `${filteredEntries.length} resultados`;
    };

    // Listeners de filtros
    document.getElementById('filterSearch').addEventListener('input', applyFilters);
    document.getElementById('filterAction').addEventListener('change', applyFilters);
    document.getElementById('filterEntity').addEventListener('change', applyFilters);

    document.getElementById('clearFilters').addEventListener('click', () => {
        document.getElementById('filterSearch').value = '';
        document.getElementById('filterAction').value = '';
        document.getElementById('filterEntity').value = '';
        applyFilters();
    });

    // Exportar resultados filtrados
    document.getElementById('exportFilteredJSON').addEventListener('click', async () => {
        try {
            const auditData = await exportAuditTrailJSON();
            auditData.entries = filteredEntries; // Solo exportar filtrados
            auditData.metadata.totalEntries = filteredEntries.length;
            auditData.metadata.filtered = filteredEntries.length !== allEntries.length;

            const jsonString = JSON.stringify(auditData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const fileName = `AuditTrail_Filtered_${timestamp}.json`;

            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);

            alert(`Exportación exitosa:\n\n${fileName}\n\n${filteredEntries.length} entradas exportadas`);
        } catch (error) {
            console.error('Error exportando resultados filtrados:', error);
            alert('Error al exportar:\n\n' + error.message);
        }
    });

    // Verificar integridad
    document.getElementById('verifyIntegrityViewer').addEventListener('click', async () => {
        try {
            const integrity = await verifyAuditTrailIntegrity();

            if (integrity.valid) {
                alert(`✓ Integridad verificada correctamente\n\nCadena de hashes válida: ${integrity.chainLength} entradas\n\nNo se detectaron manipulaciones o alteraciones en el audit trail.`);
            } else {
                alert(`✗ ERROR DE INTEGRIDAD\n\nSe detectaron ${integrity.errors.length} problema(s):\n\n${integrity.errors.join('\n')}\n\nEl audit trail puede haber sido manipulado.`);
            }
        } catch (error) {
            console.error('Error verificando integridad:', error);
            alert('Error al verificar integridad:\n\n' + error.message);
        }
    });
}

/* ====================================================================
   MODAL DE VALIDACIÓN (LOGIN)
   ==================================================================== */

/**
 * Mostrar modal de login para equipo de validación
 */
async function showValidationTeamModal() {
    // Si el sistema de auth está cargado, NUNCA mostramos este modal: el
    // ejecutor sale del user logueado (vía el login modal). Devolvemos
    // defaults; cuando el user se loguea, onSessionEstablished sincroniza
    // el campo #ejecutor y los logs siguientes ya quedan a nombre real.
    if (window.ValidationSuite && window.ValidationSuite.auth) {
        const sess = window.ValidationSuite.auth.getActiveSession &&
                     window.ValidationSuite.auth.getActiveSession();
        return {
            executor: (sess && (sess.displayName || sess.username)) || 'Usuario',
            reviewer: '',
            approver: '',
            timestamp: new Date().toISOString(),
            sessionId: AUDIT_CONFIG.sessionId,
            fromAuthSession: !!sess
        };
    }
    return new Promise((resolve) => {
        // Crear modal dinámicamente
        const modal = document.createElement('div');
        modal.id = 'modalValidationTeam';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 500px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <h2 style="margin: 0 0 20px 0; color: #213B50; font-size: 20px;">
                    📋 Iniciar Sesión de Validación
                </h2>
                <p style="color: #666; margin-bottom: 20px; font-size: 13px;">
                    Ingresa los datos del equipo de validación para esta sesión.
                </p>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; color: #213B50; font-weight: 600; font-size: 12px;">
                        Ejecutor / Tester: <span style="color: red;">*</span>
                    </label>
                    <input type="text" id="auditExecutor" placeholder="Nombre completo"
                           style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; color: #213B50; font-weight: 600; font-size: 12px;">
                        Revisor: <span style="color: #999;">(opcional)</span>
                    </label>
                    <input type="text" id="auditReviewer" placeholder="Nombre completo"
                           style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; color: #213B50; font-weight: 600; font-size: 12px;">
                        Rol:
                    </label>
                    <select id="auditRole" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
                        <option value="QA Tester">QA Tester</option>
                        <option value="QA Analyst">QA Analyst</option>
                        <option value="QA Lead">QA Lead</option>
                        <option value="Validator">Validator</option>
                        <option value="Developer">Developer</option>
                    </select>
                </div>

                <button id="btnStartSession"
                        style="width: 100%; padding: 12px; background: #C2E03B; color: #213B50; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 14px;">
                    Iniciar Sesión
                </button>

                <p style="margin-top: 15px; font-size: 11px; color: #999; text-align: center;">
                    Esta información quedará registrada en el Audit Trail
                </p>
            </div>
        `;

        document.body.appendChild(modal);

        // Handler del botón
        document.getElementById('btnStartSession').addEventListener('click', () => {
            const executor = document.getElementById('auditExecutor').value.trim();
            const reviewer = document.getElementById('auditReviewer').value.trim();
            const role = document.getElementById('auditRole').value;

            if (!executor) {
                alert('El nombre del ejecutor es obligatorio');
                return;
            }

            // Guardar en sessionStorage
            const validationTeam = {
                executor: executor,
                reviewer: reviewer || 'No asignado',
                role: role,
                sessionStart: new Date().toISOString()
            };

            sessionStorage.setItem('validationTeam', JSON.stringify(validationTeam));

            // Actualizar campo ejecutor si existe
            const executorField = document.getElementById('executor') || document.getElementById('ejecutor');
            if (executorField) {
                executorField.value = executor;
            }

            // Cerrar modal
            modal.remove();
            resolve(validationTeam);
        });

        // Bloquear ESC
        document.addEventListener('keydown', function preventEsc(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    });
}

/* ====================================================================
   INICIALIZACIÓN
   ==================================================================== */

/**
 * Inicializar sistema de audit trail al cargar la página
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🔍 Audit Trail: Iniciando sistema...');

        // 1. Mostrar modal de validación
        const validationTeam = await showValidationTeamModal();
        console.log('✓ Equipo de validación registrado:', validationTeam);

        // 2. Inicializar DB
        await initAuditTrailDB();
        console.log('✓ Audit Trail: IndexedDB inicializada correctamente');

        // 3. Log de inicio del sistema con datos del equipo
        await logAction(
            AUDIT_ACTIONS.SYSTEM_INIT,
            'system',
            'system',
            {
                version: '3.0',
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                validationTeam: validationTeam
            },
            `Sesión iniciada por ${validationTeam.executor}`
        );
        console.log('✓ Audit Trail: SYSTEM_INIT registrado');

        // 4. Aplicar auto-wrapping de funciones
        // Esperar 1 segundo para que se carguen todas las funciones del sistema
        setTimeout(() => {
            initAutoWrapping();
        }, 1000);

        // 5. Verificar cuántas entradas hay
        const count = await getAllAuditEntries();
        console.log(`✓ Audit Trail: ${count.length} entradas en total`);

    } catch (error) {
        console.error('❌ Error inicializando audit trail:', error);
    }
});

/* ====================================================================
   EXPORTS (para usar en otros archivos)
   ==================================================================== */

// Hacer funciones disponibles globalmente
if (typeof window !== 'undefined') {
    window.AuditTrail = {
        logAction,
        AUDIT_ACTIONS,
        exportAuditTrailJSON,
        downloadAuditTrailJSON,
        exportAuditTrailPDF,
        verifyAuditTrailIntegrity,
        getAllAuditEntries,
        clearAuditTrail,
        auditWrapper,
        showAuditTrailViewer
    };
}
