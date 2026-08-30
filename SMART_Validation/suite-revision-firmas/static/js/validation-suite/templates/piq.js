/* ====================================================================
   VALIDATION SUITE — RENDERER PIQ
   Protocolo de Calificacion de Instalacion (Installation Qualification
   Protocol). Documento que define los Test Cases ANTES de ejecutar la
   IQ. En este protocolo no se cargan resultados, hallazgos ni firmas
   de ejecucion — eso va al IIQ.

   Filosofia CSA-friendly:
   - Matriz unificada al inicio (vista ejecutiva).
   - Bloques detallados por TC con criterios consolidados (no scripts
     micro-prescriptivos paso a paso).
   - Profundidad de verificacion heredada del IRA (Basica/Estandar/
     Exhaustiva).
   - Justificacion de proporcionalidad al final.

   Estructura tipica del PIQ:
   1. Proposito y objetivo
   2. Alcance
   3. Documentos de referencia
   4. Condiciones de ejecucion
   5. Matriz unificada de TCs (tipo: matriz-tc)
   6. Test Cases — bloques detallados (tipo: tabla-test-case)
   7. Critical Thinking / Justificacion de proporcionalidad
   8. Referencias
   9. Firmas

   Tipos de seccion soportados:
   - Todos los compartidos
   - matriz-tc       : matriz resumen de todos los TCs
   - tabla-test-case : bloques detallados por TC (puede agrupar por grupo)
   - tabla-firmas-final : firmas estandar
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[piq.js] ValidationSuite no esta cargado');
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

        if (TABLE_TYPES.includes(sec.tipo) && rowCount > 0 && rowCount <= 4) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        if (sec.tipo === 'tabla' && rowCount > 0 && rowCount <= 4) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        return [...titleBlock, ...contentBlock];
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('PIQ', function renderPIQ(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const iq = VS.iqShared;
        const out = [];
        const secciones = data.secciones || [];

        // El modo es siempre 'protocolo' para PIQ
        const MODE = 'protocolo';

        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);

            let titleBlock = [];
            if (sec.tipo !== 'subseccion') {
                const titulo = sec.titulo
                    ? (num != null ? `${num}. ${sec.titulo}` : sec.titulo)
                    : null;
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
                // Callout boxes: el titulo va DENTRO del box — limpiar titleBlock
                case 'caja-nota': contentBlock = shared.renderCajaNota(sec, tb); titleBlock = []; break;
                case 'caja-justificacion': contentBlock = shared.renderCajaJustificacion(sec, tb); titleBlock = []; break;
                case 'caja-criterio': contentBlock = shared.renderCajaCriterio(sec, tb); titleBlock = []; break;
                case 'caja-conclusion': contentBlock = shared.renderCajaConclusion(sec, tb); titleBlock = []; break;
                case 'matriz-tc': contentBlock = iq.renderSeccionMatriz(sec, tb, MODE); break;
                case 'tabla-test-case': contentBlock = iq.renderSeccionTabla(sec, tb, MODE); break;
                case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                default:
                    contentBlock = [{
                        text: `[Tipo de seccion desconocido: ${sec.tipo}]`,
                        color: '#FF0000', margin: [0, 0, 0, 12]
                    }];
            }

            out.push(...maybeWrapUnbreakable(sec, titleBlock, contentBlock));
        });

        return out;
    });

})(window);
