/* ====================================================================
   VALIDATION SUITE — TEMPLATE BASE  (v1.1 — pulido)
   Componentes comunes a todos los documentos del paquete de validacion
   ==================================================================== */

(function (global) {
    'use strict';

    // ===== Paleta DRP =====
    const VS_COLORS = {
        primary: '#1F3C56',       // azul DRP profundo (banners, headers tabla)
        primaryDark: '#152A3D',
        secondary: '#2C4F70',
        accent: '#00b050',
        text: '#2A2A2A',
        textSoft: '#5a5a5a',
        neutral: '#717D8A',
        border: '#D0D5DB',
        bgSoft: '#F4F6F8',
        bgHeader: '#1F3C56',
        bgBlueLight: '#E8EEF6',
        bgYellow: '#FFF8DC',
        bgGreen: '#E8F5E9',
        bgRedSoft: '#FDECEA',
        white: '#FFFFFF',
        sevMenor: '#C0392B',
        sevMayor: '#E67E22',
        sevInfo: '#2980B9',
        statusApproved: '#00b050',
        statusDraft: '#E67E22',
        statusReview: '#2980B9'
    };

    // A4 portrait: 595.28 x 841.89. Con margins [70,90,70,60] el ancho util es 455.28
    const PAGE_MARGINS = [70, 90, 70, 60];
    const CONTENT_WIDTH = 455;

    /** Stopwords en español (artículos/preposiciones/conjunciones cortas).
     *  Cuando aparecen en mayúscula en un título, deben pasar a minúscula
     *  al aplicar formato oración (evita el caso "DE", "EL", "LA"). */
    const SPANISH_STOPWORDS = new Set([
        'DE', 'EL', 'LA', 'EN', 'CON', 'POR', 'SIN', 'AL', 'DEL', 'LOS', 'LAS',
        'UN', 'UNA', 'Y', 'O', 'A', 'ES', 'SE', 'LE', 'LO', 'SU', 'MI', 'TU',
        'SI', 'NO', 'PARA', 'ENTRE', 'SOBRE'
    ]);

    /** Sentence case con preservación de acrónimos/códigos.
     *  Reglas:
     *    - Palabras 2-6 chars todo mayúsculas (y no stopwords): se preservan (SAP, URS, IQ, FDA).
     *    - Códigos tipo URS-001, DRP-SIS-001: se preservan.
     *    - Stopwords ES en mayúscula: pasan a minúscula.
     *    - Resto: lowercase, con primera letra capitalizada si es el primer token. */
    function vsToSentenceCase(s) {
        if (!s || typeof s !== 'string') return s;
        const tokens = s.split(/(\s+)/);
        let isFirst = true;
        return tokens.map(t => {
            if (/^\s+$/.test(t)) return t;
            const upper = t.toUpperCase();
            if (SPANISH_STOPWORDS.has(upper)) {
                const lower = t.toLowerCase();
                if (isFirst) {
                    isFirst = false;
                    return lower.charAt(0).toUpperCase() + lower.slice(1);
                }
                return lower;
            }
            // Acrónimo: 2-6 letras todas mayúsculas
            if (/^[A-ZÁÉÍÓÚÑ]{2,6}$/.test(t)) {
                isFirst = false;
                return t;
            }
            // Código tipo URS-001, DRP-SIS-001
            if (/^[A-Z][A-Z0-9\-]*\d/.test(t)) {
                isFirst = false;
                return t;
            }
            const lower = t.toLowerCase();
            if (isFirst) {
                isFirst = false;
                return lower.charAt(0).toUpperCase() + lower.slice(1);
            }
            return lower;
        }).join('');
    }

    /** Aplica el casing apropiado según el patrón de numeración:
     *    "N. Texto"      → "N. TEXTO" (nivel 1, MAYÚSCULA)
     *    "N.N Texto"     → "N.N Texto" (subsección, formato oración)
     *    "N.N.N Texto"   → "N.N.N Texto" (sub-subsección, formato oración)
     *    "Texto suelto"  → sin cambios (títulos especiales como "PREFACIO")
     *  Si el título no calza con el patrón de numeración, se devuelve intacto. */
    function vsFormatTitleCasing(text) {
        if (!text || typeof text !== 'string') return text;
        const m = text.match(/^(\d+(?:\.\d+)+)\s+(.+)$/);
        if (m) {
            // Subsección (tiene al menos un punto): sentence case
            return m[1] + ' ' + vsToSentenceCase(m[2]);
        }
        const m1 = text.match(/^(\d+)\.\s+(.+)$/);
        if (m1) {
            // Nivel 1 (sólo un número y punto): MAYÚSCULA
            return m1[1] + '. ' + m1[2].toUpperCase();
        }
        return text;
    }

    /** Normaliza widths numéricos para que la tabla ocupe el ancho completo de la página.
     *  pdfMake agrega padding por celda FUERA de los widths:
     *    - vsTableLayout (regular): 6+6 = 12pt/celda → paddingPerCell omitido o 12
     *    - vsTableLayoutDense:      3+3 = 6pt/celda  → paddingPerCell = 6
     *  Siempre escala (sube o baja) para llenar el ancho disponible.
     *  Arrays con '*' o 'auto' se devuelven intactos. */
    function vsScaleWidths(widths, paddingPerCell) {
        if (!Array.isArray(widths)) return widths;
        if (!widths.every(w => typeof w === 'number')) return widths;
        const PAD       = (typeof paddingPerCell === 'number') ? paddingPerCell : 12;
        const MIN_COL   = 20;   // mínimo absoluto por columna (≈4 chars a 9pt)
        const MARGEN    = 4;
        const nCols     = widths.length;
        const realLimit = CONTENT_WIDTH - MARGEN - (PAD * nCols);
        const sum       = widths.reduce((a, b) => a + b, 0);
        if (sum === 0) return widths;

        // Escalar proporcionalmente
        const scale  = realLimit / sum;
        let scaled   = widths.map(w => Math.floor(w * scale));

        // Aplicar mínimo: si alguna columna quedó angosta, tomar el déficit de las más anchas
        let deficit = 0;
        scaled = scaled.map(w => { if (w < MIN_COL) { deficit += MIN_COL - w; return MIN_COL; } return w; });
        if (deficit > 0) {
            // Ordenar índices de más ancho a más angosto y descontar el déficit
            const order = scaled.map((w, i) => i).sort((a, b) => scaled[b] - scaled[a]);
            for (const i of order) {
                if (deficit <= 0) break;
                const give = Math.min(deficit, scaled[i] - MIN_COL);
                scaled[i] -= give;
                deficit   -= give;
            }
        }
        return scaled;
    }

    // ====================================================================
    // PORTADA (PAGINA 1)
    // ====================================================================
    function buildCoverPage(data) {
        const pkg = data.package || {};
        const doc = data.document || {};
        const sysName = pkg.systemName || 'Sistema sin nombre';
        const sysVersion = pkg.systemVersion || '';
        const titleEs = doc.titleEs || data.titleEs || '';
        const titleEn = doc.titleEn || data.titleEn || '';

        const content = [];

        // ===== Logo =====
        if (global.VS_LOGO_DATAURL) {
            content.push({
                image: global.VS_LOGO_DATAURL,
                width: 70,
                alignment: 'center',
                margin: [0, 10, 0, 12]
            });
        } else {
            content.push({ text: '', margin: [0, 50, 0, 0] });
        }

        // ===== Empresa =====
        // pkg.consultant = firma consultora (DRP Assurance); pkg.client = organización cliente (va en tablas)
        content.push({
            text: (pkg.consultant || 'DRP Assurance').toUpperCase(),
            fontSize: 20,
            bold: true,
            color: VS_COLORS.primary,
            alignment: 'center',
            margin: [0, 0, 0, 4],
            characterSpacing: 1
        });

        // ===== Linea decorativa superior =====
        content.push({
            canvas: [{ type: 'line', x1: 60, y1: 0, x2: 395, y2: 0, lineWidth: 0.5, lineColor: VS_COLORS.primary }],
            margin: [0, 6, 0, 4]
        });

        // ===== Subtítulo QMS =====
        content.push({
            text: pkg.qmsLabel || 'Sistema de Gestión de Calidad GxP',
            fontSize: 10,
            color: VS_COLORS.text,
            alignment: 'center',
            margin: [0, 0, 0, 4]
        });

        // ===== Linea decorativa inferior =====
        content.push({
            canvas: [{ type: 'line', x1: 60, y1: 0, x2: 395, y2: 0, lineWidth: 0.5, lineColor: VS_COLORS.primary }],
            margin: [0, 0, 0, 24]
        });

        // ===== Titulo principal del documento (ES) =====
        content.push({
            text: titleEs.toUpperCase(),
            fontSize: 19,
            bold: true,
            color: VS_COLORS.primary,
            alignment: 'center',
            margin: [0, 0, 0, 4]
        });

        // ===== Subtítulo en ingles (italic) =====
        if (titleEn) {
            content.push({
                text: titleEn,
                fontSize: 11,
                italics: true,
                color: VS_COLORS.textSoft,
                alignment: 'center',
                margin: [0, 0, 0, 18]
            });
        } else {
            content.push({ text: '', margin: [0, 0, 0, 18] });
        }

        // ===== Banner azul con sistema + version =====
        const bannerStack = [
            {
                text: sysName,
                fontSize: 14,
                bold: true,
                color: VS_COLORS.white,
                alignment: 'center'
            }
        ];
        const subtitleParts = [];
        if (pkg.systemSubtitle) subtitleParts.push(pkg.systemSubtitle);
        if (sysVersion) subtitleParts.push(`Versión ${sysVersion}`);
        if (subtitleParts.length > 0) {
            bannerStack.push({
                text: subtitleParts.join(' — '),
                fontSize: 10,
                color: VS_COLORS.white,
                alignment: 'center',
                margin: [0, 4, 0, 0]
            });
        }

        content.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: bannerStack,
                    fillColor: VS_COLORS.primary,
                    margin: [16, 12, 16, 12],
                    border: [false, false, false, false]
                }]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 22]
        });

        // ===== Tabla de metadata =====
        const metadataRows = buildCoverMetadataRows(data);
        if (metadataRows.length > 0) {
            content.push({
                table: {
                    // Total: 135 + 320 = 455 (= CONTENT_WIDTH)
                    // Label narrower (135), value wider (320) — más espacio para
                    // valores largos como Marco Normativo o URLs, evita overflow.
                    widths: vsScaleWidths([121, 287]),
                    body: metadataRows,
                    dontBreakRows: true
                },
                layout: vsBoxLayout(),
                alignment: 'center',
                margin: [0, 0, 0, 0]
            });
        }

        // Forzar salto de pagina al final de la portada
        // (el copyright de portada lo dibuja el callback `background` del docDefinition)
        content.push({ text: '', pageBreak: 'after' });

        return content;
    }

    /**
     * Background callback para usar en docDefinition.background.
     * Dibuja el copyright al pie SOLO de la portada.
     */
    function buildBackground(data) {
        const pkg = data.package || {};
        const year = pkg.year || new Date().getFullYear();
        const company = pkg.consultant || 'DRP Assurance';
        const text = `© ${year} ${company} — Documento Controlado — Distribución Restringida`;

        return function (currentPage, pageSize) {
            if (currentPage !== 1) return null;
            return {
                text: text,
                fontSize: 9,
                italics: true,
                color: VS_COLORS.neutral,
                alignment: 'center',
                absolutePosition: { x: 0, y: pageSize.height - 50 },
                margin: [50, 0, 50, 0]
            };
        };
    }

    function buildCoverMetadataRows(data) {
        const pkg = data.package || {};
        const doc = data.document || {};
        const rows = [];

        const fields = [
            { label: 'Código del Documento', value: getDocumentCode(data) },
            { label: 'Código de Inventario', value: pkg.code },
            { label: 'Versión', value: doc.version },
            { label: 'Fecha de Emisión', value: formatDateLong(doc.issueDate) },
            { label: 'Estado', value: doc.status, statusColor: true },
            { label: 'Process Owner', value: doc.processOwner },
            { label: 'Organización', value: pkg.client },
            { label: 'Categoría GAMP', value: doc.gampCategory, bold: true },
            { label: 'Marco Normativo', value: doc.normativeFramework }
        ];

        // Permitir campos extras especificos del tipo de documento
        // (ej. VP: 'Documento base (HLRA)', 'Tipo de Validación')
        if (doc.extras && typeof doc.extras === 'object') {
            Object.keys(doc.extras).forEach(key => {
                fields.push({ label: key, value: doc.extras[key] });
            });
        }

        fields.forEach(f => {
            if (!f.value) return;
            const labelCell = {
                text: f.label,
                fontSize: 8.5,
                bold: true,
                color: VS_COLORS.text,
                fillColor: VS_COLORS.bgSoft,
                margin: [8, 3, 8, 3]
            };
            const valueCell = {
                text: f.value,
                fontSize: 8.5,
                color: VS_COLORS.text,
                margin: [8, 3, 8, 3]
            };
            if (f.bold) valueCell.bold = true;
            if (f.statusColor) {
                valueCell.color = getStatusColor(f.value);
                valueCell.bold = true;
            }
            rows.push([labelCell, valueCell]);
        });

        return rows;
    }

    // ====================================================================
    // PAGINA 2 — CONTROL DE CAMBIOS + MATRIZ DE APROBACIONES
    // ====================================================================
    function buildControlAndApprovalsPage(data) {
        const content = [];

        // ===== Seccion Control de Cambios =====
        content.push(sectionTitle('CONTROL DE CAMBIOS'));

        const cambios = data.controlCambios || [];
        const cambiosBody = [
            // Header de tabla. Total widths: 55 + 75 + 130 + 235 = 495
            [
                vsTh('Versión'),
                vsTh('Fecha'),
                vsTh('Autor'),
                vsTh('Descripción')
            ]
        ];
        if (cambios.length === 0) {
            cambiosBody.push([
                vsTd('—', { alignment: 'center' }),
                vsTd('—', { alignment: 'center' }),
                vsTd('—'),
                vsTd('Sin cambios registrados', { italics: true, color: VS_COLORS.neutral })
            ]);
        } else {
            cambios.forEach((c, idx) => {
                const bg = idx % 2 === 1 ? VS_COLORS.bgSoft : null;
                cambiosBody.push([
                    vsTd(c.version || '—', { fillColor: bg, alignment: 'center', bold: true }),
                    vsTd(formatDateShort(c.fecha), { fillColor: bg, alignment: 'center' }),
                    vsTd(c.autor || '—', { fillColor: bg }),
                    vsTd(c.descripcion || '—', { fillColor: bg })
                ]);
            });
        }
        content.push({
            table: { widths: vsScaleWidths([68, 68, 114, 205]), body: cambiosBody, dontBreakRows: true, headerRows: 1 },
            layout: vsTableLayout(),
            margin: [0, 0, 0, 0],
            pageBreak: 'after'
        });

        return content;
    }


    // ====================================================================
    // HEADER / FOOTER POR PAGINA
    // ====================================================================
    function buildPageHeader(data, currentPage, totalPages) {
        if (currentPage === 1) return null;

        const pkg = data.package || {};
        const doc = data.document || {};
        const titleShort = doc.headerTitle || doc.titleEs || '';
        const docCode = getDocumentCode(data);
        const company = (pkg.consultant || 'DRP Assurance').toUpperCase();

        return {
            margin: [50, 30, 50, 0],
            stack: [
                {
                    columns: [
                        // Logo izq (24x24)
                        global.VS_LOGO_DATAURL
                            ? { image: global.VS_LOGO_DATAURL, width: 24, alignment: 'left' }
                            : { text: '', width: 24 },
                        // Centro: empresa + titulo doc
                        {
                            stack: [
                                { text: company, fontSize: 9, bold: true, color: VS_COLORS.primary, alignment: 'center' },
                                { text: titleShort, fontSize: 8, color: VS_COLORS.textSoft, alignment: 'center' }
                            ],
                            margin: [0, 2, 0, 0]
                        },
                        // Codigo doc der
                        {
                            text: docCode,
                            fontSize: 9,
                            bold: true,
                            color: VS_COLORS.primary,
                            alignment: 'right',
                            margin: [0, 6, 0, 0]
                        }
                    ]
                },
                // Linea inferior
                {
                    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 455, y2: 0, lineWidth: 0.8, lineColor: VS_COLORS.primary }],
                    margin: [0, 6, 0, 0]
                }
            ]
        };
    }

    function buildPageFooter(data, currentPage, totalPages) {
        if (currentPage === 1) return null;

        const pkg = data.package || {};
        const doc = data.document || {};
        const company = pkg.consultant || 'DRP Assurance';
        const docCode = getDocumentCode(data);
        const docVersion = doc.version ? ` v${doc.version}` : '';
        const year = pkg.year || new Date().getFullYear();
        // Numerar paginas excluyendo portada
        const visiblePage = currentPage - 1;
        const visibleTotal = totalPages - 1;

        return {
            margin: [50, 10, 50, 20],
            stack: [
                {
                    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 455, y2: 0, lineWidth: 0.5, lineColor: VS_COLORS.border }],
                    margin: [0, 0, 0, 6]
                },
                {
                    columns: [
                        { text: `© ${year} ${company}`, fontSize: 8, color: VS_COLORS.neutral, width: '*' },
                        { text: `${docCode}${docVersion}`, fontSize: 8, color: VS_COLORS.neutral, width: 'auto', alignment: 'center' },
                        { text: `Página ${visiblePage} de ${visibleTotal}`, fontSize: 8, color: VS_COLORS.neutral, width: '*', alignment: 'right' }
                    ]
                }
            ]
        };
    }

    // ====================================================================
    // HELPERS COMPARTIDOS (exportados para que los renderers los usen)
    // ====================================================================

    /** Titulo de seccion con linea inferior.
     *  Aplica casing automático: "N. Foo" → "N. FOO"; "N.N Foo" → "N.N Foo". */
    function sectionTitle(text, opts) {
        opts = opts || {};
        const formattedText = vsFormatTitleCasing(text);
        return [
            {
                text: formattedText,
                fontSize: opts.fontSize || 14,
                bold: true,
                color: VS_COLORS.primary,
                margin: [0, opts.marginTop || 0, 0, 4]
            },
            {
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: 455, y2: 0, lineWidth: 1.2, lineColor: VS_COLORS.primary }],
                margin: [0, 0, 0, 12]
            }
        ];
    }

    /** Codigo del documento: TIPO-CODIGO_PAQUETE */
    function getDocumentCode(data) {
        if (data.document && data.document.code) return data.document.code;
        const type = data.type || (data.document && data.document.type) || 'DOC';
        const pkgCode = data.package && data.package.code ? data.package.code : 'XXX-001';
        return `${type}-${pkgCode}`;
    }

    /** Layout estandar de tabla con bordes finos */
    function vsTableLayout() {
        return {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => VS_COLORS.border,
            vLineColor: () => VS_COLORS.border,
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4
        };
    }

    /** Layout denso: padding lateral chico (3px) para tablas con muchas columnas
     *  como las matrices FMEA del RA y la matriz de componentes del IRA.
     *  Reduce el padding extra que pdfMake suma fuera de los widths. */
    function vsTableLayoutDense() {
        return {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => VS_COLORS.border,
            vLineColor: () => VS_COLORS.border,
            paddingLeft: () => 3,
            paddingRight: () => 3,
            paddingTop: () => 4,
            paddingBottom: () => 4
        };
    }

    /** Layout para cajas con borde mas grueso */
    function vsBoxLayout() {
        return {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => VS_COLORS.border,
            vLineColor: () => VS_COLORS.border,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0
        };
    }

    function vsTh(text, opts) {
        return Object.assign({
            text: text,
            fontSize: 10,
            bold: true,
            color: VS_COLORS.white,
            fillColor: VS_COLORS.primary,
            margin: [6, 7, 6, 7],
            alignment: opts && opts.alignment ? opts.alignment : 'left',
            noWrap: false
        }, opts || {});
    }

    function vsTd(text, opts) {
        return Object.assign({
            text: text,
            fontSize: 10,
            color: VS_COLORS.text,
            margin: [6, 5, 6, 5],
            noWrap: false,
            lineHeight: 1.25
        }, opts || {});
    }

    function getStatusColor(status) {
        if (!status) return VS_COLORS.text;
        const s = status.toLowerCase();
        if (s.includes('aprob')) return VS_COLORS.statusApproved;
        if (s.includes('borrador') || s.includes('draft')) return VS_COLORS.statusDraft;
        if (s.includes('revisi')) return VS_COLORS.statusReview;
        return VS_COLORS.text;
    }

    // Parser de fechas en español: "ago-2026", "ago 2026", "agosto 2026",
    // "01-ago-2026", "01 ago 2026". Devuelve Date o null.
    const _MESES_ES = {
        ene:0,enero:0, feb:1,febrero:1, mar:2,marzo:2, abr:3,abril:3,
        may:4,mayo:4,  jun:5,junio:5,   jul:6,julio:6,  ago:7,agosto:7,
        sep:8,septiembre:8,oct:9,octubre:9,nov:10,noviembre:10,dic:11,diciembre:11
    };
    function _parseEsDate(s) {
        if (typeof s !== 'string') return null;
        const t = s.trim().toLowerCase();
        // "ago-2026" / "ago 2026" / "agosto 2026"
        let m = t.match(/^([a-záéíóúñ]+)[\s\-.](\d{4})$/);
        if (m && _MESES_ES[m[1]] !== undefined)
            return new Date(parseInt(m[2]), _MESES_ES[m[1]], 1);
        // "01-ago-2026" / "01 ago 2026" / "01/ago/2026"
        m = t.match(/^(\d{1,2})[\s\-./]([a-záéíóúñ]+)[\s\-./](\d{4})$/);
        if (m && _MESES_ES[m[2]] !== undefined)
            return new Date(parseInt(m[3]), _MESES_ES[m[2]], parseInt(m[1]));
        return null;
    }

    function formatDateLong(d) {
        if (!d) return '';
        if (typeof d === 'string') {
            const parsed = _parseEsDate(d);
            if (parsed) return parsed.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
            if (/^[A-Za-záéíóúñ]/.test(d)) return d;
        }
        try {
            const date = new Date(d);
            if (isNaN(date.getTime())) return String(d);
            return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
        } catch (e) { return String(d); }
    }

    function formatDateShort(d) {
        if (!d) return '';
        if (typeof d === 'string') {
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
            const parsed = _parseEsDate(d);
            if (parsed) return parsed.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            if (/^[A-Za-záéíóúñ]/.test(d)) return d;
        }
        try {
            const date = new Date(d);
            if (isNaN(date.getTime())) return String(d);
            return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch (e) { return String(d); }
    }

    function setLogoDataUrl(dataUrl) {
        global.VS_LOGO_DATAURL = dataUrl;
    }

    // ===== Exportar al global =====
    global.ValidationSuite = global.ValidationSuite || {};
    global.ValidationSuite.templateBase = {
        // Renderers principales
        buildCoverPage,
        buildControlAndApprovalsPage,
        buildPageHeader,
        buildPageFooter,
        buildBackground,
        // Helpers para renderers especificos
        sectionTitle,
        vsTableLayout,
        vsTableLayoutDense,
        vsBoxLayout,
        vsTh,
        vsTd,
        vsScaleWidths,
        vsFormatTitleCasing,
        vsToSentenceCase,
        getDocumentCode,
        getStatusColor,
        formatDateLong,
        formatDateShort,
        setLogoDataUrl,
        // Constantes
        VS_COLORS,
        PAGE_MARGINS,
        CONTENT_WIDTH
    };

})(window);
