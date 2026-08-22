/* ====================================================================
   VALIDATION SUITE — RENDERER DS
   Design Specification (Especificacion de Diseno).
   Documento tipico de GAMP 4/5 que traduce los FRS en decisiones
   tecnicas concretas: arquitectura, componentes, interfaces tecnicas,
   modelo de datos, configuracion, seguridad tecnica, etc.

   Diferencia clave con FRS:
   - FRS dice QUE debe hacer el sistema (funcional)
   - DS dice COMO se va a implementar tecnicamente

   Tipos de seccion soportados:
   - Todos los compartidos (texto, tabla, tabla-info, subseccion,
     lista-incluido-excluido, caja-nota, caja-justificacion,
     caja-criterio, caja-conclusion, tabla-firmas-final)
   - diagrama-arquitectura : NUEVO. Diagrama de capas/componentes
     en cajas con flujo descendente (Presentacion -> Aplicacion ->
     Datos -> Infraestructura). Cada capa tiene componentes listados.

   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[ds.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // TIPO NUEVO: DIAGRAMA DE ARQUITECTURA
    //
    // Estructura JSON:
    // {
    //   "tipo": "diagrama-arquitectura",
    //   "titulo": "5. ARQUITECTURA DE ALTO NIVEL",
    //   "intro": "Texto descriptivo opcional...",
    //   "capas": [
    //     {
    //       "nombre": "Capa de Presentación",
    //       "tecnologia": "React 18 + Material-UI",
    //       "color": "primary | accent | secondary | hex",
    //       "componentes": [
    //         "Web App responsive (desktop, tablet)",
    //         "PWA para uso offline"
    //       ]
    //     },
    //     ...
    //   ],
    //   "nota": "Texto opcional al final"
    // }
    // ====================================================================
    function renderDiagramaArquitectura(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        const capas = sec.capas || [];

        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10, color: C.text, alignment: 'justify',
                lineHeight: 1.4, margin: [0, 0, 0, 12]
            });
        }

        // Resolver color por nombre o hex
        function resolveColor(c) {
            if (!c) return C.primary;
            if (c.startsWith('#')) return c;
            return C[c] || C.primary;
        }

        // Cada capa = stack vertical: cabecera (titulo + tecnologia) + bullets
        // Entre capa y capa: flecha hacia abajo
        capas.forEach((capa, idx) => {
            const capaColor = resolveColor(capa.color);

            // Cabecera de la capa: caja con titulo + tecnologia
            const headerCells = [
                {
                    stack: [
                        { text: capa.nombre || '—', fontSize: 11, bold: true, color: '#FFFFFF' },
                        capa.tecnologia ? { text: capa.tecnologia, fontSize: 9, italics: true, color: '#FFFFFF', margin: [0, 2, 0, 0] } : null
                    ].filter(Boolean),
                    fillColor: capaColor,
                    margin: [10, 8, 10, 8]
                }
            ];

            // Caja de componentes (lista bullets)
            const componentes = (capa.componentes || []).map(c => {
                if (typeof c === 'string') {
                    return { text: c, fontSize: 9, color: C.text, margin: [0, 0, 0, 3] };
                }
                return c;
            });

            const componentesCell = componentes.length > 0
                ? {
                    ul: componentes.map(c => c.text || c),
                    fontSize: 9, color: C.text,
                    fillColor: '#FFFFFF',
                    margin: [16, 8, 12, 8]
                }
                : { text: '—', fontSize: 9, color: C.textSoft, margin: [10, 8, 10, 8] };

            out.push({
                unbreakable: true,
                table: {
                    widths: ['*'],
                    body: [
                        [headerCells[0]],
                        [componentesCell]
                    ]
                },
                layout: {
                    hLineWidth: () => 0.5,
                    vLineWidth: () => 0.5,
                    hLineColor: () => capaColor,
                    vLineColor: () => capaColor,
                    paddingLeft: () => 0,
                    paddingRight: () => 0,
                    paddingTop: () => 0,
                    paddingBottom: () => 0
                },
                margin: [40, 0, 40, idx === capas.length - 1 ? 12 : 4]
            });

            // Flecha hacia abajo entre capas
            if (idx !== capas.length - 1) {
                out.push({
                    text: '▼',
                    fontSize: 16,
                    alignment: 'center',
                    color: C.primary,
                    margin: [0, 0, 0, 4]
                });
            }
        });

        if (sec.nota) {
            out.push({
                text: sec.nota,
                fontSize: 9, italics: true, color: C.textSoft,
                alignment: 'justify', margin: [0, 6, 0, 0]
            });
        }

        return out;
    }

    // ====================================================================
    // tabla-firmas-final (compartido con HLRA/VP/URS/FRS)
    // ====================================================================
    function renderTablaFirmasFinal(sec, tb, num) {
        if (VS.shared && typeof VS.shared.renderTablaFirmasFinalSmart === "function") {
            return VS.shared.renderTablaFirmasFinalSmart(sec, tb, { rolesDefault: [
                'Ejecutor (Validador)',
                'Revisor Técnico (IT / Arquitecto)',
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
    VS.registerRenderer('DS', function renderDS(data) {
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
                case 'diagrama-arquitectura': contentBlock = renderDiagramaArquitectura(sec, tb); break;
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
