/* ====================================================================
   VALIDATION SUITE — SIGN & ARCHIVE (Fase C, UI)
   Modal que combina:
     1. Candidatos para firmar (docs del paquete + doc activo del editor)
     2. Vista de la "carpeta del proyecto" (lista navegable de docs firmados)
     3. Acciones: firmar, descargar JSON, borrar entrada, exportar ZIP

   El doc firmado se persiste en IndexedDB vía VS.projectFolder, con su
   hash SHA-256 + timestamp + firmante. La firma queda asociada al
   pkgCode del paquete activo — múltiples versiones del mismo doc se
   conservan (no se sobrescriben, salvo misma versión exacta).

   API:
     VS.signArchive.openSignModal()  → abre el modal
     VS.signArchive.refresh()        → re-render del listado de la carpeta
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.signArchive = VS.signArchive || {};

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function getCurrentPkgCode() {
        const pkg = global.packageDocs || [];
        for (const d of pkg) {
            const c = d.data && d.data.package && d.data.package.code;
            if (c) return c;
        }
        return 'PKG';
    }

    function getCurrentSignedBy() {
        const ej = document.getElementById('ejecutor');
        if (ej && ej.value && ej.value.trim()) return ej.value.trim();
        if (global.executor && String(global.executor).trim()) return String(global.executor).trim();
        return 'Sin identificar';
    }

    // ====================================================================
    // INYECCIÓN EN CUADRO DE FIRMAS DEL DOCUMENTO
    // Cuando el usuario firma desde este modal, la firma también se
    // inserta visualmente en la sección tabla-firmas-final del documento,
    // igual que lo hace el circuito drag-and-drop (firma-digital.js).
    // ====================================================================

    function _initials(nombre) {
        return (nombre || '?').split(' ').map(function(w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase() || '?';
    }

    function _buildFirmaEntry(firma) {
        const fecha = firma.fecha
            || new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return {
            rol:        firma.rol        || 'Firmante',
            nombre:     firma.nombre     || '',
            iniciales:  firma.iniciales  || _initials(firma.nombre),
            firmaImage: firma.firmaImage || null,
            fecha:      fecha,
            pinVerified: true
        };
    }

    function _injectIntoSecciones(secciones, firmaEntry) {
        (secciones || []).forEach(function(sec) {
            if (sec.tipo !== 'tabla-firmas-final') return;
            if (!Array.isArray(sec.firmas)) sec.firmas = [];
            const idx = sec.firmas.findIndex(function(x) { return x.rol === firmaEntry.rol; });
            if (idx >= 0) sec.firmas[idx] = firmaEntry;
            else          sec.firmas.push(firmaEntry);
        });
    }

    function _injectSignatureIntoDoc(cand, firma) {
        const firmaEntry = _buildFirmaEntry(firma);

        if (cand.source === 'package') {
            // Busca la entrada correspondiente en packageDocs por type + code + version
            const pkg = global.packageDocs || [];
            const entry = pkg.find(function(d) {
                if (!d || !d.data || !d.data.document) return false;
                return d.type === cand.type
                    && String(d.data.document.code)    === String(cand.code)
                    && String(d.data.document.version) === String(cand.version);
            });
            if (entry && entry.data) {
                _injectIntoSecciones(entry.data.secciones, firmaEntry);
                if (typeof global.saveToStorage === 'function') {
                    global.saveToStorage().catch(function() {});
                }
            }
        } else if (cand.source === 'editor') {
            // Actualiza el JSON del editor activo
            const editor = document.getElementById('vsJsonEditor');
            if (!editor || !editor.value) return;
            try {
                const doc = JSON.parse(editor.value);
                _injectIntoSecciones(doc.secciones, firmaEntry);
                editor.value = JSON.stringify(doc, null, 2);
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (_) { /* JSON inválido — sin inyección */ }
        }
    }

    // ====================================================================
    // RECOLECCIÓN DE CANDIDATOS
    // ====================================================================

    function collectCandidates() {
        const out = [];
        const pkg = global.packageDocs || [];
        pkg.forEach(d => {
            if (!d || !d.type || !d.data) return;
            out.push({
                source: 'package',
                type: d.type,
                code: (d.data.document && d.data.document.code) || d.code || '(sin código)',
                version: (d.data.document && d.data.document.version) || d.version || '1.0',
                data: d.data,
                titleEs: (d.data.document && d.data.document.titleEs) || ''
            });
        });

        // Doc actualmente abierto en el editor del suite (si lo hay)
        const editor = document.getElementById('vsJsonEditor');
        if (editor && editor.value && editor.value.trim()) {
            try {
                const data = JSON.parse(editor.value);
                if (data && data.type) {
                    const code = (data.document && data.document.code) || '(editor)';
                    const version = (data.document && data.document.version) || '1.0';
                    // Evitar duplicar si ya está en el paquete por mismo type+code+version
                    const exists = out.some(c =>
                        c.type === data.type && c.code === code && c.version === version
                    );
                    if (!exists) {
                        out.push({
                            source: 'editor',
                            type: data.type,
                            code,
                            version,
                            data,
                            titleEs: (data.document && data.document.titleEs) || ''
                        });
                    }
                }
            } catch (e) { /* JSON inválido, ignorar */ }
        }

        return out;
    }

    // ====================================================================
    // RENDER DE LA CARPETA DEL PROYECTO
    // ====================================================================

    function renderFolder(container, entries, pkgCode) {
        if (entries.length === 0) {
            container.innerHTML = `
                <div class="sign-folder-empty">
                    <div class="sign-folder-empty-title">📁 Carpeta vacía</div>
                    <div class="sign-folder-empty-text">Cuando firmés un doc se va a archivar acá con su hash SHA-256, firmante y timestamp. Múltiples versiones del mismo doc se conservan por separado.</div>
                </div>
            `;
            return;
        }

        // Agrupar por type → code → versions
        const byType = {};
        entries.forEach(e => {
            if (!byType[e.type]) byType[e.type] = {};
            if (!byType[e.type][e.code]) byType[e.type][e.code] = [];
            byType[e.type][e.code].push(e);
        });

        const html = [];
        html.push(`
            <div class="sign-folder-header">
                <span class="sign-folder-icon">📁</span>
                <strong>${escapeHtml(pkgCode || 'PKG')}</strong>
                <span class="sign-folder-count">${entries.length} archivo(s)</span>
                <button class="vs-btn-action" style="margin-left:auto; padding:6px 12px; font-size:12px;" onclick="exportProjectZip()" title="Descarga la carpeta completa como ZIP firmado">⬇ Exportar ZIP del proyecto</button>
            </div>
        `);

        Object.keys(byType).sort().forEach(type => {
            const codesObj = byType[type];
            const totalInType = Object.values(codesObj).reduce((s, arr) => s + arr.length, 0);
            html.push(`<div class="sign-tree-type-row"><span class="sign-tree-type-label">${escapeHtml(type)}</span><span class="sign-tree-type-count">${totalInType}</span></div>`);
            Object.keys(codesObj).sort().forEach(code => {
                const versions = codesObj[code].sort((a, b) => String(a.version).localeCompare(String(b.version), undefined, { numeric: true }));
                versions.forEach(e => {
                    const date = new Date(e.signedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
                    const hashShort = e.hash ? e.hash.substring(0, 12) + '…' : 'no-hash';
                    const sizeKB = (e.sizeBytes / 1024).toFixed(1);
                    const rolLine = e.signerRol
                        ? `<span title="Rol declarado al firmar">🎯 ${escapeHtml(e.signerRol)}</span>`
                        : '';
                    const pinBadge = e.pinVerified
                        ? '<span class="sign-tree-pin-badge" title="Firma 21 CFR Part 11 — autenticada con PIN">🔒 PIN</span>'
                        : '<span class="sign-tree-pin-badge sign-tree-pin-badge-warn" title="Legacy: sin verificación PIN">⚠ legacy</span>';
                    html.push(`
                        <div class="sign-tree-entry">
                            <div class="sign-tree-entry-main">
                                <div class="sign-tree-entry-title">
                                    <strong>${escapeHtml(e.code)}</strong>
                                    <span class="sign-tree-entry-ver">v${escapeHtml(e.version)}</span>
                                    ${pinBadge}
                                </div>
                                <div class="sign-tree-entry-meta">
                                    <span>👤 ${escapeHtml(e.signedBy)}</span>
                                    ${rolLine}
                                    <span>📅 ${escapeHtml(date)}</span>
                                    <span>📦 ${sizeKB} KB</span>
                                </div>
                                <div class="sign-tree-entry-hash" title="${escapeHtml(e.hash || '')}">SHA-256 · ${escapeHtml(hashShort)}</div>
                            </div>
                            <div class="sign-tree-entry-actions">
                                <button class="vs-btn-secondary" style="font-size:10px; padding:4px 9px;" onclick="downloadArchivedDoc('${escapeHtml(e.id)}')" title="Descargar documento archivado">Descargar</button>
                                <button class="vs-btn-secondary" style="font-size:10px; padding:4px 9px; color:#A52A2A;" onclick="deleteArchivedDoc('${escapeHtml(e.id)}')" title="Eliminar de la carpeta del proyecto">✕</button>
                            </div>
                        </div>
                    `);
                });
            });
        });

        container.innerHTML = html.join('');
    }

    function renderCandidates(container, candidates) {
        if (candidates.length === 0) {
            container.innerHTML = `
                <div class="sign-folder-empty">
                    <div class="sign-folder-empty-title">Sin docs disponibles</div>
                    <div class="sign-folder-empty-text">Cargá un paquete documental o abrí un doc en la Suite Validación para tener candidatos para firmar.</div>
                </div>
            `;
            return;
        }
        container.innerHTML = candidates.map((c, i) => {
            const srcLabel = c.source === 'editor' ? 'editor activo' : 'paquete';
            return `
                <div class="sign-cand-row">
                    <div class="sign-cand-info">
                        <span class="sign-cand-tag">${escapeHtml(c.type)}</span>
                        <strong class="sign-cand-code">${escapeHtml(c.code)}</strong>
                        <span class="sign-cand-ver">v${escapeHtml(c.version)}</span>
                        <span class="sign-cand-source">${srcLabel}</span>
                    </div>
                    <button class="vs-btn-action" style="background:#5B3A8C; padding:7px 14px; font-size:12px;" onclick="signAndArchive(${i})">✍ Firmar &amp; archivar</button>
                </div>
            `;
        }).join('');
    }

    // ====================================================================
    // ACCIONES
    // ====================================================================

    async function refresh() {
        const modal = document.getElementById('modalSignArchive');
        if (!modal) return;

        const pkgCode = getCurrentPkgCode();
        const candidates = collectCandidates();
        modal._candidates = candidates;
        modal._pkgCode = pkgCode;

        const candEl = modal.querySelector('#signArchCandidates');
        renderCandidates(candEl, candidates);

        try {
            const entries = await VS.projectFolder.listAll(pkgCode);
            const folderEl = modal.querySelector('#signArchFolderList');
            renderFolder(folderEl, entries, pkgCode);

            // Stats header
            const statsEl = modal.querySelector('#signArchStats');
            if (statsEl) {
                const types = new Set(entries.map(e => e.type)).size;
                statsEl.innerHTML = `
                    <span><strong>${entries.length}</strong> doc(s) firmado(s)</span>
                    <span>·</span>
                    <span><strong>${types}</strong> tipo(s)</span>
                    <span>·</span>
                    <span>paquete <strong>${escapeHtml(pkgCode)}</strong></span>
                `;
            }
        } catch (e) {
            const folderEl = modal.querySelector('#signArchFolderList');
            folderEl.innerHTML = `<div class="sign-folder-empty"><div class="sign-folder-empty-title">Error</div><div class="sign-folder-empty-text">${escapeHtml(e.message)}</div></div>`;
        }
    }

    async function openSignModal() {
        const modal = document.getElementById('modalSignArchive');
        if (!modal) { alert('Modal de firma no presente.'); return; }
        await refresh();
        modal.style.display = 'flex';
    }

    function closeSignModal() {
        const modal = document.getElementById('modalSignArchive');
        if (modal) modal.style.display = 'none';
    }

    async function signAndArchive(candIdx) {
        const modal = document.getElementById('modalSignArchive');
        const candidates = modal && modal._candidates;
        if (!candidates || !candidates[candIdx]) return;
        const cand = candidates[candIdx];
        const pkgCode = modal._pkgCode || getCurrentPkgCode();

        // 21 CFR Part 11 — la firma SOLO procede si una persona PIN-verificada
        // se identifica. No usamos más el campo "ejecutor" del header (era falso
        // positivo: cualquiera con teclado podía firmar como quien quisiera).
        if (typeof global.openSignWithPinModal !== 'function') {
            alert('El módulo de firma con PIN no está disponible. No se puede archivar sin autenticación.');
            return;
        }

        // Verificar que hay personas registradas en el paquete
        const PM = global.PeopleManager;
        const personas = PM && typeof PM.list === 'function' ? PM.list(pkgCode) : [];
        if (!personas || personas.length === 0) {
            alert('No hay firmantes registrados para este paquete.\n\nPara archivar con firma 21 CFR Part 11, primero registrá personas con PIN desde "Personas firmantes" (📋 en la barra superior).');
            return;
        }

        global.openSignWithPinModal({
            title: `Firmar & archivar — ${cand.type} ${cand.code} v${cand.version}`,
            packageCode: pkgCode,
            onSigned: async function (firma) {
                // firma viene PIN-verificada: { nombre, iniciales, rol, fecha, firmaImage, personaId, pinVerified, ... }
                try {
                    const entry = await VS.projectFolder.saveDoc(pkgCode, cand.data, firma.nombre, {
                        rol: firma.rol,
                        signerId: firma.personaId || firma.id || null,
                        iniciales: firma.iniciales,
                        firmaImage: firma.firmaImage,
                        pinVerified: true
                    });

                    // Audit log con firma PIN-verificada
                    if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                        global.AuditTrail.logAction('SUITE_SIGN_DOC', 'document', entry.code, {
                            type: entry.type,
                            version: entry.version,
                            hash: entry.hash,
                            signedBy: entry.signedBy,
                            signerRol: entry.signerRol,
                            signerId: entry.signerId,
                            pinVerified: entry.pinVerified,
                            pkgCode: entry.pkgCode,
                            sizeBytes: entry.sizeBytes
                        }, 'Doc firmado y archivado (21 CFR Part 11 — PIN verificado)');
                    }

                    // Inyectar firma en el cuadro visual del documento
                    _injectSignatureIntoDoc(cand, firma);

                    if (typeof global.showNotification === 'function') {
                        global.showNotification(
                            `${entry.code} v${entry.version} firmado por ${entry.signedBy}${entry.signerRol ? ' (' + entry.signerRol + ')' : ''} · hash ${entry.hash ? entry.hash.substring(0, 10) + '…' : 'sin-hash'}`,
                            'success'
                        );
                    }

                    await refresh();
                } catch (e) {
                    alert('Error archivando: ' + e.message);
                }
            }
        });
    }

    async function downloadArchivedDoc(id) {
        try {
            const entry = await VS.projectFolder.getEntry(id);
            if (!entry) { alert('Entrada no encontrada en la carpeta.'); return; }
            const blob = new Blob([JSON.stringify(entry.content, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${entry.code}_v${entry.version}.json`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
        } catch (e) {
            alert('Error descargando: ' + e.message);
        }
    }

    async function deleteArchivedDoc(id) {
        if (!confirm('¿Eliminar este doc de la carpeta del proyecto?\n\nEsta acción no se puede deshacer. El archivo se mantiene en el paquete activo (si está cargado) — solo se borra de la carpeta archivada.')) return;
        try {
            await VS.projectFolder.deleteEntry(id);
            await refresh();
            if (typeof global.showNotification === 'function') {
                global.showNotification('Entrada eliminada de la carpeta.', 'info');
            }
        } catch (e) {
            alert('Error eliminando: ' + e.message);
        }
    }

    async function exportProjectZip() {
        const pkgCode = getCurrentPkgCode();
        try {
            const result = await VS.projectFolder.exportZip(pkgCode);
            if (typeof global.showNotification === 'function') {
                global.showNotification(
                    `Proyecto exportado: ${result.fileName} · ${result.manifest.totalEntries} doc(s) firmado(s)`,
                    'success'
                );
            }
            // Audit log para el export
            if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                global.AuditTrail.logAction('SUITE_SIGN_DOC', 'package', pkgCode, {
                    action: 'export_zip',
                    fileName: result.fileName,
                    totalEntries: result.manifest.totalEntries,
                    byType: result.manifest.byType
                }, 'Proyecto archivado exportado como ZIP');
            }
        } catch (e) {
            alert('Error exportando ZIP: ' + e.message);
        }
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    VS.signArchive.openSignModal = openSignModal;
    VS.signArchive.closeSignModal = closeSignModal;
    VS.signArchive.refresh = refresh;
    VS.signArchive.signAndArchive = signAndArchive;
    VS.signArchive.downloadArchivedDoc = downloadArchivedDoc;
    VS.signArchive.deleteArchivedDoc = deleteArchivedDoc;
    VS.signArchive.exportProjectZip = exportProjectZip;

    global.openSignArchiveModal = openSignModal;
    global.closeSignArchiveModal = closeSignModal;
    global.signAndArchive = signAndArchive;
    global.downloadArchivedDoc = downloadArchivedDoc;
    global.deleteArchivedDoc = deleteArchivedDoc;
    global.exportProjectZip = exportProjectZip;

})(window);
