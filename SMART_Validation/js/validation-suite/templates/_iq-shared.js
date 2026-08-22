/* ====================================================================
   VALIDATION SUITE — QUALIFICATION SHARED RENDERERS
   Renderers compartidos entre los pares Protocolo/Informe de las
   calificaciones IQ, OQ y PQ.

   Notas de naming:
   - El nombre de archivo sigue siendo `_iq-shared.js` por compatibilidad
     histórica. El módulo expone alias `VS.qualificationShared` y
     `VS.iqShared` (ambos apuntan al mismo objeto).
   - Cuando entre PQ y migremos imports, podemos renombrar el archivo
     a `_qualification-shared.js`. Esto no es bloqueante hoy.

   Filosofía:
   - IQ usa criterios consolidados (CSA): TC = objetivo + criterios[] +
     evidenciaEsperada.
   - OQ usa procedimiento numerado (CSA aplicado a comportamiento):
     TC = objetivo + procedimiento[{paso, instruccion, resultadoEsperado}]
     + criterioAceptacion (single string).
   - El mismo objeto Test Case sirve para protocolo (P*Q) e informe (I*Q).
     La diferencia es si los campos de ejecución (estado, ejecutor,
     resultadoReal por paso, criterioObservado, evidencias, hallazgos)
     están o no poblados.

   Schema modo (declarado por sección `tabla-test-case`):
   - schemaModo='criterios'    : render IQ-style (criterios[] + evidenciaEsperada).
   - schemaModo='procedimiento': render OQ-style (procedimiento[] + criterioAceptacion).
   - default (sin declarar)    : 'criterios' (backwards-compat con PIQ/IIQ).

   Modo de render (derivado del documento, no del JSON):
   - mode='protocolo' (PIQ/POQ): placeholders, [ ] PASS [ ] FAIL.
   - mode='informe'   (IIQ/IOQ): valores ejecutados, badge PASS/FAIL coloreado,
                                  evidencias gestor, hallazgos.

   Tipos de sección expuestos en VS.iqShared / VS.qualificationShared:
   - renderMatrizUnificadaTC : matriz resumen (configurable vía columnasVisibles).
   - renderBloqueTestCase    : bloque detallado de UN TC (rama por schemaModo).
   - renderTablaTC / renderSeccionTabla : sección "tabla-test-case".
   - renderSeccionMatriz     : sección "matriz-tc".
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.iqShared = VS.iqShared || {};

    // ====================================================================
    // HELPERS
    // ====================================================================

    // Mapeo legacy IQ: raScore (1-27) → nivel + verificación.
    // Usado cuando el TC NO declara `nivel` explícito (caso PIQ).
    function nivelIraScore(score) {
        const n = parseInt(score, 10);
        if (isNaN(n) || n < 1) return { nivel: '—', color: '#717D8A', verif: '—' };
        if (n <= 4) return { nivel: 'BAJO', color: '#27AE60', verif: 'Básica' };
        if (n <= 8) return { nivel: 'MEDIO', color: '#E67E22', verif: 'Estándar' };
        return { nivel: 'ALTO', color: '#C0392B', verif: 'Exhaustiva' };
    }

    // Resolver nivel del TC. Prioriza `tc.nivel` (explícito en OQ/PQ) y cae
    // a `nivelIraScore(tc.raScore)` (legacy IQ).
    // Devuelve { nivel, color, verif }.
    function getNivelInfo(tc) {
        if (tc && tc.nivel) {
            const n = String(tc.nivel).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            const map = {
                'CRITICO': { nivel: 'CRÍTICO', color: '#7B1F1F', verif: 'Exhaustiva' },
                'ALTO': { nivel: 'ALTO', color: '#C0392B', verif: 'Exhaustiva' },
                'MEDIO': { nivel: 'MEDIO', color: '#E67E22', verif: 'Estándar' },
                'BAJO': { nivel: 'BAJO', color: '#27AE60', verif: 'Básica' }
            };
            if (map[n]) {
                const out = Object.assign({}, map[n]);
                if (tc.profundidad) out.verif = tc.profundidad;
                return out;
            }
        }
        return nivelIraScore(tc && tc.raScore);
    }

    // Badge POSITIVO/NEGATIVO para TCs OQ. Devuelve null si no aplica.
    function tipoTCInfo(tc) {
        const t = String((tc && tc.tipoTC) || '').toUpperCase();
        if (t === 'POSITIVO' || t === 'POS') return { color: '#1E7E34', bg: '#E8F5E9', label: 'POS', full: 'POSITIVO' };
        if (t === 'NEGATIVO' || t === 'NEG') return { color: '#A52A2A', bg: '#FDECEA', label: 'NEG', full: 'NEGATIVO' };
        return null;
    }

    // Estado de ejecución (TCs en informe).
    function estadoTcColor(estado) {
        const e = String(estado || '').toUpperCase().trim();
        if (e === 'PASS' || e === 'PASA') return { color: '#1E7E34', bg: '#E8F5E9', label: 'PASS' };
        if (e === 'FAIL' || e === 'NO PASA') return { color: '#A52A2A', bg: '#FDECEA', label: 'FAIL' };
        if (e === 'OBS' || e === 'PASS_OBS' || e === 'PASA CON OBSERVACIONES') return { color: '#B85F0F', bg: '#FFF4E5', label: 'OBS' };
        if (e === 'NA' || e === 'N/A' || e === 'NO APLICA') return { color: '#717D8A', bg: '#F4F6F8', label: 'N/A' };
        return { color: '#717D8A', bg: null, label: '—' };
    }

    function isModeInforme(mode) {
        return mode === 'informe' || mode === 'IIQ' || mode === 'IOQ' || mode === 'IPQ';
    }

    // ====================================================================
    // COLUMN REGISTRY (matriz unificada)
    //
    // Cada columna declara su header, ancho, y función de render.
    // `renderMatrizUnificadaTC` arma la tabla iterando `columnasVisibles`.
    // Si `columnasVisibles` no se declara, usa el default IQ (7 columnas)
    // para preservar backwards-compat con PIQ/IIQ.
    // ====================================================================
    function buildColumnRegistry(tb) {
        const C = tb.VS_COLORS;

        return {
            tcId: {
                th: 'TC-ID', width: 35, widthDense: 32,
                thOpts: { alignment: 'center' },
                render: (tc, o) => tb.vsTd(tc.tcId || '', { bold: true, color: C.primary, fillColor: o.bg, alignment: 'center', fontSize: o.dense ? 7 : 8 })
            },
            titulo: {
                th: 'Título / Objetivo', width: 110, widthDense: 92,
                render: (tc, o) => tb.vsTd(tc.titulo || '', { fillColor: o.bg, fontSize: o.dense ? 7 : 8, lineHeight: 1.25 })
            },
            componente: {
                th: 'Componente', width: 60, widthDense: 52,
                render: (tc, o) => tb.vsTd(tc.componente || '—', { fillColor: o.bg, fontSize: o.dense ? 6.5 : 7.5, italics: true })
            },
            grupo: {
                th: 'Grupo', width: 70, widthDense: 58,
                render: (tc, o) => tb.vsTd(tc.grupo || '—', { fillColor: o.bg, fontSize: o.dense ? 6.5 : 7.5 })
            },
            tipoTC: {
                th: 'Tipo', width: 28, widthDense: 24,
                thOpts: { alignment: 'center' },
                render: (tc, o) => {
                    const t = tipoTCInfo(tc);
                    if (!t) return tb.vsTd('—', { fillColor: o.bg, alignment: 'center', fontSize: 7, color: C.textSoft });
                    return tb.vsTd(t.label, { bold: true, color: t.color, fillColor: t.bg || o.bg, alignment: 'center', fontSize: o.dense ? 6.5 : 7.5 });
                }
            },
            raScore: {
                th: 'RA', width: 30, widthDense: 22,
                thOpts: { alignment: 'center' },
                render: (tc, o) => {
                    const niv = getNivelInfo(tc);
                    return {
                        stack: [
                            { text: tc.raScore != null ? String(tc.raScore) : '—', bold: true, fontSize: o.dense ? 8 : 9, alignment: 'center' },
                            // Si la matriz NO incluye columna `nivel`, anexamos el label aquí (legacy IQ).
                            o.includesNivelCol ? null : { text: niv.nivel, fontSize: 6.5, bold: true, color: niv.color, alignment: 'center' }
                        ].filter(Boolean),
                        fillColor: o.bg,
                        margin: [2, 4, 2, 4]
                    };
                }
            },
            nivel: {
                th: 'Nivel', width: 42, widthDense: 36,
                thOpts: { alignment: 'center' },
                render: (tc, o) => {
                    const niv = getNivelInfo(tc);
                    return tb.vsTd(niv.nivel || '—', { fillColor: o.bg, alignment: 'center', fontSize: o.dense ? 6.5 : 7.5, color: niv.color, bold: true });
                }
            },
            ursVinculados: {
                th: 'URS', width: 60, widthDense: 50,
                thOpts: { alignment: 'center' },
                render: (tc, o) => {
                    const ursTxt = Array.isArray(tc.ursVinculados) ? tc.ursVinculados.join(' | ') : (tc.ursVinculados || '—');
                    return tb.vsTd(ursTxt, { fillColor: o.bg, alignment: 'center', fontSize: o.dense ? 6 : 7, italics: true });
                }
            },
            profundidad: {
                th: 'Profund.', width: 50, widthDense: 42,
                thOpts: { alignment: 'center' },
                render: (tc, o) => {
                    const niv = getNivelInfo(tc);
                    return tb.vsTd(tc.profundidad || niv.verif || '—', { fillColor: o.bg, alignment: 'center', fontSize: o.dense ? 6.5 : 7.5, color: niv.color, bold: true });
                }
            },
            estado: {
                th: 'Estado', width: 48, widthDense: 40,
                thOpts: { alignment: 'center' },
                render: (tc, o) => {
                    if (o.informe) {
                        const est = estadoTcColor(tc.estado);
                        return tb.vsTd(est.label, { bold: true, color: est.color, fillColor: est.bg || o.bg, alignment: 'center', fontSize: o.dense ? 7 : 8 });
                    }
                    return tb.vsTd('PENDIENTE', { italics: true, color: C.neutral, fillColor: o.bg, alignment: 'center', fontSize: 7 });
                }
            },
            ejecutor: {
                th: 'Ejec.', width: 52, widthDense: 35,
                thOpts: { alignment: 'center' },
                render: (tc, o) => tb.vsTd(tc.ejecutor || '—', { fillColor: o.bg, alignment: 'center', fontSize: o.dense ? 6.5 : 7, italics: !tc.ejecutor, color: tc.ejecutor ? C.text : C.textSoft })
            },
            fechaEjecucion: {
                th: 'Fecha', width: 42, widthDense: 38,
                thOpts: { alignment: 'center' },
                render: (tc, o) => tb.vsTd(tc.fechaEjecucion || '—', { fillColor: o.bg, alignment: 'center', fontSize: o.dense ? 6.5 : 7, italics: !tc.fechaEjecucion, color: tc.fechaEjecucion ? C.text : C.textSoft })
            },
            evidenciasCount: {
                th: 'Ev.', width: 28, widthDense: 22,
                thOpts: { alignment: 'center' },
                render: (tc, o) => {
                    const count = Array.isArray(tc.evidenciasGestor)
                        ? tc.evidenciasGestor.length
                        : (typeof tc.evidenciasCount === 'number' ? tc.evidenciasCount : 0);
                    return tb.vsTd(String(count), { fillColor: o.bg, alignment: 'center', fontSize: o.dense ? 7 : 8, bold: count > 0, color: count > 0 ? C.primary : C.textSoft });
                }
            }
        };
    }

    // ====================================================================
    // 1. MATRIZ UNIFICADA DE TCs (vista ejecutiva)
    //
    // Backwards-compat: si `opts.columnasVisibles` no se pasa, usa el set
    // default IQ con las 7 columnas históricas y los mismos widths.
    // Si se pasa, usa el registry para construir la tabla.
    // ====================================================================
    function renderMatrizUnificadaTC(testCases, tb, mode, opts) {
        opts = opts || {};
        const C = tb.VS_COLORS;
        const informe = isModeInforme(mode);
        const out = [];

        // Default IQ (legacy): 7 columnas con los widths históricos.
        const DEFAULT_COLUMNS = ['tcId', 'titulo', 'componente', 'raScore', 'ursVinculados', 'profundidad', 'estado'];
        const columns = (Array.isArray(opts.columnasVisibles) && opts.columnasVisibles.length > 0)
            ? opts.columnasVisibles
            : DEFAULT_COLUMNS;

        const registry = buildColumnRegistry(tb);
        const includesNivelCol = columns.indexOf('nivel') >= 0;

        // Modo "dense" — para matrices con muchas columnas (informes IOQ/IPQ típicamente 11 cols).
        // Activa widths/fontsize reducidos para que la suma de widths quepa en A4 portrait (~510pt).
        const denseMatrix = columns.length >= 9;

        // Header
        const body = [columns.map(colKey => {
            const col = registry[colKey];
            if (!col) return tb.vsTh(colKey, { fontSize: denseMatrix ? 7 : 8 });
            return tb.vsTh(col.th, Object.assign(
                { fontSize: denseMatrix ? 7 : 8, margin: [3, 6, 3, 6] },
                col.thOpts || {}
            ));
        })];

        // Body
        const tcs = testCases || [];
        tcs.forEach((tc, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const cellOpts = { bg, informe, includesNivelCol, dense: denseMatrix };
            body.push(columns.map(colKey => {
                const col = registry[colKey];
                if (!col) return tb.vsTd('—', { fillColor: bg, fontSize: 7, alignment: 'center' });
                return col.render(tc, cellOpts);
            }));
        });

        // Widths: legacy IQ usa los originales (suma 413, cabe en A4 portrait).
        // Con columnasVisibles densa, usa widthDense de cada columna para que la suma
        // quede dentro del ancho útil A4 portrait (~510pt) y no haya desborde visual.
        const widths = columns.map(colKey => {
            const col = registry[colKey];
            if (!col) return 50;
            return (denseMatrix && col.widthDense != null) ? col.widthDense : col.width;
        });

        out.push({
            table: {
                widths: widths,
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
    // 2. PROCEDIMIENTO TABLE (TCs OQ)
    //
    // Tabla de 4 columnas: Paso | Instrucción | Resultado Esperado |
    // Resultado Real. En modo protocolo la última columna es placeholder
    // (líneas para llenado a mano si se imprime). En modo informe se
    // rellena con `paso.resultadoReal`.
    // ====================================================================
    function renderProcedimientoTable(procedimiento, tb, mode) {
        const C = tb.VS_COLORS;
        const informe = isModeInforme(mode);
        const pasos = Array.isArray(procedimiento) ? procedimiento : [];

        const body = [[
            tb.vsTh('Paso', { alignment: 'center', fontSize: 9 }),
            tb.vsTh('Instrucción', { fontSize: 9 }),
            tb.vsTh('Resultado Esperado', { fontSize: 9 }),
            tb.vsTh('Resultado Real', { alignment: informe ? 'left' : 'center', fontSize: 9 })
        ]];

        pasos.forEach((p, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const numero = (p.paso != null) ? String(p.paso) : String(i + 1);
            const real = p.resultadoReal || '';
            const realCell = informe
                ? tb.vsTd(real || '—', {
                    fontSize: 9, fillColor: bg,
                    italics: !real, color: real ? C.text : C.textSoft
                })
                : tb.vsTd('________________', {
                    fontSize: 9, fillColor: bg, color: C.textSoft, italics: true, alignment: 'center'
                });

            body.push([
                tb.vsTd(numero, { fontSize: 9, alignment: 'center', bold: true, color: C.primary, fillColor: bg }),
                tb.vsTd(p.instruccion || '', { fontSize: 9, fillColor: bg, lineHeight: 1.3 }),
                tb.vsTd(p.resultadoEsperado || '', { fontSize: 9, fillColor: bg, lineHeight: 1.3 }),
                realCell
            ]);
        });

        return {
            table: { widths: tb.vsScaleWidths([25, 165, 145, 80]), body: body, headerRows: 1, dontBreakRows: true },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 8]
        };
    }

    // ====================================================================
    // 3. METADATA TABLE de un TC (header debajo del título)
    //
    // Se adapta automáticamente: muestra `componente/IRA-ID` para IQ,
    // `tipoTC/Grupo funcional` para OQ. Filas vacías se omiten.
    // ====================================================================
    function renderTcMetadataTable(tc, tb, schemaModo) {
        const C = tb.VS_COLORS;
        const niv = getNivelInfo(tc);
        const tipo = tipoTCInfo(tc);
        const ursTxt = Array.isArray(tc.ursVinculados) ? tc.ursVinculados.join(' | ') : (tc.ursVinculados || '—');

        // Decidimos columnas izquierdas según schemaModo
        const isOq = schemaModo === 'procedimiento';

        // Fila 1
        const row1 = isOq
            ? [
                tb.vsTd('Tipo de TC', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
                tipo
                    ? tb.vsTd(tipo.full, { fontSize: 9, bold: true, color: tipo.color })
                    : tb.vsTd('—', { fontSize: 9, italics: true, color: C.textSoft }),
                tb.vsTd('Grupo funcional', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
                tb.vsTd(tc.grupoFuncional || tc.grupo || '—', { fontSize: 9 })
            ]
            : [
                tb.vsTd('Componente', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
                tb.vsTd(tc.componenteDesc || tc.componente || '—', { fontSize: 9 }),
                tb.vsTd('IRA-ID', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
                tb.vsTd(tc.componente || '—', { fontSize: 9, italics: true })
            ];

        // Fila 2 (común): URS vinculados + RA Score / nivel
        const row2 = [
            tb.vsTd('URS vinculados', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
            tb.vsTd(ursTxt, { fontSize: 9 }),
            tb.vsTd(isOq ? 'RPN / Nivel' : 'RA Score', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
            {
                stack: [
                    { text: (tc.raScore != null ? String(tc.raScore) : '—') + (tc.raScore != null ? ' — ' + niv.nivel : ''), bold: true, color: niv.color, fontSize: 10 }
                ],
                margin: [6, 5, 6, 5]
            }
        ];

        // Fila 3 (común): RA vinculado + Profundidad
        const row3 = [
            tb.vsTd(isOq ? 'Riesgo (RA)' : 'RA vinculado', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
            tb.vsTd(tc.raVinculado || '—', { fontSize: 9, italics: true }),
            tb.vsTd(isOq ? 'Severidad' : 'Tipo / Profund.', { bold: true, fillColor: C.bgSoft, fontSize: 9 }),
            tb.vsTd(tc.profundidad || niv.verif, { fontSize: 9, bold: true, color: niv.color })
        ];

        return {
            table: { widths: tb.vsScaleWidths([85, 145, 75, 145]), body: [row1, row2, row3], dontBreakRows: true },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 8]
        };
    }

    // ====================================================================
    // 4. BLOQUE DETALLADO DE UN TC
    //
    // Header con metadata + objetivo + procedimiento|criterios + criterio
    // de aceptación|evidencia esperada + sección de resultado.
    // El branching por schemaModo determina el render del cuerpo del TC.
    // ====================================================================
    function renderBloqueTestCase(tc, tb, mode, schemaModo) {
        const C = tb.VS_COLORS;
        const out = [];
        const informe = isModeInforme(mode);
        schemaModo = schemaModo || 'criterios'; // backwards compat

        // ── BANNER full-width del TC ──
        // Mismo patrón visual que el AEX (tabla con badge de estado a la
        // derecha cuando es informe). Antes era un `stack` con `text +
        // fillColor` que renderizaba el azul SOLO alrededor del texto (no
        // full-width) y, al estar como bloque suelto separado de la
        // metadata, podía quedar al pie de una página mientras la metadata
        // saltaba a la siguiente — dejando al lector sin TC-ID visible.
        const tipo = tipoTCInfo(tc);
        const est = informe ? estadoTcColor(tc.estado) : null;
        const tipoSuffix = tipo ? '   [' + tipo.full + ']' : '';
        const headerText = [
            { text: (tc.tcId || 'TC-XXX') + '  ', bold: true, fontSize: 12, color: '#FFFFFF' },
            { text: '— ' + (tc.titulo || ''), bold: true, fontSize: 11, color: '#FFFFFF' },
            tipoSuffix ? { text: tipoSuffix, italics: true, fontSize: 9, color: '#FFFFFF' } : ''
        ];

        let bannerBlock;
        if (informe && est && est.label !== '—') {
            // Banner con badge de estado a la derecha
            bannerBlock = {
                table: {
                    widths: ['*', 60],
                    body: [[
                        { text: headerText, fillColor: C.primary, margin: [10, 8, 10, 8] },
                        { text: est.label, bold: true, fontSize: 12, color: '#FFFFFF', fillColor: est.color, alignment: 'center', margin: [4, 8, 4, 8] }
                    ]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
            };
        } else {
            // Protocolo / informe sin estado: banner simple full-width
            bannerBlock = {
                table: {
                    widths: ['*'],
                    body: [[
                        { text: headerText, fillColor: C.primary, margin: [10, 8, 10, 8] }
                    ]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
            };
        }

        // ── HEADER UNBREAKABLE ──
        // Banner + metadata + objetivo + grupo van juntos: si no hay espacio
        // en la página actual, saltan TODOS a la siguiente. Así el lector
        // nunca encuentra metadata sin TC-ID arriba.
        const headerStack = [bannerBlock];
        headerStack.push(renderTcMetadataTable(tc, tb, schemaModo));

        if (tc.objetivo) {
            headerStack.push({
                text: [
                    { text: 'Objetivo: ', bold: true, color: C.primary, fontSize: 10 },
                    { text: tc.objetivo, fontSize: 10, color: C.text }
                ],
                alignment: 'justify', lineHeight: 1.4, margin: [0, 0, 0, 6]
            });
        }

        if (tc.grupo && schemaModo !== 'procedimiento') {
            headerStack.push({
                text: [
                    { text: 'Grupo: ', bold: true, color: C.primary, fontSize: 9 },
                    { text: tc.grupo, fontSize: 9, color: C.text }
                ],
                margin: [0, 0, 0, 6]
            });
        }

        out.push({ unbreakable: true, stack: headerStack, margin: [0, 0, 0, 0] });

        // Precondiciones (común)
        if (tc.precondiciones && tc.precondiciones.length > 0) {
            out.push({ text: 'Precondiciones:', bold: true, color: C.primary, fontSize: 9, margin: [0, 4, 0, 4] });
            out.push({
                ul: tc.precondiciones.map(p => ({ text: p, fontSize: 9, color: C.text })),
                margin: [8, 0, 0, 8]
            });
        }

        // ===== Branch por schemaModo =====
        if (schemaModo === 'procedimiento') {
            // OQ: tabla numerada de procedimiento + criterio de aceptación
            out.push({
                text: 'Procedimiento:',
                bold: true, color: C.primary, fontSize: 9,
                margin: [0, 4, 0, 4]
            });
            out.push(renderProcedimientoTable(tc.procedimiento, tb, mode));

            // Criterio de aceptación (consolidado, string único)
            if (tc.criterioAceptacion) {
                out.push({
                    table: {
                        widths: ['*'],
                        body: [[{
                            text: [
                                { text: 'Criterio de aceptación: ', bold: true, color: C.primary, fontSize: 9 },
                                { text: tc.criterioAceptacion, fontSize: 9, color: C.text }
                            ],
                            margin: [10, 6, 10, 6],
                            fillColor: C.bgSoft
                        }]]
                    },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                    margin: [0, 0, 0, 6]
                });
            }

            // Criterio observado (solo informe)
            if (informe && tc.criterioObservado) {
                out.push({
                    table: {
                        widths: ['*'],
                        body: [[{
                            text: [
                                { text: 'Resultado observado: ', bold: true, color: C.primary, fontSize: 9 },
                                { text: tc.criterioObservado, fontSize: 9, color: C.text, italics: true }
                            ],
                            margin: [10, 6, 10, 6],
                            fillColor: '#F5F8FA'
                        }]]
                    },
                    layout: {
                        hLineWidth: () => 0,
                        vLineWidth: function (i) { return i === 0 ? 3 : 0; },
                        vLineColor: () => C.primary,
                        paddingLeft: () => 0, paddingRight: () => 0
                    },
                    margin: [0, 0, 0, 8]
                });
            }
        } else {
            // IQ (legacy): criterios consolidados + evidencia esperada
            if (tc.criterios && tc.criterios.length > 0) {
                out.push({
                    text: 'Criterios de verificación:',
                    bold: true, color: C.primary, fontSize: 9, margin: [0, 4, 0, 4]
                });
                out.push({
                    ul: tc.criterios.map(cr => ({ text: cr, fontSize: 9, color: C.text })),
                    margin: [8, 0, 0, 8]
                });
            }

            if (tc.evidenciaEsperada) {
                out.push({
                    table: {
                        widths: ['*'],
                        body: [[{
                            text: [
                                { text: 'Evidencia esperada: ', bold: true, color: C.primary, fontSize: 9 },
                                { text: tc.evidenciaEsperada, fontSize: 9, color: C.text }
                            ],
                            margin: [10, 6, 10, 6],
                            fillColor: C.bgSoft
                        }]]
                    },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                    margin: [0, 0, 0, 8]
                });
            }
        }

        // ===== Sección de RESULTADO — solo en informes =====
        if (informe) {
            out.push({
                text: 'Resultado de Ejecución:',
                bold: true, color: C.primary, fontSize: 10,
                margin: [0, 6, 0, 6]
            });
            // === MODO INFORME ===
            const est = estadoTcColor(tc.estado);
            const fechaTxt = tc.fechaEjecucion || '—';
            const ejecTxt = tc.ejecutor || '—';
            const firmaTxt = tc.firma || '—';

            // Caja con estado + (resultadoObservado para IQ legacy / criterioObservado ya se mostró arriba para OQ)
            const stack = [
                {
                    text: [
                        { text: 'Estado: ', bold: true, fontSize: 11, color: C.text },
                        { text: est.label, bold: true, fontSize: 13, color: est.color }
                    ],
                    margin: [0, 0, 0, 6]
                }
            ];
            if (schemaModo !== 'procedimiento' && tc.resultadoObservado) {
                stack.push({
                    text: [
                        { text: 'Resultado observado: ', bold: true, color: C.primary, fontSize: 9 },
                        { text: tc.resultadoObservado, fontSize: 9, color: C.text, italics: true }
                    ]
                });
            }

            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: stack,
                        fillColor: est.bg,
                        margin: [12, 8, 12, 8]
                    }]]
                },
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: function (i) { return i === 0 ? 4 : 0; },
                    vLineColor: () => est.color,
                    paddingLeft: () => 0, paddingRight: () => 0
                },
                margin: [0, 0, 0, 8]
            });

            // Línea ejecutor / fecha / firma
            out.push({
                table: {
                    widths: ['*', '*', '*'],
                    body: [[
                        tb.vsTd(`Ejecutor: ${ejecTxt}`, { fontSize: 9 }),
                        tb.vsTd(`Fecha: ${fechaTxt}`, { fontSize: 9, alignment: 'center' }),
                        tb.vsTd(`Firma: ${firmaTxt}`, { fontSize: 9, alignment: 'right', italics: true })
                    ]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                margin: [0, 0, 0, 6]
            });

            // Evidencias del gestor
            if (tc.evidenciasGestor && tc.evidenciasGestor.length > 0) {
                out.push({
                    text: 'Evidencias capturadas (Gestor):',
                    bold: true, color: C.primary, fontSize: 9, margin: [0, 6, 0, 4]
                });
                out.push({
                    ul: tc.evidenciasGestor.map(ev => {
                        const desc = ev.descripcion || ev.description || '';
                        const meta = [];
                        if (ev.criterioRef) meta.push(`Ref: ${ev.criterioRef}`);
                        if (ev.usuarioPrueba) meta.push(`Usuario: ${ev.usuarioPrueba}`);
                        if (ev.rolPrueba) meta.push(`(${ev.rolPrueba})`);
                        if (ev.timestamp) meta.push(ev.timestamp);
                        return {
                            text: [
                                { text: desc, fontSize: 9 },
                                meta.length > 0 ? { text: '  ' + meta.join(' · '), fontSize: 8, italics: true, color: C.textSoft } : ''
                            ]
                        };
                    }),
                    margin: [8, 0, 0, 6]
                });
            }

            // Hallazgos
            if (tc.hallazgos && tc.hallazgos.length > 0) {
                out.push({
                    text: 'Hallazgos / Desvíos:',
                    bold: true, color: '#A52A2A', fontSize: 9, margin: [0, 6, 0, 4]
                });
                tc.hallazgos.forEach(h => {
                    const id = h.id || 'NC-XXX';
                    const sev = h.severidad || '';
                    const desc = h.descripcion || '';
                    const accion = h.accion || '';
                    out.push({
                        table: {
                            widths: ['*'],
                            body: [[{
                                stack: [
                                    {
                                        text: [
                                            { text: `${id}  `, bold: true, color: '#A52A2A', fontSize: 9 },
                                            sev ? { text: `(${sev})  `, italics: true, fontSize: 8, color: C.textSoft } : '',
                                            { text: desc, fontSize: 9, color: C.text }
                                        ]
                                    },
                                    accion ? {
                                        text: [
                                            { text: 'CAPA: ', bold: true, fontSize: 8, color: C.textSoft },
                                            { text: accion, fontSize: 8, italics: true, color: C.text }
                                        ],
                                        margin: [0, 3, 0, 0]
                                    } : null
                                ].filter(Boolean),
                                fillColor: '#FDECEA',
                                margin: [10, 5, 10, 5]
                            }]]
                        },
                        layout: {
                            hLineWidth: () => 0,
                            vLineWidth: function (i) { return i === 0 ? 3 : 0; },
                            vLineColor: () => '#A52A2A',
                            paddingLeft: () => 0, paddingRight: () => 0
                        },
                        margin: [8, 0, 0, 4]
                    });
                });
            }
        }

        // Notas (común)
        if (tc.notas) {
            out.push({
                text: [
                    { text: 'Notas: ', bold: true, fontSize: 8, color: C.textSoft, italics: true },
                    { text: tc.notas, fontSize: 8, italics: true, color: C.textSoft }
                ],
                margin: [0, 4, 0, 12]
            });
        } else {
            out.push({ text: '', margin: [0, 0, 0, 12] });
        }

        return out;
    }

    // ====================================================================
    // 5. SECCIÓN "tabla-test-case" — declarable desde JSON
    //
    // Lee `sec.schemaModo` ('criterios' | 'procedimiento') y lo pasa a
    // cada bloque. Si no se declara, default 'criterios' (backwards compat).
    // ====================================================================
    function renderSeccionTabla(sec, tb, mode) {
        const C = tb.VS_COLORS;
        const out = [];
        const tcs = sec.tcs || [];
        const schemaModo = sec.schemaModo || 'criterios';

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 10]
            });
        }

        if (sec.agruparPorGrupo) {
            const grupos = {};
            const ordenGrupos = [];
            tcs.forEach(tc => {
                const g = tc.grupo || 'Sin grupo';
                if (!grupos[g]) { grupos[g] = []; ordenGrupos.push(g); }
                grupos[g].push(tc);
            });
            ordenGrupos.forEach((g) => {
                out.push({
                    text: `Grupo: ${g}`,
                    fontSize: 12, bold: true, color: '#FFFFFF',
                    fillColor: C.secondary,
                    margin: [10, 8, 10, 8]
                });
                grupos[g].forEach(tc => {
                    out.push(...renderBloqueTestCase(tc, tb, mode, schemaModo));
                });
            });
        } else {
            tcs.forEach(tc => {
                out.push(...renderBloqueTestCase(tc, tb, mode, schemaModo));
            });
        }

        return out;
    }

    // ====================================================================
    // 6. SECCIÓN "matriz-tc" — declarable desde JSON
    //
    // Lee `sec.columnasVisibles` (array opcional) y se lo pasa a la matriz.
    // Si no se declara, usa columnas IQ default.
    // ====================================================================
    function renderSeccionMatriz(sec, tb, mode) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        const tcs = sec.tcs || [];
        out.push(...renderMatrizUnificadaTC(tcs, tb, mode, {
            columnasVisibles: sec.columnasVisibles
        }));

        return out;
    }

    // ====================================================================
    // EXPORTAR API
    // ====================================================================
    VS.iqShared.renderMatrizUnificadaTC = renderMatrizUnificadaTC;
    VS.iqShared.renderProcedimientoTable = renderProcedimientoTable;
    VS.iqShared.renderTcMetadataTable = renderTcMetadataTable;
    VS.iqShared.renderBloqueTestCase = renderBloqueTestCase;
    VS.iqShared.renderSeccionTabla = renderSeccionTabla;
    VS.iqShared.renderSeccionMatriz = renderSeccionMatriz;
    VS.iqShared.nivelIraScore = nivelIraScore;
    VS.iqShared.getNivelInfo = getNivelInfo;
    VS.iqShared.tipoTCInfo = tipoTCInfo;
    VS.iqShared.estadoTcColor = estadoTcColor;
    VS.iqShared.isModeInforme = isModeInforme;
    VS.iqShared.buildColumnRegistry = buildColumnRegistry;

    // Alias forward-compat: cuando renombremos el archivo, el import será
    // VS.qualificationShared. Hoy ambos apuntan al mismo objeto.
    VS.qualificationShared = VS.iqShared;

})(window);
