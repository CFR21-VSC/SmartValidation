// Agregador de estados DocWorkflow para dashboard de proyectos y progress tracker.
// UMD: funciona en browser (window.CycleDashboard) y Node.js (module.exports).

(function (root, factory) {
    var result = factory();
    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = result;
    } else {
        root.CycleDashboard = result.CycleDashboard;
    }
})(typeof window !== 'undefined' ? window : global, function () {

    var STORAGE_PREFIX = 'doc_workflow_';

    function _loadMap(projectId) {
        if (typeof localStorage === 'undefined') return {};
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + (projectId || 'default'));
            return raw ? JSON.parse(raw) : {};
        } catch (_) { return {}; }
    }

    /**
     * Cuenta documentos por estado para un proyecto. Síncrono (localStorage).
     * @param {string} projectId
     * @param {number} [totalDocs] - total de docs en el paquete (p.stats.packageDocs).
     *   Docs sin estado explícito en el mapa se cuentan como 'draft'.
     * @returns {{ total, draft, in_review, approved, locked, completionPct }}
     */
    function getCycleStats(projectId, totalDocs) {
        var map = _loadMap(projectId);
        var counts = { draft: 0, in_review: 0, approved: 0, locked: 0 };

        Object.keys(map).forEach(function (docId) {
            var estado = (map[docId] && map[docId].estado) || 'draft';
            if (Object.prototype.hasOwnProperty.call(counts, estado)) {
                counts[estado]++;
            }
        });

        var tracked = counts.draft + counts.in_review + counts.approved + counts.locked;
        var total = (typeof totalDocs === 'number' && totalDocs > 0)
            ? Math.max(totalDocs, tracked)
            : tracked;

        // Docs sin entrada en el mapa → draft implícito
        if (typeof totalDocs === 'number' && totalDocs > tracked) {
            counts.draft += (totalDocs - tracked);
        }

        var done = counts.approved + counts.locked;
        var completionPct = total > 0 ? Math.round((done / total) * 100) : 0;

        return {
            total:         total,
            draft:         counts.draft,
            in_review:     counts.in_review,
            approved:      counts.approved,
            locked:        counts.locked,
            completionPct: completionPct
        };
    }

    /**
     * Retorna el mapa de estados del proyecto como array.
     * @param {string} projectId
     * @returns {Array<{ docId, estado, updatedAt, updatedBy }>}
     */
    function getDocStates(projectId) {
        var map = _loadMap(projectId);
        return Object.keys(map).map(function (docId) {
            var entry = map[docId] || {};
            return {
                docId:     docId,
                estado:    entry.estado    || 'draft',
                updatedAt: entry.updatedAt || null,
                updatedBy: entry.updatedBy || null
            };
        });
    }

    /**
     * Estado de un documento específico (síncrono).
     * @param {string} projectId
     * @param {string} docId
     * @returns {'draft'|'in_review'|'approved'|'locked'}
     */
    function getDocState(projectId, docId) {
        var map = _loadMap(projectId);
        return (map[docId] && map[docId].estado) || 'draft';
    }

    var CycleDashboard = {
        getCycleStats: getCycleStats,
        getDocStates:  getDocStates,
        getDocState:   getDocState
    };

    return { CycleDashboard: CycleDashboard };
});
