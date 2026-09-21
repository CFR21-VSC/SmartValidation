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

    // Tipos de tabla "chicos" para wrap unbreakable
    const TABLE_TYPES = ['tabla-info', 'tabla-decisiones-tc'];

    /**
     * Wrappear titulo+tabla en stack unbreakable si es tabla chica.
     * Para 'tabla' general, NO siempre wrappeamos porque puede ser la tabla
     * gigante de requerimientos (50+ filas) que NO debe ser unbreakable.
     */
    /** Celda compuesta: su contenido son varios bloques, no una linea de texto. */
    function _celdaCompuesta(c) {
        return c && typeof c === 'object' && !Array.isArray(c) &&
               (Array.isArray(c.stack) || Array.isArray(c.ul) || Array.isArray(c.ol) || Array.isArray(c.bullets));
    }
    function _tieneFilasCompuestas(sec) {
        return (sec.filas || []).some(function (f) {
            return Array.isArray(f) ? f.some(_celdaCompuesta)
                 : (f && typeof f === 'object' && Object.keys(f).some(function (k) { return _celdaCompuesta(f[k]); }));
        });
    }

    function maybeWrapUnbreakable(sec, titleBlock, tableBlocks) {
        const rowCount = (sec.filas || sec.preguntas || []).length;

        // Contar filas es un mal proxy de la altura: una tabla de UNA fila cuyas celdas
        // son stacks largos supera la pagina. Envuelta en `unbreakable`, pdfMake la
        // descarta entera y en silencio — asi desaparecia el "Resumen estadistico" del
        // URS (1 fila, 3 celdas con stacks). Si hay celdas compuestas, no se envuelve.
        if (_tieneFilasCompuestas(sec)) {
            return [...titleBlock, ...tableBlocks];
        }

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
                case 'firmas-horizontales': contentBlock = (VS.shared && VS.shared.renderFirmasHorizontal) ? VS.shared.renderFirmasHorizontal(sec, tb) : []; titleBlock = []; break;
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
