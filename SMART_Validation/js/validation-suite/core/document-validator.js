/* ====================================================================
   VALIDATION SUITE — DOCUMENT VALIDATOR ENGINE
   Sistema extensible de validacion interna por tipo de documento.

   Diseno:
   - VS.validators es un mapa { type: validatorFunction }.
   - Cada renderer puede llamar VS.validateDocument(data) antes de
     renderizar para detectar inconsistencias internas.
   - Devuelve un reporte: { valid, errors, warnings, info, summary }.
   - Los renderers que soportan validacion (ej. MTR) muestran una
     "caja de validacion" al inicio del PDF con el resultado.

   FASE 1 (este modulo): validacion INTERNA de un solo documento.
     Verifica autocontencion: IDs unicos, formato correcto, cobertura,
     conteos coherentes, etc. NO cruza referencias a otros documentos.

   FASE 2 (futura): validacion CRUZADA entre documentos del paquete.
     Requiere un "workspace" en la UI que cargue multiples JSONs.
     El cross-validator verificara que cada URS-ID en MTR exista en
     URS, cada RA-ID exista en RA, etc.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.validators = VS.validators || {};

    // ====================================================================
    // PATRONES DE IDS (regex compartidos)
    // ====================================================================
    const ID_PATTERNS = {
        URS:    /^URS-(\d{3,4}|NF-\d{3,4})$/,
        RA:     /^RA-\d{3,4}$/,
        IRA:    /^COMP-(SW|INF|SEC)-\d{2,3}$/,
        TC_IQ:  /^TC-IQ-\d{3}$/,
        TC_OQ:  /^TC-OQ-\d{3}$/,
        TC_PQ:  /^TC-PQ-\d{3}$/,
        GAP:    /^GAP-\d{3}$/,
        FRS:    /^FRS-(\d{3}|IF-\d{3})$/,
        ALG:    /^ALG-(IN-|OUT-)?\d{3}$/
    };

    /** Helper: chequea si un ID matchea el patron del tipo. */
    function matchesIdPattern(id, type) {
        if (id == null || id === '' || id === '—' || id === '-') return true;
        const p = ID_PATTERNS[type];
        if (!p) return true;  // tipo no conocido, no validar
        return p.test(String(id).trim());
    }

    /** Helper: separa un campo "URS-001 | URS-002" en array. */
    function splitMultiId(value) {
        if (!value) return [];
        return String(value).split('|').map(s => s.trim()).filter(Boolean);
    }

    // ====================================================================
    // VALIDADOR: MTR
    // ====================================================================
    VS.validators.MTR = function validateMTR(data) {
        const report = {
            valid: true,
            errors: [],
            warnings: [],
            info: [],
            summary: {
                ursTotal: 0,
                modulosCount: {},
                tcIqCount: 0,
                tcOqCount: 0,
                cobertura: 0
            }
        };

        function err(msg, ctx)  { report.errors.push({ msg, ctx });  report.valid = false; }
        function warn(msg, ctx) { report.warnings.push({ msg, ctx }); }
        function info(msg)      { report.info.push({ msg }); }

        const secciones = data.secciones || [];
        const tablaTraza = secciones.find(s => s.tipo === 'tabla-trazabilidad');

        if (!tablaTraza) {
            err('No se encontró ninguna sección "tabla-trazabilidad" en la MTR.');
            return report;
        }

        const filas = tablaTraza.filas || [];
        const seenUrsIds = new Set();
        let currentModulo = null;
        // Solo contar filas con URS-ID con formato válido — excluye subheaders,
        // filas de totales/separadores y cualquier fila sin ID real
        const filasReales = filas.filter(f =>
            f && f.subheader == null &&
            f.ursId && f.ursId !== '—' && f.ursId !== '-' && f.ursId !== '--' &&
            ID_PATTERNS.URS.test(String(f.ursId).trim())
        );
        const conteoPorModulo = {};
        // Sets de IDs únicos para contar TCs reales, no filas URS que los referencian
        const tcIqSet = new Set();
        const tcOqSet = new Set();
        let urssSinTcOq = 0;

        filas.forEach((f, idx) => {
            // Sub-header de modulo
            if (f && typeof f === 'object' && f.subheader != null) {
                currentModulo = f.subheader;
                return;
            }

            const ctx = `Fila ${idx + 1} (${f.ursId || 'sin ID'})`;

            // 1. URS-ID obligatorio y formato correcto
            if (!f.ursId) {
                err('Fila sin URS-ID', ctx);
            } else {
                if (!matchesIdPattern(f.ursId, 'URS')) {
                    err(`URS-ID con formato inválido: "${f.ursId}". Esperado: URS-NNN o URS-NF-NNN`, ctx);
                }
                if (seenUrsIds.has(f.ursId)) {
                    err(`URS-ID duplicado: "${f.ursId}"`, ctx);
                }
                seenUrsIds.add(f.ursId);
            }

            // 2. Descripcion no vacia
            if (!f.descripcion || String(f.descripcion).trim() === '') {
                warn('Fila sin descripción', ctx);
            }

            // 3. Criticidad valida
            const critValidas = ['CRÍTICO', 'CRITICO', 'ALTO', 'MEDIO'];
            if (!f.criticidad) {
                warn('Fila sin criticidad asignada', ctx);
            } else if (!critValidas.includes(String(f.criticidad).toUpperCase())) {
                err(`Criticidad inválida: "${f.criticidad}". Esperado: CRÍTICO | ALTO | MEDIO`, ctx);
            }

            // 4. Modulo poblado (info)
            if (!f.modulo) {
                warn('Fila sin módulo asignado', ctx);
            } else {
                conteoPorModulo[f.modulo] = (conteoPorModulo[f.modulo] || 0) + 1;
            }

            // 5. RA-ID formato (multi separated by |)
            splitMultiId(f.raId).forEach(rid => {
                if (rid !== '—' && rid !== '-' && !matchesIdPattern(rid, 'RA')) {
                    err(`RA-ID con formato inválido: "${rid}". Esperado: RA-NNN`, ctx);
                }
            });

            // 6. TC-IQ formato (puede ser "—" o "--" si no aplica)
            if (f.tcIq && f.tcIq !== '—' && f.tcIq !== '--' && f.tcIq !== '-') {
                splitMultiId(f.tcIq).forEach(tc => {
                    if (!matchesIdPattern(tc, 'TC_IQ')) {
                        err(`TC-IQ con formato inválido: "${tc}". Esperado: TC-IQ-NNN`, ctx);
                    } else {
                        tcIqSet.add(tc);
                    }
                });
            }

            // 7. TC-OQ — advertencia (no error) porque el MTR puede generarse antes de la fase OQ
            if (!f.tcOq || f.tcOq === '—' || f.tcOq === '--' || f.tcOq === '-') {
                warn(`URS sin TC-OQ asignado: "${f.ursId}" — pendiente de fase OQ`, ctx);
                urssSinTcOq++;
            } else {
                splitMultiId(f.tcOq).forEach(tc => {
                    if (!matchesIdPattern(tc, 'TC_OQ')) {
                        err(`TC-OQ con formato inválido: "${tc}". Esperado: TC-OQ-NNN`, ctx);
                    } else {
                        tcOqSet.add(tc);
                    }
                });
            }
        });

        // Resumen
        const conteoTcIq = tcIqSet.size;
        const conteoTcOq = tcOqSet.size;
        // Cobertura: % de URS reales que tienen al menos un TC-OQ en la tabla
        const ursCubiertas = filasReales.filter(f =>
            f.tcOq && f.tcOq !== '—' && f.tcOq !== '--' && f.tcOq !== '-'
        ).length;
        report.summary.ursTotal = filasReales.length;
        report.summary.modulosCount = conteoPorModulo;
        report.summary.tcIqCount = conteoTcIq;
        report.summary.tcOqCount = conteoTcOq;
        report.summary.cobertura = filasReales.length > 0
            ? Math.round((ursCubiertas / filasReales.length) * 100)
            : 0;

        info(`Total URS evaluados: ${filasReales.length}`);
        info(`Cobertura URS→TC-OQ: ${report.summary.cobertura}% (${ursCubiertas}/${filasReales.length})`);
        info(`TC-IQ únicos: ${conteoTcIq} | TC-OQ únicos: ${conteoTcOq}`);
        info(`Módulos detectados: ${Object.keys(conteoPorModulo).join(', ') || '—'}`);

        // 8. Validacion del resumen estadistico declarado vs conteo real
        const resumen = secciones.find(s => s.tipo === 'tabla' && /resumen/i.test(s.titulo || ''));
        if (resumen && resumen.filas) {
            // Cada fila del resumen tiene formato: [Modulo, RangoURS, Total, TCsIQ, TCsOQ]
            // (formato libre — solo verificamos coherencia sumas)
            const filasResumen = resumen.filas.filter(r => Array.isArray(r));
            if (filasResumen.length > 1) {
                // Buscar la fila TOTAL (ultima) y sumar las columnas Total/TCsIQ/TCsOQ
                const totalFila = filasResumen[filasResumen.length - 1];
                const totalDecl = parseInt(typeof totalFila[2] === 'object' ? totalFila[2].text : totalFila[2], 10);
                if (!isNaN(totalDecl) && totalDecl !== filasReales.length) {
                    warn(`Resumen estadístico declara ${totalDecl} URS pero en la matriz hay ${filasReales.length}.`);
                }
            }
        }

        return report;
    };

    // ====================================================================
    // VALIDADOR DE CALIFICACIONES: PIQ/IIQ (IQ) + POQ/IOQ (OQ) [+ PPQ/IPQ futuro]
    //
    // Reglas comunes:
    // - TCs vienen dentro de secciones tipo 'tabla-test-case' o 'matriz-tc'.
    // - Cada TC debe tener: tcId (formato TC-{IQ|OQ|PQ}-NNN), titulo.
    // - tcId único por sección (dedupe entre secciones eligiendo la versión
    //   más rica para evaluación).
    // - URS con formato URS-NNN o URS-NF-NNN.
    // - Niveles: derivados de raScore (legacy IQ) o explícitos (OQ/PQ).
    //
    // Reglas específicas por qualKind:
    // - IQ: componente con formato del IRA obligatorio (trazabilidad a IRA).
    //   Schema modo "criterios": cada TC con criterios[] consolidados.
    // - OQ: componente OPCIONAL (los TCs verifican comportamiento, no
    //   componentes físicos). Schema modo "procedimiento": cada TC con
    //   procedimiento[] (3-12 pasos) + criterioAceptacion (string).
    //   tipoTC: POSITIVO|NEGATIVO. nivel: CRÍTICO|ALTO|MEDIO|BAJO.
    //
    // En modo informe (IIQ/IOQ/IPQ):
    // - Cada TC con estado != null debe tener ejecutor + fechaEjecucion.
    // - OQ: si estado distinto de NA, criterioObservado debería estar.
    // - Hallazgos del TC con id formato NC-NNN.
    // ====================================================================
    function validateQualificationDocument(data, qualKind, esInforme) {
        const report = {
            valid: true,
            errors: [],
            warnings: [],
            info: [],
            summary: {
                tcTotal: 0,
                porGrupo: {},
                porProfundidad: { Basica: 0, Estandar: 0, Exhaustiva: 0, otros: 0 },
                cobertura: 0,
                ejecutados: 0
            }
        };
        function err(msg, ctx)  { report.errors.push({ msg, ctx });  report.valid = false; }
        function warn(msg, ctx) { report.warnings.push({ msg, ctx }); }
        function info(msg)      { report.info.push({ msg }); }

        const secciones = data.secciones || [];
        const seenTcIds = new Set();
        const tcIdPattern = 'TC_' + qualKind;        // 'TC_IQ' | 'TC_OQ' | 'TC_PQ'
        const tcIdHumanFmt = 'TC-' + qualKind + '-NNN';
        // OQ y PQ comparten reglas: componente opcional, tipoTC requerido,
        // schemaModo procedimiento default, criterioObservado en informes.
        // IQ tiene su propia regla más estricta (componente requerido del IRA).
        const isOq = qualKind === 'OQ' || qualKind === 'PQ';

        // Recolectar TCs — dedupe por tcId, prefiriendo la versión con MÁS datos.
        // El mismo TC suele aparecer en `matriz-tc` (metadata mínima) y en
        // `tabla-test-case` (objetivo + criterios|procedimiento + ...). Quedarse
        // con la más rica para que el validador pueda evaluar criterios CSA.
        // Detectar duplicados DENTRO de una misma sección (eso sí es error).
        const tcByid = new Map();
        function tcRichness(tc) {
            // Heurística simple: cuántos campos clave tiene poblados.
            let score = 0;
            if (tc.objetivo) score += 1;
            if (Array.isArray(tc.criterios) && tc.criterios.length > 0) score += 3;
            if (Array.isArray(tc.procedimiento) && tc.procedimiento.length > 0) score += 3;
            if (tc.evidenciaEsperada) score += 1;
            if (tc.criterioAceptacion) score += 2;
            if (Array.isArray(tc.precondiciones) && tc.precondiciones.length > 0) score += 1;
            return score;
        }
        secciones.forEach(sec => {
            if (sec.tipo === 'tabla-test-case' || sec.tipo === 'matriz-tc') {
                const idsEnSeccion = new Set();
                (sec.tcs || []).forEach(tc => {
                    if (!tc || !tc.tcId) {
                        // TC sin ID: igual lo guardamos para que el validador reporte la falta de tcId
                        tcByid.set(Symbol(), tc);
                        return;
                    }
                    if (idsEnSeccion.has(tc.tcId)) {
                        err(`tcId duplicado en sección "${sec.tipo}": "${tc.tcId}"`, `sección ${sec.tipo}`);
                        return;
                    }
                    idsEnSeccion.add(tc.tcId);
                    const existente = tcByid.get(tc.tcId);
                    if (!existente || tcRichness(tc) > tcRichness(existente)) {
                        tcByid.set(tc.tcId, tc);
                    }
                });
            }
        });
        const tcsRecolectados = Array.from(tcByid.values());

        if (tcsRecolectados.length === 0) {
            warn('No se encontraron Test Cases en el documento (ninguna sección tabla-test-case o matriz-tc con TCs).');
        }

        const NC_PATTERN = /^NC-\d{3,4}$/;

        tcsRecolectados.forEach(tc => {
            const ctx = `TC ${tc.tcId || '(sin ID)'}`;

            // 1. tcId (formato según qualKind)
            if (!tc.tcId) {
                err('Test Case sin tcId', ctx);
            } else {
                if (!matchesIdPattern(tc.tcId, tcIdPattern)) {
                    err(`tcId con formato inválido: "${tc.tcId}". Esperado: ${tcIdHumanFmt}`, ctx);
                }
                seenTcIds.add(tc.tcId);
            }

            // 2. titulo
            if (!tc.titulo || String(tc.titulo).trim() === '') {
                warn('Test Case sin título', ctx);
            }

            // 3. componente — IQ obligatorio (trazabilidad IRA), OQ opcional
            if (!isOq) {
                if (!tc.componente) {
                    warn('Test Case sin componente declarado (rompe trazabilidad al IRA)', ctx);
                } else if (!matchesIdPattern(tc.componente, 'IRA')) {
                    err(`Componente con formato inválido: "${tc.componente}". Esperado: COMP-SW/INF/SEC-NN o "—"`, ctx);
                }
            } else {
                // OQ: componente opcional, pero si se declara debe tener formato válido
                if (tc.componente && !matchesIdPattern(tc.componente, 'IRA')) {
                    err(`Componente con formato inválido: "${tc.componente}". Esperado: COMP-SW/INF/SEC-NN o "—"`, ctx);
                }
            }

            // 4. raScore numérico (1-27 = rango RPN/RA-Score)
            if (tc.raScore != null) {
                const n = parseInt(tc.raScore, 10);
                if (isNaN(n) || n < 1 || n > 27) {
                    err(`raScore fuera de rango: "${tc.raScore}". Esperado: número 1-27`, ctx);
                }
            }

            // 5. URS vinculados (array o string)
            const urs = Array.isArray(tc.ursVinculados)
                ? tc.ursVinculados
                : (tc.ursVinculados ? [tc.ursVinculados] : []);
            urs.forEach(u => {
                if (u !== '—' && u !== '-' && u !== '' && !matchesIdPattern(u, 'URS')) {
                    err(`URS vinculado con formato inválido: "${u}". Esperado: URS-NNN o URS-NF-NNN`, ctx);
                }
            });

            // 6. RA vinculado (formato canónico RA-NNN, opcional)
            if (tc.raVinculado && tc.raVinculado !== '—' && !matchesIdPattern(tc.raVinculado, 'RA')) {
                if (!/^RA-\d{3,4}$/.test(String(tc.raVinculado).trim())) {
                    err(`RA vinculado con formato inválido: "${tc.raVinculado}". Esperado: RA-NNN o "—"`, ctx);
                }
            }

            // 7. Profundidad (BASICA/ESTANDAR/EXHAUSTIVA — normalizar acentos)
            // Aplica a IQ; en OQ es opcional (típicamente se usa "nivel" en su lugar)
            if (tc.profundidad) {
                const p = String(tc.profundidad)
                    .normalize('NFD').replace(/[̀-ͯ]/g, '')
                    .toUpperCase().trim();
                const validas = ['BASICA', 'ESTANDAR', 'EXHAUSTIVA'];
                if (!validas.includes(p)) {
                    warn(`Profundidad no estándar: "${tc.profundidad}". Esperado: Básica / Estándar / Exhaustiva`, ctx);
                }
            }

            // 7b. nivel (OQ explícito): CRÍTICO/ALTO/MEDIO/BAJO
            if (tc.nivel) {
                const n = String(tc.nivel)
                    .normalize('NFD').replace(/[̀-ͯ]/g, '')
                    .toUpperCase().trim();
                const validos = ['CRITICO', 'ALTO', 'MEDIO', 'BAJO'];
                if (!validos.includes(n)) {
                    warn(`Nivel no estándar: "${tc.nivel}". Esperado: CRÍTICO / ALTO / MEDIO / BAJO`, ctx);
                }
            }

            // 7c. tipoTC (OQ): POSITIVO/NEGATIVO
            if (tc.tipoTC) {
                const t = String(tc.tipoTC).toUpperCase().trim();
                if (t !== 'POSITIVO' && t !== 'NEGATIVO' && t !== 'POS' && t !== 'NEG') {
                    err(`tipoTC inválido: "${tc.tipoTC}". Esperado: POSITIVO o NEGATIVO`, ctx);
                }
            } else if (isOq) {
                warn(`Test Case ${qualKind} sin tipoTC declarado (esperado POSITIVO o NEGATIVO)`, ctx);
            }

            // 8. Schema modo dispatch — qué espera el TC según su forma
            // - 'criterios':   criterios[] requerido (estilo IQ/CSA)
            // - 'procedimiento': procedimiento[] + criterioAceptacion requeridos (estilo OQ)
            const tieneProc = Array.isArray(tc.procedimiento) && tc.procedimiento.length > 0;
            const tieneCrit = Array.isArray(tc.criterios) && tc.criterios.length > 0;

            if (isOq) {
                // OQ esperado: procedimiento[] + criterioAceptacion
                if (!tieneProc && !tieneCrit) {
                    warn(`Test Case ${qualKind} sin procedimiento[] ni criterios[] (debe tener al menos uno)`, ctx);
                }
                if (tieneProc) {
                    if (tc.procedimiento.length < 2) {
                        warn('Procedimiento con menos de 2 pasos — revisar si la verificación es completa', ctx);
                    }
                    if (tc.procedimiento.length > 12) {
                        warn(`Procedimiento con ${tc.procedimiento.length} pasos — posible sobre-scripting (CSA recomienda ≤12)`, ctx);
                    }
                    tc.procedimiento.forEach((p, i) => {
                        if (!p.instruccion) warn(`Paso ${p.paso != null ? p.paso : i + 1} sin instrucción`, ctx);
                        if (!p.resultadoEsperado) warn(`Paso ${p.paso != null ? p.paso : i + 1} sin resultadoEsperado`, ctx);
                    });
                    if (!tc.criterioAceptacion || String(tc.criterioAceptacion).trim() === '') {
                        warn(`Test Case ${qualKind} con procedimiento[] pero sin criterioAceptacion consolidado`, ctx);
                    }
                }
            } else {
                // IQ esperado: criterios[] consolidados
                if (!tieneCrit) {
                    warn('Test Case sin criterios definidos (enfoque CSA requiere criterios consolidados)', ctx);
                }
            }

            // 9. Modo INFORME — chequeos extras
            if (esInforme) {
                if (tc.estado != null) {
                    if (!tc.ejecutor) warn('TC con estado poblado pero sin ejecutor', ctx);
                    if (!tc.fechaEjecucion) warn('TC con estado poblado pero sin fechaEjecucion', ctx);

                    // OQ: estado != NA debería tener criterioObservado
                    if (isOq) {
                        const estadoUp = String(tc.estado).toUpperCase().trim();
                        const esNa = (estadoUp === 'NA' || estadoUp === 'N/A' || estadoUp === 'NO APLICA');
                        if (!esNa && !tc.criterioObservado) {
                            warn(`TC ${qualKind} con estado distinto de NA debería tener criterioObservado (qué se observó frente al criterio de aceptación)`, ctx);
                        }
                    }
                }

                // Hallazgos: cada uno debe tener id, severidad, descripcion
                (tc.hallazgos || []).forEach((h, i) => {
                    if (!h.id) {
                        warn(`Hallazgo #${i + 1} sin id`, ctx);
                    } else if (!NC_PATTERN.test(h.id)) {
                        err(`Hallazgo con id inválido: "${h.id}". Esperado: NC-NNN`, ctx);
                    }
                    if (!h.severidad) warn(`Hallazgo ${h.id || '#' + (i + 1)} sin severidad`, ctx);
                    if (!h.descripcion) warn(`Hallazgo ${h.id || '#' + (i + 1)} sin descripcion`, ctx);
                });
            }

            // Acumular en summary
            const grupo = tc.grupo || 'Sin grupo';
            report.summary.porGrupo[grupo] = (report.summary.porGrupo[grupo] || 0) + 1;

            const profKey = (tc.profundidad || '').replace(/[áÁ]/g, 'a').replace(/[éÉ]/g, 'e').replace(/[íÍ]/g, 'i').replace(/[óÓ]/g, 'o').replace(/[úÚ]/g, 'u');
            const profNorm = profKey.charAt(0).toUpperCase() + profKey.slice(1).toLowerCase();
            if (report.summary.porProfundidad[profNorm] != null) {
                report.summary.porProfundidad[profNorm]++;
            } else {
                report.summary.porProfundidad.otros++;
            }

            if (esInforme && tc.estado != null) {
                report.summary.ejecutados++;
            }
        });

        report.summary.tcTotal = tcsRecolectados.length;

        if (esInforme) {
            const cob = tcsRecolectados.length > 0
                ? Math.round((report.summary.ejecutados / tcsRecolectados.length) * 100)
                : 0;
            report.summary.cobertura = cob;
            info(`Total TCs: ${tcsRecolectados.length}`);
            info(`Ejecutados: ${report.summary.ejecutados} (${cob}%)`);
        } else {
            info(`Total TCs definidos: ${tcsRecolectados.length}`);
        }

        const grupos = Object.keys(report.summary.porGrupo);
        if (grupos.length > 0) info(`Grupos: ${grupos.join(', ')}`);

        return report;
    }

    VS.validators.PIQ = function validatePIQ(data) { return validateQualificationDocument(data, 'IQ', false); };
    VS.validators.IIQ = function validateIIQ(data) { return validateQualificationDocument(data, 'IQ', true); };
    VS.validators.POQ = function validatePOQ(data) { return validateQualificationDocument(data, 'OQ', false); };
    VS.validators.IOQ = function validateIOQ(data) { return validateQualificationDocument(data, 'OQ', true); };
    VS.validators.PPQ = function validatePPQ(data) { return validateQualificationDocument(data, 'PQ', false); };
    VS.validators.IPQ = function validateIPQ(data) { return validateQualificationDocument(data, 'PQ', true); };

    // ====================================================================
    // VALIDATOR NCR — Non-Conformance Report
    //
    // Verifica:
    // - Estructura básica (type/package/document/secciones).
    // - Las 4 secciones gated en orden esperado.
    // - Para cada sección "aprobada": firmas obligatorias completas.
    // - Gating: si la sección N tiene contenido pero la N-1 no está
    //   aprobada → warning (permite borradores en progreso).
    // - NC-IDs únicos en sección 1.
    // - ncRef en análisis y CAPA debe coincidir con un NC del registro.
    // ====================================================================
    VS.validators.NCR = function validateNCR(data) {
        const errors = [];
        const warnings = [];

        if (!data || typeof data !== 'object') return { valid: false, errors: [{ msg: 'JSON inválido' }], warnings: [] };
        if (data.type !== 'NCR') errors.push({ msg: `Type esperado "NCR", recibido "${data.type}"` });
        if (!data.package) errors.push({ msg: 'Falta sección "package"' });
        if (!data.document) errors.push({ msg: 'Falta sección "document"' });
        if (!Array.isArray(data.secciones)) errors.push({ msg: 'Falta array "secciones"' });

        if (errors.length > 0) return { valid: false, errors, warnings };

        const gatedTypes = ['ncr-registro-hallazgos', 'ncr-analisis-causa', 'ncr-plan-capa', 'ncr-cierre-aprobacion'];
        const secByType = {};
        gatedTypes.forEach(t => { secByType[t] = data.secciones.find(s => s.tipo === t); });

        gatedTypes.forEach((t, i) => {
            if (!secByType[t]) {
                errors.push({ msg: `Falta sección gated "${t}" (etapa ${i + 1})` });
            }
        });

        // Helper local: ¿sección aprobada?
        function approved(sec) {
            if (!sec) return false;
            if (sec.estado === 'aprobada') {
                const required = (sec.firmasRequeridas || []).filter(r => r.obligatoria !== false);
                const firmas = sec.firmas || [];
                return required.every(r => firmas.some(f => f.rol === r.rol && f.nombre && f.fecha));
            }
            return false;
        }

        // Para cada gated: si está marcada aprobada pero faltan firmas obligatorias → error
        gatedTypes.forEach((t, i) => {
            const sec = secByType[t];
            if (!sec) return;
            if (sec.estado === 'aprobada') {
                const required = (sec.firmasRequeridas || []).filter(r => r.obligatoria !== false);
                const firmas = sec.firmas || [];
                required.forEach(req => {
                    const f = firmas.find(x => x.rol === req.rol);
                    if (!f || !f.nombre || !f.fecha) {
                        errors.push({ msg: `Sección "${t}" marcada "aprobada" pero falta firma obligatoria: rol="${req.rol}"` });
                    }
                });
            }
            // Gating: si esta sección tiene contenido pero la anterior no está aprobada → warning.
            // "Contenido" = array no vacío o resumen con totalNcs > 0 (no contamos arrays vacíos).
            if (i > 0) {
                const prev = secByType[gatedTypes[i - 1]];
                const hasContent = (Array.isArray(sec.hallazgos) && sec.hallazgos.length > 0)
                    || (Array.isArray(sec.analisis) && sec.analisis.length > 0)
                    || (Array.isArray(sec.capas) && sec.capas.length > 0)
                    || (sec.resumen && typeof sec.resumen.totalNcs === 'number' && sec.resumen.totalNcs > 0);
                if (hasContent && !approved(prev)) {
                    warnings.push({ msg: `Sección "${t}" tiene contenido pero la etapa anterior ("${gatedTypes[i - 1]}") no está aprobada. Workflow inconsistente.` });
                }
            }
        });

        // NC-IDs únicos
        const registro = secByType['ncr-registro-hallazgos'];
        const ncIds = new Set();
        if (registro && Array.isArray(registro.hallazgos)) {
            registro.hallazgos.forEach((h, idx) => {
                if (!h.id) {
                    errors.push({ msg: `Hallazgo #${idx + 1} sin id (NC-XXX)` });
                } else if (ncIds.has(h.id)) {
                    errors.push({ msg: `NC-ID duplicado: ${h.id}` });
                } else {
                    ncIds.add(h.id);
                }
            });
        }

        // ncRef en análisis y CAPA debe coincidir con NC registrado
        const analisis = secByType['ncr-analisis-causa'];
        if (analisis && Array.isArray(analisis.analisis)) {
            analisis.analisis.forEach((a, idx) => {
                if (a.ncId && !ncIds.has(a.ncId)) {
                    warnings.push({ msg: `Análisis #${idx + 1}: ncId "${a.ncId}" no figura en el registro de hallazgos.` });
                }
            });
        }
        const plan = secByType['ncr-plan-capa'];
        if (plan && Array.isArray(plan.capas)) {
            plan.capas.forEach((c, idx) => {
                if (c.ncId && !ncIds.has(c.ncId)) {
                    warnings.push({ msg: `CAPA #${idx + 1}: ncId "${c.ncId}" no figura en el registro de hallazgos.` });
                }
            });
        }

        // Aviso si el cierre dice aprobado pero hay CAPAs no verificadas
        const cierre = secByType['ncr-cierre-aprobacion'];
        if (cierre && cierre.estado === 'aprobada' && plan && Array.isArray(plan.capas)) {
            const noCerradas = plan.capas.filter(c => !/VERIF|CERR/.test(String(c.estadoCapa || '').toUpperCase()));
            if (noCerradas.length > 0) {
                warnings.push({ msg: `Cierre "aprobado" con ${noCerradas.length} CAPA(s) no verificada(s) — revisar antes de firmar.` });
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    };

    // ====================================================================
    // VALIDATOR REPORTES DE LIBERACION (RIQ / ROQ / RPQ)
    //
    // Verifica:
    // - Estructura básica.
    // - "type" coherente con "etapa" (RIQ↔IQ, ROQ↔OQ, RPQ↔PQ).
    // - Si decision === "APROBADO":
    //     - kpis.criticasAbiertas debe ser 0 (no se aprueba con NCs críticas abiertas).
    //     - kpis.fail debe ser 0 (no se aprueba con TCs FAIL sin resolver).
    // - Si "APROBADO CON CONDICIONES":
    //     - debe haber al menos un condicionante en la sección release-condicionantes.
    // - Firmas ejecutivas obligatorias: Sponsor / Director + Gerente QA.
    // ====================================================================
    function validateReleaseReport(data, typeExpected, etapaExpected) {
        const errors = [];
        const warnings = [];
        if (!data || typeof data !== 'object') return { valid: false, errors: [{ msg: 'JSON inválido' }], warnings: [] };
        if (data.type !== typeExpected) errors.push({ msg: `Type esperado "${typeExpected}", recibido "${data.type}"` });
        if (data.etapa && data.etapa !== etapaExpected) {
            errors.push({ msg: `Etapa esperada "${etapaExpected}" para ${typeExpected}, recibida "${data.etapa}"` });
        }
        if (!data.package) errors.push({ msg: 'Falta sección "package"' });
        if (!data.document) errors.push({ msg: 'Falta sección "document"' });
        if (!Array.isArray(data.secciones)) errors.push({ msg: 'Falta array "secciones"' });
        if (errors.length > 0) return { valid: false, errors, warnings };

        // Buscar secciones clave
        const portada = data.secciones.find(s => s.tipo === 'release-portada-decision');
        const resumen = data.secciones.find(s => s.tipo === 'release-resumen-ejecutivo');
        const cond = data.secciones.find(s => s.tipo === 'release-condicionantes');
        const formal = data.secciones.find(s => s.tipo === 'release-decision-formal');
        const firmas = data.secciones.find(s => s.tipo === 'tabla-firmas-final');

        const decision = (portada && portada.decision) || (formal && formal.decision)
            || (data.document && data.document.extras && data.document.extras['Decisión']) || '';
        const dec = String(decision).toUpperCase();

        // Gating crítico
        if (/^APROB(?!.*CONDIC)/.test(dec)) {
            // APROBADO pleno
            if (resumen && resumen.kpis) {
                const k = resumen.kpis;
                if (typeof k.criticasAbiertas === 'number' && k.criticasAbiertas > 0) {
                    errors.push({ msg: `${typeExpected} "APROBADO" con ${k.criticasAbiertas} NC(s) crítica(s) abiertas. No se puede aprobar plenamente — cerrar NCs vía NCR o cambiar a "APROBADO CON CONDICIONES".` });
                }
                if (typeof k.fail === 'number' && k.fail > 0) {
                    errors.push({ msg: `${typeExpected} "APROBADO" con ${k.fail} TC(s) FAIL. No se puede aprobar plenamente.` });
                }
                if (typeof k.hallazgosAbiertos === 'number' && k.hallazgosAbiertos > 0) {
                    warnings.push({ msg: `${typeExpected} "APROBADO" pero hay ${k.hallazgosAbiertos} hallazgo(s) abiertos. Verificar que sean menores y no requieran condicionantes.` });
                }
            }
        } else if (/CONDIC/.test(dec)) {
            // Aprobado con condiciones — exige al menos 1 condicionante
            const items = (cond && cond.condicionantes) || [];
            if (items.length === 0) {
                errors.push({ msg: `${typeExpected} "APROBADO CON CONDICIONES" requiere al menos un condicionante en la sección "release-condicionantes".` });
            }
        }

        // Firmas obligatorias
        if (firmas) {
            const f = firmas.firmas || [];
            const tieneSponsor = f.some(x => /SPONSOR|DIRECTOR/i.test(x.rol || '') && x.nombre && x.fecha);
            const tieneQA = f.some(x => /QA|CALIDAD/i.test(x.rol || '') && x.nombre && x.fecha);
            if (data.document && data.document.status === 'Aprobado') {
                if (!tieneSponsor) errors.push({ msg: 'Falta firma de Sponsor / Director (obligatoria para Aprobado)' });
                if (!tieneQA) errors.push({ msg: 'Falta firma de Gerente QA (obligatoria para Aprobado)' });
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    VS.validators.RIQ = function validateRIQ(data) { return validateReleaseReport(data, 'RIQ', 'IQ'); };
    VS.validators.ROQ = function validateROQ(data) { return validateReleaseReport(data, 'ROQ', 'OQ'); };
    VS.validators.RPQ = function validateRPQ(data) { return validateReleaseReport(data, 'RPQ', 'PQ'); };
    VS.validatorHelpers = VS.validatorHelpers || {};
    VS.validatorHelpers.validateReleaseReport = validateReleaseReport;

    // ====================================================================
    // VALIDATOR VSR — Validation Summary Report (Reporte Maestro)
    // ====================================================================
    VS.validators.VSR = function validateVSR(data) {
        const errors = [];
        const warnings = [];
        if (!data || typeof data !== 'object') return { valid: false, errors: [{ msg: 'JSON inválido' }], warnings: [] };
        if (data.type !== 'VSR') errors.push({ msg: `Type esperado "VSR", recibido "${data.type}"` });
        if (!data.package) errors.push({ msg: 'Falta "package"' });
        if (!data.document) errors.push({ msg: 'Falta "document"' });
        if (!Array.isArray(data.secciones)) errors.push({ msg: 'Falta array "secciones"' });
        if (errors.length > 0) return { valid: false, errors, warnings };

        // Secciones clave esperadas
        const expected = ['vsr-portada-final', 'vsr-inventario-paquete', 'vsr-cronologia-fases', 'vsr-decision-final'];
        expected.forEach(t => {
            if (!data.secciones.find(s => s.tipo === t)) {
                warnings.push({ msg: `Falta sección recomendada "${t}". El documento puede renderear pero el contenido ejecutivo queda incompleto.` });
            }
        });

        const portada = data.secciones.find(s => s.tipo === 'vsr-portada-final');
        const decision = (portada && portada.decision) || (data.document && data.document.extras && data.document.extras['Decisión global']) || '';
        const dec = String(decision).toUpperCase();
        const aprobado = /VALID|APROB|LIBER/.test(dec) && !/NO\s*VALID|NO\s*APROB|PENDIENTE/.test(dec);

        // Gating duro: si "SISTEMA VALIDADO", no puede haber NCs críticas abiertas
        if (aprobado) {
            const resumen = data.secciones.find(s => s.tipo === 'release-resumen-ejecutivo');
            if (resumen && resumen.kpis) {
                const k = resumen.kpis;
                if (typeof k.criticasAbiertas === 'number' && k.criticasAbiertas > 0) {
                    errors.push({ msg: `VSR "SISTEMA VALIDADO" con ${k.criticasAbiertas} NC(s) crítica(s) abiertas. No se puede declarar validado.` });
                }
                if (typeof k.fail === 'number' && k.fail > 0) {
                    errors.push({ msg: `VSR "SISTEMA VALIDADO" con ${k.fail} TC(s) FAIL. No se puede declarar validado plenamente.` });
                }
            }
        }

        // Cronología: si VSR aprobado, las 3 fases (IQ/OQ/PQ) deberían estar aprobadas
        const crono = data.secciones.find(s => s.tipo === 'vsr-cronologia-fases');
        if (aprobado && crono && Array.isArray(crono.fases)) {
            const requeridas = ['IQ', 'OQ', 'PQ'];
            requeridas.forEach(cod => {
                const f = crono.fases.find(x => x.codigo === cod);
                if (!f || !/APROB|CERR|VALID/.test(String(f.estado || '').toUpperCase())) {
                    errors.push({ msg: `VSR aprobado pero la fase ${cod} no está marcada como aprobada en la cronología.` });
                }
            });
        }

        // Firmas ejecutivas obligatorias para Aprobado
        const firmas = data.secciones.find(s => s.tipo === 'tabla-firmas-final');
        if (aprobado && firmas) {
            const f = firmas.firmas || [];
            const tieneSponsor = f.some(x => /SPONSOR/i.test(x.rol || '') && x.nombre && x.fecha);
            const tieneDirector = f.some(x => /DIRECTOR/i.test(x.rol || '') && x.nombre && x.fecha);
            const tieneQA = f.some(x => /QA|CALIDAD/i.test(x.rol || '') && x.nombre && x.fecha);
            if (!tieneSponsor) errors.push({ msg: 'Falta firma de Sponsor (obligatoria para VSR aprobado)' });
            if (!tieneDirector) errors.push({ msg: 'Falta firma de Director Técnico (obligatoria para VSR aprobado)' });
            if (!tieneQA) errors.push({ msg: 'Falta firma de Gerente QA (obligatoria para VSR aprobado)' });
        }

        return { valid: errors.length === 0, errors, warnings };
    };

    // Alias retrocompatible: si algún caller externo importa validateIqDocument
    // por nombre, sigue funcionando para el caso IQ.
    function validateIqDocument(data, esInforme) {
        return validateQualificationDocument(data, 'IQ', esInforme);
    }
    VS.validatorHelpers = VS.validatorHelpers || {};
    VS.validatorHelpers.validateIqDocument = validateIqDocument;
    VS.validatorHelpers.validateQualificationDocument = validateQualificationDocument;

    // ====================================================================
    // API GENERAL: VS.validateDocument(data)
    // ====================================================================
    VS.validateDocument = function (data) {
        const type = data && data.type;
        if (!type) {
            return {
                valid: false,
                errors: [{ msg: 'JSON sin campo "type". No se puede validar.' }],
                warnings: [], info: [], summary: {}
            };
        }
        const validator = VS.validators[type];
        let report;
        if (!validator) {
            report = {
                valid: true,
                errors: [],
                warnings: [{ msg: `Tipo "${type}" no tiene validador interno definido. Saltando validación.` }],
                info: [], summary: {}
            };
        } else {
            report = validator(data);
        }

        // ═══ Cross-reference validation (mergeado al final del report del doc-type) ═══
        // Si el módulo cross-ref está disponible, ejecuta validación de
        // trazabilidad bidireccional (huérfanas, items usados pero no
        // declarados, version mismatch). Los errores/warnings se mergean
        // al report del doc-type.
        if (VS.crossRef && typeof VS.crossRef.validateReferences === 'function') {
            try {
                const crossRep = VS.crossRef.validateReferences(data);
                report.errors = report.errors.concat(crossRep.errors || []);
                report.warnings = report.warnings.concat(crossRep.warnings || []);
                report.info = (report.info || []).concat(crossRep.info || []);
                if ((crossRep.errors || []).length > 0) report.valid = false;
            } catch (e) {
                report.warnings.push({ msg: 'Cross-reference validator falló: ' + e.message, ctx: 'cross-ref' });
            }
        }

        return report;
    };

    // Helpers exportados para que otros validadores los reusen
    VS.validatorHelpers = {
        ID_PATTERNS: ID_PATTERNS,
        matchesIdPattern: matchesIdPattern,
        splitMultiId: splitMultiId
    };

})(window);
