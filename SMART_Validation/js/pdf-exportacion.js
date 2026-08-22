/**FINALIZACIÓN
 * 04_PDF_EXPORTACION.JS
 * Exportación PDF para evidencia individual
 * Orientación: LANDSCAPE
 */

const PDF_CONFIG = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [40, 40, 40, 60],
    defaultStyle: {
        fontSize: 9,
        color: '#2C3E50',
        lineHeight: 1.2
    }
};

const COLORS = {
    primary: '#213B50',
    secondary: '#405A75',
    accent: '#C2E03B',
    neutral: '#AFBDC8',
    background: '#EEF3F4',
    white: '#FFFFFF',
    text: '#2C3E50',
    pass: '#27AE60',
    fail: '#E74C3C',
    passObs: '#F39C12',
    notApplicable: '#95A5A6'
};

function showWatermarkPicker() {
    return new Promise(resolve => {
        const existing = document.getElementById('wm-picker-overlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'wm-picker-overlay';
        overlay.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;');
        overlay.innerHTML = `
            <div style="background:#1e2d3e;border:1px solid #3a5068;border-radius:10px;padding:24px 28px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
                <div style="font-size:13px;font-weight:700;color:#7ab3d4;margin-bottom:16px;text-align:center;text-transform:uppercase;letter-spacing:.5px;">Marca de agua</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <button data-val="none" style="padding:10px;font-size:12px;font-weight:700;background:#213b50;color:#e0e8f4;border:1px solid #3a5068;border-radius:6px;cursor:pointer;">Sin marca</button>
                    <button data-val="borrador" style="padding:10px;font-size:12px;font-weight:700;background:#4a1a1a;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;cursor:pointer;">BORRADOR</button>
                    <button data-val="confidencial" style="padding:10px;font-size:12px;font-weight:700;background:#1a2a4a;color:#2980B9;border:1px solid #2980B9;border-radius:6px;cursor:pointer;">CONFIDENCIAL</button>
                    <button data-val="aprobado" style="padding:10px;font-size:12px;font-weight:700;background:#1a4a2a;color:#27AE60;border:1px solid #27AE60;border-radius:6px;cursor:pointer;">APROBADO</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const WATERMARKS = {
            none: null,
            borrador:     { text: 'BORRADOR',     color: '#E74C3C', opacity: 0.10, bold: true, angle: -45, fontSize: 70 },
            confidencial: { text: 'CONFIDENCIAL', color: '#2980B9', opacity: 0.10, bold: true, angle: -45, fontSize: 55 },
            aprobado:     { text: 'APROBADO',     color: '#27AE60', opacity: 0.10, bold: true, angle: -45, fontSize: 65 }
        };
        overlay.querySelectorAll('button[data-val]').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.remove();
                resolve(WATERMARKS[btn.dataset.val]);
            });
        });
    });
}

async function loadSessionForPDF() {
    const jsonData = localStorage.getItem('vscTestsData_v3');
    if (!jsonData) return null;

    const parsed = JSON.parse(jsonData);

    for (const test of parsed.tests) {
        for (const evidence of test.evidences) {
            if (evidence.hasImage) {
                const imageId = `${test.id}_evidence_${evidence.step}`;
                evidence.image = await getImageFromDB(imageId);
                delete evidence.hasImage;
            }
        }
    }

    return {
        version: parsed.version,
        systemInfo: parsed.systemInfo,
        executor: parsed.executor,
        protocols: parsed.protocols,
        groups: parsed.groups,
        tests: parsed.tests,
        projectData: parsed.projectData,
        lastSaved: parsed.lastSaved
    };
}

async function getImageFromDB(imageId) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('GestorEvidenciasDB', 2);

        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const getRequest = store.get(imageId);

            getRequest.onsuccess = () => {
                const result = getRequest.result;
                resolve(result ? result.data : null);
            };
            getRequest.onerror = () => reject(getRequest.error);
        };

        request.onerror = () => reject(request.error);
    });
}

function buildEvidencePage_Image(evidence, contextInfo, pageNumber, totalPages, customStepId = null) {
    // DETECTAR SI ES TABLA
    if (evidence.type === 'table') {
        return buildTablePage_Visual(evidence, contextInfo, customStepId);
    }

    // CÓDIGO ORIGINAL PARA IMÁGENES
    const _pn = (contextInfo.projectName || 'Sin nombre').substring(0, 25);
    const _pr = (contextInfo.protocol || '').substring(0, 25);
    const _sc = (contextInfo.section || '').substring(0, 20);
    const _tc = (contextInfo.testCode || '').substring(0, 35);
    const breadcrumb = `${_pn} | ${_pr} | ${_sc} | ${_tc} | Paso #${String(evidence.step).padStart(3, '0')}`;
    const titulo = `${contextInfo.testCode} - Paso #${String(evidence.step).padStart(3, '0')}`;
    const stepId = customStepId || `evidence_${evidence.step}`;;

    const content = [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            id: stepId
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            text: titulo,
                            fontSize: 11,
                            bold: true,
                            color: COLORS.white,
                            fillColor: COLORS.secondary,
                            margin: [10, 10, 10, 10],
                            border: [false, false, false, false]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 0; },
                vLineWidth: function () { return 0; }
            },
            margin: [0, 0, 0, 0]
        }
    ];

    if (evidence.image) {
        content.push({
            table: {
                widths: ['*'],
                heights: [380],
                body: [
                    [
                        {
                            image: evidence.image,
                            fit: [660, 360],
                            alignment: 'center',
                            fillColor: COLORS.background,
                            margin: [5, 5, 5, 5]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 2; },
                vLineWidth: function () { return 2; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            }
        });
    } else {
        content.push({
            table: {
                widths: ['*'],
                heights: [380],
                body: [
                    [
                        {
                            text: 'Imagen no disponible',
                            fontSize: 10,
                            color: COLORS.neutral,
                            italics: true,
                            alignment: 'center',
                            fillColor: COLORS.background,
                            margin: [10, 200, 10, 200]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 2; },
                vLineWidth: function () { return 2; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            }
        });
    }

    return content;
}

function buildEvidencePage_Metadata(evidence, contextInfo, pageNumber, totalPages) {
    if (evidence.type === 'table') {
        return buildTablePage_Metadata(evidence, contextInfo);
    }

    const _pn = (contextInfo.projectName || 'Sin nombre').substring(0, 25);
    const _pr = (contextInfo.protocol || '').substring(0, 25);
    const _sc = (contextInfo.section || '').substring(0, 20);
    const _tc = (contextInfo.testCode || '').substring(0, 35);
    const breadcrumb = `${_pn} | ${_pr} | ${_sc} | ${_tc} | Paso #${String(evidence.step).padStart(3, '0')}`;
    const titulo = `${contextInfo.testCode} - Paso #${String(evidence.step).padStart(3, '0')}`;

    const tableData = [
        [
            { text: 'CAMPO', style: 'tableHeader', fillColor: COLORS.primary, color: COLORS.white, margin: [6, 8, 6, 8], fontSize: 9 },
            { text: 'VALOR', style: 'tableHeader', fillColor: COLORS.primary, color: COLORS.white, margin: [6, 8, 6, 8], fontSize: 9 }
        ]
    ];

    const resultadoColor = {
        'PASA': COLORS.pass,
        'NO PASA': COLORS.fail,
        'PASA CON OBSERVACIONES': COLORS.passObs,
        'NO APLICA': COLORS.notApplicable
    };

    tableData.push([
        { text: 'Resultado', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
        {
            text: evidence.resultado || 'PASA',
            color: resultadoColor[evidence.resultado] || COLORS.text,
            bold: true,
            margin: [6, 6, 6, 6], fontSize: 9
        }
    ]);

    if (evidence.description) {
        tableData.push([
            { text: 'Descripcion', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: (evidence.description || '').substring(0, 500), margin: [6, 6, 6, 6], fontSize: 9 }
        ]);
    }

    if (evidence.operacion) {
        tableData.push([
            { text: 'Operacion', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: (evidence.operacion || '').substring(0, 200), margin: [6, 6, 6, 6], fontSize: 9 }
        ]);
    }

    // Datos de prueba (opcionales) — solo se renderizan si tienen valor
    if (evidence.usuarioPrueba || evidence.rolPrueba) {
        const partes = [];
        if (evidence.usuarioPrueba) partes.push(evidence.usuarioPrueba);
        if (evidence.rolPrueba) partes.push(`(${evidence.rolPrueba})`);
        tableData.push([
            { text: 'Usuario / Rol', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: partes.join(' '), margin: [6, 6, 6, 6], fontSize: 9 }
        ]);
    }

    if (evidence.testCaseRef || evidence.criterioRef) {
        const partes = [];
        if (evidence.testCaseRef) partes.push({ text: evidence.testCaseRef, bold: true });
        if (evidence.testCaseRef && evidence.criterioRef) partes.push({ text: ' · ' });
        if (evidence.criterioRef) partes.push({ text: 'Criterio ' + evidence.criterioRef, italics: true });
        tableData.push([
            { text: 'Test Case', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: partes, margin: [6, 6, 6, 6], fontSize: 9, color: COLORS.azul || '#1F3C56' }
        ]);
    }

    tableData.push([
        { text: 'Proyecto', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
        { text: (contextInfo.projectName || '').substring(0, 60), margin: [6, 6, 6, 6], fontSize: 9 }
    ]);

    tableData.push([
        { text: 'Protocolo', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
        { text: (contextInfo.protocol || '').substring(0, 60), margin: [6, 6, 6, 6], fontSize: 9 }
    ]);

    tableData.push([
        { text: 'Seccion', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
        { text: (contextInfo.section || '').substring(0, 60), margin: [6, 6, 6, 6], fontSize: 9 }
    ]);

    tableData.push([
        { text: 'Prueba', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
        { text: (contextInfo.testCode || '').substring(0, 60), margin: [6, 6, 6, 6], fontSize: 9 }
    ]);

    if (evidence.captureTimestamp || evidence.timestamp) {
        const fecha = new Date(evidence.captureTimestamp || evidence.timestamp);
        const fechaFormato = fecha.toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        tableData.push([
            { text: 'Fecha captura', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: fechaFormato, margin: [6, 6, 6, 6], fontSize: 9 }
        ]);
    }

    if (evidence.executor || contextInfo.executorGlobal) {
        tableData.push([
            { text: 'Ejecutor', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: (evidence.executor || contextInfo.executorGlobal || '').substring(0, 60), margin: [6, 6, 6, 6], fontSize: 9 }
        ]);
    }

    if (evidence.dimensions) {
        let dimensionsText;
        if (typeof evidence.dimensions === 'string') {
            dimensionsText = evidence.dimensions.replace('x', ' x ') + ' px';
        } else if (evidence.dimensions.width) {
            dimensionsText = `${evidence.dimensions.width} x ${evidence.dimensions.height} px`;
        }

        if (dimensionsText) {
            tableData.push([
                { text: 'Dimensiones', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
                { text: dimensionsText, margin: [6, 6, 6, 6], fontSize: 9 }
            ]);
        }
    }

    if (evidence.size) {
        tableData.push([
            { text: 'Tamano', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: evidence.size, margin: [6, 6, 6, 6], fontSize: 9 }
        ]);
    }

    if (evidence.exif) {
        const exifData = [];
        if (evidence.exif.dateTime) exifData.push(`Fecha: ${evidence.exif.dateTime}`);
        if (evidence.exif.make) exifData.push(`Fabricante: ${evidence.exif.make}`);
        if (evidence.exif.model) exifData.push(`Modelo: ${evidence.exif.model}`);

        if (exifData.length > 0) {
            tableData.push([
                { text: 'EXIF', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
                { text: exifData.join('\n'), margin: [6, 6, 6, 6], fontSize: 9 }
            ]);
        }
    }

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            text: titulo,
                            fontSize: 11,
                            bold: true,
                            color: COLORS.white,
                            fillColor: COLORS.secondary,
                            margin: [10, 10, 10, 10],
                            border: [false, false, false, false]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 0; },
                vLineWidth: function () { return 0; }
            },
            margin: [0, 0, 0, 20]
        },
        {
            table: {
                headerRows: 1,
                widths: [100, '*'],
                body: tableData,
                dontBreakRows: true
            },
            layout: {
                fillColor: function (rowIndex) {
                    return rowIndex === 0 ? COLORS.primary : (rowIndex % 2 === 0 ? COLORS.background : null);
                },
                hLineWidth: function () { return 0.5; },
                vLineWidth: function () { return 0.5; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; },
                paddingLeft: function () { return 4; },
                paddingRight: function () { return 4; },
                paddingTop: function () { return 2; },
                paddingBottom: function () { return 2; }
            }
        },
        {
            text: '',
            pageBreak: 'after'
        }
    ];
}

function buildPageFooter(documentCode, pageNumber, totalPages) {
    return {
        margin: [40, 15, 40, 10],
        stack: [
            {
                columns: [
                    {
                        text: documentCode || 'EV-001',
                        fontSize: 7,
                        color: COLORS.neutral,
                        width: '*'
                    },
                    {
                        text: 'Confidencial - GxP',
                        fontSize: 7,
                        color: COLORS.neutral,
                        width: 'auto',
                        alignment: 'center'
                    },
                    {
                        text: `Pagina ${pageNumber} de ${totalPages}`,
                        fontSize: 7,
                        color: COLORS.neutral,
                        width: '*',
                        alignment: 'right'
                    }
                ]
            }
        ]
    };
}

async function exportEvidence(evidenceStep, testId) {
    try {
        const sessionData = await loadSessionForPDF();
        if (!sessionData) {
            throw new Error('No hay datos de sesión disponibles');
        }

        const test = sessionData.tests.find(t => t.id === testId);
        if (!test) {
            throw new Error('Prueba no encontrada');
        }

        const evidence = test.evidences.find(e => e.step === evidenceStep);
        if (!evidence) {
            throw new Error('Evidencia no encontrada');
        }

        // Cargar imagen (solo si es tipo imagen)
        if (evidence.type !== 'table') {
            const imageId = `${testId}_evidence_${evidenceStep}`;
            evidence.image = await getImageFromDB(imageId);
        }

        // Validar que tabla tenga datos estructurados
        if (evidence.type === 'table' && !evidence.tableData) {
            evidence.tableData = extractTableDataFromHTML(evidence.tableHTML, evidence.rows, evidence.cols, evidence.hasHeader);
        }

        const group = sessionData.groups.find(g => g.id === test.groupId);
        const protocol = sessionData.protocols.find(p => p.id === (group ? group.protocolId : null));

        if (!group) {
            // Carpeta no encontrada
        }

        if (!protocol && group) {
            // Protocolo no encontrado
        }

        const protocolName = protocol ? `${protocol.code} - ${protocol.name}` : 'Sin protocolo';
        const sectionName = group ? group.name : 'Sin carpeta';

        const contextInfo = {
            projectName: sessionData.systemInfo?.nombreSistema || 'Sin nombre',
            protocol: protocolName,
            section: sectionName,
            testCode: test.name || 'Test',
            documentCode: `EV-${protocol ? protocol.code : 'DOC'}-${String(evidenceStep).padStart(3, '0')}`,
            executorGlobal: sessionData.executor || 'No especificado'
        };

        const page1Content = buildEvidencePage_Image(evidence, contextInfo, 1, 2);
        const page2Content = buildEvidencePage_Metadata(evidence, contextInfo, 2, 2);
        // Quitar pageBreak de la última página (export individual)
        if (page2Content.length > 0) {
            const lastElement = page2Content[page2Content.length - 1];
            if (lastElement.pageBreak === 'after') {
                delete lastElement.pageBreak;
            }
        }
        const docDefinition = {
            pageSize: PDF_CONFIG.pageSize,
            pageOrientation: PDF_CONFIG.pageOrientation,
            pageMargins: PDF_CONFIG.pageMargins,
            defaultStyle: PDF_CONFIG.defaultStyle,
            content: [
                ...page1Content,
                ...page2Content
            ],
            footer: function (currentPage, pageCount) {
                return buildPageFooter(contextInfo.documentCode, currentPage, pageCount);
            }
        };

        const fileName = `${contextInfo.documentCode}_Paso_${String(evidenceStep).padStart(3, '0')}.pdf`;

        const watermark_ev = await showWatermarkPicker();
        if (watermark_ev) docDefinition.watermark = watermark_ev;
        pdfMake.createPdf(docDefinition).download(fileName);

        return true;

    } catch (error) {
        alert('Error al exportar evidencia: ' + error.message);
        return false;
    }
}

async function testSingleEvidence() {
    const testId = 'test_1708123456789_def';
    const evidenceStep = 3;

    const result = await exportEvidence(evidenceStep, testId);

    if (result) {
        alert('PDF generado correctamente');
    }
}

async function exportTest(testId, userConclusion) {
    try {
        const sessionData = await loadSessionForPDF();
        if (!sessionData) {
            throw new Error('No hay datos de sesión disponibles');
        }

        const test = sessionData.tests.find(t => t.id === testId);
        if (!test) {
            throw new Error('Prueba no encontrada');
        }

        // USAR CONCLUSIÓN GUARDADA SI LA PRUEBA ESTÁ FINALIZADA
        const conclusion = test.finalized && test.conclusion
            ? test.conclusion
            : userConclusion;

        if (!conclusion) {
            throw new Error('No hay conclusión disponible para exportar');
        }

        const validEvidences = test.evidences.filter(e => !e.isEmpty);
        if (validEvidences.length === 0) {
            throw new Error('La prueba no tiene evidencias');
        }

        // Cargar todas las imágenes de las evidencias
        for (const evidence of validEvidences) {
            const imageId = `${testId}_evidence_${evidence.step}`;
            evidence.image = await getImageFromDB(imageId);
        }

        const group = sessionData.groups.find(g => g.id === test.groupId);
        const protocol = sessionData.protocols.find(p => p.id === (group ? group.protocolId : null));

        const protocolName = protocol ? `${protocol.code} - ${protocol.name}` : 'Sin protocolo';
        const sectionName = group ? group.name : 'Sin carpeta';

        const contextInfo = {
            projectName: sessionData.systemInfo?.nombreSistema || 'Sin nombre',
            protocol: protocolName,
            section: sectionName,
            testCode: test.name,
            documentCode: `TEST-${protocol ? protocol.code : 'DOC'}-${test.id.split('_')[1]}`,
            executorGlobal: sessionData.executor || 'No especificado'
        };

        // Calcular estadísticas
        const stats = calculateTestStats(validEvidences);

        // Generar hash del documento
        const documentHash = await generateDocumentHash(test, validEvidences);

        // Construir contenido del PDF
        const content = [];

        // 1. PORTADA
        content.push(...buildTestCoverPage(test, contextInfo));

        // 2. RESUMEN EJECUTIVO
        content.push(...buildTestSummaryPage(test, stats, contextInfo));

        // 3. ÍNDICE DE EVIDENCIAS
        content.push(...buildTestIndexPage(validEvidences, test, contextInfo));

        // 4. EVIDENCIAS (2 páginas por evidencia: imagen + metadata)
        for (let i = 0; i < validEvidences.length; i++) {
            const evidence = validEvidences[i];
            const isLast = i === validEvidences.length - 1;
            const imgContent = buildEvidencePage_Image(evidence, contextInfo, 0, 0);
            const metaContent = buildEvidencePage_Metadata(evidence, contextInfo, 0, 0);

            // Si es la última evidencia, quitar pageBreak:'after' de metadata
            if (isLast && metaContent.length > 0) {
                const lastElement = metaContent[metaContent.length - 1];
                if (lastElement.pageBreak === 'after') {
                    delete lastElement.pageBreak;
                }
            }

            content.push(...imgContent);
            content.push(...metaContent);
        }

        // 5. TABLA RESUMEN DE EVIDENCIAS
        content.push(...buildEvidencesSummaryTable(validEvidences, contextInfo));

        // 6. CONCLUSIÓN Y HASH
        content.push(...buildConclusionAndHashPage(conclusion, documentHash, contextInfo));

        // Crear PDF
        const docDefinition = {
            pageSize: PDF_CONFIG.pageSize,
            pageOrientation: PDF_CONFIG.pageOrientation,
            pageMargins: PDF_CONFIG.pageMargins,
            defaultStyle: PDF_CONFIG.defaultStyle,
            content: content,
            footer: function (currentPage, pageCount) {
                return buildPageFooter(contextInfo.documentCode, currentPage, pageCount);
            }
        };

        const fileName = `${contextInfo.documentCode}_${test.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

        const watermark_test = await showWatermarkPicker();
        if (watermark_test) docDefinition.watermark = watermark_test;
        pdfMake.createPdf(docDefinition).download(fileName);

        return true;

    } catch (error) {
        alert('Error al exportar test: ' + error.message);
        return false;
    }
}

function buildTestCoverPage(testData, contextInfo) {
    return [
        // FONDO CON GRADIENTE
        {
            canvas: [
                {
                    type: 'rect',
                    x: 0,
                    y: 0,
                    w: 760,
                    h: 520,
                    color: COLORS.background,
                    fillOpacity: 0.3
                }
            ],
            absolutePosition: { x: 30, y: 30 }
        },
        // MARCO VERDE PRINCIPAL
        {
            canvas: [
                {
                    type: 'rect',
                    x: 0,
                    y: 0,
                    w: 760,
                    h: 520,
                    lineWidth: 12,
                    lineColor: COLORS.accent
                }
            ],
            absolutePosition: { x: 30, y: 30 }
        },
        // BARRA SUPERIOR AZUL
        {
            canvas: [
                {
                    type: 'rect',
                    x: 15,
                    y: 15,
                    w: 730,
                    h: 80,
                    color: COLORS.primary
                }
            ],
            absolutePosition: { x: 30, y: 30 }
        },
        // CONTENIDO PRINCIPAL
        {
            stack: [
                // TÍTULO PRINCIPAL EN BARRA AZUL
                {
                    text: 'INFORME DE VALIDACIÓN',
                    fontSize: 20,
                    bold: true,
                    color: COLORS.white,
                    alignment: 'center',
                    margin: [0, 35, 0, 5]
                },
                {
                    text: 'PRUEBA COMPLETA',
                    fontSize: 14,
                    color: COLORS.accent,
                    alignment: 'center',
                    margin: [0, 0, 0, 80]
                },

                // SECCIÓN DE INFORMACIÓN
                {
                    stack: [
                        // NOMBRE DE LA PRUEBA (destacado)
                        {
                            text: testData.name.toUpperCase(),
                            fontSize: 18,
                            bold: true,
                            color: COLORS.primary,
                            alignment: 'center',
                            margin: [40, 0, 40, 20]
                        },

                        // LÍNEA DECORATIVA
                        {
                            canvas: [
                                {
                                    type: 'line',
                                    x1: 150,
                                    y1: 0,
                                    x2: 610,
                                    y2: 0,
                                    lineWidth: 2,
                                    lineColor: COLORS.accent
                                }
                            ],
                            margin: [0, 0, 0, 25]
                        },

                        // TABLA DE INFORMACIÓN (layout mejorado)
                        {
                            columns: [
                                {
                                    width: '50%',
                                    stack: [
                                        {
                                            table: {
                                                widths: [100, '*'],
                                                body: [
                                                    [
                                                        { text: 'Proyecto', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: contextInfo.projectName, fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Protocolo', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: contextInfo.protocol.split(' - ')[0], fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Sección', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, false], margin: [0, 3, 0, 3] },
                                                        { text: contextInfo.section, fontSize: 10, border: [false, false, false, false], margin: [0, 3, 0, 3] }
                                                    ]
                                                ]
                                            }
                                        }
                                    ]
                                },
                                {
                                    width: '50%',
                                    stack: [
                                        {
                                            table: {
                                                widths: [100, '*'],
                                                body: [
                                                    [
                                                        { text: 'Evidencias', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: testData.evidences.filter(e => !e.isEmpty).length.toString(), fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Ejecutor', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: contextInfo.executorGlobal, fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Fecha', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, false], margin: [0, 3, 0, 3] },
                                                        { text: new Date().toLocaleDateString('es-AR'), fontSize: 10, border: [false, false, false, false], margin: [0, 3, 0, 3] }
                                                    ]
                                                ]
                                            }
                                        }
                                    ]
                                }
                            ],
                            columnGap: 20,
                            margin: [60, 0, 60, 40]
                        },

                        // LÍNEA DECORATIVA INFERIOR
                        {
                            canvas: [
                                {
                                    type: 'line',
                                    x1: 150,
                                    y1: 0,
                                    x2: 610,
                                    y2: 0,
                                    lineWidth: 2,
                                    lineColor: COLORS.accent
                                }
                            ],
                            margin: [0, 20, 0, 30]
                        },

                        // CÓDIGO DEL DOCUMENTO
                        {
                            text: `Código: ${contextInfo.documentCode}`,
                            fontSize: 10,
                            bold: true,
                            color: COLORS.primary,
                            alignment: 'center',
                            margin: [0, 0, 0, 20]
                        },
                    ]
                }
            ]
        }
    ];
}

function calculateTestStats(evidences) {
    const validEvidences = evidences.filter(e => !e.isEmpty);

    return {
        total: validEvidences.length,
        pasa: validEvidences.filter(e => e.resultado === 'PASA').length,
        noPasa: validEvidences.filter(e => e.resultado === 'NO PASA').length,
        pasaObs: validEvidences.filter(e => e.resultado === 'PASA CON OBSERVACIONES').length,
        noAplica: validEvidences.filter(e => e.resultado === 'NO APLICA').length
    };
}

function buildTestSummaryPage(testData, stats, contextInfo) {
    const breadcrumb = `${(contextInfo.projectName || '').substring(0, 25)} | ${(contextInfo.protocol || '').substring(0, 25)} | ${(contextInfo.section || '').substring(0, 20)} | ${(testData.name || '').substring(0, 35)}`;

    // Calcular porcentajes para el gráfico
    const total = stats.total || 1;
    const pasaPct = ((stats.pasa / total) * 100).toFixed(1);
    const noPasaPct = ((stats.noPasa / total) * 100).toFixed(1);
    const pasaObsPct = ((stats.pasaObs / total) * 100).toFixed(1);
    const noAplicaPct = ((stats.noAplica / total) * 100).toFixed(1);

    // Generar SVG del gráfico de torta
    const pieChartSVG = buildPieChartSVG(stats);

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15]
        },
        {
            text: 'RESUMEN EJECUTIVO',
            fontSize: 16,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 20]
        },
        {
            columns: [
                // COLUMNA IZQUIERDA: TABLA (60%)
                {
                    width: '60%',
                    table: {
                        widths: ['*', 100],
                        body: [
                            [
                                { text: 'CONCEPTO', fillColor: COLORS.primary, color: COLORS.white, bold: true, margin: [8, 8, 8, 8] },
                                { text: 'CANTIDAD', fillColor: COLORS.primary, color: COLORS.white, bold: true, alignment: 'center', margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'Total de evidencias', margin: [8, 8, 8, 8] },
                                { text: stats.total.toString(), alignment: 'center', margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'PASA', color: COLORS.pass, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] },
                                { text: `${stats.pasa} (${pasaPct}%)`, alignment: 'center', color: COLORS.pass, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'NO PASA', color: COLORS.fail, bold: true, margin: [8, 8, 8, 8] },
                                { text: `${stats.noPasa} (${noPasaPct}%)`, alignment: 'center', color: COLORS.fail, bold: true, margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'PASA CON OBSERVACIONES', color: COLORS.passObs, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] },
                                { text: `${stats.pasaObs} (${pasaObsPct}%)`, alignment: 'center', color: COLORS.passObs, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'NO APLICA', color: COLORS.notApplicable, bold: true, margin: [8, 8, 8, 8] },
                                { text: `${stats.noAplica} (${noAplicaPct}%)`, alignment: 'center', color: COLORS.notApplicable, bold: true, margin: [8, 8, 8, 8] }
                            ]
                        ]
                    },
                    layout: {
                        hLineWidth: function () { return 0.5; },
                        vLineWidth: function () { return 0.5; },
                        hLineColor: function () { return COLORS.neutral; },
                        vLineColor: function () { return COLORS.neutral; }
                    }
                },
                // COLUMNA DERECHA: GRÁFICO (40%)
                {
                    width: '40%',
                    stack: [
                        {
                            text: 'DISTRIBUCIÓN',
                            fontSize: 11,
                            bold: true,
                            color: COLORS.primary,
                            alignment: 'center',
                            margin: [0, 0, 0, 10]
                        },
                        {
                            svg: pieChartSVG,
                            width: 200,
                            alignment: 'center'
                        }
                    ],
                    margin: [20, 0, 0, 0]
                }
            ]
        }
    ];
}

function buildPieChartSVG(stats) {
    const total = stats.pasa + stats.noPasa + stats.pasaObs + stats.noAplica;

    if (total === 0) {
        return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="${COLORS.neutral}" opacity="0.3"/>
            <text x="100" y="100" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="${COLORS.text}">Sin datos</text>
        </svg>`;
    }

    const data = [
        { value: stats.pasa, color: COLORS.pass, label: 'PASA' },
        { value: stats.noPasa, color: COLORS.fail, label: 'NO PASA' },
        { value: stats.pasaObs, color: COLORS.passObs, label: 'PASA CON OBS' },
        { value: stats.noAplica, color: COLORS.notApplicable, label: 'NO APLICA' }
    ].filter(d => d.value > 0);

    const cx = 100;
    const cy = 100;
    const radius = 80;

    let currentAngle = -90;
    let paths = '';

    data.forEach(item => {
        const percentage = item.value / total;
        const angle = percentage * 360;

        const startAngle = currentAngle;
        const endAngle = currentAngle + angle;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + radius * Math.cos(startRad);
        const y1 = cy + radius * Math.sin(startRad);
        const x2 = cx + radius * Math.cos(endRad);
        const y2 = cy + radius * Math.sin(endRad);

        const largeArc = angle > 180 ? 1 : 0;

        paths += `
            <path d="M ${cx},${cy} L ${x1},${y1} A ${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z" 
                  fill="${item.color}" 
                  stroke="white" 
                  stroke-width="2"/>
        `;

        currentAngle = endAngle;
    });

    const innerCircle = `<circle cx="${cx}" cy="${cy}" r="40" fill="white"/>`;

    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        ${paths}
        ${innerCircle}
    </svg>`;
}

function buildTestIndexPage(evidences, testData, contextInfo) {
    const breadcrumb = `${(contextInfo.projectName || '').substring(0, 25)} | ${(contextInfo.protocol || '').substring(0, 25)} | ${(contextInfo.section || '').substring(0, 20)} | ${(testData.name || '').substring(0, 35)}`;

    const validEvidences = evidences.filter(e => !e.isEmpty);
    const indexRows = [
        [
            { text: 'PASO', fillColor: COLORS.primary, color: COLORS.white, bold: true, margin: [8, 8, 8, 8] },
            { text: 'DESCRIPCIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, margin: [8, 8, 8, 8] }
        ]
    ];

    validEvidences.forEach(evidence => {
        const stepId = `evidence_${evidence.step}`;
        indexRows.push([
            {
                text: `#${String(evidence.step).padStart(3, '0')}`,
                bold: true,
                color: COLORS.primary,
                decoration: 'underline',
                linkToDestination: stepId,
                margin: [8, 6, 8, 6]
            },
            {
                text: evidence.description || 'Sin descripción',
                margin: [8, 6, 8, 6]
            }
        ]);
    });

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        {
            text: 'ÍNDICE DE EVIDENCIAS',
            fontSize: 16,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 20]
        },
        {
            table: {
                headerRows: 1,
                widths: [60, '*'],
                body: indexRows
            },
            layout: {
                fillColor: function (rowIndex) {
                    return rowIndex === 0 ? COLORS.primary : (rowIndex % 2 === 0 ? COLORS.background : null);
                },
                hLineWidth: function () { return 0.5; },
                vLineWidth: function () { return 0.5; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            }
        },
        {
            text: '',
            pageBreak: 'after'
        }
    ];
}

function buildEvidencesSummaryTable(evidences, contextInfo) {
    const breadcrumb = `${(contextInfo.projectName || '').substring(0, 25)} | ${(contextInfo.protocol || '').substring(0, 25)} | ${(contextInfo.section || '').substring(0, 20)} | ${(contextInfo.testCode || '').substring(0, 35)}`;

    const validEvidences = evidences.filter(e => !e.isEmpty);
    const tableRows = [
        [
            { text: 'PASO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'OPERACIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'DESCRIPCIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'RESULTADO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [6, 6, 6, 6] },
            { text: 'EJECUTOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'FECHA/HORA', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [6, 6, 6, 6] }
        ]
    ];

    const resultadoColor = {
        'PASA': COLORS.pass,
        'NO PASA': COLORS.fail,
        'PASA CON OBSERVACIONES': COLORS.passObs,
        'NO APLICA': COLORS.notApplicable
    };

    validEvidences.forEach((evidence, evidIdx) => {
        const fecha = evidence.captureTimestamp || evidence.timestamp;
        const fechaFormato = fecha ? new Date(fecha).toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'N/A';

        // Construir celda de descripción — agrega mini-línea con datos de prueba si existen
        const descStack = [
            { text: evidence.description || 'Sin descripción', fontSize: 8 }
        ];
        const datosPrueba = [];
        if (evidence.usuarioPrueba) datosPrueba.push(evidence.usuarioPrueba);
        if (evidence.rolPrueba) datosPrueba.push(`(${evidence.rolPrueba})`);
        if (evidence.testCaseRef) datosPrueba.push(`· ${evidence.testCaseRef}`);
        if (evidence.criterioRef) datosPrueba.push(`/${evidence.criterioRef}`);
        if (datosPrueba.length > 0) {
            descStack.push({ text: datosPrueba.join(' '), fontSize: 7, italics: true, color: '#5a5a5a', margin: [0, 2, 0, 0] });
        }

        tableRows.push([
            {
                text: `#${String(evidence.step).padStart(3, '0')}`,
                bold: true,
                fontSize: 8,
                margin: [6, 5, 6, 5]
            },
            {
                text: evidence.operacion || 'No especificado',
                fontSize: 8,
                margin: [4, 5, 4, 5],
                fillColor: evidIdx % 2 === 0 ? null : COLORS.background
            },
            {
                stack: descStack,
                margin: [4, 5, 4, 5],
                fillColor: evidIdx % 2 === 0 ? null : COLORS.background
            },
            {
                text: evidence.resultado || 'PASA',
                color: resultadoColor[evidence.resultado] || COLORS.text,
                bold: true,
                fontSize: 8,
                alignment: 'center',
                margin: [6, 5, 6, 5]
            },
            {
                text: evidence.executor || contextInfo.executorGlobal || 'N/A',
                fontSize: 8,
                margin: [6, 5, 6, 5]
            },
            {
                text: fechaFormato,
                fontSize: 8,
                alignment: 'center',
                margin: [6, 5, 6, 5]
            }
        ]);
    });

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        {
            text: 'TABLA RESUMEN DE EVIDENCIAS',
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 20]
        },
        {
            table: {
                widths: [40, 100, '*', 70, 90, 75],
                body: tableRows,
                headerRows: 1,
                dontBreakRows: true
            },
            layout: {
                fillColor: function (rowIndex) {
                    return rowIndex === 0 ? COLORS.primary : (rowIndex % 2 === 0 ? COLORS.background : null);
                },
                hLineWidth: function () { return 0.5; },
                vLineWidth: function () { return 0.5; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            }
        }
    ];
}

async function generateDocumentHash(testData, evidences) {
    const dataString = JSON.stringify({
        testName: testData.name,
        testId: testData.id,
        evidenceCount: evidences.filter(e => !e.isEmpty).length,
        timestamp: new Date().toISOString(),
        evidences: evidences.map(e => ({
            step: e.step,
            resultado: e.resultado,
            timestamp: e.timestamp
        }))
    });

    const encoder = new TextEncoder();
    const data = encoder.encode(dataString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
}

function buildConclusionAndHashPage(conclusion, documentHash, contextInfo) {
    const breadcrumb = `${(contextInfo.projectName || '').substring(0, 25)} | ${(contextInfo.protocol || '').substring(0, 25)} | ${(contextInfo.section || '').substring(0, 20)} | ${(contextInfo.testCode || '').substring(0, 35)}`;

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        {
            text: 'CONCLUSIÓN',
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 15]
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            text: conclusion || 'Sin conclusión',
                            margin: [15, 15, 15, 15],
                            alignment: 'justify'
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 1; },
                vLineWidth: function () { return 1; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            },
            margin: [0, 0, 0, 40]
        },
        {
            text: 'INTEGRIDAD DEL DOCUMENTO',
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 15]
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            stack: [
                                {
                                    text: 'Hash SHA-256:',
                                    fontSize: 9,
                                    bold: true,
                                    margin: [0, 0, 0, 8]
                                },
                                {
                                    text: documentHash,
                                    fontSize: 8,
                                    color: COLORS.primary,
                                    margin: [0, 0, 0, 8]
                                },
                                {
                                    text: 'Este hash garantiza la integridad del contenido del documento. Cualquier modificación alterará este valor.',
                                    fontSize: 8,
                                    italics: true,
                                    color: COLORS.neutral
                                }
                            ],
                            fillColor: COLORS.background,
                            margin: [15, 15, 15, 15]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 1; },
                vLineWidth: function () { return 1; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            }
        }
    ];
}
/* ============================================================================
   EXPORTACIÓN PDF - CARPETA/SECCIÓN COMPLETA
   Consolida todas las pruebas de una carpeta en un PDF único
   ============================================================================ */

/**
 * Exportar carpeta completa (todas las pruebas de una sección)
 * @param {string} groupId - ID de la carpeta/grupo
 * @param {string} userConclusion - Conclusión de la carpeta (obligatoria)
 */
async function exportFolder(groupId, userConclusion) {
    try {
        const sessionData = await loadSessionForPDF();
        if (!sessionData) {
            throw new Error('No hay datos de sesión disponibles');
        }

        const group = sessionData.groups.find(g => g.id === groupId);
        if (!group) {
            throw new Error('Carpeta no encontrada');
        }

        // Encontrar TODAS las pruebas de esta carpeta
        const testsInFolder = sessionData.tests.filter(t => t.groupId === groupId);

        if (testsInFolder.length === 0) {
            throw new Error('La carpeta no tiene pruebas');
        }

        // VALIDACIÓN CRÍTICA: Todas las pruebas deben estar finalizadas
        const unfinalizedTests = testsInFolder.filter(t => !t.finalized);
        if (unfinalizedTests.length > 0) {
            const testNames = unfinalizedTests.map(t => `• ${t.name}`).join('\n');
            throw new Error(`Todas las pruebas deben estar finalizadas antes de exportar la carpeta.\n\nPruebas pendientes:\n${testNames}`);
        }

        // USAR CONCLUSIÓN GUARDADA SI LA CARPETA ESTÁ FINALIZADA
        const conclusion = group.finalized && group.conclusion
            ? group.conclusion
            : userConclusion;

        if (!conclusion) {
            throw new Error('La conclusión de carpeta es obligatoria');
        }

        // Cargar TODAS las imágenes de TODAS las evidencias de TODAS las pruebas
        let allEvidences = [];
        for (const test of testsInFolder) {
            const validEvidences = test.evidences.filter(e => !e.isEmpty);

            for (const evidence of validEvidences) {
                const imageId = `${test.id}_evidence_${evidence.step}`;
                evidence.image = await getImageFromDB(imageId);

                // Agregar referencia a la prueba para contexto
                evidence.testName = test.name;
                evidence.testId = test.id;
            }

            allEvidences = allEvidences.concat(validEvidences);
        }

        if (allEvidences.length === 0) {
            throw new Error('No hay evidencias en ninguna prueba de la carpeta');
        }

        const protocol = sessionData.protocols.find(p => p.id === group.protocolId);
        const protocolName = protocol ? `${protocol.code} - ${protocol.name}` : 'Sin protocolo';

        const contextInfo = {
            projectName: sessionData.systemInfo?.nombreSistema || 'Sin nombre',
            protocol: protocolName,
            section: group.name,
            folderName: group.name,
            documentCode: `FOLDER-${protocol ? protocol.code : 'DOC'}-${group.id.split('_')[1]}`,
            executorGlobal: sessionData.executor || 'No especificado'
        };

        // Calcular estadísticas globales
        const globalStats = calculateFolderStats(testsInFolder);

        // Generar hash del documento
        const documentHash = await generateFolderHash(group, testsInFolder, allEvidences);

        // Construir contenido del PDF
        const content = [];

        // 1. PORTADA
        content.push(...buildFolderCoverPage(group, testsInFolder, contextInfo, globalStats));

        // 2. RESUMEN EJECUTIVO
        content.push(...buildFolderSummaryPage(group, globalStats, testsInFolder, contextInfo));

        // 3. ÍNDICE JERÁRQUICO
        content.push(...buildFolderIndexPage(testsInFolder, group, contextInfo));

        // 4. EVIDENCIAS Y CONCLUSIONES POR PRUEBA
        for (let testIdx = 0; testIdx < testsInFolder.length; testIdx++) {
            const test = testsInFolder[testIdx];
            const testEvidences = test.evidences.filter(e => !e.isEmpty);
            const isLastTest = testIdx === testsInFolder.length - 1;

            // CARÁTULA SEPARADORA DE PRUEBA
            content.push(...buildTestSeparatorPage(test, testIdx + 1, testsInFolder.length, contextInfo));

            // EVIDENCIAS DE LA PRUEBA
            for (let evidIdx = 0; evidIdx < testEvidences.length; evidIdx++) {
                const evidence = testEvidences[evidIdx];

                // Contexto específico de la prueba
                const evidenceContext = {
                    ...contextInfo,
                    testCode: test.name
                };

                // ID único global para evitar duplicados entre pruebas
                const globalStepId = `evidence_${test.id}_${evidence.step}`;

                const imgContent = buildEvidencePage_Image(evidence, evidenceContext, 0, 0, globalStepId);
                const metaContent = buildEvidencePage_Metadata(evidence, evidenceContext, 0, 0);

                // Quitar pageBreak de la última evidencia (la conclusión lo tendrá)
                if (evidIdx === testEvidences.length - 1 && metaContent.length > 0) {
                    const lastElement = metaContent[metaContent.length - 1];
                    if (lastElement.pageBreak === 'after') {
                        delete lastElement.pageBreak;
                    }
                }

                content.push(...imgContent);
                content.push(...metaContent);
            }

            // CONCLUSIÓN Y TRAZABILIDAD DE LA PRUEBA
            // Solo agregar si la prueba está finalizada
            // Si es la última prueba, NO agregar pageBreak para evitar página en blanco
            if (test.finalized) {
                content.push(...buildTestConclusionPage(test, contextInfo, true, isLastTest));
            }
        }

        // 5. TABLA RESUMEN DE EVIDENCIAS (por prueba)
        content.push(...buildFolderEvidencesSummaryTable(testsInFolder, contextInfo));

        // 6. CONCLUSIÓN Y HASH
        content.push(...buildFolderConclusionAndHashPage(conclusion, documentHash, contextInfo));

        // Crear PDF
        const docDefinition = {
            pageSize: PDF_CONFIG.pageSize,
            pageOrientation: PDF_CONFIG.pageOrientation,
            pageMargins: PDF_CONFIG.pageMargins,
            defaultStyle: PDF_CONFIG.defaultStyle,
            content: content,
            footer: function (currentPage, pageCount) {
                return buildPageFooter(contextInfo.documentCode, currentPage, pageCount);
            }
        };

        const fileName = `${contextInfo.documentCode}_${group.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

        const watermark_folder = await showWatermarkPicker();
        if (watermark_folder) docDefinition.watermark = watermark_folder;
        pdfMake.createPdf(docDefinition).download(fileName);

        return true;

    } catch (error) {
        alert('Error al exportar carpeta:\n\n' + error.message);
        return false;
    }
}

/**
 * Calcular estadísticas globales de todas las pruebas de la carpeta
 */
function calculateFolderStats(testsInFolder) {
    let globalStats = {
        total: 0,
        pasa: 0,
        noPasa: 0,
        pasaObs: 0,
        noAplica: 0,
        totalTests: testsInFolder.length,
        testsFinalized: testsInFolder.filter(t => t.finalized).length
    };

    testsInFolder.forEach(test => {
        const validEvidences = test.evidences.filter(e => !e.isEmpty);

        globalStats.total += validEvidences.length;
        globalStats.pasa += validEvidences.filter(e => e.resultado === 'PASA').length;
        globalStats.noPasa += validEvidences.filter(e => e.resultado === 'NO PASA').length;
        globalStats.pasaObs += validEvidences.filter(e => e.resultado === 'PASA CON OBSERVACIONES').length;
        globalStats.noAplica += validEvidences.filter(e => e.resultado === 'NO APLICA').length;
    });

    return globalStats;
}

/**
 * Generar hash SHA-256 de la carpeta completa
 */
async function generateFolderHash(groupData, testsInFolder, allEvidences) {
    const dataString = JSON.stringify({
        folderName: groupData.name,
        folderId: groupData.id,
        testsCount: testsInFolder.length,
        evidenceCount: allEvidences.length,
        timestamp: new Date().toISOString(),
        tests: testsInFolder.map(test => ({
            id: test.id,
            name: test.name,
            finalized: test.finalized,
            evidenceCount: test.evidences.filter(e => !e.isEmpty).length
        })),
        evidences: allEvidences.map(e => ({
            step: e.step,
            testId: e.testId,
            resultado: e.resultado,
            timestamp: e.timestamp
        }))
    });

    const encoder = new TextEncoder();
    const data = encoder.encode(dataString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
}

/**
 * Generar hash SHA-256 para proyecto completo
 */
async function generateProjectHash(projectData, folders, allTests) {
    const dataString = JSON.stringify({
        projectName: projectData.systemInfo?.nombreSistema || 'Sin nombre',
        projectId: projectData.id || 'project',
        folderCount: folders.length,
        testCount: allTests.length,
        evidenceCount: allTests.reduce((sum, t) =>
            sum + t.evidences.filter(e => !e.isEmpty).length, 0),
        timestamp: new Date().toISOString(),
        folders: folders.map(f => ({
            id: f.id,
            name: f.name
        })),
        tests: allTests.map(t => ({
            id: t.id,
            name: t.name,
            groupId: t.groupId,
            evidenceCount: t.evidences.filter(e => !e.isEmpty).length
        }))
    });

    const encoder = new TextEncoder();
    const data = encoder.encode(dataString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
}


/**
 * Construir portada de carpeta
 */
function buildFolderCoverPage(groupData, testsInFolder, contextInfo, globalStats) {
    return [
        // FONDO CON GRADIENTE
        {
            canvas: [
                {
                    type: 'rect',
                    x: 0,
                    y: 0,
                    w: 760,
                    h: 520,
                    color: COLORS.background,
                    fillOpacity: 0.3
                }
            ],
            absolutePosition: { x: 30, y: 30 }
        },
        // MARCO VERDE PRINCIPAL
        {
            canvas: [
                {
                    type: 'rect',
                    x: 0,
                    y: 0,
                    w: 760,
                    h: 520,
                    lineWidth: 12,
                    lineColor: COLORS.accent
                }
            ],
            absolutePosition: { x: 30, y: 30 }
        },
        // BARRA SUPERIOR AZUL
        {
            canvas: [
                {
                    type: 'rect',
                    x: 15,
                    y: 15,
                    w: 730,
                    h: 80,
                    color: COLORS.primary
                }
            ],
            absolutePosition: { x: 30, y: 30 }
        },
        // CONTENIDO PRINCIPAL
        {
            stack: [
                // TÍTULO PRINCIPAL EN BARRA AZUL
                {
                    text: 'INFORME DE VALIDACIÓN',
                    fontSize: 20,
                    bold: true,
                    color: COLORS.white,
                    alignment: 'center',
                    margin: [0, 35, 0, 5]
                },
                {
                    text: 'CARPETA COMPLETA',
                    fontSize: 14,
                    color: COLORS.accent,
                    alignment: 'center',
                    margin: [0, 0, 0, 80]
                },

                // SECCIÓN DE INFORMACIÓN
                {
                    stack: [
                        // NOMBRE DE LA CARPETA (destacado)
                        {
                            text: groupData.name.toUpperCase(),
                            fontSize: 18,
                            bold: true,
                            color: COLORS.primary,
                            alignment: 'center',
                            margin: [40, 0, 40, 20]
                        },

                        // LÍNEA DECORATIVA
                        {
                            canvas: [
                                {
                                    type: 'line',
                                    x1: 150,
                                    y1: 0,
                                    x2: 610,
                                    y2: 0,
                                    lineWidth: 2,
                                    lineColor: COLORS.accent
                                }
                            ],
                            margin: [0, 0, 0, 25]
                        },

                        // TABLA DE INFORMACIÓN
                        {
                            columns: [
                                {
                                    width: '50%',
                                    stack: [
                                        {
                                            table: {
                                                widths: [100, '*'],
                                                body: [
                                                    [
                                                        { text: 'Proyecto', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: contextInfo.projectName, fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Protocolo', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: contextInfo.protocol.split(' - ')[0], fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Pruebas', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, false], margin: [0, 3, 0, 3] },
                                                        { text: globalStats.totalTests.toString(), fontSize: 10, border: [false, false, false, false], margin: [0, 3, 0, 3] }
                                                    ]
                                                ]
                                            }
                                        }
                                    ]
                                },
                                {
                                    width: '50%',
                                    stack: [
                                        {
                                            table: {
                                                widths: [100, '*'],
                                                body: [
                                                    [
                                                        { text: 'Evidencias', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: globalStats.total.toString(), fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Ejecutor', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                                        { text: contextInfo.executorGlobal, fontSize: 10, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                                    ],
                                                    [
                                                        { text: 'Fecha', bold: true, fontSize: 10, color: COLORS.primary, border: [false, false, false, false], margin: [0, 3, 0, 3] },
                                                        { text: new Date().toLocaleDateString('es-AR'), fontSize: 10, border: [false, false, false, false], margin: [0, 3, 0, 3] }
                                                    ]
                                                ]
                                            }
                                        }
                                    ]
                                }
                            ],
                            columnGap: 20,
                            margin: [60, 0, 60, 40]
                        },

                        // LÍNEA DECORATIVA INFERIOR
                        {
                            canvas: [
                                {
                                    type: 'line',
                                    x1: 150,
                                    y1: 0,
                                    x2: 610,
                                    y2: 0,
                                    lineWidth: 2,
                                    lineColor: COLORS.accent
                                }
                            ],
                            margin: [0, 20, 0, 30]
                        },

                        // CÓDIGO DEL DOCUMENTO
                        {
                            text: `Código: ${contextInfo.documentCode}`,
                            fontSize: 10,
                            bold: true,
                            color: COLORS.primary,
                            alignment: 'center',
                            margin: [0, 0, 0, 60]
                        }
                    ]
                }
            ]
        }
    ];
}

/**
 * Construir resumen ejecutivo de carpeta
 */
function buildFolderSummaryPage(groupData, globalStats, testsInFolder, contextInfo) {
    const breadcrumb = `Proyecto: ${(contextInfo.projectName || '').substring(0, 40)} | Protocolo: ${(contextInfo.protocol || '').substring(0, 45)} | Carpeta: ${(groupData.name || '').substring(0, 40)}`;

    // Calcular porcentajes
    const total = globalStats.total || 1;
    const pasaPct = ((globalStats.pasa / total) * 100).toFixed(1);
    const noPasaPct = ((globalStats.noPasa / total) * 100).toFixed(1);
    const pasaObsPct = ((globalStats.pasaObs / total) * 100).toFixed(1);
    const noAplicaPct = ((globalStats.noAplica / total) * 100).toFixed(1);

    // Generar gráfico de torta
    const pieChartSVG = buildPieChartSVG(globalStats);

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15]
        },
        {
            text: 'RESUMEN EJECUTIVO DE CARPETA',
            fontSize: 16,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 20]
        },
        {
            columns: [
                // COLUMNA IZQUIERDA: TABLA (60%)
                {
                    width: '60%',
                    table: {
                        widths: ['*', 100],
                        body: [
                            [
                                { text: 'CONCEPTO', fillColor: COLORS.primary, color: COLORS.white, bold: true, margin: [8, 8, 8, 8] },
                                { text: 'CANTIDAD', fillColor: COLORS.primary, color: COLORS.white, bold: true, alignment: 'center', margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'Total de pruebas', margin: [8, 8, 8, 8] },
                                { text: globalStats.totalTests.toString(), alignment: 'center', margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'Total de evidencias', fillColor: COLORS.background, margin: [8, 8, 8, 8] },
                                { text: globalStats.total.toString(), alignment: 'center', fillColor: COLORS.background, margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'PASA', color: COLORS.pass, bold: true, margin: [8, 8, 8, 8] },
                                { text: `${globalStats.pasa} (${pasaPct}%)`, alignment: 'center', color: COLORS.pass, bold: true, margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'NO PASA', color: COLORS.fail, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] },
                                { text: `${globalStats.noPasa} (${noPasaPct}%)`, alignment: 'center', color: COLORS.fail, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'PASA CON OBSERVACIONES', color: COLORS.passObs, bold: true, margin: [8, 8, 8, 8] },
                                { text: `${globalStats.pasaObs} (${pasaObsPct}%)`, alignment: 'center', color: COLORS.passObs, bold: true, margin: [8, 8, 8, 8] }
                            ],
                            [
                                { text: 'NO APLICA', color: COLORS.notApplicable, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] },
                                { text: `${globalStats.noAplica} (${noAplicaPct}%)`, alignment: 'center', color: COLORS.notApplicable, bold: true, fillColor: COLORS.background, margin: [8, 8, 8, 8] }
                            ]
                        ]
                    },
                    layout: {
                        hLineWidth: function () { return 0.5; },
                        vLineWidth: function () { return 0.5; },
                        hLineColor: function () { return COLORS.neutral; },
                        vLineColor: function () { return COLORS.neutral; }
                    }
                },
                // COLUMNA DERECHA: GRÁFICO (40%)
                {
                    width: '40%',
                    stack: [
                        {
                            text: 'DISTRIBUCIÓN GLOBAL',
                            fontSize: 11,
                            bold: true,
                            color: COLORS.primary,
                            alignment: 'center',
                            margin: [0, 0, 0, 10]
                        },
                        {
                            svg: pieChartSVG,
                            width: 200,
                            alignment: 'center'
                        }
                    ],
                    margin: [20, 0, 0, 0]
                }
            ]
        }
    ];
}

/**
 * Construir índice jerárquico (Prueba → Evidencias)
 */
function buildFolderIndexPage(testsInFolder, groupData, contextInfo) {
    const breadcrumb = `Proyecto: ${(contextInfo.projectName || '').substring(0, 40)} | Protocolo: ${(contextInfo.protocol || '').substring(0, 45)} | Carpeta: ${(groupData.name || '').substring(0, 40)}`;

    const content = [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        // Título principal
        {
            text: 'ÍNDICE DE CONTENIDO',
            fontSize: 18,
            bold: true,
            color: COLORS.primary,
            alignment: 'center',
            margin: [0, 0, 0, 10]
        },
        // Línea decorativa
        {
            canvas: [
                {
                    type: 'line',
                    x1: 150,
                    y1: 0,
                    x2: 610,
                    y2: 0,
                    lineWidth: 2,
                    lineColor: COLORS.accent
                }
            ],
            margin: [0, 0, 0, 30]
        }
    ];

    // SECCIÓN: Pruebas y Evidencias
    content.push({
        table: { widths: ['*'], body: [[{ text: 'PRUEBAS Y EVIDENCIAS', fontSize: 12, bold: true, color: COLORS.white, fillColor: COLORS.primary, margin: [10, 8, 10, 8], border: [false, false, false, false] }]] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 0, 0, 15]
    });

    testsInFolder.forEach((test, testIdx) => {
        const validEvidences = test.evidences.filter(e => !e.isEmpty);

        // Nombre de la prueba con estadísticas
        content.push({
            text: `PRUEBA ${testIdx + 1}: ${test.name}`,
            fontSize: 11,
            bold: true,
            color: COLORS.primary,
            margin: [0, testIdx > 0 ? 15 : 0, 0, 5]
        });

        content.push({
            text: `${validEvidences.length} evidencia${validEvidences.length !== 1 ? 's' : ''} | Estado: ${test.finalized ? 'FINALIZADA' : 'EN PROGRESO'} | Resultado: ${test.resultado || 'PASA'}`,
            fontSize: 8,
            color: COLORS.neutral,
            italics: true,
            margin: [20, 0, 0, 8]
        });

        // TODAS las evidencias
        validEvidences.forEach((evidence) => {
            const stepId = `evidence_${test.id}_${evidence.step}`;
            const desc = evidence.description || evidence.title || 'Sin descripción';

            content.push({
                text: `#${String(evidence.step).padStart(3, '0')} - ${desc}`,
                fontSize: 9,
                color: COLORS.text,
                decoration: 'underline',
                linkToDestination: stepId,
                margin: [30, 2, 0, 2]
            });
        });
    });

    // SECCIÓN: Documentación de Cierre
    content.push({
        table: { widths: ['*'], body: [[{ text: 'DOCUMENTACIÓN DE CIERRE', fontSize: 12, bold: true, color: COLORS.white, fillColor: COLORS.primary, margin: [10, 8, 10, 8], border: [false, false, false, false] }]] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 25, 0, 15]
    });

    // SECCIÓN 1: Resumen de Evidencias
    content.push({
        text: 'RESUMEN DE EVIDENCIAS',
        fontSize: 11,
        bold: true,
        color: COLORS.primary,
        decoration: 'underline',
        linkToDestination: 'tabla_resumen_evidencias',
        margin: [0, 15, 0, 5]
    });
    content.push({
        text: 'Tabla consolidada de todas las evidencias ejecutadas, agrupadas por prueba',
        fontSize: 8,
        color: COLORS.neutral,
        italics: true,
        margin: [20, 0, 0, 0]
    });

    // SECCIÓN 2: Conclusión
    content.push({
        text: 'CONCLUSIÓN DEL DOCUMENTO',
        fontSize: 11,
        bold: true,
        color: COLORS.primary,
        decoration: 'underline',
        linkToDestination: 'conclusion_documento',
        margin: [0, 15, 0, 5]
    });
    content.push({
        text: 'Conclusión técnica y resultado final de la carpeta',
        fontSize: 8,
        color: COLORS.neutral,
        italics: true,
        margin: [20, 0, 0, 0]
    });

    // SECCIÓN 3: Trazabilidad
    content.push({
        text: 'TRAZABILIDAD E INTEGRIDAD (SHA-256)',
        fontSize: 11,
        bold: true,
        color: COLORS.primary,
        decoration: 'underline',
        linkToDestination: 'hash_integridad',
        margin: [0, 15, 0, 5]
    });
    content.push({
        text: 'Hash criptográfico SHA-256 que garantiza la integridad del documento',
        fontSize: 8,
        color: COLORS.neutral,
        italics: true,
        margin: [20, 0, 0, 0]
    });

    // Separador
    content.push({
        table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.neutral, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [1] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 20, 0, 15]
    });

    // Nota final
    content.push({
        text: [
            { text: 'Nota: ', bold: true, color: COLORS.primary, fontSize: 8 },
            { text: 'Todos los elementos subrayados son enlaces navegables. Click para ir directamente a la sección correspondiente.', color: COLORS.neutral, fontSize: 8, italics: true }
        ],
        margin: [20, 0, 0, 0]
    });

    return content;
}

/**
 * Construir tabla resumen de evidencias (agrupadas por prueba)
 */
function buildFolderEvidencesSummaryTable(testsInFolder, contextInfo, folderId = '') {
    const breadcrumb = `Proyecto: ${(contextInfo.projectName || '').substring(0, 40)} | Protocolo: ${(contextInfo.protocol || '').substring(0, 45)} | Carpeta: ${(contextInfo.folderName || '').substring(0, 40)}`;

    const tableRows = [
        [
            { text: 'PASO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'OPERACIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'DESCRIPCIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'RESULTADO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [6, 6, 6, 6] },
            { text: 'EJECUTOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [6, 6, 6, 6] },
            { text: 'FECHA/HORA', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [6, 6, 6, 6] }
        ]
    ];

    const resultadoColor = {
        'PASA': COLORS.pass,
        'NO PASA': COLORS.fail,
        'PASA CON OBSERVACIONES': COLORS.passObs,
        'NO APLICA': COLORS.notApplicable
    };

    // Agregar evidencias agrupadas por prueba
    testsInFolder.forEach(test => {
        const validEvidences = test.evidences.filter(e => !e.isEmpty);

        // Fila separadora con nombre de prueba
        tableRows.push([
            {
                text: test.name.toUpperCase(),
                colSpan: 6,
                bold: true,
                fontSize: 9,
                fillColor: COLORS.secondary,
                color: COLORS.white,
                margin: [6, 8, 6, 8]
            },
            {}, {}, {}, {}, {}
        ]);

        // Evidencias de esta prueba
        validEvidences.forEach((evidence, evidIdx) => {
            const fecha = evidence.captureTimestamp || evidence.timestamp;
            const fechaFormato = fecha ? new Date(fecha).toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';

            // Construir celda descripcion con datos de prueba (si existen)
            const descStack2 = [
                { text: evidence.description || 'Sin descripción', fontSize: 8 }
            ];
            const datosPrueba2 = [];
            if (evidence.usuarioPrueba) datosPrueba2.push(evidence.usuarioPrueba);
            if (evidence.rolPrueba) datosPrueba2.push(`(${evidence.rolPrueba})`);
            if (evidence.testCaseRef) datosPrueba2.push(`· ${evidence.testCaseRef}`);
            if (evidence.criterioRef) datosPrueba2.push(`/${evidence.criterioRef}`);
            if (datosPrueba2.length > 0) {
                descStack2.push({ text: datosPrueba2.join(' '), fontSize: 7, italics: true, color: '#5a5a5a', margin: [0, 2, 0, 0] });
            }

            tableRows.push([
                {
                    text: `#${String(evidence.step).padStart(3, '0')}`,
                    bold: true,
                    fontSize: 8,
                    margin: [6, 5, 6, 5]
                },
                {
                    text: evidence.operacion || 'No especificado',
                    fontSize: 8,
                    margin: [4, 5, 4, 5],
                    fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                },
                {
                    stack: descStack2,
                    margin: [4, 5, 4, 5],
                    fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                },
                {
                    text: evidence.resultado || 'PASA',
                    color: resultadoColor[evidence.resultado] || COLORS.text,
                    bold: true,
                    fontSize: 8,
                    alignment: 'center',
                    margin: [6, 5, 6, 5]
                },
                {
                    text: evidence.executor || contextInfo.executorGlobal || 'N/A',
                    fontSize: 8,
                    margin: [6, 5, 6, 5]
                },
                {
                    text: fechaFormato,
                    fontSize: 8,
                    alignment: 'center',
                    margin: [6, 5, 6, 5]
                }
            ]);
        });
    });

    // ID único por carpeta para evitar duplicados
    const uniqueId = folderId ? `tabla_resumen_evidencias_${folderId}` : 'tabla_resumen_evidencias';

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before',
            id: uniqueId
        },
        {
            text: 'TABLA RESUMEN DE EVIDENCIAS',
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 20]
        },
        {
            table: {
                widths: [40, 100, '*', 70, 90, 75],
                body: tableRows,
                headerRows: 1,
                dontBreakRows: true
            },
            layout: {
                fillColor: function (rowIndex) {
                    return rowIndex === 0 ? COLORS.primary : (rowIndex % 2 === 0 ? COLORS.background : null);
                },
                hLineWidth: function () { return 0.5; },
                vLineWidth: function () { return 0.5; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            },
            margin: [0, 0, 0, 30]
        }
    ];
}

function buildFolderConclusionAndHashPage(conclusion, documentHash, contextInfo) {
    const breadcrumb = `Proyecto: ${(contextInfo.projectName || '').substring(0, 40)} | Protocolo: ${(contextInfo.protocol || '').substring(0, 45)} | Carpeta: ${(contextInfo.folderName || '').substring(0, 40)}`;

    const content = [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        {
            text: 'CONCLUSIÓN DE CARPETA',
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 15],
            id: 'conclusion_documento'
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            text: conclusion || 'Sin conclusión',
                            margin: [15, 15, 15, 15],
                            alignment: 'justify'
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 1; },
                vLineWidth: function () { return 1; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            },
            margin: [0, 0, 0, 40]
        },
        {
            text: 'INTEGRIDAD DEL DOCUMENTO',
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 15],
            pageBreak: 'before',
            id: 'hash_integridad'
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            stack: [
                                {
                                    text: 'Hash SHA-256:',
                                    fontSize: 9,
                                    bold: true,
                                    margin: [0, 0, 0, 8]
                                },
                                {
                                    text: documentHash,
                                    fontSize: 8,
                                    color: COLORS.primary,
                                    margin: [0, 0, 0, 8]
                                },
                                {
                                    text: 'Este hash garantiza la integridad del contenido del documento. Cualquier modificación alterará este valor.',
                                    fontSize: 8,
                                    italics: true,
                                    color: COLORS.neutral
                                }
                            ],
                            fillColor: COLORS.background,
                            margin: [15, 15, 15, 15]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 1; },
                vLineWidth: function () { return 1; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            }
        },
        // TÍTULO: INFORMACIÓN DE EXPORTACIÓN (fuera de la caja)
        {
            text: 'INFORMACIÓN DE EXPORTACIÓN',
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 40, 0, 15]
        },
        // CAJA: Grid de 3 columnas
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            columns: [
                                {
                                    width: '33.33%',
                                    stack: [
                                        {
                                            text: 'Fecha de exportación:',
                                            fontSize: 8,
                                            bold: true,
                                            margin: [0, 0, 0, 5]
                                        },
                                        {
                                            text: new Date().toLocaleDateString('es-AR', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                year: 'numeric'
                                            }),
                                            fontSize: 9,
                                            color: COLORS.primary,
                                            bold: true
                                        }
                                    ]
                                },
                                {
                                    width: '33.33%',
                                    stack: [
                                        {
                                            text: 'Hora de exportación:',
                                            fontSize: 8,
                                            bold: true,
                                            margin: [0, 0, 0, 5]
                                        },
                                        {
                                            text: new Date().toLocaleTimeString('es-AR', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                                hour12: false
                                            }),
                                            fontSize: 9,
                                            color: COLORS.primary,
                                            bold: true
                                        }
                                    ]
                                },
                                {
                                    width: '33.33%',
                                    stack: [
                                        {
                                            text: 'Generado por:',
                                            fontSize: 8,
                                            bold: true,
                                            margin: [0, 0, 0, 5]
                                        },
                                        {
                                            text: contextInfo.executorGlobal || 'No especificado',
                                            fontSize: 9,
                                            color: COLORS.primary,
                                            bold: true
                                        }
                                    ]
                                }
                            ],
                            columnGap: 20,
                            fillColor: COLORS.background,
                            margin: [15, 15, 15, 15]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 1; },
                vLineWidth: function () { return 1; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            }
        }
    ];

    // Agregar firma del ejecutor si existe
    try {
        const ejecutorSig = typeof getSignatureByRole === 'function' ? getSignatureByRole('ejecutor') : null;
        if (ejecutorSig && ejecutorSig.image) {
            content.push(
                {
                    text: 'FIRMA DEL EJECUTOR',
                    fontSize: 12,
                    bold: true,
                    color: COLORS.primary,
                    margin: [0, 30, 0, 10],
                    pageBreak: 'before'
                },
                {
                    table: {
                        widths: ['*'],
                        body: [[{
                            stack: [
                                { image: ejecutorSig.image, width: 160, height: 60, alignment: 'center', margin: [0, 10, 0, 8] },
                                { text: ejecutorSig.name, fontSize: 10, bold: true, alignment: 'center', color: COLORS.primary, margin: [0, 0, 0, 4] },
                                { text: `Fecha: ${new Date().toLocaleDateString('es-AR')}`, fontSize: 8, alignment: 'center', color: COLORS.neutral }
                            ],
                            margin: [15, 10, 15, 10]
                        }]]
                    },
                    layout: {
                        hLineWidth: () => 1, vLineWidth: () => 1,
                        hLineColor: () => COLORS.neutral, vLineColor: () => COLORS.neutral
                    },
                    margin: [120, 0, 120, 0]
                }
            );
        }
    } catch (e) { /* firmas no disponibles */ }

    return content;
}
/* ============================================================================
   EXPORTACIÓN PDF - TABLAS NATIVAS
   Renderiza tablas como objetos nativos de pdfMake
   ============================================================================ */

/**
 * Construir página de tabla (imagen conceptual + metadata)
 * @param {Object} evidence - Evidencia de tipo tabla
 * @param {Object} contextInfo - Información de contexto
 */
function buildTablePage_Visual(evidence, contextInfo, customStepId = null) {
    const _pn = (contextInfo.projectName || 'Sin nombre').substring(0, 25);
    const _pr = (contextInfo.protocol || '').substring(0, 25);
    const _sc = (contextInfo.section || '').substring(0, 20);
    const _tc = (contextInfo.testCode || '').substring(0, 35);
    const breadcrumb = `${_pn} | ${_pr} | ${_sc} | ${_tc} | Paso #${String(evidence.step).padStart(3, '0')}`;
    const titulo = `${contextInfo.testCode} - Paso #${String(evidence.step).padStart(3, '0')} - TABLA`;
    const stepId = customStepId || `evidence_${evidence.step}`;

    const content = [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            id: stepId
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            text: titulo,
                            fontSize: 11,
                            bold: true,
                            color: COLORS.white,
                            fillColor: COLORS.secondary,
                            margin: [10, 10, 10, 10],
                            border: [false, false, false, false]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 0; },
                vLineWidth: function () { return 0; }
            },
            margin: [0, 0, 0, 20]
        }
    ];

    // Título de la tabla (si existe)
    if (evidence.title) {
        content.push({
            text: evidence.title,
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 15]
        });
    }

    // Descripción (si existe)
    if (evidence.description) {
        content.push({
            text: evidence.description,
            fontSize: 10,
            color: COLORS.text,
            margin: [0, 0, 0, 15],
            alignment: 'justify'
        });
    }

    // Renderizar tabla nativa en PDF
    if (evidence.tableData && Array.isArray(evidence.tableData)) {
        const pdfTable = buildPDFTableFromData(evidence.tableData, evidence.hasHeader);
        content.push(pdfTable);
    } else {
        content.push({
            text: 'Datos de tabla no disponibles',
            fontSize: 10,
            color: COLORS.neutral,
            italics: true,
            alignment: 'center',
            margin: [0, 50, 0, 50]
        });
    }

    return content;
}

/**
 * Construir metadata de tabla
 */
function buildTablePage_Metadata(evidence, contextInfo) {
    const _pn = (contextInfo.projectName || 'Sin nombre').substring(0, 25);
    const _pr = (contextInfo.protocol || '').substring(0, 25);
    const _sc = (contextInfo.section || '').substring(0, 20);
    const _tc = (contextInfo.testCode || '').substring(0, 35);
    const breadcrumb = `${_pn} | ${_pr} | ${_sc} | ${_tc} | Paso #${String(evidence.step).padStart(3, '0')}`;
    const titulo = `${contextInfo.testCode} - Paso #${String(evidence.step).padStart(3, '0')} - TABLA`;

    const tableData = [
        [
            { text: 'CAMPO', style: 'tableHeader', fillColor: COLORS.primary, color: COLORS.white, margin: [6, 8, 6, 8], fontSize: 9 },
            { text: 'VALOR', style: 'tableHeader', fillColor: COLORS.primary, color: COLORS.white, margin: [6, 8, 6, 8], fontSize: 9 }
        ]
    ];

    const resultadoColor = {
        'PASA': COLORS.pass,
        'NO PASA': COLORS.fail,
        'PASA CON OBSERVACIONES': COLORS.passObs,
        'NO APLICA': COLORS.notApplicable
    };

    tableData.push([
        { text: 'Tipo', bold: true, margin: [8, 8, 8, 8] },
        { text: 'TABLA', margin: [8, 8, 8, 8] }
    ]);

    tableData.push([
        { text: 'Resultado', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
        {
            text: evidence.resultado || 'PASA',
            color: resultadoColor[evidence.resultado] || COLORS.text,
            bold: true,
            margin: [6, 6, 6, 6], fontSize: 9
        }
    ]);

    if (evidence.title) {
        tableData.push([
            { text: 'Título', bold: true, margin: [8, 8, 8, 8] },
            { text: evidence.title, margin: [8, 8, 8, 8] }
        ]);
    }

    if (evidence.description) {
        tableData.push([
            { text: 'Descripción', bold: true, margin: [8, 8, 8, 8] },
            { text: evidence.description, margin: [8, 8, 8, 8] }
        ]);
    }

    // Datos de prueba (opcionales)
    if (evidence.usuarioPrueba || evidence.rolPrueba) {
        const partesT = [];
        if (evidence.usuarioPrueba) partesT.push(evidence.usuarioPrueba);
        if (evidence.rolPrueba) partesT.push(`(${evidence.rolPrueba})`);
        tableData.push([
            { text: 'Usuario / Rol', bold: true, margin: [8, 8, 8, 8] },
            { text: partesT.join(' '), margin: [8, 8, 8, 8] }
        ]);
    }

    if (evidence.testCaseRef || evidence.criterioRef) {
        const partesTC = [];
        if (evidence.testCaseRef) partesTC.push({ text: evidence.testCaseRef, bold: true });
        if (evidence.testCaseRef && evidence.criterioRef) partesTC.push({ text: ' · ' });
        if (evidence.criterioRef) partesTC.push({ text: 'Criterio ' + evidence.criterioRef, italics: true });
        tableData.push([
            { text: 'Test Case', bold: true, margin: [8, 8, 8, 8] },
            { text: partesTC, margin: [8, 8, 8, 8] }
        ]);
    }

    tableData.push([
        { text: 'Dimensiones', bold: true, margin: [8, 8, 8, 8] },
        { text: `${evidence.rows || 0} filas × ${evidence.cols || 0} columnas`, margin: [8, 8, 8, 8] }
    ]);

    tableData.push([
        { text: 'Proyecto', bold: true, margin: [8, 8, 8, 8] },
        { text: contextInfo.projectName, margin: [8, 8, 8, 8] }
    ]);

    tableData.push([
        { text: 'Protocolo', bold: true, margin: [8, 8, 8, 8] },
        { text: contextInfo.protocol, margin: [8, 8, 8, 8] }
    ]);

    tableData.push([
        { text: 'Sección', bold: true, margin: [8, 8, 8, 8] },
        { text: contextInfo.section, margin: [8, 8, 8, 8] }
    ]);

    tableData.push([
        { text: 'Prueba', bold: true, margin: [8, 8, 8, 8] },
        { text: contextInfo.testCode, margin: [8, 8, 8, 8] }
    ]);

    if (evidence.timestamp) {
        const fecha = new Date(evidence.timestamp);
        const fechaFormato = fecha.toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        tableData.push([
            { text: 'Fecha de creación', bold: true, margin: [8, 8, 8, 8] },
            { text: fechaFormato, margin: [8, 8, 8, 8] }
        ]);
    }

    if (evidence.executor || contextInfo.executorGlobal) {
        tableData.push([
            { text: 'Ejecutor', bold: true, margin: [6, 6, 6, 6], fontSize: 9 },
            { text: (evidence.executor || contextInfo.executorGlobal || '').substring(0, 60), margin: [6, 6, 6, 6], fontSize: 9 }
        ]);
    }

    return [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            text: titulo,
                            fontSize: 11,
                            bold: true,
                            color: COLORS.white,
                            fillColor: COLORS.secondary,
                            margin: [10, 10, 10, 10],
                            border: [false, false, false, false]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 0; },
                vLineWidth: function () { return 0; }
            },
            margin: [0, 0, 0, 20]
        },
        {
            table: {
                headerRows: 1,
                widths: [100, '*'],
                body: tableData,
                dontBreakRows: true
            },
            layout: {
                fillColor: function (rowIndex) {
                    return rowIndex === 0 ? COLORS.primary : (rowIndex % 2 === 0 ? COLORS.background : null);
                },
                hLineWidth: function () { return 0.5; },
                vLineWidth: function () { return 0.5; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; },
                paddingLeft: function () { return 4; },
                paddingRight: function () { return 4; },
                paddingTop: function () { return 2; },
                paddingBottom: function () { return 2; }
            }
        },
        {
            text: '',
            pageBreak: 'after'
        }
    ];
}

/**
 * Convertir tableData a tabla nativa de pdfMake
 */
function buildPDFTableFromData(tableData, hasHeader) {
    if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
        return {
            text: 'Tabla vacía',
            fontSize: 10,
            color: COLORS.neutral,
            italics: true
        };
    }

    const cols = tableData[0]?.length || 0;

    // SIEMPRE usar ancho proporcional (100% del ancho disponible)
    const widths = new Array(cols).fill('*');

    // Ajustar fontSize según número de columnas para evitar overflow
    let tableFontSize = 9;
    if (cols > 6) {
        tableFontSize = 8;  // Tablas anchas: letra más pequeña
    }
    if (cols > 10) {
        tableFontSize = 7;  // Tablas muy anchas: letra compacta
    }

    const pdfTableBody = [];

    // Header
    if (hasHeader && tableData[0]) {
        const headerRow = tableData[0].map(cell => ({
            text: cell || '',
            fillColor: COLORS.primary,
            color: COLORS.white,
            bold: true,
            fontSize: tableFontSize,
            margin: [4, 6, 4, 6]
        }));
        pdfTableBody.push(headerRow);
    }

    // Body rows
    const startRow = hasHeader ? 1 : 0;
    for (let r = startRow; r < tableData.length; r++) {
        const row = tableData[r];
        const pdfRow = row.map(cell => ({
            text: cell || '',
            fontSize: tableFontSize,
            margin: [4, 5, 4, 5]
        }));
        pdfTableBody.push(pdfRow);
    }

    return {
        table: {
            headerRows: hasHeader ? 1 : 0,
            widths: widths,
            body: pdfTableBody
        },
        layout: {
            fillColor: function (rowIndex, node, columnIndex) {
                // Header
                if (hasHeader && rowIndex === 0) {
                    return COLORS.primary;
                }
                // Alternate rows
                return rowIndex % 2 === 0 ? COLORS.background : null;
            },
            hLineWidth: function () { return 0.5; },
            vLineWidth: function () { return 0.5; },
            hLineColor: function () { return COLORS.neutral; },
            vLineColor: function () { return COLORS.neutral; }
        },
        margin: [0, 0, 0, 20]
    };
}

/**
 * Extraer tableData desde HTML (para tablas antiguas sin tableData)
 * MEJORADA: Maneja thead y tbody correctamente
 */
function extractTableDataFromHTML(tableHTML, rows, cols, hasHeader) {
    //     console.log('ðŸ” Extrayendo tableData desde HTML...');
    //     console.log('hasHeader:', hasHeader, 'rows:', rows, 'cols:', cols);

    if (!tableHTML) {
    //         console.warn('âš ï¸ tableHTML vacío, generando tabla vacía');
        const data = [];
        for (let r = 0; r < (rows || 3); r++) {
            const row = [];
            for (let c = 0; c < (cols || 4); c++) {
                row.push(hasHeader && r === 0 ? `Columna ${c + 1}` : '');
            }
            data.push(row);
        }
        return data;
    }

    const data = [];
    const temp = document.createElement('div');
    temp.innerHTML = tableHTML;

    const table = temp.querySelector('table');
    if (!table) {
    //         console.error('âŒ No se encontró <table> en el HTML');
        return data;
    }

    // EXTRAER HEADER (si existe)
    if (hasHeader) {
        const thead = table.querySelector('thead');
        if (thead) {
            const headerRow = thead.querySelector('tr');
            if (headerRow) {
                const headerCells = headerRow.querySelectorAll('th');
                const headerData = [];
                headerCells.forEach(cell => {
                    // Buscar input dentro de th (tablas editables)
                    const input = cell.querySelector('input');
                    const value = input ? input.value : cell.textContent;
                    headerData.push(value.trim() || '');
                });
                if (headerData.length > 0) {
                    data.push(headerData);
    //                     console.log('âœ… Header extraído:', headerData);
                }
            }
        } else {
            // Header en primera fila de tbody
            const firstRow = table.querySelector('tbody tr');
            if (firstRow) {
                const cells = firstRow.querySelectorAll('th, td');
                const headerData = [];
                cells.forEach(cell => {
                    const input = cell.querySelector('input');
                    const value = input ? input.value : cell.textContent;
                    headerData.push(value.trim() || '');
                });
                if (headerData.length > 0) {
                    data.push(headerData);
                }
            }
        }
    }

    // EXTRAER BODY
    const tbody = table.querySelector('tbody');
    if (tbody) {
        const bodyRows = tbody.querySelectorAll('tr');
        const startIdx = hasHeader && !table.querySelector('thead') ? 1 : 0; // Saltar primera fila si header estaba en tbody

        for (let i = startIdx; i < bodyRows.length; i++) {
            const tr = bodyRows[i];
            const cells = tr.querySelectorAll('td');
            const rowData = [];

            cells.forEach(cell => {
                // Buscar input dentro de td (tablas editables)
                const input = cell.querySelector('input');
                const value = input ? input.value : cell.textContent;
                rowData.push(value.trim() || '');
            });

            if (rowData.length > 0) {
                data.push(rowData);
            }
        }
    }

    //     console.log('âœ… tableData extraído:', data.length, 'filas');
    //     console.log('Datos:', data);

    return data;
}

function buildTestSeparatorPage(test, testNumber, totalTests, contextInfo) {
    const breadcrumb = `Proyecto: ${(contextInfo.projectName || '').substring(0, 40)} | Protocolo: ${(contextInfo.protocol || '').substring(0, 45)} | Carpeta: ${(contextInfo.folderName || '').substring(0, 40)}`;

    // Objeto breadcrumb con pageBreak condicional
    const breadcrumbObject = {
        text: breadcrumb,
        fontSize: 6,
        color: COLORS.neutral,
        margin: [0, 0, 0, 15]
    };

    // Solo la PRIMERA carátula necesita pageBreak (separar del índice)
    if (testNumber === 1) {
        breadcrumbObject.pageBreak = 'before';
    }

    return [
        breadcrumbObject,
        // Banda azul con número de prueba
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            stack: [
                                {
                                    text: `PRUEBA ${testNumber} DE ${totalTests}`,
                                    fontSize: 10,
                                    bold: true,
                                    color: COLORS.white,
                                    alignment: 'center',
                                    margin: [0, 0, 0, 5]
                                },
                                {
                                    canvas: [
                                        {
                                            type: 'line',
                                            x1: 200,
                                            y1: 0,
                                            x2: 560,
                                            y2: 0,
                                            lineWidth: 1,
                                            lineColor: COLORS.accent
                                        }
                                    ],
                                    margin: [0, 0, 0, 0]
                                }
                            ],
                            fillColor: COLORS.primary,
                            border: [false, false, false, false],
                            margin: [15, 15, 15, 10]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 0; },
                vLineWidth: function () { return 0; }
            },
            margin: [0, 0, 0, 30]
        },
        // Título de la prueba
        {
            text: test.name.toUpperCase(),
            fontSize: 18,
            bold: true,
            color: COLORS.primary,
            alignment: 'center',
            margin: [40, 0, 40, 20]
        },
        // Línea decorativa
        {
            canvas: [
                {
                    type: 'line',
                    x1: 150,
                    y1: 0,
                    x2: 610,
                    y2: 0,
                    lineWidth: 2,
                    lineColor: COLORS.accent
                }
            ],
            margin: [0, 0, 0, 30]
        },
        // Información de la prueba
        {
            columns: [
                {
                    width: '50%',
                    stack: [
                        {
                            text: 'INFORMACIÓN DE PRUEBA',
                            fontSize: 11,
                            bold: true,
                            color: COLORS.primary,
                            margin: [0, 0, 0, 10]
                        },
                        {
                            table: {
                                widths: [100, '*'],
                                body: [
                                    [
                                        { text: 'Evidencias', bold: true, fontSize: 9, color: COLORS.secondary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                        { text: test.evidences.filter(e => !e.isEmpty).length.toString(), fontSize: 9, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                    ],
                                    [
                                        { text: 'Estado', bold: true, fontSize: 9, color: COLORS.secondary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                        { text: test.finalized ? 'FINALIZADA' : 'EN PROGRESO', fontSize: 9, color: test.finalized ? COLORS.pass : COLORS.neutral, bold: true, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                    ],
                                    [
                                        { text: 'Resultado', bold: true, fontSize: 9, color: COLORS.secondary, border: [false, false, false, false], margin: [0, 3, 0, 3] },
                                        { text: test.resultado || 'PASA', fontSize: 9, color: test.resultado === 'NO PASA' ? COLORS.fail : COLORS.pass, bold: true, border: [false, false, false, false], margin: [0, 3, 0, 3] }
                                    ]
                                ]
                            }
                        }
                    ]
                },
                {
                    width: '50%',
                    stack: [
                        {
                            text: 'CONTEXTO',
                            fontSize: 11,
                            bold: true,
                            color: COLORS.primary,
                            margin: [0, 0, 0, 10]
                        },
                        {
                            table: {
                                widths: [100, '*'],
                                body: [
                                    [
                                        { text: 'Carpeta', bold: true, fontSize: 9, color: COLORS.secondary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                        { text: contextInfo.folderName, fontSize: 9, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                    ],
                                    [
                                        { text: 'Protocolo', bold: true, fontSize: 9, color: COLORS.secondary, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] },
                                        { text: contextInfo.protocol.split(' - ')[0], fontSize: 9, border: [false, false, false, true], borderColor: [null, null, null, COLORS.neutral], margin: [0, 3, 0, 3] }
                                    ],
                                    [
                                        { text: 'Proyecto', bold: true, fontSize: 9, color: COLORS.secondary, border: [false, false, false, false], margin: [0, 3, 0, 3] },
                                        { text: contextInfo.projectName, fontSize: 9, border: [false, false, false, false], margin: [0, 3, 0, 3] }
                                    ]
                                ]
                            }
                        }
                    ]
                }
            ],
            columnGap: 30,
            margin: [60, 0, 60, 0]
        },
        // PageBreak para separar carátula de evidencias
        {
            text: '',
            pageBreak: 'after'
        }
    ];
}

/**
 * Construir página de conclusión de prueba individual
 */
function buildTestConclusionPage(test, contextInfo, includeTraceability = true, isLastTest = false) {
    const breadcrumb = `Proyecto: ${(contextInfo.projectName || '').substring(0, 40)} | Protocolo: ${(contextInfo.protocol || '').substring(0, 45)} | Carpeta: ${(contextInfo.folderName || '').substring(0, 40)}`;

    // Formatear fecha y hora de finalización
    const finalizationDate = test.finalizationDate ? new Date(test.finalizationDate) : new Date();
    const fecha = finalizationDate.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const hora = finalizationDate.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const content = [
        {
            text: breadcrumb,
            fontSize: 6,
            color: COLORS.neutral,
            margin: [0, 0, 0, 15],
            pageBreak: 'before'
        },
        // TÍTULO: CONCLUSIÓN DE PRUEBA
        {
            text: `CONCLUSIÓN DE PRUEBA: ${test.name}`,
            fontSize: 14,
            bold: true,
            color: COLORS.primary,
            margin: [0, 0, 0, 15]
        },
        // CAJA: Conclusión
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            text: test.conclusion || 'Sin conclusión registrada',
                            margin: [15, 15, 15, 15],
                            alignment: 'justify',
                            fontSize: 10
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: function () { return 1; },
                vLineWidth: function () { return 1; },
                hLineColor: function () { return COLORS.neutral; },
                vLineColor: function () { return COLORS.neutral; }
            },
            margin: [0, 0, 0, includeTraceability ? 30 : 0]
        }
    ];

    // TRAZABILIDAD (solo si se solicita)
    if (includeTraceability) {
        content.push(
            // TÍTULO: TRAZABILIDAD
            {
                text: 'TRAZABILIDAD DE FINALIZACIÓN',
                fontSize: 14,
                bold: true,
                color: COLORS.primary,
                margin: [0, 0, 0, 15]
            },
            // CAJA: Trazabilidad en 3 columnas
            {
                table: {
                    widths: ['*'],
                    body: [
                        [
                            {
                                stack: [
                                    // Fila 1: Resultado
                                    {
                                        columns: [
                                            {
                                                width: '30%',
                                                text: 'Resultado de la prueba:',
                                                fontSize: 9,
                                                bold: true,
                                                margin: [0, 0, 0, 3]
                                            },
                                            {
                                                width: '70%',
                                                text: test.resultado || 'PASA',
                                                fontSize: 10,
                                                bold: true,
                                                color: test.resultado === 'NO PASA' ? COLORS.fail :
                                                    test.resultado === 'PASA CON OBSERVACIONES' ? COLORS.passObs :
                                                        COLORS.pass
                                            }
                                        ],
                                        margin: [0, 0, 0, 12]
                                    },
                                    // Fila 2: Grid de 3 columnas
                                    {
                                        columns: [
                                            {
                                                width: '33.33%',
                                                stack: [
                                                    {
                                                        text: 'Fecha de finalización:',
                                                        fontSize: 8,
                                                        bold: true,
                                                        margin: [0, 0, 0, 5]
                                                    },
                                                    {
                                                        text: fecha,
                                                        fontSize: 9,
                                                        color: COLORS.primary,
                                                        bold: true
                                                    }
                                                ]
                                            },
                                            {
                                                width: '33.33%',
                                                stack: [
                                                    {
                                                        text: 'Hora de finalización:',
                                                        fontSize: 8,
                                                        bold: true,
                                                        margin: [0, 0, 0, 5]
                                                    },
                                                    {
                                                        text: hora,
                                                        fontSize: 9,
                                                        color: COLORS.primary,
                                                        bold: true
                                                    }
                                                ]
                                            },
                                            {
                                                width: '33.33%',
                                                stack: [
                                                    {
                                                        text: 'Ejecutor:',
                                                        fontSize: 8,
                                                        bold: true,
                                                        margin: [0, 0, 0, 5]
                                                    },
                                                    {
                                                        text: test.executor || contextInfo.executorGlobal || 'No especificado',
                                                        fontSize: 9,
                                                        color: COLORS.primary,
                                                        bold: true
                                                    }
                                                ]
                                            }
                                        ],
                                        columnGap: 20
                                    }
                                ],
                                fillColor: COLORS.background,
                                margin: [15, 15, 15, 15]
                            }
                        ]
                    ]
                },
                layout: {
                    hLineWidth: function () { return 1; },
                    vLineWidth: function () { return 1; },
                    hLineColor: function () { return COLORS.neutral; },
                    vLineColor: function () { return COLORS.neutral; }
                },
                margin: [0, 0, 0, 0]
            }
        );

        // PageBreak para separar de la siguiente carátula (NO agregar si es la última prueba)
        if (!isLastTest) {
            content.push({
                text: '',
                pageBreak: 'after'
            });
        }
    }

    return content;
}


/*
Construir portada profesional LANDSCAPE para PDF de PROYECTO
 */
function buildProjectCoverPage(projectData, globalStats, exportData) {
    const projectName = projectData.systemInfo?.nombreSistema || 'Sistema sin nombre';
    const empresa = 'Emara SRL';
    const executor = projectData.executor || 'No especificado';

    // Fecha de finalizacion (usar la mas reciente de las pruebas)
    let fechaFinalizacion = new Date();
    if (projectData.tests && projectData.tests.length > 0) {
        const fechas = projectData.tests
            .filter(t => t.finalizationDate)
            .map(t => new Date(t.finalizationDate));
        if (fechas.length > 0) {
            fechaFinalizacion = new Date(Math.max(...fechas));
        }
    }

    const fechaStr = fechaFinalizacion.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    // Código del documento (ingresado por el usuario)
    const fecha = new Date();
    const docId = (exportData && exportData.documentCode) || `PROJ-${projectName.substring(0, 4).toUpperCase()}-${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(fecha.getDate()).padStart(2, '0')}`;

    // Protocolo: usar el código del documento como referencia principal
    const protocolCode = docId;

    return [
        // FONDO AZUL - Solo para esta página (portada)
        {
            canvas: [{
                type: 'rect',
                x: 0, y: 0,
                w: 842, h: 596,
                color: COLORS.primary
            }],
            absolutePosition: { x: 0, y: 0 }
        },

        // HEADER: DRP ASSURANCE
        {
            text: 'DRP ASSURANCE',
            fontSize: 24,
            bold: true,
            color: COLORS.white,
            alignment: 'center',
            margin: [0, 20, 0, 5]
        },
        {
            text: 'DOCUMENTACION DE CALIDAD GxP',
            fontSize: 14,
            bold: true,
            color: COLORS.white,
            alignment: 'center',
            margin: [0, 0, 0, 3]
        },
        {
            text: 'Evidencias de Calificacion del Sistema',
            fontSize: 10,
            color: COLORS.accent,
            alignment: 'center',
            margin: [0, 0, 0, 15]
        },

        // LINEA VERDE SEPARADORA
        {
            canvas: [
                {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 762,
                    y2: 0,
                    lineWidth: 3,
                    lineColor: COLORS.accent
                }
            ],
            margin: [0, 0, 0, 20]
        },

        // CAJAS DE INFORMACION (MISMO ANCHO)
        {
            columns: [
                {
                    width: '48%',
                    table: {
                        widths: ['*'],
                        body: [
                            [
                                {
                                    stack: [
                                        {
                                            text: 'SISTEMA EVALUADO',
                                            fontSize: 8,
                                            color: COLORS.accent,
                                            bold: true,
                                            margin: [0, 0, 0, 6]
                                        },
                                        {
                                            text: projectName,
                                            fontSize: 13,
                                            color: COLORS.white,
                                            bold: true,
                                            margin: [0, 0, 0, 10]
                                        },
                                        {
                                            text: 'EMPRESA',
                                            fontSize: 8,
                                            color: COLORS.accent,
                                            bold: true,
                                            margin: [0, 0, 0, 4]
                                        },
                                        {
                                            text: empresa,
                                            fontSize: 10,
                                            color: COLORS.white,
                                            margin: [0, 0, 0, 0]
                                        }
                                    ],
                                    fillColor: COLORS.secondary,
                                    margin: [12, 12, 12, 12],
                                    border: [false, false, false, false]
                                }
                            ]
                        ]
                    },
                    layout: {
                        hLineWidth: () => 0,
                        vLineWidth: () => 0
                    }
                },
                {
                    width: '4%',
                    text: ''
                },
                {
                    width: '48%',
                    table: {
                        widths: ['*'],
                        body: [
                            [
                                {
                                    stack: [
                                        {
                                            text: 'PROTOCOLO',
                                            fontSize: 8,
                                            color: COLORS.accent,
                                            bold: true,
                                            margin: [0, 0, 0, 6]
                                        },
                                        {
                                            text: protocolCode,
                                            fontSize: 10,
                                            color: COLORS.white,
                                            bold: true,
                                            margin: [0, 0, 0, 10]
                                        },
                                        {
                                            text: 'ESTADO',
                                            fontSize: 8,
                                            color: COLORS.accent,
                                            bold: true,
                                            margin: [0, 0, 0, 4]
                                        },
                                        {
                                            text: 'FINALIZADO',
                                            fontSize: 10,
                                            color: COLORS.pass,
                                            bold: true,
                                            margin: [0, 0, 0, 0]
                                        }
                                    ],
                                    fillColor: COLORS.secondary,
                                    margin: [12, 12, 12, 12],
                                    border: [false, false, false, false]
                                }
                            ]
                        ]
                    },
                    layout: {
                        hLineWidth: () => 0,
                        vLineWidth: () => 0
                    }
                }
            ],
            margin: [60, 0, 60, 30]
        },

        // NOMBRE DEL SISTEMA (GRANDE)
        {
            text: projectName.toUpperCase(),
            fontSize: 32,
            bold: true,
            color: COLORS.white,
            alignment: 'center',
            margin: [0, 15, 0, 35],
            characterSpacing: 2
        },

        // BADGE DE CONFIANZA
        {
            table: {
                widths: ['*'],
                body: [
                    [
                        {
                            stack: [
                                {
                                    text: `${globalStats.totalEvidences} EVIDENCIAS DOCUMENTADAS`,
                                    fontSize: 15,
                                    bold: true,
                                    color: '#000000',  // Negro PURO para máximo contraste
                                    alignment: 'center',
                                    margin: [0, 0, 0, 8]
                                },
                                {
                                    text: `${globalStats.totalGroups} Carpetas  |  ${globalStats.totalTests} Pruebas  |  Hash verificado`,
                                    fontSize: 10,
                                    color: COLORS.primary,  // Azul oscuro
                                    bold: true,
                                    alignment: 'center'
                                }
                            ],
                            fillColor: COLORS.accent,
                            margin: [25, 15, 25, 15],
                            border: [false, false, false, false]
                        }
                    ]
                ]
            },
            layout: {
                hLineWidth: () => 0,
                vLineWidth: () => 0
            },
            margin: [180, 0, 180, 25]
        },

        // EJECUTOR Y FECHA
        {
            columns: [
                {
                    width: '50%',
                    stack: [
                        {
                            text: 'EJECUTOR',
                            fontSize: 8,
                            color: COLORS.accent,
                            bold: true,
                            alignment: 'center',
                            margin: [0, 0, 0, 4]
                        },
                        {
                            text: executor,
                            fontSize: 11,
                            color: COLORS.white,
                            bold: true,
                            alignment: 'center'
                        }
                    ]
                },
                {
                    width: '50%',
                    stack: [
                        {
                            text: 'FECHA DE FINALIZACIÓN',
                            fontSize: 8,
                            color: COLORS.accent,
                            bold: true,
                            alignment: 'center',
                            margin: [0, 0, 0, 4]
                        },
                        {
                            text: fechaStr,
                            fontSize: 11,
                            color: COLORS.white,
                            bold: true,
                            alignment: 'center'
                        }
                    ]
                }
            ],
            margin: [100, 0, 100, 25]
        },

        // LINEA VERDE SEPARADORA INFERIOR
        {
            canvas: [
                {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 762,
                    y2: 0,
                    lineWidth: 3,
                    lineColor: COLORS.accent
                }
            ],
            margin: [0, 0, 0, 10]
        },

        // FOOTER: TRAZABILIDAD
        {
            columns: [
                {
                    width: '100%',
                    stack: [
                        {
                            text: `ID: ${docId} | Emitido: ${fecha.toLocaleDateString('es-AR')}`,
                            fontSize: 7,
                            color: COLORS.white,
                            alignment: 'center'
                        },
                        {
                            text: 'Version GAMP 5 Segunda Edicion | Documento con integridad verificada',
                            fontSize: 6,
                            color: COLORS.accent,
                            alignment: 'center',
                            margin: [0, 2, 0, 0]
                        }
                    ]
                }
            ],
            margin: [60, 0, 60, 0]
        }
    ];
}
/**
 * Construir resumen ejecutivo del proyecto (2 paginas landscape)
 * Dashboard con stats visuales
 */
function buildProjectExecutiveSummary(projectData, exportData, globalStats) {
    const duracionDias = Math.ceil((new Date(exportData.fechaFin) - new Date(exportData.fechaInicio)) / (1000 * 60 * 60 * 24));
    // Conformidad basada en resultados de PRUEBAS (PASA + PASA CON OBS = conformes)
    const conformidad = globalStats.totalTests > 0
        ? Math.round(((globalStats.pasa + globalStats.pasaObs) / globalStats.totalTests) * 100)
        : 0;
    const confColor = conformidad === 100 ? COLORS.pass : (conformidad >= 80 ? COLORS.passObs : COLORS.fail);

    // Helper: caja KPI con numero grande
    function kpiBox(valor, label, color) {
        return {
            width: '25%',
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: valor, fontSize: 30, bold: true, color: color || COLORS.primary, alignment: 'center', margin: [0, 0, 0, 4] },
                        { text: label, fontSize: 7, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1 }
                    ],
                    fillColor: COLORS.background,
                    margin: [8, 12, 8, 12],
                    border: [false, false, false, false]
                }]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
        };
    }

    // Helper: seccion con titulo y linea
    function sectionHeader(titulo) {
        return {
            table: { widths: ['*'], body: [[{
                text: titulo, fontSize: 9, bold: true, color: COLORS.white,
                fillColor: COLORS.primary, margin: [8, 5, 8, 5], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 8]
        };
    }

    const page1 = [
        // HEADER - Titulo con impacto
        {
            table: { widths: ['*'], body: [[{
                stack: [
                    { text: 'RESUMEN EJECUTIVO', fontSize: 22, bold: true, color: COLORS.white, alignment: 'center', characterSpacing: 3 },
                    { text: projectData.systemInfo?.nombreSistema || 'Sistema', fontSize: 11, color: COLORS.accent, alignment: 'center', margin: [0, 8, 0, 0], bold: true }
                ],
                fillColor: COLORS.primary, margin: [20, 20, 20, 20], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 0]
        },

        // Barra de acento
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [4] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, 0, 0, 15] },

        // IDENTIFICACIÓN - 2 filas
        {
            columns: [
                {
                    width: '50%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: 'SISTEMA EVALUADO', fontSize: 7, color: COLORS.accent, bold: true, characterSpacing: 1 },
                            { text: projectData.systemInfo?.nombreSistema || 'Sin nombre', fontSize: 11, color: COLORS.primary, bold: true, margin: [0, 4, 0, 2] },
                            { text: exportData.version || 'v1.0', fontSize: 8, color: COLORS.neutral }
                        ],
                        margin: [10, 10, 10, 10], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: (i, node) => i === node.table.body.length ? 2 : 0, vLineWidth: () => 0, hLineColor: () => COLORS.accent }
                },
                { width: '2%', text: '' },
                {
                    width: '48%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: 'CLASIFICACION GAMP', fontSize: 7, color: COLORS.accent, bold: true, characterSpacing: 1 },
                            { text: `Categoria ${exportData.gampCategory} | Criticidad: ${exportData.criticidad}`, fontSize: 10, color: COLORS.primary, bold: true, margin: [0, 4, 0, 2] },
                            { text: 'Risk-based Approach', fontSize: 8, color: COLORS.neutral }
                        ],
                        margin: [10, 10, 10, 10], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: (i, node) => i === node.table.body.length ? 2 : 0, vLineWidth: () => 0, hLineColor: () => COLORS.primary }
                }
            ],
            margin: [40, 0, 40, 8]
        },
        // Marco regulatorio - fila completa
        {
            table: { widths: ['*'], body: [[{
                stack: [
                    { text: 'MARCO REGULATORIO', fontSize: 7, color: COLORS.accent, bold: true, characterSpacing: 1 },
                    { text: (exportData.marcoRegulatorio || 'GAMP 5').substring(0, 200), fontSize: 8, color: COLORS.primary, margin: [0, 4, 0, 0], lineHeight: 1.2 }
                ],
                margin: [10, 8, 10, 8], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: (i, node) => i === node.table.body.length ? 2 : 0, vLineWidth: () => 0, hLineColor: () => COLORS.secondary },
            margin: [40, 0, 40, 15]
        },

        // KPI DASHBOARD - 4 métricas grandes
        sectionHeader('METRICAS DE EJECUCION'),
        {
            columns: [
                kpiBox(globalStats.totalGroups.toString(), 'SECCIONES', COLORS.primary),
                kpiBox(globalStats.totalTests.toString(), 'PRUEBAS', COLORS.secondary),
                kpiBox(globalStats.totalEvidences.toString(), 'EVIDENCIAS', COLORS.primary),
                kpiBox(`${conformidad}%`, 'CONFORMIDAD', confColor)
            ],
            columnGap: 8,
            margin: [40, 0, 40, 15]
        },

        // TIMELINE
        sectionHeader('CRONOGRAMA DE EJECUCION'),
        {
            table: {
                widths: ['20%', '*', '20%'],
                body: [[
                    {
                        stack: [
                            { text: 'INICIO', fontSize: 7, color: COLORS.neutral, bold: true },
                            { text: exportData.fechaInicio, fontSize: 10, color: COLORS.primary, bold: true, margin: [0, 3, 0, 0] }
                        ],
                        margin: [10, 8, 10, 8], border: [false, false, false, false]
                    },
                    {
                        stack: [
                            { text: `${duracionDias} DIAS DE EJECUCION`, fontSize: 8, color: COLORS.white, bold: true, alignment: 'center', characterSpacing: 1 },
                            {
                                table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [6] },
                                layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                                margin: [20, 6, 20, 0]
                            }
                        ],
                        fillColor: COLORS.secondary, margin: [15, 10, 15, 10], border: [false, false, false, false]
                    },
                    {
                        stack: [
                            { text: 'FIN', fontSize: 7, color: COLORS.neutral, bold: true, alignment: 'right' },
                            { text: exportData.fechaFin, fontSize: 10, color: COLORS.primary, bold: true, alignment: 'right', margin: [0, 3, 0, 0] }
                        ],
                        margin: [10, 8, 10, 8], border: [false, false, false, false]
                    }
                ]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [40, 0, 40, 12]
        },

        // SECCIONES EVALUADAS
        sectionHeader('COBERTURA POR SECCION')
    ];

    // Barras de carpetas
    const folders = projectData.groups || [];
    const barMaxW = 180;
    folders.forEach((folder, idx) => {
        const folderTests = (projectData.tests || []).filter(t => t.groupId === folder.id);
        // Contar resultados a nivel de PRUEBA (no evidencia)
        let fPasa = 0, fTotal = folderTests.length, fObs = 0, fFail = 0;
        folderTests.forEach(t => {
            const r = (t.resultado || 'PASA').toUpperCase().trim();
            if (r === 'PASA' || r === 'OK') fPasa++;
            else if (r === 'PASA CON OBSERVACIONES') { fPasa++; fObs++; }
            else if (r === 'NO PASA' || r === 'NOK') fFail++;
        });
        const completitud = fTotal > 0 ? Math.round(((fPasa) / fTotal) * 100) : 0;
        const barColor = fFail > 0 ? COLORS.fail : (fObs > 0 ? COLORS.passObs : COLORS.pass);

        page1.push({
            columns: [
                { width: '30%', text: folder.name.substring(0, 40), fontSize: 8, color: COLORS.text, bold: true, margin: [0, 2, 0, 0] },
                {
                    width: '48%',
                    canvas: [
                        { type: 'rect', x: 0, y: 0, w: barMaxW, h: 12, r: 2, color: '#E8ECF0' },
                        { type: 'rect', x: 0, y: 0, w: Math.max(2, Math.round((completitud / 100) * barMaxW)), h: 12, r: 2, color: barColor }
                    ]
                },
                { width: '22%', text: `${completitud}% (${folderTests.length} pruebas)`, fontSize: 8, color: completitud === 100 ? COLORS.pass : COLORS.text, alignment: 'right', margin: [0, 2, 0, 0] }
            ],
            margin: [30, 0, 30, 4]
        });
    });

    // PAGINA 2 - Metodologia + Equipo + Distribucion de resultados
    const page2 = [
        {
            table: { widths: ['*'], body: [[{
                text: 'DETALLE METODOLOGICO Y EQUIPO', fontSize: 16, bold: true, color: COLORS.white, alignment: 'center', characterSpacing: 2,
                fillColor: COLORS.primary, margin: [20, 15, 20, 15], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 0],
            pageBreak: 'before'
        },
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [4] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, 0, 0, 20] },

        // Dos columnas: Metodologia + Distribucion
        {
            columns: [
                {
                    width: '55%',
                    stack: [
                        sectionHeader('METODOLOGIA APLICADA'),
                        {
                            table: {
                                widths: [80, '*'],
                                body: [
                                    [
                                        { text: 'Marco Reg.', fontSize: 7, bold: true, color: COLORS.primary, border: [false, false, false, true], margin: [4, 4, 4, 4] },
                                        { text: (exportData.marcoRegulatorio || 'No especificado').substring(0, 80), fontSize: 7, color: COLORS.text, border: [false, false, false, true], margin: [4, 4, 4, 4] }
                                    ],
                                    [
                                        { text: 'Estandar', fontSize: 7, bold: true, color: COLORS.primary, border: [false, false, false, true], margin: [4, 4, 4, 4] },
                                        { text: 'GAMP 5 2da Ed. (2022)', fontSize: 7, color: COLORS.text, border: [false, false, false, true], margin: [4, 4, 4, 4] }
                                    ],
                                    [
                                        { text: 'Enfoque', fontSize: 7, bold: true, color: COLORS.primary, border: [false, false, false, true], margin: [4, 4, 4, 4] },
                                        { text: 'Basado en riesgo', fontSize: 7, color: COLORS.text, border: [false, false, false, true], margin: [4, 4, 4, 4] }
                                    ],
                                    [
                                        { text: 'Cat. GAMP', fontSize: 7, bold: true, color: COLORS.primary, border: [false, false, false, false], margin: [4, 4, 4, 4] },
                                        { text: `Cat. ${exportData.gampCategory} - ${exportData.criticidad}`, fontSize: 7, color: COLORS.text, border: [false, false, false, false], margin: [4, 4, 4, 4] }
                                    ]
                                ]
                            },
                            layout: {
                                hLineWidth: (i) => i > 0 ? 0.5 : 0, vLineWidth: () => 0,
                                hLineColor: () => '#E8ECF0'
                            },
                            margin: [0, 0, 15, 20]
                        }
                    ]
                },
                {
                    width: '45%',
                    stack: [
                        sectionHeader('DISTRIBUCION DE RESULTADOS'),
                        // Mini tabla de resultados
                        {
                            table: {
                                widths: ['*', 40, 35],
                                body: [
                                    [
                                        { text: 'Resultado', fontSize: 7, bold: true, color: COLORS.primary, fillColor: COLORS.background, margin: [4, 4, 4, 4] },
                                        { text: 'Cant.', fontSize: 7, bold: true, color: COLORS.primary, fillColor: COLORS.background, alignment: 'center', margin: [4, 4, 4, 4] },
                                        { text: '%', fontSize: 7, bold: true, color: COLORS.primary, fillColor: COLORS.background, alignment: 'center', margin: [4, 4, 4, 4] }
                                    ],
                                    [
                                        { text: 'PASA', fontSize: 7, color: COLORS.pass, bold: true, margin: [4, 3, 4, 3] },
                                        { text: globalStats.pasa.toString(), fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3] },
                                        { text: globalStats.totalTests > 0 ? `${Math.round((globalStats.pasa / globalStats.totalTests) * 100)}%` : '0%', fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3] }
                                    ],
                                    [
                                        { text: 'CON OBS.', fontSize: 7, color: COLORS.passObs, bold: true, margin: [4, 3, 4, 3], fillColor: COLORS.background },
                                        { text: globalStats.pasaObs.toString(), fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3], fillColor: COLORS.background },
                                        { text: globalStats.totalTests > 0 ? `${Math.round((globalStats.pasaObs / globalStats.totalTests) * 100)}%` : '0%', fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3], fillColor: COLORS.background }
                                    ],
                                    [
                                        { text: 'NO PASA', fontSize: 7, color: COLORS.fail, bold: true, margin: [4, 3, 4, 3] },
                                        { text: globalStats.noPasa.toString(), fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3] },
                                        { text: globalStats.totalTests > 0 ? `${Math.round((globalStats.noPasa / globalStats.totalTests) * 100)}%` : '0%', fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3] }
                                    ],
                                    [
                                        { text: 'N/A', fontSize: 7, color: COLORS.neutral, bold: true, margin: [4, 3, 4, 3], fillColor: COLORS.background },
                                        { text: (globalStats.noAplica || 0).toString(), fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3], fillColor: COLORS.background },
                                        { text: globalStats.totalTests > 0 ? `${Math.round(((globalStats.noAplica || 0) / globalStats.totalTests) * 100)}%` : '0%', fontSize: 7, alignment: 'center', margin: [4, 3, 4, 3], fillColor: COLORS.background }
                                    ]
                                ]
                            },
                            layout: {
                                hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                                hLineColor: () => '#E8ECF0', vLineColor: () => '#E8ECF0'
                            },
                            margin: [0, 0, 0, 20]
                        }
                    ]
                }
            ],
            margin: [0, 0, 0, 0]
        },

        // ALCANCE DEL SISTEMA
        sectionHeader('ALCANCE DEL SISTEMA'),
        {
            table: { widths: ['*'], body: [[{
                text: exportData.alcance || 'Sin alcance definido',
                fontSize: 9, color: COLORS.text, alignment: 'justify', lineHeight: 1.4,
                fillColor: COLORS.background, margin: [12, 12, 12, 12], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [40, 0, 40, 15]
        }
    ];

    // PROXIMOS PASOS
    if (exportData.proximosPasos) {
        page2.push(
            sectionHeader('PROXIMOS PASOS'),
            {
                text: exportData.proximosPasos,
                fontSize: 9, color: COLORS.text, alignment: 'justify', lineHeight: 1.3,
                margin: [50, 0, 50, 15]
            }
        );
    }

    // EQUIPO DE VALIDACION
    page2.push(
        sectionHeader('EQUIPO DE VALIDACION'),
        {
            table: {
                widths: ['*', '*', '*'],
                body: [[
                    {
                        stack: [
                            { text: 'EJECUTOR', fontSize: 7, color: COLORS.neutral, bold: true, characterSpacing: 1 },
                            { text: exportData.ejecutor || 'No asignado', fontSize: 10, color: COLORS.primary, bold: true, margin: [0, 4, 0, 0] }
                        ],
                        margin: [10, 8, 10, 8], border: [false, false, false, false]
                    },
                    {
                        stack: [
                            { text: 'REVISOR', fontSize: 7, color: COLORS.neutral, bold: true, characterSpacing: 1 },
                            { text: exportData.revisor || 'No asignado', fontSize: 10, color: COLORS.primary, bold: true, margin: [0, 4, 0, 0] }
                        ],
                        margin: [10, 8, 10, 8], border: [false, false, false, false]
                    },
                    {
                        stack: [
                            { text: 'APROBADOR', fontSize: 7, color: COLORS.neutral, bold: true, characterSpacing: 1 },
                            { text: exportData.aprobador || 'No asignado', fontSize: 10, color: COLORS.primary, bold: true, margin: [0, 4, 0, 0] }
                        ],
                        margin: [10, 8, 10, 8], border: [false, false, false, false]
                    }
                ]]
            },
            layout: {
                hLineWidth: (i, node) => i === node.table.body.length ? 2 : 0, vLineWidth: () => 0,
                hLineColor: () => COLORS.accent
            },
            margin: [40, 0, 40, 0]
        }
    );

    return [...page1, ...page2];
}

/**
 * Construir índice jerárquico del proyecto (carpetas → tests)
 * Muestra estructura completa con links clickeables
 */
function buildProjectIndexPage(sessionData, globalStats) {
    const content = [
        // TÍTULO PRINCIPAL
        {
            text: 'ÍNDICE DE CONTENIDO',
            fontSize: 20,
            bold: true,
            color: COLORS.primary,
            alignment: 'center',
            margin: [0, 20, 0, 10],
            pageBreak: 'before'
        },
        // LÍNEA DECORATIVA
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [2] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [40, 0, 40, 30] }
    ];

    // SECCIÓN: CARPETAS Y PRUEBAS
    content.push({
        table: { widths: ['*'], body: [[{ text: 'CARPETAS Y PRUEBAS', fontSize: 14, bold: true, color: COLORS.white, fillColor: COLORS.primary, margin: [10, 8, 10, 8], border: [false, false, false, false] }]] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 0, 0, 20]
    });

    // Agrupar tests por carpeta
    const folders = sessionData.groups || [];

    folders.forEach((folder, folderIdx) => {
        const testsInFolder = (sessionData.tests || []).filter(t => t.groupId === folder.id);
        const totalEvidences = testsInFolder.reduce((sum, t) =>
            sum + t.evidences.filter(e => !e.isEmpty).length, 0);

        // NOMBRE DE CARPETA
        content.push({
            text: `${folderIdx + 1}. ${folder.name.toUpperCase()}`,
            fontSize: 12,
            bold: true,
            color: COLORS.primary,
            margin: [0, folderIdx > 0 ? 15 : 0, 0, 5]
        });

        content.push({
            text: `${testsInFolder.length} prueba${testsInFolder.length !== 1 ? 's' : ''} | ${totalEvidences} evidencia${totalEvidences !== 1 ? 's' : ''}`,
            fontSize: 8,
            color: COLORS.neutral,
            italics: true,
            margin: [20, 0, 0, 8]
        });

        // TESTS DE LA CARPETA
        testsInFolder.forEach((test, testIdx) => {
            const validEvidences = test.evidences.filter(e => !e.isEmpty);

            content.push({
                text: `${folderIdx + 1}.${testIdx + 1} ${test.name}`,
                fontSize: 10,
                color: COLORS.text,
                margin: [30, 3, 0, 3]
            });

            content.push({
                text: `${validEvidences.length} evidencia${validEvidences.length !== 1 ? 's' : ''} | ${test.finalized ? 'Finalizada' : 'En progreso'} | ${test.resultado || 'PASA'}`,
                fontSize: 8,
                color: COLORS.neutral,
                italics: true,
                margin: [50, 0, 0, 5]
            });
        });
    });

    // Tests sin carpeta (si existen)
    const testsWithoutFolder = (sessionData.tests || []).filter(t => !t.groupId);
    if (testsWithoutFolder.length > 0) {
        content.push({
            text: `${folders.length + 1}. PRUEBAS SIN CARPETA`,
            fontSize: 12,
            bold: true,
            color: COLORS.primary,
            margin: [0, 15, 0, 5]
        });

        testsWithoutFolder.forEach((test, testIdx) => {
            const validEvidences = test.evidences.filter(e => !e.isEmpty);

            content.push({
                text: `${folders.length + 1}.${testIdx + 1} ${test.name}`,
                fontSize: 10,
                color: COLORS.text,
                margin: [30, 3, 0, 3]
            });

            content.push({
                text: `${validEvidences.length} evidencia${validEvidences.length !== 1 ? 's' : ''} | ${test.finalized ? 'Finalizada' : 'En progreso'} | ${test.resultado || 'PASA'}`,
                fontSize: 8,
                color: COLORS.neutral,
                italics: true,
                margin: [50, 0, 0, 5]
            });
        });
    }

    return content;
}

/**
 * Construir página separadora de carpeta (página completa landscape)
 * Incluye índice de tests en la misma página para optimizar espacio
 */
function buildFolderSeparatorPage(folder, folderStats, folderNumber, testsInFolder) {
    const testsCount = folderStats.totalTests || 0;
    const evidencesCount = folderStats.totalEvidences || 0;
    const estado = folderStats.finalized ? 'FINALIZADA' : 'EN PROGRESO';
    const estadoColor = folderStats.finalized ? COLORS.pass : COLORS.passObs;

    const content = [
        // Header bar con numero de seccion
        {
            table: { widths: ['*'], body: [[{
                stack: [
                    { text: `SECCION ${folderNumber}`, fontSize: 11, color: COLORS.accent, bold: true, characterSpacing: 3, alignment: 'center' },
                    { text: folder.name.substring(0, 65).toUpperCase(), fontSize: 22, bold: true, color: COLORS.white, alignment: 'center', margin: [20, 12, 20, 0], characterSpacing: 1 }
                ],
                fillColor: COLORS.primary, margin: [20, 25, 20, 25], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 30, 0, 0]
        },

        // Barra de acento
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [4] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, 0, 0, 20] },

        // KPIs de la seccion - 3 metricas
        {
            columns: [
                {
                    width: '33%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: testsCount.toString(), fontSize: 28, bold: true, color: COLORS.primary, alignment: 'center' },
                            { text: `PRUEBA${testsCount !== 1 ? 'S' : ''}`, fontSize: 8, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1 }
                        ],
                        fillColor: COLORS.background, margin: [10, 12, 10, 12], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                },
                {
                    width: '34%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: evidencesCount.toString(), fontSize: 28, bold: true, color: COLORS.primary, alignment: 'center' },
                            { text: `EVIDENCIA${evidencesCount !== 1 ? 'S' : ''}`, fontSize: 8, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1 }
                        ],
                        fillColor: COLORS.background, margin: [10, 12, 10, 12], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                },
                {
                    width: '33%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: estado, fontSize: 14, bold: true, color: estadoColor, alignment: 'center', margin: [0, 6, 0, 0] },
                            { text: 'ESTADO', fontSize: 8, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1, margin: [0, 4, 0, 0] }
                        ],
                        fillColor: COLORS.background, margin: [10, 12, 10, 12], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                }
            ],
            columnGap: 10,
            margin: [80, 0, 80, 20]
        }
    ];

    // INDICE DE PRUEBAS como tabla profesional
    if (testsInFolder && testsInFolder.length > 0) {
        content.push({
            table: { widths: ['*'], body: [[{
                text: 'INDICE DE PRUEBAS', fontSize: 10, bold: true, color: COLORS.white,
                fillColor: COLORS.secondary, margin: [10, 6, 10, 6], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [60, 0, 60, 8]
        });

        const indexRows = [
            [
                { text: '#', fontSize: 8, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [4, 5, 4, 5] },
                { text: 'PRUEBA', fontSize: 8, bold: true, color: COLORS.white, fillColor: COLORS.primary, margin: [8, 5, 4, 5] },
                { text: 'EVIDENCIAS', fontSize: 8, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [4, 5, 4, 5] },
                { text: 'ESTADO', fontSize: 8, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [4, 5, 4, 5] },
                { text: 'RESULTADO', fontSize: 8, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [4, 5, 4, 5] }
            ]
        ];

        const resultColor = { 'PASA': COLORS.pass, 'NO PASA': COLORS.fail, 'PASA CON OBSERVACIONES': COLORS.passObs, 'NO APLICA': COLORS.neutral };

        testsInFolder.forEach((test, idx) => {
            const validEvidences = test.evidences.filter(e => !e.isEmpty);
            const resultado = test.resultado || 'PASA';
            const bg = idx % 2 === 0 ? null : COLORS.background;

            indexRows.push([
                { text: (idx + 1).toString(), fontSize: 8, alignment: 'center', margin: [4, 4, 4, 4], fillColor: bg },
                { text: test.name.substring(0, 55), fontSize: 8, margin: [8, 4, 4, 4], fillColor: bg },
                { text: validEvidences.length.toString(), fontSize: 8, alignment: 'center', margin: [4, 4, 4, 4], fillColor: bg },
                { text: test.finalized ? 'Finalizada' : 'En progreso', fontSize: 8, alignment: 'center', color: test.finalized ? COLORS.pass : COLORS.passObs, margin: [4, 4, 4, 4], fillColor: bg },
                { text: resultado, fontSize: 8, alignment: 'center', bold: true, color: resultColor[resultado] || COLORS.text, margin: [4, 4, 4, 4], fillColor: bg }
            ]);
        });

        content.push({
            table: {
                widths: [30, '*', 65, 70, 85],
                body: indexRows,
                headerRows: 1
            },
            layout: {
                hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                hLineColor: () => '#E8ECF0', vLineColor: () => '#E8ECF0'
            },
            margin: [60, 0, 60, 0]
        });
    }

    return content;
}

/**
 * Construir separador de test - PÁGINA COMPLETA LANDSCAPE
 * Limpio, profesional, con color diferenciado usando tabla segura
 */
function buildTestSeparatorMini(test, testNumber, totalTests, contextInfo) {
    const validEvidences = test.evidences.filter(e => !e.isEmpty);
    const estado = test.finalized ? 'FINALIZADA' : 'EN PROGRESO';
    const resultado = test.resultado || 'PASA';

    const resultColor = { 'PASA': COLORS.pass, 'NO PASA': COLORS.fail, 'PASA CON OBSERVACIONES': COLORS.passObs, 'NO APLICA': COLORS.neutral };
    const resColor = resultColor[resultado] || COLORS.text;

    return [
        // Header compacto con contexto
        {
            table: { widths: ['*'], body: [[{
                stack: [
                    { text: contextInfo.folderName.substring(0, 55).toUpperCase(), fontSize: 9, color: COLORS.accent, bold: true, alignment: 'center', characterSpacing: 2 },
                    { text: `PRUEBA ${testNumber} DE ${totalTests}`, fontSize: 8, color: '#A0B0C0', alignment: 'center', margin: [0, 6, 0, 0] }
                ],
                fillColor: COLORS.primary, margin: [20, 15, 20, 15], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 50, 0, 0]
        },

        // Barra de acento
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [3] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, 0, 0, 0] },

        // Nombre del test - protagonista
        {
            table: { widths: ['*'], body: [[{
                text: test.name.substring(0, 75).toUpperCase(),
                fontSize: 20, bold: true, color: COLORS.white, alignment: 'center', characterSpacing: 1,
                fillColor: COLORS.secondary, margin: [30, 25, 30, 25], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 20]
        },

        // Metricas en 3 columnas
        {
            columns: [
                {
                    width: '33%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: validEvidences.length.toString(), fontSize: 26, bold: true, color: COLORS.primary, alignment: 'center' },
                            { text: 'EVIDENCIAS', fontSize: 7, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1 }
                        ],
                        fillColor: COLORS.background, margin: [8, 10, 8, 10], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                },
                {
                    width: '34%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: resultado, fontSize: 14, bold: true, color: resColor, alignment: 'center', margin: [0, 4, 0, 0] },
                            { text: 'RESULTADO', fontSize: 7, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1, margin: [0, 4, 0, 0] }
                        ],
                        fillColor: COLORS.background, margin: [8, 10, 8, 10], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                },
                {
                    width: '33%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: estado, fontSize: 14, bold: true, color: test.finalized ? COLORS.pass : COLORS.passObs, alignment: 'center', margin: [0, 4, 0, 0] },
                            { text: 'ESTADO', fontSize: 7, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1, margin: [0, 4, 0, 0] }
                        ],
                        fillColor: COLORS.background, margin: [8, 10, 8, 10], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                }
            ],
            columnGap: 10,
            margin: [100, 0, 100, 30]
        },

        // Info contextual
        {
            table: {
                widths: ['*', '*'],
                body: [[
                    { text: `Proyecto: ${(contextInfo.projectName || '').substring(0, 30)}`, fontSize: 7, color: COLORS.neutral, margin: [6, 5, 6, 5], border: [false, false, false, false] },
                    { text: `Protocolo: ${(contextInfo.protocol || '').substring(0, 30)}`, fontSize: 7, color: COLORS.neutral, alignment: 'right', margin: [6, 5, 6, 5], border: [false, false, false, false] }
                ]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [60, 0, 60, 0]
        }
    ];
}

/**
 * Construir tabla de trazabilidad completa del proyecto
 * Carpeta → Prueba → Evidencias (jerarquía completa)
 */
function buildProjectTraceabilityTable(sessionData) {
    const content = [
        // TÍTULO PRINCIPAL
        {
            text: 'TRAZABILIDAD COMPLETA DEL PROYECTO',
            fontSize: 18,
            bold: true,
            color: COLORS.primary,
            alignment: 'center',
            margin: [0, 20, 0, 10]
        },
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [2] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [100, 0, 100, 20] },
        {
            text: 'Registro completo de todas las evidencias ejecutadas durante la validación',
            fontSize: 9,
            color: COLORS.neutral,
            italics: true,
            alignment: 'center',
            margin: [0, 0, 0, 30]
        }
    ];

    const folders = sessionData.groups || [];

    folders.forEach((folder, folderIdx) => {
        const testsInFolder = (sessionData.tests || []).filter(t => t.groupId === folder.id);

        if (testsInFolder.length === 0) return; // Skip carpetas vacías

        // HEADER DE CARPETA - VISIBLE Y CLARO
        content.push(
            // Separador visual
            { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [3] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, folderIdx > 0 ? 25 : 15, 0, 15] },
            // Header de carpeta
            {
                table: {
                    widths: ['*'],
                    body: [[{
                        text: `SECCIÓN ${folderIdx + 1}: ${folder.name.toUpperCase()}`,
                        fontSize: 13,
                        bold: true,
                        color: COLORS.white,
                        fillColor: COLORS.primary,
                        margin: [10, 8, 10, 8],
                        border: [false, false, false, false]
                    }]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                margin: [0, 0, 0, 12]
            }
        );

        // TESTS DE LA CARPETA
        testsInFolder.forEach((test, testIdx) => {
            const validEvidences = test.evidences.filter(e => !e.isEmpty);

            if (validEvidences.length === 0) return; // Skip tests sin evidencias

            // HEADER DE PRUEBA - MÁS VISIBLE
            content.push({
                table: {
                    widths: ['*'],
                    body: [[{
                        stack: [
                            {
                                text: `Prueba: ${test.name}`,
                                fontSize: 11,
                                bold: true,
                                color: COLORS.white,
                                margin: [0, 0, 0, 3]
                            },
                            {
                                text: `${validEvidences.length} evidencia${validEvidences.length !== 1 ? 's' : ''} registrada${validEvidences.length !== 1 ? 's' : ''}`,
                                fontSize: 8,
                                color: COLORS.white,
                                italics: true
                            }
                        ],
                        fillColor: COLORS.secondary,
                        margin: [10, 6, 10, 6],
                        border: [false, false, false, false]
                    }]]
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                margin: [0, testIdx > 0 ? 12 : 0, 0, 8]
            });

            // TABLA DE EVIDENCIAS
            const tableRows = [
                // Header de columnas
                [
                    { text: 'PASO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'OPERACIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'DESCRIPCIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'RESULTADO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [4, 4, 4, 4] },
                    { text: 'EJECUTOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'FECHA/HORA', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [4, 4, 4, 4] }
                ]
            ];

            // Colores por resultado
            const resultadoColor = {
                'PASA': COLORS.pass,
                'NO PASA': COLORS.fail,
                'PASA CON OBSERVACIONES': COLORS.passObs,
                'NO APLICA': COLORS.notApplicable
            };

            // Filas de evidencias
            validEvidences.forEach((evidence, evidIdx) => {
                const fecha = evidence.captureTimestamp || evidence.timestamp;
                const fechaObj = fecha ? new Date(fecha) : new Date();
                const fechaFormato = fechaObj.toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit'
                });
                const horaFormato = fechaObj.toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });

                const executor = evidence.executor || test.executor || sessionData.executor || 'No especificado';
                const resultado = evidence.resultado || 'PASA';
                const color = resultadoColor[resultado] || COLORS.text;
                const desc = evidence.description || evidence.title || 'Sin descripción';

                // Construir celda descripción con datos de prueba (si existen)
                const descStack3 = [
                    { text: desc, fontSize: 8 }
                ];
                const datosPrueba3 = [];
                if (evidence.usuarioPrueba) datosPrueba3.push(evidence.usuarioPrueba);
                if (evidence.rolPrueba) datosPrueba3.push(`(${evidence.rolPrueba})`);
                if (evidence.testCaseRef) datosPrueba3.push(`· ${evidence.testCaseRef}`);
                if (evidence.criterioRef) datosPrueba3.push(`/${evidence.criterioRef}`);
                if (datosPrueba3.length > 0) {
                    descStack3.push({ text: datosPrueba3.join(' '), fontSize: 7, italics: true, color: '#5a5a5a', margin: [0, 2, 0, 0] });
                }

                tableRows.push([
                    {
                        text: String(evidence.step).padStart(3, '0'),
                        fontSize: 8,
                        margin: [4, 4, 4, 4],
                        fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                    },
                    {
                        text: evidence.operacion || 'No especificado',
                        fontSize: 8,
                        margin: [4, 5, 4, 5],
                        fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                    },
                    {
                        stack: descStack3,
                        margin: [4, 5, 4, 5],
                        fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                    },
                    {
                        text: resultado,
                        fontSize: 8,
                        color: color,
                        bold: true,
                        alignment: 'center',
                        margin: [4, 4, 4, 4],
                        fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                    },
                    {
                        text: executor,
                        fontSize: 8,
                        margin: [4, 4, 4, 4],
                        fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                    },
                    {
                        text: `${fechaFormato} ${horaFormato}`,
                        fontSize: 8,
                        alignment: 'center',
                        margin: [4, 4, 4, 4],
                        fillColor: evidIdx % 2 === 0 ? null : COLORS.background
                    }
                ]);
            });

            content.push({
                table: {
                    widths: [40, 100, '*', 70, 90, 75],
                    body: tableRows,
                    headerRows: 1,  // Repetir header en cada página
                    dontBreakRows: true  // No partir filas entre páginas
                },
                layout: {
                    hLineWidth: () => 0.5,
                    vLineWidth: () => 0.5,
                    hLineColor: () => COLORS.neutral,
                    vLineColor: () => COLORS.neutral,
                    paddingLeft: () => 4,
                    paddingRight: () => 4,
                    paddingTop: () => 6,
                    paddingBottom: () => 6
                },
                margin: [0, 0, 0, 0]
            });
        });
    });

    // Tests sin carpeta (si existen)
    const testsWithoutFolder = (sessionData.tests || []).filter(t => !t.groupId);

    if (testsWithoutFolder.length > 0) {
        // Separador visual
        content.push(
            { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [3] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, 25, 0, 15] }
        );
        // Header en tabla para que fillColor funcione
        content.push({
            table: { widths: ['*'], body: [[{ text: 'PRUEBAS SIN CARPETA', fontSize: 12, bold: true, color: COLORS.white, fillColor: COLORS.primary, margin: [10, 8, 10, 8], border: [false, false, false, false] }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 12]
        });

        testsWithoutFolder.forEach((test, testIdx) => {
            const validEvidences = test.evidences.filter(e => !e.isEmpty);
            if (validEvidences.length === 0) return;

            // Header de prueba en tabla
            content.push({
                table: { widths: ['*'], body: [[{
                    stack: [
                        { text: `Prueba: ${test.name}`, fontSize: 11, bold: true, color: COLORS.white, margin: [0, 0, 0, 3] },
                        { text: `${validEvidences.length} evidencia${validEvidences.length !== 1 ? 's' : ''} registrada${validEvidences.length !== 1 ? 's' : ''}`, fontSize: 8, color: COLORS.white, italics: true }
                    ],
                    fillColor: COLORS.secondary, margin: [10, 6, 10, 6], border: [false, false, false, false]
                }]] },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
                margin: [0, testIdx > 0 ? 12 : 0, 0, 8]
            });

            // Tabla de evidencias
            const tableRows = [
                [
                    { text: 'PASO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'OPERACIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'DESCRIPCIÓN', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'RESULTADO', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [4, 4, 4, 4] },
                    { text: 'EJECUTOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, margin: [4, 4, 4, 4] },
                    { text: 'FECHA/HORA', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 8, alignment: 'center', margin: [4, 4, 4, 4] }
                ]
            ];

            const resultadoColorMap = { 'PASA': COLORS.pass, 'NO PASA': COLORS.fail, 'PASA CON OBSERVACIONES': COLORS.passObs, 'NO APLICA': COLORS.notApplicable };

            validEvidences.forEach((evidence, evidIdx) => {
                const fecha = evidence.captureTimestamp || evidence.timestamp;
                const fechaObj = fecha ? new Date(fecha) : new Date();
                const fechaFormato = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                const horaFormato = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
                const executor = evidence.executor || test.executor || sessionData.executor || 'No especificado';
                const resultado = evidence.resultado || 'PASA';
                const bg = evidIdx % 2 === 0 ? null : COLORS.background;

                tableRows.push([
                    { text: String(evidence.step).padStart(3, '0'), fontSize: 8, margin: [4, 4, 4, 4], fillColor: bg },
                    { text: evidence.operacion || 'No especificado', fontSize: 8, margin: [4, 5, 4, 5], fillColor: bg },
                    { text: evidence.description || 'Sin descripción', fontSize: 8, margin: [4, 5, 4, 5], fillColor: bg },
                    { text: resultado, fontSize: 8, color: resultadoColorMap[resultado] || COLORS.text, bold: true, alignment: 'center', margin: [4, 4, 4, 4], fillColor: bg },
                    { text: executor, fontSize: 8, margin: [4, 4, 4, 4], fillColor: bg },
                    { text: `${fechaFormato} ${horaFormato}`, fontSize: 8, alignment: 'center', margin: [4, 4, 4, 4], fillColor: bg }
                ]);
            });

            content.push({
                table: { widths: [40, 100, '*', 70, 90, 75], body: tableRows, headerRows: 1, dontBreakRows: true },
                layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => COLORS.neutral, vLineColor: () => COLORS.neutral, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 6, paddingBottom: () => 6 },
                margin: [0, 0, 0, 0]
            });
        });
    }

    return content;
}

/**
 * Pagina de documentacion asociada no ejecutable
 * Lista los documentos adjuntados al proyecto como referencia
 */
function buildAssociatedDocsPage(docs) {
    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };
    const totalSize = docs.reduce((s, d) => s + (d.size || 0), 0);

    const content = [
        // Header
        {
            table: { widths: ['*'], body: [[{
                stack: [
                    { text: 'DOCUMENTACION ASOCIADA', fontSize: 18, bold: true, color: COLORS.white, alignment: 'center', characterSpacing: 2 },
                    { text: 'Registro de Documentacion No Ejecutable', fontSize: 9, color: COLORS.accent, alignment: 'center', margin: [0, 6, 0, 0] }
                ],
                fillColor: COLORS.primary, margin: [20, 18, 20, 18], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, 0, 0]
        },
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [3] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, 0, 0, 15] },

        // Descripcion
        {
            table: { widths: ['*'], body: [[{
                text: 'Los siguientes documentos fueron adjuntados como referencia y soporte documental del proceso de validacion. Estos documentos no contienen casos de prueba ejecutables y se encuentran disponibles en el paquete de exportacion RAW DATA bajo la carpeta Documentacion_Asociada/.',
                fontSize: 9, color: COLORS.text, alignment: 'justify', lineHeight: 1.3,
                fillColor: COLORS.background, margin: [12, 10, 12, 10], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [40, 0, 40, 12]
        },

        // KPIs compactos
        {
            columns: [
                {
                    width: '33%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: docs.length.toString(), fontSize: 22, bold: true, color: COLORS.primary, alignment: 'center' },
                            { text: 'DOCUMENTOS', fontSize: 7, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1 }
                        ], fillColor: COLORS.background, margin: [8, 8, 8, 8], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                },
                {
                    width: '34%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: formatSize(totalSize), fontSize: 22, bold: true, color: COLORS.primary, alignment: 'center' },
                            { text: 'TAMAÑO TOTAL', fontSize: 7, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1 }
                        ], fillColor: COLORS.background, margin: [8, 8, 8, 8], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                },
                {
                    width: '33%',
                    table: { widths: ['*'], body: [[{
                        stack: [
                            { text: new Set(docs.map(d => d.category || 'General')).size.toString(), fontSize: 22, bold: true, color: COLORS.primary, alignment: 'center' },
                            { text: 'CATEGORIAS', fontSize: 7, color: COLORS.neutral, alignment: 'center', bold: true, characterSpacing: 1 }
                        ], fillColor: COLORS.background, margin: [8, 8, 8, 8], border: [false, false, false, false]
                    }]] },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0 }
                }
            ],
            columnGap: 8,
            margin: [60, 0, 60, 15]
        }
    ];

    // Agrupar por categoría
    const byCategory = {};
    docs.forEach(doc => {
        const cat = doc.category || 'Documento General';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(doc);
    });

    // Una tabla por categoría para mejor trazabilidad
    const categories = Object.keys(byCategory).sort();
    let globalIdx = 0;

    categories.forEach(cat => {
        // Header de categoria
        content.push({
            table: { widths: ['*'], body: [[{
                text: cat.toUpperCase(), fontSize: 9, bold: true, color: COLORS.white,
                fillColor: COLORS.secondary, margin: [10, 5, 10, 5], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [40, 8, 40, 4]
        });

        const tableRows = [
            [
                { text: 'REF', fontSize: 7, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [3, 4, 3, 4] },
                { text: 'NOMBRE DEL DOCUMENTO', fontSize: 7, bold: true, color: COLORS.white, fillColor: COLORS.primary, margin: [6, 4, 4, 4] },
                { text: 'FORMATO', fontSize: 7, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [3, 4, 3, 4] },
                { text: 'TAMAÑO', fontSize: 7, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [3, 4, 3, 4] },
                { text: 'ADJUNTADO', fontSize: 7, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [3, 4, 3, 4] },
                { text: 'UBICACION EN PAQUETE', fontSize: 7, bold: true, color: COLORS.white, fillColor: COLORS.primary, alignment: 'center', margin: [3, 4, 3, 4] }
            ]
        ];

        byCategory[cat].forEach(doc => {
            globalIdx++;
            const bg = globalIdx % 2 === 0 ? COLORS.background : null;
            const ext = doc.name.split('.').pop().toUpperCase();
            const safeCat = (cat).replace(/[^a-zA-Z0-9_\- ]/g, '_');
            const zipPath = `Documentacion_Asociada/${safeCat}/`;

            tableRows.push([
                { text: `DOC-${String(globalIdx).padStart(3, '0')}`, fontSize: 7, alignment: 'center', color: COLORS.primary, bold: true, margin: [3, 3, 3, 3], fillColor: bg },
                { text: doc.name, fontSize: 7, margin: [6, 3, 4, 3], fillColor: bg, bold: true },
                { text: ext, fontSize: 7, alignment: 'center', margin: [3, 3, 3, 3], fillColor: bg },
                { text: formatSize(doc.size), fontSize: 7, alignment: 'center', margin: [3, 3, 3, 3], fillColor: bg },
                { text: new Date(doc.addedDate).toLocaleDateString('es-AR'), fontSize: 7, alignment: 'center', margin: [3, 3, 3, 3], fillColor: bg },
                { text: zipPath, fontSize: 6, alignment: 'center', color: COLORS.neutral, margin: [3, 3, 3, 3], fillColor: bg }
            ]);
        });

        content.push({
            table: {
                widths: [40, '*', 40, 45, 55, 110],
                body: tableRows,
                headerRows: 1,
                dontBreakRows: true
            },
            layout: {
                hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                hLineColor: () => '#E8ECF0', vLineColor: () => '#E8ECF0'
            },
            margin: [40, 0, 40, 0]
        });
    });

    // Nota de trazabilidad
    content.push({
        table: { widths: ['*'], body: [[{
            stack: [
                { text: 'NOTA DE TRAZABILIDAD', fontSize: 8, bold: true, color: COLORS.primary, margin: [0, 0, 0, 4] },
                { text: `Total: ${docs.length} documento${docs.length !== 1 ? 's' : ''} registrado${docs.length !== 1 ? 's' : ''} (${formatSize(totalSize)})`, fontSize: 8, color: COLORS.text },
                { text: `Categorias documentadas: ${categories.join(' | ')}`, fontSize: 7, color: COLORS.neutral, margin: [0, 3, 0, 3] },
                { text: 'Los archivos originales se encuentran disponibles en el paquete de exportacion ZIP bajo la carpeta Documentacion_Asociada/, organizados por categoria. Cada documento conserva su formato original.', fontSize: 7, color: COLORS.neutral, italics: true, lineHeight: 1.3 }
            ],
            fillColor: COLORS.background, margin: [12, 10, 12, 10], border: [false, false, false, false]
        }]] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [40, 12, 40, 0]
    });

    return content;
}

function buildProjectConclusionPage(projectData) {
    const resultadoColor = {
        'PASA': COLORS.pass,
        'NO PASA': COLORS.fail,
        'PASA CON OBSERVACIONES': COLORS.passObs,
        'NO APLICA': COLORS.notApplicable
    };
    const resultado = projectData.resultado || 'PASA';
    const resColor = resultadoColor[resultado] || COLORS.text;

    return [
        // Linea decorativa superior
        { table: { widths: ['*'], body: [[{ text: '', fillColor: COLORS.accent, border: [false,false,false,false], margin: [0,0,0,0] }]], heights: [4] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0 }, margin: [0, 30, 0, 25] },

        // Titulo
        {
            text: 'CONCLUSIÓN FINAL DEL PROYECTO',
            fontSize: 18,
            bold: true,
            color: COLORS.primary,
            alignment: 'center',
            margin: [0, 0, 0, 20]
        },

        // Badge de resultado
        {
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'RESULTADO FINAL', fontSize: 9, color: COLORS.white, alignment: 'center', margin: [0, 0, 0, 6] },
                        { text: resultado, fontSize: 22, bold: true, color: COLORS.white, alignment: 'center', characterSpacing: 2 }
                    ],
                    fillColor: resColor,
                    margin: [20, 12, 20, 12],
                    border: [false, false, false, false]
                }]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [180, 0, 180, 25]
        },

        // Caja de conclusion
        {
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: 'DICTAMEN', fontSize: 10, bold: true, color: COLORS.primary, margin: [0, 0, 0, 10] },
                        { text: projectData.conclusion, fontSize: 10, color: COLORS.text, alignment: 'justify', lineHeight: 1.4 }
                    ],
                    fillColor: COLORS.background,
                    margin: [15, 15, 15, 15],
                    border: [false, false, false, false]
                }]]
            },
            layout: {
                hLineWidth: () => 1, vLineWidth: () => 1,
                hLineColor: () => COLORS.neutral, vLineColor: () => COLORS.neutral
            },
            margin: [60, 0, 60, 20]
        },

        // Fecha de finalización
        {
            text: `Fecha de cierre: ${new Date(projectData.finalizedDate).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}`,
            fontSize: 9,
            color: COLORS.neutral,
            alignment: 'right',
            margin: [60, 5, 60, 0]
        }
    ];
}
/* Construir página de firmas y hash final */

function buildProjectSignaturesPage(exportData) {
    const fecha = new Date();
    const fechaEmision = fecha.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    // Determinar qué firmantes están presentes
    const tieneEjecutor = exportData.ejecutor && exportData.ejecutor.trim() !== '';
    const tieneRevisor = exportData.revisor && exportData.revisor.trim() !== '';
    const tieneAprobador = exportData.aprobador && exportData.aprobador.trim() !== '';

    // Construir tabla dinámica
    let tableWidths = [];
    let headerRow = [];
    let nombresRow = [];
    let firmasRow = [];
    let fechasRow = [];

    // Helper: construir celda de firma (imagen si existe, línea si no)
    function buildSignatureCell(role, nombre) {
        let sigData = null;
        try { sigData = typeof getSignatureByRole === 'function' ? getSignatureByRole(role) : null; } catch (e) {}

        if (sigData && sigData.image) {
            return {
                stack: [
                    { image: sigData.image, width: 120, height: 45, alignment: 'center', margin: [0, 8, 0, 4] },
                    { text: sigData.name, fontSize: 8, color: COLORS.neutral, alignment: 'center', italics: true }
                ],
                margin: [10, 5, 10, 5]
            };
        }
        return { text: 'Firma: _________________', fontSize: 9, alignment: 'center', margin: [10, 30, 10, 5] };
    }

    if (tieneEjecutor) {
        tableWidths.push('*');
        headerRow.push({ text: 'EJECUTOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 10, alignment: 'center', margin: [10, 10, 10, 10] });
        nombresRow.push({ text: exportData.ejecutor, fontSize: 10, alignment: 'center', margin: [10, 15, 10, 5] });
        firmasRow.push(buildSignatureCell('ejecutor', exportData.ejecutor));
        fechasRow.push({ text: `Fecha: ${fechaEmision}`, fontSize: 9, alignment: 'center', margin: [10, 5, 10, 15] });
    }

    if (tieneRevisor) {
        tableWidths.push('*');
        headerRow.push({ text: 'REVISOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 10, alignment: 'center', margin: [10, 10, 10, 10] });
        nombresRow.push({ text: exportData.revisor, fontSize: 10, alignment: 'center', margin: [10, 15, 10, 5] });
        firmasRow.push(buildSignatureCell('revisor', exportData.revisor));
        fechasRow.push({ text: 'Fecha: _____________', fontSize: 9, alignment: 'center', margin: [10, 5, 10, 15] });
    }

    if (tieneAprobador) {
        tableWidths.push('*');
        headerRow.push({ text: 'APROBADOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 10, alignment: 'center', margin: [10, 10, 10, 10] });
        nombresRow.push({ text: exportData.aprobador, fontSize: 10, alignment: 'center', margin: [10, 15, 10, 5] });
        firmasRow.push(buildSignatureCell('aprobador', exportData.aprobador));
        fechasRow.push({ text: 'Fecha: _____________', fontSize: 9, alignment: 'center', margin: [10, 5, 10, 15] });
    }

    // Si no hay ningún firmante, usar solo ejecutor vacío
    if (tableWidths.length === 0) {
        tableWidths = ['*'];
        headerRow = [{ text: 'EJECUTOR', fillColor: COLORS.primary, color: COLORS.white, bold: true, fontSize: 10, alignment: 'center', margin: [10, 10, 10, 10] }];
        nombresRow = [{ text: '', fontSize: 10, alignment: 'center', margin: [10, 15, 10, 5] }];
        firmasRow = [buildSignatureCell('ejecutor', '')];
        fechasRow = [{ text: `Fecha: ${fechaEmision}`, fontSize: 9, alignment: 'center', margin: [10, 5, 10, 15] }];
    }

    return [
        // TÍTULO
        {
            text: 'APROBACIÓN Y TRAZABILIDAD',
            fontSize: 18,
            bold: true,
            color: COLORS.primary,
            alignment: 'center',
            margin: [0, 20, 0, 20]
        },

        // TABLA DE FIRMAS DINÁMICA
        {
            table: {
                widths: tableWidths,
                body: [
                    headerRow,
                    nombresRow,
                    firmasRow,
                    fechasRow
                ]
            },
            layout: {
                hLineWidth: () => 1,
                vLineWidth: () => 1,
                hLineColor: () => COLORS.neutral,
                vLineColor: () => COLORS.neutral
            },
            margin: [40, 0, 40, 25]
        },

        // INFORMACION DEL DOCUMENTO
        {
            table: { widths: ['*'], body: [[{
                text: 'INFORMACION DEL DOCUMENTO', fontSize: 11, bold: true, color: COLORS.white,
                fillColor: COLORS.primary, margin: [10, 6, 10, 6], border: [false, false, false, false]
            }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [40, 20, 40, 10]
        },
        {
            table: {
                widths: [130, '*', 130, '*'],
                body: [
                    [
                        { text: 'Fecha de emision:', fontSize: 8, bold: true, color: COLORS.primary, margin: [8, 5, 4, 5] },
                        { text: fechaEmision, fontSize: 8, color: COLORS.text, margin: [4, 5, 8, 5] },
                        { text: 'Hora de emision:', fontSize: 8, bold: true, color: COLORS.primary, margin: [8, 5, 4, 5] },
                        { text: fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), fontSize: 8, color: COLORS.text, margin: [4, 5, 8, 5] }
                    ],
                    [
                        { text: 'Codigo documento:', fontSize: 8, bold: true, color: COLORS.primary, margin: [8, 5, 4, 5], fillColor: COLORS.background },
                        { text: exportData.documentCode || 'PRJ-001', fontSize: 8, color: COLORS.text, margin: [4, 5, 8, 5], fillColor: COLORS.background },
                        { text: 'Version:', fontSize: 8, bold: true, color: COLORS.primary, margin: [8, 5, 4, 5], fillColor: COLORS.background },
                        { text: exportData.version || 'v1.0', fontSize: 8, color: COLORS.text, margin: [4, 5, 8, 5], fillColor: COLORS.background }
                    ],
                    [
                        { text: 'Clasificacion:', fontSize: 8, bold: true, color: COLORS.primary, margin: [8, 5, 4, 5] },
                        { text: 'Confidencial - GxP', fontSize: 8, color: COLORS.text, bold: true, margin: [4, 5, 8, 5] },
                        { text: 'Generado por:', fontSize: 8, bold: true, color: COLORS.primary, margin: [8, 5, 4, 5] },
                        { text: (function() {
                            if (typeof ConfigStore !== 'undefined') {
                                var _cfg = ConfigStore.load();
                                if (_cfg.organizacion && _cfg.organizacion.nombre) {
                                    return _cfg.organizacion.nombre + ' — Validation Suite ' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');
                                }
                            }
                            return 'Validation Suite ' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'v3.0');
                        })(), fontSize: 8, color: COLORS.text, margin: [4, 5, 8, 5] }
                    ]
                ]
            },
            layout: {
                hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                hLineColor: () => '#E8ECF0', vLineColor: () => '#E8ECF0'
            },
            margin: [40, 0, 40, 15]
        },

    ];
}

/**
 * Exportar proyecto completo con portada y resumen ejecutivo
 */
async function exportProject() {
    try {
    //         console.log('=== EXPORTAR PROYECTO COMPLETO ===');

        // Abrir modal y esperar datos
        showModal('modalExportProject');

        // Configurar listener del boton
        const btnConfirm = document.getElementById('btnConfirmExportProject');
        if (!btnConfirm) {
            throw new Error('Boton de confirmacion no encontrado');
        }

        // Crear promesa que se resuelve cuando el usuario confirma
        const userConfirmed = new Promise((resolve, reject) => {
            const confirmHandler = async () => {
                const exportData = validateAndGetProjectExportData();
                if (!exportData) {
                    return; // Validacion fallo, no cerrar modal
                }

                // Limpiar listener
                btnConfirm.removeEventListener('click', confirmHandler);
                closeModal('modalExportProject');
                resolve(exportData);
            };

            btnConfirm.addEventListener('click', confirmHandler);

            // Timeout de 5 minutos
            setTimeout(() => {
                btnConfirm.removeEventListener('click', confirmHandler);
                reject(new Error('Timeout: Modal cerrado sin confirmacion'));
            }, 300000);
        });

        const exportData = await userConfirmed;
    //         console.log('Datos de exportacion:', exportData);

        // Cargar sesion
        const sessionData = await loadSessionForPDF();
        if (!sessionData) {
            throw new Error('No hay datos de sesion');
        }

        // Calcular stats globales a NIVEL DE PRUEBA (resultado del cierre)
        const allTests = sessionData.tests || [];
        let testsPasa = 0, testsNoPasa = 0, testsPasaObs = 0, testsNoAplica = 0;
        let statsTotalEv = 0;
        allTests.forEach(t => {
            statsTotalEv += t.evidences.filter(e => !e.isEmpty).length;
            // Resultado a nivel de PRUEBA (lo que el usuario cerró)
            const r = (t.resultado || 'PASA').toUpperCase().trim();
            if (r === 'PASA' || r === 'OK') testsPasa++;
            else if (r === 'NO PASA' || r === 'NOK') testsNoPasa++;
            else if (r === 'PASA CON OBSERVACIONES') testsPasaObs++;
            else if (r === 'NO APLICA') testsNoAplica++;
            else testsPasa++;
        });
        const globalStats = {
            totalGroups: sessionData.groups?.length || 0,
            totalTests: allTests.length,
            totalEvidences: statsTotalEv,
            // Stats a nivel de PRUEBA
            pasa: testsPasa,
            noPasa: testsNoPasa,
            pasaObs: testsPasaObs,
            noAplica: testsNoAplica
        };

        // 4. CARPETAS CON SUS TESTS Y EVIDENCIAS
        const folders = sessionData.groups || [];

        // Generar hash SHA-256 del proyecto completo
        // Hash removido - no aporta valor defendible en auditoría

        // CONTENIDO DEL PDF
        const content = [];

        // 1. PORTADA
        content.push(...buildProjectCoverPage(sessionData, globalStats, exportData));

        // 2. RESUMEN EJECUTIVO
        content.push(...buildProjectExecutiveSummary(sessionData, exportData, globalStats));

        // 3. ÍNDICE JERÁRQUICO
        content.push(...buildProjectIndexPage(sessionData, globalStats));

        // Helper: marca el último elemento del content con pageBreak:'after'
        function markPageBreakAfter() {
            if (content.length > 0) {
                content[content.length - 1].pageBreak = 'after';
            }
        }

        // 4. PROCESAR CARPETAS
        for (let folderIdx = 0; folderIdx < folders.length; folderIdx++) {
            const folder = folders[folderIdx];
            const testsInFolder = (sessionData.tests || []).filter(t => t.groupId === folder.id);

            if (testsInFolder.length === 0) continue; // Skip carpetas vacías

            // Calcular stats de carpeta
            const folderStats = {
                totalTests: testsInFolder.length,
                totalEvidences: testsInFolder.reduce((sum, t) =>
                    sum + t.evidences.filter(e => !e.isEmpty).length, 0),
                finalized: testsInFolder.every(t => t.finalized)
            };

            // 4.1 SEPARADOR DE CARPETA (con índice de tests)
            markPageBreakAfter(); // Salto ANTES del separador (desde el elemento anterior)
            content.push(...buildFolderSeparatorPage(folder, folderStats, folderIdx + 1, testsInFolder));

            // CONTEXTO DE CARPETA (para usar en todas las secciones)
            const protocol = sessionData.protocols?.find(p => p.id === folder.protocolId);
            const protocolName = protocol ? `${protocol.code} - ${protocol.name}` : exportData.version || 'v1.0';

            const folderContextInfo = {
                projectName: sessionData.systemInfo?.nombreSistema || 'Sin nombre',
                protocol: protocolName,
                folderName: folder.name,
                executorGlobal: exportData.ejecutor
            };

            // 4.2 TESTS DE LA CARPETA
            for (let testIdx = 0; testIdx < testsInFolder.length; testIdx++) {
                const test = testsInFolder[testIdx];
                const validEvidences = test.evidences.filter(e => !e.isEmpty);

                if (validEvidences.length === 0) continue; // Skip tests sin evidencias

                // Cargar imágenes de evidencias
                for (const evidence of validEvidences) {
                    const imageId = `${test.id}_evidence_${evidence.step}`;
                    evidence.image = await getImageFromDB(imageId);
                }

                // Contexto específico del test
                const contextInfo = {
                    ...folderContextInfo,
                    testCode: test.name,
                    section: folder.name
                };

                // 4.2.1 MINI-SEPARADOR DE TEST
                markPageBreakAfter(); // Salto ANTES del mini-separador
                content.push(...buildTestSeparatorMini(test, testIdx + 1, testsInFolder.length, contextInfo));
                markPageBreakAfter(); // Salto DESPUÉS del mini-separador (antes de evidencias)

                // 4.2.2 EVIDENCIAS DEL TEST (2 páginas cada una)
                for (let evidIdx = 0; evidIdx < validEvidences.length; evidIdx++) {
                    const evidence = validEvidences[evidIdx];
                    const globalStepId = `evidence_${test.id}_${evidence.step}`;

                    const imgContent = buildEvidencePage_Image(evidence, contextInfo, 0, 0, globalStepId);
                    const metaContent = buildEvidencePage_Metadata(evidence, contextInfo, 0, 0);

                    // Quitar pageBreak de la última evidencia
                    if (evidIdx === validEvidences.length - 1 && metaContent.length > 0) {
                        const lastElement = metaContent[metaContent.length - 1];
                        if (lastElement.pageBreak === 'after') {
                            delete lastElement.pageBreak;
                        }
                    }

                    content.push(...imgContent);
                    content.push(...metaContent);
                }

                // 4.2.3 CONCLUSIÓN DEL TEST (si está finalizado)
                if (test.finalized && test.conclusion) {
                    content.push(...buildTestConclusionPage(test, contextInfo, false, true));
                }
            }

            // 4.3 TABLA RESUMEN DE CARPETA
            markPageBreakAfter(); // Salto ANTES de la tabla resumen
            content.push(...buildFolderEvidencesSummaryTable(testsInFolder, folderContextInfo, folder.id));

            // 4.4 CONCLUSIÓN DE CARPETA (si está finalizada)
            if (folder.finalized && folder.conclusion) {
                markPageBreakAfter(); // Salto ANTES de la conclusión de carpeta
                content.push(
                    {
                        text: `CONCLUSIÓN DE CARPETA: ${folder.name}`,
                        fontSize: 14,
                        bold: true,
                        color: COLORS.primary,
                        margin: [0, 0, 0, 15]
                    },
                    {
                        table: {
                            widths: ['*'],
                            body: [[{
                                stack: [
                                    { text: `Resultado: ${folder.resultado || 'Sin resultado'}`, fontSize: 10, bold: true, color: folder.resultado === 'PASA' ? COLORS.pass : (folder.resultado === 'NO PASA' ? COLORS.fail : COLORS.passObs), margin: [0, 0, 0, 10] },
                                    { text: folder.conclusion, fontSize: 9, color: COLORS.text, alignment: 'justify' }
                                ],
                                margin: [15, 15, 15, 15]
                            }]]
                        },
                        layout: {
                            hLineWidth: () => 1, vLineWidth: () => 1,
                            hLineColor: () => COLORS.neutral, vLineColor: () => COLORS.neutral
                        },
                        margin: [0, 0, 0, 30]
                    }
                );
            }
        }

        // 5. TABLA DE TRAZABILIDAD COMPLETA
        markPageBreakAfter();
        content.push(...buildProjectTraceabilityTable(sessionData));

        // 5.3 DOCUMENTACION ASOCIADA (si hay documentos)
        let associatedDocs = [];
        try { associatedDocs = typeof getAssociatedDocs === 'function' ? await getAssociatedDocs() : []; } catch (e) {}
        if (associatedDocs.length > 0) {
            markPageBreakAfter();
            content.push(...buildAssociatedDocsPage(associatedDocs));
        }

        // 5.5 CONCLUSIÓN DEL PROYECTO (si está finalizado)
        if (sessionData.projectData?.finalized && sessionData.projectData?.conclusion) {
            markPageBreakAfter();
            content.push(...buildProjectConclusionPage(sessionData.projectData));
        }

        // 6. PÁGINA DE FIRMAS Y HASH
        markPageBreakAfter();
        content.push(...buildProjectSignaturesPage(exportData));

        // === LIMPIEZA DE PAGE BREAKS ===
        // 0. Mover pageBreak de elementos decorativos (barras de acento, textos vacíos) al siguiente elemento significativo
        for (let i = 0; i < content.length - 1; i++) {
            const el = content[i];
            if (el.pageBreak === 'after') {
                // Detectar si es un elemento decorativo (barra de color, texto vacío)
                const isDecorative = (el.table && el.table.heights && el.table.heights[0] <= 5) ||
                    (el.text === '' && !el.id) ||
                    (el.canvas && !el.id);
                if (isDecorative && i > 0) {
                    // Mover el pageBreak al elemento anterior
                    delete el.pageBreak;
                    content[i - 1].pageBreak = 'after';
                }
            }
        }
        // 1. Eliminar doble pageBreak (after + before consecutivos = página en blanco)
        for (let i = 0; i < content.length - 1; i++) {
            if (content[i].pageBreak === 'after' && content[i + 1].pageBreak === 'before') {
                delete content[i + 1].pageBreak;
            }
        }
        // 2. Quitar pageBreak del último elemento para no generar página en blanco final
        if (content.length > 0) {
            delete content[content.length - 1].pageBreak;
        }
        // 3. Eliminar elementos vacíos al final que puedan generar página en blanco
        while (content.length > 0) {
            const last = content[content.length - 1];
            if (last.text === '' && !last.id && !last.table && !last.canvas) {
                content.pop();
            } else {
                break;
            }
        }

        // Forzar que todo el contenido quepa: reducir el ancho disponible
        // Envolverlo todo en una tabla contenedora con ancho fijo
        const safeWidth = 752; // A4 landscape (842) - margins (40+50) = 752
        const wrappedContent = [{
            table: {
                widths: [safeWidth],
                body: [[{ stack: content, border: [false,false,false,false] }]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 }
        }];

        // Configuracion PDF
        const docDefinition = {
            pageSize: 'A4',
            pageOrientation: 'landscape',
            pageMargins: [40, 40, 45, 60],

            // FOOTER PROFESIONAL GxP
            footer: function (currentPage, pageCount) {
                if (currentPage === 1) return null; // Sin footer en portada

                const docFooterName = exportData.documentCode || sessionData.systemInfo?.nombreSistema || 'Sistema';

                return {
                    columns: [
                        {
                            width: '*',
                            text: docFooterName,
                            fontSize: 7,
                            color: '#717D8A',
                            margin: [40, 0, 0, 0]
                        },
                        {
                            width: 'auto',
                            text: 'Página ' + currentPage + ' de ' + pageCount,
                            fontSize: 7,
                            color: '#717D8A',
                            alignment: 'center'
                        },
                        {
                            width: '*',
                            text: 'Confidencial - GxP',
                            fontSize: 7,
                            color: '#717D8A',
                            alignment: 'right',
                            margin: [0, 0, 40, 0]
                        }
                    ],
                    margin: [0, 10, 0, 15]
                };
            },
            defaultStyle: PDF_CONFIG.defaultStyle,
            content: wrappedContent
        };

        const projectName = sessionData.systemInfo?.nombreSistema || 'Proyecto';
        const docCode = exportData.documentCode || projectName;
        const fileName = `${docCode.replace(/[^a-zA-Z0-9]/g, '_')}_PROYECTO_COMPLETO.pdf`;

        const watermark_proj = await showWatermarkPicker();
        if (watermark_proj) docDefinition.watermark = watermark_proj;
        pdfMake.createPdf(docDefinition).download(fileName);
    //         console.log('âœ… PDF generado:', fileName);

        return true;

    } catch (error) {
    //         console.error('âŒ Error al exportar proyecto:', error);
        alert('Error al exportar proyecto: ' + error.message);
        return false;
    }
}