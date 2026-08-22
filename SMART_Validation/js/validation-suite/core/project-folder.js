/* ====================================================================
   VALIDATION SUITE — PROJECT FOLDER (Fase C, storage layer)
   "Carpeta virtual" del proyecto persistida en IndexedDB.

   Cada entrada representa un doc archivado con su firma:
     {
       id          : "{pkgCode}|{type}|{code}|{version}",
       pkgCode, type, code, version,
       content     : JSON completo del doc,
       hash        : SHA-256 del JSON,
       signedBy    : nombre del firmante,
       signedAt    : timestamp ISO,
       sizeBytes   : tamaño del JSON serializado
     }

   API:
     VS.projectFolder.saveDoc(pkgCode, doc, signedBy) → entry
     VS.projectFolder.listAll(pkgCode?)               → entries[]
     VS.projectFolder.deleteEntry(id)                 → void
     VS.projectFolder.exportZip(pkgCode)              → { blob, fileName, manifest }

   Usa DB separada `ProjectFolderDB` para no mezclar con el storage del gestor.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.projectFolder = VS.projectFolder || {};

    const DB_NAME = 'ProjectFolderDB';
    const DB_VERSION = 1;
    const STORE = 'archivedDocs';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const s = db.createObjectStore(STORE, { keyPath: 'id' });
                    s.createIndex('byPkg', 'pkgCode', { unique: false });
                    s.createIndex('byType', ['pkgCode', 'type'], { unique: false });
                }
            };
        });
    }

    async function sha256Hex(text) {
        if (!global.crypto || !global.crypto.subtle) return null;
        try {
            const enc = new TextEncoder().encode(text);
            const buf = await global.crypto.subtle.digest('SHA-256', enc);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            console.warn('[project-folder] SHA-256 falló:', e);
            return null;
        }
    }

    function makeId(pkgCode, type, code, version) {
        return [pkgCode, type, code, version].join('|');
    }

    /** Guarda (o reemplaza) un doc en la carpeta del proyecto.
     *  signerMeta (opcional): { rol, signerId, iniciales, firmaImage, pinVerified }
     *  cuando proviene del modal PIN — habilita auditoría 21 CFR Part 11. */
    async function saveDoc(pkgCode, doc, signedBy, signerMeta) {
        if (!doc || !doc.type) throw new Error('Doc sin type — no se puede archivar.');
        const type = doc.type;
        const code = (doc.document && doc.document.code) || 'sin-codigo';
        const version = (doc.document && doc.document.version) || '1.0';
        const contentStr = JSON.stringify(doc);
        const hash = await sha256Hex(contentStr);
        const id = makeId(pkgCode || 'PKG', type, code, version);

        const meta = signerMeta || {};
        const entry = {
            id,
            pkgCode: pkgCode || 'PKG',
            type,
            code,
            version,
            content: doc,
            hash,
            signedBy: signedBy || 'Sin identificar',
            signedAt: new Date().toISOString(),
            sizeBytes: contentStr.length,
            // Metadata 21 CFR Part 11 (cuando la firma vino de openSignWithPinModal)
            signerRol: meta.rol || null,
            signerId: meta.signerId || null,
            signerIniciales: meta.iniciales || null,
            firmaImage: meta.firmaImage || null,
            pinVerified: !!meta.pinVerified
        };

        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(entry);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally {
            db.close();
        }
        return entry;
    }

    /** Lista todos los entries; opcionalmente filtrados por pkgCode. */
    async function listAll(pkgCode) {
        const db = await openDB();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const store = tx.objectStore(STORE);
                const items = [];
                const cursorReq = pkgCode
                    ? store.index('byPkg').openCursor(IDBKeyRange.only(pkgCode))
                    : store.openCursor();
                cursorReq.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) { items.push(c.value); c.continue(); }
                    else resolve(items);
                };
                cursorReq.onerror = () => reject(cursorReq.error);
            });
        } finally {
            db.close();
        }
    }

    async function getEntry(id) {
        const db = await openDB();
        try {
            return await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(id);
                req.onsuccess = () => res(req.result || null);
                req.onerror = () => rej(req.error);
            });
        } finally {
            db.close();
        }
    }

    async function deleteEntry(id) {
        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(id);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally {
            db.close();
        }
    }

    async function clearAll(pkgCode) {
        const entries = await listAll(pkgCode);
        for (const e of entries) await deleteEntry(e.id);
        return entries.length;
    }

    /** Exporta la carpeta como ZIP descargable. */
    async function exportZip(pkgCode) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip no está cargado.');
        const entries = await listAll(pkgCode);
        if (entries.length === 0) {
            throw new Error('No hay docs archivados en este paquete. Firmá al menos uno primero.');
        }

        const zip = new JSZip();
        const generated = new Date().toISOString();
        const manifest = {
            version: '1.0',
            pkgCode: pkgCode || 'PKG',
            generated,
            totalEntries: entries.length,
            byType: {},
            entries: []
        };

        entries.forEach(e => {
            const folder = `proyecto/${safeName(e.type)}/`;
            const baseName = `${safeName(e.code)}_v${safeName(e.version)}`;

            if (e.kind === 'attachment' && e.payload) {
                // Adjuntos binarios (PDF del Libro, ZIPs, etc.) — se guardan
                // con su filename original + sidecar JSON con metadata.
                const fileName = e.fileName || (baseName + '.bin');
                const attachPath = folder + fileName;
                const sigPath = folder + baseName + '.attachment.json';
                zip.file(attachPath, e.payload);
                zip.file(sigPath, JSON.stringify({
                    kind: 'attachment',
                    fileName,
                    mime: e.mime,
                    hash_sha256: e.hash,
                    attachedBy: e.signedBy,
                    attachedAt: e.signedAt,
                    sizeBytes: e.sizeBytes,
                    note: e.note || ''
                }, null, 2));
                manifest.byType[e.type] = (manifest.byType[e.type] || 0) + 1;
                manifest.entries.push({
                    id: e.id,
                    type: e.type, code: e.code, version: e.version,
                    kind: 'attachment',
                    fileName,
                    mime: e.mime,
                    hash: e.hash,
                    signedBy: e.signedBy, signedAt: e.signedAt,
                    sizeBytes: e.sizeBytes,
                    paths: { attachment: attachPath, metadata: sigPath }
                });
                return;
            }

            const docPath = folder + baseName + '.json';
            const sigPath = folder + baseName + '.signature.json';

            zip.file(docPath, JSON.stringify(e.content, null, 2));
            zip.file(sigPath, JSON.stringify({
                hash_sha256: e.hash,
                algorithm: 'SHA-256',
                signedBy: e.signedBy,
                signedAt: e.signedAt,
                doc: { type: e.type, code: e.code, version: e.version },
                sizeBytes: e.sizeBytes,
                verification: 'Recomputar SHA-256 sobre `' + docPath + '` y comparar contra `hash_sha256`.'
            }, null, 2));

            manifest.byType[e.type] = (manifest.byType[e.type] || 0) + 1;
            manifest.entries.push({
                id: e.id,
                type: e.type, code: e.code, version: e.version,
                hash: e.hash,
                signedBy: e.signedBy, signedAt: e.signedAt,
                sizeBytes: e.sizeBytes,
                paths: { document: docPath, signature: sigPath }
            });
        });

        zip.file('MANIFEST.json', JSON.stringify(manifest, null, 2));
        zip.file('README.txt', buildReadme(manifest));

        const blob = await zip.generateAsync({
            type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }
        });
        const fileName = `Proyecto_${safeName(pkgCode || 'PKG')}_${generated.split('T')[0]}.zip`;

        // Auto-descarga
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);

        return { blob, fileName, manifest };
    }

    function buildReadme(m) {
        const tipos = Object.entries(m.byType).map(([t, n]) => `  · ${t} (${n})`).join('\n');
        return [
            'CARPETA DEL PROYECTO — ARCHIVO FIRMADO',
            '═══════════════════════════════════════',
            '',
            `Paquete : ${m.pkgCode}`,
            `Generado: ${m.generated}`,
            `Total   : ${m.totalEntries} doc(s) firmado(s)`,
            '',
            'TIPOS ARCHIVADOS',
            '----------------',
            tipos,
            '',
            'ESTRUCTURA DEL ZIP',
            '------------------',
            '  README.txt',
            '  MANIFEST.json',
            '  proyecto/',
            '    {TYPE}/',
            '      {CODE}_v{VERSION}.json           — doc archivado',
            '      {CODE}_v{VERSION}.signature.json — firma + hash SHA-256',
            '',
            'PROPÓSITO',
            '---------',
            'Snapshot firmado del paquete documental. Cada doc archivado tiene',
            'un hash SHA-256 que permite verificar integridad post-extracción.',
            'Es el "archivo regulatorio" del proyecto — equivalente a un repo',
            'documental controlado para auditoría GxP.',
            '',
            'VERIFICACIÓN',
            '------------',
            '  Linux/Mac : sha256sum proyecto/{TYPE}/{CODE}_v{VERSION}.json',
            '  Windows   : certutil -hashfile proyecto\\{TYPE}\\{CODE}_v{VERSION}.json SHA256',
            '',
            'Comparar el output contra `hash_sha256` en el sidecar .signature.json.',
            '',
            '— DRP Assurance Validation Suite —'
        ].join('\n');
    }

    function safeName(s) {
        return String(s || '')
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_+|_+$/g, '')
            .substring(0, 80);
    }

    /** Adjunta un Blob arbitrario (PDF, ZIP, etc.) a la carpeta del proyecto.
     *  Reutiliza el mismo store, marcando kind='attachment' para distinguirlo
     *  de los docs firmados (kind ausente / 'doc'). El blob se guarda como
     *  Uint8Array para evitar problemas de re-hidratación cross-browser. */
    async function attachBlob(pkgCode, blob, meta) {
        if (!blob) throw new Error('Falta el Blob.');
        meta = meta || {};
        const fileName = meta.fileName || 'adjunto.bin';
        const mime = blob.type || 'application/octet-stream';
        const buf = new Uint8Array(await blob.arrayBuffer());
        const hashSource = (meta.tomo ? 'T' + meta.tomo + '|' : '') + fileName + '|' + buf.length;
        const hash = await sha256Hex(hashSource + '|' + new Date().toISOString());
        const type = meta.type || 'ATTACHMENT';
        const code = meta.code || fileName;
        const version = meta.version || new Date().toISOString().slice(0, 16);
        const id = makeId(pkgCode || 'PKG', type, code, version);

        const entry = {
            id,
            pkgCode: pkgCode || 'PKG',
            type,
            code,
            version,
            kind: 'attachment',
            fileName,
            mime,
            payload: buf,
            hash,
            signedBy: meta.attachedBy || 'Sin identificar',
            signedAt: new Date().toISOString(),
            sizeBytes: buf.length,
            note: meta.note || ''
        };

        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(entry);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally {
            db.close();
        }
        return entry;
    }

    VS.projectFolder.saveDoc = saveDoc;
    VS.projectFolder.attachBlob = attachBlob;
    VS.projectFolder.listAll = listAll;
    VS.projectFolder.getEntry = getEntry;
    VS.projectFolder.deleteEntry = deleteEntry;
    VS.projectFolder.clearAll = clearAll;
    VS.projectFolder.exportZip = exportZip;
    VS.projectFolder._sha256 = sha256Hex;

})(window);
