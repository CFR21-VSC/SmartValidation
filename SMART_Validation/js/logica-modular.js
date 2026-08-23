/* ====================================================================
   GESTOR DE EVIDENCIAS v3.0 - LÓGICA MODULAR
   Sistema de Validación Computerizada
   Desarrollo incremental - Mantener funcionalidades existentes
   ==================================================================== */

'use strict';

/* ====================================================================
   MÓDULO 0: INDEXEDDB - ALMACENAMIENTO DE IMÁGENES
   ==================================================================== */

/**
 * Configuración de IndexedDB
 */
const DB_NAME = 'GestorEvidenciasDB';
const DB_VERSION = 2;  // v2: Agregado auditTrail store
const IMAGES_STORE = 'images';

let db = null;

/**
 * Inicializar IndexedDB
 */
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
    // //             console.error('❌ Error abriendo IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
    // //             console.log('✅ IndexedDB inicializado correctamente');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            // console.log('🔧 Creando estructura de IndexedDB...');
            const db = event.target.result;

            // Crear store para imágenes
            if (!db.objectStoreNames.contains(IMAGES_STORE)) {
                const imageStore = db.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
    // //                 console.log('✓ Store "images" creado');
            }

            // Crear store para audit trail (v2)
            if (!db.objectStoreNames.contains('auditTrail')) {
                const auditStore = db.createObjectStore('auditTrail', { keyPath: 'id' });
                auditStore.createIndex('timestamp', 'timestamp', { unique: false });
                auditStore.createIndex('action', 'action', { unique: false });
                auditStore.createIndex('entityType', 'entityType', { unique: false });
                auditStore.createIndex('user', 'user', { unique: false });
            }

        };
    });
}

/**
 * Guardar imagen en IndexedDB
 * @param {string} id - ID único de la evidencia (ej: "test_123_evidence_1")
 * @param {string} imageData - Base64 de la imagen
 * @returns {Promise}
 */
function _evidenceCompoundId(imageId) {
    const projId = (window.VS && window.VS.projects && window.VS.projects.getActiveId()) || 'noproj';
    return (projId + '_' + imageId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 300);
}

function saveImageToDB(id, imageData) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('IndexedDB no inicializado'));
            return;
        }

        const transaction = db.transaction([IMAGES_STORE], 'readwrite');
        const store = transaction.objectStore(IMAGES_STORE);

        const request = store.put({ id, data: imageData });

        request.onsuccess = () => {
            resolve();
            // Fire-and-forget: backup al servidor para persistencia multi-sesión
            if (window.VS && window.VS.Storage && window.VS.Storage.isAvailable()) {
                window.VS.Storage.uploadEvidence(_evidenceCompoundId(id), imageData);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Obtener imagen desde IndexedDB
 * @param {string} id - ID de la evidencia
 * @returns {Promise<string>} - Base64 de la imagen
 */
async function getImageFromDB(id) {
    // 1. Intentar IndexedDB local (rápido, sin red)
    const localData = await new Promise((resolve, reject) => {
        if (!db) { resolve(null); return; }
        const req = db.transaction([IMAGES_STORE], 'readonly').objectStore(IMAGES_STORE).get(id);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror  = () => resolve(null);
    });
    if (localData) return localData;

    // 2. Fallback: intentar recuperar del servidor (otro navegador/máquina guardó esta imagen)
    try {
        if (window.VS && window.VS.Storage && window.VS.Storage.isAvailable()) {
            const serverData = await window.VS.Storage.fetchEvidence(_evidenceCompoundId(id));
            if (serverData) {
                // Cachear en IndexedDB para no volver a pedir al servidor
                saveImageToDB(id, serverData).catch(() => {});
                return serverData;
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Eliminar imagen de IndexedDB
 * @param {string} id - ID de la evidencia
 * @returns {Promise}
 */
function deleteImageFromDB(id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('IndexedDB no inicializado'));
            return;
        }

        const transaction = db.transaction([IMAGES_STORE], 'readwrite');
        const store = transaction.objectStore(IMAGES_STORE);

        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Limpiar TODAS las imágenes de IndexedDB
 * @returns {Promise}
 */
function clearAllImagesFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('IndexedDB no inicializado'));
            return;
        }

        const transaction = db.transaction([IMAGES_STORE], 'readwrite');
        const store = transaction.objectStore(IMAGES_STORE);

        const request = store.clear();

        request.onsuccess = () => {
            // console.log('🗑️ Todas las imágenes eliminadas de IndexedDB');
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Obtener estadísticas de uso de IndexedDB
 * @returns {Promise<object>}
 */
async function getDBStats() {
    if (!db) return { count: 0, estimatedSize: 0 };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([IMAGES_STORE], 'readonly');
        const store = transaction.objectStore(IMAGES_STORE);

        const countRequest = store.count();

        countRequest.onsuccess = () => {
            // Estimar tamaño (aproximado)
            if (navigator.storage && navigator.storage.estimate) {
                navigator.storage.estimate().then(estimate => {
                    resolve({
                        count: countRequest.result,
                        usage: estimate.usage,
                        quota: estimate.quota,
                        usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(2)
                    });
                });
            } else {
                resolve({
                    count: countRequest.result,
                    estimatedSize: 'N/A'
                });
            }
        };

        countRequest.onerror = () => reject(countRequest.error);
    });
}

/**
 * Lee TODAS las imágenes de IndexedDB y las devuelve como {id: base64data}.
 * Usado para el bulk-sync inicial hacia el servidor.
 */
function getAllImagesFromDB() {
    return new Promise((resolve) => {
        if (!db) { resolve({}); return; }
        const result = {};
        const req = db.transaction([IMAGES_STORE], 'readonly')
                      .objectStore(IMAGES_STORE)
                      .openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                result[cursor.key] = cursor.value.data;
                cursor.continue();
            } else {
                resolve(result);
            }
        };
        req.onerror = () => resolve({});
    });
}

/**
 * Sube todas las imágenes de IndexedDB al servidor (one-time migration sync).
 * Se llama una sola vez cuando el servidor está disponible.
 * Usa un flag en localStorage para no repetirlo en cada sesión.
 */
async function _bulkSyncImagesToServer(projectId) {
    if (!window.VS || !window.VS.Storage || !window.VS.Storage.isAvailable()) return;
    if (!projectId) return;
    const flagKey = `_imgSynced_${projectId}`;
    if (localStorage.getItem(flagKey)) return;   // ya se sincronizó
    const allImages = await getAllImagesFromDB();
    const keys = Object.keys(allImages);
    if (!keys.length) {
        localStorage.setItem(flagKey, '1');
        return;
    }
    // Convertir IDs locales a compound IDs
    const toUpload = {};
    for (const localId of keys) {
        const compoundId = _evidenceCompoundId(localId);
        toUpload[compoundId] = allImages[localId];
    }
    await window.VS.Storage.bulkUploadEvidence(toUpload).catch(() => {});
    localStorage.setItem(flagKey, '1');
    console.log(`[BulkSync] ${keys.length} imágenes sincronizadas al servidor`);
}

/**
 * Pre-carga en IndexedDB las imágenes del servidor que faltan localmente.
 * Llamar ANTES de generar PDF cuando el proyecto viene de otro dispositivo.
 * imageIds: array de IDs locales (sin compound prefix).
 */
async function prefetchImagesFromServer(imageIds) {
    if (!window.VS || !window.VS.Storage || !window.VS.Storage.isAvailable()) return;
    if (!imageIds || !imageIds.length) return;
    const missing = [];
    for (const id of imageIds) {
        const local = await new Promise(res => {
            if (!db) { res(null); return; }
            const r = db.transaction([IMAGES_STORE], 'readonly').objectStore(IMAGES_STORE).get(id);
            r.onsuccess = () => res(r.result ? r.result.data : null);
            r.onerror = () => res(null);
        });
        if (!local) missing.push(_evidenceCompoundId(id));
    }
    if (!missing.length) return;
    const results = await window.VS.Storage.fetchEvidenceBatch(missing).catch(() => ({}));
    for (const [compoundId, data] of Object.entries(results)) {
        if (!data) continue;
        // Recuperar ID local desde compound ID
        const localId = imageIds.find(id => _evidenceCompoundId(id) === compoundId);
        if (localId) {
            await saveImageToDB(localId, data).catch(() => {});
        }
    }
}

/* ====================================================================
   VARIABLES GLOBALES
   ==================================================================== */

// Arrays de datos principales - JERARQUÍA DE 3 NIVELES
let protocols = [];  // Nivel 1: Protocolos (IQ, OQ, PQ)
let groups = [];     // Nivel 2: Carpetas (dentro de protocolos)
let tests = [];      // Nivel 3: Pruebas (dentro de carpetas)

// PAQUETE DOCUMENTAL — multi-doc state (Fase B)
// Almacena los JSONs completos de los docs del paquete (URS, RA, IRA,
// PIQ, IIQ, POQ, IOQ, MTR, etc.) para permitir trazabilidad cruzada.
// Cada entrada: { type, code, version, title, data, fileName, loadedAt, derivedRefs }
let packageDocs = [];

// IDs activos
let activeTestId = null;
let activeProtocolId = null;

// Información del sistema (PROYECTO = nivel 0)
let systemInfo = {
    // Empresa & contexto
    empresa: '',
    cliente: '',
    // Sistema validado
    nombreSistema: '',
    codigoSistema: '',
    versionSistema: '',
    categoriaGamp: '',
    tipoSistema: '',
    proveedor: '',
    // Personas (revisor/aprobador/auditor; ejecutor va en variable separada)
    revisor: '',
    aprobador: '',
    auditor: '',
    // Período
    fechaInicio: '',
    fechaCierre: '',
    notasProyecto: ''
};

// Datos del proyecto
let projectData = {
    finalized: false,
    conclusion: '',
    resultado: ''
};

// Ejecutor
let executor = '';

// Imagen pendiente de procesar
let pendingImage = {
    data: null,
    size: null,
    dimensions: null,
    captureTimestamp: null
};

// Índice de inserción (para insertar ANTES)
let insertBeforeIndex = null;

let fabricCanvas = null;
let currentEditingIndex = null;
let editorHistory = [];
let editorHistoryIndex = -1;
let currentDrawColor = '#000000';

/* ====================================================================
   INICIALIZACIÓN
   ==================================================================== */

document.addEventListener('DOMContentLoaded', async function () {
    // console.log('🚀 Sistema inicializando...');

    // ── Bootstrap multi-proyecto ──
    // Hidrata el localStorage `vscTestsData_v3` desde el proyecto activo (si lo hay)
    // ANTES de loadFromStorage(). Si es la primera vez con multi-proyecto, migra
    // los datos existentes a un "Proyecto inicial" sin perder nada.
    if (window.ValidationSuite && window.ValidationSuite.projects) {
        try { await window.ValidationSuite.projects.bootstrap(); }
        catch (e) { console.warn('[projects] bootstrap falló:', e); }
    }

    // Inicializar IndexedDB PRIMERO
    try {
        await initIndexedDB();
    // //         console.log('✅ IndexedDB listo');

        // Mostrar estadísticas de uso
        const stats = await getDBStats();
        // console.log('📊 Uso de almacenamiento:', {
        //     imágenes: stats.count,
        //     uso: `${(stats.usage / 1024 / 1024).toFixed(2)} MB`,
        //     cuota: `${(stats.quota / 1024 / 1024).toFixed(2)} MB`,
        //     porcentaje: `${stats.usagePercent}%`
        // });
    } catch (error) {
    // //         console.error('❌ Error inicializando IndexedDB:', error);
        showNotification('Advertencia: IndexedDB no disponible. Capacidad limitada.', 'warning');
    }

    // Cargar datos guardados
    await loadFromStorage();

    // Bulk sync: subir imágenes locales al servidor (primera vez por proyecto)
    // Se ejecuta en background para no bloquear la UI
    setTimeout(async () => {
        try {
            const projId = window.VS && window.VS.projects && window.VS.projects.getActiveId
                ? window.VS.projects.getActiveId() : null;
            if (projId) await _bulkSyncImagesToServer(projId);
        } catch (_) {}
    }, 3000);

    // Inicializar UI
    initUI();

    // Sincronizar campos del sistema
    syncSystemFields();

    // Renderizar lista de tests
    renderTests();

    // Fase B.2 — Renderizar panel del paquete documental si hay docs cargados
    if (typeof renderPackagePanel === 'function') {
        renderPackagePanel();
    }

    // Auto-save cada 30 segundos
    setInterval(saveToStorage, 30000);

    // Llamar a initExportModalHandlers cuando se inicializa la app
    initExportModalHandlers();

    // También inicializar cuando se abre el modal
    const originalShowModal = showModal;
    showModal = function (modalId) {
        originalShowModal(modalId);
        if (modalId === 'modalExportSummary') {
            initExportModalHandlers();
        }
    };

    // //     console.log('✅ Sistema listo');
});

/* ====================================================================
   FUNCIONES DE ALMACENAMIENTO
   ==================================================================== */

/**
 * Migrar datos de v2.5 a v3.0
 * @param {Object} oldData - Datos en formato v2.5
 */
function migrateFromV2ToV3(oldData) {
    // //     console.log('Iniciando migración v2.5 → v3.0');

    // Agregar systemInfo vacío si no existe
    if (!oldData.systemInfo) {
        oldData.systemInfo = {
            empresa: '',
            nombreSistema: '',
            codigoSistema: '',
            proveedor: '',
            revisor: '',
            aprobador: ''
        };
    } else {
        // Asegurar campos nuevos en systemInfo existente
        if (!oldData.systemInfo.revisor) oldData.systemInfo.revisor = '';
        if (!oldData.systemInfo.aprobador) oldData.systemInfo.aprobador = '';
    }

    // Agregar protocols vacío (NUEVO en v3.0)
    if (!oldData.protocols) {
        oldData.protocols = [];
    // //         console.log('✓ protocols agregado (vacío - usuario deberá crear)');
    }

    // Actualizar versión
    oldData.version = '3.0';

    // Mantener executor (ya existía)
    if (!oldData.executor) {
        oldData.executor = '';
    }

    // Mantener groups (ya existían - ahora pueden tener protocolId)
    if (!oldData.groups) {
        oldData.groups = [];
    }

    // Mantener tests (ya existían)
    if (!oldData.tests) {
        oldData.tests = [];
    }

    // Mantener projectData (ya existía)
    if (!oldData.projectData) {
        oldData.projectData = {
            finalized: false,
            conclusion: '',
            resultado: ''
        };
    }

    // Guardar datos migrados en nueva key
    localStorage.setItem('vscTestsData_v3', JSON.stringify(oldData));

    // //     console.log('✓ Migración completada exitosamente');
    // //     console.log('✓ Sesión guardada como v3.0');

    showNotification('Sesión migrada a v3.0 correctamente');

    return oldData;
}

/**
 * Guardar todos los datos en localStorage
 */
async function saveToStorage() {
    try {
        // console.log('💾 Guardando sesión...');

        // =======================
        // PASO 1: Extraer y guardar imágenes en IndexedDB
        // =======================
        let imageCount = 0;
        const imagePromises = [];

        for (const test of tests) {
            for (const evidence of test.evidences) {
                // Solo guardar imágenes que existen
                if (evidence.image && !evidence.isEmpty) {
                    // ID único: testId_evidenceStep
                    const imageId = `${test.id}_evidence_${evidence.step}`;

                    // Guardar imagen en IndexedDB (async)
                    imagePromises.push(
                        saveImageToDB(imageId, evidence.image)
                            .catch(err => {
    // //                                 console.error(`Error guardando imagen ${imageId}:`, err);
                            })
                    );

                    imageCount++;
                }
            }
        }

        // Esperar a que todas las imágenes se guarden
        await Promise.all(imagePromises);
    // //         console.log(`✓ ${imageCount} imágenes guardadas en IndexedDB`);

        // =======================
        // PASO 2: Crear copia sin imágenes para localStorage
        // =======================
        const testsWithoutImages = tests.map(test => ({
            ...test,
            evidences: test.evidences.map(evidence => {
                // Copiar evidencia SIN la propiedad 'image'
                const { image, ...evidenceWithoutImage } = evidence;
                return {
                    ...evidenceWithoutImage,
                    hasImage: !!image && !evidence.isEmpty  // Flag para saber si tiene imagen en IndexedDB
                };
            })
        }));

        const data = {
            version: '3.0',
            storageMethod: 'indexeddb',  // Flag para identificar que usa IndexedDB
            systemInfo: {
                empresa: document.getElementById('empresa').value.trim(),
                cliente: document.getElementById('cliente')?.value.trim() || '',
                nombreSistema: document.getElementById('nombreSistema').value.trim(),
                codigoSistema: document.getElementById('codigoSistema').value.trim(),
                versionSistema: document.getElementById('versionSistema')?.value.trim() || '',
                categoriaGamp: document.getElementById('categoriaGamp')?.value.trim() || '',
                tipoSistema: document.getElementById('tipoSistema')?.value.trim() || '',
                proveedor: document.getElementById('proveedor').value.trim(),
                revisor: document.getElementById('revisor')?.value.trim() || '',
                aprobador: document.getElementById('aprobador')?.value.trim() || '',
                auditor: document.getElementById('auditor')?.value.trim() || '',
                fechaInicio: document.getElementById('fechaInicio')?.value.trim() || '',
                fechaCierre: document.getElementById('fechaCierre')?.value.trim() || '',
                notasProyecto: document.getElementById('notasProyecto')?.value.trim() || ''
            },
            executor: document.getElementById('ejecutor').value.trim(),
            protocols: protocols,
            groups: groups,
            tests: testsWithoutImages,  // Tests SIN imágenes
            projectData: projectData,
            packageDocs: packageDocs,  // Fase B.1 — paquete documental multi-doc
            exportConfig: getExportConfigFromUI(),
            lastSaved: new Date().toISOString()
        };

        const jsonString = JSON.stringify(data);
        const sizeInMB = (new Blob([jsonString]).size / (1024 * 1024)).toFixed(2);

        // =======================
        // PASO 3: Guardar metadata en localStorage
        // =======================
        localStorage.setItem('vscTestsData_v3', jsonString);

        // =======================
        // PASO 4: Auto-backup (cada 5 guardados)
        // =======================
        if (!window._saveCount) window._saveCount = 0;
        window._saveCount++;
        if (window._saveCount % 5 === 0) {
            createAutoBackup();
        }

        // Actualizar indicador de almacenamiento
        updateStorageIndicator();

        // Si hay sesion movil activa, refrescar el snapshot del servidor
        if (typeof mobileSyncToken !== 'undefined' && mobileSyncToken) {
            refreshMobileSyncSession().catch(() => { /* silencioso */ });
        }

        // Sync con multi-proyecto: si hay proyecto activo, replicar el snapshot
        // al entry de IndexedDB (con stats derivados). Throttle suave para no
        // sobrecargar — el writeback es barato pero mejor agruparlo.
        if (window.ValidationSuite && window.ValidationSuite.projects && window.ValidationSuite.projects.getActiveId()) {
            clearTimeout(window._projectSnapshotSyncTO);
            window._projectSnapshotSyncTO = setTimeout(() => {
                window.ValidationSuite.projects.saveCurrentToActive()
                    .then(() => {
                        if (typeof window.refreshActiveProjectChip === 'function') {
                            window.refreshActiveProjectChip();
                        }
                    })
                    .catch(e => console.warn('[projects] saveCurrentToActive falló:', e));
            }, 800);
        }

        updateDesviosBadge();
        return true;
    } catch (error) {
    // //         console.error('❌ Error guardando datos:', error);

        // Detectar si es QuotaExceededError
        if (error.name === 'QuotaExceededError' || error.code === 22) {
            showNotification('⚠ LÍMITE DE ALMACENAMIENTO EXCEDIDO - Exporta a JSON como backup', 'error');
        } else {
            showNotification('Error al guardar datos: ' + error.message, 'error');
        }

        return false;
    }
}

/**
 * Cargar datos desde localStorage
 */
async function loadFromStorage() {
    try {
        // console.log('📂 Cargando sesión...');

        // Intentar cargar v3.0 primero
        let data = localStorage.getItem('vscTestsData_v3');

        // Si no existe, intentar cargar v2.5 y migrar
        if (!data) {
            const oldData = localStorage.getItem('vscTestsData');
            if (oldData) {
    // //                 console.log('Detectada sesión v2.5 - Migrando a v3.0...');
                data = oldData;
            } else {
    // //                 console.log('No hay datos guardados');
                return false;
            }
        }

        const parsed = JSON.parse(data);

        // MIGRACIÓN AUTOMÁTICA de v2.5 a v3.0
        if (!parsed.version || parsed.version === '2.5') {
    // //             console.warn('Migrando desde v2.5 a v3.0...');
            migrateFromV2ToV3(parsed);
        }

        // Validar versión
        if (parsed.version !== '3.0') {
    // //             console.warn('Versión de datos no compatible:', parsed.version);
        }

        // Cargar información del sistema
        if (parsed.systemInfo) {
            // Helper inline para escribir solo si el elemento existe
            const setSysVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val || '';
            };
            setSysVal('empresa', parsed.systemInfo.empresa);
            setSysVal('cliente', parsed.systemInfo.cliente);
            setSysVal('nombreSistema', parsed.systemInfo.nombreSistema);
            setSysVal('codigoSistema', parsed.systemInfo.codigoSistema);
            setSysVal('versionSistema', parsed.systemInfo.versionSistema);
            setSysVal('categoriaGamp', parsed.systemInfo.categoriaGamp);
            setSysVal('tipoSistema', parsed.systemInfo.tipoSistema);
            setSysVal('proveedor', parsed.systemInfo.proveedor);
            setSysVal('revisor', parsed.systemInfo.revisor);
            setSysVal('aprobador', parsed.systemInfo.aprobador);
            setSysVal('auditor', parsed.systemInfo.auditor);
            setSysVal('fechaInicio', parsed.systemInfo.fechaInicio);
            setSysVal('fechaCierre', parsed.systemInfo.fechaCierre);
            setSysVal('notasProyecto', parsed.systemInfo.notasProyecto);
            systemInfo = parsed.systemInfo;
        }

        // Cargar ejecutor
        if (parsed.executor) {
            document.getElementById('ejecutor').value = parsed.executor;
            executor = parsed.executor;
        }

        // Cargar protocolos (NUEVO - con fallback)
        protocols = parsed.protocols || [];

        // Cargar grupos
        groups = parsed.groups || [];

        // =======================
        // CARGAR TESTS CON IMÁGENES DESDE INDEXEDDB
        // =======================
        tests = parsed.tests || [];

        // Si usa IndexedDB, cargar imágenes
        if (parsed.storageMethod === 'indexeddb' && db) {
            // console.log('🔄 Cargando imágenes desde IndexedDB...');
            let imageLoadCount = 0;

            for (const test of tests) {
                for (const evidence of test.evidences) {
                    // Si tiene flag hasImage, buscar en IndexedDB
                    if (evidence.hasImage && !evidence.isEmpty) {
                        const imageId = `${test.id}_evidence_${evidence.step}`;

                        try {
                            const imageData = await getImageFromDB(imageId);
                            if (imageData) {
                                evidence.image = imageData;
                                imageLoadCount++;
                            } else {
    // //                                 console.warn(`Imagen no encontrada en IndexedDB: ${imageId}`);
                            }
                        } catch (err) {
    // //                             console.error(`Error cargando imagen ${imageId}:`, err);
                        }
                    }

                    // Limpiar flag temporal
                    delete evidence.hasImage;
                }
            }

    // //             console.log(`✓ ${imageLoadCount} imágenes cargadas desde IndexedDB`);
        }

        // Cargar datos del proyecto
        projectData = parsed.projectData || {
            finalized: false,
            conclusion: '',
            resultado: ''
        };

        // Restaurar paquete documental (Fase B.1) — mutación in-place para
        // preservar la referencia de window.packageDocs.
        packageDocs.length = 0;
        if (Array.isArray(parsed.packageDocs)) {
            parsed.packageDocs.forEach(d => packageDocs.push(d));
        }

        // Cargar estado del ecosistema desde el servidor en background
        setTimeout(refreshServerDocStatus, 900);

        // Restaurar configuración de exportación
        if (parsed.exportConfig) {
            try { localStorage.setItem('drp_projectExportDefaults', JSON.stringify(parsed.exportConfig)); } catch (e) {}
        }

    // //         console.log('✅ Sesión cargada:', {
    //         version: parsed.version || 'v2.5',
    //         protocols: protocols.length,
    //         tests: tests.length,
    //         groups: groups.length,
    //         evidencias: tests.reduce((sum, t) => sum + t.evidences.length, 0),
    //         lastSaved: parsed.lastSaved
    //     });

        return true;
    } catch (error) {
    // //         console.error('❌ Error cargando datos:', error);
        showNotification('Error al cargar datos guardados: ' + error.message, 'error');
        return false;
    }
}

/**
 * Sincronizar campos del sistema en tiempo real
 */
function syncSystemFields() {
    // 'ejecutor' va en variable global aparte (executor). El resto en systemInfo.
    const fields = [
        'empresa', 'cliente',
        'nombreSistema', 'codigoSistema', 'versionSistema', 'categoriaGamp', 'tipoSistema', 'proveedor',
        'ejecutor', 'revisor', 'aprobador', 'auditor',
        'fechaInicio', 'fechaCierre', 'notasProyecto'
    ];

    fields.forEach(fieldId => {
        const input = document.getElementById(fieldId);
        if (!input) return;
        // Para selects usar 'change'; para inputs 'input'
        const ev = (input.tagName === 'SELECT') ? 'change' : 'input';
        input.addEventListener(ev, function () {
            if (fieldId === 'ejecutor') {
                executor = this.value.trim();
            } else {
                systemInfo[fieldId] = this.value.trim();
            }
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => { saveToStorage(); }, 2000);
        });
    });
}

/**
 * Limpiar cache y reiniciar
 */
async function clearCache() {
    // Mostrar modal obligatorio
    const modal = document.getElementById('modalClearCache');
    if (!modal) {
    // //         console.error('Modal de limpieza no encontrado');
        return;
    }

    modal.style.display = 'flex';

    // Deshabilitar ESC
    const originalOnKeyDown = document.onkeydown;
    document.onkeydown = function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            return false;
        }
    };

    window.restoreKeyboard = function () {
        document.onkeydown = originalOnKeyDown;
    };
}

/**
 * Exportar sesión como archivo JSON
 */
async function exportSessionJSON() {
    try {
        // Validar campos obligatorios
        if (!validateSystemInfo()) {
            return;
        }

        // Pedir nombre de archivo al usuario
        // Naming: AEX-{code}-{fecha} para consistencia con el modelo AEX
        // (el gestor ahora almacena la documentación de los TCs sin generar
        // PDF propio — los exports salen del suite).
        const dateStr = new Date().toISOString().split('T')[0];
        const code = systemInfo.codigoSistema || 'backup';
        const defaultName = `AEX-${code}-${dateStr}`;
        const customName = prompt('Nombre del archivo (sin extensión .json):', defaultName);

        if (!customName || customName.trim() === '') {
            showNotification('Exportación cancelada', 'error');
            return;
        }

        // CRÍTICO: Recolectar imágenes desde el DOM antes de exportar
        const testsWithImages = tests.map(test => {
            return {
                ...test,
                evidences: test.evidences.map(evidence => {
                    // Si la evidencia ya tiene imagen válida, usarla
                    if (evidence.image && evidence.image.startsWith('data:image')) {
                        return evidence;
                    }

                    // Si no, buscar la imagen en el DOM renderizado
                    const workArea = document.getElementById('workArea');
                    const imgElements = workArea.querySelectorAll('img');

                    for (let img of imgElements) {
                        const stepAttr = img.getAttribute('data-step');
                        const testAttr = img.getAttribute('data-test');

                        if (stepAttr == evidence.step && testAttr == test.id) {
                            if (img.src && img.src.startsWith('data:image')) {
    // //                                 console.log(`✓ Recuperando imagen desde DOM: Test ${test.name} - Paso ${evidence.step}`);
                                return {
                                    ...evidence,
                                    image: img.src
                                };
                            }
                        }
                    }

                    // Si no se encontró en el DOM, advertir
                    if (!evidence.isEmpty) {
    // //                         console.warn(`⚠ Imagen faltante: Test ${test.name} - Paso ${evidence.step}`);
                    }

                    return evidence;
                })
            };
        });

        const data = {
            version: '3.0',
            exportDate: new Date().toISOString(),
            systemInfo: systemInfo,
            executor: executor,
            protocols: protocols,
            groups: groups,
            tests: testsWithImages, // ← Usar versión con imágenes desde DOM
            projectData: projectData,
            packageDocs: packageDocs  // Fase B.1 — paquete documental multi-doc
        };

        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${customName.trim()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Calcular estadísticas del export
        const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
        let evidenceCount = 0;
        let imagesCount = 0;

        testsWithImages.forEach(test => {
            evidenceCount += test.evidences.length;
            imagesCount += test.evidences.filter(e => e.image && e.image.startsWith('data:image')).length;
        });

        showNotification(`✓ JSON exportado: ${sizeMB} MB | ${imagesCount}/${evidenceCount} evidencias con imágenes`);

    // //         console.log('JSON EXPORTADO:');
    // //         console.log('- Tamaño:', sizeMB, 'MB');
    // //         console.log('- Evidencias totales:', evidenceCount);
    // //         console.log('- Con imágenes:', imagesCount);
    // //         console.log('- Sin imágenes:', evidenceCount - imagesCount);

        if (imagesCount < evidenceCount) {
    // //             console.warn(`⚠ ${evidenceCount - imagesCount} evidencias exportadas SIN imagen`);
        }

    } catch (error) {
    // //         console.error('Error exportando JSON:', error);
        showNotification('Error al exportar sesión', 'error');
    }
}

/* ====================================================================
   PAQUETE DOCUMENTAL — helpers (Fase B.1)

   `packageDocs[]` almacena los JSONs completos de docs del paquete
   (URS, RA, IRA, PIQ, IIQ, POQ, IOQ, MTR, ...). Cada entrada permite
   trazabilidad cruzada sin necesidad de recargar archivos.

   Funciones expuestas:
   - addPackageDoc(data, opts)    : agrega/reemplaza un doc al paquete
   - removePackageDoc(code)       : remueve un doc por su code
   - getPackageDoc(code)          : busca por code
   - getPackageDocsByType(type)   : todos los docs de un tipo (ej. 'URS')
   - clearPackage()               : reset
   - packageDocSummary()          : array compacto {type, code, version, itemsCount}

   Notas:
   - Los docs se guardan completos en memoria; persistencia via saveToStorage
     (localStorage). Para un paquete típico (8-10 docs × ~50KB) el peso es
     manejable.
   - `derivedRefs` se computa con VS.crossRef.deriveFromDoc si está disponible,
     permitiendo lookups de trazabilidad sin escanear el JSON crudo cada vez.
   ==================================================================== */

/**
 * Agrega o reemplaza un documento en el paquete. Si ya existe un doc
 * con el mismo `code`, se reemplaza (versión nueva sobreescribe).
 *
 * @param {object} data — JSON del doc (debe tener type, document.code, document.version)
 * @param {object} [opts]
 * @param {string} [opts.fileName] — nombre del archivo origen (para UI/auditoría)
 * @returns {object} la entrada agregada al packageDocs
 */
function addPackageDoc(data, opts) {
    opts = opts || {};
    if (!data || !data.type) {
        throw new Error('addPackageDoc: el JSON no tiene campo "type"');
    }
    const code = data.document?.code || data.package?.code || data.type;
    const version = data.document?.version || '';
    const title = data.document?.titleEs || data.document?.headerTitle || data.document?.titleEn || code;

    // Calcular refs derivadas si cross-reference está disponible
    let derivedRefs = null;
    try {
        if (window.ValidationSuite && window.ValidationSuite.crossRef
            && typeof window.ValidationSuite.crossRef.deriveFromDoc === 'function') {
            derivedRefs = window.ValidationSuite.crossRef.deriveFromDoc(data);
        }
    } catch (e) { /* silencioso — derivedRefs queda null */ }

    const entry = {
        type: data.type,
        code: code,
        version: version,
        title: title,
        data: data,
        fileName: opts.fileName || '',
        loadedAt: new Date().toISOString(),
        derivedRefs: derivedRefs
    };

    // Reemplazar si existe con mismo code, agregar si no
    const idx = packageDocs.findIndex(d => d.code === code);
    if (idx >= 0) {
        packageDocs[idx] = entry;
    } else {
        packageDocs.push(entry);
    }
    // Actualizar dossier en vivo si está abierto
    renderDossierView();
    return entry;
}

/** Remueve un doc por su code. Devuelve true si se removió. */
function removePackageDoc(code) {
    const idx = packageDocs.findIndex(d => d.code === code);
    if (idx < 0) return false;
    packageDocs.splice(idx, 1);
    return true;
}

/** Busca un doc por su code. Devuelve la entrada completa o null. */
function getPackageDoc(code) {
    return packageDocs.find(d => d.code === code) || null;
}

/** Devuelve todos los docs de un tipo dado (ej. 'URS', 'PIQ', 'IIQ'). */
function getPackageDocsByType(type) {
    return packageDocs.filter(d => d.type === type);
}

/** Vacía el paquete in-place (preserva la referencia para window.packageDocs).
 *  No toca protocols/groups/tests (esos son del runtime de ejecución). */
function clearPackage() {
    packageDocs.length = 0;
}

/** Resumen compacto del paquete para UI/debug. */
function packageDocSummary() {
    return packageDocs.map(d => ({
        type: d.type,
        code: d.code,
        version: d.version,
        title: d.title,
        fileName: d.fileName,
        itemsCount: d.derivedRefs
            ? (d.derivedRefs.URS || []).length + (d.derivedRefs.RA || []).length + (d.derivedRefs.IRA || []).length
            : null
    }));
}

// Exponer en window para debug desde consola
window.packageDocs = packageDocs;
window.addPackageDoc = addPackageDoc;
window.removePackageDoc = removePackageDoc;
window.getPackageDoc = getPackageDoc;
window.getPackageDocsByType = getPackageDocsByType;
window.clearPackage = clearPackage;
window.packageDocSummary = packageDocSummary;

// Dossier en Vivo — exponer para botones del HTML
window.openDossierPanel       = openDossierPanel;
window.closeDossierPanel      = closeDossierPanel;
window.refreshServerDocStatus = refreshServerDocStatus;
window.renderDossierView      = renderDossierView;

// ====================================================================
// LOCK HELPERS — bloqueo en cascada para multi-protocolo
//
// Un test/grupo está bloqueado si CUALQUIERA de estos es true:
//   - projectData.finalized        (todo el proyecto cerrado)
//   - protocol.finalized           (su protocolo cerrado)
//   - group.finalized              (su carpeta cerrada)
//   - test.finalized               (la prueba ya cerrada)
// ====================================================================
function getProtocolOfGroup(grp) {
    if (!grp) return null;
    return protocols.find(p => p.id === grp.protocolId) || null;
}
function getProtocolOfTest(test) {
    if (!test) return null;
    const grp = groups.find(g => g.id === test.groupId);
    return getProtocolOfGroup(grp);
}
function isGroupLocked(grp) {
    if (!grp) return false;
    if (projectData && projectData.finalized) return true;
    if (grp.finalized) return true;
    const proto = getProtocolOfGroup(grp);
    return !!(proto && proto.finalized);
}
function isTestLocked(test) {
    if (!test) return false;
    if (projectData && projectData.finalized) return true;
    if (test.finalized) return true;
    const grp = groups.find(g => g.id === test.groupId);
    if (grp && grp.finalized) return true;
    const proto = getProtocolOfGroup(grp);
    return !!(proto && proto.finalized);
}
function lockReasonForTest(test) {
    if (!test) return '';
    if (projectData && projectData.finalized) return 'proyecto finalizado';
    if (test.finalized) return 'prueba finalizada';
    const grp = groups.find(g => g.id === test.groupId);
    if (grp && grp.finalized) return 'carpeta finalizada';
    const proto = getProtocolOfGroup(grp);
    if (proto && proto.finalized) return 'protocolo finalizado';
    return '';
}
function lockReasonForGroup(grp) {
    if (!grp) return '';
    if (projectData && projectData.finalized) return 'proyecto finalizado';
    if (grp.finalized) return 'carpeta finalizada';
    const proto = getProtocolOfGroup(grp);
    if (proto && proto.finalized) return 'protocolo finalizado';
    return '';
}
window.isGroupLocked = isGroupLocked;
window.isTestLocked = isTestLocked;
window.lockReasonForTest = lockReasonForTest;
window.lockReasonForGroup = lockReasonForGroup;

/**
 * SMART LOADER — punto de entrada único para el paquete documental.
 *
 * Procesa N archivos JSON y enruta cada uno según su tipo:
 *   - Protocolos (PIQ/POQ/PPQ) → agrega al paquete + candidato a ACTIVAR runtime
 *   - Informes (IIQ/IOQ/IPQ)   → agrega al paquete (alimenta trazabilidad ejecutada)
 *   - Referencias (URS/RA/IRA/HLRA/VP/RRM/MTR/FRS/DS/AEX/NOTIF...) → solo paquete
 *   - Sesión gestor (sin type, con tests+version) → RESTAURAR estado completo
 *
 * Reglas de activación:
 *   - 0 protocolos en upload     → modo referencia (paquete cargado, sin runtime)
 *   - 1 protocolo nuevo          → activa auto (preguntando si pisa runtime existente)
 *   - 2+ protocolos              → activa el primero, los demás quedan en paquete
 *
 * Preservación de trabajo en curso (Opción C):
 *   Si hay runtime con tests/evidencias capturadas Y el protocolo nuevo es
 *   distinto, pregunta antes de pisar. Si el usuario rechaza, agrega el doc
 *   al paquete sin tocar runtime.
 */
async function loadPackageFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    let okCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const errors = [];
    const skipped = []; // [{ type, fileName }]
    const protocolCandidates = []; // [{ data, fileName }]
    const sessionCandidates = [];  // [{ data, fileName }]
    const refCount = { upstream: 0, informe: 0, otros: 0 };

    const PROTOCOL_TYPES = ['PIQ', 'POQ', 'PPQ'];
    const INFORME_TYPES = ['IIQ', 'IOQ', 'IPQ'];

    // Filtro de contexto para Suite Evidencias: URS + RA + IRA + los 3 protocolos.
    // IRA aporta trazabilidad de componentes de infraestructura. Los otros docs
    // (HLRA, VP, FRS, DS, RRM, MTR, informes, reportes, NCR, VSR, AEX) no
    // aportan trazabilidad cruzada útil para la captura de evidencia. Para
    // cargar todos los docs (Libro de Validación), usar la Demo.
    const EVIDENCIAS_CONTEXT_TYPES = ['URS', 'RA', 'IRA', 'PIQ', 'POQ', 'PPQ'];

    // PASO 1 — Parse + categorizar todos los archivos
    for (const file of files) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // Sin type pero con tests + version → es una sesión gestor exportada
            if (!data.type && data.tests && data.version) {
                sessionCandidates.push({ data, fileName: file.name });
                okCount++;
                continue;
            }

            if (!data.type) {
                failCount++;
                errors.push(`${file.name}: sin campo "type" y no parece sesión gestor`);
                continue;
            }

            // Filtrar tipos que NO aportan contexto a la captura de evidencia
            if (EVIDENCIAS_CONTEXT_TYPES.indexOf(data.type) < 0) {
                skippedCount++;
                skipped.push({ type: data.type, fileName: file.name });
                continue;
            }

            // Agregar al paquete
            addPackageDoc(data, { fileName: file.name });
            okCount++;

            // Categorizar para enrutamiento posterior
            if (PROTOCOL_TYPES.indexOf(data.type) >= 0) {
                protocolCandidates.push({ data, fileName: file.name });
            } else if (INFORME_TYPES.indexOf(data.type) >= 0) {
                refCount.informe++;
            } else {
                refCount.upstream++;
            }
        } catch (e) {
            failCount++;
            errors.push(`${file.name}: ${e.message}`);
        }
    }

    // Notificar archivos ignorados por filtro de contexto (no es error, solo info)
    if (skippedCount > 0) {
        const tiposIgnorados = [...new Set(skipped.map(s => s.type))].join(', ');
        showNotification(
            `${skippedCount} archivo(s) ignorado(s) — tipos no relevantes para captura de evidencia: ${tiposIgnorados}. ` +
            `Solo URS/RA/IRA/PIQ/POQ/PPQ generan trazabilidad. Para incluirlos en el Libro de Validación, cargá la Demo completa.`,
            'info'
        );
        skipped.forEach(s => console.info(`[loadPackage] ignorado: ${s.fileName} (type=${s.type})`));
    }

    renderPackagePanel();

    // PASO 2 — Si hay sesión gestor entre los archivos, RESTAURAR
    if (sessionCandidates.length > 0) {
        if (sessionCandidates.length > 1) {
            showNotification('Múltiples sesiones detectadas. Solo se restaurará la primera: ' + sessionCandidates[0].fileName, 'warning');
        }
        await restoreSessionData(sessionCandidates[0].data);
        showNotification(`✓ Sesión restaurada desde ${sessionCandidates[0].fileName}` + (okCount > 1 ? ` (${okCount - 1} doc(s) adicionales al paquete)` : ''));
        return;
    }

    // PASO 3 — Si hay candidatos a protocolo, decidir activación
    if (protocolCandidates.length > 0) {
        // Orden estable: PIQ < POQ < PPQ (fase del ciclo de validación)
        const phaseOrder = { PIQ: 1, POQ: 2, PPQ: 3 };
        protocolCandidates.sort((a, b) => (phaseOrder[a.data.type] || 99) - (phaseOrder[b.data.type] || 99));

        const elegido = protocolCandidates[0];
        const elegidoCode = elegido.data.document?.code || '';

        // ¿Hay runtime activo distinto del que vamos a activar?
        const hasActiveWork = tests.length > 0 || protocols.length > 0;
        const sameAsActive = protocols.some(p => p.code === elegidoCode);

        if (hasActiveWork && !sameAsActive) {
            // Auto-merge si el nuevo protocolo pertenece al mismo paquete que el runtime activo
            const elegidoPkgCode = elegido.data.package && elegido.data.package.code;
            const samePkg = elegidoPkgCode && systemInfo.codigoSistema && elegidoPkgCode === systemInfo.codigoSistema;
            const newTypeAlreadyActive = protocols.some(p => p.type === elegido.data.type);

            if (samePkg && !newTypeAlreadyActive) {
                // Mismo paquete, fase diferente (ej. POQ mientras PIQ está activo) → merge sin preguntar
                await importProtocolJSON(elegido.data, { merge: true, skipConfirm: true });
                let mergedExtra = 0;
                if (protocolCandidates.length > 1) {
                    for (const extra of protocolCandidates.slice(1)) {
                        const pkg = extra.data.package && extra.data.package.code;
                        if (!elegidoPkgCode || pkg === elegidoPkgCode) {
                            try {
                                await importProtocolJSON(extra.data, { merge: true, skipConfirm: true });
                                mergedExtra++;
                            } catch (e) {
                                console.warn('[loadPackage] merge falló para', extra.data.document?.code, e);
                            }
                        }
                    }
                }
                await saveToStorage();
                const activeCodes = protocols.map(p => p.code).join(', ');
                showNotification(`Protocolo ${elegidoCode} agregado al suite. Protocolos activos: ${activeCodes}.`);
                return;
            }

            const totalEv = tests.reduce((s, t) => s + (Array.isArray(t.evidences) ? t.evidences.filter(e => !e.isEmpty).length : 0), 0);
            const proceed = await drpConfirm(
                `Hay un runtime activo con ${tests.length} test(s)` + (totalEv > 0 ? ` y ${totalEv} evidencia(s) capturada(s)` : '') + `. ¿Sobrescribir con ${elegidoCode}?\n\nSi cancelás, ${elegidoCode} se agrega al paquete sin tocar el runtime actual.`,
                'Activar protocolo nuevo?', 'warning'
            );
            if (!proceed) {
                await saveToStorage();
                const extras = protocolCandidates.length > 1 ? ` (+ ${protocolCandidates.length - 1} protocolo(s) más en paquete)` : '';
                showNotification(`Paquete actualizado. Runtime preservado. ${elegidoCode}${extras} agregado al paquete sin activar.`);
                return;
            }
        }

        // Activar el primer protocolo (replace si había runtime previo)
        await importProtocolJSON(elegido.data, { skipConfirm: true });

        // Si hay protocolos adicionales del MISMO paquete, agregarlos en paralelo (merge).
        // Definimos "mismo paquete" por package.code coincidente.
        let mergedCount = 0;
        const elegidoPkg = elegido.data.package && elegido.data.package.code;
        if (protocolCandidates.length > 1) {
            const extrasMismoPaquete = protocolCandidates.slice(1).filter(c => {
                const pkg = c.data.package && c.data.package.code;
                return elegidoPkg ? pkg === elegidoPkg : true;
            });
            for (const extra of extrasMismoPaquete) {
                try {
                    await importProtocolJSON(extra.data, { merge: true, skipConfirm: true });
                    mergedCount++;
                } catch (e) {
                    console.warn('[loadPackage] merge falló para', extra.data.document?.code, e);
                }
            }
        }

        const extraNoMerged = protocolCandidates.length - 1 - mergedCount;
        const sumario = [
            `Paquete cargado: ${okCount} doc(s)`,
            mergedCount > 0
                ? `${1 + mergedCount} protocolo(s) activos: ${protocols.map(p => p.code).join(', ')}`
                : `Protocolo activo: ${elegidoCode}`,
            (extraNoMerged > 0 ? `+ ${extraNoMerged} protocolo(s) de otro paquete en paquete sin activar` : null),
            (refCount.informe > 0 ? `${refCount.informe} informe(s) para trazabilidad` : null)
        ].filter(Boolean).join(' · ');
        showNotification(sumario);
        return;
    }

    // PASO 4 — Solo refs cargadas (sin protocolos, sin sesiones)
    await saveToStorage();

    const partes = [];
    if (refCount.upstream > 0) partes.push(`${refCount.upstream} doc(s) upstream`);
    if (refCount.informe > 0) partes.push(`${refCount.informe} informe(s)`);
    if (refCount.otros > 0) partes.push(`${refCount.otros} otro(s)`);

    if (partes.length > 0) {
        showNotification(`Paquete documental cargado: ${partes.join(' + ')}. Modo referencia (sin protocolo activo).`);
    } else if (failCount === 0) {
        showNotification(`Paquete: ${okCount} doc(s) cargado(s).`);
    }

    if (failCount > 0) {
        showNotification(`${failCount} archivo(s) con error. Ver consola.`, 'warning');
        errors.forEach(e => console.warn('[loadPackage]', e));
    }
}

/**
 * Restaura una sesión gestor desde data parseada (no archivo). Reutiliza
 * la lógica de importSessionJSON pero sobre data ya parsed.
 */
async function restoreSessionData(data) {
    if (!data || !data.tests) return;

    systemInfo = data.systemInfo || systemInfo;
    executor = data.executor || executor;
    protocols = data.protocols || [];
    groups = data.groups || [];
    tests = data.tests || [];
    projectData = data.projectData || { finalized: false, conclusion: '', resultado: '' };

    // Restaurar packageDocs de la sesión (si trae)
    if (Array.isArray(data.packageDocs)) {
        // No reseteamos packageDocs porque puede haber docs cargados en
        // este mismo batch que queremos preservar. Solo agregamos los que
        // no estén ya.
        data.packageDocs.forEach(d => {
            if (!packageDocs.find(x => x.code === d.code)) {
                packageDocs.push(d);
            }
        });
    }

    // UI sync — usa helper que tolera campos opcionales del sys-panel
    activeProtocolId = null;
    activeTestId = null;
    const setSysVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setSysVal('empresa', systemInfo.empresa);
    setSysVal('cliente', systemInfo.cliente);
    setSysVal('nombreSistema', systemInfo.nombreSistema);
    setSysVal('codigoSistema', systemInfo.codigoSistema);
    setSysVal('versionSistema', systemInfo.versionSistema);
    setSysVal('categoriaGamp', systemInfo.categoriaGamp);
    setSysVal('tipoSistema', systemInfo.tipoSistema);
    setSysVal('proveedor', systemInfo.proveedor);
    setSysVal('revisor', systemInfo.revisor);
    setSysVal('aprobador', systemInfo.aprobador);
    setSysVal('auditor', systemInfo.auditor);
    setSysVal('fechaInicio', systemInfo.fechaInicio);
    setSysVal('fechaCierre', systemInfo.fechaCierre);
    setSysVal('notasProyecto', systemInfo.notasProyecto);
    setSysVal('ejecutor', executor);

    await saveToStorage();
    renderTests();
    renderWorkArea();
    renderPackagePanel();
}

/**
 * Renderiza el panel "Paquete del Sistema" en el sidebar. Lista cada doc
 * con type, code, version e items derivables. Cada entrada tiene botón
 * para removerla individualmente.
 */
function renderPackagePanel() {
    // Conmuta visibilidad de las opciones del menú Libro (Tomos I/II/III)
    // según haya o no paquete cargado. Definida en book-preview.js.
    if (typeof updateBookMenuVisibility === 'function') updateBookMenuVisibility();

    const panel = document.getElementById('packagePanel');
    const list = document.getElementById('packageList');
    if (!panel || !list) return;

    if (packageDocs.length === 0) {
        panel.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    panel.style.display = 'block';

    // Ordenar por tipo según jerarquía estándar (URS upstream → IIQ/IOQ downstream)
    const ORDER = ['HLRA', 'VP', 'URS', 'FRS', 'DS', 'RA', 'IRA', 'RRM', 'MTR', 'PIQ', 'IIQ', 'POQ', 'IOQ', 'PPQ', 'IPQ', 'NOTIF'];
    const sorted = packageDocs.slice().sort((a, b) => {
        const ai = ORDER.indexOf(a.type); const bi = ORDER.indexOf(b.type);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    const COLOR_BY_TYPE = {
        HLRA: '#5a5a5a', VP: '#5a5a5a', URS: '#1F3C56', FRS: '#1F3C56', DS: '#1F3C56',
        RA: '#B85F0F', IRA: '#B85F0F', RRM: '#B85F0F', MTR: '#7B1F1F',
        PIQ: '#1E7E34', IIQ: '#1E7E34', POQ: '#3F6688', IOQ: '#3F6688',
        PPQ: '#7B1F1F', IPQ: '#7B1F1F', NOTIF: '#A52A2A'
    };

    list.innerHTML = sorted.map(d => {
        const c = COLOR_BY_TYPE[d.type] || '#5a5a5a';
        const refsLine = d.derivedRefs
            ? [
                (d.derivedRefs.URS || []).length > 0 ? `${(d.derivedRefs.URS).length} URS` : '',
                (d.derivedRefs.RA || []).length > 0 ? `${(d.derivedRefs.RA).length} RA` : '',
                (d.derivedRefs.IRA || []).length > 0 ? `${(d.derivedRefs.IRA).length} IRA` : ''
              ].filter(Boolean).join(' · ')
            : '';
        const versionTag = d.version ? ` v${d.version}` : '';
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:5px 0; border-bottom:1px solid #f0f0f0; gap:6px;">
                <div style="flex:1; min-width:0; overflow:hidden;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="display:inline-block; background:${c}; color:#fff; font-size:9px; font-weight:700; padding:2px 5px; border-radius:3px; letter-spacing:0.4px;">${escapeHtml(d.type)}</span>
                        <span style="font-weight:600; color:#1F3C56; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(d.code || '—')}${escapeHtml(versionTag)}</span>
                    </div>
                    ${refsLine ? `<div style="font-size:10px; color:#5a5a5a; font-style:italic; margin-top:2px;">${refsLine}</div>` : ''}
                </div>
                <div style="display:flex; gap:2px; flex-shrink:0;">
                    ${d.type !== 'PEOPLE' ? `<button onclick="openProjectDocEditor('${d.code.replace(/'/g, "\\'")}')" title="Editar este doc en la Suite Validación" style="background:none; border:none; color:#1E7E34; font-size:13px; cursor:pointer; padding:2px 5px; line-height:1; border-radius:3px;" onmouseover="this.style.background='#E8F5E9'" onmouseout="this.style.background='none'">✏️</button>` : ''}
                    <button onclick="removePackageDocAndRefresh('${d.code.replace(/'/g, "\\'")}')" title="Remover este doc del paquete" style="background:none; border:none; color:#999; font-size:14px; cursor:pointer; padding:0 4px; line-height:1; border-radius:3px;" onmouseover="this.style.background='#FDECEA'; this.style.color='#A52A2A'" onmouseout="this.style.background='none'; this.style.color='#999'">×</button>
                </div>
            </div>
        `;
    }).join('');
}

// ── Dossier en Vivo ──────────────────────────────────────────────────────────

const TOMOS_CONFIG = [
    { num: 'I',   title: 'Planificación y Requisitos', color: '#1F3C56',
      docs: ['HLRA','VP','URS','FRS','DS'] },
    { num: 'II',  title: 'Análisis de Riesgos',        color: '#B85F0F',
      docs: ['RA','IRA','RRM','MTR'] },
    { num: 'III', title: 'Calificación IQ',            color: '#1E7E34',
      docs: ['PIQ','IIQ','RIQ'] },
    { num: 'IV',  title: 'Calificación OQ',            color: '#3F6688',
      docs: ['POQ','IOQ','ROQ'] },
    { num: 'V',   title: 'Calificación PQ',            color: '#7B1F1F',
      docs: ['PPQ','IPQ','RPQ'] },
    { num: 'VI',  title: 'Cierre y Sumario',           color: '#5a2d82',
      docs: ['NCR','VSR'] },
];

const DOC_LABELS = {
    HLRA:'High Level Risk Assessment', VP:'Plan de Validación',
    URS:'User Requirements Spec.', FRS:'Functional Requirements Spec.',
    DS:'Design Specification', RA:'Risk Analysis (FMEA)',
    IRA:'Impact & Risk Analysis', RRM:'Risk Reduction Measures',
    MTR:'Master Test Report', PIQ:'Protocolo IQ', IIQ:'Informe IQ',
    RIQ:'Reporte / Decisión IQ', POQ:'Protocolo OQ', IOQ:'Informe OQ',
    ROQ:'Reporte / Decisión OQ', PPQ:'Protocolo PQ', IPQ:'Informe PQ',
    RPQ:'Reporte / Decisión PQ', NCR:'Non-Conformance Report',
    VSR:'Validation Summary Report',
};

const DOSSIER_STATUS_CFG = {
    pendiente:   { label:'Pendiente',   bg:'#f5f5f5', border:'#ddd',    color:'#999',    dot:'○' },
    local:       { label:'Local',       bg:'#E3F2FD', border:'#90CAF9', color:'#1565C0', dot:'◉' },
    publicado:   { label:'Borrador',    bg:'#FFF8E1', border:'#FFE082', color:'#F57F17', dot:'◎' },
    en_revision: { label:'En revisión', bg:'#FFF3E0', border:'#FFCC80', color:'#E65100', dot:'◑' },
    aprobado:    { label:'Aprobado',    bg:'#E8F5E9', border:'#A5D6A7', color:'#1E7E34', dot:'●' },
};

let _serverDocs       = {};   // { 'URS': { status, version, updated_at }, … }
let _dossierTimer     = null;
let _lastDossierFetch = 0;

function _getDossierStatus(type) {
    const local  = packageDocs.find(d => d.type === type);
    const server = _serverDocs[type];
    if (!local && !server) return 'pendiente';
    if (local && !server)  return 'local';
    const s = server.status;
    if (s === 'approved')                   return 'aprobado';
    if (s === 'for_review' || s === 'reviewed') return 'en_revision';
    return 'publicado';  // draft
}

function renderDossierView() {
    const el = document.getElementById('dossierTomos');
    if (!el) return;

    const projId = localStorage.getItem('vscActiveProjectId') || '';
    const isDemo = projId === '__demo_drp_sis_001__';
    const fetchedAt = _lastDossierFetch
        ? new Date(_lastDossierFetch).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'})
        : '—';

    let totalAll = 0, nAprobado = 0, nRevision = 0, nLocal = 0, nPendiente = 0;

    const tomoBlocks = TOMOS_CONFIG.map(tomo => {
        let tomoDone = 0;
        const cells = tomo.docs.map(type => {
            const st  = _getDossierStatus(type);
            const cfg = DOSSIER_STATUS_CFG[st];
            totalAll++;
            if (st === 'aprobado')    { nAprobado++;  tomoDone++; }
            else if (st === 'en_revision') nRevision++;
            else if (st === 'local')  nLocal++;
            else                      nPendiente++;
            const server = _serverDocs[type];
            const verTag = server ? ` v${server.version || 1}` : '';
            return `<div title="${DOC_LABELS[type] || type}${verTag}" style="
                background:${cfg.bg}; border:1px solid ${cfg.border};
                border-radius:6px; padding:8px 10px;
                display:flex; flex-direction:column; gap:3px; min-width:0;">
              <div style="display:flex; align-items:center; gap:5px;">
                <span style="color:${cfg.color}; font-size:16px; line-height:1;">${cfg.dot}</span>
                <span style="font-weight:700; font-size:11px; color:${cfg.color}; letter-spacing:0.5px;">${type}</span>
                ${verTag ? `<span style="font-size:9px; color:#aaa; margin-left:auto;">${verTag}</span>` : ''}
              </div>
              <div style="font-size:10px; color:#555; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${DOC_LABELS[type] || ''}</div>
              <div style="font-size:9px; font-weight:700; color:${cfg.color}; text-transform:uppercase; letter-spacing:0.6px;">${cfg.label}</div>
            </div>`;
        }).join('');

        const pct = Math.round(tomoDone / tomo.docs.length * 100);
        const pctColor = pct === 100 ? '#1E7E34' : tomo.color;

        return `<div style="margin-bottom:22px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
            <div style="background:${tomo.color}; color:#fff; font-size:10px; font-weight:800;
              padding:3px 10px; border-radius:4px; letter-spacing:0.5px; white-space:nowrap;">
              TOMO ${tomo.num}
            </div>
            <span style="font-weight:600; font-size:13px; color:#1F3C56;">${tomo.title}</span>
            <span style="margin-left:auto; font-size:11px; color:${pctColor}; font-weight:600; white-space:nowrap;">
              ${tomoDone}/${tomo.docs.length} aprobados
            </span>
            <div style="width:80px; height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden; flex-shrink:0;">
              <div style="width:${pct}%; height:100%; background:${pctColor}; border-radius:3px; transition:width 0.5s;"></div>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:6px;">${cells}</div>
        </div>`;
    }).join('');

    const mkBadge = (dot, n, color, lbl) =>
        `<div style="display:flex; align-items:center; gap:4px;">
           <span style="color:${color}; font-size:16px;">${dot}</span>
           <strong style="color:${color};">${n}</strong>
           <span style="color:#666; font-size:11px;">${lbl}</span>
         </div>`;

    const summary = `
      <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;
        padding:10px 16px; background:#f8f9fb; border-radius:8px; border:1px solid #e0e0e0; margin-bottom:20px;">
        <span style="font-weight:700; color:#1F3C56;">Progreso del dossier</span>
        ${mkBadge('●', nAprobado,  '#1E7E34', 'Aprobados')}
        ${mkBadge('◑', nRevision,  '#E65100', 'En revisión')}
        ${mkBadge('◉', nLocal,     '#1565C0', 'Solo local')}
        ${mkBadge('○', nPendiente, '#999',    'Pendientes')}
        <span style="margin-left:auto; font-size:10px; color:#aaa;">
          ${isDemo ? 'modo demo' : `actualizado ${fetchedAt}`}
          ${!isDemo ? `<button onclick="refreshServerDocStatus()" style="margin-left:8px;
            background:none; border:none; color:#1565C0; cursor:pointer; font-size:11px; padding:0 2px;
            text-decoration:underline;">↻ actualizar</button>` : ''}
        </span>
      </div>`;

    el.innerHTML = summary + tomoBlocks;
}

async function refreshServerDocStatus() {
    const projId = localStorage.getItem('vscActiveProjectId');
    if (!projId || projId === '__demo_drp_sis_001__') {
        renderDossierView();
        return;
    }
    try {
        const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/documents`);
        if (!r.ok) return;
        const json = await r.json();
        if (json.ok && Array.isArray(json.documents)) {
            _serverDocs = {};
            json.documents.forEach(d => {
                _serverDocs[d.doc_type] = { status: d.status, version: d.version, updated_at: d.updated_at };
            });
            _lastDossierFetch = Date.now();
            renderDossierView();
        }
    } catch (_) { /* offline / no auth — silent */ }
}

function openDossierPanel() {
    const m = document.getElementById('modalDossier');
    if (!m) return;
    m.style.display = 'flex';
    renderDossierView();
    if (!_dossierTimer) _dossierTimer = setInterval(refreshServerDocStatus, 60000);
    if (Date.now() - _lastDossierFetch > 30000) refreshServerDocStatus();
}

function closeDossierPanel() {
    const m = document.getElementById('modalDossier');
    if (m) m.style.display = 'none';
    clearInterval(_dossierTimer);
    _dossierTimer = null;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Wrapper para remover desde el botón del sidebar y refrescar UI. */
async function removePackageDocAndRefresh(code) {
    // Capturar el tipo antes de remover (para limpiar Suite Evidencias después)
    const removedDoc = getPackageDoc(code);
    const removedType = removedDoc ? (removedDoc.type || '').toUpperCase() : null;

    if (!removePackageDoc(code)) return;
    renderPackagePanel();
    if (typeof vsOnPackageDocRemoved === 'function') vsOnPackageDocRemoved(code);

    // Limpiar protocolos huérfanos en Suite Evidencias: mismo tipo y sin grupos asignados
    if (removedType && Array.isArray(protocols)) {
        const orphans = protocols.filter(p =>
            (p.type || '').toUpperCase() === removedType &&
            !groups.some(g => g.protocolId === p.id)
        );
        if (orphans.length) {
            orphans.forEach(p => {
                protocols.splice(protocols.indexOf(p), 1);
            });
            if (typeof renderTests === 'function') renderTests();
        }
    }

    await saveToStorage();
}

window.loadPackageFiles = loadPackageFiles;
window.renderPackagePanel = renderPackagePanel;
window.removePackageDocAndRefresh = removePackageDocAndRefresh;

/* ====================================================================
   AEX BUILDER (Fase C) — construye el JSON AEX desde el state del gestor
   y lo dispara contra el renderer del suite (ValidationSuite.renderDocument).

   Mapping conceptual:
   - systemInfo + protocols[]  → package + document.code + extras
   - tests[] + evidences[]     → sección "aex-registro-tc"
   - packageDocs (URS/RA/IRA)  → enriquecer trazabilidad cruzada
   - matrizAprobaciones        → desde protocols/projectData o defaults
   - Validations: usar VS.tracer para resolver trazabilidad por TC

   El AEX resultante es un JSON v2.0 (con trazabilidad cross-doc) listo
   para VS.renderDocument().
   ==================================================================== */

/**
 * Resolver el resultado de la captura: el campo `resultado` per-evidencia
 * existe en el gestor (PASS/PASA/FAIL/NO PASA/OBS/PASA CON OBSERVACIONES/NA).
 * Normalizar a las etiquetas del AEX.
 */
function normalizeDictamen(estado) {
    const e = String(estado || '').toUpperCase().trim();
    if (e === 'PASS' || e === 'PASA') return 'PASS';
    if (e === 'FAIL' || e === 'NO PASA' || e === 'NOK') return 'FAIL';
    if (e === 'OBS' || e === 'PASS_OBS' || e === 'PASA CON OBSERVACIONES') return 'OBS';
    if (e === 'NA' || e === 'N/A' || e === 'NO APLICA') return 'NA';
    return estado || '';
}

/**
 * Construye el objeto AEX (schema v1.0 con trazabilidad v2.0) desde el
 * estado actual del gestor. Toma:
 *   - protocols[], groups[], tests[]: estructura del runtime
 *   - tests[i].evidences[]: imágenes + metadata por TC
 *   - packageDocs[]: docs del paquete para trazabilidad cross-doc (opcional)
 *   - systemInfo, executor, projectData: contexto general
 *
 * Devuelve un objeto compatible con VS.renderDocument({type: 'AEX'}).
 */
function buildAexFromGestor() {
    const VS = window.ValidationSuite;
    const ahora = new Date();
    const fechaCorta = ahora.toISOString().split('T')[0]; // YYYY-MM-DD
    const fechaLarga = ahora.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const sysCode = (systemInfo.codigoSistema || 'SIS-001').toUpperCase();
    const aexCode = 'AEX-' + sysCode;

    // === Protocolo origen (si hay) — toma el activo o el primero ===
    const protocolRef = protocols.find(p => p.id === activeProtocolId) || protocols[0] || null;
    const protocolCode = protocolRef ? protocolRef.code : '';
    const protocolType = protocolRef ? protocolRef.type : '';
    const protocolVersion = protocolRef && protocolRef.protocolMeta ? protocolRef.protocolMeta.version : '';

    // === Contar evidencias e identificar TCs con captura ===
    const testsConEvidencia = tests.filter(t => Array.isArray(t.evidences) && t.evidences.some(ev => !ev.isEmpty));
    const totalEvidencias = tests.reduce((sum, t) => sum + (Array.isArray(t.evidences) ? t.evidences.filter(ev => !ev.isEmpty).length : 0), 0);

    // Stats por estado del TC
    const stats = { PASS: 0, FAIL: 0, OBS: 0, NA: 0, pendiente: 0 };
    testsConEvidencia.forEach(t => {
        const e = normalizeDictamen(t.resultado);
        if (e === 'PASS' || e === 'FAIL' || e === 'OBS' || e === 'NA') stats[e]++;
        else stats.pendiente++;
    });

    // === Helper: trazabilidad del TC vía VS.tracer + packageDocs ===
    function getTcTrazabilidad(test) {
        const g = test.protocolGuidance || {};
        const out = {
            urs: Array.isArray(g.ursVinculados) ? g.ursVinculados.filter(Boolean) : [],
            ra: g.raVinculado || '',
            ira: g.componente || '',
            componente: g.componenteDesc || ''
        };
        // Si hay packageDocs cargado, enriquecer con datos formales via tracer
        if (VS && VS.tracer && Array.isArray(packageDocs) && packageDocs.length > 0 && test.tcId) {
            try {
                const trace = VS.tracer.traceFromTcId(test.tcId, packageDocs);
                if (trace && trace.found) {
                    // Si el tracer encontró URS items enriquecidos, no los duplicamos en out
                    // (la traz queda como lista de IDs, el panel pdf-side podría enriquecer
                    // si se le pasa info — pero acá mantenemos solo IDs para el bloque inline).
                    if (!out.componente && trace.upstream.ira[0] && trace.upstream.ira[0].componente) {
                        out.componente = trace.upstream.ira[0].componente;
                    }
                }
            } catch (e) { /* silencioso */ }
        }
        return out;
    }

    // === Construir el array de tests para sección aex-registro-tc ===
    const aexTests = testsConEvidencia.map(t => {
        const g = t.protocolGuidance || {};
        const evidencias = (t.evidences || []).filter(ev => !ev.isEmpty).map(ev => ({
            step: ev.step,
            descripcion: ev.description || ev.title || '',
            image: ev.image,
            usuarioPrueba: ev.usuarioPrueba || '',
            rolPrueba: ev.rolPrueba || '',
            operacion: ev.operacion || '',
            criterioRef: ev.criterioRef || '',
            testCaseRef: ev.testCaseRef || t.tcId || '',
            timestamp: ev.captureTimestamp || ev.timestamp || '',
            captureTimestamp: ev.captureTimestamp || '',
            ejecutor: ev.executor || executor || '',
            dictamen: normalizeDictamen(ev.resultado),
            observacion: ev.observacion || ev.observaciones || '',
            originalFileName: (ev.exif && ev.exif.originalFileName) || ev.originalFileName || '',
            relativePath: (ev.exif && ev.exif.relativePath) || ev.relativePath || '',
            dimensions: ev.dimensions || ((ev.exif && ev.exif.dimensions) ? ev.exif.dimensions : null),
            cameraMake: (ev.exif && ev.exif.cameraMake) || ev.cameraMake || null,
            cameraModel: (ev.exif && ev.exif.cameraModel) || ev.cameraModel || null,
            size: ev.size || ((ev.exif && ev.exif.size) ? ev.exif.size : null),
            hash: ev.hash || null
        }));

        return {
            tcId: t.tcId || ('TEST-' + t.id.substring(0, 8)),
            titulo: t.name || '',
            grupo: ((groups.find(gr => gr.id === t.groupId) || {}).name) || g.grupo || '',
            tipoTC: g.tipoTC || '',
            trazabilidad: getTcTrazabilidad(t),
            procedimientoResumen: g.objetivo || '',
            procedimiento: Array.isArray(g.procedimiento) ? g.procedimiento : [],
            criterioAceptacion: g.criterioAceptacion || (Array.isArray(g.criterios) ? g.criterios.join('. ') : ''),
            resultado: {
                estado: normalizeDictamen(t.resultado),
                ejecutor: executor || '',
                fecha: t.finalizedDate ? new Date(t.finalizedDate).toLocaleDateString('es-AR') : '',
                firma: '',
                criterioObservado: t.conclusion || ''
            },
            evidencias: evidencias
        };
    });

    // === Matriz de trazabilidad ejecutada (URS → TCs → evidencias) ===
    const ursMap = {};
    aexTests.forEach(test => {
        (test.trazabilidad.urs || []).forEach(u => {
            if (!u || u === '—') return;
            if (!ursMap[u]) ursMap[u] = { urs: u, titulo: '', tcs: new Set(), evidencias: 0, estados: [] };
            ursMap[u].tcs.add(test.tcId);
            ursMap[u].evidencias += (test.evidencias || []).length;
            if (test.resultado.estado) ursMap[u].estados.push(test.resultado.estado);
        });
    });
    const matrizFilas = Object.values(ursMap).map(m => {
        // Estado consolidado: si alguno FAIL → FAIL; sino PASS si todos PASS; sino el primer estado
        let estadoConsol = '';
        if (m.estados.length > 0) {
            if (m.estados.some(e => e === 'FAIL')) estadoConsol = 'FAIL';
            else if (m.estados.every(e => e === 'PASS')) estadoConsol = 'PASS';
            else if (m.estados.some(e => e === 'OBS')) estadoConsol = 'OBS';
            else estadoConsol = m.estados[0];
        }
        // Enriquecer título URS si packageDocs tiene URS doc
        let urstxt = '';
        if (VS && VS.tracer && Array.isArray(packageDocs)) {
            try {
                const utrace = VS.tracer.traceFromUrsId(m.urs, packageDocs);
                if (utrace && utrace.urs && utrace.urs.descripcion) {
                    urstxt = utrace.urs.descripcion.slice(0, 100);
                }
            } catch (e) { /* silencioso */ }
        }
        return { urs: m.urs, titulo: urstxt, tcs: Array.from(m.tcs), evidencias: m.evidencias, estado: estadoConsol };
    });

    // === trazabilidad v2.0: recibeDe (protocolo + URS) y alimentaA ===
    const trazRecibeDe = [];
    if (protocolRef && protocolType) {
        trazRecibeDe.push({
            tipo: protocolType,
            code: protocolCode,
            version: protocolVersion,
            fechaCongelado: '',
            items: aexTests.map(t => t.tcId),
            itemsCount: aexTests.length,
            estado: 'aprobado',
            _auto: true
        });
    }
    // URS derivados desde TCs
    const ursSet = new Set();
    aexTests.forEach(t => (t.trazabilidad.urs || []).forEach(u => { if (u && u !== '—') ursSet.add(u); }));
    if (ursSet.size > 0) {
        const ursDoc = (packageDocs || []).find(d => d.type === 'URS');
        trazRecibeDe.push({
            tipo: 'URS',
            code: ursDoc ? ursDoc.code : ('URS-' + sysCode),
            version: ursDoc ? ursDoc.version : '',
            fechaCongelado: '',
            items: Array.from(ursSet).sort(),
            itemsCount: ursSet.size,
            estado: 'aprobado',
            _auto: true
        });
    }

    // === Estructurar el JSON AEX ===
    const informeType = protocolType ? ('I' + protocolType.charAt(1) + 'Q') : 'IIQ'; // PIQ→IIQ, POQ→IOQ, PPQ→IPQ
    return {
        schemaVersion: '1.0',
        type: 'AEX',
        package: {
            code: sysCode,
            systemName: systemInfo.nombreSistema || sysCode,
            systemVersion: '',
            systemSubtitle: '',
            client: systemInfo.empresa || 'EMPRESA',
            qmsLabel: 'Sistema de Gestión de Calidad GxP',
            year: ahora.getFullYear()
        },
        document: {
            code: aexCode,
            titleEs: 'ANEXO DE EJECUCIÓN — REGISTRO INTEGRADO DE EVIDENCIAS',
            titleEn: 'EXECUTION ANNEX — INTEGRATED EVIDENCE RECORD',
            headerTitle: 'Anexo de Ejecución (AEX)',
            version: '1.0',
            issueDate: fechaLarga,
            status: projectData.finalized ? 'Aprobado' : 'Borrador',
            processOwner: executor || '',
            gampCategory: '',
            normativeFramework: 'ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | FDA CSA 2022',
            extras: {
                'Protocolo origen': protocolCode + (protocolVersion ? ' v' + protocolVersion : ''),
                'Tipo de Protocolo': protocolType || '—',
                'Informe asociado': protocolCode ? protocolCode.replace(/^P/, 'I') : '—',
                'Tests con evidencia': testsConEvidencia.length + ' / ' + tests.length,
                'Evidencias totales': String(totalEvidencias),
                'Resultado global': stats.PASS + ' PASS / ' + stats.FAIL + ' FAIL / ' + stats.OBS + ' OBS' + (stats.NA ? ' / ' + stats.NA + ' NA' : '') + (stats.pendiente ? ' / ' + stats.pendiente + ' pendiente(s)' : '')
            }
        },
        controlCambios: [
            {
                version: '1.0',
                fecha: fechaCorta,
                autor: executor || 'Process Owner',
                descripcion: 'Emisión inicial — registro de evidencia capturada vía Gestor de Evidencias.'
            }
        ],
        matrizAprobaciones: [
            { rol: 'Ejecutor (Validador)', nombre: executor || '', iniciales: '', fecha: fechaCorta },
            { rol: 'Revisor (Process Owner)', nombre: systemInfo.revisor || '', iniciales: '', fecha: '' },
            { rol: 'Aprobador (Gerente QA)', nombre: systemInfo.aprobador || '', iniciales: '', fecha: '' }
        ],
        trazabilidad: {
            schemaVersion: '2.0',
            recibeDe: trazRecibeDe,
            alimentaA: [
                { tipo: informeType, codeEsperado: protocolCode ? protocolCode.replace(/^P/, 'I') : '—', relacion: 'integra-evidencia-al-informe' }
            ]
        },
        secciones: [
            {
                tipo: 'texto',
                titulo: 'PROPÓSITO Y OBJETIVO',
                bloques: [
                    { texto: 'El presente Anexo de Ejecución (AEX) documenta de manera formal la evidencia capturada durante la ejecución del ' + (protocolCode || 'protocolo activo') + ' sobre el sistema ' + (systemInfo.nombreSistema || sysCode) + '. Cada captura está asociada a un Test Case específico con su trazabilidad cruzada al requisito URS de origen, riesgo RA evaluado y componente IRA validado.' },
                    { texto: 'Este registro forma parte del paquete documental de validación y constituye evidencia auditable conforme 21 CFR Part 11 §11.10(b) — registros electrónicos completos, exactos y recuperables. El gestor de evidencias actúa como almacén de la documentación de Test Cases; la generación del documento formal se realiza desde la Validation Suite.' }
                ]
            },
            {
                tipo: 'tabla-info',
                titulo: 'RESUMEN DE EJECUCIÓN',
                labelWidth: 165,
                filas: [
                    { campo: 'Protocolo ejecutado', valor: protocolCode + (protocolVersion ? ' v' + protocolVersion : ''), boldValor: true, colorValor: 'primary' },
                    { campo: 'Fecha de generación', valor: fechaLarga },
                    { campo: 'Ejecutor', valor: executor || '—' },
                    { campo: 'Tests con evidencia capturada', valor: testsConEvidencia.length + ' de ' + tests.length, boldValor: true, colorValor: 'accent' },
                    { campo: 'Evidencias totales', valor: String(totalEvidencias) + ' captura(s)' },
                    { campo: 'Resultado global', valor: stats.PASS + ' PASS / ' + stats.FAIL + ' FAIL / ' + stats.OBS + ' OBS' + (stats.NA ? ' / ' + stats.NA + ' NA' : ''), boldValor: true }
                ]
            },
            {
                tipo: 'aex-registro-tc',
                titulo: 'DETALLE DE EJECUCIÓN POR TEST CASE',
                intro: 'Cada Test Case se documenta con su trazabilidad al requisito origen, procedimiento ejecutado, resultado y evidencia capturada. Las evidencias se presentan en páginas separadas con metadata completa y la imagen a tamaño completo.',
                agruparPorGrupo: true,
                tests: aexTests
            },
            {
                tipo: 'aex-matriz-trazabilidad',
                titulo: 'MATRIZ DE TRAZABILIDAD EJECUTADA',
                intro: 'Cobertura URS · TC · evidencia capturada en esta ejecución. La columna "Descripción" se enriquece automáticamente si el URS doc está cargado en el paquete documental.',
                filas: matrizFilas
            },
            {
                tipo: 'caja-conclusion',
                titulo: 'CONCLUSIÓN Y DECISIÓN FORMAL',
                parrafos: [
                    testsConEvidencia.length === 0
                        ? (tests.length > 0
                            ? 'Hay ' + tests.length + ' Test Cases registrados sin fotos adjuntas. Use "📸 Cargar fotos reales (JSON)" en el menú principal para importar las evidencias del protocolo y generar el AEX completo.'
                            : 'No se ha capturado evidencia documentada en esta sesión. Este anexo se emite vacío como registro estructural.')
                        : ('Los ' + testsConEvidencia.length + ' Test Cases ejecutados con evidencia documentada arrojan: ' + stats.PASS + ' PASS, ' + stats.FAIL + ' FAIL, ' + stats.OBS + ' OBS' + (stats.NA ? ', ' + stats.NA + ' NA' : '') + '. Total de ' + totalEvidencias + ' evidencias capturadas formalmente.'),
                    'La evidencia capturada cumple los requisitos de integridad y trazabilidad establecidos en 21 CFR Part 11 §11.10(b) y EU Annex 11 §9. Cada captura está vinculada a su Test Case origen, su requisito URS y su componente IRA correspondiente (cuando aplica).',
                    stats.FAIL > 0
                        ? 'DECISIÓN: APROBADO CON OBSERVACIONES — existen TCs con resultado FAIL que requieren no conformidad documentada y CAPA antes del cierre formal.'
                        : ((stats.OBS > 0)
                            ? 'DECISIÓN: APROBADO CON OBSERVACIONES — TCs con observaciones documentadas pero sin bloqueo.'
                            : 'DECISIÓN: APROBADO. La evidencia documentada en este Anexo de Ejecución se integra al informe ' + (informeType) + ' como soporte formal de los Test Cases ejecutados.')
                ]
            },
            {
                tipo: 'tabla-firmas-final',
                titulo: 'FIRMAS DE EJECUCIÓN Y APROBACIÓN',
                intro: 'Las firmas siguientes evidencian la ejecución, captura de evidencia, revisión y aprobación formal del presente Anexo.',
                firmas: [],
                rolesPlaceholder: [
                    'Ejecutor (Validador)',
                    'Revisor (Process Owner)',
                    'Aprobador (Gerente QA)'
                ],
                nota: ''
            }
        ]
    };
}

/**
 * Handler del botón "Exportar AEX (suite)". Construye el AEX desde el state
 * del gestor y dispara VS.renderDocument() para generar el PDF.
 */
async function exportarAex() {
    try {
        if (!validateSystemInfo()) return;

        const VS = window.ValidationSuite;
        if (!VS || typeof VS.renderDocument !== 'function') {
            showNotification('Validation Suite no está cargada. No se puede generar AEX.', 'error');
            return;
        }

        const aexJson = buildAexFromGestor();
        const testsConEvidencia = (aexJson.secciones.find(s => s.tipo === 'aex-registro-tc') || {}).tests || [];

        if (testsConEvidencia.length === 0) {
            const proceed = await drpConfirm(
                'No hay tests con evidencias capturadas. ¿Generar el AEX vacío de todos modos (como registro estructural)?',
                'AEX sin evidencias', 'warning'
            );
            if (!proceed) return;
        }

        const sysCode = (systemInfo.codigoSistema || 'SIS-001').toUpperCase();
        const fileName = 'AEX-' + sysCode + '-' + new Date().toISOString().split('T')[0] + '.pdf';

        showNotification('Generando AEX vía Validation Suite...');
        await VS.renderDocument(aexJson, { download: true, fileName: fileName });
        showNotification('AEX generado: ' + fileName);
    } catch (e) {
        console.error('[exportarAex] error:', e);
        showNotification('Error generando AEX: ' + e.message, 'error');
    }
}

window.buildAexFromGestor = buildAexFromGestor;
window.exportarAex = exportarAex;

/**
 * Importar protocolo (PIQ / POQ / PPQ) y transformarlo a estructura del gestor.
 *
 * Mapping:
 *   data.document.code/version/type  →  protocols[].{ code, name, type, protocolMeta }
 *   tabla-test-case.tcs[].grupo      →  groups[] (uno por grupo único)
 *   tabla-test-case.tcs[]            →  tests[] con protocolGuidance + protocolSource opcionales
 *
 * Los campos opcionales (protocolGuidance, protocolSource) son aditivos:
 * tests cargados desde sesiones gestor antiguas siguen funcionando sin ellos.
 */

/**
 * Importa las fotos reales desde un JSON de evidencias v3.0 (DRP_Evidencias_*.json)
 * sin tocar los packageDocs del proyecto activo.
 * Reemplaza protocols/groups/tests del runtime con los del archivo.
 */
async function mergeEvidencePhotos(file) {
    let raw;
    try {
        raw = JSON.parse(await file.text());
    } catch (e) {
        showNotification('Archivo inválido — no es un JSON de evidencias.', 'error');
        return;
    }
    if (!raw.protocols || !raw.groups || !raw.tests) {
        showNotification('El archivo no tiene formato de evidencias v3.0 (protocols/groups/tests).', 'error');
        return;
    }
    const totalPhotos = (raw.tests || []).reduce((s, t) =>
        s + (t.evidences || []).filter(ev => ev.image && !ev.isEmpty).length, 0);

    const ok = await drpConfirm(
        `Cargar ${raw.tests.length} tests con ${totalPhotos} foto(s) del archivo "${file.name}"?\n\nLos documentos del paquete (packageDocs) no se modifican.`,
        '📸 Cargar evidencias reales', 'info'
    );
    if (!ok) return;

    protocols = raw.protocols || [];
    groups = raw.groups || [];
    tests = raw.tests || [];

    await saveToStorage();
    showNotification(`✓ ${raw.tests.length} tests y ${totalPhotos} fotos cargados.`, 'success');
    setTimeout(() => typeof renderTests === 'function' && renderTests(), 400);
}

async function importProtocolJSON(data, opts) {
    opts = opts || {};
    try {
        const code = data.document?.code || data.package?.code || 'PROTO';
        const version = data.document?.version || '1.0';
        const titulo = data.document?.titleEs || data.document?.headerTitle || code;

        // Modo merge: agregar el protocolo al runtime sin resetear los anteriores.
        // Útil para cargar PIQ + POQ + PPQ del mismo paquete en paralelo.
        const merge = opts.merge === true;

        // Extraer TCs de todas las secciones tabla-test-case (docs multi-modulo)
        const tablaTCs = (data.secciones || []).filter(s => s.tipo === 'tabla-test-case');
        const tcs = tablaTCs.flatMap(s => Array.isArray(s.tcs) ? s.tcs : []);
        // schemaModo: 'criterios' (IQ) | 'procedimiento' (OQ). Si no se declara
        // a nivel sección, detectamos por la forma del primer TC.
        const schemaModo = (tablaTCs[0] && tablaTCs[0].schemaModo)
            || (tcs[0] && Array.isArray(tcs[0].procedimiento) && tcs[0].procedimiento.length > 0 ? 'procedimiento' : 'criterios');

        if (tcs.length === 0) {
            showNotification('El protocolo no contiene Test Cases (sección tabla-test-case)', 'error');
            return;
        }

        // Validación merge: no duplicar protocolos por code
        if (merge && protocols.some(p => p.code === code)) {
            showNotification(`Protocolo ${code} ya está cargado en el runtime — se omite duplicado.`, 'warning');
            return;
        }

        // Confirmación de sobrescritura (skip si el caller ya preguntó o si es merge)
        if (!opts.skipConfirm && !merge && (tests.length > 0 || groups.length > 0 || protocols.length > 0)) {
            if (!await drpConfirm(
                `Esto reemplazara TODO el contenido actual con el protocolo ${code} v${version} (${tcs.length} Test Cases).`,
                'Cargar protocolo?', 'warning'
            )) return;
        }

        // Reset estado SOLO si no es merge
        if (!merge) {
            protocols = [];
            groups = [];
            tests = [];
            activeProtocolId = null;
            activeTestId = null;
        }

        // SystemInfo desde el package: solo en modo replace, o si está vacío en modo merge.
        // En merge no sobrescribimos: asumimos que todos los protocolos del paquete
        // comparten el mismo package.code y ya está poblado del primero.
        if (data.package && (!merge || !systemInfo.codigoSistema)) {
            systemInfo = {
                empresa: data.package.client || '',
                nombreSistema: data.package.systemName || '',
                codigoSistema: data.package.code || '',
                proveedor: '',
                revisor: '',
                aprobador: ''
            };
            const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
            setVal('empresa', systemInfo.empresa);
            setVal('nombreSistema', systemInfo.nombreSistema);
            setVal('codigoSistema', systemInfo.codigoSistema);
            setVal('proveedor', '');
            setVal('revisor', '');
            setVal('aprobador', '');
        } else if (merge && data.package && data.package.code && data.package.code !== systemInfo.codigoSistema) {
            // Aviso: el protocolo nuevo pertenece a otro paquete que el activo.
            console.warn(`[importProtocol/merge] paquete del nuevo protocolo (${data.package.code}) difiere del runtime activo (${systemInfo.codigoSistema})`);
        }

        // Crear el protocolo
        const protocol = {
            id: 'protocol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: titulo,
            code: code,
            type: data.type, // 'PIQ' | 'POQ' | 'PPQ'
            collapsed: false,
            finalized: false,
            conclusion: '',
            resultado: '',
            protocolMeta: {
                version: version,
                schemaVersion: data.schemaVersion || '1.0',
                issueDate: data.document?.issueDate || '',
                gampCategory: data.document?.gampCategory || '',
                normativeFramework: data.document?.normativeFramework || ''
            }
        };
        protocols.push(protocol);
        // En merge, no robamos el "activo" al protocolo que ya estaba; solo lo seteamos
        // si no hay ninguno todavía. En replace, este es el nuevo activo.
        if (!activeProtocolId) activeProtocolId = protocol.id;

        // Grupos a partir de tc.grupo únicos (preserva orden de aparición)
        const groupMap = {};
        let groupSeq = 0;
        const baseTs = Date.now();
        tcs.forEach(tc => {
            const grupoName = tc.grupo || 'Sin grupo';
            if (!groupMap[grupoName]) {
                const newGroup = {
                    id: 'group_' + baseTs + '_' + (groupSeq++) + '_' + Math.random().toString(36).substr(2, 9),
                    name: grupoName,
                    protocolId: protocol.id,
                    collapsed: false
                };
                groups.push(newGroup);
                groupMap[grupoName] = newGroup.id;
            }
        });

        // protocolSource común a todos los tests
        const protocolSource = {
            code: code,
            version: version,
            type: data.type,
            schemaVersion: data.schemaVersion || '1.0',
            schemaModo: schemaModo
        };

        // Crear tests
        tcs.forEach((tc, idx) => {
            const groupId = groupMap[tc.grupo || 'Sin grupo'];
            const newTest = {
                id: 'test_' + baseTs + '_' + idx + '_' + Math.random().toString(36).substr(2, 9),
                name: tc.titulo || tc.tcId,
                tcId: tc.tcId || '',
                groupId: groupId,
                evidences: [],
                finalized: false,
                conclusion: '',
                resultado: '',
                // ═══ Campos opcionales (protocolo-aware) ═══
                // Schema-aware: criterios[] para IQ, procedimiento[]+criterioAceptacion para OQ.
                // Ambos sets pueden coexistir si el JSON los trae, pero el render del panel
                // prioriza la forma del schemaModo declarado.
                protocolGuidance: {
                    schemaModo: schemaModo,
                    objetivo: tc.objetivo || '',
                    precondiciones: Array.isArray(tc.precondiciones) ? tc.precondiciones : [],
                    // IQ
                    criterios: Array.isArray(tc.criterios) ? tc.criterios : [],
                    evidenciaEsperada: tc.evidenciaEsperada || '',
                    // OQ
                    procedimiento: Array.isArray(tc.procedimiento) ? tc.procedimiento : [],
                    criterioAceptacion: tc.criterioAceptacion || '',
                    tipoTC: tc.tipoTC || '',
                    nivel: tc.nivel || '',
                    grupoFuncional: tc.grupoFuncional || '',
                    // Común
                    profundidad: tc.profundidad || '',
                    componente: tc.componente || '',
                    componenteDesc: tc.componenteDesc || '',
                    raScore: typeof tc.raScore === 'number' ? tc.raScore : null,
                    ursVinculados: Array.isArray(tc.ursVinculados) ? tc.ursVinculados : [],
                    raVinculado: tc.raVinculado || ''
                },
                protocolSource: protocolSource
            };
            tests.push(newTest);

            // Memorizar tcId para el datalist
            if (newTest.tcId) addRecentTestDataValue('tcIds', newTest.tcId);
        });

        // ProjectData fresh
        projectData = { finalized: false, conclusion: '', resultado: '' };

        // Agregar al paquete documental (Fase B.1) — el protocolo recién cargado
        // queda disponible para trazabilidad cruzada con otros docs del paquete.
        // El protocolo "runtime" (tests/groups/protocols) se ejecuta; el doc
        // crudo guardado en packageDocs es lectura para el motor de trazabilidad.
        try { addPackageDoc(data, { fileName: code + '.json' }); } catch (e) { /* silencioso */ }

        // Persistir ANTES de cualquier interacción del usuario que pueda recargar.
        // Sin await acá había una ventana donde recargar la página perdía el
        // import (saveToStorage es async por IndexedDB; aunque no hay imágenes
        // a guardar en un import inicial, el await garantiza que localStorage
        // termine de escribirse antes de continuar).
        await saveToStorage();

        // Refrescar UI
        renderTests();
        renderWorkArea();
        if (typeof updateGroupSelects === 'function') updateGroupSelects();
        if (typeof refreshTestDataDatalists === 'function') refreshTestDataDatalists();
        if (typeof renderPackagePanel === 'function') renderPackagePanel();

        const grupoCount = Object.keys(groupMap).length;
        showNotification(
            `✓ Protocolo cargado: ${code} v${version} — ${tcs.length} TCs en ${grupoCount} grupo(s)`
        );
    } catch (error) {
        showNotification('Error al cargar protocolo: ' + error.message, 'error');
    }
}

/**
 * Importar sesión desde archivo JSON
 */
function importSessionJSON(file) {
    // console.log('🔄 IMPORTANDO JSON:', file.name, file.size, 'bytes');

    const reader = new FileReader();

    reader.onload = async function (e) {
        // console.log('📖 FileReader onload ejecutado');
        try {
            const data = JSON.parse(e.target.result);

            // ═══ AUTODETECCIÓN DE PROTOCOLO (PIQ / POQ / PPQ) ═══
            // Si el JSON declara type de protocolo, lo transformamos a estructura del gestor
            // (protocolos/grupos/tests) preservando guidance + source como metadata.
            if (data.type === 'PIQ' || data.type === 'POQ' || data.type === 'PPQ') {
                return await importProtocolJSON(data);
            }

            // Validar estructura de sesión del gestor
            if (!data.version || !data.tests) {
                throw new Error('Archivo JSON inválido - Falta version o tests');
            }

            // Confirmar sobrescritura
            if (tests.length > 0 || groups.length > 0 || protocols.length > 0) {
    // //                 console.log('⚠ Hay datos existentes, solicitando confirmación...');
                if (!await drpConfirm('Esto reemplazara TODO el contenido actual.', 'Sobrescribir datos?', 'warning')) {
    // //                     console.log('❌ Usuario canceló la importación');
                    return;
                }
            }

            // console.log('📥 Cargando datos en memoria...');

            // Cargar datos
            systemInfo = data.systemInfo || {
                empresa: '',
                nombreSistema: '',
                codigoSistema: '',
                proveedor: ''
            };
            executor = data.executor || '';
            protocols = data.protocols || [];
            groups = data.groups || [];
            tests = data.tests || [];
            projectData = data.projectData || {
                finalized: false,
                conclusion: '',
                resultado: ''
            };

            // Restaurar paquete documental (Fase B.1) — mutación in-place
            packageDocs.length = 0;
            if (Array.isArray(data.packageDocs)) {
                data.packageDocs.forEach(d => packageDocs.push(d));
            }

            // Restaurar configuración de exportación
            if (data.exportConfig) {
                try { localStorage.setItem('drp_projectExportDefaults', JSON.stringify(data.exportConfig)); } catch (e) {}
            }

    // //             console.log('✓ Datos cargados en variables globales:', {
    //             protocols: protocols.length,
    //             groups: groups.length,
    //             tests: tests.length
    //         });

            // Resetear IDs activos
            activeProtocolId = null;
            activeTestId = null;

            // Actualizar UI
            document.getElementById('empresa').value = systemInfo.empresa || '';
            document.getElementById('nombreSistema').value = systemInfo.nombreSistema || '';
            document.getElementById('codigoSistema').value = systemInfo.codigoSistema || '';
            document.getElementById('proveedor').value = systemInfo.proveedor || '';
            document.getElementById('revisor').value = systemInfo.revisor || '';
            document.getElementById('aprobador').value = systemInfo.aprobador || '';
            document.getElementById('ejecutor').value = executor || '';

            // console.log('🖊 Campos UI actualizados');

            // Guardar en localStorage
            // console.log('💾 Guardando en localStorage...');
            saveToStorage();

            // Renderizar
            // console.log('🎨 Renderizando UI...');
            renderTests();
            renderWorkArea();

            // Calcular total de evidencias
            const totalEvidencias = tests.reduce((sum, t) => sum + t.evidences.length, 0);

            showNotification(`✓ Sesión importada: ${protocols.length} protocolos, ${groups.length} carpetas, ${tests.length} pruebas, ${totalEvidencias} evidencias`);

    // //             console.log('✅ JSON IMPORTADO EXITOSAMENTE:');
    // //             console.log('- Protocolos:', protocols.length);
    // //             console.log('- Carpetas:', groups.length);
    // //             console.log('- Pruebas:', tests.length);
    // //             console.log('- Evidencias:', totalEvidencias);
        } catch (error) {
    // //             console.error('❌ Error importando JSON:', error);
            showNotification('Error al importar: ' + error.message, 'error');
        }
    };

    reader.onerror = function (error) {
    // //         console.error('❌ FileReader error:', error);
        showNotification('Error al leer el archivo', 'error');
    };

    // console.log('📂 Iniciando lectura del archivo...');
    reader.readAsText(file);
}

/* ====================================================================
   INICIALIZACIÓN DE UI
   ==================================================================== */

/**
 * Inicializar elementos de interfaz
 */
function initUI() {
    // Botones padre/hijo (acordeón)
    initParentButtons();

    // Event listeners de botones principales
    initButtonListeners();

    // Event listeners de modales
    initModalListeners();

    // Captura de Ctrl+V
    initPasteListener();

    // Drag & Drop global
    initDragDropGlobal();

    // Split-button dropdowns (toolbar estilo Windows)
    initSplitButtons();

    // Búsqueda en sidebar
    initSidebarSearch();

    // Indicador de almacenamiento
    updateStorageIndicator();

    // Pad de firma electrónica
    initSignaturePad();

    // Documentos asociados
    initAssociatedDocs();

    // Renderizar UI inicial
    renderTests();
    renderWorkArea();

    // //     console.log('UI inicializada - Tests y workspace renderizados');
}

/**
 * Inicializar split-buttons con dropdowns estilo Windows
 * Usa position:fixed para evitar clipping del toolbar overflow
 */
function initSplitButtons() {
    const allDropdowns = document.querySelectorAll('.tb-dropdown');

    // Mover dropdowns al body para evitar clipping por overflow del toolbar
    allDropdowns.forEach(dd => document.body.appendChild(dd));

    function closeAllDropdowns() {
        allDropdowns.forEach(dd => {
            dd.classList.remove('active');
        });
        document.querySelectorAll('.tb-split.open').forEach(s => s.classList.remove('open'));
    }

    function positionDropdown(dropdown, triggerEl) {
        const rect = triggerEl.getBoundingClientRect();
        const split = triggerEl.closest('.tb-split');
        const splitRect = split.getBoundingClientRect();

        // Posicionar debajo del split-button, alineado a la izquierda
        let left = splitRect.left;
        let top = splitRect.bottom + 3;

        // Si se sale de la pantalla por la derecha, alinear al borde derecho del boton
        dropdown.style.left = '0px';
        dropdown.style.top = '0px';
        dropdown.classList.add('active');

        const ddRect = dropdown.getBoundingClientRect();
        if (left + ddRect.width > window.innerWidth - 8) {
            left = splitRect.right - ddRect.width;
        }
        if (left < 4) left = 4;

        dropdown.classList.remove('active');

        // Si se sale por abajo, mover hacia arriba
        if (top + ddRect.height > window.innerHeight - 8) {
            top = splitRect.top - ddRect.height - 3;
            if (top < 4) top = 4;
        }

        dropdown.style.left = left + 'px';
        dropdown.style.top = top + 'px';
    }

    function toggleDropdown(triggerEl, e) {
        e.stopPropagation();
        const dropId = triggerEl.getAttribute('data-dropdown');
        const dropdown = document.getElementById(dropId);
        const split = triggerEl.closest('.tb-split');
        const isOpen = dropdown.classList.contains('active');

        closeAllDropdowns();

        if (!isOpen) {
            positionDropdown(dropdown, triggerEl);
            dropdown.classList.add('active');
            split.classList.add('open');
        }
    }

    // Flechas toggle dropdown
    document.querySelectorAll('.tb-split-arrow').forEach(arrow => {
        arrow.addEventListener('click', (e) => toggleDropdown(arrow, e));
    });

    // Botones principales que tambien abren dropdown
    document.querySelectorAll('.tb-split-main[data-dropdown]').forEach(main => {
        main.addEventListener('click', (e) => toggleDropdown(main, e));
    });

    // Cerrar dropdown al hacer click en un item
    allDropdowns.forEach(dd => {
        dd.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => closeAllDropdowns());
        });
    });

    // Cerrar al hacer click fuera
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tb-split') && !e.target.closest('.tb-dropdown')) {
            closeAllDropdowns();
        }
    });

    // Cerrar con Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllDropdowns();
    });

    // Reposicionar al hacer scroll en el toolbar
    document.querySelector('.app-toolbar')?.addEventListener('scroll', closeAllDropdowns);
}

/**
 * Búsqueda en sidebar — filtra protocolos/carpetas/pruebas en tiempo real
 */
function initSidebarSearch() {
    const searchInput = document.getElementById('sidebarSearch');
    if (!searchInput) return;

    let debounceTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            renderTests();
        }, 200);
    });
}

/**
 * Obtener query de búsqueda actual del sidebar
 */
function getSidebarSearchQuery() {
    const input = document.getElementById('sidebarSearch');
    return input ? input.value.trim().toLowerCase() : '';
}

/**
 * Verificar si un test/grupo/protocolo coincide con la búsqueda
 */
function matchesSearch(name, query) {
    if (!query) return true;
    return name.toLowerCase().includes(query);
}

/**
 * Filtro avanzado para tests — soporta búsqueda por:
 * - Nombre del test (substring)
 * - tcId (TC-IQ-001, TC-OQ-036, etc.)
 * - URS vinculados (URS-044, URS-NF-001)
 * - RA vinculado (RA-021, RA-024)
 * - Componente IRA (COMP-SW-01, COMP-INF-03)
 *
 * Si el query empieza con URS-, RA-, COMP- o TC-, hace match exacto
 * (case-insensitive) contra esos campos. Si no, hace match parcial al
 * nombre. Eso permite filtrar el sidebar a "todos los TCs que tocan
 * URS-044" con una sola query.
 */
function matchesTestFilter(test, query) {
    if (!query) return true;
    if (!test) return false;

    const q = String(query).trim().toUpperCase();

    // Detectar query con shape de ID
    const isIdQuery = /^(URS|RA|COMP|TC)-/.test(q);

    if (isIdQuery) {
        // Match contra tcId
        if (test.tcId && String(test.tcId).toUpperCase() === q) return true;

        const g = test.protocolGuidance;
        if (g) {
            // URS vinculados
            if (Array.isArray(g.ursVinculados)) {
                if (g.ursVinculados.some(u => String(u).toUpperCase() === q)) return true;
            }
            // RA vinculado
            if (g.raVinculado && String(g.raVinculado).toUpperCase() === q) return true;
            // IRA componente
            if (g.componente && String(g.componente).toUpperCase() === q) return true;
        }

        // Si es ID query y no hubo match → falla (no caer a match por nombre)
        return false;
    }

    // Query normal: match parcial contra el nombre + tcId como bonus
    const lower = String(query).trim().toLowerCase();
    if (String(test.name || '').toLowerCase().includes(lower)) return true;
    if (test.tcId && String(test.tcId).toLowerCase().includes(lower)) return true;
    return false;
}
window.matchesTestFilter = matchesTestFilter;

/**
 * Actualizar indicador de almacenamiento en el sidebar
 */
async function updateStorageIndicator() {
    try {
        const stats = await getDBStats();
        const container = document.getElementById('storageIndicator');

        if (!container) {
            // Crear indicador si no existe
            const statsDiv = document.querySelector('.sb-stats');
            if (!statsDiv) return;

            const indicator = document.createElement('div');
            indicator.id = 'storageIndicator';
            indicator.style.cssText = 'padding: 4px 12px; font-size: 10px; color: var(--vsc-gris);';
            statsDiv.parentNode.insertBefore(indicator, statsDiv.nextSibling);
        }

        const el = document.getElementById('storageIndicator');
        if (!el) return;

        const usageMB = (stats.usage / 1024 / 1024).toFixed(1);
        const percent = stats.usagePercent || 0;
        const barColor = percent > 80 ? 'var(--vsc-rojo)' : percent > 50 ? '#F39C12' : 'var(--vsc-verde)';

        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="flex:1;height:3px;background:var(--vsc-gris-claro);border-radius:2px;overflow:hidden;">
                    <div style="width:${Math.min(percent, 100)}%;height:100%;background:${barColor};border-radius:2px;"></div>
                </div>
                <span>${usageMB} MB (${stats.count} img)</span>
            </div>`;

        if (percent > 80) {
            showNotification(`Almacenamiento al ${percent}% - Considera limpiar datos antiguos`, 'warning');
        }
    } catch (e) { /* silenciar si IndexedDB no disponible */ }
}

/**
 * Validación de nombre único
 */
function isNameUnique(name, collection, excludeId) {
    const normalized = name.trim().toLowerCase();
    return !collection.some(item => item.id !== excludeId && item.name.trim().toLowerCase() === normalized);
}

/**
 * Auto-backup: guardar copia de seguridad en localStorage con timestamp
 */
function createAutoBackup() {
    try {
        const data = {
            version: '3.0',
            timestamp: new Date().toISOString(),
            systemInfo: {
                empresa: document.getElementById('empresa')?.value || '',
                nombreSistema: document.getElementById('nombreSistema')?.value || '',
                codigoSistema: document.getElementById('codigoSistema')?.value || '',
                proveedor: document.getElementById('proveedor')?.value || ''
            },
            executor: document.getElementById('ejecutor')?.value || '',
            protocols: protocols,
            groups: groups,
            tests: tests.map(t => ({
                ...t,
                evidences: t.evidences.map(e => {
                    const copy = { ...e };
                    delete copy.image;
                    if (copy.hasImage === undefined && e.image) copy.hasImage = true;
                    return copy;
                })
            })),
            projectData: projectData
        };

        // Rotar backups: mantener últimos 3
        const backupKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('vscBackup_')) backupKeys.push(key);
        }
        backupKeys.sort();
        while (backupKeys.length >= 3) {
            localStorage.removeItem(backupKeys.shift());
        }

        const backupKey = 'vscBackup_' + Date.now();
        localStorage.setItem(backupKey, JSON.stringify(data));
    } catch (e) { /* silenciar si quota exceeded */ }
}

/**
 * Restaurar desde backup
 */
function showRestoreBackupModal() {
    const backupKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('vscBackup_')) backupKeys.push(key);
    }
    backupKeys.sort().reverse();

    if (backupKeys.length === 0) {
        showNotification('No hay backups disponibles', 'warning');
        return;
    }

    let html = `<div style="padding: 20px;">
        <h3 style="margin-bottom: 15px;">Restaurar desde Backup</h3>
        <p style="margin-bottom: 15px; color: var(--vsc-gris); font-size: 12px;">Se reemplazarán los datos actuales. Las imágenes en IndexedDB se conservan.</p>
        <div style="display: flex; flex-direction: column; gap: 8px;">`;

    backupKeys.forEach(key => {
        const ts = parseInt(key.replace('vscBackup_', ''));
        const date = new Date(ts);
        const label = date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        try {
            const data = JSON.parse(localStorage.getItem(key));
            const testCount = data.tests ? data.tests.length : 0;
            html += `<button onclick="restoreBackup('${key}')" style="padding: 12px; border: 1px solid var(--vsc-gris); background: white; border-radius: 6px; cursor: pointer; text-align: left;">
                <strong>${label}</strong><br>
                <span style="color: var(--vsc-gris); font-size: 11px;">${testCount} pruebas | ${data.systemInfo?.nombreSistema || 'Sin nombre'}</span>
            </button>`;
        } catch (e) { /* skip corrupt */ }
    });

    html += `</div></div>`;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'customModal';
    modal.innerHTML = `<div class="modal-content">${html}</div>`;
    modal.onclick = (e) => { if (e.target === modal) closeCustomModal(); };
    document.body.appendChild(modal);
}

async function restoreBackup(backupKey) {
    if (!await drpConfirm('Se reemplazaran los datos actuales.', 'Restaurar backup?', 'warning')) return;

    try {
        const data = JSON.parse(localStorage.getItem(backupKey));
        if (!data) throw new Error('Backup vacío');

        localStorage.setItem('vscTestsData_v3', JSON.stringify(data));
        closeCustomModal();
        location.reload();
    } catch (e) {
        showNotification('Error al restaurar backup: ' + e.message, 'error');
    }
}

/**
 * Reordenar carpetas dentro de un protocolo (arriba/abajo)
 */

/* ====================================================================
   EXPORTAR RAW DATA — ZIP con estructura de carpetas trazable
   ==================================================================== */

function downloadZipIndex() {
    if (!window._lastZipIndex) {
        showNotification('Exporta el ZIP primero para generar el indice', 'warning');
        return;
    }
    const blob = new Blob([window._lastZipIndex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Indice_Trazabilidad_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
    showNotification('Indice de trazabilidad descargado');
}

function openZipExportModal() {
    // Pre-llenar nombre del archivo
    const projectName = document.getElementById('projectName')?.value || 'Proyecto';
    const protocol = document.getElementById('protocolCode')?.value || '';
    const sanitized = (projectName + (protocol ? '_' + protocol : '')).replace(/[^a-zA-Z0-9_\- ]/g, '_').substring(0, 50);
    document.getElementById('zipFileName').value = `RawData_${sanitized}_${new Date().toISOString().slice(0, 10)}`;

    // Llenar opciones de carpeta
    updateZipScopeOptions();

    // Reset UI
    document.getElementById('zipProgress').style.display = 'none';
    document.getElementById('btnExportZip').disabled = false;

    showModal('modalExportZip');
}

function updateZipScopeOptions() {
    const scope = document.getElementById('zipScope').value;
    const folderSelectDiv = document.getElementById('zipFolderSelect');
    const folderSelect = document.getElementById('zipFolderChoice');

    if (scope === 'folder') {
        folderSelectDiv.style.display = 'block';
        folderSelect.innerHTML = '';
        groups.forEach(g => {
            const protocol = protocols.find(p => p.id === g.protocolId);
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${protocol ? protocol.code + ' - ' : ''}${g.name}`;
            folderSelect.appendChild(opt);
        });
    } else {
        folderSelectDiv.style.display = 'none';
    }
}

async function executeZipExport() {
    if (typeof JSZip === 'undefined') {
        showNotification('JSZip no esta cargado. Verifica tu conexion a internet.', 'error');
        return;
    }

    const fileName = document.getElementById('zipFileName')?.value.trim() || 'RawData_Export';
    const scope = document.getElementById('zipScope').value;
    const includeMetadata = document.getElementById('zipIncludeMetadata').checked;
    const includeIndex = document.getElementById('zipIncludeIndex').checked;
    const folderId = document.getElementById('zipFolderChoice')?.value;

    // Show progress
    const progressDiv = document.getElementById('zipProgress');
    const progressBar = document.getElementById('zipProgressBar');
    const progressText = document.getElementById('zipProgressText');
    progressDiv.style.display = 'block';
    document.getElementById('btnExportZip').disabled = true;

    try {
        const zip = new JSZip();

        // Determinar qué tests exportar
        let testsToExport = [];
        let folderMap = {};

        if (scope === 'folder' && folderId) {
            const group = groups.find(g => g.id === folderId);
            const protocol = protocols.find(p => p.id === group?.protocolId);
            testsToExport = tests.filter(t => t.groupId === folderId);
            if (group) folderMap[folderId] = { group, protocol };
        } else {
            testsToExport = [...tests];
            groups.forEach(g => {
                const protocol = protocols.find(p => p.id === g.protocolId);
                folderMap[g.id] = { group: g, protocol };
            });
        }

        // Contar total de imágenes para progreso
        let totalImages = 0;
        testsToExport.forEach(t => {
            t.evidences.forEach(e => {
                if (!e.isEmpty && (e.image || e.hasImage)) totalImages++;
            });
        });

        if (totalImages === 0) {
            showNotification('No hay imagenes para exportar', 'warning');
            progressDiv.style.display = 'none';
            document.getElementById('btnExportZip').disabled = false;
            return;
        }

        let processed = 0;
        let indexContent = [];
        indexContent.push('═══════════════════════════════════════════════════════════════');
        indexContent.push('  INDICE DE TRAZABILIDAD - RAW DATA');
        indexContent.push(`  Proyecto: ${document.getElementById('projectName')?.value || 'N/A'}`);
        indexContent.push(`  Fecha de exportacion: ${new Date().toLocaleString('es-AR')}`);
        indexContent.push(`  Total imagenes: ${totalImages}`);
        indexContent.push('═══════════════════════════════════════════════════════════════');
        indexContent.push('');

        // Procesar cada test
        for (const test of testsToExport) {
            const groupInfo = folderMap[test.groupId];
            const protocolCode = groupInfo?.protocol?.code || 'SinProtocolo';
            const folderName = groupInfo?.group?.name || 'Sin_Carpeta';

            // Sanitizar nombres para paths de archivo
            const safeProt = protocolCode.replace(/[^a-zA-Z0-9_\- ]/g, '_');
            const safeFolder = folderName.replace(/[^a-zA-Z0-9_\- ]/g, '_').substring(0, 40);
            const safeTest = test.name.replace(/[^a-zA-Z0-9_\- ]/g, '_').substring(0, 40);

            const basePath = `${safeProt}/${safeFolder}/${safeTest}`;

            indexContent.push(`📁 ${basePath}`);

            const testMetadata = {
                testName: test.name,
                testId: test.id,
                protocol: protocolCode,
                folder: folderName,
                finalized: test.finalized || false,
                resultado: test.resultado || '',
                conclusion: test.conclusion || '',
                evidences: []
            };

            for (const evidence of test.evidences) {
                if (evidence.isEmpty) continue;

                // Obtener imagen (puede estar en memoria o en IndexedDB)
                let imageData = evidence.image;
                if (!imageData && evidence.hasImage) {
                    try {
                        const imageId = `${test.id}_evidence_${evidence.step}`;
                        imageData = await getImageFromDB(imageId);
                    } catch (e) { /* skip */ }
                }

                if (!imageData) continue;

                const stepStr = String(evidence.step).padStart(3, '0');
                const desc = (evidence.description || 'sin_descripcion').replace(/[^a-zA-Z0-9_\- ]/g, '_').substring(0, 30);
                const imgFileName = `PASO_${stepStr}_${desc}.png`;

                // Convertir base64 a binario
                const base64Content = imageData.replace(/^data:image\/\w+;base64,/, '');
                zip.file(`${basePath}/${imgFileName}`, base64Content, { base64: true });

                // Metadata de evidencia
                const evidMeta = {
                    step: evidence.step,
                    file: imgFileName,
                    description: evidence.description || '',
                    operacion: evidence.operacion || '',
                    resultado: evidence.resultado || 'PASA',
                    usuarioPrueba: evidence.usuarioPrueba || '',
                    rolPrueba: evidence.rolPrueba || '',
                    testCaseRef: evidence.testCaseRef || '',
                    criterioRef: evidence.criterioRef || '',
                    executor: evidence.executor || test.executor || '',
                    timestamp: evidence.captureTimestamp || evidence.timestamp || '',
                    dimensions: evidence.dimensions || null,
                    size: evidence.size || null
                };
                testMetadata.evidences.push(evidMeta);

                const fecha = evidence.captureTimestamp || evidence.timestamp;
                const fechaStr = fecha ? new Date(fecha).toLocaleString('es-AR') : 'N/A';
                indexContent.push(`    📄 ${imgFileName}`);
                let lineaInfo = `       Operacion: ${evidence.operacion || 'N/A'} | Resultado: ${evidence.resultado || 'PASA'} | Fecha: ${fechaStr}`;
                if (evidence.usuarioPrueba || evidence.rolPrueba || evidence.testCaseRef) {
                    const datosLinea = [];
                    if (evidence.usuarioPrueba) datosLinea.push(`Usuario: ${evidence.usuarioPrueba}`);
                    if (evidence.rolPrueba) datosLinea.push(`Rol: ${evidence.rolPrueba}`);
                    if (evidence.testCaseRef) datosLinea.push(`TC: ${evidence.testCaseRef}`);
                    lineaInfo += `\n       ${datosLinea.join(' | ')}`;
                }
                indexContent.push(lineaInfo);

                processed++;
                const pct = Math.round((processed / totalImages) * 100);
                progressBar.style.width = pct + '%';
                progressText.textContent = `Procesando ${processed}/${totalImages} imagenes...`;

                // Yield para no bloquear UI
                if (processed % 5 === 0) await new Promise(r => setTimeout(r, 0));
            }

            // Guardar metadata JSON por test
            if (includeMetadata && testMetadata.evidences.length > 0) {
                zip.file(`${basePath}/_metadata.json`, JSON.stringify(testMetadata, null, 2));
            }

            indexContent.push('');
        }

        // Guardar indice en memoria para descarga separada si el usuario quiere
        if (includeIndex) {
            indexContent.push('═══════════════════════════════════════════════════════════════');
            indexContent.push(`  Exportado: ${new Date().toLocaleString('es-AR')}`);
            indexContent.push(`  Imagenes exportadas: ${processed}/${totalImages}`);
            indexContent.push('═══════════════════════════════════════════════════════════════');
            window._lastZipIndex = indexContent.join('\r\n');
        }

        progressText.textContent = 'Generando archivo ZIP...';
        progressBar.style.width = '100%';

        // ZIP limpio: solo imágenes PNG (sin .bat, .txt, .json que activan MOTW)
        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
            mimeType: 'application/zip'
        });

        const safeName = fileName.replace(/[^a-zA-Z0-9_\- ]/g, '_');
        const sizeMB = (blob.size / 1024 / 1024).toFixed(1);

        // showSaveFilePicker: escribe directo al disco sin MOTW
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: `${safeName}.zip`,
                    types: [{ description: 'Archivo ZIP', accept: { 'application/zip': ['.zip'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                showNotification(`ZIP guardado (${sizeMB} MB, ${processed} imagenes). Sin bloqueo de Windows.`);
                closeModal('modalExportZip');
                return;
            } catch (pickerErr) {
                if (pickerErr.name === 'AbortError') {
                    showNotification('Exportacion cancelada', 'warning');
                    progressDiv.style.display = 'none';
                    document.getElementById('btnExportZip').disabled = false;
                    return;
                }
            }
        }

        // Fallback clasico
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 3000);
        showNotification(`ZIP exportado (${sizeMB} MB, ${processed} imagenes).`, 'success', 8000);

        closeModal('modalExportZip');

    } catch (err) {
        console.error('Error en export ZIP:', err);
        showNotification('Error al generar ZIP: ' + err.message, 'error');
    } finally {
        progressDiv.style.display = 'none';
        document.getElementById('btnExportZip').disabled = false;
    }
}

/* ====================================================================
   FIRMA ELECTRONICA — Canvas de captura + almacenamiento IndexedDB
   ==================================================================== */

let signatureCtx = null;
let isDrawingSignature = false;

function initSignaturePad() {
    const canvas = document.getElementById('signatureCanvas');
    if (!canvas) return;

    signatureCtx = canvas.getContext('2d');
    signatureCtx.strokeStyle = '#213B50';
    signatureCtx.lineWidth = 2.5;
    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';

    let lastX = 0, lastY = 0;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function startDraw(e) {
        e.preventDefault();
        isDrawingSignature = true;
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;
    }

    function draw(e) {
        if (!isDrawingSignature) return;
        e.preventDefault();
        const pos = getPos(e);
        signatureCtx.beginPath();
        signatureCtx.moveTo(lastX, lastY);
        signatureCtx.lineTo(pos.x, pos.y);
        signatureCtx.stroke();
        lastX = pos.x;
        lastY = pos.y;
    }

    function stopDraw() { isDrawingSignature = false; }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);

    // Limpiar canvas
    document.getElementById('btnClearSignature')?.addEventListener('click', () => {
        signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
    });

    // Guardar firma
    document.getElementById('btnSaveSignature')?.addEventListener('click', (e) => saveSignature(e));
}

async function saveSignature() {
    const canvas = document.getElementById('signatureCanvas');
    const name = document.getElementById('signatureName')?.value.trim();
    const role = document.getElementById('signatureRole')?.value;

    if (!name) {
        showNotification('Ingresa el nombre del firmante', 'error');
        return;
    }

    // Verificar que el canvas no esté vacío
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    if (canvas.toDataURL() === blank.toDataURL()) {
        showNotification('Dibuja tu firma primero', 'error');
        return;
    }

    const signatureData = canvas.toDataURL('image/png');
    const signatureId = `signature_${role}_${Date.now()}`;

    const signatureRecord = {
        id: signatureId,
        role: role,
        name: name,
        image: signatureData,
        timestamp: new Date().toISOString()
    };

    // Guardar en localStorage (las firmas son pequeñas)
    try {
        let signatures = JSON.parse(localStorage.getItem('vscSignatures') || '[]');

        // Reemplazar firma existente del mismo rol si existe
        signatures = signatures.filter(s => s.role !== role);
        signatures.push(signatureRecord);

        localStorage.setItem('vscSignatures', JSON.stringify(signatures));

        closeModal('modalSignature');
        showNotification(`Firma de ${role} guardada: ${name}`);
    } catch (e) {
        showNotification('Error al guardar firma: ' + e.message, 'error');
    }
}

function getSignatureByRole(role) {
    try {
        const signatures = JSON.parse(localStorage.getItem('vscSignatures') || '[]');
        return signatures.find(s => s.role === role) || null;
    } catch (e) {
        return null;
    }
}

function getAllSignatures() {
    try {
        return JSON.parse(localStorage.getItem('vscSignatures') || '[]');
    } catch (e) {
        return [];
    }
}

function openSignatureModal() {
    const canvas = document.getElementById('signatureCanvas');
    if (canvas && signatureCtx) {
        signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Pre-llenar nombre si hay ejecutor
    const ejecutor = document.getElementById('ejecutor')?.value || '';
    const nameInput = document.getElementById('signatureName');
    if (nameInput && !nameInput.value) nameInput.value = ejecutor;

    // Mostrar firmas guardadas
    loadSavedSignaturesPreview();

    showModal('modalSignature');
}

function loadSavedSignaturesPreview() {
    const signatures = getAllSignatures();
    const section = document.getElementById('savedSignaturesSection');
    const list = document.getElementById('savedSignaturesList');
    if (!section || !list) return;

    if (signatures.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    list.innerHTML = '';

    signatures.forEach(sig => {
        const item = document.createElement('div');
        item.style.cssText = 'border: 1px solid var(--vsc-gris); border-radius: 6px; padding: 6px; text-align: center; cursor: pointer; background: white; width: 130px;';
        item.innerHTML = `
            <img src="${sig.image}" style="width: 120px; height: 45px; object-fit: contain; display: block; margin: 0 auto 4px;">
            <div style="font-size: 10px; color: var(--vsc-azul); font-weight: 600;">${sig.name}</div>
            <div style="font-size: 9px; color: var(--vsc-gris); text-transform: uppercase;">${sig.role}</div>
        `;
        item.title = `Usar firma de ${sig.name} (${sig.role})`;
        item.addEventListener('click', () => {
            // Cargar firma en el canvas
            const canvas = document.getElementById('signatureCanvas');
            const img = new Image();
            img.onload = () => {
                signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
                signatureCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = sig.image;
            document.getElementById('signatureName').value = sig.name;
            document.getElementById('signatureRole').value = sig.role;
        });
        list.appendChild(item);
    });
}

/* ====================================================================
   DOCUMENTOS ASOCIADOS — Adjuntar docs no ejecutables al proyecto
   ==================================================================== */

function openAssociatedDocsModal() {
    renderAssociatedDocsList();
    showModal('modalAssociatedDocs');
}

function initAssociatedDocs() {
    const input = document.getElementById('uploadAssocDocInput');
    if (!input) return;

    input.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        for (const file of files) {
            if (file.size > 50 * 1024 * 1024) {
                showNotification(`${file.name} excede 50MB, omitido`, 'error');
                continue;
            }

            const arrayBuffer = await file.arrayBuffer();

            const doc = {
                id: `assoc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.size,
                data: arrayBuffer,  // binario puro en IndexedDB
                addedDate: new Date().toISOString(),
                category: detectDocCategory(file.name)
            };

            await saveDocToDB(doc);
            renderAssociatedDocsList();
            showNotification(`Documento adjuntado: ${file.name}`);
        }
        input.value = '';
    });
}

function detectDocCategory(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('manual')) return 'Manual';
    if (lower.includes('politica') || lower.includes('policy')) return 'Politica';
    if (lower.includes('plan')) return 'Plan';
    if (lower.includes('procedimiento') || lower.includes('sop')) return 'Procedimiento';
    if (lower.includes('especificacion') || lower.includes('spec') || lower.includes('urs') || lower.includes('req')) return 'Especificacion';
    if (lower.includes('riesgo') || lower.includes('risk')) return 'Analisis de Riesgo';
    if (lower.includes('diseno') || lower.includes('design')) return 'Documento de Diseno';
    return 'Documento General';
}

// --- IndexedDB SEPARADA para documentos asociados (evita conflictos de version) ---

const DOCS_DB_NAME = 'GestorEvidencias_DocsDB';
const DOCS_DB_VERSION = 1;
const DOCS_STORE = 'associatedDocs';
let docsDb = null;

function initDocsDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DOCS_DB_NAME, DOCS_DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { docsDb = req.result; resolve(docsDb); };
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(DOCS_STORE)) {
                d.createObjectStore(DOCS_STORE, { keyPath: 'id' });
            }
        };
    });
}

async function getDocsDB() {
    if (docsDb) return docsDb;
    return await initDocsDB();
}

async function saveDocToDB(doc) {
    const d = await getDocsDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(DOCS_STORE, 'readwrite');
        tx.objectStore(DOCS_STORE).put(doc);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getAssociatedDocs() {
    try {
        const d = await getDocsDB();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(DOCS_STORE, 'readonly');
            const req = tx.objectStore(DOCS_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (e) { return []; }
}

async function getAssociatedDocById(docId) {
    try {
        const d = await getDocsDB();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(DOCS_STORE, 'readonly');
            const req = tx.objectStore(DOCS_STORE).get(docId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) { return null; }
}

async function removeAssociatedDoc(docId) {
    const d = await getDocsDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(DOCS_STORE, 'readwrite');
        tx.objectStore(DOCS_STORE).delete(docId);
        tx.oncomplete = () => {
            renderAssociatedDocsList();
            showNotification('Documento eliminado');
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

async function updateDocCategory(docId, category) {
    const doc = await getAssociatedDocById(docId);
    if (doc) {
        doc.category = category;
        await saveDocToDB(doc);
    }
}

async function renderAssociatedDocsList() {
    const container = document.getElementById('associatedDocsList');
    if (!container) return;

    const docs = await getAssociatedDocs();

    if (docs.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--vsc-gris); font-size: 12px; padding: 20px;">No hay documentos asociados</p>';
        return;
    }

    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const categories = ['Manual', 'Politica', 'Plan', 'Procedimiento', 'Especificacion', 'Analisis de Riesgo', 'Documento de Diseno', 'Documento General'];

    container.innerHTML = docs.map(doc => `
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--vsc-gris-claro); border-radius: 6px; margin-bottom: 6px; background: white;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--vsc-azul)" stroke-width="2" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 12px; font-weight: 600; color: var(--vsc-texto); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(doc.name)}</div>
                <div style="font-size: 10px; color: var(--vsc-gris);">${formatSize(doc.size)} | ${new Date(doc.addedDate).toLocaleDateString('es-AR')}</div>
            </div>
            <select onchange="updateDocCategory('${escapeHtml(doc.id)}', this.value)" style="font-size: 11px; padding: 2px 4px; border: 1px solid var(--vsc-gris-claro); border-radius: 4px; color: var(--vsc-azul); background: var(--vsc-gris-claro);">
                ${categories.map(c => `<option value="${c}" ${doc.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <button onclick="removeAssociatedDoc('${escapeHtml(doc.id)}')" style="background: none; border: none; cursor: pointer; color: var(--vsc-gris); padding: 4px;" title="Eliminar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `).join('');
}

function moveGroupUp(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const siblings = groups.filter(g => g.protocolId === group.protocolId);
    const idx = siblings.indexOf(group);
    if (idx <= 0) return;

    const globalIdx = groups.indexOf(group);
    const prevSibling = siblings[idx - 1];
    const prevGlobalIdx = groups.indexOf(prevSibling);

    groups.splice(globalIdx, 1);
    groups.splice(prevGlobalIdx, 0, group);

    renderTests();
    saveToStorage();
}

function moveGroupDown(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const siblings = groups.filter(g => g.protocolId === group.protocolId);
    const idx = siblings.indexOf(group);
    if (idx >= siblings.length - 1) return;

    const globalIdx = groups.indexOf(group);
    const nextSibling = siblings[idx + 1];
    const nextGlobalIdx = groups.indexOf(nextSibling);

    groups.splice(globalIdx, 1);
    groups.splice(nextGlobalIdx, 0, group);

    renderTests();
    saveToStorage();
}

/**
 * Reordenar pruebas dentro de una carpeta (arriba/abajo)
 */
function moveTestUp(testId) {
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    const siblings = tests.filter(t => t.groupId === test.groupId);
    const idx = siblings.indexOf(test);
    if (idx <= 0) return;

    const globalIdx = tests.indexOf(test);
    const prevSibling = siblings[idx - 1];
    const prevGlobalIdx = tests.indexOf(prevSibling);

    tests.splice(globalIdx, 1);
    tests.splice(prevGlobalIdx, 0, test);

    renderTests();
    saveToStorage();
}

function moveTestDown(testId) {
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    const siblings = tests.filter(t => t.groupId === test.groupId);
    const idx = siblings.indexOf(test);
    if (idx >= siblings.length - 1) return;

    const globalIdx = tests.indexOf(test);
    const nextSibling = siblings[idx + 1];
    const nextGlobalIdx = tests.indexOf(nextSibling);

    tests.splice(globalIdx, 1);
    tests.splice(nextGlobalIdx, 0, test);

    renderTests();
    saveToStorage();
}

/**
 * Inicializar botones padre/hijo (acordeón)
 */
function initParentButtons() {
    const parentButtons = document.querySelectorAll('.parent-btn');

    parentButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            const group = this.dataset.group;
            const submenu = document.getElementById(`submenu-${group}`);

            // Toggle active en botón
            this.classList.toggle('active');

            // Toggle active en submenu
            if (submenu) {
                submenu.classList.toggle('active');
            }

            // Cerrar otros submenus
            parentButtons.forEach(other => {
                if (other !== this) {
                    other.classList.remove('active');
                    const otherGroup = other.dataset.group;
                    const otherSubmenu = document.getElementById(`submenu-${otherGroup}`);
                    if (otherSubmenu) {
                        otherSubmenu.classList.remove('active');
                    }
                }
            });
        });
    });

    // //     console.log('Botones padre/hijo inicializados');
}

/**
 * Inicializar listeners de botones principales
 */
function initButtonListeners() {
    // GESTIÓN
    const btnNuevoProtocolo = document.getElementById('btnNuevoProtocolo');
    if (btnNuevoProtocolo) {
        btnNuevoProtocolo.addEventListener('click', () => showModal('modalNewProtocol'));
    }

    const btnNuevaPrueba = document.getElementById('btnNuevaPrueba');
    if (btnNuevaPrueba) {
        btnNuevaPrueba.addEventListener('click', () => showModal('modalNewTest'));
    }

    const btnNuevaCarpeta = document.getElementById('btnNuevaCarpeta');
    if (btnNuevaCarpeta) {
        btnNuevaCarpeta.addEventListener('click', () => showModal('modalNewGroup'));
    }

    const btnCargarSesion = document.getElementById('btnCargarSesion');
    if (btnCargarSesion) {
        btnCargarSesion.addEventListener('click', () => {
            document.getElementById('loadSessionInput').click();
        });
    }

    // CAPTURA
    const btnSubirImagen = document.getElementById('btnSubirImagen');
    if (btnSubirImagen) {
        btnSubirImagen.addEventListener('click', () => {
            document.getElementById('uploadImageInput').click();
        });
    }

    const btnSubirCarpeta = document.getElementById('btnSubirCarpeta');
    if (btnSubirCarpeta) {
        btnSubirCarpeta.addEventListener('click', () => {
            document.getElementById('uploadFolderInput').click();
        });
    }

    const btnInsertarTabla = document.getElementById('btnInsertarTabla');
    if (btnInsertarTabla) {
        btnInsertarTabla.addEventListener('click', () => showModal('modalAddTable'));
    }

    const btnEvidenciaVacia = document.getElementById('btnEvidenciaVacia');
    if (btnEvidenciaVacia) {
        btnEvidenciaVacia.addEventListener('click', (e) => createEmptyEvidence(e));
    }

    // GESTIÓN - REORDENAR
    const btnReordenarEvidencias = document.getElementById('btnReordenarEvidencias');
    if (btnReordenarEvidencias) {
        btnReordenarEvidencias.addEventListener('click', (e) => activarModoReordenar(e));
    }

    // EXPORTACIÓN
    const btnExportarPDF = document.getElementById('btnExportarPDF');
    if (btnExportarPDF) {
        btnExportarPDF.addEventListener('click', () => showModal('modalExportSummary'));
    }

    const btnConfirmExportPDF = document.getElementById('btnConfirmExportPDF');
    if (btnConfirmExportPDF) {
        btnConfirmExportPDF.addEventListener('click', async function () {
            const exportType = document.querySelector('input[name="exportType"]:checked');

            if (!exportType) {
                drpAlert('Selecciona un tipo de exportacion', 'Exportacion', 'warning');
                return;
            }

            // Validar conclusión si es necesario
            const validation = validateConclusionBeforeExport();
            if (!validation.valid) return;

            const typeValue = exportType.value;

            // EVIDENCIA INDIVIDUAL
            if (typeValue === 'evidence') {
                if (!activeTestId) {
                    drpAlert('No hay ningun test activo', 'Sin prueba', 'warning');
                    return;
                }

                const selectedEvidence = document.querySelector('.evidence-item.selected');
                if (!selectedEvidence) {
                    drpAlert('Selecciona una evidencia primero', 'Sin seleccion', 'warning');
                    return;
                }

                const step = parseInt(selectedEvidence.dataset.step);
                closeModal('modalExportSummary');

                // Llamar a la función de exportación de evidencia individual
                await exportEvidence(step, activeTestId);
            }

            // PRUEBA COMPLETA
            else if (typeValue === 'test') {
                // Obtener prueba seleccionada del dropdown
                const testSelector = document.getElementById('testSelector');
                const selectedTestId = testSelector?.value;

                if (!selectedTestId) {
                    drpAlert('Selecciona una prueba para exportar', 'Exportacion', 'warning');
                    return;
                }

                const selectedTest = tests.find(t => t.id === selectedTestId);
                if (!selectedTest) {
                    drpAlert('Prueba no encontrada', 'Error', 'error');
                    return;
                }

                closeModal('modalExportSummary');

                // Llamar a la función de exportación de test completo
                await exportTest(selectedTestId, validation.conclusion);
            }

            // CARPETA COMPLETA
            else if (typeValue === 'folder') {
                // Obtener carpeta seleccionada del dropdown
                const folderSelector = document.getElementById('folderSelector');
                const selectedFolderId = folderSelector?.value;

                if (!selectedFolderId) {
                    drpAlert('Selecciona una carpeta para exportar', 'Exportacion', 'warning');
                    return;
                }

                const selectedGroup = groups.find(g => g.id === selectedFolderId);
                if (!selectedGroup) {
                    drpAlert('Carpeta no encontrada', 'Error', 'error');
                    return;
                }

                closeModal('modalExportSummary');
                await exportFolder(selectedFolderId, validation.conclusion);
            }

            // PROYECTO COMPLETO
            else if (typeValue === 'project') {
                closeModal('modalExportSummary');
                await exportProject();
            }
        });
    }

    const btnExportarExcel = document.getElementById('btnExportarExcel');
    if (btnExportarExcel) {
        btnExportarExcel.addEventListener('click', (e) => exportToExcel(e));
    }

    const btnGuardarSesion = document.getElementById('btnGuardarSesion');
    if (btnGuardarSesion) {
        btnGuardarSesion.addEventListener('click', () => {
            if (saveToStorage()) {
                showNotification('Sesión guardada correctamente');
            }
        });
    }

    const btnExportarJSON = document.getElementById('btnExportarJSON');
    if (btnExportarJSON) {
        btnExportarJSON.addEventListener('click', (e) => exportSessionJSON(e));
    }

    const btnImportarJSON = document.getElementById('btnImportarJSON');
    if (btnImportarJSON) {
        btnImportarJSON.addEventListener('click', () => {
            document.getElementById('importJSONInput').click();
        });
    }

    // Fase C — Exportar AEX (modo suite)
    const btnExportarAex = document.getElementById('btnExportarAex');
    if (btnExportarAex) {
        btnExportarAex.addEventListener('click', (e) => exportarAex(e));
    }

    // Fase B.2 — Cargar paquete documental completo (multi-file picker)
    const btnCargarPaquete = document.getElementById('btnCargarPaquete');
    if (btnCargarPaquete) {
        btnCargarPaquete.addEventListener('click', () => {
            document.getElementById('loadPackageInput').click();
        });
    }

    const btnClearPackage = document.getElementById('btnClearPackage');
    if (btnClearPackage) {
        btnClearPackage.addEventListener('click', async () => {
            if (packageDocs.length === 0) return;
            const ok = await drpConfirm(
                `Esto vaciará el paquete documental (${packageDocs.length} doc${packageDocs.length > 1 ? 's' : ''}). Los tests/evidencias del runtime NO se tocan.`,
                'Vaciar paquete?', 'warning'
            );
            if (!ok) return;
            clearPackage();
            renderPackagePanel();
            await saveToStorage();
            showNotification('Paquete documental vaciado');
        });
    }

    const btnLimpiarCache = document.getElementById('btnLimpiarCache');
    if (btnLimpiarCache) {
        btnLimpiarCache.addEventListener('click', (e) => clearCache(e));
    }

    // Botones de Audit Trail
    const btnViewAuditTrail = document.getElementById('btnViewAuditTrail');
    if (btnViewAuditTrail && typeof window.AuditTrail !== 'undefined') {
        btnViewAuditTrail.addEventListener('click', () => {
            window.AuditTrail.showAuditTrailViewer();
        });
    }

    const btnExportAuditJSON = document.getElementById('btnExportAuditJSON');
    if (btnExportAuditJSON && typeof window.AuditTrail !== 'undefined') {
        btnExportAuditJSON.addEventListener('click', async () => {
            const success = await window.AuditTrail.downloadAuditTrailJSON();
            if (success) {
                showNotification('Audit Trail JSON exportado correctamente', 'success');
            }
        });
    }

    const btnExportAuditPDF = document.getElementById('btnExportAuditPDF');
    if (btnExportAuditPDF && typeof window.AuditTrail !== 'undefined') {
        btnExportAuditPDF.addEventListener('click', async () => {
            const success = await window.AuditTrail.exportAuditTrailPDF();
            if (success) {
                showNotification('Audit Trail PDF exportado correctamente', 'success');
            }
        });
    }

    const btnVerifyAudit = document.getElementById('btnVerifyAudit');
    if (btnVerifyAudit && typeof window.AuditTrail !== 'undefined') {
        btnVerifyAudit.addEventListener('click', async () => {
            const result = await window.AuditTrail.verifyAuditTrailIntegrity();

            if (result.valid) {
                drpAlert(`${result.message}\n\nTotal de entradas: ${result.totalEntries}`, 'Integridad Verificada', 'success');
            } else {
                drpAlert(`${result.message}\n\nTotal de entradas: ${result.totalEntries}\nEntradas comprometidas: ${result.tamperedEntries.length}`, 'Manipulacion Detectada', 'error');
                console.error('Entradas con problemas:', result.tamperedEntries);
            }
        });
    }

    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            document.querySelector('.left-panel').classList.toggle('collapsed');
        });
    }

    // FINALIZACIÓN
    const btnFinalizarPrueba = document.getElementById('btnFinalizarPrueba');
    if (btnFinalizarPrueba) {
        btnFinalizarPrueba.addEventListener('click', () => showModal('modalFinalizeTest'));
    }

    const btnFinalizarCarpeta = document.getElementById('btnFinalizarCarpeta');
    if (btnFinalizarCarpeta) {
        btnFinalizarCarpeta.addEventListener('click', () => {
            if (projectData.finalized) {
                showNotification('El proyecto ya está finalizado', 'error');
                return;
            }
            const test = tests.find(t => t.id === activeTestId);
            if (!test || !test.groupId) {
                showNotification('Selecciona una prueba de una carpeta', 'error');
                return;
            }
            const grp = groups.find(g => g.id === test.groupId);
            if (grp && grp.finalized) {
                showNotification(`La carpeta "${grp.name}" ya está finalizada`, 'error');
                return;
            }
            showModal('modalFinalizeFolder');
        });
    }

    const btnFinalizarProyecto = document.getElementById('btnFinalizarProyecto');
    if (btnFinalizarProyecto) {
        btnFinalizarProyecto.addEventListener('click', () => {
            if (projectData.finalized) {
                showNotification('El proyecto ya está finalizado', 'error');
                return;
            }
            showModal('modalFinalizeProject');
        });
    }

    // //     console.log('Event listeners de botones inicializados');
}

// Manejar cambio de tipo de exportación (mostrar/ocultar selectores)
const exportTypeRadios = document.querySelectorAll('input[name="exportType"]');
exportTypeRadios.forEach(radio => {
    radio.addEventListener('change', function () {
        const testSelectorContainer = document.getElementById('testSelectorContainer');
        const folderSelectorContainer = document.getElementById('folderSelectorContainer');

        if (this.value === 'test') {
            // Mostrar selector de pruebas
            if (testSelectorContainer) {
                testSelectorContainer.style.display = 'block';
                populateTestSelector();
            }
            if (folderSelectorContainer) {
                folderSelectorContainer.style.display = 'none';
            }
        } else if (this.value === 'folder') {
            // Mostrar selector de carpetas
            if (folderSelectorContainer) {
                folderSelectorContainer.style.display = 'block';
                populateFolderSelector();
            }
            if (testSelectorContainer) {
                testSelectorContainer.style.display = 'none';
            }
        } else {
            // Ocultar todos los selectores
            if (testSelectorContainer) {
                testSelectorContainer.style.display = 'none';
            }
            if (folderSelectorContainer) {
                folderSelectorContainer.style.display = 'none';
            }
        }
    });
});

/**
 * Inicializar listeners de modales
 */
function initModalListeners() {
    // Botones de cancelar (cerrar modales)
    const cancelButtons = document.querySelectorAll('.btn-cancel[data-close]');
    cancelButtons.forEach(btn => {
        const modalId = btn.dataset.close;
        btn.addEventListener('click', () => closeModal(modalId));
    });

    // Botones de confirmación
    const btnConfirmNewProtocol = document.getElementById('btnConfirmNewProtocol');
    if (btnConfirmNewProtocol) {
        btnConfirmNewProtocol.addEventListener('click', (e) => addProtocol(e));
    }

    const btnConfirmNewTest = document.getElementById('btnConfirmNewTest');
    if (btnConfirmNewTest) {
        btnConfirmNewTest.addEventListener('click', (e) => addTest(e));
    }

    const btnSaveEditedTest = document.getElementById('btnSaveEditedTest');
    if (btnSaveEditedTest) {
        btnSaveEditedTest.addEventListener('click', (e) => saveEditedTest(e));
    }

    const btnConfirmNewGroup = document.getElementById('btnConfirmNewGroup');
    if (btnConfirmNewGroup) {
        btnConfirmNewGroup.addEventListener('click', (e) => addGroup(e));
    }

    const btnConfirmEvidence = document.getElementById('btnConfirmEvidence');
    if (btnConfirmEvidence) {
        btnConfirmEvidence.addEventListener('click', (e) => confirmEvidence(e));
    }

    const btnSaveEditedEvidence = document.getElementById('btnSaveEditedEvidence');
    if (btnSaveEditedEvidence) {
        btnSaveEditedEvidence.addEventListener('click', (e) => saveEditedEvidence(e));
    }

    const btnConfirmAddTable = document.getElementById('btnConfirmAddTable');
    if (btnConfirmAddTable) {
        btnConfirmAddTable.addEventListener('click', (e) => addTable(e));
    }

    const btnConfirmImageEditor = document.getElementById('btnConfirmImageEditor');
    if (btnConfirmImageEditor) {
        btnConfirmImageEditor.addEventListener('click', (e) => confirmImageEditor(e));
    }

    const btnConfirmFinalizeTest = document.getElementById('btnConfirmFinalizeTest');
    if (btnConfirmFinalizeTest) {
        btnConfirmFinalizeTest.addEventListener('click', (e) => finalizeTest(e));
    }

    const btnConfirmFinalizeFolder = document.getElementById('btnConfirmFinalizeFolder');
    if (btnConfirmFinalizeFolder) {
        btnConfirmFinalizeFolder.addEventListener('click', (e) => finalizeFolder(e));
    }

    const btnConfirmFinalizeProject = document.getElementById('btnConfirmFinalizeProject');
    if (btnConfirmFinalizeProject) {
        btnConfirmFinalizeProject.addEventListener('click', (e) => finalizeProject(e));
    }

    // Editor de tabla avanzado
    const btnSaveTableChanges = document.getElementById('btnSaveTableChanges');
    if (btnSaveTableChanges) {
        btnSaveTableChanges.addEventListener('click', (e) => saveTableChanges(e));
    }

    // Toggle header en editor de tabla
    const editTableHasHeader = document.getElementById('editTableHasHeader');
    if (editTableHasHeader) {
        editTableHasHeader.addEventListener('change', function () {
            if (currentEditingTableData) {
                currentEditingTableData.hasHeader = this.checked;

                // Si se activa header y la primera fila está vacía, agregar nombres por defecto
                if (this.checked && currentEditingTableData.data[0]) {
                    const cols = currentEditingTableData.data[0].length;
                    for (let c = 0; c < cols; c++) {
                        if (!currentEditingTableData.data[0][c]) {
                            currentEditingTableData.data[0][c] = `Columna ${c + 1}`;
                        }
                    }
                }

                renderEditingTable();
            }
        });
    }

    // SELECCIÓN DE EVIDENCIAS PARA EXPORTACIÓN
    document.addEventListener('click', (e) => {
        if (e.target.closest('.evidence-item')) {
            const evidenceItem = e.target.closest('.evidence-item');

            // Remover selección previa
            document.querySelectorAll('.evidence-item').forEach(item => {
                item.classList.remove('selected');
            });

            // Agregar selección actual
            evidenceItem.classList.add('selected');

            // Guardar step en el elemento
            const img = evidenceItem.querySelector('.evidence-image');
            if (img) {
                evidenceItem.dataset.step = img.dataset.step;
            }
        }
    });

    // Enter para confirmar en modales
    document.getElementById('newTestName')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTest();
    });

    document.getElementById('newGroupName')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addGroup();
    });

    document.getElementById('evidenceDescription')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) confirmEvidence();
    });


    // Click fuera del modal para cerrar
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('active');
            }
        });
    });

    // //     console.log('Event listeners de modales inicializados');
}

/**
 * Inicializar captura de Ctrl+V
 */
function initPasteListener() {
    document.addEventListener('paste', function (e) {
        if (!activeTestId) return;
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                handlePaste(blob);
                e.preventDefault();
                break;
            }
        }
    });

    // F9 — capturar siguiente paso vacío desde el stream activo
    // (Ctrl+Shift+C no se usa porque Chrome lo intercepta para DevTools)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'F9') {
            e.preventDefault();
            captureNextEmpty();
        }
    });
}

/**
 * Inicializar drag & drop global
 */
function initDragDropGlobal() {
    const dropZone = document.getElementById('dropZone');

    // Mostrar overlay al arrastrar archivos
    document.addEventListener('dragenter', function (e) {
        if (e.dataTransfer.types.includes('Files') && activeTestId) {
            dropZone.classList.add('active');
        }
    });

    // Ocultar overlay al salir
    dropZone.addEventListener('dragleave', function (e) {
        if (e.target === this) {
            this.classList.remove('active');
        }
    });

    // Prevenir comportamiento por defecto
    dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
    });

    // Manejar drop
    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('active');

        if (!activeTestId) {
            showNotification('Selecciona una prueba primero', 'error');
            return;
        }

        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));

        if (files.length === 0) {
            showNotification('No se detectaron imágenes', 'error');
            return;
        }

        if (files.length === 1) {
            // Una sola imagen - procesamiento directo
            handleImageUpload(files[0]);
        } else {
            // Múltiples imágenes - modal de importación
            handleMultipleImages(files);
        }
    });

    // //     console.log('Drag & drop global inicializado');
}

/* ====================================================================
   FUNCIONES DE MODALES
   ==================================================================== */

/**
 * Mostrar modal
 */
/**
 * Mostrar modal
 */
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');

        // Si es el modal de nueva prueba, actualizar select de grupos + limpiar inputs + refrescar datalists
        if (modalId === 'modalNewTest') {
            updateGroupSelects();
            const nameInput = document.getElementById('newTestName');
            const tcIdInput = document.getElementById('newTestTcId');
            if (nameInput) nameInput.value = '';
            if (tcIdInput) tcIdInput.value = '';
            if (typeof refreshTestDataDatalists === 'function') refreshTestDataDatalists();
        }

        // Focus en primer input si existe
        const firstInput = modal.querySelector('input, textarea');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    }

    if (modalId === 'modalFinalizeTest') {
        if (typeof initFinalizarPruebaHandlers === 'function') {
            initFinalizarPruebaHandlers();

            if (activeTestId) {
                const test = tests.find(t => t.id === activeTestId);
                if (test) {
                    // Cargar conclusion guardada si existe
                    if (test.conclusion) {
                        document.getElementById('testConclusion').value = test.conclusion;
                        initFinalizarPruebaHandlers();
                    }
                    // Regla GxP: el resultado se computa siempre desde las evidencias.
                    // Si alguna evidencia es NO PASA → NO PASA.
                    // Si alguna es PASA CON OBSERVACIONES (y ninguna NO PASA) → PASA CON OBSERVACIONES.
                    // Si todas son NO APLICA → NO APLICA. De lo contrario → PASA.
                    const validEvs = test.evidences.filter(e => !e.isEmpty);
                    const hasNoPasa = validEvs.some(e => (e.resultado || 'PASA') === 'NO PASA');
                    const hasObs    = validEvs.some(e => (e.resultado || 'PASA') === 'PASA CON OBSERVACIONES');
                    const allNa     = validEvs.length > 0 && validEvs.every(e => (e.resultado || '') === 'NO APLICA');
                    const computed  = hasNoPasa ? 'NO PASA'
                        : hasObs   ? 'PASA CON OBSERVACIONES'
                        : allNa    ? 'NO APLICA'
                        : 'PASA';
                    const sel = document.getElementById('testResultado');
                    if (sel) sel.value = computed;
                }
            }
        }
    }

    // Si es el modal de exportar proyecto, pre-llenar y inicializar contadores
    if (modalId === 'modalExportProject') {
        // Pre-llenar desde datos guardados previamente
        prefillProjectExportModal();

        // Agregar listeners para contadores
        const projectMarcoReg = document.getElementById('projectMarcoReg');
        const projectAlcance = document.getElementById('projectAlcance');
        const projectConclusion = document.getElementById('projectConclusion');

        if (projectMarcoReg) {
            projectMarcoReg.removeEventListener('input', updateProjectCharCounters);
            projectMarcoReg.addEventListener('input', updateProjectCharCounters);
        }
        if (projectAlcance) {
            projectAlcance.removeEventListener('input', updateProjectCharCounters);
            projectAlcance.addEventListener('input', updateProjectCharCounters);
        }

        // Actualizar contadores con valores pre-llenados
        updateProjectCharCounters();
    }
}

/**
 * Cerrar modal
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');

        // Resetear el scope del modal de finalizar (puede haber quedado en kind=protocol)
        if (modalId === 'modalFinalizeProject') {
            pendingFinalize = null;
            window.pendingFinalize = null;
            const h3 = modal.querySelector('h3');
            if (h3 && h3.textContent.startsWith('Finalizar Protocolo:')) {
                h3.textContent = 'Finalizar Proyecto';
            }
        }

        // No limpiar el modal de exportar proyecto (los datos se persisten)
        if (modalId === 'modalExportProject') return;

        // Limpiar inputs si es necesario
        const inputs = modal.querySelectorAll('input[type="text"], textarea');
        inputs.forEach(input => {
            if (!input.id.includes('system') && !input.id.includes('ejecutor')) {
                input.value = '';
            }
        });
    }
}

/* ====================================================================
   FUNCIONES DE NOTIFICACIONES
   ==================================================================== */

/**
 * Mostrar notificación
 * @param {string} message - Mensaje a mostrar
 * @param {string} type - Tipo: 'info', 'error', 'warning'
 */
function showNotification(message, type = 'info', duration = 3500) {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    container.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(40px)';
        notification.style.transition = 'opacity 0.3s, transform 0.3s';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, duration);
}

/**
 * Dialog custom estilizado — reemplazo de alert() nativo
 * Retorna Promise que se resuelve cuando el usuario cierra el dialog
 */
function drpAlert(message, title, type = 'info') {
    return new Promise(resolve => {
        const iconSvg = {
            info: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
            warning: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            error: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            success: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        };

        // Detectar tema ambient activo para pintar el dialog en el color de la suite
        const themeMatch = document.body.className.match(/body-theme-(project|validation|evidence|compare|book)/);
        const themeClass = themeMatch ? ` drp-dialog-theme-${themeMatch[1]}` : '';

        const overlay = document.createElement('div');
        overlay.className = 'drp-dialog-overlay';
        overlay.innerHTML = `
            <div class="drp-dialog${themeClass}">
                <div class="drp-dialog-icon ${type}">${iconSvg[type] || iconSvg.info}</div>
                <div class="drp-dialog-title">${title || (type === 'error' ? 'Error' : type === 'warning' ? 'Advertencia' : 'Información')}</div>
                <div class="drp-dialog-message">${message}</div>
                <div class="drp-dialog-actions">
                    <button class="drp-dialog-btn-ok" id="drpDialogOk">Aceptar</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const okBtn = overlay.querySelector('#drpDialogOk');
        okBtn.focus();

        const close = () => { overlay.remove(); resolve(); };
        okBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape' || e.key === 'Enter') { document.removeEventListener('keydown', esc); close(); }
        });
    });
}

/**
 * Dialog custom estilizado — reemplazo de confirm() nativo
 * Retorna Promise<boolean>
 */
function drpConfirm(message, title, type = 'confirm') {
    return new Promise(resolve => {
        const iconSvg = {
            confirm: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
            warning: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            danger: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        };

        const isDanger = type === 'danger';

        // Detectar tema activo del body para pintar el popup en el color de la
        // suite que lo dispara (project/validation/evidence/compare/book).
        // Si no hay tema activo, se renderiza neutro como antes.
        const themeMatch = document.body.className.match(/body-theme-(project|validation|evidence|compare|book)/);
        const themeClass = themeMatch ? ` drp-dialog-theme-${themeMatch[1]}` : '';

        const overlay = document.createElement('div');
        overlay.className = 'drp-dialog-overlay';
        overlay.innerHTML = `
            <div class="drp-dialog${themeClass}">
                <div class="drp-dialog-icon ${type}">${iconSvg[type] || iconSvg.confirm}</div>
                <div class="drp-dialog-title">${title || 'Confirmar accion'}</div>
                <div class="drp-dialog-message">${message}</div>
                <div class="drp-dialog-actions">
                    <button class="drp-dialog-btn-cancel" id="drpDialogCancel">Cancelar</button>
                    <button class="${isDanger ? 'drp-dialog-btn-danger' : 'drp-dialog-btn-ok'}" id="drpDialogOk">${isDanger ? 'Eliminar' : 'Confirmar'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.querySelector('#drpDialogOk').focus();

        const close = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('#drpDialogOk').addEventListener('click', () => close(true));
        overlay.querySelector('#drpDialogCancel').addEventListener('click', () => close(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(false); }
        });
    });
}

/**
 * drpPrompt — reemplazo themed del prompt() nativo.
 * Devuelve Promise<string|null> (null si el user cancela / cierra).
 * opts: { defaultValue, isPassword, placeholder, okLabel, cancelLabel }
 *
 * Lleva z-index 2147483646 (uno menos que MAX_SAFE_INTEGER) para garantizar
 * que aparece encima de cualquier modal abierto (el prompt nativo quedaba
 * atrás de modales con z-index alto).
 */
function drpPrompt(message, title, opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const themeMatch = document.body.className.match(/body-theme-(project|validation|evidence|compare|book)/);
        const themeClass = themeMatch ? ' drp-dialog-theme-' + themeMatch[1] : '';
        const inputType = opts.isPassword ? 'password' : 'text';
        const defaultVal = String(opts.defaultValue == null ? '' : opts.defaultValue);
        const placeholder = opts.placeholder || '';
        const okLabel = opts.okLabel || 'Aceptar';
        const cancelLabel = opts.cancelLabel || 'Cancelar';

        const overlay = document.createElement('div');
        overlay.className = 'drp-dialog-overlay';
        overlay.style.zIndex = '2147483646';
        overlay.innerHTML =
            '<div class="drp-dialog' + themeClass + '">' +
              '<div class="drp-dialog-icon confirm">' +
                '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
              '</div>' +
              '<div class="drp-dialog-title"></div>' +
              '<div class="drp-dialog-message"></div>' +
              '<input class="drp-dialog-input" type="' + inputType + '" autocomplete="off" />' +
              '<div class="drp-dialog-actions">' +
                '<button class="drp-dialog-btn-cancel"></button>' +
                '<button class="drp-dialog-btn-ok"></button>' +
              '</div>' +
            '</div>';
        overlay.querySelector('.drp-dialog-title').textContent = title || 'Ingresar valor';
        overlay.querySelector('.drp-dialog-message').textContent = message || '';
        const input = overlay.querySelector('.drp-dialog-input');
        input.value = defaultVal;
        if (placeholder) input.placeholder = placeholder;
        overlay.querySelector('.drp-dialog-btn-cancel').textContent = cancelLabel;
        overlay.querySelector('.drp-dialog-btn-ok').textContent = okLabel;

        document.body.appendChild(overlay);
        setTimeout(() => { input.focus(); input.select(); }, 30);

        const close = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('.drp-dialog-btn-ok').addEventListener('click', () => close(input.value));
        overlay.querySelector('.drp-dialog-btn-cancel').addEventListener('click', () => close(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); close(input.value); }
            else if (e.key === 'Escape') { e.preventDefault(); close(null); }
        });
    });
}
window.drpPrompt = drpPrompt;
window.drpBuildAexFromGestor = buildAexFromGestor;

/* ====================================================================
   MÓDULO 0: GESTIÓN DE PROTOCOLOS (NIVEL 1)
   ==================================================================== */

/**
 * Crear nuevo protocolo
 */
function addProtocol() {
    const protocolName = document.getElementById('newProtocolName').value.trim();
    const protocolCode = document.getElementById('newProtocolCode').value.trim();
    const protocolType = document.getElementById('newProtocolType').value;

    if (!protocolName) {
        showNotification('Ingresa un nombre para el protocolo', 'error');
        return;
    }

    if (!protocolCode) {
        showNotification('Ingresa un código para el protocolo', 'error');
        return;
    }

    if (!isNameUnique(protocolName, protocols)) {
        showNotification('Ya existe un protocolo con ese nombre', 'warning');
    }

    const newProtocol = {
        id: 'protocol_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: protocolName,
        code: protocolCode,
        type: protocolType,
        collapsed: false,
        finalized: false,
        conclusion: '',
        resultado: ''
    };

    protocols.push(newProtocol);
    renderTests();
    closeModal('modalNewProtocol');

    // Seleccionar automáticamente el nuevo protocolo
    activeProtocolId = newProtocol.id;

    showNotification('Protocolo creado: ' + protocolName);
    saveToStorage();
}

/**
 * Eliminar protocolo
 */
async function deleteProtocol(protocolId) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol) return;

    const groupsInProtocol = groups.filter(g => g.protocolId === protocolId);

    // Verificar si algún grupo tiene pruebas
    const groupsWithTests = groupsInProtocol.filter(g => tests.some(t => t.groupId === g.id));
    if (groupsWithTests.length > 0) {
        const total = groupsWithTests.reduce((n, g) => n + tests.filter(t => t.groupId === g.id).length, 0);
        showNotification(`No se puede eliminar: hay ${total} prueba(s) cargada(s). Eliminá las pruebas primero.`, 'error');
        return;
    }

    const msg = groupsInProtocol.length > 0
        ? `Se eliminará el protocolo "${protocol.name}" y sus ${groupsInProtocol.length} carpeta(s) vacía(s).`
        : `Se eliminará el protocolo "${protocol.name}".`;
    if (!await drpConfirm(msg, 'Eliminar protocolo?', 'danger')) return;

    // Cascade: eliminar grupos vacíos del protocolo
    if (groupsInProtocol.length > 0) {
        const groupIds = new Set(groupsInProtocol.map(g => g.id));
        groups = groups.filter(g => !groupIds.has(g.id));
    }

    protocols = protocols.filter(p => p.id !== protocolId);

    if (activeProtocolId === protocolId) {
        activeProtocolId = null;
    }

    renderTests();
    showNotification('Protocolo eliminado');
    saveToStorage();
}

/**
 * Editar nombre de protocolo
 */
function editProtocolName(protocolId) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol) return;

    const newName = prompt('Nuevo nombre del protocolo:', protocol.name);

    if (newName && newName.trim() !== '') {
        protocol.name = newName.trim();
        renderTests();
        showNotification('Nombre actualizado');
        saveToStorage();
    }
}

/**
 * Editar código de protocolo
 */
function editProtocolCode(protocolId) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol) return;

    const newCode = prompt('Nuevo código del protocolo:', protocol.code);
    if (newCode && newCode.trim() !== '') {
        protocol.code = newCode.trim();
        renderTests();
        showNotification('Código actualizado');
        saveToStorage();
    }
}

/**
 * Editar tipo de protocolo (IQ/OQ/PQ)
 */
function editProtocolType(protocolId) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol) return;

    let html = `<div style="padding: 20px;">
        <h3 style="margin-bottom: 15px;">Cambiar tipo de "${protocol.name}"</h3>
        <p style="margin-bottom: 15px; color: var(--vsc-gris); font-size: 12px;">Tipo actual: <strong>${protocol.type}</strong></p>
        <div style="display: flex; flex-direction: column; gap: 8px;">`;

    ['IQ', 'OQ', 'PQ'].forEach(type => {
        const isActive = protocol.type === type ? 'background: rgba(194,224,59,0.2); border-color: var(--vsc-verde); font-weight: 700;' : '';
        html += `<button onclick="confirmProtocolType('${protocolId}', '${type}')" style="padding: 12px; border: 1px solid var(--vsc-gris); background: white; border-radius: 6px; cursor: pointer; font-size: 13px; ${isActive}">${type} - ${type === 'IQ' ? 'Calificación de Instalación' : type === 'OQ' ? 'Calificación Operacional' : 'Calificación de Desempeño'}</button>`;
    });

    html += `</div></div>`;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'customModal';
    modal.innerHTML = `<div class="modal-content">${html}</div>`;
    modal.onclick = (e) => { if (e.target === modal) closeCustomModal(); };
    document.body.appendChild(modal);
}

function confirmProtocolType(protocolId, newType) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol) return;
    protocol.type = newType;
    closeCustomModal();
    renderTests();
    showNotification(`Tipo cambiado a ${newType}`);
    saveToStorage();
}

/**
 * Duplicar prueba completa con todas sus evidencias
 */
async function duplicateTest(testId) {
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    const newId = 'test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Clonar evidencias (sin imagen en memoria, se copia desde IndexedDB)
    const clonedEvidences = [];
    for (let i = 0; i < test.evidences.length; i++) {
        const ev = test.evidences[i];
        const cloned = {
            ...ev,
            step: i + 1,
            timestamp: new Date().toISOString()
        };

        // Copiar imagen en IndexedDB si existe
        if (ev.hasImage || ev.image) {
            try {
                const originalImageId = `${testId}_evidence_${ev.step}`;
                const imageData = await getImageFromDB(originalImageId);
                if (imageData) {
                    const newImageId = `${newId}_evidence_${cloned.step}`;
                    await saveImageToDB(newImageId, imageData);
                    cloned.hasImage = true;
                }
            } catch (e) {
                // Si falla la copia de imagen, continuar sin ella
            }
        }
        clonedEvidences.push(cloned);
    }

    const newTest = {
        id: newId,
        name: test.name + ' (copia)',
        groupId: test.groupId,
        evidences: clonedEvidences,
        finalized: false,
        conclusion: '',
        resultado: ''
    };

    tests.push(newTest);
    renderTests();
    selectTest(newId);
    saveToStorage();
    showNotification(`Prueba duplicada: ${newTest.name} (${clonedEvidences.length} evidencias)`);
}

/**
 * Mover evidencia a otra prueba
 */
function showMoveEvidenceModal(evidenceIndex) {
    const sourceTest = tests.find(t => t.id === activeTestId);
    if (!sourceTest) return;

    const evidence = sourceTest.evidences[evidenceIndex];
    if (!evidence) return;

    const availableTests = tests.filter(t => t.id !== activeTestId && !t.finalized);

    if (availableTests.length === 0) {
        showNotification('No hay otras pruebas disponibles (no finalizadas)', 'error');
        return;
    }

    let html = `<div style="padding: 20px;">
        <h3 style="margin-bottom: 10px;">Mover evidencia #${String(evidence.step).padStart(3, '0')}</h3>
        <p style="margin-bottom: 15px; color: var(--vsc-gris); font-size: 12px;">Desde: <strong>${sourceTest.name}</strong></p>
        <p style="margin-bottom: 15px; font-size: 12px;">Selecciona la prueba destino:</p>
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">`;

    availableTests.forEach(t => {
        const folder = groups.find(g => g.id === t.groupId);
        const folderName = folder ? folder.name + ' / ' : '';
        html += `<button onclick="moveEvidenceToTest(${evidenceIndex}, '${t.id}'); closeCustomModal();" style="padding: 10px 12px; border: 1px solid var(--vsc-gris); background: white; border-radius: 6px; cursor: pointer; text-align: left; font-size: 12px;">
            <span style="color: var(--vsc-gris); font-size: 11px;">${folderName}</span>${t.name}
            <span style="color: var(--vsc-gris); font-size: 11px;"> (${t.evidences.filter(e => !e.isEmpty).length} ev.)</span>
        </button>`;
    });

    html += `</div></div>`;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'customModal';
    modal.innerHTML = `<div class="modal-content">${html}</div>`;
    modal.onclick = (e) => { if (e.target === modal) closeCustomModal(); };
    document.body.appendChild(modal);
}

async function moveEvidenceToTest(evidenceIndex, targetTestId) {
    const sourceTest = tests.find(t => t.id === activeTestId);
    const targetTest = tests.find(t => t.id === targetTestId);
    if (!sourceTest || !targetTest) return;

    const evidence = sourceTest.evidences[evidenceIndex];
    if (!evidence) return;

    // Mover imagen en IndexedDB
    if (evidence.hasImage || evidence.image) {
        try {
            const oldImageId = `${sourceTest.id}_evidence_${evidence.step}`;
            const imageData = await getImageFromDB(oldImageId);
            if (imageData) {
                const newStep = targetTest.evidences.length + 1;
                const newImageId = `${targetTest.id}_evidence_${newStep}`;
                await saveImageToDB(newImageId, imageData);
                await deleteImageFromDB(oldImageId);
            }
        } catch (e) { /* continuar */ }
    }

    // Agregar al destino con step correcto
    evidence.step = targetTest.evidences.length + 1;
    targetTest.evidences.push(evidence);

    // Remover del origen y renumerar
    sourceTest.evidences.splice(evidenceIndex, 1);
    sourceTest.evidences.forEach((e, i) => e.step = i + 1);

    renderWorkArea();
    renderTests();
    saveToStorage();
    showNotification(`Evidencia movida a "${targetTest.name}"`);
}

/**
 * Toggle collapse/expand de protocolo
 */
function toggleProtocol(protocolId) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol) return;

    protocol.collapsed = !protocol.collapsed;
    renderTests();
}

/**
 * Seleccionar protocolo activo
 */
function selectProtocol(protocolId) {
    activeProtocolId = protocolId;
    showNotification('Protocolo activo: ' + protocols.find(p => p.id === protocolId)?.name);
}

/* ====================================================================
   MÓDULO 1: GESTIÓN DE PRUEBAS
   ==================================================================== */

/**
 * Crear nueva prueba
 */
// FUNCIÓN 1: addTest (línea ~1358)
// Reemplazar la función completa addTest con esta versión con logs
async function addTest() {
    const testName = document.getElementById('newTestName').value.trim();
    const groupId = document.getElementById('testGroup').value;
    // tcId opcional — si se completa, todas las evidencias de este test heredan testCaseRef = tcId
    const tcId = (document.getElementById('newTestTcId')?.value || '').trim();

    if (!testName) {
        showNotification('Ingresa un nombre para la prueba', 'error');
        return;
    }

    if (!isNameUnique(testName, tests)) {
        showNotification('Ya existe una prueba con ese nombre', 'warning');
    }

    const newTest = {
        id: 'test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: testName,
        tcId: tcId,                  // ← TC formal asociado (PIQ/POQ). Vacío si no aplica.
        groupId: groupId || null,
        evidences: [],
        finalized: false,
        conclusion: '',
        resultado: ''
    };

    // Memorizar tcId para autocompletado en futuros tests
    if (tcId) addRecentTestDataValue('tcIds', tcId);

    // //     console.log('Nuevo test:', newTest);
    // //     console.log('Tests en grupo antes:', tests.filter(t => t.groupId === groupId).length);

    tests.push(newTest);

    // //     console.log('Tests en grupo después:', tests.filter(t => t.groupId === groupId).length);

    renderTests();
    closeModal('modalNewTest');

    // Seleccionar automáticamente el nuevo test
    selectTest(newTest.id);

    showNotification('Prueba creada: ' + testName);
    saveToStorage();
}


/**
 * Eliminar prueba
 */
async function deleteTest(testId) {
    const test = tests.find(t => t.id === testId);

    if (!test) return;

    const evidenceCount = test.evidences.length;
    const confirmMsg = evidenceCount > 0
        ? `Se eliminara "${test.name}" con ${evidenceCount} evidencia(s).`
        : `Se eliminara "${test.name}".`;

    if (!await drpConfirm(confirmMsg, 'Eliminar prueba?', 'danger')) return;

    // Eliminar del array
    tests = tests.filter(t => t.id !== testId);

    // Si era el test activo, limpiar
    if (activeTestId === testId) {
        activeTestId = null;
        renderWorkArea();
    }

    renderTests();
    showNotification('Prueba eliminada');
    saveToStorage();
}

/**
 * Seleccionar prueba activa
 */
function selectTest(testId) {
    activeTestId = testId;
    renderTests(); // Re-renderizar para mostrar activo
    renderWorkArea();
    saveToStorage();
}

/**
 * Editar nombre de prueba
 */
function editTestName(testId) {
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    // Pre-poblar el modal con valores actuales
    const nameInput = document.getElementById('editTestName');
    const tcIdInput = document.getElementById('editTestTcId');
    if (nameInput) nameInput.value = test.name || '';
    if (tcIdInput) tcIdInput.value = test.tcId || '';

    // Recordar qué test estamos editando
    window.editingTestId = testId;

    if (typeof refreshTestDataDatalists === 'function') refreshTestDataDatalists();
    showModal('modalEditTest');
}

function saveEditedTest() {
    const testId = window.editingTestId;
    if (!testId) { closeModal('modalEditTest'); return; }
    const test = tests.find(t => t.id === testId);
    if (!test) { closeModal('modalEditTest'); return; }

    const newName = (document.getElementById('editTestName')?.value || '').trim();
    const newTcId = (document.getElementById('editTestTcId')?.value || '').trim();

    if (!newName) {
        showNotification('El nombre no puede estar vacío', 'error');
        return;
    }

    const tcIdChanged = newTcId !== (test.tcId || '');
    test.name = newName;
    test.tcId = newTcId;

    // Si el TC cambió, sincronizar testCaseRef en evidencias del test que NO tengan
    // un valor distinto previamente cargado (backwards-compat con flujo viejo).
    if (tcIdChanged && newTcId) {
        (test.evidences || []).forEach(ev => {
            if (!ev.testCaseRef) ev.testCaseRef = newTcId;
        });
    }

    if (newTcId) addRecentTestDataValue('tcIds', newTcId);

    closeModal('modalEditTest');
    renderTests();
    if (activeTestId === testId) renderWorkArea();
    showNotification('Prueba actualizada');
    saveToStorage();
    window.editingTestId = null;
}

/**
 * Mover prueba a otra carpeta
 */
function moveTestToGroup(testId, newGroupId) {
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    test.groupId = newGroupId || null;
    renderTests();
    showNotification('Prueba movida');
    saveToStorage();
}

/* ====================================================================
   MÓDULO 2: GESTIÓN DE CARPETAS
   ==================================================================== */

/**
 * Crear nueva carpeta/grupo
 */
function addGroup() {
    const groupName = document.getElementById('newGroupName').value.trim();

    if (!groupName) {
        showNotification('Ingresa un nombre para la carpeta', 'error');
        return;
    }

    if (!isNameUnique(groupName, groups)) {
        showNotification('Ya existe una carpeta con ese nombre', 'warning');
    }

    // CRÍTICO: Vincular al protocolo activo
    if (!activeProtocolId) {
        showNotification('Selecciona un protocolo primero', 'error');
        return;
    }

    const newGroup = {
        id: 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: groupName,
        protocolId: activeProtocolId,  // ← VINCULACIÓN AL PROTOCOLO
        collapsed: false
    };

    groups.push(newGroup);
    renderTests();
    closeModal('modalNewGroup');

    // Actualizar select de grupos en modal de nueva prueba
    updateGroupSelects();

    const protocol = protocols.find(p => p.id === activeProtocolId);
    showNotification(`Carpeta creada en ${protocol.code}: ${groupName}`);
    saveToStorage();
}

/**
 * Eliminar carpeta/grupo
 */
async function deleteGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Validar que no tenga tests asignados
    const testsInGroup = tests.filter(t => t.groupId === groupId);

    if (testsInGroup.length > 0) {
        showNotification(`No se puede eliminar: tiene ${testsInGroup.length} prueba(s) asignada(s)`, 'error');
        return;
    }

    if (!await drpConfirm(`Se eliminara la carpeta "${group.name}".`, 'Eliminar carpeta?', 'danger')) return;

    groups = groups.filter(g => g.id !== groupId);
    renderTests();
    updateGroupSelects();
    showNotification('Carpeta eliminada');
    saveToStorage();
}

/**
 * Editar nombre de carpeta
 */
function editGroupName(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const newName = prompt('Nuevo nombre de la carpeta:', group.name);

    if (newName && newName.trim() !== '') {
        group.name = newName.trim();
        renderTests();
        updateGroupSelects();
        showNotification('Nombre actualizado');
        saveToStorage();
    }
}

/**
 * Mover carpeta a otro protocolo
 */
function moveFolderToProtocol(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    if (protocols.length === 0) {
        showNotification('No hay protocolos disponibles', 'error');
        return;
    }

    let options = 'Selecciona protocolo:\n';
    options += '0. Sin protocolo (raíz)\n';
    protocols.forEach((p, idx) => {
        options += `${idx + 1}. ${p.name}\n`;
    });

    const choice = prompt(options + '\nNúmero:');
    if (choice === null) return;

    const index = parseInt(choice);

    if (index === 0) {
        group.protocolId = null;
        showNotification(`Carpeta movida a raíz`);
    } else if (index > 0 && index <= protocols.length) {
        const targetProtocol = protocols[index - 1];
        group.protocolId = targetProtocol.id;
        showNotification(`Carpeta movida a "${targetProtocol.name}"`);
    } else {
        showNotification('Opción inválida', 'error');
        return;
    }

    renderTests();
    saveToStorage();
}

/**
 * Toggle collapse/expand de carpeta
 */
function toggleGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    group.collapsed = !group.collapsed;
    renderTests();
}

/**
 * Actualizar selects de grupos en modales
 */
function updateGroupSelects() {
    const select = document.getElementById('testGroup');
    if (!select) return;

    // Limpiar opciones actuales (excepto la primera "Sin carpeta")
    select.innerHTML = '<option value="">Sin carpeta</option>';

    // Agregar grupos
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        select.appendChild(option);
    });
}

/* ====================================================================
   RENDERIZADO
   ==================================================================== */

/**
 * Renderizar lista de tests en sidebar
 */
function renderTests() {
    const container = document.getElementById('testsList');
    if (!container) {
    // //         console.error('ERROR: No se encontró contenedor #testsList');
        return;
    }

    // //     console.log('=== RENDERIZANDO TESTS ===');
    // //     console.log('Total protocols:', protocols.length);
    // //     console.log('Total tests:', tests.length);
    // //     console.log('Total groups:', groups.length);

    container.innerHTML = '';

    // JERARQUÍA COMPLETA: PROTOCOLOS → CARPETAS → PRUEBAS

    // Obtener query de búsqueda (necesaria para filtrar también las pruebas sueltas)
    const searchQuery = getSidebarSearchQuery();

    // Pruebas sueltas — sin carpeta o cuya carpeta ya no existe. Se renderizan
    // al tope del sidebar para que el usuario nunca pierda de vista una prueba
    // recién creada con "Sin carpeta". Sin esta sección, los tests huérfanos
    // quedan invisibles en el árbol protocolo→carpeta→prueba.
    const orphanTests = tests.filter(t => !t.groupId || !groups.find(g => g.id === t.groupId));
    let orphanRendered = false;
    if (orphanTests.length > 0) {
        const orphanSection = createOrphanTestsSection(orphanTests, searchQuery);
        if (orphanSection) {
            container.appendChild(orphanSection);
            orphanRendered = true;
        }
    }

    if (protocols.length === 0) {
        // Sin protocolos: aviso al final (no reemplaza las pruebas sueltas si las hay)
        const msg = document.createElement('p');
        msg.style.cssText = 'text-align: center; color: var(--vsc-gris); padding: 20px; font-size: 12px;';
        msg.innerHTML = 'No hay protocolos creados<br><strong>Crea un Protocolo (IQ/OQ/PQ) primero</strong>';
        container.appendChild(msg);
        // Stats al cierre
        const statProtocols = document.getElementById('statProtocols');
        const statTests = document.getElementById('statTests');
        const statEvidences = document.getElementById('statEvidences');
        if (statProtocols) statProtocols.textContent = protocols.length + ' Protocolos';
        if (statTests) statTests.textContent = tests.length + ' Pruebas';
        if (statEvidences) statEvidences.textContent = tests.reduce((sum, t) => sum + t.evidences.filter(e => !e.isEmpty).length, 0) + ' Evidencias';
        return;
    }

    // Renderizar cada PROTOCOLO (filtrado por búsqueda)
    let hasVisibleContent = orphanRendered;
    protocols.forEach(protocol => {
        // Si hay búsqueda, verificar si el protocolo o algún hijo coincide
        if (searchQuery) {
            const protocolMatches = matchesSearch(protocol.name, searchQuery) || matchesSearch(protocol.code, searchQuery);
            const groupsInP = groups.filter(g => g.protocolId === protocol.id);
            const hasMatchingGroup = groupsInP.some(g => matchesSearch(g.name, searchQuery));
            const hasMatchingTest = tests.some(t => {
                const inProtocol = groupsInP.some(g => g.id === t.groupId);
                return inProtocol && matchesTestFilter(t, searchQuery);
            });

            if (!protocolMatches && !hasMatchingGroup && !hasMatchingTest) return;
        }

        const protocolElement = createProtocolElement(protocol, searchQuery);
        container.appendChild(protocolElement);
        hasVisibleContent = true;
    });

    if (searchQuery && !hasVisibleContent) {
        container.innerHTML = `<p style="text-align: center; color: var(--vsc-gris); padding: 20px; font-size: 12px;">Sin resultados para "<strong>${escapeHtml(searchQuery)}</strong>"</p>`;
    }

    // Actualizar stats
    const statProtocols = document.getElementById('statProtocols');
    const statTests = document.getElementById('statTests');
    const statEvidences = document.getElementById('statEvidences');
    if (statProtocols) statProtocols.textContent = protocols.length + ' Protocolos';
    if (statTests) statTests.textContent = tests.length + ' Pruebas';
    if (statEvidences) statEvidences.textContent = tests.reduce((sum, t) => sum + t.evidences.filter(e => !e.isEmpty).length, 0) + ' Evidencias';
}

/**
 * Sección "Pruebas sueltas" — tests sin carpeta o con carpeta inexistente.
 * Se renderiza como un nodo nivel-1 al tope del sidebar, con look ámbar para
 * distinguirla de los protocolos azules. Usa createTestElement para que los
 * tests adentro funcionen igual (click → selectTest, menú contextual, etc.).
 */
function createOrphanTestsSection(orphanTests, searchQuery) {
    let filtered = orphanTests;
    if (searchQuery) {
        filtered = filtered.filter(t => matchesTestFilter(t, searchQuery));
        if (filtered.length === 0) return null;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'protocol-item';

    const header = document.createElement('div');
    header.className = 'protocol-header';
    header.style.background = '#FFF8E1';
    header.style.color = '#B85F0F';
    header.style.borderLeft = '3px solid #F39C12';
    header.innerHTML = `
        <span class="protocol-icon" style="color:#B85F0F;">📋</span>
        <span class="protocol-type" style="color:#B85F0F;">[SUELTAS]</span>
        <span class="protocol-name" style="color:#B85F0F;">Pruebas sueltas</span>
        <span class="protocol-code" style="color:#B85F0F;">${filtered.length}</span>
    `;
    wrapper.appendChild(header);

    const content = document.createElement('div');
    content.className = 'protocol-content';
    filtered.forEach(test => content.appendChild(createTestElement(test)));
    wrapper.appendChild(content);

    return wrapper;
}

/**
 * Crear elemento HTML de PROTOCOLO (Nivel 1)
 */
function createProtocolElement(protocol, searchQuery) {
    const protocolDiv = document.createElement('div');
    protocolDiv.className = 'protocol-item';

    // Header del protocolo
    const header = document.createElement('div');
    header.className = 'protocol-header' + (protocol.id === activeProtocolId ? ' active' : '') + (protocol.finalized ? ' finalized' : '');

    const icon = (protocol.collapsed && !searchQuery) ? '▶' : '▼';
    const typeLabel = `[${protocol.type}]`;
    const finalizedBadge = protocol.finalized
        ? `<span class="protocol-finalized-badge" title="Protocolo finalizado el ${protocol.finalizedDate ? new Date(protocol.finalizedDate).toLocaleDateString('es-AR') : ''}" style="background:#1E7E34;color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px;">FINALIZADO</span>`
        : '';

    header.innerHTML = `
        <span class="protocol-icon" onclick="toggleProtocol('${escapeHtml(protocol.id)}')">${icon}</span>
        <span class="protocol-type">${escapeHtml(typeLabel)}</span>
        <span class="protocol-name" onclick="selectProtocol('${escapeHtml(protocol.id)}')">${escapeHtml(protocol.name)}</span>
        <span class="protocol-code">${escapeHtml(protocol.code)}</span>
        ${finalizedBadge}
        <button class="test-menu-btn" onclick="showProtocolContextMenu(event, '${escapeHtml(protocol.id)}')">⋮</button>
    `;

    protocolDiv.appendChild(header);

    // Contenido del protocolo (carpetas + pruebas) — expandir si hay búsqueda
    if (!protocol.collapsed || searchQuery) {
        const content = document.createElement('div');
        content.className = 'protocol-content';

        // Filtrar carpetas de este protocolo
        let groupsInProtocol = groups.filter(g => g.protocolId === protocol.id);

        // Filtrar por búsqueda
        if (searchQuery) {
            groupsInProtocol = groupsInProtocol.filter(g => {
                if (matchesSearch(g.name, searchQuery)) return true;
                return tests.some(t => t.groupId === g.id && matchesTestFilter(t, searchQuery));
            });
        }

        if (groupsInProtocol.length === 0 && !searchQuery) {
            content.innerHTML = `
                <p style="color: var(--vsc-gris); font-size: 11px; padding: 15px 10px; text-align: center; font-style: italic;">
                    Sin carpetas - Crea una carpeta para empezar
                </p>
            `;
        } else {
            // Renderizar cada carpeta dentro del protocolo
            groupsInProtocol.forEach(group => {
                content.appendChild(createGroupElement(group, searchQuery));
            });
        }

        protocolDiv.appendChild(content);
    }

    return protocolDiv;
}

/**
 * Crear elemento HTML de carpeta
 */
// FUNCIÓN 2: createGroupElement (línea ~1711)
// Reemplazar la función completa createGroupElement con esta versión con logs
function createGroupElement(group, searchQuery) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'group-item';

    // Header de carpeta — siempre mostrar menú contextual (incluso finalizadas, para reabrir)
    const header = document.createElement('div');
    header.className = 'group-header' + (group.finalized ? ' finalized' : '');
    const folderFinTag = group.finalized ? ' <span style="color:#388E3C;font-size:10px;font-weight:700;">[FINALIZADA]</span>' : '';
    header.innerHTML = `
        <span>${(group.collapsed && !searchQuery) ? '▶' : '▼'}</span>
        <span>${escapeHtml(group.name)}${folderFinTag}</span>
        <button class="test-menu-btn" onclick="showGroupContextMenu(event, '${escapeHtml(group.id)}')">⋮</button>
    `;

    header.addEventListener('click', (e) => {
        if (e.target.classList.contains('test-menu-btn')) return;
        toggleGroup(group.id);
    });

    groupDiv.appendChild(header);

    // Contenido (tests de la carpeta) — expandir si hay búsqueda
    if (!group.collapsed || searchQuery) {
        const content = document.createElement('div');
        content.className = 'group-content';

        let testsInGroup = tests.filter(t => t.groupId === group.id);

        // Filtrar por búsqueda (soporta IDs: URS-NNN, RA-NNN, COMP-NN, TC-NNN)
        if (searchQuery) {
            testsInGroup = testsInGroup.filter(t => matchesTestFilter(t, searchQuery));
        }

        if (testsInGroup.length === 0 && !searchQuery) {
            content.innerHTML = '<p style="color: var(--vsc-gris); font-size: 11px; padding: 10px; text-align: center;">Sin pruebas</p>';
        } else {
            testsInGroup.forEach(test => {
                content.appendChild(createTestElement(test));
            });
        }

        groupDiv.appendChild(content);
    }

    return groupDiv;
}

/**
 * Crear elemento HTML de test
 */
function createTestElement(test) {
    const testDiv = document.createElement('div');
    testDiv.className = 'test-item' + (test.id === activeTestId ? ' active' : '');

    const evidenceCount = test.evidences.filter(e => !e.isEmpty).length;
    const finalized = test.finalized ? ' [FINALIZADO]' : '';
    // Si el test tiene un TC formal asociado, mostrarlo como prefijo en azul.
    const tcBadge = test.tcId
        ? `<span class="test-item-tcid" style="color: #1F3C56; font-weight: 700; font-size: 11px; margin-right: 6px;">[${escapeHtml(test.tcId)}]</span>`
        : '';

    testDiv.innerHTML = `
        <div class="test-item-header">
            <span class="test-item-icon">📋</span>
            <span>${tcBadge}${escapeHtml(test.name)}${finalized}</span>
            <span class="test-item-count">${evidenceCount}</span>
        </div>
        <button class="test-menu-btn" onclick="showTestContextMenu(event, '${escapeHtml(test.id)}')">⋮</button>
    `;

    // Click para seleccionar
    testDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('test-menu-btn')) return;
        selectTest(test.id);
    });

    return testDiv;
}

/**
 * Mostrar menú contextual de test
 */
function showTestContextMenu(event, testId) {
    event.stopPropagation();

    // Eliminar menús existentes
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    // Crear menú
    const menu = document.createElement('div');
    menu.className = 'context-menu active';

    const test = tests.find(t => t.id === testId);
    const parentGrp = test ? groups.find(g => g.id === test.groupId) : null;
    const parentProto = getProtocolOfGroup(parentGrp);
    const protoLocked = !!(parentProto && parentProto.finalized);
    const isLocked = projectData.finalized || protoLocked || (parentGrp && parentGrp.finalized);
    let items = '';

    if (isLocked) {
        const reason = projectData.finalized ? 'proyecto' : protoLocked ? 'protocolo' : 'carpeta';
        items = `<button disabled>Bloqueado (${reason} finalizado)</button>`;
    } else if (test && test.finalized) {
        items = `
            <button onclick="duplicateTest('${testId}')">Duplicar Prueba</button>
            <button onclick="moveTestUp('${testId}')">Subir</button>
            <button onclick="moveTestDown('${testId}')">Bajar</button>
        `;
    } else {
        items = `
            <button onclick="editTestName('${testId}')">Editar (nombre + TC)</button>
            <button onclick="showMoveTestModal('${testId}')">Mover a carpeta</button>
            <button onclick="duplicateTest('${testId}')">Duplicar Prueba</button>
            <button onclick="moveTestUp('${testId}')">Subir</button>
            <button onclick="moveTestDown('${testId}')">Bajar</button>
            <button onclick="deleteTest('${testId}')" style="color:var(--vsc-rojo);">Eliminar</button>
        `;
    }

    menu.innerHTML = items;

    // Posicionar
    menu.style.position = 'absolute';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';

    document.body.appendChild(menu);

    // Cerrar al hacer click fuera
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 100);
}

/**
 * Mostrar menú contextual de carpeta
 */
/**
 * Mostrar menú contextual de protocolo
 */
function showProtocolContextMenu(event, protocolId) {
    event.stopPropagation();

    // Eliminar menús existentes
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    // Crear menú
    const menu = document.createElement('div');
    menu.className = 'context-menu active';

    const proto = protocols.find(p => p.id === protocolId);
    const isFinalized = !!(proto && proto.finalized);
    const projectLocked = !!(projectData && projectData.finalized);

    let items = '';

    // Opciones de edición — bloqueadas si el protocolo o el proyecto está finalizado
    if (!isFinalized && !projectLocked) {
        items += `<button onclick="editProtocolName('${protocolId}')">Renombrar</button>`;
        items += `<button onclick="editProtocolCode('${protocolId}')">Editar Código</button>`;
        items += `<button onclick="editProtocolType('${protocolId}')">Cambiar Tipo</button>`;
        items += `<hr class="ctx-sep">`;
    }

    // Acciones de ciclo de vida del protocolo
    if (!isFinalized && !projectLocked) {
        items += `<button onclick="finalizeProtocol('${protocolId}')" style="color:#1E7E34;font-weight:600;">Finalizar Protocolo</button>`;
    } else if (isFinalized && !projectLocked) {
        items += `<button onclick="reopenProtocol('${protocolId}')" style="color:#B85F0F;">Reabrir Protocolo</button>`;
    } else if (projectLocked) {
        items += `<button disabled style="color:var(--vsc-gris);">Proyecto finalizado — sin acciones</button>`;
    }

    // Eliminar — solo si no está finalizado
    if (!isFinalized && !projectLocked) {
        items += `<hr class="ctx-sep">`;
        items += `<button onclick="deleteProtocol('${protocolId}')" style="color:var(--vsc-rojo);">Eliminar</button>`;
    }

    menu.innerHTML = items;

    // Posicionar
    menu.style.position = 'absolute';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';

    document.body.appendChild(menu);

    // Cerrar al hacer click fuera
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 100);
}

/**
 * Mostrar menú contextual de carpeta
 */
function showGroupContextMenu(event, groupId) {
    event.stopPropagation();

    // Eliminar menús existentes
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    // Crear menú
    const menu = document.createElement('div');
    menu.className = 'context-menu active';

    const grp = groups.find(g => g.id === groupId);
    const grpProto = getProtocolOfGroup(grp);
    const protoLocked = !!(grpProto && grpProto.finalized);
    const grpLocked = !!(projectData && projectData.finalized) || protoLocked;
    const grpFinalized = grp && grp.finalized;
    const lockReason = (projectData && projectData.finalized) ? 'proyecto' : protoLocked ? 'protocolo' : '';

    let items = '';

    if (grpFinalized && !grpLocked) {
        items += `<button onclick="reopenFolder('${groupId}')">Reabrir Carpeta</button>`;
    }

    if (!grpFinalized && !grpLocked) {
        items += `
            <button onclick="editGroupName('${groupId}')">Renombrar</button>
            <button onclick="moveFolderToProtocol('${groupId}')">Mover a Protocolo</button>
            <button onclick="moveGroupUp('${groupId}')">Subir</button>
            <button onclick="moveGroupDown('${groupId}')">Bajar</button>
            <button onclick="deleteGroup('${groupId}')" style="color:var(--vsc-rojo);">Eliminar</button>
        `;
    }

    if (grpLocked) {
        items = `<button disabled>Bloqueado (${lockReason} finalizado)</button>`;
        if (!grpFinalized) {
            // Caso raro pero posible
        }
    }

    menu.innerHTML = items;

    // Posicionar
    menu.style.position = 'absolute';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';

    document.body.appendChild(menu);

    // Cerrar al hacer click fuera
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 100);
}

/**
 * Mostrar modal para mover test a otra carpeta
 */
function showMoveTestModal(testId) {
    const test = tests.find(t => t.id === testId);
    if (!test) return;

    let html = `<div style="padding: 20px;">
        <h3 style="margin-bottom: 20px;">Mover "${test.name}" a:</h3>
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <button onclick="moveTestToGroup('${testId}', null); closeCustomModal();" style="padding: 12px; border: 1px solid var(--vsc-gris); background: white; border-radius: 6px; cursor: pointer;">
                Sin carpeta
            </button>`;

    groups.forEach(group => {
        html += `
            <button onclick="moveTestToGroup('${testId}', '${group.id}'); closeCustomModal();" style="padding: 12px; border: 1px solid var(--vsc-gris); background: white; border-radius: 6px; cursor: pointer;">
                ${group.name}
            </button>`;
    });

    html += `</div></div>`;

    // Crear modal temporal
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'customModal';
    modal.innerHTML = `<div class="modal-content">${html}</div>`;
    modal.onclick = (e) => {
        if (e.target === modal) closeCustomModal();
    };

    document.body.appendChild(modal);
}

/**
 * Cerrar modal custom
 */
function closeCustomModal() {
    const modal = document.getElementById('customModal');
    if (modal) modal.remove();
}

/**
 * Renderizar área de trabajo
 */
function renderWorkArea() {
    const container = document.getElementById('workArea');
    if (!container) return;

    // Si no hay test activo
    if (!activeTestId) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Selecciona una prueba para comenzar</p>
                <p>o crea una nueva desde el menú GESTIÓN</p>
            </div>
        `;
        return;
    }

    const test = tests.find(t => t.id === activeTestId);

    if (!test) {
        activeTestId = null;
        renderWorkArea();
        return;
    }

    // Header del test
    let html = `
        <div style="background: white; padding: 20px; border-radius: 6px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h2 style="color: var(--vsc-azul); margin-bottom: 10px;">${test.name}</h2>
                    <div style="display: flex; gap: 20px; font-size: 12px; color: var(--vsc-gris);">
                        <span>Evidencias: ${test.evidences.filter(e => !e.isEmpty).length}</span>
                        <span>Estado: ${test.finalized ? 'FINALIZADO' : 'En progreso'}</span>
                    </div>
                </div>
                ${test.finalized ? (() => {
                    const parentGrp = groups.find(g => g.id === test.groupId);
                    const parentProto = getProtocolOfGroup(parentGrp);
                    const protoLocked = !!(parentProto && parentProto.finalized);
                    const grpLocked = !!(parentGrp && parentGrp.finalized);
                    const projLocked = !!(projectData && projectData.finalized);
                    const locked = projLocked || protoLocked || grpLocked;
                    const reason = projLocked ? 'proyecto' : protoLocked ? 'protocolo' : grpLocked ? 'carpeta' : '';
                    return locked
                        ? `<span style="background:#E8F5E9;color:#388E3C;padding:8px 16px;border-radius:4px;font-weight:600;font-size:12px;">🔒 Cerrada (${reason} finalizado)</span>`
                        : `<button onclick="reopenTest()" style="background: var(--vsc-verde); color: var(--vsc-azul); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 13px;">🔓 Reabrir prueba</button>`;
                })() : ''}
            </div>
        </div>
    `;

    // Panel de guía del protocolo (solo si el test viene de PIQ/POQ/PPQ)
    if (test.protocolGuidance) {
        html += renderProtocolGuidancePanel(test.protocolGuidance, test.protocolSource);
    }

    // Fase B.4 — Panel de trazabilidad (solo si hay packageDocs cargado Y el test tiene tcId)
    if (test.tcId && Array.isArray(packageDocs) && packageDocs.length > 0
        && window.ValidationSuite && window.ValidationSuite.tracer) {
        html += renderTraceabilityPanel(test.tcId);
    }

    // Calcular isLocked antes de renderizar evidencias (necesario para el toolbar)
    const isLocked = !!(projectData && projectData.finalized) ||
        !!(groups.find(g => g.id === test.groupId) && groups.find(g => g.id === test.groupId).finalized) ||
        test.finalized;

    // Evidencias
    // Auto-inicializar con un slot vacío al abrir un TC sin evidencias
    if (test.evidences.length === 0 && !isLocked) {
        test.evidences.push({
            step: 1,
            description: 'Evidencia pendiente',
            operacion: '',
            resultado: '',
            timestamp: null,
            captureTimestamp: null,
            size: null,
            dimensions: null,
            testName: test.name,
            executor: typeof executor !== 'undefined' ? executor : '',
            isEmpty: true,
            hasImage: false,
            image: null
        });
        saveToStorage();
    }

    if (test.evidences.length === 0) {
        html += `
            <div class="empty-state">
                <p>No hay evidencias en esta prueba</p>
                <p>Presiona Ctrl+V para pegar un screenshot</p>
                <p>o usa el menú CAPTURA para agregar imágenes</p>
            </div>
        `;
    } else {
        // Toolbar de asignación en batch (solo si hay al menos una evidencia con imagen y el test no está bloqueado)
        const hasImages = test.evidences.some(e => !e.isEmpty && e.image);
        if (!isLocked && hasImages) {
            html += `
    <div class="batch-toolbar">
        <span class="batch-label">Marcar todos:</span>
        <button class="batch-btn batch-pasa" onclick="batchSetResultado('PASA', false)">✓ PASA</button>
        <button class="batch-btn batch-nopasa" onclick="batchSetResultado('NO PASA', false)">✗ NO PASA</button>
        <button class="batch-btn batch-obs" onclick="batchSetResultado('PASA CON OBSERVACIONES', false)">⚠ CON OBS</button>
        <button class="batch-btn batch-na" onclick="batchSetResultado('NO APLICA', false)">— NO APLICA</button>
        <span class="batch-sep">|</span>
        <span class="batch-label">Solo sin resultado:</span>
        <button class="batch-btn batch-pasa" onclick="batchSetResultado('PASA', true)">✓</button>
        <button class="batch-btn batch-nopasa" onclick="batchSetResultado('NO PASA', true)">✗</button>
    </div>`;
        }

        test.evidences.forEach((evidence, index) => {
            html += renderEvidenceItem(evidence, index, test);
        });
    }

    // Botón para agregar pasos extra (siempre visible al final)
    if (!isLocked) {
        html += `
            <div style="text-align:center; padding: 16px 0 24px;">
                <button onclick="addExtraEvidenceStep()" style="
                    background: transparent; border: 2px dashed #b0b8c8;
                    color: #6b7a90; padding: 10px 24px; border-radius: 6px;
                    cursor: pointer; font-size: 13px; font-weight: 600;
                    transition: all .15s;">
                    ＋ Agregar evidencia extra
                </button>
            </div>
        `;
    }

    container.innerHTML = html;
}

/**
 * Panel read-only con la guía del protocolo (objetivo, precondiciones,
 * criterios, evidencia esperada). Solo se renderiza cuando el test fue
 * cargado desde un PIQ/POQ/PPQ (presencia de test.protocolGuidance).
 *
 * Decisión arquitectural: este panel NO permite edición. El protocolo
 * es la fuente de verdad y se autora aguas arriba (en el JSON del PIQ),
 * no en el gestor. Mantener inmutabilidad acá garantiza trazabilidad
 * limpia entre PIQ ejecutado y IIQ generado.
 */
function renderProtocolGuidancePanel(g, src) {
    if (!g) return '';

    // Detectar schema: procedimiento (OQ) vs criterios (IQ).
    // Prioriza marker explícito; cae a inspección del contenido.
    const isOq = (g.schemaModo === 'procedimiento')
        || (Array.isArray(g.procedimiento) && g.procedimiento.length > 0);

    // Badge POSITIVO/NEGATIVO en el header (solo si está declarado)
    let tipoBadge = '';
    if (g.tipoTC) {
        const t = String(g.tipoTC).toUpperCase();
        if (t === 'POSITIVO') {
            tipoBadge = `<span style="background:#E8F5E9;color:#1E7E34;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.3px;margin-left:8px;">POSITIVO</span>`;
        } else if (t === 'NEGATIVO') {
            tipoBadge = `<span style="background:#FDECEA;color:#A52A2A;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.3px;margin-left:8px;">NEGATIVO</span>`;
        }
    }

    const sourceTag = src
        ? `<span style="font-size:10px;color:#5a5a5a;font-style:italic;font-weight:500;">${escapeHtml(src.type || '')} ${escapeHtml(src.code || '')} v${escapeHtml(src.version || '')}</span>`
        : '';

    const blocks = [];

    if (g.objetivo) {
        blocks.push(`
            <div style="margin-bottom:10px;">
                <strong style="color:#1F3C56;display:block;margin-bottom:3px;">Objetivo</strong>
                <div style="color:#333;">${escapeHtml(g.objetivo)}</div>
            </div>
        `);
    }

    if (Array.isArray(g.precondiciones) && g.precondiciones.length > 0) {
        const items = g.precondiciones.map(p => `<li>${escapeHtml(p)}</li>`).join('');
        blocks.push(`
            <div style="margin-bottom:10px;">
                <strong style="color:#1F3C56;display:block;margin-bottom:3px;">Precondiciones</strong>
                <ul style="margin:0;padding-left:20px;color:#333;">${items}</ul>
            </div>
        `);
    }

    // ═══ Cuerpo del TC: procedimiento (OQ) o criterios (IQ) ═══
    if (isOq && Array.isArray(g.procedimiento) && g.procedimiento.length > 0) {
        // Tabla numerada: Paso | Instrucción | Resultado esperado
        const rows = g.procedimiento.map((p, i) => {
            const num = p.paso != null ? p.paso : (i + 1);
            return `
                <tr style="border-bottom:1px solid #e0e0e0;">
                    <td style="padding:6px 8px;font-weight:700;color:#1F3C56;width:36px;text-align:center;vertical-align:top;background:#fff;">${escapeHtml(String(num))}</td>
                    <td style="padding:6px 8px;color:#333;vertical-align:top;background:#fff;">${escapeHtml(p.instruccion || '')}</td>
                    <td style="padding:6px 8px;color:#333;vertical-align:top;background:#fff;font-style:italic;">${escapeHtml(p.resultadoEsperado || '')}</td>
                </tr>`;
        }).join('');
        blocks.push(`
            <div style="margin-bottom:10px;">
                <strong style="color:#1F3C56;display:block;margin-bottom:6px;">Procedimiento</strong>
                <table style="width:100%;border-collapse:collapse;border:1px solid #d0d8de;font-size:12px;background:#fff;border-radius:3px;overflow:hidden;">
                    <thead>
                        <tr style="background:#EAF1F8;">
                            <th style="padding:5px 8px;text-align:center;font-weight:700;color:#1F3C56;border-bottom:1px solid #d0d8de;width:36px;">Paso</th>
                            <th style="padding:5px 8px;text-align:left;font-weight:700;color:#1F3C56;border-bottom:1px solid #d0d8de;">Instrucción</th>
                            <th style="padding:5px 8px;text-align:left;font-weight:700;color:#1F3C56;border-bottom:1px solid #d0d8de;">Resultado esperado</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `);

        if (g.criterioAceptacion) {
            blocks.push(`
                <div style="margin-bottom:10px;background:#FFF8E1;border-left:3px solid #C9A227;padding:8px 12px;border-radius:3px;">
                    <strong style="color:#1F3C56;display:block;margin-bottom:3px;">Criterio de aceptación</strong>
                    <div style="color:#333;">${escapeHtml(g.criterioAceptacion)}</div>
                </div>
            `);
        }
    } else {
        // IQ legacy: criterios consolidados
        if (Array.isArray(g.criterios) && g.criterios.length > 0) {
            const items = g.criterios.map((c, i) => `<li><strong style="color:#1F3C56;">${i + 1}.</strong> ${escapeHtml(c)}</li>`).join('');
            blocks.push(`
                <div style="margin-bottom:10px;">
                    <strong style="color:#1F3C56;display:block;margin-bottom:3px;">Criterios de aceptación</strong>
                    <ol style="margin:0;padding-left:22px;color:#333;list-style:none;">${items}</ol>
                </div>
            `);
        }

        if (g.evidenciaEsperada) {
            blocks.push(`
                <div style="margin-bottom:10px;background:#FFF8E1;border-left:3px solid #C9A227;padding:8px 12px;border-radius:3px;">
                    <strong style="color:#1F3C56;display:block;margin-bottom:3px;">Evidencia esperada</strong>
                    <div style="color:#333;">${escapeHtml(g.evidenciaEsperada)}</div>
                </div>
            `);
        }
    }

    // Metadatos compactos al pie — adaptan IQ vs OQ
    const meta = [];
    if (g.nivel) {
        const nivColor = { 'CRÍTICO': '#7B1F1F', 'CRITICO': '#7B1F1F', 'ALTO': '#C0392B', 'MEDIO': '#E67E22', 'BAJO': '#27AE60' }[String(g.nivel).toUpperCase()] || '#1F3C56';
        meta.push(`Nivel: <strong style="color:${nivColor};">${escapeHtml(g.nivel)}</strong>`);
    }
    if (g.profundidad) meta.push(`Profundidad: <strong>${escapeHtml(g.profundidad)}</strong>`);
    if (!isOq && g.componente) meta.push(`Componente: <strong>${escapeHtml(g.componente)}</strong>`);
    if (g.grupoFuncional && isOq) meta.push(`Grupo func.: <strong>${escapeHtml(g.grupoFuncional)}</strong>`);
    if (g.raVinculado) meta.push(`RA: <strong>${escapeHtml(g.raVinculado)}</strong>`);
    if (Array.isArray(g.ursVinculados) && g.ursVinculados.length > 0) {
        meta.push(`URS: <strong>${escapeHtml(g.ursVinculados.join(', '))}</strong>`);
    }
    if (typeof g.raScore === 'number' && g.raScore > 0) {
        meta.push(`${isOq ? 'RPN' : 'RA Score'}: <strong>${g.raScore}</strong>`);
    }

    const metaHtml = meta.length > 0
        ? `<div style="font-size:11px;color:#5a5a5a;border-top:1px solid #d0d8de;padding-top:8px;margin-top:6px;">${meta.join(' &nbsp;·&nbsp; ')}</div>`
        : '';

    if (blocks.length === 0 && metaHtml === '') return '';

    return `
        <div style="background:#F5F8FA;border:1px solid #d0d8de;border-left:4px solid #1F3C56;padding:14px 18px;border-radius:4px;margin-bottom:18px;font-size:13px;line-height:1.5;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid #d0d8de;padding-bottom:8px;">
                <strong style="color:#1F3C56;font-size:13px;letter-spacing:0.3px;">📋 GUÍA DEL PROTOCOLO (read-only)${tipoBadge}</strong>
                ${sourceTag}
            </div>
            ${blocks.join('')}
            ${metaHtml}
        </div>
    `;
}

/**
 * Panel de TRAZABILIDAD del test activo (Fase B.4).
 *
 * Usa VS.tracer.traceFromTcId() para obtener la cadena upstream + TCs
 * relacionados + estado de ejecución. Se renderiza debajo del panel
 * "GUÍA DEL PROTOCOLO" cuando hay docs en el paquete.
 *
 * Si el TC no se encuentra en packageDocs (porque el doc del paquete no
 * incluye este TC), devuelve string vacío — no se muestra el panel.
 */
function renderTraceabilityPanel(tcId) {
    if (!tcId || !window.ValidationSuite || !window.ValidationSuite.tracer) return '';

    let trace;
    try {
        trace = window.ValidationSuite.tracer.traceFromTcId(tcId, packageDocs);
    } catch (e) {
        return '';
    }
    if (!trace || !trace.found) return '';

    // Helper para colorear estado
    function estadoStyle(estado) {
        const e = String(estado || '').toUpperCase();
        if (e === 'PASS' || e === 'PASA') return { color: '#1E7E34', bg: '#E8F5E9', label: 'PASS' };
        if (e === 'FAIL' || e === 'NO PASA') return { color: '#A52A2A', bg: '#FDECEA', label: 'FAIL' };
        if (e === 'OBS' || e === 'PASS_OBS') return { color: '#B85F0F', bg: '#FFF4E5', label: 'OBS' };
        if (e === 'NA' || e === 'N/A') return { color: '#717D8A', bg: '#F4F6F8', label: 'N/A' };
        return { color: '#717D8A', bg: '#F4F6F8', label: estado || 'pendiente' };
    }

    function badge(text, color) {
        return `<span style="background:${color};color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:0.3px;">${escapeHtml(text)}</span>`;
    }

    const TYPE_COLORS = {
        PIQ: '#1E7E34', IIQ: '#1E7E34', POQ: '#3F6688', IOQ: '#3F6688',
        PPQ: '#7B1F1F', IPQ: '#7B1F1F'
    };

    const blocks = [];

    // ────── UPSTREAM ──────
    const upstreamItems = [];

    // Helper para resolver el nombre formal del doc upstream desde packageDocs.
    // Aún cuando el item no está enriquecido (no se encontró el item específico),
    // si el DOCUMENTO TIPO existe en el paquete, mostramos su code+version como
    // referencia formal — el auditor sabe contra qué doc se trazó.
    function lookupDocFormalName(tipo) {
        // tipo: 'URS' | 'RA' | 'IRA'
        const docs = (Array.isArray(packageDocs) ? packageDocs : []).filter(d => d.type === tipo);
        if (docs.length === 0) return null;
        const d = docs[0];
        return { code: d.code, version: d.version, title: d.title };
    }

    function docRefLine(tipo, srcDoc) {
        const formal = srcDoc || lookupDocFormalName(tipo);
        if (formal && formal.code) {
            return `<div style="font-size:10px; color:#5a5a5a; margin-top:2px;">Origen: <strong style="color:#3F6688;">${escapeHtml(formal.code)}</strong>${formal.version ? ` v${escapeHtml(formal.version)}` : ''}</div>`;
        }
        return `<div style="font-size:10px; color:#A52A2A; margin-top:2px; font-style:italic;">⚠ Documento ${tipo} no presente en el paquete cargado</div>`;
    }

    trace.upstream.urs.forEach(u => {
        const enriched = u && u.descripcion;
        const prioColor = u.prioridad === 'CRÍTICO' ? '#7B1F1F'
                       : u.prioridad === 'ALTO' ? '#C0392B'
                       : u.prioridad === 'MEDIO' ? '#E67E22'
                       : u.prioridad === 'BAJO' ? '#27AE60' : '#5a5a5a';
        upstreamItems.push(`
            <div style="margin-bottom:6px; padding:6px 8px; background:#fff; border-left:3px solid #1F3C56; border-radius:2px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    ${badge('URS', '#1F3C56')}
                    <strong style="color:#1F3C56; font-size:12px;">${escapeHtml(u.id || u)}</strong>
                    ${u.prioridad ? `<span style="font-size:9px; font-weight:700; color:${prioColor};">${escapeHtml(u.prioridad)}</span>` : ''}
                </div>
                ${enriched ? `<div style="font-size:11px; color:#333; margin-top:3px; line-height:1.4;">${escapeHtml(u.descripcion)}</div>` : ''}
                ${docRefLine('URS', u.sourceDoc)}
            </div>
        `);
    });

    trace.upstream.ra.forEach(r => {
        const enriched = r && r.enriched !== false && (r.descripcion || r.modo || r.causa);
        upstreamItems.push(`
            <div style="margin-bottom:6px; padding:6px 8px; background:#fff; border-left:3px solid #B85F0F; border-radius:2px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    ${badge('RA', '#B85F0F')}
                    <strong style="color:#1F3C56; font-size:12px;">${escapeHtml(r.id || r)}</strong>
                    ${r.rpn ? `<span style="font-size:10px; color:#B85F0F; font-weight:700;">RPN ${r.rpn}</span>` : ''}
                </div>
                ${enriched && r.descripcion ? `<div style="font-size:11px; color:#333; margin-top:3px;">${escapeHtml(r.descripcion)}</div>` : ''}
                ${docRefLine('RA', r.sourceDoc)}
            </div>
        `);
    });

    trace.upstream.ira.forEach(c => {
        const enriched = c && c.componente;
        upstreamItems.push(`
            <div style="margin-bottom:6px; padding:6px 8px; background:#fff; border-left:3px solid #B85F0F; border-radius:2px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    ${badge('IRA', '#B85F0F')}
                    <strong style="color:#1F3C56; font-size:12px;">${escapeHtml(c.id || c)}</strong>
                    ${c.componente ? `<span style="font-size:11px; color:#333;">— ${escapeHtml(c.componente)}</span>` : ''}
                    ${c.iraScore ? `<span style="font-size:10px; color:#B85F0F; font-weight:700;">IRA ${c.iraScore}</span>` : ''}
                </div>
                ${enriched && c.verificacion ? `<div style="font-size:11px; color:#333; margin-top:3px; font-style:italic;">${escapeHtml(c.verificacion)}</div>` : ''}
                ${docRefLine('IRA', c.sourceDoc)}
            </div>
        `);
    });

    if (upstreamItems.length > 0) {
        blocks.push(`
            <div style="margin-bottom:10px;">
                <div style="font-size:10px; font-weight:700; color:#1F3C56; letter-spacing:0.5px; margin-bottom:4px;">UPSTREAM — Origen del requisito</div>
                ${upstreamItems.join('')}
            </div>
        `);
    }

    // EJECUCIÓN — omitido del panel de trazabilidad del protocolo.
    // Los resultados de ejecución pertenecen al Informe (IIQ/IOQ/IPQ) y se ven
    // al abrir ese documento. Mostrarlos en el protocolo (PIQ/POQ/PPQ) es
    // contradictorio con el flujo GxP: primero se ejecuta, luego se registra.

    // ────── TCs RELACIONADOS ──────
    if (trace.related && trace.related.length > 0) {
        const items = trace.related.map(r => {
            const est = estadoStyle(r.estado);
            const typeColor = TYPE_COLORS[r.sourceDoc.type] || '#5a5a5a';
            return `
                <div style="display:flex; align-items:center; gap:6px; padding:4px 0; font-size:11px;">
                    ${badge(r.sourceDoc.type, typeColor)}
                    <strong style="color:#1F3C56;">${escapeHtml(r.tcId)}</strong>
                    <span style="color:${est.color}; font-weight:700; font-size:10px;">${escapeHtml(est.label)}</span>
                    <span style="color:#5a5a5a; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(r.titulo)}</span>
                    <span style="font-size:9px; color:#999; font-style:italic;">comparte ${r.sharedUrs ? r.sharedUrs.join(',') : ''}</span>
                </div>
            `;
        }).join('');
        blocks.push(`
            <div style="margin-bottom:6px;">
                <div style="font-size:10px; font-weight:700; color:#1F3C56; letter-spacing:0.5px; margin-bottom:4px;">TCs RELACIONADOS — Validan los mismos URS en otros protocolos</div>
                ${items}
            </div>
        `);
    }

    if (blocks.length === 0) return '';

    // Source info — qué doc del paquete tiene este TC
    const src = trace.sourceDoc;
    const srcInfo = src
        ? `<span style="font-size:10px; color:#5a5a5a; font-style:italic;">${escapeHtml(src.type || '')} ${escapeHtml(src.code || '')} v${escapeHtml(src.version || '')}</span>`
        : '';

    return `
        <div style="background:#F0F4F8; border:1px solid #d0d8de; border-left:4px solid #3F6688; padding:14px 18px; border-radius:4px; margin-bottom:18px; font-size:13px; line-height:1.5;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #d0d8de; padding-bottom:8px;">
                <strong style="color:#1F3C56; font-size:13px; letter-spacing:0.3px;">TRAZABILIDAD CRUZADA</strong>
                ${srcInfo}
            </div>
            ${blocks.join('')}
        </div>
    `;
}

/**
 * Abrir la evidencia en tamaño completo (modal overlay).
 * Se invoca desde el onclick del thumbnail.
 */
function openEvidenceFullsize(testId, step) {
    const test = tests.find(t => t.id === testId);
    if (!test) return;
    const evidence = test.evidences.find(e => e.step === step);
    if (!evidence || !evidence.image) return;

    // Cerrar cualquier modal previo
    const existing = document.getElementById('evidenceFullsizeModal');
    if (existing) existing.remove();

    // Metadata legible: timestamp + descripcion + EXIF (camara, GPS, archivo)
    const meta = [];
    if (evidence.description) meta.push(escapeHtml(evidence.description));
    if (evidence.captureTimestamp || evidence.timestamp) {
        meta.push('⏰ ' + formatDateTime24h(evidence.captureTimestamp || evidence.timestamp));
    }
    if (evidence.dimensions) meta.push('📐 ' + escapeHtml(evidence.dimensions));
    if (evidence.size) meta.push('💾 ' + escapeHtml(evidence.size));
    if (evidence.exif && evidence.exif.cameraModel) {
        const cam = (evidence.exif.cameraMake || '') + ' ' + evidence.exif.cameraModel;
        meta.push('📷 ' + escapeHtml(cam.trim()));
    }
    if (evidence.exif && evidence.exif.gpsLatitude && evidence.exif.gpsLongitude) {
        meta.push('📍 GPS ' + evidence.exif.gpsLatitude + ', ' + evidence.exif.gpsLongitude);
    }
    if (evidence.sourceType === 'mobile-camera') {
        meta.push('📱 Captura desde móvil');
    }

    const overlay = document.createElement('div');
    overlay.id = 'evidenceFullsizeModal';
    overlay.className = 'evidence-fullsize-modal';
    overlay.innerHTML = `
        <button class="evidence-fullsize-close" onclick="closeEvidenceFullsize()" aria-label="Cerrar">×</button>
        <img src="${evidence.image}" alt="Evidencia paso ${step}">
        ${meta.length ? `<div class="evidence-fullsize-meta">${meta.join(' &nbsp;·&nbsp; ')}</div>` : ''}
    `;
    overlay.addEventListener('click', (e) => {
        // Click fuera de la imagen cierra
        if (e.target === overlay) closeEvidenceFullsize();
    });
    // Cerrar con ESC
    overlay._escHandler = (e) => { if (e.key === 'Escape') closeEvidenceFullsize(); };
    document.addEventListener('keydown', overlay._escHandler);

    document.body.appendChild(overlay);
}

function closeEvidenceFullsize() {
    const overlay = document.getElementById('evidenceFullsizeModal');
    if (!overlay) return;
    if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
    overlay.remove();
}

/**
 * Renderizar item de evidencia
 */
function renderEvidenceItem(evidence, index, test) {
    const isPlaceholder = evidence.isEmpty;
    const isTable = evidence.type === 'table';
    const stepNumber = String(evidence.step).padStart(3, '0');
    const resultado = evidence.resultado || 'PASA';

    // Mapear resultado a clase CSS
    let resultadoClass = 'pasa';
    if (resultado === 'NO PASA' || resultado === 'NOK') {
        resultadoClass = 'no-pasa';
    } else if (resultado === 'PASA CON OBSERVACIONES') {
        resultadoClass = 'pasa-con-observaciones';
    } else if (resultado === 'NO APLICA') {
        resultadoClass = 'no-aplica';
    } else if (resultado === 'PASA' || resultado === 'OK') {
        resultadoClass = 'pasa';
    }

    if (isPlaceholder) {
        const descHtml = evidence.description && evidence.description !== 'Evidencia pendiente'
            ? `<p style="font-size:12px;font-weight:600;color:var(--vsc-azul-medio);margin:0 0 6px 0;text-align:left;">${evidence.description}</p>`
            : '';
        return `
            <div class="evidence-item" data-step="${evidence.step}">
                <div class="evidence-header">
                    <div class="evidence-step">Paso #${stepNumber} - PENDIENTE</div>
                    <div class="evidence-actions">
                        <button class="capture-now-btn" onclick="captureForStep(${evidence.step})" title="Capturar pantalla y asignar a este paso">📷 Capturar</button>
                        <button class="capture-cd-btn" onclick="captureForStep(${evidence.step}, true)" title="3 segundos para cambiar de ventana, luego captura automática">⏱ 3s</button>
                        <button onclick="deleteEvidence(${index})">Eliminar</button>
                    </div>
                </div>
                <div class="evidence-placeholder"
                     data-index="${index}"
                     ondrop="handleDropOnPlaceholder(event, ${index})"
                     ondragover="event.preventDefault(); event.currentTarget.classList.add('drag-over')"
                     ondragleave="event.currentTarget.classList.remove('drag-over')"
                     onclick="handleClickPlaceholder(${index})">
                    <div class="placeholder-icon">📷</div>
                    <div class="placeholder-text">
                        ${descHtml}
                        <p>Arrastra, pegá (Ctrl+V) o usá los botones de captura</p>
                    </div>
                </div>
            </div>
        `;
    }

    if (isTable) {
        // Renderizar tabla
        return `
            <div class="evidence-item evidence-table" data-table-index="${index}">
                <div class="evidence-header">
                    <div class="evidence-step">Paso #${stepNumber} - TABLA</div>
                    <div class="evidence-actions">
                        <button onclick="saveTableInline(${index})" title="Guardar cambios de tabla" style="background: var(--vsc-verde); color: var(--vsc-azul); font-weight: 700;">💾 Guardar</button>
                        <button onclick="editTable(${index})" title="Editar en modal">✏️ Editor</button>
                        <button onclick="deleteTable(${index})" title="Eliminar tabla">🗑️</button>
                    </div>
                </div>
                <div class="table-container" id="tableContainer_${index}" style="margin: 10px 0; overflow-x: auto;">
                    ${evidence.tableHTML}
                </div>
                <div class="evidence-metadata">
                    <span style="font-weight: 700; color: var(--vsc-azul);">📊 ${evidence.title}</span>
                    <span>${evidence.rows} filas × ${evidence.cols} columnas</span>
                    <span>⏰ ${formatDateTime24h(evidence.timestamp)}</span>
                    <span>👤 ${evidence.executor || 'N/A'}</span>
                </div>
            </div>
        `;
    }

    // Renderizar evidencia normal (imagen)
    return `
        <div class="evidence-item">
            <div class="evidence-header">
                <div class="evidence-step">Paso #${stepNumber}</div>
                <div class="evidence-actions">
                    <button onclick="moveEvidenceUp(${index})"  title="Mover arriba">↑</button>
                    <button onclick="moveEvidenceDown(${index})"  title="Mover abajo">↓</button>
                    <button onclick="rotateEvidence(${index})" title="Rotar 90°">↻ Rotar</button>
                    <button onclick="openImageEditor(${index})" >✏️ Editar imagen</button>
                    <button onclick="replaceEvidenceImage(${index})" >Cambiar imagen</button>
                    <button onclick="editEvidence(${index})" >Editar</button>
                    <button onclick="showInsertBeforeModal(${index})" >Insertar antes</button>
                    <button onclick="duplicateEvidence(${index})" >Duplicar</button>
                    <button onclick="showMoveEvidenceModal(${index})" >Mover a prueba</button>
                    <button onclick="openCompareModal(${evidence.step})" title="Comparar con otro paso">⇄ Comparar</button>
                    <button onclick="deleteEvidence(${index})" >Eliminar</button>
                </div>
            </div>
            <img src="${evidence.image}"
                 alt="Evidencia ${stepNumber}"
                 class="evidence-image"
                 data-step="${evidence.step}"
                 data-test="${test.id}"
                 onclick="openEvidenceFullsize('${test.id}', ${evidence.step})"
                 title="Click para ver tamaño completo">
            <div class="evidence-description">${evidence.description || 'Sin descripción'}</div>
            <div class="evidence-metadata">
                <span class="evidence-resultado ${resultadoClass}">${resultado}</span>
                ${evidence.captureTimestamp
                    ? `<span title="Momento de la captura de pantalla" style="color:var(--vsc-azul-medio);font-weight:600;">📸 ${formatDateTime24h(evidence.captureTimestamp)}</span>`
                    : evidence.timestamp
                        ? `<span>⏰ ${formatDateTime24h(evidence.timestamp)}</span>`
                        : ''}
                <span>💾 ${evidence.size || 'N/A'}</span>
                <span>📐 ${evidence.dimensions || 'N/A'}</span>
                <span>👤 ${evidence.executor || 'N/A'}</span>
            </div>
            ${evidence.exif ? `
                <div class="evidence-metadata" style="border-top: 1px solid var(--vsc-gris-claro); padding-top: 8px; margin-top: 8px; flex-wrap: wrap;">
                    ${evidence.sourceType === 'mobile-camera' ?
                `<span style="grid-column: 1 / -1; color: var(--vsc-azul-medio); font-weight: 600;">📱 Captura desde móvil</span>` : ''}
                    ${evidence.exif.originalFileName ?
                `<span style="grid-column: 1 / -1;"><strong>📁 Archivo:</strong> ${escapeHtml(evidence.exif.originalFileName)}</span>` : ''}
                    ${evidence.exif.relativePath ?
                `<span style="grid-column: 1 / -1;"><strong>📂 Ruta:</strong> ${escapeHtml(evidence.exif.relativePath)}</span>` : ''}
                    ${evidence.exif.captureDate ?
                `<span style="grid-column: 1 / -1;"><strong>📅 Fecha captura EXIF:</strong> ${formatDateTime24h(evidence.exif.captureDate)}</span>` : ''}
                    ${evidence.exif.cameraModel ?
                `<span style="grid-column: 1 / -1;"><strong>📷 Cámara:</strong> ${escapeHtml((evidence.exif.cameraMake || '') + ' ' + evidence.exif.cameraModel).trim()}</span>` : ''}
                    ${(evidence.exif.gpsLatitude != null && evidence.exif.gpsLongitude != null) ?
                `<span style="grid-column: 1 / -1;"><strong>📍 GPS:</strong> ${escapeHtml(String(evidence.exif.gpsLatitude))}${evidence.exif.gpsLatitudeRef ? ' ' + evidence.exif.gpsLatitudeRef : ''}, ${escapeHtml(String(evidence.exif.gpsLongitude))}${evidence.exif.gpsLongitudeRef ? ' ' + evidence.exif.gpsLongitudeRef : ''}</span>` : ''}
                </div>
            ` : ''}
        </div>
    `;
}

/* ====================================================================
   MÓDULO 2.1: COMPARACIÓN DE EVIDENCIAS
   ==================================================================== */

function openCompareModal(stepA) {
    if (!activeTestId) return;
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;
    const withImg = test.evidences.filter(e => !e.isEmpty && e.image && e.step !== stepA);
    if (withImg.length === 0) { showNotification('No hay otros pasos capturados para comparar', 'info'); return; }
    if (withImg.length === 1) { renderCompareModal(stepA, withImg[0].step); return; }
    // Mostrar picker
    const overlay = document.createElement('div');
    overlay.id = 'compare-picker-overlay';
    overlay.innerHTML = `
        <div class="cmp-picker-box">
            <div class="cmp-picker-title">Comparar Paso #${String(stepA).padStart(3,'0')} con:</div>
            <div class="cmp-picker-list">
                ${withImg.map(ev => `
                    <div class="cmp-picker-item" onclick="renderCompareModal(${stepA}, ${ev.step}); document.getElementById('compare-picker-overlay').remove();">
                        <img src="${ev.image}" class="cmp-thumb">
                        <span>Paso #${String(ev.step).padStart(3,'0')}<br><small>${ev.description || ''}</small></span>
                    </div>`).join('')}
            </div>
            <button onclick="document.getElementById('compare-picker-overlay').remove()" class="cmp-cancel-btn">Cancelar</button>
        </div>`;
    document.body.appendChild(overlay);
}

function renderCompareModal(stepA, stepB) {
    const existing = document.getElementById('compare-picker-overlay');
    if (existing) existing.remove();
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;
    const evA = test.evidences.find(e => e.step === stepA);
    const evB = test.evidences.find(e => e.step === stepB);
    if (!evA || !evB) return;
    const modal = document.createElement('div');
    modal.id = 'compare-modal';
    modal.innerHTML = `
        <div class="cmp-header">
            <span class="cmp-title">COMPARACIÓN — Paso #${String(stepA).padStart(3,'0')} vs Paso #${String(stepB).padStart(3,'0')}</span>
            <button class="cmp-close" onclick="document.getElementById('compare-modal').remove()">✕</button>
        </div>
        <div class="cmp-body">
            <div class="cmp-side">
                <div class="cmp-side-label">Paso #${String(stepA).padStart(3,'0')}</div>
                <div class="cmp-side-desc">${evA.description || ''}</div>
                <img src="${evA.image}" class="cmp-img">
            </div>
            <div class="cmp-divider"></div>
            <div class="cmp-side">
                <div class="cmp-side-label">Paso #${String(stepB).padStart(3,'0')}</div>
                <div class="cmp-side-desc">${evB.description || ''}</div>
                <img src="${evB.image}" class="cmp-img">
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal._escHandler = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', modal._escHandler); modal.remove(); } };
    document.addEventListener('keydown', modal._escHandler);
    modal.addEventListener('click', e => { if (e.target === modal) { document.removeEventListener('keydown', modal._escHandler); modal.remove(); } });
}

/* ====================================================================
   MÓDULO 3: CAPTURA DE EVIDENCIAS
   ==================================================================== */

/**
 * Manejar paste de imagen (Ctrl+V)
 */
function handlePaste(blob) {
    if (!activeTestId) {
        showNotification('Selecciona una prueba primero', 'error');
        return;
    }

    const test = tests.find(t => t.id === activeTestId);

    // Bloquear si está finalizado
    if (test.finalized) {
        showNotification('Prueba finalizada — no se pueden agregar evidencias', 'error');
        return;
    }
    const parentGrp = groups.find(g => g.id === test.groupId);
    const parentProto = getProtocolOfGroup(parentGrp);
    if ((parentGrp && parentGrp.finalized) || (parentProto && parentProto.finalized) || projectData.finalized) {
        const reason = projectData.finalized ? 'proyecto' : (parentProto && parentProto.finalized) ? 'protocolo' : 'carpeta';
        showNotification(`Bloqueado: ${reason} finalizado`, 'error');
        return;
    }

    // Convertir blob a File para poder extraer EXIF (si existe)
    const file = new File([blob], 'pasted-image.png', { type: blob.type });

    // Intentar extraer EXIF (screenshots no tendrán EXIF, imágenes de archivo sí)
    extractEXIFMetadata(file, (exifData) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                compressImage(img, (compressedDataURL, compressedSize) => {
                    const imageData = {
                        data: compressedDataURL,
                        size: formatBytes(compressedSize),
                        dimensions: `${img.width}x${img.height}`,
                        captureTimestamp: exifData.captureDate || new Date().toISOString(),
                        exif: exifData.captureDate ? {
                            originalFileName: exifData.originalFileName,
                            captureDate: exifData.captureDate,
                            cameraMake: exifData.cameraMake,
                            cameraModel: exifData.cameraModel,
                            fileSize: exifData.fileSize,
                            mimeType: exifData.mimeType
                        } : null
                    };

                    // === SMART PASTE: buscar primera evidencia vacía ===
                    const emptyIndex = test.evidences.findIndex(ev => ev.isEmpty === true);

                    if (emptyIndex !== -1) {
                        // Llenar slot vacío directamente — sin modal
                        smartFillEmptyEvidence(test, emptyIndex, imageData);
                    } else {
                        // Sin slots vacíos — flujo normal con modal
                        pendingImage = imageData;
                        showDescriptionModal();
                    }
                }, 'paste');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Smart Paste: llena una evidencia vacía directamente sin modal
 * Usa la descripción/operación preseteada del placeholder
 */
async function smartFillEmptyEvidence(test, emptyIndex, imageData) {
    const evidence = test.evidences[emptyIndex];

    // Llenar con la imagen
    evidence.image = imageData.data;
    evidence.size = imageData.size;
    evidence.dimensions = imageData.dimensions;
    evidence.captureTimestamp = imageData.captureTimestamp;
    evidence.timestamp = imageData.captureTimestamp || new Date().toISOString();
    evidence.isEmpty = false;
    evidence.exif = imageData.exif;

    // Mantener descripción/operación preseteada, o poner default
    if (!evidence.description || evidence.description === 'Evidencia pendiente') {
        evidence.description = `Paso ${String(evidence.step).padStart(3, '0')}`;
    }
    if (!evidence.resultado || evidence.resultado === 'OK') {
        evidence.resultado = 'PASA';
    }

    // Guardar imagen en IndexedDB
    const imageId = `${test.id}_evidence_${evidence.step}`;
    try {
        await saveImageToDB(imageId, imageData.data);
    } catch (e) { /* silenciar */ }

    // Renderizar y guardar
    renderWorkArea();
    renderTests();
    saveToStorage();

    // Contar cuántas vacías quedan
    const remaining = test.evidences.filter(ev => ev.isEmpty).length;
    const stepLabel = String(evidence.step).padStart(3, '0');

    if (remaining > 0) {
        showNotification(`Paso #${stepLabel} capturado — ${remaining} restante${remaining > 1 ? 's' : ''} (Ctrl+V para siguiente)`, 'info');
    } else {
        showNotification(`Paso #${stepLabel} capturado — Todas las evidencias completas`, 'info');
    }

    // Auto-scroll a la siguiente evidencia vacía
    setTimeout(() => {
        const nextEmpty = test.evidences.findIndex(ev => ev.isEmpty === true);
        if (nextEmpty !== -1) {
            const el = document.querySelector(`[data-evidence-index="${nextEmpty}"]`) ||
                        document.querySelectorAll('.evidence-item, .evidence-placeholder-container')[nextEmpty];
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.style.outline = '2px solid var(--vsc-verde)';
                setTimeout(() => { el.style.outline = ''; }, 2000);
            }
        }
    }, 100);
}

// ====================================================================
// CAPTURA DE PANTALLA — Screen Capture API
// ====================================================================

let captureSession = { stream: null, video: null, active: false, windowName: '' };
let autoCaptureWorker = null;
let autoCaptureIntervalSecs = 5;
let autoCaptureCountdownRemaining = 0;
let pipWindow = null;
// Web Worker inline — el worker corre en thread separado y no se throttlea cuando la pestaña pierde foco
const _AUTO_CAPTURE_WORKER_SRC = `let iv=null;self.onmessage=function(e){if(e.data==='start'){iv=setInterval(function(){self.postMessage('tick');},1000);}else if(e.data==='stop'){clearInterval(iv);}};`;

/**
 * Inicia una sesión de captura. Muestra el picker del browser UNA sola vez.
 * Las capturas siguientes son instantáneas (stream persiste).
 * El video element se adjunta oculto al DOM para evitar que el browser lo throttlee.
 */
async function ensureCaptureSession() {
    if (captureSession.active) {
        // Verificar que el track siga vivo
        if (captureSession.stream && captureSession.stream.getVideoTracks()[0].readyState === 'live') {
            return true;
        }
        // Track muerto — limpiar y reabrir
        stopCaptureSession(true);
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showNotification('Tu browser no soporta captura de pantalla. Usá Chrome o Edge.', 'error');
        return false;
    }
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        // Adjuntar al DOM oculto — evita que Chrome pause el video por estar fuera del viewport
        video.style.cssText = 'position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(video);
        await new Promise(res => { video.onloadedmetadata = res; setTimeout(res, 3000); });
        await video.play();
        stream.getVideoTracks()[0].addEventListener('ended', () => stopCaptureSession(false));
        captureSession = {
            stream, video, active: true,
            windowName: stream.getVideoTracks()[0].label || 'Ventana seleccionada'
        };
        updateCaptureSessionBanner();
        showNotification('📷 Sesión iniciada — F9 para capturar el siguiente paso', 'success');
        return true;
    } catch (err) {
        if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
            showNotification('No se pudo iniciar la captura: ' + err.message, 'error');
        }
        return false;
    }
}

/** Graba un frame del stream. Usa ImageCapture API si está disponible (más confiable). */
async function grabFrame() {
    if (!captureSession.active || !captureSession.stream) return null;
    const track = captureSession.stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return null;

    // ImageCapture API — más confiable en Chrome (no depende del estado del video element)
    if (typeof ImageCapture !== 'undefined') {
        try {
            const ic = new ImageCapture(track);
            const bitmap = await ic.grabFrame();
            const c = document.createElement('canvas');
            c.width = bitmap.width; c.height = bitmap.height;
            c.getContext('2d').drawImage(bitmap, 0, 0);
            bitmap.close && bitmap.close();
            return { dataURL: c.toDataURL('image/jpeg', 0.85), width: bitmap.width, height: bitmap.height };
        } catch (_) { /* fallback al video */ }
    }

    // Fallback: video element
    const v = captureSession.video;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return { dataURL: c.toDataURL('image/jpeg', 0.85), width: v.videoWidth, height: v.videoHeight };
}

/** Detiene la sesión y limpia el stream. silent=true no muestra notificación. */
function stopCaptureSession(silent) {
    if (autoCaptureWorker) stopAutoCapture();
    if (pipWindow && !pipWindow.closed) { pipWindow.close(); pipWindow = null; }
    if (captureSession.stream) captureSession.stream.getTracks().forEach(t => t.stop());
    if (captureSession.video && captureSession.video.parentNode) {
        captureSession.video.parentNode.removeChild(captureSession.video);
    }
    captureSession = { stream: null, video: null, active: false, windowName: '' };
    updateCaptureSessionBanner();
    if (!silent) showNotification('Sesión de captura finalizada');
}

/**
 * Muestra un overlay flotante para que el usuario escriba una nota rápida de 1 línea.
 * Retorna una Promise<string> con la nota ingresada, o '' si el usuario saltó o se agotó
 * el tiempo sin haber escrito nada.
 */
function showQuickNoteInput(stepNumber) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'quick-note-overlay';
        overlay.innerHTML = `
            <div class="qno-box">
                <div class="qno-header">
                    <span class="qno-title">📝 Paso #${String(stepNumber).padStart(3,'0')} — Nota rápida</span>
                    <span class="qno-timer-chip" id="qno-timer">6s</span>
                </div>
                <input type="text" id="qno-input" maxlength="180"
                       placeholder="Observación... (Enter guardar · Esc saltar)">
                <div class="qno-actions">
                    <button class="qno-btn-skip" id="qno-skip">Saltar</button>
                    <button class="qno-btn-save" id="qno-save">Guardar</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const input = document.getElementById('qno-input');
        input.focus();
        let remaining = 6;
        const iv = setInterval(() => {
            remaining--;
            const chip = document.getElementById('qno-timer');
            if (chip) {
                chip.textContent = remaining + 's';
                if (remaining <= 2) chip.classList.add('urgent');
            }
            if (remaining <= 0) done(input.value.trim());
        }, 1000);
        function done(val) {
            clearInterval(iv);
            const el = document.getElementById('quick-note-overlay');
            if (el) el.remove();
            resolve(val);
        }
        document.getElementById('qno-save').addEventListener('click', () => done(input.value.trim()));
        document.getElementById('qno-skip').addEventListener('click', () => done(''));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') done(input.value.trim());
            if (e.key === 'Escape') done('');
        });
    });
}

/**
 * Captura el paso `stepNumber` del test activo.
 * Si no hay sesión abierta, abre el picker primero.
 * Si withCountdown=true, muestra 3...2...1 antes de capturar.
 */
async function captureForStep(stepNumber, withCountdown) {
    if (!activeTestId) { showNotification('Seleccioná una prueba primero', 'warning'); return; }
    // Detectar si ya había sesión activa ANTES de abrir el picker
    const track0 = captureSession.stream?.getVideoTracks()[0];
    const sessionWasActive = captureSession.active && !!track0 && track0.readyState === 'live';
    // Si la sesión ya estaba activa y hay countdown, mostrarlo ANTES de capturar
    if (withCountdown && sessionWasActive) await runCaptureCountdown(3);
    const ok = await ensureCaptureSession();
    if (!ok) return;
    if (!sessionWasActive) {
        // Sesión recién iniciada: el picker acaba de cerrarse y el SMART está en primer plano.
        // No capturar todavía — dar al usuario la oportunidad de cambiar de ventana.
        if (withCountdown) {
            // Botón ⏱: usar el countdown para que el usuario cambie de ventana y luego capturar
            await runCaptureCountdown(3);
        } else {
            // F9: la notificación de ensureCaptureSession ya indica "F9 para capturar"
            return;
        }
    }
    const frame = await grabFrame();
    if (!frame) { showNotification('No se pudo capturar el frame. Intentá de nuevo.', 'error'); return; }
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;
    const evIdx = test.evidences.findIndex(e => e.step === stepNumber);
    if (evIdx === -1) return;
    const sizeBytes = Math.round(frame.dataURL.length * 0.75);
    await smartFillEmptyEvidence(test, evIdx, {
        data: frame.dataURL,
        size: (typeof formatBytes === 'function' ? formatBytes(sizeBytes) : Math.round(sizeBytes / 1024) + ' KB'),
        dimensions: frame.width + 'x' + frame.height,
        captureTimestamp: new Date().toISOString(),
        exif: null
    });
    _syncPipWindow();
    playShutterSound();
    flashPipWindow();
    // Solo en modo manual (no durante ráfaga automática)
    if (!autoCaptureWorker) {
        const note = await showQuickNoteInput(stepNumber);
        if (note) {
            const updatedTest = tests.find(t => t.id === activeTestId);
            if (updatedTest) {
                const ev = updatedTest.evidences.find(e => e.step === stepNumber);
                const defaultDescs = ['Evidencia pendiente', 'Paso ' + String(stepNumber).padStart(3,'0'), ''];
                if (ev && (defaultDescs.includes(ev.description || ''))) {
                    ev.description = note;
                    saveToStorage();
                    renderWorkArea();
                }
            }
        }
    }
}

/** F9 / botón manual: captura el siguiente paso vacío, o crea uno nuevo si todos están llenos. */
async function captureNextEmpty() {
    if (!activeTestId) return;
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;
    let nextEmpty = test.evidences.find(e => e.isEmpty);
    if (!nextEmpty) {
        addExtraEvidenceStep();
        nextEmpty = test.evidences.find(e => e.isEmpty);
    }
    if (nextEmpty) await captureForStep(nextEmpty.step);
}

/** Agrega un paso de evidencia extra al final del test activo. */
function addExtraEvidenceStep() {
    if (!activeTestId) return;
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;
    const maxStep = test.evidences.reduce((m, e) => Math.max(m, e.step), 0);
    const newStep = maxStep + 1;
    test.evidences.push({
        step: newStep,
        description: 'Evidencia adicional',
        operacion: '',
        resultado: 'PASA',
        timestamp: new Date().toISOString(),
        captureTimestamp: null,
        size: null,
        dimensions: null,
        testName: test.name,
        executor: executor || '',
        isEmpty: true,
        hasImage: false,
        image: null
    });
    renderWorkArea();
    saveToStorage();
    setTimeout(() => {
        const items = document.querySelectorAll('.evidence-item');
        if (items.length) items[items.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    showNotification('Paso adicional agregado — paso #' + String(newStep).padStart(3, '0'));
}

/** Muestra cuenta regresiva visual N...1, luego resuelve. */
function runCaptureCountdown(seconds) {
    return new Promise(resolve => {
        let remaining = seconds;
        const overlay = document.createElement('div');
        overlay.id = 'capture-countdown-overlay';
        overlay.innerHTML = '<div class="cco-inner"><div class="cco-num" id="cco-num">' + remaining + '</div>' +
            '<div class="cco-msg">Cambiá a la ventana que querés capturar</div></div>';
        document.body.appendChild(overlay);
        const iv = setInterval(() => {
            remaining--;
            const el = document.getElementById('cco-num');
            if (el) el.textContent = remaining;
            if (remaining <= 0) { clearInterval(iv); overlay.remove(); resolve(); }
        }, 1000);
    });
}

/** Actualiza el banner de sesión activa en la UI y sincroniza la ventana PiP si está abierta. */
function updateCaptureSessionBanner() {
    const banner = document.getElementById('capture-session-banner');
    if (!banner) return;
    if (!captureSession.active) { banner.style.display = 'none'; return; }
    banner.style.display = 'flex';
    const nameEl = document.getElementById('capture-window-name');
    if (nameEl) nameEl.textContent = captureSession.windowName;
    const manualEl = document.getElementById('csb-manual');
    const autoEl = document.getElementById('csb-auto');
    if (autoCaptureWorker) {
        if (manualEl) manualEl.style.display = 'none';
        if (autoEl) autoEl.style.display = 'inline-flex';
        const iv = document.getElementById('csb-interval-val');
        const cd = document.getElementById('csb-countdown');
        if (iv) iv.textContent = autoCaptureIntervalSecs;
        if (cd) cd.textContent = autoCaptureCountdownRemaining;
    } else {
        if (manualEl) manualEl.style.display = 'inline-flex';
        if (autoEl) autoEl.style.display = 'none';
    }
    _syncPipWindow();
}

/** Sincroniza el contenido de la ventana flotante PiP con el estado actual. */
/** Sonido de obturador sintético via Web Audio API. */
function playShutterSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.045].forEach((t, i) => {
            const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.055), ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let j = 0; j < data.length; j++) {
                data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / data.length, 2);
            }
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(i === 0 ? 0.45 : 0.28, ctx.currentTime + t);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.055);
            src.connect(gain);
            gain.connect(ctx.destination);
            src.start(ctx.currentTime + t);
        });
        setTimeout(() => ctx.close(), 600);
    } catch(e) {}
}

/** Flash verde en la ventana PiP para confirmar que la captura se guardó. */
function flashPipWindow() {
    if (!pipWindow || pipWindow.closed) return;
    const body = pipWindow.document.body;
    body.style.transition = 'background 0.08s';
    body.style.background = '#0d3320';
    setTimeout(() => { body.style.background = '#1a2332'; }, 380);
}

/** Sincroniza el contenido de la ventana flotante PiP con el estado actual. */
function _syncPipWindow() {
    if (!pipWindow || pipWindow.closed) return;
    const pd = pipWindow.document;
    const nameEl = pd.getElementById('pip-name');
    if (nameEl) nameEl.textContent = captureSession.windowName || 'Sesión activa';
    const test = tests.find(t => t.id === activeTestId);
    const total = test ? test.evidences.length : 0;
    const done = test ? test.evidences.filter(e => !e.isEmpty).length : 0;
    const stepEl = pd.getElementById('pip-steps');
    if (stepEl) stepEl.textContent = done + ' / ' + total + ' pasos';
    const nextEmpty = test ? test.evidences.find(e => e.isEmpty) : null;
    const descEl = pd.getElementById('pip-next-desc');
    if (descEl) {
        if (nextEmpty) {
            const desc = nextEmpty.description && nextEmpty.description !== 'Evidencia pendiente'
                ? nextEmpty.description
                : 'Paso #' + String(nextEmpty.step).padStart(3, '0');
            descEl.textContent = '→ ' + desc;
            descEl.style.color = '#a8c8e8';
        } else {
            descEl.textContent = '✓ Todos los pasos capturados';
            descEl.style.color = '#27AE60';
        }
    }
    const cdEl = pd.getElementById('pip-cd');
    const rafagaEl = pd.getElementById('pip-rafaga-info');
    const btnCapture = pd.getElementById('pip-btn-capture');
    const btnStopAuto = pd.getElementById('pip-btn-stop-auto');
    if (autoCaptureWorker) {
        if (cdEl) { cdEl.style.display = 'flex'; cdEl.textContent = autoCaptureCountdownRemaining + 's'; }
        if (rafagaEl) { rafagaEl.style.display = 'inline'; rafagaEl.textContent = 'cada ' + autoCaptureIntervalSecs + 's'; }
        if (btnCapture) btnCapture.textContent = '📷 Ahora';
        if (btnStopAuto) btnStopAuto.style.display = 'inline-block';
    } else {
        if (cdEl) cdEl.style.display = 'none';
        if (rafagaEl) rafagaEl.style.display = 'none';
        if (btnCapture) btnCapture.textContent = '📷 Capturar';
        if (btnStopAuto) btnStopAuto.style.display = 'none';
    }
}

/** Abre la ventana flotante Picture-in-Picture con controles de captura. */
async function openCapturePiP() {
    if (!('documentPictureInPicture' in window)) {
        showNotification('Tu browser no soporta ventana flotante. Usá Chrome/Edge 116+', 'warning');
        return;
    }
    if (!captureSession.active) {
        showNotification('Abrí una sesión de captura primero', 'warning');
        return;
    }
    if (pipWindow && !pipWindow.closed) { pipWindow.focus(); return; }

    const pip = await window.documentPictureInPicture.requestWindow({ width: 290, height: 130 });

    pip.document.head.innerHTML = `<style>
        *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif;}
        body{background:#1a2332;color:#e0e8f4;display:flex;flex-direction:column;justify-content:center;
             padding:10px 12px;gap:6px;height:100vh;user-select:none;transition:background 0.08s;}
        .row{display:flex;align-items:center;gap:7px;}
        .dot{width:8px;height:8px;border-radius:50%;background:#e74c3c;flex-shrink:0;
             animation:pulse 1.2s ease-in-out infinite;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        #pip-name{font-size:11px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        #pip-steps{font-size:11px;opacity:.55;white-space:nowrap;}
        #pip-rafaga-info{font-size:10px;color:#27AE60;font-weight:700;}
        #pip-next-desc{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                       padding-left:15px;opacity:.85;}
        #pip-cd{display:none;align-items:center;justify-content:center;
                font-size:22px;font-weight:900;color:#27AE60;min-width:38px;}
        #pip-btn-capture{flex:1;padding:5px 0;font-size:13px;font-weight:700;
                         background:#2980B9;color:white;border:none;border-radius:5px;cursor:pointer;}
        #pip-btn-capture:hover{background:#3498DB;}
        #pip-btn-stop-auto{padding:5px 8px;font-size:11px;font-weight:700;
                           background:#E67E22;color:white;border:none;border-radius:5px;cursor:pointer;display:none;}
        #pip-btn-stop-auto:hover{background:#F39C12;}
        #pip-btn-close{padding:5px 9px;font-size:12px;font-weight:700;
                       background:#444;color:white;border:none;border-radius:5px;cursor:pointer;}
        #pip-btn-close:hover{background:#666;}
    </style>`;

    pip.document.body.innerHTML = `
        <div class="row">
            <span class="dot"></span>
            <span id="pip-name">Sesión activa</span>
            <span id="pip-rafaga-info" style="display:none"></span>
            <span id="pip-steps"></span>
        </div>
        <div id="pip-next-desc"></div>
        <div class="row">
            <button id="pip-btn-capture">📷 Capturar</button>
            <span id="pip-cd"></span>
            <button id="pip-btn-stop-auto">⏹ Parar</button>
            <button id="pip-btn-close" title="Cerrar ventana flotante (la sesión sigue activa)">↙</button>
        </div>
    `;

    pip.document.getElementById('pip-btn-capture').addEventListener('click', captureNextEmpty);
    pip.document.getElementById('pip-btn-stop-auto').addEventListener('click', () => {
        stopAutoCapture();
        const btn = pip.document.getElementById('pip-btn-stop-auto');
        if (btn) btn.style.display = 'none';
    });
    // ✕ cierra solo el PiP, la sesión sigue activa en el banner del gestor
    pip.document.getElementById('pip-btn-close').addEventListener('click', () => {
        pip.close();
        pipWindow = null;
    });
    pip.addEventListener('pagehide', () => { pipWindow = null; });

    pipWindow = pip;
    _syncPipWindow();
}

/** Inicia ráfaga: captura automática cada intervalSeconds segundos usando Web Worker (no se throttlea en background). */
function startAutoCapture(intervalSeconds) {
    autoCaptureIntervalSecs = intervalSeconds;
    autoCaptureCountdownRemaining = intervalSeconds;
    ensureCaptureSession().then(ok => {
        if (!ok) return;
        if (autoCaptureWorker) { autoCaptureWorker.postMessage('stop'); autoCaptureWorker.terminate(); }
        const blob = new Blob([_AUTO_CAPTURE_WORKER_SRC], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        autoCaptureWorker = new Worker(url);
        URL.revokeObjectURL(url);
        autoCaptureWorker.onmessage = async () => {
            autoCaptureCountdownRemaining--;
            updateCaptureSessionBanner();
            if (autoCaptureCountdownRemaining <= 0) {
                autoCaptureCountdownRemaining = autoCaptureIntervalSecs;
                const test = tests.find(t => t.id === activeTestId);
                if (!test) { stopAutoCapture(); return; }
                let nextEmpty = test.evidences.find(e => e.isEmpty);
                if (!nextEmpty) {
                    addExtraEvidenceStep();
                    nextEmpty = test.evidences.find(e => e.isEmpty);
                }
                if (nextEmpty) await captureForStep(nextEmpty.step);
            }
        };
        autoCaptureWorker.postMessage('start');
        updateCaptureSessionBanner();
    });
}

/** Detiene ráfaga automática y vuelve a modo manual. */
function stopAutoCapture() {
    if (autoCaptureWorker) {
        autoCaptureWorker.postMessage('stop');
        autoCaptureWorker.terminate();
        autoCaptureWorker = null;
    }
    updateCaptureSessionBanner();
}

/**
 * Comprimir imagen usando Canvas
 */
function compressImage(img, callback, sourceType = 'unknown') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Detectar tipo de imagen
    const isLargePhoto = img.width > 2000 || img.height > 2000;
    const isScreenshot = sourceType === 'paste' || (!isLargePhoto);

    // Configuración según tipo
    let maxDimension, quality, label;

    if (isScreenshot) {
        // CAPTURAS DE PANTALLA: Máxima calidad, casi sin compresión
        maxDimension = 1920;
        quality = 0.95;  // Alta calidad (antes: 0.85)
        label = '📸 Captura de pantalla - ALTA CALIDAD';
    } else {
        // FOTOS DE ARCHIVO: Compresión ligera, buena calidad
        maxDimension = 1600;
        quality = 0.80;  // Buena calidad (antes: 0.60)
        label = '📷 Foto de archivo - Compresión ligera';
    }

    // Calcular dimensiones manteniendo aspect ratio
    let width = img.width;
    let height = img.height;
    const originalSize = `${width}x${height}`;

    if (width > maxDimension || height > maxDimension) {
        if (width > height) {
            height = Math.round((height / width) * maxDimension);
            width = maxDimension;
        } else {
            width = Math.round((width / height) * maxDimension);
            height = maxDimension;
        }
    }

    canvas.width = width;
    canvas.height = height;

    // Dibujar imagen redimensionada con suavizado MÁXIMO
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    // Comprimir a JPEG con calidad dinámica
    canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const compressionRatio = ((1 - (blob.size / (img.width * img.height * 4))) * 100).toFixed(1);
    // //             console.log(`${label} | Original: ${originalSize} → Procesada: ${width}x${height} | Calidad: ${quality} | Tamaño: ${formatBytes(blob.size)} | Compresión: ${compressionRatio}%`);
            callback(e.target.result, blob.size);
        };
        reader.readAsDataURL(blob);
    }, 'image/jpeg', quality);
}

/**
 * Formatear bytes a KB/MB
 */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Formatear fecha/hora en formato 24hs (DD/MM/AAAA HH:MM:SS)
 * @param {string|Date} dateInput - Fecha en formato ISO o Date object
 * @returns {string} - Fecha formateada
 */
function formatDateTime24h(dateInput) {
    if (!dateInput) return 'N/A';

    try {
        const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;

        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    } catch (e) {
    // //         console.error('Error formateando fecha:', e);
        return 'N/A';
    }
}

// ====================================================================
// Datos de prueba (usuario / rol / TC ref) — memorización en localStorage
// para autocompletar entre capturas y persistir entre sesiones.
// ====================================================================

const TEST_DATA_STORAGE_KEY = 'drp_test_data_recent';
const TEST_DATA_MAX_RECENT = 10;       // máximo de valores recordados por campo
const TEST_DATA_LAST_CONTEXT_KEY = 'drp_test_data_last_ctx';

/** Lee la lista de últimos N valores de un campo desde localStorage. */
function getRecentTestDataValues(field) {
    try {
        const raw = localStorage.getItem(TEST_DATA_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed[field]) ? parsed[field] : [];
    } catch (e) {
        return [];
    }
}

/** Agrega un valor a la lista de recientes (lo mueve al frente, sin duplicados). */
function addRecentTestDataValue(field, value) {
    const v = (value || '').trim();
    if (!v) return;
    let store = {};
    try {
        const raw = localStorage.getItem(TEST_DATA_STORAGE_KEY);
        store = raw ? JSON.parse(raw) : {};
    } catch (e) {
        store = {};
    }
    if (!Array.isArray(store[field])) store[field] = [];
    // Sacar si ya existía (case-insensitive) y reinsertar al frente
    store[field] = store[field].filter(x => x.toLowerCase() !== v.toLowerCase());
    store[field].unshift(v);
    if (store[field].length > TEST_DATA_MAX_RECENT) {
        store[field] = store[field].slice(0, TEST_DATA_MAX_RECENT);
    }
    try { localStorage.setItem(TEST_DATA_STORAGE_KEY, JSON.stringify(store)); } catch (e) { /* quota */ }
}

/** Llamado al guardar una evidencia: memoriza usuario/rol/criterio + sticky context. */
function rememberTestUserRoleUsage(usuarioPrueba, rolPrueba, criterioRef) {
    addRecentTestDataValue('usuarios', usuarioPrueba);
    addRecentTestDataValue('roles', rolPrueba);
    addRecentTestDataValue('criterios', criterioRef);
    // Guardar el contexto actual (sticky) para pre-poblar en próxima captura del MISMO test.
    try {
        localStorage.setItem(TEST_DATA_LAST_CONTEXT_KEY, JSON.stringify({
            usuarioPrueba: usuarioPrueba || '',
            rolPrueba: rolPrueba || '',
            criterioRef: criterioRef || ''
        }));
    } catch (e) { /* quota */ }
}

/** Devuelve el último contexto usado (para pre-poblar inputs al abrir el modal). */
function getLastTestDataContext() {
    try {
        const raw = localStorage.getItem(TEST_DATA_LAST_CONTEXT_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            usuarioPrueba: parsed.usuarioPrueba || '',
            rolPrueba: parsed.rolPrueba || '',
            criterioRef: parsed.criterioRef || ''
        };
    } catch (e) {
        return { usuarioPrueba: '', rolPrueba: '', criterioRef: '' };
    }
}

/** Refresca el contenido de los <datalist> con los valores recientes. */
function refreshTestDataDatalists() {
    const usuarios = getRecentTestDataValues('usuarios');
    const roles = getRecentTestDataValues('roles');
    const criteriosRecientes = getRecentTestDataValues('criterios');
    const tcIds = getRecentTestDataValues('tcIds');

    // Si el test activo viene de un protocolo (PIQ/POQ/PPQ), enriquecemos
    // el datalist de criterioRef con sus referencias oficiales — quedan primero,
    // y los recientes después, deduplicando.
    // - IQ: criterios consolidados como strings completos (los del array).
    // - OQ: "Paso 1", "Paso 2", ..., "Paso N", "Criterio aceptación" como
    //   etiquetas estructuradas que apuntan al procedimiento.
    let criterios = criteriosRecientes;
    const activeTest = activeTestId ? tests.find(t => t.id === activeTestId) : null;
    const g = activeTest && activeTest.protocolGuidance;
    if (g) {
        const oficiales = [];
        const isOq = g.schemaModo === 'procedimiento'
            || (Array.isArray(g.procedimiento) && g.procedimiento.length > 0);
        if (isOq && Array.isArray(g.procedimiento) && g.procedimiento.length > 0) {
            // OQ: etiquetas "Paso N" por cada paso + "Criterio aceptación"
            g.procedimiento.forEach((p, i) => {
                const num = p.paso != null ? p.paso : (i + 1);
                oficiales.push('Paso ' + num);
            });
            if (g.criterioAceptacion) oficiales.push('Criterio aceptación');
        } else if (Array.isArray(g.criterios) && g.criterios.length > 0) {
            // IQ: los criterios consolidados completos
            g.criterios.forEach(c => { if (c) oficiales.push(c); });
        }

        if (oficiales.length > 0) {
            const seen = new Set();
            criterios = [];
            oficiales.forEach(c => {
                const k = String(c).trim();
                if (k && !seen.has(k)) { seen.add(k); criterios.push(c); }
            });
            criteriosRecientes.forEach(c => {
                const k = String(c || '').trim();
                if (k && !seen.has(k)) { seen.add(k); criterios.push(c); }
            });
        }
    }

    function fill(datalistId, values) {
        const dl = document.getElementById(datalistId);
        if (!dl) return;
        dl.innerHTML = values.map(v => `<option value="${v.replace(/"/g, '&quot;')}">`).join('');
    }
    fill('dlUsuariosPrueba', usuarios);
    fill('dlRolesPrueba', roles);
    fill('dlCriteriosRef', criterios);
    fill('dlTcIds', tcIds);
}

// Exponer para debugging desde consola
window.getRecentTestDataValues = getRecentTestDataValues;
window.refreshTestDataDatalists = refreshTestDataDatalists;

/**
 * Mostrar modal de descripción
 */
function showDescriptionModal() {
    // Mostrar preview de la imagen
    const preview = document.getElementById('imagePreview');
    if (preview && pendingImage.data) {
        preview.innerHTML = `<img src="${pendingImage.data}" alt="Preview" style="width: 100%; display: block;">`;
    }

    // Mostrar metadatos del archivo si existen
    const metadataSection = document.getElementById('fileMetadataSection');
    if (pendingImage.exif) {
        metadataSection.style.display = 'block';

        // Nombre de archivo
        document.getElementById('metaFileName').textContent =
            pendingImage.exif.originalFileName || '-';

        // Ruta relativa (si existe)
        document.getElementById('metaFilePath').textContent =
            pendingImage.exif.relativePath || 'Archivo único (sin ruta)';

        // Fecha de captura EXIF
        document.getElementById('metaCaptureDate').textContent =
            pendingImage.exif.captureDate ? formatDateTime24h(pendingImage.exif.captureDate) : '-';

        // Cámara
        const camera = pendingImage.exif.cameraModel
            ? `${pendingImage.exif.cameraMake || ''} ${pendingImage.exif.cameraModel}`.trim()
            : '-';
        document.getElementById('metaCamera').textContent = camera;
    } else {
        // Ocultar sección si no hay metadatos
        metadataSection.style.display = 'none';
    }

    // Limpiar campos
    document.getElementById('evidenceDescription').value = '';
    document.getElementById('evidenceResultado').value = 'PASA';

    // Datos de prueba: pre-poblar con últimos valores usados (sticky entre capturas)
    // — el validador suele hacer 5-10 capturas seguidas con el mismo usuario/rol.
    // El TC NO se pregunta acá: viene del test activo (test.tcId).
    const lastCtx = getLastTestDataContext();
    const usuarioInput = document.getElementById('evidenceUsuarioPrueba');
    const rolInput = document.getElementById('evidenceRolPrueba');
    const criterioInput = document.getElementById('evidenceCriterioRef');
    if (usuarioInput) usuarioInput.value = lastCtx.usuarioPrueba || '';
    if (rolInput) rolInput.value = lastCtx.rolPrueba || '';
    // criterio NO es sticky — cambia por captura, así que parto del campo vacío
    if (criterioInput) criterioInput.value = '';

    // Refrescar datalists con valores recientes
    refreshTestDataDatalists();

    // Mostrar modal
    showModal('modalDescription');
}

/**
 * Confirmar evidencia y guardarla
 */
async function confirmEvidence() {
    if (!activeTestId || !pendingImage.data) {
        showNotification('Error: No hay imagen pendiente', 'error');
        return;
    }

    const test = tests.find(t => t.id === activeTestId);
    if (!test) {
        showNotification('Error: Prueba no encontrada', 'error');
        return;
    }

    // Bloquear si finalizado en cualquier nivel del cascade
    if (isTestLocked(test)) {
        showNotification(`No se pueden agregar evidencias — ${lockReasonForTest(test)}`, 'error');
        return;
    }

    const description = document.getElementById('evidenceDescription').value.trim();
    const operacion = document.getElementById('evidenceOperacion').value.trim();
    const resultado = document.getElementById('evidenceResultado').value;

    // Datos de prueba: usuario y rol cambian por captura, TC se hereda del test, criterio es manual.
    const usuarioPrueba = (document.getElementById('evidenceUsuarioPrueba')?.value || '').trim();
    const rolPrueba = (document.getElementById('evidenceRolPrueba')?.value || '').trim();
    const criterioRef = (document.getElementById('evidenceCriterioRef')?.value || '').trim();
    // TC asociado se deriva del test activo (configurado al crear/editar el test).
    const testCaseRef = (test.tcId || '').trim();

    if (!description) {
        drpAlert('La descripcion es obligatoria', 'Campo requerido', 'warning');
        return;
    }

    if (!operacion) {
        drpAlert('La operacion/funcion probada es obligatoria', 'Campo requerido', 'warning');
        return;
    }
    // Calcular siguiente paso
    const nextStep = test.evidences.length + 1;

    // Crear evidencia
    const evidence = {
        step: insertBeforeIndex !== null ? insertBeforeIndex + 1 : nextStep,
        image: pendingImage.data,
        description: description,
        operacion: operacion,
        resultado: resultado,
        // Datos de prueba (opcionales — vacíos si no aplican, ej. tests de infraestructura)
        usuarioPrueba: usuarioPrueba,
        rolPrueba: rolPrueba,
        testCaseRef: testCaseRef,        // heredado del test (test.tcId) — puede estar vacío
        criterioRef: criterioRef,         // criterio/paso dentro del TC — manual por captura
        timestamp: new Date().toISOString(),
        captureTimestamp: pendingImage.captureTimestamp,
        size: pendingImage.size,
        dimensions: pendingImage.dimensions,
        testName: test.name,
        executor: executor || document.getElementById('ejecutor').value.trim(),
        isEmpty: false,
        // Metadatos EXIF (si existen)
        exif: pendingImage.exif || null
    };

    // Memorizar usuario/rol/criterio para autocompletado en próximas capturas
    rememberTestUserRoleUsage(usuarioPrueba, rolPrueba, criterioRef);

    // Insertar evidencia
    if (insertBeforeIndex !== null) {
        // Insertar ANTES de un paso específico
        test.evidences.splice(insertBeforeIndex, 0, evidence);
        renumberSteps(test);
        insertBeforeIndex = null;
    } else {
        // Agregar al final
        test.evidences.push(evidence);
    }

    // Limpiar pendingImage
    pendingImage = {
        data: null,
        size: null,
        dimensions: null,
        captureTimestamp: null
    };

    // Cerrar modal y renderizar
    closeModal('modalDescription');
    renderWorkArea();
    renderTests(); // Actualizar contador
    saveToStorage();

    showNotification('Evidencia agregada correctamente');
}

/**
 * Extraer metadatos EXIF de una imagen
 * @param {File} file - Archivo de imagen
 * @param {Function} callback - Callback con los metadatos extraídos
 */
function extractEXIFMetadata(file, callback) {
    const reader = new FileReader();

    reader.onload = function (e) {
        const img = new Image();

        img.onload = function () {
            // Extraer datos EXIF usando librería EXIF.js
            EXIF.getData(img, function () {
                const exifData = {
                    // Nombre original del archivo
                    originalFileName: file.name,

                    // Ruta relativa (solo disponible si se sube carpeta completa)
                    relativePath: file.webkitRelativePath || null,

                    // Fecha de captura original (si existe)
                    dateTimeOriginal: EXIF.getTag(this, 'DateTimeOriginal') || null,

                    // Fecha de digitalización
                    dateTimeDigitized: EXIF.getTag(this, 'DateTimeDigitized') || null,

                    // Modelo de cámara
                    cameraMake: EXIF.getTag(this, 'Make') || null,
                    cameraModel: EXIF.getTag(this, 'Model') || null,

                    // GPS (si existe)
                    gpsLatitude: EXIF.getTag(this, 'GPSLatitude') || null,
                    gpsLongitude: EXIF.getTag(this, 'GPSLongitude') || null,

                    // Orientación
                    orientation: EXIF.getTag(this, 'Orientation') || 1,

                    // Tamaño del archivo
                    fileSize: file.size,

                    // Tipo MIME
                    mimeType: file.type
                };

                // Convertir fecha EXIF (formato: "2024:12:25 14:30:00") a ISO
                if (exifData.dateTimeOriginal) {
                    try {
                        const exifDate = exifData.dateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                        exifData.captureDate = new Date(exifDate).toISOString();
                    } catch (e) {
    // //                         console.warn('Error parseando fecha EXIF:', e);
                        exifData.captureDate = null;
                    }
                }

                // console.log('📋 Metadatos EXIF extraídos:', {
                //     archivo: exifData.originalFileName,
                //     ruta: exifData.relativePath || 'No disponible (archivo único)',
                //     fechaCaptura: exifData.captureDate || 'No disponible',
                //     camara: exifData.cameraModel || 'Desconocida'
                // });

                callback(exifData);
            });
        };

        img.src = e.target.result;
    };

    reader.readAsDataURL(file);
}

/**
 * Manejar upload de archivo de imagen
 */
function handleImageUpload(file) {
    if (!activeTestId) {
        showNotification('Selecciona una prueba primero', 'error');
        return;
    }

    const test = tests.find(t => t.id === activeTestId);


    if (!file.type.startsWith('image/')) {
        showNotification('El archivo no es una imagen', 'error');
        return;
    }

    // //     console.log('Imagen cargada desde archivo:', file.name, file.size, 'bytes');

    // Extraer metadatos EXIF primero
    extractEXIFMetadata(file, (exifData) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                // Comprimir antes de guardar
                compressImage(img, (compressedDataURL, compressedSize) => {
                    // Guardar en pendingImage con metadatos EXIF
                    pendingImage = {
                        data: compressedDataURL,
                        size: formatBytes(compressedSize),
                        dimensions: `${img.width}x${img.height}`,
                        captureTimestamp: exifData.captureDate || new Date().toISOString(),
                        // Metadatos EXIF
                        exif: {
                            originalFileName: exifData.originalFileName,
                            captureDate: exifData.captureDate,
                            cameraMake: exifData.cameraMake,
                            cameraModel: exifData.cameraModel,
                            fileSize: exifData.fileSize,
                            mimeType: exifData.mimeType
                        }
                    };

                    // Mostrar modal de descripción
                    showDescriptionModal();
                }, 'file');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Manejar múltiples imágenes
 */
function handleMultipleImages(files) {
    if (!activeTestId) {
        showNotification('Selecciona una prueba primero', 'error');
        return;
    }

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;


    // console.log(`📁 Procesando ${files.length} imágenes...`);
    showNotification(`Cargando ${files.length} imágenes...`);

    let processedCount = 0;
    let errorCount = 0;

    function processNext(index) {
        if (index >= files.length) {
            // Todas procesadas
            renderWorkArea();
            saveToStorage();
            showNotification(`✓ ${processedCount} imágenes agregadas${errorCount > 0 ? ` (${errorCount} errores)` : ''}`);
    // //             console.log(`✓ Upload masivo completado: ${processedCount}/${files.length}`);
            return;
        }

        const file = files[index];

        // Validar que sea imagen
        if (!file.type.startsWith('image/')) {
    // //             console.warn(`Archivo omitido (no es imagen): ${file.name}`);
            errorCount++;
            processNext(index + 1);
            return;
        }

        // Extraer metadatos EXIF para cada imagen
        extractEXIFMetadata(file, (exifData) => {
            const reader = new FileReader();

            reader.onload = function (e) {
                const img = new Image();

                img.onload = function () {
                    compressImage(img, (compressedDataURL, compressedSize) => {
                        const evidence = {
                            step: test.evidences.length + 1,
                            image: compressedDataURL,
                            description: `${file.name}`,
                            resultado: 'PASA',
                            timestamp: new Date().toISOString(),
                            captureTimestamp: exifData.captureDate || new Date().toISOString(),
                            size: formatBytes(compressedSize),
                            dimensions: `${img.width}x${img.height}`,
                            testName: test.name,
                            executor: executor || document.getElementById('ejecutor').value.trim(),
                            isEmpty: false,
                            // Metadatos EXIF
                            exif: {
                                originalFileName: exifData.originalFileName,
                                relativePath: exifData.relativePath,
                                captureDate: exifData.captureDate,
                                cameraMake: exifData.cameraMake,
                                cameraModel: exifData.cameraModel
                            }
                        };

                        test.evidences.push(evidence);
                        processedCount++;

    // //                         console.log(`✓ Imagen ${processedCount}/${files.length}: ${file.name}${exifData.relativePath ? ` (${exifData.relativePath})` : ''}`);

                        // Procesar siguiente
                        processNext(index + 1);
                    }, 'file');
                };

                img.onerror = function () {
    // //                     console.error(`Error cargando imagen: ${file.name}`);
                    errorCount++;
                    processNext(index + 1);
                };

                img.src = e.target.result;
            };

            reader.readAsDataURL(file);
        });
    }

    // Iniciar procesamiento
    processNext(0);
}

/**
 * Renumerar pasos después de inserción/eliminación
 */
function renumberSteps(test) {
    test.evidences.forEach((evidence, index) => {
        evidence.step = index + 1;
    });
}

/* ====================================================================
   MÓDULO 5: GESTIÓN DE TABLAS
   ==================================================================== */

/**
 * Insertar tabla en el área de trabajo
 */
function addTable() {
    if (!activeTestId) {
        showNotification('Selecciona una prueba primero', 'error');
        return;
    }

    const test = tests.find(t => t.id === activeTestId);
    if (!test || test.finalized) {
        showNotification('No se puede agregar tabla', 'error');
        return;
    }

    // Obtener valores del modal
    const title = document.getElementById('tableTitle').value.trim();
    const rows = parseInt(document.getElementById('tableRows').value) || 3;
    const cols = parseInt(document.getElementById('tableCols').value) || 4;
    const hasHeader = document.getElementById('tableHasHeader').checked;
    const alternateRows = document.getElementById('tableAlternateRows').checked;
    const withBorders = document.getElementById('tableWithBorders').checked;

    // Validar
    if (rows < 1 || rows > 50) {
        showNotification('Filas debe estar entre 1 y 50', 'error');
        return;
    }

    if (cols < 2 || cols > 10) {
        showNotification('Columnas debe estar entre 2 y 10', 'error');
        return;
    }

    // Generar HTML de la tabla
    const tableHTML = generateTableHTML(title, rows, cols, hasHeader, alternateRows, withBorders);

    // Agregar como "evidencia" especial de tipo tabla
    // Crear estructura de datos inicial
    const initialData = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            if (hasHeader && r === 0) {
                row.push(`Columna ${c + 1}`);
            } else {
                row.push('');
            }
        }
        initialData.push(row);
    }

    // Agregar como "evidencia" especial de tipo tabla
    const tableEvidence = {
        step: test.evidences.length + 1,
        type: 'table',  // Identificador especial
        title: title || 'Tabla sin título',
        description: '',
        resultado: 'PASA',
        tableHTML: tableHTML,
        tableData: initialData,  // NUEVO: Datos estructurados
        rows: rows,
        cols: cols,
        hasHeader: hasHeader,
        timestamp: new Date().toISOString(),
        testName: test.name,
        executor: executor || document.getElementById('ejecutor').value.trim()
    };

    test.evidences.push(tableEvidence);

    closeModal('modalAddTable');
    renderWorkArea();
    saveToStorage();

    showNotification(`Tabla ${rows}x${cols} insertada`);
}

/**
 * Generar HTML de tabla con estilos
 */
function generateTableHTML(title, rows, cols, hasHeader, alternateRows, withBorders) {
    let html = '';

    // Título (si existe)
    if (title) {
        html += `<div style="margin-bottom: 10px; font-weight: 700; font-size: 14px; color: var(--vsc-azul);">${title}</div>`;
    }

    // Estilos de la tabla
    const borderStyle = withBorders ? '1px solid var(--vsc-gris)' : 'none';
    const tableStyle = `
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
        font-size: 11px;
    `.trim();

    html += `<table style="${tableStyle}" class="inserted-table">`;

    // Header (si está habilitado)
    if (hasHeader) {
        html += '<thead><tr>';
        for (let c = 0; c < cols; c++) {
            const headerStyle = `
                background: var(--vsc-azul);
                color: var(--vsc-blanco);
                padding: 10px;
                border: ${borderStyle};
                font-weight: 700;
                text-align: left;
            `.trim();
            html += `<th style="${headerStyle}" contenteditable="true">Columna ${c + 1}</th>`;
        }
        html += '</tr></thead>';
    }

    // Body (filas de datos)
    html += '<tbody>';
    for (let r = 0; r < rows; r++) {
        const rowBg = (alternateRows && r % 2 === 1) ? 'var(--vsc-gris-claro)' : 'transparent';
        html += `<tr style="background: ${rowBg};">`;

        for (let c = 0; c < cols; c++) {
            const cellStyle = `
                padding: 8px 10px;
                border: ${borderStyle};
                text-align: left;
            `.trim();
            html += `<td style="${cellStyle}" contenteditable="true">&nbsp;</td>`;
        }

        html += '</tr>';
    }
    html += '</tbody>';

    html += '</table>';

    return html;
}

/**
 * Editar tabla existente (abrir en modal)
 */
/* ====================================================================
   EDITOR AVANZADO DE TABLAS
   ==================================================================== */

let currentEditingTableIndex = null;
let currentEditingTableData = null;

/**
 * Abrir editor de tabla avanzado
 */
function editTable(index) {
    if (!activeTestId) return;

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence || evidence.type !== 'table') {
        showNotification('No es una tabla', 'error');
        return;
    }

    // Guardar índice de la tabla que estamos editando
    currentEditingTableIndex = index;

    // Cargar datos actuales de la tabla
    currentEditingTableData = {
        title: evidence.title || '',
        description: evidence.description || '',
        resultado: evidence.resultado || 'PASA',
        rows: evidence.rows || 3,
        cols: evidence.cols || 4,
        hasHeader: evidence.hasHeader || false,
        data: evidence.tableData || extractTableData(evidence.tableHTML, evidence.rows, evidence.cols, evidence.hasHeader)
    };

    // Cargar valores en el modal
    document.getElementById('editTableTitle').value = currentEditingTableData.title;
    document.getElementById('editTableDescription').value = currentEditingTableData.description || '';
    document.getElementById('editTableResultado').value = currentEditingTableData.resultado;
    document.getElementById('editTableHasHeader').checked = currentEditingTableData.hasHeader;

    // Renderizar tabla en el preview
    renderEditingTable();

    // Mostrar modal
    showModal('modalEditTable');
}

/**
 * Extraer datos de tabla desde HTML (para retrocompatibilidad)
 */
function extractTableData(tableHTML, rows, cols, hasHeader) {
    const data = [];

    // Crear un elemento temporal para parsear el HTML
    const temp = document.createElement('div');
    temp.innerHTML = tableHTML;

    const table = temp.querySelector('table');
    if (!table) {
        // Si no hay tabla, crear datos vacíos
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                row.push('');
            }
            data.push(row);
        }
        return data;
    }

    // Extraer datos de celdas
    const allRows = table.querySelectorAll('tr');
    const startRow = hasHeader ? 1 : 0; // Saltar header si existe

    for (let r = startRow; r < allRows.length; r++) {
        const cells = allRows[r].querySelectorAll('td, th');
        const rowData = [];
        for (let c = 0; c < cells.length; c++) {
            rowData.push(cells[c].textContent.trim() || '');
        }
        data.push(rowData);
    }

    return data;
}

/**
 * Renderizar tabla en modo edición
 */
function renderEditingTable() {
    if (!currentEditingTableData) return;

    const { data, hasHeader } = currentEditingTableData;
    const rows = data.length;
    const cols = data[0]?.length || 0;

    let html = '<table style="width: 100%; border-collapse: collapse;" class="editing-table">';

    // Header (si está habilitado)
    if (hasHeader) {
        html += '<thead><tr>';
        for (let c = 0; c < cols; c++) {
            const headerValue = data[0]?.[c] || `Columna ${c + 1}`;
            html += `
                <th style="background: var(--vsc-azul); color: white; padding: 10px; border: 1px solid var(--vsc-gris); font-weight: 700;">
                    <input type="text" 
                           value="${headerValue}" 
                           onchange="updateEditingTableCell(0, ${c}, this.value)"
                           style="width: 100%; background: transparent; border: none; color: white; font-weight: 700; text-align: left;">
                </th>
            `;
        }
        html += '</tr></thead>';
    }

    // Body
    html += '<tbody>';
    const startRow = hasHeader ? 1 : 0;

    for (let r = startRow; r < rows; r++) {
        const rowBg = r % 2 === 0 ? 'white' : 'var(--vsc-gris-claro)';
        html += `<tr style="background: ${rowBg};">`;

        for (let c = 0; c < cols; c++) {
            const cellValue = data[r]?.[c] || '';
            html += `
                <td style="padding: 8px 10px; border: 1px solid var(--vsc-gris);">
                    <input type="text" 
                           value="${cellValue}" 
                           onchange="updateEditingTableCell(${r}, ${c}, this.value)"
                           style="width: 100%; background: transparent; border: none;">
                </td>
            `;
        }

        html += '</tr>';
    }
    html += '</tbody>';
    html += '</table>';

    document.getElementById('editTablePreview').innerHTML = html;
}

/**
 * Actualizar valor de celda
 */
function updateEditingTableCell(row, col, value) {
    if (!currentEditingTableData || !currentEditingTableData.data[row]) return;
    currentEditingTableData.data[row][col] = value;
}

/**
 * Agregar fila a tabla en edición
 */
function addRowToEditingTable() {
    if (!currentEditingTableData) return;

    const cols = currentEditingTableData.data[0]?.length || 4;
    const newRow = new Array(cols).fill('');

    currentEditingTableData.data.push(newRow);
    currentEditingTableData.rows = currentEditingTableData.data.length;

    renderEditingTable();
    showNotification('Fila agregada');
}

/**
 * Quitar última fila
 */
function removeRowFromEditingTable() {
    if (!currentEditingTableData) return;

    const minRows = currentEditingTableData.hasHeader ? 2 : 1;

    if (currentEditingTableData.data.length <= minRows) {
        showNotification('No se puede quitar más filas', 'error');
        return;
    }

    currentEditingTableData.data.pop();
    currentEditingTableData.rows = currentEditingTableData.data.length;

    renderEditingTable();
    showNotification('Fila eliminada');
}

/**
 * Agregar columna a tabla en edición
 */
function addColumnToEditingTable() {
    if (!currentEditingTableData) return;

    if (currentEditingTableData.data[0]?.length >= 10) {
        showNotification('Máximo 10 columnas', 'error');
        return;
    }

    currentEditingTableData.data.forEach(row => {
        row.push('');
    });

    currentEditingTableData.cols = currentEditingTableData.data[0].length;

    renderEditingTable();
    showNotification('Columna agregada');
}

/**
 * Quitar última columna
 */
function removeColumnFromEditingTable() {
    if (!currentEditingTableData) return;

    if (currentEditingTableData.data[0]?.length <= 2) {
        showNotification('Mínimo 2 columnas', 'error');
        return;
    }

    currentEditingTableData.data.forEach(row => {
        row.pop();
    });

    currentEditingTableData.cols = currentEditingTableData.data[0].length;

    renderEditingTable();
    showNotification('Columna eliminada');
}

/**
 * Guardar cambios de tabla editada
 */
function saveTableChanges() {
    if (!activeTestId || currentEditingTableIndex === null) return;

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[currentEditingTableIndex];
    if (!evidence || evidence.type !== 'table') return;

    // Capturar valores actualizados del modal
    currentEditingTableData.title = document.getElementById('editTableTitle').value.trim();
    currentEditingTableData.description = document.getElementById('editTableDescription').value.trim();
    currentEditingTableData.resultado = document.getElementById('editTableResultado').value;
    currentEditingTableData.hasHeader = document.getElementById('editTableHasHeader').checked;

    // Actualizar evidencia con nuevos datos
    evidence.title = currentEditingTableData.title || 'Tabla sin título';
    evidence.description = currentEditingTableData.description;
    evidence.resultado = currentEditingTableData.resultado;
    evidence.rows = currentEditingTableData.data.length;
    evidence.cols = currentEditingTableData.data[0]?.length || 0;
    evidence.hasHeader = currentEditingTableData.hasHeader;
    evidence.tableData = JSON.parse(JSON.stringify(currentEditingTableData.data)); // Deep copy

    // Regenerar HTML para visualización
    evidence.tableHTML = generateTableHTMLFromData(
        currentEditingTableData.title,
        currentEditingTableData.data,
        currentEditingTableData.hasHeader
    );

    // Limpiar estado de edición
    currentEditingTableIndex = null;
    currentEditingTableData = null;

    closeModal('modalEditTable');
    renderWorkArea();
    saveToStorage();

    showNotification('Tabla actualizada correctamente');
}

/**
 * Generar HTML de tabla desde datos estructurados
 */
function generateTableHTMLFromData(title, data, hasHeader) {
    let html = '';

    // Título
    if (title) {
        html += `<div style="margin-bottom: 10px; font-weight: 700; font-size: 14px; color: var(--vsc-azul);">${title}</div>`;
    }

    const tableStyle = `
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
        font-size: 11px;
    `.trim();

    html += `<table style="${tableStyle}" class="inserted-table">`;

    const rows = data.length;
    const cols = data[0]?.length || 0;

    // Header
    if (hasHeader && data[0]) {
        html += '<thead><tr>';
        for (let c = 0; c < cols; c++) {
            const headerStyle = `
                background: var(--vsc-azul);
                color: var(--vsc-blanco);
                padding: 10px;
                border: 1px solid var(--vsc-gris);
                font-weight: 700;
                text-align: left;
            `.trim();
            html += `<th style="${headerStyle}" contenteditable="true">${data[0][c] || `Columna ${c + 1}`}</th>`;
        }
        html += '</tr></thead>';
    }

    // Body
    html += '<tbody>';
    const startRow = hasHeader ? 1 : 0;

    for (let r = startRow; r < rows; r++) {
        const rowBg = r % 2 === 1 ? 'var(--vsc-gris-claro)' : 'transparent';
        html += `<tr style="background: ${rowBg};">`;

        for (let c = 0; c < cols; c++) {
            const cellStyle = `
                padding: 8px 10px;
                border: 1px solid var(--vsc-gris);
                text-align: left;
            `.trim();
            html += `<td style="${cellStyle}" contenteditable="true">${data[r][c] || '&nbsp;'}</td>`;
        }

        html += '</tr>';
    }
    html += '</tbody>';
    html += '</table>';

    return html;
}
/**
 * Eliminar tabla
 */
async function deleteTable(index) {
    if (!activeTestId) return;

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence || evidence.type !== 'table') return;

    if (!await drpConfirm(`Se eliminara la tabla "${evidence.title}".`, 'Eliminar tabla?', 'danger')) return;

    test.evidences.splice(index, 1);
    renumberSteps(test);
    renderWorkArea();
    saveToStorage();

    showNotification('Tabla eliminada');
}

/**
 * Guardar cambios de tabla inline (contenteditable)
 */
function saveTableInline(index) {
    if (!activeTestId) return;

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence || evidence.type !== 'table') return;

    // Capturar HTML actual del contenedor
    const tableContainer = document.getElementById(`tableContainer_${index}`);
    if (!tableContainer) {
        showNotification('No se pudo encontrar la tabla', 'error');
        return;
    }

    // Extraer datos actualizados desde el HTML editado
    const updatedHTML = tableContainer.innerHTML;
    const updatedData = extractTableDataFromEditedHTML(updatedHTML, evidence.hasHeader);

    if (!updatedData || updatedData.length === 0) {
        showNotification('No se pudieron extraer datos de la tabla', 'error');
        return;
    }

    // Actualizar evidencia
    evidence.tableData = updatedData;
    evidence.rows = updatedData.length;
    evidence.cols = updatedData[0]?.length || 0;
    evidence.tableHTML = updatedHTML; // Guardar HTML editado

    // Guardar en localStorage
    saveToStorage();

    showNotification(`Tabla guardada: ${evidence.rows}×${evidence.cols}`, 'success');

    // //     console.log('✅ Tabla guardada inline:', {
    //     rows: evidence.rows,
    //     cols: evidence.cols,
    //     data: evidence.tableData
    // });
}

/**
 * Extraer datos desde HTML contenteditable (tabla ya renderizada en DOM)
 */
function extractTableDataFromEditedHTML(tableHTML, hasHeader) {
    const data = [];
    const temp = document.createElement('div');
    temp.innerHTML = tableHTML;

    const table = temp.querySelector('table');
    if (!table) {
    // //         console.error('❌ No se encontró <table> en el HTML');
        return data;
    }

    // EXTRAER HEADER (si existe)
    if (hasHeader) {
        const thead = table.querySelector('thead');
        if (thead) {
            const headerRow = thead.querySelector('tr');
            if (headerRow) {
                const headerCells = headerRow.querySelectorAll('th');
                const headerData = [];
                headerCells.forEach(cell => {
                    headerData.push(cell.textContent.trim() || '');
                });
                if (headerData.length > 0) {
                    data.push(headerData);
                }
            }
        }
    }

    // EXTRAER BODY
    const tbody = table.querySelector('tbody');
    if (tbody) {
        const bodyRows = tbody.querySelectorAll('tr');

        bodyRows.forEach(tr => {
            const cells = tr.querySelectorAll('td');
            const rowData = [];

            cells.forEach(cell => {
                rowData.push(cell.textContent.trim() || '');
            });

            if (rowData.length > 0) {
                data.push(rowData);
            }
        });
    }

    // //     console.log('✅ Datos extraídos desde HTML editado:', data.length, 'filas');
    return data;
}
/* ====================================================================
   MÓDULO 6: EDITOR DE IMÁGENES (Fabric.js)
   ==================================================================== */

/**
 * Abrir editor de imágenes
 */
function openImageEditor(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence || evidence.type === 'table') {
        showNotification('Solo se pueden editar imágenes', 'error');
        return;
    }

    currentEditingIndex = index;

    // Mostrar modal
    showModal('modalImageEditor');

    // Inicializar canvas después de que el modal sea visible
    setTimeout(() => {
        initImageEditor(evidence.image);
    }, 100);
}

/**
 * Inicializar canvas de Fabric.js
 */
function initImageEditor(imageDataURL) {
    const canvasElement = document.getElementById('imageEditorCanvas');
    if (!canvasElement) {
    // //         console.error('Canvas element not found');
        return;
    }

    // Destruir canvas anterior si existe
    if (fabricCanvas) {
        fabricCanvas.dispose();
        fabricCanvas = null;
    }

    // Crear nuevo canvas
    fabricCanvas = new fabric.Canvas('imageEditorCanvas', {
        backgroundColor: '#f0f0f0',
        selection: true
    });

    // Cargar imagen de fondo
    fabric.Image.fromURL(imageDataURL, function (img) {
        // Ajustar tamaño del canvas a la imagen
        const maxWidth = 900;
        const maxHeight = 600;

        let scale = 1;
        if (img.width > maxWidth || img.height > maxHeight) {
            const scaleX = maxWidth / img.width;
            const scaleY = maxHeight / img.height;
            scale = Math.min(scaleX, scaleY);
        }

        fabricCanvas.setWidth(img.width * scale);
        fabricCanvas.setHeight(img.height * scale);

        img.scale(scale);
        img.selectable = false;
        img.evented = false;

        fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas));

    // //         console.log('✓ Editor inicializado:', fabricCanvas.width, 'x', fabricCanvas.height);

        // CRÍTICO: Guardar estado inicial vacío en historial
        saveToHistory();
    });

    // Reset history
    editorHistory = [];
    editorHistoryIndex = -1;

    // Configurar event listeners de herramientas
    setupEditorToolListeners();

    // Configurar atajos de teclado
    setupKeyboardShortcuts();
}

/**
 * Configurar listeners de herramientas
 */
function setupEditorToolListeners() {
    const toolButtons = document.querySelectorAll('.tool-btn');

    toolButtons.forEach(btn => {
        // Remover listeners anteriores
        btn.replaceWith(btn.cloneNode(true));
    });

    // Re-seleccionar después de clonar
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const tool = this.getAttribute('data-tool');

            // Remover clase active de todos
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));

            switch (tool) {
                case 'rectangle':
                    this.classList.add('active');
                    enableRectangleTool();
                    break;
                case 'arrow':
                    this.classList.add('active');
                    enableArrowTool();
                    break;
                case 'circle':
                    this.classList.add('active');
                    enableCircleTool();
                    break;
                case 'text':
                    this.classList.add('active');
                    enableTextTool();
                    break;
                case 'undo':
                    undoAction();
                    break;
                case 'clear':
                    clearCanvas();
                    break;
            }
        });
    });
    // Listener para color picker
    const colorPicker = document.getElementById('drawColorPicker');
    if (colorPicker) {
        colorPicker.addEventListener('input', function () {
            currentDrawColor = this.value;
            // console.log('🎨 Color cambiado a:', currentDrawColor);
        });
    }

    // Listeners para botones de acceso rápido
    const quickColorBtns = document.querySelectorAll('.color-quick-btn');
    quickColorBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const color = this.getAttribute('data-color');
            currentDrawColor = color;
            if (colorPicker) {
                colorPicker.value = color;
            }
            // console.log('🎨 Color rápido seleccionado:', color);
        });
    });
}

/**
 * Configurar atajos de teclado para el editor
 */
/**
 * Configurar atajos de teclado para el editor
 */
function setupKeyboardShortcuts() {
    // Remover listener anterior si existe
    document.removeEventListener('keydown', handleEditorKeydown);

    // Agregar nuevo listener
    document.addEventListener('keydown', handleEditorKeydown);
}

function handleEditorKeydown(e) {
    // Solo funcionar si el modal está abierto
    const modal = document.getElementById('modalImageEditor');
    if (!modal || modal.style.display === 'none') return;

    // CTRL+Z - Deshacer
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoAction();
    }

    // CTRL+Y o CTRL+SHIFT+Z - Rehacer
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        redoAction();
    }

    // DELETE - Eliminar objeto seleccionado (SOLO si NO está editando texto)
    if (e.key === 'Delete' && fabricCanvas) {
        const activeObject = fabricCanvas.getActiveObject();
        if (activeObject && activeObject.type !== 'i-text') {
            // Solo eliminar si NO es texto editable
            fabricCanvas.remove(activeObject);
            saveToHistory();
            showNotification('Elemento eliminado');
        } else if (activeObject && activeObject.type === 'i-text' && !activeObject.isEditing) {
            // Si es texto PERO NO está en modo edición, sí eliminarlo
            fabricCanvas.remove(activeObject);
            saveToHistory();
            showNotification('Texto eliminado');
        }
        // Si está editando texto (isEditing = true), dejar que DELETE funcione normal dentro del texto
    }
}

/**
 * Habilitar herramienta de rectángulo
 */
function enableRectangleTool() {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true;

    let isDrawing = false;
    let rect = null;
    let startX, startY;

    fabricCanvas.off('mouse:down');
    fabricCanvas.off('mouse:move');
    fabricCanvas.off('mouse:up');

    fabricCanvas.on('mouse:down', function (o) {
        isDrawing = true;
        const pointer = fabricCanvas.getPointer(o.e);
        startX = pointer.x;
        startY = pointer.y;

        rect = new fabric.Rect({
            left: startX,
            top: startY,
            width: 0,
            height: 0,
            fill: 'transparent',
            stroke: currentDrawColor,
            strokeWidth: 3
        });

        fabricCanvas.add(rect);
    });

    fabricCanvas.on('mouse:move', function (o) {
        if (!isDrawing) return;

        const pointer = fabricCanvas.getPointer(o.e);

        if (pointer.x < startX) {
            rect.set({ left: pointer.x });
        }
        if (pointer.y < startY) {
            rect.set({ top: pointer.y });
        }

        rect.set({
            width: Math.abs(pointer.x - startX),
            height: Math.abs(pointer.y - startY)
        });

        fabricCanvas.renderAll();
    });

    fabricCanvas.on('mouse:up', function () {
        isDrawing = false;
        saveToHistory();
    });

    showNotification('Herramienta: Rectángulo activada');
}

/**
 * Habilitar herramienta de flecha
 */
function enableArrowTool() {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true;

    let isDrawing = false;
    let line = null;
    let triangle = null;
    let startX, startY;

    fabricCanvas.off('mouse:down');
    fabricCanvas.off('mouse:move');
    fabricCanvas.off('mouse:up');

    fabricCanvas.on('mouse:down', function (o) {
        isDrawing = true;
        const pointer = fabricCanvas.getPointer(o.e);
        startX = pointer.x;
        startY = pointer.y;

        line = new fabric.Line([startX, startY, startX, startY], {
            stroke: currentDrawColor,
            strokeWidth: 3,
            selectable: false
        });

        fabricCanvas.add(line);
    });

    fabricCanvas.on('mouse:move', function (o) {
        if (!isDrawing) return;

        const pointer = fabricCanvas.getPointer(o.e);
        line.set({ x2: pointer.x, y2: pointer.y });

        fabricCanvas.renderAll();
    });

    fabricCanvas.on('mouse:up', function (o) {
        isDrawing = false;

        const pointer = fabricCanvas.getPointer(o.e);

        // Calcular ángulo para la punta de flecha
        const angle = Math.atan2(pointer.y - startY, pointer.x - startX);

        // Crear triángulo para la punta
        const arrowLength = 15;
        triangle = new fabric.Triangle({
            left: pointer.x,
            top: pointer.y,
            width: arrowLength,
            height: arrowLength,
            fill: currentDrawColor,
            angle: (angle * 180 / Math.PI) + 90,
            originX: 'center',
            originY: 'center',
            selectable: false
        });

        fabricCanvas.add(triangle);

        // Agrupar línea y triángulo
        const group = new fabric.Group([line, triangle], {
            selectable: true
        });

        fabricCanvas.remove(line, triangle);
        fabricCanvas.add(group);

        saveToHistory();
    });

    showNotification('Herramienta: Flecha activada');
}

/**
 * Habilitar herramienta de círculo
 */
function enableCircleTool() {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true;

    let isDrawing = false;
    let circle = null;
    let startX, startY;

    fabricCanvas.off('mouse:down');
    fabricCanvas.off('mouse:move');
    fabricCanvas.off('mouse:up');

    fabricCanvas.on('mouse:down', function (o) {
        isDrawing = true;
        const pointer = fabricCanvas.getPointer(o.e);
        startX = pointer.x;
        startY = pointer.y;

        circle = new fabric.Circle({
            left: startX,
            top: startY,
            radius: 0,
            fill: 'transparent',
            stroke: currentDrawColor,
            strokeWidth: 3
        });

        fabricCanvas.add(circle);
    });

    fabricCanvas.on('mouse:move', function (o) {
        if (!isDrawing) return;

        const pointer = fabricCanvas.getPointer(o.e);
        const radius = Math.sqrt(Math.pow(pointer.x - startX, 2) + Math.pow(pointer.y - startY, 2));

        circle.set({ radius: radius });
        fabricCanvas.renderAll();
    });

    fabricCanvas.on('mouse:up', function () {
        isDrawing = false;
        saveToHistory();
    });

    showNotification('Herramienta: Círculo activada');
}


function enableTextTool() {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true;


    fabricCanvas.off('mouse:down');
    fabricCanvas.off('mouse:move');
    fabricCanvas.off('mouse:up');


    fabricCanvas.once('mouse:down', function (o) {
        const pointer = fabricCanvas.getPointer(o.e);

        const text = new fabric.IText('Texto', {
            left: pointer.x,
            top: pointer.y,
            fontFamily: 'Arial',
            fontSize: 24,
            fill: currentDrawColor,
            fontWeight: 'bold',
            editable: true,
            selectable: true
        });

        fabricCanvas.add(text);
        fabricCanvas.setActiveObject(text);
        text.enterEditing();

        text.selectAll();

        saveToHistory();

        setTimeout(() => {
            enableTextTool();
        }, 100);
    });

    showNotification('Herramienta: Texto activada - Haz click para agregar');
}


function saveToHistory() {
    if (!fabricCanvas) return;

    const json = fabricCanvas.toJSON();


    editorHistory = editorHistory.slice(0, editorHistoryIndex + 1);


    editorHistory.push(JSON.stringify(json));
    editorHistoryIndex++;

    if (editorHistory.length > 20) {
        editorHistory.shift();
        editorHistoryIndex--;
    }
}


function undoAction() {
    if (!fabricCanvas) return;

    if (editorHistoryIndex > 0) {
        editorHistoryIndex--;
        const state = JSON.parse(editorHistory[editorHistoryIndex]);
        fabricCanvas.loadFromJSON(state, fabricCanvas.renderAll.bind(fabricCanvas));
        showNotification('Deshacer');
    } else {
        showNotification('No hay acciones para deshacer', 'error');
    }
}

function redoAction() {
    if (!fabricCanvas) return;

    if (editorHistoryIndex < editorHistory.length - 1) {
        editorHistoryIndex++;
        const state = JSON.parse(editorHistory[editorHistoryIndex]);
        fabricCanvas.loadFromJSON(state, fabricCanvas.renderAll.bind(fabricCanvas));
        showNotification('Rehacer');
    } else {
        showNotification('No hay acciones para rehacer', 'error');
    }
}

async function clearCanvas() {
    if (!fabricCanvas) return;

    if (!await drpConfirm('Se eliminaran todas las anotaciones del editor.', 'Limpiar anotaciones?', 'warning')) return;

    fabricCanvas.getObjects().forEach(obj => {
        fabricCanvas.remove(obj);
    });

    fabricCanvas.renderAll();
    saveToHistory();

    showNotification('Canvas limpiado');
}


function confirmImageEditor() {
    if (!fabricCanvas || currentEditingIndex === null) return;

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[currentEditingIndex];
    if (!evidence) return;

    const dataURL = fabricCanvas.toDataURL({
        format: 'jpeg',
        quality: 0.9
    });

    evidence.image = dataURL;
    evidence.timestamp = new Date().toISOString();

    fabricCanvas.dispose();
    fabricCanvas = null;
    currentEditingIndex = null;

    closeModal('modalImageEditor');

    renderWorkArea();
    saveToStorage();

    showNotification('Imagen editada correctamente');
}

/* ====================================================================
   MÓDULO 4: EDICIÓN DE EVIDENCIAS
   ==================================================================== */

function editEvidence(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence) return;

    document.getElementById('editDescription').value = evidence.description || '';
    document.getElementById('editOperacion').value = evidence.operacion || '';
    document.getElementById('editResultado').value = evidence.resultado || 'PASA';

    // Datos de prueba (opcionales): usuario, rol, criterio. El TC NO se edita acá
    // — viene del test, se cambia editando la prueba si hace falta.
    const editUsuarioInput = document.getElementById('editUsuarioPrueba');
    const editRolInput = document.getElementById('editRolPrueba');
    const editCriterioInput = document.getElementById('editCriterioRef');
    if (editUsuarioInput) editUsuarioInput.value = evidence.usuarioPrueba || '';
    if (editRolInput) editRolInput.value = evidence.rolPrueba || '';
    if (editCriterioInput) editCriterioInput.value = evidence.criterioRef || '';

    // Refrescar datalists con valores recientes
    refreshTestDataDatalists();

    window.currentEditIndex = index;

    showModal('modalEditEvidence');
}

async function saveEditedEvidence() {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const index = window.currentEditIndex;
    const evidence = test.evidences[index];
    if (!evidence) return;

    const newDescription = document.getElementById('editDescription').value.trim();
    const newOperacion = document.getElementById('editOperacion').value.trim();
    const newResultado = document.getElementById('editResultado').value;

    // Datos de prueba (opcionales)
    const newUsuarioPrueba = (document.getElementById('editUsuarioPrueba')?.value || '').trim();
    const newRolPrueba = (document.getElementById('editRolPrueba')?.value || '').trim();
    const newCriterioRef = (document.getElementById('editCriterioRef')?.value || '').trim();

    if (!newDescription) {
        showNotification('❌ La descripción no puede estar vacía', 'error');
        return;
    }

    if (!newOperacion) {
        showNotification('❌ La operación probada no puede estar vacía', 'error');
        return;
    }

    // Actualizar evidencia (testCaseRef NO se toca acá — viene del test, no del modal)
    evidence.description = newDescription;
    evidence.operacion = newOperacion;
    evidence.resultado = newResultado;
    evidence.usuarioPrueba = newUsuarioPrueba;
    evidence.rolPrueba = newRolPrueba;
    evidence.criterioRef = newCriterioRef;
    // Backwards-compat: si la evidencia no tiene testCaseRef pero el test sí, heredarlo ahora.
    if (!evidence.testCaseRef && test.tcId) {
        evidence.testCaseRef = test.tcId;
    }

    // Memorizar para autocompletado
    rememberTestUserRoleUsage(newUsuarioPrueba, newRolPrueba, newCriterioRef);

    // Cerrar modal y actualizar
    closeModal('modalEditEvidence');
    renderWorkArea();
    saveToStorage();

    showNotification('Evidencia actualizada');
}

/**
 * Eliminar evidencia
 */
async function deleteEvidence(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence) return;

    if (!await drpConfirm(`Se eliminara la evidencia paso #${String(evidence.step).padStart(3, '0')}.`, 'Eliminar evidencia?', 'danger')) {
        return;
    }

    // Eliminar
    test.evidences.splice(index, 1);

    // Renumerar pasos
    renumberSteps(test);

    // Actualizar
    renderWorkArea();
    renderTests();
    saveToStorage();

    showNotification('Evidencia eliminada');
}

/**
 * Duplicar evidencia
 */
function duplicateEvidence(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence) return;

    // Crear copia
    const duplicate = {
        ...evidence,
        step: test.evidences.length + 1,
        timestamp: new Date().toISOString(),
        description: evidence.description + ' (copia)'
    };

    // Agregar al final
    test.evidences.push(duplicate);

    // Actualizar
    renderWorkArea();
    renderTests();
    saveToStorage();

    showNotification('Evidencia duplicada');
}

/**
 * Mover evidencia hacia ARRIBA
 */
function moveEvidenceUp(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    // No se puede mover la primera hacia arriba
    if (index === 0) {
        showNotification('Ya está en la primera posición', 'error');
        return;
    }

    // Intercambiar con la anterior
    const temp = test.evidences[index];
    test.evidences[index] = test.evidences[index - 1];
    test.evidences[index - 1] = temp;

    // Renumerar pasos
    renumberSteps(test);

    // Actualizar
    renderWorkArea();
    renderTests();
    saveToStorage();

    showNotification('Evidencia movida hacia arriba');
}

/**
 * Mover evidencia hacia ABAJO
 */
function moveEvidenceDown(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    // No se puede mover la última hacia abajo
    if (index === test.evidences.length - 1) {
        showNotification('Ya está en la última posición', 'error');
        return;
    }

    // Intercambiar con la siguiente
    const temp = test.evidences[index];
    test.evidences[index] = test.evidences[index + 1];
    test.evidences[index + 1] = temp;

    // Renumerar pasos
    renumberSteps(test);

    // Actualizar
    renderWorkArea();
    renderTests();
    saveToStorage();

    showNotification('Evidencia movida hacia abajo');
}

/**
 * Asignar resultado en batch a todas las evidencias con imagen
 * @param {string} resultado - 'PASA' | 'NO PASA' | 'PASA CON OBSERVACIONES' | 'NO APLICA'
 * @param {boolean} onlyEmpty - si true, solo aplica a las que aún tienen el resultado por defecto
 */
function batchSetResultado(resultado, onlyEmpty) {
    if (!activeTestId) return;
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;
    const label = onlyEmpty ? 'los pasos sin resultado' : 'todos los pasos con imagen';
    if (!confirm('¿Marcar ' + label + ' como "' + resultado + '"?')) return;
    let count = 0;
    test.evidences.forEach(ev => {
        if (ev.isEmpty || !ev.image) return;
        if (onlyEmpty && ev.resultado && ev.resultado !== 'PASA') return;
        ev.resultado = resultado;
        count++;
    });
    saveToStorage();
    renderWorkArea();
    showNotification(count + ' paso(s) marcados como ' + resultado);
}

/**
 * Reemplazar imagen de evidencia existente
 */
function replaceEvidenceImage(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence || evidence.type === 'table') {
        showNotification('Solo se pueden cambiar imágenes', 'error');
        return;
    }

    // Crear input temporal para seleccionar nueva imagen
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = function (event) {
            const img = new Image();

            img.onload = function () {
                compressImage(img, (compressedDataURL, compressedSize) => {
                    // Actualizar evidencia existente
                    evidence.image = compressedDataURL;
                    evidence.size = formatBytes(compressedSize);
                    evidence.dimensions = `${img.width}x${img.height}`;
                    evidence.timestamp = new Date().toISOString();

                    // Actualizar UI
                    renderWorkArea();
                    saveToStorage();

                    showNotification('Imagen reemplazada correctamente');
                }, 'file');
            };

            img.src = event.target.result;
        };

        reader.readAsDataURL(file);
    };

    // Trigger file picker
    input.click();
}

/**
 * Mostrar modal para insertar ANTES
 */
function showInsertBeforeModal(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence) return;

    insertBeforeIndex = index;

    showNotification(`Próxima evidencia se insertará ANTES del paso #${String(evidence.step).padStart(3, '0')}`);
}

/**
 * Mover evidencia a otro test (placeholder - modal complejo)
 */
function moveEvidenceToTest(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence) return;

    // TODO: Modal de selección de test destino
    showNotification('Funcionalidad de mover entre tests en desarrollo');
}

/**
 * Crear evidencia vacía (placeholder)
 */
function createEmptyEvidence() {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) {
        showNotification('Selecciona una prueba primero', 'error');
        return;
    }

    const evidence = {
        step: test.evidences.length + 1,
        image: null,
        description: 'Evidencia pendiente',
        resultado: 'PASA',
        timestamp: new Date().toISOString(),
        isEmpty: true,
        testName: test.name,
        executor: executor || document.getElementById('ejecutor').value.trim()
    };

    test.evidences.push(evidence);

    renderWorkArea();
    renderTests();
    saveToStorage();

    showNotification('Evidencia vacía creada - Arrastra una imagen para completarla');
}

/**
 * Manejar drop en placeholder vacío
 */
function handleDropOnPlaceholder(event, index) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence || !evidence.isEmpty) return;

    const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('image/'));

    if (files.length === 0) {
        showNotification('No se detectó ninguna imagen', 'error');
        return;
    }

    const file = files[0];

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            compressImage(img, async (compressedDataURL, compressedSize) => {
                evidence.image = compressedDataURL;
                evidence.size = formatBytes(compressedSize);
                evidence.dimensions = `${img.width}x${img.height}`;
                evidence.captureTimestamp = new Date().toISOString();
                evidence.isEmpty = false;
                if (!evidence.resultado || evidence.resultado === 'OK') evidence.resultado = 'PASA';

                // Guardar en IndexedDB
                try {
                    await saveImageToDB(`${test.id}_evidence_${evidence.step}`, compressedDataURL);
                } catch (err) { /* silenciar */ }

                renderWorkArea();
                renderTests();
                saveToStorage();

                const remaining = test.evidences.filter(ev => ev.isEmpty).length;
                showNotification(`Paso #${String(evidence.step).padStart(3, '0')} completado${remaining > 0 ? ` — ${remaining} restante${remaining > 1 ? 's' : ''}` : ' — Todas completas'}`);
            }, 'file');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Manejar click en placeholder para seleccionar archivo
 */
function handleClickPlaceholder(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    const evidence = test.evidences[index];
    if (!evidence || !evidence.isEmpty) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (ev) {
            const img = new Image();
            img.onload = function () {
                compressImage(img, async (compressedDataURL, compressedSize) => {
                    evidence.image = compressedDataURL;
                    evidence.size = formatBytes(compressedSize);
                    evidence.dimensions = `${img.width}x${img.height}`;
                    evidence.captureTimestamp = new Date().toISOString();
                    evidence.isEmpty = false;
                    if (!evidence.resultado || evidence.resultado === 'OK') evidence.resultado = 'PASA';

                    try {
                        await saveImageToDB(`${test.id}_evidence_${evidence.step}`, compressedDataURL);
                    } catch (err) { /* silenciar */ }

                    renderWorkArea();
                    renderTests();
                    saveToStorage();

                    const remaining = test.evidences.filter(evx => evx.isEmpty).length;
                    showNotification(`Paso #${String(evidence.step).padStart(3, '0')} completado${remaining > 0 ? ` — ${remaining} restante${remaining > 1 ? 's' : ''}` : ' — Todas completas'}`);
                }, 'file');
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    };

    input.click();
}

/* ====================================================================
   EVENT LISTENERS DE INPUTS DE ARCHIVOS
   ==================================================================== */

// Upload de imagen individual
document.getElementById('uploadImageInput')?.addEventListener('change', function (e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (files.length === 1) {
        handleImageUpload(files[0]);
    } else {
        handleMultipleImages(files);
    }

    // Limpiar input
    this.value = '';
});

// Upload de carpeta completa
document.getElementById('uploadFolderInput')?.addEventListener('change', function (e) {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));

    if (files.length === 0) {
        showNotification('No se encontraron imágenes en la carpeta', 'error');
        return;
    }

    handleMultipleImages(files);

    // Limpiar input
    this.value = '';
});

// Agregar UN doc al paquete (versión single-file de Cargar Paquete).
// Usa loadPackageFiles para mantener consistencia: aplica el mismo filtro
// (URS/RA/IRA/PIQ/POQ/PPQ) y activa protocolos si corresponde. Útil cuando
// el usuario se olvidó de incluir un doc en la carga inicial multi-archivo.
//
// Si el JSON es una sesión gestor exportada (sin `type`, con `tests`+`version`)
// loadPackageFiles también la detecta y restaura — comportamiento idéntico
// al multi-file picker.
document.getElementById('importJSONInput')?.addEventListener('change', async function (e) {
    const file = e.target.files[0];
    if (file) {
        await loadPackageFiles([file]);
    }
    this.value = '';
});

// Cargar Sesión (mismo que importar JSON)
document.getElementById('loadSessionInput')?.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        // console.log('🔵 CARGAR SESIÓN - Archivo seleccionado:', file.name);
        importSessionJSON(file);
    }
    this.value = '';
});

// Fase B.2 — Cargar paquete documental (multi-file)
document.getElementById('loadPackageInput')?.addEventListener('change', function (e) {
    const files = e.target.files;
    if (files && files.length > 0) {
        loadPackageFiles(files);
    }
    this.value = '';
});

/* ====================================================================
   MÓDULO 7: FINALIZACIÓN
   ==================================================================== */

/**
 * Finalizar prueba
 */
async function finalizeTest() {
    if (!activeTestId) {
        showNotification('Selecciona una prueba', 'error');
        return;
    }

    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;

    if (test.evidences.filter(e => !e.isEmpty).length === 0) {
        showNotification('La prueba debe tener al menos 1 evidencia con imagen', 'error');
        return;
    }

    const conclusion = document.getElementById('testConclusion').value.trim();
    const resultado = document.getElementById('testResultado').value;

    if (!conclusion) {
        showNotification('Debes ingresar una conclusión', 'error');
        return;
    }

    test.finalized = true;
    test.conclusion = conclusion;
    test.resultado = resultado;
    test.finalizedDate = new Date().toISOString();

    closeModal('modalFinalizeTest');
    renderWorkArea();
    renderTests();
    saveToStorage();

    showNotification(`Prueba "${test.name}" finalizada`);
}

async function reopenTest() {
    const test = tests.find(t => t.id === activeTestId);
    if (!test || !test.finalized) return;

    // Bloquear si la carpeta ya está finalizada
    const parentGroup = groups.find(g => g.id === test.groupId);
    if (parentGroup && parentGroup.finalized) {
        showNotification(`No se puede reabrir: la carpeta "${parentGroup.name}" está finalizada`, 'error');
        return;
    }

    // Bloquear si el proyecto está finalizado
    if (projectData.finalized) {
        showNotification('No se puede reabrir: el proyecto está finalizado', 'error');
        return;
    }

    if (!await drpConfirm(`Se eliminara la conclusion de "${test.name}".`, 'Reabrir prueba?', 'warning')) {
        return;
    }

    test.finalized = false;
    delete test.conclusion;
    delete test.resultado;
    delete test.finalizedDate;

    renderWorkArea();
    renderTests();
    saveToStorage();
    showNotification(`Prueba "${test.name}" reabierta`);
}

/**
 * Reabrir carpeta finalizada
 */
async function reopenFolder(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group || !group.finalized) return;

    if (projectData.finalized) {
        showNotification('No se puede reabrir: el proyecto está finalizado', 'error');
        return;
    }

    if (!await drpConfirm(`Se eliminara la conclusion de "${group.name}".\n\nLas pruebas permaneceran finalizadas (podes reabrirlas individualmente).`, 'Reabrir carpeta?', 'warning')) {
        return;
    }

    group.finalized = false;
    delete group.conclusion;
    delete group.resultado;
    delete group.finalizedDate;

    renderTests();
    renderWorkArea();
    saveToStorage();
    showNotification(`Carpeta "${group.name}" reabierta`);
}

/**
 * Reabrir proyecto finalizado
 */
async function reopenProject() {
    if (!projectData.finalized) return;

    if (!await drpConfirm('Se eliminara la conclusion del proyecto.\n\nLas carpetas y pruebas permaneceran finalizadas (podes reabrirlas individualmente).', 'Reabrir proyecto?', 'warning')) {
        return;
    }

    projectData.finalized = false;
    delete projectData.conclusion;
    delete projectData.resultado;
    delete projectData.finalizedDate;

    renderTests();
    renderWorkArea();
    saveToStorage();
    showNotification('Proyecto reabierto');
}
/**
 * Finalizar carpeta
 */
function finalizeFolder() {
    // Obtener carpeta activa desde la prueba activa
    const test = tests.find(t => t.id === activeTestId);
    if (!test || !test.groupId) {
        showNotification('Selecciona una prueba de una carpeta', 'error');
        return;
    }

    const group = groups.find(g => g.id === test.groupId);
    if (!group) return;

    // Validar que todas las pruebas estén finalizadas
    const groupTests = tests.filter(t => t.groupId === group.id);
    const unfinalizedTests = groupTests.filter(t => !t.finalized);

    if (unfinalizedTests.length > 0) {
        showNotification(`Finaliza todas las pruebas primero (${unfinalizedTests.length} pendientes)`, 'error');
        return;
    }

    const conclusion = document.getElementById('folderConclusion').value.trim();
    const resultado = document.getElementById('folderResultado').value;

    if (!conclusion) {
        showNotification('Debes ingresar una conclusión', 'error');
        return;
    }

    group.finalized = true;
    group.conclusion = conclusion;
    group.resultado = resultado;
    group.finalizedDate = new Date().toISOString();

    closeModal('modalFinalizeFolder');
    renderTests();
    saveToStorage();

    showNotification(`Carpeta "${group.name}" finalizada`);
}

/**
 * Estado pendiente del modal de finalización: indica si confirmar dispara
 * finalizar proyecto o finalizar protocolo. Reseteado al cerrar.
 *   { kind: 'project' | 'protocol', protocolId?: string }
 */
let pendingFinalize = null;
window.pendingFinalize = null;

/**
 * Abre el modal de finalizar para un protocolo específico.
 * Valida que todas sus pruebas + carpetas estén finalizadas antes de abrir.
 */
function finalizeProtocol(protocolId) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol) {
        showNotification('Protocolo no encontrado', 'error');
        return;
    }
    if (protocol.finalized) {
        showNotification(`El protocolo ${protocol.code} ya está finalizado`, 'error');
        return;
    }
    const groupsP = groups.filter(g => g.protocolId === protocolId);
    const testsP = tests.filter(t => groupsP.some(g => g.id === t.groupId));

    if (testsP.length === 0) {
        showNotification(`El protocolo ${protocol.code} no tiene pruebas`, 'error');
        return;
    }
    const unfTests = testsP.filter(t => !t.finalized);
    if (unfTests.length > 0) {
        showNotification(`Finaliza todas las pruebas del protocolo primero (${unfTests.length} pendientes)`, 'error');
        return;
    }
    const unfGroups = groupsP.filter(g => !g.finalized);
    if (unfGroups.length > 0) {
        showNotification(`Finaliza todas las carpetas del protocolo primero (${unfGroups.length} pendientes: ${unfGroups.map(g => g.name).join(', ')})`, 'error');
        return;
    }

    // Reusar el mismo modal del proyecto, pero cambiando el título y el scope
    pendingFinalize = { kind: 'protocol', protocolId: protocolId };
    window.pendingFinalize = pendingFinalize;

    // Personalizar título del modal si está disponible
    const modal = document.getElementById('modalFinalizeProject');
    if (modal) {
        const h3 = modal.querySelector('h3');
        if (h3) h3.textContent = `Finalizar Protocolo: ${protocol.code}`;
        const conclusionInput = document.getElementById('projectConclusion');
        if (conclusionInput) conclusionInput.value = '';
        const resInput = document.getElementById('projectResultado');
        if (resInput) resInput.value = 'PASA';
        modal.style.display = 'flex';
    }
}

/**
 * Reabre un protocolo finalizado. No cascadea a sus tests/grupos:
 * solo el protocolo queda reabierto. Tests y grupos ya finalizados
 * mantienen su estado individual.
 */
function reopenProtocol(protocolId) {
    const protocol = protocols.find(p => p.id === protocolId);
    if (!protocol || !protocol.finalized) {
        showNotification('El protocolo no está finalizado', 'error');
        return;
    }
    if (projectData && projectData.finalized) {
        showNotification('No se puede reabrir un protocolo con el proyecto finalizado. Reabrí el proyecto primero.', 'error');
        return;
    }
    protocol.finalized = false;
    delete protocol.conclusion;
    delete protocol.resultado;
    delete protocol.finalizedDate;
    renderTests();
    if (typeof renderWorkArea === 'function') renderWorkArea();
    saveToStorage();
    showNotification(`Protocolo ${protocol.code} reabierto`);
}

window.finalizeProtocol = finalizeProtocol;
window.reopenProtocol = reopenProtocol;

/**
 * Finalizar proyecto
 */
function finalizeProject() {
    // Si el modal está siendo usado por el flow de protocolo, despachar a la función específica
    if (pendingFinalize && pendingFinalize.kind === 'protocol') {
        return finalizeProtocolFromModal();
    }

    // Validar que haya al menos 1 prueba
    if (tests.length === 0) {
        showNotification('El proyecto debe tener al menos 1 prueba', 'error');
        return;
    }

    // Validar que todas las pruebas estén finalizadas
    const unfinalizedTests = tests.filter(t => !t.finalized);
    if (unfinalizedTests.length > 0) {
        showNotification(`Finaliza todas las pruebas primero (${unfinalizedTests.length} pendientes)`, 'error');
        return;
    }

    // Validar que todas las carpetas estén finalizadas
    const unfinalizedGroups = groups.filter(g => !g.finalized);
    if (unfinalizedGroups.length > 0) {
        showNotification(`Finaliza todas las carpetas primero (${unfinalizedGroups.length} pendientes: ${unfinalizedGroups.map(g => g.name).join(', ')})`, 'error');
        return;
    }

    // Validar que todos los protocolos estén finalizados (multi-protocolo)
    const unfinalizedProtos = protocols.filter(p => !p.finalized);
    if (unfinalizedProtos.length > 0 && protocols.length > 1) {
        showNotification(`Finaliza todos los protocolos primero (${unfinalizedProtos.length} pendientes: ${unfinalizedProtos.map(p => p.code).join(', ')})`, 'error');
        return;
    }

    const conclusion = document.getElementById('projectConclusion').value.trim();
    const resultado = document.getElementById('projectResultado').value;

    if (!conclusion) {
        showNotification('Debes ingresar una conclusión', 'error');
        return;
    }

    projectData.finalized = true;
    projectData.conclusion = conclusion;
    projectData.resultado = resultado;
    projectData.finalizedDate = new Date().toISOString();

    closeModal('modalFinalizeProject');
    pendingFinalize = null;
    window.pendingFinalize = null;
    renderTests();
    saveToStorage();

    showNotification('PROYECTO FINALIZADO - Todo bloqueado');
}

/**
 * Variante de finalización despachada desde el modal cuando pendingFinalize
 * apunta a un protocolo. Toma los mismos inputs (conclusión + resultado) pero
 * marca solo el protocolo objetivo, sin tocar otros protocolos del paquete.
 */
function finalizeProtocolFromModal() {
    const scope = pendingFinalize;
    if (!scope || scope.kind !== 'protocol') return;
    const protocol = protocols.find(p => p.id === scope.protocolId);
    if (!protocol) {
        showNotification('Protocolo no encontrado en el modal', 'error');
        return;
    }
    const conclusion = (document.getElementById('projectConclusion') || {}).value;
    const resultado = (document.getElementById('projectResultado') || {}).value;
    if (!conclusion || !conclusion.trim()) {
        showNotification('Debes ingresar una conclusión', 'error');
        return;
    }
    protocol.finalized = true;
    protocol.conclusion = conclusion.trim();
    protocol.resultado = resultado || '';
    protocol.finalizedDate = new Date().toISOString();

    // Restaurar título del modal por si la próxima apertura es de proyecto
    const modal = document.getElementById('modalFinalizeProject');
    if (modal) {
        const h3 = modal.querySelector('h3');
        if (h3) h3.textContent = 'Finalizar Proyecto';
    }
    closeModal('modalFinalizeProject');
    pendingFinalize = null;
    window.pendingFinalize = null;
    renderTests();
    if (typeof renderWorkArea === 'function') renderWorkArea();
    saveToStorage();
    showNotification(`Protocolo ${protocol.code} finalizado`);
}

/* ====================================================================
   FUNCIONES PLACEHOLDER (A IMPLEMENTAR EN PRÓXIMO MÓDULO)
   ==================================================================== */

/**
 * Validar campos obligatorios del sistema
 */
function validateSystemInfo() {
    const empresa = document.getElementById('empresa').value.trim();
    const nombreSistema = document.getElementById('nombreSistema').value.trim();
    const codigoSistema = document.getElementById('codigoSistema').value.trim();
    const proveedor = document.getElementById('proveedor').value.trim();
    const ejecutorVal = document.getElementById('ejecutor').value.trim();

    const missing = [];

    if (!empresa) missing.push('Empresa');
    if (!nombreSistema) missing.push('Nombre del Sistema');
    if (!codigoSistema) missing.push('Código del Sistema');
    if (!proveedor) missing.push('Proveedor');
    if (!ejecutorVal) missing.push('Ejecutor');

    if (missing.length > 0) {
        drpAlert('Campos faltantes:\n\n' + missing.map(m => '• ' + m).join('\n') + '\n\nCompleta toda la informacion del sistema antes de exportar.', 'Campos obligatorios', 'warning');
        return false;
    }

    return true;
}

/**
 * Exportar a Excel - Matriz de Trazabilidad
 */
function exportToExcel() {
    // Validar campos obligatorios
    if (!validateSystemInfo()) {
        return;
    }

    const hasPackage = Array.isArray(packageDocs) && packageDocs.length > 0;
    if (tests.length === 0 && !hasPackage) {
        showNotification('No hay pruebas ni paquete documental para exportar', 'error');
        return;
    }

    // ════════════════════════════════════════════════════════════════════
    // PATH NUEVO: si hay paquete documental, generar libro multi-hoja
    // consumiendo el matrix-builder (source-of-truth unificado).
    // Si no hay paquete, cae al export legacy de 2 hojas (preservado).
    // ════════════════════════════════════════════════════════════════════
    const VS = window.ValidationSuite;
    if (hasPackage && VS && VS.matrixBuilder && typeof VS.matrixBuilder.build === 'function') {
        try {
            const matrix = VS.matrixBuilder.build({
                packageDocs: packageDocs,
                tests: tests,
                groups: groups,
                protocols: protocols,
                systemInfo: systemInfo,
                executor: executor,
                projectData: projectData
            });
            const wb = XLSX.utils.book_new();
            // Orden lógico: ejecutivo primero, detalle al final.
            const sheetOrder = [
                'Resumen Ejecutivo',
                'Trazabilidad URS-TC-RA',
                'Test Cases',
                'Pruebas Gestor',
                'Conclusiones',
                'Evidencias',
                'Hallazgos',
                'Manifest Paquete'
            ];
            sheetOrder.forEach(name => {
                const aoa = matrix.sheets[name];
                if (!aoa) return;
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31)); // Excel limit
            });
            const pkgCode = (packageDocs[0] && packageDocs[0].data && packageDocs[0].data.package && packageDocs[0].data.package.code)
                || systemInfo.codigoSistema
                || 'PKG';
            const filename = `Matriz_${pkgCode}_${new Date().toISOString().split('T')[0]}.xlsx`;
            XLSX.writeFile(wb, filename);
            const kpis = matrix.kpis;
            showNotification(`Excel exportado (${sheetOrder.length} hojas). TCs: ${kpis.totalTcsEjecutados} ejecutados · ${kpis.pass} PASS · ${kpis.fail} FAIL · ${kpis.obs} OBS · Estado: ${kpis.estadoGlobal}`);
            return;
        } catch (err) {
            console.error('matrix-builder export failed, fallback to legacy:', err);
            showNotification('Advertencia: export ampliado falló, generando export legacy', 'error');
            // continúa al path legacy abajo
        }
    }

    const data = [];

    // Headers
    data.push(['MATRIZ DE TRAZABILIDAD - GESTOR DE EVIDENCIAS']);
    data.push([]);
    data.push(['Empresa:', systemInfo.empresa || '']);
    data.push(['Sistema:', systemInfo.nombreSistema || '']);
    data.push(['Código:', systemInfo.codigoSistema || '']);
    data.push(['Ejecutor:', executor || '']);
    data.push(['Fecha Exportación:', new Date().toLocaleDateString('es-AR')]);
    data.push([]);

    // Headers de tabla
    data.push([
        'Protocolo',
        'Carpeta',
        'Prueba',
        'Total Evidencias',
        'PASA',
        'NO PASA',
        'PASA CON OBS',
        'NO APLICA',
        'Estado',
        'Resultado',
        'Fecha Finalización'
    ]);

    // Datos de pruebas
    tests.forEach(test => {
        const group = groups.find(g => g.id === test.groupId);
        const protocol = group ? protocols.find(p => p.id === group.protocolId) : null;

        // Contar resultados
        const passCount = test.evidences.filter(e => e.resultado === 'PASA').length;
        const failCount = test.evidences.filter(e => e.resultado === 'NO PASA').length;
        const obsCount = test.evidences.filter(e => e.resultado === 'PASA CON OBSERVACIONES').length;
        const naCount = test.evidences.filter(e => e.resultado === 'NO APLICA').length;

        data.push([
            protocol ? protocol.name : 'Sin Protocolo',
            group ? group.name : 'Sin Carpeta',
            test.name,
            test.evidences.length,
            passCount,
            failCount,
            obsCount,
            naCount,
            test.finalized ? 'FINALIZADO' : 'En Proceso',
            test.resultado || '',
            test.finalizedDate ? new Date(test.finalizedDate).toLocaleDateString('es-AR') : ''
        ]);
    });

    // Resumen
    data.push([]);
    data.push(['RESUMEN']);
    data.push(['Total Protocolos:', protocols.length]);
    data.push(['Total Carpetas:', groups.length]);
    data.push(['Total Pruebas:', tests.length]);
    data.push(['Total Evidencias:', tests.reduce((sum, t) => sum + t.evidences.length, 0)]);
    data.push(['Pruebas Finalizadas:', tests.filter(t => t.finalized).length]);
    data.push(['Pruebas Pendientes:', tests.filter(t => !t.finalized).length]);

    // Crear workbook
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Matriz Trazabilidad');

    // ==========================================
    // HOJA 2: DETALLE DE EVIDENCIAS
    // ==========================================
    const dataEvidencias = [];

    // Headers
    dataEvidencias.push(['DETALLE DE EVIDENCIAS']);
    dataEvidencias.push([]);
    dataEvidencias.push(['Empresa:', systemInfo.empresa || '']);
    dataEvidencias.push(['Sistema:', systemInfo.nombreSistema || '']);
    dataEvidencias.push(['Ejecutor:', executor || '']);
    dataEvidencias.push([]);

    // Headers de tabla
    dataEvidencias.push([
        'Protocolo',
        'Carpeta',
        'Prueba',
        'Paso',
        'Descripción',
        'Resultado',
        'Fecha/Hora Captura',
        'Fecha/Hora Guardado',
        'Ejecutor',
        'Tamaño',
        'Dimensiones',
        'Archivo Original',
        'Ruta Relativa',
        'Fecha Captura EXIF',
        'Cámara'
    ]);

    // Datos de evidencias
    tests.forEach(test => {
        const group = groups.find(g => g.id === test.groupId);
        const protocol = group ? protocols.find(p => p.id === group.protocolId) : null;

        test.evidences.forEach(evidence => {
            // Saltear evidencias vacías
            if (evidence.isEmpty) return;

            dataEvidencias.push([
                protocol ? protocol.name : 'Sin Protocolo',
                group ? group.name : 'Sin Carpeta',
                test.name,
                evidence.step,
                evidence.description || '',
                evidence.resultado || 'PASA',
                evidence.captureTimestamp ? formatDateTime24h(evidence.captureTimestamp) : '',
                evidence.timestamp ? formatDateTime24h(evidence.timestamp) : '',
                evidence.executor || '',
                evidence.size || '',
                evidence.dimensions || '',
                evidence.exif?.originalFileName || '',
                evidence.exif?.relativePath || '',
                evidence.exif?.captureDate ? formatDateTime24h(evidence.exif.captureDate) : '',
                evidence.exif?.cameraModel ? `${evidence.exif.cameraMake || ''} ${evidence.exif.cameraModel}`.trim() : ''
            ]);
        });
    });

    const wsEvidencias = XLSX.utils.aoa_to_sheet(dataEvidencias);
    XLSX.utils.book_append_sheet(wb, wsEvidencias, 'Detalle Evidencias');

    // Exportar
    const filename = `Matriz_Trazabilidad_${systemInfo.codigoSistema || 'VSC'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);

    showNotification('Excel exportado correctamente (2 hojas)');
}

/* ====================================================================
   ATAJOS DE TECLADO
   ==================================================================== */

document.addEventListener('keydown', function (e) {
    // Escape para cerrar modales
    if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal.active');
        if (activeModal) {
            activeModal.classList.remove('active');
        }
    }

    // Ctrl+S para guardar
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveToStorage();
        showNotification('Sesión guardada');
    }
});


/* ====================================================================
   PROTECCIÓN ANTI-PÉRDIDA DE DATOS
   ==================================================================== */

/**
 * Detectar cierre de ventana/pestaña
 */
// Sin warning nativo de beforeunload: los datos se persisten automáticamente
// en cada cambio (saveToStorage → localStorage + IndexedDB), así que cerrar
// la pestaña no implica pérdida. El popup negro del navegador molestaba más
// de lo que protegía.

/**
 * Modal de backup antes de cerrar (NO se puede escapar)
 */
function showBackupBeforeCloseModal() {
    const modal = document.getElementById('modalBackupBeforeClose');
    if (!modal) return;

    modal.style.display = 'flex';

    // Deshabilitar cierre con ESC
    const originalOnKeyDown = document.onkeydown;
    document.onkeydown = function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            return false;
        }
    };

    // Restaurar cuando se cierra el modal
    window.restoreKeyboard = function () {
        document.onkeydown = originalOnKeyDown;
    };
}

/**
 * Confirmar descarga de backup antes de cerrar
 */
async function confirmBackupAndClose(downloadBackup) {
    if (downloadBackup) {
        // Descargar backup
        await exportSessionJSON();
        showNotification('Backup descargado - Puedes cerrar la ventana ahora', 'success');
    }

    // Cerrar modal
    const modal = document.getElementById('modalBackupBeforeClose');
    modal.style.display = 'none';
    window.restoreKeyboard();

    // Permitir cierre
    window.removeEventListener('beforeunload', arguments.callee);
}

/**
 * Confirmar limpieza de cache
 */
async function confirmClearCache(downloadBackup) {
    // Cerrar modal
    const modal = document.getElementById('modalClearCache');
    modal.style.display = 'none';
    window.restoreKeyboard();

    if (downloadBackup) {
        // Descargar backup primero
        showNotification('Descargando backup antes de limpiar...', 'info');
        await exportSessionJSON();

        // Esperar 2 segundos para que se descargue
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Ejecutar limpieza COMPLETA
    try {
        // 1. Limpiar TODO el localStorage (no solo items específicos)
        localStorage.clear();
    // //         console.log('✅ localStorage completamente limpiado');

        // 2. Limpiar IndexedDB (imágenes)
        if (db) {
            await clearAllImagesFromDB();
    // //             console.log('✅ IndexedDB de imágenes limpiado');
        }

        // 3. Resetear variables globales del sistema
        protocols = [];
        groups = [];
        tests = [];
        activeTestId = null;
        activeProtocolId = null;

        systemInfo = {
            empresa: '',
            nombreSistema: '',
            codigoSistema: '',
            fabricante: '',
            version: '',
            entorno: ''
        };

        projectData = {
            ejecutor: '',
            revisor: '',
            aprobador: '',
            version: ''
        };

        executor = '';

    // //         console.log('✅ Variables del sistema reseteadas');

        showNotification('Sistema limpiado completamente - Recargando...', 'success');

        setTimeout(() => {
            location.reload();
        }, 1500);
    } catch (error) {
    // //         console.error('❌ Error limpiando sistema:', error);
        showNotification('Error al limpiar sistema: ' + error.message, 'error');
    }
}

/**
 * Cancelar limpieza de cache
 */
function cancelClearCache() {
    const modal = document.getElementById('modalClearCache');
    modal.style.display = 'none';
    window.restoreKeyboard();
    showNotification('Limpieza cancelada', 'info');
}

function initExportModalHandlers() {
    const radioButtons = document.querySelectorAll('input[name="exportType"]');

    // Event listeners para mostrar/ocultar selector de carpetas
    radioButtons.forEach(radio => {
        radio.addEventListener('change', () => {
            toggleFolderSelector();
        });
    });

    // Inicializar
    toggleFolderSelector();
}

/**
 * Llenar selector de carpetas en modal de exportación
 */
/**
 * Poblar selector de pruebas en modal de exportación
 */
function populateTestSelector() {
    const testSelector = document.getElementById('testSelector');
    if (!testSelector) return;

    // Limpiar opciones existentes
    testSelector.innerHTML = '';

    // Obtener todas las pruebas
    if (tests.length === 0) {
        testSelector.innerHTML = '<option value="">No hay pruebas creadas</option>';
        return;
    }

    // Agrupar pruebas por carpeta para mejor UX
    const testsWithoutFolder = tests.filter(t => !t.groupId);
    const testsWithFolder = tests.filter(t => t.groupId);

    // Primero: prueba activa (si hay)
    if (activeTestId) {
        const activeTest = tests.find(t => t.id === activeTestId);
        if (activeTest) {
            const evidenceCount = activeTest.evidences.filter(e => !e.isEmpty).length;
            testSelector.innerHTML += `<option value="${activeTest.id}" selected>${activeTest.name} (${evidenceCount} evidencias) - Prueba actual</option>`;
        }
    }

    // Segundo: pruebas sin carpeta
    testsWithoutFolder.forEach(test => {
        if (test.id !== activeTestId) {
            const evidenceCount = test.evidences.filter(e => !e.isEmpty).length;
            testSelector.innerHTML += `<option value="${test.id}">${test.name} (${evidenceCount} evidencias)</option>`;
        }
    });

    // Tercero: pruebas agrupadas por carpeta
    const groupedByFolder = {};
    testsWithFolder.forEach(test => {
        if (!groupedByFolder[test.groupId]) {
            groupedByFolder[test.groupId] = [];
        }
        groupedByFolder[test.groupId].push(test);
    });

    Object.keys(groupedByFolder).forEach(groupId => {
        const group = groups.find(g => g.id === groupId);
        const groupTests = groupedByFolder[groupId];

        groupTests.forEach(test => {
            if (test.id !== activeTestId) {
                const evidenceCount = test.evidences.filter(e => !e.isEmpty).length;
                const groupName = group ? group.name : 'Sin carpeta';
                testSelector.innerHTML += `<option value="${test.id}">${test.name} (${evidenceCount} evidencias) - ${groupName}</option>`;
            }
        });
    });
}

function populateFolderSelector() {
    const folderSelector = document.getElementById('folderSelector');
    if (!folderSelector) return;

    // Limpiar opciones existentes
    folderSelector.innerHTML = '';

    // Obtener carpetas con pruebas
    const foldersWithTests = groups.filter(g => {
        const testsInFolder = tests.filter(t => t.groupId === g.id);
        return testsInFolder.length > 0;
    });

    if (foldersWithTests.length === 0) {
        folderSelector.innerHTML = '<option value="">No hay carpetas con pruebas</option>';
        return;
    }

    // Agregar opción por defecto
    if (activeTestId) {
        const activeTest = tests.find(t => t.id === activeTestId);
        if (activeTest && activeTest.groupId) {
            const activeGroup = groups.find(g => g.id === activeTest.groupId);
            if (activeGroup) {
                folderSelector.innerHTML += `<option value="${activeGroup.id}" selected>${activeGroup.name} (carpeta actual)</option>`;
            }
        }
    }

    // Agregar todas las carpetas
    foldersWithTests.forEach(group => {
        const testsCount = tests.filter(t => t.groupId === group.id).length;
        const isActive = activeTestId && tests.find(t => t.id === activeTestId)?.groupId === group.id;

        if (!isActive) {
            folderSelector.innerHTML += `<option value="${group.id}">${group.name} (${testsCount} pruebas)</option>`;
        }
    });
}

/**
 * Mostrar/ocultar selector de carpeta según tipo de export
 */
function toggleFolderSelector() {
    const folderRadio = document.querySelector('input[name="exportType"][value="folder"]');
    const folderSelectorContainer = document.getElementById('folderSelectorContainer');

    if (!folderRadio || !folderSelectorContainer) return;

    if (folderRadio.checked) {
        folderSelectorContainer.style.display = 'block';
        populateFolderSelector();
    } else {
        folderSelectorContainer.style.display = 'none';
    }
}

/**
 * Validar conclusión antes de exportar
 */
function validateConclusionBeforeExport() {
    const selectedType = document.querySelector('input[name="exportType"]:checked');
    if (!selectedType) {
        drpAlert('Selecciona un tipo de exportacion', 'Exportacion', 'warning');
        return { valid: false };
    }

    const typeValue = selectedType.value;

    // EVIDENCIA INDIVIDUAL - No requiere finalización
    if (typeValue === 'evidence') {
        return { valid: true };
    }

    // PRUEBA - Verificar que esté finalizada
    if (typeValue === 'test') {
        const testSelector = document.getElementById('testSelector');
        const selectedTestId = testSelector?.value;

        if (!selectedTestId) {
            drpAlert('Selecciona una prueba para exportar', 'Exportacion', 'warning');
            return { valid: false };
        }

        const test = tests.find(t => t.id === selectedTestId);
        if (!test) {
            drpAlert('Prueba no encontrada', 'Error', 'error');
            return { valid: false };
        }
        if (!test.finalized) {
            drpAlert('La prueba debe estar finalizada antes de exportar.\n\nUsa el boton "Finalizar Prueba" en el panel CIERRE.', 'Prueba no finalizada', 'warning');
            return { valid: false };
        }
        return { valid: true, conclusion: test.conclusion };
    }

    // CARPETA - Verificar que todas las pruebas estén finalizadas
    if (typeValue === 'folder') {
        const folderSelector = document.getElementById('folderSelector');
        const selectedFolderId = folderSelector?.value;

        if (!selectedFolderId) {
            drpAlert('Selecciona una carpeta para exportar', 'Exportacion', 'warning');
            return { valid: false };
        }

        const selectedGroup = groups.find(g => g.id === selectedFolderId);
        if (!selectedGroup) {
            drpAlert('Carpeta no encontrada', 'Error', 'error');
            return { valid: false };
        }

        const testsInFolder = tests.filter(t => t.groupId === selectedFolderId);
        const unfinalizedTests = testsInFolder.filter(t => !t.finalized);

        if (unfinalizedTests.length > 0) {
            const testNames = unfinalizedTests.map(t => '• ' + t.name).join('\n');
            drpAlert('Todas las pruebas deben estar finalizadas.\n\nPendientes:\n' + testNames, 'Pruebas sin finalizar', 'warning');
            return { valid: false };
        }

        if (!selectedGroup.finalized) {
            drpAlert('La carpeta debe estar finalizada antes de exportar.\n\nUsa el boton "Finalizar Carpeta" en el panel CIERRE.', 'Carpeta no finalizada', 'warning');
            return { valid: false };
        }

        return { valid: true, conclusion: selectedGroup.conclusion };
    }

    // PROYECTO - Por implementar
    if (typeValue === 'project') {
        return { valid: true, conclusion: null };
    }

    return { valid: false };
}

/**
 * Inicializar contador de caracteres en modal de finalizar prueba
 */
function initFinalizarPruebaHandlers() {
    const conclusionTextarea = document.getElementById('testConclusion');
    const charCounter = document.getElementById('testConclusionCounter');
    const charWarning = document.getElementById('testConclusionWarning');

    if (!conclusionTextarea) return;

    function updateCharCounter() {
        const length = conclusionTextarea.value.length;
        charCounter.textContent = `${length} / 250 caracteres mínimo`;

        if (length < 250) {
            charCounter.style.color = 'var(--vsc-rojo)';
            charWarning.style.display = 'block';
        } else {
            charCounter.style.color = 'var(--vsc-verde)';
            charWarning.style.display = 'none';
        }
    }

    conclusionTextarea.addEventListener('input', updateCharCounter);
    updateCharCounter();
}

/**
 * Validar y obtener datos del modal de exportacion proyecto
 */
/**
 * Pre-llenar modal de exportar proyecto desde localStorage + systemInfo + ejecutor
 */
function prefillProjectExportModal() {
    // Fuente 1: localStorage (guardado rápido entre exports)
    const STORAGE_KEY = 'drp_projectExportDefaults';
    let fromLS = {};
    try { fromLS = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}

    // Fuente 2: exportConfig guardado en la sesión del proyecto
    let fromSession = {};
    try {
        const sessionData = JSON.parse(localStorage.getItem('vscTestsData_v3') || '{}');
        fromSession = sessionData.exportConfig || {};
    } catch (e) {}

    // Prioridad: localStorage > sesión (el más reciente gana)
    const saved = { ...fromSession, ...fromLS };

    // Mapeo campo ID -> clave en saved
    const textFields = {
        projectDocCode: 'documentCode',
        projectVersion: 'version',
        projectEmpresa: 'empresa',
        projectMarcoReg: 'marcoRegulatorio',
        projectFechaInicio: 'fechaInicio',
        projectFechaFin: 'fechaFin',
        projectAlcance: 'alcance',
        projectProximosPasos: 'proximosPasos',
        projectEjecutor: 'ejecutor',
        projectRevisor: 'revisor',
        projectAprobador: 'aprobador'
    };

    // Llenar campos de texto/textarea/date
    for (const [fieldId, key] of Object.entries(textFields)) {
        const el = document.getElementById(fieldId);
        if (el && !el.value.trim()) {
            const val = saved[key] || '';
            if (val) el.value = val;
        }
    }

    // Si empresa sigue vacia, tomar de systemInfo
    const elEmpresa = document.getElementById('projectEmpresa');
    if (elEmpresa && !elEmpresa.value.trim() && systemInfo.empresa) {
        elEmpresa.value = systemInfo.empresa;
    }

    // Si ejecutor/revisor/aprobador siguen vacios, tomar del panel de sistema
    const rolFields = [
        { exportId: 'projectEjecutor', mainId: 'ejecutor' },
        { exportId: 'projectRevisor', mainId: 'revisor' },
        { exportId: 'projectAprobador', mainId: 'aprobador' }
    ];
    rolFields.forEach(({ exportId, mainId }) => {
        const el = document.getElementById(exportId);
        const main = document.getElementById(mainId);
        if (el && !el.value.trim() && main?.value.trim()) {
            el.value = main.value.trim();
        }
    });

    // Radio buttons
    if (saved.gampCategory) {
        const radio = document.querySelector(`input[name="projectGampCat"][value="${saved.gampCategory}"]`);
        if (radio) radio.checked = true;
    }
    if (saved.criticidad) {
        const radio = document.querySelector(`input[name="projectCriticidad"][value="${saved.criticidad}"]`);
        if (radio) radio.checked = true;
    }
}

/**
 * Guardar valores del modal de exportar proyecto en localStorage
 */
function saveProjectExportDefaults(exportData) {
    const STORAGE_KEY = 'drp_projectExportDefaults';
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(exportData));
    } catch (e) { /* ignore */ }
}

/**
 * Leer configuración de exportación desde la UI o desde memoria
 */
function getExportConfigFromUI() {
    // Si el modal está abierto, leer de los campos
    const version = document.getElementById('projectVersion')?.value.trim();
    if (version) {
        return {
            documentCode: document.getElementById('projectDocCode')?.value.trim() || '',
            version: version,
            empresa: document.getElementById('projectEmpresa')?.value.trim() || '',
            gampCategory: document.querySelector('input[name="projectGampCat"]:checked')?.value || '',
            criticidad: document.querySelector('input[name="projectCriticidad"]:checked')?.value || '',
            marcoRegulatorio: document.getElementById('projectMarcoReg')?.value.trim() || '',
            fechaInicio: document.getElementById('projectFechaInicio')?.value || '',
            fechaFin: document.getElementById('projectFechaFin')?.value || '',
            alcance: document.getElementById('projectAlcance')?.value.trim() || '',
            proximosPasos: document.getElementById('projectProximosPasos')?.value.trim() || '',
            ejecutor: document.getElementById('projectEjecutor')?.value.trim() || '',
            revisor: document.getElementById('projectRevisor')?.value.trim() || '',
            aprobador: document.getElementById('projectAprobador')?.value.trim() || ''
        };
    }
    // Si no, devolver lo último guardado
    try {
        return JSON.parse(localStorage.getItem('drp_projectExportDefaults') || '{}');
    } catch (e) { return {}; }
}

function validateAndGetProjectExportData() {
    // Campos de texto obligatorios
    const docCode = document.getElementById('projectDocCode')?.value.trim();
    const version = document.getElementById('projectVersion')?.value.trim();
    const empresa = document.getElementById('projectEmpresa')?.value.trim();
    const marcoReg = document.getElementById('projectMarcoReg')?.value.trim();
    const fechaInicio = document.getElementById('projectFechaInicio')?.value;
    const fechaFin = document.getElementById('projectFechaFin')?.value;
    const alcance = document.getElementById('projectAlcance')?.value.trim();
    const ejecutor = document.getElementById('projectEjecutor')?.value.trim();

    // Radio buttons obligatorios
    const gampCat = document.querySelector('input[name="projectGampCat"]:checked')?.value;
    const criticidad = document.querySelector('input[name="projectCriticidad"]:checked')?.value;

    // Validaciones
    if (!docCode) {
        drpAlert('El codigo del documento es obligatorio', 'Campo requerido', 'warning');
        return null;
    }
    if (!version) {
        drpAlert('La version del sistema es obligatoria', 'Campo requerido', 'warning');
        return null;
    }
    if (!empresa) {
        drpAlert('La empresa propietaria es obligatoria', 'Campo requerido', 'warning');
        return null;
    }
    if (!gampCat) {
        drpAlert('Selecciona una categoria GAMP', 'Campo requerido', 'warning');
        return null;
    }
    if (!criticidad) {
        drpAlert('Selecciona la criticidad GxP', 'Campo requerido', 'warning');
        return null;
    }
    if (marcoReg.length < 100) {
        drpAlert('El marco regulatorio debe tener al menos 100 caracteres', 'Contenido insuficiente', 'warning');
        return null;
    }
    if (!fechaInicio || !fechaFin) {
        drpAlert('Las fechas de inicio y fin son obligatorias', 'Campo requerido', 'warning');
        return null;
    }
    if (alcance.length < 100) {
        drpAlert('El alcance del sistema debe tener al menos 100 caracteres', 'Contenido insuficiente', 'warning');
        return null;
    }

    if (!ejecutor) {
        drpAlert('El nombre del ejecutor es obligatorio', 'Campo requerido', 'warning');
        return null;
    }

    // Campos opcionales
    const proximosPasos = document.getElementById('projectProximosPasos')?.value.trim();
    const revisor = document.getElementById('projectRevisor')?.value.trim();
    const aprobador = document.getElementById('projectAprobador')?.value.trim();

    const result = {
        documentCode: docCode,
        version,
        empresa,
        gampCategory: gampCat,
        criticidad,
        marcoRegulatorio: marcoReg,
        fechaInicio,
        fechaFin,
        alcance,
        proximosPasos,
        ejecutor,
        revisor,
        aprobador
    };

    // Persistir para la proxima vez que se abra el modal
    saveProjectExportDefaults(result);

    return result;
}

function updateProjectCharCounters() {
    const marcoReg = document.getElementById('projectMarcoReg');
    const alcance = document.getElementById('projectAlcance');
    const conclusion = document.getElementById('projectConclusion');

    if (marcoReg) {
        const counter = document.getElementById('marcoRegCharCounter');
        if (counter) {
            const length = marcoReg.value.length;
            counter.textContent = `${length} / 100 caracteres minimo`;
            counter.style.color = length < 100 ? 'var(--vsc-rojo)' : 'var(--vsc-verde)';
        }
    }

    if (alcance) {
        const counter = document.getElementById('alcanceCharCounter');
        if (counter) {
            const length = alcance.value.length;
            counter.textContent = `${length} / 250 caracteres minimo`;
            counter.style.color = length < 250 ? 'var(--vsc-rojo)' : 'var(--vsc-verde)';
        }
    }
}

/* ====================================================================
   CAPTURA DESDE MOVIL — Sincronizacion via servidor LAN
   ==================================================================== */

let mobileSyncToken = null;
let mobileSyncPollInterval = null;
let mobileSyncIpCheckInterval = null;
let mobileSyncLastTimestamp = 0;
let mobileSyncReceivedIds = new Set();
let mobileSyncStatusReceived = false;
let mobileSyncCurrentIp = null;

async function startMobileCapture() {
    // Verificar que hay tests
    if (!tests || tests.length === 0) {
        showNotification('Crea al menos una prueba antes de activar captura movil', 'warning');
        return;
    }

    // En producción (HTTPS / Railway): el celular puede acceder directo al servidor.
    // No se necesita sync LAN. Mostrar QR con la URL pública y un mensaje explicativo.
    if (window.location.protocol === 'https:') {
        const prodUrl = window.location.origin;
        document.getElementById('mobileQrUrl').textContent = prodUrl;
        const tokenEl = document.getElementById('mobileSessionToken');
        if (tokenEl) tokenEl.textContent = 'acceso directo';
        document.getElementById('mobilePhotosCount').textContent = '—';
        document.getElementById('mobileStatusText').textContent =
            'Modo cloud: escaneá el QR con el celular, iniciá sesión y cargá fotos normalmente. Las imágenes quedan guardadas en el servidor y aparecen al recargar.';
        renderMobileQr(prodUrl);
        const ipSel = document.getElementById('mobileIpSelectorContainer');
        if (ipSel) ipSel.style.display = 'none';
        showModal('modalMobileCapture');
        return;
    }

    // Verificar que el server esta corriendo (debe responder a /sync/info)
    try {
        const infoResp = await fetch('/sync/info');
        if (!infoResp.ok) throw new Error('Server no responde');
    } catch (e) {
        showNotification('El servidor de sincronizacion no esta activo. Reinicia INICIAR.bat', 'error');
        return;
    }

    // Generar token corto y memorable
    const tokenChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O,0,I,1
    let token = '';
    for (let i = 0; i < 6; i++) {
        token += tokenChars[Math.floor(Math.random() * tokenChars.length)];
    }

    // Construir sesion liviana (sin imagenes binarias para reducir el payload)
    const sessionLite = {
        systemInfo: {
            empresa: document.getElementById('empresa')?.value || '',
            nombreSistema: document.getElementById('nombreSistema')?.value || '',
            codigoSistema: document.getElementById('codigoSistema')?.value || ''
        },
        executor: document.getElementById('ejecutor')?.value || '',
        protocols: protocols.map(p => ({ id: p.id, code: p.code, name: p.name })),
        groups: groups.map(g => ({ id: g.id, name: g.name, protocolId: g.protocolId, finalized: g.finalized })),
        tests: tests.map(t => ({
            id: t.id,
            name: t.name,
            groupId: t.groupId,
            finalized: t.finalized,
            evidenceCount: t.evidences.filter(e => !e.isEmpty).length,
            // Incluir solo metadata de evidencias vacias para que el celu pueda llenarlas
            emptyEvidences: t.evidences
                .filter(e => e.isEmpty)
                .map(e => ({ step: e.step, description: e.description || '' }))
        }))
    };

    // Subir sesion al servidor
    let serverInfo;
    try {
        const resp = await fetch('/sync/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, session_data: sessionLite })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        serverInfo = await resp.json();
    } catch (e) {
        showNotification('Error subiendo sesion al servidor: ' + e.message, 'error');
        return;
    }

    // Guardar estado — usar el token generado por el server, no el local
    mobileSyncToken = serverInfo.token;
    mobileSyncLastTimestamp = 0;
    mobileSyncReceivedIds = new Set();
    mobileSyncStatusReceived = false;

    // Mostrar modal con QR
    const url = serverInfo.url_movil;
    document.getElementById('mobileQrUrl').textContent = url;
    document.getElementById('mobileSessionToken').textContent = serverInfo.token;
    document.getElementById('mobilePhotosCount').textContent = '0';
    document.getElementById('mobileStatusText').textContent = 'Esperando conexion del movil...';

    // Renderizar QR con la URL actual
    mobileSyncCurrentIp = serverInfo.ip;
    renderMobileQr(url);

    // Si el server detectó múltiples IPs, mostrar selector
    populateIpSelector(serverInfo.all_ips || [serverInfo.ip], serverInfo.ip);

    // Verificar cada 30s si la IP cambio - si cambio, regenerar el QR
    if (mobileSyncIpCheckInterval) clearInterval(mobileSyncIpCheckInterval);
    mobileSyncIpCheckInterval = setInterval(checkMobileSyncIpChanged, 30000);

    showModal('modalMobileCapture');

    // Iniciar polling
    mobileSyncPollInterval = setInterval(pollMobilePhotos, 3000);
    pollMobilePhotos(); // primer chequeo inmediato
}

function populateIpSelector(allIps, currentIp) {
    const container = document.getElementById('mobileIpSelectorContainer');
    const select = document.getElementById('mobileIpSelector');
    if (!container || !select) return;

    if (!allIps || allIps.length <= 1) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    select.innerHTML = allIps.map(ip => `
        <option value="${ip}" ${ip === currentIp ? 'selected' : ''}>${ip}${ip === currentIp ? ' (actual)' : ''}</option>
    `).join('');
}

function changeMobileSyncIp(newIp) {
    if (!mobileSyncToken || !newIp) return;
    const port = window.location.port || '8080';
    const newUrl = `http://${newIp}:${port}?mobile=${mobileSyncToken}`;
    mobileSyncCurrentIp = newIp;
    renderMobileQr(newUrl);
    showNotification(`QR regenerado con IP: ${newIp}`, 'info', 4000);
}

/**
 * Renderiza un QR code en un elemento <img> usando qrcodejs (lib/qrcode.min.js).
 * Genera un data:image/png via canvas — compatible con CSP img-src 'self' data: blob:.
 * Compartido por los tres flujos QR: captura móvil, firma manuscrita, wizard.
 */
function _renderQrToImg(imgEl, url, size) {
    if (!imgEl || typeof QRCode === 'undefined') return;
    size = size || 256;
    try {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
        document.body.appendChild(wrap);
        new QRCode(wrap, {
            text: url, width: size, height: size,
            colorDark: '#073e8b', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        const canvas = wrap.querySelector('canvas');
        const imgTag = wrap.querySelector('img');
        if (canvas) {
            imgEl.src = canvas.toDataURL('image/png');
        } else if (imgTag && imgTag.src) {
            imgEl.src = imgTag.src;
        }
        document.body.removeChild(wrap);
    } catch (e) {
        console.warn('QR render error:', e);
    }
}

function renderMobileQr(url) {
    const qrImg = document.getElementById('mobileQrImage');
    if (!qrImg) return;
    document.getElementById('mobileQrUrl').textContent = url;
    _renderQrToImg(qrImg, url, 280);
}

async function checkMobileSyncIpChanged() {
    if (!mobileSyncToken) return;
    try {
        const resp = await fetch('/sync/info');
        if (!resp.ok) return;
        const info = await resp.json();
        if (info.ip && info.ip !== mobileSyncCurrentIp) {
            // IP cambio: re-subir la sesion al server (para que tenga el snapshot mas reciente)
            // y regenerar el QR con la IP nueva
            await refreshMobileSyncSession();
            const port = window.location.port || '8080';
            const newUrl = `http://${info.ip}:${port}?mobile=${mobileSyncToken}`;
            mobileSyncCurrentIp = info.ip;
            renderMobileQr(newUrl);
            showNotification(`IP del servidor cambio. QR actualizado a ${info.ip}`, 'warning', 6000);
        }
    } catch (e) { /* silencio */ }
}

async function pollMobilePhotos() {
    if (!mobileSyncToken) return;

    try {
        const resp = await fetch(`/sync/photos/${mobileSyncToken}?since=${mobileSyncLastTimestamp}`);
        if (!resp.ok) {
            if (resp.status === 404) {
                // Sesion expirada
                stopMobileCapture(true);
                showNotification('Sesion movil expirada', 'warning');
            }
            return;
        }
        const data = await resp.json();
        mobileSyncLastTimestamp = data.server_time || mobileSyncLastTimestamp;

        if (data.photos && data.photos.length > 0) {
            // Marcar conexion establecida
            if (!mobileSyncStatusReceived) {
                mobileSyncStatusReceived = true;
                document.getElementById('mobileStatusText').textContent = 'Movil conectado';
                document.querySelector('.spinner-mobile').style.display = 'none';
            }

            let anyNew = false;
            for (const photo of data.photos) {
                if (mobileSyncReceivedIds.has(photo.id)) continue;
                mobileSyncReceivedIds.add(photo.id);
                try {
                    await processMobilePhoto(photo);
                    anyNew = true;
                } catch (photoErr) {
                    console.error('Error procesando foto movil:', photo.id, photoErr);
                }
            }

            // Actualizar contador
            document.getElementById('mobilePhotosCount').textContent = mobileSyncReceivedIds.size.toString();

            // Refrescar area de trabajo si el test activo recibio fotos
            if (anyNew && activeTestId) {
                renderWorkArea();
            }
        }
    } catch (e) {
        console.warn('Poll error:', e);
    }
}

async function processMobilePhoto(photo) {
    if (!photo.testId || !photo.image) return;

    const test = tests.find(t => t.id === photo.testId);
    if (!test) {
        console.warn('Test no encontrado para foto:', photo.testId);
        return;
    }

    // Buscar evidencia vacia correspondiente o crear nueva
    let targetEvidence = test.evidences.find(e => e.step === photo.step && e.isEmpty);
    if (!targetEvidence) {
        // Crear nueva evidencia al final
        const nextStep = test.evidences.length > 0
            ? Math.max(...test.evidences.map(e => e.step)) + 1
            : 1;
        targetEvidence = {
            step: nextStep,
            image: null,
            description: '',
            resultado: 'PASA',
            timestamp: new Date().toISOString(),
            isEmpty: false
        };
        test.evidences.push(targetEvidence);
    }

    // Llenar la evidencia con los datos de la foto + metadata
    targetEvidence.image = photo.image;
    targetEvidence.description = photo.description || targetEvidence.description || 'Foto desde movil';
    targetEvidence.operacion = photo.operacion || targetEvidence.operacion || '';
    targetEvidence.resultado = photo.resultado || 'PASA';
    targetEvidence.executor = photo.executor || targetEvidence.executor || executor;
    targetEvidence.captureTimestamp = photo.timestamp || new Date().toISOString();
    targetEvidence.timestamp = photo.timestamp || new Date().toISOString();
    targetEvidence.dimensions = photo.dimensions || targetEvidence.dimensions || '';
    targetEvidence.size = photo.size || targetEvidence.size || '';
    targetEvidence.sourceType = photo.sourceType || 'mobile-camera';
    // Mapear EXIF real del celular (cuando el mobile lo extrajo de la foto original).
    // Si algún campo viene vacío, caemos a defaults legibles para que la UI no
    // muestre strings raros.
    targetEvidence.exif = {
        originalFileName: photo.originalFileName || 'mobile-photo.jpg',
        captureDate: photo.captureDate || photo.timestamp || new Date().toISOString(),
        cameraMake: photo.cameraMake || 'Mobile device',
        cameraModel: photo.cameraModel || 'Cámara del celular',
        gpsLatitude: photo.gpsLatitude || null,
        gpsLongitude: photo.gpsLongitude || null,
        gpsLatitudeRef: photo.gpsLatitudeRef || null,
        gpsLongitudeRef: photo.gpsLongitudeRef || null,
        orientation: photo.orientation || 1,
        fileSize: photo.size,
        mimeType: 'image/jpeg',
        source: 'mobile-sync'
    };
    targetEvidence.isEmpty = false;

    // Guardar imagen en IndexedDB
    const imageId = `${test.id}_evidence_${targetEvidence.step}`;
    try {
        await saveImageToDB(imageId, photo.image);
    } catch (e) {
        console.error('Error guardando imagen:', e);
    }

    // Persistir sesion
    await saveToStorage();

    // Re-renderizar si la prueba afectada esta activa
    if (activeTestId === test.id) {
        renderWorkArea();
    }

    showNotification(`Foto recibida: ${test.name} - Paso ${targetEvidence.step}`);

    // Mostrar panel de ultima foto en el modal de captura movil
    const lastPanel = document.getElementById('mobileLastPhoto');
    const lastText = document.getElementById('mobileLastPhotoText');
    if (lastPanel && lastText) {
        lastPanel.style.display = 'block';
        const time = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        lastText.textContent = `${test.name} - Paso ${String(targetEvidence.step).padStart(3, '0')} (${time})`;
    }
}

async function refreshMobileSyncSession() {
    if (!mobileSyncToken) return;

    const sessionLite = {
        systemInfo: {
            empresa: document.getElementById('empresa')?.value || '',
            nombreSistema: document.getElementById('nombreSistema')?.value || '',
            codigoSistema: document.getElementById('codigoSistema')?.value || ''
        },
        executor: document.getElementById('ejecutor')?.value || '',
        protocols: protocols.map(p => ({ id: p.id, code: p.code, name: p.name })),
        groups: groups.map(g => ({ id: g.id, name: g.name, protocolId: g.protocolId, finalized: g.finalized })),
        tests: tests.map(t => ({
            id: t.id,
            name: t.name,
            groupId: t.groupId,
            finalized: t.finalized,
            evidenceCount: t.evidences.filter(e => !e.isEmpty).length,
            emptyEvidences: t.evidences
                .filter(e => e.isEmpty)
                .map(e => ({ step: e.step, description: e.description || '' }))
        }))
    };

    try {
        await fetch('/sync/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: mobileSyncToken, session_data: sessionLite })
        });
    } catch (e) { /* silencio */ }
}

// Sin handler de beforeunload — el cierre de la pestaña libera todos los
// intervals automáticamente, y mantener ANY listener de beforeunload en
// Chrome puede disparar el prompt nativo "¿Volver a cargar?" en algunos
// escenarios. Costo cero por quitarlo.

async function stopMobileCapture(silent) {
    if (mobileSyncPollInterval) {
        clearInterval(mobileSyncPollInterval);
        mobileSyncPollInterval = null;
    }
    if (mobileSyncIpCheckInterval) {
        clearInterval(mobileSyncIpCheckInterval);
        mobileSyncIpCheckInterval = null;
    }

    if (mobileSyncToken) {
        try {
            await fetch(`/sync/session/${mobileSyncToken}`, { method: 'DELETE' });
        } catch (e) { /* ignorar */ }
    }

    mobileSyncToken = null;
    mobileSyncLastTimestamp = 0;
    mobileSyncReceivedIds = new Set();
    mobileSyncStatusReceived = false;

    closeModal('modalMobileCapture');

    // Refrescar el area de trabajo para mostrar cualquier foto que haya llegado
    // mientras el modal cubria la vista
    renderWorkArea();

    if (!silent) {
        showNotification('Sesion movil cerrada');
    }
}

/* ====================================================================
   MODO MOVIL — Vista responsive para captura desde celular
   ==================================================================== */

let mobileViewToken = null;
let mobileViewSession = null;
let mobileViewSelectedTest = null;
let mobileViewPhotoQueue = [];
let mobileViewAutoSyncInterval = null;
let mobileViewLastSync = 0;
let mobileViewSessionHash = '';

function checkMobileMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('mobile');
    if (token) {
        mobileViewToken = token;
        initMobileView();
    }
}

async function initMobileView() {
    // Ocultar la UI normal
    document.body.style.overflow = 'hidden';

    // Inyectar el contenedor movil con su propio CSS
    const overlay = document.createElement('div');
    overlay.id = 'mobileViewOverlay';
    overlay.innerHTML = `
        <style>
            #mobileViewOverlay {
                position: fixed; inset: 0; z-index: 99999;
                background: #F0F2F5; color: #213B50;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow-y: auto; -webkit-overflow-scrolling: touch;
            }
            #mobileViewOverlay * { box-sizing: border-box; }
            .mvHeader {
                background: #073e8b; color: white; padding: 16px;
                position: sticky; top: 0; z-index: 10;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                display: flex; align-items: center; gap: 12px;
            }
            .mvBack {
                background: rgba(255,255,255,0.15); border: none; color: white;
                width: 36px; height: 36px; border-radius: 50%; font-size: 20px;
                cursor: pointer; display: flex; align-items: center; justify-content: center;
            }
            .mvHeader h2 {
                margin: 0; font-size: 16px; flex: 1;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .mvBody { padding: 14px; padding-bottom: 80px; }
            .mvSubtitle { font-size: 12px; color: #717D8A; margin: 0 0 14px; }
            .mvCard {
                background: white; border-radius: 10px; padding: 14px; margin-bottom: 10px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.06);
                cursor: pointer; transition: all 0.15s;
                border-left: 4px solid #00b050;
            }
            .mvCard:active { transform: scale(0.98); background: #FAFBFC; }
            .mvCard.finalized { border-left-color: #717D8A; opacity: 0.7; }
            .mvCard h3 { margin: 0 0 6px; font-size: 14px; color: #073e8b; }
            .mvCard .mvMeta { font-size: 11px; color: #717D8A; }
            .mvBadge {
                display: inline-block; padding: 2px 8px; border-radius: 10px;
                font-size: 10px; font-weight: bold; margin-right: 4px;
            }
            .mvBadge.green { background: #d4f5dd; color: #00b050; }
            .mvBadge.gray { background: #E8ECF0; color: #717D8A; }
            .mvForm label {
                display: block; font-size: 11px; color: #073e8b; font-weight: 600;
                margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.5px;
            }
            .mvForm input, .mvForm select, .mvForm textarea {
                width: 100%; padding: 12px; border: 1px solid #E8ECF0;
                border-radius: 8px; font-size: 14px; background: white;
                font-family: inherit; -webkit-appearance: none;
            }
            .mvForm textarea { resize: vertical; min-height: 70px; }
            .mvForm input:focus, .mvForm select:focus, .mvForm textarea:focus {
                outline: none; border-color: #073e8b;
            }
            .mvBtn {
                width: 100%; padding: 14px; border: none; border-radius: 8px;
                font-size: 15px; font-weight: 600; cursor: pointer;
                margin-top: 10px; -webkit-appearance: none;
            }
            .mvBtn.primary { background: #073e8b; color: white; }
            .mvBtn.success { background: #00b050; color: white; }
            .mvBtn.secondary { background: #E8ECF0; color: #213B50; }
            .mvBtn:active { transform: scale(0.98); }
            .mvPhotoPreview {
                width: 100%; max-height: 280px; object-fit: contain;
                border-radius: 8px; background: #E8ECF0; margin-top: 10px;
            }
            .mvCaptureLabel {
                display: block; padding: 22px 18px; border: 2px dashed #073e8b;
                border-radius: 12px; text-align: center; cursor: pointer;
                background: linear-gradient(180deg, #ffffff 0%, #f8fafd 100%);
                margin-top: 10px; transition: all 0.2s;
            }
            .mvCaptureLabel:active { background: #f0f4f8; transform: scale(0.98); }
            .mvCaptureLabel svg { display: block; margin: 0 auto 8px; }
            .mvCaptureLabel .mvCaptureTxt { font-size: 15px; font-weight: 700; color: #073e8b; }
            .mvCaptureLabel .mvCaptureSub { font-size: 12px; color: #717D8A; margin-top: 4px; }
            /* Variante "elegir de galería" — borde sólido gris para diferenciar de cámara */
            .mvCaptureLabel.mvCaptureAlt {
                border-style: solid; border-color: #AFBDC8;
            }
            .mvCaptureLabel.mvCaptureAlt svg { stroke: #586574; }
            .mvCaptureLabel.mvCaptureAlt .mvCaptureTxt { color: #586574; }
            .mvCaptureRow {
                display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;
            }
            .mvCaptureRow .mvCaptureLabel { margin-top: 0; }
            .mvLoading {
                display: flex; align-items: center; justify-content: center;
                padding: 40px; flex-direction: column; gap: 10px;
            }
            .mvSpinner {
                width: 32px; height: 32px; border: 3px solid #E8ECF0;
                border-top-color: #073e8b; border-radius: 50%;
                animation: mvSpin 0.8s linear infinite;
            }
            @keyframes mvSpin { to { transform: rotate(360deg); } }
            .mvToast {
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                background: #213B50; color: white; padding: 12px 20px;
                border-radius: 24px; font-size: 13px; z-index: 100000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                animation: mvFade 0.3s;
            }
            .mvToast.success { background: #00b050; }
            .mvToast.error { background: #DC3545; }
            @keyframes mvFade { from { opacity: 0; transform: translate(-50%, 20px); } }
            .mvEmpty {
                text-align: center; padding: 60px 20px; color: #717D8A; font-size: 13px;
            }
            .mvQueueBar {
                display: none; align-items: center; justify-content: space-between;
                gap: 8px; margin-top: 8px;
            }
            .mvQueueNav {
                background: #E8ECF0; border: none; border-radius: 50%;
                width: 36px; height: 36px; font-size: 20px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
            }
            .mvQueueNav:active { transform: scale(0.92); }
            .mvQueueLabel { font-size: 13px; font-weight: 600; color: #213B50; flex: 1; text-align: center; }
            .mvRotateBtn {
                background: #E8ECF0; border: none; border-radius: 8px;
                padding: 8px 14px; font-size: 13px; font-weight: 600;
                cursor: pointer; color: #213B50; display: flex; align-items: center; gap: 6px;
                flex-shrink: 0;
            }
            .mvRotateBtn:active { transform: scale(0.95); }
        </style>
        <div id="mvContent">
            <div class="mvLoading">
                <div class="mvSpinner"></div>
                <div>Cargando sesion...</div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Cargar sesion del server
    try {
        const resp = await fetch(`/sync/session/${mobileViewToken}`);
        if (!resp.ok) {
            renderMobileError('Sesion no encontrada o expirada. Pedi un nuevo QR en la PC.');
            return;
        }
        const data = await resp.json();
        mobileViewSession = data.session_data;
        mobileViewSessionHash = JSON.stringify(mobileViewSession.tests || []).length + ':' + (mobileViewSession.tests || []).length;
        mobileViewLastSync = Date.now();
        renderMobileTestList();

        // Iniciar auto-sync cada 5s (solo refresca si cambia el hash)
        if (mobileViewAutoSyncInterval) clearInterval(mobileViewAutoSyncInterval);
        mobileViewAutoSyncInterval = setInterval(autoSyncMobileSession, 5000);
    } catch (e) {
        renderMobileError('Error de conexion: ' + e.message);
    }
}

let mobileViewConsecutiveErrors = 0;

async function autoSyncMobileSession() {
    if (!mobileViewToken) return;
    if (mobileViewSelectedTest) return;

    try {
        const resp = await fetch(`/sync/session/${mobileViewToken}`);
        if (!resp.ok) {
            mobileViewConsecutiveErrors++;
            updateMobileConnectionStatus(false);
            return;
        }
        mobileViewConsecutiveErrors = 0;
        const data = await resp.json();
        const newSession = data.session_data;
        const newHash = JSON.stringify(newSession.tests || []).length + ':' + (newSession.tests || []).length;

        if (newHash !== mobileViewSessionHash) {
            mobileViewSession = newSession;
            mobileViewSessionHash = newHash;
            mobileViewLastSync = Date.now();
            renderMobileTestList();
            showMobileToast('Sesion actualizada desde PC', 'success');
        } else {
            mobileViewLastSync = Date.now();
            updateMobileSyncIndicator();
        }
    } catch (e) {
        mobileViewConsecutiveErrors++;
        updateMobileConnectionStatus(false);
    }
}

function updateMobileConnectionStatus(ok) {
    const el = document.getElementById('mvSyncIndicator');
    if (!el) return;
    if (ok) {
        el.style.color = '#00b050';
        el.innerHTML = '<span style="width: 6px; height: 6px; border-radius: 50%; background: #00b050; display: inline-block;"></span> Sincronizado';
    } else {
        el.style.color = '#DC3545';
        if (mobileViewConsecutiveErrors >= 3) {
            el.innerHTML = `<span style="width: 6px; height: 6px; border-radius: 50%; background: #DC3545; display: inline-block;"></span> Sin conexion (${mobileViewConsecutiveErrors})`;
        } else {
            el.innerHTML = '<span style="width: 6px; height: 6px; border-radius: 50%; background: #ffc000; display: inline-block;"></span> Reintentando...';
        }
    }
}

function updateMobileSyncIndicator() {
    updateMobileConnectionStatus(true);
}

function renderMobileError(msg) {
    document.getElementById('mvContent').innerHTML = `
        <div class="mvHeader"><h2>Error</h2></div>
        <div class="mvBody">
            <div class="mvEmpty">${msg}</div>
        </div>
    `;
}

function renderMobileTestList() {
    if (!mobileViewSession) return;
    const groups = mobileViewSession.groups || [];
    const tests = mobileViewSession.tests || [];

    let html = `
        <div class="mvHeader">
            <h2>${mobileViewSession.systemInfo?.nombreSistema || 'Sistema'}</h2>
            <button class="mvBack" onclick="refreshMobileView()" title="Refrescar">&#x21bb;</button>
        </div>
        <div class="mvBody">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <p class="mvSubtitle" style="margin: 0;">${tests.length} prueba${tests.length !== 1 ? 's' : ''} disponibles</p>
                <span id="mvSyncIndicator" style="font-size: 10px; color: #00b050; display: flex; align-items: center; gap: 4px;">
                    <span style="width: 6px; height: 6px; border-radius: 50%; background: #00b050; display: inline-block;"></span>
                    Sincronizado
                </span>
            </div>
    `;

    if (tests.length === 0) {
        html += '<div class="mvEmpty">No hay pruebas en esta sesion</div>';
    } else {
        // Agrupar por carpeta
        groups.forEach(g => {
            const folderTests = tests.filter(t => t.groupId === g.id);
            if (folderTests.length === 0) return;
            html += `<div style="font-size: 11px; color: #717D8A; margin: 14px 0 8px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">${g.name}</div>`;
            folderTests.forEach(t => {
                const finalizedClass = t.finalized ? 'finalized' : '';
                const emptyCount = (t.emptyEvidences || []).length;
                html += `
                    <div class="mvCard ${finalizedClass}" onclick="openMobileTest('${t.id}')">
                        <h3>${escapeHtml(t.name)}</h3>
                        <div class="mvMeta">
                            <span class="mvBadge ${t.finalized ? 'gray' : 'green'}">${t.finalized ? 'Finalizada' : 'Activa'}</span>
                            <span>${t.evidenceCount} evidencia${t.evidenceCount !== 1 ? 's' : ''}</span>
                            ${emptyCount > 0 ? ` &middot; <span style="color: #ffc000;">${emptyCount} pendiente${emptyCount !== 1 ? 's' : ''}</span>` : ''}
                        </div>
                    </div>
                `;
            });
        });

        // Tests sin carpeta
        const noFolder = tests.filter(t => !t.groupId);
        if (noFolder.length > 0) {
            html += `<div style="font-size: 11px; color: #717D8A; margin: 14px 0 8px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Sin carpeta</div>`;
            noFolder.forEach(t => {
                const finalizedClass = t.finalized ? 'finalized' : '';
                html += `
                    <div class="mvCard ${finalizedClass}" onclick="openMobileTest('${t.id}')">
                        <h3>${escapeHtml(t.name)}</h3>
                        <div class="mvMeta">
                            <span class="mvBadge ${t.finalized ? 'gray' : 'green'}">${t.finalized ? 'Finalizada' : 'Activa'}</span>
                            <span>${t.evidenceCount} evidencia${t.evidenceCount !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                `;
            });
        }
    }
    html += '</div>';
    document.getElementById('mvContent').innerHTML = html;
}

async function refreshMobileView() {
    showMobileToast('Actualizando...', '');
    try {
        const resp = await fetch(`/sync/session/${mobileViewToken}`);
        if (!resp.ok) {
            showMobileToast('Sesion expirada', 'error');
            return;
        }
        const data = await resp.json();
        mobileViewSession = data.session_data;
        renderMobileTestList();
        showMobileToast('Sesion actualizada', 'success');
    } catch (e) {
        showMobileToast('Error: ' + e.message, 'error');
    }
}

function openMobileTest(testId) {
    const test = (mobileViewSession.tests || []).find(t => t.id === testId);
    if (!test) return;
    mobileViewSelectedTest = test;
    renderMobileCaptureView();
}

function renderMobileCaptureView() {
    const test = mobileViewSelectedTest;
    const empty = test.emptyEvidences || [];
    window._mvQueue    = [];
    window._mvQueueIdx = 0;

    const html = `
        <div class="mvHeader">
            <button class="mvBack" onclick="renderMobileTestList()">&larr;</button>
            <h2>${escapeHtml(test.name)}</h2>
        </div>
        <div class="mvBody">
            <p class="mvSubtitle">${test.evidenceCount} evidencia${test.evidenceCount !== 1 ? 's' : ''} cargada${test.evidenceCount !== 1 ? 's' : ''}${empty.length ? ` &middot; ${empty.length} pendiente${empty.length !== 1 ? 's' : ''}` : ''}</p>

            <form class="mvForm" onsubmit="event.preventDefault(); submitMobilePhoto();">
                <label>EVIDENCIA</label>
                <div class="mvCaptureRow">
                    <label for="mvPhotoInput" class="mvCaptureLabel">
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#073e8b" stroke-width="2">
                            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <div class="mvCaptureTxt">Tomar foto</div>
                        <div class="mvCaptureSub">Abre la camara</div>
                    </label>
                    <label for="mvImageInput" class="mvCaptureLabel mvCaptureAlt">
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#586574" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <path d="M21 15l-5-5L5 21"/>
                        </svg>
                        <div class="mvCaptureTxt">Elegir imágenes</div>
                        <div class="mvCaptureSub">Podés elegir varias</div>
                    </label>
                </div>
                <!-- Cámara: capture="environment" fuerza la cámara trasera, siempre una foto -->
                <input type="file" id="mvPhotoInput" accept="image/*" capture="environment" onchange="handleMobilePhotoSelected(event)" style="display: none;">
                <!-- Galería: multiple permite seleccionar varias a la vez -->
                <input type="file" id="mvImageInput" accept="image/*" multiple onchange="handleMobilePhotoSelected(event)" style="display: none;">
                <img id="mvPhotoPreview" class="mvPhotoPreview" style="display: none;">
                <div id="mvQueueBar" class="mvQueueBar">
                    <button type="button" class="mvQueueNav" onclick="mvQueueNav(-1)">&#8249;</button>
                    <span id="mvQueueLabel" class="mvQueueLabel">1 / 1</span>
                    <button type="button" class="mvQueueNav" onclick="mvQueueNav(1)">&#8250;</button>
                    <button type="button" class="mvRotateBtn" onclick="rotateMobilePhoto()">&#8635; Rotar</button>
                </div>

                ${empty.length > 0 ? `
                    <label for="mvStepSelect">PASO PENDIENTE (opcional)</label>
                    <select id="mvStepSelect">
                        <option value="">Crear nuevo paso al final</option>
                        ${empty.map(e => `<option value="${e.step}">Paso #${String(e.step).padStart(3, '0')}${e.description ? ` - ${escapeHtml(e.description.substring(0, 40))}` : ''}</option>`).join('')}
                    </select>
                ` : ''}

                <label for="mvDescription">DESCRIPCION</label>
                <textarea id="mvDescription" placeholder="Que muestra esta evidencia..." rows="3"></textarea>

                <label for="mvOperacion">OPERACION (opcional)</label>
                <input type="text" id="mvOperacion" placeholder="Operacion probada">

                <label for="mvResultado">RESULTADO</label>
                <select id="mvResultado">
                    <option value="PASA">PASA</option>
                    <option value="PASA CON OBSERVACIONES">PASA CON OBSERVACIONES</option>
                    <option value="NO PASA">NO PASA</option>
                    <option value="NO APLICA">NO APLICA</option>
                </select>

                <button type="submit" class="mvBtn success" id="mvSubmitBtn" disabled>Subir evidencia</button>
                <button type="button" class="mvBtn secondary" onclick="renderMobileTestList()">Volver</button>
            </form>
        </div>
    `;
    document.getElementById('mvContent').innerHTML = html;
}

// Comprime img (Image element) con rotación en grados (0, 90, 180, 270) y retorna dataUrl JPEG.
function compressWithRotation(img, rotation) {
    const maxDim = 1600, quality = 0.80;
    const swap = rotation === 90 || rotation === 270;
    let sw = img.naturalWidth  || img.width;
    let sh = img.naturalHeight || img.height;
    let dw = sw, dh = sh;
    if (dw > maxDim || dh > maxDim) {
        if (dw > dh) { dh = Math.round(dh / dw * maxDim); dw = maxDim; }
        else { dw = Math.round(dw / dh * maxDim); dh = maxDim; }
    }
    const canvas = document.createElement('canvas');
    canvas.width  = swap ? dh : dw;
    canvas.height = swap ? dw : dh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (rotation !== 0) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    } else {
        ctx.drawImage(img, 0, 0, dw, dh);
    }
    return canvas.toDataURL('image/jpeg', quality);
}

// Actualiza el preview y los controles del queue bar según _mvQueueIdx actual.
function mvRenderQueuePreview() {
    const q   = window._mvQueue || [];
    const idx = window._mvQueueIdx || 0;
    const item = q[idx];
    if (!item || !item.dataUrl) return;

    const preview = document.getElementById('mvPhotoPreview');
    if (preview) { preview.src = item.dataUrl; preview.style.display = 'block'; }

    const bar = document.getElementById('mvQueueBar');
    if (bar) {
        bar.style.display = 'flex';
        const lbl = document.getElementById('mvQueueLabel');
        if (lbl) lbl.textContent = `${idx + 1} / ${q.length}`;
        const navBtns = bar.querySelectorAll('.mvQueueNav');
        navBtns.forEach(b => b.style.display = q.length > 1 ? '' : 'none');
    }

    const btn = document.getElementById('mvSubmitBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = q.length > 1 ? `Subir ${q.length} evidencias` : 'Subir evidencia';
    }
}

// Navega entre imágenes del queue (-1 = anterior, +1 = siguiente).
function mvQueueNav(dir) {
    const q = window._mvQueue || [];
    window._mvQueueIdx = Math.max(0, Math.min(q.length - 1, (window._mvQueueIdx || 0) + dir));
    mvRenderQueuePreview();
}

// Rota 90° la imagen actual del queue y actualiza el preview.
function rotateMobilePhoto() {
    const q    = window._mvQueue || [];
    const item = q[window._mvQueueIdx || 0];
    if (!item || !item.img) return;
    item.rotation = ((item.rotation || 0) + 90) % 360;
    item.dataUrl  = compressWithRotation(item.img, item.rotation);
    mvRenderQueuePreview();
}

function rotateEvidence(index) {
    const test = tests.find(t => t.id === activeTestId);
    if (!test) return;
    const evidence = test.evidences[index];
    if (!evidence || evidence.isEmpty || !evidence.image) return;

    const img = new Image();
    img.onload = function () {
        const currentRotation = evidence._rotation || 0;
        const newRotation = (currentRotation + 90) % 360;
        const newDataUrl = compressWithRotation(img, newRotation);
        evidence.image = newDataUrl;
        evidence._rotation = newRotation;
        const swap = newRotation === 90 || newRotation === 270;
        const parts = (evidence.dimensions || '0x0').split('x');
        if (parts.length === 2) {
            evidence.dimensions = swap ? `${parts[1]}x${parts[0]}` : `${parts[0]}x${parts[1]}`;
        }
        try { saveImageToDB(`${test.id}_evidence_${evidence.step}`, newDataUrl); } catch (e) { /* silenciar */ }
        saveToStorage();
        renderWorkArea();
    };
    img.src = evidence.image;
}

function handleMobilePhotoSelected(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    // Diferenciar origen para trazabilidad GxP — un screenshot no es lo mismo que una foto.
    const sourceType = (event.target.id === 'mvImageInput') ? 'mobile-gallery' : 'mobile-camera';
    window._mvQueue    = new Array(files.length);
    window._mvQueueIdx = 0;

    showMobileToast(files.length > 1 ? `Procesando ${files.length} imágenes...` : 'Procesando imagen...', '');

    let processed = 0;

    files.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let exif = {
                    cameraMake: null, cameraModel: null,
                    dateTimeOriginal: null, captureDate: null,
                    gpsLatitude: null, gpsLongitude: null,
                    gpsLatitudeRef: null, gpsLongitudeRef: null,
                    orientation: 1,
                    originalFileName: file.name,
                    fileSize: file.size,
                    mimeType: file.type
                };

                const afterExif = () => {
                    const dataUrl = compressWithRotation(img, 0);
                    window._mvQueue[idx] = { img, dataUrl, meta: exif, sourceType, rotation: 0 };
                    processed++;
                    if (processed === files.length) {
                        window._mvQueueIdx = 0;
                        mvRenderQueuePreview();
                    }
                };

                if (typeof EXIF !== 'undefined' && EXIF.getData) {
                    // Timeout de seguridad: si EXIF.getData no llama de vuelta en 3s, continuamos igual
                    let exifDone = false;
                    const exifTimeout = setTimeout(() => {
                        if (!exifDone) { exifDone = true; afterExif(); }
                    }, 3000);
                    try {
                        EXIF.getData(img, function () {
                            if (exifDone) return;
                            exifDone = true;
                            clearTimeout(exifTimeout);
                            exif.cameraMake        = EXIF.getTag(this, 'Make')          || null;
                            exif.cameraModel       = EXIF.getTag(this, 'Model')         || null;
                            exif.dateTimeOriginal  = EXIF.getTag(this, 'DateTimeOriginal') || null;
                            exif.gpsLatitude       = EXIF.getTag(this, 'GPSLatitude')   || null;
                            exif.gpsLongitude      = EXIF.getTag(this, 'GPSLongitude')  || null;
                            exif.gpsLatitudeRef    = EXIF.getTag(this, 'GPSLatitudeRef') || null;
                            exif.gpsLongitudeRef   = EXIF.getTag(this, 'GPSLongitudeRef') || null;
                            exif.orientation       = EXIF.getTag(this, 'Orientation')   || 1;
                            if (exif.dateTimeOriginal) {
                                try {
                                    const norm = exif.dateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                                    exif.captureDate = new Date(norm).toISOString();
                                } catch (_) {}
                            }
                            afterExif();
                        });
                    } catch (_) {
                        clearTimeout(exifTimeout);
                        if (!exifDone) { exifDone = true; afterExif(); }
                    }
                } else {
                    afterExif();
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function submitMobilePhoto() {
    const q = (window._mvQueue || []).filter(Boolean);
    if (!q.length) {
        showMobileToast('Cargá una imagen primero', 'error');
        return;
    }

    const test = mobileViewSelectedTest;
    const stepSelect = document.getElementById('mvStepSelect');
    const selectedStep = stepSelect ? parseInt(stepSelect.value) : null;
    const description = document.getElementById('mvDescription').value.trim() || 'Foto desde movil';
    const operacion = document.getElementById('mvOperacion').value.trim();
    const resultado = document.getElementById('mvResultado').value;

    const submitBtn = document.getElementById('mvSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = q.length > 1 ? `Subiendo ${q.length} fotos...` : 'Subiendo...';

    // Envío en paralelo — todas las fotos a la vez, sin abortar si alguna falla
    const results = await Promise.allSettled(q.map((item, i) => {
        const exif = item.meta || {};
        const payload = {
            token: mobileViewToken,
            id: `photo_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            testId: test.id,
            step: selectedStep || null,
            image: item.dataUrl,
            description,
            operacion,
            resultado,
            executor: (mobileViewSession && mobileViewSession.executor) || '',
            timestamp: exif.captureDate || new Date().toISOString(),
            dimensions: '',
            size: '',
            sourceType: item.sourceType || 'mobile-gallery',
            originalFileName: exif.originalFileName || '',
            cameraMake: exif.cameraMake || '',
            cameraModel: exif.cameraModel || '',
            captureDate: exif.captureDate || '',
            gpsLatitude: exif.gpsLatitude || null,
            gpsLongitude: exif.gpsLongitude || null,
            gpsLatitudeRef: exif.gpsLatitudeRef || null,
            gpsLongitudeRef: exif.gpsLongitudeRef || null,
            orientation: exif.orientation || 1
        };
        return fetch('/sync/photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; });
    }));

    const uploaded = results.filter(r => r.status === 'fulfilled').length;
    const failed   = results.filter(r => r.status === 'rejected').length;

    if (failed > 0 && uploaded === 0) {
        showMobileToast(`Error al subir las fotos. Reintentá.`, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reintentar';
        return;
    }
    if (failed > 0) {
        showMobileToast(`${uploaded} subida${uploaded > 1 ? 's' : ''}, ${failed} fallida${failed > 1 ? 's' : ''}`, 'error');
    } else {
        showMobileToast(uploaded > 1 ? `${uploaded} fotos enviadas a la PC` : 'Foto enviada a la PC', 'success');
    }

    // Reset
    window._mvQueue    = [];
    window._mvQueueIdx = 0;
    const preview = document.getElementById('mvPhotoPreview');
    if (preview) preview.style.display = 'none';
    const qbar = document.getElementById('mvQueueBar');
    if (qbar) qbar.style.display = 'none';
    document.getElementById('mvPhotoInput').value = '';
    const mi = document.getElementById('mvImageInput');
    if (mi) mi.value = '';
    document.getElementById('mvDescription').value = '';
    document.getElementById('mvOperacion').value = '';
    if (stepSelect) stepSelect.value = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Subir evidencia';

    test.evidenceCount = (test.evidenceCount || 0) + uploaded;
}

function showMobileToast(msg, type) {
    const toast = document.createElement('div');
    toast.className = `mvToast ${type || ''}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Auto-detectar modo movil al cargar la pagina
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkMobileMode);
} else {
    checkMobileMode();
}

// ====================================================================
// DESVÍOS — Panel de escalación de hallazgos FAIL / PASA CON OBS
// ====================================================================

function collectDesvios() {
    const result = [];
    for (const test of (tests || [])) {
        if (!test.evidences) continue;
        const group    = (groups    || []).find(g => g.id === test.groupId);
        const protocol = group ? (protocols || []).find(p => p.id === group.protocolId) : null;
        for (const ev of test.evidences) {
            if (ev.isEmpty) continue;
            const norm = normalizeDictamen(ev.resultado);
            if (norm !== 'FAIL' && norm !== 'OBS') continue;
            result.push({
                id:          `${test.id}_ev${ev.step}`,
                tcId:        (test.name || test.id).match(/TC-[A-Z]+-\d+/)?.[0] || test.id,
                tcName:      test.name || test.id,
                groupName:   group?.name || '',
                protocolCode:protocol?.code || protocol?.name || '',
                step:        ev.step,
                description: ev.description || '',
                dictamen:    norm === 'FAIL' ? 'NO PASA' : 'PASA CON OBS',
                observacion: ev.observacion || ev.observaciones || '',
            });
        }
    }
    return result;
}

function updateDesviosBadge() {
    const btn   = document.getElementById('btnDesvios');
    const badge = document.getElementById('desviosBadge');
    if (!btn) return;
    const count = collectDesvios().length;
    btn.style.display = count > 0 ? 'inline-flex' : 'none';
    if (badge) badge.textContent = count;
}

function showDesviosPanel() {
    const desvios = collectDesvios();
    const modal   = document.getElementById('modalDesvios');
    if (!modal) return;

    const empresa  = document.getElementById('empresa')?.value  || '';
    const sistema  = document.getElementById('nombreSistema')?.value || '';
    const label    = [empresa, sistema].filter(Boolean).join(' — ') || 'Proyecto activo';

    const labelEl = document.getElementById('desviosProjectLabel');
    if (labelEl) labelEl.textContent = label;
    const countEl = document.getElementById('desviosCount');
    if (countEl) countEl.textContent = desvios.length;

    const list   = document.getElementById('desviosList');
    const footer = document.getElementById('desviosFooter');

    if (desvios.length === 0) {
        list.innerHTML = '<p style="color:#059669;text-align:center;padding:28px;font-size:14px;">Sin desvíos — todos los pasos registran PASA o N/A.</p>';
        if (footer) footer.style.display = 'none';
    } else {
        if (footer) footer.style.display = 'block';
        list.innerHTML = desvios.map(d => {
            const isNoPasa = d.dictamen === 'NO PASA';
            const color    = isNoPasa ? '#dc2626' : '#d97706';
            const bg       = isNoPasa ? '#fff5f5' : '#fffbeb';
            const border   = isNoPasa ? '#fca5a5' : '#fcd34d';
            return `<label class="desvio-row" style="background:${bg};border:1px solid ${border};
                    border-left:3px solid ${color};border-radius:6px;padding:10px 12px;
                    margin-bottom:6px;display:flex;gap:10px;align-items:flex-start;cursor:pointer;">
                <input type="checkbox" class="desvio-chk" data-id="${escapeHtml(d.id)}" checked style="margin-top:3px;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
                        <span style="font-weight:700;font-size:13px;">${escapeHtml(d.tcId)}</span>
                        <span style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.tcName)}</span>
                        <span style="margin-left:auto;background:${color};color:#fff;font-size:10px;
                              font-weight:700;padding:1px 7px;border-radius:3px;">${d.dictamen}</span>
                    </div>
                    <div style="font-size:12px;color:#374151;">Paso ${d.step}: ${escapeHtml(d.description)}</div>
                    ${d.observacion ? `<div style="font-size:11px;color:#6b7280;margin-top:3px;">Obs: ${escapeHtml(d.observacion)}</div>` : ''}
                </div>
            </label>`;
        }).join('');
    }

    modal.style.display = 'flex';
}

function _getSelectedDesvios() {
    return collectDesvios().filter(d => {
        const chk = document.querySelector(`.desvio-chk[data-id="${CSS.escape(d.id)}"]`);
        return chk && chk.checked;
    });
}

function copyDesviosToClipboard() {
    const selected = _getSelectedDesvios();
    if (!selected.length) { showNotification('Seleccioná al menos un desvío', 'warning'); return; }
    const executor = document.getElementById('ejecutor')?.value || '';
    const empresa  = document.getElementById('empresa')?.value  || '';
    const sistema  = document.getElementById('nombreSistema')?.value || '';
    const now = new Date().toLocaleString('es-AR');

    let text = `REPORTE DE DESVÍOS — ${[empresa, sistema].filter(Boolean).join(' / ')}\n`;
    text += `Ejecutor: ${executor} | Fecha: ${now}\n`;
    text += '─'.repeat(60) + '\n\n';
    for (const d of selected) {
        text += `[${d.dictamen}]  ${d.tcId} — ${d.tcName}\n`;
        text += `  Paso ${d.step}: ${d.description}\n`;
        if (d.observacion) text += `  Obs: ${d.observacion}\n`;
        text += '\n';
    }
    navigator.clipboard.writeText(text)
        .then(() => showNotification(`${selected.length} desvío(s) copiado(s)`, 'success'))
        .catch(() => showNotification('No se pudo acceder al portapapeles', 'error'));
}

async function sendDesviosReport() {
    const selected = _getSelectedDesvios();
    if (!selected.length) { showNotification('Seleccioná al menos un desvío', 'warning'); return; }

    const recipientInput = document.getElementById('desviosRecipient');
    const recipients = (recipientInput?.value || '')
        .split(/[,;\s]+/).map(s => s.trim()).filter(s => s.includes('@'));
    if (!recipients.length) { showNotification('Ingresá al menos un email destinatario', 'warning'); return; }

    const btn = document.getElementById('btnEnviarDesvios');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

    try {
        const resp = await fetch('/api/notify-desvios', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                desvios:     selected,
                recipients,
                projectName: [document.getElementById('empresa')?.value, document.getElementById('nombreSistema')?.value].filter(Boolean).join(' — '),
                executor:    document.getElementById('ejecutor')?.value || '',
            })
        });
        const data = await resp.json();
        if (data.warn) {
            showNotification(data.warn, 'warning');
        } else {
            showNotification(`Reporte enviado a ${data.sent} destinatario(s)`, 'success');
            document.getElementById('modalDesvios').style.display = 'none';
        }
    } catch (e) {
        showNotification('Error al enviar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Enviar por email'; }
    }
}
