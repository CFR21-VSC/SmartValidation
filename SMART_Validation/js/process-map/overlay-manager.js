// js/process-map/overlay-manager.js
// Renderiza chips de capa directamente sobre el canvas de Cytoscape

const OverlayManager = (() => {

    let _cy = null;
    let _container = null;      // #cy div
    let _overlay = null;        // div absoluto encima del canvas
    let _cards = {};            // nodeId → div card
    let _activeLayers = new Set(['roles', 'integrations', 'calculations', 'documents']);
    const MIN_ZOOM_SHOW = 0.38; // debajo de este zoom se ocultan los overlays

    const LAYER_CFG = {
        roles:        { icon: '👤', cls: 'pm-ov-roles',  key: 'roles' },
        integrations: { icon: '🔗', cls: 'pm-ov-integr', key: 'integrations' },
        calculations: { icon: '⚡', cls: 'pm-ov-calcs',  key: 'calculations' },
        documents:    { icon: '📄', cls: 'pm-ov-docs',   key: 'documents' },
    };

    // ─── Inicialización (llamada desde viewer.js tras initCytoscape) ───
    function _ensureOverlay(cy) {
        _cy = cy;
        _container = document.getElementById('cy');

        if (_overlay) _overlay.remove();

        _overlay = document.createElement('div');
        _overlay.id = 'pmOverlayCanvas';
        _overlay.style.cssText = `
            position: absolute; inset: 0;
            pointer-events: none;
            overflow: hidden;
            z-index: 10;
        `;
        _container.appendChild(_overlay);

        // Actualizar posiciones en cada render (zoom/pan)
        cy.on('render', () => updatePositions());
    }

    // ─── Carga los datos del mapa y construye los cards ───
    function load(nodes, cy) {
        _ensureOverlay(cy);
        _cards = {};
        _overlay.innerHTML = '';

        for (const node of nodes) {
            const layers = node.layers || {};
            const hasAny = (layers.roles || []).length
                || (layers.integrations || []).length
                || (layers.calculations || []).length
                || (layers.documents || []).length;

            if (!hasAny) continue;

            const card = _buildCard(node.id, layers);
            _overlay.appendChild(card);
            _cards[node.id] = card;
        }

        updateVisibility();
    }

    // ─── Construye el card HTML de un nodo ───
    function _buildCard(nodeId, layers) {
        const card = document.createElement('div');
        card.className = 'pm-node-card';
        card.dataset.nodeId = nodeId;

        for (const [layerKey, cfg] of Object.entries(LAYER_CFG)) {
            const items = layers[cfg.key] || [];
            if (!items.length) continue;

            const row = document.createElement('div');
            row.className = 'pm-ov-row ' + cfg.cls;
            row.dataset.layer = layerKey;

            const text = _formatLayer(layerKey, items);
            row.innerHTML = `<span class="pm-ov-icon">${cfg.icon}</span><span class="pm-ov-text">${escHtml(text)}</span>`;

            card.appendChild(row);
        }

        return card;
    }

    function _formatLayer(key, items) {
        switch (key) {
            case 'roles':
                return items.join(' · ');
            case 'integrations':
                return items.map(i => {
                    const arrow = i.direction === 'in' ? '←' : i.direction === 'out' ? '→' : '↔';
                    return i.system + ' ' + arrow;
                }).join(' · ');
            case 'calculations':
                return items.map(c => c.name + (c.limit ? ' (' + c.limit + ')' : '')).join(' · ');
            case 'documents':
                return items.map(d => d.id || d.title).join(' · ');
            default:
                return '';
        }
    }

    // ─── Actualiza posiciones de todos los cards según zoom/pan ───
    function updatePositions() {
        if (!_cy || !_overlay) return;

        const zoom = _cy.zoom();
        const visible = zoom >= MIN_ZOOM_SHOW;

        // Ocultar todo si zoom muy pequeño
        _overlay.style.display = visible ? 'block' : 'none';
        if (!visible) return;

        const layoutDir = _getCurrentLayoutDir();

        for (const [nodeId, card] of Object.entries(_cards)) {
            const node = _cy.getElementById(nodeId);
            if (!node || !node.length) continue;

            const rp = node.renderedPosition();
            const rw = node.renderedWidth();
            const rh = node.renderedHeight();

            // Posicionar debajo del nodo (TB) o a la derecha (LR)
            let left, top;
            if (layoutDir === 'LR') {
                left = rp.x + rw / 2 + 6;
                top  = rp.y - rh / 2;
            } else {
                left = rp.x - rw / 2;
                top  = rp.y + rh / 2 + 5;
            }

            const cardW = Math.max(rw, 150 * zoom);

            card.style.left   = left + 'px';
            card.style.top    = top  + 'px';
            card.style.width  = cardW + 'px';
            card.style.fontSize = Math.max(8, 10.5 * zoom) + 'px';
        }
    }

    // ─── Muestra/oculta rows según capas activas ───
    function updateVisibility() {
        if (!_overlay) return;
        _overlay.querySelectorAll('.pm-ov-row').forEach(row => {
            const layer = row.dataset.layer;
            row.style.display = _activeLayers.has(layer) ? 'flex' : 'none';
        });
        // Ocultar cards que no tienen ninguna fila visible
        for (const card of Object.values(_cards)) {
            const anyVisible = card.querySelector('.pm-ov-row[style*="flex"]')
                || [...card.querySelectorAll('.pm-ov-row')].some(r => r.style.display !== 'none');
            card.style.display = anyVisible ? 'block' : 'none';
        }
    }

    function setActiveLayers(layers) {
        _activeLayers = new Set(layers);
        updateVisibility();
    }

    function _getCurrentLayoutDir() {
        const r = document.querySelector('input[name="layoutDir"]:checked');
        return r ? r.value : 'TB';
    }

    function escHtml(str) {
        return String(str || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    return { load, updatePositions, setActiveLayers };
})();
