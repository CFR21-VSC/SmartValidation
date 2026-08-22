/* ====================================================================
   VALIDATION SUITE — BOOK BUILDER
   Compila TODOS los docs del paquete documental en un único PDF tipo
   libro, con:

     - Tapa con identificación del paquete + decisión global.
     - Prefacio del libro (qué contiene).
     - Índice maestro navegable (TOC) con páginas.
     - Registro maestro de firmas (consolidado de todo el ciclo).
     - Cada doc del paquete uno tras otro, con TAB divider y
       contenido completo del renderer registrado.
     - Numeración GLOBAL consecutiva (Página X de Y).
     - Header dinámico con código del doc actual de cada página.
     - Single PDF descargable.

   Uso:
     VS.bookBuilder.generate(packageDocs, opts)
       → llama a pdfMake.createPdf(...) y descarga el PDF.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.bookBuilder = VS.bookBuilder || {};

    // ====================================================================
    // ORDEN CANÓNICO DEL PAQUETE (fase del ciclo)
    //
    // PHASE_ORDER = Tomo I (el ciclo narrativo, sin AEX).
    // AEX_TYPES   = Tomo II (anexos de ejecución con evidencias capturadas).
    //
    // Esta separación refleja la estructura real de auditoría: el ciclo
    // cuenta la historia (HLRA→...→VSR), y los AEX son evidencia adjunta
    // que respalda lo contado.
    // ====================================================================
    const PHASE_ORDER = [
        'HLRA', 'VP', 'URS', 'FRS', 'DS',
        'RA', 'IRA', 'RRM', 'MTR',
        'PIQ', 'IIQ', 'RIQ',
        'POQ', 'IOQ', 'NCR', 'ROQ',
        'PPQ', 'IPQ', 'RPQ',
        'VSR'
    ];
    const AEX_TYPES = ['AEX'];

    const PHASE_LABELS = {
        'HLRA': 'Análisis de Riesgo de Alto Nivel',
        'VP': 'Plan de Validación',
        'URS': 'User Requirements Specification',
        'FRS': 'Functional Requirements Specification',
        'DS': 'Design Specification',
        'RA': 'Risk Assessment Funcional',
        'IRA': 'Infrastructure Risk Assessment',
        'RRM': 'Risk Reduction Matrix',
        'MTR': 'Matriz de Trazabilidad',
        'PIQ': 'Protocolo de Calificación de Instalación',
        'IIQ': 'Informe de Calificación de Instalación',
        'RIQ': 'Reporte de Liberación IQ',
        'POQ': 'Protocolo de Calificación Operacional',
        'IOQ': 'Informe de Calificación Operacional',
        'NCR': 'Reporte de No Conformidades y CAPA',
        'ROQ': 'Reporte de Liberación OQ',
        'PPQ': 'Protocolo de Calificación de Performance',
        'IPQ': 'Informe de Calificación de Performance',
        'RPQ': 'Reporte de Liberación PQ',
        'AEX': 'Anexo de Ejecución (Evidencias)',
        'VSR': 'Reporte Maestro de Validación'
    };

    // ====================================================================
    // HELPERS — extracción de info de cada doc
    // ====================================================================

    function getDocCode(doc) {
        return (doc.data && doc.data.document && doc.data.document.code) || doc.code || doc.type;
    }
    function getDocVersion(doc) {
        return (doc.data && doc.data.document && doc.data.document.version) || doc.version || '—';
    }
    function getDocTitle(doc) {
        const t = doc.data && doc.data.document;
        return (t && t.titleEs) || (t && t.headerTitle) || doc.title || doc.type;
    }
    function getDocStatus(doc) {
        return (doc.data && doc.data.document && doc.data.document.status) || '—';
    }
    function getDocCreationDate(doc) {
        // controlCambios[0].fecha si existe, sino loadedAt
        const cc = doc.data && doc.data.controlCambios;
        if (Array.isArray(cc) && cc.length > 0 && cc[0].fecha) return cc[0].fecha;
        return doc.loadedAt ? new Date(doc.loadedAt).toLocaleDateString('es-AR') : '—';
    }
    function getDocApprovalDate(doc) {
        // matrizAprobaciones último fecha disponible (más reciente)
        const ap = doc.data && doc.data.matrizAprobaciones;
        if (Array.isArray(ap) && ap.length > 0) {
            const fechas = ap.map(a => a.fecha).filter(Boolean);
            if (fechas.length > 0) {
                return fechas[fechas.length - 1]; // última firma
            }
        }
        return doc.data && doc.data.document && doc.data.document.issueDate || '—';
    }

    function sortPackageDocs(packageDocs) {
        // Devuelve { tomo1, tomo2 }. tomo1 = docs del ciclo en orden canónico,
        // tomo2 = AEX en orden de aparición (sin sort específico, suelen ser 1-2).
        const filtered = (packageDocs || []).filter(d => d.type !== 'PEOPLE');
        const tomo1 = filtered
            .filter(d => PHASE_ORDER.indexOf(d.type) >= 0)
            .sort((a, b) => PHASE_ORDER.indexOf(a.type) - PHASE_ORDER.indexOf(b.type));
        const tomo2 = filtered
            .filter(d => AEX_TYPES.indexOf(d.type) >= 0);
        // Docs de tipo no reconocido (rare): los anexamos a tomo1 al final
        const otros = filtered.filter(d =>
            PHASE_ORDER.indexOf(d.type) < 0 && AEX_TYPES.indexOf(d.type) < 0
        );
        otros.forEach(d => tomo1.push(d));
        return { tomo1, tomo2 };
    }

    // ====================================================================
    // PORTADA DEL LIBRO
    //
    // Soporta dos variantes controladas por opts.coverDesign:
    //
    //   'franja' (default) — Fondo azul DRP sólido tipo carátula de libro.
    //     El fondo azul se inyecta vía la función `background` del docDefinition
    //     (que detecta currentPage === 1 y pinta toda la página). Aquí solo
    //     generamos el CONTENT (textos en blanco encima del azul).
    //
    //   'formal' — Fondo blanco con franja azul superior.
    //     Página 1 NO se pinta de azul (se excluye de bluePages). El contenido
    //     genera su propia tabla de encabezado azul y el resto del cuerpo en
    //     fondo blanco con texto oscuro.
    //
    // Campos personalizables via opts (todos opcionales):
    //   coverCliente, coverVersion, coverFechaCierre, coverResponsable,
    //   coverLogoDataUrl, coverDesign
    // ====================================================================
    function buildBookCover(packageDocs, opts) {
        const firstDoc = packageDocs[0];
        const pkg = (firstDoc && firstDoc.data && firstDoc.data.package) || {};
        const decision = opts.decisionGlobal || 'SISTEMA VALIDADO';
        const fechaCompilacion = new Date().toLocaleDateString('es-AR');

        // Extraer personas del paquete si hay un PEOPLE doc
        const peopleEntry = (packageDocs || []).find(d => d.type === 'PEOPLE');
        const personas = (peopleEntry && peopleEntry.data && peopleEntry.data.personas) || [];

        // Versión del libro (de la config personalizada o default 1.0)
        const libroVersion = opts.coverVersion || opts.libroVersion || '1.0';

        // Campos personalizados
        const coverCliente      = opts.coverCliente     || pkg.client || '';
        const coverFechaCierre  = opts.coverFechaCierre || '';
        const coverResponsable  = opts.coverResponsable || '';
        const coverLogoDataUrl  = opts.coverLogoDataUrl || null;
        const coverDesign       = opts.coverDesign      || 'franja';

        // Fecha de cierre formateada
        let fechaCierreLabel = '';
        if (coverFechaCierre) {
            try {
                const d = new Date(coverFechaCierre + 'T00:00:00');
                fechaCierreLabel = d.toLocaleDateString('es-AR');
            } catch (e) {
                fechaCierreLabel = coverFechaCierre;
            }
        }

        // ── Colores según diseño ──
        const isDark = coverDesign !== 'formal'; // 'franja' = fondo azul oscuro
        const txtPrimary  = isDark ? '#FFFFFF' : '#1F3C56';
        const txtSecond   = isDark ? '#A8C0D8' : '#586574';
        const txtSoft     = isDark ? '#C8DCEE' : '#7A8FA0';
        const lineColor   = isDark ? '#FFFFFF' : '#1F3C56';
        const labelColor  = isDark ? '#A8C0D8' : '#586574';

        const content = [];

        if (coverDesign === 'formal') {
            // ════════════════════════════════════════════════════════════
            // DISEÑO FORMAL — franja azul superior, resto blanco
            // ════════════════════════════════════════════════════════════

            // Franja de header azul con logo (si hay) + brand
            const headerCols = [];
            if (coverLogoDataUrl) {
                headerCols.push({ image: coverLogoDataUrl, fit: [70, 50], margin: [0, 10, 14, 10], alignment: 'left' });
            }
            headerCols.push({
                width: '*',
                stack: [
                    { text: 'DRP ASSURANCE', fontSize: 16, bold: true, color: '#FFFFFF', characterSpacing: 3 },
                    { text: 'Validation Suite', fontSize: 10, italics: true, color: '#A8C0D8', characterSpacing: 1, margin: [0, 2, 0, 0] }
                ],
                alignment: coverLogoDataUrl ? 'left' : 'center',
                margin: [0, 12, 0, 12]
            });

            content.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        columns: headerCols,
                        fillColor: '#1F3C56',
                        margin: [18, 0, 18, 0]
                    }]]
                },
                layout: 'noBorders',
                margin: [0, 0, 0, 0]
            });

            // Línea acento
            content.push({
                canvas: [{ type: 'rect', x: 0, y: 0, w: 455, h: 4, color: '#2E86AB' }],
                margin: [0, 0, 0, 36]
            });

            // Título
            content.push({
                text: 'LIBRO DE VALIDACIÓN',
                fontSize: 26, bold: true, color: '#1F3C56', alignment: 'center',
                characterSpacing: 4, margin: [0, 0, 0, 6]
            });
            content.push({
                canvas: [{ type: 'line', x1: 80, y1: 0, x2: 375, y2: 0, lineWidth: 1.5, lineColor: '#1F3C56' }],
                margin: [0, 0, 0, 20]
            });

            // Sistema
            content.push({
                text: pkg.systemName || 'Sistema sin identificar',
                fontSize: 20, bold: true, color: '#1F3C56', alignment: 'center',
                margin: [0, 0, 0, 6]
            });
            if (pkg.systemSubtitle) {
                content.push({
                    text: pkg.systemSubtitle,
                    fontSize: 11, italics: true, color: '#586574', alignment: 'center',
                    margin: [0, 0, 0, 4]
                });
            }
            content.push({
                text: 'versión ' + (pkg.systemVersion || '—'),
                fontSize: 12, color: '#586574', alignment: 'center',
                margin: [0, 4, 0, 28]
            });

            // Caja de metadatos
            const metaRows = [];
            metaRows.push([
                { text: 'Código del paquete', fontSize: 9, color: '#586574', alignment: 'right', margin: [0, 5, 10, 5], bold: true },
                { text: pkg.code || '—', fontSize: 11, bold: true, color: '#1F3C56', margin: [0, 5, 0, 5] }
            ]);
            if (coverCliente) {
                metaRows.push([
                    { text: 'Cliente', fontSize: 9, color: '#586574', alignment: 'right', margin: [0, 5, 10, 5], bold: true },
                    { text: coverCliente, fontSize: 11, color: '#1F3C56', margin: [0, 5, 0, 5] }
                ]);
            }
            if (coverResponsable) {
                metaRows.push([
                    { text: 'Responsable', fontSize: 9, color: '#586574', alignment: 'right', margin: [0, 5, 10, 5], bold: true },
                    { text: coverResponsable, fontSize: 11, color: '#1F3C56', margin: [0, 5, 0, 5] }
                ]);
            }
            metaRows.push([
                { text: 'Documentos compilados', fontSize: 9, color: '#586574', alignment: 'right', margin: [0, 5, 10, 5], bold: true },
                { text: String(packageDocs.filter(d => d.type !== 'PEOPLE').length), fontSize: 11, bold: true, color: '#1F3C56', margin: [0, 5, 0, 5] }
            ]);
            if (fechaCierreLabel) {
                metaRows.push([
                    { text: 'Fecha de cierre', fontSize: 9, color: '#586574', alignment: 'right', margin: [0, 5, 10, 5], bold: true },
                    { text: fechaCierreLabel, fontSize: 11, color: '#1F3C56', margin: [0, 5, 0, 5] }
                ]);
            }
            content.push({
                table: { widths: [130, '*'], body: metaRows },
                layout: {
                    hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 1 : 0.5,
                    vLineWidth: () => 0,
                    hLineColor: () => '#D8E4EE'
                },
                margin: [50, 0, 50, 20]
            });

            // Personal involucrado (opcional)
            if (personas.length > 0) {
                content.push({
                    text: 'Personal involucrado',
                    fontSize: 10, bold: true, color: '#1F3C56', margin: [50, 8, 50, 6]
                });
                const personasBody = personas.map(p => [
                    { text: p.iniciales || '', fontSize: 9, bold: true, color: '#1F3C56', alignment: 'center', margin: [0, 3, 0, 3] },
                    { text: p.nombre || '', fontSize: 9, color: '#1F2A36', margin: [0, 3, 0, 3] },
                    { text: p.rol || '', fontSize: 9, italics: true, color: '#586574', margin: [0, 3, 0, 3] }
                ]);
                content.push({
                    table: { widths: [35, 145, '*'], body: personasBody },
                    layout: 'noBorders',
                    margin: [50, 0, 50, 16]
                });
            }

            // Pie: fecha compilación + versión
            content.push({ canvas: [{ type: 'line', x1: 50, y1: 0, x2: 405, y2: 0, lineWidth: 0.8, lineColor: '#C8DCEE' }], margin: [0, 16, 0, 12] });
            content.push({
                columns: [
                    { width: '*', stack: [
                        { text: 'FECHA DE COMPILACIÓN', fontSize: 8, color: '#AFBDC8', characterSpacing: 1, alignment: 'center' },
                        { text: fechaCompilacion, fontSize: 12, bold: true, color: '#1F3C56', alignment: 'center', margin: [0, 3, 0, 0] }
                    ]},
                    { width: '*', stack: [
                        { text: 'VERSIÓN DEL PAQUETE', fontSize: 8, color: '#AFBDC8', characterSpacing: 1, alignment: 'center' },
                        { text: libroVersion, fontSize: 12, bold: true, color: '#1F3C56', alignment: 'center', margin: [0, 3, 0, 0] }
                    ]}
                ]
            });

        } else {
            // ════════════════════════════════════════════════════════════
            // DISEÑO FRANJA — fondo azul DRP sólido (diseño original)
            // ════════════════════════════════════════════════════════════

            // === BLOQUE 0 — Logo del cliente (si hay) ===
            if (coverLogoDataUrl) {
                content.push({
                    image: coverLogoDataUrl,
                    fit: [90, 56],
                    alignment: 'center',
                    margin: [0, 20, 0, 0]
                });
            } else {
                content.push({ text: '', margin: [0, 30, 0, 0] });
            }

            // === BLOQUE 1 — Brand superior ===
            content.push({
                text: 'DRP ASSURANCE',
                fontSize: 16, bold: true, color: '#FFFFFF', alignment: 'center',
                characterSpacing: 4,
                margin: [0, coverLogoDataUrl ? 8 : 0, 0, 4]
            });
            content.push({
                text: 'Validation Suite',
                fontSize: 10, italics: true, color: '#A8C0D8', alignment: 'center',
                characterSpacing: 2,
                margin: [0, 0, 0, 30]
            });

            // Línea divisoria fina blanca
            content.push({
                canvas: [{ type: 'line', x1: 100, y1: 0, x2: 355, y2: 0, lineWidth: 0.5, lineColor: '#FFFFFF' }],
                margin: [0, 0, 0, 40]
            });

            // === BLOQUE 2 — Título del libro ===
            content.push({
                text: 'LIBRO DE',
                fontSize: 24, bold: true, color: '#FFFFFF', alignment: 'center',
                characterSpacing: 6,
                margin: [0, 0, 0, 0]
            });
            content.push({
                text: 'VALIDACIÓN',
                fontSize: 28, bold: true, color: '#FFFFFF', alignment: 'center',
                characterSpacing: 6,
                margin: [0, 4, 0, 30]
            });

            // === BLOQUE 3 — Sistema (corazón de la portada) ===
            content.push({
                text: pkg.systemName || 'Sistema sin identificar',
                fontSize: 22, bold: true, color: '#FFFFFF', alignment: 'center',
                margin: [0, 0, 0, 8]
            });
            if (pkg.systemSubtitle) {
                content.push({
                    text: pkg.systemSubtitle,
                    fontSize: 11, italics: true, color: '#C8DCEE', alignment: 'center',
                    margin: [0, 0, 0, 4]
                });
            }
            content.push({
                text: 'versión ' + (pkg.systemVersion || '—'),
                fontSize: 13, color: '#A8C0D8', alignment: 'center',
                margin: [0, 4, 0, 30]
            });

            // === BLOQUE 4 — Caja de identificación ===
            const idRows = [
                [
                    { text: 'Código del paquete', fontSize: 9, color: '#A8C0D8', alignment: 'right', margin: [0, 4, 8, 4] },
                    { text: pkg.code || '—', fontSize: 11, bold: true, color: '#FFFFFF', margin: [0, 4, 0, 4] }
                ],
                [
                    { text: 'Cliente', fontSize: 9, color: '#A8C0D8', alignment: 'right', margin: [0, 4, 8, 4] },
                    { text: coverCliente || '—', fontSize: 11, color: '#FFFFFF', margin: [0, 4, 0, 4] }
                ],
                [
                    { text: 'Documentos compilados', fontSize: 9, color: '#A8C0D8', alignment: 'right', margin: [0, 4, 8, 4] },
                    { text: String(packageDocs.filter(d => d.type !== 'PEOPLE').length), fontSize: 11, bold: true, color: '#FFFFFF', margin: [0, 4, 0, 4] }
                ],
                [
                    { text: 'Período del ciclo', fontSize: 9, color: '#A8C0D8', alignment: 'right', margin: [0, 4, 8, 4] },
                    { text: opts.periodoCiclo || '—', fontSize: 11, color: '#FFFFFF', margin: [0, 4, 0, 4] }
                ]
            ];
            if (coverResponsable) {
                idRows.push([
                    { text: 'Responsable', fontSize: 9, color: '#A8C0D8', alignment: 'right', margin: [0, 4, 8, 4] },
                    { text: coverResponsable, fontSize: 11, color: '#FFFFFF', margin: [0, 4, 0, 4] }
                ]);
            }
            if (fechaCierreLabel) {
                idRows.push([
                    { text: 'Fecha de cierre', fontSize: 9, color: '#A8C0D8', alignment: 'right', margin: [0, 4, 8, 4] },
                    { text: fechaCierreLabel, fontSize: 11, color: '#FFFFFF', margin: [0, 4, 0, 4] }
                ]);
            }
            content.push({
                table: { widths: [125, '*'], body: idRows },
                layout: 'noBorders',
                margin: [60, 0, 60, 20]
            });

            // === BLOQUE 5 — Personal DRP involucrado ===
            if (personas.length > 0) {
                content.push({
                    text: '— PERSONAL INVOLUCRADO —',
                    fontSize: 9, color: '#A8C0D8', alignment: 'center', characterSpacing: 2,
                    margin: [0, 10, 0, 8]
                });
                const personasBody = personas.map(p => [
                    { text: p.iniciales || '', fontSize: 10, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 3, 0, 3] },
                    { text: p.nombre || '', fontSize: 10, color: '#FFFFFF', margin: [0, 3, 0, 3] },
                    { text: p.rol || '', fontSize: 9, italics: true, color: '#C8DCEE', margin: [0, 3, 0, 3] }
                ]);
                content.push({
                    table: { widths: [35, 145, '*'], body: personasBody },
                    layout: 'noBorders',
                    margin: [60, 0, 60, 16]
                });
            }

            // === BLOQUE 6 — Pie: fecha + versión del libro ===
            content.push({
                canvas: [{ type: 'line', x1: 100, y1: 0, x2: 355, y2: 0, lineWidth: 0.5, lineColor: '#FFFFFF' }],
                margin: [0, 14, 0, 14]
            });
            const footerCols = [
                { width: '*', text: 'FECHA DE COMPILACIÓN', fontSize: 8, color: '#A8C0D8', alignment: 'center', characterSpacing: 1, margin: [0, 0, 0, 2] },
                { width: '*', text: 'VERSIÓN DEL PAQUETE', fontSize: 8, color: '#A8C0D8', alignment: 'center', characterSpacing: 1, margin: [0, 0, 0, 2] }
            ];
            const footerVals = [
                { width: '*', text: fechaCompilacion, fontSize: 13, bold: true, color: '#FFFFFF', alignment: 'center' },
                { width: '*', text: libroVersion, fontSize: 13, bold: true, color: '#FFFFFF', alignment: 'center' }
            ];
            if (fechaCierreLabel) {
                footerCols.push({ width: '*', text: 'FECHA DE CIERRE', fontSize: 8, color: '#A8C0D8', alignment: 'center', characterSpacing: 1, margin: [0, 0, 0, 2] });
                footerVals.push({ width: '*', text: fechaCierreLabel, fontSize: 13, bold: true, color: '#FFFFFF', alignment: 'center' });
            }
            content.push({ columns: footerCols });
            content.push({ columns: footerVals, margin: [0, 0, 0, 0] });
        }

        content.push({ text: '', pageBreak: 'after' });
        return content;
    }

    // ====================================================================
    // GLOSARIO — términos GxP usados en el ciclo
    // ====================================================================
    function buildGlosario() {
        const tb = VS.templateBase;
        const C = tb.VS_COLORS;
        const out = [];
        out.push(tb.sectionTitle('GLOSARIO DE TÉRMINOS'));
        out.push({
            text: 'Glosario de términos técnicos y siglas utilizadas en el ciclo de validación documentado en este libro. Las definiciones siguen las convenciones de GAMP 5 (Second Edition 2022) y los marcos regulatorios complementarios.',
            fontSize: 10, italics: true, color: C.textSoft, alignment: 'justify', lineHeight: 1.35,
            margin: [0, 0, 0, 12]
        });

        const terminos = [
            ['CAPA', 'Corrective and Preventive Action — acción correctiva (resuelve el problema observado) y preventiva (evita que se repita).'],
            ['Categoría GAMP', 'Clasificación del software según GAMP 5 (Cat. 1 infraestructura, 3 estándar configurable, 4 configurable, 5 custom). Define el rigor de validación aplicable.'],
            ['CSA', 'Computer Software Assurance — enfoque FDA 2022 que sustituye CSV. Aplica rigor de validación proporcional al riesgo del software.'],
            ['DS', 'Design Specification — documento técnico que describe cómo se diseña el sistema para cumplir la FRS.'],
            ['FRS', 'Functional Requirements Specification — documento que detalla las funciones específicas que el sistema debe ejecutar para cumplir la URS.'],
            ['GAMP 5', 'Good Automated Manufacturing Practice (Second Edition 2022). Marco de referencia para validación de sistemas computarizados GxP.'],
            ['GxP', 'Conjunto de "Buenas Prácticas" regulatorias (GMP, GLP, GCP, etc.) aplicables al sector farmacéutico.'],
            ['HLRA', 'High Level Risk Assessment — análisis de riesgo inicial que define el alcance y rigor del ciclo de validación.'],
            ['IIQ', 'Informe de Calificación de Instalación — reporte de ejecución del PIQ.'],
            ['IOQ', 'Informe de Calificación Operacional — reporte de ejecución del POQ.'],
            ['IPQ', 'Informe de Calificación de Performance — reporte de ejecución del PPQ.'],
            ['IRA', 'Infrastructure Risk Assessment — análisis de riesgo de la infraestructura sobre la que corre el sistema.'],
            ['MTR', 'Matriz de Trazabilidad — vínculos URS ↔ RA ↔ TC ↔ Resultado a lo largo del ciclo.'],
            ['NC', 'No Conformidad — desviación identificada durante la ejecución que requiere análisis y CAPA.'],
            ['NCR', 'Non-Conformance Report — documento que consolida NCs identificadas, análisis de causa raíz y plan CAPA.'],
            ['PIQ / POQ / PPQ', 'Protocolos de Calificación de Instalación / Operacional / Performance. Definen los TCs a ejecutar en cada fase.'],
            ['PQ', 'Performance Qualification — fase final del ciclo. Verifica que el sistema opera en producción según lo esperado.'],
            ['RA', 'Risk Assessment funcional — análisis de riesgo de cada función del sistema. Origina los TCs críticos.'],
            ['RIQ / ROQ / RPQ', 'Reportes de Liberación de cada fase (IQ/OQ/PQ). Documento ejecutivo de cierre que un sponsor firma para autorizar el avance.'],
            ['RRM', 'Risk Reduction Matrix — matriz de mitigaciones aplicadas a los riesgos identificados en RA.'],
            ['TC', 'Test Case — caso de prueba con procedimiento, criterio de aceptación y resultado esperado.'],
            ['URS', 'User Requirements Specification — documento que describe los requerimientos del usuario al sistema.'],
            ['Validación', 'Demostración documentada de que el sistema cumple sus requerimientos especificados de forma consistente.'],
            ['VP', 'Validation Plan — plan que describe el alcance, metodología y entregables del ciclo de validación.'],
            ['VSR', 'Validation Summary Report — reporte maestro que consolida el ciclo completo en un solo documento.']
        ];

        const body = [
            [tb.vsTh('Término / Sigla'), tb.vsTh('Definición')]
        ];
        terminos.forEach((t, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            body.push([
                tb.vsTd(t[0], { fillColor: bg, bold: true, color: C.primary, fontSize: 9.5 }),
                tb.vsTd(t[1], { fillColor: bg, fontSize: 9, lineHeight: 1.3 })
            ]);
        });

        out.push({
            // widths 100 + 305 = 405 (cabe holgado en 455 utiles)
            table: { widths: tb.vsScaleWidths([100, 305]), body, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        out.push({ text: '', pageBreak: 'after' });
        return out;
    }

    // ====================================================================
    // MARCO REGULATORIO APLICADO
    // ====================================================================
    function buildMarcoRegulatorio(packageDocs) {
        const tb = VS.templateBase;
        const C = tb.VS_COLORS;
        const firstDoc = packageDocs[0];
        const gampCat = (firstDoc && firstDoc.data && firstDoc.data.document && firstDoc.data.document.gampCategory) || 'GAMP no declarado';
        const out = [];

        out.push(tb.sectionTitle('MARCO REGULATORIO APLICADO'));

        out.push({
            text: 'El ciclo de validación documentado en este libro se rige por los marcos normativos vigentes en industria farmacéutica regulada. La aplicación es proporcional al riesgo y categoría del sistema, conforme al principio de Computer Software Assurance (FDA CSA 2022).',
            fontSize: 10.5, alignment: 'justify', lineHeight: 1.4,
            margin: [0, 0, 0, 12]
        });

        // Categorización del sistema
        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'CATEGORIZACIÓN DEL SISTEMA', fontSize: 9, bold: true, color: '#FFFFFF', characterSpacing: 1, alignment: 'center', margin: [0, 0, 0, 4] },
                        { text: gampCat, fontSize: 14, bold: true, color: '#FFFFFF', alignment: 'center' }
                    ],
                    fillColor: C.primary,
                    margin: [14, 10, 14, 10]
                }]]
            },
            layout: 'noBorders',
            margin: [0, 0, 0, 14]
        });

        // Marcos normativos en tabla
        const marcos = [
            {
                code: 'GAMP 5 (Second Edition, 2022)',
                full: 'Good Automated Manufacturing Practice',
                desc: 'Estándar internacional ISPE para validación de sistemas computarizados GxP. Define las categorías, el ciclo en V (URS → DS → Calificación) y el enfoque proporcional al riesgo. Aplicable a las 4 categorías de software (1, 3, 4, 5).'
            },
            {
                code: 'FDA CSA (2022)',
                full: 'Computer Software Assurance for Production and Quality System Software',
                desc: 'Guidance de FDA que reemplaza el enfoque tradicional CSV por una metodología basada en pensamiento crítico (Critical Thinking) y proporcionalidad al riesgo. Habilita test cases reducidos para funciones de bajo impacto.'
            },
            {
                code: 'EU Annex 11 (2011)',
                full: 'Computerised Systems',
                desc: 'Anexo del EU GMP Guide que aplica a sistemas computarizados utilizados en producción farmacéutica europea. Establece principios de validación, auditoría y firma electrónica.'
            },
            {
                code: '21 CFR Part 11',
                full: 'Electronic Records / Electronic Signatures',
                desc: 'Regulación FDA que define los requisitos para registros y firmas electrónicas en industria farmacéutica. Aplica autenticación por PIN, audit trail, no-repudio y trazabilidad criptográfica.'
            },
            {
                code: 'ANMAT 4159/2023',
                full: 'Buenas Prácticas de Validación de Sistemas Computarizados (Argentina)',
                desc: 'Regulación nacional argentina equivalente a EU Annex 11 + 21 CFR Part 11. Aplicable a sistemas computarizados de uso GMP en Argentina.'
            },
            {
                code: 'ICH Q9',
                full: 'Quality Risk Management',
                desc: 'Guía ICH armonizada sobre gestión de riesgos en industria farmacéutica. Aplicada al análisis de causa raíz y CAPA del NCR.'
            }
        ];

        const body = [
            [tb.vsTh('Norma / Guía'), tb.vsTh('Título completo'), tb.vsTh('Aplicación en este ciclo')]
        ];
        marcos.forEach((m, i) => {
            const bg = (i % 2 === 1) ? C.bgSoft : null;
            body.push([
                tb.vsTd(m.code, { fillColor: bg, bold: true, color: C.primary, fontSize: 9 }),
                tb.vsTd(m.full, { fillColor: bg, italics: true, fontSize: 9, lineHeight: 1.3 }),
                tb.vsTd(m.desc, { fillColor: bg, fontSize: 9, lineHeight: 1.3 })
            ]);
        });

        out.push({
            // widths: 110 + 110 + 185 = 405 (cabe holgado)
            table: { widths: tb.vsScaleWidths([110, 110, 185]), body, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        // Principio de proporcionalidad
        out.push({
            text: 'Principio de proporcionalidad',
            fontSize: 11, bold: true, color: C.primary,
            margin: [0, 4, 0, 6]
        });
        out.push({
            text: 'El rigor de validación aplicado a cada componente del sistema es proporcional al riesgo regulatorio que ese componente supone. Los TCs críticos derivados del Risk Assessment (RA) son ejecutados con evidencia formal; los componentes de bajo riesgo se cubren con verificaciones más livianas conforme al pensamiento crítico CSA. Esta aproximación está reflejada en cada documento del paquete documental incluido en este libro.',
            fontSize: 10, alignment: 'justify', lineHeight: 1.4,
            margin: [0, 0, 0, 8]
        });

        out.push({ text: '', pageBreak: 'after' });
        return out;
    }

    // ====================================================================
    // PREFACIO
    // ====================================================================
    function buildPreface(packageDocs, opts) {
        const tb = VS.templateBase;
        const C = tb.VS_COLORS;
        return [
            tb.sectionTitle('PREFACIO'),
            {
                text: 'Este Libro de Validación consolida en un único documento navegable la totalidad de la evidencia del ciclo de validación del sistema. Contiene la cascada completa de los documentos producidos — desde el análisis de riesgo de alto nivel hasta el reporte maestro de cierre — más el registro consolidado de firmas electrónicas que las acompañan.',
                fontSize: 10.5, alignment: 'justify', lineHeight: 1.4, margin: [0, 0, 0, 8]
            },
            {
                text: 'La compilación está diseñada para ser presentada ante auditoría regulatoria como un entregable único. El índice maestro permite navegación directa a cada sección. La numeración de páginas es global y consecutiva. Cada documento conserva su estructura, firmas y decisiones formales originales.',
                fontSize: 10.5, alignment: 'justify', lineHeight: 1.4, margin: [0, 0, 0, 8]
            },
            {
                text: 'El libro se genera automáticamente desde el paquete documental cargado en el suite de validación, asegurando coherencia entre el contenido individual de cada documento y la consolidación final. Cualquier modificación posterior a documentos del paquete invalida esta compilación y requiere una nueva emisión del libro.',
                fontSize: 10.5, alignment: 'justify', lineHeight: 1.4, italics: true, color: C.textSoft, margin: [0, 0, 0, 16]
            },
            {
                text: 'Estructura del libro:',
                fontSize: 11, bold: true, color: C.primary, margin: [0, 8, 0, 6]
            },
            {
                ol: [
                    { text: 'Tabla de Contenidos: mapa navegable de todas las secciones del libro con números de página y links directos.' },
                    { text: 'Índice Maestro: lista de todos los documentos del paquete con código, versión, fechas y fase del ciclo.' },
                    { text: 'Registro Maestro de Firmas: matriz consolidada de todas las firmas electrónicas del ciclo.' },
                    { text: 'Cascada Documental: cada documento del paquete renderizado completo, en orden canónico (HLRA → VP → URS → ... → VSR).' }
                ],
                fontSize: 10.5, margin: [0, 0, 0, 10]
            },
            { text: '', pageBreak: 'after' }
        ];
    }

    // ====================================================================
    // TABLA DE CONTENIDOS (TOC) CON NÚMEROS DE PÁGINA
    //
    // Genera el TOC del libro. En la 2da pasada del doble render
    // (opts._chapterMap poblado) usa páginas REALES. En la 1ra pasada
    // usa páginas estimadas marcadas con "~".
    //
    // Cada entrada es clickeable via linkToDestination a los anchors
    // 'book-doc-N' y 'book-aex-N' que ya existen en buildDocDivider.
    // ====================================================================
    function buildBookTOC(tomo1, tomo2, opts) {
        opts = opts || {};
        const tb = VS.templateBase;
        const C = tb.VS_COLORS;
        const chapterMap = opts._chapterMap || null;
        const hasRealPages = chapterMap && Object.keys(chapterMap).length > 0;

        // Construir mapa inverso: idx+tomo → pageNumber
        // chapterMap tiene la forma { pageNumber: { idx, tomo, code, ... } }
        const realPageByKey = {};
        if (hasRealPages) {
            Object.keys(chapterMap).forEach(pn => {
                const ch = chapterMap[pn];
                const key = (ch.tomo === 2 ? 'aex-' : 'doc-') + ch.idx;
                realPageByKey[key] = parseInt(pn, 10);
            });
        }

        // Estimación de páginas para la 1ra pasada (sin chapterMap).
        // Portada + Prefacio + Glosario + Marco + Índice + Firmas ≈ 10 páginas.
        let estimatedPage = 10;

        function estimateDocPages(doc) {
            const secciones = (doc.data && doc.data.secciones) || [];
            // Cubierta del doc (2 págs) + secciones (1 pág por c/1.5 secciones) + trazabilidad (~1)
            return 2 + Math.max(1, Math.ceil(secciones.length / 1.5)) + 1;
        }

        const content = [];

        // sectionTitle devuelve [textBlock, canvasBlock]. Se spreadan en content
        // para que queden como items top-level (no como columnas), lo que permite
        // que pageBreakBefore capture startPosition correctamente.
        // Al textBlock (primer item, el que tiene más alto y aparece primero en
        // la página) se le agrega id 'book-toc' para detectar la página del TOC.
        const tocTitleBlocks = tb.sectionTitle('TABLA DE CONTENIDOS');
        const tocTitleArr = Array.isArray(tocTitleBlocks) ? tocTitleBlocks : [tocTitleBlocks];
        if (tocTitleArr[0]) tocTitleArr[0].id = 'book-toc';
        tocTitleArr.forEach(b => content.push(b));
        content.push({
            text: hasRealPages
                ? 'Navegación directa a cada sección del libro. Haga click en el título para ir a la sección.'
                : 'Navegación directa a cada sección del libro. Haga click en el título para ir a la sección. Los números de página son aproximados en esta vista previa.',
            fontSize: 10, italics: true, color: C.textSoft, margin: [0, 0, 0, 16]
        });

        // Función que construye una fila del TOC.
        // Usa linkToPage cuando el número de página es exacto (2da pasada del render)
        // porque Chrome/Edge no soportan linkToDestination (named destinations).
        function tocRow(label, title, anchorId, pageNum, isApprox, indent, isBold) {
            const pageText = isApprox
                ? [{ text: '~' + pageNum, bold: true, color: C.primary }]
                : [{ text: String(pageNum), bold: true, color: C.primary }];

            const titleCell = {
                width: '*',
                text: title,
                color: '#2980B9',
                fontSize: 9.5,
                bold: isBold,
                decoration: 'underline',
                margin: [0, 2, 8, 2]
            };
            if (!isApprox) {
                titleCell.linkToPage = pageNum;     // funciona en todos los viewers
            } else {
                titleCell.linkToDestination = anchorId; // fallback primera pasada
            }

            return {
                columns: [
                    {
                        width: 28,
                        text: label,
                        fontSize: 9,
                        bold: isBold,
                        color: C.primary,
                        margin: [indent || 0, 2, 4, 2]
                    },
                    titleCell,
                    {
                        width: 36,
                        text: pageText,
                        alignment: 'right',
                        fontSize: 9,
                        margin: [0, 2, 0, 2]
                    }
                ],
                margin: [0, 1, 0, 1]
            };
        }

        // Separador de tomo
        function tomoHeader(label) {
            return {
                table: {
                    widths: ['*'],
                    body: [[{
                        text: label,
                        fontSize: 9, bold: true, color: '#FFFFFF',
                        fillColor: C.primary,
                        alignment: 'center',
                        margin: [8, 4, 8, 4]
                    }]]
                },
                layout: 'noBorders',
                margin: [0, 10, 0, 6]
            };
        }

        // ── PRELIMINARES ──
        // Siempre están en las primeras páginas pero no tienen anchor propio.
        // Se usan números fijos / estimados de referencia.
        const prelims = [
            { label: '·', title: 'Portada del libro', page: 1, anchor: null },
            { label: '·', title: 'Prefacio', page: 2, anchor: null },
            { label: '·', title: 'Glosario de Términos', page: 3, anchor: null },
            { label: '·', title: 'Marco Regulatorio Aplicado', page: 4, anchor: null },
            { label: '·', title: 'Índice Maestro', page: 5, anchor: null },
            { label: '·', title: 'Registro Maestro de Firmas', page: 6, anchor: null }
        ];

        content.push({
            text: 'SECCIONES PRELIMINARES',
            fontSize: 9, bold: true, color: C.textSoft,
            characterSpacing: 1, margin: [0, 0, 0, 6]
        });

        prelims.forEach(p => {
            content.push({
                columns: [
                    { width: 28, text: p.label, fontSize: 9, color: C.textSoft, margin: [0, 1, 4, 1] },
                    { width: '*', text: p.title, fontSize: 9, color: C.text, margin: [0, 1, 8, 1] },
                    { width: 36, text: String(p.page), fontSize: 9, color: C.textSoft, alignment: 'right', margin: [0, 1, 0, 1] }
                ],
                margin: [0, 0, 0, 1]
            });
        });

        // Línea divisora
        content.push({
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: 455, y2: 0, lineWidth: 0.5, lineColor: '#D0D8E0' }],
            margin: [0, 10, 0, 0]
        });

        // ── TOMO I: CICLO DE VALIDACIÓN ──
        if (tomo1.length > 0) {
            content.push(tomoHeader('TOMO I — CICLO DE VALIDACIÓN'));
            tomo1.forEach((doc, idx) => {
                const key = 'doc-' + idx;
                let pageNum, isApprox;
                if (hasRealPages && realPageByKey[key] != null) {
                    pageNum = realPageByKey[key];
                    isApprox = false;
                } else {
                    pageNum = estimatedPage;
                    isApprox = true;
                    estimatedPage += estimateDocPages(doc);
                }
                const label = String(idx + 1).padStart(2, '0');
                const titulo = getDocTitle(doc);
                content.push(tocRow(label, `${doc.type} — ${titulo.slice(0, 55)}`, 'book-doc-' + idx, pageNum, isApprox, 0, false));
            });
        }

        // ── TOMO II: ANEXOS DE EJECUCIÓN ──
        if (tomo2.length > 0) {
            content.push(tomoHeader('TOMO II — ANEXOS DE EJECUCIÓN'));
            tomo2.forEach((doc, idx) => {
                const key = 'aex-' + idx;
                let pageNum, isApprox;
                if (hasRealPages && realPageByKey[key] != null) {
                    pageNum = realPageByKey[key];
                    isApprox = false;
                } else {
                    pageNum = estimatedPage;
                    isApprox = true;
                    estimatedPage += estimateDocPages(doc);
                }
                const label = 'AEX ' + toRoman(idx + 1);
                const titulo = getDocTitle(doc);
                content.push(tocRow(label, `${doc.type} — ${titulo.slice(0, 55)}`, 'book-aex-' + idx, pageNum, isApprox, 0, false));
            });
        }

        // Nota al pie
        if (!hasRealPages) {
            content.push({
                text: '* Números de página aproximados generados en la primera pasada de renderizado. El PDF final muestra los números exactos.',
                fontSize: 8, italics: true, color: C.textSoft, margin: [0, 14, 0, 0]
            });
        } else {
            content.push({
                text: '* Haga click sobre el título de cualquier sección para navegar directamente a ella.',
                fontSize: 8, italics: true, color: C.textSoft, margin: [0, 14, 0, 0]
            });
        }

        content.push({ text: '', pageBreak: 'after' });
        return content;
    }

    // ====================================================================
    // ÍNDICE MAESTRO
    // ====================================================================
    function buildMasterIndex(packageDocs) {
        const tb = VS.templateBase;
        const C = tb.VS_COLORS;
        const out = [];

        out.push(tb.sectionTitle('ÍNDICE MAESTRO'));
        out.push({
            text: 'Listado completo de los documentos del paquete con código, versión, fechas y fase del ciclo. Cada entrada es navegable.',
            fontSize: 10, italics: true, color: C.textSoft, margin: [0, 0, 0, 12]
        });

        // Tabla de índice
        const body = [[
            tb.vsTh('#', { alignment: 'center' }),
            tb.vsTh('Fase'),
            tb.vsTh('Código'),
            tb.vsTh('Título'),
            tb.vsTh('Ver', { alignment: 'center' }),
            tb.vsTh('Creación', { alignment: 'center' }),
            tb.vsTh('Aprobación', { alignment: 'center' })
        ]];

        packageDocs.forEach((doc, idx) => {
            const bg = (idx % 2 === 1) ? C.bgSoft : null;
            const fase = PHASE_LABELS[doc.type] || doc.type;
            body.push([
                tb.vsTd(String(idx + 1), { fillColor: bg, alignment: 'center', bold: true, fontSize: 9, color: C.primary }),
                tb.vsTd(doc.type, { fillColor: bg, alignment: 'center', bold: true, fontSize: 8.5, color: C.primary }),
                {
                    text: getDocCode(doc),
                    fillColor: bg, fontSize: 9, bold: true,
                    linkToDestination: 'book-doc-' + idx,
                    color: '#0E5285',
                    decoration: 'underline'
                },
                tb.vsTd(getDocTitle(doc).slice(0, 50), { fillColor: bg, fontSize: 8.5, italics: true }),
                tb.vsTd(getDocVersion(doc), { fillColor: bg, alignment: 'center', fontSize: 8.5 }),
                tb.vsTd(getDocCreationDate(doc), { fillColor: bg, alignment: 'center', fontSize: 8 }),
                tb.vsTd(getDocApprovalDate(doc), { fillColor: bg, alignment: 'center', fontSize: 8 })
            ]);
        });

        out.push({
            // widths: 20+30+75+125+28+50+55 = 383pt (cabe holgado en 455pt utiles A4)
            table: {
                widths: tb.vsScaleWidths([18, 27, 68, 113, 25, 45, 50]),
                body, headerRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        out.push({
            text: 'Click en el código del documento para navegar al inicio de su sección dentro del libro.',
            fontSize: 9, italics: true, color: C.textSoft, alignment: 'center',
            margin: [0, 0, 0, 0]
        });

        out.push({ text: '', pageBreak: 'after' });
        return out;
    }

    // ====================================================================
    // REGISTRO MAESTRO DE FIRMAS
    // ====================================================================
    function buildMasterSignatureRegistry(packageDocs) {
        const tb = VS.templateBase;
        const C = tb.VS_COLORS;
        const out = [];

        out.push(tb.sectionTitle('REGISTRO MAESTRO DE FIRMAS'));
        out.push({
            text: 'Consolidación de todas las firmas electrónicas registradas en el ciclo de validación. Cada fila vincula una firma con su documento, persona firmante, rol y fecha. Las firmas con hash de PIN registrado tienen referencia criptográfica (HASH-REF) para auditoría.',
            fontSize: 10, alignment: 'justify', italics: true, color: C.textSoft, margin: [0, 0, 0, 12]
        });

        // Recolectar todas las firmas
        const allFirmas = [];
        packageDocs.forEach(doc => {
            const data = doc.data;
            const docCode = getDocCode(doc);
            // tabla-firmas-final
            const tff = (data.secciones || []).find(s => s.tipo === 'tabla-firmas-final');
            if (tff && Array.isArray(tff.firmas)) {
                tff.firmas.forEach(f => {
                    if (f.nombre && f.fecha) {
                        allFirmas.push({
                            docCode, docTipo: doc.type,
                            rol: f.rol, nombre: f.nombre, iniciales: f.iniciales,
                            fecha: f.fecha,
                            hashRef: f._signatureHashRef || '',
                            signedAt: f._signedAt || ''
                        });
                    }
                });
            }
            // NCR: firmas por sección gated
            if (doc.type === 'NCR') {
                ['ncr-registro-hallazgos', 'ncr-analisis-causa', 'ncr-plan-capa', 'ncr-cierre-aprobacion'].forEach(t => {
                    const sec = (data.secciones || []).find(s => s.tipo === t);
                    if (sec && Array.isArray(sec.firmas)) {
                        sec.firmas.forEach(f => {
                            if (f.nombre && f.fecha) {
                                allFirmas.push({
                                    docCode: docCode + ' / ' + t.replace('ncr-', ''),
                                    docTipo: 'NCR-section',
                                    rol: f.rol, nombre: f.nombre, iniciales: f.iniciales,
                                    fecha: f.fecha,
                                    hashRef: f._signatureHashRef || '',
                                    signedAt: f._signedAt || ''
                                });
                            }
                        });
                    }
                });
            }
        });

        if (allFirmas.length === 0) {
            out.push({
                text: 'Sin firmas registradas en el ciclo.',
                fontSize: 10, italics: true, color: C.textSoft, alignment: 'center',
                fillColor: '#F4F6F8', margin: [0, 12, 0, 12]
            });
            out.push({ text: '', pageBreak: 'after' });
            return out;
        }

        // KPIs arriba
        const personasUnicas = new Set(allFirmas.map(f => f.nombre.trim().toLowerCase())).size;
        const docsConFirmas = new Set(allFirmas.map(f => f.docCode.split(' / ')[0])).size;
        const conHash = allFirmas.filter(f => f.hashRef).length;

        const kpi = (label, value, color) => ({
            stack: [
                { text: label, fontSize: 8.5, color: C.textSoft, alignment: 'center', margin: [0, 4, 0, 2] },
                { text: String(value), fontSize: 16, bold: true, color, alignment: 'center', margin: [0, 0, 0, 4] }
            ],
            fillColor: '#F4F6F8'
        });
        out.push({
            table: {
                widths: ['*', '*', '*', '*'],
                body: [[
                    kpi('Total firmas', allFirmas.length, C.primary),
                    kpi('Documentos firmados', docsConFirmas, C.primary),
                    kpi('Personas firmantes', personasUnicas, C.primary),
                    kpi('Con hash 21 CFR', conHash, conHash > 0 ? '#1E7E34' : '#717D8A')
                ]]
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 12]
        });

        // Tabla de firmas
        const body = [[
            tb.vsTh('#', { alignment: 'center' }),
            tb.vsTh('Documento'),
            tb.vsTh('Rol'),
            tb.vsTh('Nombre'),
            tb.vsTh('Inic.', { alignment: 'center' }),
            tb.vsTh('Fecha', { alignment: 'center' }),
            tb.vsTh('Hash-Ref', { alignment: 'center' })
        ]];
        allFirmas.forEach((f, idx) => {
            const bg = (idx % 2 === 1) ? C.bgSoft : null;
            body.push([
                tb.vsTd(String(idx + 1), { fillColor: bg, alignment: 'center', bold: true, fontSize: 8, color: C.primary }),
                tb.vsTd(f.docCode, { fillColor: bg, fontSize: 8, bold: true }),
                tb.vsTd(f.rol, { fillColor: bg, fontSize: 8 }),
                tb.vsTd(f.nombre, { fillColor: bg, fontSize: 8, bold: true }),
                tb.vsTd(f.iniciales || '—', { fillColor: bg, alignment: 'center', fontSize: 8, bold: true, color: C.primary }),
                tb.vsTd(f.fecha, { fillColor: bg, alignment: 'center', fontSize: 8 }),
                tb.vsTd(f.hashRef ? f.hashRef.substring(0, 10) : '—', { fillColor: bg, alignment: 'center', fontSize: 7, italics: true, color: f.hashRef ? '#1E7E34' : C.textSoft })
            ]);
        });

        out.push({
            // widths: 20+85+85+95+25+45+50 = 405pt (cabe holgado en 455pt utiles A4)
            table: { widths: tb.vsScaleWidths([20, 85, 85, 95, 25, 45, 50]), body, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 8]
        });

        out.push({
            text: `Total: ${allFirmas.length} firma(s) registrada(s) por ${personasUnicas} persona(s) en ${docsConFirmas} documento(s) del ciclo. ${conHash > 0 ? `${conHash} firma(s) con hash criptográfico verificable (21 CFR Part 11).` : ''}`,
            fontSize: 9, italics: true, color: C.textSoft, alignment: 'justify', margin: [0, 0, 0, 0]
        });

        out.push({ text: '', pageBreak: 'after' });
        return out;
    }

    // ====================================================================
    // PORTADA TOMO II — ANEXOS DE EJECUCIÓN
    //
    // Solo se inserta si el paquete tiene 1+ AEX. Misma estética que la
    // portada Tomo I (fondo azul DRP) pero con título "TOMO II — ANEXOS
    // DE EJECUCIÓN" y lista breve de los AEX que contiene.
    // ====================================================================
    function buildTomo2Cover(aexDocs, packageDocs, opts) {
        const firstDoc = packageDocs[0];
        const pkg = (firstDoc && firstDoc.data && firstDoc.data.package) || {};
        const content = [];

        // Anchor para que pageBreakBefore registre esta página como azul.
        // El id va sobre el primer bloque VISIBLE (text "DRP ASSURANCE") + headlineLevel
        // para que pdfMake lo registre como bloque posicionable confiable.
        content.push({
            id: 'book-tomo2-cover',
            headlineLevel: 1,
            text: 'DRP ASSURANCE',
            fontSize: 14, bold: true, color: '#FFFFFF', alignment: 'center',
            characterSpacing: 4, margin: [0, 60, 0, 4]
        });
        content.push({
            text: 'Validation Suite',
            fontSize: 9, italics: true, color: '#A8C0D8', alignment: 'center',
            characterSpacing: 2, margin: [0, 0, 0, 36]
        });

        content.push({
            canvas: [{ type: 'line', x1: 100, y1: 0, x2: 355, y2: 0, lineWidth: 0.5, lineColor: '#FFFFFF' }],
            margin: [0, 0, 0, 36]
        });

        content.push({
            text: 'TOMO II',
            fontSize: 32, bold: true, color: '#FFFFFF', alignment: 'center',
            characterSpacing: 10, margin: [0, 0, 0, 8]
        });
        content.push({
            text: 'ANEXOS DE EJECUCIÓN',
            fontSize: 18, bold: true, color: '#FFFFFF', alignment: 'center',
            characterSpacing: 5, margin: [0, 0, 0, 30]
        });

        // Subtítulo descriptivo
        content.push({
            text: 'Evidencia capturada durante la ejecución del ciclo',
            fontSize: 11, italics: true, color: '#C8DCEE', alignment: 'center',
            margin: [0, 0, 0, 36]
        });

        // Mini-índice
        content.push({
            canvas: [{ type: 'line', x1: 140, y1: 0, x2: 315, y2: 0, lineWidth: 0.5, lineColor: '#A8C0D8' }],
            margin: [0, 0, 0, 14]
        });
        content.push({
            text: 'CONTENIDO DEL TOMO',
            fontSize: 9, color: '#A8C0D8', alignment: 'center', characterSpacing: 2,
            margin: [0, 0, 0, 14]
        });
        const idxBody = aexDocs.map((doc, i) => [
            { text: 'Anexo ' + toRoman(i + 1), fontSize: 10, color: '#FFFFFF', bold: true, alignment: 'right', margin: [0, 4, 8, 4] },
            { text: getDocCode(doc), fontSize: 10, color: '#FFFFFF', margin: [0, 4, 6, 4] },
            { text: getDocTitle(doc).slice(0, 50), fontSize: 9, italics: true, color: '#C8DCEE', margin: [0, 4, 0, 4] }
        ]);
        content.push({
            table: { widths: [75, 110, '*'], body: idxBody },
            layout: 'noBorders',
            margin: [50, 0, 50, 30]
        });

        // Pie
        content.push({
            canvas: [{ type: 'line', x1: 100, y1: 0, x2: 355, y2: 0, lineWidth: 0.5, lineColor: '#FFFFFF' }],
            margin: [0, 20, 0, 14]
        });
        content.push({
            text: pkg.code || '—',
            fontSize: 11, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 4]
        });
        content.push({
            text: aexDocs.length + ' anexo' + (aexDocs.length !== 1 ? 's' : '') + ' compilado' + (aexDocs.length !== 1 ? 's' : ''),
            fontSize: 9, italics: true, color: '#A8C0D8', alignment: 'center',
            margin: [0, 0, 0, 0]
        });

        content.push({ text: '', pageBreak: 'after' });
        return content;
    }

    // Helper: número romano simple (I, II, III, IV, V, ..., X)
    function toRoman(n) {
        const map = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV'];
        return map[n - 1] || String(n);
    }

    // ====================================================================
    // TAB DIVIDER ENTRE DOCS
    // ====================================================================
    function buildDocDivider(doc, idx, opts) {
        opts = opts || {};
        const tb = VS.templateBase;
        const C = tb.VS_COLORS;
        const codigo = getDocCode(doc);
        const titulo = getDocTitle(doc);
        const fase = PHASE_LABELS[doc.type] || doc.type;
        const version = getDocVersion(doc);
        const isAnexo = opts.tomo === 2;
        const labelKind = isAnexo ? 'ANEXO ' + toRoman(idx + 1) : 'SECCIÓN ' + String(idx + 1).padStart(2, '0');
        // En Tomo II usamos un anchor distinto para el chapterMap
        const anchorId = isAnexo ? 'book-aex-' + idx : 'book-doc-' + idx;

        // El id se pone DIRECTAMENTE en el bloque visible (la tabla del divider)
        // y se agrega `headlineLevel: 1` para que pdfMake llame siempre a
        // pageBreakBefore con currentNode.id y startPosition.pageNumber
        // poblados. Un `{ text: '', id: ... }` se omite a veces porque pdfMake
        // no lo registra como bloque posicionable confiable.
        return [
            {
                id: anchorId,
                headlineLevel: 1,
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            { text: labelKind, fontSize: 11, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 6] },
                            { text: doc.type, fontSize: 48, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 6] },
                            { text: codigo, fontSize: 14, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 4] },
                            { text: 'versión ' + version, fontSize: 11, italics: true, color: '#FFFFFF', alignment: 'center' }
                        ],
                        fillColor: C.primary,
                        margin: [20, 35, 20, 35]
                    }]]
                },
                layout: {
                    hLineWidth: () => 3, vLineWidth: () => 3,
                    hLineColor: () => C.primary, vLineColor: () => C.primary
                },
                margin: [40, 80, 40, 18]
            },
            {
                text: fase,
                fontSize: 14, bold: true, alignment: 'center', color: C.primary,
                margin: [0, 0, 0, 6]
            },
            {
                text: titulo,
                fontSize: 11, alignment: 'center', italics: true, color: C.text,
                margin: [0, 0, 0, 0]
            },
            { text: '', pageBreak: 'after' }
        ];
    }

    // ====================================================================
    // ENTRY POINT — buildDocDefinition
    // ====================================================================
    function buildDocDefinition(packageDocs, opts) {
        opts = opts || {};
        const tb = VS.templateBase;
        if (!tb) throw new Error('templateBase no esta cargado');

        const sorted = sortPackageDocs(packageDocs);
        // Filtrar tomos según opts.tomo:
        //   undefined o 'completo' → ambos tomos (default)
        //   1 → solo Tomo I (ciclo, sin AEX)
        //   2 → solo Tomo II (solo AEX)
        const tomoMode = opts.tomo || 'completo';
        const tomo1 = (tomoMode === 2) ? [] : sorted.tomo1;
        const tomo2 = (tomoMode === 1) ? [] : sorted.tomo2;
        if (tomo1.length === 0 && tomo2.length === 0) throw new Error('No hay documentos en el paquete para compilar.');
        const allDocs = [...tomo1, ...tomo2];

        // Header global del libro
        const firstDoc = allDocs[0];
        const pkg = (firstDoc && firstDoc.data && firstDoc.data.package) || {};

        // Helper: renderea el contenido completo de un doc (cover + ctrl + traza + specific)
        function renderDocContent(doc) {
            const out = [];
            const renderer = VS.renderers[doc.type];
            if (!renderer) {
                out.push({
                    text: `[Renderer no registrado para tipo "${doc.type}"]`,
                    color: '#A52A2A', italics: true, margin: [0, 30, 0, 30]
                });
                return out;
            }
            try {
                const cover = tb.buildCoverPage(doc.data);
                const ctrlAppr = tb.buildControlAndApprovalsPage(doc.data);
                const trazabilidadBlock = (VS.shared && VS.shared.renderTrazabilidadDetallada)
                    ? VS.shared.renderTrazabilidadDetallada(doc.data, tb)
                    : [];
                const specific = renderer(doc.data) || [];
                out.push(...cover);
                out.push(...ctrlAppr);
                out.push(...trazabilidadBlock);
                out.push(...specific);
            } catch (e) {
                console.error('[book-builder] error al renderear', doc.type, e);
                out.push({
                    text: `[Error al renderear ${doc.type}: ${e.message}]`,
                    color: '#A52A2A', italics: true, margin: [0, 30, 0, 30]
                });
            }
            return out;
        }

        const content = [];

        // ─── PRELIMINARES DEL LIBRO ───
        // 1) Portada azul del libro
        content.push(...buildBookCover(allDocs, opts));
        // 2) Prefacio
        content.push(...buildPreface(allDocs, opts));
        // 3) Glosario
        content.push(...buildGlosario());
        // 4) Marco regulatorio aplicado
        content.push(...buildMarcoRegulatorio(allDocs));
        // 5) Tabla de contenidos con números de página
        //    En la 1ra pasada (opts._chapterMap vacío) usa páginas estimadas.
        //    En la 2da pasada (opts._chapterMap poblado) usa páginas reales.
        content.push(...buildBookTOC(tomo1, tomo2, opts));
        // 6) Índice maestro (incluye ambos tomos)
        content.push(...buildMasterIndex(allDocs));
        // 7) Registro maestro de firmas (firmas de TODOS los docs, ambos tomos)
        content.push(...buildMasterSignatureRegistry(allDocs));

        // ─── TOMO I: CASCADA DEL CICLO ───
        tomo1.forEach((doc, idx) => {
            content.push(...buildDocDivider(doc, idx, { tomo: 1 }));
            content.push(...renderDocContent(doc));
            content.push({ text: '', pageBreak: 'after' });
        });

        // ─── TOMO II: ANEXOS DE EJECUCIÓN (solo si hay AEX) ───
        if (tomo2.length > 0) {
            // Portada del Tomo II
            content.push(...buildTomo2Cover(tomo2, allDocs, opts));
            // Anexos uno por uno
            tomo2.forEach((doc, idx) => {
                content.push(...buildDocDivider(doc, idx, { tomo: 2 }));
                content.push(...renderDocContent(doc));
                content.push({ text: '', pageBreak: 'after' });
            });
        }

        // Contratapa simple. El último doc ya terminó con `pageBreak: 'after'`
        // (dentro del forEach), así que estamos al inicio de una página fresca.
        // Agregar pageBreak: 'before' acá generaba un salto extra (página en
        // blanco entre la última firma y la contratapa) — removido.
        content.push({
            text: '— FIN DEL LIBRO DE VALIDACIÓN —',
            fontSize: 12, bold: true, color: tb.VS_COLORS.primary, alignment: 'center',
            margin: [0, 200, 0, 8]
        });
        content.push({
            text: `${pkg.systemName || ''} ${pkg.systemVersion ? 'v' + pkg.systemVersion : ''}`,
            fontSize: 14, alignment: 'center', italics: true, color: tb.VS_COLORS.text,
            margin: [0, 0, 0, 16]
        });
        content.push({
            text: `Paquete ${pkg.code || ''} · Compilado el ${new Date().toLocaleDateString('es-AR')}`,
            fontSize: 10, alignment: 'center', color: tb.VS_COLORS.textSoft,
            margin: [0, 0, 0, 0]
        });

        // === Background dinámico ===
        // Página 1 (portada): pinta TODA la página azul DRP sólido,
        // EXCEPTO cuando el diseño de portada es 'formal' (fondo blanco con franja).
        // Resto de páginas: usa el background del primer doc (watermark estándar).
        const origBg = tb.buildBackground ? tb.buildBackground(firstDoc.data) : null;
        const coverIsFormal = (opts.coverDesign === 'formal');
        // bluePages = páginas que deben pintarse azul DRP sólido. Se llena durante
        // pageBreakBefore al detectar el anchor de la portada Tomo II.
        // Igual que chapterMap, puede venir pre-poblado en la 2da pasada del doble render.
        const bluePages = (opts._bluePages && typeof opts._bluePages === 'object')
            ? opts._bluePages
            : (coverIsFormal ? {} : { 1: true });
        function bookBackground(currentPage, pageSize) {
            if (bluePages[currentPage]) {
                return [{
                    canvas: [{
                        type: 'rect',
                        x: 0, y: 0,
                        w: pageSize.width, h: pageSize.height,
                        color: '#1F3C56'
                    }]
                }];
            }
            return origBg;
        }

        // noHeaderPages = páginas sin header ni footer (portadas). Para diseño
        // 'formal', la página 1 tiene fondo blanco pero sigue sin header/footer.
        const noHeaderPages = Object.assign({}, bluePages);
        if (coverIsFormal) noHeaderPages[1] = true;

        // === Mapa de capítulos: pageNumber → { idx, code, title, fase } ===
        // Se llena durante el procesamiento de pageBreakBefore (que tiene
        // acceso a node.startPosition.pageNumber).
        // El header dinámico hace lookup en este mapa para mostrar el capítulo
        // actual a la derecha.
        // chapterMap puede venir pre-poblado desde un render anterior (doble pasada).
        // Si se pasa via opts._chapterMap, lo usamos y `pageBreakBefore` solo lee.
        // Si no, se llena durante este render (1ra pasada del doble render).
        const chapterMap = (opts._chapterMap && typeof opts._chapterMap === 'object')
            ? opts._chapterMap
            : {};
        // Página donde empieza el TOC (capturada en 1ra pasada, pasada en 2da).
        let tocPage = opts._tocPage || null;

        function pageBreakBefore(currentNode) {
            if (!currentNode || !currentNode.id) return false;
            const id = currentNode.id;

            // Detectar inicio del TOC → guardar su página para el link "↑ Índice".
            // Se actualiza en AMBAS pasadas del doble render: la 2da pasada tiene
            // contenido levemente distinto (texto más corto, linkToPage en rows)
            // y puede diferir en una página respecto a la 1ra.
            if (id === 'book-toc') {
                const pn = (currentNode.startPosition && currentNode.startPosition.pageNumber) || null;
                if (pn != null) tocPage = pn;
                return false;
            }

            // Detectar portada Tomo II → marcar página como azul
            if (id === 'book-tomo2-cover') {
                const pn = (currentNode.startPosition && currentNode.startPosition.pageNumber) || null;
                if (pn != null) bluePages[pn] = true;
                return false;
            }

            let tomo = 0, idx = -1, doc = null;
            if (id.indexOf('book-doc-') === 0) {
                tomo = 1;
                idx = parseInt(id.split('-')[2], 10);
                doc = tomo1[idx];
            } else if (id.indexOf('book-aex-') === 0) {
                tomo = 2;
                idx = parseInt(id.split('-')[2], 10);
                doc = tomo2[idx];
            }
            if (doc) {
                const pageNum = (currentNode.startPosition && currentNode.startPosition.pageNumber) || null;
                if (pageNum != null) {
                    chapterMap[pageNum] = {
                        idx: idx,
                        tomo: tomo,
                        code: getDocCode(doc),
                        title: doc.type,
                        fase: PHASE_LABELS[doc.type] || doc.type
                    };
                }
            }
            return false; // no forzar pageBreak (el divider ya lo hace)
        }

        function findCurrentChapter(page) {
            // Devuelve el último capítulo registrado en pageMap con pageNumber <= page
            let bestPage = -1, best = null;
            Object.keys(chapterMap).forEach(p => {
                const pn = parseInt(p, 10);
                if (pn <= page && pn > bestPage) { bestPage = pn; best = chapterMap[pn]; }
            });
            return best;
        }

        // === Header dinámico ===
        // - Portadas azules (página 1 y portada Tomo II): sin header.
        // - Páginas preliminares (preface/glosario/marco/índice/firmas): right
        //   muestra "Preliminares" porque chapterMap aún no tiene capítulo.
        // - Páginas de cada doc: right muestra "Capítulo XX · CODE" o
        //   "Tomo II · Anexo XX · CODE".
        function bookHeader(currentPage, pageCount) {
            if (noHeaderPages[currentPage]) return ''; // portadas (azules o formales), sin header
            const chap = findCurrentChapter(currentPage);
            let rightLabel;
            if (chap) {
                if (chap.tomo === 2) {
                    rightLabel = `Tomo II · Anexo ${toRoman(chap.idx + 1)} · ${chap.code}`;
                } else {
                    rightLabel = `Capítulo ${String(chap.idx + 1).padStart(2, '0')} · ${chap.code}`;
                }
            } else {
                // Antes del primer capítulo → secciones preliminares del libro
                rightLabel = 'Preliminares';
            }
            return {
                columns: [
                    {
                        width: '*',
                        text: 'Libro de Validación · ' + (pkg.code || ''),
                        fontSize: 8, color: '#586574', italics: true, alignment: 'left',
                        margin: [70, 28, 0, 0]
                    },
                    {
                        width: '*',
                        text: rightLabel,
                        fontSize: 8, color: '#586574', italics: true, bold: true, alignment: 'right',
                        margin: [0, 28, 70, 0]
                    }
                ]
            };
        }

        function bookFooter(currentPage, pageCount) {
            if (noHeaderPages[currentPage]) return ''; // portadas (azules o formales) sin footer
            return {
                columns: [
                    {
                        width: '*',
                        text: 'Compilado por DRP Assurance Validation Suite',
                        fontSize: 8, color: '#AFBDC8', italics: true, alignment: 'left',
                        margin: [70, 14, 0, 0]
                    },
                    {
                        width: 'auto',
                        text: '↑ Índice',
                        linkToPage: tocPage || 5,
                        fontSize: 8, color: '#2980B9', alignment: 'center',
                        margin: [0, 14, 0, 0]
                    },
                    {
                        width: '*',
                        text: `Página ${currentPage} de ${pageCount}`,
                        fontSize: 9, color: '#586574', bold: true, alignment: 'right',
                        margin: [0, 14, 70, 0]
                    }
                ]
            };
        }

        const docDef = {
            pageSize: 'A4',
            pageOrientation: 'portrait',
            pageMargins: tb.PAGE_MARGINS,
            content: content,
            background: bookBackground,
            header: bookHeader,
            footer: bookFooter,
            pageBreakBefore: pageBreakBefore,
            info: {
                title: `Libro de Validación — ${pkg.code || 'PKG'}`,
                author: 'DRP Assurance Validation Suite',
                subject: pkg.systemName + ' v' + (pkg.systemVersion || ''),
                creator: 'DRP Assurance Validation Suite',
                producer: 'DRP Assurance'
            },
            defaultStyle: {
                fontSize: 10,
                color: tb.VS_COLORS.text,
                lineHeight: 1.3
            }
        };
        // Exponer los mapas para que el caller pueda leerlos tras el 1er render
        // y pasarlos a la 2da pasada (header dinámico que requiere chapterMap populado).
        docDef._chapterMap = chapterMap;
        docDef._bluePages = bluePages;
        docDef._tocPage = tocPage; // página del TOC → usado para linkToPage en footer
        return docDef;
    }

    /**
     * Genera el libro de validación.
     * @param {Array} packageDocs
     * @param {Object} [opts] - {
     *     decisionGlobal, periodoCiclo, fileName,
     *     tomo: undefined | 1 | 2,   // filtro por tomo
     *     openInNewTab: bool,         // abrir en pestaña nueva
     *     openInline: bool            // mostrar en iframe del bookPreview
     *   }
     */
    async function generate(packageDocs, opts) {
        opts = opts || {};
        if (!Array.isArray(packageDocs) || packageDocs.length === 0) {
            throw new Error('No hay documentos en el paquete para compilar el libro.');
        }
        if (typeof pdfMake === 'undefined') {
            throw new Error('pdfMake no está cargado.');
        }
        // Auto-cargar logo si no fue cargado
        if (!global.VS_LOGO_DATAURL && typeof VS.tryAutoLoadLogo === 'function') {
            await VS.tryAutoLoadLogo();
        }

        // ──────────────────────────────────────────────────────────────
        // DOBLE RENDER (necesario para que el header dinámico funcione).
        //   1ra pasada: render en memoria para que pageBreakBefore
        //               registre el mapa página→capítulo + páginas azules.
        //               El header de esta pasada todavía no tiene el mapa
        //               populado, así que se ve mal — pero el resultado
        //               se descarta.
        //   2da pasada: re-render con el mapa precomputado. Ahora SI el
        //               header function tiene acceso al chapterMap completo
        //               y muestra "Capítulo XX · CÓDIGO".
        // Costo: ~2x tiempo de generación. Pero es la única forma robusta
        // en pdfMake; el callback header se ejecuta antes de finalizar
        // pageBreakBefore.
        // ──────────────────────────────────────────────────────────────
        // Audit log: registrar inicio de la generación del libro
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('BOOK_GENERATE', 'package', 'libro', {
                tomo: opts.tomo || 'completo',
                totalDocs: packageDocs.length,
                docTypes: [...new Set(packageDocs.map(d => d.type))]
            }, 'Libro de Validación');
        }

        const docDef1 = buildDocDefinition(packageDocs, opts);
        await new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(docDef1).getBuffer(() => resolve());
            } catch (e) { reject(e); }
        });

        // Diagnóstico: si el header dinámico no funciona, este log ayuda a ver
        // si pageBreakBefore registró capítulos. Si chapters === 0, pdfMake no
        // está invocando pageBreakBefore para los anchors de los dividers.
        const chapKeys = Object.keys(docDef1._chapterMap || {});
        console.info(`[book-builder] 1ra pasada · ${chapKeys.length} capítulo(s) registrados, ${Object.keys(docDef1._bluePages || {}).length} página(s) azul(es)`);

        // Re-renderizar pasando los mapas que se llenaron en la 1ra pasada
        const opts2 = Object.assign({}, opts, {
            _chapterMap: docDef1._chapterMap,
            _bluePages: docDef1._bluePages,
            _tocPage: docDef1._tocPage
        });
        const docDef = buildDocDefinition(packageDocs, opts2);

        const pkgCode = (packageDocs[0] && packageDocs[0].data && packageDocs[0].data.package && packageDocs[0].data.package.code) || 'PKG';
        const tomoSuffix = opts.tomo === 1 ? '_TomoI_Ciclo' : opts.tomo === 2 ? '_TomoII_Anexos' : '';
        const fileName = opts.fileName || `Libro_Validacion${tomoSuffix}_${pkgCode}_${new Date().toISOString().split('T')[0]}.pdf`;

        return new Promise((resolve, reject) => {
            try {
                const pdfDoc = pdfMake.createPdf(docDef);
                if (opts.openInline && VS.bookPreview && typeof VS.bookPreview.openWithDocDef === 'function') {
                    // Preview inline: reusa el blob ya generado y abre iframe en el modal
                    pdfDoc.getBlob(blob => {
                        VS.bookPreview.attachBlob(blob, fileName, { totalDocs: (opts._stats && opts._stats.totalDocs) }, opts);
                        resolve(blob);
                    });
                } else if (opts.openInNewTab) {
                    pdfDoc.open();
                    resolve(null);
                } else {
                    pdfDoc.download(fileName);
                    pdfDoc.getBlob(blob => resolve(blob));
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    // Estimar stats antes de generar (para mostrar al usuario).
    // sortPackageDocs ahora devuelve { tomo1, tomo2 } — los combinamos.
    function stats(packageDocs) {
        const { tomo1, tomo2 } = sortPackageDocs(packageDocs);
        const all = [...tomo1, ...tomo2];
        let firmas = 0;
        all.forEach(doc => {
            const tff = (doc.data && doc.data.secciones || []).find(s => s.tipo === 'tabla-firmas-final');
            if (tff && Array.isArray(tff.firmas)) firmas += tff.firmas.filter(f => f.nombre && f.fecha).length;
            // NCR sub-firmas
            if (doc.type === 'NCR') {
                ['ncr-registro-hallazgos','ncr-analisis-causa','ncr-plan-capa','ncr-cierre-aprobacion'].forEach(t => {
                    const s = (doc.data.secciones || []).find(x => x.tipo === t);
                    if (s && Array.isArray(s.firmas)) firmas += s.firmas.filter(f => f.nombre && f.fecha).length;
                });
            }
        });
        return {
            totalDocs: all.length,
            totalDocsTomo1: tomo1.length,
            totalDocsTomo2: tomo2.length,
            totalFirmas: firmas,
            docsPorTipo: all.reduce((acc, d) => { acc[d.type] = (acc[d.type] || 0) + 1; return acc; }, {})
        };
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    VS.bookBuilder.generate = generate;
    VS.bookBuilder.buildDocDefinition = buildDocDefinition;
    VS.bookBuilder.stats = stats;
    VS.bookBuilder.PHASE_ORDER = PHASE_ORDER;
    VS.bookBuilder.PHASE_LABELS = PHASE_LABELS;

})(window);
