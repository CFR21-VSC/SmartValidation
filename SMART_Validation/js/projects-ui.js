/* ====================================================================
   PROJECTS UI - modal + button + top-bar chip para multi-proyecto.
   Depende de VS.projects (projects-manager.js).
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    if (!VS.projects) {
        console.error('[projects-ui] VS.projects no esta cargado.');
        return;
    }

    // IDs ya sincronizados al servidor en esta sesión — evita re-pushear en cada
    // apertura del modal y previene ráfagas de POSTs grandes (HTTP 429 en Railway).
    const _syncedThisSession = new Set();

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function relativeTime(iso) {
        if (!iso) return 'nunca';
        const then = new Date(iso).getTime();
        const now = Date.now();
        const diff = Math.max(0, now - then);
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'recien';
        if (m < 60) return 'hace ' + m + ' min';
        const h = Math.floor(m / 60);
        if (h < 24) return 'hace ' + h + ' h';
        const d = Math.floor(h / 24);
        if (d < 30) return 'hace ' + d + ' dia' + (d > 1 ? 's' : '');
        return new Date(iso).toLocaleDateString('es-AR');
    }

    // ============== RENDER ==============
    async function refresh() {
        const modal = document.getElementById('modalProyectos');
        if (!modal) return;
        const container = modal.querySelector('#projGrid');
        const headerStats = modal.querySelector('#projStats');
        const activeId = VS.projects.getActiveId();

        try {
            // Paso 1: lista local (IndexedDB) — tiene stats y snapshot frescos
            const localList = await VS.projects.listAll();
            const localMap = new Map(localList.map(p => [p.id, p]));

            // Paso 2: lista del servidor (fuente de verdad) — muestra proyectos de todos los navegadores
            // Se intenta siempre (no gateado por isAvailable), ya que la probe puede no haber
            // completado aún cuando el modal se abre por primera vez.
            let serverList = [];
            if (VS.Storage) {
                try { serverList = (await VS.Storage.listProjects()) || []; } catch (_) {}
            }
            console.log('[projects-ui] serverList:', serverList.length, serverList.map(p => p.id + ' ' + p.name));
            console.log('[projects-ui] localList:', localList.length, localList.map(p => p.id + ' ' + p.name));
            const serverIds = new Set(serverList.map(sp => sp.id));

            // Paso 3: unificar — servidor como base, IndexedDB enriquece con stats
            const merged = serverList.map(sp => {
                const local = localMap.get(sp.id);
                if (local) return local; // IndexedDB tiene snapshot completo + stats
                // Solo en servidor: construir entry mínimo para mostrar la card
                return {
                    id: sp.id,
                    name: sp.name || sp.system_name || sp.id,
                    cliente: sp.cliente || '',
                    sistemaCode: '',
                    sistemaName: sp.system_name || '',
                    gampCat: sp.gamp_category || '',
                    stats: { tests: 0, evidences: 0, protocols: 0, packageDocs: 0, sizeKB: 0 },
                    archived: false,
                    lastOpenedAt: sp.updated_at ? new Date(sp.updated_at * 1000).toISOString() : null,
                };
            });

            // Proyectos solo locales (no están en el servidor aún).
            // Se pushean una sola vez por sesión para no saturar Railway (429).
            const localOnly = localList.filter(p => !serverIds.has(p.id));
            if (VS.Storage && localOnly.length > 0) {
                localOnly
                    .filter(p => p.id && p.snapshot && !p.id.startsWith('__demo') && !_syncedThisSession.has(p.id))
                    .forEach(p => {
                        _syncedThisSession.add(p.id);
                        VS.Storage.syncSnapshot(p.id, p.snapshot, p.name).catch(() => {});
                    });
            }
            const all = [...merged, ...localOnly];

            const activos = all.filter(p => !p.archived);
            const archivados = all.filter(p => p.archived);

            if (headerStats) {
                headerStats.innerHTML =
                    '<span><strong>' + all.length + '</strong> proyecto' + (all.length !== 1 ? 's' : '') + '</span>' +
                    '<span>&middot;</span>' +
                    '<span>' + activos.length + ' activo' + (activos.length !== 1 ? 's' : '') + '</span>' +
                    (archivados.length ? '<span>&middot;</span><span>' + archivados.length + ' archivado' + (archivados.length !== 1 ? 's' : '') + '</span>' : '');
            }

            const cards = all
                .sort((a, b) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0))
                .map(p => renderCard(p, activeId))
                .join('');

            if (all.length === 0) {
                container.innerHTML =
                    '<div class="proj-empty">' +
                    '<div class="proj-empty-title">No hay proyectos todavia</div>' +
                    '<div class="proj-empty-text">Crea tu primer proyecto desde el boton <strong>+ Nuevo proyecto</strong> de arriba a la derecha.</div>' +
                    '</div>';
            } else {
                container.innerHTML = cards;
            }
        } catch (e) {
            container.innerHTML = '<div class="proj-empty"><div class="proj-empty-title">Error</div><div class="proj-empty-text">' + escapeHtml(e.message) + '</div></div>';
        }
    }

    function renderCycleProgress(projectId, totalDocs) {
        if (typeof CycleDashboard === 'undefined') return '';
        const s = CycleDashboard.getCycleStats(projectId, totalDocs);
        if (s.total === 0) return '';

        const t = s.total;
        const wLocked   = Math.round((s.locked   / t) * 100);
        const wApproved = Math.round((s.approved / t) * 100);
        const wReview   = Math.round((s.in_review / t) * 100);
        const wDraft    = Math.max(0, 100 - wLocked - wApproved - wReview);

        let segs = '';
        if (wLocked   > 0) segs += '<div class="proj-cyc-seg proj-cyc-locked"   style="width:' + wLocked   + '%"></div>';
        if (wApproved > 0) segs += '<div class="proj-cyc-seg proj-cyc-approved" style="width:' + wApproved + '%"></div>';
        if (wReview   > 0) segs += '<div class="proj-cyc-seg proj-cyc-review"   style="width:' + wReview   + '%"></div>';
        if (wDraft    > 0) segs += '<div class="proj-cyc-seg proj-cyc-draft"    style="width:' + wDraft    + '%"></div>';

        const parts = [];
        if (s.locked)    parts.push(s.locked    + ' bloq.');
        if (s.approved)  parts.push(s.approved  + ' aprobado' + (s.approved  !== 1 ? 's' : ''));
        if (s.in_review) parts.push(s.in_review + ' en revisión');
        if (s.draft)     parts.push(s.draft     + ' borrador' + (s.draft     !== 1 ? 'es' : ''));

        const label = s.completionPct + '% completo · ' + parts.join(' · ');

        return '<div class="proj-cycle">' +
            '<div class="proj-cyc-bar">' + (segs || '<div class="proj-cyc-seg proj-cyc-draft" style="width:100%"></div>') + '</div>' +
            '<div class="proj-cyc-label">' + escapeHtml(label) + '</div>' +
            '</div>';
    }

    function renderCard(p, activeId) {
        const isActive = (p.id === activeId);
        const stats = p.stats || { tests: 0, evidences: 0, protocols: 0, packageDocs: 0, sizeKB: 0 };
        const archivedBadge = p.archived
            ? '<span class="proj-card-badge proj-badge-archived">Archivado</span>'
            : (isActive ? '<span class="proj-card-badge proj-badge-active">Activo</span>' : '');

        const sistemaLine = (p.sistemaCode || p.sistemaName)
            ? '<div class="proj-card-system">' + escapeHtml(p.sistemaName || '') + ' ' + (p.sistemaCode ? '<code>' + escapeHtml(p.sistemaCode) + '</code>' : '') + '</div>'
            : '<div class="proj-card-system proj-card-empty-line">Sin sistema asignado</div>';

        const clienteLine = p.cliente
            ? '<div class="proj-card-cliente">Cliente: <strong>' + escapeHtml(p.cliente) + '</strong></div>'
            : '';

        const gampBadge = p.gampCat
            ? '<span class="proj-card-gamp">' + escapeHtml(p.gampCat) + '</span>'
            : '';

        const statsLine =
            '<div class="proj-card-stats">' +
            '<span title="Test Cases">TC ' + stats.tests + '</span>' +
            '<span title="Evidencias">EV ' + stats.evidences + '</span>' +
            '<span title="Documentos en paquete">DOC ' + stats.packageDocs + '</span>' +
            '<span title="Tamano del snapshot">' + stats.sizeKB + ' KB</span>' +
            '</div>';

        const cycleProgress = renderCycleProgress(p.id, stats.packageDocs);

        const isDemo = !!p.isDemo;

        const openBtn = isActive
            ? '<button class="proj-btn proj-btn-active-state" disabled>&#10003; Abierto</button>'
            : '<button class="proj-btn proj-btn-primary" onclick="handleProjectSwitch(\'' + p.id + '\')" title="Cerrar el proyecto actual y abrir este">Abrir</button>';

        // Demo: "Abrir" reconstruye desde fixtures (openDemo) para garantizar
        // que los protocolos IQ/OQ/PQ estén siempre presentes.
        const demoOpenBtn = isActive
            ? '<button class="proj-btn proj-btn-active-state" disabled>&#10003; Abierto</button>'
            : '<button class="proj-btn proj-btn-primary" onclick="handleDemoOpen()" title="Reconstruir la demo desde fixtures y abrir">Abrir</button>';

        // Acciones — el proyecto Demo solo permite Abrir / Resetear (no renombrar/borrar/duplicar/archivar).
        let actions;
        if (isDemo) {
            const resetBtn = isActive
                ? '<button class="proj-btn proj-btn-danger" onclick="handleDemoReset()" title="Borrar la demo y recargar los 20 docs del paquete canónico DRP-SIS-001">⟲ Resetear demo</button>'
                : '<button class="proj-btn" onclick="handleDemoReset()" title="Borrar la demo y recargar los 20 docs del paquete canónico DRP-SIS-001">⟲ Resetear demo</button>';
            actions = demoOpenBtn + resetBtn;
        } else {
            const deleteBtn = !isActive
                ? '<button class="proj-btn proj-btn-danger" onclick="handleProjectDelete(\'' + p.id + '\')" title="Eliminar definitivamente">X</button>'
                : '';
            actions = openBtn +
                '<button class="proj-btn" onclick="handleProjectDuplicate(\'' + p.id + '\')" title="Crear copia con un nombre nuevo">Duplicar</button>' +
                '<button class="proj-btn" onclick="handleProjectRename(\'' + p.id + '\')" title="Renombrar">Renombrar</button>' +
                '<button class="proj-btn" onclick="handleProjectExport(\'' + p.id + '\')" title="Descargar copia de seguridad del proyecto">Exportar</button>' +
                '<button class="proj-btn" onclick="handleProjectArchive(\'' + p.id + '\', ' + (!p.archived) + ')" title="' + (p.archived ? 'Desarchivar' : 'Archivar') + '">' + (p.archived ? 'Desarchivar' : 'Archivar') + '</button>' +
                deleteBtn;
        }

        const demoBadge = isDemo
            ? '<span class="proj-card-demo-badge" title="Proyecto de demostración pre-cargado — editable, no contamina tus proyectos reales">DEMO</span>'
            : '';

        return '' +
            '<div class="proj-card ' + (isActive ? 'proj-card-active' : '') + (isDemo ? ' proj-card-demo' : '') + '" data-id="' + p.id + '">' +
                '<div class="proj-card-header">' +
                    '<div class="proj-card-name-row">' +
                        '<div class="proj-card-name" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</div>' +
                        demoBadge +
                        gampBadge +
                    '</div>' +
                    archivedBadge +
                '</div>' +
                clienteLine +
                sistemaLine +
                statsLine +
                cycleProgress +
                '<div class="proj-card-footer">' +
                    '<span class="proj-card-time">Ultima edicion: ' + relativeTime(p.lastOpenedAt) + '</span>' +
                '</div>' +
                '<div class="proj-card-actions">' +
                    actions +
                '</div>' +
            '</div>';
    }

    // ============== OPEN / CLOSE ==============
    async function openProjectsModal() {
        const modal = document.getElementById('modalProyectos');
        if (!modal) { alert('Modal de proyectos no presente.'); return; }
        await refresh();
        modal.style.display = 'flex';
    }
    function closeProjectsModal() {
        const modal = document.getElementById('modalProyectos');
        if (modal) modal.style.display = 'none';
    }

    // ============== ACCIONES ==============
    async function handleProjectSwitch(id) {
        try { await VS.projects.switchTo(id); }
        catch (e) { alert('Error abriendo proyecto: ' + e.message); }
    }

    async function handleProjectDownload(id) {
        try {
            await VS.projects.downloadFromServer(id);
            await VS.projects.switchTo(id);
        } catch (e) {
            alert('Error restaurando proyecto desde el servidor: ' + e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // WIZARD DE CREACIÓN DE PROYECTO (3 pasos)
    // ═══════════════════════════════════════════════════════════════════
    let _wizState = null;

    function handleProjectNew() {
        openWizard();
    }
    // (export global ya está al final del archivo, no duplicar acá)

    function openWizard() {
        const modal = document.getElementById('modalCrearProyectoWizard');
        if (!modal) { alert('Modal del wizard no presente'); return; }
        // Cerrar el modal de Suite Proyectos si está abierto (sino quedan
        // overlappeados y hay que cerrar manualmente el de atrás).
        const projectsModal = document.getElementById('modalProyectos');
        const wasProjectsOpen = projectsModal && projectsModal.style.display !== 'none';
        if (wasProjectsOpen) projectsModal.style.display = 'none';

        _wizState = {
            step: 1,
            data: { name: '', cliente: '', sistemaCode: '', sistemaName: '', gampCat: '', tipoSistema: '' },
            folderHandle: null,    // FileSystemDirectoryHandle elegido por el usuario
            folderName: null,      // nombre de la carpeta física (para display y storagePath)
            _projectsModalWasOpen: wasProjectsOpen
        };
        // Detectar modo online/offline y mostrar panel correcto.
        // Si la probe aún no completó, re-probar y actualizar el panel cuando responda.
        const onlineInfo  = document.getElementById('wizOnlineStorageInfo');
        const offlineInfo = document.getElementById('wizOfflineStorageInfo');
        function _applyStorageMode(online) {
            if (onlineInfo)  onlineInfo.style.display  = online ? 'block' : 'none';
            if (offlineInfo) offlineInfo.style.display = online ? 'none'  : 'block';
        }
        const isOnline = VS.Storage && VS.Storage.isAvailable();
        _applyStorageMode(isOnline);
        // Si aparentemente offline, re-probar una vez para no quedar colgado en el estado inicial
        if (!isOnline && VS.Storage && typeof VS.Storage.listProjects === 'function') {
            VS.Storage.listProjects().then(list => {
                if (list && list.length >= 0) _applyStorageMode(true);
            }).catch(() => {});
        }

        renderWizardStep();
        modal.style.display = 'flex';
        // Focus al primer campo
        setTimeout(() => {
            const n = document.getElementById('wizProjectName');
            if (n) n.focus();
        }, 100);
    }

    function wizardCancel() {
        if (!confirm('Cancelar la creación del proyecto? Se pierden los datos ingresados.')) return;
        const reopenProjects = _wizState && _wizState._projectsModalWasOpen;
        closeWizard();
        // Si veníamos de Suite Proyectos, volver ahí (mejor UX que dejar al usuario
        // sin contexto tras cancelar).
        if (reopenProjects) {
            setTimeout(() => openProjectsModal(), 100);
        }
    }

    function closeWizard() {
        const modal = document.getElementById('modalCrearProyectoWizard');
        if (modal) modal.style.display = 'none';
        _wizState = null;
    }

    function renderWizardStep() {
        if (!_wizState) return;
        const step = _wizState.step;
        // Activar el step content correcto -- wizStep3 (HTML) es el paso 2 visible
        // (el "Equipo de firmantes" intermedio se eliminó 2026-09-02).
        ['wizStep1', 'wizStep3'].forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.style.display = (i + 1 === step) ? 'block' : 'none';
        });
        // Actualizar el stepper visual
        document.querySelectorAll('#modalCrearProyectoWizard .modal-themed-step').forEach(el => {
            const n = parseInt(el.getAttribute('data-step'), 10);
            el.classList.remove('active', 'done');
            if (n < step) el.classList.add('done');
            else if (n === step) el.classList.add('active');
        });
        document.querySelectorAll('#modalCrearProyectoWizard .modal-themed-step-divider').forEach((el, i) => {
            el.classList.toggle('passed', i + 1 < step);
        });
        // Subtitle
        const sub = document.getElementById('wizSubtitle');
        if (sub) {
            const labels = ['Datos del proyecto', 'Confirmar y crear'];
            sub.textContent = 'Paso ' + step + ' de 2 · ' + labels[step - 1];
        }
        // Botones de navegación
        const btnBack = document.getElementById('wizBtnBack');
        const btnNext = document.getElementById('wizBtnNext');
        const btnConfirm = document.getElementById('wizBtnConfirm');
        btnBack.style.display = step > 1 ? '' : 'none';
        btnNext.style.display = step < 2 ? '' : 'none';
        btnConfirm.style.display = step === 2 ? '' : 'none';

        if (step === 2) {
            renderWizardSummary();
        }
    }

    function wizardBack() {
        if (!_wizState || _wizState.step <= 1) return;
        _wizState.step--;
        renderWizardStep();
    }

    function wizardNext() {
        if (!_wizState) return;
        const step = _wizState.step;
        if (step === 1) {
            // Validar y capturar datos
            const name = document.getElementById('wizProjectName').value.trim();
            if (!name) {
                alert('El nombre del proyecto es requerido');
                document.getElementById('wizProjectName').focus();
                return;
            }
            _wizState.data.name = name;
            _wizState.data.cliente = document.getElementById('wizCliente').value.trim();
            _wizState.data.sistemaCode = document.getElementById('wizSistemaCode').value.trim();
            _wizState.data.sistemaName = document.getElementById('wizSistemaName').value.trim();
            _wizState.data.gampCat = document.getElementById('wizGampCat').value;
            _wizState.data.tipoSistema = document.getElementById('wizTipoSistema').value;
        }
        if (_wizState.step < 2) _wizState.step++;
        renderWizardStep();
    }

    function renderWizardSummary() {
        const d = _wizState.data;
        const sumEl = document.getElementById('wizSummary');
        if (!sumEl) return;
        const rows = [];
        rows.push(['Nombre', d.name]);
        if (d.cliente) rows.push(['Cliente', d.cliente]);
        if (d.sistemaName) rows.push(['Sistema', d.sistemaName]);
        if (d.sistemaCode) rows.push(['Código', '<code>' + escapeHtml(d.sistemaCode) + '</code>']);
        if (d.gampCat) rows.push(['Categoría GAMP', d.gampCat]);
        if (d.tipoSistema) rows.push(['Tipo', d.tipoSistema]);
        rows.push(['Documentos iniciales', 'HLRA · VP · URS · RA · IRA (5 templates)']);
        sumEl.innerHTML = rows.map(([label, val]) =>
            '<div class="wiz-summary-row"><div class="wiz-summary-label">' + label + '</div><div class="wiz-summary-value">' + val + '</div></div>'
        ).join('');
    }

    async function wizardPickFolder() {
        const FS = VS.ProjectFolderFS;
        if (!FS || !FS.isSupported()) {
            alert('Tu navegador no soporta la selección de carpetas. Usá Chrome 86+.');
            return;
        }
        const nameInput = document.getElementById('wizProjectName');
        const projectName = (nameInput && nameInput.value.trim()) || 'nuevo-proyecto';
        try {
            const btn = document.getElementById('wizFolderBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Seleccionando…'; }
            // Usamos un projectId temporal — el handle real se guardará en createNew()
            const result = await FS.pickAndSetup('__pending__', projectName);
            _wizState.folderHandle = result.handle;
            _wizState.folderName   = result.folderName;
            const nameEl    = document.getElementById('wizFolderName');
            const previewEl = document.getElementById('wizFolderPreview');
            if (nameEl)    nameEl.textContent = result.folderName;
            if (nameEl)    nameEl.style.cssText = 'font-size:12px;color:#2E7D32;font-weight:600;font-style:normal;';
            if (previewEl) previewEl.textContent = result.folderName + '/ai-docs · fuente · fotos · exports';
            if (btn) { btn.disabled = false; btn.textContent = '✓ ' + result.folderName; btn.style.color = '#2E7D32'; }
        } catch (e) {
            const btn = document.getElementById('wizFolderBtn');
            if (btn) { btn.disabled = false; btn.textContent = 'Elegir carpeta'; }
            if (e.name !== 'AbortError') alert('Error al seleccionar carpeta: ' + e.message);
        }
    }

    async function wizardConfirm() {
        if (!_wizState) return;
        const btn = document.getElementById('wizBtnConfirm');
        btn.disabled = true;
        btn.textContent = 'Creando...';
        try {
            const d = _wizState.data;
            const systemInfo = {
                empresa: '', cliente: d.cliente, nombreSistema: d.sistemaName,
                codigoSistema: d.sistemaCode || ('SYS-' + Date.now().toString().slice(-6)),
                versionSistema: '', categoriaGamp: d.gampCat, tipoSistema: d.tipoSistema,
                proveedor: '', revisor: '', aprobador: '', auditor: '',
                fechaInicio: '', fechaCierre: '', notasProyecto: ''
            };
            await VS.projects.createNew({
                name: d.name,
                systemInfo,
                folderHandle: _wizState.folderHandle || null,
                storagePath:  _wizState.folderName   || null,
            });
            // createNew() recarga la página; no llegamos acá normalmente.
        } catch (e) {
            alert('Error creando proyecto: ' + e.message);
            btn.disabled = false;
            btn.textContent = '✓ Crear proyecto';
        }
    }

    // ── Editar proyecto activo ────────────────────────────────────────

    function openEditProject() {
        const modal = document.getElementById('modalEditProject');
        if (!modal) return;
        const snap     = JSON.parse(localStorage.getItem('vscTestsData_v3') || '{}');
        const si       = snap.systemInfo || {};
        const projName = document.querySelector('.proj-chip-name');

        document.getElementById('epName').value        = (projName && projName.textContent !== '—') ? projName.textContent : '';
        document.getElementById('epCliente').value     = si.cliente        || '';
        document.getElementById('epSistemaCode').value = si.codigoSistema  || '';
        document.getElementById('epSistemaName').value = si.nombreSistema  || '';
        document.getElementById('epGampCat').value     = si.categoriaGamp  || '';
        document.getElementById('epTipoSistema').value = si.tipoSistema    || '';
        document.getElementById('epEmpresa').value     = si.empresa        || '';
        document.getElementById('epProveedor').value   = si.proveedor      || '';
        document.getElementById('epVersion').value     = si.versionSistema || '';

        modal.style.display = 'flex';
    }

    function closeEditProject() {
        const modal = document.getElementById('modalEditProject');
        if (modal) modal.style.display = 'none';
    }

    async function saveEditProject() {
        const snap = JSON.parse(localStorage.getItem('vscTestsData_v3') || '{}');
        if (!snap.systemInfo) snap.systemInfo = {};
        const si = snap.systemInfo;
        si.cliente        = document.getElementById('epCliente').value.trim();
        si.codigoSistema  = document.getElementById('epSistemaCode').value.trim();
        si.nombreSistema  = document.getElementById('epSistemaName').value.trim();
        si.categoriaGamp  = document.getElementById('epGampCat').value;
        si.tipoSistema    = document.getElementById('epTipoSistema').value;
        si.empresa        = document.getElementById('epEmpresa').value.trim();
        si.proveedor      = document.getElementById('epProveedor').value.trim();
        si.versionSistema = document.getElementById('epVersion').value.trim();
        snap.lastSaved    = new Date().toISOString();
        localStorage.setItem('vscTestsData_v3', JSON.stringify(snap));

        // Actualizar nombre del proyecto en IndexedDB
        const newName = document.getElementById('epName').value.trim();
        try {
            await VS.projects.saveCurrentToActive();
            const activeId = VS.projects.getActiveId();
            if (activeId && newName) {
                const entry = await VS.projects.get(activeId);
                if (entry) { entry.name = newName; await VS.projects._dbPut && VS.projects._dbPut(entry); }
            }
        } catch (e) { console.warn('[editProject] saveCurrentToActive falló:', e); }

        closeEditProject();
        if (typeof refreshActiveProjectChip === 'function') setTimeout(refreshActiveProjectChip, 100);
        if (typeof showNotification === 'function') showNotification('Proyecto actualizado', 'success');
        // Refrescar chips del header
        if (typeof updateSystemInfoChips === 'function') updateSystemInfoChips();
        else if (typeof refreshChips === 'function') refreshChips();
    }

    // Globals para los onclick del HTML
    global.openEditProject  = openEditProject;
    async function epForceSyncServer(btn) {
        if (!VS.projects.forceSyncToServer) {
            alert('Función no disponible en esta versión.');
            return;
        }
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Subiendo…';
        try {
            const result = await VS.projects.forceSyncToServer();
            btn.textContent = '✓ Subido';
            btn.style.color = '#2E7D32';
            setTimeout(() => { btn.textContent = orig; btn.style.color = ''; btn.disabled = false; }, 3000);
        } catch (e) {
            btn.textContent = '✗ Error: ' + e.message;
            btn.style.color = '#C62828';
            setTimeout(() => { btn.textContent = orig; btn.style.color = ''; btn.disabled = false; }, 4000);
        }
    }

    global.closeEditProject = closeEditProject;
    global.saveEditProject  = saveEditProject;
    global.epForceSyncServer = epForceSyncServer;
    global.wizardPickFolder = wizardPickFolder;
    global.wizardCancel = wizardCancel;
    global.wizardBack = wizardBack;
    global.wizardNext = wizardNext;
    global.wizardConfirm = wizardConfirm;

    async function handleProjectDuplicate(id) {
        const entry = await VS.projects.get(id);
        if (!entry) return;
        const name = prompt('Nombre del proyecto duplicado:', entry.name + ' (copia)');
        if (!name) return;
        try {
            await VS.projects.duplicate(id, { name });
            await refresh();
            alert('Proyecto duplicado: ' + name);
        } catch (e) { alert('Error duplicando: ' + e.message); }
    }

    async function handleProjectRename(id) {
        if (id === VS.projects.DEMO_PROJECT_ID) {
            alert('El proyecto Demo no se puede renombrar — es fijo del sistema.');
            return;
        }
        const entry = await VS.projects.get(id);
        if (!entry) return;
        const name = prompt('Nuevo nombre del proyecto:', entry.name);
        if (!name || name === entry.name) return;
        try {
            await VS.projects.rename(id, name);
            await refresh();
            refreshActiveProjectChip();
        } catch (e) { alert('Error renombrando: ' + e.message); }
    }

    async function handleProjectArchive(id, archived) {
        try { await VS.projects.archive(id, archived); await refresh(); }
        catch (e) { alert('Error: ' + e.message); }
    }

    async function handleProjectDelete(id) {
        if (id === VS.projects.DEMO_PROJECT_ID) {
            alert('El proyecto Demo no se puede eliminar — usá "Resetear demo" si querés volver al estado original.');
            return;
        }
        const entry = await VS.projects.get(id);
        if (!entry) return;
        const stats = entry.stats || {};
        const msg = 'Eliminar definitivamente el proyecto "' + entry.name + '"?\n\n' +
                    'Tests: ' + (stats.tests || 0) + ' | Evidencias: ' + (stats.evidences || 0) + '\n\n' +
                    'Esto NO se puede deshacer.';
        if (!confirm(msg)) return;
        try { await VS.projects.deleteProject(id); await refresh(); }
        catch (e) { alert('Error eliminando: ' + e.message); }
    }

    /** Resetear demo: borra y recrea el proyecto demo desde fixtures canónicos. */
    async function handleDemoOpen() {
        try {
            await VS.projects.openDemo();
        } catch (e) { alert('Error abriendo demo: ' + e.message); }
    }

    async function handleDemoReset() {
        if (!confirm('Resetear el proyecto Demo a su estado original?\n\nSe pierden las firmas y modificaciones que hayas hecho al demo. Los demás proyectos no se tocan.')) return;
        try {
            await VS.projects.resetDemo();
            await refresh();
            alert('Proyecto Demo restaurado.');
        } catch (e) { alert('Error reseteando demo: ' + e.message); }
    }

    async function handleProjectExport(id) {
        try { await VS.projects.exportProject(id); }
        catch (e) { alert('Error exportando: ' + e.message); }
    }

    function handleProjectImport() {
        const input = document.getElementById('projImportInput');
        if (input) input.click();
    }

    async function handleProjectImportFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const entry = await VS.projects.importProject(data);
            await refresh();
            alert('Proyecto importado: "' + entry.name + '". Podes abrirlo desde la grilla.');
        } catch (e) { alert('Error importando: ' + e.message); }
    }

    // ============== CHIP TOP-BAR ==============
    async function refreshActiveProjectChip() {
        const chip = document.getElementById('activeProjectChip');
        if (!chip) return;
        try {
            const active = await VS.projects.getActive();
            const label = chip.querySelector('.proj-chip-name');
            if (active) {
                if (label) label.textContent = active.name;
                chip.style.display = '';
                chip.title = 'Proyecto activo: ' + active.name + '\nClick para cambiar de proyecto';
            } else {
                if (label) label.textContent = 'Sin proyecto';
                chip.style.display = '';
                chip.title = 'Sin proyecto activo - click para crear o abrir uno';
            }
        } catch (e) { console.warn('[projects-ui] chip refresh fallo:', e); }
    }

    // ============== EXPORTS ==============
    VS.projectsUI = { openProjectsModal, closeProjectsModal, refresh, refreshActiveProjectChip };

    global.openProjectsModal = openProjectsModal;
    global.closeProjectsModal = closeProjectsModal;
    global.handleProjectSwitch = handleProjectSwitch;
    global.handleProjectNew = handleProjectNew;
    global.handleProjectDuplicate = handleProjectDuplicate;
    global.handleProjectRename = handleProjectRename;
    global.handleProjectArchive = handleProjectArchive;
    global.handleProjectDelete = handleProjectDelete;
    global.handleDemoOpen  = handleDemoOpen;
    global.handleDemoReset = handleDemoReset;
    global.handleProjectDownload = handleProjectDownload;
    global.handleProjectExport = handleProjectExport;
    global.handleProjectImport = handleProjectImport;
    global.handleProjectImportFile = handleProjectImportFile;
    global.refreshActiveProjectChip = refreshActiveProjectChip;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(refreshActiveProjectChip, 200);
        });
    } else {
        setTimeout(refreshActiveProjectChip, 200);
    }

})(window);
