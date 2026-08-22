/* ====================================================================
   VALIDATION SUITE — DOCUMENT RENDERER
   Orchestrator que toma un JSON de documento de validacion y produce
   el PDF final (portada + control/aprobaciones + contenido especifico).

   Uso:
       ValidationSuite.renderDocument(jsonData);
       ValidationSuite.renderDocument(jsonData, { download: true, fileName: 'HLRA.pdf' });

   Cada renderer especifico (HLRA, VP, URS, FRS, DS...) se registra en
   ValidationSuite.renderers[<TYPE>] y devuelve el array de elementos
   pdfMake del contenido especifico.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.renderers = VS.renderers || {};

    function registerRenderer(type, fn) {
        VS.renderers[type] = fn;
    }

    /**
     * Recorre recursivamente el árbol de contenido pdfMake y:
     * 1. Reemplaza celdas undefined con {} vacío (pdfMake crashea al intentar
     *    asignar _minWidth a undefined).
     * 2. Rellena filas más cortas que widths.length con {} para evitar acceso a
     *    posiciones undefined.
     * 3. Desactiva dontBreakRows en tablas que están dentro de un bloque
     *    {unbreakable: true, stack: [...]} — esas tablas ya no pueden romper
     *    página (el unbreakable las controla) y dontBreakRows: true desencadena
     *    un bug interno de pdfMake en ese contexto.
     * 4. Desactiva dontBreakRows en cualquier tabla que tenga celdas con colSpan
     *    (el otro bug conocido de pdfMake con dontBreakRows + colSpan).
     *
     * @param {Array} nodes - Nodos del árbol de contenido
     * @param {boolean} insideUnbreakable - true si ya estamos dentro de un stack unbreakable
     */
    function sanitizeContentTree(nodes, insideUnbreakable) {
        if (!Array.isArray(nodes)) return;
        nodes.forEach(function (node) {
            if (!node || typeof node !== 'object') return;
            if (node.table && node.table.body) {
                var widthsLen = Array.isArray(node.table.widths) ? node.table.widths.length : 0;
                var hasColSpan = false;
                // Bug crítico de pdfMake: usa body[0].length como límite del loop de
                // medición de columnas y accede a widths[i] para cada i < body[0].length.
                // Si widths[i] es undefined → "Cannot set properties of undefined (setting '_minWidth')".
                // Fix: extender widths con '*' hasta igualar body[0].length.
                if (widthsLen > 0 && node.table.body.length > 0 && Array.isArray(node.table.body[0])) {
                    while (node.table.widths.length < node.table.body[0].length) {
                        node.table.widths.push('*');
                    }
                    widthsLen = node.table.widths.length;
                }
                node.table.body = node.table.body.map(function (row) {
                    if (!Array.isArray(row)) return row;
                    // Pad si la fila es más corta que widths
                    while (widthsLen > 0 && row.length < widthsLen) row.push({});
                    return row.map(function (cell) {
                        if (cell === undefined || cell === null) return {};
                        if (cell && cell.colSpan && cell.colSpan > 1) hasColSpan = true;
                        return cell;
                    });
                });
                // dontBreakRows: true dentro de un bloque unbreakable o con colSpan
                // desencadena bugs internos de pdfMake → forzar false
                if (node.table.dontBreakRows && (insideUnbreakable || hasColSpan)) {
                    node.table.dontBreakRows = false;
                }
                node.table.body.forEach(function (row) {
                    if (Array.isArray(row)) sanitizeContentTree(row, insideUnbreakable);
                });
            }
            if (Array.isArray(node.stack)) {
                // Propagar insideUnbreakable=true si este nodo es unbreakable
                sanitizeContentTree(node.stack, insideUnbreakable || node.unbreakable === true);
            }
            if (Array.isArray(node.columns)) sanitizeContentTree(node.columns, insideUnbreakable);
            if (Array.isArray(node.ul)) sanitizeContentTree(node.ul, insideUnbreakable);
            if (Array.isArray(node.ol)) sanitizeContentTree(node.ol, insideUnbreakable);
        });
    }

    /**
     * Renderiza un documento completo a partir de su JSON.
     * @param {Object} data - JSON del documento (con type, package, document, etc.)
     * @param {Object} [options]
     * @param {boolean} [options.download=true] - Si descargar el PDF generado
     * @param {string} [options.fileName] - Nombre del archivo de salida
     * @param {boolean} [options.openInNewTab=false] - Abrir en nueva pestaña en vez de descargar
     * @returns {Promise<Blob>} Blob del PDF generado
     */
    async function renderDocument(data, options) {
        options = options || {};
        if (!data || !data.type) {
            throw new Error('JSON invalido: falta el campo "type"');
        }

        const renderer = VS.renderers[data.type];
        if (!renderer) {
            throw new Error(`No hay renderer registrado para el tipo "${data.type}". Tipos disponibles: ${Object.keys(VS.renderers).join(', ') || '(ninguno)'}`);
        }

        const tb = VS.templateBase;
        if (!tb) {
            throw new Error('templateBase no esta cargado. Verifica el orden de scripts.');
        }

        // Auto-cargar logo si no esta seteado todavia
        if (!global.VS_LOGO_DATAURL) {
            await tryAutoLoadLogo();
        }

        // 1. Portada
        const cover = tb.buildCoverPage(data);
        // 2. Control de cambios + Matriz de aprobaciones
        const controlAndAppr = tb.buildControlAndApprovalsPage(data);
        // 3. TRAZABILIDAD DOCUMENTAL (auto-inyectada si data.trazabilidad.schemaVersion === '2.0')
        //    Aplica universalmente a todos los doc types — auditor ve la cadena de
        //    referencias antes de leer la sección 1. Si trazabilidad es v1 (strings)
        //    o ausente, el helper devuelve [] y no se inserta nada.
        const trazabilidadBlock = (VS.shared && VS.shared.renderTrazabilidadDetallada)
            ? VS.shared.renderTrazabilidadDetallada(data, tb)
            : [];
        // 4. Contenido específico del tipo de documento
        const specific = renderer(data) || [];

        const content = [...cover, ...controlAndAppr, ...trazabilidadBlock, ...specific];

        // Obtener estado workflow del doc para watermark
        // 'none' = sin watermark cuando no hay proyecto ni estado explícito
        let wfState = 'none';
        try {
            if (typeof DocWorkflow !== 'undefined' && VS.projects && VS.projects.getActiveId) {
                const pid = VS.projects.getActiveId();
                const did = (data.document && data.document.code) || data.type;
                if (pid && did) {
                    const st = DocWorkflow.getState(did, pid).estado;
                    if (st) wfState = st;
                }
            }
        } catch (_) {}

        // Fallback: leer estado del propio JSON del documento
        if (wfState === 'none') {
            const rawEstado = (data.document && (data.document.estado || data.document.status)) ||
                              data.estado ||
                              (data.metadata && data.metadata.estado);
            if (rawEstado) {
                const s = String(rawEstado).toLowerCase().replace(/[\s-]/g, '_');
                if (s === 'aprobado' || s === 'approved' || s === 'locked') wfState = 'approved';
                else if (s === 'en_revision' || s === 'in_review' || s === 'revision') wfState = 'in_review';
                else if (s === 'borrador' || s === 'draft') wfState = 'draft';
            }
        }

        // Definir el documento pdfMake
        const docDefinition = {
            pageSize: 'A4',
            pageOrientation: 'portrait',
            pageMargins: tb.PAGE_MARGINS,
            content: content,
            background: tb.buildBackground(data),
            header: function (currentPage, pageCount) {
                return tb.buildPageHeader(data, currentPage, pageCount);
            },
            footer: function (currentPage, pageCount) {
                return tb.buildPageFooter(data, currentPage, pageCount);
            },
            defaultStyle: {
                fontSize: 10,
                color: tb.VS_COLORS.text,
                lineHeight: 1.3
            }
        };

        // Watermark según estado workflow
        // 'none' y 'draft' = sin watermark (borrador es el estado normal de trabajo)
        if (wfState === 'in_review') {
            docDefinition.watermark = {
                text: 'EN REVISIÓN',
                color: '#999999', opacity: 0.10, bold: true, angle: -45, fontSize: 60
            };
        } else if (wfState === 'approved' || wfState === 'locked') {
            docDefinition.watermark = {
                text: 'APROBADO',
                color: '#27AE60', opacity: 0.10, bold: true, angle: -45, fontSize: 60
            };
        }

        // Nombre del archivo
        const fileName = options.fileName || `${tb.getDocumentCode(data).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

        // Sanitizar todo el árbol de contenido: pdfMake crashea con undefined en celdas de tabla
        sanitizeContentTree(docDefinition.content);

        // Generar
        return new Promise((resolve, reject) => {
            try {
                if (typeof pdfMake === 'undefined') {
                    reject(new Error('pdfMake no esta cargado'));
                    return;
                }
                const pdfDoc = pdfMake.createPdf(docDefinition);
                if (options.openInNewTab) {
                    pdfDoc.open();
                    resolve(null);
                } else if (options.download !== false) {
                    // Generar UNA sola vez con getBlob y descargar desde el blob.
                    // Llamar download() y getBlob() por separado hace que pdfMake
                    // genere el PDF DOS veces — la segunda corre sobre nodos ya
                    // mutados por la primera y puede crashear.
                    pdfDoc.getBlob(function (blob) {
                        var url = URL.createObjectURL(blob);
                        var a = document.createElement('a');
                        a.href = url;
                        a.download = fileName;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(function () {
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        }, 10000);
                        resolve(blob);
                    });
                } else {
                    pdfDoc.getBlob(blob => resolve(blob));
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Valida que un JSON tenga los campos minimos requeridos.
     * Devuelve { ok: true } o { ok: false, errors: [...] }
     */
    function validateDocumentJson(data) {
        const errors = [];
        if (!data) { errors.push('JSON vacio'); return { ok: false, errors }; }
        if (!data.type) errors.push('Falta campo "type"');
        if (!data.package) errors.push('Falta campo "package"');
        else {
            if (!data.package.code) errors.push('Falta package.code');
            if (!data.package.systemName) errors.push('Falta package.systemName');
            if (!data.package.client) errors.push('Falta package.client');
        }
        if (!data.document) errors.push('Falta campo "document"');
        else {
            if (!data.document.titleEs && !data.titleEs) errors.push('Falta document.titleEs');
            if (!data.document.version) errors.push('Falta document.version');
        }
        if (!Array.isArray(data.matrizAprobaciones)) {
            errors.push('matrizAprobaciones debe ser un array (puede estar vacio)');
        }
        if (!Array.isArray(data.controlCambios)) {
            errors.push('controlCambios debe ser un array (puede estar vacio)');
        }
        return errors.length === 0 ? { ok: true } : { ok: false, errors };
    }

    /**
     * Intenta cargar automaticamente el logo desde js/validation-suite/assets/logo-drp.png
     * Si falla (404), no hace nada y la portada queda sin logo.
     */
    async function tryAutoLoadLogo() {
        // Prioridad 1: logo del cliente configurado en ConfigStore
        if (typeof ConfigStore !== 'undefined') {
            const cfg = ConfigStore.load();
            if (cfg.organizacion && cfg.organizacion.logo) {
                VS.templateBase.setLogoDataUrl(cfg.organizacion.logo);
                return;
            }
        }
        // Prioridad 2: logo-drp.png como fallback
        try {
            const resp = await fetch('js/validation-suite/assets/logo-drp.png');
            if (!resp.ok) return;
            const blob = await resp.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            VS.templateBase.setLogoDataUrl(dataUrl);
        } catch (e) {
            // Sin logo, sigue sin error
        }
    }

    // Export al global
    VS.renderDocument = renderDocument;
    VS.registerRenderer = registerRenderer;
    VS.validateDocumentJson = validateDocumentJson;
    VS.tryAutoLoadLogo = tryAutoLoadLogo;

})(window);
