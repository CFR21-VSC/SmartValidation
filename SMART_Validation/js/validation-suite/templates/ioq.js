/* ====================================================================
   VALIDATION SUITE — RENDERER IOQ
   Informe de Calificación Operacional (Operational Qualification
   Report). Documento que reporta los resultados de ejecución de los
   TCs definidos en el POQ. Misma estructura que el POQ + secciones
   extras de hallazgos y conclusión.

   Diferencias clave vs POQ:
   - Los TCs vienen con campos de ejecución poblados (procedimiento[].
     resultadoReal, criterioObservado, estado, ejecutor, fechaEjecucion,
     firma, evidenciasGestor, hallazgos).
   - Sección nueva: Resumen de Ejecución OQ (estadística PASS/FAIL/OBS
     con conteo separado de TCs negativos).
   - Sección nueva: Hallazgos consolidados (igual que IIQ).
   - Sección nueva: Conclusión y decisión formal (apto/no apto para PQ).

   Tipos de sección soportados:
   - Todos los compartidos
   - matriz-tc       : matriz resumen con estados ejecutados
   - tabla-test-case : bloques detallados con resultados de ejecución
   - resumen-ejecucion-oq : tabla con totales (PASS/FAIL/OBS/N/A) +
                            TCs negativos contabilizados aparte
   - hallazgos-consolidados : recolecta hallazgos de cada TC
   - tabla-firmas-final : firmas estándar
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[ioq.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // TIPO NUEVO: RESUMEN-EJECUCION-OQ
    //
    // Variante del IIQ resumen con conteo de TCs negativos por separado.
    // El conteo es importante en OQ porque demuestra cobertura de
    // seguridad / validación de inputs (auditor lo lee como métrica).
    //
    // Estructura JSON:
    //   {
    //     "tipo": "resumen-ejecucion-oq",
    //     "titulo": "RESUMEN DE EJECUCIÓN",
    //     "intro": "...",
    //     "tcs": [...]    // necesarios para auto-cálculo
    //   }
    // ====================================================================
    function renderResumenEjecucionOq(sec, tb, documentData) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        // Auto-extrae TCs de tabla-test-case si sec.tcs vacío.
        let tcs = sec.tcs || [];
        if ((!tcs || tcs.length === 0) && documentData && Array.isArray(documentData.secciones)) {
            const matriz = documentData.secciones.find(s => s.tipo === 'matriz-tc');
            const detalleTcs = documentData.secciones
                .filter(s => s.tipo === 'tabla-test-case' && Array.isArray(s.tcs))
                .flatMap(s => s.tcs);
            // Preferir matriz-tc (tiene los TCs completos); fallback al detalle si solo hay representativos.
            if (matriz && Array.isArray(matriz.tcs) && matriz.tcs.length > 0) tcs = matriz.tcs;
            else if (detalleTcs.length > 0) tcs = detalleTcs;
        }
        const porGrupo = {};
        const totales = { pass: 0, fail: 0, obs: 0, na: 0, total: 0 };
        const totalesNeg = { pass: 0, fail: 0, obs: 0, na: 0, total: 0 };

        const normalizar = VS.shared.normalizarEstadoTC;

        function isNegativo(tc) {
            const t = String(tc.tipoTC || '').toUpperCase();
            return t === 'NEGATIVO' || t === 'NEG';
        }

        tcs.forEach(tc => {
            const g = tc.grupo || 'Sin grupo';
            if (!porGrupo[g]) porGrupo[g] = { pass: 0, fail: 0, obs: 0, na: 0, total: 0, neg: 0 };
            const cat = normalizar(tc.estado);
            const neg = isNegativo(tc);

            if (porGrupo[g][cat] != null) porGrupo[g][cat]++;
            if (totales[cat] != null) totales[cat]++;
            porGrupo[g].total++;
            totales.total++;

            if (neg) {
                porGrupo[g].neg++;
                if (totalesNeg[cat] != null) totalesNeg[cat]++;
                totalesNeg.total++;
            }
        });

        // Tabla principal por grupo
        const body = [[
            tb.vsTh('Grupo Funcional'),
            tb.vsTh('Total', { alignment: 'center' }),
            tb.vsTh('PASS', { alignment: 'center' }),
            tb.vsTh('FAIL', { alignment: 'center' }),
            tb.vsTh('OBS', { alignment: 'center' }),
            tb.vsTh('N/A', { alignment: 'center' }),
            tb.vsTh('Negativos', { alignment: 'center' })
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
                tb.vsTd(String(r.na), { alignment: 'center', color: '#717D8A', bold: true, fillColor: bg, fontSize: 9 }),
                tb.vsTd(r.neg > 0 ? String(r.neg) : '—', { alignment: 'center', italics: true, fillColor: bg, fontSize: 9, color: r.neg > 0 ? C.primary : C.textSoft })
            ]);
        });

        // Fila TOTAL
        body.push([
            tb.vsTd('TOTAL', { bold: true, fillColor: '#EAF1F8', fontSize: 9 }),
            tb.vsTd(String(totales.total), { alignment: 'center', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.pass), { alignment: 'center', color: '#1E7E34', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.fail), { alignment: 'center', color: '#A52A2A', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.obs), { alignment: 'center', color: '#B85F0F', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totales.na), { alignment: 'center', color: '#717D8A', bold: true, fillColor: '#EAF1F8', fontSize: 10 }),
            tb.vsTd(String(totalesNeg.total), { alignment: 'center', bold: true, fillColor: '#EAF1F8', fontSize: 10, color: C.primary })
        ]);

        out.push({
            table: { widths: tb.vsScaleWidths([150, 45, 50, 50, 50, 45, 60]), body, headerRows: 1, dontBreakRows: true },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 8]
        });

        // Sub-resumen TCs negativos (si hay)
        if (totalesNeg.total > 0) {
            const negPasaron = totalesNeg.pass + totalesNeg.obs;
            const negColor = totalesNeg.fail === 0 ? '#1E7E34' : '#A52A2A';
            const negBg = totalesNeg.fail === 0 ? '#E8F5E9' : '#FDECEA';
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: [
                            { text: `TCs Negativos: `, bold: true, fontSize: 9, color: C.text },
                            { text: `${negPasaron} de ${totalesNeg.total} `, bold: true, fontSize: 9, color: negColor },
                            { text: 'rechazaron correctamente la acción inválida ', fontSize: 9, italics: true, color: C.text },
                            totalesNeg.fail > 0
                                ? { text: `(${totalesNeg.fail} FAIL — el sistema NO rechazó cuando debía).`, fontSize: 9, italics: true, color: '#A52A2A', bold: true }
                                : { text: '— cobertura de seguridad/validación demostrada.', fontSize: 9, italics: true, color: C.textSoft }
                        ],
                        fillColor: negBg,
                        margin: [12, 8, 12, 8]
                    }]]
                },
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: function (i) { return i === 0 ? 3 : 0; },
                    vLineColor: () => negColor,
                    paddingLeft: () => 0, paddingRight: () => 0
                },
                margin: [0, 0, 0, 12]
            });
        }

        // Caja decisión
        const aprobado = totales.fail === 0 && totales.total > 0;
        const conObs = aprobado && totales.obs > 0;
        const labelDecision = aprobado
            ? (conObs ? 'OQ APROBADA CON OBSERVACIONES' : 'OQ APROBADA')
            : (totales.total === 0 ? 'EJECUCIÓN PENDIENTE' : 'OQ NO APROBADA');
        const colorDecision = aprobado ? (conObs ? '#B85F0F' : '#1E7E34') : (totales.total === 0 ? '#717D8A' : '#A52A2A');
        const bgDecision = aprobado ? (conObs ? '#FFF4E5' : '#E8F5E9') : (totales.total === 0 ? '#F4F6F8' : '#FDECEA');

        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: labelDecision, bold: true, fontSize: 14, color: colorDecision, alignment: 'center', margin: [0, 0, 0, 6] },
                        {
                            text: aprobado
                                ? `${totales.pass}/${totales.total} TCs PASS${conObs ? ` (${totales.obs} con observaciones menores)` : ''}. ${totalesNeg.total > 0 ? `Los ${totalesNeg.total} TCs negativos demostraron cobertura de seguridad. ` : ''}El sistema cumple los criterios operacionales y está apto para la PQ.`
                                : (totales.total === 0
                                    ? 'Aún no se han ejecutado test cases.'
                                    : `${totales.fail} TC(s) con FAIL requieren NCs documentadas y CAPA antes de proceder a PQ.`),
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
    // Reusa la lógica del IIQ pero con texto adaptado a OQ.
    // Si `sec.tcs` está vacío, auto-extrae los TCs con hallazgos desde
    // la sección `tabla-test-case` del documento (vía `_documentRef`).
    // ====================================================================
    function renderHallazgosConsolidados(sec, tb, documentData) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        // Fuente de TCs: prefiere sec.tcs si fue declarado. Si está vacío,
        // auto-extrae de la sección tabla-test-case del documento.
        let tcsSource = sec.tcs || [];
        if ((!tcsSource || tcsSource.length === 0) && documentData && Array.isArray(documentData.secciones)) {
            const detalleTcs = documentData.secciones
                .filter(s => s.tipo === 'tabla-test-case' && Array.isArray(s.tcs))
                .flatMap(s => s.tcs);
            if (detalleTcs.length > 0) tcsSource = detalleTcs;
        }

        const todos = [];
        tcsSource.forEach(tc => {
            (tc.hallazgos || []).forEach(h => {
                todos.push({
                    id: h.id || 'NC-XXX',
                    severidad: h.severidad || h.criticidad || 'Menor',
                    criticidad: h.criticidad || '',
                    estado: h.estado || '',
                    descripcion: h.descripcion || '',
                    accion: h.accion || h.accionCorrectiva || '',
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
                        text: 'Sin hallazgos ni desvíos en la ejecución de la OQ.',
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

        const body = [[
            tb.vsTh('NC-ID', { alignment: 'center' }),
            tb.vsTh('Severidad', { alignment: 'center' }),
            tb.vsTh('TC', { alignment: 'center' }),
            tb.vsTh('Descripción / Causa raíz'),
            tb.vsTh('Acción Correctiva (CAPA)'),
            tb.vsTh('Estado', { alignment: 'center' })
        ]];

        todos.forEach((h, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const sev = String(h.criticidad || h.severidad || '').toUpperCase();
            const sevColor = /MAYOR|CR[ÍI]TIC|ALTO/.test(sev) ? '#A52A2A'
                : /OBSERV|BAJ/.test(sev) ? '#B85F0F'
                : '#717D8A';
            const estadoLabel = String(h.estado || '').toUpperCase();
            const estColor = /CERR/.test(estadoLabel) ? '#1E7E34'
                : /ABIERT|PEND/.test(estadoLabel) ? '#A52A2A'
                : '#717D8A';
            const estBg = /CERR/.test(estadoLabel) ? '#E8F5E9'
                : /ABIERT|PEND/.test(estadoLabel) ? '#FDECEA'
                : '#F4F6F8';
            body.push([
                tb.vsTd(h.id, { bold: true, color: '#A52A2A', alignment: 'center', fillColor: bg, fontSize: 8 }),
                tb.vsTd(h.criticidad || h.severidad, { bold: true, color: sevColor, alignment: 'center', fillColor: bg, fontSize: 7.5 }),
                tb.vsTd(h.tcRef, { italics: true, alignment: 'center', fillColor: bg, fontSize: 7.5 }),
                tb.vsTd(h.descripcion, { fillColor: bg, fontSize: 7.5, lineHeight: 1.25 }),
                tb.vsTd(h.accion, { fillColor: bg, fontSize: 7.5, lineHeight: 1.25 }),
                tb.vsTd(h.estado || '—', { bold: true, color: estColor, fillColor: estBg, alignment: 'center', fontSize: 7.5 })
            ]);
        });

        out.push({
            table: {
                widths: tb.vsScaleWidths([31, 41, 26, 108, 116, 37]),
                body, headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 10]
        });

        const cerradas = todos.filter(h => /CERR/.test(String(h.estado || '').toUpperCase())).length;
        const abiertas = todos.length - cerradas;
        out.push({
            text: cerradas === todos.length
                ? `Total: ${todos.length} hallazgo(s). Todas las NC fueron cerradas con su CAPA verificada antes del cierre del IOQ.`
                : `Total: ${todos.length} hallazgo(s) — ${cerradas} CERRADAS, ${abiertas} ABIERTAS. Las NC abiertas requieren cierre y CAPA verificada antes de la liberación.`,
            fontSize: 9, italics: true, color: abiertas === 0 ? '#1E7E34' : C.textSoft,
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
    VS.registerRenderer('IOQ', function renderIOQ(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const iq = VS.iqShared;
        const out = [];
        const secciones = data.secciones || [];

        // El modo es siempre 'informe' para IOQ
        const MODE = 'informe';

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
                case 'matriz-tc': contentBlock = iq.renderSeccionMatriz(sec, tb, MODE); break;
                case 'tabla-test-case': contentBlock = iq.renderSeccionTabla(sec, tb, MODE); break;
                case 'resumen-ejecucion-oq': contentBlock = renderResumenEjecucionOq(sec, tb, data); break;
                case 'hallazgos-consolidados': contentBlock = renderHallazgosConsolidados(sec, tb, data); break;
                case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                default:
                    contentBlock = [{
                        text: `[Tipo de sección desconocido: ${sec.tipo}]`,
                        color: '#FF0000', margin: [0, 0, 0, 12]
                    }];
            }

            out.push(...maybeWrapUnbreakable(sec, titleBlock, contentBlock));
        });

        return out;
    });

})(window);
