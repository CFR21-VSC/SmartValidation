/* ====================================================================
   VALIDATION SUITE — RENDERER AEX
   Anexo de Ejecución — Registro Integrado de Evidencias.

   El AEX es el artefacto formal de la captura de evidencias durante
   la ejecución de un protocolo (PIQ/POQ). Reemplaza el "PDF de
   evidencias" del gestor con un documento de la suite que adopta el
   mismo lenguaje visual: cover + control de cambios + matriz aprobaciones
   + trazabilidad v2.0 auto-inyectada + secciones numeradas + firmas.

   Tipos de sección NUEVOS expuestos:
   - aex-registro-tc       : detalle por TC con trazabilidad + procedimiento
                              ejecutado + resultado + screenshots de evidencia
   - aex-matriz-trazabilidad : matriz URS → TC → evidencias capturadas

   Tipos compartidos reusados:
   - texto, tabla, tabla-info, caja-conclusion, tabla-firmas-final
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[aex.js] ValidationSuite no esta cargado');
        return;
    }

    /**
     * Decodificar SVG base64 a raw SVG string (para usar en pdfMake `svg:`).
     */
    function decodeSvg(imgData) {
        if (!imgData || typeof imgData !== 'string') return null;
        if (imgData.startsWith('data:image/svg+xml;base64,')) {
            try {
                const b64 = imgData.replace(/^data:image\/svg\+xml;base64,/, '');
                return (typeof atob === 'function')
                    ? atob(b64)
                    : (typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : null);
            } catch (e) { return null; }
        }
        if (imgData.startsWith('data:image/svg+xml')) {
            const idx = imgData.indexOf(',');
            const raw = imgData.substring(idx + 1);
            try { return decodeURIComponent(raw); } catch (e) { return raw; }
        }
        if (imgData.trim().startsWith('<svg')) return imgData;
        return null;
    }

    /**
     * Detectar orientación (portrait/landscape) de una imagen.
     * - SVG: parsea viewBox o width/height
     * - PNG/JPG: usa ev.dimensions si está disponible
     * - Default: landscape (la mayoría de screenshots son apaisadas)
     */
    function detectOrientation(ev) {
        // Si la evidencia trae dimensions, usar eso
        if (ev && ev.dimensions && typeof ev.dimensions.width === 'number' && typeof ev.dimensions.height === 'number') {
            return ev.dimensions.width >= ev.dimensions.height ? 'landscape' : 'portrait';
        }
        // SVG: parsear viewBox
        const svg = decodeSvg(ev && ev.image);
        if (svg) {
            const m = svg.match(/viewBox\s*=\s*["'][\d.\s\-]*?\s+([\d.]+)\s+([\d.]+)\s*["']/);
            if (m) {
                const w = parseFloat(m[1]), h = parseFloat(m[2]);
                if (w && h) return w >= h ? 'landscape' : 'portrait';
            }
            const w = (svg.match(/\bwidth\s*=\s*["']([\d.]+)/) || [])[1];
            const h = (svg.match(/\bheight\s*=\s*["']([\d.]+)/) || [])[1];
            if (w && h) return parseFloat(w) >= parseFloat(h) ? 'landscape' : 'portrait';
        }
        // Default landscape
        return 'landscape';
    }

    /**
     * Bloque pdfMake para una imagen (PNG/JPG/SVG). Usa `image:` o `svg:` según
     * el tipo. fitSize es [maxWidth, maxHeight] en pt.
     */
    function renderImageOnly(imgData, fitSize, colors) {
        if (!imgData || typeof imgData !== 'string') {
            return { text: '[Imagen no disponible]', fontSize: 9, italics: true, color: colors.textSoft, alignment: 'center', margin: [0, 20, 0, 0] };
        }
        const svgRaw = decodeSvg(imgData);
        if (svgRaw) {
            return { svg: svgRaw, fit: fitSize, alignment: 'center', margin: [0, 0, 0, 0] };
        }
        if (imgData.startsWith('data:image/png')
            || imgData.startsWith('data:image/jpeg')
            || imgData.startsWith('data:image/jpg')
            || imgData.startsWith('data:image/gif')) {
            return { image: imgData, fit: fitSize, alignment: 'center', margin: [0, 0, 0, 0] };
        }
        return { image: imgData, fit: fitSize, alignment: 'center', margin: [0, 0, 0, 0] };
    }

    /**
     * Resuelve la descripción del paso del procedimiento desde criterioRef.
     * Si ev.criterioRef === "Paso 3" y el test tiene procedimiento[],
     * devuelve la instrucción del paso 3 (case-insensitive, busca por número).
     */
    function resolveProcedimientoPaso(ev, test) {
        if (!ev || !ev.criterioRef || !test) return null;
        const m = String(ev.criterioRef).match(/paso\s*(\d+)/i);
        if (!m) return null;
        const num = parseInt(m[1], 10);
        // El procedimiento puede estar en test.procedimiento o test.protocolGuidance.procedimiento
        const proc = (test.procedimiento && Array.isArray(test.procedimiento))
            ? test.procedimiento
            : (test.protocolGuidance && Array.isArray(test.protocolGuidance.procedimiento)
                ? test.protocolGuidance.procedimiento
                : null);
        if (!proc) return null;
        // Buscar por paso === num o por índice (num-1)
        const step = proc.find(p => p && (p.paso === num || p.paso === String(num))) || proc[num - 1];
        if (!step) return null;
        return {
            paso: step.paso != null ? step.paso : num,
            instruccion: step.instruccion || '',
            resultadoEsperado: step.resultadoEsperado || ''
        };
    }

    /**
     * Renderea UNA evidencia en UNA SOLA página portrait:
     *
     *   Header compacto (tcId + descripción) + traza mini-block + paso del
     *   procedimiento + dictamen + metadata grid + IMAGEN ocupando el resto
     *   de la página.
     *
     * Una evidencia = una página. El auditor ve la metadata arriba y la
     * captura visual abajo sin tener que pasar página.
     */
    function renderEvidencePage(ev, colors, test, evIdx, evTotal) {
        const tcId = test && test.tcId;
        const blocks = [];

        // Header compacto — pageBreak antes para que cada evidencia arranque
        // en página nueva. Sigue siempre portrait.
        blocks.push({
            text: [
                { text: 'Evidencia ' + (evIdx + 1) + (evTotal > 1 ? ' de ' + evTotal : '') + '  ', bold: true, fontSize: 11, color: colors.primary },
                { text: '· ' + (tcId || ''), italics: true, fontSize: 10, color: colors.textSoft },
                ev.descripcion ? { text: '\n' + ev.descripcion, fontSize: 10, color: colors.text } : ''
            ],
            pageBreak: 'before',
            pageOrientation: 'portrait',
            margin: [0, 0, 0, 6]
        });

        // === TRAZABILIDAD MINI-BLOCK (URS/RA/IRA del TC parent) ===
        if (test && test.trazabilidad) {
            const tz = test.trazabilidad;
            const tzCells = [];
            if (Array.isArray(tz.urs) && tz.urs.length > 0) {
                tzCells.push({
                    stack: [
                        { text: 'URS', fontSize: 7, bold: true, color: colors.primary },
                        { text: tz.urs.join(', '), fontSize: 7.5, color: colors.text }
                    ],
                    margin: [4, 2, 4, 2], fillColor: '#EAF1F8'
                });
            }
            if (tz.ra) {
                tzCells.push({
                    stack: [
                        { text: 'RA', fontSize: 7, bold: true, color: '#B85F0F' },
                        { text: tz.ra, fontSize: 7.5, color: colors.text }
                    ],
                    margin: [4, 2, 4, 2], fillColor: '#FFF8E1'
                });
            }
            if (tz.ira) {
                tzCells.push({
                    stack: [
                        { text: 'IRA', fontSize: 7, bold: true, color: '#B85F0F' },
                        { text: tz.ira + (tz.componente ? ' — ' + tz.componente : ''), fontSize: 7.5, color: colors.text }
                    ],
                    margin: [4, 2, 4, 2], fillColor: '#FFF8E1'
                });
            }
            if (test.grupo) {
                tzCells.push({
                    stack: [
                        { text: 'Grupo', fontSize: 7, bold: true, color: colors.textSoft },
                        { text: test.grupo, fontSize: 7.5, color: colors.text }
                    ],
                    margin: [4, 2, 4, 2], fillColor: '#F5F8FA'
                });
            }
            if (tzCells.length > 0) {
                const widths = tzCells.map(() => '*');
                blocks.push({
                    table: { widths: widths, body: [tzCells] },
                    layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => colors.border, vLineColor: () => colors.border },
                    margin: [0, 0, 0, 3]
                });
            }
        }

        // === PASO + DICTAMEN en dos columnas compactas (mismo bloque) ===
        const paso = resolveProcedimientoPaso(ev, test);
        const dictamen = ev.dictamen || ev.resultado;
        const dictEst = dictamen ? (function () {
            const e = String(dictamen).toUpperCase().trim();
            if (e === 'PASS' || e === 'PASA') return { color: '#1E7E34', bg: '#E8F5E9' };
            if (e === 'FAIL' || e === 'NO PASA') return { color: '#A52A2A', bg: '#FDECEA' };
            if (e === 'OBS' || e === 'PASA CON OBSERVACIONES') return { color: '#B85F0F', bg: '#FFF4E5' };
            if (e === 'NA' || e === 'N/A' || e === 'NO APLICA') return { color: '#717D8A', bg: '#F4F6F8' };
            return { color: colors.text, bg: '#F5F8FA' };
        })() : null;

        if (paso) {
            blocks.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            {
                                text: [
                                    { text: 'Paso ' + paso.paso + ': ', bold: true, color: colors.primary, fontSize: 8 },
                                    { text: paso.instruccion, fontSize: 8, color: colors.text }
                                ]
                            },
                            paso.resultadoEsperado ? {
                                text: [
                                    { text: 'Esperado: ', bold: true, color: colors.textSoft, fontSize: 7.5 },
                                    { text: paso.resultadoEsperado, fontSize: 7.5, italics: true, color: colors.text }
                                ],
                                margin: [0, 1, 0, 0]
                            } : null
                        ].filter(Boolean),
                        margin: [6, 3, 6, 3], fillColor: '#EAF1F8'
                    }]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 2.5 : 0, vLineColor: () => colors.primary, paddingLeft: () => 0, paddingRight: () => 0 },
                margin: [0, 0, 0, 3]
            });
        }

        if (dictamen) {
            blocks.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: [
                            { text: 'Dictamen: ', bold: true, color: colors.text, fontSize: 8.5 },
                            { text: String(dictamen).toUpperCase(), bold: true, fontSize: 8.5, color: dictEst.color },
                            ev.observacion ? { text: '  ·  ' + ev.observacion, fontSize: 7.5, italics: true, color: colors.text } : ''
                        ],
                        margin: [6, 3, 6, 3], fillColor: dictEst.bg
                    }]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 2.5 : 0, vLineColor: () => dictEst.color, paddingLeft: () => 0, paddingRight: () => 0 },
                margin: [0, 0, 0, 3]
            });
        }

        // === METADATA GRID — raw data completa, compacta en 2 cols ===
        const metaRows = [];
        const pushMeta = (label, value) => {
            if (value === null || value === undefined || value === '' || value === '—') return;
            metaRows.push([label, String(value)]);
        };
        pushMeta('Usuario', ev.usuarioPrueba);
        pushMeta('Rol', ev.rolPrueba);
        pushMeta('Operación', ev.operacion);
        pushMeta('Referencia', ev.criterioRef);
        pushMeta('TC asociado', ev.testCaseRef || tcId);
        pushMeta('Ejecutor', ev.executor);
        pushMeta('Fecha captura', ev.captureTimestamp || ev.timestamp);
        pushMeta('Archivo origen', ev.originalFileName || ev.fileName);
        pushMeta('Dimensiones', ev.dimensions
            ? (ev.dimensions.width + ' × ' + ev.dimensions.height + ' px')
            : null);
        pushMeta('Hash/SHA', ev.hash || ev.sha256);

        if (metaRows.length > 0) {
            const tableRows = [];
            for (let i = 0; i < metaRows.length; i += 2) {
                const a = metaRows[i];
                const b = metaRows[i + 1];
                tableRows.push([
                    { text: a[0] + ':', fontSize: 7.5, bold: true, color: colors.textSoft, margin: [4, 2, 4, 2] },
                    { text: a[1], fontSize: 7.5, color: colors.text, margin: [4, 2, 4, 2] },
                    b ? { text: b[0] + ':', fontSize: 7.5, bold: true, color: colors.textSoft, margin: [4, 2, 4, 2] } : { text: '', margin: [0, 0, 0, 0] },
                    b ? { text: b[1], fontSize: 7.5, color: colors.text, margin: [4, 2, 4, 2] } : { text: '', margin: [0, 0, 0, 0] }
                ]);
            }
            blocks.push({
                table: { widths: VS.templateBase.vsScaleWidths([80, 140, 80, 140]), body: tableRows },
                layout: { hLineWidth: () => 0.3, vLineWidth: () => 0, hLineColor: () => colors.border },
                margin: [0, 0, 0, 6]
            });
        }

        // === IMAGEN — ocupando el espacio restante de la página portrait ===
        // A4 portrait útil ≈ 455 × 692pt. Metadata + traza + paso + dictamen ≈ 200pt.
        // Quedan ~470-490pt para la imagen. Le damos [455, 460] para que siempre
        // entre con margen de seguridad sin desbordar a la siguiente página.
        blocks.push(renderImageOnly(ev.image, [455, 460], colors));

        return blocks;
    }

    function estadoStyle(estado) {
        const e = String(estado || '').toUpperCase().trim();
        if (e === 'PASS' || e === 'PASA') return { color: '#1E7E34', bg: '#E8F5E9', label: 'PASS' };
        if (e === 'FAIL' || e === 'NO PASA') return { color: '#A52A2A', bg: '#FDECEA', label: 'FAIL' };
        if (e === 'OBS' || e === 'PASS_OBS') return { color: '#B85F0F', bg: '#FFF4E5', label: 'OBS' };
        if (e === 'NA' || e === 'N/A' || e === 'NO APLICA') return { color: '#717D8A', bg: '#F4F6F8', label: 'N/A' };
        return { color: '#717D8A', bg: '#F4F6F8', label: estado || '—' };
    }

    // ====================================================================
    // SECCIÓN: aex-registro-tc — bloques detallados por TC con evidencia
    //
    // Agrupación: si los TCs traen `grupo`, se agrupan por grupo funcional
    // con un banner azul claro por grupo (preserva orden de aparición).
    // Si `agruparPorGrupo` es false explícito, render lineal sin agrupación.
    // Esto escala a cientos de TCs (ej: POQ con 200 TCs en 8 grupos).
    // ====================================================================
    function renderRegistroTc(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        const tests = sec.tests || [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 12]
            });
        }

        // === MINI-RESUMEN INICIAL — útil para docs con muchos TCs ===
        // Tabla compacta con: TC-ID | Grupo | Resultado | # Evidencias.
        // El auditor ve el panorama global antes de entrar al detalle.
        if (tests.length > 5) {
            out.push({
                text: 'Resumen de TCs documentados (' + tests.length + ')',
                fontSize: 11, bold: true, color: C.primary,
                margin: [0, 0, 0, 6]
            });
            const sumBody = [[
                tb.vsTh('TC-ID', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Título', { fontSize: 8 }),
                tb.vsTh('Grupo', { fontSize: 8 }),
                tb.vsTh('Resultado', { alignment: 'center', fontSize: 8 }),
                tb.vsTh('Evid.', { alignment: 'center', fontSize: 8 })
            ]];
            tests.forEach((t, i) => {
                const bg = (i % 2 === 1) ? C.bgSoft : null;
                const est = estadoStyle(t.resultado && t.resultado.estado);
                const evCount = (t.evidencias || []).length;
                sumBody.push([
                    tb.vsTd(t.tcId || '—', { bold: true, color: C.primary, alignment: 'center', fontSize: 7.5, fillColor: bg }),
                    tb.vsTd(t.titulo || '', { fontSize: 7.5, fillColor: bg }),
                    tb.vsTd(t.grupo || '—', { fontSize: 7.5, italics: true, fillColor: bg }),
                    tb.vsTd(est.label, { alignment: 'center', bold: true, color: est.color, fontSize: 7.5, fillColor: bg }),
                    tb.vsTd(String(evCount), { alignment: 'center', bold: evCount > 0, color: evCount > 0 ? C.primary : C.textSoft, fontSize: 7.5, fillColor: bg })
                ]);
            });
            out.push({
                table: { widths: [55, '*', 100, 55, 30], body: sumBody, headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1 },
                layout: tb.vsTableLayout(),
                margin: [0, 0, 0, 14]
            });
        }

        // === AGRUPAR POR `grupo` (preserva orden de aparición) ===
        // Default: agrupar si los TCs tienen `grupo`. Override con sec.agruparPorGrupo = false.
        const debeAgrupar = sec.agruparPorGrupo !== false && tests.some(t => t.grupo);

        let testGroups; // [{ grupo, tests: [...] }]
        if (debeAgrupar) {
            const map = {};
            const orden = [];
            tests.forEach(t => {
                const g = t.grupo || 'Sin grupo';
                if (!map[g]) { map[g] = []; orden.push(g); }
                map[g].push(t);
            });
            testGroups = orden.map(g => ({ grupo: g, tests: map[g] }));
        } else {
            testGroups = [{ grupo: null, tests: tests }];
        }

        // Renderizar grupo a grupo
        testGroups.forEach((tg, gIdx) => {
            // Banner del grupo (solo si hay agrupación)
            if (tg.grupo) {
                out.push({
                    text: 'Grupo: ' + tg.grupo + '  ·  ' + tg.tests.length + ' TC' + (tg.tests.length > 1 ? 's' : ''),
                    fontSize: 11, bold: true, color: '#FFFFFF',
                    fillColor: C.secondary,
                    margin: [10, 8, 10, 8],
                    pageBreak: gIdx === 0 ? undefined : 'before' // nuevo grupo en página nueva
                });
            }
            tg.tests.forEach((test, idxInGroup) => {
                renderTcInline(test, out, C, tb, idxInGroup === 0);
            });
        });

        return out;
    }

    /**
     * Render de UN TC dentro del registro AEX (banner + trazabilidad inline +
     * procedimiento + resultado + evidencias en páginas separadas).
     * Llamada desde renderRegistroTc para cada test.
     *
     * isFirstInGroup: si es el primero del grupo, no metemos margen extra arriba
     * (el banner del grupo ya separa).
     */
    function renderTcInline(test, out, C, tb, isFirstInGroup) {
        const est = estadoStyle(test.resultado && test.resultado.estado);
        const tipoTC = test.tipoTC ? '  [' + test.tipoTC + ']' : '';

        // Header del TC — banner azul con tcId + título + estado
        out.push({
            unbreakable: true,
            stack: [{
                table: {
                    widths: ['*', 60],
                    body: [[
                        {
                            text: [
                                { text: (test.tcId || 'TC-XXX') + '  ', bold: true, fontSize: 12, color: '#FFFFFF' },
                                { text: test.titulo || '', bold: true, fontSize: 11, color: '#FFFFFF' },
                                { text: tipoTC, italics: true, fontSize: 9, color: '#FFFFFF' }
                            ],
                            fillColor: C.primary, margin: [10, 8, 10, 8]
                        },
                        {
                            text: est.label,
                            bold: true, fontSize: 12, color: '#FFFFFF',
                            fillColor: est.color, alignment: 'center', margin: [4, 8, 4, 8]
                        }
                    ]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
            }],
            margin: [0, isFirstInGroup ? 0 : 8, 0, 0]
        });

        // Trazabilidad cruzada (mini-bloque)
        if (test.trazabilidad) {
            const tz = test.trazabilidad;
            const tzCells = [];
            if (Array.isArray(tz.urs) && tz.urs.length > 0) {
                tzCells.push({
                    stack: [
                        { text: 'URS', fontSize: 8, bold: true, color: C.primary },
                        { text: tz.urs.join(', '), fontSize: 9, color: C.text }
                    ],
                    margin: [6, 5, 6, 5], fillColor: '#EAF1F8'
                });
            }
            if (tz.ra) {
                tzCells.push({
                    stack: [
                        { text: 'RA', fontSize: 8, bold: true, color: '#B85F0F' },
                        { text: tz.ra, fontSize: 9, color: C.text }
                    ],
                    margin: [6, 5, 6, 5], fillColor: '#FFF8E1'
                });
            }
            if (tz.ira) {
                tzCells.push({
                    stack: [
                        { text: 'IRA', fontSize: 8, bold: true, color: '#B85F0F' },
                        { text: tz.ira + (tz.componente ? ' — ' + tz.componente : ''), fontSize: 9, color: C.text }
                    ],
                    margin: [6, 5, 6, 5], fillColor: '#FFF8E1'
                });
            }
            if (test.grupo) {
                tzCells.push({
                    stack: [
                        { text: 'Grupo', fontSize: 8, bold: true, color: C.textSoft },
                        { text: test.grupo, fontSize: 9, color: C.text }
                    ],
                    margin: [6, 5, 6, 5], fillColor: '#F5F8FA'
                });
            }
            if (tzCells.length > 0) {
                const widths = tzCells.map(() => '*');
                out.push({
                    table: { widths: widths, body: [tzCells] },
                    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => C.border, vLineColor: () => C.border },
                    margin: [0, 0, 0, 6]
                });
            }
        }

        // Procedimiento ejecutado (resumen)
        if (test.procedimientoResumen) {
            out.push({
                text: [
                    { text: 'Procedimiento ejecutado: ', bold: true, color: C.primary, fontSize: 9 },
                    { text: test.procedimientoResumen, fontSize: 9, color: C.text }
                ],
                margin: [0, 2, 0, 4], lineHeight: 1.4
            });
        }

        // Criterio de aceptación
        if (test.criterioAceptacion) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        text: [
                            { text: 'Criterio de aceptación: ', bold: true, color: C.primary, fontSize: 9 },
                            { text: test.criterioAceptacion, fontSize: 9, color: C.text }
                        ],
                        margin: [8, 5, 8, 5], fillColor: '#FFF8E1'
                    }]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 3 : 0, vLineColor: () => '#C9A227', paddingLeft: () => 0, paddingRight: () => 0 },
                margin: [0, 0, 0, 6]
            });
        }

        // Resultado de ejecución (caja con color)
        if (test.resultado) {
            const r = test.resultado;
            const innerStack = [
                {
                    text: [
                        { text: 'Resultado: ', bold: true, color: C.text, fontSize: 11 },
                        { text: est.label, bold: true, color: est.color, fontSize: 12 }
                    ],
                    margin: [0, 0, 0, 4]
                }
            ];
            if (r.criterioObservado) {
                innerStack.push({
                    text: [
                        { text: 'Observado: ', bold: true, color: C.primary, fontSize: 9 },
                        { text: r.criterioObservado, fontSize: 9, italics: true, color: C.text }
                    ],
                    margin: [0, 0, 0, 4]
                });
            }
            innerStack.push({
                text: [
                    { text: 'Ejecutor: ', color: C.textSoft, fontSize: 9 },
                    { text: r.ejecutor || '—', bold: true, fontSize: 9, color: C.text },
                    { text: '  ·  Fecha: ', color: C.textSoft, fontSize: 9 },
                    { text: r.fecha || '—', bold: true, fontSize: 9, color: C.text },
                    { text: '  ·  Firma: ', color: C.textSoft, fontSize: 9 },
                    { text: r.firma || '—', italics: true, fontSize: 9, color: C.text }
                ]
            });

            out.push({
                table: { widths: ['*'], body: [[{ stack: innerStack, fillColor: est.bg, margin: [12, 8, 12, 8] }]] },
                layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 4 : 0, vLineColor: () => est.color, paddingLeft: () => 0, paddingRight: () => 0 },
                margin: [0, 0, 0, 8]
            });
        }

        // Evidencias — UNA por página portrait con metadata + imagen juntas.
        const evs = Array.isArray(test.evidencias) ? test.evidencias : [];
        if (evs.length > 0) {
            evs.forEach((ev, eIdx) => {
                out.push(...renderEvidencePage(ev, C, test, eIdx, evs.length));
            });
        }
    }

    // ====================================================================
    // SECCIÓN: aex-matriz-trazabilidad — matriz URS → TC → evidencias
    // ====================================================================
    function renderMatrizTrazabilidad(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({
                text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 8]
            });
        }

        const body = [[
            tb.vsTh('URS', { alignment: 'center' }),
            tb.vsTh('Descripción'),
            tb.vsTh('TC(s)', { alignment: 'center' }),
            tb.vsTh('Evidencias', { alignment: 'center' }),
            tb.vsTh('Estado', { alignment: 'center' })
        ]];

        (sec.filas || []).forEach((f, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const est = estadoStyle(f.estado);
            body.push([
                tb.vsTd(f.urs || '—', { bold: true, color: C.primary, alignment: 'center', fillColor: bg, fontSize: 9 }),
                tb.vsTd(f.titulo || '', { fontSize: 9, fillColor: bg }),
                tb.vsTd((f.tcs || []).join(', '), { fontSize: 9, alignment: 'center', italics: true, fillColor: bg }),
                tb.vsTd(String(f.evidencias != null ? f.evidencias : 0), { fontSize: 9, alignment: 'center', bold: true, fillColor: bg, color: f.evidencias > 0 ? C.primary : C.textSoft }),
                tb.vsTd(est.label, { fontSize: 9, alignment: 'center', bold: true, color: est.color, fillColor: est.bg || bg })
            ]);
        });

        out.push({
            table: { widths: tb.vsScaleWidths([55, 200, 80, 50, 50]), body: body, headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        return out;
    }

    function renderTablaFirmasFinal(sec, tb, num) {
        if (VS.shared && typeof VS.shared.renderTablaFirmasFinalSmart === "function") {
            return VS.shared.renderTablaFirmasFinalSmart(sec, tb, { rolesDefault: [
            'Ejecutor (Validador)', 'Revisor (Process Owner)', 'Aprobador (Gerente QA)'
        ], numero: num, titulo: sec.titulo });
        }
        return [{ text: "[Helper de firmas no disponible]", color: "#FF0000" }];
    }

    function maybeWrapUnbreakable(sec, titleBlock, contentBlock) {
        const TABLE_TYPES = ['tabla-info'];
        const rowCount = (sec.filas || []).length;
        if (TABLE_TYPES.includes(sec.tipo) && rowCount > 0 && rowCount <= 8) {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        return [...titleBlock, ...contentBlock];
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('AEX', function renderAEX(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        // ─── NOTA SOBRE EVIDENCIA RAW ────────────────────────────────────
        // Las imágenes embebidas son representaciones optimizadas (fit a página
        // portrait). Los archivos originales (full-resolution + metadata EXIF +
        // hashes SHA-256) se exportan como ZIP separado — el "Tomo III" digital
        // del entregable, conservado para auditoría y visualización completa.
        const C0 = tb.VS_COLORS;
        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'EVIDENCIAS RAW · TOMO III DIGITAL', fontSize: 9, bold: true, color: '#B85F0F', characterSpacing: 1.5, margin: [0, 0, 0, 4] },
                        {
                            text: [
                                { text: 'Las imágenes embebidas en este anexo son representaciones optimizadas al formato libro (fit a página portrait). ', fontSize: 9, color: C0.text },
                                { text: 'Los archivos originales de evidencia ', fontSize: 9, color: C0.text },
                                { text: '(PNG/JPG/SVG en resolución completa, metadata EXIF, timestamps y hashes SHA-256)', fontSize: 9, bold: true, color: C0.text },
                                { text: ' se conservan en un paquete ZIP independiente que acompaña este libro como ', fontSize: 9, color: C0.text },
                                { text: 'Tomo III digital', fontSize: 9, bold: true, color: '#B85F0F' },
                                { text: '. Esa carpeta es la fuente autoritativa para inspección regulatoria y visualización full-resolution.', fontSize: 9, color: C0.text }
                            ],
                            alignment: 'justify', lineHeight: 1.35
                        }
                    ],
                    fillColor: '#FFF4E5', margin: [12, 8, 12, 8]
                }]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 3 : 0, vLineColor: () => '#B85F0F', paddingLeft: () => 0, paddingRight: () => 0 },
            margin: [0, 0, 0, 16]
        });

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
                case 'tabla': contentBlock = shared.renderTabla(sec, tb); break;
                case 'tabla-info': contentBlock = shared.renderTablaInfo(sec, tb); break;
                case 'caja-conclusion': contentBlock = shared.renderCajaConclusion(sec, tb); break;
                case 'caja-nota': contentBlock = shared.renderCajaNota(sec, tb); break;
                case 'aex-registro-tc': contentBlock = renderRegistroTc(sec, tb); break;
                case 'aex-matriz-trazabilidad': contentBlock = renderMatrizTrazabilidad(sec, tb); break;
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

    // Validador básico — chequea estructura mínima
    if (VS.validators) {
        VS.validators.AEX = function validateAEX(data) {
            const report = { valid: true, errors: [], warnings: [], info: [], summary: {} };
            if (!data.secciones || !Array.isArray(data.secciones)) {
                report.errors.push({ msg: 'AEX sin secciones[]' });
                report.valid = false;
            }
            const tests = (data.secciones || []).find(s => s.tipo === 'aex-registro-tc')?.tests || [];
            report.summary.tests = tests.length;
            report.summary.evidenciasTotal = tests.reduce((sum, t) => sum + (t.evidencias || []).length, 0);
            report.info.push({ msg: `${tests.length} test(s) documentado(s) con ${report.summary.evidenciasTotal} evidencia(s) total` });
            return report;
        };
    }

})(window);
