/* ====================================================================
   VALIDATION SUITE — RENDERER RA
   Risk Analysis (Analisis de Riesgos Operativo). Documento FMEA
   conforme a ICH Q9 R1 y GAMP 5 2da Edicion. Mapea cada riesgo a
   uno o mas URS de origen y evalua S * P * D inicial vs residual.

   Principio fundamental:
     LA SEVERIDAD (S, gravedad) NO PUEDE DISMINUIRSE CON MITIGACION,
     YA QUE ES INHERENTE AL PELIGRO ASOCIADO.
   La mitigacion solo reduce P (probabilidad) y/o D (detectabilidad).
   Por eso el RR final viene pre-calculado por el skill (Claude
   Desktop) respetando esta regla, y el renderer no recalcula RR.

   Estructura tipica del RA:
   1. Proposito
   2. Alcance
   3. Metodologia FMEA
      3.1 Enfoque (texto)
      3.2 Escalas de Puntuacion (tipo: escalas-fmea)
   4. Matriz de Riesgos FMEA (tipo: tabla-fmea)
   5. Resumen de Resultados (tabla normal con totales)
   6. Aceptacion Formal del Riesgo Residual (tipo: aceptacion-riesgo-residual)
   7. Referencias

   Tipos de seccion soportados:
   - Todos los compartidos (texto, tabla, tabla-info, subseccion,
     lista-incluido-excluido, caja-nota, caja-justificacion,
     caja-criterio, caja-conclusion, tabla-firmas-final)
   - escalas-fmea : 4 mini tablas en grid 2x2 con escalas S, P, D y
     niveles de riesgo (RI/RR rangos).
   - tabla-fmea : matriz principal con columnas SPD compactas y
     RI/RR coloreados por nivel. Soporta sub-headers de modulo.
   - aceptacion-riesgo-residual : caja de conclusion + tabla mini de
     firmas (default 2: Process Owner + Gerente QA, override via
     rolesPlaceholder).
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[ra.js] ValidationSuite no esta cargado');
        return;
    }

    // Niveles de riesgo y colores asociados (FMEA standard)
    // BAJO: 1-6 verde | MEDIO: 7-14 naranja | ALTO: 15-27 rojo
    function nivelRiesgo(score) {
        const n = parseInt(score, 10);
        if (isNaN(n) || n < 1) return { nivel: '—', color: '#717D8A' };
        if (n <= 6) return { nivel: 'BAJO', color: '#27AE60' };
        if (n <= 14) return { nivel: 'MEDIO', color: '#E67E22' };
        return { nivel: 'ALTO', color: '#C0392B' };
    }

    // ====================================================================
    // TIPO NUEVO: ESCALAS-FMEA
    //
    // Estructura JSON:
    // {
    //   "tipo": "escalas-fmea",
    //   "titulo": "3.2 Escalas de Puntuación",
    //   "intro": "Texto introductorio opcional",
    //   "escalaS": [
    //     { "valor": 1, "nivel": "Baja", "descripcion": "..." },
    //     { "valor": 2, "nivel": "Media", "descripcion": "..." },
    //     { "valor": 3, "nivel": "Alta", "descripcion": "..." }
    //   ],
    //   "escalaP": [...],
    //   "escalaD": [...],
    //   "niveles": [
    //     { "rango": "1-6", "nivel": "BAJO", "accion": "Aceptable. Monitoreo estandar." },
    //     { "rango": "7-14", "nivel": "MEDIO", "accion": "Mitigacion obligatoria. TC dedicado en OQ." },
    //     { "rango": "15-27", "nivel": "ALTO", "accion": "Requiere control compensatorio documentado." }
    //   ],
    //   "nota": "Texto opcional al final"
    // }
    // ====================================================================
    function renderEscalasFmea(sec, tb) {
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
                        table: { widths: [25, 40, '*'], body: body, headerRows: 1, dontBreakRows: true },
                        layout: tb.vsTableLayout()
                    }
                ]
            };
        }

        function miniNiveles(items) {
            const body = [[
                tb.vsTh('Rango', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Nivel', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Acción requerida', { fontSize: 8 })
            ]];
            (items || []).forEach((it, i) => {
                const bg = i % 2 === 1 ? C.bgSoft : null;
                const niv = nivelRiesgo(it.nivel === 'ALTO' ? 15 : it.nivel === 'MEDIO' ? 7 : 1);
                body.push([
                    tb.vsTd(it.rango || '', { alignment: 'center', bold: true, fillColor: bg, fontSize: 8 }),
                    tb.vsTd(it.nivel || '', { alignment: 'center', bold: true, color: niv.color, fillColor: bg, fontSize: 8 }),
                    tb.vsTd(it.accion || '', { fillColor: bg, fontSize: 8 })
                ]);
            });
            return {
                stack: [
                    { text: 'Niveles de Riesgo (RI / RR)', fontSize: 10, bold: true, color: C.primary, margin: [0, 0, 0, 4] },
                    { text: 'Riesgo = S × P × D', fontSize: 8, italics: true, color: C.textSoft, margin: [0, 0, 0, 4] },
                    {
                        table: { widths: [40, 40, '*'], body: body, headerRows: 1, dontBreakRows: true },
                        layout: tb.vsTableLayout()
                    }
                ]
            };
        }

        // Grid 2x2: [S, P] arriba, [D, Niveles] abajo
        out.push({
            unbreakable: true,
            table: {
                widths: ['*', '*'],
                body: [
                    [miniEscala('S — Severidad / Gravedad', sec.escalaS), miniEscala('P — Probabilidad', sec.escalaP)],
                    [miniEscala('D — Detectabilidad', sec.escalaD), miniNiveles(sec.niveles)]
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

        // Nota destacada (severidad inmutable)
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
    // TIPO NUEVO: TABLA-FMEA
    //
    // Estructura JSON:
    // {
    //   "tipo": "tabla-fmea",
    //   "titulo": "MATRIZ DE RIESGOS FMEA",
    //   "intro": "Texto opcional.",
    //   "filas": [
    //     { "subheader": "MÓDULO A — AUTENTICACIÓN (URS-001 a URS-008)" },
    //     {
    //       "id": "RA-001",
    //       "urs": "URS-001",
    //       "peligro": "Acceso no autorizado al sistema...",
    //       "S": 3, "P": 2, "D": 2,
    //       "control": "Texto del control de mitigación. GAP-001: ...",
    //       "RR": 3
    //     },
    //     ...
    //   ],
    //   "notaInferior": "LA SEVERIDAD NO PUEDE DISMINUIRSE CON MITIGACION..."
    // }
    //
    // Calculo automatico:
    //   RI = S * P * D (mostrado con nivel coloreado)
    //   RR = el campo "RR" ya viene calculado por el skill (Claude
    //        Desktop) respetando S inmutable. El renderer solo lo
    //        muestra con nivel coloreado.
    // ====================================================================
    function renderTablaFmea(sec, tb) {
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
        const thFmea = (text, extra) => tb.vsTh(text, Object.assign({ fontSize: 8, margin: [3, 6, 3, 6] }, extra || {}));
        const body = [[
            thFmea('RA-ID', { alignment: 'center' }),
            thFmea('URS Ref.', { alignment: 'center' }),
            thFmea('Peligro / Modo de Fallo'),
            thFmea('S', { alignment: 'center' }),
            thFmea('P', { alignment: 'center' }),
            thFmea('D', { alignment: 'center' }),
            thFmea('RI', { alignment: 'center' }),
            thFmea('Control de Mitigación'),
            thFmea('RR', { alignment: 'center' })
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
                    colSpan: 9,
                    margin: [4, 4, 4, 4]
                }, {}, {}, {}, {}, {}, {}, {}, {}]);
                return;
            }

            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const S = parseInt(f.S, 10) || 0;
            const P = parseInt(f.P, 10) || 0;
            const D = parseInt(f.D, 10) || 0;
            const RI = (S > 0 && P > 0 && D > 0) ? (S * P * D) : null;
            const RR = (f.RR != null) ? parseInt(f.RR, 10) : null;

            const nRI = RI != null ? nivelRiesgo(RI) : null;
            const nRR = RR != null ? nivelRiesgo(RR) : null;

            body.push([
                tb.vsTd(f.id || '', { bold: true, color: C.primary, fillColor: bg, alignment: 'center', fontSize: 8 }),
                tb.vsTd(f.urs || '', { italics: true, fillColor: bg, alignment: 'center', fontSize: 8 }),
                tb.vsTd(f.peligro || '', { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                tb.vsTd(S > 0 ? String(S) : '', { bold: true, fillColor: bg, alignment: 'center', fontSize: 9 }),
                tb.vsTd(P > 0 ? String(P) : '', { bold: true, fillColor: bg, alignment: 'center', fontSize: 9 }),
                tb.vsTd(D > 0 ? String(D) : '', { bold: true, fillColor: bg, alignment: 'center', fontSize: 9 }),
                {
                    stack: [
                        { text: RI != null ? String(RI) : '—', bold: true, fontSize: 11, alignment: 'center' },
                        nRI ? { text: nRI.nivel, fontSize: 7, bold: true, color: nRI.color, alignment: 'center' } : null
                    ].filter(Boolean),
                    fillColor: bg,
                    margin: [2, 4, 2, 4]
                },
                tb.vsTd(f.control || '', { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                {
                    stack: [
                        { text: RR != null ? String(RR) : '—', bold: true, fontSize: 11, alignment: 'center' },
                        nRR ? { text: nRR.nivel, fontSize: 7, bold: true, color: nRR.color, alignment: 'center' } : null
                    ].filter(Boolean),
                    fillColor: bg,
                    margin: [2, 4, 2, 4]
                }
            ]);
        });

        // Anchos: total = 401 (CONTENT_WIDTH 455 - 54 de padding denso)
        // Layout denso: paddingLeft+paddingRight = 6 por celda × 9 cols = 54
        // RA-ID 35 | URS 46 | Peligro 90 | S 16 | P 16 | D 16 | RI 28 | Control 120 | RR 34
        // Suma: 35+46+90+16+16+16+28+120+34 = 401
        out.push({
            table: {
                widths: tb.vsScaleWidths([33, 43, 85, 15, 15, 15, 26, 113, 32], 6),
                body: body,
                headerRows: 1,           // Header SIEMPRE se repite en cada pagina
                dontBreakRows: true,
                keepWithHeaderRows: 1
            },
            layout: tb.vsTableLayoutDense(),
            margin: [0, 0, 0, 10]
        });

        if (sec.notaInferior) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: sec.notaInferior,
                        bold: true,
                        fontSize: 9,
                        color: C.primary,
                        alignment: 'center',
                        margin: [10, 8, 10, 8],
                        fillColor: '#FFF8DC'
                    }]]
                },
                layout: {
                    hLineWidth: () => 1,
                    vLineWidth: () => 1,
                    hLineColor: () => C.primary,
                    vLineColor: () => C.primary,
                    paddingLeft: () => 0,
                    paddingRight: () => 0
                },
                margin: [0, 0, 0, 0]
            });
        }

        return out;
    }

    // ====================================================================
    // TIPO NUEVO: ACEPTACION-RIESGO-RESIDUAL
    //
    // Estructura JSON:
    // {
    //   "tipo": "aceptacion-riesgo-residual",
    //   "titulo": "ACEPTACIÓN FORMAL DEL RIESGO RESIDUAL",
    //   "conclusion": "Texto introductorio.",
    //   "items": [
    //     "Ningún riesgo identificado supera RR = 6...",
    //     "Los 4 GAPs regulatorios tienen controles compensatorios...",
    //     ...
    //   ],
    //   "firmas": [],  // array vacio = usa rolesPlaceholder
    //   "rolesPlaceholder": ["Process Owner", "Gerente QA"],
    //   "nota": "Opcional"
    // }
    // ====================================================================
    function renderAceptacionRiesgoResidual(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.conclusion) {
            out.push({
                text: sec.conclusion,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 10]
            });
        }

        if (sec.items && sec.items.length > 0) {
            out.push({
                ol: sec.items.map(t => ({ text: t, fontSize: 10, color: C.text, margin: [0, 0, 0, 4] })),
                margin: [0, 0, 0, 12]
            });
        }

        // Tabla de firmas (mini, default 2 roles)
        const firmas = sec.firmas || [];
        const body = [[
            tb.vsTh('Rol'),
            tb.vsTh('Nombre'),
            tb.vsTh('Firma (acepta riesgo residual)', { alignment: 'center' }),
            tb.vsTh('Fecha', { alignment: 'center' })
        ]];

        if (firmas.length === 0) {
            const rolesPlaceholder = sec.rolesPlaceholder || [
                'Process Owner',
                'Gerente QA'
            ];
            rolesPlaceholder.forEach((rol, idx) => {
                const bg = idx % 2 === 1 ? C.bgSoft : null;
                body.push([
                    tb.vsTd(rol, { bold: true, fillColor: bg, fontSize: 9 }),
                    tb.vsTd('', { fillColor: bg }),
                    tb.vsTd('', { fillColor: bg, alignment: 'center' }),
                    tb.vsTd('', { fillColor: bg, alignment: 'center' })
                ]);
            });
        } else {
            firmas.forEach((f, idx) => {
                const bg = idx % 2 === 1 ? C.bgSoft : null;
                const firmaCell = f.firmaImage
                    ? { image: f.firmaImage, fit: [80, 50], alignment: 'center', margin: [4, 4, 4, 4], fillColor: bg }
                    : tb.vsTd(f.iniciales || f.firma || '', { alignment: 'center', bold: true, fillColor: bg });

                body.push([
                    tb.vsTd(f.rol || '—', { bold: true, fillColor: bg, fontSize: 9 }),
                    tb.vsTd(f.nombre || '', { fillColor: bg, fontSize: 9 }),
                    firmaCell,
                    tb.vsTd(tb.formatDateShort(f.fecha) || '', { alignment: 'center', fillColor: bg, fontSize: 9 })
                ]);
            });
        }

        const heights = body.map((_, i) => i === 0 ? 28 : 50);

        out.push({
            unbreakable: true,
            table: {
                widths: tb.vsScaleWidths([110, 122, 88, 63]),
                heights: heights, body: body, headerRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 10]
        });

        if (sec.nota) {
            out.push({
                text: sec.nota, fontSize: 8, italics: true, color: C.neutral,
                alignment: 'justify', margin: [0, 0, 0, 0]
            });
        }
        return out;
    }

    // ====================================================================
    // tabla-firmas-final (compartido con HLRA/VP/URS/FRS/DS/IRA/RRM)
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
    VS.registerRenderer('RA', function renderRA(data) {
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
                case 'escalas-fmea': contentBlock = renderEscalasFmea(sec, tb); break;
                case 'tabla-fmea': contentBlock = renderTablaFmea(sec, tb); break;
                case 'aceptacion-riesgo-residual': contentBlock = renderAceptacionRiesgoResidual(sec, tb); break;
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
