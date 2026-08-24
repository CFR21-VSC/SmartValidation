/* ====================================================================
   PROJECTS MANAGER — gestor de multi-proyecto (DRP Validation Suite)

   Permite tener múltiples proyectos almacenados simultáneamente y
   switchear entre ellos sin perder datos. Cada proyecto guarda un
   "snapshot" completo (systemInfo + protocols + groups + tests +
   packageDocs + projectData + executor) que se hidrata en memoria
   cuando se abre.

   Arquitectura:
     - El proyecto ACTIVO vive replicado en localStorage `vscTestsData_v3`
       (igual que hoy). Así el resto del código (loadFromStorage,
       saveToStorage) no necesita cambios.
     - El catálogo de proyectos vive en IndexedDB `GestorEvidenciasProjectsDB`
       store `projects` con sus snapshots completos.
     - Las imágenes (IndexedDB `images` store) son COMPARTIDAS entre todos
       los proyectos. testIds son globalmente únicos → no colisionan.
     - Switch entre proyectos = save current → write target snapshot →
       window.location.reload(). Sencillo y bulletproof.

   API:
     VS.projects.bootstrap()                  → en DOMContentLoaded
     VS.projects.listAll({ archived })        → array
     VS.projects.get(id)                      → entry | null
     VS.projects.getActiveId() / setActiveId  → activo actual
     VS.projects.getActive()                  → entry activo
     VS.projects.saveCurrentToActive()        → snapshot in-memory → DB
     VS.projects.switchTo(id)                 → guarda current y abre target (reloads)
     VS.projects.createNew({name, blank})     → nuevo (reloads)
     VS.projects.duplicate(id, {name})        → clona (reloads al nuevo)
     VS.projects.rename(id, name)
     VS.projects.archive(id, archived)        → toggle archivado
     VS.projects.deleteProject(id)            → borrar + cleanup imágenes
     VS.projects.exportProject(id)            → descarga JSON
     VS.projects.importProject(data)          → importa desde JSON (reloads)
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.projects = VS.projects || {};

    const DB_NAME = 'GestorEvidenciasProjectsDB';
    const DB_VERSION = 1;
    const STORE = 'projects';
    const ACTIVE_ID_KEY = 'vscActiveProjectId';
    const SNAPSHOT_KEY = 'vscTestsData_v3'; // matchea localStorage del gestor

    // ────────────────────────────────────────────────────────────────────
    // SEED del paquete al crear un proyecto nuevo:
    //   Cinco docs upstream (los que generan trazabilidad cruzada en la
    //   matriz URS↔RA↔TC) se cargan vacíos automáticamente, así el usuario
    //   no tiene que ir a "Cargar Paquete" como primer paso. Los protocolos
    //   PIQ/POQ/PPQ se generan después porque dependen de URS+RA.
    // ────────────────────────────────────────────────────────────────────
    const SEED_TEMPLATES = [
        { name: 'hlra-template-vacio', label: 'HLRA' },
        { name: 'vp-template-vacio',   label: 'VP' },
        { name: 'urs-template-vacio',  label: 'URS' },
        { name: 'ra-template-vacio',   label: 'RA' },
        { name: 'ira-template-vacio',  label: 'IRA' }
    ];

    /** Carga los 5 templates vacíos y devuelve un array packageDocs[]. */
    async function loadSeedPackage() {
        const docs = [];
        for (const tpl of SEED_TEMPLATES) {
            try {
                const r = await fetch('js/validation-suite/fixtures/' + tpl.name + '.json');
                if (!r.ok) {
                    console.warn('[projects] seed template no encontrado:', tpl.name);
                    continue;
                }
                const data = await r.json();
                if (!data || !data.type) {
                    console.warn('[projects] seed sin type:', tpl.name);
                    continue;
                }
                docs.push({
                    type: data.type,
                    code: (data.document && data.document.code) || data.type + '-NEW',
                    version: (data.document && data.document.version) || '1.0',
                    title: (data.document && data.document.titleEs) || data.type,
                    data: data,
                    fileName: tpl.name + '.json',
                    loadedAt: new Date().toISOString()
                });
            } catch (e) {
                console.warn('[projects] seed fetch falló:', tpl.name, e);
            }
        }
        return docs;
    }

    // ====================================================================
    // INDEXEDDB
    // ====================================================================
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const s = db.createObjectStore(STORE, { keyPath: 'id' });
                    s.createIndex('byArchived', 'archived', { unique: false });
                    s.createIndex('byLastOpened', 'lastOpenedAt', { unique: false });
                }
            };
        });
    }

    async function dbGet(id) {
        const db = await openDB();
        try {
            return await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readonly');
                const r = tx.objectStore(STORE).get(id);
                r.onsuccess = () => res(r.result || null);
                r.onerror = () => rej(r.error);
            });
        } finally { db.close(); }
    }

    async function dbPut(entry) {
        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(entry);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally { db.close(); }
        return entry;
    }

    async function dbDelete(id) {
        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(id);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally { db.close(); }
    }

    async function dbListAll() {
        const db = await openDB();
        try {
            return await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readonly');
                const items = [];
                const cur = tx.objectStore(STORE).openCursor();
                cur.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) { items.push(c.value); c.continue(); }
                    else res(items);
                };
                cur.onerror = () => rej(cur.error);
            });
        } finally { db.close(); }
    }

    // ====================================================================
    // SNAPSHOT helpers (localStorage)
    // ====================================================================
    function readCurrentSnapshot() {
        try {
            const s = localStorage.getItem(SNAPSHOT_KEY);
            return s ? JSON.parse(s) : null;
        } catch (e) { return null; }
    }

    function writeSnapshot(snap) {
        if (snap == null) {
            localStorage.removeItem(SNAPSHOT_KEY);
        } else {
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
        }
    }

    function getActiveId() {
        return localStorage.getItem(ACTIVE_ID_KEY) || null;
    }
    function setActiveId(id) {
        if (id) localStorage.setItem(ACTIVE_ID_KEY, id);
        else localStorage.removeItem(ACTIVE_ID_KEY);
    }

    // ====================================================================
    // DERIVADOS — stats a partir del snapshot
    // ====================================================================
    function computeStats(snapshot) {
        if (!snapshot) return { tests: 0, evidences: 0, protocols: 0, packageDocs: 0, sizeKB: 0 };
        const tests = snapshot.tests || [];
        const evidences = tests.reduce((s, t) =>
            s + (t.evidences || []).filter(e => e && !e.isEmpty).length, 0);
        let sizeKB = 0;
        try {
            sizeKB = Math.round(JSON.stringify(snapshot).length / 1024);
        } catch (e) {}
        return {
            tests: tests.length,
            evidences,
            protocols: (snapshot.protocols || []).length,
            packageDocs: (snapshot.packageDocs || []).length,
            sizeKB
        };
    }

    function refreshFromSnapshot(entry, snapshot) {
        const si = (snapshot && snapshot.systemInfo) || {};
        return Object.assign({}, entry, {
            cliente: si.cliente || entry.cliente || '',
            sistemaCode: si.codigoSistema || entry.sistemaCode || '',
            sistemaName: si.nombreSistema || entry.sistemaName || '',
            gampCat: si.categoriaGamp || entry.gampCat || '',
            stats: computeStats(snapshot)
        });
    }

    // ====================================================================
    // OPERACIONES PRINCIPALES
    // ====================================================================

    /** Snapshot del estado actual → entry del proyecto activo. */
    async function saveCurrentToActive() {
        const id = getActiveId();
        if (!id) return null;
        const snapshot = readCurrentSnapshot();
        let entry = await dbGet(id);
        if (!entry) return null;
        entry.snapshot = snapshot;
        entry.lastOpenedAt = new Date().toISOString();
        entry = refreshFromSnapshot(entry, snapshot);
        await dbPut(entry);
        // Write-through: non-blocking backup to server SQLite
        if (global.VS && global.VS.Storage) global.VS.Storage.syncSnapshot(id, snapshot, entry.name);
        return entry;
    }

    /** Rehidrata los packageDocs de un snapshot descargado del servidor.
     *  El servidor guarda snapshot_json sin el campo `data` de cada doc para ahorrar espacio.
     *  Los docs completos están en la tabla documents — los re-fetcheamos en paralelo
     *  y reinyectamos `data` para que el snapshot quede idéntico al original. */
    async function _rehydratePackageDocs(projectId, snapshot) {
        const pkgDocs = snapshot.packageDocs || [];
        if (pkgDocs.length === 0 || !global.VS || !global.VS.Storage || !global.VS.Storage.getDocument) return;
        const promises = pkgDocs.map(async (doc) => {
            const docType = doc.type || doc.docType;
            if (!docType) return doc;
            try {
                const full = await global.VS.Storage.getDocument(projectId, docType);
                if (full && full.json_data) {
                    const parsed = typeof full.json_data === 'string'
                        ? JSON.parse(full.json_data) : full.json_data;
                    return Object.assign({}, doc, { data: parsed.data || parsed });
                }
            } catch (e) {
                console.warn('[projects] rehidratación falló para', docType, e);
            }
            return doc;
        });
        snapshot.packageDocs = await Promise.all(promises);
    }

    /** Descarga el snapshot de un proyecto desde el servidor y lo hidrata en IndexedDB. */
    async function downloadFromServer(id) {
        if (!global.VS || !global.VS.Storage) throw new Error('Storage no disponible');
        const snapshot = await global.VS.Storage.getSnapshot(id);
        if (!snapshot) throw new Error('Proyecto no disponible en el servidor');
        await _rehydratePackageDocs(id, snapshot);
        const si = (snapshot.systemInfo) || {};
        const existing = await dbGet(id);
        const entry = existing || {
            id,
            name: si.nombreSistema || si.projectName || 'Proyecto restaurado',
            cliente: si.cliente || '',
            sistemaCode: si.codigoSistema || '',
            sistemaName: si.nombreSistema || '',
            gampCat: si.categoriaGamp || '',
            createdAt: new Date().toISOString(),
            archived: false,
        };
        entry.snapshot = snapshot;
        entry.lastOpenedAt = new Date().toISOString();
        const updated = refreshFromSnapshot(entry, snapshot);
        await dbPut(updated);
        // Registrar cuándo bajamos del server → el banner "hay cambios" compara contra esto
        try { localStorage.setItem(`_serverSyncFrom_${id}`, String(Date.now() / 1000)); } catch (_) {}
        return updated;
    }

    /** Carga el snapshot del proyecto target en localStorage y recarga la página. */
    async function switchTo(id) {
        const currentId = getActiveId();
        if (currentId && currentId !== id) {
            try { await saveCurrentToActive(); }
            catch (e) { console.warn('[projects] save current falló:', e); }
        }
        let target = await dbGet(id);
        // Si no está en IndexedDB local, intentar recuperarlo del servidor
        if (!target && global.VS && global.VS.Storage) {
            try { target = await downloadFromServer(id); }
            catch (e) { console.warn('[projects] downloadFromServer falló:', e); }
        }
        if (!target) throw new Error('Proyecto no encontrado: ' + id);
        writeSnapshot(target.snapshot || null);
        setActiveId(id);
        target.lastOpenedAt = new Date().toISOString();
        await dbPut(target);
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('SUITE_PROJECT_OPEN', 'project', id, {
                name: target.name, cliente: target.cliente, sistemaCode: target.sistemaCode
            }, 'Abrir proyecto: ' + target.name);
        }
        // Reload garantiza que TODA la app re-inicialice con los nuevos datos
        window.location.reload();
    }

    /** Crea un nuevo proyecto con packageDocs vacío.
     *  Los documentos se generan via AI Generator. */
    async function createNew(opts) {
        opts = opts || {};
        const name = (opts.name || '').trim() || 'Proyecto sin nombre';
        const currentId = getActiveId();
        if (currentId) {
            try { await saveCurrentToActive(); }
            catch (e) { console.warn('[projects] save current falló:', e); }
        }

        const seedDocs = [];

        const id = 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const blankSnapshot = {
            version: '3.0',
            storageMethod: 'indexeddb',
            systemInfo: opts.systemInfo || {
                empresa: '', cliente: '', nombreSistema: '', codigoSistema: '',
                versionSistema: '', categoriaGamp: '', tipoSistema: '', proveedor: '',
                revisor: '', aprobador: '', auditor: '',
                fechaInicio: '', fechaCierre: '', notasProyecto: ''
            },
            executor: '',
            protocols: [],
            groups: [],
            tests: [],
            projectData: { finalized: false, conclusion: '', resultado: '' },
            packageDocs: seedDocs,
            lastSaved: new Date().toISOString()
        };
        let entry = {
            id, name,
            cliente: '', sistemaCode: '', sistemaName: '', gampCat: '',
            createdAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
            storagePath: opts.storagePath || null,
            hasFolderHandle: !!opts.folderHandle,
            snapshot: blankSnapshot,
            stats: computeStats(blankSnapshot)
        };
        entry = refreshFromSnapshot(entry, blankSnapshot);
        await dbPut(entry);

        // Si el usuario eligió una carpeta, guardamos el handle con el ID real del proyecto
        // (antes del reload, porque los handles de FS API viven en IndexedDB, no localStorage).
        if (opts.folderHandle && global.ValidationSuite && global.ValidationSuite.ProjectFolderFS) {
            try {
                await global.ValidationSuite.ProjectFolderFS.saveHandle(id, opts.folderHandle);
                // El handle temporal __pending__ ya no sirve, lo borramos
                await global.ValidationSuite.ProjectFolderFS.clearHandle('__pending__');
            } catch (e) {
                console.warn('[projects] No se pudo guardar el folder handle:', e);
            }
        }

        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('SUITE_PROJECT_CREATE', 'project', id, { name }, 'Nuevo proyecto: ' + name);
        }
        // Sincronizar al servidor antes del reload para que aparezca en todos los navegadores
        if (global.VS && global.VS.Storage) {
            try { await global.VS.Storage.syncSnapshot(id, blankSnapshot, name); } catch (_) {}
        }
        // Switch al nuevo proyecto
        writeSnapshot(blankSnapshot);
        setActiveId(id);
        window.location.reload();
    }

    /** Duplica un proyecto existente (mantiene contenido, nuevo id + nombre). */
    async function duplicate(id, opts) {
        opts = opts || {};
        const src = await dbGet(id);
        if (!src) throw new Error('Proyecto no encontrado');
        const newId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const newName = (opts.name || src.name + ' (copia)').trim();
        const copy = Object.assign({}, src, {
            id: newId,
            name: newName,
            createdAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
            // Snapshot se duplica tal cual; testIds quedan iguales (puede causar
            // colisión de imágenes si se editan ambos proyectos a la vez, pero
            // como NO se pueden editar dos a la vez (es modelo single-active),
            // este caso solo surge si el usuario abre la copia y modifica algo.
            // Para esa fase, generamos nuevos testIds al duplicar.
            snapshot: regenerateTestIds(src.snapshot)
        });
        await dbPut(copy);
        if (global.VS && global.VS.Storage && copy.snapshot) {
            try { await global.VS.Storage.syncSnapshot(newId, copy.snapshot, copy.name); } catch (_) {}
        }
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('SUITE_PROJECT_DUPLICATE', 'project', newId, {
                sourceId: id, sourceName: src.name, newName
            }, 'Duplicar proyecto: ' + src.name + ' → ' + newName);
        }
        return copy;
    }

    /** Re-asigna testIds en el snapshot para evitar conflictos de imágenes. */
    function regenerateTestIds(snapshot) {
        if (!snapshot || !snapshot.tests) return snapshot;
        const copy = JSON.parse(JSON.stringify(snapshot));
        copy.tests = copy.tests.map(t => Object.assign({}, t, {
            id: 'test_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)
        }));
        return copy;
    }

    async function rename(id, name) {
        const entry = await dbGet(id);
        if (!entry) throw new Error('Proyecto no encontrado');
        entry.name = String(name || '').trim() || entry.name;
        await dbPut(entry);
        return entry;
    }

    async function archive(id, archived) {
        const entry = await dbGet(id);
        if (!entry) throw new Error('Proyecto no encontrado');
        entry.archived = !!archived;
        await dbPut(entry);
        return entry;
    }

    /** Borrado de proyecto. Si era el activo, queda sin activo y se vacía localStorage. */
    async function deleteProject(id) {
        const entry = await dbGet(id);
        if (!entry) return;
        const wasActive = (getActiveId() === id);
        // (Imágenes huérfanas quedan en el `images` store — cleanup futuro.)
        await dbDelete(id);
        if (wasActive) {
            writeSnapshot(null);
            setActiveId(null);
        }
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('SUITE_PROJECT_DELETE', 'project', id, {
                name: entry.name, wasActive
            }, 'Eliminar proyecto: ' + entry.name);
        }
    }

    /** Descarga el proyecto como JSON portable. */
    async function exportProject(id) {
        const entry = await dbGet(id);
        if (!entry) throw new Error('Proyecto no encontrado');
        const payload = {
            version: '1.0',
            type: 'drp-assurance-project',
            exportedAt: new Date().toISOString(),
            project: {
                id: entry.id,
                name: entry.name,
                cliente: entry.cliente, sistemaCode: entry.sistemaCode,
                sistemaName: entry.sistemaName, gampCat: entry.gampCat,
                createdAt: entry.createdAt,
                snapshot: entry.snapshot
            }
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = String(entry.name).replace(/[^\w\-]+/g, '_').substring(0, 60);
        a.href = url;
        a.download = `Proyecto_${safeName}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
        return entry;
    }

    /** Importa desde JSON (formato exportado arriba). Crea nuevo id, no pisa nada. */
    async function importProject(data) {
        if (!data || data.type !== 'drp-assurance-project' || !data.project) {
            throw new Error('Archivo JSON no es un proyecto DRP exportado.');
        }
        const src = data.project;
        const newId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const entry = {
            id: newId,
            name: src.name + ' (importado)',
            cliente: src.cliente || '',
            sistemaCode: src.sistemaCode || '',
            sistemaName: src.sistemaName || '',
            gampCat: src.gampCat || '',
            createdAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
            snapshot: regenerateTestIds(src.snapshot),
            stats: computeStats(src.snapshot)
        };
        await dbPut(entry);
        // Sincronizar al servidor para que sea visible desde todos los navegadores
        if (global.VS && global.VS.Storage && entry.snapshot) {
            try { await global.VS.Storage.syncSnapshot(newId, entry.snapshot, entry.name); } catch (_) {}
        }
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('SUITE_PROJECT_IMPORT', 'project', newId, {
                name: entry.name, sourceName: src.name
            }, 'Importar proyecto: ' + entry.name);
        }
        return entry;
    }

    // ====================================================================
    // BOOTSTRAP — migrar datos existentes al modelo multi-proyecto
    // ====================================================================
    async function bootstrap() {
        try {
            const activeId = getActiveId();
            if (activeId) {
                let proj = await dbGet(activeId);
                if (proj) {
                    // Si el demo activo tiene snapshot viejo (sin protocolos), reconstruir
                    // y reescribir vscTestsData_v3 ANTES de que loadFromStorage lo lea.
                    if (activeId === DEMO_PROJECT_ID &&
                        (!proj.snapshot || !Array.isArray(proj.snapshot.protocols) ||
                         proj.snapshot.protocols.length === 0)) {
                        console.info('[projects-demo] Reconstruyendo demo (sin protocolos)...');
                        proj = await ensureDemoProject();
                        writeSnapshot(proj.snapshot);
                    } else {
                        // Proyecto normal — reescribir snapshot en localStorage para que
                        // loadFromStorage() lea datos frescos desde IndexedDB (no localStorage stale)
                        if (proj.snapshot) writeSnapshot(proj.snapshot);
                        ensureDemoProject().catch(e => console.warn('[projects-demo] ensure falló:', e));
                    }
                    return proj;
                }
                // IndexedDB vacía para este activeId — intentar recuperar snapshot del servidor
                if (global.VS && global.VS.Storage) {
                    try {
                        const snapshot = await global.VS.Storage.getSnapshot(activeId);
                        if (snapshot) {
                            await _rehydratePackageDocs(activeId, snapshot);
                            const sysInfo = snapshot.systemInfo || {};
                            let entry = {
                                id: activeId,
                                name: sysInfo.projectName || sysInfo.nombre || sysInfo.nombreSistema || 'Proyecto restaurado',
                                cliente: sysInfo.client || sysInfo.cliente || '',
                                sistemaCode: sysInfo.systemCode || sysInfo.codigoSistema || '',
                                sistemaName: sysInfo.systemName || sysInfo.nombreSistema || '',
                                gampCat: sysInfo.gampCategory || sysInfo.categoriaGamp || '',
                                createdAt: new Date().toISOString(),
                                lastOpenedAt: new Date().toISOString(),
                                archived: false,
                                snapshot,
                                stats: computeStats(snapshot),
                            };
                            entry = refreshFromSnapshot(entry, snapshot);
                            await dbPut(entry);
                            writeSnapshot(snapshot);
                            console.info('[projects] Proyecto restaurado desde servidor:', activeId);
                            ensureDemoProject().catch(() => {});
                            return entry;
                        }
                    } catch (e) {
                        console.warn('[projects] No se pudo recuperar snapshot del servidor:', e);
                    }
                }
                setActiveId(null); // stale
            }
            // Sin proyecto activo — garantizar demo en background
            ensureDemoProject().catch(e => console.warn('[projects-demo] ensure falló:', e));
            // No hay proyecto activo. Si hay snapshot en localStorage, migrar.
            const snapshot = readCurrentSnapshot();
            const hasData = snapshot && (
                (snapshot.tests || []).length > 0 ||
                (snapshot.packageDocs || []).length > 0 ||
                (snapshot.protocols || []).length > 0
            );
            if (hasData) {
                const sistemaName = (snapshot.systemInfo && snapshot.systemInfo.nombreSistema) || '';
                const baseName = sistemaName ? `Proyecto inicial — ${sistemaName}` : 'Proyecto inicial';
                const id = 'proj_initial_' + Date.now();
                let entry = {
                    id,
                    name: baseName,
                    cliente: '', sistemaCode: '', sistemaName: '', gampCat: '',
                    createdAt: new Date().toISOString(),
                    lastOpenedAt: new Date().toISOString(),
                    archived: false,
                    snapshot,
                    stats: computeStats(snapshot)
                };
                entry = refreshFromSnapshot(entry, snapshot);
                await dbPut(entry);
                setActiveId(id);
                console.info('[projects] Proyecto inicial creado por migración:', baseName);
                return entry;
            }
            // Sin datos locales — consultar el servidor por proyectos existentes (cross-browser sync)
            if (global.VS && global.VS.Storage) {
                try {
                    const serverProjects = await global.VS.Storage.listProjects();
                    if (serverProjects && serverProjects.length > 0) {
                        const real = serverProjects
                            .filter(p => p.id !== DEMO_PROJECT_ID)
                            .sort((a, b) => (b.updated_at || b.last_opened_at || 0) - (a.updated_at || a.last_opened_at || 0));
                        if (real.length > 0) {
                            try {
                                const entry = await downloadFromServer(real[0].id);
                                setActiveId(entry.id);
                                writeSnapshot(entry.snapshot);
                                console.info('[projects] Auto-sync: proyecto descargado del servidor:', entry.name);
                                return entry;
                            } catch (e) {
                                console.warn('[projects] Auto-sync downloadFromServer falló:', e);
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[projects] Auto-sync listProjects falló:', e);
                }
            }
            return null;
        } catch (e) {
            console.error('[projects] bootstrap falló:', e);
            return null;
        }
    }

    async function getActive() {
        const id = getActiveId();
        if (!id) return null;
        return await dbGet(id);
    }

    // ====================================================================
    // PROYECTO DEMO — fijo, reservado, autoseed con paquete DRP-SIS-001
    // ====================================================================

    const DEMO_PROJECT_ID = '__demo_drp_sis_001__';
    const DEMO_FIXTURES = [
        'hlra-drp-sis-001', 'vp-drp-sis-001', 'urs-drp-sis-001',
        'ra-drp-sis-001', 'ira-drp-sis-001', 'rrm-drp-sis-001',
        'mtr-drp-sis-001', 'piq-drp-sis-001', 'iiq-drp-sis-001',
        'riq-drp-sis-001', 'poq-drp-sis-001', 'ioq-drp-sis-001',
        'ncr-drp-sis-001', 'roq-drp-sis-001', 'ppq-drp-sis-001',
        'ipq-drp-sis-001', 'rpq-drp-sis-001', 'vsr-drp-sis-001',
        'aex-drp-sis-001', 'people-drp-sis-001'
    ];

    /** Carga los 20 fixtures del demo como packageDocs[]. */
    async function loadDemoFixtures() {
        const docs = [];
        for (const code of DEMO_FIXTURES) {
            try {
                const r = await fetch('js/validation-suite/fixtures/' + code + '.json');
                if (!r.ok) { console.warn('[projects-demo] no encontrado:', code); continue; }
                const data = await r.json();
                if (!data || !data.type) { console.warn('[projects-demo] sin type:', code); continue; }
                docs.push({
                    type: data.type,
                    code: (data.document && data.document.code) || data.type + '-DEMO',
                    version: (data.document && data.document.version) || '1.0',
                    title: (data.document && data.document.titleEs) || data.type,
                    data: data,
                    fileName: code + '.json',
                    loadedAt: new Date().toISOString()
                });
            } catch (e) { console.warn('[projects-demo] fetch falló:', code, e); }
        }
        return docs;
    }

    /** Construye el snapshot del proyecto demo desde cero. */
    async function buildDemoSnapshot() {
        const packageDocs = await loadDemoFixtures();

        // Cargar protocolos IQ/OQ/PQ desde el fixture de evidencias
        let protocols = [], groups = [], tests = [];
        try {
            const resp = await fetch('js/validation-suite/fixtures/evidence-iq-demo.json');
            if (resp.ok) {
                const ev = await resp.json();
                protocols = Array.isArray(ev.protocols) ? ev.protocols : [];
                groups    = Array.isArray(ev.groups)    ? ev.groups    : [];
                tests     = Array.isArray(ev.tests)     ? ev.tests     : [];
            }
        } catch (_) { /* sin conexión o archivo faltante — demo funciona sin evidencias */ }

        return {
            version: '3.0',
            storageMethod: 'indexeddb',
            systemInfo: {
                empresa: 'DRP Assurance Solutions',
                cliente: 'DRP Assurance Solutions',
                nombreSistema: 'DRP-GAMP Categorizador',
                codigoSistema: 'DRP-SIS-001',
                versionSistema: '1.1',
                categoriaGamp: 'GAMP 3',
                tipoSistema: 'Web SaaS',
                proveedor: 'DRP Assurance Solutions',
                revisor: '', aprobador: '', auditor: '',
                fechaInicio: '', fechaCierre: '',
                notasProyecto: 'Proyecto DEMO — paquete pre-cargado del ciclo de validación completo DRP-SIS-001 (20 docs + protocolos IQ/OQ/PQ). Editable y firmable como cualquier proyecto, sin contaminar tus proyectos reales.'
            },
            executor: 'Federico Bongiovanni',
            protocols: protocols,
            groups:    groups,
            tests:     tests,
            projectData: { finalized: false, conclusion: '', resultado: '' },
            packageDocs: packageDocs,
            lastSaved: new Date().toISOString()
        };
    }

    /** Crea (si no existe) el proyecto demo reservado. Idempotente.
     *  Si existe pero no tiene protocolos (snapshot viejo), lo reconstruye. */
    async function ensureDemoProject() {
        const existing = await dbGet(DEMO_PROJECT_ID);
        const hasProtocols = existing && existing.snapshot &&
            Array.isArray(existing.snapshot.protocols) &&
            existing.snapshot.protocols.length > 0;
        if (existing && hasProtocols) return existing;
        if (existing) await dbDelete(DEMO_PROJECT_ID);
        const snapshot = await buildDemoSnapshot();
        const entry = {
            id: DEMO_PROJECT_ID,
            name: '⭐ Demo DRP-SIS-001 (pre-cargado)',
            cliente: 'DRP Assurance Solutions',
            sistemaCode: 'DRP-SIS-001',
            sistemaName: 'DRP-GAMP Categorizador',
            gampCat: 'GAMP 3',
            createdAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
            isDemo: true,
            snapshot: snapshot,
            stats: computeStats(snapshot)
        };
        await dbPut(refreshFromSnapshot(entry, snapshot));
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('SUITE_PROJECT_CREATE', 'project', DEMO_PROJECT_ID,
                { name: entry.name, demo: true }, 'Proyecto demo auto-creado');
        }
        return entry;
    }

    /** Abre el proyecto demo. Siempre reconstruye desde fixtures para garantizar
     *  que los 20 docs (incluye OQ/PQ/PPQ) estén presentes y actualizados. */
    async function openDemo() {
        await dbDelete(DEMO_PROJECT_ID);
        await ensureDemoProject();
        await switchTo(DEMO_PROJECT_ID);
    }

    /** Borra el proyecto demo y lo recrea desde fixtures. Útil cuando el demo
     *  quedó modificado por pruebas y se quiere volver al estado canónico. */
    async function resetDemo() {
        const currentId = getActiveId();
        await dbDelete(DEMO_PROJECT_ID);
        await ensureDemoProject();
        if (currentId === DEMO_PROJECT_ID) {
            await switchTo(DEMO_PROJECT_ID);
        }
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    /** Sube el snapshot actual al servidor y devuelve {ok, name} o lanza error. */
    async function forceSyncToServer() {
        const id = getActiveId();
        if (!id) throw new Error('No hay proyecto activo');
        const entry = await saveCurrentToActive();
        if (!entry) throw new Error('No se pudo guardar localmente');
        if (!global.VS || !global.VS.Storage) throw new Error('Servidor no disponible');
        const snapshot = entry.snapshot || (readCurrentSnapshot && readCurrentSnapshot()) || {};
        const r = await global.VS.Storage.syncSnapshot(id, snapshot, entry.name);
        if (!r || !r.data || !r.data.ok) throw new Error('El servidor rechazó el snapshot');
        return { ok: true, name: entry.name };
    }

    VS.projects.bootstrap = bootstrap;
    VS.projects.listAll = async function ({ archived } = {}) {
        const all = await dbListAll();
        if (typeof archived === 'boolean') {
            return all.filter(p => !!p.archived === archived);
        }
        return all;
    };
    VS.projects.get = dbGet;
    VS.projects.getActiveId = getActiveId;
    VS.projects.getActive = getActive;
    VS.projects.saveCurrentToActive = saveCurrentToActive;
    VS.projects.switchTo = switchTo;
    VS.projects.createNew = createNew;
    VS.projects.duplicate = duplicate;
    VS.projects.rename = rename;
    VS.projects.archive = archive;
    VS.projects.deleteProject = deleteProject;
    VS.projects.downloadFromServer = downloadFromServer;
    VS.projects.forceSyncToServer = forceSyncToServer;
    VS.projects.exportProject = exportProject;
    VS.projects.importProject = importProject;
    VS.projects.computeStats = computeStats;
    VS.projects.openDemo = openDemo;
    VS.projects.ensureDemoProject = ensureDemoProject;
    VS.projects.resetDemo = resetDemo;
    VS.projects.DEMO_PROJECT_ID = DEMO_PROJECT_ID;

})(window);
