/* ====================================================================
   VALIDATION SUITE — RENDERER VSR
   Validation Summary Report (Reporte Maestro de Validación).

   Documento ejecutivo final que consolida TODO el ciclo de validación
   en un solo entregable. Se emite tras la aprobación del RPQ y
   funciona como el "doc carátula" del paquete de validación entero.

   Diferencia clave vs reportes RIQ/ROQ/RPQ:
     - Los reportes R* liberan FASE individual (IQ, OQ, PQ).
     - El VSR es la liberación COMPLETA del sistema validado. Un único
       documento que un auditor regulatorio lee primero.

   Estructura típica (5-8 páginas):
     1. Portada con bandera "SISTEMA VALIDADO" + decisión global.
     2. Identificación + alcance del sistema validado.
     3. Resumen ejecutivo (KPIs globales del paquete).
     4. Inventario del paquete documental (todos los docs con estado).
     5. Trazabilidad URS↔TC consolidada (de matrix-builder).
     6. Cronología del ciclo (timeline 4 fases).
     7. Hallazgos y CAPAs consolidados.
     8. Decisión final de validación + autorización GxP.
     9. Firmas ejecutivas finales (Sponsor, Director Técnico, QA Manager).

   Tipos de sección específicos:
     - vsr-portada-final          : banner enorme "SISTEMA VALIDADO"
     - vsr-inventario-paquete     : tabla con todos los docs y estado
     - vsr-cronologia-fases       : timeline visual 4 fases
     - vsr-hallazgos-resumen      : consolidado de NCs ciclo completo
     - vsr-decision-final         : caja grande con autorización formal

   Reusa de release-report.js:
     - release-resumen-ejecutivo  : KPIs grid
     - release-trazabilidad-cierre: cuando se quiere repetir docs
     - tabla-firmas-final         : firmas ejecutivas
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[vsr.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // SECCIÓN: PORTADA FINAL — banner "SISTEMA VALIDADO"
    // ====================================================================
    function renderPortadaFinal(sec, tb, data) {
        const C = tb.VS_COLORS;
        const decision = sec.decision || (data.document && data.document.extras && data.document.extras['Decisión']) || 'PENDIENTE';
        const dec = String(decision).toUpperCase();
        const aprobado = /VALID|APROB|LIBER/.test(dec);
        const conObs = /CONDIC|OBS/.test(dec);

        const bg = aprobado && !conObs ? '#1E7E34'
            : conObs ? '#B85F0F'
            : aprobado ? '#1E7E34'
            : '#A52A2A';
        const titleLabel = aprobado && !conObs ? 'SISTEMA VALIDADO'
            : conObs ? 'SISTEMA VALIDADO CON CONDICIONES'
            : aprobado ? 'SISTEMA VALIDADO'
            : 'VALIDACIÓN NO COMPLETADA';

        const out = [];

        // Banner principal
        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'REPORTE MAESTRO DE VALIDACIÓN', fontSize: 11, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 2] },
                        { text: 'CICLO COMPLETO DEL PAQUETE', fontSize: 12, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 10] },
                        { text: titleLabel, fontSize: 26, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 6] },
                        sec.subtitulo
                            ? { text: sec.subtitulo, fontSize: 11, italics: true, color: '#FFFFFF', alignment: 'center' }
                            : null,
                        { text: 'Sistema autorizado para uso productivo GxP bajo el alcance del paquete documental.', fontSize: 10, color: '#FFFFFF', alignment: 'center', italics: true, margin: [0, 6, 0, 0] }
                    ].filter(Boolean),
                    fillColor: bg,
                    margin: [22, 28, 22, 28]
                }]]
            },
            layout: {
                hLineWidth: () => 2.5, vLineWidth: () => 2.5,
                hLineColor: () => bg, vLineColor: () => bg
            },
            margin: [0, 0, 0, 14]
        });

        // Stats al pie del banner
        const stats = sec.statsResumen;
        if (stats) {
            const items = [
                { label: 'Documentos del paquete', value: stats.totalDocs || '—' },
                { label: 'TCs ejecutados (ciclo)', value: stats.totalTcs || '—' },
                { label: 'Cobertura URS', value: stats.cobertura != null ? (stats.cobertura + '%') : '—' },
                { label: 'NCs gestionadas', value: stats.ncsGestionadas != null ? stats.ncsGestionadas : '—' }
            ];
            const cells = items.map(it => ({
                stack: [
                    { text: it.label, fontSize: 8.5, color: C.textSoft, alignment: 'center', margin: [0, 5, 0, 2] },
                    { text: String(it.value), fontSize: 16, bold: true, color: C.primary, alignment: 'center', margin: [0, 0, 0, 5] }
                ],
                fillColor: '#F4F6F8'
            }));
            out.push({
                table: { widths: ['*', '*', '*', '*'], body: [cells] },
                layout: tb.vsTableLayout(),
                margin: [0, 0, 0, 12]
            });
        }

        return out;
    }

    // ====================================================================
    // SECCIÓN: INVENTARIO DEL PAQUETE DOCUMENTAL
    // ====================================================================
    function renderInventarioPaquete(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const docs = sec.documentos || [];
        if (docs.length === 0) {
            out.push({ text: '— Sin documentos en el inventario. —', fontSize: 10, italics: true, color: C.textSoft, alignment: 'center', margin: [0, 8, 0, 12] });
            return out;
        }

        // Agrupar por fase del ciclo
        const PHASE_ORDER = ['HLRA', 'VP', 'URS', 'FRS', 'DS', 'RA', 'IRA', 'RRM', 'MTR', 'PIQ', 'IIQ', 'RIQ', 'POQ', 'IOQ', 'NCR', 'ROQ', 'PPQ', 'IPQ', 'RPQ', 'AEX'];
        const docPhase = {
            'HLRA': 'Pre-validación', 'VP': 'Pre-validación', 'URS': 'Pre-validación', 'FRS': 'Pre-validación', 'DS': 'Pre-validación',
            'RA': 'Análisis de riesgo', 'IRA': 'Análisis de riesgo', 'RRM': 'Análisis de riesgo', 'MTR': 'Análisis de riesgo',
            'PIQ': 'Instalación (IQ)', 'IIQ': 'Instalación (IQ)', 'RIQ': 'Instalación (IQ)',
            'POQ': 'Operacional (OQ)', 'IOQ': 'Operacional (OQ)', 'NCR': 'Operacional (OQ)', 'ROQ': 'Operacional (OQ)',
            'PPQ': 'Performance (PQ)', 'IPQ': 'Performance (PQ)', 'RPQ': 'Performance (PQ)',
            'AEX': 'Evidencias'
        };

        const sortedDocs = [...docs].sort((a, b) => {
            const ia = PHASE_ORDER.indexOf(a.tipo);
            const ib = PHASE_ORDER.indexOf(b.tipo);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });

        const body = [[
            tb.vsTh('Fase', { alignment: 'center' }),
            tb.vsTh('Tipo', { alignment: 'center' }),
            tb.vsTh('Código'),
            tb.vsTh('Versión', { alignment: 'center' }),
            tb.vsTh('Estado', { alignment: 'center' }),
            tb.vsTh('Observación')
        ]];

        sortedDocs.forEach((d, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const estadoLabel = String(d.estado || '').toUpperCase();
            const estColor = /APROB|CERR/.test(estadoLabel) ? '#1E7E34'
                : /PEND|ABIERT/.test(estadoLabel) ? '#A52A2A'
                : C.text;
            const fase = docPhase[d.tipo] || 'Otros';
            body.push([
                tb.vsTd(fase, { fillColor: bg, fontSize: 8.5, alignment: 'center', italics: true, color: C.textSoft }),
                tb.vsTd(d.tipo || '—', { fillColor: bg, alignment: 'center', bold: true, fontSize: 9, color: C.primary }),
                tb.vsTd(d.codigo || '—', { fillColor: bg, fontSize: 9, bold: true }),
                tb.vsTd(d.version || '—', { fillColor: bg, alignment: 'center', fontSize: 9 }),
                tb.vsTd(d.estado || '—', { fillColor: bg, alignment: 'center', bold: true, fontSize: 8.5, color: estColor }),
                tb.vsTd(d.observacion || '—', { fillColor: bg, fontSize: 8.5, italics: !d.observacion })
            ]);
        });

        out.push({
            table: { widths: [85, 35, 105, 38, 60, '*'], body, headerRows: 1, dontBreakRows: true },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        return out;
    }

    // ====================================================================
    // SECCIÓN: CRONOLOGÍA DE FASES (timeline visual)
    // ====================================================================
    function renderCronologiaFases(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const fases = sec.fases || [
            { codigo: 'IQ', label: 'Instalación', cierre: '', estado: 'pendiente' },
            { codigo: 'OQ', label: 'Operacional', cierre: '', estado: 'pendiente' },
            { codigo: 'PQ', label: 'Performance', cierre: '', estado: 'pendiente' },
            { codigo: 'VSR', label: 'Validación completa', cierre: '', estado: 'pendiente' }
        ];

        // Renderear como 4 columnas con conectores
        const row = [];
        fases.forEach((f, i) => {
            const estadoLabel = String(f.estado || '').toUpperCase();
            const aprobada = /APROB|CERR|VALID/.test(estadoLabel);
            const bg = aprobada ? '#E8F5E9' : '#F4F6F8';
            const colorAcento = aprobada ? '#1E7E34' : C.textSoft;
            row.push({
                width: '*',
                stack: [
                    {
                        text: f.codigo || '—',
                        fontSize: 14, bold: true, alignment: 'center', color: colorAcento, margin: [0, 6, 0, 2]
                    },
                    {
                        text: f.label || '',
                        fontSize: 9, bold: true, alignment: 'center', color: C.text, margin: [0, 0, 0, 2]
                    },
                    {
                        text: f.cierre || '—',
                        fontSize: 8.5, italics: true, alignment: 'center', color: C.textSoft, margin: [0, 0, 0, 4]
                    },
                    {
                        text: aprobada ? 'CERRADA' : (f.estado || 'PENDIENTE').toUpperCase(),
                        fontSize: 8, bold: true, alignment: 'center',
                        color: '#FFFFFF', fillColor: aprobada ? '#1E7E34' : '#717D8A',
                        margin: [0, 0, 0, 6]
                    }
                ],
                fillColor: bg
            });
            if (i < fases.length - 1) {
                const aprobadaSig = aprobada;
                row.push({
                    width: 16,
                    text: aprobadaSig ? '→' : '⋯',
                    fontSize: 16, bold: true, alignment: 'center',
                    color: aprobadaSig ? '#1E7E34' : C.textSoft,
                    margin: [0, 22, 0, 0]
                });
            }
        });

        out.push({
            columns: row,
            margin: [0, 0, 0, 14]
        });

        return out;
    }

    // ====================================================================
    // SECCIÓN: HALLAZGOS Y CAPAs CONSOLIDADOS
    // ====================================================================
    function renderHallazgosResumen(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const items = sec.hallazgos || [];
        if (items.length === 0) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: 'Sin hallazgos en el ciclo. La validación se completó sin desvíos identificados.',
                        bold: true, fontSize: 10, color: '#1E7E34',
                        fillColor: '#E8F5E9', alignment: 'center',
                        margin: [12, 10, 12, 10]
                    }]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 4 : 0, vLineColor: () => '#1E7E34' },
                margin: [0, 0, 0, 12]
            });
            return out;
        }

        // KPI mini-cards (top) — usar tabla (fillColor no aplica en columns)
        const cerradas = items.filter(h => /CERR/.test(String(h.estado || '').toUpperCase())).length;
        const abiertas = items.length - cerradas;
        const criticas = items.filter(h => /CR[ÍI]TIC|MAYOR|ALTO/.test(String(h.criticidad || h.severidad || '').toUpperCase())).length;

        const kpiCell = (label, value, color, bg) => ({
            stack: [
                { text: label, fontSize: 8.5, color: C.textSoft, alignment: 'center', margin: [0, 4, 0, 2] },
                { text: String(value), fontSize: 16, bold: true, color, alignment: 'center', margin: [0, 0, 0, 4] }
            ],
            fillColor: bg
        });
        out.push({
            table: {
                widths: ['*', '*', '*', '*'],
                body: [[
                    kpiCell('Total NCs ciclo', items.length, C.primary, '#F4F6F8'),
                    kpiCell('Cerradas', cerradas, '#1E7E34', '#E8F5E9'),
                    kpiCell('Abiertas', abiertas, abiertas > 0 ? '#A52A2A' : '#1E7E34', abiertas > 0 ? '#FDECEA' : '#F4F6F8'),
                    kpiCell('Críticas', criticas, criticas > 0 ? '#A52A2A' : C.text, '#F4F6F8')
                ]]
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 10]
        });

        // Tabla detalle — widths ajustados (suma 470, cabe en A4 portrait 510)
        // SIN dontBreakRows: permite que filas con descripciones largas se dividan
        // entre páginas en vez de saltar pesado y dejar whitespace.
        const body = [[
            tb.vsTh('NC-ID', { alignment: 'center' }),
            tb.vsTh('Criticidad', { alignment: 'center' }),
            tb.vsTh('TC origen', { alignment: 'center' }),
            tb.vsTh('Descripción / Causa raíz'),
            tb.vsTh('Acción Correctiva (CAPA)'),
            tb.vsTh('Estado', { alignment: 'center' })
        ]];
        items.forEach((h, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const est = String(h.estado || '').toUpperCase();
            const estColor = /CERR/.test(est) ? '#1E7E34' : /ABIERT|PEND/.test(est) ? '#A52A2A' : '#717D8A';
            const crit = String(h.criticidad || h.severidad || '').toUpperCase();
            const critColor = /CR[ÍI]TIC|MAYOR|ALTO/.test(crit) ? '#A52A2A' : /OBS|MENOR|BAJ/.test(crit) ? '#B85F0F' : '#717D8A';
            body.push([
                tb.vsTd(h.id || '—', { fillColor: bg, bold: true, alignment: 'center', fontSize: 8, color: '#A52A2A' }),
                tb.vsTd(h.criticidad || h.severidad || '—', { fillColor: bg, bold: true, alignment: 'center', fontSize: 7.5, color: critColor }),
                tb.vsTd(h.tcRef || '—', { fillColor: bg, alignment: 'center', italics: true, fontSize: 7.5 }),
                tb.vsTd(h.descripcion || '—', { fillColor: bg, fontSize: 8, lineHeight: 1.25 }),
                tb.vsTd(h.accion || h.accionCorrectiva || '—', { fillColor: bg, fontSize: 8, lineHeight: 1.25 }),
                tb.vsTd(h.estado || '—', { fillColor: bg, bold: true, alignment: 'center', fontSize: 7.5, color: estColor })
            ]);
        });

        out.push({
            // Sin dontBreakRows: filas con descripcion + accion largas pueden dividirse
            // entre paginas en lugar de saltar pesado y dejar whitespace.
            // vsScaleWidths compensa el padding 12pt/celda no incluido en widths.
            table: { widths: tb.vsScaleWidths([38, 50, 42, 135, 155, 48]), body, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 10]
        });

        return out;
    }

    // ====================================================================
    // SECCIÓN: DECISIÓN FINAL DE VALIDACIÓN
    // ====================================================================
    function renderDecisionFinal(sec, tb, data) {
        const C = tb.VS_COLORS;
        const decision = sec.decision || (data.document && data.document.extras && data.document.extras['Decisión']) || 'PENDIENTE';
        const dec = String(decision).toUpperCase();
        const aprobado = /VALID|APROB|LIBER/.test(dec);
        const conCond = /CONDIC/.test(dec);
        const bg = aprobado ? '#1E7E34' : '#A52A2A';
        const label = aprobado ? (conCond ? 'SISTEMA VALIDADO CON CONDICIONES' : 'SISTEMA VALIDADO Y AUTORIZADO') : 'VALIDACIÓN NO COMPLETADA';
        const textoFormal = sec.textoFormal || (
            aprobado
                ? `Por la presente se declara formalmente que el sistema ha completado satisfactoriamente el ciclo de validación bajo el alcance del paquete documental. Se AUTORIZA su uso productivo GxP. El sistema queda registrado como validado conforme a los marcos normativos referenciados, hasta su próxima revalidación periódica o por cambio significativo.`
                : `El ciclo de validación NO se completó conforme a los criterios establecidos. El sistema NO está autorizado para uso productivo GxP hasta la resolución de los desvíos identificados.`
        );

        const out = [];
        out.push({
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'AUTORIZACIÓN FORMAL DEL SISTEMA', fontSize: 11, bold: true, color: bg, alignment: 'center', margin: [0, 0, 0, 6] },
                        { text: label, fontSize: 18, bold: true, color: bg, alignment: 'center', margin: [0, 0, 0, 8] },
                        { text: textoFormal, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.5 }
                    ],
                    fillColor: aprobado ? '#E8F5E9' : '#FDECEA',
                    margin: [18, 14, 18, 14]
                }]]
            },
            layout: {
                hLineWidth: () => 2, vLineWidth: () => 2,
                hLineColor: () => bg, vLineColor: () => bg
            },
            margin: [0, 0, 0, 14]
        });

        // Marco de validez
        if (sec.validez) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        columns: [
                            { width: 'auto', text: 'Validez:', fontSize: 9, bold: true, color: C.text, margin: [0, 2, 0, 0] },
                            { width: '*', text: sec.validez, fontSize: 10, color: C.text, italics: true, margin: [6, 2, 0, 0] }
                        ],
                        fillColor: '#EAF1F8',
                        margin: [12, 8, 12, 8]
                    }]]
                },
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: (i) => i === 0 ? 3 : 0,
                    vLineColor: () => C.primary
                },
                margin: [0, 0, 0, 14]
            });
        }

        return out;
    }

    // ====================================================================
    // AUTO-RELLENO DESDE EL PAQUETE EN RUNTIME
    // ====================================================================
    function autoFillVSR(data) {
        const pkgDocs = (Array.isArray(global.packageDocs)) ? global.packageDocs : [];
        if (pkgDocs.length === 0) return;
        if (!VS.matrixBuilder) return;
        const mb = VS.matrixBuilder;

        let matrix = null;
        function ensureMatrix() {
            if (matrix) return matrix;
            try { matrix = mb.build({ packageDocs: pkgDocs, tests: [], groups: [], protocols: [] }); }
            catch (e) { matrix = null; }
            return matrix;
        }

        // Auto-llenar stats de la portada si están vacíos
        const portada = (data.secciones || []).find(s => s.tipo === 'vsr-portada-final');
        if (portada && (!portada.statsResumen || Object.keys(portada.statsResumen).length === 0)) {
            const m = ensureMatrix();
            if (m && m.kpis) {
                portada.statsResumen = {
                    totalDocs: pkgDocs.length,
                    totalTcs: m.kpis.totalTcsEjecutados,
                    cobertura: m.kpis.cobertura,
                    ncsGestionadas: m.kpis.hallazgosTotal
                };
            }
        }

        // Inventario de paquete
        const inv = (data.secciones || []).find(s => s.tipo === 'vsr-inventario-paquete');
        if (inv && Array.isArray(inv.documentos) && inv.documentos.length === 0) {
            inv.documentos = pkgDocs.map(d => ({
                codigo: d.code,
                tipo: d.type,
                version: d.version,
                estado: ((d.data && d.data.document && d.data.document.status) || 'Aprobado'),
                observacion: d.title || ''
            }));
        }

        // Resumen ejecutivo (delegar al helper de release-report)
        const resumen = (data.secciones || []).find(s => s.tipo === 'release-resumen-ejecutivo');
        if (resumen && resumen.kpis) {
            const empty = resumen.kpis.totalTcsEjecutados == null && resumen.kpis.pass == null;
            if (empty) {
                const m = ensureMatrix();
                if (m && m.kpis) {
                    let critAb = 0;
                    pkgDocs.forEach(d => mb.extractHallazgos(d).forEach(h => {
                        const c = String(h.criticidad || h.severidad || '').toUpperCase();
                        const e = String(h.estado || '').toUpperCase();
                        if (/CR[ÍI]TIC|MAYOR|ALTO/.test(c) && !/CERR/.test(e)) critAb++;
                    }));
                    resumen.kpis = Object.assign({}, m.kpis, { criticasAbiertas: critAb });
                }
            }
        }

        // Hallazgos resumen
        const hallSec = (data.secciones || []).find(s => s.tipo === 'vsr-hallazgos-resumen');
        if (hallSec && Array.isArray(hallSec.hallazgos) && hallSec.hallazgos.length === 0) {
            const all = [];
            pkgDocs.forEach(d => mb.extractHallazgos(d).forEach(h => all.push(h)));
            hallSec.hallazgos = all;
        }
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('VSR', function renderVSR(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        autoFillVSR(data);

        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);
            let titleBlock = [];
            if (sec.titulo) {
                titleBlock = tb.sectionTitle(`${num}. ${sec.titulo}`, { marginTop: idx === 0 ? 0 : 10 });
            }

            let contentBlock = [];
            switch (sec.tipo) {
                case 'texto': contentBlock = shared.renderTexto(sec, tb); break;
                case 'tabla': contentBlock = shared.renderTabla(sec, tb); break;
                case 'tabla-info': contentBlock = shared.renderTablaInfo(sec, tb); break;
                case 'subseccion': contentBlock = shared.renderSubseccion(sec, tb); break;
                case 'caja-nota': contentBlock = shared.renderCajaNota(sec, tb); break;
                case 'caja-conclusion': contentBlock = shared.renderCajaConclusion(sec, tb); break;

                case 'vsr-portada-final': contentBlock = renderPortadaFinal(sec, tb, data); break;
                case 'vsr-inventario-paquete': contentBlock = renderInventarioPaquete(sec, tb); break;
                case 'vsr-cronologia-fases': contentBlock = renderCronologiaFases(sec, tb); break;
                case 'vsr-hallazgos-resumen': contentBlock = renderHallazgosResumen(sec, tb); break;
                case 'vsr-decision-final': contentBlock = renderDecisionFinal(sec, tb, data); break;

                // Tipos reusados de release-report
                case 'release-resumen-ejecutivo':
                    if (VS.releaseRenderers && VS.releaseRenderers.renderResumenEjecutivo) {
                        contentBlock = VS.releaseRenderers.renderResumenEjecutivo(sec, tb, 'PQ');
                    }
                    break;
                case 'release-trazabilidad-cierre':
                    if (VS.releaseRenderers && VS.releaseRenderers.renderTrazabilidadCierre) {
                        contentBlock = VS.releaseRenderers.renderTrazabilidadCierre(sec, tb);
                    }
                    break;
                case 'tabla-firmas-final':
                    if (VS.releaseRenderers && VS.releaseRenderers.renderTablaFirmasFinal) {
                        contentBlock = VS.releaseRenderers.renderTablaFirmasFinal(sec, tb, num);
                        titleBlock = []; // título queda dentro del unbreakable del helper
                    }
                    break;

                default:
                    contentBlock = [{ text: `[Tipo de sección desconocido: ${sec.tipo}]`, color: '#FF0000', margin: [0, 0, 0, 12] }];
            }

            // Wrap unbreakable para secciones críticas
            if (['tabla-info', 'vsr-portada-final', 'vsr-decision-final', 'vsr-cronologia-fases'].includes(sec.tipo)) {
                out.push({ unbreakable: true, stack: [...titleBlock, ...contentBlock] });
            } else {
                out.push(...titleBlock, ...contentBlock);
            }
        });

        return out;
    });

})(window);
