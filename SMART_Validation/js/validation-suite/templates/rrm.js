/* ====================================================================
   VALIDATION SUITE — RENDERER RRM
   Regulatory Requirements Matrix (ex-MCN, Matriz de Cumplimiento Normativo).
   Documento DIFERENCIADOR del paquete: mapea cada articulo/punto de las
   normas regulatorias aplicables (ANMAT 4159/2023, 21 CFR Part 11, EU
   Annex 11, ICH Q9 R1, GAMP 5) a los URS del sistema, con estado
   coloreado (CUMPLE/PARCIAL/GAP/N/A) y trazabilidad bidireccional a RA
   y TC-OQ.

   Estructura tipica del RRM:
   1. Proposito
   2. Alcance
   3. Responsabilidades
   4. Definiciones
   5. Metodologia de Mapeo (5 dimensiones)
   6. Matrices de Cumplimiento (1 tabla-norma por dimension)
   7. Analisis de Brechas (GAP Analysis) — solo si hay GAPs
      - Tabla resumen de GAPs
      - Tarjeta detallada por cada GAP (tarjeta-gap-rrm)
   8. Resumen de Cumplimiento (totales por norma)
   9. Conclusion + Decision formal
   10. Referencias
   11. Firmas (tabla-firmas-final)

   Tipos de seccion soportados:
   - Todos los compartidos
   - tabla-norma : matriz por cada norma con columna Estado coloreada
     (CUMPLE/PARCIAL/GAP/N/A). Soporta sub-headers de capitulo o subpart.
   - tarjeta-gap-rrm : tarjeta detallada por GAP con header de color por
     severidad (Mayor=rojo / Menor=naranja). Flag visual "REQUIERE FIRMA
     FORMAL" cuando aplica.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[rrm.js] ValidationSuite no esta cargado');
        return;
    }

    // Estados de cumplimiento — colores semanticos
    function estadoColor(estado) {
        const e = (estado || '').toUpperCase().trim();
        if (e === 'CUMPLE') return { color: '#1E7E34', bg: '#E8F5E9' };
        if (e === 'PARCIAL') return { color: '#B85F0F', bg: '#FFF4E5' };
        if (e === 'GAP' || e === 'NO CUMPLE') return { color: '#A52A2A', bg: '#FDECEA' };
        if (e === 'N/A' || e === 'NA') return { color: '#717D8A', bg: '#F4F6F8' };
        return { color: '#2A2A2A', bg: null };
    }

    // Severidad de GAP — colores del header de tarjeta
    function severidadGapColor(severidad) {
        const s = (severidad || '').toUpperCase();
        if (s.includes('MAYOR')) return '#A52A2A';   // rojo
        if (s.includes('MENOR')) return '#B85F0F';   // naranja
        if (s.includes('CRITICO') || s.includes('CRÍTICO')) return '#7B1810';  // rojo oscuro
        return '#5C7080';  // gris
    }

    // ====================================================================
    // TIPO NUEVO: TABLA-NORMA
    //
    // Estructura JSON:
    // {
    //   "tipo": "tabla-norma",
    //   "titulo": "8.1. ANMAT 4159/2023 Anexo VI",
    //   "intro": "Norma de referencia: ...",
    //   "cobertura": "15/15 puntos evaluados | 11 CUMPLEN | 4 PARCIAL/GAP",
    //   "filas": [
    //     { "subheader": "SUBPART B — REGISTROS ELECTRÓNICOS" }, // opcional
    //     {
    //       "punto": "1",
    //       "requisito": "Texto resumido del requisito normativo",
    //       "aplica": "Sí",
    //       "estado": "CUMPLE",
    //       "urs": "URS-NF-001 | URS-NF-003",
    //       "raRef": "HLRA §1 | RA Global = 32",
    //       "tcOq": "TC-OQ-001 al TC-OQ-006",
    //       "observaciones": "Texto de controles aplicados"
    //     }
    //   ]
    // }
    // ====================================================================
    function renderTablaNorma(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 6]
            });
        }

        if (sec.cobertura) {
            out.push({
                text: sec.cobertura,
                fontSize: 9, italics: true, color: C.primary,
                margin: [0, 0, 0, 8]
            });
        }

        // Header denso (fontSize 8, margin lateral 3) para tablas con muchas columnas
        const thN = (text, extra) => tb.vsTh(text, Object.assign({ fontSize: 8, margin: [3, 6, 3, 6] }, extra || {}));
        const body = [[
            thN('Punto', { alignment: 'center' }),
            thN('Requisito Normativo'),
            thN('Aplic.', { alignment: 'center' }),
            thN('Estado', { alignment: 'center' }),
            thN('URS Vinculados'),
            thN('RA Ref.', { alignment: 'center' }),
            thN('TC-OQ', { alignment: 'center' }),
            thN('Observaciones / Controles')
        ]];

        const filas = sec.filas || [];
        filas.forEach((f, i) => {
            // Sub-header de capitulo / subpart
            if (f && typeof f === 'object' && f.subheader != null) {
                body.push([{
                    text: f.subheader,
                    bold: true,
                    color: '#FFFFFF',
                    fillColor: C.primary,
                    fontSize: 9,
                    colSpan: 8,
                    margin: [4, 4, 4, 4]
                }, {}, {}, {}, {}, {}, {}, {}]);
                return;
            }

            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const est = estadoColor(f.estado);

            body.push([
                tb.vsTd(f.punto || '', { bold: true, color: C.primary, fillColor: bg, alignment: 'center', fontSize: 8 }),
                tb.vsTd(f.requisito || '', { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                tb.vsTd(f.aplica || '', { fillColor: bg, alignment: 'center', fontSize: 8 }),
                tb.vsTd(f.estado || '', {
                    bold: true,
                    color: est.color,
                    fillColor: est.bg || bg,
                    alignment: 'center',
                    fontSize: 8
                }),
                tb.vsTd(f.urs || '', { fillColor: bg, fontSize: 7.5, lineHeight: 1.3 }),
                tb.vsTd(f.raRef || '', { fillColor: bg, alignment: 'center', fontSize: 7.5, italics: true }),
                tb.vsTd(f.tcOq || '', { fillColor: bg, alignment: 'center', fontSize: 7.5, italics: true }),
                tb.vsTd(f.observaciones || '', { fillColor: bg, fontSize: 7.5, lineHeight: 1.3 })
            ]);
        });

        // Anchos: total = 407 (CONTENT_WIDTH 455 - 48 padding denso, 8 cols × 6)
        // Punto 42 | Requisito 64 | Aplic. 18 | Estado 32 | URS 52 | RA 58 | TC 52 | Obs. 89
        // Punto ampliado para que §11.10(a) no rompa en 4 líneas; Obs. más ancha para controles
        out.push({
            table: {
                widths: tb.vsScaleWidths([42, 64, 18, 32, 52, 58, 52, 89], 6),
                body: body,
                headerRows: 1,
                dontBreakRows: true,
                keepWithHeaderRows: 1
            },
            layout: tb.vsTableLayoutDense(),
            margin: [0, 0, 0, 12]
        });

        return out;
    }

    // ====================================================================
    // TIPO NUEVO: TARJETA-GAP-RRM
    //
    // Estructura JSON:
    // {
    //   "tipo": "tarjeta-gap-rrm",
    //   "id": "GAP-002",
    //   "severidad": "GAP Mayor",   // GAP Mayor | GAP Menor | NC Critico | NC Menor
    //   "titulo": "Sin Firma Electrónica Nativa",
    //   "norma": "ANMAT 4159/2023 Puntos 9 y 13 | 21 CFR Part 11 Subpart C | EU Annex 11 Point 14",
    //   "requisito": "Texto del requisito",
    //   "impacto": "MEDIO — Texto del impacto GxP",
    //   "descripcion": "Texto descriptivo",
    //   "ursAfectados": "Exclusión URS §9 | URS-NF-004",
    //   "controlesCompensatorios": "Texto de controles. Puede ser array de strings tambien.",
    //   "accion": "Texto de accion requerida",
    //   "requiereFirma": true   // opcional, agrega flag visual destacado
    // }
    // ====================================================================
    function renderTarjetaGapRrm(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        const headerColor = severidadGapColor(sec.severidad);
        const idLabel = sec.id || 'GAP-XXX';
        const titulo = sec.titulo || 'Brecha sin titulo';
        const severidad = sec.severidad || '';

        // Header de la tarjeta: ID + severidad + titulo
        const headerCell = {
            stack: [
                {
                    text: [
                        { text: idLabel + '  ', bold: true, fontSize: 11, color: '#FFFFFF' },
                        severidad ? { text: '— ' + severidad + '  ', italics: true, fontSize: 10, color: '#FFFFFF' } : '',
                        { text: '— ' + titulo, bold: true, fontSize: 11, color: '#FFFFFF' }
                    ]
                }
            ],
            fillColor: headerColor,
            margin: [10, 8, 10, 8]
        };

        // Cuerpo de la tarjeta: tabla key-value
        const labelStyle = { bold: true, color: C.primary, fontSize: 9 };
        const valueStyle = { fontSize: 9, color: C.text, lineHeight: 1.35 };

        const rows = [];

        function addRow(label, value, opts) {
            if (value == null || value === '') return;
            const valueText = Array.isArray(value) ? value.join(' ') : value;
            rows.push([
                tb.vsTd(label, Object.assign({}, labelStyle, { fillColor: C.bgSoft, margin: [8, 6, 6, 6] })),
                tb.vsTd(valueText, Object.assign({}, valueStyle, opts || {}, { margin: [8, 6, 8, 6] }))
            ]);
        }

        addRow('Norma(s)', sec.norma);
        addRow('Requisito', sec.requisito);
        addRow('Impacto GxP', sec.impacto, { bold: true });
        addRow('Descripción', sec.descripcion);
        addRow('URS Afectados', sec.ursAfectados, { italics: true });

        // Controles compensatorios — soporta array o string
        if (sec.controlesCompensatorios) {
            const cc = sec.controlesCompensatorios;
            if (Array.isArray(cc)) {
                rows.push([
                    tb.vsTd('Controles Compensatorios', Object.assign({}, labelStyle, { fillColor: C.bgSoft, margin: [8, 6, 6, 6] })),
                    {
                        ol: cc.map(t => ({ text: t, fontSize: 9, color: C.text, margin: [0, 0, 0, 3] })),
                        margin: [8, 6, 8, 6]
                    }
                ]);
            } else {
                addRow('Controles Compensatorios', cc);
            }
        }

        addRow('Acción Requerida', sec.accion);

        // Tabla de campos
        const cuerpoTabla = {
            table: {
                widths: [110, '*'],
                body: rows,
                dontBreakRows: true
            },
            layout: {
                hLineWidth: () => 0.5,
                vLineWidth: () => 0.5,
                hLineColor: () => C.border,
                vLineColor: () => C.border,
                paddingLeft: () => 0,
                paddingRight: () => 0,
                paddingTop: () => 0,
                paddingBottom: () => 0
            }
        };

        // Flag "REQUIERE FIRMA FORMAL"
        const childrenStack = [
            {
                table: { widths: ['*'], body: [[headerCell]] },
                layout: 'noBorders',
                margin: [0, 0, 0, 0]
            },
            cuerpoTabla
        ];

        if (sec.requiereFirma === true) {
            childrenStack.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: 'REQUIERE FIRMA FORMAL DEL PROCESS OWNER + GERENTE QA',
                        bold: true,
                        fontSize: 10,
                        color: '#A52A2A',
                        fillColor: '#FFF8DC',
                        alignment: 'center',
                        margin: [10, 6, 10, 6]
                    }]]
                },
                layout: {
                    hLineWidth: () => 1,
                    vLineWidth: () => 1,
                    hLineColor: () => '#A52A2A',
                    vLineColor: () => '#A52A2A',
                    paddingLeft: () => 0,
                    paddingRight: () => 0
                },
                margin: [0, 4, 0, 0]
            });
        }

        out.push({
            unbreakable: true,
            stack: childrenStack,
            margin: [0, 0, 0, 12]
        });

        return out;
    }

    // ====================================================================
    // Wrap unbreakable solo para tablas chicas (<=6 filas)
    // ====================================================================
    function maybeWrapUnbreakable(sec, titleBlock, contentBlock) {
        const TABLE_TYPES = ['tabla-info'];
        const rowCount = (sec.filas || sec.preguntas || []).length;

        if (TABLE_TYPES.includes(sec.tipo) && rowCount > 0 && rowCount <= 8) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        if (sec.tipo === 'tabla' && rowCount > 0 && rowCount <= 6) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        return [...titleBlock, ...contentBlock];
    }

    // ====================================================================
    // tabla-firmas-final (compartido con HLRA/VP/URS/FRS/DS)
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

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('RRM', function renderRRM(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);

            let titleBlock = [];
            if (sec.tipo !== 'subseccion' && sec.tipo !== 'tarjeta-gap-rrm') {
                const titulo = sec.titulo ? `${num}. ${sec.titulo}` : null;
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
                case 'caja-nota': contentBlock = shared.renderCajaNota(sec, tb); break;
                case 'caja-justificacion': contentBlock = shared.renderCajaJustificacion(sec, tb); break;
                case 'caja-criterio': contentBlock = shared.renderCajaCriterio(sec, tb); break;
                case 'caja-conclusion': contentBlock = shared.renderCajaConclusion(sec, tb); break;
                case 'tabla-norma': contentBlock = renderTablaNorma(sec, tb); break;
                case 'tarjeta-gap-rrm': contentBlock = renderTarjetaGapRrm(sec, tb); break;
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
