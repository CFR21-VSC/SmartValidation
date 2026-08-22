/* ====================================================================
   BOOK UI — handler del menú "Generar Libro de Validación"
   Pide confirmación con stats antes de compilar.
   ==================================================================== */
(function (global) {
    'use strict';

    // ====================================================================
    // MODAL INFORMATIVO: ¿qué es el Libro de Validación?
    // ====================================================================
    global.showBookInfoModal = function () {
        const modal = document.getElementById('modalBookInfo');
        if (modal) {
            modal.style.display = 'flex';
            return;
        }
        // Fallback si el modal no está en el DOM (shouldn't happen)
        alert([
            'LIBRO DE VALIDACIÓN',
            '',
            'Entregable maestro que compila todo el paquete de validación en un único PDF tipo libro.',
            '',
            'Contiene:',
            '  · Portada con identificación del sistema + decisión global',
            '  · Prefacio',
            '  · Índice maestro navegable (TOC) con todos los docs',
            '  · Registro maestro de firmas (consolidado del ciclo)',
            '  · Cascada documental: HLRA → VP → URS → ... → VSR',
            '  · Cada doc con su contenido completo + firmas',
            '  · Numeración global de páginas',
            '',
            'Es el documento que un auditor regulatorio (ANMAT, FDA, EMA) recibe como evidencia única de la validación del sistema.'
        ].join('\n'));
    };

    // ====================================================================
    // VISTA PREVIA — abre el libro en una pestaña nueva sin descargar.
    // Útil cuando se quiere imprimir o compartir el URL del blob.
    // (La vista previa INLINE en el suite la maneja previewBookInline en
    //  book-preview.js, con iframe embebido y loading visual.)
    // ====================================================================
    global.previewValidationBook = async function () {
        const pkg = global.packageDocs || [];
        if (!Array.isArray(pkg) || pkg.length === 0) {
            alert('No hay paquete documental cargado para previsualizar el libro.');
            return;
        }
        const VS = global.ValidationSuite;
        if (!VS || !VS.bookBuilder) { alert('book-builder no disponible.'); return; }

        if (typeof global.showNotification === 'function') {
            global.showNotification('Generando vista previa del libro...');
        }
        try {
            await VS.bookBuilder.generate(pkg, {
                decisionGlobal: 'SISTEMA VALIDADO',
                periodoCiclo: '',
                openInNewTab: true
            });
        } catch (e) {
            console.error('[book-ui preview]', e);
            alert('Error en vista previa: ' + e.message);
        }
    };

    global.generateValidationBook = async function () {
        const pkg = global.packageDocs || [];
        if (!Array.isArray(pkg) || pkg.length === 0) {
            alert('No hay paquete documental cargado.\n\nPara generar el libro de validación necesitás cargar primero un paquete completo desde:\n\n  Suite Evidencias → Cargar Paquete');
            return;
        }

        const VS = global.ValidationSuite;
        if (!VS || !VS.bookBuilder) {
            alert('Módulo book-builder no disponible.');
            return;
        }

        const stats = VS.bookBuilder.stats(pkg);

        // Construir lista de tipos presentes vs orden canónico
        const PHASE = VS.bookBuilder.PHASE_ORDER || [];
        const presentes = PHASE.filter(t => stats.docsPorTipo[t]);
        const ausentes = PHASE.filter(t => !stats.docsPorTipo[t]);

        const cobertura = Math.round((presentes.length / PHASE.length) * 100);
        const completo = cobertura === 100;
        const sistema = (pkg[0] && pkg[0].data && pkg[0].data.package && pkg[0].data.package.systemName) || 'Sistema sin nombre';
        const codigo = (pkg[0] && pkg[0].data && pkg[0].data.package && pkg[0].data.package.code) || '—';

        const msg = `Compilar LIBRO DE VALIDACIÓN del paquete\n\n` +
            `  Sistema: ${sistema}\n` +
            `  Paquete: ${codigo}\n\n` +
            `  Documentos del paquete: ${stats.totalDocs}\n` +
            `  Firmas a consolidar: ${stats.totalFirmas}\n` +
            `  Cobertura del ciclo: ${cobertura}% (${presentes.length}/${PHASE.length} tipos canónicos)\n` +
            (ausentes.length > 0
                ? `\n  Tipos ausentes: ${ausentes.join(', ')}\n  El libro se compila con lo que hay; los tipos faltantes no se incluyen.\n`
                : `\n  Paquete completo. El libro consolida el ciclo entero.\n`) +
            `\nContinuar?`;

        if (!confirm(msg)) return;

        const decisionGlobal = prompt('Decisión global del libro (visible en portada y contratapa):',
            completo ? 'SISTEMA VALIDADO' : 'COMPILACIÓN EN CURSO');
        if (decisionGlobal === null) return;

        const periodoCiclo = prompt('Período del ciclo de validación (ej. "Marzo–Mayo 2026"):',
            '');
        if (periodoCiclo === null) return;

        // Usa el modal de loading con pasos animados si está disponible
        const hasLoadingUI = VS.bookLoading && typeof VS.bookLoading.show === 'function';
        try {
            if (hasLoadingUI) {
                VS.bookLoading.show();
                VS.bookLoading.step('prep', 'Recolectando documentos del paquete...');
                await VS.bookLoading.yield();
                VS.bookLoading.step('prelim', 'Construyendo portada, prefacio, glosario, marco...');
                await VS.bookLoading.yield();
                VS.bookLoading.step('indice', 'Calculando índice maestro y registro de firmas...');
                await VS.bookLoading.yield();
                VS.bookLoading.step('tomo1', `Renderizando Tomo I (${stats.totalDocs} docs)...`);
                await VS.bookLoading.yield();
                VS.bookLoading.step('tomo2', 'Tomo II (Anexos AEX si los hay)...');
                await VS.bookLoading.yield();
                VS.bookLoading.step('pdf', 'Renderizando PDF — esto puede tardar...');
                await VS.bookLoading.yield();
            } else if (typeof global.showNotification === 'function') {
                global.showNotification(`Compilando libro con ${stats.totalDocs} documentos...`);
            }
            await VS.bookBuilder.generate(pkg, {
                decisionGlobal: decisionGlobal || 'SISTEMA VALIDADO',
                periodoCiclo: periodoCiclo || ''
            });
            if (hasLoadingUI) {
                VS.bookLoading.markAllDone();
                await VS.bookLoading.yield();
                setTimeout(() => VS.bookLoading.hide(), 600);
            }
            if (typeof global.showNotification === 'function') {
                global.showNotification(`Libro de Validación generado. ${stats.totalDocs} documentos compilados, ${stats.totalFirmas} firmas consolidadas.`);
            }
        } catch (e) {
            if (hasLoadingUI) VS.bookLoading.hide();
            console.error('[book-ui] error:', e);
            alert('Error generando el libro: ' + e.message);
        }
    };

})(window);
