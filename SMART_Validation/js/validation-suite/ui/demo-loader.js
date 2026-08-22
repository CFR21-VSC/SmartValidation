/* ====================================================================
   DEMO LOADER — carga en 1 click el paquete completo DRP-SIS-001
   Para demos / pitch / smoke tests visuales del Libro de Validación.
   ==================================================================== */
(function (global) {
    'use strict';

    // Lista canónica de los fixtures del paquete DRP-SIS-001
    const DRP_DEMO_FIXTURES = [
        'hlra-drp-sis-001',
        'vp-drp-sis-001',
        'urs-drp-sis-001',
        'ra-drp-sis-001',
        'ira-drp-sis-001',
        'rrm-drp-sis-001',
        'mtr-drp-sis-001',
        'piq-drp-sis-001',
        'iiq-drp-sis-001',
        'riq-drp-sis-001',
        'poq-drp-sis-001',
        'ioq-drp-sis-001',
        'ncr-drp-sis-001',
        'roq-drp-sis-001',
        'ppq-drp-sis-001',
        'ipq-drp-sis-001',
        'rpq-drp-sis-001',
        'vsr-drp-sis-001',
        'aex-drp-sis-001',     // anexos de ejecución (Tomo II del libro)
        'people-drp-sis-001'   // personas firmantes + pinHash
    ];

    const POST_RELOAD_KEY = 'vsDemoPostReloadAction';

    /** Cargar Demo → cambiar al proyecto demo reservado.
     *  El proyecto actual del usuario queda intacto en IndexedDB.
     *  Después del reload, la app levanta con el demo cargado y editable. */
    async function loadDrpDemo(opts) {
        opts = opts || {};
        const VS = global.ValidationSuite;
        if (!VS || !VS.projects || typeof VS.projects.openDemo !== 'function') {
            alert('Sistema de proyectos no disponible.');
            return;
        }

        if (opts.postReloadAction) {
            try { localStorage.setItem(POST_RELOAD_KEY, opts.postReloadAction); }
            catch (e) { /* silencioso */ }
        }

        if (typeof global.showNotification === 'function') {
            global.showNotification('Abriendo proyecto Demo DRP-SIS-001…');
        }

        try {
            await VS.projects.openDemo();
            // openDemo() llama a switchTo() que hace reload — no llegamos acá normalmente.
        } catch (e) {
            console.error('[demo-loader] openDemo falló:', e);
            alert('No se pudo abrir el proyecto demo: ' + (e.message || e));
        }
    }

    /** Ejecuta una acción solicitada antes del reload (combo flows).
     *  Reconoce: 'openBook', 'downloadSeparados', 'downloadTomoIII', 'downloadTodo'. */
    function runPostReloadAction(action) {
        switch (action) {
            case 'openBook':
                if (typeof global.previewBookInline === 'function') return global.previewBookInline();
                if (typeof global.generateValidationBook === 'function') return global.generateValidationBook();
                break;
            case 'downloadSeparados':
                return (async () => {
                    if (typeof global.downloadBookTomoI === 'function') {
                        try { await global.downloadBookTomoI(); } catch (e) { console.error('[demo] Tomo I', e); }
                    }
                    await new Promise(r => setTimeout(r, 600));
                    if (typeof global.downloadBookTomoII === 'function') {
                        try { await global.downloadBookTomoII(); } catch (e) { console.error('[demo] Tomo II', e); }
                    }
                })();
            case 'downloadTomoIII':
                if (typeof global.downloadTomoIII === 'function') return global.downloadTomoIII();
                break;
            case 'downloadTodo':
                return (async () => {
                    if (typeof global.downloadBookTomoI === 'function') {
                        try { await global.downloadBookTomoI(); } catch (e) {}
                    }
                    await new Promise(r => setTimeout(r, 600));
                    if (typeof global.downloadBookTomoII === 'function') {
                        try { await global.downloadBookTomoII(); } catch (e) {}
                    }
                    await new Promise(r => setTimeout(r, 600));
                    if (typeof global.downloadTomoIII === 'function') {
                        try { await global.downloadTomoIII(); } catch (e) {}
                    }
                })();
        }
    }

    /** Al bootstrap, si quedó una acción pendiente del último loadDrpDemo→reload,
     *  la ejecuta una vez que la app terminó de inicializar. */
    function consumePostReloadAction() {
        let action;
        try { action = localStorage.getItem(POST_RELOAD_KEY); }
        catch (e) { return; }
        if (!action) return;
        try { localStorage.removeItem(POST_RELOAD_KEY); } catch (e) {}
        // Esperar a que app + packageDocs estén listos (demo carga 20+ fixtures desde IndexedDB)
        function waitForPackageDocs(cb, tries) {
            tries = tries || 0;
            if ((window.packageDocs && window.packageDocs.length > 0) || tries >= 20) { cb(); return; }
            setTimeout(() => waitForPackageDocs(cb, tries + 1), 300);
        }
        waitForPackageDocs(() => runPostReloadAction(action));
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', consumePostReloadAction);
    } else {
        consumePostReloadAction();
    }

    global.loadDrpDemo = loadDrpDemo;

    /** Abrir demo + abrir preview del libro tras el reload. */
    global.loadDrpDemoAndOpenBook = function () {
        return loadDrpDemo({ postReloadAction: 'openBook' });
    };

    // Demo + descarga de los DOS tomos en archivos separados (no combinado).
    // Útil para pitch: el inversor ve dos PDFs distinguibles (Ciclo vs Anexos)
    // en lugar de un único PDF gigante.
    global.loadDrpDemoAndDownloadSeparados = function () {
        return loadDrpDemo({ postReloadAction: 'downloadSeparados' });
    };

    // ────────────────────────────────────────────────────────────────────
    // TOMO III — ZIP con evidencias raw + manifest + índice PDF
    // ────────────────────────────────────────────────────────────────────

    /** Descarga el Tomo III del paquete actual (raw data ZIP). */
    global.downloadTomoIII = async function () {
        const pkg = global.packageDocs || [];
        if (!Array.isArray(pkg) || pkg.length === 0) {
            alert('No hay paquete documental cargado.');
            return;
        }
        const VS = global.ValidationSuite;
        if (!VS || !VS.tomoIII || typeof VS.tomoIII.generate !== 'function') {
            alert('Módulo Tomo III no disponible.');
            return;
        }
        const stats = VS.tomoIII.stats(pkg);
        if (stats.aexCount === 0) {
            alert('El paquete actual no tiene anexos AEX con evidencias. El Tomo III solo aplica a paquetes con ejecución registrada.');
            return;
        }

        // Notification con stats
        const notify = global.showNotification || ((msg) => console.log('[tomoIII]', msg));
        notify(`Generando Tomo III · ${stats.aexCount} AEX · ${stats.evidenciaCount} evidencia(s)...`);

        try {
            const result = await VS.tomoIII.generate(pkg, {
                onProgress: (msg) => notify(msg)
            });
            notify(`Tomo III descargado: ${result.fileName} · ${result.manifest.stats.totalEvidencias} evidencia(s)`);
        } catch (e) {
            console.error('[tomoIII]', e);
            alert('Error generando Tomo III:\n\n' + e.message);
        }
    };

    /** Demo: abre el proyecto demo y descarga el Tomo III post-reload. */
    global.loadDrpDemoAndDownloadTomoIII = function () {
        return loadDrpDemo({ postReloadAction: 'downloadTomoIII' });
    };

    /** Demo "todo en uno": abre demo + descarga los 3 tomos post-reload. */
    global.loadDrpDemoAndDownloadTodo = function () {
        return loadDrpDemo({ postReloadAction: 'downloadTodo' });
    };
})(window);
