// js/process-map/node-panel.js
// Panel lateral derecho — detalle de las 5 capas del nodo seleccionado

const NodePanel = (() => {

    const LAYER_CONFIG = {
        roles: {
            label: 'Roles de usuario',
            color: '#0E7490',
            icon: '👤',
            render: renderRoles,
        },
        integrations: {
            label: 'Integraciones',
            color: '#E67E22',
            icon: '🔗',
            render: renderIntegrations,
        },
        calculations: {
            label: 'Cálculos',
            color: '#5B3A8C',
            icon: '⚡',
            render: renderCalculations,
        },
        documents: {
            label: 'Documentos',
            color: '#1E7E34',
            icon: '📄',
            render: renderDocuments,
        },
    };

    const TYPE_LABELS = {
        start:      'Inicio',
        end:        'Fin',
        step:       'Paso',
        decision:   'Decisión',
        parallel:   'Paralelo',
        subprocess: 'Subprocess',
    };

    let _currentNodeData = null;
    let _activeLayers = ['roles', 'integrations', 'calculations', 'documents'];

    function show(nodeData, mapData) {
        _currentNodeData = nodeData;
        render(nodeData);
    }

    function clear() {
        _currentNodeData = null;
        document.getElementById('nodePanelEmpty').style.display = 'flex';
        document.getElementById('nodePanelDetail').style.display = 'none';
    }

    function onLayerChange(activeLayers) {
        _activeLayers = activeLayers;
        if (_currentNodeData) render(_currentNodeData);
    }

    function render(nodeData) {
        document.getElementById('nodePanelEmpty').style.display = 'none';
        document.getElementById('nodePanelDetail').style.display = 'flex';

        document.getElementById('npNodeLabel').textContent = nodeData.label || nodeData.id;

        const typeEl = document.getElementById('npNodeType');
        const type = nodeData.type || 'step';
        typeEl.textContent = TYPE_LABELS[type] || type;
        typeEl.className = 'pm-node-type-badge pm-type-' + type;

        const layersEl = document.getElementById('npLayers');
        layersEl.innerHTML = '';

        const layers = nodeData.layers || {};

        // Siempre mostramos las 4 capas de datos, pero marcamos cuáles están activas
        ['roles', 'integrations', 'calculations', 'documents'].forEach(key => {
            const cfg = LAYER_CONFIG[key];
            const data = layers[key] || [];
            const isActive = _activeLayers.includes(key) || _activeLayers.length === 0;

            const section = document.createElement('div');
            section.className = 'pm-layer-section';
            if (!isActive) section.style.opacity = '0.35';

            const header = document.createElement('div');
            header.className = 'pm-layer-section-header';
            header.innerHTML = `
                <span class="pm-layer-section-dot" style="background:${cfg.color}"></span>
                <span>${cfg.icon} ${cfg.label}</span>
                ${data.length > 0 ? `<span style="margin-left:auto;font-size:10px;background:${cfg.color}22;color:${cfg.color};padding:1px 6px;border-radius:8px;font-weight:700">${data.length}</span>` : ''}
            `;

            const content = document.createElement('div');
            content.className = 'pm-layer-section-content';

            if (!data || data.length === 0) {
                content.innerHTML = '<span class="pm-layer-empty">Sin datos en esta capa</span>';
            } else {
                content.innerHTML = cfg.render(data);
            }

            section.appendChild(header);
            section.appendChild(content);
            layersEl.appendChild(section);
        });
    }

    // ─── Renderers por tipo de capa ───

    function renderRoles(roles) {
        return roles.map(r =>
            `<div class="pm-layer-item">
                <span class="pm-layer-item-icon">👤</span>
                <div class="pm-layer-item-body">
                    <div class="pm-layer-item-title">${escHtml(r)}</div>
                </div>
            </div>`
        ).join('');
    }

    function renderIntegrations(integrations) {
        return integrations.map(intg => {
            const dirBadge = {
                'in':            '<span class="pm-dir-badge pm-dir-in">← IN</span>',
                'out':           '<span class="pm-dir-badge pm-dir-out">OUT →</span>',
                'bidirectional': '<span class="pm-dir-badge pm-dir-bi">↔ BI</span>',
            }[intg.direction] || '';

            return `<div class="pm-layer-item">
                <span class="pm-layer-item-icon">🔗</span>
                <div class="pm-layer-item-body">
                    <div class="pm-layer-item-title">${escHtml(intg.system || '—')}${dirBadge}</div>
                    ${intg.data ? `<div class="pm-layer-item-meta">${escHtml(intg.data)}</div>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function renderCalculations(calcs) {
        return calcs.map(c =>
            `<div class="pm-layer-item">
                <span class="pm-layer-item-icon">⚡</span>
                <div class="pm-layer-item-body">
                    <div class="pm-layer-item-title">${escHtml(c.name || '—')}</div>
                    ${c.formula ? `<div class="pm-layer-item-meta">= ${escHtml(c.formula)}${c.unit ? ' ' + escHtml(c.unit) : ''}</div>` : ''}
                    ${c.limit ? `<div class="pm-layer-item-meta" style="color:#D97706">Límite: ${escHtml(c.limit)}</div>` : ''}
                </div>
            </div>`
        ).join('');
    }

    function renderDocuments(docs) {
        return docs.map(d =>
            `<div class="pm-layer-item">
                <span class="pm-layer-item-icon">📄</span>
                <div class="pm-layer-item-body">
                    <div class="pm-layer-item-title">
                        ${d.id ? `<span style="color:#0369A1;font-weight:700">${escHtml(d.id)}</span> — ` : ''}${escHtml(d.title || '—')}
                    </div>
                    <div class="pm-layer-item-meta">
                        <span class="pm-doc-type">${escHtml(d.type || 'OTHER')}</span>
                    </div>
                </div>
            </div>`
        ).join('');
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return { show, clear, onLayerChange };
})();
