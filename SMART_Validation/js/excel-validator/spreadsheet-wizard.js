'use strict';

/* ====================================================================
   SPREADSHEET VALIDATION WIZARD
   Modal para subir una planilla Excel, analizar su estructura,
   completar contexto GxP y generar EVRA → EVPROT → EVIR via IA.
   ==================================================================== */

(function (global) {

    let _modal = null;
    let _analysis = null;    // SpreadsheetAnalysis from ExcelParser
    let _userCtx = {};       // Department, purpose, etc. filled by user

    // ── CSS ──────────────────────────────────────────────────────────────
    const CSS = `
#modalSpreadsheetWizard { display:none; position:fixed; inset:0; z-index:9100; background:rgba(0,0,0,.55); }
#modalSpreadsheetWizard .sw-dialog {
    position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    background:#fff; border-radius:10px; width:680px; max-width:96vw;
    max-height:88vh; overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,.22);
    display:flex; flex-direction:column;
}
.sw-header { padding:20px 24px 14px; border-bottom:1px solid #E8ECF0; display:flex; align-items:center; gap:12px; }
.sw-header h2 { font-size:17px; font-weight:700; color:#1A2B4A; margin:0; flex:1; }
.sw-header .sw-close { background:none; border:none; font-size:22px; cursor:pointer; color:#888; padding:0 4px; }
.sw-body { padding:24px; flex:1; }
.sw-step { display:none; }
.sw-step.active { display:block; }
.sw-label { font-size:13px; font-weight:600; color:#1A2B4A; margin-bottom:6px; display:block; }
.sw-sublabel { font-size:11px; color:#666; margin-top:-4px; margin-bottom:10px; }
.sw-input, .sw-select, .sw-textarea {
    width:100%; padding:9px 12px; border:1px solid #D0D8E4; border-radius:6px;
    font-size:13px; color:#1A2B4A; margin-bottom:14px; box-sizing:border-box;
}
.sw-textarea { min-height:72px; resize:vertical; }
.sw-drop-zone {
    border:2px dashed #C8D5E8; border-radius:10px; padding:32px 24px;
    text-align:center; cursor:pointer; transition:.2s; margin-bottom:14px;
    background:#F8FAFC;
}
.sw-drop-zone:hover, .sw-drop-zone.drag-over { border-color:#2563EB; background:#EFF6FF; }
.sw-drop-zone .sw-drop-icon { font-size:36px; margin-bottom:10px; }
.sw-drop-zone p { margin:4px 0; font-size:13px; color:#555; }
.sw-drop-zone .sw-hint { font-size:11px; color:#888; margin-top:6px; }
.sw-file-picked { display:flex; align-items:center; gap:10px; background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:12px 14px; margin-bottom:14px; }
.sw-file-picked .sw-file-icon { font-size:24px; }
.sw-file-picked .sw-file-info strong { font-size:13px; color:#14532D; }
.sw-file-picked .sw-file-info span { font-size:11px; color:#166534; display:block; }
.sw-analysis-box { background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:14px; margin-bottom:14px; font-size:12px; white-space:pre-line; color:#334155; line-height:1.7; }
.sw-sheets-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
.sw-sheet-card { border:1px solid #E2E8F0; border-radius:8px; padding:12px; }
.sw-sheet-card .sw-sheet-name { font-size:12px; font-weight:700; color:#1A2B4A; margin-bottom:6px; }
.sw-sheet-card .sw-sheet-meta { font-size:11px; color:#666; }
.sw-sheet-card.critical { border-color:#BFDBFE; background:#EFF6FF; }
.sw-sheet-card.critical .sw-sheet-name { color:#1D4ED8; }
.sw-flags { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
.sw-flag { padding:4px 10px; border-radius:999px; font-size:11px; font-weight:600; }
.sw-flag.ok { background:#DCFCE7; color:#15803D; }
.sw-flag.warn { background:#FEF3C7; color:#92400E; }
.sw-flag.danger { background:#FEE2E2; color:#991B1B; }
.sw-footer { padding:16px 24px; border-top:1px solid #E8ECF0; display:flex; gap:10px; justify-content:flex-end; background:#FAFBFC; border-radius:0 0 10px 10px; }
.sw-btn { padding:9px 20px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; border:none; }
.sw-btn-secondary { background:#F1F5F9; color:#334155; }
.sw-btn-secondary:hover { background:#E2E8F0; }
.sw-btn-primary { background:#2563EB; color:#fff; }
.sw-btn-primary:hover { background:#1D4ED8; }
.sw-btn-primary:disabled { background:#93C5FD; cursor:not-allowed; }
.sw-progress { display:flex; align-items:center; gap:0; margin-bottom:24px; }
.sw-step-dot { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; }
.sw-step-dot.done { background:#2563EB; color:#fff; }
.sw-step-dot.active { background:#2563EB; color:#fff; box-shadow:0 0 0 4px #BFDBFE; }
.sw-step-dot.pending { background:#E2E8F0; color:#94A3B8; }
.sw-step-line { flex:1; height:2px; background:#E2E8F0; }
.sw-step-line.done { background:#2563EB; }
.sw-doc-card { border:1px solid #E2E8F0; border-radius:8px; padding:14px; margin-bottom:10px; cursor:pointer; transition:.15s; }
.sw-doc-card:hover { border-color:#2563EB; background:#EFF6FF; }
.sw-doc-card.generating { border-color:#F59E0B; background:#FFFBEB; cursor:wait; }
.sw-doc-card.done { border-color:#86EFAC; background:#F0FDF4; }
.sw-doc-card h4 { font-size:13px; font-weight:700; margin:0 0 4px; color:#1A2B4A; }
.sw-doc-card p { font-size:11px; color:#666; margin:0; }
.sw-doc-card .sw-doc-status { font-size:11px; font-weight:600; float:right; }
.sw-generating-spinner { display:inline-block; width:14px; height:14px; border:2px solid #F59E0B; border-top-color:transparent; border-radius:50%; animation:sw-spin .7s linear infinite; margin-right:6px; }
@keyframes sw-spin { to { transform:rotate(360deg); } }
.sw-row { display:flex; gap:14px; }
.sw-row > * { flex:1; }
`;

    // ── HTML ─────────────────────────────────────────────────────────────
    function buildHTML() {
        return `
<div id="modalSpreadsheetWizard">
  <div class="sw-dialog">
    <div class="sw-header">
      <span style="font-size:24px;">📊</span>
      <h2>Validación de Planilla de Cálculo</h2>
      <button class="sw-close" onclick="SpreadsheetWizard.close()">×</button>
    </div>
    <div class="sw-body">
      <!-- Progress bar -->
      <div class="sw-progress">
        <div class="sw-step-dot done" id="swDot1">1</div>
        <div class="sw-step-line" id="swLine1"></div>
        <div class="sw-step-dot pending" id="swDot2">2</div>
        <div class="sw-step-line" id="swLine2"></div>
        <div class="sw-step-dot pending" id="swDot3">3</div>
        <div class="sw-step-line" id="swLine3"></div>
        <div class="sw-step-dot pending" id="swDot4">4</div>
      </div>

      <!-- STEP 1: Upload -->
      <div class="sw-step active" id="swStep1">
        <label class="sw-label">1. Seleccioná la planilla Excel a validar</label>
        <div class="sw-drop-zone" id="swDropZone">
          <div class="sw-drop-icon">📂</div>
          <p><strong>Arrastrá tu planilla aquí</strong> o hacé clic para seleccionar</p>
          <p class="sw-hint">Soportado: .xlsx · Máx. 20 MB</p>
        </div>
        <div id="swFilePicked" style="display:none" class="sw-file-picked">
          <span class="sw-file-icon">📊</span>
          <div class="sw-file-info">
            <strong id="swFileName"></strong>
            <span id="swFileMeta"></span>
          </div>
        </div>
        <input type="file" id="swFileInput" accept=".xlsx" style="display:none">
      </div>

      <!-- STEP 2: Analysis + context -->
      <div class="sw-step" id="swStep2">
        <label class="sw-label">2. Análisis de la planilla</label>
        <div class="sw-analysis-box" id="swAnalysisSummary"></div>

        <div id="swSheetsGrid" class="sw-sheets-grid"></div>
        <div id="swFlags" class="sw-flags"></div>

        <label class="sw-label">Propósito GxP de la planilla <span style="color:#E53E3E">*</span></label>
        <p class="sw-sublabel">¿Para qué se usa en el proceso regulado? (ej: "Cálculo de rendimiento de lote de fabricación")</p>
        <textarea class="sw-textarea" id="swPurpose" placeholder="Describe el propósito GxP de la planilla..."></textarea>

        <div class="sw-row">
          <div>
            <label class="sw-label">Departamento responsable</label>
            <input class="sw-input" id="swDepartment" placeholder="ej: Producción, QC, QA...">
          </div>
          <div>
            <label class="sw-label">Cargo del responsable</label>
            <input class="sw-input" id="swResponsible" placeholder="ej: Jefe de Producción">
          </div>
        </div>

        <div class="sw-row">
          <div>
            <label class="sw-label">Frecuencia de uso</label>
            <input class="sw-input" id="swFrequency" placeholder="ej: Por lote, Diario, Mensual">
          </div>
          <div>
            <label class="sw-label">Versión de la planilla</label>
            <input class="sw-input" id="swVersion" placeholder="ej: v1.0">
          </div>
        </div>

        <label class="sw-label">Ubicación del archivo</label>
        <input class="sw-input" id="swLocation" placeholder="ej: \\\\servidor\\planillas\\produccion\\">

        <label class="sw-label">Categoría GAMP 5</label>
        <select class="sw-select" id="swGampCategory">
          <option value="Cat 4">Categoría 4 — Herramienta configurada (más común)</option>
          <option value="Cat 3">Categoría 3 — No configurada</option>
        </select>
      </div>

      <!-- STEP 3: Generate docs -->
      <div class="sw-step" id="swStep3">
        <label class="sw-label">3. Generación de documentos de validación</label>
        <p style="font-size:12px; color:#555; margin-bottom:16px;">
          Hacé clic en cada documento para generarlo con IA. El orden recomendado es EVRA → EVPROT → EVIR.
        </p>

        <div class="sw-doc-card" id="swCardEVRA" onclick="SpreadsheetWizard.generateDoc('EVRA')">
          <h4>📋 EVRA — Evaluación de Riesgo</h4>
          <p>Identifica y evalúa los riesgos de la planilla según GAMP 5. Primer documento del ciclo.</p>
          <span class="sw-doc-status" id="swStatusEVRA">Pendiente</span>
        </div>
        <div class="sw-doc-card" id="swCardEVPROT" onclick="SpreadsheetWizard.generateDoc('EVPROT')">
          <h4>🧪 EVPROT — Protocolo de Validación</h4>
          <p>Casos de prueba para verificar integridad de fórmulas, acceso y versión.</p>
          <span class="sw-doc-status" id="swStatusEVPROT">Pendiente</span>
        </div>
        <div class="sw-doc-card" id="swCardEVIR" onclick="SpreadsheetWizard.generateDoc('EVIR')">
          <h4>✅ EVIR — Informe de Validación</h4>
          <p>Documento de cierre con resultados de ejecución y estado final (APROBADA / NO APROBADA).</p>
          <span class="sw-doc-status" id="swStatusEVIR">Pendiente</span>
        </div>
      </div>

      <!-- STEP 4: Done -->
      <div class="sw-step" id="swStep4">
        <div style="text-align:center; padding:24px 0;">
          <div style="font-size:52px; margin-bottom:16px;">✅</div>
          <h3 style="font-size:18px; color:#1A2B4A; margin-bottom:8px;">Documentos generados</h3>
          <p style="font-size:13px; color:#555; max-width:380px; margin:0 auto 20px;">
            Los documentos EVRA, EVPROT y EVIR se guardaron en el proyecto activo.
            Podés revisarlos y firmarlos desde la Suite de Validación.
          </p>
          <button class="sw-btn sw-btn-primary" onclick="SpreadsheetWizard.openSuite()">
            Abrir en Suite de Validación
          </button>
        </div>
      </div>
    </div>

    <div class="sw-footer" id="swFooter">
      <button class="sw-btn sw-btn-secondary" id="swBtnBack" onclick="SpreadsheetWizard.back()" style="display:none">← Atrás</button>
      <button class="sw-btn sw-btn-primary" id="swBtnNext" onclick="SpreadsheetWizard.next()">Siguiente →</button>
    </div>
  </div>
</div>`;
    }

    // ── State & navigation ────────────────────────────────────────────────
    let _currentStep = 1;
    const TOTAL_STEPS = 4;

    function goToStep(n) {
        for (let i = 1; i <= TOTAL_STEPS; i++) {
            const el = document.getElementById(`swStep${i}`);
            if (el) el.classList.toggle('active', i === n);

            const dot = document.getElementById(`swDot${i}`);
            if (dot) {
                dot.className = 'sw-step-dot ' + (i < n ? 'done' : i === n ? 'active' : 'pending');
            }
            if (i < TOTAL_STEPS) {
                const line = document.getElementById(`swLine${i}`);
                if (line) line.classList.toggle('done', i < n);
            }
        }
        _currentStep = n;

        const btnBack = document.getElementById('swBtnBack');
        const btnNext = document.getElementById('swBtnNext');
        const footer  = document.getElementById('swFooter');

        if (btnBack) btnBack.style.display = n > 1 && n < TOTAL_STEPS ? 'block' : 'none';
        if (btnNext) {
            btnNext.style.display = n < TOTAL_STEPS ? 'block' : 'none';
            btnNext.textContent = n === TOTAL_STEPS - 1 ? 'Finalizar' : 'Siguiente →';
        }
        if (footer) footer.style.display = n === TOTAL_STEPS ? 'none' : 'flex';
    }

    // ── Drop zone setup ───────────────────────────────────────────────────
    function initDropZone() {
        const dz = document.getElementById('swDropZone');
        const fi = document.getElementById('swFileInput');
        if (!dz || !fi) return;

        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', e => {
            e.preventDefault();
            dz.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
        });
        fi.addEventListener('change', e => {
            if (e.target.files[0]) handleFile(e.target.files[0]);
        });
    }

    async function handleFile(file) {
        if (!file.name.endsWith('.xlsx')) {
            alert('Solo se admiten archivos .xlsx');
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            alert('El archivo supera los 20 MB');
            return;
        }

        document.getElementById('swFileName').textContent = file.name;
        document.getElementById('swFileMeta').textContent = Math.round(file.size / 1024) + ' KB';
        document.getElementById('swDropZone').style.display = 'none';
        document.getElementById('swFilePicked').style.display = 'flex';

        try {
            _analysis = await ExcelParser.parse(file);
        } catch (err) {
            alert('Error al analizar el archivo: ' + err.message);
            resetUpload();
        }
    }

    function resetUpload() {
        document.getElementById('swDropZone').style.display = 'block';
        document.getElementById('swFilePicked').style.display = 'none';
        _analysis = null;
    }

    function renderStep2() {
        if (!_analysis) return;

        // Summary box
        document.getElementById('swAnalysisSummary').textContent = _analysis.summary;

        // Sheets grid
        const grid = document.getElementById('swSheetsGrid');
        grid.innerHTML = _analysis.sheets.map(s => `
            <div class="sw-sheet-card ${s.isCritical ? 'critical' : ''}">
                <div class="sw-sheet-name">${s.isCritical ? '⚠️ ' : ''}${s.name}</div>
                <div class="sw-sheet-meta">${s.formulaCount} fórmulas${s.hasProtection ? ' · protegida' : ''}</div>
            </div>
        `).join('');

        // Flags
        const flags = document.getElementById('swFlags');
        const flagDefs = [
            { label: _analysis.hasVBA ? '⚠️ Tiene VBA' : '✓ Sin VBA', cls: _analysis.hasVBA ? 'warn' : 'ok' },
            { label: _analysis.hasExternalLinks ? '⚠️ Vínculos externos' : '✓ Sin vínculos externos', cls: _analysis.hasExternalLinks ? 'warn' : 'ok' },
            { label: _analysis.hasProtection ? '✓ Hojas protegidas' : '⚠️ Sin protección', cls: _analysis.hasProtection ? 'ok' : 'warn' },
        ];
        flags.innerHTML = flagDefs.map(f => `<span class="sw-flag ${f.cls}">${f.label}</span>`).join('');
    }

    function collectUserContext() {
        _userCtx = {
            purpose:      document.getElementById('swPurpose')?.value.trim() || '',
            department:   document.getElementById('swDepartment')?.value.trim() || '',
            responsible:  document.getElementById('swResponsible')?.value.trim() || '',
            frequency:    document.getElementById('swFrequency')?.value.trim() || '',
            version:      document.getElementById('swVersion')?.value.trim() || 'v1.0',
            location:     document.getElementById('swLocation')?.value.trim() || '',
            gampCategory: document.getElementById('swGampCategory')?.value || 'Cat 4'
        };
    }

    // ── AI Document generation ────────────────────────────────────────────
    const _generatedDocs = {};

    async function generateDoc(docType) {
        if (!_analysis) return;
        collectUserContext();

        const card   = document.getElementById(`swCard${docType}`);
        const status = document.getElementById(`swStatus${docType}`);

        card.className = 'sw-doc-card generating';
        status.innerHTML = '<span class="sw-generating-spinner"></span>Generando...';

        try {
            const VS = global.ValidationSuite;
            const SL = VS && VS.AIGenerator && VS.AIGenerator.SkillLoader;
            const AC = VS && VS.AIGenerator && VS.AIGenerator.ApiClient;
            if (!SL || !AC) throw new Error('AI Generator no está cargado');

            const skillKey = docType.toLowerCase();

            // Load skill + lessons
            const [skill, lessons] = await Promise.all([
                SL.loadSkill ? SL.loadSkill(skillKey) : fetch(`claude-desktop-skills/${skillKey}-generator.md`).then(r => r.text()),
                SL.loadLessonsLearned ? SL.loadLessonsLearned() : Promise.resolve('')
            ]);

            const systemPrompt = lessons
                ? skill + '\n\n---\n\n# LECCIONES APRENDIDAS\n\n' + lessons
                : skill;

            // Build user prompt — include previous docs as context if available
            let contextDocs = '';
            if (docType === 'EVPROT' && _generatedDocs['EVRA']) {
                contextDocs = `\n\n## EVRA aprobado (usar como base)\n\`\`\`json\n${JSON.stringify(_generatedDocs['EVRA'], null, 2)}\n\`\`\``;
            } else if (docType === 'EVIR' && _generatedDocs['EVPROT']) {
                contextDocs = `\n\n## EVPROT ejecutado (copiar TCs con resultados)\n\`\`\`json\n${JSON.stringify(_generatedDocs['EVPROT'], null, 2)}\n\`\`\``;
            }

            const userPrompt = ExcelParser.buildAIPrompt(_analysis, _userCtx, docType) + contextDocs;

            const raw = await AC.generate({ systemPrompt, userPrompt });

            // Parse JSON from AI response
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('La IA no devolvió un JSON válido');
            const docJson = JSON.parse(jsonMatch[0]);

            _generatedDocs[docType] = docJson;

            // Save to active project
            await _saveToProject(docType, docJson);

            card.className = 'sw-doc-card done';
            status.innerHTML = '✅ Generado';
        } catch (err) {
            console.error(`[SpreadsheetWizard] Error generando ${docType}:`, err);
            card.className = 'sw-doc-card';
            status.innerHTML = '❌ Error: ' + err.message;
        }
    }

    async function _saveToProject(docType, docJson) {
        // Reuse the existing project save mechanism
        const save = global.saveDocumentToProject || (global.SuiteManager && global.SuiteManager.saveDoc);
        if (typeof save === 'function') {
            await save(docType, docJson);
            return;
        }

        // Fallback: find active project and POST via API
        const projId = global._activeProjectId || (global.getActiveProjectId && global.getActiveProjectId());
        if (!projId) {
            console.warn('[SpreadsheetWizard] No se encontró proyecto activo — guardado omitido');
            return;
        }

        const resp = await fetch(`/api/projects/${projId}/documents/${docType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: docType, data: docJson }),
            credentials: 'include'
        });
        if (!resp.ok) throw new Error(`Error guardando ${docType}: HTTP ${resp.status}`);
    }

    // ── Public API ────────────────────────────────────────────────────────
    const SpreadsheetWizard = {

        init() {
            if (document.getElementById('modalSpreadsheetWizard')) return;

            // Inject CSS
            if (!document.getElementById('swCSS')) {
                const style = document.createElement('style');
                style.id = 'swCSS';
                style.textContent = CSS;
                document.head.appendChild(style);
            }

            // Inject HTML
            const div = document.createElement('div');
            div.innerHTML = buildHTML();
            document.body.appendChild(div.firstElementChild);

            _modal = document.getElementById('modalSpreadsheetWizard');

            // Close on backdrop click
            _modal.addEventListener('click', e => { if (e.target === _modal) this.close(); });

            initDropZone();
        },

        open() {
            this.init();
            _analysis = null;
            _userCtx = {};
            Object.keys(_generatedDocs).forEach(k => delete _generatedDocs[k]);
            goToStep(1);
            resetUpload();
            _modal.style.display = 'block';
        },

        close() {
            if (_modal) _modal.style.display = 'none';
        },

        next() {
            if (_currentStep === 1) {
                if (!_analysis) { alert('Primero seleccioná una planilla Excel (.xlsx)'); return; }
                renderStep2();
                goToStep(2);
            } else if (_currentStep === 2) {
                if (!document.getElementById('swPurpose')?.value.trim()) {
                    alert('El propósito GxP es obligatorio');
                    return;
                }
                collectUserContext();
                goToStep(3);
            } else if (_currentStep === 3) {
                const allDone = ['EVRA', 'EVPROT', 'EVIR'].every(t => _generatedDocs[t]);
                if (!allDone) {
                    if (!confirm('No todos los documentos fueron generados. ¿Continuar de todas formas?')) return;
                }
                goToStep(4);
            }
        },

        back() {
            if (_currentStep > 1 && _currentStep < TOTAL_STEPS) goToStep(_currentStep - 1);
        },

        generateDoc,

        openSuite() {
            this.close();
            if (typeof global.openValidationSuite === 'function') {
                global.openValidationSuite();
            }
        }
    };

    global.SpreadsheetWizard = SpreadsheetWizard;

})(typeof window !== 'undefined' ? window : global);
