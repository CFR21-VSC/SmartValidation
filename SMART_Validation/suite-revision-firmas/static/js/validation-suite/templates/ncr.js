/* ====================================================================
   VALIDATION SUITE — RENDERER NCR
   Non-Conformance Report (Reporte de No Conformidades + CAPA).
   Documento unificado que registra hallazgos de ejecución, su análisis
   de causa raíz y el plan de acciones correctivas/preventivas.

   STAGE-GATING POR FIRMAS:
   Cada sección lleva su propio set de firmas requeridas. Una sección
   queda visualmente "BLOQUEADA" hasta que la anterior tenga todas
   sus firmas obligatorias completas. Esto refleja el workflow real
   de un QMS GxP.

   Estados de cada sección:
     - "pendiente"   → sin firmas, sin contenido validado
     - "en_revision" → contenido cargado, firmas parciales
     - "aprobada"    → todas las firmas obligatorias obtenidas
     - "rechazada"   → revisor rechazó, requiere corrección

   Tipos de sección específicos:
     - ncr-workflow-indicator   : visual de progreso 4-etapas
     - ncr-registro-hallazgos   : sección 1 (registro NCs)
     - ncr-analisis-causa       : sección 2 (análisis causa raíz)
     - ncr-plan-capa            : sección 3 (plan CAPA)
     - ncr-cierre-aprobacion    : sección 4 (cierre formal)
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[ncr.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // CONSTANTES — orden gating de secciones
    // ====================================================================
    const GATED_SECTION_TYPES = ['ncr-registro-hallazgos', 'ncr-analisis-causa', 'ncr-plan-capa', 'ncr-cierre-aprobacion'];

    // ====================================================================
    // HELPERS — estado de firmas y gating
    // ====================================================================

    /**
     * ¿La sección tiene TODAS sus firmas obligatorias?
     */
    function isSectionApproved(sec) {
        if (!sec) return false;
        if (sec.estado === 'aprobada') return true;
        const required = (sec.firmasRequeridas || []).filter(r => r.obligatoria !== false);
        if (required.length === 0) return !!(sec.estado === 'aprobada');
        const firmas = sec.firmas || [];
        return required.every(r => firmas.some(f => f.rol === r.rol && f.nombre && f.fecha));
    }

    /**
     * Estado computado de una sección.
     */
    function computeSectionState(sec) {
        if (!sec) return 'pendiente';
        if (sec.estado === 'rechazada') return 'rechazada';
        if (isSectionApproved(sec)) return 'aprobada';
        const firmas = sec.firmas || [];
        if (firmas.length > 0) return 'en_revision';
        return sec.estado || 'pendiente';
    }

    /**
     * Devuelve el índice de gating de la sección dentro del workflow (0..3),
     * o -1 si no es una sección gated.
     */
    function gateIndexOf(sec) {
        return GATED_SECTION_TYPES.indexOf(sec.tipo);
    }

    /**
     * ¿Está bloqueada esta sección porque alguna previa NO está aprobada?
     */
    function isSectionBlocked(sec, allSecciones) {
        const idx = gateIndexOf(sec);
        if (idx <= 0) return false; // sección 1 nunca está bloqueada
        // Verificar todas las secciones gated anteriores
        for (let i = 0; i < idx; i++) {
            const prevType = GATED_SECTION_TYPES[i];
            const prevSec = allSecciones.find(s => s.tipo === prevType);
            if (!prevSec || !isSectionApproved(prevSec)) return true;
        }
        return false;
    }

    /**
     * Color/label del estado.
     */
    function stateBadge(state) {
        switch (state) {
            case 'aprobada': return { label: 'APROBADA', color: '#FFFFFF', bg: '#1E7E34' };
            case 'en_revision': return { label: 'EN REVISIÓN', color: '#FFFFFF', bg: '#B85F0F' };
            case 'rechazada': return { label: 'RECHAZADA', color: '#FFFFFF', bg: '#A52A2A' };
            case 'pendiente':
            default: return { label: 'PENDIENTE', color: '#FFFFFF', bg: '#717D8A' };
        }
    }

    // ====================================================================
    // SECCIÓN VISUAL: INDICADOR DE WORKFLOW
    //
    // Renderea 4 cajas horizontales unidas por flechas, mostrando el
    // progreso de aprobación de las 4 etapas del NCR.
    // ====================================================================
    function renderWorkflowIndicator(sec, tb, allSecciones) {
        const C = tb.VS_COLORS;
        const out = [];

        const stages = GATED_SECTION_TYPES.map(t => {
            const s = allSecciones.find(x => x.tipo === t);
            return {
                tipo: t,
                state: computeSectionState(s),
                label: ({
                    'ncr-registro-hallazgos': '1. Registro',
                    'ncr-analisis-causa': '2. Causa Raíz',
                    'ncr-plan-capa': '3. Plan CAPA',
                    'ncr-cierre-aprobacion': '4. Cierre'
                })[t]
            };
        });

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.35, margin: [0, 0, 0, 8]
            });
        }

        // 4 cajas + 3 flechas, total ~7 elementos
        const row = [];
        stages.forEach((stage, i) => {
            const badge = stateBadge(stage.state);
            row.push({
                width: '*',
                stack: [
                    {
                        text: stage.label,
                        fontSize: 9, bold: true, alignment: 'center', color: C.primary,
                        margin: [0, 0, 0, 3]
                    },
                    {
                        text: badge.label,
                        fontSize: 8, bold: true, alignment: 'center',
                        color: badge.color, fillColor: badge.bg,
                        margin: [0, 0, 0, 0]
                    }
                ]
            });
            if (i < stages.length - 1) {
                row.push({
                    width: 20,
                    text: stage.state === 'aprobada' ? '→' : '⋯',
                    fontSize: 14, bold: true, alignment: 'center',
                    color: stage.state === 'aprobada' ? '#1E7E34' : C.textSoft,
                    margin: [0, 6, 0, 0]
                });
            }
        });

        out.push({
            columns: row,
            margin: [0, 0, 0, 14]
        });

        return out;
    }

    // ====================================================================
    // BLOQUE DE FIRMAS DE UNA SECCIÓN
    // Renderea al pie de cada sección gated: tabla de firmas requeridas
    // con el estado de cada una (obtenida / pendiente).
    // ====================================================================
    function renderFirmasSeccion(sec, tb) {
        const C = tb.VS_COLORS;
        const state = computeSectionState(sec);
        const badge = stateBadge(state);
        const requeridas = sec.firmasRequeridas || [];
        const firmas = sec.firmas || [];

        const out = [];

        // Banner con el estado
        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    columns: [
                        { width: 'auto', text: 'Estado de la sección:', fontSize: 9, bold: true, color: C.text, margin: [0, 1, 0, 0] },
                        { width: 'auto', text: ' ' + badge.label, fontSize: 9, bold: true, color: badge.color, fillColor: badge.bg, margin: [6, 1, 6, 1] }
                    ],
                    fillColor: '#F4F6F8',
                    margin: [10, 6, 10, 6]
                }]]
            },
            layout: {
                hLineWidth: () => 0,
                vLineWidth: (i) => i === 0 ? 3 : 0,
                vLineColor: () => badge.bg
            },
            margin: [0, 4, 0, 6]
        });

        // Tabla de firmas requeridas
        if (requeridas.length > 0) {
            const body = [[
                tb.vsTh('Rol requerido', { fontSize: 9 }),
                tb.vsTh('Obligatoria', { fontSize: 9, alignment: 'center' }),
                tb.vsTh('Nombre', { fontSize: 9 }),
                tb.vsTh('Firma', { fontSize: 9, alignment: 'center' }),
                tb.vsTh('Fecha', { fontSize: 9, alignment: 'center' })
            ]];
            requeridas.forEach((req, i) => {
                const bg = i % 2 === 1 ? C.bgSoft : null;
                const firma = firmas.find(f => f.rol === req.rol);
                const obtenida = !!(firma && firma.nombre && firma.fecha);
                body.push([
                    tb.vsTd(req.rol, { fillColor: bg, fontSize: 9, bold: true }),
                    tb.vsTd(req.obligatoria !== false ? 'Sí' : 'No', { fillColor: bg, fontSize: 9, alignment: 'center' }),
                    tb.vsTd(firma ? (firma.nombre || '—') : '—', { fillColor: bg, fontSize: 9, italics: !obtenida }),
                    obtenida
                        ? tb.vsTd(firma.iniciales || firma.firma || 'OK', { fillColor: bg, fontSize: 9, bold: true, alignment: 'center', color: '#1E7E34' })
                        : tb.vsTd('— pendiente —', { fillColor: bg, fontSize: 8, italics: true, alignment: 'center', color: C.textSoft }),
                    tb.vsTd(firma && firma.fecha ? tb.formatDateShort(firma.fecha) : '—', { fillColor: bg, fontSize: 9, alignment: 'center', italics: !obtenida })
                ]);
            });
            // Widths escalados: 5 cols × 12pt + 22pt margen = 82pt; útil 455-82 = 373pt.
            // Suma anterior 460 desbordaba; ahora 115+50+105+50+50 = 370.
            out.push({
                table: { widths: tb.vsScaleWidths([115, 50, 105, 50, 50]), body, headerRows: 1, dontBreakRows: true },
                layout: tb.vsTableLayout(),
                margin: [0, 0, 0, 10]
            });
        }

        return out;
    }

    // ====================================================================
    // SELLO DE TRANSICIÓN ENTRE ETAPAS
    //
    // Se inserta DESPUÉS de cada sección gated cuyo estado sea decidible
    // (aprobada / no aprobada). Funciona como "puerta de avance":
    //   - Aprobada  → caja verde, firmantes, "habilita ETAPA N+1".
    //   - Pendiente → caja gris, "Etapa no firmada — bloquea ETAPA N+1".
    //   - Rechazada → caja roja, "Etapa rechazada — workflow detenido".
    //
    // Genera un pseudo-hash del bloque firmado (concatenación de roles +
    // iniciales + fechas) que actúa como huella simbólica para auditoría.
    // ====================================================================
    function pseudoHash(seed) {
        let h = 0;
        for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
        const hex = (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
        return hex.substring(0, 8);
    }

    function renderTransitionSeal(sec, nextSec, tb) {
        if (!sec || !nextSec) return [];
        const C = tb.VS_COLORS;
        const state = computeSectionState(sec);
        const stageIdx = gateIndexOf(sec);
        const stageNum = stageIdx + 1;
        const nextStageNum = stageIdx + 2;

        const stageLabel = ({
            'ncr-registro-hallazgos': 'Registro de Hallazgos',
            'ncr-analisis-causa': 'Análisis de Causa Raíz',
            'ncr-plan-capa': 'Plan CAPA',
            'ncr-cierre-aprobacion': 'Cierre y Aprobación'
        })[sec.tipo] || sec.titulo || 'Etapa';

        const nextStageLabel = ({
            'ncr-registro-hallazgos': 'Registro de Hallazgos',
            'ncr-analisis-causa': 'Análisis de Causa Raíz',
            'ncr-plan-capa': 'Plan CAPA',
            'ncr-cierre-aprobacion': 'Cierre y Aprobación'
        })[nextSec.tipo] || nextSec.titulo || 'Etapa siguiente';

        let titulo, subtitulo, bg, borderColor, txtColor;
        let listaFirmantes = '';
        let hashRef = '';
        const firmas = sec.firmas || [];

        if (state === 'aprobada') {
            titulo = `ETAPA ${stageNum} — ${stageLabel.toUpperCase()} — CERRADA`;
            subtitulo = `Avance habilitado hacia ETAPA ${nextStageNum} — ${nextStageLabel}`;
            bg = '#E8F5E9'; borderColor = '#1E7E34'; txtColor = '#1E7E34';
            listaFirmantes = firmas.map(f =>
                `${f.rol}: ${f.nombre} (${f.iniciales || '—'}) · ${tb.formatDateShort(f.fecha) || f.fecha || '—'}`
            ).join('\n');
            const seedFirmas = firmas.map(f => (f.rol || '') + (f.iniciales || '') + (f.fecha || '')).join('|');
            hashRef = 'HASH-REF: ' + pseudoHash(seedFirmas);
        } else if (state === 'rechazada') {
            titulo = `ETAPA ${stageNum} — ${stageLabel.toUpperCase()} — RECHAZADA`;
            subtitulo = `Workflow detenido. Requiere corrección antes de retomar ETAPA ${stageNum}.`;
            bg = '#FDECEA'; borderColor = '#A52A2A'; txtColor = '#A52A2A';
            listaFirmantes = sec.motivoRechazo || '— Sin motivo registrado —';
        } else {
            const requiredCount = (sec.firmasRequeridas || []).filter(r => r.obligatoria !== false).length;
            const obtainedCount = firmas.filter(f => f.nombre && f.fecha).length;
            titulo = `ETAPA ${stageNum} — ${stageLabel.toUpperCase()} — ${state === 'en_revision' ? 'EN REVISIÓN' : 'PENDIENTE'}`;
            subtitulo = `Firmas obtenidas: ${obtainedCount}/${requiredCount}. ETAPA ${nextStageNum} permanece BLOQUEADA hasta completar firmas.`;
            bg = '#F4F6F8'; borderColor = '#717D8A'; txtColor = '#717D8A';
            listaFirmantes = '— Firmas pendientes — la etapa siguiente no se habilita hasta el cierre formal de ésta. —';
        }

        const stack = [
            { text: titulo, fontSize: 11, bold: true, color: txtColor, alignment: 'center', margin: [0, 0, 0, 4] },
            { text: subtitulo, fontSize: 9.5, italics: true, color: C.text, alignment: 'center', margin: [0, 0, 0, 6] }
        ];

        if (listaFirmantes) {
            stack.push({
                text: listaFirmantes,
                fontSize: 8.5, color: C.text, alignment: 'center', lineHeight: 1.35,
                margin: [0, 0, 0, hashRef ? 4 : 0]
            });
        }
        if (hashRef) {
            stack.push({
                text: hashRef,
                fontSize: 7.5, color: C.textSoft, alignment: 'center', italics: true
            });
        }

        return [{
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: stack,
                    fillColor: bg,
                    margin: [16, 10, 16, 10]
                }]]
            },
            layout: {
                hLineWidth: () => 1.5, vLineWidth: () => 1.5,
                hLineColor: () => borderColor, vLineColor: () => borderColor
            },
            margin: [40, 8, 40, 14]
        }];
    }

    // ====================================================================
    // SECCIÓN BLOQUEADA — banner rojo, sin contenido
    // ====================================================================
    function renderBlockedSection(sec, tb, blockerLabel) {
        const C = tb.VS_COLORS;
        return [{
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: '— SECCION BLOQUEADA —', fontSize: 13, bold: true, color: '#A52A2A', alignment: 'center', margin: [0, 0, 0, 4] },
                        { text: blockerLabel, fontSize: 10, color: C.text, italics: true, alignment: 'center', margin: [0, 0, 0, 4] },
                        { text: 'El contenido permanecerá oculto hasta que las firmas previas sean obtenidas.', fontSize: 9, color: C.textSoft, alignment: 'center' }
                    ],
                    fillColor: '#FDECEA',
                    margin: [16, 14, 16, 14]
                }]]
            },
            layout: {
                hLineWidth: () => 1, vLineWidth: () => 1,
                hLineColor: () => '#A52A2A', vLineColor: () => '#A52A2A'
            },
            margin: [0, 0, 0, 14]
        }];
    }

    // ====================================================================
    // SECCIÓN 1 — REGISTRO DE HALLAZGOS
    // ====================================================================
    function renderRegistroHallazgos(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const hallazgos = sec.hallazgos || [];
        if (hallazgos.length === 0) {
            out.push({
                text: '— Sin hallazgos registrados. Si la ejecución generó NCs, cargarlas en esta sección antes de firmar. —',
                fontSize: 10, italics: true, color: C.textSoft, alignment: 'center',
                fillColor: '#F4F6F8', margin: [0, 12, 0, 12]
            });
            out.push(...renderFirmasSeccion(sec, tb));
            return out;
        }

        const body = [[
            tb.vsTh('NC-ID', { alignment: 'center' }),
            tb.vsTh('Tipo', { alignment: 'center' }),
            tb.vsTh('Criticidad', { alignment: 'center' }),
            tb.vsTh('TC Ref', { alignment: 'center' }),
            tb.vsTh('Doc Origen', { alignment: 'center' }),
            tb.vsTh('Descripción del Hallazgo'),
            tb.vsTh('F. Apertura', { alignment: 'center' })
        ]];

        hallazgos.forEach((h, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            const crit = String(h.criticidad || '').toUpperCase();
            const critColor = /CR[ÍI]TIC|MAYOR|ALTO/.test(crit) ? '#A52A2A'
                : /MENOR|OBSERV/.test(crit) ? '#B85F0F'
                : '#717D8A';
            body.push([
                tb.vsTd(h.id || '—', { bold: true, alignment: 'center', color: '#A52A2A', fillColor: bg, fontSize: 8 }),
                tb.vsTd(h.tipo || 'NC', { alignment: 'center', bold: true, fillColor: bg, fontSize: 8 }),
                tb.vsTd(h.criticidad || '—', { alignment: 'center', bold: true, color: critColor, fillColor: bg, fontSize: 7.5 }),
                tb.vsTd(h.tcRef || '—', { alignment: 'center', italics: true, fillColor: bg, fontSize: 7.5 }),
                tb.vsTd(h.docOrigen || '—', { alignment: 'center', italics: true, fillColor: bg, fontSize: 7.5 }),
                tb.vsTd(h.descripcion || '—', { fillColor: bg, fontSize: 8, lineHeight: 1.3 }),
                tb.vsTd(h.fechaApertura || '—', { alignment: 'center', fillColor: bg, fontSize: 7.5 })
            ]);
        });

        // Widths escalados: 7 cols × 12pt padding + 22pt margen = 106pt; útil 455-106 = 349pt.
        // Suma anterior 455 desbordaba; ahora 32+22+42+38+42+133+40 = 349.
        out.push({
            table: { widths: tb.vsScaleWidths([32, 22, 42, 38, 42, 133, 40]), body, headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 10]
        });

        out.push({
            text: `Total: ${hallazgos.length} hallazgo(s) registrado(s) en esta sección.`,
            fontSize: 9, italics: true, color: C.textSoft, margin: [0, 0, 0, 8]
        });

        out.push(...renderFirmasSeccion(sec, tb));
        return out;
    }

    // ====================================================================
    // SECCIÓN 2 — ANÁLISIS DE CAUSA RAÍZ
    // ====================================================================
    function renderAnalisisCausa(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const analisis = sec.analisis || [];
        if (analisis.length === 0) {
            out.push({
                text: '— Sin análisis cargado. —',
                fontSize: 10, italics: true, color: C.textSoft, alignment: 'center',
                fillColor: '#F4F6F8', margin: [0, 12, 0, 12]
            });
            out.push(...renderFirmasSeccion(sec, tb));
            return out;
        }

        analisis.forEach((a, idx) => {
            // Sub-título: NC ID + tipo de análisis
            out.push({
                text: `${a.ncId || ('Análisis #' + (idx + 1))}  ·  ${(a.tipoAnalisis || '5-porqués').toUpperCase()}`,
                fontSize: 11, bold: true, color: C.primary, margin: [0, idx === 0 ? 0 : 8, 0, 4]
            });

            // Lista 5-porqués
            if (Array.isArray(a.porques) && a.porques.length > 0) {
                out.push({
                    ol: a.porques.map((p, i) => ({
                        text: p,
                        fontSize: 9.5,
                        color: i === a.porques.length - 1 ? C.primary : C.text,
                        bold: i === a.porques.length - 1
                    })),
                    margin: [0, 0, 0, 6]
                });
            }

            // Causa raíz identificada
            if (a.causaRaizIdentificada) {
                out.push({
                    table: {
                        widths: ['*'],
                        body: [[{
                            stack: [
                                { text: 'Causa raíz identificada:', fontSize: 9, bold: true, color: C.primary, margin: [0, 0, 0, 2] },
                                { text: a.causaRaizIdentificada, fontSize: 10, color: C.text, lineHeight: 1.3 }
                            ],
                            fillColor: '#FFF8DC',
                            margin: [10, 6, 10, 6]
                        }]]
                    },
                    layout: {
                        hLineWidth: () => 0,
                        vLineWidth: (i) => i === 0 ? 3 : 0,
                        vLineColor: () => '#B85F0F'
                    },
                    margin: [0, 0, 0, 6]
                });
            }

            // Atributos (factor sistémico / recurrente / impacto)
            const attrs = [];
            if (a.factorSistemico !== undefined) {
                attrs.push({
                    width: '*',
                    text: [
                        { text: 'Factor sistémico: ', fontSize: 9, bold: true, color: C.text },
                        { text: a.factorSistemico ? 'SÍ' : 'No', fontSize: 9, bold: true, color: a.factorSistemico ? '#A52A2A' : '#1E7E34' }
                    ]
                });
            }
            if (a.recurrente !== undefined) {
                attrs.push({
                    width: '*',
                    text: [
                        { text: 'Recurrente: ', fontSize: 9, bold: true, color: C.text },
                        { text: a.recurrente ? 'SÍ' : 'No', fontSize: 9, bold: true, color: a.recurrente ? '#A52A2A' : '#1E7E34' },
                        a.recurrente && a.ncRecurrenteRef
                            ? { text: ` (ref: ${a.ncRecurrenteRef})`, fontSize: 8, italics: true, color: C.textSoft }
                            : { text: '' }
                    ]
                });
            }
            if (a.impactoScope) {
                attrs.push({
                    width: '*',
                    text: [
                        { text: 'Alcance: ', fontSize: 9, bold: true, color: C.text },
                        { text: a.impactoScope, fontSize: 9, italics: true, color: C.primary }
                    ]
                });
            }
            if (attrs.length > 0) {
                out.push({ columns: attrs, margin: [0, 0, 0, 10] });
            }
        });

        out.push(...renderFirmasSeccion(sec, tb));
        return out;
    }

    // ====================================================================
    // SECCIÓN 3 — PLAN CAPA
    // ====================================================================
    function renderPlanCapa(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const capas = sec.capas || [];
        if (capas.length === 0) {
            out.push({ text: '— Sin CAPAs registradas. —', fontSize: 10, italics: true, color: C.textSoft, alignment: 'center', fillColor: '#F4F6F8', margin: [0, 12, 0, 12] });
            out.push(...renderFirmasSeccion(sec, tb));
            return out;
        }

        capas.forEach((capa, idx) => {
            out.push({
                text: `CAPA para ${capa.ncId || ('NC #' + (idx + 1))}`,
                fontSize: 11, bold: true, color: C.primary, margin: [0, idx === 0 ? 0 : 8, 0, 4]
            });

            const estadoLabel = (capa.estadoCapa || 'EN CURSO').toUpperCase();
            const estadoColor = /VERIF|CERR/.test(estadoLabel) ? '#1E7E34'
                : /CURSO|APLIC/.test(estadoLabel) ? '#B85F0F'
                : /ABIERT|PEND/.test(estadoLabel) ? '#A52A2A'
                : '#717D8A';

            const body = [
                [
                    tb.vsTd('Acción Correctiva (CA)', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(capa.accionCorrectiva || '—', { fontSize: 9.5, lineHeight: 1.3 })
                ],
                [
                    tb.vsTd('Acción Preventiva (PA)', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(capa.accionPreventiva || '—', { fontSize: 9.5, lineHeight: 1.3 })
                ],
                [
                    tb.vsTd('Responsable', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(capa.responsable || '—', { fontSize: 9.5 })
                ],
                [
                    tb.vsTd('Fecha compromiso', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(capa.fechaCompromiso || '—', { fontSize: 9.5 })
                ],
                [
                    tb.vsTd('Fecha cierre real', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(capa.fechaCierre || '— pendiente —', { fontSize: 9.5, italics: !capa.fechaCierre })
                ],
                [
                    tb.vsTd('Evidencia de cierre', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(capa.evidenciaCierre || '— pendiente —', { fontSize: 9.5, lineHeight: 1.3, italics: !capa.evidenciaCierre })
                ],
                [
                    tb.vsTd('Verificado por', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(capa.verificadoPor || '— pendiente —', { fontSize: 9.5, italics: !capa.verificadoPor })
                ],
                [
                    tb.vsTd('Estado CAPA', { bold: true, color: C.primary, fontSize: 9, fillColor: C.bgSoft }),
                    tb.vsTd(estadoLabel, { bold: true, color: estadoColor, fontSize: 9.5, fillColor: '#FFFFFF' })
                ]
            ];

            out.push({
                table: { widths: [120, '*'], body, dontBreakRows: true, keepWithHeaderRows: 0 },
                layout: tb.vsTableLayout(),
                margin: [0, 0, 0, 10]
            });
        });

        out.push(...renderFirmasSeccion(sec, tb));
        return out;
    }

    // ====================================================================
    // SECCIÓN 4 — CIERRE Y APROBACIÓN FINAL
    // ====================================================================
    function renderCierreAprobacion(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] });
        }

        const r = sec.resumen || {};

        // KPIs en grid 2×3
        const kpis = [
            { label: 'Total NCs', value: r.totalNcs != null ? r.totalNcs : '—', color: C.primary },
            { label: 'NCs cerradas', value: r.ncCerradas != null ? r.ncCerradas : '—', color: '#1E7E34' },
            { label: 'NCs abiertas', value: r.ncAbiertas != null ? r.ncAbiertas : '—', color: r.ncAbiertas > 0 ? '#A52A2A' : '#1E7E34' },
            { label: 'NCs críticas', value: r.ncCriticas != null ? r.ncCriticas : '—', color: '#A52A2A' },
            { label: 'Críticas cerradas', value: r.criticasCerradas != null ? r.criticasCerradas : '—', color: '#1E7E34' },
            { label: 'Días promedio cierre', value: r.diasPromedioCierre != null ? r.diasPromedioCierre : '—', color: C.text }
        ];

        const kpiCells = kpis.map(k => ({
            stack: [
                { text: k.label, fontSize: 8, color: C.textSoft, alignment: 'center', margin: [0, 4, 0, 2] },
                { text: String(k.value), fontSize: 18, bold: true, color: k.color, alignment: 'center', margin: [0, 0, 0, 4] }
            ],
            fillColor: '#F4F6F8'
        }));

        out.push({
            table: { widths: ['*', '*', '*', '*', '*', '*'], body: [kpiCells] },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 10]
        });

        // Factor sistémico flag
        if (r.factorSistemico !== undefined) {
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        columns: [
                            { width: 'auto', text: 'Factor sistémico identificado: ', fontSize: 10, bold: true, color: C.text, margin: [0, 1, 0, 0] },
                            { width: 'auto', text: r.factorSistemico ? 'SÍ' : 'No', fontSize: 10, bold: true, color: r.factorSistemico ? '#A52A2A' : '#1E7E34', margin: [4, 1, 0, 0] },
                            { width: '*', text: r.factorSistemico ? '  — la NC reveló una debilidad sistémica que se reforzó vía PA.' : '', fontSize: 9, italics: true, color: C.textSoft, margin: [4, 1, 0, 0] }
                        ],
                        fillColor: r.factorSistemico ? '#FFF4E5' : '#E8F5E9',
                        margin: [10, 6, 10, 6]
                    }]]
                },
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: (i) => i === 0 ? 3 : 0,
                    vLineColor: () => r.factorSistemico ? '#B85F0F' : '#1E7E34'
                },
                margin: [0, 0, 0, 10]
            });
        }

        // Decisión final destacada
        if (r.decisionFinal) {
            const aprobado = /CERR|APROB/.test(String(r.decisionFinal).toUpperCase());
            out.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            { text: 'DECISIÓN FINAL', fontSize: 11, bold: true, color: aprobado ? '#1E7E34' : '#A52A2A', alignment: 'center', margin: [0, 0, 0, 4] },
                            { text: r.decisionFinal, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.4 }
                        ],
                        fillColor: aprobado ? '#E8F5E9' : '#FDECEA',
                        margin: [14, 10, 14, 10]
                    }]]
                },
                layout: {
                    hLineWidth: () => 1, vLineWidth: () => 1,
                    hLineColor: () => aprobado ? '#1E7E34' : '#A52A2A',
                    vLineColor: () => aprobado ? '#1E7E34' : '#A52A2A'
                },
                margin: [0, 0, 0, 12]
            });
        }

        out.push(...renderFirmasSeccion(sec, tb));
        return out;
    }

    // ====================================================================
    // WRAPPER UNBREAKABLE
    // ====================================================================
    function maybeWrapUnbreakable(sec, titleBlock, contentBlock) {
        if (sec.tipo === 'tabla-info' || sec.tipo === 'ncr-workflow-indicator') {
            return [{ unbreakable: true, stack: [...titleBlock, ...contentBlock] }];
        }
        return [...titleBlock, ...contentBlock];
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('NCR', function renderNCR(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);

            let titleBlock = [];
            if (sec.titulo) {
                titleBlock = tb.sectionTitle(`${num}. ${sec.titulo}`, { marginTop: idx === 0 ? 0 : 10 });
            }

            // Si es sección gated y está bloqueada → render bloqueado (sin pasar al renderer custom)
            const blocked = isSectionBlocked(sec, secciones);
            let contentBlock = [];
            if (blocked) {
                const blockerIdx = gateIndexOf(sec) - 1;
                const blockerType = GATED_SECTION_TYPES[blockerIdx];
                const blockerSec = secciones.find(s => s.tipo === blockerType);
                const blockerLabel = `Sección ${blockerIdx + 1} (${blockerSec ? (blockerSec.titulo || blockerType) : blockerType}) debe ser aprobada primero.`;
                contentBlock = renderBlockedSection(sec, tb, blockerLabel);
            } else {
                switch (sec.tipo) {
                    case 'texto': contentBlock = shared.renderTexto(sec, tb); break;
                    case 'tabla': contentBlock = shared.renderTabla(sec, tb); break;
                    case 'tabla-info': contentBlock = shared.renderTablaInfo(sec, tb); break;
                    case 'subseccion': contentBlock = shared.renderSubseccion(sec, tb); break;
                    case 'caja-nota': contentBlock = shared.renderCajaNota(sec, tb); break;
                    case 'caja-conclusion': contentBlock = shared.renderCajaConclusion(sec, tb); break;
                    case 'ncr-workflow-indicator': contentBlock = renderWorkflowIndicator(sec, tb, secciones); break;
                    case 'ncr-registro-hallazgos': contentBlock = renderRegistroHallazgos(sec, tb); break;
                    case 'ncr-analisis-causa': contentBlock = renderAnalisisCausa(sec, tb); break;
                    case 'ncr-plan-capa': contentBlock = renderPlanCapa(sec, tb); break;
                    case 'ncr-cierre-aprobacion': contentBlock = renderCierreAprobacion(sec, tb); break;
                    case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                    default:
                        contentBlock = [{ text: `[Tipo de sección desconocido: ${sec.tipo}]`, color: '#FF0000', margin: [0, 0, 0, 12] }];
                }
            }
            out.push(...maybeWrapUnbreakable(sec, titleBlock, contentBlock));

            // ─── SELLO DE TRANSICIÓN ───
            // Si esta sección es gated y hay una siguiente sección gated,
            // insertar el sello que marca el cierre/avance del workflow.
            const curIdx = gateIndexOf(sec);
            if (curIdx >= 0 && curIdx < GATED_SECTION_TYPES.length - 1) {
                const nextType = GATED_SECTION_TYPES[curIdx + 1];
                const nextSec = secciones.find(s => s.tipo === nextType);
                if (nextSec) {
                    out.push(...renderTransitionSeal(sec, nextSec, tb));
                }
            }
        });

        return out;
    });

    // ====================================================================
    // FIRMAS FINALES — reusa el mismo patrón que IIQ/IOQ
    // ====================================================================
    function renderTablaFirmasFinal(sec, tb, num) {
        // Delega al helper compartido con ajuste smart (fontSize + height adaptativo)
        if (VS.shared && typeof VS.shared.renderTablaFirmasFinalSmart === 'function') {
            return VS.shared.renderTablaFirmasFinalSmart(sec, tb, { rolesDefault: ['Identificador NC', 'Process Owner', 'Responsable CAPA', 'Gerente QA'], numero: num, titulo: sec.titulo });
        }
        return [{ text: '[Helper de firmas no disponible]', color: '#FF0000' }];
    }

    // Exponer helpers para validator
    VS.ncrHelpers = {
        isSectionApproved,
        computeSectionState,
        isSectionBlocked,
        GATED_SECTION_TYPES
    };

})(window);
