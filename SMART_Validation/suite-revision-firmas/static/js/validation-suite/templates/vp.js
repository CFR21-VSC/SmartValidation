/* ====================================================================
   VALIDATION SUITE — RENDERER VP (Validation Plan / Plan de Validación)

   Tipos de seccion soportados:
   COMPARTIDOS (de shared-renderers.js):
   - texto                       : Parrafo simple
   - lista-incluido-excluido     : Bloque "Incluido / Excluido" con bullets
   - tabla                       : Tabla generica (soporta bullets en celdas)
   - tabla-info                  : Tabla key/value
   - subseccion                  : Sub-titulo numerado (8.1, 8.2)
   - caja-nota                   : Callout amarillo italic
   - caja-justificacion          : Caja con borde + titulo destacado
   - caja-criterio               : Banner verde con titulo (validacion)
   - caja-conclusion             : Caja con borde para parrafos finales

   ESPECIFICOS VP:
   - tabla-firmas-final          : Tabla de firmas al final (compartido HLRA)
   - tabla-decisiones-tc         : Cuadro de criterios de resultado de TC
                                   (PASA / NO PASA / PASA CON OBS / NO APLICA)
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[vp.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // RENDERER ESPECIFICO VP: tabla-decisiones-tc
    // Cuadro estandar de criterios de resultado para TCs
    // ====================================================================
    function renderTablaDecisionesTC(sec, tb) {
        const C = tb.VS_COLORS;

        // Si el JSON provee filas custom, usarlas. Si no, usar las default GxP
        const filas = sec.filas || [
            {
                resultado: 'PASA',
                color: 'pass',
                significado: 'El resultado real coincide exactamente con el criterio de aceptación definido.',
                impacto: 'Sin impacto en liberación.',
                accion: 'Continuar con la ejecución.'
            },
            {
                resultado: 'PASA CON OBSERVACIONES',
                color: 'passObs',
                significado: 'El sistema cumple el criterio de aceptación. Se documenta una observación de mejora sin impacto en los criterios.',
                impacto: 'Sin impacto en liberación. La observación queda documentada para resolución en versión productiva.',
                accion: 'Documentar observación (OBS) en informe de la fase.'
            },
            {
                resultado: 'NO PASA',
                color: 'fail',
                significado: 'El resultado real NO coincide con el criterio de aceptación.',
                impacto: 'BLOQUEANTE. No permite liberar el sistema hasta resolver.',
                accion: 'Abrir No Conformidad (NC), análisis de causa raíz, CAPA y re-testing.'
            },
            {
                resultado: 'NO APLICA',
                color: 'neutral',
                significado: 'El test case no aplica a la versión actual del sistema (ej: funcionalidad no contratada).',
                impacto: 'Sin impacto en liberación.',
                accion: 'Documentar justificación de inaplicabilidad en el informe.'
            }
        ];

        const colorMap = {
            'pass': C.accent,
            'passObs': '#E67E22',
            'fail': C.sevMenor,
            'neutral': C.neutral
        };

        // widths: 90 + 145 + 130 + 90 = 455
        const body = [
            [
                tb.vsTh('Resultado', { alignment: 'center' }),
                tb.vsTh('Significado'),
                tb.vsTh('Impacto en liberación'),
                tb.vsTh('Acción')
            ]
        ];

        filas.forEach((f, idx) => {
            const bg = idx % 2 === 1 ? C.bgSoft : null;
            const resColor = colorMap[f.color] || C.text;
            body.push([
                tb.vsTd(f.resultado || '—', { alignment: 'center', bold: true, color: resColor, fillColor: bg, fontSize: 9 }),
                tb.vsTd(f.significado || '—', { fillColor: bg, fontSize: 9 }),
                tb.vsTd(f.impacto || '—', { fillColor: bg, fontSize: 9, bold: f.color === 'fail' }),
                tb.vsTd(f.accion || '—', { fillColor: bg, fontSize: 9 })
            ]);
        });

        const out = [];
        if (sec.intro) {
            out.push({ text: sec.intro, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 10] });
        }
        out.push({
            table: { widths: tb.vsScaleWidths([90, 145, 130, 90]), body: body, dontBreakRows: true, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 14]
        });
        return out;
    }

    // ====================================================================
    // tabla-firmas-final (copiado de hlra.js - es compartido)
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

    // Tipos de seccion que son TABLAS (para detectar si conviene wrappear con unbreakable)
    const TABLE_TYPES = ['tabla', 'tabla-info', 'arbol-decision-gamp', 'tabla-decisiones-tc'];

    /**
     * Si la tabla es chica (<=8 filas), envuelve titulo+tabla en stack unbreakable.
     * Asi si no caben juntos en lo que queda de la pagina, saltan completos
     * (evita header solo en una pagina + header repetido + filas en la siguiente).
     */
    function maybeWrapUnbreakable(sec, titleBlock, tableBlocks) {
        if (!TABLE_TYPES.includes(sec.tipo)) {
            return [...titleBlock, ...tableBlocks];
        }
        const rowCount = (sec.filas || sec.preguntas || []).length;
        // Si tiene <=4 filas, wrappear como unidad indivisible
        // Tablas grandes (>4 filas) pueden superar la altura de pagina cuando tienen
        // contenido con bullets — unbreakable las descartaria silenciosamente.
        if (rowCount > 0 && rowCount <= 4) {
            return [{
                unbreakable: true,
                stack: [...titleBlock, ...tableBlocks]
            }];
        }
        return [...titleBlock, ...tableBlocks];
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('VP', function renderVP(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        const numberer = (VS.shared && VS.shared.createSectionNumberer) ? VS.shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            // Numeración delegada al helper compartido:
            //   sec.numero === <int>  → ese número (sincroniza counter interno)
            //   sec.numero === null   → título sin número (cajas-nota internas)
            //   tipo === 'subseccion' → no consume contador (su título trae "X.Y")
            //   sin título            → no consume contador
            //   default               → counter auto-incremental
            const num = numberer(sec);

            // Generar el bloque de titulo
            let titleBlock = [];
            if (sec.tipo !== 'subseccion') {
                const titulo = sec.titulo
                    ? (num != null ? `${num}. ${sec.titulo}` : sec.titulo)
                    : null;
                if (titulo) {
                    titleBlock = tb.sectionTitle(titulo, { marginTop: idx === 0 ? 0 : 10 });
                }
            }

            // Generar el bloque de contenido segun tipo
            let contentBlock = [];
            switch (sec.tipo) {
                case 'texto': contentBlock = shared.renderTexto(sec, tb); break;
                case 'lista-incluido-excluido': contentBlock = shared.renderIncluidoExcluido(sec, tb); break;
                case 'tabla': contentBlock = shared.renderTabla(sec, tb); break;
                case 'tabla-info': contentBlock = shared.renderTablaInfo(sec, tb); break;
                case 'subseccion': contentBlock = shared.renderSubseccion(sec, tb); break;
                // Callout boxes: el titulo va DENTRO del box — limpiar titleBlock
                // para evitar que aparezca dos veces (como header de sección Y dentro del box).
                case 'caja-nota': contentBlock = shared.renderCajaNota(sec, tb); titleBlock = []; break;
                case 'caja-justificacion': contentBlock = shared.renderCajaJustificacion(sec, tb); titleBlock = []; break;
                case 'caja-criterio': contentBlock = shared.renderCajaCriterio(sec, tb); titleBlock = []; break;
                case 'caja-conclusion': contentBlock = shared.renderCajaConclusion(sec, tb); titleBlock = []; break;
                case 'tabla-decisiones-tc': contentBlock = renderTablaDecisionesTC(sec, tb); break;
                case 'tabla-firmas-final': contentBlock = renderTablaFirmasFinal(sec, tb, num); titleBlock = []; break;
                default:
                    contentBlock = [{
                        text: `[Tipo de seccion desconocido: ${sec.tipo}]`,
                        color: '#FF0000',
                        margin: [0, 0, 0, 12]
                    }];
            }

            // Wrappear titulo+contenido en unbreakable si es tabla chica
            out.push(...maybeWrapUnbreakable(sec, titleBlock, contentBlock));
        });

        return out;
    });

})(window);
