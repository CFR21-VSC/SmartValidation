// js/process-map/viewer.js

const ProcessMapViewer = (() => {
    let cy = null;
    let mapData = null;

    const CYTOSCAPE_STYLE = [
        // ── Base de todos los nodos ──
        {
            selector: 'node',
            style: {
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': '140px',
                'font-size': '11.5px',
                'font-weight': '500',
                'font-family': 'Inter, system-ui, -apple-system, sans-serif',
                'color': '#ffffff',
                'shadow-blur': 10,
                'shadow-color': '#000000',
                'shadow-offset-x': 0,
                'shadow-offset-y': 3,
                'shadow-opacity': 0.18,
            }
        },
        // ── Tipos de nodo ──
        {
            selector: 'node[type="start"]',
            style: {
                'background-color': '#16a34a',
                'shape': 'ellipse',
                'width': '52px', 'height': '52px',
                'font-size': '10px', 'font-weight': '700',
                'border-width': 3, 'border-color': '#bbf7d0',
            }
        },
        {
            selector: 'node[type="end"]',
            style: {
                'background-color': '#dc2626',
                'shape': 'ellipse',
                'width': '52px', 'height': '52px',
                'font-size': '10px', 'font-weight': '700',
                'border-width': 3, 'border-color': '#fecaca',
            }
        },
        {
            selector: 'node[type="step"]',
            style: {
                'background-color': '#1e3a52',
                'shape': 'roundrectangle',
                'width': '170px', 'height': '50px',
                'border-width': 1, 'border-color': 'rgba(255,255,255,0.12)',
            }
        },
        {
            selector: 'node[type="decision"]',
            style: {
                'background-color': '#b45309',
                'shape': 'diamond',
                'width': '130px', 'height': '82px',
                'font-size': '10px',
                'border-width': 2, 'border-color': '#fde68a',
            }
        },
        {
            selector: 'node[type="parallel"]',
            style: {
                'background-color': '#4c1d95',
                'shape': 'rectangle',
                'width': '170px', 'height': '22px',
                'font-size': '9px', 'letter-spacing': '1.5px',
            }
        },
        {
            selector: 'node[type="subprocess"]',
            style: {
                'background-color': '#075985',
                'shape': 'roundrectangle',
                'width': '170px', 'height': '50px',
                'border-width': 3, 'border-color': 'rgba(255,255,255,0.3)',
            }
        },
        // ── Estado seleccionado ──
        {
            selector: 'node:selected',
            style: {
                'border-width': 3,
                'border-color': '#C2E03B',
                'shadow-blur': 16,
                'shadow-color': '#C2E03B',
                'shadow-opacity': 0.4,
            }
        },
        // ── Aristas ──
        {
            selector: 'edge',
            style: {
                'curve-style': 'bezier',
                'target-arrow-shape': 'triangle',
                'target-arrow-color': '#475569',
                'line-color': '#475569',
                'width': 2,
                'arrow-scale': 1.2,
                'label': 'data(label)',
                'font-size': '9.5px',
                'font-family': 'Inter, system-ui, sans-serif',
                'font-weight': '500',
                'color': '#334155',
                'text-background-color': '#f8fafc',
                'text-background-opacity': 1,
                'text-background-padding': '3px',
                'text-border-opacity': 1,
                'text-border-width': 1,
                'text-border-color': '#e2e8f0',
            }
        },
        {
            selector: 'edge:selected',
            style: {
                'line-color': '#C2E03B',
                'target-arrow-color': '#C2E03B',
            }
        },
        // ── Aristas de loop/retorno (style diferenciado) ──
        {
            selector: 'edge[isLoop]',
            style: {
                'curve-style': 'unbundled-bezier',
                'control-point-distances': [-80],
                'control-point-weights': [0.5],
                'line-style': 'dashed',
                'line-dash-pattern': [6, 3],
                'line-color': '#94a3b8',
                'target-arrow-color': '#94a3b8',
                'width': 1.5,
            }
        },
    ];

    function init() {
        // cytoscape-dagre registra el layout al cargarse como script tag —
        // llamar .use() es innecesario y puede lanzar error en algunos builds.
        try { cytoscape.use(cytoscapeDagre); } catch(e) { /* ya registrado */ }
        initCytoscape();
        LayerManager.init();

        document.getElementById('btnLoadJSON').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    loadMap(JSON.parse(ev.target.result));
                } catch (err) {
                    alert('JSON inválido: ' + err.message);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    function initCytoscape() {
        cy = cytoscape({
            container: document.getElementById('cy'),
            elements: [],
            style: CYTOSCAPE_STYLE,
            layout: { name: 'preset' },
            wheelSensitivity: 0.3,
            minZoom: 0.15,
            maxZoom: 3,
        });

        cy.on('tap', 'node', (evt) => {
            NodePanel.show(evt.target.data(), mapData);
        });

        cy.on('tap', (evt) => {
            if (evt.target === cy) NodePanel.clear();
        });
    }

    function loadMap(data) {
        mapData = data;

        // Header metadata
        document.getElementById('mapName').textContent = data.meta?.name || 'Sin título';
        const sysEl = document.getElementById('mapSystem');
        sysEl.textContent = data.meta?.system || '';
        sysEl.style.display = data.meta?.system ? 'inline' : 'none';

        // Construir elementos de Cytoscape
        const elements = [];
        const nodeIds = new Set((data.nodes || []).map(n => n.id));

        for (const node of (data.nodes || [])) {
            const layers = node.layers || {};
            elements.push({
                group: 'nodes',
                data: {
                    id: node.id,
                    label: node.label || node.id,
                    type: node.type || 'step',
                    layers: layers,
                    hasRoles:        (layers.roles || []).length > 0,
                    hasIntegrations: (layers.integrations || []).length > 0,
                    hasCalculations: (layers.calculations || []).length > 0,
                    hasDocuments:    (layers.documents || []).length > 0,
                }
            });
        }

        for (const edge of (data.edges || [])) {
            // Detectar loops (arista que va hacia un nodo que aparece ANTES en el flujo)
            // Heurística simple: si el target aparece antes que el source en la lista de nodos
            const srcIdx = (data.nodes || []).findIndex(n => n.id === edge.from);
            const tgtIdx = (data.nodes || []).findIndex(n => n.id === edge.to);
            const isLoop = tgtIdx < srcIdx;

            elements.push({
                group: 'edges',
                data: {
                    id: edge.id,
                    source: edge.from,
                    target: edge.to,
                    label: edge.label || '',
                    condition: edge.condition || '',
                    isLoop: isLoop ? 'yes' : undefined,
                }
            });
        }

        cy.elements().remove();
        cy.add(elements);

        // Layout
        runLayout('TB');

        // UI
        const count = (data.nodes || []).length;
        document.getElementById('nodeCount').textContent = count + ' nodo' + (count !== 1 ? 's' : '');
        document.getElementById('pmEmptyState').classList.add('hidden');

        NodePanel.clear();

        // Inicializar overlay con datos del mapa
        OverlayManager.load(data.nodes || [], cy);
        LayerManager.refresh(cy);
    }

    function runLayout(rankDir) {
        if (!cy || cy.nodes().length === 0) return;
        cy.layout({
            name: 'dagre',
            rankDir: rankDir || currentLayoutDir(),
            nodeSep: 70,
            rankSep: 90,
            edgeSep: 30,
            padding: 52,
            animate: true,
            animationDuration: 280,
            // Excluir aristas de loop del cálculo de rango para no distorsionar el layout
            edgeWeight: (edge) => edge.data('isLoop') ? 0 : 1,
        }).run();

        // Después del layout, actualizar posiciones del overlay
        setTimeout(() => OverlayManager.updatePositions(), 320);
    }

    function relayout(dir) { runLayout(dir); }

    function fit() {
        if (cy) {
            cy.fit(undefined, 48);
            OverlayManager.updatePositions();
        }
    }

    function currentLayoutDir() {
        const r = document.querySelector('input[name="layoutDir"]:checked');
        return r ? r.value : 'TB';
    }

    function getCy() { return cy; }
    function getMapData() { return mapData; }

    return { init, loadMap, relayout, fit, getCy, getMapData };
})();
