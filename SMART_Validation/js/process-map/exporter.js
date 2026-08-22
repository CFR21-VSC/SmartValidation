// js/process-map/exporter.js
// Exportación de JSON (completo y por capa) y PNG

const ProcessMapExporter = (() => {

    function init() {
        // nada que inicializar por ahora
    }

    function exportFullJSON() {
        const data = ProcessMapViewer.getMapData();
        if (!data) { alert('No hay mapa cargado.'); return; }
        downloadJSON(data, _filename('proceso-completo'));
    }

    function exportLayerJSON(layer) {
        const data = ProcessMapViewer.getMapData();
        if (!data) { alert('No hay mapa cargado.'); return; }

        const LAYER_LABELS = {
            roles:        'roles',
            integrations: 'integraciones',
            calculations: 'calculos',
            documents:    'documentos',
        };

        const stripped = {
            meta: { ...data.meta, exported_layer: layer },
            nodes: (data.nodes || []).map(node => ({
                id: node.id,
                label: node.label,
                type: node.type,
                [layer]: (node.layers || {})[layer] || [],
            })),
            edges: data.edges,
        };

        downloadJSON(stripped, _filename('capa-' + (LAYER_LABELS[layer] || layer)));
    }

    function exportPNG() {
        const cy = ProcessMapViewer.getCy();
        if (!cy || cy.nodes().length === 0) { alert('No hay mapa cargado.'); return; }

        const png = cy.png({
            output: 'blob',
            scale: 2,
            bg: '#f8fafc',
            full: true,
        });

        const url = URL.createObjectURL(png);
        const a = document.createElement('a');
        a.href = url;
        a.download = _filename('mapa') + '.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function _filename(suffix) {
        const data = ProcessMapViewer.getMapData();
        const base = (data?.meta?.name || 'proceso')
            .toLowerCase()
            .replace(/[^a-z0-9áéíóúñ]/gi, '-')
            .replace(/-+/g, '-')
            .substring(0, 40);
        return 'smart-pm_' + base + '_' + suffix;
    }

    return { init, exportFullJSON, exportLayerJSON, exportPNG };
})();
