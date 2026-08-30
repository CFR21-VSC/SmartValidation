/* ====================================================================
   VALIDATION SUITE — RENDERER PPQ
   Protocolo de Calificación de Performance (Performance Qualification
   Protocol). Documento que define los Test Cases ANTES de ejecutar la
   PQ. En este protocolo no se cargan resultados, hallazgos ni firmas
   de ejecución — eso va al IPQ.

   Filosofía CSA aplicada a PQ:
   - Procedimiento numerado (escenarios de uso real con pasos numerados).
   - Criterio de aceptación único consolidado al pie de cada TC.
   - TCs identificados como POSITIVO o NEGATIVO.
   - Nivel de criticidad (CRÍTICO/ALTO/MEDIO/BAJO) derivado del RPN del RA.

   Diferencia PQ vs OQ:
   - OQ: verifica que funciones específicas operan según diseño.
   - PQ: verifica que escenarios end-to-end de uso productivo cumplen
        requisitos de negocio bajo condiciones representativas reales.

   Estructura típica del PPQ:
   1. Propósito y objetivo
   2. Alcance
   3. Documentos de referencia
   4. Condiciones de ejecución
   5. Resumen de Test Cases PQ
   6. Test Cases — bloques detallados (schemaModo: "procedimiento")
   7. Critical Thinking / Justificación de proporcionalidad
   8. Referencias
   9. Firmas
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[ppq.js] ValidationSuite no esta cargado');
        return;
    }

    function renderTablaFirmasFinal(sec, tb, num) {
        if (VS.shared && typeof VS.shared.renderTablaFirmasFinalSmart === "function") {
            return VS.shared.renderTablaFirmasFinalSmart(sec, tb, { rolesDefault: [
                'Redactor (Validador)',
                'Revisor (Process Owner)',
                'Aprobador (Jefe de Validaciones)',
                'Aprobador (Gerente QA)'
            ], numero: num, titulo: sec.titulo });
        }
        return [{ text: "[Helper de firmas no disponible]", color: "#FF0000" }];
    }

    function maybeWrapUnbreakable(sec, titleBlock, contentBlock) {
        const TABLE_TYPES = ['tabla-info'];
        const rowCount = (sec.filas || sec.preguntas || []).length;

        if (TABLE_TYPES.includes(sec.tipo) && rowCount > 0 && rowCount <= 8) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        if (sec.tipo === 'tabla' && rowCount > 0 && rowCount <= 6) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        return [...titleBlock, ...contentBlock];
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('PPQ', function renderPPQ(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const iq = VS.iqShared;
        const out = [];
        const secciones = data.secciones || [];

        // El modo es siempre 'protocolo' para PPQ
        const MODE = 'protocolo';

        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);

            let titleBlock = [];
            if (sec.tipo !== 'subseccion') {
                const titulo = sec.titulo ? `${num}. ${sec.titulo}` : null;
                if (titulo) {
                    titleBlock = tb.sectionTitle(titulo, { marginTop: idx === 0 ? 0 : 10 });
                }
            }

            let contentBlock = [];
            switch (sec.tipo) {
                case 'texto': contentBlock = shared.renderTexto(sec, tb); break;
                case 'lista-incluido-excluido': contentBlock = shared.renderIncluidoExcluido(sec, tb); break;
                case 'tabla': contentBlock = shared.renderTabla(sec, tb); break;
                case 'tabla-info': contentBlock = shared.renderTablaInfo(sec, tb); break;
                case 'subseccion': contentBlock = shared.renderSubseccion(sec, tb); break;
                case 'caja-nota': contentBlock = shared.renderCajaNota(sec, tb); break;
                case 'caja-justificacion': contentBlock = shared.renderCajaJustificacion(sec, tb); break;
                case 'caja-criterio': contentBlock = shared.renderCajaCriterio(sec, tb); break;
                case 'caja-conclusion': contentBlock = shared.renderCajaConclusion(sec, tb); break;
                case 'matriz-tc': contentBlock = iq.renderSeccionMatriz(sec, tb, MODE); break;
                case 'tabla-test-case': contentBlock = iq.renderSeccionTabla(sec, tb, MODE); break;
                case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                default:
                    contentBlock = [{
                        text: `[Tipo de sección desconocido: ${sec.tipo}]`,
                        color: '#FF0000', margin: [0, 0, 0, 12]
                    }];
            }

            out.push(...maybeWrapUnbreakable(sec, titleBlock, contentBlock));
        });

        return out;
    });

})(window);
