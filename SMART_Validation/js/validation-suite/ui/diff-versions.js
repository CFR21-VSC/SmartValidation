/* ====================================================================
   VALIDATION SUITE — DIFF DE VERSIONES (Fase B)
   Detecta diferencias estructurales entre dos versiones del MISMO doc.

   Alcance Fase B (versión estructural):
     - Match de secciones por (tipo + título normalizado).
     - Para cada sección matched: diff de campos (scalars, arrays, objects).
     - Para arrays de items con ID (URS-001, RA-001, TC-IQ-001…) match por ID.
     - Para arrays sin ID: comparación posicional.
     - Genera reporte: secciones agregadas / removidas / modificadas + cambios
       de metadata top-level.

   No incluido (queda para v2 con IA):
     - Diff semántico de párrafos (detectar reformulaciones equivalentes).
     - Vectores/grafos para entender QUÉ tipo de cambio es (mejora, regresión).
     - Algoritmo de Myers para LCS en strings largos.

   API expuesta:
     VS.diffVersions.compareDocuments(docA, docB) → diff result
     VS.diffVersions.openDiffModal()              → abre el modal
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.diffVersions = VS.diffVersions || {};

    // ====================================================================
    // ALGORITMO DE COMPARACIÓN
    // ====================================================================

    /** Genera una clave estable para matching de secciones. */
    function sectionKey(sec) {
        const tipo = sec.tipo || '';
        const titulo = (sec.titulo || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (titulo) return tipo + '::' + titulo;
        if (sec.numero != null) return tipo + '::n' + sec.numero;
        return tipo + '::sin-id';
    }

    /** Inferir cuál es el campo ID de los items de un array (URS-001, RA-001, etc). */
    function guessIdField(item) {
        if (!item || typeof item !== 'object') return null;
        const candidates = ['id', 'tcId', 'ursId', 'raId', 'ncId', 'capaId'];
        for (const f of candidates) {
            if (item[f] != null && /^[A-Z][A-Z0-9\-_]*\d+/i.test(String(item[f]))) return f;
        }
        return null;
    }

    /** Para arrays-de-arrays (filas de tablas), extrae el ID si la cell[0] lo contiene.
     *  Soporta cell como string ("URS-005") o como objeto pdfMake ({text:"URS-005"}). */
    function extractRowId(row) {
        if (!Array.isArray(row) || row.length === 0) return null;
        const c0 = row[0];
        let raw = null;
        if (typeof c0 === 'string') raw = c0;
        else if (c0 && typeof c0 === 'object' && typeof c0.text === 'string') raw = c0.text;
        if (!raw) return null;
        const m = raw.trim().match(/^([A-Z][A-Z0-9\-_]*\d+)/i);
        return m ? m[1] : null;
    }

    /** Deep equality vía JSON.stringify (suficiente para Fase B). */
    function deepEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    /** Diff entre dos arrays. */
    function diffArray(a, b) {
        const result = { added: [], removed: [], modified: [], unchanged: 0 };
        if (!Array.isArray(a)) a = [];
        if (!Array.isArray(b)) b = [];

        // Buscar idField y rowId en cualquier elemento del array (los primeros
        // pueden ser subheaders u otros tipos sin ID).
        let idField = null;
        for (const it of a) { idField = guessIdField(it); if (idField) break; }
        if (!idField) for (const it of b) { idField = guessIdField(it); if (idField) break; }

        let hasRowIds = false;
        for (const it of a) { if (Array.isArray(it) && extractRowId(it)) { hasRowIds = true; break; } }
        if (!hasRowIds) for (const it of b) { if (Array.isArray(it) && extractRowId(it)) { hasRowIds = true; break; } }

        // Caso especial: arrays-de-arrays (filas de tabla) con ID extraíble de cell[0].
        // Permite matchear URS-005 entre v1 y v2 aunque las filas sean arrays raw.
        // Los subheaders y filas sin ID caen al matching posicional dentro de este caso.
        if (hasRowIds) {
            const aById = new Map();
            const bById = new Map();
            const aNoId = [];
            const bNoId = [];
            a.forEach((row, i) => {
                const id = extractRowId(row);
                if (id) aById.set(id, { item: row, idx: i });
                else aNoId.push({ item: row, idx: i });
            });
            b.forEach((row, i) => {
                const id = extractRowId(row);
                if (id) bById.set(id, { item: row, idx: i });
                else bNoId.push({ item: row, idx: i });
            });

            aById.forEach((entry, id) => {
                if (bById.has(id)) {
                    const bEntry = bById.get(id);
                    if (!deepEqual(entry.item, bEntry.item)) {
                        result.modified.push({ id, a: entry.item, b: bEntry.item });
                    } else {
                        result.unchanged++;
                    }
                } else {
                    result.removed.push({ id, item: entry.item });
                }
            });
            bById.forEach((entry, id) => {
                if (!aById.has(id)) result.added.push({ id, item: entry.item });
            });

            // Filas sin ID (subheaders, separadores) — posicional
            const minLen = Math.min(aNoId.length, bNoId.length);
            for (let i = 0; i < minLen; i++) {
                if (!deepEqual(aNoId[i].item, bNoId[i].item)) {
                    result.modified.push({ position: i, a: aNoId[i].item, b: bNoId[i].item, isPositional: true });
                } else {
                    result.unchanged++;
                }
            }
            for (let i = minLen; i < aNoId.length; i++) result.removed.push({ position: i, item: aNoId[i].item, isPositional: true });
            for (let i = minLen; i < bNoId.length; i++) result.added.push({ position: i, item: bNoId[i].item, isPositional: true });
            return result;
        }

        if (idField) {
            const aById = new Map();
            const bById = new Map();
            const aNoId = [];
            const bNoId = [];
            a.forEach((it, i) => {
                if (it && typeof it === 'object' && it[idField] != null) aById.set(String(it[idField]), { item: it, idx: i });
                else aNoId.push({ item: it, idx: i });
            });
            b.forEach((it, i) => {
                if (it && typeof it === 'object' && it[idField] != null) bById.set(String(it[idField]), { item: it, idx: i });
                else bNoId.push({ item: it, idx: i });
            });

            aById.forEach((entry, id) => {
                if (bById.has(id)) {
                    const bEntry = bById.get(id);
                    if (!deepEqual(entry.item, bEntry.item)) {
                        result.modified.push({ id, a: entry.item, b: bEntry.item, fields: diffObject(entry.item, bEntry.item) });
                    } else {
                        result.unchanged++;
                    }
                } else {
                    result.removed.push({ id, item: entry.item });
                }
            });
            bById.forEach((entry, id) => {
                if (!aById.has(id)) result.added.push({ id, item: entry.item });
            });

            // Items sin ID: comparación posicional
            const minLen = Math.min(aNoId.length, bNoId.length);
            for (let i = 0; i < minLen; i++) {
                if (!deepEqual(aNoId[i].item, bNoId[i].item)) {
                    result.modified.push({ position: i, a: aNoId[i].item, b: bNoId[i].item, isPositional: true });
                } else {
                    result.unchanged++;
                }
            }
            for (let i = minLen; i < aNoId.length; i++) result.removed.push({ position: i, item: aNoId[i].item, isPositional: true });
            for (let i = minLen; i < bNoId.length; i++) result.added.push({ position: i, item: bNoId[i].item, isPositional: true });
        } else {
            // Sin ID — comparación posicional (típico de filas de tablas heredadas)
            const minLen = Math.min(a.length, b.length);
            for (let i = 0; i < minLen; i++) {
                if (!deepEqual(a[i], b[i])) {
                    result.modified.push({ position: i, a: a[i], b: b[i], isPositional: true });
                } else {
                    result.unchanged++;
                }
            }
            for (let i = minLen; i < a.length; i++) result.removed.push({ position: i, item: a[i], isPositional: true });
            for (let i = minLen; i < b.length; i++) result.added.push({ position: i, item: b[i], isPositional: true });
        }
        return result;
    }

    /** Diff entre dos objetos: lista los campos que cambiaron. */
    function diffObject(a, b) {
        const changes = [];
        if (!a) a = {};
        if (!b) b = {};
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        keys.forEach(k => {
            const va = a[k], vb = b[k];
            if (deepEqual(va, vb)) return;
            const typeStr = typeof va === 'object' || typeof vb === 'object' ? 'object' : 'scalar';
            changes.push({ field: k, type: typeStr, before: va, after: vb });
        });
        return changes;
    }

    /** Diff de una sección: campos top-level (incluyendo arrays). */
    function diffSection(a, b) {
        const result = { hasChanges: false, fieldChanges: [] };
        const exclude = new Set(['tipo']); // tipo es la clave de matching
        const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => !exclude.has(k)));

        keys.forEach(k => {
            const va = a[k], vb = b[k];
            if (deepEqual(va, vb)) return;
            if (Array.isArray(va) || Array.isArray(vb)) {
                const ad = diffArray(va || [], vb || []);
                if (ad.added.length + ad.removed.length + ad.modified.length > 0) {
                    result.fieldChanges.push({ field: k, type: 'array', diff: ad });
                }
            } else if ((typeof va === 'object' && va) || (typeof vb === 'object' && vb)) {
                result.fieldChanges.push({ field: k, type: 'object', before: va, after: vb });
            } else {
                result.fieldChanges.push({ field: k, type: 'scalar', before: va, after: vb });
            }
        });
        result.hasChanges = result.fieldChanges.length > 0;
        return result;
    }

    /** Comparación top-level de dos docs. */
    function compareDocuments(docA, docB) {
        if (!docA || !docB) throw new Error('Faltan documentos.');
        if (docA.type !== docB.type) {
            throw new Error('Tipos distintos: ' + (docA.type || '?') + ' vs ' + (docB.type || '?') +
                            '. Solo se pueden comparar dos versiones del mismo tipo de doc.');
        }

        const metadataDiff = diffObject(docA.document || {}, docB.document || {});
        const sectionsResult = { added: [], removed: [], modified: [], unchanged: 0 };

        const aSecs = docA.secciones || [];
        const bSecs = docB.secciones || [];

        // Agrupar por clave (puede haber duplicados en algunos docs)
        const aMap = new Map();
        const bMap = new Map();
        aSecs.forEach((s, i) => {
            const k = sectionKey(s);
            if (!aMap.has(k)) aMap.set(k, []);
            aMap.get(k).push({ sec: s, idx: i });
        });
        bSecs.forEach((s, i) => {
            const k = sectionKey(s);
            if (!bMap.has(k)) bMap.set(k, []);
            bMap.get(k).push({ sec: s, idx: i });
        });

        const allKeys = new Set([...aMap.keys(), ...bMap.keys()]);
        allKeys.forEach(k => {
            const aList = aMap.get(k) || [];
            const bList = bMap.get(k) || [];
            const matchCount = Math.min(aList.length, bList.length);
            for (let i = 0; i < matchCount; i++) {
                const innerDiff = diffSection(aList[i].sec, bList[i].sec);
                if (innerDiff.hasChanges) {
                    sectionsResult.modified.push({
                        key: k,
                        a: aList[i].sec, b: bList[i].sec,
                        idxA: aList[i].idx, idxB: bList[i].idx,
                        diff: innerDiff
                    });
                } else {
                    sectionsResult.unchanged++;
                }
            }
            for (let i = matchCount; i < aList.length; i++) {
                sectionsResult.removed.push({ sec: aList[i].sec, idx: aList[i].idx });
            }
            for (let i = matchCount; i < bList.length; i++) {
                sectionsResult.added.push({ sec: bList[i].sec, idx: bList[i].idx });
            }
        });

        const stats = {
            sectionsAdded: sectionsResult.added.length,
            sectionsRemoved: sectionsResult.removed.length,
            sectionsModified: sectionsResult.modified.length,
            sectionsUnchanged: sectionsResult.unchanged,
            metadataChanges: metadataDiff.length,
            totalChanges: sectionsResult.added.length + sectionsResult.removed.length + sectionsResult.modified.length + metadataDiff.length
        };

        return {
            type: docA.type,
            versions: { a: (docA.document && docA.document.version) || '?', b: (docB.document && docB.document.version) || '?' },
            codes:    { a: (docA.document && docA.document.code) || '',   b: (docB.document && docB.document.code) || '' },
            titles:   { a: (docA.document && docA.document.titleEs) || '', b: (docB.document && docB.document.titleEs) || '' },
            metadata: metadataDiff,
            sections: sectionsResult,
            stats
        };
    }

    // ====================================================================
    // UI — MODAL CON FILE PICKERS + RENDER DEL DIFF
    // ====================================================================

    let _loadedA = null;
    let _loadedB = null;

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** Resume un valor para mostrar (corta strings largos, JSON-stringify objetos). */
    function summarize(v) {
        if (v == null) return '<em class="cmp-empty">∅</em>';
        if (typeof v === 'string') {
            const s = v.replace(/\s+/g, ' ').trim();
            return escapeHtml(s.length > 200 ? s.slice(0, 197) + '…' : s);
        }
        if (typeof v === 'number' || typeof v === 'boolean') return escapeHtml(String(v));
        if (Array.isArray(v)) return `<em>[Array · ${v.length} items]</em>`;
        if (typeof v === 'object') {
            try {
                const s = JSON.stringify(v);
                return escapeHtml(s.length > 160 ? s.slice(0, 157) + '…' : s);
            } catch { return '<em>[obj]</em>'; }
        }
        return escapeHtml(String(v));
    }

    function itemLabel(item, idField) {
        if (!item || typeof item !== 'object') return '(item)';
        if (idField && item[idField]) return String(item[idField]);
        if (item.tcId) return item.tcId;
        if (item.id) return item.id;
        if (item.titulo) return String(item.titulo).slice(0, 50);
        if (item.subheader) return 'group: ' + item.subheader;
        return '(item)';
    }

    function renderDiff(diff, container) {
        container.innerHTML = '';
        const { stats, metadata, sections } = diff;

        // ── Encabezado con código + versiones ──
        const header = document.createElement('div');
        header.className = 'diff-header';
        header.innerHTML = `
            <div class="diff-header-codes">
                <span class="diff-doc-tag">${escapeHtml(diff.type)}</span>
                <span class="diff-doc-code">${escapeHtml(diff.codes.a || diff.codes.b || 'doc')}</span>
            </div>
            <div class="diff-header-versions">
                <span class="diff-ver-a">v${escapeHtml(diff.versions.a)}</span>
                <span class="diff-ver-arrow">→</span>
                <span class="diff-ver-b">v${escapeHtml(diff.versions.b)}</span>
            </div>
        `;
        container.appendChild(header);

        // ── KPIs ──
        const kpis = document.createElement('div');
        kpis.className = 'cmp-kpi-row diff-kpi-row';
        const kpi = (label, val, color) =>
            `<div class="cmp-kpi"><div class="cmp-kpi-label">${label}</div><div class="cmp-kpi-value" style="color:${color}">${val}</div></div>`;
        kpis.innerHTML = [
            kpi('Total cambios', stats.totalChanges, stats.totalChanges === 0 ? '#1E7E34' : '#5B3A8C'),
            kpi('+ Secciones', stats.sectionsAdded, '#1E7E34'),
            kpi('− Secciones', stats.sectionsRemoved, '#A52A2A'),
            kpi('~ Secciones', stats.sectionsModified, '#B85F0F'),
            kpi('= sin cambios', stats.sectionsUnchanged, '#586574'),
            kpi('Metadata', stats.metadataChanges, stats.metadataChanges === 0 ? '#586574' : '#B85F0F')
        ].join('');
        container.appendChild(kpis);

        if (stats.totalChanges === 0) {
            const ok = document.createElement('div');
            ok.className = 'diff-no-changes';
            ok.innerHTML = '<strong>Sin cambios.</strong> Las dos versiones son estructural y textualmente idénticas.';
            container.appendChild(ok);
            return;
        }

        // ── Filtros ──
        const filterBar = document.createElement('div');
        filterBar.className = 'cmp-filter-bar';
        filterBar.innerHTML = `
            <span class="cmp-filter-label">Mostrar:</span>
            <button class="cmp-filter-btn active" data-fc="all">Todos</button>
            <button class="cmp-filter-btn" data-fc="meta">Metadata (${stats.metadataChanges})</button>
            <button class="cmp-filter-btn" data-fc="added">+ Agregadas (${stats.sectionsAdded})</button>
            <button class="cmp-filter-btn" data-fc="removed">− Removidas (${stats.sectionsRemoved})</button>
            <button class="cmp-filter-btn" data-fc="modified">~ Modificadas (${stats.sectionsModified})</button>
        `;
        container.appendChild(filterBar);

        const tree = document.createElement('div');
        tree.className = 'diff-tree';

        // ── Cambios de metadata ──
        if (metadata.length > 0) {
            const block = document.createElement('div');
            block.className = 'diff-block';
            block.dataset.dfc = 'meta';
            block.innerHTML = `<div class="diff-block-title">Cambios de metadata del documento (${metadata.length})</div>`;
            metadata.forEach(ch => {
                const row = document.createElement('div');
                row.className = 'diff-field-row diff-mod';
                row.innerHTML = `
                    <span class="diff-field-name">${escapeHtml(ch.field)}</span>
                    <div class="diff-value-pair">
                        <span class="diff-val-before">${summarize(ch.before)}</span>
                        <span class="diff-arrow">→</span>
                        <span class="diff-val-after">${summarize(ch.after)}</span>
                    </div>
                `;
                block.appendChild(row);
            });
            tree.appendChild(block);
        }

        // ── Secciones agregadas ──
        if (sections.added.length > 0) {
            const block = document.createElement('div');
            block.className = 'diff-block';
            block.dataset.dfc = 'added';
            block.innerHTML = `<div class="diff-block-title diff-title-add">+ Secciones agregadas (${sections.added.length})</div>`;
            sections.added.forEach(s => {
                const row = document.createElement('div');
                row.className = 'diff-section-card diff-add';
                row.innerHTML = `
                    <div class="diff-sec-type">${escapeHtml(s.sec.tipo)}</div>
                    <div class="diff-sec-title">${escapeHtml(s.sec.titulo || '(sin título)')}</div>
                    <div class="diff-sec-note">Solo en v${escapeHtml(diff.versions.b)} · pos ${s.idx + 1}</div>
                `;
                block.appendChild(row);
            });
            tree.appendChild(block);
        }

        // ── Secciones removidas ──
        if (sections.removed.length > 0) {
            const block = document.createElement('div');
            block.className = 'diff-block';
            block.dataset.dfc = 'removed';
            block.innerHTML = `<div class="diff-block-title diff-title-rem">− Secciones removidas (${sections.removed.length})</div>`;
            sections.removed.forEach(s => {
                const row = document.createElement('div');
                row.className = 'diff-section-card diff-rem';
                row.innerHTML = `
                    <div class="diff-sec-type">${escapeHtml(s.sec.tipo)}</div>
                    <div class="diff-sec-title">${escapeHtml(s.sec.titulo || '(sin título)')}</div>
                    <div class="diff-sec-note">Solo en v${escapeHtml(diff.versions.a)} · pos ${s.idx + 1}</div>
                `;
                block.appendChild(row);
            });
            tree.appendChild(block);
        }

        // ── Secciones modificadas ──
        if (sections.modified.length > 0) {
            const block = document.createElement('div');
            block.className = 'diff-block';
            block.dataset.dfc = 'modified';
            block.innerHTML = `<div class="diff-block-title diff-title-mod">~ Secciones modificadas (${sections.modified.length})</div>`;
            sections.modified.forEach(m => {
                const card = document.createElement('div');
                card.className = 'diff-section-card diff-mod';
                card.innerHTML = `
                    <div class="diff-sec-type">${escapeHtml(m.a.tipo)}</div>
                    <div class="diff-sec-title">${escapeHtml(m.a.titulo || '(sin título)')}</div>
                    <div class="diff-sec-note">${m.diff.fieldChanges.length} campo(s) afectado(s)</div>
                `;
                m.diff.fieldChanges.forEach(fc => {
                    const fdiv = document.createElement('div');
                    fdiv.className = 'diff-field-block';
                    if (fc.type === 'array') {
                        const ad = fc.diff;
                        const itemsHtml = [];
                        ad.added.slice(0, 30).forEach(x => {
                            const lbl = x.id || ('pos ' + (x.position + 1));
                            itemsHtml.push(`<div class="diff-item-row diff-add">+ ${escapeHtml(lbl)} <span class="diff-item-summary">${summarize(x.item)}</span></div>`);
                        });
                        ad.removed.slice(0, 30).forEach(x => {
                            const lbl = x.id || ('pos ' + (x.position + 1));
                            itemsHtml.push(`<div class="diff-item-row diff-rem">− ${escapeHtml(lbl)} <span class="diff-item-summary">${summarize(x.item)}</span></div>`);
                        });
                        ad.modified.slice(0, 30).forEach(x => {
                            const lbl = x.id || ('pos ' + (x.position + 1));
                            const fieldsShort = (x.fields || []).slice(0, 3).map(f => escapeHtml(f.field)).join(', ');
                            const more = (x.fields || []).length > 3 ? `<em> · +${(x.fields || []).length - 3} más</em>` : '';
                            itemsHtml.push(`<div class="diff-item-row diff-mod">~ ${escapeHtml(lbl)} <span class="diff-item-summary">campos cambiados: ${fieldsShort}${more}</span></div>`);
                        });
                        const overflow = (ad.added.length + ad.removed.length + ad.modified.length) > 90 ? `<div class="diff-overflow">… mostrando primeros 30 de cada tipo. Total: +${ad.added.length} −${ad.removed.length} ~${ad.modified.length}.</div>` : '';
                        fdiv.innerHTML = `
                            <div class="diff-field-head">array <code>${escapeHtml(fc.field)}</code> · +${ad.added.length} −${ad.removed.length} ~${ad.modified.length}</div>
                            ${itemsHtml.join('')}
                            ${overflow}
                        `;
                    } else {
                        fdiv.innerHTML = `
                            <div class="diff-field-head">${fc.type} <code>${escapeHtml(fc.field)}</code></div>
                            <div class="diff-value-pair">
                                <span class="diff-val-before">${summarize(fc.before)}</span>
                                <span class="diff-arrow">→</span>
                                <span class="diff-val-after">${summarize(fc.after)}</span>
                            </div>
                        `;
                    }
                    card.appendChild(fdiv);
                });
                block.appendChild(card);
            });
            tree.appendChild(block);
        }

        container.appendChild(tree);

        // Wire filter buttons
        filterBar.querySelectorAll('.cmp-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                filterBar.querySelectorAll('.cmp-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const fc = btn.dataset.fc;
                tree.querySelectorAll('.diff-block').forEach(blk => {
                    blk.style.display = (fc === 'all' || blk.dataset.dfc === fc) ? '' : 'none';
                });
            });
        });
    }

    // ====================================================================
    // FILE LOADING + WIRING DEL MODAL
    // ====================================================================

    function updateSlotDisplay(slot, doc, fileName) {
        const slotEl = document.getElementById('cmpDiffSlot' + slot);
        if (!slotEl) return;
        if (!doc) {
            slotEl.innerHTML = `
                <div class="cmp-diff-slot-empty">
                    <strong>Versión ${slot}</strong>
                    <button class="vs-btn-secondary" onclick="document.getElementById('cmpDiffFile${slot}').click()">Cargar archivo</button>
                </div>`;
            return;
        }
        const code = (doc.document && doc.document.code) || '(sin código)';
        const ver = (doc.document && doc.document.version) || '?';
        slotEl.innerHTML = `
            <div class="cmp-diff-slot-ready">
                <div class="cmp-diff-slot-head">
                    <strong>Versión ${slot}</strong>
                    <button class="vs-btn-secondary" onclick="document.getElementById('cmpDiffFile${slot}').click()" style="font-size:11px; padding:4px 10px;">Cambiar</button>
                </div>
                <div class="cmp-diff-slot-info">
                    <span class="diff-doc-tag">${escapeHtml(doc.type || '?')}</span>
                    <span class="cmp-diff-slot-code">${escapeHtml(code)}</span>
                    <span class="cmp-diff-slot-ver">v${escapeHtml(ver)}</span>
                </div>
                <div class="cmp-diff-slot-file">${escapeHtml(fileName)}</div>
            </div>`;
    }

    function updateCompareButton() {
        const btn = document.getElementById('cmpDiffRunBtn');
        if (!btn) return;
        const ready = _loadedA && _loadedB;
        btn.disabled = !ready;
        btn.style.opacity = ready ? '1' : '0.5';
        btn.style.cursor = ready ? 'pointer' : 'not-allowed';
    }

    async function handleFile(slot, file) {
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.type && !data.secciones) throw new Error('JSON no parece ser un doc del suite (falta type / secciones).');
            if (slot === 'A') _loadedA = data;
            else _loadedB = data;
            updateSlotDisplay(slot, data, file.name);
            updateCompareButton();
            // Si ambos están y son tipos distintos, advertir
            if (_loadedA && _loadedB && _loadedA.type !== _loadedB.type) {
                const msg = document.getElementById('cmpDiffWarning');
                if (msg) msg.style.display = 'block';
            } else {
                const msg = document.getElementById('cmpDiffWarning');
                if (msg) msg.style.display = 'none';
            }
        } catch (e) {
            alert('Error leyendo archivo: ' + e.message);
        }
    }

    function runComparison() {
        if (!_loadedA || !_loadedB) return;
        try {
            const diff = compareDocuments(_loadedA, _loadedB);
            const container = document.getElementById('cmpDiffResult');
            renderDiff(diff, container);
            container.style.display = '';
            // Audit log
            if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                global.AuditTrail.logAction('SUITE_DIFF_VERSIONS', 'document', diff.codes.a || diff.codes.b || diff.type, {
                    type: diff.type,
                    versions: diff.versions,
                    stats: diff.stats
                }, 'Diff entre versiones');
            }
        } catch (e) {
            alert('Error comparando: ' + e.message);
        }
    }

    function resetDiff() {
        _loadedA = null;
        _loadedB = null;
        updateSlotDisplay('A', null);
        updateSlotDisplay('B', null);
        updateCompareButton();
        const container = document.getElementById('cmpDiffResult');
        if (container) { container.innerHTML = ''; container.style.display = 'none'; }
        const w = document.getElementById('cmpDiffWarning');
        if (w) w.style.display = 'none';
    }

    function openDiffModal() {
        const modal = document.getElementById('modalCmpDiff');
        if (!modal) { alert('Modal de diff no presente.'); return; }
        resetDiff();
        modal.style.display = 'flex';
        // Conectar file inputs (idempotente)
        ['A', 'B'].forEach(slot => {
            const inp = document.getElementById('cmpDiffFile' + slot);
            if (inp && !inp._diffWired) {
                inp.addEventListener('change', function (e) {
                    handleFile(slot, e.target.files[0]);
                    this.value = '';
                });
                inp._diffWired = true;
            }
        });
        updateSlotDisplay('A', null);
        updateSlotDisplay('B', null);
        updateCompareButton();
    }

    function closeDiffModal() {
        const modal = document.getElementById('modalCmpDiff');
        if (modal) modal.style.display = 'none';
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    VS.diffVersions.compareDocuments = compareDocuments;
    VS.diffVersions.diffSection = diffSection;
    VS.diffVersions.diffArray = diffArray;
    VS.diffVersions.openDiffModal = openDiffModal;
    VS.diffVersions.closeDiffModal = closeDiffModal;
    VS.diffVersions.runComparison = runComparison;
    VS.diffVersions.resetDiff = resetDiff;

    global.openVersionDiffModal = openDiffModal;
    global.closeVersionDiffModal = closeDiffModal;
    global.runVersionDiff = runComparison;
    global.resetVersionDiff = resetDiff;

})(window);
