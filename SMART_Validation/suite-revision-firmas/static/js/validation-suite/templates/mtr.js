/* ====================================================================
   VALIDATION SUITE — RENDERER MTR
   Matriz de Trazabilidad de Requisitos (Requirements Traceability
   Matrix). Documento que vincula cada URS con su cadena completa de
   trazabilidad: URS -> RA-ID -> TC-IQ -> TC-OQ -> Estado.

   Estructura tipica del MTR:
   1. Proposito
   2. Alcance
   3. Metodologia y Leyenda
   4. Matriz de Trazabilidad Completa (LA TABLA PRINCIPAL)
   5. Resumen Estadistico por Modulo
   6. Analisis de GAPs de Cobertura
   7. Referencias
   8. Firmas

   Tipos de seccion soportados:
   - Todos los compartidos
   - tabla-trazabilidad : matriz principal con 8 columnas, criticidad
     coloreada, sub-headers de modulo, validacion automatica de IDs.
   - caja-validacion : caja destacada con resultado de validacion
     interna (verde/amarillo/rojo segun valid/warnings/errors).

   VALIDACION INTERNA:
   - El renderer llama a VS.validateDocument(data) antes de renderizar.
   - Si data._validacion.mostrarCaja !== false, agrega una caja de
     resultado al inicio del documento (despues del proposito).
   - Si data._validacion.estricta === true y hay errors, aborta con
     un texto rojo "VALIDACION FALLIDA" en lugar del render normal.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[mtr.js] ValidationSuite no esta cargado');
        return;
    }

    // Colores semanticos de criticidad
    function criticidadColor(crit) {
        const c = String(crit || '').toUpperCase().trim();
        if (c === 'CRÍTICO' || c === 'CRITICO') return { fg: '#A52A2A', bg: '#FDECEA' };
        if (c === 'ALTO') return { fg: '#B85F0F', bg: '#FFF4E5' };
        if (c === 'MEDIO') return { fg: '#1E7E34', bg: '#E8F5E9' };
        return { fg: '#717D8A', bg: null };
    }

    // ====================================================================
    // TIPO NUEVO: CAJA-VALIDACION
    //
    // Renderiza el resultado de la validacion interna del documento.
    // Verde: 0 errors, 0 warnings.
    // Amarillo: 0 errors, >0 warnings.
    // Rojo: >0 errors.
    //
    // Estructura JSON (se construye automaticamente, NO se pone en el
    // fixture — el renderer principal la inyecta segun la validacion).
    // ====================================================================
    function renderCajaValidacion(report, tb) {
        const C = tb.VS_COLORS;
        if (!report) return [];

        let titulo, subtitulo, color, bg, icon;
        const ne = report.errors.length;
        const nw = report.warnings.length;

        if (ne > 0) {
            titulo = `Validación interna FALLIDA — ${ne} error${ne > 1 ? 'es' : ''}, ${nw} advertencia${nw > 1 ? 's' : ''}`;
            color = '#A52A2A';
            bg = '#FDECEA';
            icon = '[FAIL]';
        } else if (nw > 0) {
            titulo = `Validación con advertencias — ${nw} ítem${nw > 1 ? 's' : ''}`;
            color = '#B85F0F';
            bg = '#FFF4E5';
            icon = '[!]';
        } else {
            titulo = `Validación interna OK — sin inconsistencias detectadas`;
            color = '#1E7E34';
            bg = '#E8F5E9';
            icon = '[OK]';
        }

        // Resumen breve (sumario de stats si existe)
        const summary = report.summary || {};
        const summaryLines = [];
        if (summary.ursTotal != null) {
            summaryLines.push(`Total URS evaluados: ${summary.ursTotal}`);
        }
        if (summary.cobertura != null) {
            summaryLines.push(`Cobertura URS→TC-OQ: ${summary.cobertura}%`);
        }
        if (summary.tcIqCount != null && summary.tcOqCount != null) {
            summaryLines.push(`TC únicos: ${summary.tcIqCount} IQ + ${summary.tcOqCount} OQ`);
        }

        // Detalle de errors y warnings
        const detalleStack = [];
        if (ne > 0) {
            detalleStack.push({
                text: `Errores (${ne}):`,
                fontSize: 9, bold: true, color: '#A52A2A',
                margin: [0, 6, 0, 2]
            });
            detalleStack.push({
                ul: report.errors.slice(0, 8).map(e => ({
                    text: [
                        e.ctx ? { text: `[${e.ctx}] `, italics: true, fontSize: 8, color: '#717D8A' } : '',
                        { text: e.msg, fontSize: 8, color: C.text }
                    ]
                })),
                margin: [8, 0, 0, 0]
            });
            if (report.errors.length > 8) {
                detalleStack.push({
                    text: `... y ${report.errors.length - 8} error${report.errors.length - 8 > 1 ? 'es' : ''} más.`,
                    fontSize: 8, italics: true, color: '#A52A2A', margin: [8, 2, 0, 0]
                });
            }
        }
        if (nw > 0) {
            detalleStack.push({
                text: `Advertencias (${nw}):`,
                fontSize: 9, bold: true, color: '#B85F0F',
                margin: [0, 6, 0, 2]
            });
            detalleStack.push({
                ul: report.warnings.slice(0, 8).map(w => ({
                    text: [
                        w.ctx ? { text: `[${w.ctx}] `, italics: true, fontSize: 8, color: '#717D8A' } : '',
                        { text: w.msg, fontSize: 8, color: C.text }
                    ]
                })),
                margin: [8, 0, 0, 0]
            });
            if (report.warnings.length > 8) {
                detalleStack.push({
                    text: `... y ${report.warnings.length - 8} advertencia${report.warnings.length - 8 > 1 ? 's' : ''} más.`,
                    fontSize: 8, italics: true, color: '#B85F0F', margin: [8, 2, 0, 0]
                });
            }
        }

        const innerStack = [
            { text: titulo, bold: true, fontSize: 10, color: color, margin: [0, 0, 0, 4] }
        ];
        if (summaryLines.length > 0) {
            innerStack.push({
                text: summaryLines.join(' · '),
                fontSize: 9, italics: true, color: C.textSoft,
                margin: [0, 0, 0, 0]
            });
        }
        if (detalleStack.length > 0) {
            innerStack.push(...detalleStack);
        }

        return [{
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: innerStack,
                    fillColor: bg,
                    margin: [12, 8, 12, 8]
                }]]
            },
            layout: {
                hLineWidth: () => 0,
                vLineWidth: function (i) { return i === 0 ? 4 : 0; },
                vLineColor: () => color,
                paddingLeft: () => 0,
                paddingRight: () => 0,
                paddingTop: () => 0,
                paddingBottom: () => 0
            },
            margin: [0, 0, 0, 12]
        }];
    }

    // ====================================================================
    // TIPO NUEVO: TABLA-TRAZABILIDAD
    //
    // Estructura JSON:
    // {
    //   "tipo": "tabla-trazabilidad",
    //   "titulo": "MATRIZ DE TRAZABILIDAD COMPLETA",
    //   "intro": "Texto opcional",
    //   "filas": [
    //     { "subheader": "MÓDULO A — AUTENTICACIÓN (URS-001 a URS-008)" },
    //     {
    //       "ursId": "URS-001",
    //       "descripcion": "Login con credenciales únicas",
    //       "criticidad": "CRÍTICO",
    //       "modulo": "Autenticación",
    //       "raId": "RA-001",
    //       "tcIq": "TC-IQ-014",
    //       "tcOq": "TC-OQ-001",
    //       "fechaEjecucion": null
    //     }
    //   ]
    // }
    // ====================================================================
    function renderTablaTrazabilidad(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        // Header denso (fontSize 8, margin lateral 3)
        const thT = (text, extra) => tb.vsTh(text, Object.assign({ fontSize: 8, margin: [3, 6, 3, 6] }, extra || {}));
        const body = [[
            thT('URS-ID', { alignment: 'center' }),
            thT('Descripción del Requerimiento'),
            thT('Criticidad', { alignment: 'center' }),
            thT('Módulo'),
            thT('RA-ID', { alignment: 'center' }),
            thT('TC-IQ', { alignment: 'center' }),
            thT('TC-OQ', { alignment: 'center' }),
            thT('Fecha Ejecución', { alignment: 'center' })
        ]];

        const filas = sec.filas || [];
        filas.forEach((f, i) => {
            // Sub-header de modulo
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
            const crit = criticidadColor(f.criticidad);

            body.push([
                tb.vsTd(f.ursId || '', { bold: true, color: C.primary, fillColor: bg, alignment: 'center', fontSize: 8 }),
                tb.vsTd(f.descripcion || '', { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                tb.vsTd(f.criticidad || '', {
                    bold: true,
                    color: crit.fg,
                    fillColor: crit.bg || bg,
                    alignment: 'center',
                    fontSize: 8
                }),
                tb.vsTd(f.modulo || '', { fillColor: bg, fontSize: 8 }),
                tb.vsTd(f.raId || '—', { fillColor: bg, alignment: 'center', fontSize: 7.5, italics: true }),
                tb.vsTd(f.tcIq || '—', { fillColor: bg, alignment: 'center', fontSize: 7.5, italics: true }),
                tb.vsTd(f.tcOq || '—', { fillColor: bg, alignment: 'center', fontSize: 7.5, italics: true }),
                tb.vsTd(f.fechaEjecucion ? tb.formatDateShort(f.fechaEjecucion) : '— PENDIENTE —', {
                    fillColor: bg,
                    alignment: 'center',
                    fontSize: 7,
                    italics: !f.fechaEjecucion,
                    color: f.fechaEjecucion ? C.text : C.neutral
                })
            ]);
        });

        // Anchos: total = 407 (CONTENT_WIDTH 455 - 48 padding denso, 8 cols × 6)
        // URS-ID 39 | Descripcion 113 | Criticidad 45 | Modulo 45 | RA 35 | TC-IQ 48 | TC-OQ 48 | Fecha 34
        // TC-IQ y TC-OQ ampliados: "TC-IQ-001" (9 chars × 4.4pt = 39.6pt) entra en 1 línea en 42pt de contenido
        out.push({
            table: {
                widths: tb.vsScaleWidths([37, 106, 42, 42, 33, 45, 45, 32], 6),
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
    // tabla-firmas-final (compartido con HLRA/VP/URS/FRS/DS/RA/IRA/RRM)
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

    // Wrap unbreakable solo para tablas chicas (<=6 filas)
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
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('MTR', function renderMTR(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        // VALIDACION INTERNA
        const cfgVal = (data._validacion || {});
        const mostrarCaja = cfgVal.mostrarCaja === true;    // default false — no mostrar caja automática
        const estricta = cfgVal.estricta === true;          // default false

        let report = null;
        if (typeof VS.validateDocument === 'function') {
            try {
                report = VS.validateDocument(data);
            } catch (e) {
                report = { valid: false, errors: [{ msg: 'Error en validador: ' + e.message }], warnings: [], info: [], summary: {} };
            }
        }

        // Modo estricto: si hay errors, abortar con texto rojo
        if (estricta && report && !report.valid) {
            return [{
                stack: [
                    { text: 'VALIDACIÓN INTERNA FALLIDA (modo estricto)', fontSize: 14, bold: true, color: '#A52A2A', margin: [0, 0, 0, 10] },
                    { text: 'El documento no se puede generar porque tiene inconsistencias internas. Corregir los errores listados a continuación y volver a generar.', fontSize: 10, italics: true, color: tb.VS_COLORS.text, margin: [0, 0, 0, 10] },
                    ...renderCajaValidacion(report, tb)
                ]
            }];
        }

        // Caja de validacion al inicio (si esta habilitada)
        if (mostrarCaja && report) {
            out.push(...renderCajaValidacion(report, tb));
        }

        // Render normal de secciones
        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);

            let titleBlock = [];
            if (sec.tipo !== 'subseccion') {
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
                case 'tabla-trazabilidad': contentBlock = renderTablaTrazabilidad(sec, tb); break;
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
