/* ====================================================================
   VALIDATION SUITE — RENDERER EVRA
   Evaluación de Riesgo de Planilla de Cálculo (GxP/GAMP 5).

   Tipos soportados además de los compartidos:
   - tabla-riesgos : Matriz de riesgos con probabilidad, severidad,
     riesgo inherente (coloreado), control propuesto y riesgo residual.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) { console.error('[evra.js] ValidationSuite no está cargado'); return; }

    // Colores de nivel de riesgo
    const RISK_COLORS = {
        Alto:  { bg: '#FDECEA', text: '#C0392B', bold: true },
        Medio: { bg: '#FEF9E7', text: '#B7770D', bold: true },
        Bajo:  { bg: '#EAFAF1', text: '#1E8449', bold: true }
    };

    function riskCell(nivel, tb) {
        const C = RISK_COLORS[nivel] || { bg: '#F5F5F5', text: '#555', bold: false };
        return {
            text: nivel || '—',
            fontSize: 9,
            bold: C.bold,
            color: C.text,
            fillColor: C.bg,
            alignment: 'center',
            margin: [2, 3, 2, 3]
        };
    }

    function renderTablaRiesgos(sec, tb) {
        const C = tb.VS_COLORS;
        const riesgos = sec.riesgos || [];

        const headerRow = [
            tb.vsTh('ID',            { alignment: 'center' }),
            tb.vsTh('Categoría'),
            tb.vsTh('Descripción / Causa / Efecto GxP'),
            tb.vsTh('P',             { alignment: 'center' }),
            tb.vsTh('S',             { alignment: 'center' }),
            tb.vsTh('R.I.',          { alignment: 'center' }),
            tb.vsTh('Control propuesto'),
            tb.vsTh('R.R.',          { alignment: 'center' })
        ];

        const body = [headerRow];

        riesgos.forEach((r, i) => {
            const bg = i % 2 === 1 ? C.bgSoft : null;
            const desc = [
                r.descripcion || '',
                r.causa ? `\nCausa: ${r.causa}` : '',
                r.efectoGxP ? `\nEfecto GxP: ${r.efectoGxP}` : ''
            ].join('');

            body.push([
                tb.vsTd(r.id || '', { alignment: 'center', bold: true, fillColor: bg, fontSize: 8 }),
                tb.vsTd(r.categoria || '', { fillColor: bg, fontSize: 8, bold: true }),
                { text: desc, fontSize: 8, fillColor: bg, margin: [4, 3, 4, 3], lineHeight: 1.3 },
                riskCell(r.probabilidad, tb),
                riskCell(r.severidad, tb),
                riskCell(r.riesgoInherente, tb),
                { text: r.control || '', fontSize: 8, fillColor: bg, margin: [4, 3, 4, 3], lineHeight: 1.3 },
                riskCell(r.riesgoResidual, tb)
            ]);
        });

        const out = [];

        // Leyenda P/S/RI/RR
        out.push({
            text: [
                { text: 'P', bold: true }, ' = Probabilidad   ',
                { text: 'S', bold: true }, ' = Severidad   ',
                { text: 'R.I.', bold: true }, ' = Riesgo Inherente   ',
                { text: 'R.R.', bold: true }, ' = Riesgo Residual'
            ],
            fontSize: 8, color: C.textSoft, margin: [0, 0, 0, 6]
        });

        out.push({
            table: {
                widths: tb.vsScaleWidths([28, 70, 135, 22, 22, 28, 110, 28]),
                body,
                headerRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 0]
        });

        return out;
    }

    // Encabezado de la planilla (aparece después de la portada)
    function renderSpreadsheetBadge(spreadsheet, tb) {
        if (!spreadsheet) return [];
        const C = tb.VS_COLORS;
        return [{
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: '📋 PLANILLA EVALUADA', fontSize: 9, bold: true, color: C.primary, margin: [0, 0, 0, 4] },
                        {
                            columns: [
                                { text: [{ text: 'Archivo: ', bold: true }, spreadsheet.fileName || '—'], fontSize: 9, width: '*' },
                                { text: [{ text: 'Categoría GAMP: ', bold: true }, spreadsheet.gampCategory || 'Cat 4'], fontSize: 9, width: 120, alignment: 'right' }
                            ]
                        },
                        { text: [{ text: 'Propósito: ', bold: true }, spreadsheet.purpose || '—'], fontSize: 9, margin: [0, 2, 0, 0] }
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
    VS.registerRenderer('EVRA', function renderEVRA(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        // Badge de planilla evaluada
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
                case 'tabla-riesgos':      contentBlock = renderTablaRiesgos(sec, tb); break;
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
