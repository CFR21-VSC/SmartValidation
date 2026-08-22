// js/process-map/layer-manager.js
// Gestión del estado de capas — controla el OverlayManager y el panel lateral

const LayerManager = (() => {

    const DATA_LAYERS = ['roles', 'integrations', 'calculations', 'documents'];

    function init() {
        DATA_LAYERS.forEach(layer => {
            const cb = document.getElementById(_cbId(layer));
            if (cb) cb.addEventListener('change', _onToggle);
        });
        // La capa "flow" (flujo) siempre está activa — no tiene checkbox de data
        const flowCb = document.getElementById('layerFlow');
        if (flowCb) flowCb.addEventListener('change', _onFlowToggle);
    }

    function refresh(cy) {
        _applyOverlay();
    }

    function _onToggle() {
        _applyOverlay();
        NodePanel.onLayerChange(getActiveLayers());
    }

    function _onFlowToggle() {
        const cy = ProcessMapViewer.getCy();
        if (!cy) return;
        const show = document.getElementById('layerFlow')?.checked ?? true;
        cy.nodes().style('opacity', show ? 1 : 0.15);
        cy.edges().style('opacity', show ? 1 : 0.08);
    }

    function _applyOverlay() {
        OverlayManager.setActiveLayers(getActiveLayers());
    }

    function getActiveLayers() {
        return DATA_LAYERS.filter(l => {
            const cb = document.getElementById(_cbId(l));
            return cb ? cb.checked : true;
        });
    }

    function isLayerActive(layer) {
        const cb = document.getElementById(_cbId(layer));
        return cb ? cb.checked : true;
    }

    function _cbId(layer) {
        const map = {
            roles:        'layerRoles',
            integrations: 'layerIntegrations',
            calculations: 'layerCalculations',
            documents:    'layerDocuments',
        };
        return map[layer] || layer;
    }

    return { init, refresh, getActiveLayers, isLayerActive };
})();
