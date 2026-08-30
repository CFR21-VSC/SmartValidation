/* ====================================================================
   VALIDATION SUITE — SHARED SECTION RENDERERS
   Tipos de seccion comunes a todos los documentos del paquete
   (HLRA, VP, URS, FRS, DS, RA, etc.).

   Tipos exportados (en ValidationSuite.shared):
   - renderTexto                : Parrafo simple con bloques (subtitulo+texto+bullets)
   - renderIncluidoExcluido     : Bloque "Incluido / Excluido" con bullets
   - renderTabla                : Tabla generica con columnas variables
                                  Soporta bullets en celdas via objeto { bullets: [...] }
   - renderTablaInfo            : Tabla key/value (Campo | Valor)
   - renderCajaConclusion       : Caja con borde para parrafos finales
   - renderSubseccion           : Sub-titulo numerado (8.1, 8.2) con linea fina
   - renderCajaNota             : Callout amarillo italic (notas de aclaracion)
   - renderCajaJustificacion    : Caja con titulo destacado para justificaciones (PQ No Aplica)
   - renderCajaCriterio         : Banner verde con titulo (criterios de aprobacion)
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.shared = VS.shared || {};

    // ====================================================================
    // NUMERACIÓN DE SECCIONES (helper compartido)
    //
    // Devuelve una función-counter que cada renderer invoca al iterar.
    // Reglas:
    //   - sec.numero === <int>  → usa ese (sincroniza el counter interno)
    //   - sec.numero === null   → título sin número (caja interna con label)
    //   - sec.tipo === 'subseccion' → NO consume contador (su título trae "X.Y")
    //   - sin titulo            → NO consume contador (tablas hijas sin head)
    //   - default               → counter++
    //
    // Uso típico en cada renderer:
    //   const numberer = VS.shared.createSectionNumberer();
    //   secciones.forEach((sec, idx) => {
    //       const num = numberer(sec);
    //       // ... usar num en lugar de idx+1 ...
    //   });
    // ====================================================================
    // VOCABULARIO CANÓNICO — ESCALAS DE SEVERIDAD
    //
    // El paquete documental maneja DOS escalas conceptualmente distintas
    // que NO deben confundirse:
    //
    // ── ESCALA A — Clasificación formal (4 niveles, género femenino) ──
    //   CRÍTICA / MAYOR / MENOR / OBSERVACIÓN
    //   Uso: NCR (clasificación de no-conformidad), VSR (criticidad),
    //        HLRA (severidad del gap identificado).
    //   Origen: convención pharma estándar para clasificar desvíos
    //           regulatorios (ICH Q9 → criticidad de NCs).
    //
    // ── ESCALA B — Intensidad de prioridad (4 niveles, género masculino) ──
    //   CRÍTICO / ALTO / MEDIO / BAJO
    //   Uso: MTR (priorización de trazabilidad), IOQ/VSR (severidad
    //        de impacto de TC), riesgos residuales numéricos.
    //   Origen: escala de intensidad (impacto × probabilidad).
    //
    // RRM usa labels COMPUESTOS ("GAP Mayor", "NC Menor") intencionalmente
    // para distinguir entre GAP (incumplimiento documentado) y NC (no
    // conformidad de ejecución) — no es una tercera escala, es un prefijo
    // semántico sobre Escala A.
    //
    // RA/IRA usan numérico S/P/D/RR (FMEA puro, sin labels).
    //
    // Convención: TODO en mayúscula al persistir en JSON.
    // ====================================================================

    // ====================================================================
    // NORMALIZADOR DE ESTADOS DE TC
    // Vocabulario canónico: 'pass' | 'fail' | 'obs' | 'na' | 'pendiente'
    // Acepta variantes ES/EN históricas para retro-compatibilidad con
    // fixtures legacy (PASA, NO PASA, PASA CON OBSERVACIONES, etc.).
    // Antes existían 3 copias idénticas en iiq.js / ioq.js / ipq.js.
    // ====================================================================
    VS.shared.normalizarEstadoTC = function (estado) {
        const e = String(estado || '').toUpperCase().trim();
        if (e === 'PASS' || e === 'PASA') return 'pass';
        if (e === 'FAIL' || e === 'NO PASA') return 'fail';
        if (e === 'OBS' || e === 'PASS_OBS' || e === 'PASA CON OBSERVACIONES') return 'obs';
        if (e === 'NA' || e === 'N/A' || e === 'NO APLICA') return 'na';
        return 'pendiente';
    };

    // ====================================================================
    VS.shared.createSectionNumberer = function () {
        let counter = 0;
        return function (sec) {
            if (!sec) return null;
            if (typeof sec.numero === 'number') {
                counter = sec.numero;
                return sec.numero;
            }
            if (sec.tipo === 'subseccion') return null;
            if (Object.prototype.hasOwnProperty.call(sec, 'numero') && sec.numero === null) return null;
            if (sec.titulo) {
                counter++;
                return counter;
            }
            return null;
        };
    };

    // ====================================================================
    // TEXTO
    // ====================================================================
    VS.shared.renderTexto = function (sec, tb) {
        const out = [];
        const bloques = sec.bloques || [{ texto: sec.contenido || sec.texto || '' }];
        bloques.forEach(b => {
            if (b.subtitulo) {
                out.push({
                    text: b.subtitulo,
                    fontSize: 11,
                    bold: true,
                    color: tb.VS_COLORS.primary,
                    margin: [0, 4, 0, 6]
                });
            }
            if (b.texto) {
                out.push({
                    text: b.texto,
                    fontSize: 10,
                    color: tb.VS_COLORS.text,
                    alignment: 'justify',
                    lineHeight: 1.35,
                    margin: [0, 0, 0, 6]
                });
            }
            if (b.bullets && b.bullets.length > 0) {
                out.push({
                    ul: b.bullets.map(t => ({ text: t, fontSize: 10, color: tb.VS_COLORS.text })),
                    margin: [0, 0, 0, 6]
                });
            }
        });
        return out;
    };

    // ====================================================================
    // INCLUIDO / EXCLUIDO
    // ====================================================================
    VS.shared.renderIncluidoExcluido = function (sec, tb) {
        const out = [];
        const C = tb.VS_COLORS;

        if (sec.incluido) {
            if (sec.subIncluido) {
                out.push({
                    text: sec.subIncluido,
                    fontSize: 11,
                    bold: true,
                    color: C.primary,
                    margin: [0, 0, 0, 6]
                });
            }
            out.push({
                ul: sec.incluido.map(t => ({ text: t, fontSize: 10 })),
                color: C.text,
                margin: [0, 0, 0, 14]
            });
        }
        if (sec.excluido) {
            if (sec.subExcluido) {
                out.push({
                    text: sec.subExcluido,
                    fontSize: 11,
                    bold: true,
                    color: C.primary,
                    margin: [0, 0, 0, 6]
                });
            }
            out.push({
                ul: sec.excluido.map(t => ({ text: t, fontSize: 10 })),
                color: C.text,
                margin: [0, 0, 0, 10]
            });
        }
        return out;
    };

    // ====================================================================
    // TABLA (generica) — soporta bullets en celdas
    // ====================================================================
    /**
     * Convierte una celda del JSON a un objeto pdfMake.
     * Soporta:
     *   - String simple: "texto"
     *   - Objeto { text, ... }: texto con override de estilo
     *   - Objeto { bullets: ["a","b"] }: lista de bullets dentro de la celda
     *   - Objeto { stack: [...] }: stack pdfMake directo
     */
    // Detecta si un texto debe tener noWrap=true para evitar quiebres en / o -
    // Aplica a: valores cortos sin espacios (SI, NO, N/A, M, D, ALTO, BAJO, MEDIO)
    // y patrones de fecha (DD/MM/YYYY, YYYY-MM-DD) que pdfMake rompe en la barra
    function _cellNoWrap(text) {
        const t = (text || '').trim();
        if (!t || t === '—') return false;
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
        return t.length <= 6 && !t.includes(' ');
    }

    function buildCell(cell, baseStyle, tb) {
        const C = tb.VS_COLORS;

        if (cell == null) {
            return tb.vsTd('—', baseStyle);
        }

        if (typeof cell === 'object' && !Array.isArray(cell)) {
            // Bullets dentro de celda
            if (Array.isArray(cell.bullets)) {
                return {
                    stack: [
                        cell.text ? { text: cell.text, fontSize: baseStyle.fontSize, color: C.text, margin: [0, 0, 0, 4] } : null,
                        {
                            ul: cell.bullets.map(b => ({
                                text: typeof b === 'string' ? b : (b.text || ''),
                                fontSize: baseStyle.fontSize - 0.5,
                                color: C.text
                            })),
                            margin: [0, 0, 0, 0]
                        }
                    ].filter(Boolean),
                    fillColor: baseStyle.fillColor,
                    margin: baseStyle.margin || [6, 5, 6, 5]
                };
            }
            // Stack directo
            if (Array.isArray(cell.stack)) {
                return Object.assign({}, baseStyle, cell);
            }
            // Objeto con text + override: auto-noWrap si no fue explicitado
            const merged = Object.assign({}, baseStyle, cell);
            if (cell.noWrap === undefined) merged.noWrap = _cellNoWrap(cell.text || '');
            return tb.vsTd(cell.text || '—', merged);
        }

        const str = String(cell || '—');
        const style = _cellNoWrap(str)
            ? Object.assign({}, baseStyle, { noWrap: true })
            : baseStyle;
        return tb.vsTd(str, style);
    }

    // ── Auto-width heurístico para tablas GxP ─────────────────────────
    // Asigna anchos según semántica de columna cuando la IA no especifica widths.
    // Estrategia: columnas codificadas (N°, Aplica, Estado) → fijas angostas;
    // columnas de texto libre (Descripción, Observaciones) → flexibles ('*');
    // el resto → ancho medio fijo. Los '*' se reparten el espacio sobrante.
    function _autoWidthsGxP(cols) {
        // Muy angosta: secuenciales, flags Sí/No, identificadores de 1-2 chars
        const RE_TINY   = /^(n[°º.#\s]?$|#$|item$|ítem$|num$|nro$|ord$|punto$|punt[.]?$|p\b$|g\b$|i\b$|t\b$|v\b$|sí$|si$|no$|pq$|oq$|iq$|pq\b|oq\b|iq\b)/i;
        // Angosta: estado, aplica, tipo, fecha, nivel, criticidad (contiene keyword al inicio)
        const RE_NARROW = /^(aplica|apl[.\s]|estado|fase|tipo|categ|nivel|crit|prior|fecha|vers|cumpl|prob|sever|puntaje|score|calif|clase|frec|calific)/i;
        // Ancha: texto libre (descripción, observaciones, controles, justificación...)
        const RE_WIDE   = /^(descrip|observ|control[es\s/]|medida|acci[oó]n|justif|comentar|conclus|criter|requisito\s+normat|especif|alcance|detall|eviden|mitig|acept|result.*detall|normat)/i;
        // Media: referencias cruzadas, IDs, códigos compuestos
        const RE_MED    = /^(urs|frs|ds\b|ra\b|tc\b|ref|comp|sist|mod|verif|ctrl|control\b|caso|hallaz|causa|norma|vincul|requisito\b)/i;

        return cols.map(col => {
            // Limpiar el nombre de columna para matching
            const raw = (col || '').trim().toLowerCase();
            const clean = raw.replace(/[^a-záéíóúñ\s]/gi, ' ').trim();
            if (RE_TINY.test(raw) || RE_TINY.test(clean))     return 22;
            if (RE_NARROW.test(raw) || RE_NARROW.test(clean)) return 40;
            if (RE_WIDE.test(raw) || RE_WIDE.test(clean))     return '*';
            if (RE_MED.test(raw) || RE_MED.test(clean))       return 58;
            // Fallback: longitud del encabezado limpio
            const len = clean.replace(/\s+/g, '').length;
            if (len <= 3)  return 22;
            if (len <= 6)  return 40;
            if (len <= 12) return 60;
            return '*';
        });
    }

    VS.shared.renderTabla = function (sec, tb) {
        const C = tb.VS_COLORS;
        const cols = sec.columnas || [];
        const filas = sec.filas || [];
        // ── AUTO-ESCALADO DE WIDTHS ────────────────────────────────────
        // pdfMake A4 portrait con PAGE_MARGINS [70,90,70,60] deja 455pt útiles.
        // PERO `vsTableLayout` agrega padding 6+6=12pt por celda NO incluido
        // en widths — para N cols eso suma 12*N pt extra invisibles.
        // Si widths está al borde (sum=455 típico de fixtures históricos),
        // la tabla real ocupa 455 + 12*N → desborda al borde derecho.
        //
        // Fórmula: realLimit = 455 - margen_visual - 12*N
        // Si la suma de widths excede realLimit → escalar proporcionalmente.
        const PADDING_PER_CELL = 12; // 6 izq + 6 der (vsTableLayout default)
        const MARGEN_VISUAL = 4;     // colchón mínimo — tablas siempre llenan el ancho
        const ANCHO_UTIL = 455;
        // Columnas efectivas: prioridad cols > max fila > 1
        // Esto garantiza que widths y colCount siempre coincidan.
        const effectiveCols = cols.length ||
            filas.reduce((m, f) => Array.isArray(f) ? Math.max(m, f.length) : m, 0) || 1;

        // Usar widths explícito si fue provisto; sino calcular con heurística GxP.
        let widths = sec.widths || (cols.length > 1 ? _autoWidthsGxP(cols) :
                     effectiveCols > 1   ? Array(effectiveCols).fill('*') : ['*']);

        // Normalización de anchos: escala siempre (sube o baja) para llenar el ancho disponible.
        // Para arrays mixtos ('*' + números) pdfMake distribuye el sobrante nativamente.
        if (Array.isArray(widths) && widths.every(w => typeof w === 'number')) {
            const MIN_COL   = 20;
            const nCols     = widths.length;
            const realLimit = ANCHO_UTIL - MARGEN_VISUAL - (PADDING_PER_CELL * nCols);
            const sum       = widths.reduce((a, b) => a + b, 0);
            if (sum > 0) {
                const scale  = realLimit / sum;
                widths       = widths.map(w => Math.floor(w * scale));
                // Mínimo por columna: si escaló demasiado angosto, compensar desde las más anchas
                let deficit  = 0;
                widths = widths.map(w => { if (w < MIN_COL) { deficit += MIN_COL - w; return MIN_COL; } return w; });
                if (deficit > 0) {
                    const order = widths.map((w, i) => i).sort((a, b) => widths[b] - widths[a]);
                    for (const i of order) {
                        if (deficit <= 0) break;
                        const give = Math.min(deficit, widths[i] - MIN_COL);
                        widths[i] -= give; deficit -= give;
                    }
                }
            }
        }

        // Si widths no coincide con cols.length, recalcular con heurística GxP.
        // Ocurre cuando el JSON tiene sec.widths con menos entradas que sec.columnas
        // (p.ej. 2 widths pero 3 columnas). pdfMake usa body[0].length como límite
        // del loop de medición y accede a widths[i] — si widths[i] es undefined,
        // crashea con "Cannot set properties of undefined (setting '_minWidth')".
        if (cols.length > 0 && widths.length !== cols.length) {
            widths = _autoWidthsGxP(cols);
            if (Array.isArray(widths) && widths.every(w => typeof w === 'number')) {
                const nC2 = widths.length;
                const rl2 = ANCHO_UTIL - MARGEN_VISUAL - PADDING_PER_CELL * nC2;
                const sm2 = widths.reduce((a, b) => a + b, 0);
                if (sm2 > 0) widths = widths.map(w => Math.floor(w * rl2 / sm2));
            }
        }

        // colCount = número real de columnas que pdfMake va a usar (= widths.length)
        const colCount = widths.length;

        // Tablas con muchas filas O muchas columnas → modo compacto (font 9pt, padding reducido)
        const compact = filas.length > 6 || colCount > 5 || sec.compact === true;
        const cellFontSize = compact ? 9 : 10;
        const cellMargin   = compact ? [5, 3, 5, 3] : [6, 5, 6, 5];

        const body = [];

        // Header de tabla (a menos que noHeader: true)
        if (!sec.noHeader && cols.length > 0) {
            body.push(cols.map(c => tb.vsTh(c, { fontSize: cellFontSize })));
        }

        let dataRowIdx = 0;
        filas.forEach((fila) => {
            // Detectar sub-header de grupo: { subheader: "..." } u objeto con esa propiedad
            if (fila && typeof fila === 'object' && !Array.isArray(fila) && fila.subheader) {
                // Renderear como fila destacada con colSpan
                const nCols = widths.length || colCount;
                const subRow = [{
                    text: fila.subheader,
                    colSpan: nCols,
                    fontSize: cellFontSize,
                    bold: true,
                    color: C.white,
                    fillColor: C.secondary,
                    margin: [cellMargin[0] + 2, cellMargin[1] + 1, cellMargin[2], cellMargin[3] + 1]
                }];
                        // Slots colSpan: pdfMake requiere {} vacío (no {text:''})
                for (let i = 1; i < nCols; i++) subRow.push({});
                body.push(subRow);
                return; // No incrementa dataRowIdx (sub-headers no cuentan para alternar bg)
            }

            // Fila normal de datos
            const bg = dataRowIdx % 2 === 1 ? C.bgSoft : null;
            const baseStyle = { fillColor: bg, fontSize: cellFontSize, margin: cellMargin };
            const row = (Array.isArray(fila) ? fila : cols.map(c => fila[c] || '—'))
                .map(cell => buildCell(cell, baseStyle, tb));
            // Pad defensivo: si el JSON tiene una fila más corta que widths, pdfMake crashea
            const targetCols = widths.length || colCount;
            while (row.length < targetCols) row.push(tb.vsTd('', baseStyle));
            body.push(row);
            dataRowIdx++;
        });

        // Si la tabla tiene sub-headers de grupo, NO repetir el header al partir.
        // Razon: en la nueva pagina quedaria header + sub-header inmediatamente,
        // viendose como "doble encabezado" sin filas de contenido entre ambos.
        // Los sub-headers actuan como contexto en cada pagina.
        const hasSubheaders = filas.some(f => f && typeof f === 'object' && !Array.isArray(f) && f.subheader);
        const wantsHeader = !sec.noHeader && cols.length > 0;
        const headerRows = (wantsHeader && !hasSubheaders) ? 1 : 0;

        // Sanitizar: pdfMake crashea con undefined en cualquier celda
        const safeBody = body.map(function (row) {
            return Array.isArray(row) ? row.map(function (cell) { return cell !== undefined ? cell : {}; }) : row;
        });

        // dontBreakRows: pdfMake tiene un bug al combinar dontBreakRows=true con
        // celdas colSpan (subheaders) — intenta acceder a posiciones undefined en
        // su lógica interna de medición de filas. Para tablas con subheaders usamos
        // false; los subheaders ya actúan como separadores visuales entre páginas.
        const dontBreak = !hasSubheaders;

        return [{
            table: {
                widths: widths,
                body: safeBody,
                dontBreakRows: dontBreak,
                headerRows: headerRows,
                keepWithHeaderRows: headerRows > 0 ? 1 : 0
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 14]
        }];
    };

    // ====================================================================
    // TABLA INFO (key/value)
    // ====================================================================
    VS.shared.renderTablaInfo = function (sec, tb) {
        const C = tb.VS_COLORS;
        const filas = sec.filas || [];
        const labelWidth = sec.labelWidth || 150;
        const valueWidth = tb.CONTENT_WIDTH - labelWidth;
        const compact = filas.length > 6;
        const fs = compact ? 9 : 10;
        const cm = compact ? [5, 3, 5, 3] : [6, 5, 6, 5];

        const body = [
            [tb.vsTh('Campo', { fontSize: fs }), tb.vsTh('Valor', { fontSize: fs })]
        ];
        filas.forEach((f, idx) => {
            const bg = idx % 2 === 1 ? C.bgSoft : null;
            // Permitir override de color por fila (ej. { campo, valor, color: 'primary' })
            const valueColor = f.colorValor === 'primary' ? C.primary :
                               f.colorValor === 'accent' ? C.accent :
                               C.text;
            const valueBold = f.boldValor === true;
            body.push([
                tb.vsTd(f.campo || f.label || '—', { bold: true, fillColor: bg, color: C.primary, fontSize: fs, margin: cm }),
                tb.vsTd(f.valor || f.value || '—', { fillColor: bg, fontSize: fs, margin: cm, color: valueColor, bold: valueBold })
            ]);
        });

        return [{
            table: { widths: [labelWidth, valueWidth], body: body, dontBreakRows: true, headerRows: 1 },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 14]
        }];
    };

    // ====================================================================
    // TABLA DE FIRMAS FINAL — SMART FIT
    //
    // Renderea la tabla de firmas con:
    //   - Anchuras: 145+145+90+75 = 455pt (cabe en A4 portrait).
    //   - fontSize adaptativo según largo del nombre (9 / 8.5 / 8).
    //   - height adaptativo por fila según contenido (60 base, 75 si largo).
    //   - Truncado defensivo > 70 chars con elipsis.
    //   - Soporta tanto firmas pobladas como rolesPlaceholder vacíos.
    //
    // Opts:
    //   - rolesDefault: array con roles default si sec.rolesPlaceholder está
    //     vacío y no hay firmas. Ej. ['Validador', 'Revisor', 'Aprobador'].
    //   - showIntro: bool (default true)
    // ====================================================================
    VS.shared.renderTablaFirmasFinalSmart = function (sec, tb, opts) {
        opts = opts || {};
        const C = tb.VS_COLORS;
        const firmas = sec.firmas || [];
        // Stack interno del bloque unbreakable.
        // Si opts.numero/titulo se pasan, incluimos el sectionTitle adentro
        // → el título queda PEGADO al cuadro (no se separa nunca).
        const innerStack = [];

        // Título interno (si se pasó)
        if (opts.numero != null && opts.titulo && typeof tb.sectionTitle === 'function') {
            const t = tb.sectionTitle(`${opts.numero}. ${opts.titulo}`, { marginTop: 0 });
            innerStack.push(...t);
        } else if (opts.titulo && typeof tb.sectionTitle === 'function') {
            innerStack.push(...tb.sectionTitle(opts.titulo, { marginTop: 0 }));
        }

        if (opts.showIntro !== false && sec.intro) {
            innerStack.push({
                text: sec.intro,
                fontSize: 10, italics: true, color: C.textSoft,
                alignment: 'justify', lineHeight: 1.35,
                margin: [0, 0, 0, 12]
            });
        }

        const body = [[
            tb.vsTh('Rol / Cargo'),
            tb.vsTh('Nombre'),
            tb.vsTh('Firma', { alignment: 'center' }),
            tb.vsTh('Fecha', { alignment: 'center' })
        ]];

        // Helpers locales
        function fitName(nombre) {
            const n = String(nombre || '');
            if (n.length > 70) return n.substring(0, 67) + '...';
            return n;
        }
        function fontForName(nombre) {
            const len = String(nombre || '').length;
            if (len > 40) return 7.5;
            if (len > 28) return 8.5;
            return 9;
        }
        function fontForRol(rol) {
            const len = String(rol || '').length;
            if (len > 28) return 8;
            return 9;
        }
        function fontForIniciales(ini) {
            const len = String(ini || '').length;
            if (len > 6) return 11;
            if (len > 4) return 12;
            return 13;
        }
        // height adaptativo: 60 base + 15 extra si algun texto largo en la fila
        function rowHeight(rol, nombre) {
            const maxLen = Math.max(String(rol || '').length, String(nombre || '').length);
            if (maxLen > 40) return 75;
            if (maxLen > 28) return 68;
            return 60;
        }

        const rowHeights = [28]; // header

        if (firmas.length === 0) {
            const roles = (Array.isArray(sec.rolesPlaceholder) && sec.rolesPlaceholder.length > 0 ? sec.rolesPlaceholder : null) || opts.rolesDefault || ['Validador', 'Revisor', 'Aprobador'];
            roles.forEach((rol, idx) => {
                const bg = idx % 2 === 1 ? C.bgSoft : null;
                body.push([
                    tb.vsTd(rol, { bold: true, fillColor: bg, fontSize: fontForRol(rol) }),
                    tb.vsTd('', { fillColor: bg }),
                    tb.vsTd('', { fillColor: bg }),
                    tb.vsTd('', { fillColor: bg })
                ]);
                rowHeights.push(rowHeight(rol, ''));
            });
        } else {
            firmas.forEach((f, idx) => {
                const bg = idx % 2 === 1 ? C.bgSoft : null;
                const rol = f.rol || '—';
                const nombre = fitName(f.nombre);
                const iniciales = f.iniciales || f.firma || '';
                const fecha = tb.formatDateShort(f.fecha) || '';

                // Celda de firma: si hay imagen, usarla; sino iniciales en grande
                let firmaCell;
                if (f.firmaImage) {
                    firmaCell = { image: f.firmaImage, fit: [78, 46], alignment: 'center', margin: [4, 4, 4, 4], fillColor: bg };
                } else {
                    firmaCell = tb.vsTd(iniciales, {
                        alignment: 'center', bold: true, fillColor: bg,
                        fontSize: fontForIniciales(iniciales)
                    });
                }

                body.push([
                    tb.vsTd(rol, { bold: true, fillColor: bg, fontSize: fontForRol(rol) }),
                    tb.vsTd(nombre, { fillColor: bg, fontSize: fontForName(nombre), lineHeight: 1.2 }),
                    firmaCell,
                    tb.vsTd(fecha, { alignment: 'center', fillColor: bg, fontSize: 9 })
                ]);
                rowHeights.push(rowHeight(rol, nombre));
            });
        }

        // Tabla principal de firmas, agregada al stack interno
        innerStack.push({
            table: {
                widths: tb.vsScaleWidths([122, 122, 76, 63]),
                heights: rowHeights,
                body: body,
                headerRows: 1
            },
            layout: tb.vsTableLayout(),
            margin: [0, 0, 0, 14]
        });

        if (sec.nota) {
            innerStack.push({
                text: sec.nota,
                fontSize: 8, italics: true, color: C.neutral,
                alignment: 'justify',
                margin: [0, 0, 0, 0]
            });
        }

        // Devolver TODO (título + intro + tabla + nota) como un solo bloque
        // unbreakable: pdfMake no puede separar el título del cuadro entre páginas.
        return [{
            unbreakable: true,
            stack: innerStack
        }];
    };

    // ====================================================================
    // CAJA CONCLUSION
    // ====================================================================
    VS.shared.renderCajaConclusion = function (sec, tb) {
        const C = tb.VS_COLORS;
        const stack = [];

        if (Array.isArray(sec.parrafos)) {
            sec.parrafos.forEach((p, i) => {
                stack.push({
                    text: p,
                    fontSize: 10,
                    color: C.text,
                    alignment: 'justify',
                    lineHeight: 1.35,
                    margin: [0, i === 0 ? 0 : 5, 0, 0]
                });
            });
        } else if (sec.contenido) {
            stack.push({
                text: sec.contenido,
                fontSize: 10,
                color: C.text,
                alignment: 'justify',
                lineHeight: 1.4
            });
        }

        return [{
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: stack,
                    fillColor: C.bgBlueLight,
                    margin: [14, 14, 14, 14],
                    border: [true, true, true, true]
                }]]
            },
            layout: {
                hLineWidth: () => 1, vLineWidth: () => 1,
                hLineColor: () => C.primary, vLineColor: () => C.primary
            },
            margin: [0, 0, 0, 14]
        }];
    };

    // ====================================================================
    // SUB-SECCION (numero punto numero, ej. 8.1, 8.2)
    // Linea inferior mas fina que sectionTitle
    // ====================================================================
    VS.shared.renderSubseccion = function (sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];
        const rawTitulo = sec.titulo || '';
        // Subsecciones (1.1, 2.1.1, etc.) van en formato oración con
        // acrónimos preservados. Si el título no tiene patrón numerado,
        // vsFormatTitleCasing lo devuelve intacto.
        const titulo = (typeof tb.vsFormatTitleCasing === 'function')
            ? tb.vsFormatTitleCasing(rawTitulo)
            : rawTitulo;

        out.push({
            text: titulo,
            fontSize: 12,
            bold: true,
            color: C.primary,
            margin: [0, sec.marginTop || 6, 0, 4]
        });
        out.push({
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: tb.CONTENT_WIDTH, y2: 0, lineWidth: 0.6, lineColor: C.primary }],
            margin: [0, 0, 0, 10]
        });

        // Texto introductorio opcional
        if (sec.intro) {
            out.push({
                text: sec.intro,
                fontSize: 10,
                color: C.text,
                alignment: 'justify',
                lineHeight: 1.4,
                margin: [0, 0, 0, 10]
            });
        }

        // Las secciones hijas se renderizan despues por el dispatcher principal
        return out;
    };

    // ====================================================================
    // CAJA NOTA (callout amarillo italic — para aclaraciones)
    // ====================================================================
    VS.shared.renderCajaNota = function (sec, tb) {
        const C = tb.VS_COLORS;
        const stack = [];

        if (sec.titulo) {
            stack.push({
                text: sec.titulo.toUpperCase(),
                fontSize: 9,
                bold: true,
                color: C.primary,
                margin: [0, 0, 0, 4],
                characterSpacing: 1
            });
        }

        const parrafos = Array.isArray(sec.parrafos) ? sec.parrafos : [sec.contenido || sec.texto || ''];
        parrafos.forEach((p, i) => {
            stack.push({
                text: p,
                fontSize: 9,
                italics: true,
                color: C.text,
                alignment: 'justify',
                lineHeight: 1.35,
                margin: [0, i === 0 ? 0 : 4, 0, 0]
            });
        });

        return [{
            table: {
                widths: ['*'],
                body: [[{
                    stack: stack,
                    fillColor: C.bgYellow,
                    margin: [12, 10, 12, 10],
                    border: [true, true, true, true]
                }]]
            },
            layout: {
                hLineWidth: () => 0.8, vLineWidth: () => 0.8,
                hLineColor: () => '#E0C97C', vLineColor: () => '#E0C97C'
            },
            margin: [0, 0, 0, 14]
        }];
    };

    // ====================================================================
    // CAJA JUSTIFICACION (caja con borde + titulo destacado)
    // Para "PQ No Aplica — Justificación" y similares
    // ====================================================================
    VS.shared.renderCajaJustificacion = function (sec, tb) {
        const C = tb.VS_COLORS;
        const stack = [];

        if (sec.titulo) {
            stack.push({
                text: sec.titulo,
                fontSize: 11,
                bold: true,
                color: C.primary,
                margin: [0, 0, 0, 6]
            });
        }

        const parrafos = Array.isArray(sec.parrafos) ? sec.parrafos : [sec.contenido || sec.texto || ''];
        parrafos.forEach((p, i) => {
            const isItalic = sec.parrafosItalic ? sec.parrafosItalic[i] : (i > 0);
            stack.push({
                text: p,
                fontSize: 10,
                italics: isItalic,
                color: C.text,
                alignment: 'justify',
                lineHeight: 1.4,
                margin: [0, i === 0 ? 0 : 8, 0, 0]
            });
        });

        return [{
            unbreakable: true,
            table: {
                widths: ['*'],
                body: [[{
                    stack: stack,
                    fillColor: C.bgSoft,
                    margin: [14, 12, 14, 12],
                    border: [true, true, true, true]
                }]]
            },
            layout: {
                hLineWidth: () => 0.8, vLineWidth: () => 0.8,
                hLineColor: () => C.border, vLineColor: () => C.border
            },
            margin: [0, 0, 0, 14]
        }];
    };

    // ====================================================================
    // CAJA CRITERIO (banner verde con titulo destacado)
    // Para "El sistema se considera VALIDADO cuando..."
    // ====================================================================
    VS.shared.renderCajaCriterio = function (sec, tb) {
        const C = tb.VS_COLORS;
        const items = Array.isArray(sec.items) ? sec.items : [];
        const out = [];

        // Banner verde con título
        out.push({
            table: {
                widths: ['*'],
                body: [[{
                    text: sec.titulo || '',
                    fontSize: 12,
                    bold: true,
                    color: C.white,
                    alignment: 'center',
                    fillColor: C.accent,
                    margin: [16, 12, 16, 12],
                    border: [false, false, false, false]
                }]]
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
            margin: [0, 0, items.length ? 10 : 14, 0]
        });

        // Lista de criterios (si el JSON incluye sec.items)
        items.forEach(function (item, i) {
            out.push({
                columns: [
                    { text: '✓', width: 16, fontSize: 10, bold: true, color: C.accent, margin: [0, 1, 0, 0] },
                    { text: item, fontSize: 10, color: C.text, alignment: 'justify', lineHeight: 1.4 }
                ],
                margin: [0, i === 0 ? 0 : 5, 0, i === items.length - 1 ? 14 : 0]
            });
        });

        return out;
    };

    // ====================================================================
    // TRAZABILIDAD DOCUMENTAL — bloque auto-inyectado (schema v2.0)
    //
    // Lee data.trazabilidad (recibeDe: [{tipo, code, version, fechaCongelado,
    // items[], itemsCount, estado, _auto}], alimentaA: [...]) y genera un
    // panel visual al inicio del cuerpo del documento.
    //
    // NO se invoca como section type — cada renderer principal lo prepende
    // automáticamente si detecta v2.0. El bloque tiene su propio título
    // destacado pero NO consume número de sección (es metadata).
    //
    // Backward compat: si trazabilidad no es v2.0 (string array o ausente),
    // esta función devuelve [] — no aparece nada en el PDF.
    // ====================================================================
    VS.shared.renderTrazabilidadDetallada = function (data, tb) {
        const traz = data && data.trazabilidad;
        if (!traz || traz.schemaVersion !== '2.0') return [];

        const C = tb.VS_COLORS;
        const recibe = Array.isArray(traz.recibeDe) ? traz.recibeDe : [];
        const alimenta = Array.isArray(traz.alimentaA) ? traz.alimentaA : [];

        if (recibe.length === 0 && alimenta.length === 0) return [];

        const out = [];

        // Título del bloque (sin numeración — es meta, no sección)
        out.push({
            text: 'TRAZABILIDAD DOCUMENTAL',
            fontSize: 13,
            bold: true,
            color: C.primary,
            characterSpacing: 0.5,
            margin: [0, 12, 0, 4]
        });

        // Línea bajo el título
        out.push({
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: 455, y2: 0, lineWidth: 1, lineColor: C.primary }],
            margin: [0, 0, 0, 10]
        });

        // Sub-bloque "Recibe de" — un panel por cada tipo declarado
        if (recibe.length > 0) {
            out.push({
                text: 'Recibe de:',
                fontSize: 10, bold: true, color: C.primary,
                margin: [0, 0, 0, 6]
            });

            recibe.forEach((r, i) => {
                if (!r || !r.tipo) return;

                const code = r.code || '—';
                const version = r.version ? `v${r.version}` : (r.version === '' ? '' : '');
                // ese string raro es para evitar imprimir "vundefined" si no hay version
                const fecha = r.fechaCongelado ? `congelado ${r.fechaCongelado}` : '';
                const count = (r.itemsCount != null) ? `${r.itemsCount} items` : `${(r.items || []).length} items`;
                const estado = r.estado || '';
                const autoTag = r._auto ? '[auto]' : '[manual]';

                // Header row: tipo + code + version + fecha + count
                const headerSegments = [];
                headerSegments.push({ text: r.tipo, bold: true, color: C.primary, fontSize: 10 });
                headerSegments.push({ text: '  ·  ', color: C.textSoft, fontSize: 10 });
                headerSegments.push({ text: code, color: C.text, fontSize: 10 });
                if (version) headerSegments.push({ text: ' ' + version, italics: true, color: C.textSoft, fontSize: 10 });
                if (fecha) {
                    headerSegments.push({ text: '  ·  ', color: C.textSoft, fontSize: 10 });
                    headerSegments.push({ text: fecha, italics: true, color: C.textSoft, fontSize: 9 });
                }
                headerSegments.push({ text: '  ·  ', color: C.textSoft, fontSize: 10 });
                headerSegments.push({ text: count, color: C.primary, bold: true, fontSize: 9 });
                if (estado) {
                    headerSegments.push({ text: '  ·  ', color: C.textSoft, fontSize: 10 });
                    headerSegments.push({ text: estado, color: C.statusApproved || '#1E7E34', fontSize: 9, italics: true });
                }
                headerSegments.push({ text: '   ', fontSize: 10 });
                headerSegments.push({ text: autoTag, color: C.textSoft, fontSize: 8, italics: true });

                // Items en bloque compacto
                const items = Array.isArray(r.items) ? r.items : [];
                const itemsText = items.length > 0 ? items.join(', ') : '—';

                out.push({
                    table: {
                        widths: ['*'],
                        body: [[{
                            stack: [
                                { text: headerSegments, margin: [0, 0, 0, 4] },
                                { text: itemsText, fontSize: 8.5, color: C.textSoft, italics: false, margin: [0, 0, 0, 0], lineHeight: 1.3 }
                            ],
                            fillColor: '#F5F8FA',
                            margin: [10, 7, 10, 7]
                        }]]
                    },
                    layout: {
                        hLineWidth: () => 0,
                        vLineWidth: (i) => i === 0 ? 3 : 0,
                        vLineColor: () => C.primary,
                        paddingLeft: () => 0, paddingRight: () => 0
                    },
                    margin: [0, 0, 0, 6]
                });
            });
        }

        // Sub-bloque "Alimenta a"
        if (alimenta.length > 0) {
            // Formato v1 (array de strings) y v2 (array de objects) ambos soportados
            const alimentaTxts = alimenta.map(a => {
                if (typeof a === 'string') return a;
                if (a && a.tipo) {
                    const code = a.codeEsperado || a.code || '';
                    const rel = a.relacion ? ` (${a.relacion})` : '';
                    return code ? `${a.tipo} aporta a ${code}${rel}` : `${a.tipo}${rel}`;
                }
                return '';
            }).filter(Boolean);

            if (alimentaTxts.length > 0) {
                out.push({
                    text: 'Alimenta a:',
                    fontSize: 10, bold: true, color: C.primary,
                    margin: [0, 6, 0, 4]
                });
                out.push({
                    text: alimentaTxts.join('  ·  '),
                    fontSize: 9, color: C.text, italics: true,
                    margin: [10, 0, 0, 12]
                });
            }
        }

        // Separator visual al final
        out.push({
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: 455, y2: 0, lineWidth: 0.5, lineColor: C.border }],
            margin: [0, 4, 0, 18]
        });

        return out;
    };

})(window);
