/* ====================================================================
   VALIDATION SUITE — RENDERER URS (User Requirements Specification)

   Tipos de seccion soportados:
   COMPARTIDOS (de shared-renderers.js):
   - texto                       : Parrafos
   - lista-incluido-excluido     : Alcance
   - tabla                       : Tabla generica (con sub-headers, noHeader)
   - tabla-info                  : Tabla key/value
   - subseccion                  : Sub-titulo numerado
   - caja-nota                   : Callout amarillo
   - caja-justificacion          : Caja con borde + titulo
   - caja-criterio               : Banner verde con titulo
   - caja-conclusion             : Caja con borde

   ESPECIFICOS URS:
   - tabla-firmas-final          : Tabla de firmas (compartido con HLRA/VP)

   NOTA: La gran tabla de requerimientos (50+ filas) se renderea con
   tipo: 'tabla', usando filas con { subheader: "7.1 ..." } para los
   grupos. El renderer detecta sub-headers automaticamente.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[urs.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // tabla-firmas-final (compartido con HLRA/VP)
    // ====================================================================
    function renderTablaFirmasFinal(sec, tb, num) {
        if (VS.shared && typeof VS.shared.renderTablaFirmasFinalSmart === "function") {
            return VS.shared.renderTablaFirmasFinalSmart(sec, tb, { rolesDefault: [
                'Ejecutor (Validador)',
                'Revisor (Process Owner)',
                'Aprobador (Jefe de Validaciones)',
                'Aprobador (Gerente QA)'
            ], numero: num, titulo: sec.titulo });
        }
        return [{ text: "[Helper de firmas no disponible]", color: "#FF0000" }];
    }

    // Tipos de tabla "chicos" para wrap unbreakable
    const TABLE_TYPES = ['tabla-info', 'tabla-decisiones-tc'];

    /**
     * Wrappear titulo+tabla en stack unbreakable si es tabla chica.
     * Para 'tabla' general, NO siempre wrappeamos porque puede ser la tabla
     * gigante de requerimientos (50+ filas) que NO debe ser unbreakable.
     */
    function maybeWrapUnbreakable(sec, titleBlock, tableBlocks) {
        const rowCount = (sec.filas || sec.preguntas || []).length;

        // tabla-info siempre wrappear si es chica
        if (TABLE_TYPES.includes(sec.tipo) && rowCount > 0 && rowCount <= 4) {
            return [{
                unbreakable: true,
                stack: [...titleBlock, ...tableBlocks]
            }];
        }

        // tabla generica: solo wrappear si tiene <=4 filas
        if (sec.tipo === 'tabla' && rowCount > 0 && rowCount <= 4) {
            return [{
                unbreakable: true,
                stack: [...titleBlock, ...tableBlocks]
            }];
        }

        return [...titleBlock, ...tableBlocks];
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('URS', function renderURS(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

                const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
                secciones.forEach((sec, idx) => {
            // Numeración:
            //   sec.numero === <int>  → usar ese (sincroniza contador)
            //   sec.numero === null   → título sin número (caja interna)
            //   subseccion            → no consume contador (su título trae el "X.Y")
            //   tabla sin título      → no consume contador
            //   default               → contador auto-incremental
            const num = numberer(sec);

            // Generar bloque de titulo
            let titleBlock = [];
            if (sec.tipo !== 'subseccion') {
                const titulo = sec.titulo
                    ? (num != null ? `${num}. ${sec.titulo}` : sec.titulo)
                    : null;
                if (titulo) {
                    titleBlock = tb.sectionTitle(titulo, { marginTop: idx === 0 ? 0 : 10 });
                }
            }

            // Generar bloque de contenido
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
                case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                default:
                    contentBlock = [{
                        text: `[Tipo de seccion desconocido: ${sec.tipo}]`,
                        color: '#FF0000',
                        margin: [0, 0, 0, 12]
                    }];
            }

            out.push(...maybeWrapUnbreakable(sec, titleBlock, contentBlock));
        });

        return out;
    });

})(window);
