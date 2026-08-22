/* ====================================================================
   VALIDATION SUITE — MATRIX BUILDER
   Engine único que consolida la información del paquete documental
   + runtime del gestor en una estructura tabular reutilizable.

   Consumidores:
     - exportToExcel() : convierte a libro XLSX multi-hoja.
     - NOTIF / Reportes de liberación : consumen kpis, trazabilidadUrs,
       hallazgos directamente sin re-procesar.

   Filosofía: "una sola fuente, un solo número". Lo que se ve en el
   Excel y lo que se reporta en NOTIF/Liberación derivan de aquí.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.matrixBuilder = VS.matrixBuilder || {};

    // ====================================================================
    // CONSTANTES — tipos de documentos
    // ====================================================================
    const PROTOCOL_TYPES = ['PIQ', 'POQ', 'PPQ'];
    const REPORT_TYPES = ['IIQ', 'IOQ', 'IPQ'];
    const TC_BEARING_TYPES = [...PROTOCOL_TYPES, ...REPORT_TYPES];

    // ====================================================================
    // HELPERS — extractores por tipo
    // ====================================================================

    /**
     * Devuelve los TCs de un protocolo o informe.
     * Prefiere la matriz-tc (que típicamente tiene TODOS los TCs, ej. 47 en IOQ)
     * sobre tabla-test-case (que en informes abreviados puede tener solo 10).
     */
    function extractTCs(doc) {
        if (!doc || !doc.data || !TC_BEARING_TYPES.includes(doc.type)) return [];
        const secs = doc.data.secciones || [];
        const matriz = secs.find(s => s.tipo === 'matriz-tc');
        const matrizTcs = matriz && Array.isArray(matriz.tcs) ? matriz.tcs : [];
        // Use filter+flatMap to collect TCs from ALL tabla-test-case sections (multi-module docs)
        const detalleTcs = secs
            .filter(s => s.tipo === 'tabla-test-case' && Array.isArray(s.tcs))
            .flatMap(s => s.tcs);
        // Devolver el set más completo (matriz suele tener todos; detalle puede ser representativo)
        if (matrizTcs.length >= detalleTcs.length) return matrizTcs;
        return detalleTcs;
    }

    /**
     * Devuelve los hallazgos de los TCs ejecutados (en tabla-test-case).
     * Cada hallazgo se "infla" con la info del TC al que pertenece.
     */
    function extractHallazgos(doc) {
        if (!doc || !doc.data) return [];
        const secs = doc.data.secciones || [];
        const allTcs = secs
            .filter(s => s.tipo === 'tabla-test-case' && Array.isArray(s.tcs))
            .flatMap(s => s.tcs);
        if (allTcs.length === 0) return [];
        const out = [];
        allTcs.forEach(tc => {
            (tc.hallazgos || []).forEach(h => {
                out.push({
                    docCode: doc.code,
                    docType: doc.type,
                    tcId: tc.tcId || '',
                    tcTitulo: tc.titulo || '',
                    tcGrupo: tc.grupo || '',
                    id: h.id || '',
                    severidad: h.severidad || h.criticidad || '',
                    criticidad: h.criticidad || h.severidad || '',
                    descripcion: h.descripcion || '',
                    accion: h.accion || h.accionCorrectiva || '',
                    estado: h.estado || '',
                    criterioRef: h.criterioRef || ''
                });
            });
        });
        return out;
    }

    /**
     * Normaliza un estado de TC a una categoría comparable.
     */
    function normalizarEstado(estado) {
        const e = String(estado || '').toUpperCase().trim();
        if (!e) return 'pendiente';
        if (e === 'PASS' || e === 'PASA') return 'pass';
        if (e === 'FAIL' || e === 'NO PASA') return 'fail';
        if (/^OBS|OBSERVACI|PASA CON OBS/.test(e)) return 'obs';
        if (e === 'NA' || e === 'N/A' || /NO APLICA/.test(e)) return 'na';
        return 'pendiente';
    }

    function isNegativo(tc) {
        const t = String(tc && tc.tipoTC || '').toUpperCase();
        return t === 'NEGATIVO' || t === 'NEG';
    }

    /**
     * Construye la matriz de cobertura URS↔TC↔RA.
     * Cruza ursVinculados/raVinculado de cada TC con el universo de URS/RA del paquete.
     *
     * Devuelve: { 'URS-001': { id, tcsPass: [...], tcsFail: [...], ..., raLinked: [...] } }
     */
    function buildUrsCoverage(packageDocs) {
        const ursMap = {};
        const raMap = {};

        // 1) Sembrar mapa con URS/RA del paquete (vía derivedRefs si están).
        (packageDocs || []).forEach(doc => {
            const refs = doc.derivedRefs;
            if (!refs) return;
            (refs.URS || []).forEach(id => {
                if (!ursMap[id]) ursMap[id] = { id, tcs: [], raLinked: new Set() };
            });
            (refs.RA || []).forEach(id => {
                if (!raMap[id]) raMap[id] = { id, tcs: [], ursLinked: new Set() };
            });
        });

        // 2) Por cada TC, agregar referencias cruzadas.
        (packageDocs || []).forEach(doc => {
            const tcs = extractTCs(doc);
            tcs.forEach(tc => {
                const ursList = Array.isArray(tc.ursVinculados) ? tc.ursVinculados : [];
                const raId = tc.raVinculado || '';
                ursList.forEach(ursId => {
                    if (!ursMap[ursId]) ursMap[ursId] = { id: ursId, tcs: [], raLinked: new Set() };
                    ursMap[ursId].tcs.push({
                        tcId: tc.tcId || '',
                        titulo: tc.titulo || '',
                        estado: tc.estado || '',
                        tipoTC: tc.tipoTC || '',
                        nivel: tc.nivel || '',
                        doc: doc.code,
                        docType: doc.type
                    });
                    if (raId) ursMap[ursId].raLinked.add(raId);
                });
                if (raId) {
                    if (!raMap[raId]) raMap[raId] = { id: raId, tcs: [], ursLinked: new Set() };
                    raMap[raId].tcs.push({
                        tcId: tc.tcId || '',
                        titulo: tc.titulo || '',
                        estado: tc.estado || '',
                        tipoTC: tc.tipoTC || '',
                        nivel: tc.nivel || '',
                        doc: doc.code,
                        docType: doc.type
                    });
                    ursList.forEach(u => raMap[raId].ursLinked.add(u));
                }
            });
        });

        return { ursMap, raMap };
    }

    /**
     * Calcula KPIs consolidados a partir del paquete + runtime.
     */
    function buildKpis(ctx) {
        const allTcsFromReports = [];
        const allTcsFromProtocols = [];
        (ctx.packageDocs || []).forEach(doc => {
            const tcs = extractTCs(doc);
            if (REPORT_TYPES.includes(doc.type)) tcs.forEach(t => allTcsFromReports.push({ ...t, docCode: doc.code, docType: doc.type }));
            else if (PROTOCOL_TYPES.includes(doc.type)) tcs.forEach(t => allTcsFromProtocols.push({ ...t, docCode: doc.code, docType: doc.type }));
        });

        // KPIs de ejecución → usar solo informes (que tienen estado real).
        const buckets = { pass: 0, fail: 0, obs: 0, na: 0, pendiente: 0 };
        let neg = 0, negFail = 0;
        allTcsFromReports.forEach(tc => {
            buckets[normalizarEstado(tc.estado)]++;
            if (isNegativo(tc)) {
                neg++;
                if (normalizarEstado(tc.estado) === 'fail') negFail++;
            }
        });

        const total = allTcsFromReports.length;
        const cumplenObjetivo = buckets.pass + buckets.obs;
        const cobertura = total > 0 ? Math.round((cumplenObjetivo / total) * 1000) / 10 : 0;
        const allPass = total > 0 && buckets.fail === 0 && buckets.pendiente === 0;
        const conObs = allPass && buckets.obs > 0;

        return {
            totalTcsProtocolos: allTcsFromProtocols.length,
            totalTcsEjecutados: total,
            ...buckets,
            negativos: neg,
            negativosFail: negFail,
            cobertura: cobertura,         // % TCs que cumplieron objetivo (PASS+OBS)
            estadoGlobal: total === 0 ? 'SIN EJECUCION'
                : allPass ? (conObs ? 'APROBADO CON OBS' : 'APROBADO')
                : (buckets.fail > 0 ? 'CON FAILS' : 'EN EJECUCION'),
            _allTcsFromReports: allTcsFromReports,
            _allTcsFromProtocols: allTcsFromProtocols
        };
    }

    // ====================================================================
    // BUILDERS POR HOJA (array-of-arrays para XLSX.aoa_to_sheet)
    // ====================================================================

    function buildResumenEjecutivo(ctx, kpis) {
        const aoa = [];
        const sys = ctx.systemInfo || {};
        aoa.push(['RESUMEN EJECUTIVO — PAQUETE DE VALIDACION']);
        aoa.push([]);
        aoa.push(['Empresa', sys.empresa || '']);
        aoa.push(['Sistema', sys.nombreSistema || '']);
        aoa.push(['Codigo Sistema', sys.codigoSistema || '']);
        aoa.push(['Ejecutor', ctx.executor || '']);
        aoa.push(['Fecha exportacion', new Date().toLocaleDateString('es-AR')]);
        aoa.push([]);
        aoa.push(['DOCUMENTOS DEL PAQUETE']);
        aoa.push(['Total documentos cargados', (ctx.packageDocs || []).length]);
        aoa.push(['Protocolos cargados', (ctx.packageDocs || []).filter(d => PROTOCOL_TYPES.includes(d.type)).map(d => d.code).join(', ') || '—']);
        aoa.push(['Informes cargados', (ctx.packageDocs || []).filter(d => REPORT_TYPES.includes(d.type)).map(d => d.code).join(', ') || '—']);
        aoa.push([]);
        aoa.push(['INDICADORES DE EJECUCION']);
        aoa.push(['Total TCs en protocolos', kpis.totalTcsProtocolos]);
        aoa.push(['Total TCs ejecutados (informes)', kpis.totalTcsEjecutados]);
        aoa.push(['PASS', kpis.pass]);
        aoa.push(['FAIL', kpis.fail]);
        aoa.push(['OBS', kpis.obs]);
        aoa.push(['N/A', kpis.na]);
        aoa.push(['Pendiente', kpis.pendiente]);
        aoa.push(['Cobertura (% PASS+OBS / total)', kpis.cobertura + '%']);
        aoa.push(['TCs negativos ejecutados', kpis.negativos]);
        aoa.push(['TCs negativos con FAIL', kpis.negativosFail]);
        aoa.push([]);
        aoa.push(['ESTADO GLOBAL', kpis.estadoGlobal]);
        return aoa;
    }

    function buildTrazabilidadUrs(ctx) {
        const { ursMap, raMap } = buildUrsCoverage(ctx.packageDocs || []);
        const aoa = [];
        aoa.push(['MATRIZ DE COBERTURA URS — TC — RA']);
        aoa.push([]);
        aoa.push(['URS', 'TCs que lo verifican', 'Estado consolidado', 'RA(s) vinculados', '# TCs PASS', '# TCs FAIL', '# TCs OBS', '# TCs total']);

        const ursIds = Object.keys(ursMap).sort();
        ursIds.forEach(ursId => {
            const entry = ursMap[ursId];
            const stats = { pass: 0, fail: 0, obs: 0, na: 0, pendiente: 0 };
            entry.tcs.forEach(t => stats[normalizarEstado(t.estado)]++);
            let estadoCons = '—';
            if (entry.tcs.length === 0) estadoCons = 'SIN TC';
            else if (stats.fail > 0) estadoCons = 'CON FAIL';
            else if (stats.pendiente > 0) estadoCons = 'PENDIENTE';
            else if (stats.pass + stats.obs === entry.tcs.length) estadoCons = stats.obs > 0 ? 'PASS (con OBS)' : 'PASS';
            else estadoCons = 'PARCIAL';

            aoa.push([
                ursId,
                entry.tcs.map(t => t.tcId).filter(Boolean).join(', ') || '—',
                estadoCons,
                Array.from(entry.raLinked).join(', ') || '—',
                stats.pass, stats.fail, stats.obs, entry.tcs.length
            ]);
        });

        if (Object.keys(raMap).length > 0) {
            aoa.push([]);
            aoa.push(['MATRIZ DE COBERTURA RA — TC']);
            aoa.push([]);
            aoa.push(['RA', 'TCs que lo verifican', 'Estado consolidado', 'URS vinculados', '# TCs PASS', '# TCs FAIL', '# TCs OBS', '# TCs total']);
            Object.keys(raMap).sort().forEach(raId => {
                const entry = raMap[raId];
                const stats = { pass: 0, fail: 0, obs: 0, na: 0, pendiente: 0 };
                entry.tcs.forEach(t => stats[normalizarEstado(t.estado)]++);
                let estadoCons = '—';
                if (entry.tcs.length === 0) estadoCons = 'SIN TC';
                else if (stats.fail > 0) estadoCons = 'CON FAIL';
                else if (stats.pendiente > 0) estadoCons = 'PENDIENTE';
                else if (stats.pass + stats.obs === entry.tcs.length) estadoCons = stats.obs > 0 ? 'MITIGADO (con OBS)' : 'MITIGADO';
                else estadoCons = 'PARCIAL';

                aoa.push([
                    raId,
                    entry.tcs.map(t => t.tcId).filter(Boolean).join(', ') || '—',
                    estadoCons,
                    Array.from(entry.ursLinked).join(', ') || '—',
                    stats.pass, stats.fail, stats.obs, entry.tcs.length
                ]);
            });
        }

        return aoa;
    }

    function buildTestCases(ctx, kpis) {
        const aoa = [];
        aoa.push(['TEST CASES — UNIVERSO COMPLETO']);
        aoa.push([]);
        aoa.push(['Documento', 'Tipo Doc', 'TC ID', 'Titulo', 'Grupo', 'Tipo TC', 'RA Score', 'Nivel', 'URS vinculados', 'RA vinculado', 'Estado', 'Ejecutor', 'Fecha Ejecucion', '# Evidencias', '# Hallazgos']);

        // Preferir informes (tienen estado); si solo hay protocolo, usar protocolo.
        // Combinar: si un TC aparece en POQ y IOQ, ganar IOQ (informe ejecutado).
        const tcsByKey = {};
        (ctx.packageDocs || []).forEach(doc => {
            if (!TC_BEARING_TYPES.includes(doc.type)) return;
            const tcs = extractTCs(doc);
            tcs.forEach(tc => {
                const key = (tc.tcId || '') + '|' + (tc.titulo || '');
                const isReport = REPORT_TYPES.includes(doc.type);
                // Solo sobreescribir si el actual es protocolo y entra un informe.
                if (!tcsByKey[key] || (isReport && !REPORT_TYPES.includes(tcsByKey[key]._docType))) {
                    tcsByKey[key] = { ...tc, _docCode: doc.code, _docType: doc.type };
                }
            });
        });

        Object.values(tcsByKey).forEach(tc => {
            const evCount = Array.isArray(tc.evidenciasGestor)
                ? tc.evidenciasGestor.length
                : (typeof tc.evidenciasCount === 'number' ? tc.evidenciasCount : 0);
            const hallCount = Array.isArray(tc.hallazgos) ? tc.hallazgos.length : 0;
            aoa.push([
                tc._docCode, tc._docType,
                tc.tcId || '', tc.titulo || '', tc.grupo || '', tc.tipoTC || '',
                tc.raScore != null ? tc.raScore : '', tc.nivel || '',
                Array.isArray(tc.ursVinculados) ? tc.ursVinculados.join(', ') : (tc.ursVinculados || ''),
                tc.raVinculado || '',
                tc.estado || '—',
                tc.ejecutor || '',
                tc.fechaEjecucion || '',
                evCount, hallCount
            ]);
        });

        return aoa;
    }

    function buildPruebasGestor(ctx) {
        const aoa = [];
        aoa.push(['PRUEBAS DEL GESTOR (RUNTIME DE EJECUCION)']);
        aoa.push([]);
        aoa.push(['Protocolo', 'Carpeta', 'Prueba', 'TC vinculado', 'Total Evidencias', 'PASA', 'NO PASA', 'PASA CON OBS', 'NO APLICA', 'Estado', 'Resultado', 'Fecha Finalizacion']);

        (ctx.tests || []).forEach(test => {
            const group = (ctx.groups || []).find(g => g.id === test.groupId);
            const protocol = group ? (ctx.protocols || []).find(p => p.id === group.protocolId) : null;
            const ev = test.evidences || [];
            const passCount = ev.filter(e => e.resultado === 'PASA').length;
            const failCount = ev.filter(e => e.resultado === 'NO PASA').length;
            const obsCount = ev.filter(e => e.resultado === 'PASA CON OBSERVACIONES').length;
            const naCount = ev.filter(e => e.resultado === 'NO APLICA').length;
            aoa.push([
                protocol ? protocol.name : 'Sin Protocolo',
                group ? group.name : 'Sin Carpeta',
                test.name,
                test.tcId || '',
                ev.length,
                passCount, failCount, obsCount, naCount,
                test.finalized ? 'FINALIZADO' : 'En Proceso',
                test.resultado || '',
                test.finalizedDate ? new Date(test.finalizedDate).toLocaleDateString('es-AR') : ''
            ]);
        });

        return aoa;
    }

    function buildEvidencias(ctx) {
        const aoa = [];
        aoa.push(['DETALLE DE EVIDENCIAS']);
        aoa.push([]);
        aoa.push([
            'Protocolo', 'Carpeta', 'Prueba', 'TC vinculado',
            'Paso #', 'Criterio Ref', 'Descripcion', 'Dictamen', 'Observacion',
            'Resultado', 'Fecha Captura', 'Fecha Guardado', 'Ejecutor',
            'Tamano', 'Dimensiones', 'Archivo Original', 'Ruta Relativa',
            'Fecha EXIF', 'Camara'
        ]);

        (ctx.tests || []).forEach(test => {
            const group = (ctx.groups || []).find(g => g.id === test.groupId);
            const protocol = group ? (ctx.protocols || []).find(p => p.id === group.protocolId) : null;
            (test.evidences || []).forEach(ev => {
                if (ev.isEmpty) return;
                aoa.push([
                    protocol ? protocol.name : 'Sin Protocolo',
                    group ? group.name : 'Sin Carpeta',
                    test.name,
                    test.tcId || '',
                    ev.step != null ? ev.step : '',
                    ev.criterioRef || '',
                    ev.description || '',
                    ev.dictamen || '',
                    ev.observacion || '',
                    ev.resultado || 'PASA',
                    ev.captureTimestamp ? (typeof formatDateTime24h === 'function' ? formatDateTime24h(ev.captureTimestamp) : new Date(ev.captureTimestamp).toISOString()) : '',
                    ev.timestamp ? (typeof formatDateTime24h === 'function' ? formatDateTime24h(ev.timestamp) : new Date(ev.timestamp).toISOString()) : '',
                    ev.executor || '',
                    ev.size || '',
                    ev.dimensions || '',
                    (ev.exif && ev.exif.originalFileName) || '',
                    (ev.exif && ev.exif.relativePath) || '',
                    (ev.exif && ev.exif.captureDate) ? (typeof formatDateTime24h === 'function' ? formatDateTime24h(ev.exif.captureDate) : new Date(ev.exif.captureDate).toISOString()) : '',
                    (ev.exif && ev.exif.cameraModel) ? `${ev.exif.cameraMake || ''} ${ev.exif.cameraModel}`.trim() : ''
                ]);
            });
        });
        return aoa;
    }

    function buildHallazgos(ctx) {
        const aoa = [];
        const all = [];
        (ctx.packageDocs || []).forEach(doc => {
            extractHallazgos(doc).forEach(h => all.push(h));
        });

        aoa.push(['HALLAZGOS / NO CONFORMIDADES']);
        aoa.push([]);
        if (all.length === 0) {
            aoa.push(['Sin hallazgos registrados en informes ejecutados.']);
            return aoa;
        }
        aoa.push(['Documento', 'TC ID', 'TC Titulo', 'Grupo', 'NC ID', 'Severidad', 'Criticidad', 'Estado', 'Descripcion', 'Accion Correctiva (CAPA)']);
        all.forEach(h => {
            aoa.push([
                h.docCode, h.tcId, h.tcTitulo, h.tcGrupo,
                h.id, h.severidad, h.criticidad, h.estado,
                h.descripcion, h.accion
            ]);
        });
        aoa.push([]);
        aoa.push(['Total', all.length]);
        aoa.push(['Cerradas', all.filter(h => /CERR/.test(String(h.estado || '').toUpperCase())).length]);
        aoa.push(['Abiertas', all.filter(h => /ABIERT|PEND/.test(String(h.estado || '').toUpperCase())).length]);
        return aoa;
    }

    function buildManifest(ctx) {
        const aoa = [];
        aoa.push(['MANIFEST DEL PAQUETE DOCUMENTAL']);
        aoa.push([]);
        aoa.push(['Codigo', 'Tipo', 'Version', 'Titulo', 'Archivo', 'Cargado en', 'Items URS', 'Items RA', 'Items IRA']);
        (ctx.packageDocs || []).forEach(d => {
            const refs = d.derivedRefs || {};
            aoa.push([
                d.code, d.type, d.version, d.title, d.fileName,
                d.loadedAt,
                (refs.URS || []).length,
                (refs.RA || []).length,
                (refs.IRA || []).length
            ]);
        });
        return aoa;
    }

    function buildConclusiones(ctx) {
        const aoa = [];
        aoa.push(['CONCLUSIONES DE EJECUCIÓN']);
        aoa.push([]);
        aoa.push([
            'Nivel', 'Protocolo', 'Carpeta', 'Prueba', 'TC Vinculado',
            'Estado', 'Resultado', 'Conclusión', 'Fecha Finalización'
        ]);

        // Nivel Proyecto
        const pd = ctx.projectData || {};
        aoa.push([
            'Proyecto', '—', '—', '—', '—',
            pd.finalized ? 'FINALIZADO' : 'En proceso',
            pd.resultado || '—',
            pd.conclusion || '—',
            '—'
        ]);

        // Nivel Protocolo — incluir si está finalizado o tiene conclusión
        (ctx.protocols || []).forEach(function(protocol) {
            if (!protocol.finalized && !protocol.conclusion) return;
            aoa.push([
                'Protocolo', protocol.name || '—', '—', '—', '—',
                protocol.finalized ? 'FINALIZADO' : 'En proceso',
                '—',
                protocol.conclusion || '—',
                '—'
            ]);
        });

        // Nivel Carpeta
        (ctx.groups || []).forEach(function(group) {
            if (!group.finalized && !group.conclusion) return;
            var protocol = (ctx.protocols || []).find(function(p) { return p.id === group.protocolId; });
            aoa.push([
                'Carpeta',
                protocol ? protocol.name : '—',
                group.name || '—',
                '—', '—',
                group.finalized ? 'FINALIZADO' : 'En proceso',
                '—',
                group.conclusion || '—',
                '—'
            ]);
        });

        // Nivel Prueba
        (ctx.tests || []).forEach(function(test) {
            if (!test.finalized && !test.conclusion) return;
            var group = (ctx.groups || []).find(function(g) { return g.id === test.groupId; });
            var protocol = group ? (ctx.protocols || []).find(function(p) { return p.id === group.protocolId; }) : null;
            aoa.push([
                'Prueba',
                protocol ? protocol.name : '—',
                group ? group.name : '—',
                test.name || '—',
                test.tcId || '—',
                test.finalized ? 'FINALIZADO' : 'En proceso',
                test.resultado || '—',
                test.conclusion || '—',
                test.finalizedDate ? new Date(test.finalizedDate).toLocaleDateString('es-AR') : '—'
            ]);
        });

        return aoa;
    }

    // ====================================================================
    // ENTRY POINT
    // ====================================================================
    function build(ctx) {
        ctx = ctx || {};
        ctx.packageDocs = ctx.packageDocs || [];
        ctx.tests = ctx.tests || [];
        ctx.groups = ctx.groups || [];
        ctx.protocols = ctx.protocols || [];
        ctx.projectData = ctx.projectData || {};

        const kpis = buildKpis(ctx);
        const hallazgos = [];
        ctx.packageDocs.forEach(doc => extractHallazgos(doc).forEach(h => hallazgos.push(h)));

        // Cobertura URS para uso programático (no solo Excel)
        const { ursMap, raMap } = buildUrsCoverage(ctx.packageDocs);

        return {
            kpis: {
                totalTcsProtocolos: kpis.totalTcsProtocolos,
                totalTcsEjecutados: kpis.totalTcsEjecutados,
                pass: kpis.pass,
                fail: kpis.fail,
                obs: kpis.obs,
                na: kpis.na,
                pendiente: kpis.pendiente,
                negativos: kpis.negativos,
                negativosFail: kpis.negativosFail,
                cobertura: kpis.cobertura,
                estadoGlobal: kpis.estadoGlobal,
                hallazgosTotal: hallazgos.length,
                hallazgosCerrados: hallazgos.filter(h => /CERR/.test(String(h.estado || '').toUpperCase())).length,
                hallazgosAbiertos: hallazgos.filter(h => /ABIERT|PEND/.test(String(h.estado || '').toUpperCase())).length
            },
            hallazgos: hallazgos,
            ursCoverage: ursMap,
            raCoverage: raMap,
            sheets: {
                'Resumen Ejecutivo': buildResumenEjecutivo(ctx, kpis),
                'Trazabilidad URS-TC-RA': buildTrazabilidadUrs(ctx),
                'Test Cases': buildTestCases(ctx, kpis),
                'Pruebas Gestor': buildPruebasGestor(ctx),
                'Conclusiones': buildConclusiones(ctx),
                'Evidencias': buildEvidencias(ctx),
                'Hallazgos': buildHallazgos(ctx),
                'Manifest Paquete': buildManifest(ctx)
            }
        };
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    VS.matrixBuilder = {
        build: build,
        extractTCs: extractTCs,
        extractHallazgos: extractHallazgos,
        buildUrsCoverage: buildUrsCoverage,
        normalizarEstado: normalizarEstado
    };

})(window);
