'use strict';

/* ====================================================================
   SMART Validation — Analytics Panel
   Reemplaza el motor de trazabilidad JS por resultados del servicio
   Python (FastAPI). El JS solo renderiza — no computa nada.
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};

    // ── Estado del panel ──────────────────────────────────────────────
    let _modal      = null;
    let _lastResult = null;
    let _pingTimer  = null;
    let _activeTab  = 'matriz';  // matriz | rtm | normativa | gaps | coherencia | cascada | ejecucion

    // ── CSS ───────────────────────────────────────────────────────────
    const CSS = `
#anaModal { position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9100;display:none;align-items:center;justify-content:center; }
#anaModal .ana-box { background:#fff;border-radius:10px;width:92%;max-width:1050px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.25); }
#anaModal .ana-header { background:#1a2a3a;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px; }
#anaModal .ana-title { font-size:15px;font-weight:700;letter-spacing:.3px;flex:1; }
#anaModal .ana-ping { font-size:11px;padding:2px 9px;border-radius:10px;font-weight:600; }
#anaModal .ana-ping.online  { background:#1b5e20;color:#a5d6a7; }
#anaModal .ana-ping.offline { background:#7f0000;color:#ffcdd2; }
#anaModal .ana-ping.checking{ background:#333;color:#aaa; }
#anaModal .ana-close { background:none;border:none;color:#9ba8b5;font-size:18px;cursor:pointer;line-height:1; }
#anaModal .ana-close:hover { color:#fff; }

/* Score bar */
#anaModal .ana-score-bar { background:#f0f4f8;padding:14px 20px;display:flex;align-items:center;gap:20px;border-bottom:1px solid #dde3ea;flex-wrap:wrap; }
#anaModal .ana-score-circle { width:62px;height:62px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;flex-shrink:0; }
#anaModal .ana-score-circle.ok      { background:#e8f5e9;color:#2e7d32;border:3px solid #4caf50; }
#anaModal .ana-score-circle.warn    { background:#fff8e1;color:#e65100;border:3px solid #ff9800; }
#anaModal .ana-score-circle.bad     { background:#ffebee;color:#b71c1c;border:3px solid #f44336; }
#anaModal .ana-kpis { display:flex;gap:12px;flex-wrap:wrap; }
#anaModal .ana-kpi { background:#fff;border:1px solid #dde3ea;border-radius:7px;padding:8px 14px;min-width:100px; }
#anaModal .ana-kpi-val { font-size:18px;font-weight:700;color:#1a2a3a; }
#anaModal .ana-kpi-lbl { font-size:10px;color:#7a8898;text-transform:uppercase;letter-spacing:.5px;margin-top:1px; }
#anaModal .ana-summary-text { font-size:12px;color:#4a5a6a;line-height:1.5;flex:1;min-width:180px; }

/* Matriz */
#anaModal .ana-sev-tag { display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap; }
#anaModal .ana-sev-tag.CRÍTICO,#anaModal .ana-sev-tag.CRITICO { background:#ffebee;color:#b71c1c; }
#anaModal .ana-sev-tag.ALTO    { background:#fff3e0;color:#e65100; }
#anaModal .ana-sev-tag.MEDIO   { background:#fff8e1;color:#f57f17; }
#anaModal .ana-sev-tag.BAJO    { background:#e8f5e9;color:#2e7d32; }
#anaModal tr.row-covered td:first-child { border-left:3px solid #4caf50; }
#anaModal tr.row-partial td:first-child { border-left:3px solid #ff9800; }
#anaModal tr.row-gap    td:first-child { border-left:3px solid #f44336; background:#fff5f5; }
#anaModal .tc-pill { display:inline-block;background:#e8eaf6;color:#3949ab;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600;margin:1px; }

/* Toolbar */
#anaModal .ana-toolbar { padding:10px 20px;border-bottom:1px solid #dde3ea;display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
#anaModal .ana-tab { background:none;border:1px solid #c8d4e0;border-radius:5px;padding:4px 12px;font-size:12px;cursor:pointer;color:#4a5a6a;transition:all .15s; }
#anaModal .ana-tab:hover { border-color:#213b50;color:#213b50; }
#anaModal .ana-tab.active { background:#213b50;color:#fff;border-color:#213b50; }
#anaModal .ana-spacer { flex:1; }
#anaModal .ana-btn { padding:5px 13px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid; }
#anaModal .ana-btn-primary { background:#213b50;color:#fff;border-color:#213b50; }
#anaModal .ana-btn-primary:hover { background:#1a2e3f; }
#anaModal .ana-btn-secondary { background:#fff;color:#213b50;border-color:#213b50; }
#anaModal .ana-btn-secondary:hover { background:#f0f4f8; }
#anaModal .ana-btn:disabled { opacity:.4;cursor:not-allowed; }
#anaModal .ana-file-lbl { font-size:11px;color:#9aabb8;cursor:pointer;padding:4px 10px;border:1px dashed #9aabb8;border-radius:5px; }
#anaModal .ana-file-lbl:hover { border-color:#213b50;color:#213b50; }
#anaModal #anaFileInput { display:none; }

/* Body / table */
#anaModal .ana-body { flex:1;overflow-y:auto;padding:0; }
#anaModal .ana-empty { text-align:center;padding:60px 20px;color:#9aabb8;font-size:14px; }
#anaModal .ana-table { width:100%;border-collapse:collapse;font-size:12px; }
#anaModal .ana-table th { background:#f8f9fb;color:#4a5a6a;font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:8px 14px;text-align:left;border-bottom:2px solid #dde3ea;position:sticky;top:0;z-index:2; }
#anaModal .ana-table td { padding:8px 14px;border-bottom:1px solid #eef2f5;vertical-align:top; }
#anaModal .ana-table tr:hover td { background:#f8fafc; }
#anaModal .ana-sev { display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700; }
#anaModal .ana-sev.CRITICO { background:#ffebee;color:#b71c1c; }
#anaModal .ana-sev.MAYOR   { background:#fff3e0;color:#e65100; }
#anaModal .ana-sev.MENOR   { background:#f3f8ff;color:#1565c0; }
#anaModal .ana-phase { font-size:10px;background:#e8eaf6;color:#3949ab;padding:2px 7px;border-radius:4px;font-weight:600; }

/* Normativa regulatoria */
#anaModal .reg-group { margin-bottom:0; }
#anaModal .reg-group-header { background:#f0f4f8;padding:8px 14px;font-size:11px;font-weight:700;color:#1a2a3a;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:10px;border-bottom:2px solid #dde3ea;position:sticky;top:0;z-index:3; }
#anaModal .reg-group-badge { font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700; }
#anaModal .reg-group-badge.ok  { background:#e8f5e9;color:#2e7d32; }
#anaModal .reg-group-badge.nok { background:#ffebee;color:#b71c1c; }
#anaModal .reg-row { display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-bottom:1px solid #eef2f5; }
#anaModal .reg-row:hover { background:#f8fafc; }
#anaModal .reg-icon { font-size:14px;flex-shrink:0;margin-top:1px; }
#anaModal .reg-info { flex:1; }
#anaModal .reg-art { font-size:10px;font-weight:700;color:#4a5a6a;margin-bottom:2px; }
#anaModal .reg-req { font-size:12px;color:#1a2a3a;line-height:1.4; }
#anaModal .reg-docs { margin-top:4px;display:flex;gap:4px;flex-wrap:wrap; }
#anaModal .reg-doc-chip { font-size:10px;padding:1px 7px;border-radius:3px;font-weight:600;text-transform:uppercase; }
#anaModal .reg-doc-chip.present { background:#e8f5e9;color:#2e7d32; }
#anaModal .reg-doc-chip.missing { background:#ffebee;color:#b71c1c;border:1px dashed #ef9a9a; }
#anaModal .reg-gap { font-size:10px;color:#b71c1c;margin-top:4px;line-height:1.4;font-style:italic; }

/* RTM — tabla extendida con descripción */
#anaModal .rtm-tipo { font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;text-transform:uppercase; }
#anaModal .rtm-tipo.F  { background:#e8eaf6;color:#3949ab; }
#anaModal .rtm-tipo.NF { background:#fce4ec;color:#c2185b; }
#anaModal .rtm-cov { display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:10px;font-weight:700; }
#anaModal .rtm-cov.yes { background:#e8f5e9;color:#2e7d32; }
#anaModal .rtm-cov.no  { background:#ffebee;color:#b71c1c; }

/* Cascada */
#anaModal .cas-chain { padding:16px 20px;display:flex;flex-direction:column;gap:0; }
#anaModal .cas-step { display:flex;flex-direction:column;position:relative; }
#anaModal .cas-connector { width:2px;height:18px;background:#dde3ea;margin-left:19px; }
#anaModal .cas-row { display:flex;align-items:flex-start;gap:12px; }
#anaModal .cas-node { width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0;border:2px solid; }
#anaModal .cas-node.ok      { background:#e8f5e9;color:#2e7d32;border-color:#4caf50; }
#anaModal .cas-node.warn    { background:#fff3e0;color:#e65100;border-color:#ff9800; }
#anaModal .cas-node.bad     { background:#ffebee;color:#b71c1c;border-color:#f44336; }
#anaModal .cas-node.skip    { background:#f5f5f5;color:#bdbdbd;border-color:#e0e0e0; }
#anaModal .cas-info { flex:1;padding:6px 0; }
#anaModal .cas-pair { font-size:12px;font-weight:700;color:#1a2a3a; }
#anaModal .cas-pair-status { font-size:10px;color:#7a8898;margin-top:1px; }
#anaModal .cas-issues-list { margin-top:6px;display:flex;flex-direction:column;gap:4px; }
#anaModal .cas-issue-card { background:#fff;border:1px solid #eef2f5;border-radius:5px;padding:7px 10px;border-left:3px solid; }
#anaModal .cas-issue-card.CRITICO { border-left-color:#f44336; }
#anaModal .cas-issue-card.MAYOR   { border-left-color:#ff9800; }
#anaModal .cas-issue-card.MENOR   { border-left-color:#2196f3; }
#anaModal .cas-issue-title { font-size:11px;font-weight:600;color:#1a2a3a;margin-bottom:2px; }
#anaModal .cas-issue-detail { font-size:10px;color:#4a5a6a;line-height:1.45; }
#anaModal .cas-no-pair { background:#f8f9fb;border-radius:6px;padding:8px 12px;font-size:11px;color:#9aabb8;font-style:italic; }

/* Spinner */
#anaModal .ana-spinner { display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:14px; }
#anaModal .ana-spin-ring { width:40px;height:40px;border:4px solid #dde3ea;border-top-color:#213b50;border-radius:50%;animation:anaSpin .8s linear infinite; }
@keyframes anaSpin { to { transform:rotate(360deg); } }
`;

    // ── Bootstrap ─────────────────────────────────────────────────────

    function _injectCSS() {
        if (document.getElementById('ana-css')) return;
        const s = document.createElement('style');
        s.id = 'ana-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function _buildModal() {
        if (_modal) return;
        _injectCSS();
        _modal = document.createElement('div');
        _modal.id = 'anaModal';
        _modal.innerHTML = `
<div class="ana-box">
  <div class="ana-header">
    <span class="ana-title">Análisis de Trazabilidad GxP</span>
    <span class="ana-ping checking" id="anaPing">Verificando motor…</span>
    <button class="ana-close" id="anaClose">✕</button>
  </div>

  <div class="ana-score-bar" id="anaScoreBar" style="display:none">
    <div class="ana-score-circle" id="anaScoreCircle">—</div>
    <div class="ana-kpis" id="anaKpis"></div>
    <div class="ana-summary-text" id="anaSummaryText"></div>
  </div>

  <div class="ana-toolbar">
    <button class="ana-tab active" data-tab="matriz">Matriz URS↔RA↔TC</button>
    <button class="ana-tab" data-tab="rtm">RTM Completa</button>
    <button class="ana-tab" data-tab="normativa">Normativa</button>
    <button class="ana-tab" data-tab="gaps">Gaps</button>
    <button class="ana-tab" data-tab="coherencia">Coherencia</button>
    <button class="ana-tab" data-tab="cascada">Cascada</button>
    <button class="ana-tab" data-tab="ejecucion">Ejecución</button>
    <div class="ana-spacer"></div>
    <label class="ana-file-lbl" title="Subir Excel de ejecución para análisis de resultados">
      <input type="file" id="anaFileInput" accept=".xlsx,.xls">
      ⬆ Excel ejecución
    </label>
    <button class="ana-btn ana-btn-primary" id="anaBtnAnalyze">Analizar ciclo</button>
    <button class="ana-btn ana-btn-secondary" id="anaBtnExport" style="display:none">Exportar CSV</button>
  </div>

  <div class="ana-body" id="anaBody">
    <div class="ana-empty">
      Presioná <strong>Analizar ciclo</strong> para ejecutar el análisis de trazabilidad con el motor Python.
    </div>
  </div>
</div>`;
        document.body.appendChild(_modal);
        _bindEvents();
    }

    // ── Eventos ───────────────────────────────────────────────────────

    function _bindEvents() {
        document.getElementById('anaClose').onclick = AnalyticsPanel.close;
        _modal.addEventListener('click', e => { if (e.target === _modal) AnalyticsPanel.close(); });

        document.getElementById('anaBtnAnalyze').onclick = _runAnalysis;
        document.getElementById('anaBtnExport').onclick  = _exportCSV;

        document.getElementById('anaFileInput').onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const lbl = document.querySelector('.ana-file-lbl');
            lbl.textContent = `✓ ${file.name}`;
        };

        _modal.querySelectorAll('.ana-tab').forEach(btn => {
            btn.onclick = () => {
                _activeTab = btn.dataset.tab;
                _modal.querySelectorAll('.ana-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (_lastResult) _renderTable(_lastResult);
            };
        });
    }

    // ── Ping ──────────────────────────────────────────────────────────

    async function _checkPing() {
        const el = document.getElementById('anaPing');
        if (!el) return;
        const ok = await (VS.Analytics && VS.Analytics.ping ? VS.Analytics.ping() : Promise.resolve(false));
        el.className = `ana-ping ${ok ? 'online' : 'offline'}`;
        el.textContent = ok ? '● Motor activo' : '✕ Motor offline';
    }

    // ── Análisis ──────────────────────────────────────────────────────

    async function _runAnalysis() {
        if (!VS.Analytics) {
            _showError('El cliente de analytics no está disponible.');
            return;
        }
        const online = await VS.Analytics.ping();
        if (!online) {
            _showError('El motor Python no está corriendo. Ejecutá start.bat en analytics-service/ y volvé a intentar.');
            return;
        }

        // Recopilar documentos del ciclo activo (aprobados o cargados en la Suite)
        const docs = _collectDocs();
        if (!Object.keys(docs).length) {
            _showError('No hay documentos en el ciclo activo. Abrí un proyecto o la demo desde el menú de proyectos.');
            return;
        }

        // Excel de ejecución (opcional)
        let excelB64 = null;
        const fileInput = document.getElementById('anaFileInput');
        if (fileInput.files[0]) {
            excelB64 = await _fileToBase64(fileInput.files[0]);
        }

        _showSpinner();
        document.getElementById('anaBtnAnalyze').disabled = true;

        const projectId = VS.projects && VS.projects.getActiveId ? VS.projects.getActiveId() : 'unknown';

        try {
            const result = await VS.Analytics.analyze(projectId, docs, excelB64);
            _lastResult = result;
            _renderResult(result);
            document.getElementById('anaBtnExport').style.display = '';
        } catch (e) {
            _showError(`Error al analizar: ${e.message}`);
        } finally {
            document.getElementById('anaBtnAnalyze').disabled = false;
        }
    }

    function _collectDocs() {
        // 1. Wizard state — documentos aprobados del generador IA
        const projectId = VS.projects && VS.projects.getActiveId ? VS.projects.getActiveId() : null;
        if (projectId && VS.AIGenerator && VS.AIGenerator.WizardState) {
            const state = VS.AIGenerator.WizardState.load(projectId);
            if (state && state.approvedDocs && Object.keys(state.approvedDocs).length) {
                return { ...state.approvedDocs };
            }
        }
        // 2. getPackageDocs() — función legacy de la Suite
        if (typeof getPackageDocs === 'function') {
            const pdocs = getPackageDocs();
            if (pdocs && pdocs.length) {
                const map = {};
                pdocs.forEach(d => { if (d.type && d.json) map[d.type.toLowerCase()] = d.json; });
                if (Object.keys(map).length) return map;
            }
        }
        // 3. window.packageDocs — modo demo y proyectos cargados en la Suite
        const pkg = (typeof window !== 'undefined' && window.packageDocs) || VS.packageDocs || [];
        if (Array.isArray(pkg) && pkg.length) {
            const map = {};
            pkg.forEach(d => {
                if (d.type && d.data) map[d.type.toLowerCase()] = d.data;
            });
            if (Object.keys(map).length) return map;
        }
        return {};
    }

    // ── Render resultado ──────────────────────────────────────────────

    function _renderResult(r) {
        _renderScoreBar(r);
        _renderTable(r);
    }

    function _renderScoreBar(r) {
        const bar = document.getElementById('anaScoreBar');
        bar.style.display = 'flex';

        const circle = document.getElementById('anaScoreCircle');
        const cls = r.status === 'OK' ? 'ok' : r.status === 'WARNINGS' ? 'warn' : 'bad';
        circle.className = `ana-score-circle ${cls}`;
        circle.textContent = r.score;

        const t = r.traceability;
        document.getElementById('anaKpis').innerHTML = `
            ${_kpi(t.ursWithTC + '/' + t.ursTotal, 'URS cubiertos')}
            ${_kpi(t.ursCoverage + '%', 'Cobertura')}
            ${_kpi(t.risksMitigated + '/' + t.risksTotal, 'Riesgos mitigados')}
            ${_kpi(Object.values(t.tcByPhase).reduce((a,b)=>a+b,0), 'TCs totales')}
            ${_kpi('IQ:' + (t.tcByPhase.IQ||0) + ' OQ:' + (t.tcByPhase.OQ||0) + ' PQ:' + (t.tcByPhase.PQ||0), 'Por fase')}
        `;
        document.getElementById('anaSummaryText').textContent = r.summary;
    }

    function _kpi(val, lbl) {
        return `<div class="ana-kpi"><div class="ana-kpi-val">${val}</div><div class="ana-kpi-lbl">${lbl}</div></div>`;
    }

    function _pills(ids) {
        if (!ids || !ids.length) return '<span style="color:#bbb">—</span>';
        return ids.map(id => `<span class="tc-pill">${_esc(id)}</span>`).join(' ');
    }

    function _renderTable(r) {
        const body = document.getElementById('anaBody');

        if (_activeTab === 'matriz') {
            if (!r.matrix || !r.matrix.length) {
                body.innerHTML = '<div class="ana-empty">No hay datos de URS para mostrar la matriz.</div>';
                return;
            }
            const rows = r.matrix.map(row => {
                const cls = row.covered ? 'row-covered' : 'row-gap';
                const statusIcon  = row.covered ? '✓' : '✕';
                const statusColor = row.covered ? '#2e7d32' : '#b71c1c';
                return `<tr class="${cls}">
                    <td><code style="font-weight:700">${_esc(row.ursId)}</code></td>
                    <td>${row.raVinculado !== '—' ? `<code>${_esc(row.raVinculado)}</code>` : '<span style="color:#bbb">—</span>'}</td>
                    <td>${row.raScore !== '—' ? `<span class="ana-sev-tag ${_esc(row.raScore)}">${_esc(row.raScore)}</span>` : '<span style="color:#bbb">—</span>'}</td>
                    <td>${_pills(row.tcIQ)}</td>
                    <td>${_pills(row.tcOQ)}</td>
                    <td>${_pills(row.tcPQ)}</td>
                    <td style="text-align:center;font-weight:700;color:${statusColor}">${statusIcon}</td>
                </tr>`;
            }).join('');
            const covCount  = r.matrix.filter(r => r.covered).length;
            const gapCount  = r.matrix.filter(r => !r.covered).length;
            body.innerHTML = `
                <div style="padding:8px 14px;background:#f8f9fb;border-bottom:1px solid #eef2f5;font-size:11px;color:#4a5a6a;">
                    <span style="color:#2e7d32;font-weight:600">✓ ${covCount} URS cubiertos</span>
                    ${gapCount ? `&nbsp;·&nbsp;<span style="color:#b71c1c;font-weight:600">✕ ${gapCount} URS sin TC</span>` : '&nbsp;·&nbsp;<span style="color:#7a8898">Sin gaps de cobertura</span>'}
                    &nbsp;·&nbsp;Leyenda: <span style="border-left:3px solid #4caf50;padding-left:4px">con cobertura</span>
                    &nbsp;<span style="border-left:3px solid #f44336;padding-left:4px">sin TC asignado</span>
                </div>
                <table class="ana-table">
                    <thead><tr>
                        <th>URS-ID</th><th>RA Vinculado</th><th>Score RA</th>
                        <th>TC-IQ</th><th>TC-OQ</th><th>TC-PQ</th><th>Estado</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
            return;
        }

        if (_activeTab === 'rtm') {
            if (!r.matrix || !r.matrix.length) {
                body.innerHTML = '<div class="ana-empty">No hay datos de URS para mostrar la RTM.</div>';
                return;
            }
            const rows = r.matrix.map(row => {
                const cls = row.covered ? 'row-covered' : 'row-gap';
                const covIQ = `<span class="rtm-cov ${row.covIQ?'yes':'no'}">${row.covIQ?'✓':'✕'}</span>`;
                const covOQ = `<span class="rtm-cov ${row.covOQ?'yes':'no'}">${row.covOQ?'✓':'✕'}</span>`;
                const covPQ = `<span class="rtm-cov ${row.covPQ?'yes':'no'}">${row.covPQ?'✓':'✕'}</span>`;
                const tipoBadge = `<span class="rtm-tipo ${_esc(row.tipo)}">${_esc(row.tipo)}</span>`;
                const scoreBadge = row.raScore !== '—'
                    ? `<span class="ana-sev-tag ${_esc(row.raScore)}">${_esc(row.raScore)}</span>`
                    : '<span style="color:#bbb">—</span>';
                return `<tr class="${cls}">
                    <td><code style="font-weight:700">${_esc(row.ursId)}</code></td>
                    <td>${tipoBadge}</td>
                    <td style="max-width:240px;font-size:11px;color:#4a5a6a">${_esc(row.description || '—')}</td>
                    <td>${row.raVinculado !== '—' ? `<code>${_esc(row.raVinculado)}</code>` : '<span style="color:#bbb">—</span>'}</td>
                    <td>${scoreBadge}</td>
                    <td style="text-align:center">${covIQ}</td>
                    <td style="text-align:center">${covOQ}</td>
                    <td style="text-align:center">${covPQ}</td>
                </tr>`;
            }).join('');
            const fCount = r.matrix.filter(m => m.tipo === 'F').length;
            const nfCount = r.matrix.filter(m => m.tipo === 'NF').length;
            body.innerHTML = `
                <div style="padding:8px 14px;background:#f8f9fb;border-bottom:1px solid #eef2f5;font-size:11px;color:#4a5a6a;display:flex;gap:16px;">
                    <span>Total: <strong>${r.matrix.length}</strong></span>
                    <span><span class="rtm-tipo F">F</span> Funcional: <strong>${fCount}</strong></span>
                    <span><span class="rtm-tipo NF">NF</span> No funcional: <strong>${nfCount}</strong></span>
                </div>
                <table class="ana-table">
                    <thead><tr>
                        <th>URS-ID</th><th>Tipo</th><th>Descripción</th>
                        <th>RA</th><th>Score</th>
                        <th style="text-align:center">IQ</th><th style="text-align:center">OQ</th><th style="text-align:center">PQ</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
            return;
        }

        if (_activeTab === 'normativa') {
            const reqs = r.regMatrix || [];
            if (!reqs.length) {
                body.innerHTML = '<div class="ana-empty">No hay datos de cumplimiento regulatorio.</div>';
                return;
            }
            // Agrupar por normativa
            const groups = {};
            reqs.forEach(req => {
                if (!groups[req.regulation]) groups[req.regulation] = [];
                groups[req.regulation].push(req);
            });
            const totalSat = reqs.filter(r => r.satisfied).length;
            const compPct  = Math.round(totalSat / reqs.length * 100);
            const badgeCls = compPct >= 90 ? 'ok' : 'nok';

            let html = `<div style="padding:10px 14px;background:#f8f9fb;border-bottom:1px solid #eef2f5;font-size:12px;color:#1a2a3a;font-weight:600;">
                Cumplimiento global: ${totalSat}/${reqs.length} requisitos (${compPct}%)
                <span class="ana-sev ${compPct>=90?'ok':'CRITICO'}" style="margin-left:8px">${compPct>=90?'CONFORME':'REQUIERE ATENCIÓN'}</span>
            </div>`;

            const SORDER = {'CRITICO':0,'MAYOR':1,'MENOR':2};
            const SEV_COLOR = {CRITICO:'#b71c1c', MAYOR:'#e65100', MENOR:'#1565c0'};

            for (const [reg, items] of Object.entries(groups)) {
                const sat  = items.filter(i => i.satisfied).length;
                const cls  = sat === items.length ? 'ok' : 'nok';
                const pct  = Math.round(sat / items.length * 100);
                html += `<div class="reg-group">
                    <div class="reg-group-header">
                        ${_esc(reg)}
                        <span class="reg-group-badge ${cls}">${sat}/${items.length} (${pct}%)</span>
                    </div>`;

                const sorted = [...items].sort((a,b) => (a.satisfied?1:0)-(b.satisfied?1:0) || SORDER[a.severity]-SORDER[b.severity]);
                for (const req of sorted) {
                    const icon = req.satisfied ? '✓' : '✕';
                    const iconColor = req.satisfied ? '#2e7d32' : SEV_COLOR[req.severity] || '#b71c1c';
                    const docList = req.docsRequired.length ? req.docsRequired : req.docsAny;
                    const chips = docList.map(d => {
                        const present = req.docsPresent.includes(d);
                        return `<span class="reg-doc-chip ${present?'present':'missing'}">${_esc(d.toUpperCase())}</span>`;
                    }).join('');
                    html += `<div class="reg-row">
                        <div class="reg-icon" style="color:${iconColor}">${icon}</div>
                        <div class="reg-info">
                            <div class="reg-art">${_esc(req.article)}</div>
                            <div class="reg-req">${_esc(req.requirement)}</div>
                            <div class="reg-docs">${chips}</div>
                            ${!req.satisfied ? `<div class="reg-gap">${_esc(req.gap)}</div>` : ''}
                        </div>
                        ${!req.satisfied ? `<span class="ana-sev ${req.severity}" style="flex-shrink:0">${req.severity}</span>` : ''}
                    </div>`;
                }
                html += '</div>';
            }
            body.innerHTML = html;
            return;
        }

        if (_activeTab === 'gaps') {
            if (!r.gaps.length) {
                body.innerHTML = '<div class="ana-empty">Sin gaps de trazabilidad detectados ✓</div>';
                return;
            }
            body.innerHTML = `<table class="ana-table">
                <thead><tr><th>ID</th><th>Descripción</th><th>Fase</th><th>Severidad</th></tr></thead>
                <tbody>${r.gaps.map(g => `
                    <tr>
                        <td><code>${_esc(g.ursId)}</code></td>
                        <td>${_esc(g.description)}</td>
                        <td><span class="ana-phase">${_esc(g.phase)}</span></td>
                        <td><span class="ana-sev ${g.severity}">${g.severity}</span></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        }

        if (_activeTab === 'coherencia') {
            if (!r.coherenceIssues.length) {
                body.innerHTML = '<div class="ana-empty">Sin problemas de coherencia detectados ✓</div>';
                return;
            }
            body.innerHTML = `<table class="ana-table">
                <thead><tr><th>Documento</th><th>TC</th><th>Problema detectado</th><th>Severidad</th></tr></thead>
                <tbody>${r.coherenceIssues.map(c => `
                    <tr>
                        <td>${_esc(c.docType)}</td>
                        <td>${c.tcId ? `<code>${_esc(c.tcId)}</code>` : '—'}</td>
                        <td>${_esc(c.issue)}</td>
                        <td><span class="ana-sev ${c.severity}">${c.severity}</span></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        }

        if (_activeTab === 'cascada') {
            const issues = r.cascadeIssues || [];
            // Pares definidos en el orden de la cadena
            const PAIRS = [
                { from: 'HLRA', to: 'VP',  label: 'HLRA → VP',  desc: 'Análisis de riesgo inicial define alcance y documentos requeridos' },
                { from: 'VP',   to: 'URS', label: 'VP → URS',   desc: 'Plan de validación determina criterios y alcance de requerimientos' },
                { from: 'URS',  to: 'RA',  label: 'URS → RA',   desc: 'Requerimientos de usuario fundamentan el análisis de riesgo detallado' },
                { from: 'IRA',  to: 'PIQ', label: 'IRA → PIQ',  desc: 'Análisis de riesgo de componentes define casos de prueba de instalación' },
                { from: 'URS',  to: 'POQ', label: 'URS → POQ',  desc: 'Requerimientos funcionales se verifican operacionalmente en la Calificación OQ' },
                { from: 'RA',   to: 'POQ', label: 'RA → POQ',   desc: 'Riesgos de naturaleza operacional deben tener cobertura en el POQ' },
                { from: 'VP',   to: 'PPQ', label: 'VP → PPQ',   desc: 'El alcance del VP determina si PQ aplica para esta categoría GAMP' },
            ];
            // Agrupar issues por par
            const byPair = {};
            issues.forEach(i => {
                const key = `${i.fromDoc}→${i.toDoc}`;
                if (!byPair[key]) byPair[key] = [];
                byPair[key].push(i);
            });

            const steps = PAIRS.map((pair, idx) => {
                const key = `${pair.from}→${pair.to}`;
                const pairIssues = byPair[key] || [];
                const hasCritico = pairIssues.some(i => i.severity === 'CRITICO');
                const hasMayor   = pairIssues.some(i => i.severity === 'MAYOR');
                const nodeClass  = !pairIssues.length ? 'ok' : hasCritico ? 'bad' : hasMayor ? 'warn' : 'warn';
                const nodeIcon   = !pairIssues.length ? '✓' : pairIssues.length;
                const statusText = !pairIssues.length ? 'Sin hallazgos — coherencia confirmada' : `${pairIssues.length} hallazgo${pairIssues.length>1?'s':''} detectado${pairIssues.length>1?'s':''}`;

                const issueCards = pairIssues.map(i => `
                    <div class="cas-issue-card ${_esc(i.severity)}">
                        <div class="cas-issue-title">
                            <span class="ana-sev ${i.severity === 'CRITICO' ? 'CRITICO' : i.severity}">${_esc(i.severity)}</span>
                            &nbsp;${_esc(i.issue)}
                        </div>
                        ${i.detail ? `<div class="cas-issue-detail">${_esc(i.detail)}</div>` : ''}
                    </div>`).join('');

                const connector = idx < PAIRS.length - 1 ? '<div class="cas-connector"></div>' : '';
                return `<div class="cas-step">
                    <div class="cas-row">
                        <div class="cas-node ${nodeClass}">${nodeIcon}</div>
                        <div class="cas-info">
                            <div class="cas-pair">${pair.label}</div>
                            <div class="cas-pair-status">${pair.desc}</div>
                            <div class="cas-pair-status" style="margin-top:2px;font-weight:600;color:${!pairIssues.length?'#2e7d32':hasCritico?'#b71c1c':'#e65100'}">${statusText}</div>
                            ${issueCards ? `<div class="cas-issues-list">${issueCards}</div>` : ''}
                        </div>
                    </div>
                    ${connector}
                </div>`;
            }).join('');

            const totalIssues = issues.length;
            const banner = totalIssues
                ? `<div style="padding:10px 20px;background:#fff8e1;border-bottom:1px solid #ffe082;font-size:12px;color:#e65100;">
                    <strong>⚠ ${totalIssues} hallazgo${totalIssues>1?'s':''} de coherencia en cascada.</strong>
                    Revisá los puntos marcados antes de generar el libro de validación.
                   </div>`
                : `<div style="padding:10px 20px;background:#e8f5e9;border-bottom:1px solid #a5d6a7;font-size:12px;color:#2e7d32;">
                    <strong>✓ Cadena documental coherente.</strong>
                    Todos los pares verificados cumplen con los criterios de consistencia GxP.
                   </div>`;

            body.innerHTML = banner + `<div class="cas-chain">${steps}</div>`;
            return;
        }

        if (_activeTab === 'ejecucion') {
            if (!r.executionGaps.length) {
                body.innerHTML = '<div class="ana-empty">Sin elementos huérfanos en la ejecución ✓</div>';
                return;
            }
            body.innerHTML = `<table class="ana-table">
                <thead><tr><th>TC</th><th>Fase</th><th>Problema</th></tr></thead>
                <tbody>${r.executionGaps.map(e => `
                    <tr>
                        <td><code>${_esc(e.tcId)}</code></td>
                        <td><span class="ana-phase">${_esc(e.docType)}</span></td>
                        <td>${e.issue === 'SIN_RESULTADO' ? 'Sin resultado registrado' : 'Resultado inválido'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        }
    }

    // ── Helpers UI ────────────────────────────────────────────────────

    function _showSpinner() {
        const bar = document.getElementById('anaScoreBar');
        bar.style.display = 'none';
        document.getElementById('anaBody').innerHTML = `
            <div class="ana-spinner">
                <div class="ana-spin-ring"></div>
                <span style="color:#7a8898;font-size:13px">Analizando ciclo con el motor Python…</span>
            </div>`;
    }

    function _showError(msg) {
        document.getElementById('anaBody').innerHTML =
            `<div class="ana-empty" style="color:#b71c1c">${_esc(msg)}</div>`;
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function _fileToBase64(file) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload  = e => res(e.target.result.split(',')[1]);
            r.onerror = rej;
            r.readAsDataURL(file);
        });
    }

    // ── Export CSV ────────────────────────────────────────────────────

    function _exportCSV() {
        if (!_lastResult) return;
        const r = _lastResult;
        const rows = [
            ['Tipo', 'ID / Artículo', 'Descripción / Issue', 'Detalle / Fase', 'Severidad / Score'],
            ...(r.matrix || []).map(m => ['MATRIZ', m.ursId,
                `[${m.tipo}] ${m.description || ''}`,
                `RA:${m.raVinculado}|IQ:${(m.tcIQ||[]).join(';')}|OQ:${(m.tcOQ||[]).join(';')}|PQ:${(m.tcPQ||[]).join(';')}`,
                m.raScore]),
            ...(r.regMatrix || []).map(rq => ['NORMATIVA', `${rq.regulation} ${rq.article}`,
                rq.requirement, rq.gap || 'OK', rq.satisfied ? 'CONFORME' : rq.severity]),
            ...r.gaps.map(g => ['GAP', g.ursId, g.description, g.phase, g.severity]),
            ...r.coherenceIssues.map(c => ['COHERENCIA', c.tcId || '', c.issue, c.docType, c.severity]),
            ...(r.cascadeIssues || []).map(ci => ['CASCADA', `${ci.fromDoc}→${ci.toDoc}`, ci.issue, ci.detail, ci.severity]),
            ...r.executionGaps.map(e => ['EJECUCION', e.tcId, e.issue, e.docType, '']),
        ];
        const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `trazabilidad-${r.projectId}-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
    }

    // ── API pública ───────────────────────────────────────────────────

    const AnalyticsPanel = {
        open() {
            _buildModal();
            _modal.style.display = 'flex';
            _checkPing();
            clearInterval(_pingTimer);
            _pingTimer = setInterval(_checkPing, 15000);
        },
        close() {
            if (_modal) _modal.style.display = 'none';
            clearInterval(_pingTimer);
        },
    };

    VS.AnalyticsPanel = AnalyticsPanel;

    // ── Globals que antes vivían en comparison-suite.js ───────────────
    // Trazabilidad → nuevo panel Python
    global.openComparisonMatrix     = () => AnalyticsPanel.open();
    global.closeComparisonMatrix    = () => AnalyticsPanel.close();
    global.exportComparisonMatrixCSV = () => _exportCSV();

    // Diff de versiones → diff-versions.js (sin cambios)
    global.openVersionDiff = () => {
        if (VS.diffVersions && VS.diffVersions.openDiffModal) VS.diffVersions.openDiffModal();
    };

    // Firma & archivado → sign-archive.js (sin cambios)
    global.openSignFlow = () => {
        if (VS.signArchive && VS.signArchive.openSignModal) VS.signArchive.openSignModal();
    };

    // Audit trail → audit-trail.js (sin cambios)
    global.openSuiteAuditTrail = () => {
        if (typeof AuditTrail !== 'undefined' && AuditTrail.showAuditTrailViewer)
            AuditTrail.showAuditTrailViewer();
    };

})(typeof window !== 'undefined' ? window : global);
