/* ====================================================================
   VALIDATION SUITE — RENDERER FRS
   Functional Requirements Specification (Especificacion de Requerimientos
   Funcionales). Documento tipico de GAMP 4/5 que traduce los URS a
   requerimientos tecnicos verificables.

   Estructura tipica del FRS:
   1. Proposito
   2. Alcance
   3. Responsabilidades
   4. Definiciones
   5. Referencia URS (trazabilidad)
   6. Requerimientos funcionales por modulo (tabla gigante con sub-headers)
   7. Interfaces y dependencias
   8. Performance
   9. Seguridad funcional
   10. Manejo de errores
   11. Criterios de aceptacion
   12. Referencias
   13. Firmas

   Tipos soportados: TODOS los compartidos (texto, tabla, tabla-info,
   subseccion, lista-incluido-excluido, caja-nota, caja-justificacion,
   caja-criterio, caja-conclusion, tabla-firmas-final).

   Tipo especifico:
   - flujo-logico : Documenta algoritmos / reglas de negocio / logica
     funcional con trigger + pasos numerados + decisiones (si/entonces)
     + ejemplo. Util para FRS "extendido" en GAMP 4 (vendor) cuando es
     valioso explicar la algoritmia configurada (ej. SAP EWM putaway,
     LIMS workflow OOS) o en GAMP 5 custom para definir la logica
     funcional verificable.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[frs.js] ValidationSuite no esta cargado');
        return;
    }

    // tabla-firmas-final (compartido con HLRA/VP/URS)
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

    // ====================================================================
    // TIPO NUEVO: FLUJO-LOGICO (algoritmos / reglas de negocio)
    //
    // Estructura JSON:
    // {
    //   "tipo": "flujo-logico",
    //   "titulo": "7. REGLAS DE NEGOCIO Y LOGICA FUNCIONAL",
    //   "intro": "...",
    //   "algoritmos": [
    //     {
    //       "id": "ALG-001",
    //       "nombre": "Nombre del algoritmo",
    //       "frsAsociados": "FRS-001, FRS-002",
    //       "trigger": "Que dispara el algoritmo (evento)",
    //       "pasos": [ "Paso 1...", "Paso 2...", ... ],
    //       "decisiones": [
    //         { "condicion": "Si X", "accion": "entonces Y" },
    //         ...
    //       ],
    //       "ejemplo": "Texto opcional con un ejemplo concreto"
    //     }
    //   ]
    // }
    // ====================================================================
    function renderFlujoLogico(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        const algoritmos = sec.algoritmos || [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 12]
            });
        }

        algoritmos.forEach((alg, idx) => {
            const blockChildren = [];

            // Header: ID + nombre + FRS
            const headerSpans = [];
            if (alg.id) headerSpans.push({ text: alg.id + '  ', bold: true, color: C.primary });
            headerSpans.push({ text: alg.nombre || 'Algoritmo', bold: true, color: C.text });
            if (alg.frsAsociados) headerSpans.push({ text: '   (' + alg.frsAsociados + ')', italics: true, fontSize: 9, color: C.textSoft });

            blockChildren.push({
                text: headerSpans,
                fontSize: 11,
                margin: [0, 0, 0, 6]
            });

            // Trigger (caja con fondo soft)
            if (alg.trigger) {
                blockChildren.push({
                    table: {
                        widths: ['*'],
                        body: [[{
                            text: [
                                { text: 'Trigger:  ', bold: true, color: C.primary, fontSize: 9 },
                                { text: alg.trigger, fontSize: 9, color: C.text }
                            ],
                            margin: [8, 4, 8, 4],
                            fillColor: C.bgSoft
                        }]]
                    },
                    layout: 'noBorders',
                    margin: [0, 0, 0, 6]
                });
            }

            // Tabla de pasos numerados
            if (alg.pasos && alg.pasos.length > 0) {
                const body = [[
                    tb.vsTh('#', { alignment: 'center' }),
                    tb.vsTh('Paso lógico')
                ]];
                alg.pasos.forEach((p, i) => {
                    const bg = i % 2 === 1 ? C.bgSoft : null;
                    const numero = (typeof p === 'object' && p.n != null) ? p.n : (i + 1);
                    const accion = (typeof p === 'object') ? (p.accion || p.text || '') : p;
                    body.push([
                        tb.vsTd(String(numero), { alignment: 'center', bold: true, fillColor: bg, fontSize: 9 }),
                        tb.vsTd(accion, { fillColor: bg, fontSize: 9 })
                    ]);
                });
                blockChildren.push({
                    table: { widths: tb.vsScaleWidths([25, 430]), body: body, headerRows: 1, dontBreakRows: true },
                    layout: tb.vsTableLayout(),
                    margin: [0, 0, 0, 6]
                });
            }

            // Tabla de decisiones (si/entonces)
            if (alg.decisiones && alg.decisiones.length > 0) {
                const body = [[
                    tb.vsTh('Condición'),
                    tb.vsTh('Acción')
                ]];
                alg.decisiones.forEach((d, i) => {
                    const bg = i % 2 === 1 ? C.bgSoft : null;
                    const cond = Array.isArray(d) ? d[0] : (d.condicion || '');
                    const acc = Array.isArray(d) ? d[1] : (d.accion || '');
                    body.push([
                        tb.vsTd(cond, { fillColor: bg, fontSize: 9 }),
                        tb.vsTd(acc, { fillColor: bg, fontSize: 9 })
                    ]);
                });
                blockChildren.push({
                    table: { widths: tb.vsScaleWidths([200, 255]), body: body, headerRows: 1, dontBreakRows: true },
                    layout: tb.vsTableLayout(),
                    margin: [0, 0, 0, 6]
                });
            }

            // Ejemplo (caja con borde verde a la izquierda)
            if (alg.ejemplo) {
                blockChildren.push({
                    table: {
                        widths: ['*'],
                        body: [[{
                            text: [
                                { text: 'Ejemplo:  ', bold: true, color: C.accent, fontSize: 9 },
                                { text: alg.ejemplo, italics: true, fontSize: 9, color: C.text }
                            ],
                            margin: [10, 5, 8, 5]
                        }]]
                    },
                    layout: {
                        hLineWidth: () => 0,
                        vLineWidth: function (i) { return i === 0 ? 3 : 0; },
                        vLineColor: () => C.accent,
                        paddingLeft: () => 0,
                        paddingRight: () => 0,
                        paddingTop: () => 0,
                        paddingBottom: () => 0
                    },
                    margin: [0, 0, 0, 0]
                });
            }

            // Cada algoritmo va en un bloque "unbreakable" si es chico (<= 8 pasos)
            const totalRows = (alg.pasos || []).length + (alg.decisiones || []).length;
            if (totalRows <= 8) {
                out.push({
                    unbreakable: true,
                    stack: blockChildren,
                    margin: [0, 0, 0, idx === algoritmos.length - 1 ? 0 : 12]
                });
            } else {
                blockChildren[blockChildren.length - 1].margin = blockChildren[blockChildren.length - 1].margin || [0, 0, 0, 0];
                blockChildren[blockChildren.length - 1].margin[3] = idx === algoritmos.length - 1 ? 0 : 12;
                out.push(...blockChildren);
            }
        });

        return out;
    }

    // Wrap unbreakable solo para tablas chicas (<=6 filas)
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
    VS.registerRenderer('FRS', function renderFRS(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

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
                case 'flujo-logico': contentBlock = renderFlujoLogico(sec, tb); break;
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
