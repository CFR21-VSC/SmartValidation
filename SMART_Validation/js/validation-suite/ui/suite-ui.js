/* ====================================================================
   VALIDATION SUITE — UI (split view: editor JSON + preview PDF)
   ==================================================================== */

(function (global) {
    'use strict';

    let lastValidJSON = null;          // ultimo JSON parseado correctamente
    let lastBlobUrl = null;            // URL del PDF generado (para revoke)
    let isRendering = false;           // flag para evitar regeneraciones simultaneas

    // ====================================================================
    // ABRIR / CERRAR MODAL
    // ====================================================================
    // ════════════════════════════════════════════════════════════════════
    // ESTADO DE CONTEXTO DEL EDITOR
    // Indica de dónde viene el doc actualmente cargado:
    //   { kind: 'project'|'template'|'example'|null, projectDocIndex, type, code, version, name }
    // El botón "Guardar al proyecto" solo se habilita cuando kind === 'project'.
    // ════════════════════════════════════════════════════════════════════
    let _vsEditorContext = { kind: null };

    global.openValidationSuite = function (preselectTemplate) {
        const modal = document.getElementById('modalValidationSuite');
        if (!modal) return;
        modal.style.display = 'block';

        // Listener del selector verde "Docs del proyecto activo"
        const projDocSelector = document.getElementById('vsProjectDocSelector');
        if (projDocSelector && !projDocSelector._vsBound) {
            projDocSelector.addEventListener('change', function() {
                vsLoadFromProject.call(this);
                const delBtn = document.getElementById('vsDeleteDocBtn');
                if (delBtn) {
                    const hasSelection = !!this.value && this.value.startsWith('pkg-');
                    delBtn.disabled = !hasSelection;
                    delBtn.style.opacity = hasSelection ? '1' : '0.4';
                    delBtn.style.cursor  = hasSelection ? 'pointer' : 'default';
                }
            });
            projDocSelector._vsBound = true;
        }
        // Repoblar dinámicamente cada vez que se abre el modal (puede haber
        // cambiado el proyecto activo entre aperturas)
        vsPopulateProjectDocs();

        // Listener del selector de plantillas vacías
        const selector = document.getElementById('vsTemplateSelector');
        if (selector && !selector._vsBound) {
            selector.addEventListener('change', vsLoadTemplate);
            selector._vsBound = true;
        }

        // Listener del selector de ejemplos pre-completados (botón rojo).
        // Comparte handler con el selector de plantillas: ambos disparan
        // vsLoadTemplate() que lee el `value` del select que cambió.
        // Para evitar confusión, cuando uno cambia el otro se resetea.
        const examplesSelector = document.getElementById('vsExamplesSelector');
        if (examplesSelector && !examplesSelector._vsBound) {
            examplesSelector.addEventListener('change', function (e) {
                if (selector) selector.value = '';
                if (projDocSelector) projDocSelector.value = '';
                vsLoadTemplate(e);
            });
            examplesSelector._vsBound = true;
        }
        // Cross-reset entre los 3 selectores
        if (selector && !selector._vsResetCross) {
            selector.addEventListener('change', function () {
                if (examplesSelector) examplesSelector.value = '';
                if (projDocSelector) projDocSelector.value = '';
            });
            selector._vsResetCross = true;
        }

        // Listener del editor para validacion en vivo
        const editor = document.getElementById('vsJsonEditor');
        if (editor && !editor._vsBound) {
            editor.addEventListener('input', vsValidateJSONLive);
            editor._vsBound = true;
        }

        // Listener del file input
        const fileInput = document.getElementById('vsImportFileInput');
        if (fileInput && !fileInput._vsBound) {
            fileInput.addEventListener('change', vsHandleImportFile);
            fileInput._vsBound = true;
        }

        // Preseleccionar plantilla si fue indicada desde el menu unificado.
        // Buscar primero en el selector de plantillas, luego en el de ejemplos.
        if (preselectTemplate) {
            if (selector && Array.from(selector.options).some(o => o.value === preselectTemplate)) {
                if (selector.value !== preselectTemplate) {
                    selector.value = preselectTemplate;
                    if (examplesSelector) examplesSelector.value = '';
                    vsLoadTemplate();
                    return;
                }
            } else if (examplesSelector && Array.from(examplesSelector.options).some(o => o.value === preselectTemplate)) {
                if (examplesSelector.value !== preselectTemplate) {
                    examplesSelector.value = preselectTemplate;
                    if (selector) selector.value = '';
                    vsLoadTemplate();
                    return;
                }
            }
        }

        // Wire toggle Vista documento / JSON
        const visualBtn = document.getElementById('vsEditModeVisual');
        const jsonBtn = document.getElementById('vsEditModeJson');
        if (visualBtn && !visualBtn._vsBound) {
            visualBtn.addEventListener('click', function () { vsSwitchEditMode('visual'); });
            visualBtn._vsBound = true;
        }
        if (jsonBtn && !jsonBtn._vsBound) {
            jsonBtn.addEventListener('click', function () { vsSwitchEditMode('json'); });
            jsonBtn._vsBound = true;
        }
        const applyBtn = document.getElementById('vsVisualApplyBtn');
        if (applyBtn && !applyBtn._vsBound) {
            applyBtn.addEventListener('click', vsApplyVisualToJSON);
            applyBtn._vsBound = true;
        }

        vsValidateJSONLive(); // estado inicial
        vsUpdateContextBadge();

        // Arranca en vista documento — modo amigable para analistas
        vsSwitchEditMode('visual');
    };

    // ════════════════════════════════════════════════════════════════════
    // TOGGLE Vista documento ↔ JSON
    // ════════════════════════════════════════════════════════════════════
    let _vsEditMode = 'json'; // estado actual

    function vsSwitchEditMode(mode) {
        const visualBtn = document.getElementById('vsEditModeVisual');
        const jsonBtn = document.getElementById('vsEditModeJson');
        const visualEditor = document.getElementById('vsVisualEditor');
        const jsonEditor = document.getElementById('vsJsonEditor');
        const saveBar = document.getElementById('vsVisualSaveBar');
        if (mode === 'visual') {
            if (visualBtn) visualBtn.classList.add('active');
            if (jsonBtn) jsonBtn.classList.remove('active');
            if (visualEditor) visualEditor.style.display = 'block';
            if (jsonEditor) jsonEditor.style.display = 'none';
            if (saveBar) saveBar.classList.remove('vs-hidden');
            _vsEditMode = 'visual';
            vsRenderVisualFromJSON();
        } else {
            // Al salir de modo visual: volcar los cambios al textarea silenciosamente
            // para que no se pierdan cuando el usuario vuelve al modo JSON.
            if (_vsEditMode === 'visual' && visualEditor && jsonEditor) {
                const VSref = global.ValidationSuite;
                if (VSref && VSref.visualEditor) {
                    let _orig;
                    try { _orig = JSON.parse(jsonEditor.value || '{}'); } catch (e) { _orig = {}; }
                    const _flushed = VSref.visualEditor.serialize(_orig, visualEditor);
                    jsonEditor.value = JSON.stringify(_flushed, null, 2);
                    jsonEditor.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
            if (visualBtn) visualBtn.classList.remove('active');
            if (jsonBtn) jsonBtn.classList.add('active');
            if (visualEditor) visualEditor.style.display = 'none';
            if (jsonEditor) jsonEditor.style.display = 'block';
            if (saveBar) saveBar.classList.add('vs-hidden');
            _vsEditMode = 'json';
        }
    }
    global.vsSwitchEditMode = vsSwitchEditMode;

    function vsRenderVisualFromJSON() {
        const editor = document.getElementById('vsJsonEditor');
        const visualEditor = document.getElementById('vsVisualEditor');
        const VSref = global.ValidationSuite;
        if (!editor || !visualEditor || !VSref || !VSref.visualEditor) return;
        const txt = editor.value || '';
        if (!txt.trim()) {
            VSref.visualEditor.render(null, visualEditor);
            return;
        }
        let data;
        try { data = JSON.parse(txt); }
        catch (e) {
            visualEditor.innerHTML =
                '<div class="ve-empty" style="color:#A52A2A;">Formato inválido — corregilo en modo Técnico antes de cambiar a vista documento.' +
                '<br><small style="display:block; margin-top:8px;">' + String(e.message || e) + '</small></div>';
            return;
        }
        VSref.visualEditor.render(data, visualEditor);
    }

    async function vsApplyVisualToJSON() {
        const editor = document.getElementById('vsJsonEditor');
        const visualEditor = document.getElementById('vsVisualEditor');
        const VSref = global.ValidationSuite;
        if (!editor || !visualEditor || !VSref || !VSref.visualEditor) return;

        // Confirmar
        const ok = typeof global.drpConfirm === 'function'
            ? await global.drpConfirm(
                'Vas a aplicar los cambios de la vista documento. Las modificaciones manuales hechas en modo Técnico que no estén reflejadas en la vista pueden perderse.\n\n¿Continuar?',
                'Aplicar cambios al documento')
            : confirm('Aplicar los cambios de la vista documento?');
        if (!ok) return;

        let originalData;
        try { originalData = JSON.parse(editor.value || '{}'); }
        catch (e) { originalData = {}; }

        const newData = VSref.visualEditor.serialize(originalData, visualEditor);
        editor.value = JSON.stringify(newData, null, 2);
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Si hay contexto de proyecto, guardar directamente (no solo aplicar al textarea).
        // El textarea ya está actualizado, así que vsSaveToProject lo leerá correctamente.
        if (_vsEditorContext && _vsEditorContext.kind === 'project') {
            await vsSaveToProject();
        } else {
            if (typeof global.showNotification === 'function') {
                global.showNotification('Cambios aplicados al documento', 'success');
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // POBLADO DEL SELECTOR "Docs del proyecto activo"
    // ════════════════════════════════════════════════════════════════════
    function vsPopulateProjectDocs() {
        const sel = document.getElementById('vsProjectDocSelector');
        if (!sel) return;
        const pkg = (global.packageDocs || []).filter(d => d && d.type && d.type !== 'PEOPLE');
        // Conservar el valor seleccionado si todavía existe
        const prev = sel.value;
        if (pkg.length === 0) {
            sel.innerHTML = '<option value="">📂 Sin docs en el proyecto activo</option>';
            sel.disabled = true;
            sel.style.opacity = '0.6';
            vsUpdateCycleProgressBar(null, 0);
            return;
        }
        sel.disabled = false;
        sel.style.opacity = '1';
        // Orden canónico GxP
        const ORDER = ['HLRA','VP','URS','FRS','DS','RA','IRA','RRM','MTR','PIQ','IIQ','RIQ','POQ','IOQ','NCR','ROQ','PPQ','IPQ','RPQ','VSR','AEX','EVRA','EVPROT','EVIR'];
        const sorted = pkg.slice().sort((a, b) => {
            const ai = ORDER.indexOf(a.type), bi = ORDER.indexOf(b.type);
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        });
        sel.innerHTML = '<option value="">📂 Docs del proyecto activo (' + sorted.length + ')</option>' +
            sorted.map((d, i) => {
                // El value es el índice en window.packageDocs (no en sorted), para save lookup
                const realIdx = global.packageDocs.indexOf(d);
                const code = d.code || '(sin código)';
                const ver = d.version ? ' v' + d.version : '';
                const docId = d.code || d.type;
                // Estado workflow para etiqueta de estado (3.2)
                const pid = (global.ValidationSuite && global.ValidationSuite.projects)
                    ? global.ValidationSuite.projects.getActiveId() : null;
                const estado = (typeof CycleDashboard !== 'undefined' && pid && docId)
                    ? CycleDashboard.getDocState(pid, docId) : 'draft';
                const estadoLabel = { draft: '○', in_review: '◑', approved: '●', locked: '⬡' }[estado] || '○';
                return '<option value="pkg-' + realIdx + '">' +
                       estadoLabel + ' ' + escapeHtml(d.type) + ' · ' + escapeHtml(code) + escapeHtml(ver) +
                       '</option>';
            }).join('');
        // Restaurar selección si todavía es válida
        if (prev && sel.querySelector('option[value="' + prev + '"]')) sel.value = prev;
        // Actualizar barra de progreso del ciclo (3.2)
        const activePid = (global.ValidationSuite && global.ValidationSuite.projects)
            ? global.ValidationSuite.projects.getActiveId() : null;
        vsUpdateCycleProgressBar(activePid, pkg.length);
    }

    // Renderiza/actualiza la barra de progreso del ciclo debajo del selector (tarea 3.2)
    function vsUpdateCycleProgressBar(projectId, totalDocs) {
        const sel = document.getElementById('vsProjectDocSelector');
        if (!sel) return;
        // Obtener o crear el contenedor de progreso
        let bar = document.getElementById('vsCycleProgressBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'vsCycleProgressBar';
            bar.style.cssText = 'margin-top:4px;';
            sel.parentNode && sel.parentNode.insertBefore(bar, sel.nextSibling);
        }
        if (!projectId || typeof CycleDashboard === 'undefined') {
            bar.innerHTML = '';
            return;
        }
        const s = CycleDashboard.getCycleStats(projectId, totalDocs);
        if (s.total === 0) { bar.innerHTML = ''; return; }

        const t = s.total;
        const wLocked   = Math.round((s.locked   / t) * 100);
        const wApproved = Math.round((s.approved / t) * 100);
        const wReview   = Math.round((s.in_review / t) * 100);
        const wDraft    = Math.max(0, 100 - wLocked - wApproved - wReview);

        const segs = (wLocked   ? '<div class="proj-cyc-seg proj-cyc-locked"   style="width:' + wLocked   + '%"></div>' : '') +
                     (wApproved ? '<div class="proj-cyc-seg proj-cyc-approved" style="width:' + wApproved + '%"></div>' : '') +
                     (wReview   ? '<div class="proj-cyc-seg proj-cyc-review"   style="width:' + wReview   + '%"></div>' : '') +
                     (wDraft    ? '<div class="proj-cyc-seg proj-cyc-draft"    style="width:' + wDraft    + '%"></div>' : '');

        const parts = [];
        if (s.locked)    parts.push(s.locked    + ' bloq.');
        if (s.approved)  parts.push(s.approved  + ' aprobado' + (s.approved  !== 1 ? 's' : ''));
        if (s.in_review) parts.push(s.in_review + ' en revisión');

        bar.innerHTML = '<div class="proj-cyc-bar" style="border-radius:3px;">' + segs + '</div>' +
            '<div class="proj-cyc-label">' +
            escapeHtml(s.completionPct + '% ciclo completo' + (parts.length ? ' · ' + parts.join(' · ') : '')) +
            '</div>';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ════════════════════════════════════════════════════════════════════
    // CARGAR DOC DEL PROYECTO ACTIVO
    // Lee packageDocs[idx].data, lo escribe al editor y setea contexto 'project'.
    // ════════════════════════════════════════════════════════════════════
    function vsLoadFromProject(e) {
        const sel = (e && e.target) || document.getElementById('vsProjectDocSelector');
        const value = sel ? sel.value : '';
        if (!value || !value.startsWith('pkg-')) return;
        const idx = parseInt(value.slice(4), 10);
        const entry = (global.packageDocs || [])[idx];
        if (!entry || !entry.data) {
            alert('No se pudo cargar el doc del proyecto (entry no encontrado).');
            return;
        }
        // Reset de los otros selectores
        const tpl = document.getElementById('vsTemplateSelector');
        const ex = document.getElementById('vsExamplesSelector');
        if (tpl) tpl.value = '';
        if (ex) ex.value = '';

        const editor = document.getElementById('vsJsonEditor');
        if (editor) editor.value = JSON.stringify(entry.data, null, 2);

        _vsEditorContext = {
            kind: 'project',
            projectDocIndex: idx,
            type: entry.type,
            code: entry.code,
            version: entry.version,
            name: entry.type + ' · ' + (entry.code || '?')
        };
        vsUpdateContextBadge();
        vsValidateJSONLive();
        if (_vsEditMode === 'visual') vsRenderVisualFromJSON();
        setTimeout(() => vsRenderPreview(), 100);
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('SUITE_OPEN_DOC', 'document', entry.code, {
                type: entry.type, version: entry.version, source: 'project'
            }, 'Doc abierto desde proyecto: ' + entry.code);
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // GUARDAR EL DOC EDITADO AL PROYECTO (reemplaza packageDocs[idx].data)
    // ════════════════════════════════════════════════════════════════════
    async function vsSaveToProject() {
        if (!_vsEditorContext || _vsEditorContext.kind !== 'project') {
            alert('Este doc no fue cargado desde el proyecto. Para guardarlo al proyecto, cargalo primero desde "Docs del proyecto activo".');
            return;
        }
        const idx = _vsEditorContext.projectDocIndex;
        const entry = (global.packageDocs || [])[idx];
        if (!entry) {
            alert('No se encontró el entry en el paquete del proyecto. Recargá la página.');
            return;
        }

        // Si estamos en modo visual, volcar los cambios al textarea antes de guardar.
        // Esto permite que "Guardar al proyecto" funcione directamente desde la vista
        // documento sin necesidad de presionar primero "Guardar cambios".
        if (_vsEditMode === 'visual') {
            const _ve = document.getElementById('vsVisualEditor');
            const _ed = document.getElementById('vsJsonEditor');
            const _vsr = global.ValidationSuite;
            if (_ve && _ed && _vsr && _vsr.visualEditor) {
                let _orig;
                try { _orig = JSON.parse(_ed.value || '{}'); } catch (e) { _orig = {}; }
                const _flushed = _vsr.visualEditor.serialize(_orig, _ve);
                _ed.value = JSON.stringify(_flushed, null, 2);
            }
        }

        const editor = document.getElementById('vsJsonEditor');
        let data;
        try {
            data = JSON.parse(editor.value);
        } catch (err) {
            alert('El documento del editor no es válido. Corregí los errores antes de guardar:\n\n' + err.message);
            return;
        }
        if (!data.type) {
            alert('El documento no tiene campo "type" — no se puede guardar al paquete.');
            return;
        }
        if (data.type !== entry.type) {
            if (!confirm('El tipo del documento (' + data.type + ') cambió respecto al original (' + entry.type + '). ¿Continuar y reasignar el tipo?')) return;
        }

        // Actualizar el entry
        const oldVersion = entry.version;
        const oldCode = entry.code;
        entry.data = data;
        entry.type = data.type;
        entry.code = (data.document && data.document.code) || entry.code;
        entry.version = (data.document && data.document.version) || entry.version;
        entry.title = (data.document && data.document.titleEs) || entry.title;
        entry.loadedAt = new Date().toISOString();

        // Persistir
        if (typeof global.saveToStorage === 'function') {
            try { await global.saveToStorage(); } catch (e) { console.warn('[suite-ui] save fallo:', e); }
        }
        if (typeof global.renderPackagePanel === 'function') {
            try { global.renderPackagePanel(); } catch (e) {}
        }
        // Actualizar contexto (puede haber cambiado code/version)
        _vsEditorContext.code = entry.code;
        _vsEditorContext.version = entry.version;
        _vsEditorContext.name = entry.type + ' · ' + (entry.code || '?');
        vsUpdateContextBadge();
        // Repopular el selector para reflejar code/version nuevos
        vsPopulateProjectDocs();
        // Re-seleccionar el doc que acabamos de guardar
        const sel = document.getElementById('vsProjectDocSelector');
        if (sel) sel.value = 'pkg-' + idx;

        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('DOC_UPDATED_IN_PROJECT', 'document', entry.code, {
                type: entry.type, oldCode, oldVersion, newVersion: entry.version,
                contentSize: editor.value.length
            }, 'Doc actualizado en proyecto: ' + entry.code);
        }
        // Invalidar firmas si el doc fue editado post-firma (GxP — trazabilidad)
        if (typeof DocWorkflow !== 'undefined') {
            const _pid = (global.ValidationSuite && global.ValidationSuite.projects &&
                typeof global.ValidationSuite.projects.getActiveId === 'function')
                ? global.ValidationSuite.projects.getActiveId() : 'default';
            const _docId = entry.id || entry.code || entry.type;
            const _invalidated = DocWorkflow.invalidateSignatures(_docId, _pid);
            if (_invalidated > 0 && global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                global.AuditTrail.logAction('DOC_SIGNATURES_INVALIDATED', 'document', _docId, {
                    signaturesInvalidated: _invalidated, reason: 'Edición post-firma'
                }, 'Firmas invalidadas por edición del documento.');
            }
        }
        if (typeof global.showNotification === 'function') {
            global.showNotification('Doc guardado en el proyecto · ' + entry.type + ' ' + entry.code, 'success');
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // BADGE DE CONTEXTO + estado del botón "Guardar al proyecto"
    // ════════════════════════════════════════════════════════════════════
    function vsUpdateContextBadge() {
        const badge = document.getElementById('vsContextBadge');
        const saveBtn = document.getElementById('vsBtnSaveToProject');
        if (!badge) return;

        const ctx = _vsEditorContext || { kind: null };
        if (!ctx.kind) {
            badge.style.display = 'none';
            if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
            return;
        }
        badge.style.display = '';
        badge.className = 'vs-context-badge vs-context-badge-' + ctx.kind;
        let icon, label, meta;
        if (ctx.kind === 'project') {
            icon = '✓';
            // Badge de estado workflow (3.6)
            let stateBadge = '';
            try {
                if (typeof CycleDashboard !== 'undefined' && global.ValidationSuite && global.ValidationSuite.projects) {
                    const pid = global.ValidationSuite.projects.getActiveId();
                    const did = ctx.code || ctx.type;
                    if (pid && did) {
                        const estado = CycleDashboard.getDocState(pid, did);
                        const labels = { draft: 'Borrador', in_review: 'En Revisión', approved: 'Aprobado', locked: 'Bloqueado' };
                        stateBadge = ' <span class="vs-state-badge vs-state-' + escapeHtml(estado) + '">' + escapeHtml(labels[estado] || estado) + '</span>';
                    }
                }
            } catch (_) {}
            label = 'Editando del proyecto activo: <code>' + escapeHtml(ctx.type) + '</code> · <strong>' + escapeHtml(ctx.code || '?') + '</strong>' + (ctx.version ? ' v' + escapeHtml(ctx.version) : '') + stateBadge;
            meta = 'Los cambios se persisten con <strong>💾 Guardar al proyecto</strong>';
            if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
        } else if (ctx.kind === 'template') {
            icon = '📄';
            label = 'Editando plantilla vacía: <code>' + escapeHtml(ctx.name || '?') + '</code>';
            meta = 'NO asociada al proyecto — descargá el JSON o importalo después';
            if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
        } else if (ctx.kind === 'example') {
            icon = '★';
            label = 'Inspeccionando ejemplo: <code>' + escapeHtml(ctx.name || '?') + '</code>';
            meta = 'Modo lectura informativa — no se persiste';
            if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
        } else {
            badge.style.display = 'none';
            if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
            return;
        }
        badge.innerHTML = '<span style="font-size:14px;">' + icon + '</span> <span>' + label + '</span> <span class="vs-context-badge-meta">' + meta + '</span>';
    }

    global.vsSaveToProject = vsSaveToProject;
    global.vsPopulateProjectDocs = vsPopulateProjectDocs;

    /** Elimina el documento seleccionado en el selector verde del proyecto. */
    global.vsDeleteSelectedDoc = async function () {
        const sel = document.getElementById('vsProjectDocSelector');
        if (!sel || !sel.value || !sel.value.startsWith('pkg-')) return;
        const idx = parseInt(sel.value.replace('pkg-', ''), 10);
        const doc = (global.packageDocs || [])[idx];
        if (!doc) return;

        const label = (doc.type || '').toUpperCase() + (doc.code ? ' · ' + doc.code : '');
        if (!confirm(`¿Eliminar "${label}" del proyecto?\n\nEsta acción no se puede deshacer.`)) return;

        const projId = global.ValidationSuite && global.ValidationSuite.projects
            ? global.ValidationSuite.projects.getActiveId() : null;
        if (!projId) { alert('No hay proyecto activo.'); return; }

        const docType = (doc.type || '').toLowerCase();

        try {
            const res = await fetch(`/api/projects/${projId}/documents/${docType}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                // 404 = no está en el servidor, solo en localStorage — igual lo quitamos del frontend
                if (res.status !== 404) {
                    alert('Error al eliminar: ' + (err.error || res.status));
                    return;
                }
            }
        } catch (e) {
            alert('Error de red al eliminar: ' + e.message);
            return;
        }

        // Quitar del packageDocs local (usa la función existente que también limpia el editor y persiste)
        if (typeof removePackageDocAndRefresh === 'function') {
            await removePackageDocAndRefresh(doc.code || doc.type);
        } else {
            global.packageDocs.splice(idx, 1);
            if (typeof global.vsOnPackageDocRemoved === 'function') global.vsOnPackageDocRemoved(doc.code || doc.type);
        }

        // Resetear botón y selector
        const delBtn = document.getElementById('vsDeleteDocBtn');
        if (delBtn) { delBtn.disabled = true; delBtn.style.opacity = '0.4'; }
        sel.value = '';
        vsPopulateProjectDocs();
    };

    /** Limpia el editor: cierra el documento actual sin borrar nada del proyecto. */
    global.vsClearEditor = function () {
        _vsEditorContext = { kind: null };
        const editor = document.getElementById('vsJsonEditor');
        if (editor) editor.value = '';
        const visualEditor = document.getElementById('vsVisualEditor');
        if (visualEditor) visualEditor.innerHTML = '';
        const infoBar = document.getElementById('vsInfoBar');
        if (infoBar) {
            const badge   = document.getElementById('vsDocBadge');
            const code    = document.getElementById('vsDocCode');
            const version = document.getElementById('vsDocVersion');
            const status  = document.getElementById('vsDocStatus');
            const system  = document.getElementById('vsDocSystem');
            const owner   = document.getElementById('vsDocOwner');
            if (badge)   badge.textContent   = '—';
            if (code)    code.textContent    = '—';
            if (version) version.textContent = '—';
            if (status)  status.textContent  = '—';
            if (system)  system.textContent  = '—';
            if (owner)   owner.textContent   = '—';
        }
        vsUpdateContextBadge();
    };

    /**
     * Llamado cuando un doc es removido del paquete.
     * Si ese doc estaba abierto en el viewer, limpia el editor.
     */
    global.vsOnPackageDocRemoved = function (codeOrType) {
        if (_vsEditorContext && _vsEditorContext.kind === 'project' &&
            (_vsEditorContext.code === codeOrType || _vsEditorContext.type === codeOrType)) {
            _vsEditorContext = { kind: null };
            const editor = document.getElementById('vsJsonEditor');
            if (editor) editor.value = '';
            vsUpdateContextBadge();
        }
        vsPopulateProjectDocs();
    };

    /**
     * Atajo para abrir Suite Validación directamente con un doc del proyecto
     * pre-cargado en el editor. Se invoca desde el botón "✏️ Editar" del
     * sidebar de Documentos del Proyecto (renderPackagePanel).
     */
    global.openProjectDocEditor = function (docCode) {
        if (!docCode) return;
        // Encontrar el entry por code (debe ser único dentro del paquete)
        const pkg = global.packageDocs || [];
        const idx = pkg.findIndex(d => d && d.code === docCode);
        if (idx < 0) {
            alert('Doc no encontrado en el paquete: ' + docCode);
            return;
        }
        // Abrir el modal Suite Validación (esto popula el selector verde)
        global.openValidationSuite();
        // Pequeño delay para que vsPopulateProjectDocs termine
        setTimeout(function () {
            const sel = document.getElementById('vsProjectDocSelector');
            if (!sel) return;
            const targetValue = 'pkg-' + idx;
            // Verificar que la opción exista
            const opt = sel.querySelector('option[value="' + targetValue + '"]');
            if (!opt) {
                console.warn('[suite-ui] No se encontró opción para ' + targetValue + ' tras populate');
                return;
            }
            sel.value = targetValue;
            // Disparar el change para que vsLoadFromProject corra
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, 80);
    };

    global.closeValidationSuite = function () {
        const modal = document.getElementById('modalValidationSuite');
        if (modal) modal.style.display = 'none';
        // No limpiar el editor, asi el usuario no pierde su trabajo
    };

    // ====================================================================
    // VALIDACION EN VIVO DEL JSON
    // ====================================================================
    function vsValidateJSONLive() {
        const editor = document.getElementById('vsJsonEditor');
        const status = document.getElementById('vsJsonStatus');
        const stats = document.getElementById('vsJsonStats');
        const text = editor ? editor.value : '';

        if (!text.trim()) {
            lastValidJSON = null;
            vsUpdateEVAIBtn(null);
            if (status) {
                status.textContent = 'Cargá una plantilla para comenzar';
                status.className = 'vs-status-bar';
            }
            if (stats) stats.textContent = '0 lineas';
            vsUpdateInfoBar(null);
            vsRenderOutline(null);
            if (window.ValidationSuite && window.ValidationSuite.ncrSnippets) {
                window.ValidationSuite.ncrSnippets.updateVisibility(null);
            }
            if (window.ValidationSuite && window.ValidationSuite.signDocument) {
                window.ValidationSuite.signDocument.updateBarVisibility(null);
            }
            return;
        }

        try {
            const parsed = JSON.parse(text);
            lastValidJSON = parsed;

            // Stats utiles
            const lineCount = text.split('\n').length;
            const charCount = text.length;
            const sectionCount = (parsed.secciones || []).length;
            const tipo = parsed.type || '?';

            if (stats) {
                stats.textContent = `${tipo} · ${sectionCount} secc. · ${lineCount} lineas · ${(charCount / 1024).toFixed(1)} KB`;
            }

            if (status) {
                status.textContent = `Documento válido (${tipo})`;
                status.className = 'vs-status-bar vs-status-ok';
            }

            // Refrescar UI
            vsUpdateInfoBar(parsed);
            vsRenderOutline(parsed);
            vsUpdateEVAIBtn(parsed);
            // NCR snippet bar — visible solo si type=NCR
            if (window.ValidationSuite && window.ValidationSuite.ncrSnippets && typeof window.ValidationSuite.ncrSnippets.updateVisibility === 'function') {
                window.ValidationSuite.ncrSnippets.updateVisibility(parsed);
            }
            // Sign document bar — visible si el doc tiene tabla-firmas-final
            if (window.ValidationSuite && window.ValidationSuite.signDocument && typeof window.ValidationSuite.signDocument.updateBarVisibility === 'function') {
                window.ValidationSuite.signDocument.updateBarVisibility(parsed);
            }
        } catch (e) {
            lastValidJSON = null;
            vsUpdateEVAIBtn(null);
            if (status) {
                status.textContent = 'Formato inválido: ' + e.message;
                status.className = 'vs-status-bar vs-status-error';
            }
            if (stats) {
                const lineCount = text.split('\n').length;
                stats.textContent = `${lineCount} lineas (con error)`;
            }
            // No limpiar info ni outline asi el usuario sigue viendo el doc
            // mientras corrige el error
        }
    }

    // ====================================================================
    // INFO BAR — identificacion del documento cargado
    // ====================================================================
    function vsUpdateInfoBar(data) {
        const bar = document.getElementById('vsInfoBar');
        if (!bar) return;

        if (!data) {
            bar.classList.remove('active');
            return;
        }

        bar.classList.add('active');

        const doc = data.document || {};
        const pkg = data.package || {};
        const tipo = data.type || '?';
        const code = doc.code || `${tipo}-${pkg.code || '?'}`;
        const version = doc.version || '—';
        const status = doc.status || 'Borrador';
        const owner = doc.processOwner || '—';
        const sysName = pkg.systemName || '—';
        const sectionCount = (data.secciones || []).length;

        document.getElementById('vsDocBadge').textContent = tipo;
        document.getElementById('vsDocCode').textContent = code;
        document.getElementById('vsDocVersion').textContent = version;
        document.getElementById('vsDocSystem').textContent = sysName;
        document.getElementById('vsDocOwner').textContent = owner;
        document.getElementById('vsDocSectionCount').textContent = sectionCount;

        const statusEl = document.getElementById('vsDocStatus');
        statusEl.textContent = status;
        statusEl.className = 'vs-doc-status ' + getStatusClass(status);
    }

    function getStatusClass(status) {
        const s = (status || '').toLowerCase();
        if (s.includes('aprob')) return 'vs-status-aprobado';
        if (s.includes('borrador') || s.includes('draft')) return 'vs-status-borrador';
        if (s.includes('revisi')) return 'vs-status-revision';
        return 'vs-status-borrador';
    }

    // ====================================================================
    // SIDEBAR — outline navegable de la estructura del JSON
    // ====================================================================
    function vsRenderOutline(data) {
        const tree = document.getElementById('vsSidebarTree');
        if (!tree) return;

        if (!data) {
            tree.innerHTML = '<div class="vs-sidebar-empty">Cargá un documento para<br>ver su estructura</div>';
            return;
        }

        const html = [];

        // Grupo: Metadata
        html.push('<div class="vs-tree-group">Metadata</div>');
        html.push(buildTreeItem('Paquete',      `"package":`,      '📦', null, null, 'header'));
        html.push(buildTreeItem('Documento',    `"document":`,     '📄', null, null, 'header'));
        html.push(buildTreeItem('Trazabilidad', `"trazabilidad":`, '🔗', null, null, 'header'));

        // Grupo: Control y Aprobaciones
        const ccCount = (data.controlCambios || []).length;
        const apCount = (data.matrizAprobaciones || []).length;
        html.push('<div class="vs-tree-group">Control & Aprobaciones</div>');
        html.push(buildTreeItem(`Control de Cambios (${ccCount})`,   `"controlCambios":`,    '📝', null, null, 'cc'));
        html.push(buildTreeItem(`Matriz Aprobaciones (${apCount})`,  `"matrizAprobaciones":`, '✍️', null, null, 'ma'));

        // Grupo: Secciones del documento
        const secciones = data.secciones || [];
        html.push(`<div class="vs-tree-group">Secciones (${secciones.length})</div>`);

        if (secciones.length === 0) {
            html.push('<div class="vs-sidebar-empty" style="padding: 14px; font-size: 11px;">Sin secciones</div>');
        } else {
            secciones.forEach((sec, idx) => {
                const num = sec.numero != null ? sec.numero : (idx + 1);
                const titulo = sec.titulo || `(${sec.tipo || 'sin tipo'})`;
                const tipo = (sec.tipo || '').replace('-', ' ');
                let searchKey;
                if (sec.titulo) {
                    searchKey = `"titulo": "${sec.titulo.replace(/"/g, '\\"')}"`;
                } else {
                    searchKey = `"tipo": "${sec.tipo}"`;
                }
                html.push(buildTreeItem(titulo, searchKey, null, num, tipo, idx));
            });
        }

        // Grupo: Otros
        if (data.notaFirmas !== undefined) {
            html.push('<div class="vs-tree-group">Otros</div>');
            html.push(buildTreeItem('Nota de Firmas', `"notaFirmas":`, '📌', null, null, 'header'));
        }

        tree.innerHTML = html.join('');

        // Bind click en items — bifurca según modo activo
        tree.querySelectorAll('.vs-tree-item').forEach(item => {
            item.addEventListener('click', () => {
                tree.querySelectorAll('.vs-tree-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                if (_vsEditMode === 'visual') {
                    vsScrollVisualTo(item.getAttribute('data-visual-target'));
                } else {
                    const search = item.getAttribute('data-search');
                    if (search) vsScrollEditorTo(search);
                }
            });
        });
    }

    function buildTreeItem(label, searchKey, icon, num, tipo, visualTarget) {
        const escLabel  = (label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escSearch = (searchKey || '').replace(/"/g, '&quot;');
        const escVT     = visualTarget != null ? String(visualTarget) : '';
        const numHtml   = num != null ? `<span class="vs-tree-num">${num}.</span>` : (icon ? `<span class="vs-tree-num">${icon}</span>` : '');
        const tipoHtml  = tipo ? `<span class="vs-tree-tipo">${escLabel === tipo ? '' : tipo}</span>` : '';
        return `<div class="vs-tree-item" data-search="${escSearch}" data-visual-target="${escVT}">${numHtml}<span class="vs-tree-label" title="${escLabel}">${escLabel}</span>${tipoHtml}</div>`;
    }

    // ====================================================================
    // SCROLL EN VISTA DOCUMENTO (visual editor)
    // ====================================================================
    function vsScrollVisualTo(target) {
        const container = document.getElementById('vsVisualEditor');
        if (!container) return;

        let el = null;

        if (target === 'header' || target === '') {
            // Metadata / Paquete / Documento → header del doc
            el = container.querySelector('.ve-header');
        } else if (target === 'cc') {
            el = container.querySelector('.ve-cc-block');
        } else if (target === 'ma') {
            el = container.querySelector('.ve-ma-block');
        } else if (target !== '') {
            // Índice numérico → sección
            el = container.querySelector(`.ve-section[data-section-idx="${target}"]`);
        }

        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Flash visual para indicar la sección
            el.classList.add('vs-nav-flash');
            setTimeout(() => el.classList.remove('vs-nav-flash'), 900);
        }
    }

    // ====================================================================
    // SCROLL DEL EDITOR A UN NODO ESPECIFICO
    // ====================================================================
    function vsScrollEditorTo(searchString) {
        const editor = document.getElementById('vsJsonEditor');
        if (!editor) return;

        const text = editor.value;
        const idx = text.indexOf(searchString);
        if (idx === -1) {
            console.warn('No se encontro:', searchString);
            return;
        }

        // Calcular linea del match
        const before = text.substring(0, idx);
        const lineNum = before.split('\n').length;

        // Posicionar cursor + scroll
        editor.focus();
        editor.selectionStart = idx;
        editor.selectionEnd = idx + searchString.length;

        // Calcular scroll position por linea
        // (textareas: scrollTop = (lineNum - visibleLines/2) * lineHeight aprox)
        const lineHeight = 18; // ~12px font * 1.5 line-height
        const visibleHeight = editor.clientHeight;
        const visibleLines = visibleHeight / lineHeight;
        const targetScroll = Math.max(0, (lineNum - Math.floor(visibleLines / 2)) * lineHeight);
        editor.scrollTop = targetScroll;
    }

    // ====================================================================
    // CARGAR PLANTILLA DESDE EL DROPDOWN
    // ====================================================================
    async function vsLoadTemplate(e) {
        // value puede venir del evento (selector cambia) o se infiere del
        // selector activo cuando llamamos manualmente (preselect path).
        let value = e && e.target ? e.target.value : null;
        let sourceSelector = e && e.target ? e.target : null;
        if (!value) {
            // Fallback: leer del selector que tenga value seteado
            const tplSel = document.getElementById('vsTemplateSelector');
            const exSel = document.getElementById('vsExamplesSelector');
            if (tplSel && tplSel.value) { value = tplSel.value; sourceSelector = tplSel; }
            else if (exSel && exSel.value) { value = exSel.value; sourceSelector = exSel; }
        }
        if (!value) return;

        try {
            const resp = await fetch(`js/validation-suite/fixtures/${value}.json`);
            if (!resp.ok) throw new Error(`No se pudo cargar la plantilla (${resp.status})`);
            const data = await resp.json();

            const editor = document.getElementById('vsJsonEditor');
            if (editor) {
                editor.value = JSON.stringify(data, null, 2);
            }
            vsValidateJSONLive();

            // Detectar si vino del selector de plantillas vacías o del de ejemplos
            // para setear el contexto del editor correctamente. El badge cambia
            // de color: azul (plantilla) vs rojo (ejemplo).
            const isExample = sourceSelector && sourceSelector.id === 'vsExamplesSelector';
            _vsEditorContext = {
                kind: isExample ? 'example' : 'template',
                name: value,
                type: data.type || null,
                code: (data.document && data.document.code) || null,
                version: (data.document && data.document.version) || null
            };
            vsUpdateContextBadge();

            // Reset el selector que disparó la carga para poder recargar la misma plantilla
            if (sourceSelector) sourceSelector.value = '';

            // Refrescar la vista visual si está activa
            if (_vsEditMode === 'visual') vsRenderVisualFromJSON();

            // Auto-generar preview de la plantilla cargada
            setTimeout(() => vsRenderPreview(), 100);
        } catch (err) {
            alert('Error cargando plantilla: ' + err.message);
        }
    }

    // ====================================================================
    // IMPORTAR JSON DESDE ARCHIVO
    // ====================================================================
    global.vsImportJSON = function () {
        const fileInput = document.getElementById('vsImportFileInput');
        if (fileInput) {
            fileInput.value = ''; // reset para poder cargar el mismo archivo de nuevo
            fileInput.click();
        }
    };

    function vsHandleImportFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                const parsed = JSON.parse(ev.target.result);

                // Agregar al paquete documental global (upsert por code)
                _vsEditorContext = { kind: null };
                try {
                    if (parsed && parsed.type && typeof global.addPackageDoc === 'function') {
                        global.addPackageDoc(parsed, { fileName: file.name });
                        // Persistir snapshot
                        if (typeof global.saveToStorage === 'function') {
                            global.saveToStorage().catch(function () {});
                        }
                        // Actualizar dropdown
                        vsPopulateProjectDocs();
                        // Activar contexto de proyecto para habilitar "Guardar al proyecto"
                        const importedCode = (parsed.document && parsed.document.code) || parsed.type;
                        const idx = (global.packageDocs || []).findIndex(function (d) { return d.code === importedCode; });
                        if (idx >= 0) {
                            const entry = global.packageDocs[idx];
                            _vsEditorContext = {
                                kind: 'project',
                                projectDocIndex: idx,
                                type: entry.type,
                                code: entry.code,
                                version: entry.version,
                                name: entry.type + ' · ' + (entry.code || '?')
                            };
                        }
                    }
                } catch (_) {}
                vsUpdateContextBadge();

                // Cargar en editor
                const editor = document.getElementById('vsJsonEditor');
                if (editor) {
                    editor.value = JSON.stringify(parsed, null, 2);
                }
                vsValidateJSONLive();
                if (_vsEditMode === 'visual') vsRenderVisualFromJSON();
                setTimeout(function () { vsRenderPreview(); }, 100);
            } catch (err) {
                alert('El archivo no es un documento válido: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // ====================================================================
    // EXPORTAR JSON EDITADO COMO ARCHIVO
    // ====================================================================
    global.vsExportJSON = function () {
        if (!lastValidJSON) {
            alert('No hay documento válido para descargar. Verificá el editor.');
            return;
        }

        const text = JSON.stringify(lastValidJSON, null, 2);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const code = (lastValidJSON.document && lastValidJSON.document.code) ||
                     (lastValidJSON.type + '_doc');
        const safeName = code.replace(/[^a-zA-Z0-9_-]/g, '_');

        const a = document.createElement('a');
        a.href = url;
        a.download = safeName + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // ====================================================================
    // EXPORTAR / IMPORTAR PROYECTO COMPLETO
    // ====================================================================

    global.vsExportProject = async function () {
        // Determinar proyecto activo o pedir al usuario que elija
        var pid = (typeof VS !== 'undefined' && VS.projects && VS.projects.getActiveId)
            ? VS.projects.getActiveId() : null;
        if (!pid) {
            try {
                var listResp = await fetch('/api/projects');
                if (!listResp.ok) throw new Error('Sin conexión al servidor (' + listResp.status + ')');
                var listData = await listResp.json();
                var projects = (listData.projects || []).filter(function (p) {
                    return !/^__demo/.test(p.name || p.id || '');
                });
                if (!projects.length) { alert('No hay proyectos para exportar.'); return; }
                var chosen = projects.length === 1 ? projects[0] : await vsShowProjectPicker(projects);
                if (!chosen) return;
                pid = chosen.id;
            } catch (err) { alert('Error: ' + err.message); return; }
        }
        try {
            var resp = await fetch('/api/projects/' + encodeURIComponent(pid) + '/export');
            if (!resp.ok) {
                var errData = await resp.json().catch(function () { return {}; });
                alert('Error al exportar: ' + (errData.error || resp.status));
                return;
            }
            var bundle = await resp.json();
            // Adjuntar el DocWorkflow del cliente (localStorage) al bundle antes de descargar
            var wfRaw = localStorage.getItem('doc_workflow_' + pid);
            if (wfRaw) {
                try { bundle.workflow = JSON.parse(wfRaw); } catch (_) {}
            }
            var disposition = resp.headers.get('Content-Disposition') || '';
            var fnMatch = disposition.match(/filename="([^"]+)"/);
            var fileName = fnMatch ? fnMatch[1] : ((bundle.project && bundle.project.name
                ? bundle.project.name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40)
                : 'proyecto') + '.project.json');
            var finalBlob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(finalBlob);
            var a = document.createElement('a');
            a.href = url; a.download = fileName;
            document.body.appendChild(a); a.click();
            setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 5000);
            if (typeof global.showNotification === 'function')
                global.showNotification('Proyecto exportado: ' + fileName, 'success');
        } catch (err) { alert('Error al exportar proyecto:\n' + err.message); }
    };

    var _vsImportProjectInput = null;
    global.vsImportProject = function () {
        if (!_vsImportProjectInput) {
            _vsImportProjectInput = document.createElement('input');
            _vsImportProjectInput.type = 'file';
            _vsImportProjectInput.accept = '.json';
            _vsImportProjectInput.style.display = 'none';
            document.body.appendChild(_vsImportProjectInput);
            _vsImportProjectInput.addEventListener('change', _vsHandleImportProject);
        }
        _vsImportProjectInput.value = '';
        _vsImportProjectInput.click();
    };

    async function _vsHandleImportProject(e) {
        var file = e.target && e.target.files && e.target.files[0];
        if (!file) return;
        var text;
        try { text = await file.text(); }
        catch (err) { alert('No se pudo leer el archivo: ' + err.message); return; }
        var bundle;
        try { bundle = JSON.parse(text); }
        catch (err) { alert('El archivo no es JSON válido: ' + err.message); return; }
        if (!bundle.schemaVersion || !bundle.project) {
            alert('El archivo no es un proyecto exportado válido.\nUsá "Exportar proyecto" para generar el archivo.');
            return;
        }
        var projName = (bundle.project && bundle.project.name) || 'Proyecto';
        var docCount = Array.isArray(bundle.documents) ? bundle.documents.length : 0;
        if (!confirm('¿Importar "' + projName + '" con ' + docCount + ' documentos?\n\nSe creará como proyecto nuevo en el servidor.'))
            return;
        try {
            var resp = await fetch('/api/projects/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bundle)
            });
            var result = await resp.json();
            if (!result.ok) { alert('Error al importar: ' + result.error); return; }
            // Restaurar DocWorkflow en localStorage bajo el NUEVO project id
            if (result.workflow && Object.keys(result.workflow).length > 0) {
                try { localStorage.setItem('doc_workflow_' + result.project_id, JSON.stringify(result.workflow)); }
                catch (_) {}
            }
            // Cargar el proyecto recién importado
            await vsDoLoadProject({ id: result.project_id, name: result.project_name });
            if (typeof global.showNotification === 'function')
                global.showNotification('"' + result.project_name + '" importado con ' + result.doc_count + ' doc(s).', 'success');
        } catch (err) { alert('Error al importar proyecto:\n' + err.message); }
    }

    // ====================================================================
    // CARGAR PROYECTO DESDE EL SERVIDOR
    // ====================================================================
    // Modal visual para seleccionar proyecto del servidor
    function vsShowProjectPicker(projects) {
        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';

            var box = document.createElement('div');
            box.style.cssText = 'background:#1e2940;border-radius:12px;padding:28px 28px 20px;min-width:360px;max-width:520px;width:92%;max-height:80vh;display:flex;flex-direction:column;gap:14px;box-shadow:0 12px 48px rgba(0,0,0,.6);';

            var title = document.createElement('div');
            title.style.cssText = 'font-size:16px;font-weight:700;color:#e8ecf3;letter-spacing:.3px;';
            title.textContent = '☁ Seleccionar proyecto del servidor';

            var list = document.createElement('div');
            list.style.cssText = 'display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:380px;padding-right:2px;';

            function isRealProject(p) {
                var n = p.name || p.id || '';
                return !/^proj_|^__demo/.test(n);
            }

            projects.forEach(function (p) {
                var real = isRealProject(p);
                var row = document.createElement('button');
                row.style.cssText = 'text-align:left;padding:11px 14px;border-radius:8px;border:1px solid ' +
                    (real ? '#3a7bd5' : '#252f4a') + ';background:' + (real ? '#1a3458' : '#141c30') +
                    ';color:#c8d0e0;cursor:pointer;font-size:13px;width:100%;';

                var nameEl = document.createElement('div');
                nameEl.style.cssText = 'font-weight:' + (real ? '600' : '400') + ';color:' + (real ? '#7eb8f7' : '#6a7a98') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                nameEl.textContent = p.name || p.id;

                var metaParts = [];
                if (p.system_name) metaParts.push(p.system_name);
                if (p.client_name)  metaParts.push(p.client_name);
                if (metaParts.length) {
                    var metaEl = document.createElement('div');
                    metaEl.style.cssText = 'font-size:11px;color:#5a6a84;margin-top:3px;';
                    metaEl.textContent = metaParts.join(' · ');
                    row.appendChild(nameEl);
                    row.appendChild(metaEl);
                } else {
                    row.appendChild(nameEl);
                }

                row.onmouseover = function () { this.style.background = real ? '#1f3f6a' : '#1a2440'; };
                row.onmouseout  = function () { this.style.background = real ? '#1a3458' : '#141c30'; };
                row.onclick     = function () { document.body.removeChild(overlay); resolve(p); };
                list.appendChild(row);
            });

            var footer = document.createElement('div');
            footer.style.cssText = 'display:flex;justify-content:flex-end;';
            var cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.style.cssText = 'padding:7px 18px;border-radius:7px;border:1px solid #2e3d5a;background:transparent;color:#6a7a98;cursor:pointer;font-size:13px;';
            cancelBtn.onclick = function () { document.body.removeChild(overlay); resolve(null); };
            footer.appendChild(cancelBtn);

            overlay.onclick = function (e) { if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); } };

            box.appendChild(title);
            box.appendChild(list);
            box.appendChild(footer);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    async function vsDoLoadProject(proj) {
        var projName = proj.name || proj.id;

        // 1. Obtener metadata del proyecto (incluye folder_path)
        var folderPath = proj.folder_path || null;
        if (!folderPath) {
            try {
                var metaR = await fetch('/api/projects/' + proj.id);
                if (metaR.ok) { var meta = await metaR.json(); folderPath = (meta.project && meta.project.folder_path) || null; }
            } catch (_) {}
        }

        // 2. Si hay carpeta vinculada, auto-importar JSONs nuevos PRIMERO
        if (folderPath) {
            try {
                if (typeof global.showNotification === 'function')
                    global.showNotification('Sincronizando desde carpeta...', 'info');
                var scanR = await fetch('/api/projects/' + encodeURIComponent(proj.id) + '/folder-scan');
                if (scanR.ok) {
                    var scanData = await scanR.json();
                    var newFiles = (scanData.files || []).filter(function (f) {
                        return !f.already_imported && f.doc_type && !f.error;
                    });
                    if (newFiles.length > 0) {
                        await fetch('/api/projects/' + encodeURIComponent(proj.id) + '/folder-import', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filenames: newFiles.map(function (f) { return f.filename; }) })
                        });
                    }
                }
            } catch (_) { /* silencioso — la carga continúa igual */ }
        }

        // 3. Cargar todos los documentos del proyecto desde la DB
        var docsResp = await fetch('/api/projects/' + proj.id + '/documents');
        if (!docsResp.ok) throw new Error('Error obteniendo documentos (' + docsResp.status + ')');
        var docsData = await docsResp.json();
        var docList  = docsData.documents || [];

        if (!docList.length) {
            vsInitFolderStrip(proj.id, folderPath);
            if (typeof global.showNotification === 'function') {
                global.showNotification('"' + projName + '" cargado — sin documentos todavía. Agregá JSONs a la carpeta ai-docs y volvé a abrir.', 'info');
            } else {
                alert('Proyecto cargado. Aún no tiene documentos. Agregá JSONs a la carpeta ai-docs/ y volvé a cargar.');
            }
            return;
        }

        var loaded = 0, errors = [];
        for (var i = 0; i < docList.length; i++) {
            var docMeta = docList[i];
            try {
                var docResp = await fetch('/api/projects/' + proj.id + '/documents/' + encodeURIComponent(docMeta.doc_type));
                if (!docResp.ok) { errors.push(docMeta.doc_type); continue; }
                var docData  = await docResp.json();
                var content  = docData.document && docData.document.content;
                if (!content || !content.type) { errors.push(docMeta.doc_type + ' (vacío)'); continue; }
                if (content.data && content.data.type && !content.package && !content.secciones) {
                    content = content.data;
                }
                if (typeof global.addPackageDoc === 'function') {
                    global.addPackageDoc(content, { fileName: docMeta.doc_type + '.json' });
                    loaded++;
                }
            } catch (e) { errors.push(docMeta.doc_type); }
        }

        if (typeof global.saveToStorage === 'function') {
            try { await global.saveToStorage(); } catch (_) {}
        }

        vsInitFolderStrip(proj.id, folderPath);
        vsPopulateProjectDocs();

        var sel = document.getElementById('vsProjectDocSelector');
        if (sel && sel.options.length > 1) {
            sel.selectedIndex = 1;
            vsLoadFromProject();
        }

        var msg = loaded + ' doc(s) cargados de "' + projName + '"';
        if (errors.length) msg += ' (' + errors.length + ' error(es): ' + errors.join(', ') + ')';
        if (typeof global.showNotification === 'function') {
            global.showNotification(msg, errors.length ? 'warning' : 'success');
        }
    }

    // ── Crear nuevo proyecto en Suite Validación (con carpeta en disco) ──────
    global.vsNewSVProject = function () {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:999999;display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#111e33;border-radius:12px;padding:28px;width:520px;max-width:94vw;display:flex;flex-direction:column;gap:16px;box-shadow:0 16px 64px rgba(0,0,0,.9);';

        function row(label, el) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
            var lbl = document.createElement('label');
            lbl.style.cssText = 'font-size:11px;color:#6a8aaa;font-weight:600;text-transform:uppercase;letter-spacing:.5px;';
            lbl.textContent = label;
            wrap.appendChild(lbl); wrap.appendChild(el);
            return wrap;
        }
        function input(placeholder, value) {
            var el = document.createElement('input');
            el.type = 'text'; el.value = value || ''; el.placeholder = placeholder;
            el.style.cssText = 'background:#0a1525;color:#c8d8f0;border:1px solid #2a4060;border-radius:6px;padding:9px 12px;font-size:12px;width:100%;box-sizing:border-box;outline:none;';
            return el;
        }

        var title = document.createElement('div');
        title.style.cssText = 'font-size:15px;font-weight:700;color:#e8ecf3;';
        title.textContent = '＋ Nuevo proyecto de validación';

        var inpName   = input('Nombre del proyecto (ej: Validación emqc® — EMQC-001)');
        var inpSys    = input('Sistema a validar (ej: emqc®)');
        var inpFolder = input('Carpeta base en disco (ej: C:\\Users\\fjbon\\OneDrive\\Escritorio\\EMQC_Emara)');

        var hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px;color:#3a6a8a;background:#091522;border-radius:5px;padding:8px 10px;line-height:1.6;';
        hint.innerHTML = 'Se creará: <code style="color:#5a9abf">&lt;carpeta base&gt;/&lt;nombre proyecto&gt;/ai-docs/</code><br>Los JSON que Claude genere van en esa carpeta. Al abrir el proyecto, se importan solos.';

        var errMsg = document.createElement('div');
        errMsg.style.cssText = 'font-size:11px;color:#e07070;display:none;';

        var footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:4px;';

        var btnCancel = document.createElement('button');
        btnCancel.textContent = 'Cancelar';
        btnCancel.style.cssText = 'background:transparent;color:#6a8aaa;border:1px solid #2a3a50;border-radius:6px;padding:8px 18px;font-size:12px;cursor:pointer;';
        btnCancel.onclick = function () { document.body.removeChild(overlay); };

        var btnCreate = document.createElement('button');
        btnCreate.textContent = '✓ Crear proyecto';
        btnCreate.style.cssText = 'background:#0d4a8a;color:#a0d0ff;border:1px solid #1a6aaa;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer;';
        btnCreate.onclick = async function () {
            var name   = inpName.value.trim();
            var sys    = inpSys.value.trim();
            var folder = inpFolder.value.trim();
            if (!name) { errMsg.textContent = '⚠ El nombre es obligatorio.'; errMsg.style.display = 'block'; return; }
            btnCreate.disabled = true; btnCreate.textContent = 'Creando...';
            errMsg.style.display = 'none';
            try {
                var r = await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name,
                        system_name: sys || null,
                        folder_base: folder || null,
                    })
                });
                var data = await r.json();
                if (!data.ok) {
                    errMsg.textContent = '⚠ ' + (data.error || 'Error desconocido');
                    errMsg.style.display = 'block';
                    btnCreate.disabled = false; btnCreate.textContent = '✓ Crear proyecto';
                    return;
                }
                document.body.removeChild(overlay);
                // Cargar el nuevo proyecto
                await vsDoLoadProject({ id: data.id, name: name, folder_path: data.folder_path });
                if (typeof global.showNotification === 'function') {
                    var msg = 'Proyecto "' + name + '" creado.';
                    if (data.folder_path) msg += ' Carpeta: ' + data.folder_path;
                    global.showNotification(msg, 'success');
                }
            } catch (e) {
                errMsg.textContent = '⚠ Error: ' + e.message;
                errMsg.style.display = 'block';
                btnCreate.disabled = false; btnCreate.textContent = '✓ Crear proyecto';
            }
        };

        footer.appendChild(btnCancel); footer.appendChild(btnCreate);
        box.appendChild(title);
        box.appendChild(row('Nombre del proyecto', inpName));
        box.appendChild(row('Sistema a validar', inpSys));
        box.appendChild(row('Carpeta base en disco (opcional)', inpFolder));
        box.appendChild(hint);
        box.appendChild(errMsg);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        setTimeout(function () { inpName.focus(); }, 50);
    };

    // Carga silenciosa del proyecto activo desde el servidor.
    // Excluye proyectos demo. Si queda 1 proyecto, lo carga directamente;
    // si quedan múltiples, muestra el picker para que el usuario elija.
    global.vsAutoLoadProjectDocs = async function () {
        try {
            var listResp = await fetch('/api/projects');
            if (!listResp.ok) return;
            var listData = await listResp.json();
            var projects = (listData.projects || listData.data || []).filter(function (p) {
                return !/^__demo/.test(p.name || p.id || '');
            });
            if (projects.length === 0) return;
            var chosen = projects.length === 1 ? projects[0] : await vsShowProjectPicker(projects);
            if (!chosen) return;
            await vsDoLoadProject(chosen);
        } catch (_) { /* silencioso */ }
    };

    global.vsLoadProjectFromServer = async function () {
        try {
            var listResp = await fetch('/api/projects');
            if (!listResp.ok) throw new Error('No se pudo conectar al servidor (' + listResp.status + ')');
            var listData = await listResp.json();
            var projects = listData.projects || listData.data || [];
            if (!projects.length) {
                alert('No hay proyectos en el servidor.');
                return;
            }

            // Auto-cargar si hay exactamente 1 proyecto con nombre real
            var realProjects = projects.filter(function (p) {
                return !/^proj_|^__demo/.test(p.name || p.id || '');
            });
            var chosen = (realProjects.length === 1) ? realProjects[0] : await vsShowProjectPicker(projects);
            if (!chosen) return;

            await vsDoLoadProject(chosen);
        } catch (err) {
            alert('Error al cargar desde el servidor:\n' + err.message);
        }
    };

    // ====================================================================
    // CARPETA VINCULADA — sincronización desde disco
    // ====================================================================

    var _activeSrvProjectId = null;  // ID del proyecto del servidor actualmente cargado

    function vsInitFolderStrip(projectId, folderPath) {
        _activeSrvProjectId = projectId;
        var strip     = document.getElementById('vsFolderSyncStrip');
        var pathLabel = document.getElementById('vsFolderPathLabel');
        var btnVincular = document.getElementById('vsBtnVincularCarpeta');

        if (strip) {
            if (folderPath) {
                if (pathLabel) pathLabel.textContent = folderPath;
                strip.style.display = 'flex';
                if (btnVincular) { btnVincular.textContent = '📁 Cambiar carpeta'; btnVincular.style.opacity = '1'; }
            } else {
                strip.style.display = 'none';
                if (btnVincular) { btnVincular.textContent = '📁 Vincular carpeta'; btnVincular.style.opacity = '1'; }
            }
        }
    }

    global.vsSetProjectFolder = function () {
        if (!_activeSrvProjectId) {
            if (typeof global.showNotification === 'function') {
                global.showNotification('Primero cargá un proyecto desde el servidor.', 'warning');
            } else {
                alert('Primero cargá un proyecto desde el servidor.');
            }
            return;
        }
        var currentLabel = document.getElementById('vsFolderPathLabel');
        var currentPath = currentLabel ? currentLabel.textContent.trim() : '';

        // Modal propio (sin prompt nativo)
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:999999;display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#111e33;border-radius:10px;padding:24px;width:560px;max-width:94vw;display:flex;flex-direction:column;gap:14px;box-shadow:0 12px 48px rgba(0,0,0,.8);';

        var title = document.createElement('div');
        title.style.cssText = 'font-size:14px;font-weight:700;color:#e8ecf3;';
        title.textContent = '📁 Vincular carpeta al proyecto';

        var desc = document.createElement('div');
        desc.style.cssText = 'font-size:12px;color:#6a8aaa;line-height:1.5;';
        desc.textContent = 'El servidor va a leer esta carpeta al sincronizar. Ingresá la ruta completa donde guardás los JSON del proyecto (ai-docs).';

        var input = document.createElement('input');
        input.type = 'text';
        input.value = currentPath;
        input.placeholder = 'C:\\Users\\fjbon\\OneDrive\\Escritorio\\EMQC_Emara\\Proyecto demo 1 - Emara\\ai-docs';
        input.style.cssText = 'background:#0a1525;color:#c8d8f0;border:1px solid #2a4060;border-radius:6px;padding:9px 12px;font-size:12px;font-family:monospace;width:100%;box-sizing:border-box;outline:none;';

        var errMsg = document.createElement('div');
        errMsg.style.cssText = 'font-size:11px;color:#e07070;display:none;';

        var footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

        var btnCancelar = document.createElement('button');
        btnCancelar.textContent = 'Cancelar';
        btnCancelar.style.cssText = 'background:transparent;color:#6a8aaa;border:1px solid #2a3a50;border-radius:6px;padding:7px 16px;font-size:12px;cursor:pointer;';
        btnCancelar.onclick = function () { document.body.removeChild(overlay); };

        var btnOk = document.createElement('button');
        btnOk.textContent = 'Vincular';
        btnOk.style.cssText = 'background:#0d4a8a;color:#a0d0ff;border:1px solid #1a6aaa;border-radius:6px;padding:7px 18px;font-size:12px;font-weight:700;cursor:pointer;';
        btnOk.onclick = async function () {
            var newPath = input.value.trim();
            errMsg.style.display = 'none';
            btnOk.disabled = true; btnOk.textContent = 'Guardando...';
            try {
                var r = await fetch('/api/projects/' + encodeURIComponent(_activeSrvProjectId) + '/folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folder_path: newPath })
                });
                var data = await r.json();
                if (!data.ok) {
                    errMsg.textContent = '⚠ ' + (data.error || 'Error desconocido');
                    errMsg.style.display = 'block';
                    btnOk.disabled = false; btnOk.textContent = 'Vincular';
                    return;
                }
                document.body.removeChild(overlay);
                vsInitFolderStrip(_activeSrvProjectId, newPath || null);
                if (typeof global.showNotification === 'function') {
                    global.showNotification(newPath ? 'Carpeta vinculada. Usá "🔄 Sincronizar" para importar los JSONs.' : 'Carpeta desvinculada.', 'success');
                }
            } catch (e) {
                errMsg.textContent = '⚠ Error de red: ' + e.message;
                errMsg.style.display = 'block';
                btnOk.disabled = false; btnOk.textContent = 'Vincular';
            }
        };

        // Enter confirma
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btnOk.click(); });

        footer.appendChild(btnCancelar);
        footer.appendChild(btnOk);
        box.appendChild(title);
        box.appendChild(desc);
        box.appendChild(input);
        box.appendChild(errMsg);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        setTimeout(function () { input.focus(); input.select(); }, 50);
    };

    global.vsSyncFromFolder = async function () {
        if (!_activeSrvProjectId) return;
        var btn = document.getElementById('vsBtnSyncFolder');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Escaneando...'; }

        try {
            var r = await fetch('/api/projects/' + encodeURIComponent(_activeSrvProjectId) + '/folder-scan');
            var data = await r.json();
            if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizar'; }
            if (!data.ok) { alert('Error: ' + data.error); return; }
            if (!data.files || !data.files.length) {
                alert('La carpeta está vacía o no contiene archivos JSON.');
                return;
            }
            _vsShowFolderSyncOverlay(data.folder_path, data.files);
        } catch (e) {
            if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizar'; }
            alert('Error al escanear carpeta: ' + e.message);
        }
    };

    function _vsShowFolderSyncOverlay(folderPath, files) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#111e33;border-radius:12px;padding:24px;min-width:480px;max-width:660px;width:94%;max-height:80vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 12px 48px rgba(0,0,0,.7);';

        var title = document.createElement('div');
        title.style.cssText = 'font-size:15px;font-weight:700;color:#e8ecf3;';
        title.textContent = '📁 Archivos en la carpeta vinculada';

        var pathEl = document.createElement('div');
        pathEl.style.cssText = 'font-size:10px;font-family:monospace;color:#4a7a9a;background:#0a1525;padding:5px 8px;border-radius:4px;word-break:break-all;';
        pathEl.textContent = folderPath;

        var newFiles = files.filter(function (f) { return !f.already_imported && f.doc_type && !f.error; });
        var summary = document.createElement('div');
        summary.style.cssText = 'font-size:12px;color:#7a9abf;';
        summary.textContent = files.length + ' archivo(s) encontrado(s) · ' + newFiles.length + ' nuevo(s) sin importar';

        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:5px;overflow-y:auto;max-height:320px;';

        files.forEach(function (f) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;background:' +
                (f.already_imported ? '#0d2010' : f.error ? '#1a0a0a' : '#0d1e35') + ';border:1px solid ' +
                (f.already_imported ? '#1a4020' : f.error ? '#3a1010' : '#1a3050') + ';';

            var badge = document.createElement('span');
            badge.style.cssText = 'font-size:11px;font-weight:700;min-width:38px;color:' +
                (f.already_imported ? '#4a9a60' : f.error ? '#9a4040' : '#5a9adf') + ';';
            badge.textContent = f.doc_type || '??';

            var fname = document.createElement('span');
            fname.style.cssText = 'flex:1;font-size:11px;font-family:monospace;color:#8098b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            fname.textContent = f.filename;

            var right = document.createElement('span');
            right.style.cssText = 'font-size:11px;';
            if (f.error) {
                right.style.color = '#9a4040';
                right.textContent = '⚠ error';
            } else if (f.already_imported) {
                right.style.color = '#4a9a60';
                right.textContent = '✓ ya importado';
            } else {
                var btnImp = document.createElement('button');
                btnImp.style.cssText = 'background:#0d3a6a;color:#7ab8f7;border:1px solid #1a5280;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;';
                btnImp.textContent = '↓ Importar';
                btnImp.onclick = async function () {
                    btnImp.disabled = true; btnImp.textContent = '⏳';
                    await _vsImportFolderFiles([f.filename]);
                    f.already_imported = true;
                    right.style.color = '#4a9a60'; right.textContent = '✓ importado';
                    row.style.background = '#0d2010'; row.style.borderColor = '#1a4020';
                    badge.style.color = '#4a9a60';
                };
                right.appendChild(btnImp);
            }

            if (f.version) {
                var verEl = document.createElement('span');
                verEl.style.cssText = 'font-size:10px;color:#4a6a8a;';
                verEl.textContent = 'v' + f.version;
                row.appendChild(badge); row.appendChild(fname); row.appendChild(verEl); row.appendChild(right);
            } else {
                row.appendChild(badge); row.appendChild(fname); row.appendChild(right);
            }
            list.appendChild(row);
        });

        var footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:4px;';

        if (newFiles.length > 0) {
            var btnAll = document.createElement('button');
            btnAll.style.cssText = 'background:#0d4a8a;color:#a0d0ff;border:1px solid #1a6aaa;border-radius:6px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer;';
            btnAll.textContent = '↓ Importar todos los nuevos (' + newFiles.length + ')';
            btnAll.onclick = async function () {
                btnAll.disabled = true; btnAll.textContent = '⏳ Importando...';
                var count = await _vsImportFolderFiles(newFiles.map(function (f) { return f.filename; }));
                document.body.removeChild(overlay);
                if (typeof global.showNotification === 'function') {
                    global.showNotification(count + ' documento(s) importado(s) desde la carpeta.', 'success');
                }
                vsPopulateProjectDocs();
            };
            footer.appendChild(btnAll);
        }

        var btnClose = document.createElement('button');
        btnClose.style.cssText = 'background:transparent;color:#6a8aaa;border:1px solid #2a3a50;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;';
        btnClose.textContent = 'Cerrar';
        btnClose.onclick = function () { document.body.removeChild(overlay); };
        footer.appendChild(btnClose);

        box.appendChild(title);
        box.appendChild(pathEl);
        box.appendChild(summary);
        box.appendChild(list);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    async function _vsImportFolderFiles(filenames) {
        try {
            var r = await fetch('/api/projects/' + encodeURIComponent(_activeSrvProjectId) + '/folder-import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: filenames })
            });
            var data = await r.json();
            if (!data.ok) { alert('Error al importar: ' + (data.error || 'desconocido')); return 0; }
            // Recargar docs en el paquete activo
            var ok = data.results ? data.results.filter(function (r) { return r.ok; }) : [];
            for (var i = 0; i < ok.length; i++) {
                try {
                    var docR = await fetch('/api/projects/' + encodeURIComponent(_activeSrvProjectId) + '/documents/' + encodeURIComponent(ok[i].doc_type));
                    if (!docR.ok) continue;
                    var docData = await docR.json();
                    var content = docData.document && docData.document.content;
                    if (!content || !content.type) continue;
                    if (content.data && content.data.type && !content.package && !content.secciones) content = content.data;
                    if (typeof global.addPackageDoc === 'function') global.addPackageDoc(content, { fileName: ok[i].doc_type + '.json' });
                } catch (_) {}
            }
            if (typeof global.saveToStorage === 'function') { try { await global.saveToStorage(); } catch (_) {} }
            vsPopulateProjectDocs();
            return ok.length;
        } catch (e) {
            alert('Error: ' + e.message);
            return 0;
        }
    }

    // ====================================================================
    // GENERAR PREVIEW PDF
    // ====================================================================
    global.vsRenderPreview = async function () {
        if (isRendering) return; // evitar doble render
        if (!lastValidJSON) {
            alert('JSON invalido. Corregir errores antes de generar preview.');
            return;
        }

        const VS = global.ValidationSuite;
        if (!VS || !VS.renderDocument) {
            alert('ValidationSuite no esta cargado correctamente.');
            return;
        }

        const previewStatus = document.getElementById('vsPreviewStatus');
        const previewStats = document.getElementById('vsPreviewStats');
        const previewFrame = document.getElementById('vsPreviewFrame');
        const previewEmpty = document.getElementById('vsPreviewEmpty');

        isRendering = true;
        if (previewStatus) {
            previewStatus.textContent = 'Generando PDF...';
            previewStatus.className = 'vs-status-bar';
        }

        const startTime = Date.now();

        try {
            // Renderear sin descargar (queremos el blob para el iframe)
            const blob = await VS.renderDocument(lastValidJSON, { download: false });

            // Limpiar URL anterior si existe
            if (lastBlobUrl) {
                try { URL.revokeObjectURL(lastBlobUrl); } catch (e) { }
            }

            lastBlobUrl = URL.createObjectURL(blob);

            if (previewFrame && previewEmpty) {
                previewFrame.src = lastBlobUrl;
                previewFrame.style.display = 'block';
                previewEmpty.style.display = 'none';
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const sizeKB = (blob.size / 1024).toFixed(0);

            if (previewStatus) {
                previewStatus.textContent = `PDF generado en ${elapsed}s (${sizeKB} KB)`;
                previewStatus.className = 'vs-status-bar vs-status-ok';
            }
            if (previewStats) {
                previewStats.textContent = `${sizeKB} KB · ${elapsed}s`;
            }
        } catch (err) {
            console.error('Error generando PDF:', err);
            if (previewStatus) {
                previewStatus.textContent = 'Error: ' + err.message;
                previewStatus.className = 'vs-status-bar vs-status-error';
            }
            alert('Error generando PDF:\n\n' + err.message);
        } finally {
            isRendering = false;
        }
    };

    // ====================================================================
    // DESCARGAR PDF FINAL
    // ====================================================================
    global.vsDownloadPDF = async function () {
        if (!lastValidJSON) {
            alert('JSON invalido. Corregir errores antes de descargar.');
            return;
        }

        const VS = global.ValidationSuite;
        if (!VS || !VS.renderDocument) {
            alert('ValidationSuite no esta cargado correctamente.');
            return;
        }

        try {
            await VS.renderDocument(lastValidJSON, { download: true });
        } catch (err) {
            console.error('Error descargando PDF:', err);
            alert('Error descargando PDF:\n\n' + err.message);
        }
    };

    // ====================================================================
    // DESCARGAR TODOS LOS PDFs DEL PROYECTO
    // ====================================================================
    global.vsDownloadAllPDFs = async function () {
        const VS = global.ValidationSuite;
        if (!VS || !VS.renderDocument) {
            alert('ValidationSuite no esta cargado correctamente.');
            return;
        }

        const docs = (window.packageDocs || []).filter(d => d.type !== 'PEOPLE' && d.data);
        if (docs.length === 0) {
            alert('No hay documentos cargados en el proyecto activo.');
            return;
        }

        const btn = document.getElementById('vsBtnDownloadAll');
        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Preparando...'; }

        const ok = [];
        const fail = [];

        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            if (btn) btn.textContent = 'Descargando ' + (i + 1) + '/' + docs.length + '...';
            try {
                if (i > 0) await new Promise(r => setTimeout(r, 800));
                await VS.renderDocument(doc.data, { download: true });
                ok.push(doc.code || doc.type);
            } catch (err) {
                console.warn('[vsDownloadAllPDFs] Error en ' + (doc.code || doc.type) + ':', err);
                fail.push(doc.code || doc.type);
            }
        }

        if (btn) { btn.disabled = false; btn.textContent = originalText; }

        alert(
            'Descarga completada.\n\n' +
            ok.length + ' PDFs descargados:\n' + ok.join(', ') +
            (fail.length
                ? '\n\n' + fail.length + ' omitidos (sin renderer o error):\n' + fail.join(', ')
                : '')
        );
    };

    // ====================================================================
    // GENERAR CON IA — EVRA / EVPROT / EVIR (sin archivo Excel)
    // ====================================================================

    const _EV_TYPES = new Set(['EVRA', 'EVPROT', 'EVIR']);

    function vsUpdateEVAIBtn(parsed) {
        const btn = document.getElementById('vsBtnGenEV');
        if (!btn) return;
        btn.style.display = (parsed && _EV_TYPES.has(parsed.type)) ? '' : 'none';
    }

    global.vsOpenEVAIModal = function () {
        const modal = document.getElementById('vsEVAIModal');
        if (!modal) return;
        // Pre-fill desde el doc actual si ya tiene datos
        if (lastValidJSON && lastValidJSON.spreadsheet) {
            const sp = lastValidJSON.spreadsheet;
            const f = document.getElementById('vsEVAIFile');
            const p = document.getElementById('vsEVAIPurpose');
            const d = document.getElementById('vsEVAIDept');
            const r = document.getElementById('vsEVAIResp');
            if (f && sp.fileName)    f.value = sp.fileName;
            if (p && sp.purpose)     p.value = sp.purpose;
            if (d && sp.department)  d.value = sp.department;
            if (r && sp.responsible) r.value = sp.responsible;
        }
        // Título dinámico según tipo
        const titleEl = document.getElementById('vsEVAITitle');
        if (titleEl && lastValidJSON) {
            const labels = { EVRA: 'Evaluación de Riesgo', EVPROT: 'Protocolo de Validación', EVIR: 'Informe de Validación' };
            titleEl.textContent = `Generar ${labels[lastValidJSON.type] || lastValidJSON.type} con IA`;
        }
        modal.style.display = 'flex';
        setTimeout(() => { const t = document.getElementById('vsEVAIDesc'); if (t) t.focus(); }, 50);
    };

    global.vsCloseEVAIModal = function () {
        const modal = document.getElementById('vsEVAIModal');
        if (modal) modal.style.display = 'none';
    };

    global.vsRunEVAIGen = async function () {
        if (!lastValidJSON || !_EV_TYPES.has(lastValidJSON.type)) return;

        const desc     = (document.getElementById('vsEVAIDesc')?.value     || '').trim();
        const fileName = (document.getElementById('vsEVAIFile')?.value     || '').trim();
        const purpose  = (document.getElementById('vsEVAIPurpose')?.value  || '').trim();
        const dept     = (document.getElementById('vsEVAIDept')?.value     || '').trim();
        const resp     = (document.getElementById('vsEVAIResp')?.value     || '').trim();

        if (!desc && !fileName && !purpose) {
            alert('Describí la planilla antes de generar.');
            return;
        }

        const docType = lastValidJSON.type;
        const runBtn  = document.getElementById('vsEVAIRunBtn');
        if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Generando...'; }

        try {
            const VS = global.ValidationSuite;
            const SL = VS && VS.AIGenerator && VS.AIGenerator.SkillLoader;
            const AC = VS && VS.AIGenerator && VS.AIGenerator.ApiClient;
            if (!SL || !AC) throw new Error('AI Generator no está cargado. Verificá que el servidor esté activo.');

            const [skill, lessons] = await Promise.all([SL.loadSkill(docType.toLowerCase()), SL.loadLessonsLearned()]);
            const systemPrompt = lessons ? `${skill}\n\n---\n\n# LECCIONES APRENDIDAS\n\n${lessons}` : skill;

            let userPrompt = `Generá el documento ${docType} para la siguiente planilla de cálculo GxP.\n\n`;
            if (desc)     userPrompt += `## DESCRIPCIÓN DE LA PLANILLA\n${desc}\n\n`;
            if (fileName) userPrompt += `## NOMBRE DEL ARCHIVO\n${fileName}\n\n`;
            if (purpose)  userPrompt += `## PROPÓSITO\n${purpose}\n\n`;
            if (dept)     userPrompt += `## DEPARTAMENTO\n${dept}\n\n`;
            if (resp)     userPrompt += `## RESPONSABLE\n${resp}\n\n`;
            userPrompt += `## CATEGORÍA GAMP 5\nCategoría 4 — Herramienta configurada (planilla con fórmulas)\n\n`;
            userPrompt += `Generá el ${docType} completo con datos realistas y coherentes con la descripción.\nDevolvé únicamente el JSON, sin texto adicional.`;

            const raw = await AC.generate({ systemPrompt, userPrompt });
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) throw new Error('La IA no devolvió un JSON válido.');

            const docJson = JSON.parse(match[0]);

            const editor = document.getElementById('vsJsonEditor');
            if (editor) {
                editor.value = JSON.stringify(docJson, null, 2);
                vsValidateJSONLive();
            }

            global.vsCloseEVAIModal();
        } catch (err) {
            console.error('[vsRunEVAIGen]', err);
            alert('Error al generar:\n\n' + err.message);
        } finally {
            if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Generar'; }
        }
    };

})(window);
