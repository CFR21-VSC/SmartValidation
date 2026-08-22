/* ====================================================================
   VALIDATION SUITE — TOMO III (EVIDENCIAS RAW)
   Empaqueta como ZIP descargable el material crudo de los AEX:

     - evidencias/{AEX}/{TC}/{nn}_{filename}.{ext}  → archivos originales
     - MANIFEST.json                                → inventario + hashes
     - INDICE_IMAGENES.pdf                          → índice visual
     - README.txt                                   → guía del paquete

   Es el complemento digital del Libro de Validación (Tomo I + Tomo II).
   El Libro embebe las imágenes en formato reducido; el Tomo III conserva
   los originales full-resolution para auditoría regulatoria GxP.

   Uso:
     VS.tomoIII.generate(packageDocs, opts)
       → arma el ZIP y lo descarga.

   Requiere JSZip (cargado vía CDN en index.html).
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.tomoIII = VS.tomoIII || {};

    // ====================================================================
    // HELPERS
    // ====================================================================

    function parseDataUrl(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) return { mimeType: m[1], base64: m[2] };
        // SVG sin base64 (data:image/svg+xml,<svg...>)
        const m2 = dataUrl.match(/^data:(image\/svg\+xml)(?:;[^,]+)?,(.+)$/);
        if (m2) {
            const raw = decodeURIComponent(m2[2]);
            const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(raw))) : null;
            if (b64) return { mimeType: m2[1], base64: b64 };
        }
        return null;
    }

    function extensionFor(mimeType) {
        switch (String(mimeType || '').toLowerCase()) {
            case 'image/png': return 'png';
            case 'image/jpeg':
            case 'image/jpg': return 'jpg';
            case 'image/svg+xml': return 'svg';
            case 'image/gif': return 'gif';
            case 'image/webp': return 'webp';
            default: return 'bin';
        }
    }

    function base64ToBytes(b64) {
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        return bytes;
    }

    async function sha256Hex(bytes) {
        if (!global.crypto || !global.crypto.subtle) return null;
        try {
            const buf = await global.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            console.warn('[tomo-iii] crypto.subtle.digest falló:', e);
            return null;
        }
    }

    function safeName(s) {
        return String(s || '')
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_+|_+$/g, '')
            .substring(0, 80);
    }

    function fmtKB(bytes) {
        if (!bytes) return '—';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }

    // ====================================================================
    // GENERACIÓN PRINCIPAL
    // ====================================================================

    /**
     * Genera el ZIP del Tomo III.
     * @param {Array} packageDocs - paquete documental cargado (debe tener al menos un AEX)
     * @param {Object} [opts] - {
     *     fileName?: string,         // override del nombre del ZIP
     *     includeIndexPdf?: bool,    // default true
     *     generateHashes?: bool,     // default true (SHA-256 si crypto.subtle disponible)
     *     onProgress?: (msg) => void // callback de progreso
     *   }
     */
    async function generate(packageDocs, opts) {
        opts = opts || {};
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip no está cargado. Verificá que index.html incluya jszip.min.js.');
        }

        const aexDocs = (packageDocs || []).filter(d => d && d.type === 'AEX');
        if (aexDocs.length === 0) {
            throw new Error('No hay documentos AEX en el paquete. El Tomo III solo aplica a paquetes con anexos de ejecución.');
        }

        onProgress('Inicializando ZIP...');
        const zip = new JSZip();

        // Metadata del paquete
        const firstDoc = packageDocs[0];
        const pkg = (firstDoc && firstDoc.data && firstDoc.data.package) || {};
        const pkgCode = pkg.code || 'PKG';
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];

        // Manifest acumulador
        const manifest = {
            version: '1.0',
            generated: now.toISOString(),
            package: {
                code: pkgCode,
                systemName: pkg.systemName || '',
                systemVersion: pkg.systemVersion || '',
                client: pkg.client || ''
            },
            anexos: [],
            stats: {}
        };

        // Lista plana de evidencias (para el índice PDF)
        const allEvidencias = [];

        // ── Iterar AEX → tests → evidencias ──
        for (let aIdx = 0; aIdx < aexDocs.length; aIdx++) {
            const aex = aexDocs[aIdx];
            const aexCode = (aex.data && aex.data.document && aex.data.document.code) || aex.type;
            const aexCodeSafe = safeName(aexCode);

            onProgress(`Procesando anexo ${aIdx + 1}/${aexDocs.length}: ${aexCode}`);

            const aexEntry = {
                code: aexCode,
                title: (aex.data && aex.data.document && aex.data.document.titleEs) || '',
                tests: []
            };

            const reg = (aex.data && aex.data.secciones || []).find(s => s.tipo === 'aex-registro-tc');
            const tests = (reg && reg.tests) || [];

            for (const test of tests) {
                const tcId = test.tcId || 'TC-UNK';
                const tcIdSafe = safeName(tcId);
                const tcEntry = {
                    tcId,
                    titulo: test.titulo || '',
                    grupo: test.grupo || '',
                    estado: (test.resultado && test.resultado.estado) || '',
                    evidencias: []
                };

                const evs = Array.isArray(test.evidencias) ? test.evidencias : [];
                for (let evIdx = 0; evIdx < evs.length; evIdx++) {
                    const ev = evs[evIdx];
                    const parsed = parseDataUrl(ev.image);
                    if (!parsed) continue;

                    const ext = extensionFor(parsed.mimeType);
                    const orderPrefix = String(evIdx + 1).padStart(2, '0');
                    const baseName = ev.originalFileName
                        ? safeName(ev.originalFileName.replace(/\.[^.]+$/, ''))
                        : safeName(ev.descripcion || ('evidencia_' + (evIdx + 1)));
                    const fileName = `${orderPrefix}_${baseName}.${ext}`;
                    const zipPath = `evidencias/${aexCodeSafe}/${tcIdSafe}/${fileName}`;

                    // Decodificar para obtener bytes reales (necesario para hash + size verificable)
                    const bytes = base64ToBytes(parsed.base64);
                    let hash = ev.hash || ev.sha256 || null;
                    if (!hash && opts.generateHashes !== false) {
                        hash = await sha256Hex(bytes);
                    }

                    // Guardar en ZIP (base64 directo, JSZip lo decodifica al final)
                    zip.file(zipPath, parsed.base64, { base64: true });

                    const evRecord = {
                        order: evIdx + 1,
                        fileName,
                        zipPath,
                        mimeType: parsed.mimeType,
                        size: ev.size || bytes.length,
                        dimensions: ev.dimensions || null,
                        sha256: hash,
                        descripcion: ev.descripcion || '',
                        criterioRef: ev.criterioRef || '',
                        usuario: ev.usuarioPrueba || '',
                        rol: ev.rolPrueba || '',
                        ejecutor: ev.ejecutor || '',
                        timestamp: ev.captureTimestamp || ev.timestamp || '',
                        camera: ev.cameraModel
                            ? ((ev.cameraMake ? ev.cameraMake + ' ' : '') + ev.cameraModel)
                            : '',
                        dictamen: ev.dictamen || '',
                        observacion: ev.observacion || ''
                    };
                    tcEntry.evidencias.push(evRecord);

                    // Acumular para el índice (incluye imagen para thumbnail)
                    allEvidencias.push(Object.assign({}, evRecord, {
                        aexCode,
                        tcId,
                        tcTitulo: test.titulo || '',
                        grupo: test.grupo || '',
                        image: ev.image
                    }));
                }

                aexEntry.tests.push(tcEntry);
            }

            manifest.anexos.push(aexEntry);
        }

        // Stats finales
        manifest.stats = {
            totalAnexos: manifest.anexos.length,
            totalTests: manifest.anexos.reduce((s, a) => s + a.tests.length, 0),
            totalEvidencias: allEvidencias.length,
            totalSizeBytes: allEvidencias.reduce((s, e) => s + (e.size || 0), 0)
        };

        onProgress('Escribiendo manifest...');
        zip.file('MANIFEST.json', JSON.stringify(manifest, null, 2));

        onProgress('Escribiendo README...');
        zip.file('README.txt', buildReadme(manifest));

        // Índice PDF (opcional, default ON si hay pdfMake)
        if (opts.includeIndexPdf !== false && typeof pdfMake !== 'undefined' && allEvidencias.length > 0) {
            try {
                onProgress('Generando índice visual PDF...');
                const indexBlob = await buildIndicePdf(allEvidencias, manifest);
                zip.file('INDICE_IMAGENES.pdf', indexBlob);
            } catch (e) {
                console.warn('[tomo-iii] No se pudo generar INDICE_IMAGENES.pdf:', e);
            }
        }

        onProgress('Comprimiendo ZIP...');
        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        const fileName = opts.fileName || `TomoIII_${pkgCode}_${dateStr}.zip`;

        // Descargar
        if (typeof saveAs === 'function') {
            saveAs(blob, fileName);
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
        }

        // Audit log: registrar exportación del Tomo III (evidencias raw)
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('TOMO_III_EXPORT', 'package', 'tomo-iii', {
                totalAnexos: manifest.stats.totalAnexos,
                totalTests: manifest.stats.totalTests,
                totalEvidencias: manifest.stats.totalEvidencias,
                sizeBytes: manifest.stats.totalSizeBytes,
                fileName
            }, 'Tomo III digital');
        }

        onProgress('Descarga iniciada.');
        return { blob, manifest, fileName };
    }

    // ====================================================================
    // README.txt
    // ====================================================================
    function buildReadme(manifest) {
        const p = manifest.package;
        const s = manifest.stats;
        return [
            'TOMO III DIGITAL — EVIDENCIAS RAW',
            '=====================================',
            '',
            `Paquete : ${p.code}`,
            `Sistema : ${p.systemName}${p.systemVersion ? ' v' + p.systemVersion : ''}`,
            p.client ? `Cliente : ${p.client}` : '',
            `Generado: ${manifest.generated}`,
            '',
            'ESTADÍSTICAS',
            '------------',
            `· Anexos AEX        : ${s.totalAnexos}`,
            `· Tests documentados: ${s.totalTests}`,
            `· Evidencias raw    : ${s.totalEvidencias}`,
            `· Tamaño total      : ${fmtKB(s.totalSizeBytes)}`,
            '',
            'ESTRUCTURA DEL ZIP',
            '------------------',
            '  README.txt                         (este archivo)',
            '  MANIFEST.json                      (inventario completo, hashes SHA-256)',
            '  INDICE_IMAGENES.pdf                (índice visual paginado)',
            '  evidencias/',
            '    {AEX-CODE}/',
            '      {TC-ID}/',
            '        {nn}_{filename}.{png|jpg|svg}',
            '',
            'PROPÓSITO',
            '---------',
            'Este ZIP es el "Tomo III digital" del Libro de Validación. Conserva los',
            'archivos originales de evidencia capturados durante la ejecución (resolución',
            'completa, metadata EXIF y hashes verificables).',
            '',
            'Acompaña al Libro de Validación impreso/PDF:',
            '  · Tomo I  : ciclo de validación (HLRA → ... → VSR)',
            '  · Tomo II : anexos de ejecución AEX (con imágenes optimizadas)',
            '  · Tomo III: ESTE ZIP — evidencia raw conservada',
            '',
            'Para auditoría regulatoria GxP (FDA CSA, EU Annex 11, 21 CFR Part 11,',
            'ANMAT 4159) este Tomo III es la fuente autoritativa de la evidencia visual.',
            '',
            'VERIFICACIÓN DE INTEGRIDAD',
            '--------------------------',
            'Cada archivo bajo evidencias/ tiene su hash SHA-256 registrado en MANIFEST.json',
            '(campo `sha256`). Para verificar integridad post-extracción:',
            '',
            '  Linux/Mac : sha256sum evidencias/{AEX}/{TC}/{archivo}',
            '  Windows   : certutil -hashfile evidencias\\{AEX}\\{TC}\\{archivo} SHA256',
            '',
            'Comparar el output contra el campo `sha256` correspondiente en MANIFEST.json.',
            '',
            '— DRP Assurance Validation Suite —'
        ].filter(Boolean).join('\n');
    }

    // ====================================================================
    // INDICE_IMAGENES.pdf — usa pdfMake
    // ====================================================================
    function buildIndicePdf(evidencias, manifest) {
        const tb = VS.templateBase;
        const C = (tb && tb.VS_COLORS) || {
            primary: '#0E5285', text: '#1F2C3A', textSoft: '#586574',
            border: '#C8D2DC', bgSoft: '#F4F6F8'
        };

        const content = [];

        // ── Portada ──
        content.push({ text: '', margin: [0, 80, 0, 0] });
        content.push({
            text: 'TOMO III',
            fontSize: 36, bold: true, color: C.primary, alignment: 'center',
            characterSpacing: 8, margin: [0, 0, 0, 6]
        });
        content.push({
            text: 'ÍNDICE DE EVIDENCIAS RAW',
            fontSize: 14, bold: true, color: C.primary, alignment: 'center',
            characterSpacing: 4, margin: [0, 0, 0, 30]
        });
        content.push({
            canvas: [{ type: 'line', x1: 100, y1: 0, x2: 355, y2: 0, lineWidth: 0.7, lineColor: C.primary }],
            margin: [0, 0, 0, 24]
        });
        content.push({
            text: manifest.package.systemName || 'Sistema sin identificar',
            fontSize: 16, bold: true, color: C.text, alignment: 'center', margin: [0, 0, 0, 4]
        });
        content.push({
            text: manifest.package.code,
            fontSize: 11, italics: true, color: C.textSoft, alignment: 'center', margin: [0, 0, 0, 30]
        });

        // Stats cards
        const stats = manifest.stats;
        const statCard = (label, value, color) => ({
            stack: [
                { text: label, fontSize: 8, color: C.textSoft, alignment: 'center', characterSpacing: 1, margin: [0, 4, 0, 2] },
                { text: String(value), fontSize: 18, bold: true, color: color || C.primary, alignment: 'center', margin: [0, 0, 0, 4] }
            ],
            fillColor: C.bgSoft
        });
        content.push({
            table: {
                widths: ['*', '*', '*', '*'],
                body: [[
                    statCard('ANEXOS', stats.totalAnexos),
                    statCard('TESTS', stats.totalTests),
                    statCard('EVIDENCIAS', stats.totalEvidencias),
                    statCard('TAMAÑO', fmtKB(stats.totalSizeBytes))
                ]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [40, 0, 40, 20]
        });
        content.push({
            text: 'Generado: ' + new Date(manifest.generated).toLocaleString('es-AR'),
            fontSize: 9, italics: true, color: C.textSoft, alignment: 'center'
        });
        content.push({
            text: 'Cada entrada del índice referencia un archivo en evidencias/{AEX}/{TC}/. El hash SHA-256 permite verificar integridad criptográfica.',
            fontSize: 9, italics: true, color: C.textSoft, alignment: 'center',
            margin: [60, 8, 60, 0]
        });
        content.push({ text: '', pageBreak: 'after' });

        // ── Detalle por AEX → TC → evidencia ──
        // Agrupar por aexCode → tcId
        const porAex = {};
        evidencias.forEach(e => {
            if (!porAex[e.aexCode]) porAex[e.aexCode] = {};
            if (!porAex[e.aexCode][e.tcId]) {
                porAex[e.aexCode][e.tcId] = { titulo: e.tcTitulo, grupo: e.grupo, evidencias: [] };
            }
            porAex[e.aexCode][e.tcId].evidencias.push(e);
        });

        Object.keys(porAex).forEach((aexCode, aIdx) => {
            // Header del AEX
            content.push({
                text: aexCode,
                fontSize: 16, bold: true, color: C.primary,
                margin: [0, aIdx === 0 ? 0 : 14, 0, 8],
                pageBreak: aIdx === 0 ? undefined : 'before'
            });
            content.push({
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: 455, y2: 0, lineWidth: 1, lineColor: C.primary }],
                margin: [0, 0, 0, 10]
            });

            Object.keys(porAex[aexCode]).forEach((tcId, tIdx) => {
                const tc = porAex[aexCode][tcId];
                // Header del TC
                content.push({
                    unbreakable: true,
                    stack: [{
                        text: [
                            { text: tcId + '  ', bold: true, color: C.primary, fontSize: 11 },
                            { text: tc.titulo, color: C.text, fontSize: 10 },
                            tc.grupo ? { text: '  · ' + tc.grupo, italics: true, color: C.textSoft, fontSize: 9 } : ''
                        ],
                        fillColor: C.bgSoft, margin: [10, 5, 10, 5]
                    }],
                    margin: [0, tIdx === 0 ? 0 : 6, 0, 6]
                });

                // Filas: una por evidencia (thumbnail + metadata)
                tc.evidencias.forEach(ev => {
                    content.push(buildEvidenciaRow(ev, C));
                });
            });
        });

        // ── Generar el PDF a Blob ──
        return new Promise((resolve, reject) => {
            try {
                const docDef = {
                    pageSize: 'A4',
                    pageOrientation: 'portrait',
                    pageMargins: [70, 50, 70, 50],
                    content: content,
                    footer: function (currentPage, pageCount) {
                        return {
                            columns: [
                                { width: '*', text: `Tomo III · ${manifest.package.code}`, fontSize: 8, italics: true, color: '#AFBDC8', alignment: 'left', margin: [70, 14, 0, 0] },
                                { width: '*', text: `Página ${currentPage} de ${pageCount}`, fontSize: 9, bold: true, color: '#586574', alignment: 'right', margin: [0, 14, 70, 0] }
                            ]
                        };
                    },
                    info: {
                        title: `Tomo III — Índice de Evidencias — ${manifest.package.code}`,
                        author: 'DRP Assurance Validation Suite',
                        subject: `Evidencias raw del paquete ${manifest.package.code}`,
                        creator: 'DRP Assurance Validation Suite'
                    },
                    defaultStyle: { fontSize: 10, color: C.text, lineHeight: 1.3 }
                };
                pdfMake.createPdf(docDef).getBlob(blob => resolve(blob));
            } catch (e) { reject(e); }
        });
    }

    /** Fila visual: thumbnail (60×60) + metadata a la derecha. */
    function buildEvidenciaRow(ev, C) {
        // Determinar el thumbnail según el tipo de imagen
        let thumbCell;
        if (ev.image && ev.image.startsWith('data:image/svg+xml')) {
            const svgRaw = decodeSvgInline(ev.image);
            thumbCell = svgRaw
                ? { svg: svgRaw, fit: [70, 50], alignment: 'center' }
                : { text: '[SVG]', fontSize: 7, italics: true, color: C.textSoft, alignment: 'center' };
        } else if (ev.image && ev.image.startsWith('data:image/')) {
            thumbCell = { image: ev.image, fit: [70, 50], alignment: 'center' };
        } else {
            thumbCell = { text: '[—]', fontSize: 7, italics: true, color: C.textSoft, alignment: 'center' };
        }

        // Metadata compacta a la derecha
        const dim = ev.dimensions ? `${ev.dimensions.width}×${ev.dimensions.height}px` : '—';
        const hashShort = ev.sha256 ? ev.sha256.substring(0, 16) + '…' : '—';
        const metaStack = [
            {
                text: [
                    { text: ev.fileName, bold: true, fontSize: 9, color: C.primary },
                    { text: '   ' + fmtKB(ev.size) + '  ·  ' + dim, fontSize: 8, color: C.textSoft }
                ],
                margin: [0, 0, 0, 2]
            },
            {
                text: ev.descripcion || '—',
                fontSize: 9, color: C.text, italics: true, margin: [0, 0, 0, 3]
            },
            {
                columns: [
                    { width: 'auto', text: 'Ref: ', fontSize: 7.5, bold: true, color: C.textSoft },
                    { width: 'auto', text: ev.criterioRef || '—', fontSize: 7.5, color: C.text, margin: [2, 0, 8, 0] },
                    { width: 'auto', text: 'Ejecutor: ', fontSize: 7.5, bold: true, color: C.textSoft },
                    { width: 'auto', text: ev.ejecutor || ev.usuario || '—', fontSize: 7.5, color: C.text, margin: [2, 0, 8, 0] },
                    { width: 'auto', text: 'Fecha: ', fontSize: 7.5, bold: true, color: C.textSoft },
                    { width: '*', text: (ev.timestamp || '—').toString().substring(0, 19), fontSize: 7.5, color: C.text, margin: [2, 0, 0, 0] }
                ],
                margin: [0, 0, 0, 2]
            },
            {
                // Nota: pdfMake default solo trae Roboto; para look monoespaciado
                // del hash usamos bold + characterSpacing (no fonts custom).
                text: [
                    { text: 'SHA-256: ', fontSize: 7, bold: true, color: C.textSoft },
                    { text: hashShort, fontSize: 7, color: C.text, bold: true, characterSpacing: 0.3 }
                ]
            }
        ];

        return {
            unbreakable: true,
            table: {
                widths: [80, '*'],
                body: [[
                    { stack: [thumbCell], margin: [4, 4, 4, 4], fillColor: '#FAFBFC' },
                    { stack: metaStack, margin: [6, 4, 6, 4] }
                ]]
            },
            layout: {
                hLineWidth: () => 0.4, vLineWidth: () => 0.4,
                hLineColor: () => C.border, vLineColor: () => C.border
            },
            margin: [0, 0, 0, 3]
        };
    }

    function decodeSvgInline(dataUrl) {
        if (!dataUrl) return null;
        if (dataUrl.startsWith('data:image/svg+xml;base64,')) {
            try { return atob(dataUrl.substring('data:image/svg+xml;base64,'.length)); } catch (e) { return null; }
        }
        if (dataUrl.startsWith('data:image/svg+xml')) {
            const idx = dataUrl.indexOf(',');
            try { return decodeURIComponent(dataUrl.substring(idx + 1)); } catch (e) { return dataUrl.substring(idx + 1); }
        }
        return null;
    }

    // ====================================================================
    // STATS — para mostrar al usuario antes de generar
    // ====================================================================
    function stats(packageDocs) {
        const aexDocs = (packageDocs || []).filter(d => d && d.type === 'AEX');
        let tests = 0, evidencias = 0, totalSize = 0;
        aexDocs.forEach(aex => {
            const reg = (aex.data && aex.data.secciones || []).find(s => s.tipo === 'aex-registro-tc');
            const tcs = (reg && reg.tests) || [];
            tests += tcs.length;
            tcs.forEach(t => {
                (t.evidencias || []).forEach(ev => {
                    evidencias++;
                    totalSize += (ev.size || 0);
                });
            });
        });
        return { aexCount: aexDocs.length, testCount: tests, evidenciaCount: evidencias, sizeBytes: totalSize };
    }

    VS.tomoIII.generate = generate;
    VS.tomoIII.stats = stats;

})(window);
