/* ====================================================================
   VALIDATION SUITE — RENDERER IRA
   Infrastructure Risk Analysis (Analisis de Riesgos de Componentes).
   Documento que evalua los riesgos individuales de cada componente
   tecnico del sistema (software, infraestructura, seguridad) para
   determinar el alcance y profundidad de verificacion en el PIQ
   (Installation Qualification Protocol).

   Diferencias clave con RA:
   - Metodologia P x G x I (Proceso GxP x Gravedad x Integridad de
     Datos) en vez de S x P x D (FMEA clasico).
   - Niveles: 1-4 BAJO, 5-8 MEDIO, 9-27 ALTO.
   - No hay analisis de mitigacion (no hay RR). Evalua el componente
     "as-is" para determinar la profundidad del IQ.
   - Granularidad por componente (servidor, BD, firewall, modulo),
     no por modo de fallo.
   - Sub-headers por categoria (Software / Infraestructura / Seguridad).

   Estructura tipica del IRA:
   1. Proposito
   2. Metodologia (escalas-ira)
   3. Matriz de Riesgos por Componente (tabla-componentes-ira)
   4. Resumen de Resultados (tabla normal)
   5. Alcance de Verificacion en el PIQ (tabla-alcance-piq)
   6. Conclusion (caja-conclusion)
   7. Referencias

   Tipos de seccion soportados:
   - Todos los compartidos (texto, tabla, tabla-info, subseccion,
     lista-incluido-excluido, caja-nota, caja-justificacion,
     caja-criterio, caja-conclusion, tabla-firmas-final)
   - escalas-ira : 4 mini tablas en grid con escalas P, G, I y
     niveles de profundidad de IQ (BAJO/MEDIO/ALTO).
   - tabla-componentes-ira : matriz principal con columnas P/G/I/IRA
     coloreadas por nivel + Verificacion IQ + TC-IQ.
   - tabla-alcance-piq : tabla detallada de criterios de aceptacion
     por componente para el PIQ.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[ira.js] ValidationSuite no esta cargado');
        return;
    }

    // Niveles IRA y colores asociados
    // BAJO 1-4 verde | MEDIO 5-8 naranja | ALTO 9-27 rojo
    function nivelIRA(score) {
        const n = parseInt(score, 10);
        if (isNaN(n) || n < 1) return { nivel: '—', color: '#717D8A', verificacion: '—' };
        if (n <= 4) return { nivel: 'BAJO', color: '#27AE60', verificacion: 'Básica' };
        if (n <= 8) return { nivel: 'MEDIO', color: '#E67E22', verificacion: 'Estándar' };
        return { nivel: 'ALTO', color: '#C0392B', verificacion: 'Exhaustiva' };
    }

    // ====================================================================
    // TIPO NUEVO: ESCALAS-IRA
    //
    // Estructura JSON:
    // {
    //   "tipo": "escalas-ira",
    //   "titulo": "2. METODOLOGÍA: IRA = P × G × I",
    //   "intro": "Texto introductorio opcional",
    //   "escalaP": [
    //     { "valor": 1, "nivel": "Bajo", "descripcion": "Sin vinculación directa a proceso GxP" },
    //     ...
    //   ],
    //   "escalaG": [...],
    //   "escalaI": [...],
    //   "niveles": [
    //     { "rango": "1-4", "nivel": "BAJO", "verificacion": "Verificación Básica" },
    //     { "rango": "5-8", "nivel": "MEDIO", "verificacion": "Verificación Estándar" },
    //     { "rango": "9-27", "nivel": "ALTO", "verificacion": "Verificación Exhaustiva" }
    //   ],
    //   "nota": "Texto opcional al final"
    // }
    // ====================================================================
    function renderEscalasIra(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 10]
            });
        }

        function miniEscala(titulo, items) {
            const body = [[
                tb.vsTh('Valor', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Nivel', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Descripción', { fontSize: 8 })
            ]];
            (items || []).forEach((it, i) => {
                const bg = i % 2 === 1 ? C.bgSoft : null;
                body.push([
                    tb.vsTd(String(it.valor != null ? it.valor : ''), { alignment: 'center', bold: true, fillColor: bg, fontSize: 8 }),
                    tb.vsTd(it.nivel || '', { alignment: 'center', fillColor: bg, fontSize: 8 }),
                    tb.vsTd(it.descripcion || '', { fillColor: bg, fontSize: 8 })
                ]);
            });
            return {
                stack: [
                    { text: titulo, fontSize: 10, bold: true, color: C.primary, margin: [0, 0, 0, 4] },
                    {
                        table: { widths: [25, 50, '*'], body: body, headerRows: 1, dontBreakRows: true },
                        layout: tb.vsTableLayout()
                    }
                ]
            };
        }

        function miniNiveles(items) {
            const body = [[
                tb.vsTh('Rango', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Nivel', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Profundidad de Verificación IQ', { fontSize: 8 })
            ]];
            (items || []).forEach((it, i) => {
                const bg = i % 2 === 1 ? C.bgSoft : null;
                const niv = nivelIRA(it.nivel === 'ALTO' ? 9 : it.nivel === 'MEDIO' ? 5 : 1);
                body.push([
                    tb.vsTd(it.rango || '', { alignment: 'center', bold: true, fillColor: bg, fontSize: 8 }),
                    tb.vsTd(it.nivel || '', { alignment: 'center', bold: true, color: niv.color, fillColor: bg, fontSize: 8 }),
                    tb.vsTd(it.verificacion || '', { fillColor: bg, fontSize: 8 })
                ]);
            });
            return {
                stack: [
                    { text: 'Niveles de Riesgo (IRA-Score)', fontSize: 10, bold: true, color: C.primary, margin: [0, 0, 0, 4] },
                    { text: 'IRA = P × G × I', fontSize: 8, italics: true, color: C.textSoft, margin: [0, 0, 0, 4] },
                    {
                        table: { widths: [40, 40, '*'], body: body, headerRows: 1, dontBreakRows: true },
                        layout: tb.vsTableLayout()
                    }
                ]
            };
        }

        // Grid 2x2
        out.push({
            unbreakable: true,
            table: {
                widths: ['*', '*'],
                body: [
                    [miniEscala('P — Proceso GxP', sec.escalaP), miniEscala('G — Gravedad de Fallo', sec.escalaG)],
                    [miniEscala('I — Integridad de Datos', sec.escalaI), miniNiveles(sec.niveles)]
                ]
            },
            layout: {
                hLineWidth: () => 0,
                vLineWidth: () => 0,
                paddingLeft: (i) => i === 0 ? 0 : 8,
                paddingRight: (i) => i === 1 ? 0 : 8,
                paddingTop: (i) => i === 0 ? 0 : 10,
                paddingBottom: (i) => i === 1 ? 0 : 10
            },
            margin: [0, 0, 0, 10]
        });

        if (sec.nota) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: [
                            { text: 'NOTA:  ', bold: true, color: C.primary, fontSize: 9 },
                            { text: sec.nota, fontSize: 9, italics: true, color: C.text }
                        ],
                        margin: [10, 6, 10, 6],
                        fillColor: '#FFF8DC'
                    }]]
                },
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: function (i) { return i === 0 ? 3 : 0; },
                    vLineColor: () => C.primary,
                    paddingLeft: () => 0,
                    paddingRight: () => 0
                },
                margin: [0, 4, 0, 0]
            });
        }

        return out;
    }

    // ====================================================================
    // TIPO NUEVO: TABLA-COMPONENTES-IRA
    //
    // Estructura JSON:
    // {
    //   "tipo": "tabla-componentes-ira",
    //   "titulo": "MATRIZ DE RIESGOS POR COMPONENTE",
    //   "intro": "Texto opcional.",
    //   "filas": [
    //     { "subheader": "CATEGORÍA 1 — SOFTWARE DE APLICACIÓN" },
    //     {
    //       "id": "COMP-SW-01",
    //       "tipo": "Software",
    //       "componente": "App Web Principal",
    //       "descripcion": "SaaS Python/Django en https://...",
    //       "P": 3, "G": 3, "I": 3,
    //       "tcIq": "TC-IQ-001"
    //     },
    //     ...
    //   ]
    // }
    //
    // Calculo automatico:
    //   IRA = P * G * I (mostrado con nivel coloreado y profundidad
    //   de verificacion deducida automaticamente).
    // ====================================================================
    function renderTablaComponentesIra(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        // Header denso: fontSize 8, margin lateral chico para que entren los textos
        const thIra = (text, extra) => tb.vsTh(text, Object.assign({ fontSize: 8, margin: [3, 6, 3, 6] }, extra || {}));
        const body = [[
            thIra('COMP-ID', { alignment: 'center' }),
            thIra('Tipo', { alignment: 'center' }),
            thIra('Componente'),
            thIra('Descripción'),
            thIra('P', { alignment: 'center' }),
            thIra('G', { alignment: 'center' }),
            thIra('I', { alignment: 'center' }),
            thIra('IRA', { alignment: 'center' }),
            thIra('Verif. IQ', { alignment: 'center' }),
            thIra('TC-IQ', { alignment: 'center' })
        ]];

        // Sub-headers son filas con { subheader: "..." } que abarcan todas las columnas.
        // El header principal de la tabla SIEMPRE se repite en cada salto de pagina.
        const filas = sec.filas || [];

        filas.forEach((f, i) => {
            if (f && typeof f === 'object' && f.subheader != null) {
                body.push([{
                    text: f.subheader,
                    bold: true,
                    color: '#FFFFFF',
                    fillColor: C.primary,
                    fontSize: 9,
                    colSpan: 10,
                    margin: [4, 4, 4, 4]
                }, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
                return;
            }

            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const P = parseInt(f.P, 10) || 0;
            const G = parseInt(f.G, 10) || 0;
            const I = parseInt(f.I, 10) || 0;
            const ira = (P > 0 && G > 0 && I > 0) ? (P * G * I) : null;
            const nIra = ira != null ? nivelIRA(ira) : null;

            body.push([
                tb.vsTd(f.id || '', { bold: true, color: C.primary, fillColor: bg, alignment: 'center', fontSize: 7 }),
                tb.vsTd(f.tipo || '', { fillColor: bg, alignment: 'center', fontSize: 7 }),
                tb.vsTd(f.componente || '', { fillColor: bg, fontSize: 8, bold: true }),
                tb.vsTd(f.descripcion || '', { fillColor: bg, fontSize: 7, lineHeight: 1.3 }),
                tb.vsTd(P > 0 ? String(P) : '', { bold: true, fillColor: bg, alignment: 'center', fontSize: 9 }),
                tb.vsTd(G > 0 ? String(G) : '', { bold: true, fillColor: bg, alignment: 'center', fontSize: 9 }),
                tb.vsTd(I > 0 ? String(I) : '', { bold: true, fillColor: bg, alignment: 'center', fontSize: 9 }),
                {
                    stack: [
                        { text: ira != null ? String(ira) : '—', bold: true, fontSize: 11, alignment: 'center' },
                        nIra ? { text: nIra.nivel, fontSize: 7, bold: true, color: nIra.color, alignment: 'center' } : null
                    ].filter(Boolean),
                    fillColor: bg,
                    margin: [2, 4, 2, 4]
                },
                tb.vsTd(nIra ? nIra.verificacion : '', { fillColor: bg, alignment: 'center', fontSize: 8, bold: true, color: nIra ? nIra.color : null }),
                tb.vsTd(f.tcIq || '', { fillColor: bg, alignment: 'center', fontSize: 7, italics: true })
            ]);
        });

        // Anchos: total = 388 (CONTENT_WIDTH 455 - 60 padding denso - 7pt margen)
        // Layout denso: paddingLeft+paddingRight = 6 por celda × 10 cols = 60
        // Re-distribuido para que NO se rompan textos en celdas:
        //   - "Software" entra en 1 línea (era 32 → 38pt)
        //   - "App Web Principal" / "Administración" más cómodos (era 60 → 75pt)
        //   - "Exhaustiva" en 1 línea (era 50 → 58pt)
        //   - Descripción reducida (era 95 → 75pt) — wrappea pero es OK por ser texto largo natural
        //   - COMP-ID compacto (era 50 → 44pt) — "COMP-SW-01" entra
        //   - P/G/I/IRA/TC-IQ ajustados a 13/13/13/24/35
        // Suma: 44+38+75+75+13+13+13+24+58+35 = 388pt
        out.push({
            table: {
                widths: tb.vsScaleWidths([42, 36, 72, 72, 12, 12, 12, 23, 55, 33], 6),
                body: body,
                headerRows: 1,           // Header SIEMPRE se repite en cada pagina
                dontBreakRows: true,
                keepWithHeaderRows: 1
            },
            layout: tb.vsTableLayoutDense(),
            margin: [0, 0, 0, 10]
        });

        return out;
    }

    // ====================================================================
    // TIPO NUEVO: TABLA-ALCANCE-PIQ
    //
    // Estructura JSON:
    // {
    //   "tipo": "tabla-alcance-piq",
    //   "titulo": "ALCANCE DE VERIFICACIÓN EN EL PIQ",
    //   "intro": "Texto opcional.",
    //   "filas": [
    //     {
    //       "compId": "COMP-SW-01",
    //       "componente": "App Web",
    //       "ira": 27,
    //       "verificacion": "URL accesible HTTPS, versión v1.0 visible en interfaz",
    //       "criterio": "HTTPS 200 OK. Texto '1.0' visible en pantalla sin login",
    //       "tcIq": "TC-IQ-001"
    //     },
    //     ...
    //   ]
    // }
    // ====================================================================
    function renderTablaAlcancePiq(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        const thAlc = (text, extra) => tb.vsTh(text, Object.assign({ fontSize: 8, margin: [3, 6, 3, 6] }, extra || {}));
        const body = [[
            thAlc('COMP-ID', { alignment: 'center' }),
            thAlc('Componente'),
            thAlc('IRA', { alignment: 'center' }),
            thAlc('Verificación requerida IQ'),
            thAlc('Criterio de aceptación'),
            thAlc('TC-IQ', { alignment: 'center' })
        ]];

        const filas = sec.filas || [];
        filas.forEach((f, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const ira = parseInt(f.ira, 10) || 0;
            const nIra = ira > 0 ? nivelIRA(ira) : null;

            body.push([
                tb.vsTd(f.compId || '', { bold: true, color: C.primary, fillColor: bg, alignment: 'center', fontSize: 7 }),
                tb.vsTd(f.componente || '', { fillColor: bg, fontSize: 8, bold: true }),
                {
                    stack: [
                        { text: ira > 0 ? String(ira) : '—', bold: true, fontSize: 10, alignment: 'center' },
                        nIra ? { text: nIra.nivel, fontSize: 7, bold: true, color: nIra.color, alignment: 'center' } : null
                    ].filter(Boolean),
                    fillColor: bg,
                    margin: [2, 4, 2, 4]
                },
                tb.vsTd(f.verificacion || '', { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                tb.vsTd(f.criterio || '', { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                tb.vsTd(f.tcIq || '', { fillColor: bg, alignment: 'center', fontSize: 7, italics: true })
            ]);
        });

        // Anchos: total = 419 (CONTENT_WIDTH 455 - 36 de padding denso)
        // Layout denso: paddingLeft+paddingRight = 6 por celda × 6 cols = 36
        // COMP-ID 46 | Componente 70 | IRA 26 | Verificación 119 | Criterio 116 | TC-IQ 42
        // TC-IQ ampliado: "TC-IQ-001" (9 chars a 7pt) entra en 1 línea (antes wrapeaba)
        out.push({
            table: {
                widths: tb.vsScaleWidths([43, 66, 24, 112, 109, 40], 6),
                body: body,
                headerRows: 1,           // Header SIEMPRE se repite en cada pagina
                dontBreakRows: true,
                keepWithHeaderRows: 1
            },
            layout: tb.vsTableLayoutDense(),
            margin: [0, 0, 0, 10]
        });

        return out;
    }

    // ====================================================================
    // tabla-firmas-final (compartido con HLRA/VP/URS/FRS/DS/RA/RRM)
    // ====================================================================
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

    // Wrap unbreakable solo para tablas chicas (<=4 filas)
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
    VS.registerRenderer('IRA', function renderIRA(data) {
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
                case 'escalas-ira': contentBlock = renderEscalasIra(sec, tb); break;
                case 'tabla-componentes-ira': contentBlock = renderTablaComponentesIra(sec, tb); break;
                case 'tabla-alcance-piq': contentBlock = renderTablaAlcancePiq(sec, tb); break;
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
