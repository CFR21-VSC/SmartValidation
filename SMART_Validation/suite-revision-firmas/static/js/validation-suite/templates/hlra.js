/* ====================================================================
   VALIDATION SUITE — RENDERER HLRA
   High Level Risk Assessment - Analisis de Criticidad de Alto Nivel

   Tipos de seccion soportados:
   - texto                       : Parrafo simple (puede tener subtitulos)
   - lista-incluido-excluido     : Bloque "Incluido / Excluido" con bullets
   - tabla                       : Tabla generica con columnas variables
   - tabla-info                  : Tabla key/value (Campo | Valor)
   - arbol-decision-gamp         : Tabla pregunta/respuesta + conclusion
   - caja-resultado              : Banner destacado con resultado
   - tabla-docs-aplicables       : Tabla con columna de estado coloreado
   - formula-rai                 : Caja con formula + tabla de factores + resultado
   - box-resultado-rai           : Dos boxes lado a lado (calculo + nivel)
   - tarjeta-gap                 : Tarjeta con header de color por severidad
   - caja-conclusion             : Caja con borde para conclusion final
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[hlra.js] ValidationSuite no esta cargado');
        return;
    }

    // El registerRenderer principal esta al final del archivo (despues de definir todos los helpers)

    // ====================================================================
    // RENDERERS POR TIPO
    // ====================================================================

    function renderTexto(sec, tb) {
        const out = [];
        // Soporta subtitulos por bloque
        const bloques = sec.bloques || [{ texto: sec.contenido || sec.texto || '' }];
        bloques.forEach(b => {
            if (b.subtitulo) {
                out.push({
                    text: b.subtitulo,
                    fontSize: 11,
                    bold: true,
                    color: tb.VS_COLORS.primary,
                    margin: [0, 4, 0, 6]
                });
            }
            if (b.texto) {
                out.push({
                    text: b.texto,
                    fontSize: 10,
                    color: tb.VS_COLORS.text,
                    alignment: 'justify',
                    lineHeight: 1.4,
                    margin: [0, 0, 0, 10]
                });
            }
            if (b.bullets && b.bullets.length > 0) {
                out.push({
                    ul: b.bullets.map(t => ({ text: t, fontSize: 10, color: tb.VS_COLORS.text })),
                    margin: [0, 0, 0, 10]
                });
            }
        });
        return out;
    }

    function renderIncluidoExcluido(sec, tb) {
        const out = [];
        const C = tb.VS_COLORS;

        // Bloque Incluido
        if (sec.incluido) {
            if (sec.subIncluido) {
                out.push({
                    text: sec.subIncluido,
                    fontSize: 11,
                    bold: true,
                    color: C.primary,
                    margin: [0, 0, 0, 6]
                });
            }
            out.push({
                ul: sec.incluido.map(t => ({ text: t, fontSize: 10 })),
                color: C.text,
                margin: [0, 0, 0, 14]
            });
        }
        // Bloque Excluido
        if (sec.excluido) {
            if (sec.subExcluido) {
                out.push({
                    text: sec.subExcluido,
                    fontSize: 11,
                    bold: true,
                    color: C.primary,
                    margin: [0, 0, 0, 6]
                });
            }
            out.push({
                ul: sec.excluido.map(t => ({ text: t, fontSize: 10 })),
                color: C.text,
                margin: [0, 0, 0, 10]
            });
        }
        return out;
    }

    function renderTabla(sec, tb) {
        const C = tb.VS_COLORS;
        const cols = sec.columnas || [];
        const filas = sec.filas || [];
        // Siempre escalar widths numéricos al ancho útil (455pt) descontando padding
        const rawWidths = sec.widths || cols.map(() => '*');
        const widths = tb.vsScaleWidths(rawWidths);
        // Para tablas con muchas filas, fontSize reducido y celdas mas compactas
        const compact = filas.length > 5 || sec.compact === true;
        const cellFontSize = compact ? 9 : 10;
        const cellMargin = compact ? [5, 3, 5, 3] : [6, 5, 6, 5];
        // dontBreakRows solo en tablas pequeñas; en tablas grandes puede conflictuar con unbreakable
        const dontBreakRows = filas.length <= 5;

        const body = [
            cols.map(c => tb.vsTh(c, { fontSize: cellFontSize }))
        ];
        filas.forEach((fila, idx) => {
            const bg = idx % 2 === 1 ? C.bgSoft : null;
            const row = (Array.isArray(fila) ? fila : cols.map(c => fila[c] || '—'))
                .map(cell => {
                    if (typeof cell === 'object' && cell !== null) {
                        return tb.vsTd(cell.text || '—', Object.assign({ fillColor: bg, fontSize: cellFontSize, margin: cellMargin }, cell));
                    }
                    return tb.vsTd(String(cell || '—'), { fillColor: bg, fontSize: cellFontSize, margin: cellMargin });
                });
            body.push(row);
        });

        return [{
            table: { widths: widths, body: body, dontBreakRows: dontBreakRows, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 14]
        }];
    }

    function renderTablaInfo(sec, tb) {
        const C = tb.VS_COLORS;
        const filas = sec.filas || [];
        const labelWidth = sec.labelWidth || 150;
        const valueWidth = tb.CONTENT_WIDTH - labelWidth;
        const compact = filas.length > 6;
        const fs = compact ? 9 : 10;
        const cm = compact ? [5, 3, 5, 3] : [6, 5, 6, 5];

        const body = [
            [tb.vsTh('Campo', { fontSize: fs }), tb.vsTh('Valor', { fontSize: fs })]
        ];
        filas.forEach((f, idx) => {
            const bg = idx % 2 === 1 ? C.bgSoft : null;
            body.push([
                tb.vsTd(f.campo || f.label || '—', { bold: true, fillColor: bg, color: C.primary, fontSize: fs, margin: cm }),
                tb.vsTd(f.valor || f.value || '—', { fillColor: bg, fontSize: fs, margin: cm })
            ]);
        });

        return [{
            table: { widths: [labelWidth, valueWidth], body: body, dontBreakRows: true, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 14]
        }];
    }

    function renderArbolDecisionGamp(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10,
                color: C.text,
                alignment: 'justify',
                lineHeight: 1.4,
                margin: [0, 0, 0, 10]
            });
        }

        const preguntas = sec.preguntas || [];
        const body = [
            [tb.vsTh('Pregunta del árbol de decisión GAMP'), tb.vsTh('Respuesta / Conclusión')]
        ];
        preguntas.forEach((p, idx) => {
            const isLast = idx === preguntas.length - 1;
            const bg = isLast ? C.bgBlueLight : (idx % 2 === 1 ? C.bgSoft : null);
            body.push([
                tb.vsTd(p.pregunta || '—', { bold: isLast, fillColor: bg }),
                tb.vsTd(p.respuesta || '—', { bold: isLast, color: isLast ? C.primary : C.text, fillColor: bg })
            ]);
        });

        out.push({
            table: { widths: tb.vsScaleWidths([240, 215]), body: body, dontBreakRows: true, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 16]
        });
        return out;
    }

    function renderCajaResultado(sec, tb) {
        const C = tb.VS_COLORS;
        const color = sec.color === 'success' ? C.accent : C.primary;
        return [{
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        sec.icono ? { text: sec.icono + '  ' + (sec.titulo || ''), fontSize: 14, bold: true, color: C.white, alignment: 'center' }
                                  : { text: (sec.titulo || ''), fontSize: 14, bold: true, color: C.white, alignment: 'center' },
                        sec.subtitulo ? { text: sec.subtitulo, fontSize: 10, italics: true, color: C.white, alignment: 'center', margin: [0, 4, 0, 0] } : null
                    ].filter(Boolean),
                    fillColor: color,
                    margin: [16, 14, 16, 14],
                    border: [false, false, false, false]
                }]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 16]
        }];
    }

    function renderTablaDocsAplicables(sec, tb) {
        const C = tb.VS_COLORS;
        const filas = sec.filas || [];
        const compact = filas.length > 6;
        const fs = compact ? 9 : 10;
        const cm = compact ? [5, 3, 5, 3] : [6, 5, 6, 5];

        const body = [
            [tb.vsTh('Documento', { fontSize: fs }), tb.vsTh('Categoría', { fontSize: fs }), tb.vsTh('Aplicación', { fontSize: fs })]
        ];
        const colorByEstado = {
            'obligatorio': C.accent,
            'no aplica': C.sevMenor,
            'opcional': C.sevMayor,
            'aplica': C.accent
        };
        filas.forEach((f, idx) => {
            const bg = idx % 2 === 1 ? C.bgSoft : null;
            const estadoColor = colorByEstado[(f.estado || '').toLowerCase()] || C.text;
            body.push([
                tb.vsTd(f.documento || '—', { bold: true, fillColor: bg, fontSize: fs, margin: cm }),
                tb.vsTd(f.estado || '—', { color: estadoColor, bold: true, fillColor: bg, fontSize: fs, margin: cm }),
                tb.vsTd(f.aplicacion || '—', { fillColor: bg, fontSize: fs, margin: cm })
            ]);
        });

        return [{
            table: { widths: tb.vsScaleWidths([200, 100, 155]), body: body, dontBreakRows: true, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 14]
        }];
    }

    function renderFormulaRai(sec, tb) {
        const C = tb.VS_COLORS;
        const stack = [];

        // Texto introductorio (opcional)
        if (sec.intro) {
            stack.push({
                text: sec.intro,
                fontSize: 10,
                color: C.text,
                alignment: 'justify',
                lineHeight: 1.4,
                margin: [0, 0, 0, 10]
            });
        }

        // Caja con la formula
        if (sec.formula) {
            stack.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: sec.formula,
                        fontSize: 14,
                        bold: true,
                        color: C.primary,
                        alignment: 'center',
                        fillColor: C.bgBlueLight,
                        margin: [0, 14, 0, 14],
                        border: [false, false, false, false]
                    }]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                margin: [0, 0, 0, 14]
            });
        }

        // Tabla de factores
        if (sec.factores && sec.factores.length > 0) {
            const body = [
                [tb.vsTh('Var', { alignment: 'center' }),
                 tb.vsTh('Factor'),
                 tb.vsTh('Descripción'),
                 tb.vsTh('Escala', { alignment: 'center' }),
                 tb.vsTh('Valor', { alignment: 'center' })]
            ];
            sec.factores.forEach((f, idx) => {
                const bg = idx % 2 === 1 ? C.bgSoft : null;
                body.push([
                    tb.vsTd(f.var || '—', { alignment: 'center', bold: true, fillColor: bg, color: C.primary }),
                    tb.vsTd(f.factor || '—', { bold: true, fillColor: bg }),
                    tb.vsTd(f.descripcion || '—', { fillColor: bg }),
                    tb.vsTd(f.escala || '—', { alignment: 'center', fillColor: bg }),
                    tb.vsTd(String(f.valor != null ? f.valor : '—'), { alignment: 'center', bold: true, color: C.primary, fillColor: bg })
                ]);
            });
            stack.push({
                table: { widths: tb.vsScaleWidths([40, 70, 200, 50, 45]), body: body, dontBreakRows: true, headerRows: 1 },
                layout: tb.vsTableLayout(),
                margin: [0, 0, 0, 14]
            });
        }

        // Devolvemos el stack sin unbreakable: si la formula-rai es grande
        // forzar unbreakable empuja a una pagina vacia. Los renderers individuales
        // (formula box, tabla factores) ya tienen dontBreakRows en lo que importa.
        return stack;
    }

    function renderBoxResultadoRai(sec, tb) {
        const C = tb.VS_COLORS;
        const nivelColor = nivelToColor(sec.nivel, C);
        const labelCalc = sec.labelCalculo || 'IRO CALCULADO';

        return [{
            unbreakable: true,
            columns: [
                {
                    width: '*',
                    table: {
                        widths: ['*'],
                        body: [[{
                            stack: [
                                { text: labelCalc, fontSize: 10, bold: true, color: C.white, alignment: 'center', margin: [0, 0, 0, 4] },
                                { text: sec.calculo || '—', fontSize: 16, bold: true, color: C.white, alignment: 'center' }
                            ],
                            fillColor: C.primary,
                            margin: [12, 14, 12, 14],
                            border: [false, false, false, false]
                        }]]
                    },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                },
                { width: 8, text: '' },
                {
                    width: '*',
                    table: {
                        widths: ['*'],
                        body: [[{
                            stack: [
                                { text: 'NIVEL DE RIESGO', fontSize: 10, bold: true, color: nivelColor, alignment: 'center', margin: [0, 0, 0, 4] },
                                { text: sec.nivel || '—', fontSize: 16, bold: true, color: nivelColor, alignment: 'center' },
                                sec.rangos ? { text: sec.rangos, fontSize: 8, italics: true, color: C.textSoft, alignment: 'center', margin: [0, 4, 0, 0] } : null
                            ].filter(Boolean),
                            fillColor: C.bgGreen,
                            margin: [12, 14, 12, 14],
                            border: [false, false, false, false]
                        }]]
                    },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                }
            ],
            margin: [0, 0, 0, 16]
        }];
    }

    function nivelToColor(nivel, C) {
        if (!nivel) return C.text;
        const n = nivel.toLowerCase();
        if (n.includes('alto')) return C.sevMenor;
        if (n.includes('bajo')) return C.accent;
        if (n.includes('medio') || n.includes('bajo-medio')) return C.accent;
        return C.primary;
    }

    function renderTarjetaGap(sec, tb) {
        const C = tb.VS_COLORS;
        const sev = (sec.severidad || 'menor').toLowerCase();
        const sevColor = {
            'menor': C.sevMenor,
            'mayor': C.sevMayor,
            'critico': '#A93226',
            'info': C.sevInfo
        }[sev] || C.sevMenor;

        const sevLabel = (sec.severidadLabel || sec.severidad || 'NC Menor').toUpperCase();

        return [{
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [
                    // Header con color de severidad
                    [{
                        text: `${sec.id || ''}  ${sec.id ? '—' : ''}  ${sec.titulo || ''}`.trim(),
                        fontSize: 11,
                        bold: true,
                        color: C.white,
                        fillColor: sevColor,
                        margin: [10, 7, 10, 7],
                        border: [true, true, true, false]
                    }],
                    // Sub-header con norma + tipo
                    sec.norma ? [{
                        text: [
                            { text: 'Norma: ', bold: true, color: C.text, fontSize: 9 },
                            { text: (sec.norma || '—'), color: C.text, fontSize: 9 },
                            { text: '  |  ', color: C.textSoft, fontSize: 9 },
                            { text: 'Tipo: ', bold: true, color: C.text, fontSize: 9 },
                            { text: sevLabel, color: sevColor, bold: true, fontSize: 9 }
                        ],
                        fillColor: C.bgSoft,
                        margin: [10, 6, 10, 6],
                        border: [true, false, true, false]
                    }] : null,
                    // Descripcion
                    [{
                        stack: buildGapBody(sec, C),
                        fillColor: C.white,
                        margin: [10, 8, 10, 10],
                        border: [true, false, true, true]
                    }]
                ].filter(Boolean)
            },
            layout: {
                hLineWidth: () => 0.6,
                vLineWidth: () => 0.6,
                hLineColor: () => sevColor,
                vLineColor: () => sevColor
            },
            margin: [0, 0, 0, 14]
        }];
    }

    function buildGapBody(sec, C) {
        const stack = [];
        if (sec.descripcion) {
            stack.push({
                text: [
                    { text: 'Descripción: ', bold: true, color: C.text, fontSize: 10 },
                    { text: sec.descripcion, color: C.text, fontSize: 10 }
                ],
                margin: [0, 0, 0, 6],
                lineHeight: 1.3
            });
        }
        if (sec.control) {
            stack.push({
                text: [
                    { text: 'Control compensatorio: ', bold: true, color: C.text, fontSize: 10 },
                    { text: sec.control, color: C.text, fontSize: 10 }
                ],
                margin: [0, 0, 0, 6],
                lineHeight: 1.3
            });
        }
        if (sec.impacto) {
            stack.push({
                text: [
                    { text: 'Impacto: ', bold: true, color: C.text, fontSize: 10 },
                    { text: sec.impacto, color: C.text, fontSize: 10, italics: true }
                ],
                margin: [0, 0, 0, 0]
            });
        }
        if (sec.aceptacion) {
            stack.push({
                text: [
                    { text: 'Aceptación requerida: ', bold: true, color: C.text, fontSize: 10 },
                    { text: sec.aceptacion, color: C.text, fontSize: 10, italics: true }
                ],
                margin: [0, 6, 0, 0]
            });
        }
        return stack;
    }

    function renderCajaConclusion(sec, tb) {
        const C = tb.VS_COLORS;
        const stack = [];

        if (Array.isArray(sec.parrafos)) {
            sec.parrafos.forEach((p, i) => {
                stack.push({
                    text: p,
                    fontSize: 10,
                    color: C.text,
                    alignment: 'justify',
                    lineHeight: 1.4,
                    margin: [0, i === 0 ? 0 : 8, 0, 0]
                });
            });
        } else if (sec.contenido) {
            stack.push({
                text: sec.contenido,
                fontSize: 10,
                color: C.text,
                alignment: 'justify',
                lineHeight: 1.4
            });
        }

        return [{
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: stack,
                    fillColor: C.bgBlueLight,
                    margin: [14, 14, 14, 14],
                    border: [true, true, true, true]
                }]]
            },
            layout: {
                hLineWidth: () => 1,
                vLineWidth: () => 1,
                hLineColor: () => tb.VS_COLORS.primary,
                vLineColor: () => tb.VS_COLORS.primary
            },
            margin: [0, 0, 0, 14]
        }];
    }

    // ====================================================================
    // NUEVO TIPO: tabla-firmas-final
    // Para insertar al final del documento una tabla de firmas digitales/electronicas
    // de ejecucion (distinta de la matriz de aprobaciones de la pagina 2).
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

    // ====================================================================
    // RENDERER PRINCIPAL (despacha segun tipo de seccion)
    // ====================================================================
    VS.registerRenderer('HLRA', function (data) {
        const tb = VS.templateBase;
        const out = [];
        const secciones = data.secciones || [];

        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);
            const titulo = sec.titulo ? `${num}. ${sec.titulo}` : null;

            // Generar bloque de titulo (separado para poder envolverlo con la tabla)
            let titleBlock = [];
            if (titulo) {
                titleBlock = tb.sectionTitle(titulo, { marginTop: idx === 0 ? 0 : 10 });
            }

            // Generar bloque de contenido segun tipo
            let contentBlock = [];
            switch (sec.tipo) {
                case 'texto': contentBlock = renderTexto(sec, tb); break;
                case 'lista-incluido-excluido': contentBlock = renderIncluidoExcluido(sec, tb); break;
                case 'tabla': contentBlock = renderTabla(sec, tb); break;
                case 'tabla-info': contentBlock = renderTablaInfo(sec, tb); break;
                case 'arbol-decision-gamp': contentBlock = renderArbolDecisionGamp(sec, tb); break;
                case 'caja-resultado': contentBlock = renderCajaResultado(sec, tb); break;
                case 'tabla-docs-aplicables': contentBlock = renderTablaDocsAplicables(sec, tb); break;
                case 'formula-rai': contentBlock = renderFormulaRai(sec, tb); break;
                case 'box-resultado-rai': contentBlock = renderBoxResultadoRai(sec, tb); break;
                case 'tarjeta-gap': contentBlock = renderTarjetaGap(sec, tb); break;
                case 'caja-conclusion': contentBlock = renderCajaConclusion(sec, tb); break;
                case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                default:
                    contentBlock = [{
                        text: `[Tipo de seccion desconocido: ${sec.tipo}]`,
                        color: '#FF0000',
                        margin: [0, 0, 0, 12]
                    }];
            }

            // Wrappear titulo+tabla en unbreakable si es tabla chica (<=8 filas)
            // Asi el header de tabla nunca queda solo en una pagina
            const TABLE_TYPES_HLRA = ['tabla', 'tabla-info', 'arbol-decision-gamp', 'tabla-docs-aplicables'];
            const rowCount = (sec.filas || sec.preguntas || []).length;
            // unbreakable solo para tablas muy chicas (<=4 filas); tablas más grandes
            // con texto largo pueden superar la altura de página y pdfMake las omite si son unbreakable
            if (TABLE_TYPES_HLRA.includes(sec.tipo) && rowCount > 0 && rowCount <= 4) {
                out.push({
                    unbreakable: true,
                    stack: [...titleBlock, ...contentBlock]
                });
            } else {
                out.push(...titleBlock);
                out.push(...contentBlock);
            }
        });

        return out;
    });

})(window);
