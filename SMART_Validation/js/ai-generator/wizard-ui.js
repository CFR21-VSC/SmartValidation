'use strict';

/* ====================================================================
   AI GENERATOR — WIZARD UI
   Layout idéntico a Suite Validación: full-screen, sidebar izquierdo
   con cascade progress, panel derecho con el paso actual.
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.AIGenerator = VS.AIGenerator || {};

    const _WS  = () => VS.AIGenerator.WizardState;
    const _SL  = () => VS.AIGenerator.SkillLoader;
    const _AC  = () => VS.AIGenerator.ApiClient;
    const _DP  = () => VS.AIGenerator.DocParser;

    const DOCTYPE_LABELS = {
        hlra: 'HLRA — High Level Risk Assessment',
        vp:   'VP — Validation Plan',
        urs:  'URS — User Requirements Specification',
        frs:  'FRS — Functional Requirements Specification',
        ds:   'DS — Design Specification',
        ra:   'RA — Risk Assessment',
        ira:  'IRA — Infrastructure Risk Assessment',
        rrm:  'RRM — Risk Register Matrix',
        mtr:  'MTR — Master Traceability Report',
        piq:  'PIQ — Protocolo de Calificación de Instalación',
        poq:  'POQ — Protocolo de Calificación Operacional',
        ppq:  'PPQ — Protocolo de Calificación de Performance',
        iiq:  'IIQ — Informe de Calificación de Instalación',
        ioq:  'IOQ — Informe de Calificación Operacional',
        ipq:  'IPQ — Informe de Calificación de Performance',
        riq:  'RIQ — Reporte de Decisión IQ',
        roq:  'ROQ — Reporte de Decisión OQ',
        rpq:  'RPQ — Reporte de Decisión PQ',
        ncr:  'NCR — Non-Conformance Report',
        vsr:  'VSR — Validation Summary Report',
        evra:   'EVRA — Evaluación de Riesgo de Planilla',
        evprot: 'EVPROT — Protocolo de Validación de Planilla',
        evir:   'EVIR — Informe de Validación de Planilla'
    };

    const PHASE_LABELS = {
        hlra: 'Planificación', vp: 'Planificación', urs: 'Planificación',
        frs: 'Planificación', ds: 'Planificación',
        ra: 'Riesgo', ira: 'Riesgo', rrm: 'Riesgo',
        mtr: 'Trazabilidad',
        piq: 'Protocolos', poq: 'Protocolos', ppq: 'Protocolos',
        iiq: 'Informes', ioq: 'Informes', ipq: 'Informes',
        riq: 'Reportes', roq: 'Reportes', rpq: 'Reportes',
        ncr: 'Cierre', vsr: 'Cierre',
        evra: 'Planillas GxP', evprot: 'Planillas GxP', evir: 'Planillas GxP'
    };

    // Qué docs aprobados son realmente útiles como contexto para cada tipo.
    // Evita inyectar toda la cascade (20 docs) y saturar el modelo.
    const CONTEXT_DEPS = {
        // ── Fase 1: Planificación ──────────────────────────────────────
        hlra: [],
        vp:   ['hlra'],
        urs:  ['hlra', 'vp'],
        frs:  ['hlra', 'urs'],
        ds:   ['urs', 'frs'],
        // ── Fase 2: Riesgo ─────────────────────────────────────────────
        ra:   ['hlra', 'urs'],
        ira:  ['hlra', 'urs', 'ra'],          // IRA (Installation Risk Assessment) — paralelo a RA; recibe RA para coordinación de escenarios
        rrm:  ['urs', 'ra', 'ira'],           // RRM cruza URS ↔ RA ↔ IRA
        // ── Fase 3: Calificación IQ ────────────────────────────────────
        piq:  ['urs', 'ds', 'ira', 'ra', 'rrm'],  // Profundidad TC ← RA; trazabilidad ← RRM
        iiq:  ['piq'],
        riq:  ['ra', 'ira', 'rrm', 'iiq'],   // Dictamen sobre componentes ← IRA
        // ── Fase 4: Calificación OQ ────────────────────────────────────
        poq:  ['urs', 'frs', 'ira', 'piq', 'riq'], // OQ verifica comportamiento funcional ← FRS
        ioq:  ['poq'],
        roq:  ['ra', 'ira', 'rrm', 'riq', 'ioq'],
        // ── Fase 5: Calificación PQ ────────────────────────────────────
        ppq:  ['urs', 'frs', 'ira', 'poq', 'roq'], // PQ verifica performance ← FRS
        ipq:  ['ppq'],
        rpq:  ['ra', 'ira', 'rrm', 'roq', 'ipq'],
        // ── Fase 6: Trazabilidad (después de protocolos — usa TCs reales) ─
        mtr:  ['urs', 'ra', 'ira', 'rrm', 'piq', 'poq', 'ppq', 'riq', 'roq', 'rpq'],
        // ── Fase 7: Cierre ─────────────────────────────────────────────
        ncr:  ['urs', 'ra', 'rrm', 'mtr'],   // NCRs son gaps URS↔TC detectados en MTR
        vsr:  ['hlra', 'vp', 'urs', 'mtr', 'ncr', 'riq', 'roq', 'rpq'], // Resume los 3 dictámenes
        // ── Planillas GxP ──────────────────────────────────────────────
        evra:   [],
        evprot: ['evra'],
        evir:   ['evprot']
    };

    let _state      = null;
    let _cancelCtrl = null;
    let _modal   = null;
    let _useOpus = false;

    // ── CSS ───────────────────────────────────────────────────────────

    function _injectStyles() {
        if (document.getElementById('ai-wiz-styles')) return;
        const s = document.createElement('style');
        s.id = 'ai-wiz-styles';
        s.textContent = `
/* ── Modal overlay ── */
#aiWizModal {
    display: none; position: fixed; inset: 0; z-index: 9000;
    background: rgba(0,0,0,.45);
}
#aiWizModal .aig-content {
    position: absolute; inset: 16px; background: #fff;
    border-radius: 8px; display: flex; flex-direction: column;
    overflow: hidden; box-shadow: 0 6px 30px rgba(0,0,0,.25);
}

/* ── Header ── */
#aiWizModal .aig-header {
    background: var(--vsc-azul, #213B50); color: #fff;
    padding: 10px 18px; display: flex; align-items: center; gap: 10px;
    flex-shrink: 0; border-radius: 8px 8px 0 0;
}
#aiWizModal .aig-header h2 {
    flex: 1; margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .2px;
}
#aiWizModal .aig-header .aig-proj {
    font-size: 11px; opacity: .75; font-weight: 400;
}
#aiWizModal .aig-close {
    background: none; border: none; color: #fff; font-size: 22px;
    cursor: pointer; padding: 0 4px; opacity: .8; line-height: 1;
}
#aiWizModal .aig-close:hover { opacity: 1; }

/* ── Status bar ── */
#aiWizModal .aig-statusbar {
    background: #F8F9FB; border-bottom: 1px solid var(--vsc-gris-claro, #D8E0E9);
    padding: 5px 18px; font-size: 11px; color: var(--vsc-azul, #213B50);
    display: flex; align-items: center; gap: 12px; flex-shrink: 0;
}
#aiWizModal .aig-statusbar .aig-badge {
    background: var(--vsc-azul, #213B50); color: #fff;
    border-radius: 10px; padding: 1px 8px; font-size: 10px; font-weight: 700;
}
#aiWizModal .aig-statusbar .aig-badge.done {
    background: #2E7D32;
}

/* ── Body: sidebar + main ── */
#aiWizModal .aig-body {
    flex: 1; display: flex; overflow: hidden;
}

/* ── Sidebar ── */
#aiWizModal .aig-sidebar {
    width: 260px; flex-shrink: 0;
    background: #F8F9FB; border-right: 1px solid var(--vsc-gris-claro, #D8E0E9);
    display: flex; flex-direction: column; overflow: hidden;
}
#aiWizModal .aig-sidebar-header {
    background: var(--vsc-gris-claro, #D8E0E9); padding: 7px 14px;
    font-size: 11px; font-weight: 700; color: var(--vsc-azul, #213B50);
    text-transform: uppercase; letter-spacing: .4px; border-bottom: 1px solid #C8D2DC;
    flex-shrink: 0;
}
#aiWizModal .aig-sidebar-list {
    flex: 1; overflow-y: auto; padding: 6px 0;
}
#aiWizModal .aig-phase-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .5px; color: #7A8EA0; padding: 8px 14px 3px;
}
#aiWizModal .aig-doc-item {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 14px; font-size: 12px; cursor: default;
    border-left: 3px solid transparent; transition: background .1s;
}
#aiWizModal .aig-doc-item.cur {
    background: #E8F0F8; border-left-color: var(--vsc-azul, #213B50);
    font-weight: 700; color: var(--vsc-azul, #213B50);
}
#aiWizModal .aig-doc-item.done-item { color: #2E7D32; }
#aiWizModal .aig-doc-item.done-item:hover { background: #F0F8F0; }
#aiWizModal .aig-doc-item.skipped { color: #9AABB8; }
#aiWizModal .aig-doc-item.skipped .aig-doc-name { text-decoration: line-through; }
#aiWizModal .aig-doc-icon.skip-icon { background: #EEF2F5; color: #9AABB8; border: 1.5px solid #C8D2DC; font-size: 10px; }

/* Botones de acción en sidebar — aparecen en hover */
#aiWizModal .aig-doc-actions { display:flex; gap:2px; opacity:0; transition:opacity .1s; margin-left:auto; flex-shrink:0; }
#aiWizModal .aig-doc-item:hover .aig-doc-actions,
#aiWizModal .aig-doc-item.cur .aig-doc-actions,
#aiWizModal .aig-doc-item.skipped .aig-doc-actions { opacity:1; }
#aiWizModal .aig-act-btn {
    background:none; border:1px solid #D0D8E0; border-radius:3px;
    padding:1px 5px; font-size:10px; cursor:pointer; color:#7A8EA0;
    line-height:1.5; transition:background .1s, color .1s, border-color .1s;
}
#aiWizModal .aig-act-btn:hover { background:#EEF2F5; color:#213B50; }
#aiWizModal .aig-act-btn.act-red:hover { background:#FDECEA; color:#C62828; border-color:#EF9A9A; }
#aiWizModal .aig-act-btn.act-green:hover { background:#E8F5E9; color:#2E7D32; border-color:#A5D6A7; }
#aiWizModal .aig-act-btn.act-blue { color:#1a56a0; }
#aiWizModal .aig-act-btn.act-blue:hover { background:#E8F0FB; color:#1a3c70; border-color:#9EB8E8; }
#aiWizModal .aig-doc-item.pending {
    color: #9AABB8;
}
#aiWizModal .aig-doc-icon {
    width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 700;
}
#aiWizModal .aig-doc-icon.done-icon  { background: #E8F5E9; color: #2E7D32; border: 1.5px solid #A5D6A7; }
#aiWizModal .aig-doc-icon.cur-icon   { background: var(--vsc-azul, #213B50); color: #fff; }
#aiWizModal .aig-doc-icon.pend-icon  { background: #EEF2F5; color: #9AABB8; border: 1.5px solid #C8D2DC; }
#aiWizModal .aig-doc-name { flex: 1; }
#aiWizModal .aig-sidebar-footer {
    padding: 10px 14px; border-top: 1px solid var(--vsc-gris-claro, #D8E0E9);
    flex-shrink: 0;
}
#aiWizModal .aig-model-toggle {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: #5A6E82; cursor: pointer;
}

/* ── Main pane ── */
#aiWizModal .aig-main {
    flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0;
}
#aiWizModal .aig-pane-header {
    background: var(--vsc-gris-claro, #D8E0E9); padding: 7px 18px;
    font-size: 12px; font-weight: 700; color: var(--vsc-azul, #213B50);
    border-bottom: 1px solid #C8D2DC; flex-shrink: 0;
    display: flex; align-items: center; justify-content: space-between;
}
#aiWizModal .aig-main-body {
    flex: 1; overflow-y: auto; padding: 20px 24px;
}

/* ── Bloque de carga ── */
#aiWizModal .aig-drop {
    border: 2px dashed #B0C2D4; border-radius: 8px; padding: 30px 20px;
    text-align: center; cursor: pointer; color: #5A6E82; margin-bottom: 14px;
    transition: border-color .2s, background .2s;
}
#aiWizModal .aig-drop:hover, #aiWizModal .aig-drop.dragover {
    border-color: var(--vsc-azul, #213B50); background: #F0F4F8;
}
#aiWizModal .aig-drop .di { font-size: 28px; margin-bottom: 8px; }
#aiWizModal .aig-drop .dm { font-weight: 600; font-size: 14px; }
#aiWizModal .aig-drop .ds { font-size: 12px; opacity: .7; margin-top: 4px; }

/* ── Alertas ── */
#aiWizModal .aig-info  { background:#E3F2FD; border:1.5px solid #90CAF9; border-radius:6px; padding:10px 14px; margin-bottom:12px; font-size:12px; color:#1565C0; }
#aiWizModal .aig-warn  { background:#FFF8E1; border:1.5px solid #FFD54F; border-radius:6px; padding:10px 14px; margin-bottom:12px; font-size:12px; color:#5D4037; }
#aiWizModal .aig-err   { background:#FDECEA; border:1.5px solid #EF9A9A; border-radius:6px; padding:10px 14px; margin-bottom:12px; font-size:12px; color:#A52A2A; white-space:pre-wrap; font-family:monospace; }
#aiWizModal .aig-ok    { background:#E8F5E9; border:1.5px solid #A5D6A7; border-radius:6px; padding:10px 14px; margin-bottom:12px; font-size:12px; color:#2E7D32; }

/* ── Label ── */
#aiWizModal .aig-label {
    font-size: 11px; font-weight: 700; color: var(--vsc-azul, #213B50);
    text-transform: uppercase; letter-spacing: .4px; margin-bottom: 5px;
}

/* ── Cascade chips ── */
#aiWizModal .aig-chip {
    display: inline-block; padding: 3px 9px; border-radius: 12px;
    font-size: 11px; font-weight: 600; cursor: default;
    border: 1.5px solid transparent; white-space: nowrap;
}
#aiWizModal .aig-chip-ok   { background:#1a3a1a; border-color:#2d6b2d; color:#6fcf6f; cursor:pointer; }
#aiWizModal .aig-chip-ok:hover { border-color:#4caf50; background:#1f4a1f; }
#aiWizModal .aig-chip-patch-sel { box-shadow:0 0 0 2px #4caf50; }
#aiWizModal .aig-chip-sel  { background:#0d2a45; border-color:#2979b8; color:#7fc4f5; cursor:default; box-shadow:0 0 0 2px #2979b8; }
#aiWizModal .aig-chip-pend { background:#1a2533; border-color:#2a3f55; color:#8ab0c8; cursor:pointer; }
#aiWizModal .aig-chip-pend:hover { border-color:#4a8fbf; color:#bde0f5; background:#1e3040; }
#aiWizModal .aig-chip-lock { background:#2a1a00; border-color:#6b3d00; color:#c07030; cursor:help; }
#aiWizModal .aig-chip-skip { background:#1a1a1a; border-color:#333; color:#666; cursor:default; text-decoration:line-through; }
#aiWizModal .aig-chip-ctx  { background:#1a2a1a; border-color:#2d5a2d; color:#7ab87a; cursor:default; }
#aiWizModal .aig-chip-base { background:#1a1a2e; border-color:#3a3a6b; color:#9090d0; cursor:pointer; }
#aiWizModal .aig-chip-base:hover { border-color:#6060c0; color:#c0c0f0; background:#22223e; }
#aiWizModal .aig-chip-base-sel { background:#2a1a40; border-color:#9060d0; color:#c090f0; cursor:pointer; box-shadow:0 0 0 2px #9060d0; }
#aiWizModal .aig-chip-base-sel:hover { border-color:#b080f0; }

/* ── Spinner ── */
#aiWizModal .aig-spin { text-align: center; padding: 60px 0; }
#aiWizModal .aig-spin .ring {
    display: inline-block; width: 42px; height: 42px;
    border: 4px solid #D0D8E0; border-top-color: var(--vsc-azul, #213B50);
    border-radius: 50%; animation: aigRing .8s linear infinite;
}
@keyframes aigRing { to { transform: rotate(360deg); } }
#aiWizModal .aig-spin p { margin: 14px 0 0; color: #5A6E82; font-size: 13px; }

/* ── JSON preview ── */
#aiWizModal .aig-json-wrap {
    background: #1E1E2E; border-radius: 6px; overflow: hidden; margin-bottom: 14px;
}
#aiWizModal .aig-json-topbar {
    background: #2D2D3F; padding: 6px 12px; display: flex;
    justify-content: space-between; align-items: center;
}
#aiWizModal .aig-json-topbar span { color: #9BA3C4; font-size: 11px; font-family: monospace; }
#aiWizModal .aig-json-topbar button {
    background: none; border: 1px solid #444; color: #9BA3C4;
    font-size: 11px; cursor: pointer; padding: 2px 8px; border-radius: 3px;
}
#aiWizModal .aig-json-topbar button:hover { background: #3D3D55; }
#aiWizModal pre.aig-json-pre {
    margin: 0; padding: 14px 16px; overflow: auto; max-height: 340px;
    font-size: 11px; line-height: 1.55; font-family: Consolas, monospace;
    color: #CDD6F4; white-space: pre-wrap; word-break: break-word;
}

/* ── Textarea ── */
#aiWizModal textarea {
    width: 100%; box-sizing: border-box; border: 1.5px solid #C0CDD9;
    border-radius: 5px; padding: 9px 11px; font-size: 13px; font-family: inherit;
    resize: vertical; min-height: 80px;
}
#aiWizModal textarea:focus { outline: none; border-color: var(--vsc-azul, #213B50); }

/* ── Footer / botones ── */
#aiWizModal .aig-footer {
    padding: 11px 18px; border-top: 1px solid var(--vsc-gris-claro, #D8E0E9);
    display: flex; gap: 8px; justify-content: flex-end; align-items: center;
    flex-shrink: 0; background: #FAFBFC;
}
#aiWizModal .aig-btn {
    padding: 8px 18px; border-radius: 5px; font-size: 13px;
    font-weight: 600; cursor: pointer; border: none; transition: background .15s;
}
#aiWizModal .bp { background: var(--vsc-azul, #213B50); color: #fff; }
#aiWizModal .bp:hover { background: #152A3D; }
#aiWizModal .bp:disabled { background: #9AABB8; cursor: not-allowed; }
#aiWizModal .bs { background: #fff; color: var(--vsc-azul, #213B50); border: 1.5px solid var(--vsc-azul, #213B50); }
#aiWizModal .bs:hover { background: #F0F4F8; }
#aiWizModal .ba { background: #2E7D32; color: #fff; }
#aiWizModal .ba:hover { background: #1B5E20; }
#aiWizModal .ba:disabled { background: #9AABB8; cursor: not-allowed; }

/* ── Done ── */
#aiWizModal .aig-done { text-align: center; padding: 60px 20px; }
#aiWizModal .aig-done .big { font-size: 52px; margin-bottom: 14px; }
#aiWizModal .aig-done h3 { color: var(--vsc-azul, #213B50); margin: 0 0 8px; font-size: 20px; }
#aiWizModal .aig-done p { color: #5A6E82; font-size: 13px; margin: 4px 0; }

/* ── Tabs ── */
#aiWizModal .aig-tabs { display:flex; align-items:center; border-bottom:2px solid #D8E0E9; margin-bottom:16px; }
#aiWizModal .aig-tab { background:none; border:none; padding:7px 20px; font-size:12px; font-weight:600; color:#7A8EA0; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px; transition:color .15s,border-color .15s; }
#aiWizModal .aig-tab.active { color:var(--vsc-azul,#213B50); border-bottom-color:var(--vsc-azul,#213B50); }
#aiWizModal .aig-tab:hover { color:var(--vsc-azul,#213B50); }
#aiWizModal .aig-tab-json-link { margin-left:auto; font-size:10px; color:#B0BEC5; cursor:pointer; padding:4px 8px; border-radius:3px; font-family:Consolas,monospace; letter-spacing:.3px; }
#aiWizModal .aig-tab-json-link:hover { color:#5A6E82; background:#F0F4F8; }
#aiWizModal .aig-tab-json-link.active { color:var(--vsc-azul,#213B50); background:#EEF2F5; }

/* ── JSON editor tab ── */
#aiWizModal .aig-jeditor-topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
#aiWizModal .aig-jvalid   { font-size:11px; color:#2E7D32; font-weight:700; }
#aiWizModal .aig-jinvalid { font-size:11px; color:#C62828; font-weight:700; }
#aiWizModal .aig-jeditor-topbar button { background:none; border:1.5px solid #C0CDD9; color:#5A6E82; font-size:11px; cursor:pointer; padding:2px 9px; border-radius:3px; }
#aiWizModal .aig-jeditor-topbar button:hover { background:#F0F4F8; }
#aiWizModal textarea.aig-json-edit { width:100%; box-sizing:border-box; font-family:Consolas,monospace; font-size:11px; line-height:1.55; border:1.5px solid #C0CDD9; border-radius:5px; padding:12px 14px; resize:vertical; min-height:400px; color:#1A2733; background:#F8F9FB; }
#aiWizModal textarea.aig-json-edit:focus { outline:none; border-color:var(--vsc-azul,#213B50); }

/* ── Readable doc preview ── */
#aiWizModal .aig-rdoc-header { background:#F0F4F8; border:1.5px solid #C8D4E0; border-radius:7px; padding:14px 18px; margin-bottom:16px; }
#aiWizModal .aig-rdoc-badge { background:var(--vsc-azul,#213B50); color:#fff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:4px; letter-spacing:.5px; }
#aiWizModal .aig-rdoc-sysname { font-size:17px; font-weight:700; color:var(--vsc-azul,#213B50); margin:6px 0 3px; }
#aiWizModal .aig-rds { margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid #EEF2F5; }
#aiWizModal .aig-rds:last-child { border-bottom:none; }
#aiWizModal .aig-rds-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--vsc-azul,#213B50); margin:0 0 7px; }
#aiWizModal .aig-rds p { margin:0 0 5px; font-size:13px; color:#2A3B4C; line-height:1.5; }
#aiWizModal .aig-rds ul { margin:4px 0; padding-left:18px; }
#aiWizModal .aig-rds li { font-size:12px; color:#2A3B4C; margin-bottom:3px; }
#aiWizModal .aig-rds-sub { font-size:11px; font-weight:700; color:#5A6E82 !important; margin:8px 0 3px !important; }
#aiWizModal .aig-rds-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:6px; }
#aiWizModal .aig-rds-table th { background:#EEF2F5; text-align:left; padding:5px 8px; font-size:11px; font-weight:700; color:#5A6E82; border-bottom:1.5px solid #D8E0E9; }
#aiWizModal .aig-rds-table td { padding:4px 8px; border-bottom:1px solid #F0F3F7; color:#2A3B4C; vertical-align:top; }
#aiWizModal .aig-rds-table.aig-rds-ti td:first-child { font-weight:600; color:#5A6E82; width:35%; }
#aiWizModal .aig-rds-box { background:#E3F2FD; border:1.5px solid #90CAF9; border-radius:6px; padding:12px 16px; }
#aiWizModal .aig-rds-box-title { font-size:14px; font-weight:700; color:#1565C0; margin-bottom:4px; }
#aiWizModal .aig-rds-calc { font-family:Consolas,monospace; font-size:13px; color:#1565C0; }
#aiWizModal .aig-rds-gap { background:#FFF8E1; border:1.5px solid #FFD54F; border-radius:6px; padding:12px 16px; }
#aiWizModal .aig-rds-gap-head { display:flex; justify-content:space-between; margin-bottom:6px; font-size:11px; font-weight:700; }
#aiWizModal .aig-rds-sev-critico { color:#B71C1C; }
#aiWizModal .aig-rds-sev-mayor   { color:#E65100; }
#aiWizModal .aig-rds-sev-menor   { color:#F57C00; }
#aiWizModal .aig-rds-sev-info    { color:#1565C0; }
#aiWizModal .aig-rds-q { display:flex; gap:10px; margin-bottom:6px; font-size:12px; align-items:flex-start; }
#aiWizModal .aig-rds-q-p { color:#5A6E82; flex:1; }
#aiWizModal .aig-rds-q-r { color:#2A3B4C; font-weight:600; flex:1; }
#aiWizModal .aig-rds-formula { font-family:Consolas,monospace; font-size:14px; font-weight:700; color:#213B50; background:#EEF2F5; padding:6px 12px; border-radius:4px; margin-bottom:8px; display:inline-block; }
#aiWizModal .aig-rds-raw { font-size:10px; color:#7A8EA0; background:#F5F7F9; padding:6px; border-radius:3px; max-height:80px; overflow:auto; margin:0; }

/* ── Review — inline edit ── */
#aiWizModal .aig-rev-note { background:#E3F2FD; border:1.5px solid #90CAF9; border-radius:6px; padding:9px 14px; font-size:11.5px; color:#1565C0; margin-bottom:12px; line-height:1.5; }
#aiWizModal .aig-meta-edit { background:#F8F9FB; border:1.5px solid #C8D4E0; border-radius:7px; padding:12px 14px; margin-bottom:14px; }
#aiWizModal .aig-meta-edit h4 { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#7A8EA0; margin:0 0 8px; }
#aiWizModal .aig-meta-row { display:flex; align-items:center; gap:10px; margin-bottom:7px; }
#aiWizModal .aig-meta-row:last-child { margin-bottom:0; }
#aiWizModal .aig-meta-row label { font-size:11px; font-weight:600; color:#5A6E82; width:60px; flex-shrink:0; }
#aiWizModal .aig-meta-row input { flex:1; padding:5px 9px; border:1.5px solid #C0CDD9; border-radius:4px; font-size:12px; color:#1A2733; background:#fff; }
#aiWizModal .aig-meta-row input:focus { outline:none; border-color:var(--vsc-azul,#213B50); }
#aiWizModal .aig-sec-edit { border:1.5px solid #E0E8F0; border-radius:6px; margin-bottom:10px; overflow:hidden; }
#aiWizModal .aig-sec-hdr { display:flex; align-items:center; gap:8px; background:#EEF2F5; padding:6px 10px; }
#aiWizModal .aig-sec-title { flex:1; border:none; background:transparent; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:var(--vsc-azul,#213B50); padding:2px 4px; }
#aiWizModal .aig-sec-title:focus { outline:1.5px solid #90CAF9; border-radius:2px; }
#aiWizModal .aig-sec-del { background:none; border:none; color:#B0BEC5; font-size:14px; cursor:pointer; padding:2px 4px; line-height:1; border-radius:3px; }
#aiWizModal .aig-sec-del:hover { color:#C62828; background:#FDECEA; }
#aiWizModal .aig-sec-body { padding:10px 12px; }
#aiWizModal .aig-text-block { font-size:12px; color:#2A3B4C; line-height:1.55; padding:4px 6px; border-radius:3px; margin-bottom:4px; min-height:20px; outline:none; }
#aiWizModal .aig-text-block:focus,
#aiWizModal .aig-text-block:hover { background:#F0F7FF; }
#aiWizModal .aig-text-block:empty:before { content:attr(placeholder); color:#B0BEC5; }
#aiWizModal .aig-add-bloque { background:none; border:1px dashed #B0BEC5; color:#9AABB8; font-size:11px; cursor:pointer; padding:2px 10px; border-radius:3px; margin-top:4px; }
#aiWizModal .aig-add-bloque:hover { color:#5A6E82; border-color:#5A6E82; }
#aiWizModal .aig-add-sec { background:none; border:1.5px dashed #90CAF9; color:#1565C0; font-size:12px; font-weight:600; cursor:pointer; padding:8px; border-radius:5px; width:100%; margin-top:4px; }
#aiWizModal .aig-add-sec:hover { background:#E3F2FD; }
/* ── Listas incluido/excluido ── */
#aiWizModal .aig-lista-cols { display:flex; gap:16px; }
#aiWizModal .aig-lista-col { flex:1; min-width:0; }
#aiWizModal .aig-lista-col-hdr { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#5A6E82; margin-bottom:5px; padding-bottom:3px; border-bottom:1.5px solid #D8E4F0; }
#aiWizModal .aig-lista-item { display:flex; align-items:flex-start; gap:5px; margin-bottom:3px; }
#aiWizModal .aig-bullet { color:#90A4AE; font-size:11px; line-height:1.7; flex-shrink:0; }
#aiWizModal .aig-list-block { flex:1; }
#aiWizModal .aig-add-list-item { background:none; border:1px dashed #B0BEC5; color:#9AABB8; font-size:10px; cursor:pointer; padding:2px 8px; border-radius:3px; margin-top:3px; }
#aiWizModal .aig-add-list-item:hover { color:#5A6E82; border-color:#5A6E82; }
/* ── Tablas editables ── */
#aiWizModal .aig-table-wrap { overflow-x:auto; }
#aiWizModal .aig-table-edit { width:100%; border-collapse:collapse; font-size:11.5px; }
#aiWizModal .aig-table-edit th { background:#EEF2F5; color:#213B50; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:.3px; padding:5px 8px; border:1px solid #D0DAE6; text-align:left; }
#aiWizModal .aig-table-edit td { padding:5px 8px; border:1px solid #D8E4F0; color:#2A3B4C; vertical-align:top; }
#aiWizModal .aig-table-edit td[contenteditable]:hover { background:#F0F7FF; }
#aiWizModal .aig-table-edit td[contenteditable]:focus { background:#E8F4FF; outline:none; box-shadow:inset 0 0 0 1.5px #90CAF9; }
#aiWizModal .aig-tinfo-campo { font-weight:600; color:#5A6E82; background:#F4F7FA; white-space:nowrap; width:40%; }
#aiWizModal .aig-add-row { background:none; border:1px dashed #B0BEC5; color:#9AABB8; font-size:10px; cursor:pointer; padding:2px 10px; border-radius:3px; margin-top:4px; }
#aiWizModal .aig-add-row:hover { color:#5A6E82; border-color:#5A6E82; }
/* ── Caja resultado / conclusión ── */
#aiWizModal .aig-caja-edit label { font-size:10px; font-weight:600; color:#5A6E82; display:block; margin-bottom:2px; }
#aiWizModal .aig-caja-edit input { width:100%; padding:5px 8px; border:1.5px solid #C0CDD9; border-radius:4px; font-size:12px; color:#1A2733; box-sizing:border-box; }
/* ── GAP tarjetas ── */
#aiWizModal .aig-gap-edit label { font-size:10px; font-weight:600; color:#5A6E82; display:block; margin-bottom:2px; }
#aiWizModal .aig-gap-edit input { width:100%; padding:5px 8px; border:1.5px solid #C0CDD9; border-radius:4px; font-size:11px; color:#1A2733; box-sizing:border-box; }
#aiWizModal .aig-gap-badge { display:inline-block; font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; margin-bottom:8px; text-transform:uppercase; letter-spacing:.3px; }
#aiWizModal .aig-gap-badge.aig-gap-sev-crítico,#aiWizModal .aig-gap-badge.aig-gap-sev-critico { background:#FDECEA; color:#C62828; border:1px solid #FFCDD2; }
#aiWizModal .aig-gap-badge.aig-gap-sev-mayor { background:#FFF3E0; color:#E65100; border:1px solid #FFCC80; }
#aiWizModal .aig-gap-badge.aig-gap-sev-menor,#aiWizModal .aig-gap-badge.aig-gap-sev-observación,#aiWizModal .aig-gap-badge.aig-gap-sev-observacion { background:#E8F5E9; color:#2E7D32; border:1px solid #A5D6A7; }
/* ── Vistas de solo lectura (arbol, fórmula, RAI, etc.) ── */
#aiWizModal .aig-readonly-view { font-size:11.5px; color:#2A3B4C; line-height:1.55; }
#aiWizModal .aig-readonly-view p { margin:0 0 6px; }
#aiWizModal .aig-readonly-note { font-size:10px; color:#9AABB8; font-style:italic; margin-top:8px; padding-top:5px; border-top:1px dashed #D8E4F0; }
#aiWizModal .aig-arbol-paso { display:flex; gap:8px; margin-bottom:4px; align-items:flex-start; }
#aiWizModal .aig-arbol-q { color:#5A6E82; flex:1; }
#aiWizModal .aig-arbol-r { font-weight:600; color:#213B50; }
#aiWizModal .aig-formula-box { background:#F4F7FA; border:1.5px solid #C8D4E0; border-radius:5px; padding:8px 12px; font-family:monospace; font-size:13px; font-weight:700; color:#213B50; margin:6px 0; letter-spacing:.5px; }
#aiWizModal .aig-rai-calculo { font-family:monospace; font-size:13px; font-weight:700; color:#213B50; margin-bottom:4px; }
#aiWizModal .aig-rai-nivel { font-size:14px; font-weight:800; color:#1565C0; margin-bottom:2px; }
#aiWizModal .aig-rai-rangos { font-size:10px; color:#7A8EA0; }
/* ── Fallback genérico para tipos desconocidos ── */
#aiWizModal .aig-generic-view { font-size:11.5px; }
#aiWizModal .aig-gf-row { display:flex; gap:10px; margin-bottom:7px; align-items:flex-start; }
#aiWizModal .aig-gf-key { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.3px; color:#7A8EA0; width:110px; flex-shrink:0; padding-top:4px; }
#aiWizModal .aig-gf-val { flex:1; }
#aiWizModal .aig-gf-num { font-weight:700; color:#213B50; padding-top:4px; }
#aiWizModal .aig-gf-arr { flex:1; }
#aiWizModal .aig-gf-item { font-size:11px; color:#2A3B4C; padding:3px 0; border-bottom:1px solid #EEF2F5; }
/* ── Botón regenerar sección puntual ── */
#aiWizModal .aig-sec-regen-btn {
    padding: 2px 7px; font-size: 11px; font-weight: 700;
    background: transparent; border: 1px solid #5b9bd5;
    color: #5b9bd5; border-radius: 3px; cursor: pointer;
    opacity: 0.55; transition: opacity .15s, background .15s;
    line-height: 1.4; flex-shrink: 0;
}
#aiWizModal .aig-sec-regen-btn:hover { opacity: 1; background: #E3F0FB; }
/* ── Mensaje de carga animado ── */
#aiWizModal .aig-loading-msg {
    font-size: 12px; color: #5A6E82; margin-top: 10px;
    font-style: italic; transition: opacity 0.2s ease;
    min-height: 18px;
}
/* ── Módulos cascade ── */
#aiWizModal .aig-module-item .aig-doc-name { font-style: italic; }
#aiWizModal .aig-module-sub { font-size: 10px; opacity: .65; font-weight: 400; font-style: normal; display: block; }
#aiWizModal .aig-add-module-row { padding: 6px 14px 2px; }
#aiWizModal .aig-add-module-btn {
    background: none; border: 1px dashed #B0C2D4; border-radius: 4px;
    color: #5A6E82; font-size: 11px; cursor: pointer; padding: 3px 10px; width: 100%;
    transition: border-color .15s, color .15s;
}
#aiWizModal .aig-add-module-btn:hover { border-color: var(--vsc-azul,#213B50); color: var(--vsc-azul,#213B50); }
#aiWizModal .aig-add-module-form { padding: 6px 14px; border-top: 1px solid #E8EEF4; background: #F5F8FB; }
#aiWizModal .aig-mod-form-row { display: flex; gap: 5px; align-items: center; }
#aiWizModal .aig-mod-select { border: 1px solid #C0CDD9; border-radius: 4px; padding: 3px 6px; font-size: 11px; background: #fff; }
#aiWizModal .aig-mod-input { flex: 1; border: 1px solid #C0CDD9; border-radius: 4px; padding: 3px 7px; font-size: 11px; }
#aiWizModal .aig-mod-input:focus { outline: none; border-color: var(--vsc-azul,#213B50); }
#aiWizModal .aig-mod-ok { background: var(--vsc-azul,#213B50); color: #fff; border: none; border-radius: 4px; padding: 3px 10px; font-size: 12px; cursor: pointer; font-weight: 700; }
#aiWizModal .aig-mod-ok:hover { background: #152A3D; }
#aiWizModal .aig-mod-cancel { background: none; border: 1px solid #C0CDD9; border-radius: 4px; padding: 3px 7px; font-size: 11px; cursor: pointer; color: #7A8EA0; }
        `;
        document.head.appendChild(s);
    }

    // ── DOM ───────────────────────────────────────────────────────────

    function _ensureModal() {
        if (_modal) return;
        _injectStyles();
        _modal = document.createElement('div');
        _modal.id = 'aiWizModal';
        _modal.innerHTML = `
            <div class="aig-content">
                <div class="aig-header">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                    <h2>AI Generator <span class="aig-proj" id="aigProjName"></span></h2>
                    <button class="aig-close" id="aigClose" title="Cerrar">&times;</button>
                </div>
                <div class="aig-statusbar" id="aigStatusBar">
                    <span>Listo</span>
                </div>
                <div class="aig-body">
                    <div class="aig-sidebar">
                        <div class="aig-sidebar-header">Ciclo de Validación</div>
                        <div class="aig-sidebar-list" id="aigSidebarList"></div>
                        <div class="aig-sidebar-footer">
                            <label class="aig-model-toggle">
                                <input type="checkbox" id="aigOpus"> Usar Opus (mejor calidad)
                            </label>
                        </div>
                    </div>
                    <div class="aig-main">
                        <div class="aig-pane-header" id="aigPaneHeader">
                            <span id="aigPaneTitle">Inicio</span>
                            <span id="aigPaneStatus" style="font-weight:400;font-size:11px;color:#5A6E82"></span>
                        </div>
                        <div class="aig-main-body" id="aigMainBody"></div>
                        <div class="aig-footer" id="aigFooter"></div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(_modal);
        document.getElementById('aigClose').onclick = () => WizardUI.close();
        document.getElementById('aigOpus').onchange = e => { _useOpus = e.target.checked; };
        _modal.addEventListener('click', e => { if (e.target === _modal) WizardUI.close(); });
    }

    // ── Public ────────────────────────────────────────────────────────

    const WizardUI = {
        open() {
            const projectId = VS.projects && VS.projects.getActiveId
                ? VS.projects.getActiveId() : null;
            if (!projectId) {
                _notify('Seleccioná un proyecto antes de usar el AI Generator', 'warning');
                return;
            }
            _ensureModal();
            // Nombre del proyecto en el header
            const snap = _readSnap();
            const projName = snap && snap.projectData && snap.projectData.projectName
                ? snap.projectData.projectName : projectId;
            document.getElementById('aigProjName').textContent = '— ' + projName;
            document.getElementById('aigOpus').checked = _useOpus;

            const gampCat = snap && snap.systemInfo && snap.systemInfo.categoriaGamp || '';
            if (!gampCat) {
                _notify('El proyecto no tiene categoría GAMP configurada. Completá los datos del sistema antes de generar documentos.', 'warning', 6000);
                return;
            }

            _state = _WS().load(projectId);

            // Aplicar skips GAMP desde el proyecto si la categoría cambió o es la primera vez.
            // Solo cuando no hay docs aprobados (evita pisar decisiones manuales mid-ciclo).
            const hasApproved = Object.keys(_state.approvedDocs || {}).length > 0;
            if (!hasApproved && _state.gampScopeApplied !== gampCat) {
                _state = _WS().applyProjectGAMP(_state, gampCat);
                _WS().save(_state);
            }

            // Limpiar error de sesión anterior al abrir
            if (_state.lastError && _state.status === 'idle') {
                _state = { ..._state, lastError: null };
                _WS().save(_state);
            }
            _render();
            _modal.style.display = 'block';
        },
        close() {
            if (_modal) _modal.style.display = 'none';
        }
    };

    // ── Render ────────────────────────────────────────────────────────

    function _render() {
        _renderSidebar();
        _renderStatusBar();
        switch (_state.status) {
            case 'idle':       _renderIdle();       break;
            case 'generating': _renderGenerating(); break;
            case 'review':     _renderReview();     break;
            case 'done':       _renderDone();       break;
        }
    }

    function _renderSidebar() {
        const list = document.getElementById('aigSidebarList');
        if (!list) return;
        const WS      = _WS();
        const skipped = _state.skippedDocs || {};
        const cascade = WS.getActiveCascade(_state);
        let lastPhase = null;

        const items = cascade.map(t => {
            const inst    = (_state.moduleInstances || []).find(m => m.id === t);
            const isModule = !!inst;
            const done    = !!_state.approvedDocs[t];
            const isSkip  = !!skipped[t];
            const cur     = _state.currentDocType === t && !done && !isSkip;
            const phase   = isModule ? (PHASE_LABELS[inst.baseType] || 'Protocolos') : (PHASE_LABELS[t] || 'Otro');
            let phaseHtml = '';
            if (phase !== lastPhase) {
                phaseHtml = `<div class="aig-phase-label">${_esc(phase)}</div>`;
                lastPhase = phase;
            }

            const displayName = isModule
                ? `${t.toUpperCase()} <span class="aig-module-sub">${_esc(inst.label)}</span>`
                : t.toUpperCase();

            let iconCls, iconTxt, itemCls, actions;
            if (done) {
                iconCls = 'done-icon'; iconTxt = '✓'; itemCls = 'done-item';
                actions = `<div class="aig-doc-actions">
                    <button class="aig-act-btn act-green" data-action="download" data-type="${t}" title="Descargar JSON de este documento">⬇</button>
                    <button class="aig-act-btn act-blue" data-action="regen-solo" data-type="${t}" title="Regenerar solo este (los posteriores se conservan)">⟳</button>
                    <button class="aig-act-btn" data-action="rewind" data-type="${t}" title="Rehacer desde aquí (invalida los posteriores)">♻</button>
                </div>`;
            } else if (isSkip) {
                iconCls = 'skip-icon'; iconTxt = '–'; itemCls = 'skipped';
                actions = isModule
                    ? `<div class="aig-doc-actions">
                        <button class="aig-act-btn act-red" data-action="remove-module" data-type="${t}" title="Quitar módulo del ciclo">✕</button>
                    </div>`
                    : `<div class="aig-doc-actions">
                        <button class="aig-act-btn act-green" data-action="unskip" data-type="${t}" title="Incluir este documento en el ciclo">↩</button>
                    </div>`;
            } else if (cur) {
                iconCls = 'cur-icon'; iconTxt = '→'; itemCls = 'cur';
                actions = isModule
                    ? `<div class="aig-doc-actions">
                        <button class="aig-act-btn act-red" data-action="remove-module" data-type="${t}" title="Quitar módulo del ciclo">✕</button>
                    </div>`
                    : `<div class="aig-doc-actions">
                        <button class="aig-act-btn act-red" data-action="skip" data-type="${t}" title="Marcar como No aplica y saltear">✕</button>
                    </div>`;
            } else {
                iconCls = 'pend-icon'; iconTxt = t.slice(0,1).toUpperCase(); itemCls = 'pending';
                actions = isModule
                    ? `<div class="aig-doc-actions">
                        <button class="aig-act-btn act-red" data-action="remove-module" data-type="${t}" title="Quitar módulo del ciclo">✕</button>
                    </div>`
                    : `<div class="aig-doc-actions">
                        <button class="aig-act-btn act-red" data-action="skip" data-type="${t}" title="Marcar como No aplica">✕</button>
                    </div>`;
            }

            return `${phaseHtml}<div class="aig-doc-item ${itemCls}${isModule ? ' aig-module-item' : ''}">
                <div class="aig-doc-icon ${iconCls}">${iconTxt}</div>
                <span class="aig-doc-name">${displayName}</span>
                ${actions}
            </div>`;
        }).join('');

        const addModuleHtml = _state.sourceDocText ? `
            <div class="aig-add-module-row">
                <button class="aig-add-module-btn" id="aigAddModuleBtn">⊕ Agregar módulo OQ / IQ / PQ</button>
            </div>` : '';

        list.innerHTML = items + addModuleHtml;

        // Bind action buttons
        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const { action, type } = btn.dataset;
                if (action === 'download')      _downloadDocJson(type, _state.approvedDocs[type]);
                if (action === 'regen-solo')    _regenSolo(type);
                if (action === 'rewind')        _confirmRewind(type);
                if (action === 'skip')          _confirmSkip(type);
                if (action === 'unskip')        _doUnskip(type);
                if (action === 'remove-module') _removeModule(type);
            };
        });

        const addBtn = document.getElementById('aigAddModuleBtn');
        if (addBtn) addBtn.onclick = _toggleAddModuleForm;

        const curEl = list.querySelector('.aig-doc-item.cur');
        if (curEl) curEl.scrollIntoView({ block: 'nearest' });
    }

    function _toggleAddModuleForm() {
        const existing = document.getElementById('aigAddModuleForm');
        if (existing) { existing.remove(); return; }

        const form = document.createElement('div');
        form.id = 'aigAddModuleForm';
        form.className = 'aig-add-module-form';
        const baseOrder = ['piq','poq','ppq','iiq','ioq','ipq','riq','roq','rpq'];
        form.innerHTML = `
            <div class="aig-mod-form-row">
                <select id="aigModType" class="aig-mod-select">
                    ${baseOrder.map(t => `<option value="${t}">${t.toUpperCase()}</option>`).join('')}
                </select>
                <input id="aigModLabel" class="aig-mod-input" placeholder="Ej: Gestión de Stock">
                <button id="aigModConfirm" class="aig-mod-ok">+</button>
                <button id="aigModCancel" class="aig-mod-cancel">✕</button>
            </div>`;

        const addRow = document.getElementById('aigAddModuleBtn');
        if (addRow) addRow.closest('.aig-add-module-row').insertAdjacentElement('afterend', form);

        document.getElementById('aigModConfirm').onclick = () => {
            const baseType = document.getElementById('aigModType').value;
            const label    = (document.getElementById('aigModLabel').value || '').trim();
            try {
                _state = _WS().addModuleInstance(_state, baseType, label || baseType.toUpperCase() + ' Módulo');
                _WS().save(_state);
                form.remove();
                _render();
                _notify(`Módulo ${baseType.toUpperCase()} agregado al ciclo.`, 'info');
            } catch (e) { _notify(e.message, 'error'); }
        };
        document.getElementById('aigModCancel').onclick = () => form.remove();
        const inp = document.getElementById('aigModLabel');
        inp.focus();
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter')  document.getElementById('aigModConfirm').click();
            if (e.key === 'Escape') document.getElementById('aigModCancel').click();
        });
    }

    function _removeModule(instanceId) {
        if (!confirm(`¿Quitás el módulo ${instanceId.toUpperCase()} del ciclo? Si ya fue generado, se perderá su contenido.`)) return;
        _state = _WS().removeModuleInstance(_state, instanceId);
        _WS().save(_state);
        _render();
        _notify(`Módulo ${instanceId.toUpperCase()} eliminado del ciclo.`, 'info');
    }

    function _confirmRewind(docType) {
        const WS = _WS();
        const cascade = WS.getActiveCascade(_state);
        const idx = cascade.indexOf(docType);
        const toInvalidate = cascade.slice(idx).filter(t => _state.approvedDocs[t] || (_state.skippedDocs || {})[t]);
        const names = toInvalidate.map(t => t.toUpperCase()).join(', ');
        const msg = toInvalidate.length > 1
            ? `¿Rehacés ${docType.toUpperCase()}? Se invalidarán: ${names}.`
            : `¿Rehacés ${docType.toUpperCase()}?`;
        if (!confirm(msg)) return;
        _state = WS.rewindTo(_state, docType);
        WS.save(_state);
        _render();
        _notify(`Volviste a ${docType.toUpperCase()} — los documentos posteriores fueron invalidados.`, 'info');
    }

    function _confirmSkip(docType) {
        if (!confirm(`¿Marcás ${docType.toUpperCase()} como "No aplica"? No se generará y el ciclo continuará con el siguiente.`)) return;
        try {
            _state = _WS().skipDoc(_state, docType);
            _WS().save(_state);
            _render();
            _notify(`${docType.toUpperCase()} marcado como No aplica.`, 'info');
        } catch (e) {
            _notify(e.message, 'error');
        }
    }

    function _doUnskip(docType) {
        _state = _WS().unskipDoc(_state, docType);
        _WS().save(_state);
        _render();
        _notify(`${docType.toUpperCase()} incluido nuevamente en el ciclo.`, 'info');
    }

    function _renderStatusBar() {
        const bar = document.getElementById('aigStatusBar');
        if (!bar) return;
        const WS = _WS();
        const { approved, skipped, total } = WS.getProgress(_state);
        const effective = total - skipped;
        const pct = effective > 0 ? Math.round((approved / effective) * 100) : 100;
        const isDone = _state.status === 'done';
        const skipNote = skipped > 0 ? ` <span style="opacity:.6;font-size:10px">· ${skipped} omitido${skipped > 1 ? 's' : ''}</span>` : '';
        bar.innerHTML = `
            <span class="aig-badge ${isDone ? 'done' : ''}">${approved}/${effective}</span>
            ${skipNote}
            <span>${isDone ? '¡Ciclo completo!' : _state.sourceDocText ? `Ciclo en progreso — ${pct}% completado` : 'Cargá el documento fuente para comenzar'}</span>
            ${_state.sourceDocName ? `<span style="opacity:.6">· ${_esc(_state.sourceDocName)}</span>` : ''}
        `;
    }

    // ── Pasos ─────────────────────────────────────────────────────────

    function _renderIdle() {
        const type  = _state.currentDocType;
        const label = _shortLabel(type);
        _setPaneHeader(type ? `Generar ${type.toUpperCase()}` : 'Inicio', '');

        const body   = document.getElementById('aigMainBody');
        const footer = document.getElementById('aigFooter');
        if (!body || !footer) return;

        const errHtml = _state.lastError
            ? `<div class="aig-err">⚠ ${_esc(_state.lastError)}</div>` : '';

        if (!_state.sourceDocText) {
            const hasFolder = !!(VS.ProjectFolderFS && _state.projectId);
            body.innerHTML = `
                ${errHtml}
                <p class="aig-label">Paso 1 — Documento fuente</p>
                <div class="aig-info">Cargá el documento fuente del proyecto (URS del cliente, especificaciones, etc.). Se usará como base para generar los ${_WS().getActiveCascade(_state).length} documentos del ciclo.</div>
                ${hasFolder ? `
                <div style="background:#0d2a1a;border:1px solid #1a6b38;border-radius:6px;padding:10px 14px;margin-bottom:10px;font-size:12px;color:#4caf80">
                    <strong>¿Perdiste el progreso?</strong> Si ya generaste documentos anteriormente, podés recuperar el contexto desde la carpeta del proyecto.
                </div>` : ''}
                <div class="aig-drop" id="aigDrop">
                    <div class="di">📄</div>
                    <div class="dm">Click o arrastrá un archivo</div>
                    <div class="ds">PDF sin escanear · Word (.docx) · Excel (.xlsx) · Máx. 50 MB</div>
                    <input type="file" id="aigFileInput" accept=".pdf,.docx,.xlsx" style="display:none">
                </div>
                <div class="aig-warn">
                    <strong>Declaración de uso responsable</strong><br>
                    El documento que cargues será utilizado por el sistema para generar el paquete de validación GxP. Al continuar, declarás que el contenido no incluye información de carácter confidencial, datos personales sensibles, secretos comerciales ni información sujeta a restricciones legales de divulgación — o que contás con autorización expresa de tu organización para su procesamiento en herramientas de asistencia documental.
                    <br><br>
                    <label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-weight:600">
                        <input type="checkbox" id="aigConfid" style="width:14px;height:14px">
                        Declaro que el documento cumple con estas condiciones y estoy autorizado a procesarlo
                    </label>
                </div>
            `;
            footer.innerHTML = '';
            if (hasFolder) {
                const recoverBtn = _mkBtn('aigBtnRecover', 'Retomar desde carpeta', 'bs');
                recoverBtn.title = 'Escanea la carpeta ai-docs del proyecto y recupera los documentos ya generados';
                recoverBtn.onclick = () => _recoverFromFolder();
                footer.appendChild(recoverBtn);
            }
            const btn = _mkBtn('aigBtnLoad', 'Cargar documento', 'bp', true);
            footer.appendChild(btn);
            _bindUpload();
        } else {
            // ── Construir estado del cascade para el selector ──
            const cascade     = _WS().getActiveCascade(_state);
            const approved    = _state.approvedDocs  || {};
            const skipped     = _state.skippedDocs   || {};
            const patchTarget = _state._patchTarget  || null; // doc aprobado seleccionado para ajustar

            // Chips del cascade: aprobado (clickeable para ajustar) / seleccionado / bloqueado / pendiente / saltado
            const cascadeChips = cascade.map(t => {
                const isApproved = !!approved[t];
                const isSkipped  = !!skipped[t];
                const isCurrent  = t === type && !patchTarget;
                const isPatch    = t === patchTarget;
                const block      = !isApproved && !isSkipped ? _WS().blockingReason({ ..._state, currentDocType: t }) : null;
                let cls, title;
                if (isApproved && isPatch) { cls = 'aig-chip aig-chip-ok aig-chip-patch-sel'; title = 'Seleccionado para ajustar — clic para cancelar'; }
                else if (isApproved)       { cls = 'aig-chip aig-chip-ok';                    title = 'Aprobado — clic para ajustar con IA'; }
                else if (isSkipped)        { cls = 'aig-chip aig-chip-skip';                   title = 'Saltado'; }
                else if (isCurrent)        { cls = 'aig-chip aig-chip-sel';                    title = 'Seleccionado para generar'; }
                else if (block)            { cls = 'aig-chip aig-chip-lock';                   title = block; }
                else                       { cls = 'aig-chip aig-chip-pend';                   title = 'Pendiente — clic para seleccionar'; }
                return `<span class="${cls}" data-doc="${_esc(t)}" title="${_esc(title)}">${_esc(_shortLabel(t))}</span>`;
            }).join('');

            // Contexto para el doc activo (patch target o generación normal)
            const ctxType  = patchTarget || type;
            const ctxDeps  = (CONTEXT_DEPS[ctxType] || []).filter(d => approved[d]);
            const ctxChips = ctxDeps.length
                ? ctxDeps.map(d => `<span class="aig-chip aig-chip-ctx" title="Se inyectará como contexto">${_esc(_shortLabel(d))}</span>`).join('')
                : '<span style="opacity:.5;font-size:11px">Sin contexto previo (primer documento del ciclo)</span>';

            // Bloqueo solo aplica en modo generación normal (no en patch — el doc ya existe)
            const blockReason = patchTarget ? null : _WS().blockingReason(_state);

            // Panel de ajuste (solo cuando hay patchTarget)
            const patchPanelHtml = patchTarget ? `
                <div style="background:#0f1f0f;border:1px solid #2d7a2d;border-radius:6px;padding:10px 12px;margin-bottom:12px">
                    <p style="margin:0 0 4px;font-size:12px;color:#6fcf6f;font-weight:600">Ajustar <strong>${_esc(_shortLabel(patchTarget))}</strong></p>
                    <p style="margin:0 0 8px;font-size:11px;color:#8ab0c8">La IA recibirá el documento actual y aplicará solo los cambios que describas. El resto se conserva.</p>
                    <textarea id="aigPatchInstr" style="width:100%;height:80px;background:#0a1520;border:1px solid #1e3a52;border-radius:6px;color:#c8d8e4;padding:8px;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="Ej: Corregí el resumen estadístico, debe decir 28 URS no 30. Eliminá las filas URS-029 y URS-030 que no existen en el URS original…"></textarea>
                </div>` : '';

            // Doc de referencia adicional (solo en modo generación, no en patch)
            const extraDocHtml = !patchTarget ? (() => {
                const extraDocs = Object.keys(approved).filter(d => !ctxDeps.includes(d) && d !== type && !skipped[d]);
                if (!extraDocs.length) return '';
                const selected = _state._customBaseDoc || null;
                const chips = extraDocs.map(d => {
                    const isSel = d === selected;
                    const cls = isSel ? 'aig-chip aig-chip-base-sel' : 'aig-chip aig-chip-base';
                    return `<span class="${cls}" data-base="${_esc(d)}" title="${isSel ? 'Clic para deseleccionar' : 'Usar como referencia adicional'}">${_esc(_shortLabel(d))}</span>`;
                }).join('');
                return `<p class="aig-label" style="margin-bottom:4px">Documento de referencia adicional <span style="opacity:.5;font-weight:400">(opcional)</span></p>
                    <div id="aigBaseChips" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">${chips}</div>`;
            })() : '';

            body.innerHTML = `
                ${errHtml}
                <div class="aig-ok" style="margin-bottom:10px">
                    <strong>Fuente:</strong> ${_esc(_state.sourceDocName)}
                    <span style="opacity:.6;font-size:11px;margin-left:8px">${_state.sourceDocText.length.toLocaleString()} chars</span>
                </div>

                <p class="aig-label" style="margin-bottom:6px">Ciclo documental — ${patchTarget ? 'seleccioná qué ajustar' : 'seleccioná qué generar'}</p>
                <div id="aigCascadeChips" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">${cascadeChips}</div>

                ${patchPanelHtml}

                <p class="aig-label" style="margin-bottom:4px">Contexto que recibirá <strong>${_esc(_shortLabel(ctxType))}</strong></p>
                <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">${ctxChips}</div>

                ${blockReason ? `<div style="background:#2a1a00;border:1px solid #c07000;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#f0a030">⚠ ${_esc(blockReason)}</div>` : ''}

                ${extraDocHtml}

                <p class="aig-label" style="margin-bottom:4px">${patchTarget ? 'Instrucciones adicionales' : 'Instrucciones para la IA'} <span style="opacity:.5;font-weight:400">(opcional)</span></p>
                <textarea id="aigPreInstr" style="width:100%;height:70px;background:#0a1520;border:1px solid #1e3a52;border-radius:6px;color:#c8d8e4;padding:8px;font-size:12px;resize:vertical;box-sizing:border-box" placeholder="${patchTarget ? 'Instrucciones adicionales para la regeneración…' : 'Ej: Enfocate en el módulo de usuarios. Usá el código VP-LIMS-002. Generá al menos 20 TCs para el módulo de reportes…'}"></textarea>
            `;

            // Click en chips del cascade
            document.getElementById('aigCascadeChips').addEventListener('click', e => {
                const chip = e.target.closest('.aig-chip');
                if (!chip) return;
                const docType = chip.dataset.doc;
                if (!docType) return;
                if (skipped[docType]) return;
                if (approved[docType]) {
                    // Toggle patch mode para este doc aprobado
                    const cur = _state._patchTarget;
                    _state = { ..._state, _patchTarget: cur === docType ? null : docType };
                } else {
                    // Cambiar doc a generar (modo normal)
                    _state = { ..._state, currentDocType: docType, _patchTarget: null };
                }
                _WS().save(_state);
                _render();
            });

            // Click en chips de base doc → seleccionar/deseleccionar referencia adicional
            const baseChipsEl = document.getElementById('aigBaseChips');
            if (baseChipsEl) {
                baseChipsEl.addEventListener('click', e => {
                    const chip = e.target.closest('.aig-chip');
                    if (!chip) return;
                    const docBase = chip.dataset.base;
                    if (!docBase) return;
                    _state = { ..._state, _customBaseDoc: (_state._customBaseDoc === docBase ? null : docBase) };
                    _WS().save(_state);
                    _render();
                });
            }

            footer.innerHTML = '';
            footer.appendChild(_mkBtn('aigBtnReset', 'Cambiar fuente', 'bs'));
            if (Object.keys(_state.approvedDocs || {}).length > 0) {
                const btnExp = _mkBtn('aigBtnExportCtx2', '↓ Claude Desktop', 'bs');
                btnExp.title = 'Exportar contexto compacto de los docs aprobados para usar en Claude Desktop';
                btnExp.onclick = () => _exportClaudeDesktopContext();
                footer.appendChild(btnExp);
            }
            const isCompact = !!_state._suggestCompact;
            const genLabel  = patchTarget
                ? `Regenerar ${_esc(_shortLabel(patchTarget))} con ajustes →`
                : (isCompact ? `Regenerar compacto →` : `Generar ${_esc(_shortLabel(type))} →`);
            const genBtn    = _mkBtn('aigBtnGen', genLabel, 'bp');
            if (blockReason) {
                genBtn.disabled      = true;
                genBtn.style.opacity = '0.45';
                genBtn.style.cursor  = 'not-allowed';
            }
            footer.appendChild(genBtn);

            document.getElementById('aigBtnReset').onclick = () => {
                _state = { ..._state, sourceDocText: null, sourceDocName: null, lastError: null, _suggestCompact: false, _patchTarget: null };
                _WS().save(_state);
                _render();
            };
            document.getElementById('aigBtnGen').onclick = () => {
                const pt = _state._patchTarget;
                if (!pt && _WS().blockingReason(_state)) return;
                const preInstr  = (document.getElementById('aigPreInstr')  || {}).value || '';
                const patchInstr = pt ? ((document.getElementById('aigPatchInstr') || {}).value || '') : '';
                const compactHint = (!pt && isCompact) ? 'Generá el documento con textos breves y directos. Priorizá completitud de estructura sobre extensión de los valores.' : '';
                const instructions = [patchInstr.trim(), preInstr.trim(), compactHint].filter(Boolean).join('\n\n');
                if (pt) {
                    // Activar regen-solo: conserva docs posteriores, reemplaza solo este
                    _state._regenSoloPrev = _state.currentDocType;
                    _state._regenSoloMode = pt;
                    _state.currentDocType = pt;
                    _state._patchTarget   = null;
                    _state.pendingDoc     = null;
                    _state.status         = 'idle';
                    _WS().save(_state);
                } else {
                    _state = { ..._state, _suggestCompact: false };
                }
                _generate(instructions);
            };
        }
    }

    function _renderGenerating() {
        const type  = _state.currentDocType;
        const short = _shortLabel(type);
        _setPaneHeader(`Generando ${type.toUpperCase()}…`, 'puede tardar 1–3 min');

        const body   = document.getElementById('aigMainBody');
        const footer = document.getElementById('aigFooter');
        if (body) {
            const msgs = [
                'Analizando contexto del proyecto',
                'Generando secciones del documento',
                'Aplicando reglas GxP',
                'Verificando trazabilidad',
                'Finalizando documento'
            ];
            body.innerHTML = `
                <div class="aig-spin">
                    <div class="ring"></div>
                    <p>Generando <strong>${_esc(short)}</strong>…</p>
                    <p class="aig-loading-msg" id="aigLoadMsg">${msgs[0]}…</p>
                    <p style="font-size:11px;color:#9AABB8;margin-top:4px">El sistema está procesando — no cierres el panel</p>
                </div>`;
            // Rotar mensajes cada 2.5 segundos mientras carga
            let msgIdx = 0;
            const loadTimer = setInterval(() => {
                msgIdx = (msgIdx + 1) % msgs.length;
                const el = document.getElementById('aigLoadMsg');
                if (el) {
                    el.style.opacity = '0';
                    setTimeout(() => {
                        if (el) { el.textContent = msgs[msgIdx] + '…'; el.style.opacity = '1'; }
                    }, 200);
                } else {
                    clearInterval(loadTimer);
                }
            }, 2500);
            // Guardar referencia para limpiar si es necesario
            body._aigLoadTimer = loadTimer;
        }
        if (footer) {
            footer.innerHTML = '';
            const btn = _mkBtn('aigBtnCancel', 'Cancelar', 'bs');
            footer.appendChild(btn);
            btn.onclick = () => {
                if (_cancelCtrl) { _cancelCtrl.abort(); _cancelCtrl = null; }
                const body2 = document.getElementById('aigMainBody');
                if (body2 && body2._aigLoadTimer) { clearInterval(body2._aigLoadTimer); }
            };
        }
    }

    function _renderReview() {
        const type    = _state.pendingDoc?.docType || _state.currentDocType;
        const docJson = _state.pendingDoc?.json;
        _setPaneHeader(`Revisar — ${type.toUpperCase()}`, 'editá y aprobá');

        const body   = document.getElementById('aigMainBody');
        const footer = document.getElementById('aigFooter');
        if (!body || !footer) return;

        const jsonStr = docJson ? JSON.stringify(docJson, null, 2) : '';
        const doc     = docJson?.document || {};
        const secs    = Array.isArray(docJson?.secciones) ? docJson.secciones : [];

        body.innerHTML = `
            <div class="aig-rev-note">
                ✎ Editá título, secciones y textos antes de aprobar.
                <strong>El sistema recibirá exactamente lo que aprobás como contexto para los siguientes documentos.</strong>
                Podés agregar, borrar o modificar secciones — vos controlás el documento final.
            </div>

            <div id="aigTabPreview" class="aig-tab-panel">
                <div class="aig-meta-edit">
                    <h4>Campos del documento</h4>
                    <div class="aig-meta-row">
                        <label>Título</label>
                        <input id="aigMetaTitle" value="${_esc(doc.titleEs || '')}" placeholder="Ej: PLAN DE VALIDACIÓN">
                    </div>
                    <div class="aig-meta-row">
                        <label>Código</label>
                        <input id="aigMetaCode" value="${_esc(doc.code || '')}" placeholder="Ej: VP-DISOL001">
                    </div>
                    <div class="aig-meta-row">
                        <label>Versión</label>
                        <input id="aigMetaVer" value="${_esc(doc.version || '')}" placeholder="Ej: 1.0">
                    </div>
                </div>
                <div id="aigSecList">
                    ${secs.map((s, i) => _renderSecEdit(s, i)).join('')}
                </div>
                <button class="aig-add-sec" id="aigAddSec">+ Agregar sección de texto</button>
            </div>

            <div style="margin-top:16px">
                <p class="aig-label">Instrucciones de cambio (para Regenerar desde cero con IA)</p>
                <textarea id="aigInstr" placeholder="Ej: Agregar riesgo de pérdida de datos, cambiar código del documento…"></textarea>
            </div>
        `;

        // No hay tabs: el preview es la única vista

        // Delegación de clicks en secciones
        document.getElementById('aigSecList').addEventListener('click', e => {
            if (e.target.classList.contains('aig-sec-del')) {
                e.target.closest('.aig-sec-edit').remove();
            }
            if (e.target.classList.contains('aig-sec-regen-btn')) {
                const si = parseInt(e.target.dataset.si, 10);
                if (!isNaN(si)) _regenSection(si);
            }
            if (e.target.classList.contains('aig-add-bloque')) {
                const secBody = e.target.closest('.aig-sec-body');
                const div = document.createElement('div');
                div.contentEditable = 'true';
                div.className = 'aig-text-block';
                div.setAttribute('placeholder', 'Escribí el párrafo…');
                secBody.insertBefore(div, e.target);
                div.focus();
            }
            if (e.target.classList.contains('aig-add-list-item')) {
                const listKey = e.target.dataset.list;
                const container = e.target.parentElement?.querySelector(`[data-list="${listKey}"]`);
                if (container) {
                    const item = document.createElement('div');
                    item.className = 'aig-lista-item';
                    item.innerHTML = '<span class="aig-bullet">▸</span><div contenteditable="true" class="aig-text-block aig-list-block" placeholder="Nuevo ítem…"></div>';
                    container.appendChild(item);
                    item.querySelector('.aig-list-block').focus();
                }
            }
            if (e.target.classList.contains('aig-add-row')) {
                const table  = e.target.closest('.aig-table-wrap')?.querySelector('.aig-table-edit');
                if (!table) return;
                const cols = parseInt(e.target.dataset.cols) || table.querySelectorAll('thead th').length || 2;
                const tbody = table.querySelector('tbody');
                const tr = document.createElement('tr');
                for (let i = 0; i < cols; i++) {
                    const td = document.createElement('td');
                    td.contentEditable = 'true';
                    td.textContent = '';
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
                tr.querySelector('td').focus();
            }
        });

        // Agregar sección nueva
        document.getElementById('aigAddSec').onclick = () => {
            const list = document.getElementById('aigSecList');
            const newSec = document.createElement('div');
            newSec.className = 'aig-sec-edit';
            newSec.dataset.si  = 'new_' + Date.now();
            newSec.dataset.tipo = 'texto';
            newSec.innerHTML = `
                <div class="aig-sec-hdr">
                    <input class="aig-sec-title" value="" placeholder="Título de la sección">
                    <button class="aig-sec-del" title="Eliminar sección">✕</button>
                </div>
                <div class="aig-sec-body">
                    <div contenteditable="true" class="aig-text-block" placeholder="Escribí el contenido…"></div>
                    <button class="aig-add-bloque">+ Párrafo</button>
                </div>`;
            list.appendChild(newSec);
            newSec.querySelector('.aig-sec-title').focus();
        };

        // JSON editor live validation
        const editArea = document.getElementById('aigJsonEdit');
        const statusEl = document.getElementById('aigJsonStatus');
        if (editArea && statusEl) {
            editArea.addEventListener('input', () => {
                try { JSON.parse(editArea.value); statusEl.textContent = 'JSON válido'; statusEl.className = 'aig-jvalid'; }
                catch (_) { statusEl.textContent = 'Contenido inválido — corregí antes de aprobar'; statusEl.className = 'aig-jinvalid'; }
            });
        }

        // Copy button
        const copyBtn = document.getElementById('aigCopyBtn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const txt = editArea ? editArea.value : jsonStr;
                navigator.clipboard.writeText(txt)
                    .then(() => { copyBtn.textContent = '✓ Copiado'; setTimeout(() => { copyBtn.textContent = '⎘ Copiar'; }, 1500); })
                    .catch(() => {});
            };
        }

        footer.innerHTML = '';
        const discardBtn = _mkBtn('aigBtnDiscard', '✕ Descartar', 'bs');
        discardBtn.style.cssText = 'margin-right:auto;color:#c0392b;border-color:#c0392b;';
        footer.appendChild(discardBtn);
        footer.appendChild(_mkBtn('aigBtnRegen',     'Regenerar con IA',        'bs'));
        footer.appendChild(_mkBtn('aigBtnApply',     'Aplicar cambios',          'bs'));
        const dlBtn = _mkBtn('aigBtnDownload', '⬇ Descargar JSON', 'bs');
        dlBtn.title = 'Descarga el JSON de este documento para guardarlo localmente';
        footer.appendChild(dlBtn);
        footer.appendChild(_mkBtn('aigBtnApprove',   '✓ Aprobar y continuar →', 'ba'));

        document.getElementById('aigBtnDiscard').onclick = () => {
            if (!confirm(`¿Descartás el ${type.toUpperCase()} generado? Se eliminará de la carpeta del proyecto y podrás volver a generarlo.`)) return;
            const FS = VS.ProjectFolderFS;
            if (FS && FS.isSupported && FS.isSupported()) {
                FS.deleteAIDoc(_state.projectId, type)
                    .catch(err => console.warn(`[AIGen] No se eliminó ${type} de carpeta:`, err.message));
            }
            _state = { ..._state, pendingDoc: null, status: 'idle', currentDocType: type };
            _WS().save(_state);
            _render();
            _notify(`${type.toUpperCase()} descartado.`, 'info');
        };

        document.getElementById('aigBtnRegen').onclick = () => {
            const instr = (document.getElementById('aigInstr') || {}).value || '';
            _generate(instr.trim());
        };

        document.getElementById('aigBtnApply').onclick = () => {
            const edited = _collectPreviewJson(docJson);
            _state.pendingDoc = { ..._state.pendingDoc, json: edited };
            _WS().save(_state);
            const btn = document.getElementById('aigBtnApply');
            const orig = btn.textContent;
            btn.textContent = '✓ Guardado';
            btn.disabled = true;
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800);
        };

        document.getElementById('aigBtnApprove').onclick = () => {
            _state.pendingDoc = { ..._state.pendingDoc, json: _collectPreviewJson(docJson) };
            _approve();
        };

        document.getElementById('aigBtnDownload').onclick = () => {
            const currentJson = _collectPreviewJson(docJson);
            _downloadDocJson(type, currentJson);
        };
    }

    /** Renderiza una sección como bloque editable según su tipo. */
    function _renderSecEdit(sec, idx) {
        const title = _esc(sec.titulo || '');
        const tipo  = sec.tipo || 'texto';
        let content = '';

        if (tipo === 'texto') {
            // Soporta ambos formatos: bloques:[{texto}] y contenido:"string"
            let bloques = Array.isArray(sec.bloques) && sec.bloques.length > 0
                ? sec.bloques
                : sec.contenido ? [{ texto: sec.contenido }] : [];
            content = bloques.map(b =>
                `<div contenteditable="true" class="aig-text-block" placeholder="Escribí el párrafo…">${_esc(b.texto || '')}</div>`
            ).join('');
            content += `<button class="aig-add-bloque">+ Párrafo</button>`;

        } else if (tipo === 'caja-conclusion') {
            const parrafos = Array.isArray(sec.parrafos) ? sec.parrafos : [];
            content = parrafos.map(p =>
                `<div contenteditable="true" class="aig-text-block">${_esc(p)}</div>`
            ).join('');
            content += `<button class="aig-add-bloque">+ Párrafo</button>`;

        } else if (tipo === 'lista-incluido-excluido') {
            const incl  = Array.isArray(sec.incluido) ? sec.incluido : [];
            const excl  = Array.isArray(sec.excluido) ? sec.excluido : [];
            const subI  = _esc(sec.subIncluido || 'Incluido');
            const subE  = _esc(sec.subExcluido || 'Excluido');
            content = `
                <div class="aig-lista-cols">
                    <div class="aig-lista-col">
                        <div class="aig-lista-col-hdr">${subI}</div>
                        <div class="aig-lista-items" data-list="incluido">
                            ${incl.map(it => `<div class="aig-lista-item"><span class="aig-bullet">▸</span><div contenteditable="true" class="aig-text-block aig-list-block">${_esc(it)}</div></div>`).join('')}
                        </div>
                        <button class="aig-add-list-item" data-list="incluido">+ Ítem</button>
                    </div>
                    <div class="aig-lista-col">
                        <div class="aig-lista-col-hdr">${subE}</div>
                        <div class="aig-lista-items" data-list="excluido">
                            ${excl.map(it => `<div class="aig-lista-item"><span class="aig-bullet">▸</span><div contenteditable="true" class="aig-text-block aig-list-block">${_esc(it)}</div></div>`).join('')}
                        </div>
                        <button class="aig-add-list-item" data-list="excluido">+ Ítem</button>
                    </div>
                </div>`;

        } else if (tipo === 'tabla') {
            const cols  = Array.isArray(sec.columnas) ? sec.columnas : [];
            const filas = Array.isArray(sec.filas) ? sec.filas : [];
            content = `
                <div class="aig-table-wrap">
                    <table class="aig-table-edit">
                        <thead><tr>${cols.map(c => `<th>${_esc(c)}</th>`).join('')}</tr></thead>
                        <tbody>
                            ${filas.map(fila => `<tr>${(Array.isArray(fila) ? fila : [fila]).map(cell => `<td contenteditable="true">${_esc(String(cell ?? ''))}</td>`).join('')}</tr>`).join('')}
                        </tbody>
                    </table>
                    <button class="aig-add-row" data-cols="${cols.length}">+ Fila</button>
                </div>`;

        } else if (tipo === 'tabla-info') {
            const filas = Array.isArray(sec.filas) ? sec.filas : [];
            content = `
                <div class="aig-table-wrap">
                    <table class="aig-table-edit aig-table-info">
                        <tbody>
                            ${filas.map(f => `<tr><td class="aig-tinfo-campo">${_esc(f.campo || '')}</td><td contenteditable="true" class="aig-tinfo-valor">${_esc(String(f.valor ?? ''))}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;

        } else if (tipo === 'tabla-docs-aplicables') {
            const filas = Array.isArray(sec.filas) ? sec.filas : [];
            content = `
                <div class="aig-readonly-view">
                    ${sec.intro ? `<p>${_esc(sec.intro)}</p>` : ''}
                    ${filas.length ? `
                    <div class="aig-table-wrap"><table class="aig-table-edit">
                        <thead><tr><th>Documento</th><th>Aplicación</th></tr></thead>
                        <tbody>${filas.map(f => `<tr><td>${_esc(String(f.doc||f[0]||''))}</td><td>${_esc(String(f.aplicacion||f[1]||''))}</td></tr>`).join('')}</tbody>
                    </table></div>` : ''}
                </div>`;

        } else if (tipo === 'caja-resultado') {
            content = `
                <div class="aig-caja-edit">
                    <label>Subtítulo</label>
                    <input class="aig-caja-subtitulo" value="${_esc(sec.subtitulo || '')}">
                    <label style="margin-top:6px">Resultado</label>
                    <input class="aig-caja-icono" value="${_esc(sec.icono || '')}">
                </div>`;

        } else if (tipo === 'tarjeta-gap') {
            const sev = (sec.severidad || '').toLowerCase().replace(/\s+/g, '-');
            content = `
                <div class="aig-gap-edit">
                    <div class="aig-gap-badge aig-gap-sev-${_esc(sev)}">${_esc(sec.severidadLabel || sec.severidad || '')}</div>
                    <label>Descripción del gap</label>
                    <div contenteditable="true" class="aig-text-block aig-gap-desc">${_esc(sec.descripcion || '')}</div>
                    <label style="margin-top:6px">Acción / mitigación</label>
                    <div contenteditable="true" class="aig-text-block aig-gap-mit">${_esc(sec.mitigacion || sec.accion || '')}</div>
                    <label style="margin-top:6px">Norma de referencia</label>
                    <input class="aig-gap-norma" value="${_esc(sec.norma || '')}">
                </div>`;

        } else if (tipo === 'arbol-decision-gamp') {
            const pasos = Array.isArray(sec.pasos) ? sec.pasos : [];
            content = `
                <div class="aig-readonly-view">
                    ${sec.intro ? `<p>${_esc(sec.intro)}</p>` : ''}
                    ${pasos.map(p => `
                        <div class="aig-arbol-paso">
                            <span class="aig-arbol-q">${_esc(p.pregunta || '')}</span>
                            <span class="aig-arbol-r">&nbsp;→&nbsp;${_esc(p.respuesta || '')} — ${_esc(p.resultado || '')}</span>
                        </div>`).join('')}
                    <div class="aig-readonly-note">Árbol de decisión GAMP — revisar categorización</div>
                </div>`;

        } else if (tipo === 'formula-rai') {
            const vars = Array.isArray(sec.variables) ? sec.variables : [];
            content = `
                <div class="aig-readonly-view">
                    ${sec.intro ? `<p>${_esc(sec.intro)}</p>` : ''}
                    <div class="aig-formula-box">${_esc(sec.formula || '')}</div>
                    ${vars.length ? `<div class="aig-table-wrap"><table class="aig-table-edit" style="margin-top:6px"><thead><tr><th>Var</th><th>Parámetro</th><th>Valor</th><th>Justificación</th></tr></thead><tbody>${vars.map(v => `<tr><td style="font-weight:700">${_esc(v.var||'')}</td><td>${_esc(v.nombre||'')}</td><td style="font-weight:700">${_esc(String(v.valor??''))}</td><td style="color:#5A7A90">${_esc(v.justificacion||'')}</td></tr>`).join('')}</tbody></table></div>` : ''}
                    <div class="aig-readonly-note">Fórmula de criticidad operativa — valores calculados según metodología GAMP 5 / ICH Q9</div>
                </div>`;

        } else if (tipo === 'box-resultado-rai') {
            content = `
                <div class="aig-readonly-view aig-box-rai">
                    <div class="aig-rai-calculo">${_esc(sec.calculo || '')}</div>
                    <div class="aig-rai-nivel">${_esc(sec.nivel || '')}</div>
                    <div class="aig-rai-rangos">${_esc(sec.rangos || '')}</div>
                    <div class="aig-readonly-note">Índice de riesgo operativo — resultado automático</div>
                </div>`;

        } else if (tipo === 'tabla-firmas-final') {
            content = `
                <div class="aig-readonly-view">
                    ${sec.intro ? `<p>${_esc(sec.intro)}</p>` : ''}
                    <div class="aig-readonly-note">Las firmas son gestionadas desde el módulo Firma Digital del paquete de validación.</div>
                </div>`;

        } else if (tipo === 'caja-nota' || tipo === 'caja-criterio' || tipo === 'caja-justificacion') {
            // Cajas con parrafos editables (mismo patrón que caja-conclusion)
            const parrafos = Array.isArray(sec.parrafos) ? sec.parrafos
                           : sec.intro ? [sec.intro] : [];
            content = parrafos.map(p =>
                `<div contenteditable="true" class="aig-text-block">${_esc(p)}</div>`
            ).join('');
            content += `<button class="aig-add-bloque">+ Párrafo</button>`;

        } else if (tipo === 'subseccion') {
            content = `<div contenteditable="true" class="aig-text-block" placeholder="Descripción de la subsección…">${_esc(sec.intro || sec.descripcion || '')}</div>`;

        } else if (tipo === 'aceptacion-riesgo-residual') {
            const items = Array.isArray(sec.items) ? sec.items : [];
            content = `
                <div class="aig-readonly-view">
                    ${sec.conclusion ? `<div contenteditable="true" class="aig-text-block">${_esc(sec.conclusion)}</div>` : ''}
                    <div class="aig-lista-items" data-list="items" style="margin-top:6px">
                        ${items.map(it => `<div class="aig-lista-item"><span class="aig-bullet">▸</span><div contenteditable="true" class="aig-text-block aig-list-block">${_esc(it)}</div></div>`).join('')}
                    </div>
                    <button class="aig-add-list-item" data-list="items">+ Ítem</button>
                </div>`;

        } else if (tipo === 'tarjeta-gap-rrm') {
            const sev = (sec.criticidad || sec.severidad || '').toLowerCase().replace(/\s+/g, '-');
            content = `
                <div class="aig-gap-edit">
                    <div class="aig-gap-badge aig-gap-sev-${_esc(sev)}">${_esc(sec.criticidadLabel || sec.criticidad || sec.severidadLabel || sec.severidad || '')}</div>
                    <label>Descripción</label>
                    <div contenteditable="true" class="aig-text-block aig-gap-desc">${_esc(sec.descripcion || '')}</div>
                    <label style="margin-top:6px">Acción / cierre</label>
                    <div contenteditable="true" class="aig-text-block aig-gap-mit">${_esc(sec.cierre || sec.mitigacion || sec.accion || '')}</div>
                </div>`;

        } else {
            // Fallback inteligente: muestra todos los campos de texto del objeto
            content = _renderGenericFields(sec, tipo);
        }

        return `
            <div class="aig-sec-edit" data-si="${idx}" data-tipo="${_esc(tipo)}">
                <div class="aig-sec-hdr">
                    <input class="aig-sec-title" value="${title}" placeholder="Título de la sección">
                    <button class="aig-sec-regen-btn" data-si="${idx}" title="Regenerar solo esta sección con IA">↺</button>
                    <button class="aig-sec-del" title="Eliminar sección">✕</button>
                </div>
                <div class="aig-sec-body">${content}</div>
            </div>`;
    }

    /**
     * Fallback genérico: recorre todos los campos del objeto y muestra
     * strings como editables, arrays de strings como listas, arrays de objetos
     * como tabla resumida. Cubre todos los tipos de sección desconocidos.
     */
    function _renderGenericFields(sec, tipo) {
        const SKIP = new Set(['tipo', 'titulo', 'id', 'color', 'icono', 'widths', 'labelWidth']);
        const rows = [];

        function addField(key, val, depth) {
            if (SKIP.has(key) || depth > 2) return;
            if (typeof val === 'string' && val.trim()) {
                rows.push(`<div class="aig-gf-row">
                    <span class="aig-gf-key">${_esc(key.replace(/_/g,' '))}</span>
                    <div contenteditable="true" class="aig-text-block aig-gf-val">${_esc(val)}</div>
                </div>`);
            } else if (typeof val === 'number') {
                rows.push(`<div class="aig-gf-row">
                    <span class="aig-gf-key">${_esc(key)}</span>
                    <span class="aig-gf-num">${val}</span>
                </div>`);
            } else if (Array.isArray(val) && val.every(x => typeof x === 'string')) {
                rows.push(`<div class="aig-gf-row">
                    <span class="aig-gf-key">${_esc(key)}</span>
                    <div>${val.map(s => `<div class="aig-lista-item"><span class="aig-bullet">▸</span><div contenteditable="true" class="aig-text-block aig-list-block">${_esc(s)}</div></div>`).join('')}</div>
                </div>`);
            } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
                const preview = val.slice(0,4).map(item => {
                    const parts = Object.entries(item)
                        .filter(([k,v]) => typeof v === 'string' && v.trim() && !SKIP.has(k))
                        .slice(0,3)
                        .map(([k,v]) => `<strong>${_esc(k)}:</strong> ${_esc(v.substring(0,100))}`);
                    return parts.length ? `<div class="aig-gf-item">${parts.join(' · ')}</div>` : '';
                }).join('');
                rows.push(`<div class="aig-gf-row">
                    <span class="aig-gf-key">${_esc(key)} (${val.length})</span>
                    <div class="aig-gf-arr">${preview}${val.length>4 ? `<div class="aig-readonly-note">…y ${val.length-4} más</div>`:''}</div>
                </div>`);
            } else if (val && typeof val === 'object' && !Array.isArray(val)) {
                Object.entries(val).forEach(([k,v]) => addField(k, v, depth+1));
            }
        }

        Object.entries(sec).forEach(([k,v]) => addField(k, v, 0));

        if (!rows.length) {
            return `<div class="aig-readonly-note">Sección tipo "${_esc(tipo)}" — sin contenido de texto</div>`;
        }
        return `<div class="aig-generic-view">${rows.join('')}
            <div class="aig-readonly-note">Tipo: ${_esc(tipo)} — revisá el contenido generado antes de aprobar</div>
        </div>`;
    }

    /**
     * Recoge el estado del preview editado y lo mezcla con el JSON original.
     * Solo actualiza: document.titleEs/code/version/headerTitle y secciones[].
     * El resto del JSON (package, trazabilidad, matrizAprobaciones…) se preserva.
     */
    function _collectPreviewJson(originalJson) {
        const orig  = originalJson || {};
        const origDoc = orig.document || {};

        const titleEl = document.getElementById('aigMetaTitle');
        const codeEl  = document.getElementById('aigMetaCode');
        const verEl   = document.getElementById('aigMetaVer');

        const updatedDoc = {
            ...origDoc,
            ...(titleEl ? { titleEs: titleEl.value.trim(), headerTitle: titleEl.value.trim() } : {}),
            ...(codeEl  ? { code:    codeEl.value.trim()  } : {}),
            ...(verEl   ? { version: verEl.value.trim()   } : {}),
        };

        // Reconstruir secciones desde DOM
        const secEls = document.querySelectorAll('#aigSecList .aig-sec-edit');
        const origSecs = Array.isArray(orig.secciones) ? orig.secciones : [];
        const secciones = Array.from(secEls).map(el => {
            const si    = el.dataset.si;
            const tipo  = el.dataset.tipo || 'texto';
            const titulo = el.querySelector('.aig-sec-title')?.value?.trim() || '';
            const origIdx = parseInt(si);
            const origSec = (!isNaN(origIdx) && origSecs[origIdx]) ? origSecs[origIdx] : {};

            if (tipo === 'texto') {
                const bloques = Array.from(el.querySelectorAll('.aig-text-block'))
                    .map(b => ({ texto: (b.textContent || b.innerText || '').trim() }))
                    .filter(b => b.texto);
                return { ...origSec, tipo, titulo, bloques };

            } else if (tipo === 'caja-conclusion') {
                const parrafos = Array.from(el.querySelectorAll('.aig-text-block'))
                    .map(b => (b.textContent || '').trim()).filter(Boolean);
                return { ...origSec, tipo, titulo, parrafos };

            } else if (tipo === 'lista-incluido-excluido') {
                const inclEl = el.querySelector('[data-list="incluido"]');
                const exclEl = el.querySelector('[data-list="excluido"]');
                const incluido = inclEl ? Array.from(inclEl.querySelectorAll('.aig-list-block'))
                    .map(b => (b.textContent || '').trim()).filter(Boolean) : (origSec.incluido || []);
                const excluido = exclEl ? Array.from(exclEl.querySelectorAll('.aig-list-block'))
                    .map(b => (b.textContent || '').trim()).filter(Boolean) : (origSec.excluido || []);
                return { ...origSec, titulo, incluido, excluido };

            } else if (tipo === 'tabla') {
                const tbRows = Array.from(el.querySelectorAll('tbody tr'));
                const filas = tbRows.map(tr =>
                    Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim())
                );
                return { ...origSec, titulo, filas };

            } else if (tipo === 'tabla-info') {
                const tbRows = Array.from(el.querySelectorAll('tr'));
                const filas = tbRows.map(tr => ({
                    campo: (tr.querySelector('.aig-tinfo-campo')?.textContent || '').trim(),
                    valor: (tr.querySelector('.aig-tinfo-valor')?.textContent || '').trim()
                })).filter(f => f.campo);
                return { ...origSec, titulo, filas };

            } else if (tipo === 'caja-resultado') {
                const subtitulo = el.querySelector('.aig-caja-subtitulo')?.value?.trim() || origSec.subtitulo || '';
                const icono     = el.querySelector('.aig-caja-icono')?.value?.trim()     || origSec.icono     || '';
                return { ...origSec, titulo, subtitulo, icono };

            } else if (tipo === 'tarjeta-gap') {
                const descripcion = (el.querySelector('.aig-gap-desc')?.textContent || '').trim() || origSec.descripcion || '';
                const mitigacion  = (el.querySelector('.aig-gap-mit')?.textContent  || '').trim() || origSec.mitigacion  || '';
                const norma       = el.querySelector('.aig-gap-norma')?.value?.trim() || origSec.norma || '';
                return { ...origSec, titulo, descripcion, mitigacion, norma };

            } else if (tipo === 'tarjeta-gap-rrm') {
                const descripcion = (el.querySelector('.aig-gap-desc')?.textContent || '').trim() || origSec.descripcion || '';
                const cierre      = (el.querySelector('.aig-gap-mit')?.textContent  || '').trim() || origSec.cierre || origSec.mitigacion || '';
                return { ...origSec, titulo, descripcion, cierre };

            } else if (tipo === 'caja-nota' || tipo === 'caja-criterio' || tipo === 'caja-justificacion') {
                const parrafos = Array.from(el.querySelectorAll('.aig-text-block'))
                    .map(b => (b.textContent || '').trim()).filter(Boolean);
                return { ...origSec, tipo, titulo, parrafos };

            } else if (tipo === 'subseccion') {
                const introEl = el.querySelector('.aig-text-block');
                const intro = (introEl?.textContent || '').trim() || origSec.intro || '';
                return { ...origSec, titulo, intro };

            } else if (tipo === 'aceptacion-riesgo-residual') {
                const conclusionEl = el.querySelector('.aig-text-block:not(.aig-list-block)');
                const conclusion = (conclusionEl?.textContent || '').trim() || origSec.conclusion || '';
                const itemsEl = el.querySelector('[data-list="items"]');
                const items = itemsEl
                    ? Array.from(itemsEl.querySelectorAll('.aig-list-block')).map(b => (b.textContent||'').trim()).filter(Boolean)
                    : (origSec.items || []);
                return { ...origSec, titulo, conclusion, items };

            } else {
                // Tipos complejos (tabla-fmea, flujo-logico, ncr-*, vsr-*, etc.):
                // preservar datos originales, solo actualizar título
                return { ...origSec, titulo };
            }
        }).filter(s => s.titulo || (s.bloques && s.bloques.length) || (s.filas && s.filas.length) || (s.parrafos && s.parrafos.length) || s.descripcion || s.incluido || s.conclusion || s.intro);

        return { ...orig, document: updatedDoc, secciones };
    }

    function _renderDone() {
        _setPaneHeader('Ciclo completado', '');
        const body   = document.getElementById('aigMainBody');
        const footer = document.getElementById('aigFooter');
        const n = Object.keys(_state.approvedDocs).length;
        if (body) body.innerHTML = `
            <div class="aig-done">
                <div class="big">🎉</div>
                <h3>¡Ciclo de validación completo!</h3>
                <p>${n} documentos generados y aprobados.</p>
                <p>Todos están en el paquete del proyecto. Generá el <strong>Libro de Validación</strong> desde el menú Libro.</p>
            </div>`;
        if (footer) {
            footer.innerHTML = '';
            const btnSync = _mkBtn('aigBtnSyncAll', '↑ Guardar en proyecto', 'ba');
            btnSync.title = 'Guarda todos los documentos aprobados en el servidor para verlos en la Suite de Validación';
            btnSync.onclick = () => _syncAllDocsToServer();
            footer.appendChild(btnSync);
            const btnExport = _mkBtn('aigBtnExportCtx', '↓ Exportar para Claude Desktop', 'bs');
            btnExport.title = 'Descarga un .md con el contexto compacto de todos los docs aprobados, listo para pegar en Claude Desktop';
            btnExport.onclick = () => _exportClaudeDesktopContext();
            footer.appendChild(btnExport);
            const btn = _mkBtn('aigBtnClose', 'Cerrar', 'bp');
            footer.appendChild(btn);
            btn.onclick = () => WizardUI.close();
        }
    }

    // ── Descargar JSON de un documento ───────────────────────────────

    function _downloadDocJson(docType, json) {
        const code = (json && json.document && json.document.code) || docType;
        const filename = (code + '.json').toLowerCase().replace(/[^a-z0-9._-]/g, '-');
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        _notify(`${docType.toUpperCase()} descargado como ${filename}`, 'ok', 3000);
    }

    // ── Exportar contexto compacto para Claude Desktop ───────────────

    function _exportClaudeDesktopContext() {
        const ctx  = _WS().buildClaudeDesktopContext(_state);
        const pkg  = _state.approvedDocs;
        const firstKey = Object.keys(pkg || {})[0];
        const code = (firstKey && pkg[firstKey] && pkg[firstKey].package && pkg[firstKey].package.code) || 'proyecto';
        const filename = ('contexto-claude-desktop-' + code + '.md').toLowerCase().replace(/[^a-z0-9._-]/g, '-');
        const blob = new Blob([ctx], { type: 'text/markdown;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        _notify('Contexto exportado. Adjuntalo junto con el skill del documento en Claude Desktop.', 'ok', 4000);
    }

    // ── Recuperar contexto desde carpeta del proyecto ─────────────────

    async function _recoverFromFolder() {
        const FS = VS.ProjectFolderFS;
        if (!FS || !_state.projectId) return;

        const recoverBtn = document.getElementById('aigBtnRecover');
        if (recoverBtn) { recoverBtn.disabled = true; recoverBtn.textContent = 'Escaneando…'; }

        try {
            // 1. Escanear ai-docs/ y recuperar docs ya generados
            const found = await FS.scanAIDocs(_state.projectId);
            if (!found.length) {
                _notify('No se encontraron documentos en la carpeta ai-docs. Cargá el documento fuente para empezar.', 'info', 4000);
                if (recoverBtn) { recoverBtn.disabled = false; recoverBtn.textContent = 'Retomar desde carpeta'; }
                return;
            }

            // 2. Mapear a approvedDocs — solo los que pertenecen al cascade
            const cascade     = _WS().getActiveCascade(_state);
            const approvedDocs = { ..._state.approvedDocs };
            const recovered   = [];
            const skipped     = [];

            for (const { docType, filename, json } of found) {
                if (cascade.includes(docType)) {
                    approvedDocs[docType] = json;
                    recovered.push(docType.toUpperCase());
                } else {
                    skipped.push(filename);
                }
            }

            // 3. Intentar recuperar documento fuente desde fuente/
            let sourceDocText = _state.sourceDocText;
            let sourceDocName = _state.sourceDocName;
            if (!sourceDocText) {
                const src = await FS.readSourceDoc(_state.projectId);
                if (src) { sourceDocText = src.text; sourceDocName = src.name; }
            }
            // Si se recuperaron docs aprobados pero no hay texto fuente (PDF binario o carpeta vacía),
            // poner un placeholder para que el wizard pueda avanzar al cascade selector.
            if (!sourceDocText && recovered.length) {
                sourceDocText = `[Contexto recuperado desde carpeta. Documentos ya aprobados: ${recovered.join(', ')}. El documento fuente original no está disponible — los docs aprobados sirven como contexto para seguir generando.]`;
                sourceDocName = '(recuperado desde carpeta)';
            }

            // 4. Calcular próximo doc a generar
            const skippedDocs = _state.skippedDocs || {};
            let nextDoc = null;
            for (const t of cascade) {
                if (!approvedDocs[t] && !skippedDocs[t]) { nextDoc = t; break; }
            }

            _state = {
                ..._state,
                approvedDocs,
                sourceDocText,
                sourceDocName,
                currentDocType: nextDoc || _state.currentDocType,
                status: nextDoc ? 'idle' : 'done',
                lastError: null
            };
            _WS().save(_state);

            const msg = recovered.length
                ? `Recuperados: ${recovered.join(', ')}. Próximo a generar: ${(nextDoc || '—').toUpperCase()}.`
                : 'No se encontraron documentos del ciclo en ai-docs.';
            _notify(msg, 'ok', 5000);
            _render();

        } catch (e) {
            _notify('Error al escanear la carpeta: ' + e.message, 'error', 5000);
            if (recoverBtn) { recoverBtn.disabled = false; recoverBtn.textContent = 'Retomar desde carpeta'; }
        }
    }

    // ── Upload ────────────────────────────────────────────────────────

    function _bindUpload() {
        const drop   = document.getElementById('aigDrop');
        const input  = document.getElementById('aigFileInput');
        const confid = document.getElementById('aigConfid');
        const btn    = document.getElementById('aigBtnLoad');
        if (!drop || !input || !btn) return;

        let _file = null;
        const _upd = () => { btn.disabled = !(_file && confid && confid.checked); };
        confid && confid.addEventListener('change', _upd);

        drop.addEventListener('click', () => input.click());
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
        drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); _onFile(e.dataTransfer.files[0]); });
        input.addEventListener('change', () => _onFile(input.files[0]));

        function _onFile(f) {
            if (!f) return;
            if (!_DP().isSupported(f)) { _notify(`Formato no soportado: ${f.name}`, 'error'); return; }
            _file = f;
            drop.innerHTML = `
                <div class="di">✅</div>
                <div class="dm">${_esc(f.name)}</div>
                <div class="ds">${(f.size / 1024).toFixed(0)} KB — click para cambiar</div>
                <input type="file" id="aigFileInput" accept=".pdf,.docx,.xlsx" style="display:none">
            `;
            drop.querySelector('input').onchange = function () { _onFile(this.files[0]); };
            _upd();
        }

        btn.addEventListener('click', async () => {
            if (!_file) return;
            btn.disabled = true; btn.textContent = 'Procesando…';
            try {
                const text = await _DP().parse(_file);
                _state = _WS().setSourceDoc(_state, text, _file.name);
                _WS().save(_state);
                _render();
            } catch (e) {
                _notify(`Error al procesar: ${e.message}`, 'error');
                btn.disabled = false; btn.textContent = 'Cargar documento';
            }
        });
    }

    // ── Readable document preview ─────────────────────────────────────

    function _renderDocReadable(docJson) {
        if (!docJson) return '';
        const pkg = docJson.package || {};
        const doc = docJson.document || {};
        const statusColors = { Aprobado: '#2E7D32', Borrador: '#C67C00', 'En revisión': '#1565C0' };
        const sColor = statusColors[doc.status] || '#5A6E82';
        let html = `<div class="aig-rdoc-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                <span class="aig-rdoc-badge">${_esc(docJson.type || '')}</span>
                ${doc.code ? `<code style="font-size:11px;color:#5A6E82">${_esc(doc.code)}</code>` : ''}
                ${doc.version ? `<span style="font-size:11px;color:#5A6E82">v${_esc(doc.version)}</span>` : ''}
                ${doc.status ? `<span style="font-size:11px;color:${sColor};font-weight:700">${_esc(doc.status)}</span>` : ''}
            </div>
            <div class="aig-rdoc-sysname">${_esc(pkg.systemName || doc.headerTitle || '')}</div>
            ${pkg.client ? `<div style="font-size:12px;color:#5A6E82;margin-top:2px">Cliente: ${_esc(pkg.client)}</div>` : ''}
        </div>`;
        const secs = docJson.secciones || [];
        if (!secs.length) html += '<p style="color:#9AABB8;font-size:12px">Sin secciones generadas.</p>';
        for (const sec of secs) html += _renderSectionR(sec);
        return html;
    }

    function _renderSectionR(sec) {
        if (!sec || !sec.tipo) return '';
        const title = sec.titulo ? `<h4 class="aig-rds-title">${_esc(sec.titulo)}</h4>` : '';
        switch (sec.tipo) {
            case 'texto':                 return `<div class="aig-rds">${title}${_rdsTexto(sec)}</div>`;
            case 'tabla':                 return `<div class="aig-rds">${title}${_rdsTabla(sec)}</div>`;
            case 'lista-incluido-excluido': return `<div class="aig-rds">${title}${_rdsListaIE(sec)}</div>`;
            case 'tabla-info':            return `<div class="aig-rds">${title}${_rdsTablaInfo(sec)}</div>`;
            case 'arbol-decision-gamp':   return `<div class="aig-rds">${title}${_rdsArbol(sec)}</div>`;
            case 'formula-rai':           return `<div class="aig-rds">${title}${_rdsFormula(sec)}</div>`;
            case 'tabla-docs-aplicables': return `<div class="aig-rds">${title}${_rdsDocsApl(sec)}</div>`;
            case 'tabla-firmas-final':    return `<div class="aig-rds">${title}<p><em style="color:#9AABB8;font-size:12px">Roles: ${_esc((sec.rolesPlaceholder || []).join(' · '))}</em></p></div>`;
            case 'caja-resultado':        return `<div class="aig-rds aig-rds-box"><div class="aig-rds-box-title">${_esc(sec.titulo || '')}</div><p>${_esc(sec.subtitulo || '')}</p></div>`;
            case 'caja-conclusion':       return `<div class="aig-rds aig-rds-box">${title}${(sec.parrafos || []).map(p => `<p>${_esc(p)}</p>`).join('')}</div>`;
            case 'box-resultado-rai':     return `<div class="aig-rds aig-rds-box">${title}<p class="aig-rds-calc">${_esc(sec.calculo || '')} — <strong>${_esc(sec.nivel || '')}</strong></p><p style="font-size:11px;color:#5A6E82">${_esc(sec.rangos || '')}</p></div>`;
            case 'tarjeta-gap':           return _rdsGap(sec);
            default:                      return `<div class="aig-rds">${title}<pre class="aig-rds-raw">${_esc(JSON.stringify(sec, null, 2).slice(0, 400))}</pre></div>`;
        }
    }

    function _rdsTexto(sec) {
        if (sec.bloques && sec.bloques.length) {
            return sec.bloques.map(b => {
                let h = b.subtitulo ? `<p class="aig-rds-sub">${_esc(b.subtitulo)}</p>` : '';
                if (b.texto) h += `<p>${_esc(b.texto)}</p>`;
                if (b.bullets && b.bullets.length) h += `<ul>${b.bullets.map(x => `<li>${_esc(x)}</li>`).join('')}</ul>`;
                return h;
            }).join('');
        }
        return sec.contenido ? `<p>${_esc(sec.contenido)}</p>` : '';
    }

    function _rdsTabla(sec) {
        if (!sec.columnas || !sec.filas) return '';
        const head = `<tr>${sec.columnas.map(c => `<th>${_esc(c)}</th>`).join('')}</tr>`;
        const rows = sec.filas.map(r => {
            const cells = Array.isArray(r) ? r : [r];
            return `<tr>${cells.map(c => `<td>${_esc(String(c == null ? '' : c))}</td>`).join('')}</tr>`;
        }).join('');
        return `<table class="aig-rds-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }

    function _rdsListaIE(sec) {
        const inc = (sec.incluido || []).map(x => `<li>${_esc(x)}</li>`).join('');
        const exc = (sec.excluido || []).map(x => `<li>${_esc(x)}</li>`).join('');
        return `<p class="aig-rds-sub">${_esc(sec.subIncluido || 'Incluido')}</p><ul>${inc}</ul><p class="aig-rds-sub">${_esc(sec.subExcluido || 'Excluido')}</p><ul>${exc}</ul>`;
    }

    function _rdsTablaInfo(sec) {
        const rows = (sec.filas || []).map(r => `<tr><td>${_esc(r.campo || '')}</td><td>${_esc(r.valor || '')}</td></tr>`).join('');
        return `<table class="aig-rds-table aig-rds-ti"><tbody>${rows}</tbody></table>`;
    }

    function _rdsArbol(sec) {
        const intro = sec.intro ? `<p>${_esc(sec.intro)}</p>` : '';
        const qs = (sec.preguntas || []).map(q => `<div class="aig-rds-q"><span class="aig-rds-q-p">${_esc(q.pregunta)}</span><span class="aig-rds-q-r">${_esc(q.respuesta)}</span></div>`).join('');
        return intro + qs;
    }

    function _rdsFormula(sec) {
        const intro = sec.intro ? `<p>${_esc(sec.intro)}</p>` : '';
        const formula = sec.formula ? `<div class="aig-rds-formula">${_esc(sec.formula)}</div>` : '';
        const rows = (sec.factores || []).map(f => `<tr><td><strong>${_esc(f.var)}</strong></td><td>${_esc(f.factor)}</td><td>${_esc(f.descripcion || '')}</td><td style="text-align:center;font-weight:700">${f.valor}</td></tr>`).join('');
        const table = rows ? `<table class="aig-rds-table"><thead><tr><th>Var</th><th>Factor</th><th>Descripción</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table>` : '';
        return intro + formula + table;
    }

    function _rdsDocsApl(sec) {
        const intro = sec.intro ? `<p>${_esc(sec.intro)}</p>` : '';
        const rows = (sec.filas || []).map(r => {
            const col = r.estado === 'Obligatorio' ? '#2E7D32' : r.estado === 'No aplica' ? '#9AABB8' : '#1565C0';
            return `<tr><td>${_esc(r.documento || '')}</td><td style="color:${col};font-weight:600">${_esc(r.estado || '')}</td><td>${_esc(r.aplicacion || '')}</td></tr>`;
        }).join('');
        return intro + `<table class="aig-rds-table"><thead><tr><th>Documento</th><th>Estado</th><th>Aplicación</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function _rdsGap(sec) {
        const sevClass = `aig-rds-sev-${sec.severidad || 'info'}`;
        return `<div class="aig-rds aig-rds-gap">
            <div class="aig-rds-gap-head">
                <span style="font-family:monospace">${_esc(sec.id || 'GAP')}</span>
                <span class="${_esc(sevClass)}">${_esc(sec.severidadLabel || sec.severidad || '')}</span>
            </div>
            <h4 class="aig-rds-title" style="margin-top:4px">${_esc(sec.titulo || '')}</h4>
            ${sec.descripcion ? `<p>${_esc(sec.descripcion)}</p>` : ''}
            ${sec.control ? `<p><strong>Control:</strong> ${_esc(sec.control)}</p>` : ''}
            ${sec.norma ? `<p style="font-size:11px;color:#5A6E82">${_esc(sec.norma)}</p>` : ''}
        </div>`;
    }

    // ── Generación ────────────────────────────────────────────────────

    // Tipos que usan generación multi-fase (solo protocolos — los informes se derivan)
    const LAYERED_DOCTYPES   = new Set(['piq', 'poq', 'ppq']);
    const LAYERED_BATCH_SIZE = 12;  // TCs por lote en Fase 2

    // Informes se generan derivando el protocolo aprobado (no desde cero)
    const INFORME_DERIVADO = { iiq: 'piq', ioq: 'poq', ipq: 'ppq' };

    async function _generate(changeInstructions) {
        const WS = _WS();
        try { _state = WS.startGenerating(_state); }
        catch (e) { _notify(e.message, 'error'); return; }
        WS.save(_state);
        _render();

        const type     = _state.currentDocType;
        const inst     = (_state.moduleInstances || []).find(m => m.id === type);
        const baseType = inst ? inst.baseType : type;

        // Delegar a generación multi-fase para protocolos IQ/OQ/PQ (sin instrucciones de cambio)
        if (LAYERED_DOCTYPES.has(baseType) && !changeInstructions && !_state._regenSoloMode) {
            await _generateLayered(type, baseType);
            return;
        }

        // Informes (IIQ/IOQ/IPQ): derivar del protocolo aprobado correspondiente
        // — siempre usar el path delta (lean), incluso en regen-solo, ya que el protocolo source está aprobado
        const sourceBase = INFORME_DERIVADO[baseType];
        if (sourceBase && !changeInstructions) {
            const sourceId    = inst ? type.replace(baseType, sourceBase) : sourceBase;
            const protocolDoc = _state.approvedDocs[sourceId] || _state.approvedDocs[sourceBase];
            if (protocolDoc) {
                await _generateInformeFromProtocolo(type, baseType, sourceId, protocolDoc);
                return;
            }
        }

        _cancelCtrl = new AbortController();
        try {
            const systemPrompt = await _SL().buildSystemPrompt(type);
            const userPrompt   = _buildUserPrompt(_state, changeInstructions || '');
            const model        = _useOpus ? _AC().MODELS.opus : _AC().MODELS.sonnet;
            const raw          = await _AC().generate({ systemPrompt, userPrompt, model, signal: _cancelCtrl.signal });
            _cancelCtrl = null;
            const docJson      = _extractJson(raw);

            if (typeof addPackageDoc === 'function') {
                try { addPackageDoc(docJson, { fileName: `${type}-ai-generated.json` }); } catch (_) {}
                try { if (typeof saveToStorage === 'function') saveToStorage(); } catch (_) {}
            }

            _state = WS.markGenerated(_state, type, docJson);
            WS.save(_state);
            _render();
            _animateDocAppearance();
            _notify(`${type.toUpperCase()} generado — revisá el preview y aprobá para continuar`, 'info');
        } catch (e) {
            _cancelCtrl = null;
            // Truncación detectada: ofrecer regeneración compacta directamente
            const msg = e.truncated
                ? `Documento demasiado largo — la API lo cortó antes de terminar. Hacé clic en "Regenerar" y usá la instrucción de brevedad que ya fue agregada automáticamente.`
                : e.message;
            _state = WS.markError(_state, msg);
            if (e.truncated) _state = { ..._state, _suggestCompact: true };
            WS.save(_state);
            _render();
        }
    }

    async function _regenSection(sectionIndex) {
        if (_state.generating) return;
        const doc = _state.pendingDoc && _state.pendingDoc.json;
        if (!doc || !Array.isArray(doc.secciones) || !doc.secciones[sectionIndex]) return;
        const sec = doc.secciones[sectionIndex];

        const instrEl = document.querySelector('#aigInstr');
        const changeInstr = instrEl ? instrEl.value.trim() : '';

        // Marcar visualmente que esa sección está regenerando
        const secEls = document.querySelectorAll('#aigSecList .aig-sec-edit');
        const secEl = secEls[sectionIndex];
        if (secEl) { secEl.style.opacity = '0.4'; secEl.style.pointerEvents = 'none'; }

        try {
            const type = _state.pendingDoc.docType || _state.currentDocType;
            const systemPrompt = await _SL().buildSystemPrompt(type);
            const sectionContext = JSON.stringify(sec);
            const model = _useOpus ? _AC().MODELS.opus : _AC().MODELS.sonnet;
            const userPrompt = `${_buildUserPrompt(_state, '')}

INSTRUCCIÓN ESPECIAL: Regenerá ÚNICAMENTE la siguiente sección del documento (manteniendo el mismo tipo y título). Retorná SOLO el JSON de esa sección, sin el documento completo:
${sectionContext}
${changeInstr ? `\nInstrucciones adicionales: ${changeInstr}` : ''}

Responde con SOLO el JSON de la sección regenerada, sin markdown, sin texto extra.`;

            const raw = await _AC().generate({ systemPrompt, userPrompt, model, signal: _cancelCtrl ? _cancelCtrl.signal : undefined });

            let newSection;
            try {
                const match = raw.match(/\{[\s\S]*\}/);
                newSection = match ? JSON.parse(match[0]) : null;
            } catch (e) { newSection = null; }

            if (newSection && newSection.tipo) {
                // Preservar título original si el modelo lo cambió
                newSection.titulo = sec.titulo;
                doc.secciones[sectionIndex] = newSection;
                _state.pendingDoc = { ..._state.pendingDoc, json: doc };
                _WS().save(_state);
                _render();
                _notify('Sección regenerada ✓', 'info');
            } else {
                if (secEl) { secEl.style.opacity = ''; secEl.style.pointerEvents = ''; }
                _notify('No se pudo parsear la sección regenerada', 'warning');
            }
        } catch (e) {
            console.error('[AIGen] Error regenerando sección:', e);
            if (secEl) { secEl.style.opacity = ''; secEl.style.pointerEvents = ''; }
            _notify('Error al regenerar la sección: ' + e.message, 'error');
        }
    }

    async function _animateDocAppearance() {
        // Animar entrada de secciones secuencialmente
        const secEls = document.querySelectorAll('#aigSecList .aig-sec-edit');
        secEls.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(8px)';
            el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        });

        for (let i = 0; i < secEls.length; i++) {
            await new Promise(r => setTimeout(r, 80));
            if (secEls[i]) {
                secEls[i].style.opacity = '1';
                secEls[i].style.transform = 'translateY(0)';
            }
        }
    }

    // ── Generación por fases (IQ/OQ/PQ — sin límite de TCs) ──────────

    /**
     * Orquesta la generación multi-fase:
     *   Fase 1 — Esqueleto: secciones intro + listado completo de TCs (sin contenido)
     *   Fase 2 — Lotes:     expandir TCs en batches de LAYERED_BATCH_SIZE
     *   Fase 3 — Cierre:    justificación CSA + referencias + firmas
     */
    async function _generateLayered(type, baseType) {
        const WS = _WS();
        _cancelCtrl = new AbortController();

        // ── Fase 1: Estructura + skeleton de TCs ──
        _setLayeredStatus('Fase 1/3 — Generando estructura y listado de TCs…');
        const skeleton = await _runLayeredCall(type, _buildLayeredPrompt_Skeleton(type, baseType));
        if (!skeleton) return;

        const tcSkeleton   = skeleton.tcSkeleton || [];
        const totalTCs     = tcSkeleton.length;
        const batches      = _chunkArray(tcSkeleton, LAYERED_BATCH_SIZE);
        const totalBatches = batches.length;
        const allTCs       = [];

        // ── Fase 2: Expandir TCs en lotes ──
        for (let i = 0; i < totalBatches; i++) {
            const from = i * LAYERED_BATCH_SIZE + 1;
            const to   = Math.min((i + 1) * LAYERED_BATCH_SIZE, totalTCs);
            _setLayeredStatus(`Fase 2/3 — TCs ${from}–${to} de ${totalTCs} (lote ${i + 1}/${totalBatches})…`);
            const batchResult = await _runLayeredCall(
                type,
                _buildLayeredPrompt_Batch(type, baseType, tcSkeleton, batches[i], i + 1, totalBatches)
            );
            if (!batchResult) return;
            const tcs = batchResult.tcs || batchResult.testCases || [];
            allTCs.push(...tcs);
        }

        // ── Fase 3: Cierre ──
        _setLayeredStatus('Fase 3/3 — Generando justificación y secciones de cierre…');
        const closing = await _runLayeredCall(
            type,
            _buildLayeredPrompt_Closing(type, baseType, skeleton, allTCs)
        );
        if (!closing) return;

        // ── Ensamblar documento completo ──
        const fullDoc = _assembleLayeredDoc(baseType, skeleton, allTCs, closing);
        _cancelCtrl = null;

        if (typeof addPackageDoc === 'function') {
            try { addPackageDoc(fullDoc, { fileName: `${type}-ai-generated.json` }); } catch (_) {}
            try { if (typeof saveToStorage === 'function') saveToStorage(); } catch (_) {}
        }

        _state = WS.markGenerated(_state, type, fullDoc);
        WS.save(_state);
        _render();
        _animateDocAppearance();
        _notify(
            `${type.toUpperCase()} generado en ${totalBatches + 2} fases — ${totalTCs} TCs ✓`,
            'info'
        );
    }

    /** Ejecuta una llamada a la API para una fase. Retorna el JSON parseado o null en error. */
    async function _runLayeredCall(type, userPrompt) {
        try {
            const systemPrompt = await _SL().buildSystemPrompt(type);
            const model        = _useOpus ? _AC().MODELS.opus : _AC().MODELS.sonnet;
            const raw          = await _AC().generate({ systemPrompt, userPrompt, model, signal: _cancelCtrl.signal });
            return _extractJson(raw);
        } catch (e) {
            _cancelCtrl = null;
            const msg = e.truncated
                ? 'Respuesta de fase truncada — activá Opus o reducí el batch size'
                : (e.message || 'Error de generación');
            _state = _WS().markError(_state, `[Generación por fases] ${msg}`);
            _WS().save(_state);
            _render();
            return null;
        }
    }

    /** Divide un array en chunks de tamaño N */
    function _chunkArray(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
    }

    /** Actualiza el mensaje del spinner y cancela el timer rotatorio */
    function _setLayeredStatus(msg) {
        const body = document.getElementById('aigMainBody');
        if (body && body._aigLoadTimer) { clearInterval(body._aigLoadTimer); body._aigLoadTimer = null; }
        const el = document.getElementById('aigLoadMsg');
        if (el) el.textContent = msg;
    }

    /** Base del prompt sin la sección FORMATO DE RESPUESTA (que varía por fase) */
    function _buildLayeredBase(type) {
        const p = _buildUserPrompt({ ..._state, currentDocType: type }, '');
        const cut = p.indexOf('\n## FORMATO DE RESPUESTA\n');
        return cut >= 0 ? p.slice(0, cut) : p;
    }

    /**
     * Extrae executionSummary desde un informe (IIQ/IOQ/IPQ) que fue editado
     * manualmente y no tiene el campo calculado. Escanea todas las secciones
     * buscando TCs con campo `resultado`.
     */
    function _extractExecSummary(informeJson) {
        const RESULTADO_VALUES = ['PASA', 'PASA CON OBSERVACIONES', 'NO PASA'];
        const allTCs = [];
        (informeJson.secciones || []).forEach(sec => {
            if (Array.isArray(sec.tcs)) {
                sec.tcs.forEach(tc => { if (tc.resultado) allTCs.push(tc); });
            }
        });
        if (!allTCs.length) return null;

        const pasa = allTCs.filter(tc => tc.resultado === 'PASA').length;
        const obs  = allTCs.filter(tc => tc.resultado === 'PASA CON OBSERVACIONES').length;
        const fail = allTCs.filter(tc => tc.resultado === 'NO PASA').length;
        const total = allTCs.length;
        const label = (informeJson.titulo || '').includes('IIQ') ? 'IIQ'
                    : (informeJson.titulo || '').includes('IOQ') ? 'IOQ'
                    : (informeJson.titulo || '').includes('IPQ') ? 'IPQ'
                    : (informeJson.codigo || '').split('-')[0] || 'INFORME';
        return {
            totalTCs:             total,
            pasa,
            pasaConObservaciones: obs,
            noPasa:               fail,
            porcentajeConformidad: Math.round((pasa + obs) / total * 100),
            verdict: fail === 0
                ? `CALIFICACIÓN ${label} APROBADA`
                : `CALIFICACIÓN ${label} CON NCs ABIERTAS`,
            protocoloOrigen: informeJson.protocoloOrigen || informeJson.codigo || ''
        };
    }

    /**
     * Extrae la lista de componentes del IRA aprobado para anclar el conteo de TCs del PIQ.
     * Retorna null si el IRA no está aprobado o no tiene componentes.
     */
    function _extractIRAComponents() {
        const ira = _state.approvedDocs && _state.approvedDocs['ira'];
        if (!ira || !Array.isArray(ira.secciones)) return null;
        for (const sec of ira.secciones) {
            if (sec.tipo === 'tabla-componentes-ira' && Array.isArray(sec.componentes) && sec.componentes.length) {
                return sec.componentes.map(c => {
                    const score = (c.p || 1) * (c.g || 1) * (c.i || 1);
                    const nivel = score >= 9 ? 'ALTO → Exhaustiva' : score >= 5 ? 'MEDIO → Estándar' : 'BAJO → Básica';
                    return { id: c.id || '?', nombre: c.componente || c.nombre || '?', score, nivel };
                });
            }
        }
        return null;
    }

    /** Prompt Fase 1: secciones intro + skeleton de TCs (sin criterios, solo IDs y títulos) */
    function _buildLayeredPrompt_Skeleton(type, baseType) {
        const isOQ = baseType.endsWith('oq');
        const isPIQ = baseType === 'piq' || (baseType && baseType.startsWith('piq'));
        const tcLabel = isOQ ? 'OQ' : (baseType.endsWith('ppq') ? 'PQ' : 'IQ');
        const skeletonFields = isOQ
            ? 'tcId, titulo, grupo, tipoTC ("POSITIVO" o "NEGATIVO"), nivel ("CRÍTICO"|"ALTO"|"MEDIO"|"BAJO"), raScore'
            : 'tcId, titulo, componente, raScore ("CRÍTICO"|"ALTO"|"MEDIO"|"BAJO"), profundidad ("Exhaustiva"|"Estándar"|"Básica")';

        // Para PIQ: ancla dura al IRA aprobado
        let iraAnchor = '';
        if (isPIQ) {
            const comps = _extractIRAComponents();
            if (comps && comps.length) {
                iraAnchor = `\n## ANCLA DE TCs — IRA APROBADO (FUENTE DE VERDAD — OBLIGATORIO RESPETAR)
El IRA aprobado define exactamente ${comps.length} componentes. El PIQ DEBE generar exactamente ${comps.length} TCs (uno por componente).
Máx 2 TCs solo si un componente ALTO tiene dos funciones claramente separables (justificar en título).
NO generar TCs sin componente IRA de respaldo.

Lista de componentes (ID, Nombre, IRA-Score, Profundidad de verificación):
${comps.map(c => `- ${c.id}: ${c.nombre} [Score: ${c.score} → ${c.nivel}]`).join('\n')}

Total esperado: ${comps.length} TCs (el tcSkeleton debe tener exactamente ${comps.length} entradas salvo caso justificado de 2 TCs por componente ALTO).\n`;
            }
        }

        return `${_buildLayeredBase(type)}
${iraAnchor}
[FASE 1/3 — ESQUELETO]
Esta generación es multi-fase para manejar protocolos con muchos TCs sin saturar el modelo.
En ESTA fase generás:
1. Las secciones introductorias COMPLETAS (propósito, alcance, definiciones, condiciones previas, docs de referencia).
2. Un listado COMPLETO de TODOS los TCs que necesitará el protocolo ${tcLabel}.
   — Para cada TC incluí SOLO: ${skeletonFields}.
   — SIN criterios[], sin procedimiento[], sin evidenciaEsperada todavía.
   ${isPIQ ? '— El conteo de TCs DEBE coincidir con el IRA (ver ancla arriba). No inventar componentes.' : '— La cantidad de TCs debe derivarse del contexto aprobado.'}

Respondé con SOLO este JSON (sin texto extra, sin markdown):
{
  "titulo": "...",
  "codigo": "...",
  "version": "1.0",
  "estado": "Borrador",
  "seccionesIntro": [ /* secciones 1-N completas */ ],
  "tcSkeleton": [
    { /* ${skeletonFields.split(', ').map(f => `"${f.split(' ')[0].replace('"', '')}": "..."` ).join(', ')} */ }
  ]
}`;
    }

    /** Prompt Fase 2: expandir un lote de TCs con contenido completo */
    function _buildLayeredPrompt_Batch(type, baseType, tcSkeleton, batch, batchNum, totalBatches) {
        const isOQ = baseType.endsWith('oq');
        const expansion = isOQ
            ? 'procedimiento (array de pasos: {instruccion, resultadoEsperado}) y criterioAceptacion'
            : 'criterios (array de criterios de verificación con descripcion y evidenciaEsperada)';

        // Resumen compacto del skeleton completo (solo IDs + títulos para no saturar contexto)
        const skeletonSummary = tcSkeleton
            .map(tc => `  ${tc.tcId}: ${tc.titulo}${tc.raScore ? ` [${tc.raScore}]` : ''}`)
            .join('\n');

        return `${_buildLayeredBase(type)}

[FASE 2/3 — LOTE ${batchNum}/${totalBatches}]
El protocolo tendrá ${tcSkeleton.length} TCs en total. En esta fase expandís SOLO el lote ${batchNum}.

ESQUELETO COMPLETO (referencia):
${skeletonSummary}

TCs A EXPANDIR EN ESTE LOTE:
${JSON.stringify(batch, null, 2)}

Para cada TC del lote, generá el objeto completo con ${expansion}.
Sé exhaustivo y técnico — describí cada paso/criterio con detalle real del sistema.

Respondé con SOLO este JSON:
{
  "tcs": [ /* los ${batch.length} TCs del lote expandidos completamente */ ]
}`;
    }

    /** Prompt Fase 3: secciones de cierre (justificación CSA, referencias, firmas) */
    function _buildLayeredPrompt_Closing(type, baseType, skeleton, allTCs) {
        const critical = allTCs.filter(t =>
            t.nivel === 'CRÍTICO' || t.nivel === 'CRÍTICO' || t.raScore === 'CRÍTICO'
        ).length;
        const high = allTCs.filter(t => t.nivel === 'ALTO' || t.raScore === 'ALTO').length;

        return `${_buildLayeredBase(type)}

[FASE 3/3 — CIERRE]
El protocolo tiene ${allTCs.length} TCs completamente generados (${critical} críticos, ${high} altos).

Generá SOLO las secciones de cierre:
- Justificación de Proporcionalidad CSA (referenciando la distribución real: ${allTCs.length} TCs en total)
- Referencias Normativas
- Tabla de Firmas de Ejecución (tipo "tabla-firmas-final", con roles: Ejecutor / Revisor / Aprobador)

Respondé con SOLO este JSON:
{
  "seccionesCierre": [ /* las 3 secciones de cierre */ ]
}`;
    }

    /** Ensambla el JSON final del documento a partir de las 3 fases */
    function _assembleLayeredDoc(baseType, skeleton, allTCs, closing) {
        const isOQ      = baseType.endsWith('oq');
        const schemaModo = isOQ ? 'procedimiento' : 'criterios';
        const tcLabel    = isOQ ? 'Operational Qualification' : (baseType.endsWith('pq') ? 'Performance Qualification' : 'Installation Qualification');
        const nIntro     = (skeleton.seccionesIntro || []).length;

        const colVis = isOQ
            ? ['tcId', 'titulo', 'grupo', 'tipoTC', 'nivel', 'raScore', 'ursVinculados']
            : ['tcId', 'titulo', 'componente', 'raScore', 'profundidad', 'ursVinculados', 'estado'];

        const secMatriz = {
            tipo:             'matriz-tc',
            titulo:           `${nIntro + 1}. Matriz Unificada de Test Cases`,
            numero:           nIntro + 1,
            tcs:              allTCs,
            columnasVisibles: colVis
        };

        const secTC = {
            tipo:       'tabla-test-case',
            titulo:     `${nIntro + 2}. Test Cases — ${tcLabel}`,
            numero:     nIntro + 2,
            schemaModo: schemaModo,
            tcs:        allTCs
        };

        const secCierre = (closing.seccionesCierre || []).map((s, i) => ({
            ...s,
            numero: nIntro + 3 + i
        }));

        return {
            type:      baseType.toUpperCase(),
            titulo:    skeleton.titulo  || `Protocolo ${baseType.toUpperCase()}`,
            codigo:    skeleton.codigo  || '',
            version:   skeleton.version || '1.0',
            estado:    skeleton.estado  || 'Borrador',
            secciones: [
                ...(skeleton.seccionesIntro || []),
                secMatriz,
                secTC,
                ...secCierre
            ]
        };
    }

    // ── Informes derivados (IIQ/IOQ/IPQ desde PIQ/POQ/PPQ) ───────────

    /** Extrae todos los TCs de un documento de protocolo */
    function _extractTCsFromDoc(doc) {
        if (!doc || !Array.isArray(doc.secciones)) return [];
        for (const sec of doc.secciones) {
            if (sec.tipo === 'matriz-tc' && Array.isArray(sec.tcs)) return sec.tcs;
        }
        for (const sec of doc.secciones) {
            if (sec.tipo === 'tabla-test-case' && Array.isArray(sec.tcs)) return sec.tcs;
        }
        return [];
    }

    /**
     * Genera un informe (IIQ/IOQ/IPQ) derivando el protocolo aprobado correspondiente.
     * Hace UNA sola llamada a la API que devuelve solo los resultados + conclusión.
     * Luego fusiona ese delta con la estructura completa del protocolo.
     */
    async function _generateInformeFromProtocolo(type, baseType, sourceId, protocolDoc) {
        const WS  = _WS();
        const tcs = _extractTCsFromDoc(protocolDoc);

        const INFORME_NAMES = {
            iiq: 'IIQ — Informe de Calificación de Instalación',
            ioq: 'IOQ — Informe de Calificación Operacional',
            ipq: 'IPQ — Informe de Calificación de Performance'
        };

        _setLayeredStatus(`Generando ${INFORME_NAMES[baseType] || type.toUpperCase()} — derivando de ${sourceId.toUpperCase()} (${tcs.length} TCs)…`);
        _cancelCtrl = new AbortController();

        try {
            const systemPrompt = await _SL().buildSystemPrompt(type);
            const userPrompt   = _buildInformeDeltaPrompt(type, baseType, protocolDoc, tcs);
            const model        = _useOpus ? _AC().MODELS.opus : _AC().MODELS.sonnet;
            const raw          = await _AC().generate({ systemPrompt, userPrompt, model, signal: _cancelCtrl.signal });
            _cancelCtrl = null;

            const delta   = _extractJson(raw);
            const fullDoc = _mergeInformeFromProtocolo(baseType, protocolDoc, delta);

            if (typeof addPackageDoc === 'function') {
                try { addPackageDoc(fullDoc, { fileName: `${type}-ai-generated.json` }); } catch (_) {}
                try { if (typeof saveToStorage === 'function') saveToStorage(); } catch (_) {}
            }

            _state = WS.markGenerated(_state, type, fullDoc);
            WS.save(_state);
            _render();
            _animateDocAppearance();
            _notify(`${type.toUpperCase()} generado desde ${sourceId.toUpperCase()} — ${tcs.length} TCs con resultados ✓`, 'info');
        } catch (e) {
            _cancelCtrl = null;
            const msg = e.truncated ? 'Respuesta truncada — activá Opus' : (e.message || 'Error de generación');
            _state = WS.markError(_state, msg);
            WS.save(_state);
            _render();
        }
    }

    /** Prompt lean para el delta del informe: solo pide resultados de TCs + conclusión */
    function _buildInformeDeltaPrompt(type, baseType, protocolDoc, tcs) {
        const isOQ        = baseType.endsWith('oq');
        const qualLabel   = isOQ ? 'OQ' : (baseType.endsWith('pq') ? 'PQ' : 'IQ');
        const snap        = _readSnap();
        const sysInfo     = snap && snap.systemInfo;
        const tcList      = tcs.map(tc =>
            `- ${tc.tcId}: ${tc.titulo}${tc.raScore ? ` [${tc.raScore}]` : ''}${tc.nivel ? ` [${tc.nivel}]` : ''}`
        ).join('\n');

        let p = `El protocolo ${protocolDoc.codigo || protocolDoc.titulo} fue ejecutado exitosamente.\n`;
        p += `Generá el delta para construir el ${type.toUpperCase()} (Informe de Calificación ${qualLabel}).\n\n`;

        if (sysInfo) {
            p += `## SISTEMA\n`;
            if (sysInfo.nombreSistema) p += `- Sistema: ${sysInfo.nombreSistema}\n`;
            if (sysInfo.categoriaGamp) p += `- Categoría GAMP: ${sysInfo.categoriaGamp}\n`;
            if (sysInfo.cliente)       p += `- Cliente: ${sysInfo.cliente}\n`;
            p += '\n';
        }

        p += `## PROTOCOLO EJECUTADO\n`;
        p += `- Código: ${protocolDoc.codigo || '(sin código)'}\n`;
        p += `- Título: ${protocolDoc.titulo || '(sin título)'}\n`;
        p += `- Total TCs: ${tcs.length}\n\n`;

        p += `## TEST CASES A EVALUAR (${tcs.length})\n${tcList}\n\n`;

        p += `## INSTRUCCIÓN\n`;
        p += `Para un sistema conforme con ejecución exitosa, generá:\n`;
        p += `1. Para cada TC de la lista: resultado (PASA / PASA CON OBSERVACIONES), observaciones técnicas breves y realistas, evidenciaRegistrada (descripción de evidencia capturada).\n`;
        p += `   — Distribución realista: ~90% PASA, ~8% PASA CON OBSERVACIONES, 0 NO PASA.\n`;
        p += `2. Una sección de conclusión completa con: estadísticas de ejecución (X PASA, Y OBS), dictamen de liberación ${qualLabel} y estado: CALIFICACIÓN ${qualLabel} APROBADA.\n\n`;

        p += `## FORMATO DE RESPUESTA\nDevolvé ÚNICAMENTE este JSON:\n`;
        p += `{\n  "tcResults": [\n    { "tcId": "...", "resultado": "PASA", "observaciones": "...", "evidenciaRegistrada": "..." }\n  ],\n`;
        p += `  "conclusionSeccion": { "tipo": "texto", "titulo": "CONCLUSIÓN Y DICTAMEN DE CALIFICACIÓN ${qualLabel}", "bloques": [ { "texto": "..." } ] }\n}`;

        return p;
    }

    /** Fusiona el delta (resultados + conclusión) con el JSON completo del protocolo para producir el informe */
    function _mergeInformeFromProtocolo(baseType, protocolDoc, delta) {
        const MAP_LABELS  = { iiq: 'IIQ', ioq: 'IOQ', ipq: 'IPQ' };
        const MAP_PROTO   = { iiq: 'PIQ', ioq: 'POQ', ipq: 'PPQ' };
        const MAP_NOMBRES = {
            iiq: 'Informe de Calificación de Instalación',
            ioq: 'Informe de Calificación Operacional',
            ipq: 'Informe de Calificación de Performance'
        };

        const iLabel = MAP_LABELS[baseType] || baseType.toUpperCase();
        const pLabel = MAP_PROTO[baseType]  || '';

        const informe = JSON.parse(JSON.stringify(protocolDoc));

        // Actualizar metadata del documento
        const replPL = str => (str || '').replace(new RegExp(pLabel, 'gi'), iLabel).replace(/Protocolo/gi, 'Informe');
        informe.type   = MAP_LABELS[baseType] || baseType.toUpperCase();
        informe.titulo = replPL(informe.titulo) || `${iLabel} — ${MAP_NOMBRES[baseType]}`;
        informe.codigo = replPL(informe.codigo);
        informe.estado = 'Ejecutado';

        // Construir mapa tcId → resultado
        const resultMap = {};
        (delta.tcResults || []).forEach(r => { resultMap[r.tcId] = r; });

        // Inyectar resultados en todas las secciones con TCs y actualizar títulos
        (informe.secciones || []).forEach(sec => {
            if (sec.titulo) sec.titulo = replPL(sec.titulo);
            if (sec.tcs && Array.isArray(sec.tcs)) {
                sec.tcs = sec.tcs.map(tc => ({
                    ...tc,
                    resultado:           resultMap[tc.tcId]?.resultado           || 'PASA',
                    observaciones:       resultMap[tc.tcId]?.observaciones       || '',
                    evidenciaRegistrada: resultMap[tc.tcId]?.evidenciaRegistrada || ''
                }));
            }
        });

        // Agregar conclusión al final
        if (delta.conclusionSeccion) {
            informe.secciones.push({
                ...delta.conclusionSeccion,
                numero: (informe.secciones || []).length + 1
            });
        }

        // Calcular executionSummary desde los resultados reales (para que RIQ/ROQ/RPQ lo lean)
        const results = delta.tcResults || [];
        const pasa    = results.filter(r => r.resultado === 'PASA').length;
        const obs     = results.filter(r => r.resultado === 'PASA CON OBSERVACIONES').length;
        const fail    = results.filter(r => r.resultado === 'NO PASA').length;
        const total   = pasa + obs + fail || results.length || 1;
        informe.executionSummary = {
            totalTCs:             total,
            pasa,
            pasaConObservaciones: obs,
            noPasa:               fail,
            porcentajeConformidad: Math.round((pasa + obs) / total * 100),
            verdict: fail === 0
                ? `CALIFICACIÓN ${MAP_LABELS[baseType] || baseType.toUpperCase()} APROBADA`
                : `CALIFICACIÓN ${MAP_LABELS[baseType] || baseType.toUpperCase()} CON NCs ABIERTAS`,
            protocoloOrigen: protocolDoc.codigo || protocolDoc.titulo || ''
        };

        return informe;
    }

    // ─────────────────────────────────────────────────────────────────

    /** Regenera un doc ya aprobado SIN invalidar los posteriores. */
    function _regenSolo(docType) {
        if (!confirm(`¿Regenerar ${docType.toUpperCase()} con IA?\n\nLos documentos posteriores ya aprobados se CONSERVAN tal como están.`)) return;
        _state._regenSoloPrev    = _state.currentDocType;
        _state._regenSoloMode    = docType;
        _state.currentDocType    = docType;
        _state.pendingDoc        = null;
        _state.status            = 'idle';
        _WS().save(_state);
        _render();
        _notify(`Modo regenerar-solo: ${docType.toUpperCase()} — los posteriores se conservan`, 'info', 3000);
    }

    async function _syncDocToServer(projId, docType, docJson) {
        try {
            const res = await fetch(`/api/projects/${projId}/documents/${docType}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'draft', content: docJson })
            });
            if (res.ok) {
                console.info(`[AIGen] ${docType.toUpperCase()} → servidor ✓`);
            } else {
                const err = await res.json().catch(() => ({}));
                console.warn(`[AIGen] sync ${docType} falló (${res.status}):`, err.error || '');
            }
        } catch (e) {
            console.warn(`[AIGen] sync ${docType} error de red:`, e.message);
        }
    }

    async function _syncAllDocsToServer() {
        const approved = _state.approvedDocs || {};
        const types = Object.keys(approved);
        if (!types.length) return;
        const btn = document.getElementById('aigBtnSyncAll');
        if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
        let ok = 0, fail = 0;
        for (const t of types) {
            try {
                const res = await fetch(`/api/projects/${_state.projectId}/documents/${t}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'draft', content: approved[t] })
                });
                if (res.ok) ok++; else fail++;
            } catch { fail++; }
        }
        if (btn) { btn.disabled = false; btn.textContent = '↑ Guardar en proyecto'; }
        _notify(
            fail === 0
                ? `${ok} documentos guardados en el proyecto ✓`
                : `${ok} guardados, ${fail} fallaron. Verificá la sesión.`,
            fail === 0 ? 'ok' : 'warning',
            5000
        );
    }

    function _approve() {
        const WS = _WS();
        if (!_state.pendingDoc) return;
        const { docType, json } = _state.pendingDoc;

        // Guardar en carpeta física (siempre, en ambos modos)
        const FS = VS.ProjectFolderFS;
        const _writeFS = (dt, j) => {
            if (FS && FS.isSupported && FS.isSupported()) {
                FS.writeAIDoc(_state.projectId, dt, j)
                    .then(() => console.info(`[AIGen] ${dt.toUpperCase()}.json → carpeta del proyecto`))
                    .catch(err => console.warn(`[AIGen] No se escribió ${dt} a carpeta:`, err.message));
            }
        };

        // Modo regenerar-solo: actualizar solo este doc, conservar todos los posteriores
        if (_state._regenSoloMode) {
            _state.approvedDocs[docType] = json;
            _state.pendingDoc = null;
            const prevCurrent = _state._regenSoloPrev;
            delete _state._regenSoloPrev;
            delete _state._regenSoloMode;
            // Buscar el próximo doc genuinamente pendiente (no aprobado, no salteado)
            const cascade = WS.getActiveCascade(_state);
            const skipped = _state.skippedDocs || {};
            const nextPending = cascade.find(t => !_state.approvedDocs[t] && !skipped[t]);
            _state.currentDocType = nextPending || prevCurrent || cascade[cascade.length - 1];
            _state.status = nextPending ? 'idle' : 'done';
            _writeFS(docType, json);
            WS.save(_state);
            _syncDocToServer(_state.projectId, docType, json);
            _render();
            _notify(`${docType.toUpperCase()} actualizado — los posteriores se conservan ✓`, 'info', 4000);
            return;
        }

        // Modo normal: avanzar al siguiente en la cascada
        _state = WS.markApproved(_state, docType, json);
        WS.save(_state);
        _writeFS(docType, json);
        _syncDocToServer(_state.projectId, docType, json);

        _render();
        if (_state.status === 'done') {
            _notify('¡Ciclo de validación completo! Todos los documentos aprobados.', 'info', 5000);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    function _buildUserPrompt(state, changeInstructions) {
        const type = state.currentDocType;
        // Soporte para instancias de módulo (poq-mod01, iiq-mod02, etc.)
        const inst     = (state.moduleInstances || []).find(m => m.id === type);
        const baseType = inst ? inst.baseType : type;
        const label    = inst
            ? `${DOCTYPE_LABELS[baseType] || baseType.toUpperCase()} — Módulo "${inst.label}"`
            : (DOCTYPE_LABELS[type] || type.toUpperCase());

        // Solo inyectar los docs directamente relevantes para este tipo (evitar saturar el modelo)
        const deps    = CONTEXT_DEPS[baseType] || [];
        const context = _WS().getApprovedContext(state).filter(c => deps.includes(c.type));

        // Metadata del proyecto activo (fuente de verdad — evita que la API adivine la cat. GAMP)
        const snap    = _readSnap();
        const sysInfo = snap && snap.systemInfo ? snap.systemInfo : null;

        let p = `Generá el documento ${label} para el siguiente proyecto de validación computerizada.\n\n`;

        if (sysInfo) {
            p += `## METADATOS DEL PROYECTO (FUENTE DE VERDAD — respetar siempre, no inferir del texto)\n`;
            if (sysInfo.nombreSistema)  p += `- Sistema: ${sysInfo.nombreSistema}\n`;
            if (sysInfo.codigoSistema)  p += `- Código: ${sysInfo.codigoSistema}\n`;
            if (sysInfo.categoriaGamp)  p += `- **Categoría GAMP: ${sysInfo.categoriaGamp}** ← usar exactamente esta, NO inferir del documento fuente\n`;
            if (sysInfo.tipoSistema)    p += `- Tipo de despliegue: ${sysInfo.tipoSistema}\n`;
            if (sysInfo.cliente)        p += `- Cliente: ${sysInfo.cliente}\n`;
            if (sysInfo.empresa)        p += `- Empresa validadora: ${sysInfo.empresa}\n`;
            if (sysInfo.proveedor)      p += `- Proveedor del sistema: ${sysInfo.proveedor}\n`;
            p += '\n';
        }

        p += `## DOCUMENTO FUENTE\n${state.sourceDocText}\n`;

        // Modo patch: inyectar la versión actual del doc como base a modificar
        if (state._regenSoloMode === baseType && state.approvedDocs && state.approvedDocs[baseType]) {
            p += `\n## VERSIÓN ACTUAL DEL DOCUMENTO (BASE A MODIFICAR)\n`;
            p += `Mantenée TODA la estructura, secciones y contenido que NO se mencione explícitamente en las instrucciones de cambio. Solo modificá lo que se pide.\n`;
            p += `\`\`\`json\n${JSON.stringify(state.approvedDocs[baseType], null, 2)}\n\`\`\`\n`;
        }

        // Restricción crítica MTR: IDs reales de URS y TCs — no inventar
        if (baseType === 'mtr') {
            const ursApproved = state.approvedDocs && state.approvedDocs.urs;
            const rs = ursApproved && ursApproved.requirementsSummary;
            p += `\n## RESTRICCIONES CRÍTICAS — MTR\n`;
            if (rs && rs.total) {
                p += `- La tabla-trazabilidad DEBE tener EXACTAMENTE ${rs.total} filas de URS (${rs.functional || '?'} funcionales + ${rs.nonFunctional || '?'} no funcionales).\n`;
                p += `- El resumen estadístico debe sumar EXACTAMENTE ${rs.total} en la fila TOTAL.\n`;
            }
            p += `- Los TC-IQ IDs deben ser EXACTAMENTE los que aparecen en el PIQ aprobado (ver lista arriba). NO inventes IDs.\n`;
            p += `- Los TC-OQ IDs deben ser EXACTAMENTE los que aparecen en el POQ aprobado. NO inventes IDs.\n`;
            p += `- Si un protocolo de fase (POQ, PPQ) no está aprobado aún, poner "—" en esa columna. No inventar IDs futuros.\n`;
            p += `- URS-IDs: usar solo los que existen en el URS aprobado. NO inventar URS-029, URS-030 ni ningún ID que no esté en la lista.\n`;
        }

        // Documento base adicional seleccionado manualmente por el usuario
        const customBase = state._customBaseDoc || null;
        if (customBase) {
            const customCtx = _WS().getApprovedContext(state).find(c => c.type === customBase);
            if (customCtx) {
                p += `\n## DOCUMENTO BASE PRINCIPAL (seleccionado por el usuario — usarlo como referencia prioritaria)\n`;
                p += `### ${_shortLabel(customBase)}\n\`\`\`json\n${JSON.stringify(customCtx.json, null, 2)}\n\`\`\`\n`;
            }
        }

        if (context.length) {
            p += `\n## DOCUMENTOS APROBADOS DEL PAQUETE (${context.map(c => c.type.toUpperCase()).join(', ')}) — mantené coherencia\n`;
            const isReporte = ['riq', 'roq', 'rpq'].includes(baseType);
            const INFORMES  = new Set(['iiq', 'ioq', 'ipq']);

            // MTR: conjunto de protocolos del que puede extraer TCs
            const PROTOCOLS_FOR_MTR = new Set(['piq', 'poq', 'ppq']);
            const REPORTES_FOR_MTR  = new Set(['riq', 'roq', 'rpq']);

            context.forEach(({ type: t, json }) => {
                // Protocolos PIQ/POQ/PPQ en contexto de MTR: solo lista compacta de TCs (no JSON completo)
                if (baseType === 'mtr' && PROTOCOLS_FOR_MTR.has(t)) {
                    const tcs = _extractTCsFromDoc(json);
                    const phaseLabel = t === 'piq' ? 'IQ' : t === 'poq' ? 'OQ' : 'PQ';
                    p += `\n### ${_shortLabel(t)} — LISTA DE TCs ${phaseLabel} (usar estos IDs exactos en la MTR)\n`;
                    p += `Total: ${tcs.length} TCs\n`;
                    tcs.forEach(tc => {
                        const ursIds = (tc.ursVinculados || []).join(', ') || '—';
                        const raId   = tc.raVinculado || tc.raId || '—';
                        const comp   = tc.componente || '—';
                        p += `- ${tc.tcId}: ${tc.titulo || ''} | URS: ${ursIds} | RA: ${raId} | Comp: ${comp}\n`;
                    });
                    p += '\n';
                    return;
                }

                // Reportes RIQ/ROQ/RPQ en contexto de MTR: solo el dictamen final
                if (baseType === 'mtr' && REPORTES_FOR_MTR.has(t)) {
                    const phase = t === 'riq' ? 'IQ' : t === 'roq' ? 'OQ' : 'PQ';
                    p += `\n### ${_shortLabel(t)} — DICTAMEN ${phase}\n`;
                    // Buscar la sección de conclusión/dictamen
                    const secs = json.secciones || [];
                    const conc = secs.find(s => /dictamen|conclusion|resultado/i.test(s.titulo || ''));
                    if (conc) {
                        const texto = (conc.bloques || []).map(b => b.texto || '').join(' ') || conc.contenido || '';
                        p += `${texto.slice(0, 300)}\n`;
                    }
                    p += '\n';
                    return;
                }

                // URS: inyectar requirementsSummary como fuente de verdad antes del JSON
                if (t === 'urs' && json.requirementsSummary) {
                    const rs = json.requirementsSummary;
                    p += `\n### URS — FUENTE DE VERDAD (USAR SIEMPRE ESTOS NÚMEROS — NO recontés desde las filas)\n`;
                    p += `- **Total requisitos: ${rs.total}** (${rs.functional} funcionales + ${rs.nonFunctional} no funcionales)\n`;
                    p += `- Mandatory: ${rs.mandatory} | Desirable: ${rs.desirable}\n`;
                    p += `- CRÍTICO: ${rs.critical} | ALTO: ${rs.high} | MEDIO: ${rs.medium}\n`;
                    if (rs.functionalIds && rs.functionalIds.length)    p += `- IDs funcionales: ${rs.functionalIds.join(', ')}\n`;
                    if (rs.nonFunctionalIds && rs.nonFunctionalIds.length) p += `- IDs no funcionales: ${rs.nonFunctionalIds.join(', ')}\n`;
                    p += '\n';
                }

                // IIQ/IOQ/IPQ en contexto de RIQ/ROQ/RPQ: solo resumen, no JSON completo
                if (isReporte && INFORMES.has(t)) {
                    const es = json.executionSummary || _extractExecSummary(json);
                    p += `\n### ${_shortLabel(t)} — RESULTADOS DE EJECUCIÓN (fuente de verdad para el dictamen)\n`;
                    if (es) {
                        p += `- Total TCs ejecutados: ${es.totalTCs}\n`;
                        p += `- PASA: ${es.pasa} | PASA CON OBS: ${es.pasaConObservaciones} | NO PASA: ${es.noPasa}\n`;
                        p += `- Conformidad: ${es.porcentajeConformidad}%\n`;
                        p += `- **${es.verdict}**\n`;
                        if (es.protocoloOrigen) p += `- Protocolo ejecutado: ${es.protocoloOrigen}\n`;
                    } else {
                        p += `(Sin resumen de ejecución — verificar el informe manualmente)\n`;
                    }
                    p += '\n';
                    return; // no incluir JSON completo del informe (evitar saturar contexto)
                }

                p += `\n### ${_shortLabel(t)}\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n`;
            });
        }

        // Correcciones por tipo de documento
        if (baseType === 'vp') {
            p += `\n## CAMPOS OBLIGATORIOS DEL DOCUMENTO (no modificar)\n`;
            p += `- document.titleEs = "PLAN DE VALIDACIÓN" (NO "Plan de Calificación" aunque el sistema sea un equipo)\n`;
            p += `- document.titleEn = "VALIDATION PLAN (VP)"\n`;
            p += `- document.headerTitle = "Plan de Validación (VP)"\n`;
        }

        if (inst) {
            p += `\n## MÓDULO / SUBSISTEMA\n`;
            p += `Este protocolo corresponde EXCLUSIVAMENTE al módulo/subsistema: **"${inst.label}"**.\n`;
            p += `- Generá casos de prueba, requerimientos y alcance ÚNICAMENTE para este módulo.\n`;
            p += `- No incluyas funcionalidades de otros módulos del sistema.\n`;
            p += `- El código del documento debe incluir el identificador del módulo (ej: ${type.toUpperCase().replace('-', '-')}).\n`;
        }

        if (changeInstructions) p += `\n## INSTRUCCIONES DE CAMBIO\n${changeInstructions}\n`;
        p += '\n## FORMATO DE RESPUESTA\n';
        p += 'Devolvé ÚNICAMENTE el JSON válido del documento. Sin explicaciones, sin markdown wrapping, sin triple backticks.\n';
        p += 'Generá el JSON de forma COMPACTA: valores de texto directos y precisos, sin párrafos extensos ni relleno. ';
        p += 'Priorizá completitud estructural (todos los campos requeridos) sobre longitud de los valores textuales.';
        return p;
    }

    function _extractJson(text) {
        if (!text || !text.trim()) throw new Error('La API devolvió una respuesta vacía');
        try { return JSON.parse(text.trim()); } catch (_) {}
        const md = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (md) { try { return JSON.parse(md[1].trim()); } catch (_) {} }
        const openB = text.indexOf('{');
        const openA = text.indexOf('[');
        const start = Math.min(
            openB >= 0 ? openB : Infinity,
            openA >= 0 ? openA : Infinity
        );
        if (start < Infinity) {
            // Intento 1: desde primer { hasta el final
            try { return JSON.parse(text.slice(start)); } catch (_) {}
            // Intento 2: desde primer { hasta el último } o ] — maneja texto trailing de Claude
            const closer = (start === openB) ? '}' : ']';
            const end = text.lastIndexOf(closer);
            if (end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {} }
        }
        throw new Error(`No se pudo extraer JSON válido.\n\n${text.slice(0, 500)}`);
    }

    function _setPaneHeader(title, status) {
        const t = document.getElementById('aigPaneTitle');
        const s = document.getElementById('aigPaneStatus');
        if (t) t.textContent = title;
        if (s) s.textContent = status;
    }

    function _mkBtn(id, label, cls, disabled) {
        const b = document.createElement('button');
        b.id = id; b.textContent = label;
        b.className = `aig-btn ${cls}`;
        if (disabled) b.disabled = true;
        return b;
    }

    function _shortLabel(type) {
        const inst = (_state && _state.moduleInstances || []).find(m => m.id === type);
        if (inst) {
            const base = (DOCTYPE_LABELS[inst.baseType] || inst.baseType.toUpperCase()).split('—')[0].trim();
            return `${base} — ${inst.label}`;
        }
        const full = DOCTYPE_LABELS[type] || type.toUpperCase();
        return full.split('—')[0].trim();
    }

    function _readSnap() {
        try { return JSON.parse(localStorage.getItem('vscTestsData_v3') || 'null'); } catch (_) { return null; }
    }

    function _notify(msg, type, duration) {
        if (typeof showNotification === 'function') showNotification(msg, type, duration);
        else console.warn('[AIWizard]', msg);
    }

    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    VS.AIGenerator.WizardUI         = WizardUI;
    VS.AIGenerator._buildUserPrompt = _buildUserPrompt;
    VS.AIGenerator._extractJson     = _extractJson;

})(typeof window !== 'undefined' ? window : global);
