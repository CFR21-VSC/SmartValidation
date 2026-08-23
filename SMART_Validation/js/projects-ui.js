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
            const all = await VS.projects.listAll();

            // Complementar con proyectos que solo existen en el servidor (otro navegador los guardó)
            let serverOnly = [];
            if (VS.Storage && VS.Storage.isAvailable()) {
                try {
                    const serverList = await VS.Storage.listProjects();
                    const localIds = new Set(all.map(p => p.id));
                    serverOnly = serverList.filter(sp => !localIds.has(sp.id));
                } catch (_) {}
            }

            const activos = all.filter(p => !p.archived);
            const archivados = all.filter(p => p.archived);
            const totalVisible = all.length + serverOnly.length;

            if (headerStats) {
                headerStats.innerHTML =
                    '<span><strong>' + totalVisible + '</strong> proyecto' + (totalVisible !== 1 ? 's' : '') + '</span>' +
                    '<span>&middot;</span>' +
                    '<span>' + activos.length + ' activo' + (activos.length !== 1 ? 's' : '') + '</span>' +
                    (archivados.length ? '<span>&middot;</span><span>' + archivados.length + ' archivado' + (archivados.length !== 1 ? 's' : '') + '</span>' : '') +
                    (serverOnly.length ? '<span>&middot;</span><span style="color:#22d3ee">&#9729; ' + serverOnly.length + ' en servidor</span>' : '');
            }

            const localCards = all
                .sort((a, b) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0))
                .map(p => renderCard(p, activeId))
                .join('');

            const serverCards = serverOnly
                .map(p => renderServerCard(p))
                .join('');

            if (totalVisible === 0) {
                container.innerHTML =
                    '<div class="proj-empty">' +
                    '<div class="proj-empty-title">No hay proyectos todavia</div>' +
                    '<div class="proj-empty-text">Crea tu primer proyecto desde el boton <strong>+ Nuevo proyecto</strong> de arriba a la derecha.</div>' +
                    '</div>';
            } else {
                container.innerHTML = localCards + serverCards;
            }
        } catch (e) {
            container.innerHTML = '<div class="proj-empty"><div class="proj-empty-title">Error</div><div class="proj-empty-text">' + escapeHtml(e.message) + '</div></div>';
        }
    }

    function renderServerCard(p) {
        const name = escapeHtml(p.name || p.id);
        const sistema = escapeHtml(p.system_name || '');
        const cliente = escapeHtml(p.cliente || '');
        return '<div class="proj-card" style="border-color:#0e7490;opacity:.9;" data-id="' + escapeHtml(p.id) + '">' +
            '<div class="proj-card-header">' +
            '<div class="proj-card-name-row">' +
            '<div class="proj-card-name" title="' + name + '">' + name + '</div>' +
            '<span class="proj-card-badge" style="background:#164e63;color:#22d3ee;border:1px solid #0e7490">&#9729; Solo en servidor</span>' +
            '</div></div>' +
            (cliente ? '<div class="proj-card-cliente">Cliente: <strong>' + cliente + '</strong></div>' : '') +
            (sistema ? '<div class="proj-card-system">' + sistema + '</div>' : '<div class="proj-card-system proj-card-empty-line">Sin sistema asignado</div>') +
            '<div class="proj-card-footer"><span class="proj-card-time">Disponible para restaurar</span></div>' +
            '<div class="proj-card-actions">' +
            '<button class="proj-btn proj-btn-primary" onclick="handleProjectDownload(\'' + escapeHtml(p.id) + '\')">&#9729; Restaurar</button>' +
            '</div></div>';
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
    let _wizSignerCanvas = null;
    let _wizMobileSigToken = null;
    let _wizMobileSigPoll = null;

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
            signers: [],           // [{ nombre, rol, iniciales, email, pin, firmaImage }]
            folderHandle: null,    // FileSystemDirectoryHandle elegido por el usuario
            folderName: null,      // nombre de la carpeta física (para display y storagePath)
            _projectsModalWasOpen: wasProjectsOpen
        };
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
        cleanupMobileSigPoll();
        if (_wizSignerCanvas) { try { _wizSignerCanvas.detach(); } catch (e) {} _wizSignerCanvas = null; }
        _wizState = null;
    }

    function renderWizardStep() {
        if (!_wizState) return;
        const step = _wizState.step;
        // Activar el step content correcto
        ['wizStep1', 'wizStep2', 'wizStep3'].forEach((id, i) => {
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
            const labels = ['Datos del proyecto', 'Equipo de firmantes', 'Confirmar y crear'];
            sub.textContent = 'Paso ' + step + ' de 3 · ' + labels[step - 1];
        }
        // Botones de navegación
        const btnBack = document.getElementById('wizBtnBack');
        const btnSkip = document.getElementById('wizBtnSkipSigners');
        const btnNext = document.getElementById('wizBtnNext');
        const btnConfirm = document.getElementById('wizBtnConfirm');
        btnBack.style.display = step > 1 ? '' : 'none';
        btnSkip.style.display = step === 2 ? '' : 'none';
        btnNext.style.display = step < 3 ? '' : 'none';
        btnConfirm.style.display = step === 3 ? '' : 'none';

        // Setup específico por paso
        if (step === 2) {
            setupWizardSignerCanvas();
            renderWizardSignerList();
        }
        if (step === 3) {
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
        if (_wizState.step < 3) _wizState.step++;
        renderWizardStep();
    }

    function setupWizardSignerCanvas() {
        const canvas = document.getElementById('wizSignerCanvas');
        if (!canvas) return;
        if (_wizSignerCanvas) { try { _wizSignerCanvas.detach(); } catch (e) {} }
        _wizSignerCanvas = global.SignatureCanvas.attach(canvas, {
            color: '#1F3C56',
            lineWidth: 2.8
        });
    }

    function wizardClearCanvas() {
        if (_wizSignerCanvas) _wizSignerCanvas.clear();
    }

    async function wizardAddSigner() {
        const errEl = document.getElementById('wizSignerError');
        errEl.style.display = 'none';
        const nombre = document.getElementById('wizSignerName').value.trim();
        const rol = document.getElementById('wizSignerRole').value.trim();
        const iniciales = document.getElementById('wizSignerInitials').value.trim();
        const email = document.getElementById('wizSignerEmail').value.trim();
        const pin = document.getElementById('wizSignerPin').value;
        const pin2 = document.getElementById('wizSignerPin2').value;

        if (!nombre) { showWizErr('Nombre requerido'); return; }
        if (!rol) { showWizErr('Rol requerido'); return; }
        if (!pin || pin.length < 4) { showWizErr('PIN mínimo 4 caracteres'); return; }
        if (pin !== pin2) { showWizErr('Los PINs no coinciden'); return; }
        if (!_wizSignerCanvas || _wizSignerCanvas.isEmpty()) { showWizErr('Garabateá la firma manuscrita en el recuadro'); return; }
        // Validar nombre único en la lista actual
        if (_wizState.signers.some(s => s.nombre.toLowerCase() === nombre.toLowerCase())) {
            showWizErr('Ya hay un firmante con ese nombre en la lista');
            return;
        }
        const firmaImage = _wizSignerCanvas.toDataURL();
        _wizState.signers.push({ nombre, rol, iniciales, email, pin, firmaImage });
        // Reset form
        document.getElementById('wizSignerName').value = '';
        document.getElementById('wizSignerRole').value = '';
        document.getElementById('wizSignerInitials').value = '';
        document.getElementById('wizSignerEmail').value = '';
        document.getElementById('wizSignerPin').value = '';
        document.getElementById('wizSignerPin2').value = '';
        _wizSignerCanvas.clear();
        cleanupMobileSigPoll();
        renderWizardSignerList();
    }

    function showWizErr(msg) {
        const errEl = document.getElementById('wizSignerError');
        errEl.textContent = msg;
        errEl.style.display = 'block';
    }

    function renderWizardSignerList() {
        const list = document.getElementById('wizSignerList');
        const countEl = document.getElementById('wizSignerCount');
        if (!list) return;
        const signers = _wizState.signers;
        countEl.textContent = signers.length;
        if (signers.length === 0) {
            list.innerHTML = '<div style="padding:14px; background:#F4F6F8; border:1.5px dashed #C8D2DC; border-radius:4px; color:#AFBDC8; text-align:center; font-size:12px; font-style:italic;">Aún no agregaste firmantes. Podés saltearlo y registrarlos después.</div>';
            return;
        }
        list.innerHTML = signers.map((s, i) => {
            const masterBadge = i === 0 ? '<span class="wiz-signer-card-master">Maestro</span>' : '';
            return '<div class="wiz-signer-card">' +
                '<img src="' + s.firmaImage + '" alt="firma" class="wiz-signer-card-firma">' +
                '<div class="wiz-signer-card-info">' +
                    '<div class="wiz-signer-card-name">' + escapeHtml(s.nombre) + ' ' + masterBadge + '</div>' +
                    '<div class="wiz-signer-card-meta"><strong>' + escapeHtml(s.rol || '—') + '</strong> · iniciales: ' + escapeHtml(s.iniciales || autoIniciales(s.nombre)) + (s.email ? ' · ' + escapeHtml(s.email) : '') + '</div>' +
                '</div>' +
                '<button class="wiz-signer-card-remove" onclick="wizardRemoveSigner(' + i + ')">Quitar</button>' +
            '</div>';
        }).join('');
    }

    function autoIniciales(nombre) {
        return (nombre || '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 3).join('');
    }

    function wizardRemoveSigner(idx) {
        if (!_wizState) return;
        _wizState.signers.splice(idx, 1);
        renderWizardSignerList();
    }

    function renderWizardSummary() {
        const d = _wizState.data;
        const signers = _wizState.signers;
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
        rows.push(['Firmantes registrados', signers.length === 0
            ? '<em style="color:#AFBDC8;">Ninguno (podés agregar después)</em>'
            : signers.map((s, i) => escapeHtml(s.nombre) + ' (' + escapeHtml(s.rol) + ')' + (i === 0 ? ' <span style="color:var(--theme-project-main); font-weight:700;">[maestro]</span>' : '')).join('<br>')
        ]);
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
            const signers = _wizState.signers;
            const systemInfo = {
                empresa: '', cliente: d.cliente, nombreSistema: d.sistemaName,
                codigoSistema: d.sistemaCode || ('SYS-' + Date.now().toString().slice(-6)),
                versionSistema: '', categoriaGamp: d.gampCat, tipoSistema: d.tipoSistema,
                proveedor: '', revisor: '', aprobador: '', auditor: '',
                fechaInicio: '', fechaCierre: '', notasProyecto: ''
            };
            // createNew() hace reload, así que persistimos firmantes y carpeta ANTES.
            if (signers.length > 0) {
                localStorage.setItem('vscPendingSigners', JSON.stringify({
                    sistemaCode: systemInfo.codigoSistema,
                    signers: signers.map(s => ({
                        nombre: s.nombre, rol: s.rol, iniciales: s.iniciales,
                        email: s.email, pin: s.pin, firmaImage: s.firmaImage
                    }))
                }));
            }
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

    // ─── Mobile signature capture en el wizard ───
    function cleanupMobileSigPoll() {
        if (_wizMobileSigPoll) { clearInterval(_wizMobileSigPoll); _wizMobileSigPoll = null; }
        _wizMobileSigToken = null;
        const panel = document.getElementById('wizMobileQrPanel');
        if (panel) panel.style.display = 'none';
    }

    async function wizardMobileCapture() {
        try {
            let serverIp = 'localhost';
            try {
                const r = await fetch('/sync/info');
                if (r.ok) { const info = await r.json(); serverIp = info.ip || 'localhost'; }
            } catch (e) {}
            const port = window.location.port || '8080';
            // Registrar en el server — el server genera el token (VULN-02: ignorar token del cliente)
            const reg = await fetch('/sync/signature/register', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!reg.ok) throw new Error('No se pudo registrar token en el server');
            const regData = await reg.json();
            _wizMobileSigToken = regData.token;   // token generado por el server
            const url = 'http://' + serverIp + ':' + port + '/?sigtoken=' + _wizMobileSigToken;
            const panel = document.getElementById('wizMobileQrPanel');
            document.getElementById('wizMobileQrUrl').textContent = url;
            _renderQrToImg(document.getElementById('wizMobileQrImg'), url, 200);
            panel.style.display = 'block';
            _wizMobileSigPoll = setInterval(async () => {
                try {
                    const r = await fetch('/sync/signature/' + _wizMobileSigToken);
                    if (!r.ok) return;
                    const data = await r.json();
                    if (data.firmaImage && _wizSignerCanvas) {
                        await _wizSignerCanvas.loadDataURL(data.firmaImage);
                        cleanupMobileSigPoll();
                    }
                } catch (e) {}
            }, 2000);
        } catch (e) {
            alert('Error iniciando captura móvil: ' + e.message);
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

        epLoadSigners();
        modal.style.display = 'flex';
    }

    function closeEditProject() {
        const modal = document.getElementById('modalEditProject');
        if (modal) modal.style.display = 'none';
    }

    function epSwitchTab(tabId) {
        document.querySelectorAll('.ep-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        ['epTabDatos', 'epTabFirmantes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = id === tabId ? '' : 'none';
        });
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

    async function epLoadSigners() {
        const listEl = document.getElementById('epSignerList');
        if (!listEl) return;
        try {
            const PM = window.PeopleManager;
            if (!PM || typeof PM.list !== 'function') {
                listEl.innerHTML = '<p style="color:#9AABB8;font-size:12px;text-align:center;padding:16px 0;">PeopleManager no disponible — gestioná firmantes desde Suite Comparación &amp; Firma.</p>';
                return;
            }
            const pkgCode = PM.getPackageCode ? PM.getPackageCode() : null;
            const signers = pkgCode ? (await PM.list(pkgCode) || []) : [];
            if (!signers.length) {
                listEl.innerHTML = '<p style="color:#9AABB8;font-size:12px;text-align:center;padding:8px 0;">Sin firmantes registrados aún.</p>';
            } else {
                listEl.innerHTML = signers.map(s =>
                    `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#F8F9FB;border:1px solid #EEF3F4;border-radius:5px;margin-bottom:6px;">
                        <div style="width:32px;height:32px;border-radius:50%;background:#213B50;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${(s.iniciales||s.nombre||'?').slice(0,2).toUpperCase()}</div>
                        <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:13px;">${s.nombre||''}</div><div style="font-size:11px;color:#7A8EA0;">${s.rol||''}</div></div>
                    </div>`
                ).join('');
            }
        } catch (e) {
            listEl.innerHTML = `<p style="color:#A52A2A;font-size:12px;">Error cargando firmantes: ${e.message}</p>`;
        }
    }

    async function epAddSigner() {
        const err = document.getElementById('epSignerErr');
        const hide = () => { if (err) err.style.display = 'none'; };
        const show = msg => { if (err) { err.textContent = msg; err.style.display = 'block'; } };
        hide();

        const nombre    = document.getElementById('epSignerName').value.trim();
        const rol       = document.getElementById('epSignerRole').value.trim();
        const iniciales = document.getElementById('epSignerInitials').value.trim().toUpperCase() ||
                          nombre.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();
        const email     = document.getElementById('epSignerEmail').value.trim();
        const pin       = document.getElementById('epSignerPin').value;
        const pin2      = document.getElementById('epSignerPin2').value;

        if (!nombre)        return show('El nombre es requerido.');
        if (!rol)           return show('El rol es requerido.');
        if (pin.length < 4) return show('El PIN debe tener al menos 4 caracteres.');
        if (pin !== pin2)   return show('Los PINs no coinciden.');

        const PM = window.PeopleManager;
        if (!PM || typeof PM.add !== 'function') return show('PeopleManager no disponible.');
        const pkgCode = PM.getPackageCode ? PM.getPackageCode() : null;
        if (!pkgCode) return show('No hay proyecto activo con código de sistema definido.');

        try {
            await PM.add(pkgCode, { nombre, rol, iniciales, email, firmaImage: null }, pin);
            ['epSignerName','epSignerRole','epSignerInitials','epSignerEmail','epSignerPin','epSignerPin2']
                .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            await epLoadSigners();
            if (typeof showNotification === 'function') showNotification(`Firmante "${nombre}" registrado`, 'success');
        } catch (e) {
            show('Error: ' + e.message);
        }
    }

    // Globals para los onclick del HTML
    global.openEditProject  = openEditProject;
    global.closeEditProject = closeEditProject;
    global.epSwitchTab      = epSwitchTab;
    global.saveEditProject  = saveEditProject;
    global.epAddSigner      = epAddSigner;
    global.wizardPickFolder = wizardPickFolder;
    global.wizardCancel = wizardCancel;
    global.wizardBack = wizardBack;
    global.wizardNext = wizardNext;
    global.wizardConfirm = wizardConfirm;
    global.wizardClearCanvas = wizardClearCanvas;
    global.wizardAddSigner = wizardAddSigner;
    global.wizardRemoveSigner = wizardRemoveSigner;
    global.wizardMobileCapture = wizardMobileCapture;

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

    // ════════════════════════════════════════════════════════════════════
    // POST-RELOAD: aplicar firmantes pendientes del wizard.
    // Cuando el wizard crea un proyecto con firmantes, los guarda en
    // localStorage `vscPendingSigners` antes del reload (porque createNew()
    // recarga la página). Acá, después del reload, esperamos a que la app
    // termine de inicializar (PeopleManager + packageDocs cargados) y los
    // aplicamos vía PM.add(). Se limpia el localStorage al terminar.
    // ════════════════════════════════════════════════════════════════════
    async function applyPendingSigners() {
        const raw = localStorage.getItem('vscPendingSigners');
        if (!raw) return;
        let pending;
        try { pending = JSON.parse(raw); } catch (e) { localStorage.removeItem('vscPendingSigners'); return; }
        if (!pending || !Array.isArray(pending.signers) || pending.signers.length === 0) {
            localStorage.removeItem('vscPendingSigners');
            return;
        }
        // Esperar a que PeopleManager y packageDocs estén listos
        const ready = await new Promise(resolve => {
            let tries = 0;
            const iv = setInterval(() => {
                tries++;
                const pmReady = window.PeopleManager && typeof window.PeopleManager.add === 'function';
                const pkgReady = Array.isArray(window.packageDocs) && window.packageDocs.length > 0;
                if (pmReady && pkgReady) { clearInterval(iv); resolve(true); }
                else if (tries > 60) { clearInterval(iv); resolve(false); } // ~12s max
            }, 200);
        });
        if (!ready) {
            console.warn('[projects-ui] No se pudieron aplicar firmantes pendientes (PeopleManager/packageDocs no listos)');
            return;
        }
        // Aplicar los firmantes uno por uno. PeopleManager.add() persiste cada uno
        // dentro del paquete PEOPLE-{codigo} y dispara el audit log SIGNER_REGISTERED.
        const pkgCode = window.PeopleManager.getPackageCode();
        if (!pkgCode) {
            console.warn('[projects-ui] No hay package code activo, abortando seed de firmantes');
            return;
        }
        let ok = 0, fail = 0;
        for (const s of pending.signers) {
            try {
                await window.PeopleManager.add(pkgCode, {
                    nombre: s.nombre, rol: s.rol, iniciales: s.iniciales,
                    email: s.email, firmaImage: s.firmaImage
                }, s.pin);
                ok++;
            } catch (e) {
                console.warn('[projects-ui] Error agregando firmante', s.nombre, e.message);
                fail++;
            }
        }
        localStorage.removeItem('vscPendingSigners');
        if (typeof global.showNotification === 'function') {
            global.showNotification(
                ok + ' firmante(s) registrado(s) en el proyecto nuevo' + (fail > 0 ? ' (' + fail + ' fallaron)' : ''),
                'success'
            );
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(refreshActiveProjectChip, 200);
            setTimeout(applyPendingSigners, 1500); // dar tiempo a la app a inicializar
        });
    } else {
        setTimeout(refreshActiveProjectChip, 200);
        setTimeout(applyPendingSigners, 1500);
    }

})(window);
