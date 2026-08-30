/* ====================================================================
   VALIDATION SUITE — RENDERER IIQ
   Informe de Calificacion de Instalacion (Installation Qualification
   Report). Documento que reporta los resultados de ejecucion de los
   TCs definidos en el PIQ. Misma estructura que el PIQ + secciones
   extras de hallazgos y conclusion.

   Diferencias clave vs PIQ:
   - Los TCs vienen con campos de ejecucion poblados (estado, ejecutor,
     fechaEjecucion, firma, evidenciasGestor, hallazgos).
   - Seccion nueva: Resumen de Ejecucion (estadistica PASS/FAIL/OBS).
   - Seccion nueva: Hallazgos y Desvios consolidados (recolecta los
     hallazgos de cada TC en una vista unica).
   - Seccion nueva: Conclusion y decision formal (apto/no apto para OQ).

   Tipos de seccion soportados:
   - Todos los compartidos
   - matriz-tc       : matriz resumen con estados ejecutados (PASS/FAIL)
   - tabla-test-case : bloques detallados con resultados de ejecucion
   - resumen-ejecucion-iq : tabla con totales (PASS/FAIL/OBS/N/A por grupo)
   - hallazgos-consolidados : recolecta hallazgos de cada TC
   - tabla-firmas-final : firmas estandar
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[iiq.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // TIPO NUEVO: RESUMEN-EJECUCION-IQ
    //
    // Tabla con totales por grupo + total global.
    // Auto-calcula desde los TCs si no se proveen filas explicitas.
    //
    // Estructura JSON:
    //   {
    //     "tipo": "resumen-ejecucion-iq",
    //     "titulo": "RESUMEN DE EJECUCION",
    //     "intro": "...",
    //     "tcs": [...]    // si presente, calcula automaticamente
    //   }
    // ====================================================================
    function renderResumenEjecucionIq(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        // Calcular estadisticas desde los TCs
        const tcs = sec.tcs || [];
        const porGrupo = {};
        const totales = { pass: 0, fail: 0, obs: 0, na: 0, total: 0 };

        const normalizar = VS.shared.normalizarEstadoTC;

        tcs.forEach(tc => {
            const g = tc.grupo || 'Sin grupo';
            if (!porGrupo[g]) porGrupo[g] = { pass: 0, fail: 0, obs: 0, na: 0, total: 0 };
            const cat = normalizar(tc.estado);
            if (porGrupo[g][cat] != null) porGrupo[g][cat]++;
            if (totales[cat] != null) totales[cat]++;
            porGrupo[g].total++;
            totales.total++;
        });

        // Tabla
        const body = [[
            tb.vsTh('Grupo'),
            tb.vsTh('Total', { alignment: 'center' }),
            tb.vsTh('PASS', { alignment: 'center' }),
            tb.vsTh('FAIL', { alignment: 'center' }),
            tb.vsTh('OBS', { alignment: 'center' }),
            tb.vsTh('N/A', { alignment: 'center' })
        ]];

        Object.keys(porGrupo).forEach((g, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const r = porGrupo[g];
            body.push([
                tb.vsTd(g, { fillColor: bg, fontSize: 9 }),
                tb.vsTd(String(r.total), { alignment: 'center', bold: true, fillColor: bg, fontSize: 9 }),
                tb.vsTd(String(r.pass), { alignment: 'center', color: '#1E7E34', bold: true, fillColor: bg, fontSize: 9 }),
                tb.vsTd(String(r.fail), { alignment: 'center', color: '#A52A2A', bold: true, fillColor: bg, fontSize: 9 }),
                tb.vsTd(String(r.obs), { alignment: 'center', color: '#B85F0F', bold: true, fillColor: bg, fontSize: 9 }),
                tb.vsTd(String(r.na), { alignment: 'center', color: '#717D8A', bold: true, fillColor: bg, fontSize: 9 })
            ]);
        });

        // Fila TOTAL
        body.push([
            tb.vsTd('TOTAL', { bold: true, fillColor: '#EAF1F8', fontSize: 9 }),
            tb.vsTd(String(totales.total), { alignment: 'center', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.pass), { alignment: 'center', color: '#1E7E34', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.fail), { alignment: 'center', color: '#A52A2A', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.obs), { alignment: 'center', color: '#B85F0F', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.na), { alignment: 'center', color: '#717D8A', bold: true, fillColor: '#EAF1F8', fontSize: 10 })
        ]);

        out.push({
            table: { widths: tb.vsScaleWidths([180, 50, 55, 55, 55, 55]), body, headerRows: 1, dontBreakRows: true },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 10]
        });

        // Caja resumen / decision
        const aprobado = totales.fail === 0 && totales.total > 0;
        const conObs   = aprobado && totales.obs > 0;
        const labelDecision = aprobado
            ? (conObs ? 'IQ APROBADA CON OBSERVACIONES' : 'IQ APROBADA')
            : (totales.total === 0 ? 'EJECUCIÓN PENDIENTE' : 'IQ NO APROBADA');
        const colorDecision = aprobado
            ? (conObs ? '#B85F0F' : '#1E7E34')
            : (totales.total === 0 ? '#717D8A' : '#A52A2A');
        const bgDecision = aprobado
            ? (conObs ? '#FFF4E5' : '#E8F5E9')
            : (totales.total === 0 ? '#F4F6F8' : '#FDECEA');

        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: labelDecision, bold: true, fontSize: 14, color: colorDecision, alignment: 'center', margin: [0, 0, 0, 6] },
                        {
                            text: aprobado
                                ? (conObs
                                    ? `${totales.pass}/${totales.total} TCs aprobados. ${totales.obs} TC(s) con observaciones requieren seguimiento documentado antes de proceder a OQ.`
                                    : `${totales.pass}/${totales.total} TCs aprobados sin desvíos. El sistema cumple los criterios de aceptación de la IQ.`)
                                : (totales.total === 0
                                    ? 'Aún no se han ejecutado test cases.'
                                    : `${totales.fail} TC(s) con FAIL requieren NCs documentadas y CAPA antes de proceder a OQ.`),
                            fontSize: 9, italics: true, color: C.text, alignment: 'center'
                        }
                    ],
                    fillColor: bgDecision,
                    margin: [16, 12, 16, 12]
                }]]
            },
            layout: {
                hLineWidth: () => 1,
                vLineWidth: () => 1,
                hLineColor: () => colorDecision,
                vLineColor: () => colorDecision,
                paddingLeft: () => 0, paddingRight: () => 0
            },
            margin: [0, 0, 0, 12]
        });

        return out;
    }

    // ====================================================================
    // TIPO NUEVO: HALLAZGOS-CONSOLIDADOS
    //
    // Recolecta los hallazgos definidos dentro de cada TC y los muestra
    // como tarjetas individuales. Cada hallazgo tiene: id, severidad,
    // descripcion, accion, tcRef.
    //
    // Estructura JSON:
    //   {
    //     "tipo": "hallazgos-consolidados",
    //     "titulo": "HALLAZGOS Y DESVIOS",
    //     "tcs": [...]   // se extraen los hallazgos de cada TC
    //   }
    //
    // Si no hay hallazgos en ningun TC, muestra mensaje "Sin hallazgos".
    // ====================================================================
    function renderHallazgosConsolidados(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        // Recolectar hallazgos de cada TC
        const todos = [];
        (sec.tcs || []).forEach(tc => {
            (tc.hallazgos || []).forEach(h => {
                todos.push({
                    id: h.id || 'NC-XXX',
                    severidad: h.severidad || 'Menor',
                    descripcion: h.descripcion || '',
                    accion: h.accion || '',
                    tcRef: tc.tcId,
                    tcTitulo: tc.titulo || ''
                });
            });
        });

        if (todos.length === 0) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: 'Sin hallazgos ni desvíos en la ejecución de la IQ.',
                        bold: true, fontSize: 10, color: '#1E7E34',
                        fillColor: '#E8F5E9',
                        alignment: 'center',
                        margin: [12, 10, 12, 10]
                    }]]
                },
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: function (i) { return i === 0 ? 4 : 0; },
                    vLineColor: () => '#1E7E34',
                    paddingLeft: () => 0, paddingRight: () => 0
                },
                margin: [0, 0, 0, 12]
            });
            return out;
        }

        // Tabla resumen de hallazgos
        const body = [[
            tb.vsTh('NC-ID', { alignment: 'center' }),
            tb.vsTh('Severidad', { alignment: 'center' }),
            tb.vsTh('TC Asociado', { alignment: 'center' }),
            tb.vsTh('Descripción del Hallazgo'),
            tb.vsTh('Acción Requerida')
        ]];

        todos.forEach((h, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const sev = h.severidad.toUpperCase();
            const sevColor = /MAYOR|CR[ÍI]TIC/.test(sev) ? '#A52A2A' : '#B85F0F';
            body.push([
                tb.vsTd(h.id, { bold: true, color: '#A52A2A', alignment: 'center', fillColor: bg, fontSize: 8 }),
                tb.vsTd(h.severidad, { bold: true, color: sevColor, alignment: 'center', fillColor: bg, fontSize: 8 }),
                tb.vsTd(h.tcRef, { italics: true, alignment: 'center', fillColor: bg, fontSize: 8 }),
                tb.vsTd(h.descripcion, { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                tb.vsTd(h.accion, { fillColor: bg, fontSize: 8, lineHeight: 1.3 })
            ]);
        });

        out.push({
            table: {
                widths: tb.vsScaleWidths([40, 49, 45, 118, 118]),
                body, headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        // Nota de cierre
        out.push({
            text: `Total de hallazgos: ${todos.length}. Cada uno requiere CAPA documentada antes del cierre de la IQ.`,
            fontSize: 9, italics: true, color: C.textSoft,
            margin: [0, 0, 0, 8]
        });

        return out;
    }

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
    VS.registerRenderer('IIQ', function renderIIQ(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const iq = VS.iqShared;
        const out = [];
        const secciones = data.secciones || [];

        // El modo es siempre 'informe' para IIQ
        const MODE = 'informe';

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
                case 'matriz-tc': contentBlock = iq.renderSeccionMatriz(sec, tb, MODE); break;
                case 'tabla-test-case': contentBlock = iq.renderSeccionTabla(sec, tb, MODE); break;
                case 'resumen-ejecucion-iq': contentBlock = renderResumenEjecucionIq(sec, tb); break;
                case 'hallazgos-consolidados': contentBlock = renderHallazgosConsolidados(sec, tb); break;
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
