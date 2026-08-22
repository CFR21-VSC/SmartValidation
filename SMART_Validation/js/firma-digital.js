'use strict';

/* ====================================================================
   FIRMA DIGITAL — Circuito drag-and-drop por documento y rol
   ==================================================================== */

(function (global) {
    const STORAGE_PREFIX = 'firma-digital-';

    // ── Core helpers ──────────────────────────────────────────────────

    function _key(pid) { return STORAGE_PREFIX + pid; }

    function _load(pid) {
        try {
            const raw = localStorage.getItem(_key(pid));
            const d = raw ? JSON.parse(raw) : {};
            return { projectId: pid, firmantes: [], slotAssignments: [], ...d };
        } catch (_) { return { projectId: pid, firmantes: [], slotAssignments: [] }; }
    }

    function _save(data) { localStorage.setItem(_key(data.projectId), JSON.stringify(data)); }

    function _getProjectId() {
        try {
            const VS = global.ValidationSuite;
            return (VS && VS.ProjectsManager && VS.ProjectsManager.getActiveId && VS.ProjectsManager.getActiveId())
                || localStorage.getItem('vscActiveProjectId')
                || 'default';
        } catch (_) { return 'default'; }
    }

    function _getProjectInfo() {
        try {
            const si = JSON.parse(localStorage.getItem('vscTestsData_v3') || '{}').systemInfo || {};
            return { name: si.nombreSistema || 'Paquete de Validación', code: si.codigoSistema || '', client: si.cliente || '' };
        } catch (_) { return { name: 'Paquete de Validación', code: '', client: '' }; }
    }

    function _hashPin(pin) {
        let h = 0;
        for (let i = 0; i < pin.length; i++) { h = (h << 5) - h + pin.charCodeAt(i); h = h & h; }
        return String(h);
    }

    function _initials(n) { return (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }

    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _getPackageDocs() {
        try {
            return (typeof global.packageDocs !== 'undefined' && Array.isArray(global.packageDocs) ? global.packageDocs : null)
                || (global.ValidationSuite && global.ValidationSuite.packageDocs)
                || [];
        } catch (_) { return []; }
    }

    function _renderCursiveToImage(text) {
        const cv = document.createElement('canvas');
        cv.width = 320; cv.height = 80;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, 320, 80);
        ctx.font = "28px 'Segoe Script','Brush Script MT','Dancing Script',cursive";
        ctx.fillStyle = '#1A2733';
        ctx.textBaseline = 'middle';
        ctx.fillText((text || '').slice(0, 35), 10, 40);
        return cv.toDataURL('image/png');
    }

    function _docTitle(entry, idx) {
        if (!entry) return 'Documento ' + (idx + 1);
        return entry.title
            || entry.code
            || (entry.data && entry.data.document && (entry.data.document.titleEs || entry.data.document.code))
            || entry.type
            || ('Documento ' + (idx + 1));
    }

    function _docRoles(entry) {
        if (!entry || !entry.data || !Array.isArray(entry.data.secciones)) return [];
        const sec = entry.data.secciones.find(function(s) { return s.tipo === 'tabla-firmas-final'; });
        if (!sec) return [];
        const seen = new Set();
        const roles = [];
        function add(r) {
            const v = (typeof r === 'string' ? r : (r && (r.rol || r.cargo) ? (r.rol || r.cargo) : '')).trim();
            if (v && !seen.has(v)) { seen.add(v); roles.push(v); }
        }
        if (Array.isArray(sec.rolesPlaceholder)) sec.rolesPlaceholder.forEach(add);
        if (Array.isArray(sec.roles)) sec.roles.forEach(add);
        if (Array.isArray(sec.firmas)) sec.firmas.forEach(function(f) { add(f.rol); });
        if (!roles.length) roles.push('Firmante');
        return roles;
    }

    function _injectSignatureToDoc(firmante, docIdx, role, firmaImage) {
        try {
            const docs = _getPackageDocs();
            const entry = docs[docIdx];
            if (!entry || !entry.data) return;
            const fecha = new Date(firmante.firmadoAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const firmaEntry = { rol: role, nombre: firmante.nombre, iniciales: _initials(firmante.nombre), firmaImage: firmaImage || null, fecha: fecha };
            (entry.data.secciones || []).forEach(function(sec) {
                if (sec.tipo !== 'tabla-firmas-final') return;
                if (!Array.isArray(sec.firmas)) sec.firmas = [];
                const i = sec.firmas.findIndex(function(x) { return x.rol === role; });
                if (i >= 0) sec.firmas[i] = firmaEntry; else sec.firmas.push(firmaEntry);
            });
            if (typeof global.saveToStorage === 'function') global.saveToStorage().catch(function() {});
        } catch (e) { console.warn('[FirmaDigital]', e); }
    }

    // ── State ─────────────────────────────────────────────────────────

    let _captureTab    = 'manuscrita';
    let _drawing       = false;
    let _lx = 0, _ly  = 0;
    let _pendingSlot   = null;   // { firmanteId, docIdx, role }
    let _pendingPicker = null;   // { docIdx, role }
    let _dragFirmanteId = null;
    let _slotMap       = [];     // [{ docIdx, role }] rebuilt each render

    // ── CSS ───────────────────────────────────────────────────────────

    function _injectStyles() {
        if (document.getElementById('firma-digital-css')) return;
        const s = document.createElement('style');
        s.id = 'firma-digital-css';
        s.textContent = `
/* ── Firma Digital — overlay ── */
#fdOverlay {
    display:none; position:fixed; inset:0; background:rgba(10,20,30,.6);
    z-index:9000; align-items:center; justify-content:center;
}
#fdOverlay.open { display:flex; }
#fdModal {
    background:#fff; border-radius:14px; width:840px; max-width:97vw;
    max-height:90vh; display:flex; flex-direction:column;
    box-shadow:0 24px 80px rgba(0,0,0,.35);
    animation: fdSlideIn .22s ease;
}
@keyframes fdSlideIn { from { transform:translateY(18px); opacity:0; } to { transform:none; opacity:1; } }

/* Header */
#fdModal .fd-hdr {
    background:linear-gradient(135deg, #1A3348 0%, #213B50 100%);
    color:#fff; padding:18px 24px 14px; border-radius:14px 14px 0 0; flex-shrink:0;
}
#fdModal .fd-hdr-top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
#fdModal .fd-hdr-title { font-size:16px; font-weight:700; margin:0 0 2px; letter-spacing:-.3px; }
#fdModal .fd-hdr-sub { font-size:11px; opacity:.7; margin:0; }
#fdModal .fd-close { background:none; border:none; color:#fff; font-size:20px; cursor:pointer; opacity:.6; padding:0; line-height:1; flex-shrink:0; }
#fdModal .fd-close:hover { opacity:1; }
#fdModal .fd-prog { display:flex; align-items:center; gap:10px; margin-top:12px; }
#fdModal .fd-prog-bar { flex:1; height:5px; background:rgba(255,255,255,.25); border-radius:3px; overflow:hidden; }
#fdModal .fd-prog-fill { height:100%; background:#4CAF50; border-radius:3px; transition:width .5s ease; }
#fdModal .fd-prog-lbl { font-size:11px; opacity:.8; white-space:nowrap; }

/* Two-column body */
#fdModal .fd-body { padding:0; overflow:hidden; flex:1; display:flex; min-height:0; }

/* Left column — firmantes */
#fdModal .fd-col-left {
    width:240px; flex-shrink:0; border-right:1.5px solid #EEF2F5;
    overflow-y:auto; display:flex; flex-direction:column;
}
#fdModal .fd-col-hdr {
    font-size:10px; font-weight:700; color:#7A8EA0; text-transform:uppercase;
    letter-spacing:.7px; padding:10px 14px 8px; border-bottom:1.5px solid #EEF2F5;
    background:#FAFBFC; flex-shrink:0; position:sticky; top:0; z-index:1;
}
#fdModal .fd-fcard {
    display:flex; align-items:center; gap:10px; padding:10px 14px;
    border-bottom:1px solid #F0F4F7; cursor:grab; transition:background .15s;
    user-select:none;
}
#fdModal .fd-fcard:hover { background:#F5F8FB; }
#fdModal .fd-fcard.fd-dragging { opacity:.3; }
#fdModal .fd-favatar {
    width:36px; height:36px; border-radius:50%; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    font-size:12px; font-weight:700; color:#fff; background:#90A4AE;
}
#fdModal .fd-finfo { flex:1; min-width:0; }
#fdModal .fd-fname { font-size:12px; font-weight:700; color:#1A2733; margin:0 0 1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#fdModal .fd-frol-s { font-size:10px; color:#7A8EA0; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#fdModal .fd-fdrag-hint { font-size:16px; color:#C8D4E0; flex-shrink:0; line-height:1; }
#fdModal .fd-empty-left { padding:24px 14px; text-align:center; color:#B0BEC5; font-size:11px; line-height:1.6; flex:1; }
#fdModal .fd-btn-add-col {
    display:block; margin:10px 12px 12px; background:none; border:1.5px dashed #C8D4E0;
    color:#7A8EA0; padding:7px 10px; border-radius:6px; font-size:11px; font-weight:600;
    cursor:pointer; text-align:center; width:calc(100% - 24px); box-sizing:border-box;
}
#fdModal .fd-btn-add-col:hover { border-color:#213B50; color:#213B50; }

/* Right column — documents */
#fdModal .fd-col-right { flex:1; overflow-y:auto; }
#fdModal .fd-no-docs { padding:40px 20px; text-align:center; color:#B0BEC5; }
#fdModal .fd-no-docs-icon { font-size:36px; margin-bottom:10px; }
#fdModal .fd-no-docs-title { font-size:13px; font-weight:700; color:#7A8EA0; margin:0 0 4px; }
#fdModal .fd-no-docs-sub { font-size:11px; margin:0; }

/* Document blocks */
#fdModal .fd-doc-block { border-bottom:2px solid #EEF2F5; }
#fdModal .fd-doc-block:last-child { border-bottom:none; }
#fdModal .fd-doc-head {
    padding:9px 16px 7px; background:#F8F9FB;
    display:flex; align-items:center; gap:8px;
}
#fdModal .fd-doc-name { font-size:12px; font-weight:700; color:#1A3348; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#fdModal .fd-doc-type { font-size:10px; color:#7A8EA0; background:#EEF2F5; padding:2px 7px; border-radius:10px; white-space:nowrap; flex-shrink:0; }
#fdModal .fd-doc-prog { font-size:10px; color:#388E3C; font-weight:700; flex-shrink:0; }

/* Role slots */
#fdModal .fd-slot { display:flex; align-items:center; gap:12px; padding:7px 14px; border-bottom:1px solid #F0F4F7; min-height:48px; }
#fdModal .fd-slot:last-child { border-bottom:none; }
#fdModal .fd-slot-role { font-size:11px; font-weight:600; color:#5A6E82; width:148px; flex-shrink:0; line-height:1.3; }
#fdModal .fd-slot-drop {
    flex:1; border:1.5px dashed #C8D4E0; border-radius:8px; padding:6px 12px;
    display:flex; align-items:center; justify-content:center;
    font-size:11px; color:#B0BEC5; cursor:pointer;
    transition:border-color .2s, background .2s; min-height:32px;
}
#fdModal .fd-slot-drop:hover { border-color:#4C84B5; background:#EEF5FF; color:#4C84B5; }
#fdModal .fd-slot-drop.fd-drag-over { border-color:#4CAF50; background:#F0FFF4; color:#388E3C; border-style:solid; }
#fdModal .fd-slot-drop.fd-signed {
    border:1.5px solid #A5D6A7; background:#F6FFF6;
    justify-content:flex-start; gap:10px; cursor:default;
}
#fdModal .fd-slot-sig-img { max-width:90px; max-height:26px; display:block; flex-shrink:0; }
#fdModal .fd-slot-sig-typed { font-family:'Segoe Script','Brush Script MT',cursive; font-size:16px; color:#1A2733; flex-shrink:0; line-height:1; }
#fdModal .fd-slot-sig-info { display:flex; flex-direction:column; gap:1px; flex:1; min-width:0; }
#fdModal .fd-slot-sig-name { font-size:11px; font-weight:700; color:#2E7D32; }
#fdModal .fd-slot-sig-fecha { font-size:10px; color:#7A8EA0; }
#fdModal .fd-slot-check { font-size:14px; color:#4CAF50; flex-shrink:0; }
#fdModal .fd-slot-clear { background:none; border:none; font-size:11px; color:#C8D4E0; cursor:pointer; flex-shrink:0; padding:2px 5px; border-radius:4px; }
#fdModal .fd-slot-clear:hover { color:#C62828; background:#FFF5F5; }

/* Footer */
#fdModal .fd-footer {
    padding:12px 22px; border-top:1.5px solid #EEF2F5;
    display:flex; justify-content:space-between; align-items:center; flex-shrink:0;
}
#fdModal .fd-footer-hint { font-size:11px; color:#A0B0C0; }
#fdModal .fd-btn-export { background:#4CAF50; color:#fff; border:none; padding:9px 20px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; }
#fdModal .fd-btn-export:hover { background:#388E3C; }
#fdModal .fd-btn-export:disabled { opacity:.35; cursor:default; }

/* ── Captura ── */
#fdCaptureOverlay {
    display:none; position:fixed; inset:0; background:rgba(10,20,30,.7);
    z-index:9100; align-items:center; justify-content:center;
}
#fdCaptureOverlay.open { display:flex; }
#fdCaptureModal {
    background:#fff; border-radius:14px; width:490px; max-width:96vw;
    box-shadow:0 24px 80px rgba(0,0,0,.4); animation: fdSlideIn .2s ease;
}
#fdCaptureModal .fdc-hdr {
    background:#F8F9FB; border-bottom:1.5px solid #E0E8F0;
    padding:14px 18px; border-radius:14px 14px 0 0;
    display:flex; align-items:flex-start; justify-content:space-between;
}
#fdCaptureModal .fdc-title { font-size:13px; font-weight:700; color:#1A2733; margin:0 0 2px; }
#fdCaptureModal .fdc-sub   { font-size:11px; color:#7A8EA0; margin:0; }
#fdCaptureModal .fdc-close { background:none; border:none; font-size:18px; color:#7A8EA0; cursor:pointer; }
#fdCaptureModal .fdc-body { padding:18px 20px; }
#fdCaptureModal .fdc-tabs { display:flex; border:1.5px solid #E0E8F0; border-radius:7px; overflow:hidden; margin-bottom:14px; }
#fdCaptureModal .fdc-tab { flex:1; padding:8px; border:none; background:#F8F9FB; font-size:12px; font-weight:600; color:#7A8EA0; cursor:pointer; transition:background .15s,color .15s; }
#fdCaptureModal .fdc-tab.active { background:var(--vsc-azul,#213B50); color:#fff; }
#fdCanvas { border:1.5px solid #C8D4E0; border-radius:8px; cursor:crosshair; width:100%; display:block; background:#FAFCFF; touch-action:none; }
#fdCaptureModal .fdc-canvas-hint { font-size:10px; color:#B0BEC5; text-align:center; margin:5px 0 0; }
#fdCaptureModal .fdc-clear { background:none; border:1px solid #C8D4E0; color:#7A8EA0; font-size:11px; padding:4px 12px; border-radius:4px; cursor:pointer; margin-top:8px; }
#fdCaptureModal .fdc-clear:hover { border-color:#5A6E82; color:#5A6E82; }
#fdTipoInput {
    width:100%; padding:10px 14px; border:1.5px solid #C8D4E0; border-radius:7px;
    font-family:'Segoe Script','Brush Script MT',cursive;
    font-size:24px; color:#1A2733; background:#FAFCFF; box-sizing:border-box;
}
#fdTipoInput:focus { outline:none; border-color:var(--vsc-azul,#213B50); }
#fdCaptureModal .fdc-tipo-hint { font-size:10px; color:#B0BEC5; text-align:center; margin-top:5px; }
#fdCaptureModal .fdc-pin-row { display:flex; align-items:center; gap:12px; margin-top:16px; }
#fdCaptureModal .fdc-pin-row label { font-size:12px; font-weight:600; color:#5A6E82; white-space:nowrap; }
#fdPinInput { width:130px; padding:9px 12px; border:1.5px solid #C8D4E0; border-radius:6px; font-size:18px; letter-spacing:5px; text-align:center; color:#1A2733; }
#fdPinInput:focus { outline:none; border-color:var(--vsc-azul,#213B50); }
#fdCaptureModal .fdc-pin-err { font-size:11px; color:#C62828; margin-top:6px; display:none; font-weight:600; }
#fdCaptureModal .fdc-footer { padding:12px 18px; border-top:1.5px solid #EEF2F5; display:flex; justify-content:flex-end; gap:10px; }
#fdCaptureModal .fdc-cancel { background:none; border:1.5px solid #C8D4E0; color:#5A6E82; padding:8px 16px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
#fdCaptureModal .fdc-confirm { background:#4CAF50; color:#fff; border:none; padding:8px 22px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; }
#fdCaptureModal .fdc-confirm:hover { background:#388E3C; }

/* ── Picker firmante ── */
#fdPickerOverlay {
    display:none; position:fixed; inset:0; background:rgba(10,20,30,.55);
    z-index:9150; align-items:center; justify-content:center;
}
#fdPickerOverlay.open { display:flex; }
#fdPickerModal {
    background:#fff; border-radius:12px; width:300px; max-width:96vw;
    max-height:70vh; display:flex; flex-direction:column;
    box-shadow:0 20px 60px rgba(0,0,0,.3); animation:fdSlideIn .2s ease;
}
#fdPickerModal .fdp-hdr { padding:14px 16px 10px; border-bottom:1.5px solid #EEF2F5; }
#fdPickerModal .fdp-title { font-size:13px; font-weight:700; color:#1A2733; margin:0 0 2px; }
#fdPickerModal .fdp-sub { font-size:10px; color:#7A8EA0; margin:0; }
#fdPickerModal .fdp-list { overflow-y:auto; flex:1; padding:6px; }
#fdPickerModal .fdp-item { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:8px; cursor:pointer; transition:background .15s; }
#fdPickerModal .fdp-item:hover { background:#F5F8FB; }
#fdPickerModal .fdp-av { width:32px; height:32px; border-radius:50%; background:#90A4AE; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:#fff; flex-shrink:0; }
#fdPickerModal .fdp-nm { font-size:12px; font-weight:700; color:#1A2733; margin:0 0 1px; }
#fdPickerModal .fdp-rl { font-size:10px; color:#7A8EA0; margin:0; }
#fdPickerModal .fdp-cancel { padding:10px 14px; border-top:1.5px solid #EEF2F5; }
#fdPickerModal .fdp-cancel-btn { width:100%; background:none; border:1.5px solid #C8D4E0; color:#5A6E82; padding:7px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
#fdPickerModal .fdp-cancel-btn:hover { border-color:#5A6E82; }

/* ── Agregar firmante ── */
#fdAddOverlay {
    display:none; position:fixed; inset:0; background:rgba(10,20,30,.65);
    z-index:9200; align-items:center; justify-content:center;
}
#fdAddOverlay.open { display:flex; }
#fdAddModal { background:#fff; border-radius:12px; width:360px; max-width:96vw; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,.3); animation: fdSlideIn .2s ease; }
#fdAddModal h3 { font-size:15px; font-weight:700; color:#1A2733; margin:0 0 16px; }
#fdAddModal .fda-row { margin-bottom:12px; }
#fdAddModal .fda-row label { font-size:11px; font-weight:600; color:#5A6E82; display:block; margin-bottom:4px; }
#fdAddModal .fda-row input { width:100%; padding:9px 12px; border:1.5px solid #C8D4E0; border-radius:6px; font-size:13px; box-sizing:border-box; color:#1A2733; }
#fdAddModal .fda-row input:focus { outline:none; border-color:var(--vsc-azul,#213B50); }
#fdAddModal .fda-footer { display:flex; gap:10px; justify-content:flex-end; margin-top:16px; }
#fdAddModal .fda-cancel { background:none; border:1.5px solid #C8D4E0; color:#5A6E82; padding:8px 14px; border-radius:6px; font-size:12px; cursor:pointer; }
#fdAddModal .fda-confirm { background:var(--vsc-azul,#213B50); color:#fff; border:none; padding:8px 20px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; }
#fdAddModal .fda-confirm:hover { background:#152A3D; }

/* ── Dashboard de firmas pendientes ── */
#fd-dashboard {
    flex-shrink:0; background:#1A3348; color:#fff;
    padding:10px 20px; border-radius:0;
    border-bottom:2px solid #0F2233;
}
#fd-dashboard.fd-dash-hidden { display:none; }
.fd-dash-summary {
    display:flex; align-items:center; gap:16px; flex-wrap:wrap;
    font-size:12px; line-height:1.4;
}
.fd-dash-stat { display:flex; align-items:center; gap:5px; }
.fd-dash-stat-num { font-size:15px; font-weight:800; }
.fd-dash-stat-lbl { opacity:.75; }
.fd-dash-divider { width:1px; height:18px; background:rgba(255,255,255,.2); flex-shrink:0; }
.fd-dash-badge-warn { background:#E65100; color:#fff; border-radius:10px; padding:2px 9px; font-size:11px; font-weight:700; }
.fd-dash-badge-ok   { background:#2E7D32; color:#fff; border-radius:10px; padding:2px 9px; font-size:11px; font-weight:700; }
.fd-dash-toggle {
    margin-left:auto; background:none; border:1px solid rgba(255,255,255,.3);
    color:rgba(255,255,255,.8); font-size:10px; font-weight:600; padding:3px 10px;
    border-radius:10px; cursor:pointer; white-space:nowrap; flex-shrink:0;
}
.fd-dash-toggle:hover { border-color:#fff; color:#fff; }
.fd-dash-list {
    margin-top:8px; display:flex; flex-direction:column; gap:4px;
    max-height:130px; overflow-y:auto;
}
.fd-dash-list.fd-dash-list-hidden { display:none; }
.fd-dash-row {
    display:flex; align-items:center; gap:8px; background:rgba(255,255,255,.07);
    border-radius:6px; padding:5px 10px; font-size:11px;
}
.fd-dash-row-name { flex:1; min-width:0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fd-dash-row-roles { display:flex; gap:4px; flex-wrap:wrap; flex-shrink:0; }
.fd-dash-role-pill {
    background:rgba(230,81,0,.75); color:#fff; border-radius:8px;
    padding:1px 7px; font-size:10px; font-weight:600; white-space:nowrap;
}
.fd-dash-row-btn {
    background:none; border:1px solid rgba(255,255,255,.35); color:rgba(255,255,255,.85);
    font-size:10px; padding:2px 8px; border-radius:6px; cursor:pointer; white-space:nowrap; flex-shrink:0;
}
.fd-dash-row-btn:hover { background:rgba(255,255,255,.12); border-color:#fff; color:#fff; }

/* ── Asignación masiva ── */
.fd-assign-all-btn {
    padding: 2px 7px; font-size: 10px; font-weight: 700;
    background: transparent; border: 1px solid #5b9bd5;
    color: #5b9bd5; border-radius: 3px; cursor: pointer;
    opacity: 0.7; flex-shrink: 0; line-height: 1.4;
}
.fd-assign-all-btn:hover { opacity: 1; background: #1a3050; color: #8ec6f7; }
        `;
        document.head.appendChild(s);
    }

    // ── DOM ───────────────────────────────────────────────────────────

    function _injectDOM() {
        if (document.getElementById('fdOverlay')) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = `
        <div id="fdOverlay">
            <div id="fdModal">
                <div class="fd-hdr">
                    <div class="fd-hdr-top">
                        <div>
                            <p class="fd-hdr-title">✍ Circuito de Firma Digital</p>
                            <p class="fd-hdr-sub" id="fdSubtitle">—</p>
                        </div>
                        <button class="fd-close" onclick="FirmaDigital.close()">✕</button>
                    </div>
                    <div class="fd-prog">
                        <div class="fd-prog-bar"><div class="fd-prog-fill" id="fdProgFill" style="width:0%"></div></div>
                        <span class="fd-prog-lbl" id="fdProgLbl">0 de 0 slots firmados</span>
                    </div>
                </div>
                <div id="fd-dashboard" class="fd-dash-hidden"></div>
                <div class="fd-body">
                    <div class="fd-col-left" id="fdColLeft">
                        <div class="fd-col-hdr">Firmantes</div>
                    </div>
                    <div class="fd-col-right" id="fdColRight"></div>
                </div>
                <div class="fd-footer">
                    <span class="fd-footer-hint">Arrastrá un firmante sobre un rol para asignar la firma</span>
                    <button class="fd-btn-export" id="fdBtnExport" onclick="FirmaDigital.exportPackage()">
                        Exportar registro →
                    </button>
                </div>
            </div>
        </div>

        <div id="fdCaptureOverlay">
            <div id="fdCaptureModal">
                <div class="fdc-hdr">
                    <div>
                        <p class="fdc-title" id="fdcTitle">Firmando</p>
                        <p class="fdc-sub"   id="fdcSub">—</p>
                    </div>
                    <button class="fdc-close" onclick="FirmaDigital.closeCapture()">✕</button>
                </div>
                <div class="fdc-body">
                    <div class="fdc-tabs">
                        <button class="fdc-tab active" id="fdTabManus" onclick="FirmaDigital._tab('manuscrita')">✍ Manuscrita</button>
                        <button class="fdc-tab" id="fdTabTipo" onclick="FirmaDigital._tab('tipografica')">Aa Tipográfica</button>
                    </div>
                    <div id="fdPanelManus">
                        <canvas id="fdCanvas" width="450" height="160"></canvas>
                        <p class="fdc-canvas-hint">Dibujá tu firma con el mouse o el dedo</p>
                        <button class="fdc-clear" onclick="FirmaDigital._clearCanvas()">Limpiar</button>
                    </div>
                    <div id="fdPanelTipo" style="display:none">
                        <input type="text" id="fdTipoInput" placeholder="Escribí tu nombre" maxlength="60" autocomplete="off">
                        <p class="fdc-tipo-hint">Se renderizará como firma tipográfica en cursiva</p>
                    </div>
                    <div class="fdc-pin-row">
                        <label>PIN de confirmación</label>
                        <input type="password" id="fdPinInput" maxlength="8" placeholder="••••" autocomplete="off">
                    </div>
                    <p class="fdc-pin-err" id="fdPinErr">PIN incorrecto. Intentá de nuevo.</p>
                    <div class="fdc-cert-stmt">
                        <p class="fdc-cert-text" id="fdcCertText">—</p>
                    </div>
                </div>
                <div class="fdc-footer">
                    <button class="fdc-cancel" onclick="FirmaDigital.closeCapture()">Cancelar</button>
                    <button class="fdc-confirm" onclick="FirmaDigital._submit()">✓ Confirmar y firmar</button>
                </div>
            </div>
        </div>

        <div id="fdPickerOverlay">
            <div id="fdPickerModal">
                <div class="fdp-hdr">
                    <p class="fdp-title">Seleccionar firmante</p>
                    <p class="fdp-sub" id="fdpSub">—</p>
                </div>
                <div class="fdp-list" id="fdPickerList"></div>
                <div class="fdp-cancel">
                    <button class="fdp-cancel-btn" onclick="FirmaDigital.closePicker()">Cancelar</button>
                </div>
            </div>
        </div>

        <div id="fdAddOverlay">
            <div id="fdAddModal">
                <h3>Agregar firmante</h3>
                <div class="fda-row">
                    <label>Nombre completo</label>
                    <input type="text" id="fdaName" placeholder="Ej: Dra. Ana García" autocomplete="off">
                </div>
                <div class="fda-row">
                    <label>Rol / Cargo</label>
                    <input type="text" id="fdaRol" placeholder="Ej: Responsable de Calidad" autocomplete="off">
                </div>
                <div class="fda-row">
                    <label>PIN personal (para confirmar firma)</label>
                    <input type="password" id="fdaPin" maxlength="8" placeholder="Mínimo 4 dígitos" autocomplete="new-password">
                </div>
                <div class="fda-footer">
                    <button class="fda-cancel" onclick="FirmaDigital.closeAdd()">Cancelar</button>
                    <button class="fda-confirm" onclick="FirmaDigital._confirmAdd()">Agregar →</button>
                </div>
            </div>
        </div>
        `;
        document.body.appendChild(wrap);
    }

    // ── Module ────────────────────────────────────────────────────────

    const FirmaDigital = {

        open() {
            _injectStyles();
            _injectDOM();
            const info = _getProjectInfo();
            const sub  = [info.name, info.code, info.client].filter(Boolean).join(' · ');
            document.getElementById('fdSubtitle').textContent = sub || '—';
            this._render();
            document.getElementById('fdOverlay').classList.add('open');
        },

        close() { document.getElementById('fdOverlay')?.classList.remove('open'); },

        // ── Render ────────────────────────────────────────────────────

        _render() {
            const pid  = _getProjectId();
            const data = _load(pid);
            const docs = _getPackageDocs();
            _slotMap   = [];

            // Count slots for progress
            let totalSlots = 0, signedSlots = 0;
            docs.forEach(function(doc, di) {
                _docRoles(doc).forEach(function(role) {
                    totalSlots++;
                    if ((data.slotAssignments || []).find(function(a) { return a.docIdx === di && a.role === role && a.estado === 'firmado'; }))
                        signedSlots++;
                });
            });

            const pct = totalSlots > 0 ? Math.round((signedSlots / totalSlots) * 100) : 0;
            const fill = document.getElementById('fdProgFill');
            const lbl  = document.getElementById('fdProgLbl');
            if (fill) fill.style.width = pct + '%';
            if (lbl)  lbl.textContent  = signedSlots + ' de ' + totalSlots + ' slot' + (totalSlots !== 1 ? 's' : '') + ' firmado' + (totalSlots !== 1 ? 's' : '');

            const exportBtn = document.getElementById('fdBtnExport');
            if (exportBtn) exportBtn.disabled = signedSlots === 0;

            this._renderFirmantesCol(data.firmantes);
            this._renderDocsCol(docs, data);
            this.renderSignatureDashboard();
        },

        _renderFirmantesCol(list) {
            const col = document.getElementById('fdColLeft');
            if (!col) return;
            let html = '<div class="fd-col-hdr">Firmantes</div>';
            if (!list.length) {
                html += '<div class="fd-empty-left">Sin firmantes.<br>Agregá uno para comenzar.</div>';
            } else {
                html += list.map(function(f) {
                    const signedMark = f.firmaImage
                        ? '<span style="font-size:10px;color:#4CAF50;flex-shrink:0;" title="Firmante ya firmó">✓</span>'
                        : '';
                    return '<div class="fd-fcard" draggable="true"' +
                        ' ondragstart="FirmaDigital._dragStart(event,\'' + f.id + '\')"' +
                        ' ondragend="FirmaDigital._dragEnd(event)"' +
                        ' id="fdfcard_' + f.id + '">' +
                        '<div class="fd-favatar">' + _initials(f.nombre) + '</div>' +
                        '<div class="fd-finfo">' +
                            '<p class="fd-fname">' + _esc(f.nombre) + '</p>' +
                            '<p class="fd-frol-s">' + _esc(f.rol) + '</p>' +
                        '</div>' +
                        signedMark +
                        '<button class="fd-assign-all-btn"' +
                            ' title="Asignar \'' + _esc(f.nombre) + '\' como ' + _esc(f.rol) + ' en todos los documentos con ese slot vacío"' +
                            ' onclick="event.stopPropagation();FirmaDigital._assignToAll(\'' + f.id + '\')">→ Todos</button>' +
                        '<span class="fd-fdrag-hint" title="Arrastrá al slot">⠿</span>' +
                        '</div>';
                }).join('');
            }
            html += '<button class="fd-btn-add-col" onclick="FirmaDigital.openAdd()">+ Agregar firmante</button>';
            col.innerHTML = html;
        },

        _renderDocsCol(docs, data) {
            const col = document.getElementById('fdColRight');
            if (!col) return;

            const docsWithRoles = docs.map(function(doc, di) { return { doc: doc, di: di, roles: _docRoles(doc) }; })
                                      .filter(function(x) { return x.roles.length > 0; });

            if (!docsWithRoles.length) {
                const msg = !docs.length
                    ? '<p class="fd-no-docs-title">Sin documentos en el paquete</p><p class="fd-no-docs-sub">Generá documentos primero para asignar firmantes</p>'
                    : '<p class="fd-no-docs-title">Los documentos no tienen sección de firmas</p><p class="fd-no-docs-sub">Verificá que los documentos incluyan tabla-firmas-final</p>';
                col.innerHTML = '<div class="fd-no-docs"><div class="fd-no-docs-icon">📂</div>' + msg + '</div>';
                return;
            }

            const assignments = data.slotAssignments || [];

            col.innerHTML = '<div class="fd-col-hdr">Documentos del paquete (' + docsWithRoles.length + ')</div>'
                + docsWithRoles.map(function(item) {
                    const di    = item.di;
                    const roles = item.roles;
                    const docSignedCount = roles.filter(function(role) {
                        return assignments.find(function(a) { return a.docIdx === di && a.role === role && a.estado === 'firmado'; });
                    }).length;
                    const allSigned = docSignedCount === roles.length;

                    const slotsHtml = roles.map(function(role) {
                        const si = _slotMap.length;
                        _slotMap.push({ docIdx: di, role: role });

                        const asgn = assignments.find(function(a) { return a.docIdx === di && a.role === role && a.estado === 'firmado'; });
                        if (asgn) {
                            let sigHtml;
                            if (asgn.firmaImage) {
                                sigHtml = '<img src="' + asgn.firmaImage + '" class="fd-slot-sig-img" alt="firma">';
                            } else {
                                sigHtml = '<div class="fd-slot-sig-typed">' + _esc(asgn.firmaTexto || asgn.nombre) + '</div>';
                            }
                            const ts = new Date(asgn.firmadoAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                            return '<div class="fd-slot">' +
                                '<div class="fd-slot-role">' + _esc(role) + '</div>' +
                                '<div class="fd-slot-drop fd-signed">' +
                                    sigHtml +
                                    '<div class="fd-slot-sig-info">' +
                                        '<span class="fd-slot-sig-name">' + _esc(asgn.nombre) + '</span>' +
                                        '<span class="fd-slot-sig-fecha">' + ts + '</span>' +
                                    '</div>' +
                                    '<span class="fd-slot-check">✓</span>' +
                                    '<button class="fd-slot-clear" title="Quitar firma" onclick="FirmaDigital.clearSlot(' + si + ')">✕</button>' +
                                '</div>' +
                                '</div>';
                        } else {
                            return '<div class="fd-slot">' +
                                '<div class="fd-slot-role">' + _esc(role) + '</div>' +
                                '<div class="fd-slot-drop"' +
                                    ' ondragover="FirmaDigital._dragOver(event)"' +
                                    ' ondragleave="FirmaDigital._dragLeave(event)"' +
                                    ' ondrop="FirmaDigital._dropOnSlot(event,' + si + ')"' +
                                    ' onclick="FirmaDigital._clickSlot(' + si + ')">' +
                                    'Arrastrá firmante aquí' +
                                '</div>' +
                                '</div>';
                        }
                    }).join('');

                    const typeLabel = (item.doc.type || item.doc.docType) ? '<span class="fd-doc-type">' + _esc(item.doc.type || item.doc.docType) + '</span>' : '';
                    const progLabel = allSigned && roles.length > 0 ? '<span class="fd-doc-prog">✓ Completo</span>' : '';
                    return '<div class="fd-doc-block">' +
                        '<div class="fd-doc-head">' +
                            '<span class="fd-doc-name">' + _esc(_docTitle(item.doc, di)) + '</span>' +
                            typeLabel + progLabel +
                        '</div>' +
                        slotsHtml +
                        '</div>';
                }).join('');
        },

        // ── Dashboard de firmas pendientes ────────────────────────────

        renderSignatureDashboard() {
            const pid  = _getProjectId();
            const data = _load(pid);
            const docs = _getPackageDocs();
            const assignments = data.slotAssignments || [];

            // Build per-document pending list
            const pending = [];
            let totalDocs = 0, completeDocs = 0, totalSlots = 0, signedSlots = 0;

            docs.forEach(function(doc, di) {
                const roles = _docRoles(doc);
                if (!roles.length) return;
                totalDocs++;
                const missingRoles = roles.filter(function(role) {
                    return !assignments.find(function(a) {
                        return a.docIdx === di && a.role === role && a.estado === 'firmado';
                    });
                });
                const docSignedCount = roles.length - missingRoles.length;
                totalSlots  += roles.length;
                signedSlots += docSignedCount;
                if (!missingRoles.length) {
                    completeDocs++;
                } else {
                    pending.push({ di: di, title: _docTitle(doc, di), missingRoles: missingRoles });
                }
            });

            const pendingCount = totalDocs - completeDocs;
            const el = document.getElementById('fd-dashboard');
            if (!el) return;

            if (!totalDocs) {
                el.classList.add('fd-dash-hidden');
                el.innerHTML = '';
                return;
            }

            el.classList.remove('fd-dash-hidden');

            const badgePending = pendingCount > 0
                ? '<span class="fd-dash-badge-warn">&#9888; ' + pendingCount + ' pendiente' + (pendingCount !== 1 ? 's' : '') + '</span>'
                : '';
            const badgeOk = completeDocs > 0
                ? '<span class="fd-dash-badge-ok">&#10003; ' + completeDocs + ' completo' + (completeDocs !== 1 ? 's' : '') + '</span>'
                : '';

            const listRows = pending.map(function(item) {
                const pillsHtml = item.missingRoles.map(function(r) {
                    return '<span class="fd-dash-role-pill">' + _esc(r) + '</span>';
                }).join('');
                return '<div class="fd-dash-row">' +
                    '<span class="fd-dash-row-name" title="' + _esc(item.title) + '">' + _esc(item.title) + '</span>' +
                    '<span class="fd-dash-row-roles">' + pillsHtml + '</span>' +
                    '<button class="fd-dash-row-btn" onclick="FirmaDigital._scrollToDoc(' + item.di + ')">Ver &#8595;</button>' +
                    '</div>';
            }).join('');

            const hasDetails = pending.length > 0;
            const toggleBtn = hasDetails
                ? '<button class="fd-dash-toggle" id="fd-dash-toggle-btn" onclick="FirmaDigital._toggleDashList()">Detalle &#9660;</button>'
                : '';

            el.innerHTML =
                '<div class="fd-dash-summary">' +
                    '<span class="fd-dash-stat"><span class="fd-dash-stat-num">' + totalDocs + '</span><span class="fd-dash-stat-lbl">doc' + (totalDocs !== 1 ? 's' : '') + '</span></span>' +
                    '<span class="fd-dash-divider"></span>' +
                    badgePending +
                    badgeOk +
                    '<span class="fd-dash-divider"></span>' +
                    '<span class="fd-dash-stat"><span class="fd-dash-stat-num">' + signedSlots + '/' + totalSlots + '</span><span class="fd-dash-stat-lbl">slots firmados</span></span>' +
                    toggleBtn +
                '</div>' +
                (hasDetails ? '<div class="fd-dash-list fd-dash-list-hidden" id="fd-dash-list">' + listRows + '</div>' : '');
        },

        _toggleDashList() {
            const list = document.getElementById('fd-dash-list');
            const btn  = document.getElementById('fd-dash-toggle-btn');
            if (!list) return;
            const hidden = list.classList.toggle('fd-dash-list-hidden');
            if (btn) btn.innerHTML = hidden ? 'Detalle &#9660;' : 'Ocultar &#9650;';
        },

        _scrollToDoc(docIdx) {
            // Close the detail list first for clarity, then scroll in the right column
            const col = document.getElementById('fdColRight');
            if (!col) return;
            // Find the document block by scanning fd-doc-block elements by order in the DOM
            const docsWithRoles = (_getPackageDocs() || [])
                .map(function(doc, di) { return { di: di, hasRoles: _docRoles(doc).length > 0 }; })
                .filter(function(x) { return x.hasRoles; });
            const posInList = docsWithRoles.findIndex(function(x) { return x.di === docIdx; });
            if (posInList < 0) return;
            const blocks = col.querySelectorAll('.fd-doc-block');
            const target = blocks[posInList];
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Brief highlight
                target.style.transition = 'background .3s';
                target.style.background = '#E8F4FF';
                setTimeout(function() { target.style.background = ''; }, 900);
            }
        },

        // ── Drag & Drop ───────────────────────────────────────────────

        _dragStart(e, firmanteId) {
            _dragFirmanteId = firmanteId;
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', firmanteId);
            setTimeout(function() {
                const el = document.getElementById('fdfcard_' + firmanteId);
                if (el) el.classList.add('fd-dragging');
            }, 0);
        },

        _dragEnd(e) {
            const id = _dragFirmanteId;
            _dragFirmanteId = null;
            if (id) {
                const el = document.getElementById('fdfcard_' + id);
                if (el) el.classList.remove('fd-dragging');
            }
        },

        _dragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            e.currentTarget.classList.add('fd-drag-over');
        },

        _dragLeave(e) {
            e.currentTarget.classList.remove('fd-drag-over');
        },

        _dropOnSlot(e, slotIdx) {
            e.preventDefault();
            e.currentTarget.classList.remove('fd-drag-over');
            const fid = _dragFirmanteId || e.dataTransfer.getData('text/plain');
            _dragFirmanteId = null;
            if (!fid || !_slotMap[slotIdx]) return;
            const slot = _slotMap[slotIdx];
            this.openCapture(fid, slot.docIdx, slot.role);
        },

        _clickSlot(slotIdx) {
            if (!_slotMap[slotIdx]) return;
            const slot = _slotMap[slotIdx];
            this.openPicker(slot.docIdx, slot.role);
        },

        // ── Picker ────────────────────────────────────────────────────

        openPicker(docIdx, role) {
            _pendingPicker = { docIdx: docIdx, role: role };
            const sub = document.getElementById('fdpSub');
            if (sub) sub.textContent = role || '—';
            const pid  = _getProjectId();
            const data = _load(pid);
            const list = document.getElementById('fdPickerList');
            if (list) {
                if (!data.firmantes.length) {
                    list.innerHTML = '<p style="text-align:center;color:#B0BEC5;font-size:11px;padding:20px">Sin firmantes configurados</p>';
                } else {
                    list.innerHTML = data.firmantes.map(function(f) {
                        return '<div class="fdp-item" onclick="FirmaDigital._pickFirmante(\'' + f.id + '\')">' +
                            '<div class="fdp-av">' + _initials(f.nombre) + '</div>' +
                            '<div><p class="fdp-nm">' + _esc(f.nombre) + '</p><p class="fdp-rl">' + _esc(f.rol) + '</p></div>' +
                            '</div>';
                    }).join('');
                }
            }
            document.getElementById('fdPickerOverlay').classList.add('open');
        },

        closePicker() {
            document.getElementById('fdPickerOverlay')?.classList.remove('open');
            _pendingPicker = null;
        },

        _pickFirmante(firmanteId) {
            if (!_pendingPicker) return;
            const docIdx = _pendingPicker.docIdx;
            const role   = _pendingPicker.role;
            this.closePicker();
            this.openCapture(firmanteId, docIdx, role);
        },

        // ── Captura ───────────────────────────────────────────────────

        openCapture(firmanteId, docIdx, role) {
            const pid  = _getProjectId();
            const data = _load(pid);
            const f    = data.firmantes.find(function(x) { return x.id === firmanteId; });
            if (!f) return;

            _pendingSlot = { firmanteId: firmanteId, docIdx: docIdx, role: role };

            const docs = _getPackageDocs();
            const docTitleText = docs[docIdx] ? _docTitle(docs[docIdx], docIdx) : 'Documento';
            document.getElementById('fdcTitle').textContent = 'Firmando — ' + role;
            document.getElementById('fdcSub').textContent   = f.nombre + '  ·  ' + docTitleText;
            const certEl = document.getElementById('fdcCertText');
            if (certEl) {
                certEl.innerHTML = 'Al confirmar, <strong>' + _esc(f.nombre) + '</strong> certifica en calidad de <em>' + _esc(role) + '</em> que el contenido de <em>' + _esc(docTitleText) + '</em> es exacto y completo.';
            }
            document.getElementById('fdPinInput').value     = '';
            document.getElementById('fdPinErr').style.display = 'none';
            const tipoInput = document.getElementById('fdTipoInput');
            if (tipoInput) tipoInput.value = f.nombre;

            this._tab('manuscrita');
            this._clearCanvas();
            document.getElementById('fdCaptureOverlay').classList.add('open');
            this._initCanvas();
            setTimeout(function() {
                const pin = document.getElementById('fdPinInput');
                if (pin) pin.focus();
            }, 100);
        },

        closeCapture() {
            document.getElementById('fdCaptureOverlay')?.classList.remove('open');
            _pendingSlot = null;
        },

        _tab(t) {
            _captureTab = t;
            document.getElementById('fdTabManus').classList.toggle('active', t === 'manuscrita');
            document.getElementById('fdTabTipo').classList.toggle('active',  t === 'tipografica');
            document.getElementById('fdPanelManus').style.display = t === 'manuscrita' ? '' : 'none';
            document.getElementById('fdPanelTipo').style.display  = t === 'tipografica' ? '' : 'none';
        },

        _initCanvas() {
            const cv = document.getElementById('fdCanvas');
            if (!cv || cv._fdInited) return;
            cv._fdInited = true;
            const ctx = cv.getContext('2d');
            ctx.strokeStyle = '#1A2733'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            function pos(e) {
                const r  = cv.getBoundingClientRect();
                const sx = cv.width / r.width, sy = cv.height / r.height;
                const src = e.touches ? e.touches[0] : e;
                return [(src.clientX - r.left) * sx, (src.clientY - r.top) * sy];
            }
            const start = function(e) { e.preventDefault(); _drawing = true; const p = pos(e); _lx = p[0]; _ly = p[1]; };
            const move  = function(e) {
                if (!_drawing) return;
                e.preventDefault();
                const p = pos(e);
                ctx.beginPath(); ctx.moveTo(_lx, _ly); ctx.lineTo(p[0], p[1]); ctx.stroke();
                _lx = p[0]; _ly = p[1];
            };
            const stop = function() { _drawing = false; };
            cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move);
            cv.addEventListener('mouseup', stop); cv.addEventListener('mouseleave', stop);
            cv.addEventListener('touchstart', start, { passive: false });
            cv.addEventListener('touchmove',  move,  { passive: false });
            cv.addEventListener('touchend',   stop);
        },

        _clearCanvas() {
            const cv = document.getElementById('fdCanvas');
            if (!cv) return;
            cv._fdInited = false;
            cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
        },

        _canvasEmpty() {
            const cv = document.getElementById('fdCanvas');
            if (!cv) return true;
            return !cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data.some(function(v) { return v; });
        },

        // ── Submit firma ──────────────────────────────────────────────

        _submit() {
            if (!_pendingSlot) return;
            const firmanteId = _pendingSlot.firmanteId;
            const docIdx     = _pendingSlot.docIdx;
            const role       = _pendingSlot.role;

            const pin    = document.getElementById('fdPinInput').value;
            const pinErr = document.getElementById('fdPinErr');
            const pid    = _getProjectId();
            const data   = _load(pid);
            const f      = data.firmantes.find(function(x) { return x.id === firmanteId; });
            if (!f) return;

            if (_hashPin(pin) !== f.pinHash) {
                pinErr.style.display = 'block';
                document.getElementById('fdPinInput').value = '';
                document.getElementById('fdPinInput').focus();
                return;
            }
            pinErr.style.display = 'none';

            let firmaImage = null, firmaTexto = null;
            if (_captureTab === 'manuscrita') {
                if (this._canvasEmpty()) { alert('Dibujá tu firma antes de confirmar.'); return; }
                firmaImage = document.getElementById('fdCanvas').toDataURL('image/png');
            } else {
                firmaTexto = (document.getElementById('fdTipoInput').value || '').trim();
                if (!firmaTexto) { alert('Escribí tu nombre para la firma tipográfica.'); return; }
                firmaImage = _renderCursiveToImage(firmaTexto);
            }

            const firmadoAt = new Date().toISOString();

            // Certification statement (GxP — CFR 21 Part 11 §11.50)
            const certStatement = {
                nombre:      f.nombre,
                rol:         role,
                declaracion: 'Certifico en calidad de ' + role + ' que el contenido de este documento es exacto, completo y fue revisado conforme a los procedimientos aplicables.',
                fecha:       firmadoAt
            };

            // Update slot assignments
            data.slotAssignments = (data.slotAssignments || []).filter(function(a) {
                return !(a.docIdx === docIdx && a.role === role);
            });
            data.slotAssignments.push({
                docIdx: docIdx, role: role, firmanteId: firmanteId,
                nombre: f.nombre, firmaImage: firmaImage, firmaTexto: firmaTexto,
                firmaTipo: _captureTab, firmadoAt: firmadoAt, estado: 'firmado',
                certStatement: certStatement
            });

            // Mark firmante as signed (at least once)
            const fi = data.firmantes.findIndex(function(x) { return x.id === firmanteId; });
            if (fi >= 0) {
                data.firmantes[fi] = Object.assign({}, data.firmantes[fi], {
                    estado: 'firmado', firmaTipo: _captureTab, firmaImage: firmaImage, firmaTexto: firmaTexto, firmadoAt: firmadoAt
                });
            }

            _save(data);

            // Registrar firma en DocWorkflow (si está cargado)
            if (typeof DocWorkflow !== 'undefined') {
                const _docs = _getPackageDocs();
                const _doc  = _docs[docIdx];
                const _docId = (_doc && (_doc.id || _doc.type || _doc.docType)) || String(docIdx);
                const _fingerprint = _doc && _doc.data ? String(JSON.stringify(_doc.data).length) : null;
                DocWorkflow.registerSignature(_docId, pid, certStatement, _fingerprint);
            }

            const firmante = Object.assign({}, f, { firmadoAt: firmadoAt });
            _injectSignatureToDoc(firmante, docIdx, role, firmaImage);

            this.closeCapture();
            this._render();
        },

        clearSlot(slotIdx) {
            if (!_slotMap[slotIdx]) return;
            const docIdx = _slotMap[slotIdx].docIdx;
            const role   = _slotMap[slotIdx].role;
            const pid    = _getProjectId();
            const data   = _load(pid);
            data.slotAssignments = (data.slotAssignments || []).filter(function(a) {
                return !(a.docIdx === docIdx && a.role === role);
            });
            _save(data);
            this._render();
        },

        // ── Agregar firmante ──────────────────────────────────────────

        openAdd() {
            ['fdaName','fdaRol','fdaPin'].forEach(function(id) {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            document.getElementById('fdAddOverlay').classList.add('open');
            setTimeout(function() {
                const el = document.getElementById('fdaName');
                if (el) el.focus();
            }, 80);
        },

        closeAdd() { document.getElementById('fdAddOverlay')?.classList.remove('open'); },

        _confirmAdd() {
            const nombre = document.getElementById('fdaName').value.trim();
            const rol    = document.getElementById('fdaRol').value.trim();
            const pin    = document.getElementById('fdaPin').value;
            if (!nombre || !rol) { alert('Completá nombre y rol.'); return; }
            if (pin.length < 4)  { alert('El PIN debe tener al menos 4 caracteres.'); return; }
            const pid  = _getProjectId();
            const data = _load(pid);
            data.firmantes.push({
                id: 'fd_' + Date.now(), nombre: nombre, rol: rol,
                pinHash: _hashPin(pin), estado: 'pendiente',
                firmaImage: null, firmaTexto: null, firmaTipo: null, firmadoAt: null
            });
            _save(data);
            this.closeAdd();
            this._render();
        },

        // ── Asignación masiva ─────────────────────────────────────────

        _assignToAll(firmanteId) {
            const pid  = _getProjectId();
            const data = _load(pid);
            const f    = data.firmantes.find(function(x) { return x.id === firmanteId; });
            if (!f) return;

            if (!f.firmaImage) {
                if (typeof showNotification === 'function') {
                    showNotification('El firmante debe firmar primero para asignar en masa', 'warning');
                } else {
                    alert('El firmante debe firmar primero para asignar en masa.');
                }
                return;
            }

            const docs = _getPackageDocs();
            let count  = 0;

            docs.forEach(function(doc, docIdx) {
                const roles = _docRoles(doc);
                roles.forEach(function(role) {
                    if (role !== f.rol) return;
                    // Skip if this slot already has an assignment
                    const already = (data.slotAssignments || []).find(function(sa) {
                        return sa.docIdx === docIdx && sa.role === role;
                    });
                    if (already) return;

                    const docTitleText = _docTitle(doc, docIdx);
                    data.slotAssignments.push({
                        docIdx:      docIdx,
                        role:        role,
                        firmanteId:  f.id,
                        nombre:      f.nombre,
                        firmaImage:  f.firmaImage,
                        firmaTexto:  f.firmaTexto  || '',
                        firmaTipo:   f.firmaTipo   || 'tipografica',
                        firmadoAt:   f.firmadoAt   || new Date().toISOString(),
                        estado:      'firmado',
                        certStatement: {
                            nombre:      f.nombre,
                            rol:         f.rol,
                            declaracion: 'Certifico en calidad de ' + f.rol + ' que el contenido de ' + docTitleText + ' es exacto, completo y fue generado conforme a las BPD y la normativa aplicable.',
                            fecha:       f.firmadoAt || new Date().toISOString()
                        }
                    });

                    // Inject into doc structure
                    _injectSignatureToDoc(f, docIdx, role, f.firmaImage);
                    count++;
                });
            });

            _save(data);
            this._render();

            if (typeof showNotification === 'function') {
                if (count > 0) {
                    showNotification(count + ' documento' + (count !== 1 ? 's' : '') + ' asignado' + (count !== 1 ? 's' : '') + ' a ' + f.nombre);
                } else {
                    showNotification('Todos los slots de ' + f.rol + ' ya estaban asignados', 'warning');
                }
            } else {
                alert(count > 0
                    ? count + ' documento(s) asignado(s) a ' + f.nombre
                    : 'Todos los slots de ' + f.rol + ' ya estaban asignados.');
            }
        },

        // ── Exportar ──────────────────────────────────────────────────

        exportPackage() {
            const pid   = _getProjectId();
            const data  = _load(pid);
            const info  = _getProjectInfo();
            const docs  = _getPackageDocs();
            const slots = (data.slotAssignments || []).filter(function(a) { return a.estado === 'firmado'; });
            if (!slots.length) return;

            const lines = [
                'REGISTRO DE FIRMAS DIGITALES',
                'Proyecto: ' + info.name + (info.code ? ' (' + info.code + ')' : ''),
                'Cliente: ' + (info.client || '—'),
                'Exportado: ' + new Date().toLocaleString('es-AR'),
                '', '═'.repeat(50), '',
                ...slots.map(function(a) {
                    const docTitleText = docs[a.docIdx] ? _docTitle(docs[a.docIdx], a.docIdx) : ('Doc ' + a.docIdx);
                    const ts   = new Date(a.firmadoAt).toLocaleString('es-AR');
                    const tipo = a.firmaTipo === 'tipografica' ? 'Tipográfica' : 'Manuscrita';
                    return '[ FIRMADO ✓ ] ' + a.nombre + '\n  Rol: ' + a.role + '\n  Documento: ' + docTitleText + '\n  Tipo: ' + tipo + '\n  Fecha: ' + ts;
                }),
                '', '═'.repeat(50),
                'Verificar contra documentos del paquete.'
            ].join('\n');

            const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'firmas-' + (info.code || pid) + '-' + Date.now() + '.txt';
            a.click();
            URL.revokeObjectURL(a.href);
        }
    };

    global.FirmaDigital = FirmaDigital;
    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.FirmaDigital = FirmaDigital;

})(window);
