/* ====================================================================
   VALIDATION SUITE — TRACEABILITY ENGINE

   Pure-function lookup engine that walks the loaded `packageDocs[]` to
   build traceability chains across documents of a validation package.

   API:
   - VS.tracer.traceFromTcId(tcId, packageDocs)
   - VS.tracer.traceFromUrsId(ursId, packageDocs)
   - VS.tracer.traceFromRaId(raId, packageDocs)
   - VS.tracer.traceFromIraId(iraId, packageDocs)
   - VS.tracer.findTcInAnyProtocol(tcId, packageDocs)
   - VS.tracer.findUrsItemInDoc(ursId, ursDoc)
   - VS.tracer.findIraComponentInDoc(compId, iraDoc)

   Filosofía:
   - No requiere todos los docs del paquete cargados. Devuelve lo que
     pueda encontrar — los items vacíos quedan como references sueltas.
   - Cada función devuelve un objeto con shape predecible (con flags
     `found`, `enriched`) para que la UI pueda mostrar progresivamente.
   - El motor NO modifica los docs — solo lee.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.tracer = VS.tracer || {};

    // ====================================================================
    // FINDERS PRIMITIVOS — buscar items específicos en docs
    // ====================================================================

    /**
     * Busca un TC por su tcId en un doc (PIQ/POQ/IIQ/IOQ). Recorre todas
     * las secciones tabla-test-case y matriz-tc, prefiriendo la versión
     * más rica (más campos poblados).
     */
    function findTcInDoc(tcId, doc) {
        if (!doc || !tcId) return null;
        const secciones = (doc.data && doc.data.secciones) || [];
        let best = null;
        let bestScore = -1;
        secciones.forEach(sec => {
            if (sec.tipo !== 'tabla-test-case' && sec.tipo !== 'matriz-tc') return;
            (sec.tcs || []).forEach(tc => {
                if (!tc || tc.tcId !== tcId) return;
                // Score heuristic: tcs en tabla-test-case (con procedimiento/criterios) ganan
                let score = 0;
                if (Array.isArray(tc.procedimiento) && tc.procedimiento.length > 0) score += 5;
                if (Array.isArray(tc.criterios) && tc.criterios.length > 0) score += 5;
                if (tc.objetivo) score += 1;
                if (tc.criterioObservado) score += 2;  // ejecutado
                if (tc.estado) score += 2;
                if (score > bestScore) { best = tc; bestScore = score; }
            });
        });
        return best;
    }

    /**
     * Busca un TC en cualquier protocolo del paquete. Devuelve
     * {found, tc, sourceDoc} o {found:false}.
     */
    function findTcInAnyProtocol(tcId, packageDocs) {
        if (!Array.isArray(packageDocs)) return { found: false };
        // Priorizar IIQ/IOQ (que tienen execution state) antes que PIQ/POQ
        const order = ['IIQ', 'IOQ', 'IPQ', 'PIQ', 'POQ', 'PPQ'];
        const sorted = packageDocs.slice().sort((a, b) => {
            const ai = order.indexOf(a.type); const bi = order.indexOf(b.type);
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        });
        for (const doc of sorted) {
            if (order.indexOf(doc.type) < 0) continue;
            const tc = findTcInDoc(tcId, doc);
            if (tc) {
                return {
                    found: true,
                    tc: tc,
                    sourceDoc: {
                        type: doc.type,
                        code: doc.code,
                        version: doc.version,
                        title: doc.title
                    }
                };
            }
        }
        return { found: false };
    }

    /**
     * Busca el texto/metadata de un URS-NNN en un URS doc.
     * El URS fixture tiene filas tipo [{text:'URS-001'...}, {text:'ref'...}, 'desc', {text:'M'...}, {text:'CRÍTICO'...}]
     * Devuelve {id, descripcion, prioridad, ref} o null.
     */
    function findUrsItemInDoc(ursId, ursDoc) {
        if (!ursDoc || !ursId) return null;
        const secciones = (ursDoc.data && ursDoc.data.secciones) || [];
        for (const sec of secciones) {
            if (sec.tipo !== 'tabla' || !Array.isArray(sec.filas)) continue;
            for (const fila of sec.filas) {
                if (!Array.isArray(fila)) continue;
                // Buscar el ursId en la primera celda
                const first = fila[0];
                const idStr = typeof first === 'string' ? first : (first && first.text) || '';
                if (idStr === ursId) {
                    return {
                        id: ursId,
                        descripcion: typeof fila[2] === 'string' ? fila[2] : (fila[2] && fila[2].text) || '',
                        refSop: typeof fila[1] === 'string' ? fila[1] : (fila[1] && fila[1].text) || '',
                        modo: typeof fila[3] === 'string' ? fila[3] : (fila[3] && fila[3].text) || '',
                        prioridad: typeof fila[4] === 'string' ? fila[4] : (fila[4] && fila[4].text) || '',
                        sourceDoc: { code: ursDoc.code, version: ursDoc.version }
                    };
                }
            }
        }
        return null;
    }

    /**
     * Busca un componente IRA por compId. El IRA fixture tiene
     * tabla-alcance-piq.filas[] con keys compId/componente/ira/verificacion/criterio/tcIq.
     */
    function findIraComponentInDoc(compId, iraDoc) {
        if (!iraDoc || !compId) return null;
        const secciones = (iraDoc.data && iraDoc.data.secciones) || [];
        for (const sec of secciones) {
            const filas = sec.filas || [];
            for (const fila of filas) {
                if (fila && fila.compId === compId) {
                    return {
                        id: compId,
                        componente: fila.componente || '',
                        iraScore: fila.ira,
                        verificacion: fila.verificacion || '',
                        criterio: fila.criterio || '',
                        tcIq: fila.tcIq || '',
                        sourceDoc: { code: iraDoc.code, version: iraDoc.version }
                    };
                }
            }
        }
        return null;
    }

    /**
     * Busca un RA-NNN en un RA doc. La estructura es heterogénea
     * (tabla-fmea con subheaders), así que escaneamos todas las filas
     * con shape de objeto buscando match en cualquier campo "id".
     */
    function findRaItemInDoc(raId, raDoc) {
        if (!raDoc || !raId) return null;
        const secciones = (raDoc.data && raDoc.data.secciones) || [];
        for (const sec of secciones) {
            const filas = sec.filas || [];
            for (const fila of filas) {
                if (!fila || typeof fila !== 'object' || fila.subheader) continue;
                // Buscar id en raId, id, ra, codigo
                const id = fila.raId || fila.id || fila.ra || fila.codigo;
                if (id === raId) {
                    return {
                        id: raId,
                        ...fila,
                        sourceDoc: { code: raDoc.code, version: raDoc.version }
                    };
                }
            }
        }
        return null;
    }

    /**
     * Busca TODOS los TCs (en TODOS los protocolos del paquete) que
     * referencian un URS-NNN dado. Devuelve array de {tcId, doc, status}.
     */
    function findAllTcsReferencingUrs(ursId, packageDocs) {
        if (!Array.isArray(packageDocs)) return [];
        const protocolTypes = ['PIQ', 'IIQ', 'POQ', 'IOQ', 'PPQ', 'IPQ'];
        const matches = [];
        packageDocs.forEach(doc => {
            if (protocolTypes.indexOf(doc.type) < 0) return;
            const secciones = (doc.data && doc.data.secciones) || [];
            const seen = new Set();
            secciones.forEach(sec => {
                if (sec.tipo !== 'tabla-test-case' && sec.tipo !== 'matriz-tc') return;
                (sec.tcs || []).forEach(tc => {
                    if (!tc || !tc.tcId || seen.has(tc.tcId)) return;
                    const urs = Array.isArray(tc.ursVinculados) ? tc.ursVinculados : (tc.ursVinculados ? [tc.ursVinculados] : []);
                    if (urs.includes(ursId)) {
                        seen.add(tc.tcId);
                        matches.push({
                            tcId: tc.tcId,
                            titulo: tc.titulo || '',
                            tipoTC: tc.tipoTC || '',
                            grupo: tc.grupo || '',
                            estado: tc.estado || null,
                            ejecutor: tc.ejecutor || '',
                            fechaEjecucion: tc.fechaEjecucion || '',
                            sourceDoc: { type: doc.type, code: doc.code, version: doc.version }
                        });
                    }
                });
            });
        });
        return matches;
    }

    /** Mismo patrón para RA. */
    function findAllTcsReferencingRa(raId, packageDocs) {
        if (!Array.isArray(packageDocs)) return [];
        const protocolTypes = ['PIQ', 'IIQ', 'POQ', 'IOQ', 'PPQ', 'IPQ'];
        const matches = [];
        packageDocs.forEach(doc => {
            if (protocolTypes.indexOf(doc.type) < 0) return;
            const secciones = (doc.data && doc.data.secciones) || [];
            const seen = new Set();
            secciones.forEach(sec => {
                if (sec.tipo !== 'tabla-test-case' && sec.tipo !== 'matriz-tc') return;
                (sec.tcs || []).forEach(tc => {
                    if (!tc || !tc.tcId || seen.has(tc.tcId)) return;
                    if (tc.raVinculado === raId) {
                        seen.add(tc.tcId);
                        matches.push({
                            tcId: tc.tcId,
                            titulo: tc.titulo || '',
                            tipoTC: tc.tipoTC || '',
                            grupo: tc.grupo || '',
                            estado: tc.estado || null,
                            sourceDoc: { type: doc.type, code: doc.code, version: doc.version }
                        });
                    }
                });
            });
        });
        return matches;
    }

    /** Mismo patrón para IRA componente. */
    function findAllTcsReferencingIra(compId, packageDocs) {
        if (!Array.isArray(packageDocs)) return [];
        const protocolTypes = ['PIQ', 'IIQ', 'POQ', 'IOQ', 'PPQ', 'IPQ'];
        const matches = [];
        packageDocs.forEach(doc => {
            if (protocolTypes.indexOf(doc.type) < 0) return;
            const secciones = (doc.data && doc.data.secciones) || [];
            const seen = new Set();
            secciones.forEach(sec => {
                if (sec.tipo !== 'tabla-test-case' && sec.tipo !== 'matriz-tc') return;
                (sec.tcs || []).forEach(tc => {
                    if (!tc || !tc.tcId || seen.has(tc.tcId)) return;
                    if (tc.componente === compId) {
                        seen.add(tc.tcId);
                        matches.push({
                            tcId: tc.tcId,
                            titulo: tc.titulo || '',
                            grupo: tc.grupo || '',
                            estado: tc.estado || null,
                            sourceDoc: { type: doc.type, code: doc.code, version: doc.version }
                        });
                    }
                });
            });
        });
        return matches;
    }

    // ====================================================================
    // TRACE FUNCTIONS — alto nivel
    // ====================================================================

    /**
     * Dado un tcId, devuelve la cadena de trazabilidad completa.
     * - El TC mismo (PIQ/POQ/IIQ/IOQ que lo contiene)
     * - Items URS, RA, IRA referenciados (enriquecidos si los docs upstream están cargados)
     * - Estado de ejecución (si hay IIQ/IOQ con este TC)
     * - TCs relacionados (otros protocolos que comparten URS con este)
     */
    function traceFromTcId(tcId, packageDocs) {
        const result = {
            tcId: tcId,
            found: false,
            sourceDoc: null,
            tc: null,
            upstream: { urs: [], ra: [], ira: [] },
            execution: null,
            related: []
        };

        const r = findTcInAnyProtocol(tcId, packageDocs);
        if (!r.found) return result;

        result.found = true;
        result.sourceDoc = r.sourceDoc;
        result.tc = r.tc;

        // Encontrar docs upstream cargados (URS, RA, IRA)
        const ursDocs = packageDocs.filter(d => d.type === 'URS');
        const raDocs = packageDocs.filter(d => d.type === 'RA');
        const iraDocs = packageDocs.filter(d => d.type === 'IRA');

        // URS upstream
        const ursIds = Array.isArray(r.tc.ursVinculados) ? r.tc.ursVinculados : (r.tc.ursVinculados ? [r.tc.ursVinculados] : []);
        ursIds.forEach(uId => {
            if (!uId || uId === '—') return;
            let enriched = null;
            for (const ursDoc of ursDocs) {
                enriched = findUrsItemInDoc(uId, ursDoc);
                if (enriched) break;
            }
            result.upstream.urs.push(enriched || { id: uId, enriched: false });
        });

        // RA upstream
        const raId = r.tc.raVinculado;
        if (raId && raId !== '—') {
            let enriched = null;
            for (const raDoc of raDocs) {
                enriched = findRaItemInDoc(raId, raDoc);
                if (enriched) break;
            }
            result.upstream.ra.push(enriched || { id: raId, enriched: false });
        }

        // IRA upstream (componente)
        const compId = r.tc.componente;
        if (compId && compId !== '—') {
            let enriched = null;
            for (const iraDoc of iraDocs) {
                enriched = findIraComponentInDoc(compId, iraDoc);
                if (enriched) break;
            }
            result.upstream.ira.push(enriched || { id: compId, enriched: false });
        }

        // Execution state (si el sourceDoc es un informe, ya está; si no, buscar en informes)
        const informTypes = ['IIQ', 'IOQ', 'IPQ'];
        if (informTypes.includes(r.sourceDoc.type) && r.tc.estado) {
            result.execution = {
                estado: r.tc.estado,
                ejecutor: r.tc.ejecutor || '',
                fechaEjecucion: r.tc.fechaEjecucion || '',
                criterioObservado: r.tc.criterioObservado || r.tc.resultadoObservado || '',
                evidenciasGestor: r.tc.evidenciasGestor || [],
                hallazgos: r.tc.hallazgos || [],
                sourceDoc: r.sourceDoc
            };
        } else {
            // Buscar este TC en algún informe del paquete
            for (const doc of packageDocs) {
                if (!informTypes.includes(doc.type)) continue;
                const tcInInf = findTcInDoc(tcId, doc);
                if (tcInInf && tcInInf.estado) {
                    result.execution = {
                        estado: tcInInf.estado,
                        ejecutor: tcInInf.ejecutor || '',
                        fechaEjecucion: tcInInf.fechaEjecucion || '',
                        criterioObservado: tcInInf.criterioObservado || tcInInf.resultadoObservado || '',
                        evidenciasGestor: tcInInf.evidenciasGestor || [],
                        hallazgos: tcInInf.hallazgos || [],
                        sourceDoc: { type: doc.type, code: doc.code, version: doc.version }
                    };
                    break;
                }
            }
        }

        // Related: TCs en otros protocolos que comparten URS con este
        const relatedMap = new Map();
        ursIds.forEach(uId => {
            findAllTcsReferencingUrs(uId, packageDocs).forEach(m => {
                if (m.tcId === tcId) return;
                if (!relatedMap.has(m.tcId)) {
                    relatedMap.set(m.tcId, { ...m, sharedUrs: [uId] });
                } else {
                    relatedMap.get(m.tcId).sharedUrs.push(uId);
                }
            });
        });
        result.related = Array.from(relatedMap.values());

        return result;
    }

    /**
     * Dado un URS-NNN, devuelve:
     * - URS info (texto, prioridad) si URS doc cargado
     * - Todos los TCs que lo referencian (en todos los protocolos del paquete)
     */
    function traceFromUrsId(ursId, packageDocs) {
        const result = {
            ursId: ursId,
            found: false,
            urs: null,
            tcs: [],
            statsByProtocol: {}
        };

        // Buscar URS en URS doc
        const ursDocs = packageDocs.filter(d => d.type === 'URS');
        for (const ursDoc of ursDocs) {
            const item = findUrsItemInDoc(ursId, ursDoc);
            if (item) { result.urs = item; result.found = true; break; }
        }

        // TCs que lo referencian
        result.tcs = findAllTcsReferencingUrs(ursId, packageDocs);
        if (result.tcs.length > 0) result.found = true;

        // Stats por protocolo
        result.tcs.forEach(t => {
            const type = t.sourceDoc.type;
            if (!result.statsByProtocol[type]) result.statsByProtocol[type] = { total: 0, pass: 0, fail: 0, obs: 0, na: 0, pendiente: 0 };
            result.statsByProtocol[type].total++;
            const e = String(t.estado || '').toUpperCase();
            if (e === 'PASS' || e === 'PASA') result.statsByProtocol[type].pass++;
            else if (e === 'FAIL' || e === 'NO PASA') result.statsByProtocol[type].fail++;
            else if (e === 'OBS') result.statsByProtocol[type].obs++;
            else if (e === 'NA' || e === 'N/A') result.statsByProtocol[type].na++;
            else result.statsByProtocol[type].pendiente++;
        });

        return result;
    }

    function traceFromRaId(raId, packageDocs) {
        const result = { raId: raId, found: false, ra: null, tcs: [] };
        const raDocs = packageDocs.filter(d => d.type === 'RA');
        for (const raDoc of raDocs) {
            const item = findRaItemInDoc(raId, raDoc);
            if (item) { result.ra = item; result.found = true; break; }
        }
        result.tcs = findAllTcsReferencingRa(raId, packageDocs);
        if (result.tcs.length > 0) result.found = true;
        return result;
    }

    function traceFromIraId(compId, packageDocs) {
        const result = { compId: compId, found: false, component: null, tcs: [] };
        const iraDocs = packageDocs.filter(d => d.type === 'IRA');
        for (const iraDoc of iraDocs) {
            const item = findIraComponentInDoc(compId, iraDoc);
            if (item) { result.component = item; result.found = true; break; }
        }
        result.tcs = findAllTcsReferencingIra(compId, packageDocs);
        if (result.tcs.length > 0) result.found = true;
        return result;
    }

    // ====================================================================
    // EXPORT
    // ====================================================================
    VS.tracer.traceFromTcId = traceFromTcId;
    VS.tracer.traceFromUrsId = traceFromUrsId;
    VS.tracer.traceFromRaId = traceFromRaId;
    VS.tracer.traceFromIraId = traceFromIraId;
    VS.tracer.findTcInDoc = findTcInDoc;
    VS.tracer.findTcInAnyProtocol = findTcInAnyProtocol;
    VS.tracer.findUrsItemInDoc = findUrsItemInDoc;
    VS.tracer.findIraComponentInDoc = findIraComponentInDoc;
    VS.tracer.findRaItemInDoc = findRaItemInDoc;
    VS.tracer.findAllTcsReferencingUrs = findAllTcsReferencingUrs;
    VS.tracer.findAllTcsReferencingRa = findAllTcsReferencingRa;
    VS.tracer.findAllTcsReferencingIra = findAllTcsReferencingIra;

})(window);
