/* ====================================================================
   VALIDATION SUITE — RENDERER EVPROT
   Protocolo de Validación de Planilla de Cálculo (GxP/GAMP 5).

   Tipos soportados además de los compartidos:
   - tabla-test-cases : Tabla de casos de prueba con columnas de
     ejecución (resultado real, PASA/FALLA, observaciones).
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) { console.error('[evprot.js] ValidationSuite no está cargado'); return; }

    function renderTablaTestCases(sec, tb) {
        const C = tb.VS_COLORS;
        const testCases = sec.testCases || [];

        const headerRow = [
            tb.vsTh('ID',                  { alignment: 'center' }),
            tb.vsTh('Descripción / Procedimiento'),
            tb.vsTh('Entradas'),
            tb.vsTh('Resultado esperado'),
            tb.vsTh('Resultado real'),
            tb.vsTh('P/F',                 { alignment: 'center' }),
            tb.vsTh('Obs.')
        ];

        const body = [headerRow];

        testCases.forEach((tc, i) => {
            const bg = i % 2 === 1 ? C.bgSoft : null;

            // Procedimiento puede tener \n para pasos numerados
            const procLines = (tc.procedimiento || '').split('\n').filter(Boolean);
            const procContent = procLines.length > 1
                ? procLines.map((l, pi) => ({ text: l + (pi < procLines.length - 1 ? '\n' : ''), fontSize: 8 }))
                : tc.procedimiento || '';

            const descStack = [
                { text: tc.descripcion || '', fontSize: 8, bold: true, margin: [0, 0, 0, 3] },
                typeof procContent === 'string'
                    ? { text: procContent, fontSize: 8, color: C.textSoft }
                    : { stack: procContent, color: C.textSoft }
            ];

            // Resultado: vacío para ejecución manual, o coloreado si ya tiene valor
            const pfVal = (tc.resultado || '').toUpperCase();
            const pfColor = pfVal === 'PASA' ? '#1E8449' : pfVal === 'FALLA' ? '#C0392B' : C.textSoft;

            body.push([
                { text: tc.id || '', fontSize: 8, bold: true, alignment: 'center', fillColor: bg, margin: [2, 4, 2, 4] },
                { stack: descStack, fillColor: bg, margin: [4, 4, 4, 4] },
                { text: tc.entradas || 'N/A', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4] },
                { text: tc.resultadoEsperado || '', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4] },
                { text: tc.resultadoReal || '', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4], color: C.textSoft, italics: !tc.resultadoReal },
                { text: pfVal || '', fontSize: 8, bold: !!pfVal, color: pfColor, alignment: 'center', fillColor: bg, margin: [2, 4, 2, 4] },
                { text: tc.observaciones || '', fontSize: 8, fillColor: bg, margin: [4, 4, 4, 4], color: C.textSoft }
            ]);
        });

        return [{
            table: {
                widths: tb.vsScaleWidths([28, 140, 60, 80, 72, 24, 51]),
                body,
                headerRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 0]
        }];
    }

    // Igual que evra.js — badge de planilla
    function renderSpreadsheetBadge(spreadsheet, tb) {
        if (!spreadsheet) return [];
        const C = tb.VS_COLORS;
        return [{
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: '📋 PLANILLA', fontSize: 9, bold: true, color: C.primary, margin: [0, 0, 0, 4] },
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
    VS.registerRenderer('EVPROT', function renderEVPROT(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        out.push(...renderSpreadsheetBadge(data.spreadsheet, tb));

        const numberer = (VS.shared && VS.shared.createSectionNumberer)
            ? VS.shared.createSectionNumberer() : (() => null);

        secciones.forEach((sec, idx) => {
            const num = numberer(sec);
            let titleBlock = [];
            if (sec.tipo !== 'subseccion') {
                const titulo = sec.titulo ? `${num}. ${sec.titulo}` : null;
                if (titulo) titleBlock = tb.sectionTitle(titulo, { marginTop: idx === 0 ? 0 : 10 });
            }

            let contentBlock = [];
            switch (sec.tipo) {
                case 'texto':              contentBlock = shared.renderTexto(sec, tb); break;
                case 'tabla':              contentBlock = shared.renderTabla(sec, tb); break;
                case 'tabla-info':         contentBlock = shared.renderTablaInfo(sec, tb); break;
                case 'subseccion':         contentBlock = shared.renderSubseccion(sec, tb); break;
                case 'caja-nota':          contentBlock = shared.renderCajaNota(sec, tb); break;
                case 'caja-criterio':      contentBlock = shared.renderCajaCriterio(sec, tb); break;
                case 'caja-conclusion':    contentBlock = shared.renderCajaConclusion(sec, tb); break;
                case 'tabla-test-cases':   contentBlock = renderTablaTestCases(sec, tb); break;
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
