'use strict';

/* ====================================================================
   EXCEL PARSER — Análisis estructural de planillas .xlsx para GxP
   Usa SheetJS (XLSX global) ya cargado en index.html.

   API:
     ExcelParser.parse(file: File) → Promise<SpreadsheetAnalysis>

   SpreadsheetAnalysis = {
     fileName, fileSize, lastModified, author,
     sheets: [{name, purpose, formulaCount, inputCells, outputCells,
               formulas, namedRanges, hasProtection, isCritical}],
     hasVBA, hasExternalLinks, hasProtection, namedRanges, summary
   }
   ==================================================================== */

(function (global) {

    const ExcelParser = {

        async parse(file) {
            const lib = global.XLSX;
            if (!lib) throw new Error('SheetJS (XLSX) no está cargado');

            const arrayBuffer = await file.arrayBuffer();
            const wb = lib.read(new Uint8Array(arrayBuffer), {
                type: 'array',
                cellFormula: true,
                cellStyles: false,
                sheetStubs: false
            });

            const analysis = {
                fileName:     file.name,
                fileSize:     Math.round(file.size / 1024) + ' KB',
                lastModified: new Date(file.lastModified).toISOString().split('T')[0],
                author:       wb.Props && wb.Props.Author ? wb.Props.Author : '',
                sheets:       [],
                hasVBA:         !!wb.vbaraw,
                hasExternalLinks: false,
                hasProtection:    false,
                namedRanges:     []
            };

            // Named ranges
            if (wb.Names && Array.isArray(wb.Names)) {
                analysis.namedRanges = wb.Names.map(n => ({
                    name: n.Name || '',
                    ref:  n.Ref  || ''
                })).filter(n => n.name);
            }

            // Analyze each sheet
            wb.SheetNames.forEach(sheetName => {
                const ws = wb.Sheets[sheetName];
                const sheetInfo = this._analyzeSheet(sheetName, ws, lib);
                if (sheetInfo.hasProtection) analysis.hasProtection = true;
                analysis.sheets.push(sheetInfo);
            });

            // Detect external links (cells with formulas containing '[')
            analysis.hasExternalLinks = analysis.sheets.some(s =>
                s.formulas.some(f => f.formula && f.formula.includes('['))
            );

            analysis.summary = this._buildSummary(analysis);
            return analysis;
        },

        _analyzeSheet(name, ws, lib) {
            const info = {
                name,
                purpose:       '',  // to be filled by user
                formulaCount:  0,
                inputCells:    [],
                outputCells:   [],
                formulas:      [],
                hasProtection: !!ws['!protect'],
                isCritical:    false  // user decides / inferred
            };

            const range = ws['!ref'] ? lib.utils.decode_range(ws['!ref']) : null;
            if (!range) return info;

            for (let R = range.s.r; R <= range.e.r; R++) {
                for (let C = range.s.c; C <= range.e.c; C++) {
                    const cellAddr = lib.utils.encode_cell({ r: R, c: C });
                    const cell = ws[cellAddr];
                    if (!cell) continue;

                    if (cell.f) {
                        // Has formula
                        info.formulaCount++;
                        if (info.formulas.length < 30) {  // cap at 30 for AI context
                            info.formulas.push({ cell: cellAddr, formula: '=' + cell.f });
                        }
                        info.outputCells.push(cellAddr);
                    } else if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
                        // Has a value but no formula → likely an input cell
                        if (info.inputCells.length < 20) {
                            info.inputCells.push(cellAddr);
                        }
                    }
                }
            }

            // Heuristic: if sheet has many formulas, it's likely critical
            info.isCritical = info.formulaCount > 3;

            return info;
        },

        _buildSummary(analysis) {
            const criticalSheets = analysis.sheets.filter(s => s.isCritical).map(s => s.name);
            const totalFormulas  = analysis.sheets.reduce((sum, s) => sum + s.formulaCount, 0);

            const lines = [
                `Planilla: ${analysis.fileName}`,
                `Hojas: ${analysis.sheets.length} (${criticalSheets.length} con fórmulas críticas)`,
                `Total de fórmulas detectadas: ${totalFormulas}`,
                analysis.hasVBA ? '⚠️ Contiene macros VBA' : 'Sin macros VBA',
                analysis.hasExternalLinks ? '⚠️ Contiene vínculos externos' : 'Sin vínculos externos',
                analysis.hasProtection ? '✓ Al menos una hoja protegida' : '⚠️ Sin protección de hojas detectada',
                criticalSheets.length > 0 ? `Hojas críticas: ${criticalSheets.join(', ')}` : ''
            ].filter(Boolean);

            return lines.join('\n');
        },

        // Convierte el análisis en el bloque `spreadsheet` que van los skills
        toSpreadsheetBlock(analysis, userContext = {}) {
            return {
                fileName:       analysis.fileName,
                purpose:        userContext.purpose || '',
                gampCategory:   userContext.gampCategory || 'Cat 4',
                department:     userContext.department || '',
                responsible:    userContext.responsible || '',
                frequency:      userContext.frequency || '',
                version:        userContext.version || 'v1.0',
                location:       userContext.location || '',
                sheets: analysis.sheets.map(s => ({
                    name:         s.name,
                    purpose:      s.purpose || '',
                    formulaCount: s.formulaCount,
                    isCritical:   s.isCritical
                })),
                hasVBA:          analysis.hasVBA,
                hasExternalLinks: analysis.hasExternalLinks,
                hasProtection:   analysis.hasProtection
            };
        },

        // Genera el user prompt con contexto estructural para el skill de IA
        buildAIPrompt(analysis, userContext, docType) {
            const block = this.toSpreadsheetBlock(analysis, userContext);
            const formulaExamples = analysis.sheets
                .flatMap(s => s.formulas.slice(0, 5).map(f => `  ${s.name}!${f.cell}: ${f.formula}`))
                .slice(0, 15)
                .join('\n');

            return [
                `# Análisis estructural de la planilla`,
                ``,
                `## Contexto general`,
                `- Archivo: ${analysis.fileName} (${analysis.fileSize})`,
                `- Última modificación: ${analysis.lastModified}`,
                `- Propósito GxP: ${userContext.purpose || '(completar)'}`,
                `- Departamento: ${userContext.department || '(completar)'}`,
                `- Categoría GAMP: ${userContext.gampCategory || 'Cat 4'}`,
                ``,
                `## Hojas detectadas`,
                analysis.sheets.map(s =>
                    `- "${s.name}": ${s.formulaCount} fórmulas, ${s.isCritical ? 'CRÍTICA' : 'no crítica'}${s.hasProtection ? ', protegida' : ''}`
                ).join('\n'),
                ``,
                formulaExamples ? `## Ejemplos de fórmulas (primeras ${Math.min(15, formulaExamples.split('\n').length)})\n${formulaExamples}` : '',
                analysis.namedRanges.length > 0
                    ? `## Rangos nombrados\n${analysis.namedRanges.map(n => `- ${n.name}: ${n.ref}`).join('\n')}`
                    : '',
                `## Flags`,
                `- VBA/Macros: ${analysis.hasVBA ? 'SÍ' : 'No'}`,
                `- Vínculos externos: ${analysis.hasExternalLinks ? 'SÍ' : 'No'}`,
                `- Protección de hojas: ${analysis.hasProtection ? 'Sí' : 'NO (sin protección)'}`,
                ``,
                `## Bloque spreadsheet para el JSON`,
                `\`\`\`json`,
                JSON.stringify(block, null, 2),
                `\`\`\``,
                ``,
                `Generá el documento ${docType} completo siguiendo el schema del skill. El bloque "spreadsheet" debe ser exactamente el JSON mostrado arriba.`
            ].filter(l => l !== undefined && l !== '').join('\n');
        }
    };

    global.ExcelParser = ExcelParser;

})(typeof window !== 'undefined' ? window : global);
