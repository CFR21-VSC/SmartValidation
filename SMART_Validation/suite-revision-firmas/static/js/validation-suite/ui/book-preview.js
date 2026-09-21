/* ====================================================================
   BOOK PREVIEW & LOADING UX — versión recortada para la Suite de Firmas.

   Portado desde js/validation-suite/ui/book-preview.js (pedido del usuario
   2026-09-20, para el botón "Vista previa — Libro de Firmas" en
   dashboard.html) -- SOLO el núcleo genérico de loading+preview
   (VS.bookLoading, VS.bookPreview.openWithDocDef/attachBlob/download/close).
   El archivo original en la Suite de Validación trae además toda la
   orquestación del menú "Suite Libro de Validación" (runBookWithLoading,
   el modal de configuración de portada, el dropdown #dropSuiteDoc, el hook
   de AEX dinámico vía global.packageDocs) -- ninguno de esos globals ni
   ese modal existen acá, así que se deja afuera en vez de copiar código
   muerto que nunca se ejecuta en esta suite.

   API (igual que el original):
     ValidationSuite.bookLoading.show/step/hide/markAllDone/yield()
     ValidationSuite.bookPreview.openWithDocDef(docDef, fileName, meta) → genera blob + muestra iframe
     ValidationSuite.bookPreview.attachBlob(blob, fileName, meta, opts)  → igual, pero con blob ya generado
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
            if (icon) icon.textContent = '✓';
        });
    };

    VS.bookLoading.hide = function () {
        const m = getModal();
        if (m) m.style.display = 'none';
    };

    /** Da el browser un tick para repintar el DOM entre fases (pdfMake bloquea
     *  el thread durante createPdf). */
    VS.bookLoading.yield = function () {
        return new Promise(r => setTimeout(r, 30));
    };

    // ============================================================
    // PREVIEW
    // ============================================================
    VS.bookPreview = VS.bookPreview || {};
    let _currentBlobUrl = null;
    let _currentBlob = null;
    let _currentFileName = 'libro-firmas.pdf';

    /** Recibe un blob ya generado y abre el preview con iframe. */
    VS.bookPreview.attachBlob = function (blob, fileName, meta) {
        _currentFileName = fileName || 'libro-firmas.pdf';
        if (_currentBlobUrl) {
            URL.revokeObjectURL(_currentBlobUrl);
            _currentBlobUrl = null;
        }
        _currentBlob = blob;
        _currentBlobUrl = URL.createObjectURL(blob);
        const iframe = document.getElementById('bookPreviewIframe');
        if (iframe) iframe.src = _currentBlobUrl + '#toolbar=1&navpanes=0';
        const metaEl = document.getElementById('bookPreviewMeta');
        if (metaEl) metaEl.textContent = `${(blob.size / (1024 * 1024)).toFixed(1)} MB`;
        const modal = document.getElementById('modalBookPreview');
        if (modal) modal.style.display = 'flex';
    };

    /** Abre el modal de preview con un docDefinition de pdfMake. */
    VS.bookPreview.openWithDocDef = function (docDef, fileName, meta) {
        if (typeof pdfMake === 'undefined') {
            alert('pdfMake no está cargado.');
            return Promise.reject(new Error('pdfMake missing'));
        }
        _currentFileName = fileName || 'libro-firmas.pdf';
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
                            ? `${meta.totalDocs || '?'} docs · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`
                            : `${(blob.size / (1024 * 1024)).toFixed(1)} MB`;
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

    VS.bookPreview.close = function () {
        const modal = document.getElementById('modalBookPreview');
        if (modal) modal.style.display = 'none';
        if (_currentBlobUrl) {
            URL.revokeObjectURL(_currentBlobUrl);
            _currentBlobUrl = null;
        }
        _currentBlob = null;
        const iframe = document.getElementById('bookPreviewIframe');
        if (iframe) iframe.src = 'about:blank';
    };

})(window);
