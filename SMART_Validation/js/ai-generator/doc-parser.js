'use strict';

/* ====================================================================
   AI GENERATOR — DOC PARSER
   Extrae texto plano de archivos PDF, DOCX y XLSX para usar como
   fuente en la generación de documentos GxP. Sin OCR.

   Dependencias en window (CDN):
     - pdfjsLib  → PDF.js  (sólo para PDF)
     - mammoth   → mammoth.js  (sólo para DOCX)
     - XLSX      → SheetJS  (sólo para XLSX — ya cargado en index.html)
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.AIGenerator = VS.AIGenerator || {};

    const SUPPORTED = ['pdf', 'docx', 'xlsx'];
    const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

    const DocParser = {
        SUPPORTED_EXTENSIONS: SUPPORTED,
        MAX_BYTES,

        // ── Library accessors (inyectables en tests) ─────────────────
        _getPdfjs()   { return typeof global.pdfjsLib !== 'undefined' ? global.pdfjsLib : null; },
        _getMammoth() { return typeof global.mammoth   !== 'undefined' ? global.mammoth   : null; },
        _getXLSX()    { return typeof global.XLSX      !== 'undefined' ? global.XLSX      : null; },

        // ── Public API ────────────────────────────────────────────────

        isSupported(file) {
            if (!file || !file.name) return false;
            return SUPPORTED.includes(_ext(file.name));
        },

        /**
         * Extrae texto de un File y lo devuelve como string.
         * @param {File} file
         * @returns {Promise<string>}
         */
        async parse(file) {
            if (!file) throw new Error('Archivo requerido');
            if (file.size > MAX_BYTES) {
                throw new Error(`Archivo demasiado grande (${_mb(file.size)} MB). Máximo: 50 MB.`);
            }
            const ext = _ext(file.name);
            switch (ext) {
                case 'pdf':  return await this._parsePdf(file);
                case 'docx': return await this._parseDocx(file);
                case 'xlsx': return await this._parseXlsx(file);
                default:
                    throw new Error(
                        `Formato no soportado: .${ext}. Usá PDF, DOCX o XLSX (sin OCR).`
                    );
            }
        },

        // ── Parsers internos ──────────────────────────────────────────

        async _parsePdf(file) {
            const lib = this._getPdfjs();
            if (!lib) throw new Error('PDF.js no está cargado (pdfjsLib)');
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await lib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
            const pages = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                pages.push(content.items.map(item => item.str).join(' '));
            }
            const text = pages.join('\n').replace(/[ \t]{3,}/g, '  ').trim();
            if (!text) throw new Error('El PDF no contiene texto extraíble (posiblemente escaneado).');
            return text;
        },

        async _parseDocx(file) {
            const lib = this._getMammoth();
            if (!lib) throw new Error('mammoth.js no está cargado (mammoth)');
            const arrayBuffer = await file.arrayBuffer();
            const result = await lib.extractRawText({ arrayBuffer });
            const text = (result.value || '').trim();
            if (!text) throw new Error('El DOCX no contiene texto extraíble.');
            return text;
        },

        async _parseXlsx(file) {
            const lib = this._getXLSX();
            if (!lib) throw new Error('SheetJS no está cargado (XLSX)');
            const arrayBuffer = await file.arrayBuffer();
            const workbook = lib.read(new Uint8Array(arrayBuffer), { type: 'array' });
            const parts = [];
            workbook.SheetNames.forEach(name => {
                const csv = lib.utils.sheet_to_csv(workbook.Sheets[name]);
                const cleaned = csv.split('\n')
                    .filter(row => row.replace(/,/g, '').trim() !== '')
                    .join('\n');
                if (cleaned) parts.push(`[${name}]\n${cleaned}`);
            });
            const text = parts.join('\n\n').trim();
            if (!text) throw new Error('El XLSX no contiene datos.');
            return text;
        }
    };

    // ── Helpers privados ──────────────────────────────────────────────

    function _ext(filename) {
        const parts = filename.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }

    function _mb(bytes) {
        return (bytes / (1024 * 1024)).toFixed(1);
    }

    VS.AIGenerator.DocParser = DocParser;

})(typeof window !== 'undefined' ? window : global);
