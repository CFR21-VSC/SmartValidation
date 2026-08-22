/* SetupWizard — Wizard de configuración inicial del cliente.
   Muestra en el primer uso cuando no hay organización configurada.
   Aplica branding del cliente en toda la UI via atributos data-config.
   API: SetupWizard.init() | .show() | .hide() | .applyConfig(config)    */

(function (root) {
    'use strict';

    var OVERLAY_ID = 'setupWizardOverlay';
    var _logoBase64 = null;

    // ── Estilos ──────────────────────────────────────────────────────────
    function _injectStyles() {
        if (document.getElementById('setupWizardStyles')) return;
        var s = document.createElement('style');
        s.id = 'setupWizardStyles';
        s.textContent = [
            '#setupWizardOverlay{position:fixed;inset:0;z-index:90000;background:rgba(8,20,35,0.97);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
            '#swCard{background:#13293D;border:1px solid rgba(102,178,235,0.2);border-radius:10px;padding:36px 40px;max-width:480px;width:90%;color:#E8F4FF}',
            '#swCard h2{margin:0 0 6px;font-size:20px;color:#66B2EB;font-weight:700}',
            '.sw-sub{font-size:13px;color:#8CA7BF;margin-bottom:28px}',
            '.sw-field{margin-bottom:18px}',
            '.sw-field label{display:block;font-size:12px;color:#8CA7BF;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}',
            '.sw-field input[type=text],.sw-field select{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(102,178,235,.25);border-radius:6px;padding:9px 12px;color:#E8F4FF;font-size:14px;box-sizing:border-box;outline:none;transition:border-color .2s}',
            '.sw-field input[type=text]:focus,.sw-field select:focus{border-color:rgba(102,178,235,.6)}',
            '.sw-field select option{background:#13293D}',
            '.sw-logo-row{display:flex;align-items:center;gap:14px}',
            '#swLogoPreview{width:60px;height:40px;object-fit:contain;border-radius:4px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);display:none}',
            '.sw-logo-btn{background:rgba(102,178,235,.12);border:1px solid rgba(102,178,235,.3);color:#66B2EB;border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer}',
            '.sw-logo-btn:hover{background:rgba(102,178,235,.22)}',
            '#swLogoClear{background:none;border:none;color:#8CA7BF;font-size:12px;cursor:pointer;display:none}',
            '.sw-error{color:#F08080;font-size:12px;margin-top:4px;display:none}',
            '.sw-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}',
            '.sw-btn-save{background:#2A7DB0;border:none;color:#fff;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;transition:background .2s}',
            '.sw-btn-save:hover{background:#3090C7}',
            '.sw-btn-skip{background:none;border:1px solid rgba(255,255,255,.15);color:#8CA7BF;padding:10px 18px;border-radius:6px;font-size:13px;cursor:pointer}'
        ].join('');
        document.head.appendChild(s);
    }

    // ── HTML del wizard ──────────────────────────────────────────────────
    function _buildHTML() {
        return '<div id="swCard">' +
            '<h2>Configuración de la Suite</h2>' +
            '<p class="sw-sub">Ingresá los datos de tu organización. Podés cambiarlos después desde Configuración.</p>' +
            '<div class="sw-field">' +
                '<label>Nombre de organización *</label>' +
                '<input type="text" id="swOrgName" placeholder="ej: Farméutica Norte S.A." maxlength="80">' +
                '<div class="sw-error" id="swOrgNameErr">El nombre es requerido.</div>' +
            '</div>' +
            '<div class="sw-field">' +
                '<label>Logo (opcional)</label>' +
                '<div class="sw-logo-row">' +
                    '<img id="swLogoPreview" src="" alt="Logo">' +
                    '<button type="button" class="sw-logo-btn" id="swLogoBtn">Subir imagen</button>' +
                    '<button type="button" id="swLogoClear">✕ Quitar</button>' +
                '</div>' +
                '<input type="file" id="swLogoFile" accept="image/*" style="display:none">' +
            '</div>' +
            '<div class="sw-field">' +
                '<label>Responsable de calidad</label>' +
                '<input type="text" id="swResponsable" placeholder="ej: Ing. Ana Martínez" maxlength="80">' +
            '</div>' +
            '<div class="sw-field">' +
                '<label>Regulación aplicable</label>' +
                '<select id="swRegulacion">' +
                    '<option>ANMAT 4159/2023 + GAMP 5</option>' +
                    '<option>FDA 21 CFR Part 11 + GAMP 5</option>' +
                    '<option>EMA + GAMP 5</option>' +
                    '<option>ISO 13485 + GAMP 5</option>' +
                    '<option>ANMAT + FDA 21 CFR Part 11 + GAMP 5</option>' +
                '</select>' +
            '</div>' +
            '<div class="sw-actions">' +
                '<button type="button" class="sw-btn-skip" id="swBtnSkip">Omitir por ahora</button>' +
                '<button type="button" class="sw-btn-save" id="swBtnSave">Guardar y continuar</button>' +
            '</div>' +
        '</div>';
    }

    // ── Eventos del wizard ───────────────────────────────────────────────
    function _bindEvents(overlay) {
        overlay.querySelector('#swLogoBtn').addEventListener('click', function () {
            overlay.querySelector('#swLogoFile').click();
        });

        overlay.querySelector('#swLogoFile').addEventListener('change', function () {
            var file = this.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                _logoBase64 = e.target.result;
                var prev = overlay.querySelector('#swLogoPreview');
                prev.src = _logoBase64;
                prev.style.display = 'block';
                overlay.querySelector('#swLogoClear').style.display = 'inline';
            };
            reader.readAsDataURL(file);
        });

        overlay.querySelector('#swLogoClear').addEventListener('click', function () {
            _logoBase64 = null;
            var prev = overlay.querySelector('#swLogoPreview');
            prev.src = '';
            prev.style.display = 'none';
            this.style.display = 'none';
            overlay.querySelector('#swLogoFile').value = '';
        });

        overlay.querySelector('#swBtnSave').addEventListener('click', function () {
            var nombre = overlay.querySelector('#swOrgName').value.trim();
            var errEl = overlay.querySelector('#swOrgNameErr');
            if (!nombre) {
                errEl.style.display = 'block';
                overlay.querySelector('#swOrgName').focus();
                return;
            }
            errEl.style.display = 'none';

            var config = {
                version: root.APP_VERSION || '1.0.0-beta',
                organizacion: {
                    nombre: nombre,
                    logo: _logoBase64,
                    responsable: overlay.querySelector('#swResponsable').value.trim(),
                    regulacion: overlay.querySelector('#swRegulacion').value
                }
            };

            if (root.ConfigStore) root.ConfigStore.save(config);
            applyConfig(config);
            hide();
        });

        overlay.querySelector('#swBtnSkip').addEventListener('click', hide);
    }

    // ── Aplicar config al DOM ────────────────────────────────────────────
    function applyConfig(config) {
        if (!config || !config.organizacion) return;
        var org = config.organizacion;

        // Elementos declarados con data-config="organizacion.nombre"
        document.querySelectorAll('[data-config="organizacion.nombre"]').forEach(function (el) {
            if (org.nombre) el.textContent = org.nombre;
        });

        // Título del documento
        if (org.nombre) {
            document.title = 'Validation Suite | ' + org.nombre;
        }

        // Logo en documentos (document-renderer.js usa VS.templateBase)
        if (org.logo) {
            var VS = root.ValidationSuite;
            if (VS && VS.templateBase && typeof VS.templateBase.setLogoDataUrl === 'function') {
                VS.templateBase.setLogoDataUrl(org.logo);
            }
        }
    }

    // ── Mostrar wizard ───────────────────────────────────────────────────
    function show(prefill) {
        var existing = document.getElementById(OVERLAY_ID);
        if (existing) existing.remove();
        _logoBase64 = null;

        _injectStyles();
        var overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = _buildHTML();
        document.body.appendChild(overlay);
        _bindEvents(overlay);

        // Pre-rellenar si se pasa config existente (modo edición)
        if (prefill && prefill.organizacion) {
            var org = prefill.organizacion;
            if (org.nombre) overlay.querySelector('#swOrgName').value = org.nombre;
            if (org.responsable) overlay.querySelector('#swResponsable').value = org.responsable;
            if (org.regulacion) overlay.querySelector('#swRegulacion').value = org.regulacion;
            if (org.logo) {
                _logoBase64 = org.logo;
                var prev = overlay.querySelector('#swLogoPreview');
                prev.src = org.logo;
                prev.style.display = 'block';
                overlay.querySelector('#swLogoClear').style.display = 'inline';
            }
        }
    }

    // ── Ocultar wizard ───────────────────────────────────────────────────
    function hide() {
        var overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.remove();
    }

    // ── Init — llamar una vez al cargar la app ───────────────────────────
    function init() {
        var config = root.ConfigStore ? root.ConfigStore.load() : null;
        if (config) applyConfig(config);
        if (!root.ConfigStore || !root.ConfigStore.isConfigured()) {
            show();
        }
    }

    root.SetupWizard = { init: init, show: show, hide: hide, applyConfig: applyConfig };

})(typeof window !== 'undefined' ? window : global);
