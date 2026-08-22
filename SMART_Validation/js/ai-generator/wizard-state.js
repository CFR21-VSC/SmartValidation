'use strict';

/* ====================================================================
   AI GENERATOR — WIZARD STATE MACHINE
   Gestiona el estado del wizard de generación GxP. Sin dependencias
   externas: opera solo sobre plain objects y localStorage.
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.AIGenerator = VS.AIGenerator || {};

    const CASCADE_ORDER = [
        // Fase 1 — Planificación y requisitos
        'hlra', 'vp', 'urs', 'frs', 'ds',
        // Fase 2 — Riesgo
        'ra', 'ira', 'rrm',
        // Fase 3 — Calificación IQ
        'piq', 'iiq', 'riq',
        // Fase 4 — Calificación OQ
        'poq', 'ioq', 'roq',
        // Fase 5 — Calificación PQ
        'ppq', 'ipq', 'rpq',
        // Fase 6 — Trazabilidad (después de todos los protocolos — usa TC-IDs reales)
        'mtr',
        // Fase 7 — Cierre
        'ncr', 'vsr'
    ];

    // Tipos que admiten múltiples instancias de módulo (PIQ-MOD01, POQ-MOD02, etc.)
    const MULTI_INSTANCE_TYPES = new Set(['piq', 'poq', 'ppq', 'iiq', 'ioq', 'ipq', 'riq', 'roq', 'rpq']);

    const STORAGE_PREFIX = 'ai-wizard-state-';
    const SCHEMA_VERSION = 4;

    function _key(projectId) { return STORAGE_PREFIX + projectId; }

    // Expande el cascade base con las instancias de módulo del estado
    function _activeCascade(state) {
        const instances = state.moduleInstances || [];
        const result = [];
        CASCADE_ORDER.forEach(type => {
            result.push(type);
            instances
                .filter(inst => inst.baseType === type)
                .forEach(inst => result.push(inst.id));
        });
        return result;
    }

    /**
     * Recalcula requirementsSummary del URS contando los IDs reales en el JSON.
     * Evita depender del conteo del modelo (que puede diferir del contenido real).
     */
    function _patchURSSummary(ursJson) {
        if (!ursJson || !Array.isArray(ursJson.secciones)) return ursJson;

        const functionalIds   = [];
        const nonFunctionalIds = [];

        // Escanear todas las tablas buscando filas con URS-XXX o URS-NF-XXX en primera celda
        const URS_RE    = /^URS-(\d{3,})$/;
        const URS_NF_RE = /^URS-NF-(\d{3,})$/;

        function scanFila(fila) {
            if (!Array.isArray(fila)) return;
            const cell = fila[0];
            const text = (typeof cell === 'string') ? cell
                       : (cell && typeof cell === 'object' && cell.text) ? cell.text
                       : '';
            const t = text.trim();
            if (URS_NF_RE.test(t)) nonFunctionalIds.push(t);
            else if (URS_RE.test(t))    functionalIds.push(t);
        }

        ursJson.secciones.forEach(sec => {
            if (!sec.filas) return;
            sec.filas.forEach(fila => {
                if (Array.isArray(fila)) scanFila(fila);
                // subheader rows son objects { subheader: "..." }, ignorarlos
            });
        });

        // Solo parchear si encontramos algo (evitar sobreescribir con ceros si el schema cambió)
        if (functionalIds.length === 0 && nonFunctionalIds.length === 0) return ursJson;

        const mandatory = _countFieldInFilas(ursJson.secciones, 3, 'M');
        const desirable  = _countFieldInFilas(ursJson.secciones, 3, 'D');
        const critical   = _countFieldInFilas(ursJson.secciones, 4, 'CRÍTICO');
        const high       = _countFieldInFilas(ursJson.secciones, 4, 'ALTO');
        const medium     = _countFieldInFilas(ursJson.secciones, 4, 'MEDIO');

        const summary = {
            total:            functionalIds.length + nonFunctionalIds.length,
            functional:       functionalIds.length,
            nonFunctional:    nonFunctionalIds.length,
            mandatory,
            desirable,
            critical,
            high,
            medium,
            functionalIds,
            nonFunctionalIds
        };

        return { ...ursJson, requirementsSummary: summary };
    }

    /**
     * Para IIQ/IOQ/IPQ aprobados: calcula executionSummary escaneando secciones con TCs.
     * Cubre tanto los generados por _mergeInformeFromProtocolo (ya tienen el campo)
     * como los editados manualmente que podrían no tenerlo.
     */
    function _patchIIQSummary(informeJson, baseType) {
        if (!informeJson || !Array.isArray(informeJson.secciones)) return informeJson;
        // Si ya tiene executionSummary calculado, lo conservamos (fue generado por la derive)
        if (informeJson.executionSummary && informeJson.executionSummary.totalTCs > 0) return informeJson;

        const allTCs = [];
        informeJson.secciones.forEach(sec => {
            if (Array.isArray(sec.tcs)) {
                sec.tcs.forEach(tc => { if (tc.resultado) allTCs.push(tc); });
            }
        });
        if (!allTCs.length) return informeJson;

        const MAP_LABELS = { iiq: 'IIQ', ioq: 'IOQ', ipq: 'IPQ' };
        const label = MAP_LABELS[baseType] || baseType.toUpperCase();
        const pasa  = allTCs.filter(tc => tc.resultado === 'PASA').length;
        const obs   = allTCs.filter(tc => tc.resultado === 'PASA CON OBSERVACIONES').length;
        const fail  = allTCs.filter(tc => tc.resultado === 'NO PASA').length;
        const total = allTCs.length;

        const executionSummary = {
            totalTCs:             total,
            pasa,
            pasaConObservaciones: obs,
            noPasa:               fail,
            porcentajeConformidad: Math.round((pasa + obs) / total * 100),
            verdict: fail === 0
                ? `CALIFICACIÓN ${label} APROBADA`
                : `CALIFICACIÓN ${label} CON NCs ABIERTAS`,
            protocoloOrigen: informeJson.protocoloOrigen || informeJson.codigo || ''
        };

        return { ...informeJson, executionSummary };
    }

    /** Cuenta filas de tabla donde la celda en `colIdx` contiene `value` (texto exacto o campo .text). */
    function _countFieldInFilas(secciones, colIdx, value) {
        let count = 0;
        secciones.forEach(sec => {
            if (!sec.filas) return;
            sec.filas.forEach(fila => {
                if (!Array.isArray(fila) || fila.length <= colIdx) return;
                const cell = fila[colIdx];
                const text = (typeof cell === 'string') ? cell
                           : (cell && typeof cell === 'object' && cell.text) ? cell.text
                           : '';
                if (text.trim() === value) count++;
            });
        });
        return count;
    }

    /**
     * Aplica skips por categoría GAMP al aprobar el HLRA.
     * GAMP 3 → deshabilita frs, ds, ppq, ipq, rpq por defecto.
     * GAMP 4 → deshabilita ds por defecto.
     * GAMP 5 → no deshabilita nada.
     * RRM va siempre. El usuario puede habilitar manualmente con "↩".
     */
    function _applyGAMPScope(instances, skipped, hlraJson) {
        const raw   = (hlraJson && hlraJson.gampCategory) || '';
        const match = raw.match(/GAMP\s+(\d)/i);
        const cat   = match ? parseInt(match[1], 10) : null;
        if (!cat) return skipped;

        const SKIP_BY_GAMP = {
            3: ['frs', 'ds', 'ppq', 'ipq', 'rpq'],
            4: ['ds'],
        };
        const toSkip = SKIP_BY_GAMP[cat];
        if (!toSkip || !toSkip.length) return skipped;

        const result = { ...skipped };
        toSkip.forEach(baseT => {
            result[baseT] = true;
            instances.filter(inst => inst.baseType === baseT)
                .forEach(inst => { result[inst.id] = true; });
        });
        return result;
    }

    /**
     * Aplica el alcance de calificación definido en el VP.
     * Si validationScope.pq === false → skip ppq/ipq/rpq (y sus instancias).
     * Si validationScope.oq === false → skip poq/ioq/roq.
     * Si validationScope.iq === false → skip piq/iiq/riq.
     */
    function _applyVPScope(cascade, instances, skipped, vpJson) {
        const scope = vpJson && vpJson.validationScope;
        if (!scope || typeof scope !== 'object') return skipped;

        const result = { ...skipped };
        const SCOPE_MAP = [
            { key: 'iq', types: ['piq', 'iiq', 'riq'] },
            { key: 'oq', types: ['poq', 'ioq', 'roq'] },
            { key: 'pq', types: ['ppq', 'ipq', 'rpq'] },
        ];

        SCOPE_MAP.forEach(({ key, types }) => {
            if (scope[key] === false) {
                types.forEach(baseT => {
                    result[baseT] = true;
                    instances.filter(inst => inst.baseType === baseT)
                        .forEach(inst => { result[inst.id] = true; });
                });
            }
        });

        return result;
    }

    function _nextPending(approved, skipped, cascade, fromIdx) {
        for (let i = fromIdx; i < cascade.length; i++) {
            const t = cascade[i];
            if (!approved[t] && !skipped[t]) return t;
        }
        return null;
    }

    function _default(projectId) {
        return {
            version: SCHEMA_VERSION,
            projectId,
            sourceDocText: null,
            sourceDocName: null,
            currentDocType: CASCADE_ORDER[0],
            approvedDocs: {},
            skippedDocs: {},
            moduleInstances: [],   // [{ id, baseType, label }]
            pendingDoc: null,
            status: 'idle',   // 'idle' | 'generating' | 'review' | 'done'
            lastError: null
        };
    }

    const WizardState = {
        CASCADE_ORDER,
        MULTI_INSTANCE_TYPES,

        getActiveCascade(state) {
            return _activeCascade(state);
        },

        // ── Persistencia ──────────────────────────────────────────────

        load(projectId) {
            if (!projectId) throw new Error('projectId requerido');
            try {
                const raw = localStorage.getItem(_key(projectId));
                if (!raw) return _default(projectId);
                const parsed = JSON.parse(raw);
                // Migración v2 → v4
                if (parsed.version === 2) {
                    return { ...parsed, version: SCHEMA_VERSION, skippedDocs: {}, moduleInstances: [] };
                }
                // Migración v3 → v4: agregar moduleInstances
                if (parsed.version === 3) {
                    return { ...parsed, version: SCHEMA_VERSION, moduleInstances: [] };
                }
                if (parsed.version !== SCHEMA_VERSION) return _default(projectId);
                return parsed;
            } catch (_) {
                return _default(projectId);
            }
        },

        save(state) {
            if (!state || !state.projectId) throw new Error('state.projectId requerido');
            localStorage.setItem(_key(state.projectId), JSON.stringify(state));
        },

        reset(projectId) {
            localStorage.removeItem(_key(projectId));
            return _default(projectId);
        },

        // ── Transiciones (inmutables — devuelven nuevo estado) ────────

        setSourceDoc(state, text, name) {
            if (!text || !text.trim()) throw new Error('El texto del documento no puede estar vacío');
            return { ...state, sourceDocText: text.trim(), sourceDocName: name || 'documento', lastError: null };
        },

        startGenerating(state) {
            if (!this.canGenerate(state)) throw new Error('No se puede generar en el estado actual');
            return { ...state, status: 'generating', pendingDoc: null, lastError: null };
        },

        markGenerated(state, docType, json) {
            if (state.currentDocType !== docType) {
                throw new Error(`Tipo incorrecto: esperado ${state.currentDocType}, recibido ${docType}`);
            }
            return { ...state, pendingDoc: { docType, json, generatedAt: Date.now() }, status: 'review', lastError: null };
        },

        markApproved(state, docType, json) {
            if (!state.pendingDoc || state.pendingDoc.docType !== docType) {
                throw new Error(`No hay doc pendiente de tipo ${docType}`);
            }
            const cascade = _activeCascade(state);

            // URS: recomputar requirementsSummary; IIQ/IOQ/IPQ: garantizar executionSummary
            const INFORMES_SET = new Set(['iiq', 'ioq', 'ipq']);
            const approvedJson = docType === 'urs'             ? _patchURSSummary(json)
                               : INFORMES_SET.has(docType)     ? _patchIIQSummary(json, docType)
                               : json;

            const approvedDocs = { ...state.approvedDocs, [docType]: approvedJson };
            const instances = state.moduleInstances || [];
            let skipped = state.skippedDocs || {};
            // VP aprobado: aplicar alcance de calificación (puede agregar más skips sobre los del GAMP)
            if (docType === 'vp') skipped = _applyVPScope(cascade, instances, skipped, approvedJson);
            const nextDoc      = _nextPending(approvedDocs, skipped, cascade, cascade.indexOf(docType) + 1);
            return {
                ...state,
                approvedDocs,
                skippedDocs: skipped,
                pendingDoc: null,
                currentDocType: nextDoc,
                status: nextDoc ? 'idle' : 'done',
                lastError: null
            };
        },

        markError(state, errorMsg) {
            return { ...state, status: 'idle', lastError: errorMsg };
        },

        /**
         * Marca un documento como "No aplica" y avanza al siguiente pendiente.
         */
        skipDoc(state, docType) {
            const cascade = _activeCascade(state);
            const idx = cascade.indexOf(docType);
            if (idx < 0) throw new Error(`Tipo desconocido: ${docType}`);
            if (state.approvedDocs[docType]) throw new Error(`${docType} ya está aprobado. Usá rewindTo primero.`);
            const skippedDocs = { ...(state.skippedDocs || {}), [docType]: true };
            const approved    = state.approvedDocs;
            const curIdx      = cascade.indexOf(state.currentDocType || cascade[0]);
            const wasCurrentOrBefore = idx <= curIdx;
            const nextDoc = wasCurrentOrBefore
                ? _nextPending(approved, skippedDocs, cascade, idx + 1)
                : state.currentDocType;
            const newCurrent = (state.currentDocType === docType || !state.currentDocType)
                ? nextDoc
                : state.currentDocType;
            return {
                ...state,
                skippedDocs,
                currentDocType: newCurrent,
                pendingDoc: state.currentDocType === docType ? null : state.pendingDoc,
                status: newCurrent ? 'idle' : 'done',
                lastError: null
            };
        },

        /** Quita el skip de un documento — vuelve a ser requerido. */
        unskipDoc(state, docType) {
            const cascade     = _activeCascade(state);
            const skippedDocs = { ...(state.skippedDocs || {}) };
            delete skippedDocs[docType];
            const docIdx = cascade.indexOf(docType);
            const curIdx = cascade.indexOf(state.currentDocType);
            const becomesCurrent = docIdx < curIdx && !state.approvedDocs[docType];
            return {
                ...state,
                skippedDocs,
                currentDocType: becomesCurrent ? docType : state.currentDocType,
                status: 'idle',
                lastError: null
            };
        },

        /**
         * Vuelve el ciclo a un punto anterior: borra ese doc y los posteriores
         * de approvedDocs y skippedDocs, y resetea currentDocType.
         */
        rewindTo(state, docType) {
            const cascade = _activeCascade(state);
            const idx = cascade.indexOf(docType);
            if (idx < 0) throw new Error(`Tipo desconocido: ${docType}`);
            const approvedDocs = { ...state.approvedDocs };
            const skippedDocs  = { ...(state.skippedDocs || {}) };
            for (let i = idx; i < cascade.length; i++) {
                delete approvedDocs[cascade[i]];
                delete skippedDocs[cascade[i]];
            }
            return { ...state, approvedDocs, skippedDocs, currentDocType: docType, pendingDoc: null, status: 'idle', lastError: null };
        },

        // ── Módulos de calificación ────────────────────────────────────

        /**
         * Agrega una instancia de módulo al cascade.
         * Genera el ID automáticamente: baseType-mod01, baseType-mod02, etc.
         */
        addModuleInstance(state, baseType, label) {
            if (!MULTI_INSTANCE_TYPES.has(baseType)) {
                throw new Error(`${baseType.toUpperCase()} no soporta módulos`);
            }
            const instances = state.moduleInstances || [];
            const count = instances.filter(i => i.baseType === baseType).length;
            const id = `${baseType}-mod${String(count + 1).padStart(2, '0')}`;
            if (state.approvedDocs[id] || (state.skippedDocs || {})[id]) {
                throw new Error(`El módulo ${id} ya existe en el ciclo`);
            }
            const newInstances = [...instances, { id, baseType, label: label || id.toUpperCase() }];
            return { ...state, moduleInstances: newInstances };
        },

        /** Elimina una instancia de módulo del cascade (y borra su aprobación/skip si existe). */
        removeModuleInstance(state, instanceId) {
            const instances    = (state.moduleInstances || []).filter(i => i.id !== instanceId);
            const approvedDocs = { ...state.approvedDocs };
            const skippedDocs  = { ...(state.skippedDocs || {}) };
            delete approvedDocs[instanceId];
            delete skippedDocs[instanceId];

            const baseState = { ...state, moduleInstances: instances, approvedDocs, skippedDocs };
            const cascade   = _activeCascade(baseState);

            let currentDocType = state.currentDocType;
            let pendingDoc     = state.pendingDoc;
            let status         = state.status;

            if (currentDocType === instanceId || !cascade.includes(currentDocType)) {
                currentDocType = _nextPending(approvedDocs, skippedDocs, cascade, 0) || null;
                status = currentDocType ? 'idle' : 'done';
            }
            if (pendingDoc && pendingDoc.docType === instanceId) {
                pendingDoc = null;
                if (status !== 'done') status = 'idle';
            }

            return { ...baseState, currentDocType, pendingDoc, status };
        },

        // ── Queries ───────────────────────────────────────────────────

        canGenerate(state) {
            if (!state.sourceDocText) return false;
            if (!state.currentDocType) return false;
            if (state.status === 'generating') return false;
            if (state.status === 'done') return false;
            return true;
        },

        /**
         * Retorna un string con la razón de bloqueo si el doc actual NO puede generarse aún,
         * o null si está libre para generarse.
         * Usado para mostrar feedback al usuario antes de habilitar el botón Generar.
         */
        blockingReason(state) {
            const type = state.currentDocType;
            if (!type) return null;
            const approved = state.approvedDocs || {};

            const LABELS = {
                piq: 'PIQ', iiq: 'IIQ', riq: 'RIQ',
                poq: 'POQ', ioq: 'IOQ', roq: 'ROQ',
                ppq: 'PPQ', ipq: 'IPQ', rpq: 'RPQ',
            };

            // Extraer base type (sin sufijo de módulo, ej: "piq-modulo1" → "piq")
            const baseType = type.includes('-') ? type.split('-')[0] : type;
            const label = t => LABELS[t] || t.toUpperCase();

            // Reportes: necesitan informe previo con resultados cargados
            const REPORTE_NEEDS_INFORME = { riq: 'iiq', roq: 'ioq', rpq: 'ipq' };
            const informeKey = REPORTE_NEEDS_INFORME[baseType];
            if (informeKey) {
                const informeDoc = approved[informeKey]
                    || Object.entries(approved).find(([k]) => k.startsWith(informeKey + '-'))?.[1];
                if (!informeDoc) {
                    return `Falta aprobar el ${label(informeKey)} antes de generar el ${label(baseType)}.`;
                }
                if (!(informeDoc.executionSummary?.totalTCs > 0)) {
                    return `El ${label(informeKey)} no tiene resultados de ejecución cargados. Completá los resultados antes de continuar.`;
                }
            }

            // Protocolos de fase siguiente: necesitan el reporte de la fase anterior aprobado
            const PROTOCOLO_NEEDS_REPORTE = { poq: 'riq', ppq: 'roq' };
            const reporteKey = PROTOCOLO_NEEDS_REPORTE[baseType];
            if (reporteKey) {
                const reporteDoc = approved[reporteKey]
                    || Object.entries(approved).find(([k]) => k.startsWith(reporteKey + '-'))?.[1];
                if (!reporteDoc) {
                    return `El ${label(reporteKey)} debe estar aprobado antes de iniciar el ${label(baseType)}. La fase ${baseType === 'poq' ? 'IQ' : 'OQ'} debe estar cerrada y aprobada.`;
                }
            }

            return null;
        },

        isComplete(state) { return state.status === 'done'; },

        getProgress(state) {
            const cascade  = _activeCascade(state);
            const approved = Object.keys(state.approvedDocs).length;
            const skipped  = Object.keys(state.skippedDocs || {}).length;
            return { approved, skipped, total: cascade.length, current: state.currentDocType };
        },

        getApprovedContext(state) {
            return Object.entries(state.approvedDocs).map(([type, json]) => ({ type, json }));
        },

        /**
         * Aplica skips GAMP desde los metadatos del proyecto al abrir el wizard.
         * Recibe el string de categoría tal como viene de systemInfo.categoriaGamp
         * (ej: "GAMP 3", "GAMP 4 — Producto Configurable", etc.).
         * No restablece skips existentes — solo agrega los del mapa GAMP.
         */
        applyProjectGAMP(state, gampCatString) {
            const instances = state.moduleInstances || [];
            const skipped   = _applyGAMPScope(instances, state.skippedDocs || {}, { gampCategory: gampCatString });
            return { ...state, skippedDocs: skipped, gampScopeApplied: gampCatString };
        }
    };

    VS.AIGenerator.WizardState = WizardState;

    // ══════════════════════════════════════════════════════════════════
    // EXPORTAR CONTEXTO PARA CLAUDE DESKTOP
    // Extrae información compacta de cada doc aprobado para generar
    // el bloque de contexto que Claude Desktop necesita como input.
    // ══════════════════════════════════════════════════════════════════

    function _extractIDsByRegex(json, regex) {
        const ids = new Set();
        const tokens = (JSON.stringify(json).match(/[A-Z][A-Z0-9]*(?:-(?:NF|SW|INF|SEC|IQ|OQ|PQ|IF))?-\d{2,4}/g) || []);
        tokens.forEach(t => { if (regex.test(t)) ids.add(t); });
        return [...ids].sort();
    }

    function _extractTCIds(json, prefix) {
        const ids  = new Set();
        const re   = new RegExp('^' + prefix + '-\\d{3}$');
        (json.secciones || []).forEach(sec => {
            (sec.tcs || []).forEach(tc => { if (tc.tcId && re.test(tc.tcId)) ids.add(tc.tcId); });
        });
        _extractIDsByRegex(json, re).forEach(id => ids.add(id));
        return [...ids].sort();
    }

    function _extractDecision(json) {
        const s = JSON.stringify(json);
        if (/LIBERACI[OÓ]N\s+\w+\s+APROBADA|CALIFICACI[OÓ]N\s+\w+\s+APROBADA/.test(s)) return 'APROBADA';
        if (/RECHAZADA|NO\s+APROBADA/.test(s)) return 'RECHAZADA';
        if (/APROBADA/.test(s)) return 'APROBADA';
        return '(no determinada)';
    }

    function _idsPreview(ids) {
        if (!ids.length) return '(ninguno)';
        if (ids.length <= 8) return ids.join(', ');
        return `${ids[0]} … ${ids[ids.length - 1]}  (${ids.length} total)`;
    }

    function _compactSummary(baseType, json) {
        if (!json) return '';
        switch (baseType) {
            case 'hlra': {
                const gamp = json.gampCategory || (json.document && json.document.gampCategory) || '?';
                const gaps = _extractIDsByRegex(json, /^GAP-\d{3}$/);
                return `  GAMP: ${gamp}${gaps.length ? `  |  GAPs: ${gaps.join(', ')}` : ''}`;
            }
            case 'vp': {
                const scope = json.validationScope || {};
                return `  Alcance  IQ: ${scope.iq !== false ? 'Sí' : 'No'}  |  OQ: ${scope.oq !== false ? 'Sí' : 'No'}  |  PQ: ${scope.pq !== false ? 'Sí' : 'No'}`;
            }
            case 'urs': {
                const s = json.requirementsSummary || {};
                const parts = [`  Total: ${s.total || '?'}  (F: ${s.functional || 0}  NF: ${s.nonFunctional || 0})`];
                if (s.functionalIds && s.functionalIds.length)   parts.push(`  Funcionales: ${_idsPreview(s.functionalIds)}`);
                if (s.nonFunctionalIds && s.nonFunctionalIds.length) parts.push(`  No Funcionales: ${s.nonFunctionalIds.join(', ')}`);
                if (s.critical || s.high) parts.push(`  Criticidad  Crítico: ${s.critical || 0}  Alto: ${s.high || 0}  Medio: ${s.medium || 0}`);
                return parts.join('\n');
            }
            case 'frs': {
                const frsIds = _extractIDsByRegex(json, /^FRS-\d{3}$/);
                const ifIds  = _extractIDsByRegex(json, /^FRS-IF-\d{3}$/);
                const algIds = _extractIDsByRegex(json, /^ALG-\d{3}$/);
                const parts  = [`  FRS funcionales (${frsIds.length}): ${_idsPreview(frsIds)}`];
                if (ifIds.length)  parts.push(`  FRS interfaces  (${ifIds.length}): ${ifIds.join(', ')}`);
                if (algIds.length) parts.push(`  Algoritmos      (${algIds.length}): ${algIds.join(', ')}`);
                return parts.join('\n');
            }
            case 'ds': {
                const capas = [];
                (json.secciones || []).forEach(sec => {
                    if (sec.tipo === 'diagrama-arquitectura' && Array.isArray(sec.capas)) {
                        sec.capas.forEach(c => { if (c.nombre || c.name) capas.push(c.nombre || c.name); });
                    }
                });
                return capas.length ? `  Capas: ${capas.join(' → ')}` : '  (diseño técnico)';
            }
            case 'ra': {
                const ids = _extractIDsByRegex(json, /^RA-\d{3,4}$/);
                return `  ${ids.length} riesgos FMEA: ${_idsPreview(ids)}`;
            }
            case 'ira': {
                const ids = _extractIDsByRegex(json, /^COMP-(SW|INF|SEC)-\d{2,3}$/);
                return `  ${ids.length} componentes: ${_idsPreview(ids)}`;
            }
            case 'rrm': {
                const gaps = _extractIDsByRegex(json, /^GAP-\d{3}$/);
                return gaps.length ? `  ${gaps.length} GAPs regulatorios: ${gaps.join(', ')}` : '  Sin brechas regulatorias identificadas';
            }
            case 'piq': {
                const tcs = _extractTCIds(json, 'TC-IQ');
                return `  ${tcs.length} TC-IQ: ${_idsPreview(tcs)}`;
            }
            case 'iiq':
            case 'ioq':
            case 'ipq': {
                const s   = json.executionSummary || {};
                const lbl = baseType.toUpperCase();
                const pct = s.porcentajeConformidad != null ? ` (${s.porcentajeConformidad}%)` : '';
                return [
                    `  ${s.totalTCs || '?'} TCs ejecutados${pct}`,
                    `  PASA: ${s.pasa || 0}  |  CON OBS: ${s.pasaConObservaciones || 0}  |  NO PASA: ${s.noPasa || 0}`,
                    `  Veredicto: ${s.verdict || 'CALIFICACIÓN ' + lbl + ' ?'}`
                ].join('\n');
            }
            case 'riq':
            case 'roq':
            case 'rpq':
                return `  Decisión: ${_extractDecision(json)}`;
            case 'poq': {
                const tcs = _extractTCIds(json, 'TC-OQ');
                return `  ${tcs.length} TC-OQ: ${_idsPreview(tcs)}`;
            }
            case 'ppq': {
                const tcs = _extractTCIds(json, 'TC-PQ');
                return `  ${tcs.length} TC-PQ: ${_idsPreview(tcs)}`;
            }
            case 'mtr': {
                const ursCount = _extractIDsByRegex(json, /^URS-(\d{3,4}|NF-\d{3,4})$/).length;
                return `  ${ursCount} URS mapeados en la matriz de trazabilidad`;
            }
            case 'ncr': {
                const ncIds = _extractIDsByRegex(json, /^NC-\d{3}$/);
                return ncIds.length ? `  ${ncIds.length} NCs: ${ncIds.join(', ')}` : '  Sin no conformidades registradas';
            }
            case 'vsr':
                return '  (Reporte maestro del ciclo — ver JSON completo para decisión final)';
            default:
                return '';
        }
    }

    WizardState.buildClaudeDesktopContext = function (state) {
        const approved      = state.approvedDocs || {};
        const cascade       = _activeCascade(state);
        const approvedTypes = cascade.filter(t => approved[t]);
        const skippedTypes  = cascade.filter(t => (state.skippedDocs || {})[t] && !approved[t]);

        // Package block desde el primer doc aprobado
        const firstType = approvedTypes[0];
        const pkg  = firstType && approved[firstType] && approved[firstType].package;
        const hlra = approved['hlra'];
        const gamp = hlra
            ? (hlra.gampCategory || (hlra.document && hlra.document.gampCategory) || '?')
            : '?';

        const L = [];
        L.push('═══ CONTEXTO DEL PAQUETE — pegar al inicio de cada generación ═══');
        if (pkg) {
            L.push(`package.code             : ${pkg.code || '?'}`);
            L.push(`package.systemName       : ${pkg.systemName || '?'}`);
            L.push(`package.systemVersion    : ${pkg.systemVersion || '?'}`);
            L.push(`package.client           : ${pkg.client || '?'}`);
            L.push(`package.vendor           : ${pkg.vendor || '?'}`);
            L.push(`package.qmsLabel         : ${pkg.qmsLabel || '?'}`);
            L.push(`package.normativeFramework: ${pkg.normativeFramework || '?'}`);
        } else {
            L.push('(sin documentos aprobados — completar manualmente con datos del sistema)');
        }
        L.push(`Categoría GAMP           : ${gamp}`);
        L.push('Versión inicial de todos los docs: 1.0');
        L.push('═══════════════════════════════════════════════════════════════');

        if (approvedTypes.length) {
            L.push('');
            L.push('═══ DOCUMENTOS APROBADOS ═══');
            approvedTypes.forEach(docType => {
                const json     = approved[docType];
                const code     = (json.document && json.document.code) || `${docType.toUpperCase()}-${pkg ? pkg.code : '?'}`;
                const version  = (json.document && json.document.version) || '1.0';
                const baseType = docType.replace(/-mod\d+$/, '');
                L.push('');
                L.push(`[${docType.toUpperCase()}]  ${code}  v${version}  ✓`);
                const summary = _compactSummary(baseType, json);
                if (summary) L.push(summary);
            });
        }

        if (skippedTypes.length) {
            L.push('');
            L.push('═══ DOCUMENTOS NO APLICA (GAMP / Alcance VP) ═══');
            skippedTypes.forEach(t => L.push(`  ${t.toUpperCase()}  — omitido`));
        }

        L.push('');
        L.push('═══════════════════════════════════════════════════════════════');

        const current = state.currentDocType;
        if (current && state.status !== 'done') {
            L.push('');
            L.push(`Siguiente a generar: ${current.toUpperCase()}`);
            const baseT = current.replace(/-mod\d+$/, '');
            L.push(`Skill a invocar: "${baseT}-generator"`);
            if (approvedTypes.length) {
                L.push(`Contexto disponible: ${approvedTypes.map(t => t.toUpperCase()).join(', ')}`);
            }
        } else if (state.status === 'done') {
            L.push('');
            L.push('Estado: CICLO COMPLETO — todos los documentos generados y aprobados.');
        }

        return L.join('\n');
    };

})(typeof window !== 'undefined' ? window : global);
