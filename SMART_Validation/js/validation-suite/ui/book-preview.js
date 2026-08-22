/* ====================================================================
   BOOK PREVIEW & LOADING UX
   Maneja:
     1) Modal de loading con spinner + pasos animados durante la compilación
     2) Modal de previsualización inline del libro vía iframe + blob URL

   API:
     ValidationSuite.bookLoading.show()  → muestra modal con todos los pasos pendientes
     ValidationSuite.bookLoading.step(stepId, subtext)  → marca el paso como activo
                                                          (los anteriores se marcan done)
     ValidationSuite.bookLoading.hide()  → cierra el modal

     ValidationSuite.bookPreview.openWithDocDef(docDef, fileName)  → genera blob + muestra iframe
     ValidationSuite.bookPreview.download()  → descarga el blob actual
     ValidationSuite.bookPreview.close()     → cierra el modal y libera el blob URL
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};

    // ============================================================
    // LOADING
    // ============================================================
    VS.bookLoading = VS.bookLoading || {};

    const STEPS_ORDER = ['prep', 'prelim', 'indice', 'tomo1', 'tomo2', 'pdf'];

    function getModal() { return document.getElementById('modalBookGenerating'); }
    function getStepEl(stepId) { return document.querySelector(`#bookGenSteps .book-step[data-step="${stepId}"]`); }

    VS.bookLoading.show = function () {
        const m = getModal();
        if (!m) return;
        // Reset todos los pasos
        STEPS_ORDER.forEach(s => {
            const el = getStepEl(s);
            if (el) {
                el.classList.remove('done', 'active');
                const icon = el.querySelector('.bs-icon');
                if (icon) icon.textContent = String(STEPS_ORDER.indexOf(s) + 1);
            }
        });
        const sub = document.getElementById('bookGenSubtext');
        if (sub) sub.textContent = 'Iniciando compilación...';
        m.style.display = 'flex';
    };

    VS.bookLoading.step = function (stepId, subtext) {
        const idx = STEPS_ORDER.indexOf(stepId);
        if (idx < 0) return;
        STEPS_ORDER.forEach((s, i) => {
            const el = getStepEl(s);
            if (!el) return;
            el.classList.remove('active');
            const icon = el.querySelector('.bs-icon');
            if (i < idx) {
                el.classList.add('done');
                if (icon) icon.textContent = '✓';
            } else if (i === idx) {
                el.classList.remove('done');
                el.classList.add('active');
                if (icon) icon.textContent = String(i + 1);
            } else {
                el.classList.remove('done');
                if (icon) icon.textContent = String(i + 1);
            }
        });
        if (subtext) {
            const sub = document.getElementById('bookGenSubtext');
            if (sub) sub.textContent = subtext;
        }
    };

    VS.bookLoading.markAllDone = function () {
        STEPS_ORDER.forEach((s, i) => {
            const el = getStepEl(s);
            if (!el) return;
            el.classList.remove('active');
            el.classList.add('done');
            const icon = el.querySelector('.bs-icon');
            if (icon) icon.textContent = '✓'; // checkmark unicode
        });
    };

    VS.bookLoading.hide = function () {
        const m = getModal();
        if (m) m.style.display = 'none';
    };

    /** Da el browser un tick para repintar el DOM. pdfMake bloquea el thread
     *  durante createPdf, así que entre fases lógicas hacemos `await yield()`
     *  para que el modal de loading se vea responsivo. */
    VS.bookLoading.yield = function () {
        return new Promise(r => setTimeout(r, 30));
    };

    // ============================================================
    // PREVIEW
    // ============================================================
    VS.bookPreview = VS.bookPreview || {};
    let _currentBlobUrl = null;
    let _currentBlob = null;
    let _currentFileName = 'libro-validacion.pdf';

    /** Recibe un blob ya generado y abre el preview con iframe. Más eficiente
     *  que openWithDocDef (que generaría el PDF de nuevo). */
    VS.bookPreview.attachBlob = function (blob, fileName, meta, opts) {
        opts = opts || {};
        _currentFileName = fileName || 'libro-validacion.pdf';
        if (_currentBlobUrl) {
            URL.revokeObjectURL(_currentBlobUrl);
            _currentBlobUrl = null;
        }
        _currentBlob = blob;
        _currentBlobUrl = URL.createObjectURL(blob);
        const iframe = document.getElementById('bookPreviewIframe');
        if (iframe) iframe.src = _currentBlobUrl + '#toolbar=1&navpanes=0';
        const metaEl = document.getElementById('bookPreviewMeta');
        if (metaEl) {
            metaEl.textContent = meta && meta.totalDocs
                ? `${meta.totalDocs} docs · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`
                : `${(blob.size / (1024 * 1024)).toFixed(1)} MB`;
        }
        // Título dinámico según tomo
        const titleEl = document.querySelector('#modalBookPreview h3');
        if (titleEl) {
            if (opts.tomo === 1) titleEl.textContent = 'Vista Previa — Libro Tomo I (Ciclo de Validación)';
            else if (opts.tomo === 2) titleEl.textContent = 'Vista Previa — Libro Tomo II (Anexos de Ejecución)';
            else titleEl.textContent = 'Vista Previa del Libro de Validación (completo)';
        }
        const modal = document.getElementById('modalBookPreview');
        if (modal) modal.style.display = 'flex';
    };

    /** Abre el modal de preview con un docDefinition de pdfMake. */
    VS.bookPreview.openWithDocDef = function (docDef, fileName, meta) {
        if (typeof pdfMake === 'undefined') {
            alert('pdfMake no está cargado.');
            return Promise.reject(new Error('pdfMake missing'));
        }
        _currentFileName = fileName || 'libro-validacion.pdf';
        return new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(docDef).getBlob(blob => {
                    if (_currentBlobUrl) {
                        URL.revokeObjectURL(_currentBlobUrl);
                        _currentBlobUrl = null;
                    }
                    _currentBlob = blob;
                    _currentBlobUrl = URL.createObjectURL(blob);
                    const iframe = document.getElementById('bookPreviewIframe');
                    if (iframe) iframe.src = _currentBlobUrl + '#toolbar=1&navpanes=0';
                    const metaEl = document.getElementById('bookPreviewMeta');
                    if (metaEl) {
                        metaEl.textContent = meta
                            ? `${meta.totalDocs || '?'} docs · ${(blob.size / (1024*1024)).toFixed(1)} MB`
                            : `${(blob.size / (1024*1024)).toFixed(1)} MB`;
                    }
                    const modal = document.getElementById('modalBookPreview');
                    if (modal) modal.style.display = 'flex';
                    resolve(blob);
                });
            } catch (e) {
                reject(e);
            }
        });
    };

    VS.bookPreview.download = function () {
        if (!_currentBlob) {
            alert('No hay PDF cargado para descargar.');
            return;
        }
        // Trigger descarga usando FileSaver si está disponible, sino link anchor
        if (typeof saveAs === 'function') {
            saveAs(_currentBlob, _currentFileName);
        } else {
            const a = document.createElement('a');
            a.href = _currentBlobUrl;
            a.download = _currentFileName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 100);
        }
    };

    /** Adjunta el PDF actual a la carpeta del proyecto activo (IndexedDB).
     *  Queda disponible para incluirse en el ZIP regulatorio. */
    VS.bookPreview.attachToProject = async function () {
        if (!_currentBlob) { alert('No hay PDF para adjuntar.'); return; }
        if (!VS.projectFolder || typeof VS.projectFolder.attachBlob !== 'function') {
            alert('El módulo de carpeta de proyecto no está disponible.');
            return;
        }
        let active = null;
        try {
            if (VS.projects && typeof VS.projects.getActive === 'function') {
                active = await VS.projects.getActive();
            }
        } catch (e) { /* silencioso */ }

        if (!active) {
            alert('No hay proyecto activo. Abrí o creá uno desde Suite Proyectos primero.');
            return;
        }

        const btn = document.getElementById('bookAttachBtn');
        const prevLabel = btn ? btn.innerHTML : null;
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Adjuntando...'; }

        try {
            const pkgCode = (active.snapshot && active.snapshot.systemInfo && active.snapshot.systemInfo.codigoSistema)
                || active.id || 'PKG';
            const entry = await VS.projectFolder.attachBlob(pkgCode, _currentBlob, {
                fileName: _currentFileName,
                type: 'LIBRO-PDF',
                code: _currentFileName.replace(/\.pdf$/i, ''),
                version: new Date().toISOString().slice(0, 16).replace('T', ' '),
                attachedBy: (function () {
                    const el = document.getElementById('ejecutor') || document.getElementById('executor');
                    return (el && el.value && el.value.trim()) || 'Sin identificar';
                })(),
                note: 'Libro de Validación generado · ' + (_currentFileName || '')
            });
            if (btn) {
                btn.innerHTML = '✓ Adjuntado';
                btn.style.background = '#1E7E34';
                btn.style.color = '#FFF';
                setTimeout(() => {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = prevLabel || '📎 Adjuntar al proyecto';
                        btn.style.background = '#C2E03B';
                        btn.style.color = '#1F3C56';
                    }
                }, 2200);
            }
            // Audit trail si está disponible
            if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                try {
                    await global.AuditTrail.logAction(
                        'DOC_UPDATED_IN_PROJECT',
                        'LIBRO-PDF',
                        entry.id,
                        {
                            detalle: 'Libro de Validación adjuntado a carpeta del proyecto',
                            fileName: _currentFileName,
                            hash: entry.hash,
                            sizeBytes: entry.sizeBytes
                        },
                        _currentFileName
                    );
                } catch (_e) { /* audit no debe romper UX */ }
            }
        } catch (e) {
            console.error('[bookPreview.attachToProject] error:', e);
            alert('No se pudo adjuntar el PDF: ' + (e.message || e));
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = prevLabel || '📎 Adjuntar al proyecto';
            }
        }
    };

    VS.bookPreview.close = function () {
        const modal = document.getElementById('modalBookPreview');
        if (modal) modal.style.display = 'none';
        // Liberar blob URL
        if (_currentBlobUrl) {
            URL.revokeObjectURL(_currentBlobUrl);
            _currentBlobUrl = null;
        }
        _currentBlob = null;
        const iframe = document.getElementById('bookPreviewIframe');
        if (iframe) iframe.src = 'about:blank';
    };

    // ============================================================
    // FLOWS DE ALTO NIVEL — coordinan loading + preview
    // ============================================================

    /** Helper interno: ejecuta generate() con feedback visual del loading.
     *  tomo: undefined | 1 | 2  · openInline: true → preview · download por default */
    async function runBookWithLoading(tomo, mode) {
        const pkg = (global.packageDocs || []).slice(); // copia para no mutar el original
        if (!Array.isArray(pkg) || pkg.length === 0) {
            alert('No hay paquete documental cargado.');
            return;
        }
        if (!VS.bookBuilder) { alert('book-builder no disponible.'); return; }

        // ── Mostrar formulario de portada personalizable ANTES de compilar ──
        const coverCfg = await showBookCoverConfig();
        if (coverCfg === null) return; // usuario canceló

        VS.bookLoading.show();
        try {
            if (!global.VS_LOGO_DATAURL && typeof VS.tryAutoLoadLogo === 'function') {
                await VS.tryAutoLoadLogo();
            }

            VS.bookLoading.step('prep', 'Recolectando documentos del paquete...');
            await VS.bookLoading.yield();

            // Si hay tests con evidencias reales en el runtime, regenerar el AEX
            // dinámicamente y reemplazar el AEX estático del paquete.
            if (tomo !== 1 && typeof global.drpBuildAexFromGestor === 'function') {
                const runtimeTests = global.tests || [];
                const testsConFotos = runtimeTests.filter(t =>
                    Array.isArray(t.evidences) && t.evidences.some(ev => !ev.isEmpty && ev.image));
                if (testsConFotos.length > 0) {
                    try {
                        const aexDinamico = global.drpBuildAexFromGestor();
                        if (aexDinamico && aexDinamico.type === 'AEX') {
                            // Reemplazar o agregar AEX en la copia del paquete
                            const aexIdx = pkg.findIndex(d => d.type === 'AEX');
                            const aexEntry = {
                                type: 'AEX',
                                code: (aexDinamico.document && aexDinamico.document.code) || 'AEX-LIVE',
                                version: '1.0',
                                title: (aexDinamico.document && aexDinamico.document.titleEs) || 'Anexo de Ejecución',
                                data: aexDinamico,
                                fileName: 'aex-live.json',
                                loadedAt: new Date().toISOString()
                            };
                            if (aexIdx >= 0) pkg[aexIdx] = aexEntry;
                            else pkg.push(aexEntry);
                            console.info(`[book-preview] AEX regenerado con ${testsConFotos.length} TC(s) con evidencias reales.`);
                        }
                    } catch (e) {
                        console.warn('[book-preview] No se pudo regenerar AEX dinámico:', e);
                    }
                }
            }

            const stats = VS.bookBuilder.stats(pkg);
            const decisionGlobal = stats.totalDocs >= 10 ? 'SISTEMA VALIDADO' : 'COMPILACIÓN EN CURSO';

            VS.bookLoading.step('prelim', 'Construyendo portada, prefacio, glosario y marco regulatorio...');
            await VS.bookLoading.yield();
            VS.bookLoading.step('indice', 'Calculando índice maestro y registro de firmas...');
            await VS.bookLoading.yield();

            const labelT1 = tomo === 2 ? 'Saltando Tomo I (no aplica)' : `Tomo I (${stats.totalDocsTomo1} docs del ciclo)`;
            VS.bookLoading.step('tomo1', labelT1);
            await VS.bookLoading.yield();

            const labelT2 = tomo === 1 ? 'Saltando Tomo II (no aplica)' : `Tomo II (${stats.totalDocsTomo2} anexo${stats.totalDocsTomo2 === 1 ? '' : 's'})`;
            VS.bookLoading.step('tomo2', labelT2);
            await VS.bookLoading.yield();

            VS.bookLoading.step('pdf', 'Renderizando PDF — esto puede tardar...');
            await VS.bookLoading.yield();

            const opts = {
                decisionGlobal: decisionGlobal,
                periodoCiclo: '',
                tomo: tomo,
                openInline: mode === 'preview',
                _stats: stats,
                // ── Datos de la portada personalizada ──
                coverCliente:     coverCfg.cliente     || '',
                coverVersion:     coverCfg.version     || '',
                coverFechaCierre: coverCfg.fechaCierre || '',
                coverResponsable: coverCfg.responsable || '',
                coverLogoDataUrl: coverCfg.logoDataUrl || null,
                coverDesign:      coverCfg.design      || 'franja'
            };
            await VS.bookBuilder.generate(pkg, opts);

            VS.bookLoading.markAllDone();
            await VS.bookLoading.yield();
            setTimeout(() => VS.bookLoading.hide(), 400);
        } catch (e) {
            console.error('[book-preview]', e);
            VS.bookLoading.hide();
            alert('Error generando libro:\n\n' + e.message);
        }
    }

    // ── API global expuesta ──
    global.previewBookInline       = () => runBookWithLoading(undefined, 'preview');
    global.previewBookTomoI        = () => runBookWithLoading(1, 'preview');
    global.previewBookTomoII       = () => runBookWithLoading(2, 'preview');
    global.downloadBookCompleto    = () => runBookWithLoading(undefined, 'download');
    global.downloadBookTomoI       = () => runBookWithLoading(1, 'download');
    global.downloadBookTomoII      = () => runBookWithLoading(2, 'download');

    // ════════════════════════════════════════════════════════════════
    // VISIBILIDAD ADAPTATIVA DEL MENÚ "Suite Libro de Validación"
    //
    // Cuando el paquete documental está vacío, las opciones de
    // descarga (Tomos I/II/III) NO funcionan — antes mostrábamos los
    // botones igual y el usuario hacía click sin obtener resultado.
    //
    // Ahora ocultamos esos bloques y mostramos un hint ámbar
    // explicando que hay que cargar paquete. Los Demo y la info
    // siguen visibles porque trabajan sin paquete previo.
    // ════════════════════════════════════════════════════════════════
    function updateBookMenuVisibility() {
        const hasPackage = Array.isArray(global.packageDocs) && global.packageDocs.length > 0;
        const drop = document.getElementById('dropLibro');
        if (!drop) return;
        drop.querySelectorAll('[data-requires-package]').forEach(el => {
            el.style.display = hasPackage ? '' : 'none';
        });
        drop.querySelectorAll('[data-no-package-hint]').forEach(el => {
            el.style.display = hasPackage ? 'none' : '';
        });
    }
    global.updateBookMenuVisibility = updateBookMenuVisibility;

    // Hook al abrir el dropdown: clicks sobre los triggers .tb-split-main /
    // .tb-split-arrow con data-dropdown="dropLibro". El handler de
    // toggleDropdown() en logica-modular.js corre primero (registrado en
    // DOMContentLoaded); el nuestro corre después y actualiza la visibilidad
    // ANTES de que se vea el dropdown (setTimeout 0 cede el frame y permite
    // que se procese el display:none antes del paint).
    function attachDropdownHook() {
        document.querySelectorAll('[data-dropdown="dropLibro"]').forEach(trigger => {
            trigger.addEventListener('click', () => {
                // Ejecutar inmediatamente — toggleDropdown ya añadió .active al
                // dropdown, pero el browser no repintó todavía. Actualizar acá
                // evita un flash visual de los botones que se ocultan.
                updateBookMenuVisibility();
            }, false);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            attachDropdownHook();
            updateBookMenuVisibility();
        });
    } else {
        attachDropdownHook();
        updateBookMenuVisibility();
    }

    // ════════════════════════════════════════════════════════════════
    // CONFIGURACIÓN DE PORTADA — modal con formulario previo al libro
    // ════════════════════════════════════════════════════════════════

    const COVER_CONFIG_KEY = 'libro-cover-config';

    /** Carga la config guardada en localStorage y pre-llena el formulario. */
    function loadCoverConfigIntoForm() {
        try {
            const raw = localStorage.getItem(COVER_CONFIG_KEY);
            if (!raw) return;
            const cfg = JSON.parse(raw);
            const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
            set('bcfCliente', cfg.cliente);
            set('bcfVersion', cfg.version);
            set('bcfFecha', cfg.fechaCierre);
            set('bcfResponsable', cfg.responsable);
            // Logo: si hay dataURL guardado, restaurarlo
            if (cfg.logoDataUrl) {
                window._bcfLogoDataUrl = cfg.logoDataUrl;
                const img = document.getElementById('bcfLogoImg');
                const prev = document.getElementById('bcfLogoPreview');
                const name = document.getElementById('bcfLogoName');
                const rem  = document.getElementById('bcfLogoRemove');
                if (img) img.src = cfg.logoDataUrl;
                if (prev) prev.style.display = 'block';
                if (name) name.textContent = 'Logo cargado';
                if (rem) rem.style.display = 'inline';
            }
            // Diseño
            if (cfg.design) {
                const radio = document.querySelector(`input[name="bcfDesign"][value="${cfg.design}"]`);
                if (radio) { radio.checked = true; _bcfSyncDesignStyle(); }
            }
        } catch (e) { /* ignorar */ }
    }

    /** Sincroniza el estilo de los labels de radio según el seleccionado. */
    function _bcfSyncDesignStyle() {
        const val = (() => {
            const r = document.querySelector('input[name="bcfDesign"]:checked');
            return r ? r.value : 'franja';
        })();
        const optFranja = document.getElementById('bcfDesignOptFranja');
        const optFormal = document.getElementById('bcfDesignOptFormal');
        if (optFranja) {
            optFranja.style.borderColor = val === 'franja' ? '#1F3C56' : '#C8DCEE';
            optFranja.style.background  = val === 'franja' ? '#EAF1F8' : '#FFF';
        }
        if (optFormal) {
            optFormal.style.borderColor = val === 'formal' ? '#1F3C56' : '#C8DCEE';
            optFormal.style.background  = val === 'formal' ? '#EAF1F8' : '#FFF';
        }
    }
    global._bcfSyncDesignStyle = _bcfSyncDesignStyle;

    /** Quita el logo cargado del formulario. */
    global._bcfRemoveLogo = function () {
        window._bcfLogoDataUrl = null;
        const img  = document.getElementById('bcfLogoImg');
        const prev = document.getElementById('bcfLogoPreview');
        const name = document.getElementById('bcfLogoName');
        const rem  = document.getElementById('bcfLogoRemove');
        const inp  = document.getElementById('bcfLogo');
        if (img) img.src = '';
        if (prev) prev.style.display = 'none';
        if (name) name.textContent = 'Sin logo cargado';
        if (rem) rem.style.display = 'none';
        if (inp) inp.value = '';
    };

    /**
     * Muestra el modal de configuración de portada y resuelve con los datos
     * del formulario cuando el usuario confirma, o null si cancela.
     * @returns {Promise<Object|null>}
     */
    function showBookCoverConfig() {
        return new Promise(resolve => {
            const modal = document.getElementById('modalBookCoverConfig');
            if (!modal) { resolve({}); return; }

            // Pre-llenar desde localStorage
            loadCoverConfigIntoForm();

            // Mostrar
            modal.style.display = 'flex';

            // Handler logo file input
            const logoInput = document.getElementById('bcfLogo');
            function onLogoChange(e) {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function (ev) {
                    window._bcfLogoDataUrl = ev.target.result;
                    const img  = document.getElementById('bcfLogoImg');
                    const prev = document.getElementById('bcfLogoPreview');
                    const name = document.getElementById('bcfLogoName');
                    const rem  = document.getElementById('bcfLogoRemove');
                    if (img) img.src = ev.target.result;
                    if (prev) prev.style.display = 'block';
                    if (name) name.textContent = file.name;
                    if (rem) rem.style.display = 'inline';
                };
                reader.readAsDataURL(file);
            }
            if (logoInput) {
                logoInput.removeEventListener('change', logoInput._bcfHandler || function(){});
                logoInput._bcfHandler = onLogoChange;
                logoInput.addEventListener('change', onLogoChange);
            }

            // Radio buttons: actualizar estilos al cambiar
            document.querySelectorAll('input[name="bcfDesign"]').forEach(r => {
                r.addEventListener('change', _bcfSyncDesignStyle);
            });

            function cleanup() {
                modal.style.display = 'none';
            }

            // Botón cancelar
            const btnCancel = document.getElementById('bcfBtnCancel');
            function onCancel() {
                cleanup();
                resolve(null);
            }
            if (btnCancel) {
                btnCancel.onclick = onCancel;
            }

            // Click fuera del modal (en el overlay)
            function onOverlayClick(e) {
                if (e.target === modal) {
                    cleanup();
                    resolve(null);
                }
            }
            modal.addEventListener('click', onOverlayClick, { once: true });

            // Botón confirmar
            const btnConfirm = document.getElementById('bcfBtnConfirm');
            function onConfirm() {
                const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
                const design = (() => {
                    const r = document.querySelector('input[name="bcfDesign"]:checked');
                    return r ? r.value : 'franja';
                })();
                const cfg = {
                    cliente:      val('bcfCliente'),
                    version:      val('bcfVersion'),
                    fechaCierre:  val('bcfFecha'),
                    responsable:  val('bcfResponsable'),
                    logoDataUrl:  window._bcfLogoDataUrl || null,
                    design:       design
                };
                // Persistir (sin logoDataUrl si es muy grande — lo guardamos igual, es base64)
                try {
                    localStorage.setItem(COVER_CONFIG_KEY, JSON.stringify(cfg));
                } catch(e) { /* quota */ }

                cleanup();
                resolve(cfg);
            }
            if (btnConfirm) {
                btnConfirm.onclick = onConfirm;
            }
        });
    }

    // Exponer para uso externo si se necesita
    VS.showBookCoverConfig = showBookCoverConfig;

})(window);
