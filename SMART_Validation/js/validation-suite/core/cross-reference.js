/* ====================================================================
   VALIDATION SUITE — CROSS-REFERENCE MODULE

   Auto-genera el bloque `trazabilidad.recibeDe[]` enriquecido (schema v2.0)
   escaneando el contenido del documento (los TCs, principalmente). El
   usuario declara UNA VEZ contra qué docs externos depende (en
   `referenceConfig` opcional) y la herramienta deriva qué items
   específicos están referenciados.

   Esto convierte la trazabilidad de "conceptual" (recibe de URS) a
   "operacional" (recibe de URS-DRP-SIS-001 v1.0 items URS-001, URS-044,
   URS-049 — congelado 01/03/2026).

   Beneficios:
   - Auditor abre el doc y ve la cadena completa con versiones.
   - Detección automática de huérfanas: URS-XXX declarado pero ningún TC
     lo usa, o TC usa URS-XXX no declarado.
   - Si una URS sube de v1.0 a v1.1, podemos flagear automáticamente que
     los docs downstream (PIQ, POQ, IIQ, ...) quedaron referencialmente
     desactualizados.
   - La MTR se puede regenerar leyendo este bloque en cada doc del paquete
     sin que el usuario duplique trabajo.

   Filosofía: la disciplina la garantiza el código, no el humano. El
   usuario nunca tipea manualmente la lista de items derivables. Solo
   declara las relaciones de alto nivel (code + version + fecha).

   Reglas:
   - Solo se autogenera lo derivable. Las relaciones manuales o
     contextuales (ej. "alimentaA: IIQ") quedan declarativas.
   - El bloque enriquecido marca `_auto: true` para entradas derivadas.
     Entradas manuales sin `_auto` se preservan tal cual.
   - Backward compat: docs con `trazabilidad.recibeDe` en formato v1.0
     (array de strings) siguen renderizando como antes hasta que se
     migren manualmente o mediante augmentDocument().
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.crossRef = VS.crossRef || {};

    // ====================================================================
    // EXTRACTORS — cómo buscar referencias en un TC
    //
    // Cada extractor recibe un TC y devuelve un array de IDs encontrados.
    // Registry extensible: para soportar otros tipos de referencia
    // (HLRA, FRS, DS, MTR), agregar entradas acá.
    // ====================================================================
    const TC_EXTRACTORS = {
        URS: function (tc) {
            if (Array.isArray(tc.ursVinculados)) return tc.ursVinculados;
            if (tc.ursVinculados) return [tc.ursVinculados];
            return [];
        },
        RA: function (tc) {
            const v = tc.raVinculado || '';
            return v ? [v] : [];
        },
        IRA: function (tc) {
            const v = tc.componente || '';
            return v ? [v] : [];
        }
    };

    // Marcadores de "placeholder" o "no aplica" — se filtran al derivar
    function isRealId(id) {
        if (id == null) return false;
        const s = String(id).trim();
        return s !== '' && s !== '—' && s !== '-' && s !== 'TBD' && s !== 'N/A';
    }

    /**
     * Escanea el documento y devuelve referencias agrupadas por tipo.
     * Recorre `secciones[].tcs[]` aplicando los extractors registrados.
     *
     * @param {object} data — JSON del documento (PIQ, POQ, IIQ, IOQ, ...)
     * @returns {object} { URS: ['URS-001', ...], RA: [...], IRA: [...] }
     */
    function deriveFromDoc(data) {
        const refs = {};
        Object.keys(TC_EXTRACTORS).forEach(tipo => { refs[tipo] = new Set(); });

        const secciones = (data && data.secciones) || [];
        secciones.forEach(sec => {
            const tcs = sec.tcs || [];
            tcs.forEach(tc => {
                if (!tc) return;
                Object.keys(TC_EXTRACTORS).forEach(tipo => {
                    const ids = TC_EXTRACTORS[tipo](tc);
                    ids.forEach(id => {
                        if (isRealId(id)) refs[tipo].add(String(id).trim());
                    });
                });
            });
        });

        // Convertir Sets a arrays ordenados
        const result = {};
        Object.keys(refs).forEach(tipo => {
            result[tipo] = Array.from(refs[tipo]).sort();
        });
        return result;
    }

    /**
     * Inferir `referenceConfig` desde el `package.code` si no se declara
     * explícitamente. Patrón: code='DRP-SIS-001' → URS-DRP-SIS-001,
     * RA-DRP-SIS-001, IRA-DRP-SIS-001.
     *
     * No incluye version ni fechaCongelado — el usuario debería declararlas
     * explícitamente en `referenceConfig` para auditoría rigurosa.
     */
    function inferConfig(data) {
        const code = data && data.package && data.package.code;
        if (!code) return {};
        return {
            URS: { code: 'URS-' + code },
            RA:  { code: 'RA-' + code },
            IRA: { code: 'IRA-' + code }
        };
    }

    /**
     * Aplica al documento un bloque `trazabilidad` v2.0 enriquecido con
     * referencias derivadas automáticamente. No-destructivo:
     * - Si el doc trae `trazabilidad.recibeDe` en v2.0 con entradas manuales
     *   (sin `_auto: true`), las preserva.
     * - Si está en v1.0 (strings simples), las descarta y regenera todo
     *   (los strings históricos eran ['URS', 'RA', ...] sin info útil).
     * - `alimentaA` se preserva tal cual (es manual/declarativo).
     *
     * @param {object} data — JSON del documento (se MUTA en-place)
     * @param {object} opts — { referenceConfig?: {URS, RA, IRA} }
     * @returns {object} data (mismo objeto, mutado)
     */
    function augmentDocument(data, opts) {
        opts = opts || {};
        const explicit = (data && data.referenceConfig) || opts.referenceConfig || {};
        const inferred = inferConfig(data);

        // Merge: explícito gana sobre inferido
        const config = {};
        Object.keys(inferred).forEach(tipo => {
            config[tipo] = Object.assign({}, inferred[tipo], explicit[tipo] || {});
        });
        Object.keys(explicit).forEach(tipo => {
            if (!config[tipo]) config[tipo] = explicit[tipo];
        });

        const derived = deriveFromDoc(data);

        // Preservar bloques manuales
        const oldTraz = data.trazabilidad || {};
        const existingRecibe = Array.isArray(oldTraz.recibeDe) ? oldTraz.recibeDe : [];
        const existingAlimenta = Array.isArray(oldTraz.alimentaA) ? oldTraz.alimentaA : [];

        // Detectar formato: v1 (strings) vs v2 (objects)
        const isV1Format = existingRecibe.length > 0 && typeof existingRecibe[0] === 'string';

        // Construir el nuevo recibeDe[]
        const newRecibe = [];

        // 1. Entradas _auto por cada tipo con items derivados
        Object.keys(derived).forEach(tipo => {
            const items = derived[tipo];
            if (items.length === 0) return;
            const cfg = config[tipo] || {};
            newRecibe.push({
                tipo: tipo,
                code: cfg.code || '',
                version: cfg.version || '',
                fechaCongelado: cfg.fechaCongelado || '',
                items: items,
                itemsCount: items.length,
                estado: cfg.estado || 'aprobado',
                _auto: true
            });
        });

        // 2. Preservar entradas manuales (no-auto) pre-existentes en v2
        if (!isV1Format) {
            existingRecibe.forEach(r => {
                if (r && r._auto !== true) newRecibe.push(r);
            });
        }

        data.trazabilidad = {
            schemaVersion: '2.0',
            recibeDe: newRecibe,
            alimentaA: existingAlimenta
        };

        return data;
    }

    /**
     * Validar referencias del documento. Detecta:
     * - Items usados en TCs pero NO declarados en `trazabilidad.recibeDe`
     * - Items declarados en `recibeDe` pero NO usados en ningún TC (huérfanos)
     * - Entradas marcadas `_auto: true` con items inconsistentes con la
     *   derivación actual (señal de que falta correr augmentDocument tras
     *   cambios en TCs)
     *
     * NOTA: la validación cross-doc real (verificar que URS-044 EXISTE en
     * el URS-DRP-SIS-001 v1.0 cargado) requiere `packageContext` — un
     * conjunto de docs del paquete completo. Sin él, validamos
     * consistencia interna únicamente.
     */
    function validateReferences(data, packageContext) {
        const report = { errors: [], warnings: [], info: [] };
        const derived = deriveFromDoc(data);
        const traz = data.trazabilidad || {};
        const recibe = Array.isArray(traz.recibeDe) ? traz.recibeDe : [];

        // Formato v1 — no podemos validar, solo informar migración
        if (recibe.length > 0 && typeof recibe[0] === 'string') {
            report.info.push({ msg: 'Trazabilidad en formato v1.0 (strings simples). Correr VS.crossRef.augmentDocument(data) para migrar a v2.0 con validación cross-doc.' });
            return report;
        }

        // Por cada tipo derivado, comparar declarado vs usado
        Object.keys(derived).forEach(tipo => {
            const declaredEntry = recibe.find(r => r && r.tipo === tipo);
            const derivedItems = new Set(derived[tipo]);
            const declaredItems = new Set((declaredEntry && declaredEntry.items) || []);

            // (a) Items usados pero no declarados → warning
            derivedItems.forEach(item => {
                if (!declaredItems.has(item)) {
                    report.warnings.push({
                        msg: `${tipo} "${item}" usado en TC pero no declarado en trazabilidad.recibeDe`,
                        ctx: 'consistencia interna'
                    });
                }
            });

            // (b) Items declarados pero no usados → warning (huérfano)
            declaredItems.forEach(item => {
                if (!derivedItems.has(item)) {
                    report.warnings.push({
                        msg: `${tipo} "${item}" declarado en recibeDe pero no usado en ningún TC (huérfano)`,
                        ctx: 'consistencia interna'
                    });
                }
            });

            // (c) Entrada _auto desactualizada
            if (declaredEntry && declaredEntry._auto && declaredItems.size !== derivedItems.size) {
                report.warnings.push({
                    msg: `${tipo}: entrada _auto desactualizada. Re-correr augmentDocument para sincronizar.`,
                    ctx: 'auto-sync'
                });
            }
        });

        // Validación cross-doc (si hay packageContext)
        if (packageContext) {
            Object.keys(derived).forEach(tipo => {
                const declaredEntry = recibe.find(r => r && r.tipo === tipo);
                if (!declaredEntry) return;
                const otroDoc = (packageContext.docs || []).find(d => d.document?.code === declaredEntry.code);
                if (!otroDoc) {
                    report.errors.push({
                        msg: `Referencia a "${declaredEntry.code}" pero el doc no está en el paquete cargado`,
                        ctx: 'cross-package'
                    });
                    return;
                }
                if (declaredEntry.version && otroDoc.document?.version && declaredEntry.version !== otroDoc.document.version) {
                    report.errors.push({
                        msg: `Version mismatch: este doc apunta a ${declaredEntry.code} ${declaredEntry.version} pero el paquete trae ${otroDoc.document.version}. Posible referencialmente obsoleto.`,
                        ctx: 'cross-package'
                    });
                }
            });
        }

        // Info: resumen
        Object.keys(derived).forEach(tipo => {
            if (derived[tipo].length > 0) {
                report.info.push({ msg: `${tipo}: ${derived[tipo].length} items referenciados` });
            }
        });

        return report;
    }

    // ====================================================================
    // API PÚBLICA
    // ====================================================================
    VS.crossRef.deriveFromDoc = deriveFromDoc;
    VS.crossRef.augmentDocument = augmentDocument;
    VS.crossRef.inferConfig = inferConfig;
    VS.crossRef.validateReferences = validateReferences;
    VS.crossRef.TC_EXTRACTORS = TC_EXTRACTORS;
    VS.crossRef.isRealId = isRealId;

})(window);
