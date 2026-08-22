'use strict';

/* ====================================================================
   PROJECT FOLDER FS
   Carpetas físicas por proyecto usando la File System Access API.
   Los handles (FileSystemDirectoryHandle) se persisten en IndexedDB
   porque son objetos estructurados que no caben en localStorage.

   Estructura de carpeta:
     {carpeta-elegida}/{nombre-proyecto}/
       ai-docs/   → HLRA.json, VP.json, URS.json ...
       fuente/    → documento fuente subido al AI Generator
       fotos/     → evidencias capturadas desde celular
       exports/   → ZIPs Tomo III, PDFs Libro de Validación
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};

    const FS_DB_NAME    = 'GestorEvidenciasFSHandles';
    const FS_DB_VERSION = 1;
    const FS_STORE      = 'handles';
    const SUBFOLDERS    = ['ai-docs', 'fuente', 'fotos', 'exports'];

    // ── IndexedDB para handles ────────────────────────────────────────

    function _openFSDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(FS_DB_NAME, FS_DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(FS_STORE)) {
                    db.createObjectStore(FS_STORE, { keyPath: 'projectId' });
                }
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror  = e => reject(e.target.error);
        });
    }

    async function _saveHandle(projectId, handle) {
        const db = await _openFSDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(FS_STORE, 'readwrite');
            tx.objectStore(FS_STORE).put({ projectId, handle });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror    = () => { db.close(); reject(tx.error); };
        });
    }

    async function _loadHandle(projectId) {
        const db = await _openFSDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(FS_STORE, 'readonly');
            const req = tx.objectStore(FS_STORE).get(projectId);
            req.onsuccess = () => { db.close(); resolve(req.result ? req.result.handle : null); };
            req.onerror   = () => { db.close(); reject(req.error); };
        });
    }

    async function _deleteHandle(projectId) {
        const db = await _openFSDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(FS_STORE, 'readwrite');
            tx.objectStore(FS_STORE).delete(projectId);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror    = () => { db.close(); reject(tx.error); };
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────

    function _sanitizeName(name) {
        return (name || 'proyecto')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .trim()
            .slice(0, 60) || 'proyecto';
    }

    // ── API pública ───────────────────────────────────────────────────

    const ProjectFolderFS = {

        /** Devuelve true si el navegador soporta la File System Access API. */
        isSupported() {
            return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
        },

        /**
         * Abre el selector de carpeta del OS, crea la subcarpeta del proyecto
         * con las 4 subcarpetas estándar, y guarda el handle en IndexedDB.
         * @param {string} projectId
         * @param {string} projectName  — nombre legible para la carpeta física
         * @returns {{ handle: FileSystemDirectoryHandle, folderName: string }}
         */
        async pickAndSetup(projectId, projectName) {
            if (!this.isSupported()) {
                throw new Error('Tu navegador no soporta la selección de carpetas. Usá Chrome 86+.');
            }
            const folderName   = _sanitizeName(projectName);
            const parentHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
            const projHandle   = await parentHandle.getDirectoryHandle(folderName, { create: true });
            for (const sub of SUBFOLDERS) {
                await projHandle.getDirectoryHandle(sub, { create: true });
            }
            await _saveHandle(projectId, projHandle);
            return { handle: projHandle, folderName };
        },

        /**
         * Recupera el handle del proyecto y verifica/solicita permisos.
         * Devuelve null si no hay handle o el usuario deniega el permiso.
         */
        async getHandle(projectId) {
            const handle = await _loadHandle(projectId);
            if (!handle) return null;
            try {
                let perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted') {
                    perm = await handle.requestPermission({ mode: 'readwrite' });
                }
                return perm === 'granted' ? handle : null;
            } catch (_) {
                return null;
            }
        },

        /** Guarda el handle directamente (usado por createNew antes del reload). */
        async saveHandle(projectId, handle) {
            await _saveHandle(projectId, handle);
        },

        /** Devuelve true si existe un handle guardado (sin pedir permiso). */
        async hasHandle(projectId) {
            const h = await _loadHandle(projectId);
            return !!h;
        },

        /** Elimina el handle guardado para el proyecto. */
        async clearHandle(projectId) {
            await _deleteHandle(projectId);
        },

        /**
         * Escribe un archivo en una subcarpeta del proyecto.
         * @param {string} projectId
         * @param {'ai-docs'|'fuente'|'fotos'|'exports'} subfolder
         * @param {string} filename
         * @param {string|Blob|BufferSource} content
         */
        async writeFile(projectId, subfolder, filename, content) {
            const projHandle = await this.getHandle(projectId);
            if (!projHandle) throw new Error('No hay carpeta configurada para este proyecto, o el permiso fue denegado.');
            const dirHandle  = await projHandle.getDirectoryHandle(subfolder, { create: true });
            const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
            const writable   = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        },

        /** Escribe un documento AI generado en ai-docs/{docType}.json */
        async writeAIDoc(projectId, docType, jsonObj) {
            await this.writeFile(projectId, 'ai-docs', `${docType.toUpperCase()}.json`, JSON.stringify(jsonObj, null, 2));
        },

        /** Elimina un documento AI de ai-docs/{docType}.json. No falla si no existe. */
        async deleteAIDoc(projectId, docType) {
            const projHandle = await this.getHandle(projectId);
            if (!projHandle) return;
            try {
                const dirHandle = await projHandle.getDirectoryHandle('ai-docs');
                await dirHandle.removeEntry(`${docType.toUpperCase()}.json`);
            } catch (_) { /* archivo inexistente — ignorar */ }
        },

        /** Escribe el documento fuente en fuente/{filename} */
        async writeSourceDoc(projectId, filename, blob) {
            await this.writeFile(projectId, 'fuente', filename, blob);
        },

        /**
         * Lee un archivo de una subcarpeta del proyecto.
         * Retorna el contenido como string, o null si no existe o no hay permiso.
         */
        async readFile(projectId, subfolder, filename) {
            const projHandle = await this.getHandle(projectId);
            if (!projHandle) return null;
            try {
                const dirHandle  = await projHandle.getDirectoryHandle(subfolder);
                const fileHandle = await dirHandle.getFileHandle(filename);
                const file       = await fileHandle.getFile();
                return await file.text();
            } catch (_) {
                return null;
            }
        },

        /**
         * Escanea ai-docs/ y devuelve todos los JSON válidos encontrados.
         * Retorna array de { docType, filename, json } para cada archivo leído.
         * docType es el nombre del archivo sin extensión en minúsculas (ej: 'piq').
         */
        async scanAIDocs(projectId) {
            const projHandle = await this.getHandle(projectId);
            if (!projHandle) return [];
            let dirHandle;
            try {
                dirHandle = await projHandle.getDirectoryHandle('ai-docs');
            } catch (_) {
                return [];
            }
            const results = [];
            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
                try {
                    const file = await handle.getFile();
                    const text = await file.text();
                    const json = JSON.parse(text);
                    const docType = name.replace(/\.json$/i, '').toLowerCase();
                    // Ignorar wizard-state u otros archivos internos
                    if (docType === 'wizard-state') continue;
                    results.push({ docType, filename: name, json });
                } catch (_) {
                    // JSON inválido o lectura fallida — ignorar
                }
            }
            return results;
        },

        /**
         * Lee el texto del documento fuente desde fuente/.
         * Retorna { text, name } o null si no existe.
         */
        async readSourceDoc(projectId) {
            const projHandle = await this.getHandle(projectId);
            if (!projHandle) return null;
            try {
                const dirHandle = await projHandle.getDirectoryHandle('fuente');
                for await (const [name, handle] of dirHandle.entries()) {
                    if (handle.kind !== 'file') continue;
                    const file = await handle.getFile();
                    const text = await file.text();
                    if (text && text.trim()) return { text, name };
                }
            } catch (_) {}
            return null;
        },

        SUBFOLDERS,
    };

    VS.ProjectFolderFS = ProjectFolderFS;

})(typeof window !== 'undefined' ? window : global);
