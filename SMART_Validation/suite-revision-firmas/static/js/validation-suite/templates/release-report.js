/* ====================================================================
   VALIDATION SUITE — RENDERER REPORTES DE CALIFICACION (RIQ/ROQ/RPQ)

   Documento ejecutivo de liberación de fase que un sponsor firma para
   AUTORIZAR el paso a la siguiente etapa del ciclo:

     PIQ → IIQ → RIQ   (autoriza paso a OQ)
     POQ → IOQ → ROQ   (autoriza paso a PQ)
     PPQ → IPQ → RPQ   (autoriza liberación productiva final)

   Diferencia vs INFORME (IIQ/IOQ/IPQ):
     - El Informe es la documentación técnica detallada (60+ páginas).
     - El Reporte de Liberación es ejecutivo (5-10 páginas).
     - El Reporte se firma por Sponsor / Director / QA Manager
       (no por validador ni process owner).

   Schema parametrizado:
     - type: "RIQ" | "ROQ" | "RPQ"
     - data.etapa: "IQ" | "OQ" | "PQ"  (auto-derivado del type si no se declara)

   Tipos de sección específicos:
     - release-portada-decision  : banner enorme con decisión global
     - release-resumen-ejecutivo : KPIs auto-calculados desde el paquete
     - release-trazabilidad-cierre : tabla con docs base referenciados
     - release-condicionantes    : lista (visible solo si "con condiciones")
     - release-decision-formal   : caja grande con autorización al sponsor

   Tipos compartidos: texto, tabla-info, tabla, caja-conclusion,
   tabla-firmas-final.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[release-report.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // METADATOS POR ETAPA
    // ====================================================================
    const ETAPA_META = {
        IQ: {
            label: 'Calificación de Instalación',
            shortLabel: 'IQ',
            siguiente: 'OQ — Calificación Operacional',
            siguienteCorta: 'OQ',
            protocolo: 'PIQ',
            informe: 'IIQ',
            reporte: 'RIQ',
            colorPrimary: '#1F3C56',
            colorAccent: '#0E5285'
        },
        OQ: {
            label: 'Calificación Operacional',
            shortLabel: 'OQ',
            siguiente: 'PQ — Calificación de Performance',
            siguienteCorta: 'PQ',
            protocolo: 'POQ',
            informe: 'IOQ',
            reporte: 'ROQ',
            colorPrimary: '#1F3C56',
            colorAccent: '#0E5285'
        },
        PQ: {
            label: 'Calificación de Performance',
            shortLabel: 'PQ',
            siguiente: 'LIBERACIÓN PRODUCTIVA GxP',
            siguienteCorta: 'PROD',
            protocolo: 'PPQ',
            informe: 'IPQ',
            reporte: 'RPQ',
            colorPrimary: '#1F3C56',
            colorAccent: '#0E5285'
        }
    };

    function getEtapa(data) {
        if (data.etapa && ETAPA_META[data.etapa]) return data.etapa;
        const t = data.type;
        if (t === 'RIQ') return 'IQ';
        if (t === 'ROQ') return 'OQ';
        if (t === 'RPQ') return 'PQ';
        return 'OQ'; // fallback razonable
    }

    // ====================================================================
    // HELPERS DE DECISIÓN
    // ====================================================================
    function decisionMeta(decision) {
        const d = String(decision || '').toUpperCase();
        if (/NO APROB|RECHAZAD/.test(d)) {
            return { label: 'NO APROBADO', color: '#FFFFFF', bg: '#A52A2A', icon: 'X' };
        }
        if (/CONDICION/.test(d)) {
            return { label: 'APROBADO CON CONDICIONES', color: '#FFFFFF', bg: '#B85F0F', icon: '!' };
        }
        if (/APROB|LIBERAD/.test(d)) {
            return { label: 'APROBADO', color: '#FFFFFF', bg: '#1E7E34', icon: 'OK' };
        }
        return { label: 'PENDIENTE', color: '#FFFFFF', bg: '#717D8A', icon: '?' };
    }

    // ====================================================================
    // SECCIÓN: PORTADA EJECUTIVA CON DECISIÓN GRANDE
    // ====================================================================
    function renderPortadaDecision(sec, tb, etapa, data) {
        const C = tb.VS_COLORS;
        const meta = ETAPA_META[etapa];
        const dec = decisionMeta(sec.decision || (data.document && data.document.extras && data.document.extras.Decisión));
        const out = [];

        // Banner principal de decisión
        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'DECISIÓN DE LIBERACIÓN', fontSize: 11, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 2] },
                        { text: meta.label.toUpperCase(), fontSize: 14, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 6] },
                        { text: dec.label, fontSize: 24, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 4] },
                        sec.subtitulo
                            ? { text: sec.subtitulo, fontSize: 11, italics: true, color: '#FFFFFF', alignment: 'center' }
                            : null
                    ].filter(Boolean),
                    fillColor: dec.bg,
                    margin: [20, 22, 20, 22]
                }]]
            },
            layout: {
                hLineWidth: () => 2, vLineWidth: () => 2,
                hLineColor: () => dec.bg, vLineColor: () => dec.bg
            },
            margin: [0, 0, 0, 12]
        });

        // Línea de contexto: qué se libera y a dónde
        const proximoLabel = dec.label === 'APROBADO' || dec.label === 'APROBADO CON CONDICIONES'
            ? `Autoriza el avance del sistema a la fase: ${meta.siguiente}`
            : `El sistema NO está autorizado para avanzar a: ${meta.siguiente}. Revisar condicionantes y CAPAs.`;
        out.push({
            text: proximoLabel,
            fontSize: 11, italics: true, color: C.text, alignment: 'center',
            margin: [0, 0, 0, 14]
        });

        return out;
    }

    // ====================================================================
    // SECCIÓN: RESUMEN EJECUTIVO (KPIs grandes)
    // ====================================================================
    function renderResumenEjecutivo(sec, tb, etapa) {
        const C = tb.VS_COLORS;
        const out = [];
        const k = sec.kpis || {};

        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 10] });
        }

        // Grid 2x3 con métricas clave
        const grid = [
            { label: 'TCs ejecutados', value: k.totalTcsEjecutados != null ? k.totalTcsEjecutados : '—', color: C.primary },
            { label: 'PASS', value: k.pass != null ? k.pass : '—', color: '#1E7E34' },
            { label: 'FAIL', value: k.fail != null ? k.fail : '—', color: (k.fail > 0 ? '#A52A2A' : '#1E7E34') },
            { label: 'OBS', value: k.obs != null ? k.obs : '—', color: (k.obs > 0 ? '#B85F0F' : C.text) },
            { label: 'Cobertura %', value: k.cobertura != null ? (k.cobertura + '%') : '—', color: C.accent },
            { label: 'NCs abiertas', value: k.hallazgosAbiertos != null ? k.hallazgosAbiertos : '—', color: (k.hallazgosAbiertos > 0 ? '#A52A2A' : '#1E7E34') }
        ];

        const cells = grid.map(it => ({
            stack: [
                { text: it.label, fontSize: 8.5, color: C.textSoft, alignment: 'center', margin: [0, 5, 0, 2] },
                { text: String(it.value), fontSize: 18, bold: true, color: it.color, alignment: 'center', margin: [0, 0, 0, 5] }
            ],
            fillColor: '#F4F6F8'
        }));

        out.push({
            table: { widths: ['*', '*', '*', '*', '*', '*'], body: [cells] },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        // Sub-resumen: TCs negativos + NCs críticas
        if (k.negativos != null || k.criticasAbiertas != null) {
            const subItems = [];
            if (k.negativos != null) {
                subItems.push({
                    width: '*',
                    text: [
                        { text: 'TCs negativos: ', fontSize: 9, bold: true, color: C.text },
                        { text: `${k.negativos} (${k.negativosFail || 0} con FAIL)`, fontSize: 9, color: C.text }
                    ]
                });
            }
            if (k.criticasAbiertas != null) {
                subItems.push({
                    width: '*',
                    text: [
                        { text: 'NCs críticas abiertas: ', fontSize: 9, bold: true, color: C.text },
                        { text: String(k.criticasAbiertas), fontSize: 9, bold: true, color: k.criticasAbiertas > 0 ? '#A52A2A' : '#1E7E34' }
                    ]
                });
            }
            if (k.estadoGlobal) {
                subItems.push({
                    width: '*',
                    text: [
                        { text: 'Estado global: ', fontSize: 9, bold: true, color: C.text },
                        { text: k.estadoGlobal, fontSize: 9, bold: true, color: /APROB/.test(k.estadoGlobal) ? '#1E7E34' : '#B85F0F' }
                    ]
                });
            }
            out.push({ columns: subItems, margin: [0, 0, 0, 10] });
        }

        // Fundamento de la decisión (texto)
        if (sec.fundamento) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            { text: 'Fundamento de la decisión:', fontSize: 9, bold: true, color: C.primary, margin: [0, 0, 0, 3] },
                            { text: sec.fundamento, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.4 }
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
                margin: [0, 0, 0, 12]
            });
        }

        return out;
    }

    // ====================================================================
    // SECCIÓN: TRAZABILIDAD DEL CIERRE
    // ====================================================================
    function renderTrazabilidadCierre(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const docs = sec.documentos || [];
        if (docs.length === 0) {
            out.push({ text: '— Sin documentos base referenciados. —', fontSize: 10, italics: true, color: C.textSoft, alignment: 'center', margin: [0, 8, 0, 12] });
            return out;
        }

        const body = [[
            tb.vsTh('Documento', { alignment: 'left' }),
            tb.vsTh('Tipo', { alignment: 'center' }),
            tb.vsTh('Versión', { alignment: 'center' }),
            tb.vsTh('Estado', { alignment: 'center' }),
            tb.vsTh('Observación')
        ]];

        docs.forEach((d, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const estadoLabel = String(d.estado || '').toUpperCase();
            const estColor = /APROB|CERR/.test(estadoLabel) ? '#1E7E34'
                : /PEND|ABIERT/.test(estadoLabel) ? '#A52A2A'
                : C.text;
            body.push([
                tb.vsTd(d.codigo || '—', { fillColor: bg, bold: true, fontSize: 9, color: C.primary }),
                tb.vsTd(d.tipo || '—', { fillColor: bg, alignment: 'center', fontSize: 8.5 }),
                tb.vsTd(d.version || '—', { fillColor: bg, alignment: 'center', fontSize: 9 }),
                tb.vsTd(d.estado || '—', { fillColor: bg, alignment: 'center', fontSize: 8.5, bold: true, color: estColor }),
                tb.vsTd(d.observacion || '—', { fillColor: bg, fontSize: 8.5, italics: !d.observacion })
            ]);
        });

        out.push({
            table: { widths: [115, 50, 50, 65, '*'], body, headerRows: 1, dontBreakRows: true },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        return out;
    }

    // ====================================================================
    // SECCIÓN: CONDICIONANTES (si aprobado con condiciones)
    // ====================================================================
    function renderCondicionantes(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        const items = sec.condicionantes || [];

        if (items.length === 0) {
            out.push({
                text: 'Sin condicionantes asociados. La aprobación es plena, sin obligaciones pendientes.',
                fontSize: 10, italics: true, color: '#1E7E34', alignment: 'center',
                fillColor: '#E8F5E9', margin: [0, 8, 0, 12]
            });
            return out;
        }

        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const body = [[
            tb.vsTh('#', { alignment: 'center' }),
            tb.vsTh('Condicionante'),
            tb.vsTh('Responsable', { alignment: 'center' }),
            tb.vsTh('Plazo', { alignment: 'center' }),
            tb.vsTh('Estado', { alignment: 'center' })
        ]];

        items.forEach((it, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const estadoLabel = String(it.estado || 'PENDIENTE').toUpperCase();
            const estColor = /CUMPL|CERR/.test(estadoLabel) ? '#1E7E34' : '#B85F0F';
            body.push([
                tb.vsTd(String(i + 1), { fillColor: bg, alignment: 'center', bold: true, fontSize: 9, color: C.primary }),
                tb.vsTd(it.descripcion || '—', { fillColor: bg, fontSize: 9, lineHeight: 1.3 }),
                tb.vsTd(it.responsable || '—', { fillColor: bg, alignment: 'center', fontSize: 8.5 }),
                tb.vsTd(it.plazo || '—', { fillColor: bg, alignment: 'center', fontSize: 8.5 }),
                tb.vsTd(estadoLabel, { fillColor: bg, alignment: 'center', fontSize: 8.5, bold: true, color: estColor })
            ]);
        });

        out.push({
            table: { widths: [25, '*', 90, 65, 75], body, headerRows: 1, dontBreakRows: true },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        return out;
    }

    // ====================================================================
    // SECCIÓN: DECISIÓN FORMAL Y AUTORIZACIÓN
    // ====================================================================
    function renderDecisionFormal(sec, tb, etapa, data) {
        const C = tb.VS_COLORS;
        const meta = ETAPA_META[etapa];
        const dec = decisionMeta(sec.decision || (data.document && data.document.extras && data.document.extras.Decisión));
        const out = [];

        const textoFormal = sec.textoFormal || (
            dec.label === 'APROBADO' || dec.label === 'APROBADO CON CONDICIONES'
                ? `Por la presente se autoriza formalmente el avance del sistema a la fase de ${meta.siguiente}. La presente decisión queda registrada y firmada por los responsables ejecutivos abajo identificados.`
                : `Por la presente se DENIEGA la autorización de avance del sistema a la fase de ${meta.siguiente}. El sistema deberá retomar las correcciones identificadas antes de un nuevo intento de liberación.`
        );

        out.push({
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'DECISIÓN FORMAL', fontSize: 11, bold: true, color: dec.bg, alignment: 'center', margin: [0, 0, 0, 6] },
                        { text: dec.label, fontSize: 18, bold: true, color: dec.bg, alignment: 'center', margin: [0, 0, 0, 8] },
                        { text: textoFormal, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.5 }
                    ],
                    fillColor: dec.label === 'APROBADO' ? '#E8F5E9' : dec.label === 'NO APROBADO' ? '#FDECEA' : '#FFF4E5',
                    margin: [18, 14, 18, 14]
                }]]
            },
            layout: {
                hLineWidth: () => 2, vLineWidth: () => 2,
                hLineColor: () => dec.bg, vLineColor: () => dec.bg
            },
            margin: [0, 0, 0, 14]
        });

        return out;
    }

    // ====================================================================
    // FIRMAS FINALES
    // ====================================================================
    function renderTablaFirmasFinal(sec, tb, num) {
        // Delega al helper compartido con ajuste smart (fontSize + height adaptativo)
        if (VS.shared && typeof VS.shared.renderTablaFirmasFinalSmart === 'function') {
            return VS.shared.renderTablaFirmasFinalSmart(sec, tb, { rolesDefault: ['Sponsor / Director', 'Gerente QA', 'Process Owner'], numero: num, titulo: sec.titulo });
        }
        // Fallback (no debería ocurrir)
        return [{ text: '[Helper de firmas no disponible]', color: '#FF0000' }];
    }

    function maybeWrapUnbreakable(sec, titleBlock, contentBlock) {
        const UB = ['tabla-info', 'release-portada-decision', 'release-decision-formal'];
        if (UB.includes(sec.tipo)) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        return [...titleBlock, ...contentBlock];
    }

    // ====================================================================
    // AUTO-RELLENO DESDE EL PAQUETE EN RUNTIME
    //
    // Si el JSON del reporte tiene KPIs vacíos (todos null) o documentos
    // vacíos, intenta llenarlos consultando window.packageDocs vía el
    // matrix-builder. Filtra el paquete según la etapa (RIQ usa solo IQ,
    // ROQ agrega OQ, RPQ usa todos).
    //
    // Es no-destructivo: si ya hay valores los respeta. Esto preserva los
    // samples DRP que ya cargué con datos reales.
    // ====================================================================
    function autoFillFromPackage(data, etapa) {
        const pkgDocs = (typeof global.packageDocs !== 'undefined' && Array.isArray(global.packageDocs)) ? global.packageDocs : [];
        if (pkgDocs.length === 0) return; // nada que hacer
        if (!global.ValidationSuite || !global.ValidationSuite.matrixBuilder) return;
        const mb = global.ValidationSuite.matrixBuilder;

        // Filtrar el paquete por etapa
        const ALLOWED = {
            IQ: ['URS','RA','IRA','PIQ','IIQ'],
            OQ: ['URS','RA','IRA','PIQ','IIQ','POQ','IOQ','NCR'],
            PQ: ['URS','RA','IRA','PIQ','IIQ','POQ','IOQ','PPQ','IPQ','NCR']
        };
        const allowedTypes = ALLOWED[etapa] || ALLOWED.PQ;
        const filteredPkg = pkgDocs.filter(d => allowedTypes.indexOf(d.type) >= 0);
        if (filteredPkg.length === 0) return;

        // Calcular matrix solo si hace falta
        let matrix = null;
        function ensureMatrix() {
            if (matrix) return matrix;
            try {
                matrix = mb.build({ packageDocs: filteredPkg, tests: [], groups: [], protocols: [] });
            } catch (e) { matrix = null; }
            return matrix;
        }

        // ─── 1. Auto-llenar kpis del resumen ejecutivo si está vacío ───
        const resumen = (data.secciones || []).find(s => s.tipo === 'release-resumen-ejecutivo');
        if (resumen && resumen.kpis) {
            const k = resumen.kpis;
            const empty = k.totalTcsEjecutados == null && k.pass == null && k.cobertura == null;
            if (empty) {
                const m = ensureMatrix();
                if (m && m.kpis) {
                    // Calcular criticasAbiertas adicionalmente
                    let critAb = 0;
                    filteredPkg.forEach(d => {
                        mb.extractHallazgos(d).forEach(h => {
                            const c = String(h.criticidad || h.severidad || '').toUpperCase();
                            const e = String(h.estado || '').toUpperCase();
                            if (/CR[ÍI]TIC|MAYOR|ALTO/.test(c) && !/CERR/.test(e)) critAb++;
                        });
                    });
                    resumen.kpis = Object.assign({}, m.kpis, { criticasAbiertas: critAb });
                }
            }
        }

        // ─── 2. Auto-llenar documentos de trazabilidad si está vacío ───
        const traza = (data.secciones || []).find(s => s.tipo === 'release-trazabilidad-cierre');
        if (traza && Array.isArray(traza.documentos) && traza.documentos.length === 0) {
            traza.documentos = filteredPkg.map(d => ({
                codigo: d.code,
                tipo: d.type,
                version: d.version,
                estado: ((d.data && d.data.document && d.data.document.status) || 'Aprobado'),
                observacion: d.title || ''
            }));
        }
    }

    // ====================================================================
    // RENDERER PRINCIPAL — registra los 3 tipos con la misma función
    // ====================================================================
    function renderRelease(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];
        const etapa = getEtapa(data);

        // Auto-rellenar KPIs y trazabilidad desde el paquete si está cargado
        // y los campos del JSON están vacíos (no toca samples con datos).
        autoFillFromPackage(data, etapa);

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
                case 'release-portada-decision': contentBlock = renderPortadaDecision(sec, tb, etapa, data); break;
                case 'release-resumen-ejecutivo': contentBlock = renderResumenEjecutivo(sec, tb, etapa); break;
                case 'release-trazabilidad-cierre': contentBlock = renderTrazabilidadCierre(sec, tb); break;
                case 'release-condicionantes': contentBlock = renderCondicionantes(sec, tb); break;
                case 'release-decision-formal': contentBlock = renderDecisionFormal(sec, tb, etapa, data); break;
                case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                default:
                    contentBlock = [{ text: `[Tipo de sección desconocido: ${sec.tipo}]`, color: '#FF0000', margin: [0, 0, 0, 12] }];
            }
            out.push(...maybeWrapUnbreakable(sec, titleBlock, contentBlock));
        });

        return out;
    }

    VS.registerRenderer('RIQ', renderRelease);
    VS.registerRenderer('ROQ', renderRelease);
    VS.registerRenderer('RPQ', renderRelease);

    // Exponer helpers para validators y consumidores externos.
    // También exponemos los renderers de sección para que el VSR los reuse
    // sin duplicar código (resumen-ejecutivo, trazabilidad, firmas, etc.).
    VS.releaseReportHelpers = {
        getEtapa, ETAPA_META, decisionMeta
    };
    VS.releaseRenderers = {
        renderResumenEjecutivo,
        renderTrazabilidadCierre,
        renderTablaFirmasFinal,
        autoFillFromPackage
    };

})(window);
