/* ====================================================================
   VALIDATION SUITE — RENDERER EVIR
   Informe de Validación de Planilla de Cálculo (GxP/GAMP 5).

   Tipos específicos:
   - tabla-resumen-pruebas : Tabla de resultados con PASA/FALLA coloreado.
   - caja-estado-validacion : Caja prominente con estado final
     (APROBADA / APROBADA CON RESTRICCIONES / NO APROBADA).
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) { console.error('[evir.js] ValidationSuite no está cargado'); return; }

    const ESTADO_COLORS = {
        'APROBADA':                   { bg: '#EAFAF1', border: '#1E8449', text: '#1E8449' },
        'APROBADA CON RESTRICCIONES': { bg: '#FEF9E7', border: '#B7770D', text: '#B7770D' },
        'NO APROBADA':                { bg: '#FDECEA', border: '#C0392B', text: '#C0392B' }
    };

    function renderResumenPruebas(sec, tb) {
        const C = tb.VS_COLORS;
        const testCases = sec.testCases || [];

        const headerRow = [
            tb.vsTh('ID',                  { alignment: 'center' }),
            tb.vsTh('Descripción'),
            tb.vsTh('Resultado esperado'),
            tb.vsTh('Resultado real'),
            tb.vsTh('Resultado',           { alignment: 'center' }),
            tb.vsTh('Observaciones')
        ];
        const body = [headerRow];

        testCases.forEach((tc, i) => {
            const bg = i % 2 === 1 ? C.bgSoft : null;
            const pfVal = (tc.resultado || '').toUpperCase();
            const pfColor = pfVal === 'PASA' ? '#1E8449' : pfVal === 'FALLA' ? '#C0392B' : C.textSoft;
            const pfBg = pfVal === 'PASA' ? '#EAFAF1' : pfVal === 'FALLA' ? '#FDECEA' : bg;

            body.push([
                { text: tc.id || '', fontSize: 8, bold: true, alignment: 'center', fillColor: bg, margin: [2, 4, 2, 4] },
                { text: tc.descripcion || '', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4] },
                { text: tc.resultadoEsperado || '', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4] },
                { text: tc.resultadoReal || '', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4] },
                { text: pfVal || '—', fontSize: 8, bold: !!pfVal, color: pfColor, alignment: 'center', fillColor: pfBg, margin: [2, 4, 2, 4] },
                { text: tc.observaciones || '', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4], color: C.textSoft }
            ]);
        });

        return [{
            table: {
                widths: tb.vsScaleWidths([28, 110, 90, 90, 48, 89]),
                body,
                headerRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 0]
        }];
    }

    function renderCajaEstadoValidacion(sec, tb) {
        const C = tb.VS_COLORS;
        const estado = (sec.estado || 'NO APROBADA').toUpperCase();
        const col = ESTADO_COLORS[estado] || ESTADO_COLORS['NO APROBADA'];

        return [{
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'ESTADO DE VALIDACIÓN', fontSize: 9, bold: true, color: col.text, margin: [0, 0, 0, 6] },
                        { text: estado, fontSize: 16, bold: true, color: col.text, margin: [0, 0, 0, 10] },
                        { text: sec.contenido || '', fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.4 }
                    ],
                    fillColor: col.bg,
                    margin: [16, 14, 16, 14]
                }]]
            },
            layout: {
                hLineWidth: () => 2,
                vLineWidth: (i, node) => i === 0 ? 4 : (i === node.table.widths.length ? 2 : 0),
                hLineColor: () => col.border,
                vLineColor: () => col.border
            },
            margin: [0, 0, 0, 14]
        }];
    }

    function renderKPIBadge(resultados, tb) {
        if (!resultados) return [];
        const C = tb.VS_COLORS;
        const { totalTestCases = 0, pasados = 0, fallados = 0, pendientes = 0, fechaEjecucion, ejecutadoPor } = resultados;
        const pct = totalTestCases > 0 ? Math.round((pasados / totalTestCases) * 100) : 0;
        const pctColor = pct === 100 ? '#1E8449' : pct >= 80 ? '#B7770D' : '#C0392B';

        return [{
            table: {
                widths: ['*', '*', '*', '*'],
                body: [[
                    {
                        stack: [
                            { text: String(totalTestCases), fontSize: 20, bold: true, color: C.primary, alignment: 'center' },
                            { text: 'Total TCs', fontSize: 8, color: C.textSoft, alignment: 'center' }
                        ],
                        margin: [8, 8, 8, 8]
                    },
                    {
                        stack: [
                            { text: String(pasados), fontSize: 20, bold: true, color: '#1E8449', alignment: 'center' },
                            { text: 'Pasados', fontSize: 8, color: C.textSoft, alignment: 'center' }
                        ],
                        margin: [8, 8, 8, 8], fillColor: '#EAFAF1'
                    },
                    {
                        stack: [
                            { text: String(fallados), fontSize: 20, bold: true, color: fallados > 0 ? '#C0392B' : C.textSoft, alignment: 'center' },
                            { text: 'Fallados', fontSize: 8, color: C.textSoft, alignment: 'center' }
                        ],
                        margin: [8, 8, 8, 8], fillColor: fallados > 0 ? '#FDECEA' : null
                    },
                    {
                        stack: [
                            { text: pct + '%', fontSize: 20, bold: true, color: pctColor, alignment: 'center' },
                            { text: 'Aprobación', fontSize: 8, color: C.textSoft, alignment: 'center' }
                        ],
                        margin: [8, 8, 8, 8]
                    }
                ]],
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 6]
        }, {
            columns: [
                fechaEjecucion ? { text: [{ text: 'Fecha de ejecución: ', bold: true }, fechaEjecucion], fontSize: 9, width: '*' } : {},
                ejecutadoPor ? { text: [{ text: 'Ejecutado por: ', bold: true }, ejecutadoPor], fontSize: 9, width: '*', alignment: 'right' } : {}
            ],
            margin: [0, 0, 0, 14]
        }];
    }

    function renderSpreadsheetBadge(spreadsheet, tb) {
        if (!spreadsheet) return [];
        const C = tb.VS_COLORS;
        return [{
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: '📋 PLANILLA VALIDADA', fontSize: 9, bold: true, color: C.primary, margin: [0, 0, 0, 4] },
                        {
                            columns: [
                                { text: [{ text: 'Archivo: ', bold: true }, spreadsheet.fileName || '—'], fontSize: 9, width: '*' },
                                { text: [{ text: 'Versión: ', bold: true }, spreadsheet.version || '—'], fontSize: 9, width: 100, alignment: 'right' }
                            ]
                        }
                    ],
                    fillColor: C.bgBlueLight,
                    margin: [10, 8, 10, 8]
                }]]
            },
            layout: { hLineWidth: () => 1, vLineWidth: () => 0, hLineColor: () => C.secondary },
            margin: [0, 0, 0, 14]
        }];
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('EVIR', function renderEVIR(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        out.push(...renderSpreadsheetBadge(data.spreadsheet, tb));
        out.push(...renderKPIBadge(data.resultados, tb));

        const numberer = (VS.shared && VS.shared.createSectionNumberer)
            ? VS.shared.createSectionNumberer() : (() => null);

        secciones.forEach((sec, idx) => {
            const num = numberer(sec);
            let titleBlock = [];
            if (sec.tipo !== 'subseccion' && sec.tipo !== 'caja-estado-validacion') {
                const titulo = sec.titulo ? `${num}. ${sec.titulo}` : null;
                if (titulo) titleBlock = tb.sectionTitle(titulo, { marginTop: idx === 0 ? 0 : 10 });
            }

            let contentBlock = [];
            switch (sec.tipo) {
                case 'texto':                  contentBlock = shared.renderTexto(sec, tb); break;
                case 'tabla':                  contentBlock = shared.renderTabla(sec, tb); break;
                case 'tabla-info':             contentBlock = shared.renderTablaInfo(sec, tb); break;
                case 'subseccion':             contentBlock = shared.renderSubseccion(sec, tb); break;
                case 'caja-nota':              contentBlock = shared.renderCajaNota(sec, tb); break;
                case 'caja-criterio':          contentBlock = shared.renderCajaCriterio(sec, tb); break;
                case 'caja-conclusion':        contentBlock = shared.renderCajaConclusion(sec, tb); break;
                case 'tabla-resumen-pruebas':  contentBlock = renderResumenPruebas(sec, tb); break;
                case 'caja-estado-validacion': contentBlock = renderCajaEstadoValidacion(sec, tb); titleBlock = []; break;
                case 'tabla-firmas-final':
                    contentBlock = (shared.renderTablaFirmasFinalSmart)
                        ? shared.renderTablaFirmasFinalSmart(sec, tb, { numero: num, titulo: sec.titulo })
                        : [];
                    titleBlock = [];
                    break;
                default:
                    contentBlock = [{ text: `[Tipo desconocido: ${sec.tipo}]`, color: '#FF0000', margin: [0, 0, 0, 10] }];
            }
            out.push(...titleBlock, ...contentBlock);
        });

        return out;
    });

})(window);
