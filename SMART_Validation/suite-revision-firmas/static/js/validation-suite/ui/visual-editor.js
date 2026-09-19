/* ====================================================================
   VISUAL EDITOR — vista "Word-like" del documento JSON
   Renderiza el JSON del paquete documental como un doc editable inline
   (contenteditable), y serializa los cambios de vuelta al JSON al guardar.

   Tipos de sección soportados en MVP:
     - texto (bloques: subtitulo + texto + bullets)
     - lista-incluido-excluido (subIncluido, incluido[], subExcluido, excluido[])
     - tabla (columnas[], filas[] de strings o de objetos)
     - tabla-info (campos key/value)
     - subseccion (recursiva: hijos renderizados como sub-bloques)
     - caja-nota / caja-justificacion / caja-criterio (parrafos[])

   Para tipos no soportados, se renderiza un "fallback card" que conserva
   el JSON original intacto en una propiedad _rawSection del DOM, así
   el round-trip JSON↔Visual↔JSON no pierde data.

   API:
     VS.visualEditor.render(jsonData, container)
     VS.visualEditor.serialize(originalData, container) → newData
     VS.visualEditor.bindEditor(jsonTextarea, visualContainer) → wires saving
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.visualEditor = VS.visualEditor || {};

    // ──────────────────────────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────────────────────────

    function el(tag, opts, children) {
        const e = document.createElement(tag);
        if (opts) {
            if (opts.className) e.className = opts.className;
            if (opts.text != null) e.textContent = String(opts.text);
            if (opts.html != null) e.innerHTML = opts.html;
            if (opts.contentEditable) {
                e.contentEditable = 'true';
                e.spellcheck = true;
            }
            if (opts.placeholder) e.dataset.placeholder = opts.placeholder;
            if (opts.dataset) {
                Object.keys(opts.dataset).forEach(k => { e.dataset[k] = opts.dataset[k]; });
            }
            if (opts.attrs) {
                Object.keys(opts.attrs).forEach(k => { e.setAttribute(k, opts.attrs[k]); });
            }
            if (opts.style) e.setAttribute('style', opts.style);
            if (opts.onclick) e.addEventListener('click', opts.onclick);
        }
        if (Array.isArray(children)) {
            children.forEach(c => { if (c) e.appendChild(c); });
        } else if (children) {
            e.appendChild(children);
        }
        return e;
    }

    function readEditableText(node) {
        if (!node) return '';
        // textContent preserva line breaks de divs; ideal para multilínea
        return (node.textContent || '').replace(/ /g, ' ').trim();
    }

    function readEditableMultiline(node) {
        if (!node) return '';
        // Para contenteditable multilínea, mantener saltos de línea
        // representados como <br> o <div>
        let txt = node.innerText || node.textContent || '';
        // Normaliza NBSP
        txt = txt.replace(/ /g, ' ');
        return txt.trim();
    }

    function makeAddBtn(label, onClick) {
        return el('button', {
            className: 've-mini-btn',
            text: label || '+ agregar',
            attrs: { type: 'button' },
            onclick: onClick
        });
    }

    function makeDelBtn(onClick) {
        return el('button', {
            className: 've-mini-btn ve-mini-btn-danger',
            text: '×',
            attrs: { type: 'button', title: 'Eliminar' },
            onclick: onClick
        });
    }

    function sectionTypeLabel(tipo) {
        const map = {
            'texto': 'Párrafo de texto',
            'lista-incluido-excluido': 'Lista alcance (incluido / excluido)',
            'tabla': 'Tabla',
            'tabla-info': 'Tabla de información',
            'subseccion': 'Sub-sección',
            'caja-nota': 'Caja de nota',
            'caja-justificacion': 'Caja de justificación',
            'caja-criterio': 'Caja de criterio',
            'tabla-test-case': 'Test Cases (ejecutables)',
            'vsr-decision-final': 'Decisión de Validación (VSR)',
            'vsr-portada-final': 'Portada de Validación (VSR)'
        };
        return map[tipo] || tipo || 'desconocido';
    }

    // ──────────────────────────────────────────────────────────────────
    // RENDERERS (JSON → HTML)
    // ──────────────────────────────────────────────────────────────────

    function renderHeader(data) {
        const doc = data.document || {};
        const pkg = data.package || {};
        const wrap = el('div', { className: 've-header' });

        wrap.appendChild(el('h2', {
            className: 've-doc-title',
            contentEditable: true,
            text: doc.titleEs || '',
            placeholder: 'Título del documento'
        }));

        const meta = el('div', { className: 've-header-meta' });
        function field(label, key, value, parentKey) {
            const f = el('div', { className: 've-field' });
            f.appendChild(el('label', { text: label }));
            const inp = el('input', { className: 've-field-input', attrs: { type: 'text', value: value || '' } });
            inp.dataset.field = parentKey + '.' + key;
            f.appendChild(inp);
            return f;
        }
        meta.appendChild(field('Código', 'code', doc.code, 'document'));
        meta.appendChild(field('Versión', 'version', doc.version, 'document'));
        meta.appendChild(field('Fecha emisión', 'issueDate', doc.issueDate, 'document'));
        meta.appendChild(field('Estado', 'status', doc.status, 'document'));
        meta.appendChild(field('Sistema', 'systemName', pkg.systemName, 'package'));
        meta.appendChild(field('Cliente', 'client', pkg.client, 'package'));
        wrap.appendChild(meta);

        // Extras (clave/valor libres del header)
        if (doc.extras && typeof doc.extras === 'object' && Object.keys(doc.extras).length > 0) {
            const extrasWrap = el('div', { className: 've-extras' });
            extrasWrap.appendChild(el('div', { className: 've-extras-label', text: 'Datos adicionales:' }));
            const extrasList = el('div', { className: 've-extras-list', dataset: { extras: '1' } });
            Object.keys(doc.extras).forEach(k => {
                extrasList.appendChild(renderExtraRow(k, doc.extras[k]));
            });
            extrasWrap.appendChild(extrasList);
            wrap.appendChild(extrasWrap);
        }

        // Control de versiones
        const controlCambios = Array.isArray(data.controlCambios) ? data.controlCambios : [];
        wrap.appendChild(renderControlCambiosBlock(controlCambios));

        // Matriz de aprobaciones / firmantes
        const matrizAprob = Array.isArray(data.matrizAprobaciones) ? data.matrizAprobaciones : [];
        wrap.appendChild(renderMatrizAprobacionesBlock(matrizAprob));

        return wrap;
    }

    function renderControlCambiosBlock(filas) {
        const wrap = el('div', { className: 've-cc-block', dataset: { headerBlock: 'controlCambios' } });
        wrap.appendChild(el('div', { className: 've-cc-title', text: 'Control de Versiones' }));
        const tbl = el('table', { className: 've-tabla ve-cc-tabla' });
        const thead = el('thead');
        const hr = el('tr');
        ['Versión', 'Fecha', 'Autor', 'Descripción', ''].forEach(h => hr.appendChild(el('th', { className: 've-th', text: h })));
        thead.appendChild(hr);
        tbl.appendChild(thead);
        const tbody = el('tbody', { dataset: { collection: 'cc-rows' } });
        filas.forEach(f => tbody.appendChild(renderCCRow(f)));
        tbl.appendChild(tbody);
        wrap.appendChild(el('div', { className: 've-tabla-wrap' }, [tbl]));
        wrap.appendChild(makeAddBtn('+ versión', () => tbody.appendChild(renderCCRow({ version: '', fecha: '', autor: '', descripcion: '' }))));
        return wrap;
    }

    function renderCCRow(f) {
        const tr = el('tr');
        ['version', 'fecha', 'autor', 'descripcion'].forEach(k => {
            tr.appendChild(el('td', { contentEditable: true, text: f[k] || '', className: 've-td', dataset: { ccField: k } }));
        });
        tr.appendChild(el('td', { className: 've-td ve-td-actions' }, [makeDelBtn(() => tr.remove())]));
        return tr;
    }

    function renderMatrizAprobacionesBlock(filas) {
        const wrap = el('div', { className: 've-ma-block', dataset: { headerBlock: 'matrizAprobaciones' } });
        wrap.appendChild(el('div', { className: 've-cc-title', text: 'Matriz de Aprobaciones' }));
        const tbl = el('table', { className: 've-tabla ve-ma-tabla' });
        const thead = el('thead');
        const hr = el('tr');
        ['Rol', 'Nombre', 'Iniciales', 'Fecha', ''].forEach(h => hr.appendChild(el('th', { className: 've-th', text: h })));
        thead.appendChild(hr);
        tbl.appendChild(thead);
        const tbody = el('tbody', { dataset: { collection: 'ma-rows' } });
        filas.forEach(f => tbody.appendChild(renderMARow(f)));
        tbl.appendChild(tbody);
        wrap.appendChild(el('div', { className: 've-tabla-wrap' }, [tbl]));
        wrap.appendChild(makeAddBtn('+ firmante', () => tbody.appendChild(renderMARow({ rol: '', nombre: '', iniciales: '', fecha: '' }))));
        return wrap;
    }

    function renderMARow(f) {
        const tr = el('tr');
        // Los campos _signedBy, _signedAt, _signatureHashRef los preserva el sistema de firmas — no editables aquí
        ['rol', 'nombre', 'iniciales', 'fecha'].forEach(k => {
            tr.appendChild(el('td', { contentEditable: true, text: f[k] || '', className: 've-td', dataset: { maField: k } }));
        });
        // Guardar los campos de firma para round-trip
        tr._signatureFields = {
            _signedBy: f._signedBy,
            _signedAt: f._signedAt,
            _signatureHashRef: f._signatureHashRef
        };
        tr.appendChild(el('td', { className: 've-td ve-td-actions' }, [makeDelBtn(() => tr.remove())]));
        return tr;
    }

    function renderExtraRow(key, value) {
        const row = el('div', { className: 've-extra-row' });
        const k = el('input', { className: 've-extra-key', attrs: { type: 'text', value: key || '', placeholder: 'Campo' } });
        const v = el('input', { className: 've-extra-value', attrs: { type: 'text', value: value || '', placeholder: 'Valor' } });
        row.appendChild(k);
        row.appendChild(el('span', { className: 've-extra-sep', text: ':' }));
        row.appendChild(v);
        return row;
    }

    // ──────────────────────────────────────────────────────────────────
    // SECTION APPROVAL — bloqueo/desbloqueo de secciones individuales
    // ──────────────────────────────────────────────────────────────────

    /** Aplica o remueve el estado visual de aprobación en el wrapper DOM. */
    function _applySectionApprovedState(wrap, approved) {
        if (approved) {
            wrap.classList.add('section-approved');
            // Deshabilitar todos los elementos editables dentro del body
            const body = wrap.querySelector('.ve-section-body');
            if (body) {
                body.querySelectorAll('[contenteditable]').forEach(function(el) {
                    el.contentEditable = 'false';
                });
                body.querySelectorAll('input, textarea, select').forEach(function(el) {
                    el.disabled = true;
                });
                body.querySelectorAll('button:not(.btn-reopen-section)').forEach(function(btn) {
                    btn.disabled = true;
                    btn.style.opacity = '0.35';
                    btn.style.pointerEvents = 'none';
                });
            }
            // Deshabilitar el título también
            const titleEl = wrap.querySelector('.ve-section-title');
            if (titleEl) titleEl.contentEditable = 'false';
        } else {
            wrap.classList.remove('section-approved');
            // Re-habilitar todos los elementos editables
            const body = wrap.querySelector('.ve-section-body');
            if (body) {
                body.querySelectorAll('[contenteditable]').forEach(function(el) {
                    el.contentEditable = 'true';
                });
                body.querySelectorAll('input, textarea, select').forEach(function(el) {
                    el.disabled = false;
                });
                body.querySelectorAll('button').forEach(function(btn) {
                    btn.disabled = false;
                    btn.style.opacity = '';
                    btn.style.pointerEvents = '';
                });
            }
            // Re-habilitar título
            const titleEl = wrap.querySelector('.ve-section-title');
            if (titleEl) titleEl.contentEditable = 'true';
        }
    }

    /** Construye la barra de aprobación (botón + badge) para una sección. */
    function _buildApprovalBar(wrap, sec) {
        const bar = el('div', { className: 've-section-approval-bar' });

        // Badge "APROBADA" (visible solo cuando approved)
        const badge = el('span', { className: 've-section-approved-badge', text: '🔒 APROBADA' });
        if (sec.approvedAt) {
            const ts = new Date(sec.approvedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
            badge.title = 'Aprobado: ' + ts + (sec.approvedBy ? ' por ' + sec.approvedBy : '');
        }
        bar.appendChild(badge);

        // Botón aprobar / reabrir
        const btn = el('button', { attrs: { type: 'button' } });
        btn.className = sec.approved ? 'btn-reopen-section' : 'btn-approve-section';
        btn.textContent = sec.approved ? '🔓 Reabrir sección' : '✓ Aprobar sección';

        btn.addEventListener('click', function () {
            // Leer el estado actual desde _rawSection (fuente de verdad)
            const currentApproved = wrap._rawSection && wrap._rawSection.approved;
            if (!currentApproved) {
                // --- APROBAR ---
                const now = new Date().toISOString();
                // Intentar leer nombre del usuario del sistema si está disponible
                let userName = '';
                try {
                    const authMgr = window.AuthManager || (window.ValidationSuite && window.ValidationSuite.auth);
                    if (authMgr && typeof authMgr.getCurrentUser === 'function') {
                        const u = authMgr.getCurrentUser();
                        userName = (u && (u.name || u.email)) || '';
                    }
                } catch (_) {}

                wrap._rawSection.approved    = true;
                wrap._rawSection.approvedAt  = now;
                wrap._rawSection.approvedBy  = userName || 'Usuario';
                wrap._rawSection.reopenReason = null;

                badge.textContent = '🔒 APROBADA';
                badge.title = 'Aprobado: ' + new Date(now).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + ' por ' + (userName || 'Usuario');
                btn.className = 'btn-reopen-section';
                btn.textContent = '🔓 Reabrir sección';
                _applySectionApprovedState(wrap, true);
            } else {
                // --- REABRIR ---
                const confirmed = window.confirm(
                    '¿Querés reabrir esta sección para edición?\nEsto requiere justificación.'
                );
                if (!confirmed) return;
                const reason = window.prompt('Razón para reabrir la sección (requerido):');
                if (!reason || !reason.trim()) return;

                wrap._rawSection.approved     = false;
                wrap._rawSection.approvedAt   = null;
                wrap._rawSection.approvedBy   = null;
                wrap._rawSection.reopenReason = reason.trim();

                badge.textContent = '🔒 APROBADA';
                badge.title = '';
                btn.className = 'btn-approve-section';
                btn.textContent = '✓ Aprobar sección';
                _applySectionApprovedState(wrap, false);
            }
        });

        bar.appendChild(btn);
        return bar;
    }

    function renderSection(sec, idx) {
        const wrap = el('div', { className: 've-section', dataset: { sectionIdx: idx, sectionType: sec.tipo || 'unknown' } });
        wrap._rawSection = JSON.parse(JSON.stringify(sec || {})); // backup para round-trip

        // Badge tipo
        wrap.appendChild(el('span', { className: 've-section-type-badge', text: sectionTypeLabel(sec.tipo) }));

        // Barra de aprobación (arriba a la derecha)
        wrap.appendChild(_buildApprovalBar(wrap, sec));

        // Título
        if (sec.titulo !== undefined || ['texto', 'lista-incluido-excluido', 'tabla', 'tabla-info', 'subseccion', 'caja-nota', 'caja-justificacion', 'caja-criterio', 'arbol-decision-gamp', 'caja-resultado', 'tabla-docs-aplicables', 'vsr-decision-final', 'vsr-portada-final'].includes(sec.tipo)) {
            wrap.appendChild(el('h3', {
                className: 've-section-title',
                contentEditable: true,
                text: sec.titulo || '',
                placeholder: 'Título de la sección',
                dataset: { field: 'titulo' }
            }));
        }

        const body = el('div', { className: 've-section-body' });
        switch (sec.tipo) {
            case 'texto':                    renderTextoBody(sec, body); break;
            case 'lista-incluido-excluido':  renderListaBody(sec, body); break;
            case 'tabla':                    renderTablaBody(sec, body); break;
            case 'tabla-info':               renderTablaInfoBody(sec, body); break;
            case 'subseccion':               renderSubseccionBody(sec, body); break;
            case 'caja-nota':
            case 'caja-justificacion':
            case 'caja-criterio':
            case 'caja-conclusion':          renderCajaBody(sec, body); break;
            case 'tabla-test-case':          renderTablaTCBody(sec, body); break;
            case 'arbol-decision-gamp':      renderArbolGampBody(sec, body); break;
            case 'caja-resultado':           renderCajaResultadoBody(sec, body); break;
            case 'tabla-docs-aplicables':    renderTablaDocsBody(sec, body); break;
            case 'vsr-decision-final':
            case 'vsr-portada-final':        renderVsrDecisionBody(sec, body); break;
            // Tablas especializadas: intro + filas con objetos
            case 'tabla-norma':
            case 'tabla-trazabilidad':
            case 'tabla-componentes-ira':
            case 'tabla-alcance-piq':
            case 'aex-matriz-trazabilidad':  renderTablaConIntroBody(sec, body); break;
            case 'tabla-fmea':               renderTablaFmeaBody(sec, body); break;
            case 'escalas-fmea':             renderEscalasFmeaBody(sec, body); break;
            case 'aceptacion-riesgo-residual': renderAceptacionRiesgoResidualBody(sec, body); break;
            // Tarjetas de gap editables
            case 'tarjeta-gap':
            case 'tarjeta-gap-rrm':          renderTarjetaGapBody(sec, body); break;
            case 'tabla-firmas-final':        renderTablaFirmasFinalBody(sec, body); break;
            // matriz-tc: IIQ, IOQ, IPQ, PIQ, POQ, PPQ
            case 'matriz-tc':                renderMatrizTcBody(sec, body); break;
            // release-*: RIQ, ROQ, RPQ (+ release-resumen-ejecutivo también en VSR)
            case 'release-portada-decision': renderReleasePortadaDecisionBody(sec, body); break;
            case 'release-resumen-ejecutivo': renderReleaseResumenEjecutivoBody(sec, body); break;
            case 'release-trazabilidad-cierre': renderReleaseTrazabilidadCierreBody(sec, body); break;
            case 'release-condicionantes':   renderReleaseCondicionantesBody(sec, body); break;
            case 'release-decision-formal':  renderReleaseDecisionFormalBody(sec, body); break;
            // ncr-*: NCR
            case 'ncr-workflow-indicator':   renderNcrWorkflowIndicatorBody(sec, body); break;
            case 'ncr-registro-hallazgos':   renderNcrRegistroHallazgosBody(sec, body); break;
            case 'ncr-analisis-causa':       renderNcrAnalisisCausaBody(sec, body); break;
            case 'ncr-plan-capa':            renderNcrPlanCapaBody(sec, body); break;
            case 'ncr-cierre-aprobacion':    renderNcrCierreAprobacionBody(sec, body); break;
            // IIQ, IOQ, IPQ
            case 'hallazgos-consolidados':   renderHallazgosConsolidadosBody(sec, body); break;
            case 'resumen-ejecucion-iq':     renderResumenEjecucionIqBody(sec, body); break;
            case 'resumen-ejecucion-oq':     renderResumenEjecucionOqBody(sec, body); break;
            case 'resumen-ejecucion-pq':     renderResumenEjecucionPqBody(sec, body); break;
            // Sueltos
            case 'escalas-ira':              renderEscalasIraBody(sec, body); break;
            case 'aex-registro-tc':          renderAexRegistroTcBody(sec, body); break;
            case 'diagrama-arquitectura':    renderDiagramaArquitecturaBody(sec, body); break;
            case 'flujo-logico':             renderFlujoLogicoBody(sec, body); break;
            case 'box-resultado-rai':        renderBoxResultadoRaiBody(sec, body); break;
            case 'formula-rai':              renderFormulaRaiBody(sec, body); break;
            case 'tabla-decisiones-tc':      renderTablaDecisionesTcBody(sec, body); break;
            case 'vsr-cronologia-fases':     renderVsrCronologiaFasesBody(sec, body); break;
            case 'vsr-hallazgos-resumen':    renderVsrHallazgosResumenBody(sec, body); break;
            case 'vsr-inventario-paquete':   renderVsrInventarioPaqueteBody(sec, body); break;
            // Todo lo demás: smart read-only (muestra datos sin candado)
            default:                         renderSmartFallbackBody(sec, body); break;
        }
        wrap.appendChild(body);

        // Aplicar estado de bloqueo si la sección ya venía aprobada
        if (sec.approved) {
            _applySectionApprovedState(wrap, true);
        }

        return wrap;
    }

    function renderTextoBody(sec, body) {
        // Soporta tanto sec.contenido (string suelto) como sec.bloques[]
        let bloques = Array.isArray(sec.bloques) ? sec.bloques : null;
        if (!bloques) {
            const tex = sec.contenido || sec.texto || '';
            bloques = tex ? [{ texto: tex }] : [];
        }
        const list = el('div', { className: 've-bloques', dataset: { collection: 'bloques' } });
        bloques.forEach(b => list.appendChild(renderBloque(b)));
        body.appendChild(list);
        body.appendChild(makeAddBtn('+ agregar párrafo', () => {
            list.appendChild(renderBloque({ texto: '' }));
        }));
    }

    function renderBloque(b) {
        const block = el('div', { className: 've-bloque' });
        block.appendChild(el('div', {
            className: 've-bloque-subtitulo',
            contentEditable: true,
            text: b.subtitulo || '',
            placeholder: 'Subtítulo (opcional)',
            dataset: { field: 'subtitulo' }
        }));
        block.appendChild(el('div', {
            className: 've-bloque-texto',
            contentEditable: true,
            text: b.texto || '',
            placeholder: 'Texto del párrafo…',
            dataset: { field: 'texto' }
        }));
        // Bullets
        const bullets = Array.isArray(b.bullets) ? b.bullets : [];
        if (bullets.length > 0 || b.bullets !== undefined) {
            const ul = el('ul', { className: 've-bullets', dataset: { collection: 'bullets' } });
            bullets.forEach(t => ul.appendChild(renderBullet(t, ul)));
            block.appendChild(ul);
        }
        const bulletAddBtn = makeAddBtn('+ bullet', () => {
            let ul = block.querySelector('.ve-bullets');
            if (!ul) {
                ul = el('ul', { className: 've-bullets', dataset: { collection: 'bullets' } });
                block.insertBefore(ul, bulletAddBtn);
            }
            ul.appendChild(renderBullet('', ul));
        });
        block.appendChild(bulletAddBtn);

        // Botón para borrar el bloque entero
        const delBlock = makeDelBtn(() => block.remove());
        delBlock.classList.add('ve-bloque-del');
        block.appendChild(delBlock);
        return block;
    }

    function renderBullet(text, ul) {
        const li = el('li', { className: 've-bullet' });
        li.appendChild(el('span', {
            className: 've-bullet-text',
            contentEditable: true,
            text: text || '',
            placeholder: 'Item…'
        }));
        li.appendChild(makeDelBtn(() => li.remove()));
        return li;
    }

    function renderListaBody(sec, body) {
        // Sección "Incluido / Excluido"
        body.appendChild(renderListaSubBloque('Incluido', sec.subIncluido || '', sec.incluido || [], 'incluido', 'subIncluido'));
        body.appendChild(renderListaSubBloque('Excluido', sec.subExcluido || '', sec.excluido || [], 'excluido', 'subExcluido'));
    }

    function renderListaSubBloque(label, subtit, items, key, subKey) {
        const block = el('div', { className: 've-lista-block', dataset: { listaKey: key, listaSubKey: subKey } });
        block.appendChild(el('div', { className: 've-lista-label', text: label }));
        block.appendChild(el('div', {
            className: 've-lista-subtitulo',
            contentEditable: true,
            text: subtit,
            placeholder: 'Subtítulo de ' + label.toLowerCase() + ' (opcional)',
            dataset: { field: 'subtitulo' }
        }));
        const ul = el('ul', { className: 've-bullets', dataset: { collection: 'items' } });
        items.forEach(t => ul.appendChild(renderBullet(t, ul)));
        block.appendChild(ul);
        block.appendChild(makeAddBtn('+ item', () => ul.appendChild(renderBullet('', ul))));
        return block;
    }

    function renderTablaBody(sec, body) {
        const cols = Array.isArray(sec.columnas) ? sec.columnas : [];
        const filas = Array.isArray(sec.filas) ? sec.filas : [];
        const tbl = el('table', { className: 've-tabla', dataset: { sectionCollection: 'tabla' } });
        // Header
        const thead = el('thead');
        const headRow = el('tr');
        cols.forEach(c => {
            headRow.appendChild(el('th', { contentEditable: true, text: c || '', placeholder: 'columna', className: 've-th' }));
        });
        headRow.appendChild(el('th', { className: 've-th ve-th-actions', text: '' }));
        thead.appendChild(headRow);
        tbl.appendChild(thead);

        const tbody = el('tbody');
        filas.forEach(fila => {
            tbody.appendChild(renderTablaFila(fila, cols));
        });
        tbl.appendChild(tbody);

        const tblWrap = el('div', { className: 've-tabla-wrap' }, [tbl]);
        body.appendChild(tblWrap);
        body.appendChild(makeAddBtn('+ fila', () => {
            tbody.appendChild(renderTablaFila(cols.map(() => ''), cols));
        }));
        body.appendChild(makeAddBtn('+ columna', () => {
            // Agregar columna: nueva th + td vacía en cada fila
            const newTh = el('th', { contentEditable: true, text: '', placeholder: 'columna', className: 've-th' });
            headRow.insertBefore(newTh, headRow.lastChild);
            const nCols = headRow.querySelectorAll('th:not(.ve-th-actions)').length;
            Array.from(tbody.children).forEach(tr => {
                // Fila de agrupación: ocupa todo el ancho con una sola celda. Hay que
                // ampliar su colspan, NO agregarle una celda de datos — si se le agrega,
                // el serializador la ignora y lo que se escriba ahí se pierde.
                if (tr.dataset.filaKind === 'subheader') {
                    const tdSub = tr.querySelector('td.ve-td-subheader');
                    if (tdSub) tdSub.setAttribute('colspan', String(Math.max(nCols, 1)));
                    return;
                }
                const newTd = el('td', { contentEditable: true, text: '', className: 've-td' });
                newTd.dataset.cellKind = 'primitivo';
                tr.insertBefore(newTd, tr.lastChild);
            });
        }));
    }

    /**
     * Clasifica una celda para decidir cómo se edita y cómo se reemite.
     *   primitivo : string / número / booleano / null → editable como texto
     *   text      : {text:"…", …}  → se edita `text`, el resto se preserva
     *   contenido : {contenido:"…"} → se edita `contenido` (NO se le inventa un `text`)
     *   opaca     : cualquier otra forma → solo lectura, se preserva intacta
     */
    function _claseDeCelda(cell) {
        if (cell === null || cell === undefined) return { kind: 'primitivo', texto: '' };
        if (Array.isArray(cell)) return { kind: 'opaca', texto: '' };
        if (typeof cell === 'object') {
            if (typeof cell.text === 'string') return { kind: 'text', texto: cell.text };
            if (typeof cell.contenido === 'string') return { kind: 'contenido', texto: cell.contenido };
            return { kind: 'opaca', texto: '' };
        }
        // string, number, boolean — String(0) y String(false) no deben volverse ''
        return { kind: 'primitivo', texto: String(cell) };
    }

    /** Vista legible de una celda estructurada, sin JSON crudo en pantalla. */
    function _previewCeldaOpaca(cell) {
        if (Array.isArray(cell.bullets)) return cell.bullets.map(b => '• ' + String(b)).join('\n');
        if (Array.isArray(cell.stack)) {
            return cell.stack.map(n => (n && typeof n === 'object' ? (n.text != null ? String(n.text) : '') : String(n || ''))).filter(Boolean).join('\n');
        }
        if (Array.isArray(cell.ul)) return cell.ul.map(b => '• ' + String(b)).join('\n');
        return '[contenido estructurado]';
    }

    function renderTablaFila(fila, cols) {
        const tr = el('tr');

        // ── Filas de agrupación ({subheader}) ────────────────────────────────
        // Antes caían en la rama de "objeto con keys por columna": ninguna de sus
        // claves coincide con los nombres de columna, así que se dibujaban como una
        // fila totalmente vacía y se guardaban como ['','',...] — se perdía el texto
        // del grupo, no solo su formato. Se dibujan como una celda única editable y
        // se conserva el objeto original para reemitirlo intacto al serializar.
        if (fila && typeof fila === 'object' && !Array.isArray(fila) && fila.subheader != null) {
            tr._rawFila = fila;
            tr.dataset.filaKind = 'subheader';
            const td = el('td', {
                contentEditable: true,
                text: String(fila.subheader),
                className: 've-td ve-td-subheader',
                attrs: { colspan: String(Math.max(cols.length, 1)) }
            });
            tr.appendChild(td);
            tr.appendChild(el('td', { className: 've-td ve-td-actions' }, [makeDelBtn(() => tr.remove())]));
            return tr;
        }

        let arr;
        let esObjetoPorColumna = false;
        if (Array.isArray(fila)) {
            arr = fila;
        } else if (fila && typeof fila === 'object') {
            // Objeto con keys por columna
            arr = cols.map(c => fila[c] != null ? fila[c] : '');
            esObjetoPorColumna = true;
        } else {
            arr = cols.map(() => '');
        }
        tr._rawFila = fila;
        tr.dataset.filaKind = esObjetoPorColumna ? 'objeto' : 'array';
        arr.forEach((cell, idx) => {
            const clase = _claseDeCelda(cell);
            let td;
            if (clase.kind === 'opaca') {
                // Objeto sin representación de texto editable ({bullets:[…]}, {stack:[…]},
                // {text:[…]} de rich text). Antes caía en JSON.stringify(cell): se dibujaba
                // como JSON crudo y al guardar quedaba convertido en ese string PARA SIEMPRE
                // — hay documentos reales dañados así. Se muestra legible, no se edita, y el
                // valor original se preserva intacto.
                td = el('td', { className: 've-td ve-td-opaca', text: _previewCeldaOpaca(cell) });
                td.setAttribute('title', 'Contenido estructurado: se conserva tal cual, no se edita desde acá');
            } else {
                td = el('td', { contentEditable: true, text: clase.texto, className: 've-td' });
            }
            td._rawCell = cell;            // siempre, incluso primitivos (0 / false)
            td.dataset.cellKind = clase.kind;
            td.dataset.cellIdx = String(idx);
            tr.appendChild(td);
        });
        const actions = el('td', { className: 've-td ve-td-actions' }, [makeDelBtn(() => tr.remove())]);
        tr.appendChild(actions);
        return tr;
    }

    function renderTablaInfoBody(sec, body) {
        // Soporta formato canónico: filas[].{campo, valor}
        // y formato legacy: campos[].{label, value}
        let filas;
        if (Array.isArray(sec.filas) && sec.filas.length > 0 && sec.filas[0].campo !== undefined) {
            filas = sec.filas.map(f => ({ label: f.campo || '', value: f.valor != null ? f.valor : '' }));
        } else if (Array.isArray(sec.campos)) {
            filas = sec.campos.map(c => ({ label: c.label || '', value: c.value != null ? c.value : '' }));
        } else {
            filas = [];
        }
        const list = el('div', { className: 've-tabla-info', dataset: { collection: 'campos' } });
        filas.forEach(c => list.appendChild(renderInfoCampo(c)));
        body.appendChild(list);
        body.appendChild(makeAddBtn('+ campo', () => list.appendChild(renderInfoCampo({ label: '', value: '' }))));
    }

    function renderInfoCampo(c) {
        const row = el('div', { className: 've-info-row' });
        row.appendChild(el('input', { className: 've-info-key', attrs: { type: 'text', value: c.label || '', placeholder: 'Etiqueta' } }));
        row.appendChild(el('span', { className: 've-info-sep', text: ':' }));
        row.appendChild(el('input', { className: 've-info-value', attrs: { type: 'text', value: c.value != null ? c.value : '', placeholder: 'Valor' } }));
        row.appendChild(makeDelBtn(() => row.remove()));
        return row;
    }

    function renderArbolGampBody(sec, body) {
        body.appendChild(el('div', {
            className: 've-bloque-texto',
            contentEditable: true,
            text: sec.intro || '',
            placeholder: 'Texto introductorio de la categorización…',
            dataset: { field: 'intro' }
        }));
        const preguntas = Array.isArray(sec.preguntas) ? sec.preguntas : [];
        const list = el('div', { className: 've-preguntas-list', dataset: { collection: 'preguntas' } });
        preguntas.forEach(p => list.appendChild(renderPreguntaRow(p)));
        body.appendChild(list);
        body.appendChild(makeAddBtn('+ pregunta', () => list.appendChild(renderPreguntaRow({ pregunta: '', respuesta: '' }))));
    }

    function renderPreguntaRow(p) {
        const row = el('div', { className: 've-pregunta-row' });
        row.appendChild(el('input', { className: 've-pregunta-q', attrs: { type: 'text', value: p.pregunta || '', placeholder: 'Pregunta decisión GAMP…' } }));
        row.appendChild(el('input', { className: 've-pregunta-r', attrs: { type: 'text', value: p.respuesta || '', placeholder: 'Respuesta / conclusión…' } }));
        row.appendChild(makeDelBtn(() => row.remove()));
        return row;
    }

    function renderCajaResultadoBody(sec, body) {
        body.appendChild(el('input', {
            className: 've-caja-resultado-subtitulo',
            attrs: { type: 'text', value: sec.subtitulo || '', placeholder: 'Descripción del resultado…' },
            dataset: { field: 'subtitulo' }
        }));
    }

    function renderTablaDocsBody(sec, body) {
        body.appendChild(el('div', {
            className: 've-bloque-texto',
            contentEditable: true,
            text: sec.intro || '',
            placeholder: 'Texto introductorio…',
            dataset: { field: 'intro' }
        }));
        var COLS = ['documento', 'estado', 'aplicacion'];
        var filas = Array.isArray(sec.filas) ? sec.filas : [];
        var tbl = el('table', { className: 've-tabla ve-tabla-docs' });
        var thead = el('thead');
        var headRow = el('tr');
        ['Documento', 'Estado', 'Aplicación'].forEach(function(lbl) {
            headRow.appendChild(el('th', { className: 've-th', text: lbl }));
        });
        headRow.appendChild(el('th', { className: 've-th ve-th-actions' }));
        thead.appendChild(headRow);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        filas.forEach(function(fila) { tbody.appendChild(renderTablaDocsFila(fila, COLS)); });
        tbl.appendChild(tbody);
        body.appendChild(el('div', { className: 've-tabla-wrap' }, [tbl]));
        body.appendChild(makeAddBtn('+ fila', function() { tbody.appendChild(renderTablaDocsFila({}, COLS)); }));
    }

    function renderTablaDocsFila(fila, cols) {
        var tr = el('tr');
        cols.forEach(function(c) {
            tr.appendChild(el('td', { contentEditable: true, text: fila[c] || '', className: 've-td' }));
        });
        tr.appendChild(el('td', { className: 've-td ve-td-actions' }, [makeDelBtn(function() { tr.remove(); })]));
        return tr;
    }

    function renderSubseccionBody(sec, body) {
        const intro = el('div', {
            className: 've-subseccion-intro',
            contentEditable: true,
            text: sec.intro || '',
            placeholder: 'Texto introductorio (opcional)',
            dataset: { field: 'intro' }
        });
        body.appendChild(intro);
        const note = el('div', { className: 've-section-note', text: 'Las secciones hijas se renderizan en el doc completo por el dispatcher principal.' });
        body.appendChild(note);
    }

    function renderCajaBody(sec, body) {
        const parrafos = Array.isArray(sec.parrafos) ? sec.parrafos
                       : (sec.contenido || sec.texto) ? [sec.contenido || sec.texto]
                       : [];
        const list = el('div', { className: 've-caja-parrafos', dataset: { collection: 'parrafos' } });
        parrafos.forEach(p => list.appendChild(renderParrafo(p)));
        body.appendChild(list);
        body.appendChild(makeAddBtn('+ párrafo', () => list.appendChild(renderParrafo(''))));
    }

    function renderParrafo(text) {
        const row = el('div', { className: 've-parrafo' });
        row.appendChild(el('div', {
            className: 've-parrafo-text',
            contentEditable: true,
            text: text || '',
            placeholder: 'Párrafo…',
            dataset: { field: 'text' }
        }));
        row.appendChild(makeDelBtn(() => row.remove()));
        return row;
    }

    function renderTablaTCBody(sec, body) {
        const tcs = Array.isArray(sec.tcs) ? sec.tcs : [];
        if (sec.intro) {
            const intro = el('p', { className: 've-tc-intro', text: sec.intro });
            body.appendChild(intro);
        }
        if (tcs.length === 0) {
            body.appendChild(el('p', { className: 've-empty', text: 'Sin Test Cases definidos.' }));
            return;
        }
        const list = el('div', { className: 've-tc-list' });
        tcs.forEach(tc => {
            const card = el('div', { className: 've-tc-card' });

            // Header: ID + título
            const hdr = el('div', { className: 've-tc-header' });
            hdr.appendChild(el('span', { className: 've-tc-id', text: tc.tcId || '—' }));
            hdr.appendChild(el('span', { className: 've-tc-titulo', text: tc.titulo || '' }));
            const badges = el('span', { className: 've-tc-badges' });
            if (tc.nivel)   badges.appendChild(el('span', { className: 've-tc-badge ve-tc-badge-nivel', text: tc.nivel }));
            if (tc.tipoTC)  badges.appendChild(el('span', { className: 've-tc-badge ve-tc-badge-tipo', text: tc.tipoTC }));
            hdr.appendChild(badges);
            card.appendChild(hdr);

            // Trazabilidad: URS pills + RA
            const urs = Array.isArray(tc.ursVinculados) ? tc.ursVinculados : [];
            const ra  = tc.raVinculado || '';
            if (urs.length > 0 || ra) {
                const traz = el('div', { className: 've-tc-traz' });
                if (urs.length > 0) {
                    const ursWrap = el('span', { className: 've-tc-traz-group' });
                    ursWrap.appendChild(el('span', { className: 've-tc-traz-label', text: 'URS:' }));
                    urs.forEach(u => ursWrap.appendChild(el('span', { className: 've-tc-pill ve-tc-pill-urs', text: u })));
                    traz.appendChild(ursWrap);
                }
                if (ra) {
                    const raWrap = el('span', { className: 've-tc-traz-group' });
                    raWrap.appendChild(el('span', { className: 've-tc-traz-label', text: 'RA:' }));
                    raWrap.appendChild(el('span', { className: 've-tc-pill ve-tc-pill-ra', text: ra }));
                    traz.appendChild(raWrap);
                }
                card.appendChild(traz);
            }

            // Objetivo + criterio (colapsable)
            if (tc.objetivo) {
                card.appendChild(el('p', { className: 've-tc-objetivo', text: tc.objetivo }));
            }
            if (tc.criterioAceptacion) {
                const crit = el('div', { className: 've-tc-criterio' });
                crit.appendChild(el('span', { className: 've-tc-traz-label', text: 'Criterio de aceptación: ' }));
                crit.appendChild(document.createTextNode(tc.criterioAceptacion));
                card.appendChild(crit);
            }

            // Procedimiento (pasos) — colapsable, solo lectura
            const pasos = Array.isArray(tc.procedimiento) ? tc.procedimiento : [];
            if (pasos.length > 0) {
                const pasosWrap = el('details', { className: 've-tc-pasos-wrap' });
                pasosWrap.appendChild(el('summary', { className: 've-tc-pasos-summary', text: pasos.length + ' pasos' }));
                const ol = el('ol', { className: 've-tc-pasos' });
                pasos.forEach(p => {
                    const li = el('li', {});
                    li.innerHTML = '<span class="ve-tc-paso-inst">' + (p.instruccion || p.accion || '') + '</span>' +
                        (p.resultadoEsperado ? '<span class="ve-tc-paso-re"> → ' + p.resultadoEsperado + '</span>' : '');
                    ol.appendChild(li);
                });
                pasosWrap.appendChild(ol);
                card.appendChild(pasosWrap);
            }

            // ── Panel de ejecución ──────────────────────────────────────────
            const exec = el('div', { className: 've-tc-ejecucion', dataset: { role: 'ejecucion' } });
            exec.appendChild(el('div', { className: 've-tc-exec-title', text: 'Resultado de ejecución' }));

            // Estado
            const estRow = el('div', { className: 've-tc-exec-row ve-tc-exec-row-inline' });
            estRow.appendChild(el('span', { className: 've-tc-exec-label', text: 'Estado:' }));
            const estadoSel = document.createElement('select');
            estadoSel.className = 've-tc-exec-select';
            estadoSel.dataset.field = 'estado';
            const curEstado = (tc.estado || 'PENDIENTE').toUpperCase();
            ['PENDIENTE', 'PASS', 'FAIL', 'OBS', 'N/A'].forEach(opt => {
                const o = document.createElement('option');
                o.value = opt; o.textContent = opt;
                if (curEstado === opt || (opt === 'PENDIENTE' && !tc.estado)) o.selected = true;
                estadoSel.appendChild(o);
            });
            estRow.appendChild(estadoSel);
            exec.appendChild(estRow);

            // Resultado real
            const rrRow = el('div', { className: 've-tc-exec-row' });
            rrRow.appendChild(el('span', { className: 've-tc-exec-label', text: 'Resultado observado:' }));
            rrRow.appendChild(el('div', {
                className: 've-tc-exec-text',
                contentEditable: true,
                text: tc.resultadoReal || '',
                placeholder: 'Describir lo que se observó durante la ejecución…',
                dataset: { field: 'resultadoReal' }
            }));
            exec.appendChild(rrRow);

            // Criterio observado
            const coRow = el('div', { className: 've-tc-exec-row ve-tc-exec-row-inline' });
            coRow.appendChild(el('span', { className: 've-tc-exec-label', text: 'Criterio observado:' }));
            coRow.appendChild(el('input', {
                className: 've-tc-exec-input',
                attrs: { type: 'text', value: tc.criterioObservado || '', placeholder: 'Criterio de aceptación cumplido…' },
                dataset: { field: 'criterioObservado' }
            }));
            exec.appendChild(coRow);

            // Ejecutor + Fecha (dos columnas)
            const exeRow = el('div', { className: 've-tc-exec-row ve-tc-exec-row-inline' });
            exeRow.appendChild(el('span', { className: 've-tc-exec-label', text: 'Ejecutor / Fecha:' }));
            const twoCols = el('div', { className: 've-tc-exec-2col' });
            const exeCol = el('div', { className: 've-tc-exec-col' });
            exeCol.appendChild(el('input', {
                className: 've-tc-exec-input',
                attrs: { type: 'text', value: tc.ejecutor || '', placeholder: 'Ejecutor…' },
                dataset: { field: 'ejecutor' }
            }));
            const fechaCol = el('div', { className: 've-tc-exec-col' });
            fechaCol.appendChild(el('input', {
                className: 've-tc-exec-input',
                attrs: { type: 'text', value: tc.fechaEjecucion || '', placeholder: 'Mes YYYY…' },
                dataset: { field: 'fechaEjecucion' }
            }));
            twoCols.appendChild(exeCol);
            twoCols.appendChild(fechaCol);
            exeRow.appendChild(twoCols);
            exec.appendChild(exeRow);

            card.appendChild(exec);
            // ──────────────────────────────────────────────────────────────

            list.appendChild(card);
        });
        body.appendChild(list);
    }

    function serializeTablaTCBody(out, secEl) {
        const rawTcs = Array.isArray(out.tcs) ? out.tcs : [];
        const cards = secEl.querySelectorAll('.ve-tc-card');
        const newTcs = [];
        cards.forEach((card, i) => {
            // Deep-clone del TC original para no perder campos no editables (hallazgos, etc.)
            const base = rawTcs[i] ? JSON.parse(JSON.stringify(rawTcs[i])) : {};
            const exec = card.querySelector('.ve-tc-ejecucion');
            if (exec) {
                const sel = exec.querySelector('[data-field="estado"]');
                if (sel) base.estado = sel.value;
                const rr = exec.querySelector('[data-field="resultadoReal"]');
                if (rr) { const v = readEditableMultiline(rr); if (v) base.resultadoReal = v; }
                const co = exec.querySelector('[data-field="criterioObservado"]');
                if (co && co.value) base.criterioObservado = co.value;
                const exe = exec.querySelector('[data-field="ejecutor"]');
                if (exe && exe.value) base.ejecutor = exe.value;
                const fecha = exec.querySelector('[data-field="fechaEjecucion"]');
                if (fecha && fecha.value) base.fechaEjecucion = fecha.value;
            }
            newTcs.push(base);
        });
        if (newTcs.length > 0) out.tcs = newTcs;
    }

    function renderTablaFirmasFinalBody(sec, body) {
        if (sec.intro) {
            body.appendChild(el('div', {
                className: 've-bloque-texto',
                contentEditable: true,
                text: sec.intro,
                placeholder: 'Texto introductorio de firmas…',
                dataset: { field: 'intro' }
            }));
        }
        // Roles esperados (editables)
        const roles = Array.isArray(sec.rolesPlaceholder) ? sec.rolesPlaceholder : [];
        body.appendChild(el('div', { className: 've-cc-title', style: 'margin-top:8px', text: 'Roles requeridos:' }));
        const rolesList = el('div', { className: 've-roles-list', dataset: { collection: 'roles' } });
        roles.forEach(r => rolesList.appendChild(renderRoleRow(r)));
        body.appendChild(rolesList);
        body.appendChild(makeAddBtn('+ rol', () => rolesList.appendChild(renderRoleRow(''))));
        // Firmas ya registradas (solo lectura — las gestiona el sistema)
        const firmas = Array.isArray(sec.firmas) ? sec.firmas : [];
        if (firmas.length > 0) {
            body.appendChild(el('div', { className: 've-cc-title', style: 'margin-top:10px', text: 'Firmas registradas (' + firmas.length + '):' }));
            firmas.forEach(function(sig) {
                var line = el('div', { className: 've-smart-kv' });
                line.appendChild(el('span', { className: 've-smart-key', text: sig.rol || sig.nombre || '—' }));
                line.appendChild(el('span', { className: 've-smart-val', text: (sig.nombre || '') + (sig.fecha ? ' · ' + sig.fecha : '') }));
                body.appendChild(line);
            });
            body.appendChild(el('div', { className: 've-smart-note', text: 'Las firmas son gestionadas por el sistema de firma digital — no editables aquí.' }));
        }
        if (sec.nota) {
            body.appendChild(el('div', { className: 've-smart-note', text: sec.nota }));
        }
    }

    function renderRoleRow(text) {
        const row = el('div', { className: 've-role-row' });
        row.appendChild(el('input', { className: 've-role-input', attrs: { type: 'text', value: text || '', placeholder: 'Rol / nombre del firmante…' } }));
        row.appendChild(makeDelBtn(() => row.remove()));
        return row;
    }

    // ====================================================================
    // VSR DECISION — editor para vsr-decision-final y vsr-portada-final
    // Campos: decision (dropdown), textoFormal (textarea), validez (input)
    // ====================================================================
    function renderVsrDecisionBody(sec, body) {
        // Dropdown de decisión
        const decRow = el('div', { className: 've-vsr-dec-row' });
        decRow.appendChild(el('span', { className: 've-tc-exec-label', text: 'Decisión:' }));
        const sel = document.createElement('select');
        sel.className = 've-vsr-dec-select';
        sel.dataset.field = 'decision';
        const cur = String(sec.decision || 'PENDIENTE').toUpperCase();
        [
            { val: 'APROBADO',                   label: '✔ SISTEMA VALIDADO Y AUTORIZADO' },
            { val: 'APROBADO CON CONDICIONES',    label: '⚠ SISTEMA VALIDADO CON CONDICIONES' },
            { val: 'PENDIENTE',                   label: '◌ PENDIENTE / EN CURSO' },
            { val: 'RECHAZADO',                   label: '✖ VALIDACIÓN NO COMPLETADA' }
        ].forEach(({ val, label }) => {
            const o = document.createElement('option');
            o.value = val; o.textContent = label;
            if (cur === val.toUpperCase() ||
                (val === 'PENDIENTE' && !sec.decision) ||
                (val === 'RECHAZADO' && !/APROB|VALID|LIBER|PEND/.test(cur))) {
                o.selected = true;
            }
            sel.appendChild(o);
        });
        decRow.appendChild(sel);
        body.appendChild(decRow);

        // Texto formal de autorización
        body.appendChild(el('div', { className: 've-cc-title', style: 'margin-top:6px', text: 'Texto formal de autorización:' }));
        body.appendChild(el('div', {
            className: 've-bloque-texto',
            contentEditable: true,
            text: sec.textoFormal || '',
            placeholder: 'Redactar la declaración formal de autorización o rechazo…',
            dataset: { field: 'textoFormal' }
        }));

        // Validez
        const valRow = el('div', { className: 've-vsr-dec-row', style: 'margin-top:8px' });
        valRow.appendChild(el('span', { className: 've-tc-exec-label', text: 'Validez:' }));
        valRow.appendChild(el('input', {
            className: 've-vsr-dec-validez',
            attrs: { type: 'text', value: sec.validez || '', placeholder: 'Ej: Validez plena hasta Mayo 2027 o hasta cambio significativo…' },
            dataset: { field: 'validez' }
        }));
        body.appendChild(valRow);
    }

    function serializeVsrDecisionBody(out, secEl) {
        const sel = secEl.querySelector('[data-field="decision"]');
        if (sel) out.decision = sel.value;
        const tf = secEl.querySelector('[data-field="textoFormal"]');
        if (tf) { const v = readEditableMultiline(tf); if (v) out.textoFormal = v; else delete out.textoFormal; }
        const val = secEl.querySelector('[data-field="validez"]');
        if (val) { if (val.value) out.validez = val.value; else delete out.validez; }
    }

    // Calcula anchos porcentuales para columnas de tablas dinámicas según nombre/clave camelCase
    function _htmlColPct(cols) {
        var RE_TINY   = /^(n[°º]?$|#$|id$|ítems?$|items?$|num$|nro$|ord$|puntos?$|p\b$|sí?$|si$|no$|ok$)/i;
        var RE_NARROW = /^(aplica|aplic|estado|fase|tipo|categ|nivel|prior|fecha|vers|cumpl|sever|score|califc?|clase|frec)/i;
        var RE_WIDE   = /^(requisito|descrip|observ|accion|action|justif|comentar|conclus|especif|detall|eviden|acept)/i;
        var units = cols.map(function(col) {
            var orig   = (col || '').trim();
            var spaced = orig.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
            var clean  = spaced.replace(/[_\-]/g, ' ').trim();
            if (RE_TINY.test(clean))   return 4;
            if (RE_NARROW.test(clean)) return 7;
            if (RE_WIDE.test(clean))   return 20;
            var len = clean.replace(/\s+/g, '').length;
            if (len <= 3)  return 5;
            if (len <= 6)  return 10;
            return 14;
        });
        var total = units.reduce(function(s, u) { return s + u; }, 0) || 1;
        return units.map(function(u) { return Math.round(u * 100 / total); });
    }

    // Tabla especializada con intro de texto + filas como objetos (columnas inferidas)
    function renderTablaConIntroBody(sec, body) {
        if (sec.intro) {
            body.appendChild(el('div', { className: 've-bloque-texto ve-smart-intro', text: sec.intro }));
        }
        var filas = Array.isArray(sec.filas) ? sec.filas : [];
        if (!filas.length) { body.appendChild(el('div', { className: 've-smart-empty', text: 'Sin filas.' })); return; }
        // Inferir columnas del primer row que no sea subheader
        var cols = [];
        for (var i = 0; i < filas.length; i++) {
            if (!filas[i].subheader) { cols = Object.keys(filas[i]); break; }
        }
        var tbl = el('table', { className: 've-tabla ve-tabla-smart' });
        var colgroup = document.createElement('colgroup');
        _htmlColPct(cols).forEach(function(pct) {
            var col = document.createElement('col');
            col.style.width = pct + '%';
            colgroup.appendChild(col);
        });
        tbl.appendChild(colgroup);
        var thead = el('thead');
        var headRow = el('tr');
        cols.forEach(function(c) { headRow.appendChild(el('th', { className: 've-th', text: c })); });
        thead.appendChild(headRow);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        filas.forEach(function(fila) {
            if (fila.subheader) {
                var tr = el('tr');
                var td = el('td', { className: 've-td ve-td-subheader', attrs: { colspan: cols.length }, text: fila.subheader });
                tr.appendChild(td);
                tbody.appendChild(tr);
                return;
            }
            var tr = el('tr');
            cols.forEach(function(c) {
                var v = fila[c];
                var txt = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
                tr.appendChild(el('td', { className: 've-td', text: txt }));
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        body.appendChild(el('div', { className: 've-tabla-wrap' }, [tbl]));
        body.appendChild(el('div', { className: 've-smart-note', text: 'Vista de solo lectura — editá esta sección en modo JSON para modificar filas.' }));
    }

    // BAJO/MEDIO/ALTO — mismos umbrales y colores que templates/ra.js (nivelRiesgo), para que
    // el editor visual y el PDF final coincidan al mostrar un mismo puntaje.
    function _nivelRiesgo(score) {
        var n = parseInt(score, 10);
        if (isNaN(n) || n < 1) return { nivel: '—', color: '#717D8A' };
        if (n <= 6) return { nivel: 'BAJO', color: '#27AE60' };
        if (n <= 14) return { nivel: 'MEDIO', color: '#E67E22' };
        return { nivel: 'ALTO', color: '#C0392B' };
    }

    // Matriz FMEA (tabla-fmea) -- columnas fijas y conocidas (no inferidas como en
    // renderTablaConIntroBody, que le daba el mismo ancho a "S" que a "peligro" y rompía la
    // tabla). Mismas proporciones relativas que usa el PDF real (templates/ra.js
    // renderTablaFmea), adaptadas a HTML. Solo lectura, como el resto de las tablas
    // especializadas -- se edita en modo JSON.
    function renderTablaFmeaBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var filas = Array.isArray(sec.filas) ? sec.filas : [];
        if (!filas.length) { body.appendChild(el('div', { className: 've-smart-empty', text: 'Sin filas.' })); return; }

        var COLS = [
            ['id', 'RA-ID', 6], ['urs', 'URS Ref.', 8], ['peligro', 'Peligro / Modo de Fallo', 24],
            ['S', 'S', 4], ['P', 'P', 4], ['D', 'D', 4], ['ri', 'RI', 7],
            ['control', 'Control de Mitigación', 30], ['RR', 'RR', 7],
        ];
        var tbl = el('table', { className: 've-tabla ve-tabla-smart ve-tabla-fmea' });
        var colgroup = document.createElement('colgroup');
        COLS.forEach(function (c) {
            var col = document.createElement('col');
            col.style.width = c[2] + '%';
            colgroup.appendChild(col);
        });
        tbl.appendChild(colgroup);
        var thead = el('thead'), headRow = el('tr');
        COLS.forEach(function (c) { headRow.appendChild(el('th', { className: 've-th', text: c[1] })); });
        thead.appendChild(headRow);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        filas.forEach(function (fila) {
            if (fila && fila.subheader != null) {
                var tr = el('tr');
                tr.appendChild(el('td', { className: 've-td ve-td-subheader', attrs: { colspan: COLS.length }, text: fila.subheader }));
                tbody.appendChild(tr);
                return;
            }
            var S = parseInt(fila.S, 10) || 0, P = parseInt(fila.P, 10) || 0, D = parseInt(fila.D, 10) || 0;
            var RI = (S > 0 && P > 0 && D > 0) ? (S * P * D) : null;
            var tr2 = el('tr');
            COLS.forEach(function (c) {
                var key = c[0];
                if (key === 'ri') {
                    tr2.appendChild(el('td', { className: 've-td ve-fmea-score', html: _fmeaScoreHtml(RI) }));
                    return;
                }
                if (key === 'RR') {
                    var rr = fila.RR != null ? parseInt(fila.RR, 10) : null;
                    tr2.appendChild(el('td', { className: 've-td ve-fmea-score', html: _fmeaScoreHtml(rr) }));
                    return;
                }
                var v = fila[key];
                var txt = (v === null || v === undefined) ? '' : String(v);
                tr2.appendChild(el('td', { className: 've-td', text: txt }));
            });
            tbody.appendChild(tr2);
        });
        tbl.appendChild(tbody);
        body.appendChild(el('div', { className: 've-tabla-wrap' }, [tbl]));
        if (sec.notaInferior) body.appendChild(el('div', { className: 've-smart-intro', text: sec.notaInferior }));
        body.appendChild(el('div', { className: 've-smart-note', text: 'Vista de solo lectura — editá esta sección en modo JSON para modificar filas. RI se calcula (S×P×D), no se edita acá.' }));
    }

    function _fmeaScoreHtml(score) {
        if (score == null) return '<span class="ve-fmea-score-num">—</span>';
        var n = _nivelRiesgo(score);
        return '<span class="ve-fmea-score-num">' + score + '</span>'
            + '<span class="ve-fmea-score-nivel" style="color:' + n.color + '">' + n.nivel + '</span>';
    }

    // Escalas de puntuación (escalas-fmea en RA, escalas-ira en IRA): N mini-tablas de
    // valor/nivel/descripción + tabla de niveles de riesgo + nota. Genérica sobre los nombres
    // de campo porque ambos tipos comparten exactamente esta forma con distintas claves.
    function _renderEscalasGenericas(sec, body, escalaDefs, nivelesCols) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var grid = el('div', { className: 've-escalas-grid' });
        escalaDefs.forEach(function (pair) {
            var arr = sec[pair[0]];
            if (!Array.isArray(arr) || !arr.length) return;
            var col = el('div', { className: 've-escala-col' });
            col.appendChild(el('div', { className: 've-escala-titulo', text: pair[1] }));
            var tbl = el('table', { className: 've-tabla ve-tabla-smart' });
            var tbody = el('tbody');
            arr.forEach(function (e) {
                var tr = el('tr');
                tr.appendChild(el('td', { className: 've-td', text: e.valor != null ? String(e.valor) : '', attrs: { style: 'width:24px;text-align:center;font-weight:700;' } }));
                tr.appendChild(el('td', {}, [
                    el('div', { className: 've-escala-nivel', text: e.nivel || '' }),
                    el('div', { className: 've-escala-desc', text: e.descripcion || '' }),
                ]));
                tbody.appendChild(tr);
            });
            tbl.appendChild(tbody);
            col.appendChild(tbl);
            grid.appendChild(col);
        });
        if (grid.children.length) body.appendChild(grid);

        if (Array.isArray(sec.niveles) && sec.niveles.length) {
            body.appendChild(el('div', { className: 've-escala-titulo', text: 'Niveles de riesgo', attrs: { style: 'margin-top:14px;' } }));
            var cols = nivelesCols.map(function (c) { return { key: c[0], label: c[1], width: 1 }; });
            body.appendChild(_buildSmartTable(cols, sec.niveles));
        }
        if (sec.nota) body.appendChild(el('div', { className: 've-smart-intro', text: sec.nota, attrs: { style: 'margin-top:10px;' } }));
        _readOnlyNote(body);
    }
    function renderEscalasFmeaBody(sec, body) {
        _renderEscalasGenericas(sec, body,
            [['escalaS', 'Severidad (S)'], ['escalaP', 'Probabilidad (P)'], ['escalaD', 'Detectabilidad (D)']],
            [['rango', 'Rango'], ['nivel', 'Nivel'], ['accion', 'Acción']]);
    }
    function renderEscalasIraBody(sec, body) {
        _renderEscalasGenericas(sec, body,
            [['escalaP', 'Probabilidad (P)'], ['escalaG', 'Gravedad (G)'], ['escalaI', 'Impacto GxP (I)']],
            [['rango', 'Rango'], ['nivel', 'Nivel'], ['verificacion', 'Verificación']]);
    }

    // ──────────────────────────────────────────────────────────────────
    // Tipos sueltos: uno por tipo de documento, sin reuso entre sí.
    // ──────────────────────────────────────────────────────────────────
    function renderAexRegistroTcBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var tests = Array.isArray(sec.tests) ? sec.tests : [];
        if (!tests.length) { body.appendChild(_emptyBanner('Sin tests registrados.')); _readOnlyNote(body); return; }
        if (tests.length > 5) {
            var cols = [
                { key: 'tcId', label: 'TC-ID', width: 12 }, { key: 'titulo', label: 'Título', width: 34 }, { key: 'grupo', label: 'Grupo', width: 20 },
                { key: 'estado', label: 'Resultado', width: 20, render: function (t) { var e = t.resultado && t.resultado.estado; return e ? _badgeSpan(e, _estadoColor(e)) : ''; } },
                { key: 'evid', label: 'Evid.', width: 8, render: function (t) { return Array.isArray(t.evidencias) ? String(t.evidencias.length) : '0'; } },
            ];
            body.appendChild(_buildSmartTable(cols, tests));
        }
        var byGrupo = {}, order = [];
        tests.forEach(function (t) {
            var g = t.grupo || 'Sin grupo';
            if (!byGrupo[g]) { byGrupo[g] = []; order.push(g); }
            byGrupo[g].push(t);
        });
        order.forEach(function (g) {
            body.appendChild(el('div', { className: 've-escala-titulo', text: g, attrs: { style: 'margin-top:14px;' } }));
            byGrupo[g].forEach(function (t) {
                var card = el('div', { className: 've-ncr-card' });
                var head = el('div', { className: 've-ncr-card-title', text: (t.tcId || '') + ' — ' + (t.titulo || '') + ' ' });
                var estado = t.resultado && t.resultado.estado;
                if (estado) head.appendChild(_badgeSpan(estado, _estadoColor(estado)));
                card.appendChild(head);
                var traz = t.trazabilidad || {};
                var pills = [];
                if (Array.isArray(traz.urs) && traz.urs.length) pills.push('URS: ' + traz.urs.join(', '));
                if (traz.ra) pills.push('RA: ' + traz.ra);
                if (traz.ira) pills.push('IRA: ' + traz.ira);
                if (traz.componente) pills.push('Componente: ' + traz.componente);
                if (pills.length) card.appendChild(el('div', { className: 've-smart-intro', text: pills.join(' · '), attrs: { style: 'font-size:11px;padding:4px 8px;' } }));
                if (t.criterioAceptacion) card.appendChild(el('div', { className: 've-smart-kv' }, [el('span', { className: 've-smart-key', text: 'Criterio:' }), el('span', { className: 've-smart-val', text: t.criterioAceptacion })]));
                if (t.procedimientoResumen) card.appendChild(el('div', { className: 've-smart-kv' }, [el('span', { className: 've-smart-key', text: 'Procedimiento:' }), el('span', { className: 've-smart-val', text: t.procedimientoResumen })]));
                if (t.resultado) {
                    var r = t.resultado, rtext = [r.ejecutor, r.fecha, r.criterioObservado].filter(Boolean).join(' · ');
                    if (rtext) card.appendChild(el('div', { className: 've-smart-kv' }, [el('span', { className: 've-smart-key', text: 'Resultado:' }), el('span', { className: 've-smart-val', text: rtext })]));
                }
                body.appendChild(card);
            });
        });
        _readOnlyNote(body);
    }

    function renderDiagramaArquitecturaBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var capas = Array.isArray(sec.capas) ? sec.capas : [];
        var COLORS = { primary: '#0B2341', secondary: '#1a56a0', accent: '#C8921A' };
        capas.forEach(function (c, i) {
            var color = COLORS[c.color] || c.color || '#717D8A';
            var box = el('div', { className: 've-capa-box' });
            var head = el('div', { className: 've-capa-head', attrs: { style: 'background:' + color + ';' } });
            head.appendChild(el('span', { text: c.nombre || '', attrs: { style: 'font-weight:700;' } }));
            if (c.tecnologia) head.appendChild(el('span', { text: ' — ' + c.tecnologia, attrs: { style: 'font-style:italic;font-weight:400;' } }));
            box.appendChild(head);
            if (Array.isArray(c.componentes) && c.componentes.length) {
                var ul = el('ul', { className: 've-capa-componentes' });
                c.componentes.forEach(function (comp) { ul.appendChild(el('li', { text: comp })); });
                box.appendChild(ul);
            }
            body.appendChild(box);
            if (i < capas.length - 1) body.appendChild(el('div', { className: 've-capa-arrow', text: '▼' }));
        });
        if (sec.nota) body.appendChild(el('div', { className: 've-smart-intro', text: sec.nota, attrs: { style: 'margin-top:10px;' } }));
        _readOnlyNote(body);
    }

    function renderFlujoLogicoBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var algos = Array.isArray(sec.algoritmos) ? sec.algoritmos : [];
        algos.forEach(function (a) {
            var card = el('div', { className: 've-ncr-card' });
            card.appendChild(el('div', { className: 've-ncr-card-title', text: (a.id ? a.id + ' — ' : '') + (a.nombre || '') }));
            if (a.frsAsociados) card.appendChild(el('div', { className: 've-smart-kv' }, [el('span', { className: 've-smart-key', text: 'FRS:' }), el('span', { className: 've-smart-val', text: Array.isArray(a.frsAsociados) ? a.frsAsociados.join(', ') : String(a.frsAsociados) })]));
            if (a.trigger) card.appendChild(el('div', { className: 've-smart-intro', text: 'Disparador: ' + a.trigger }));
            var pasos = Array.isArray(a.pasos) ? a.pasos : [];
            if (pasos.length) {
                var ol = el('ol', { className: 've-escala-items' });
                pasos.forEach(function (p) { ol.appendChild(el('li', { text: (p && typeof p === 'object') ? (p.accion || JSON.stringify(p)) : String(p) })); });
                card.appendChild(ol);
            }
            var decisiones = Array.isArray(a.decisiones) ? a.decisiones : [];
            if (decisiones.length) {
                var cols = [{ key: 'condicion', label: 'Condición', width: 45 }, { key: 'accion', label: 'Acción', width: 55 }];
                var rows = decisiones.map(function (d) { return Array.isArray(d) ? { condicion: d[0], accion: d[1] } : { condicion: d.condicion, accion: d.accion }; });
                card.appendChild(_buildSmartTable(cols, rows));
            }
            if (a.ejemplo) card.appendChild(el('div', { className: 've-smart-intro', text: 'Ejemplo: ' + a.ejemplo, attrs: { style: 'margin-top:8px;' } }));
            body.appendChild(card);
        });
        _readOnlyNote(body);
    }

    function renderBoxResultadoRaiBody(sec, body) {
        var row = el('div', { className: 've-rai-row' });
        var left = el('div', { className: 've-rai-box', attrs: { style: 'background:var(--vsc-azul);color:#fff;' } });
        if (sec.labelCalculo) left.appendChild(el('div', { className: 've-escala-titulo', text: sec.labelCalculo, attrs: { style: 'color:#fff;' } }));
        left.appendChild(el('div', { text: sec.calculo || '', attrs: { style: 'font-size:15px;font-weight:700;' } }));
        row.appendChild(left);
        var right = el('div', { className: 've-rai-box', attrs: { style: 'background:#EAF7EE;' } });
        right.appendChild(el('div', { className: 've-escala-titulo', text: 'NIVEL DE RIESGO' }));
        right.appendChild(el('div', { text: sec.nivel || '', attrs: { style: 'font-size:16px;font-weight:700;color:' + _nivelColor(sec.nivel) + ';' } }));
        if (sec.rangos) right.appendChild(el('div', { text: sec.rangos, attrs: { style: 'font-size:11px;font-style:italic;color:#666;margin-top:4px;' } }));
        row.appendChild(right);
        body.appendChild(row);
        _readOnlyNote(body);
    }

    function renderFormulaRaiBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        if (sec.formula) body.appendChild(el('div', { className: 've-formula-box', text: sec.formula }));
        var cols = [
            { key: 'var', label: 'Var', width: 8 }, { key: 'factor', label: 'Factor', width: 18 },
            { key: 'descripcion', label: 'Descripción', width: 44 }, { key: 'escala', label: 'Escala', width: 15 }, { key: 'valor', label: 'Valor', width: 10 },
        ];
        body.appendChild(_buildSmartTable(cols, sec.factores, 'Sin factores.'));
        _readOnlyNote(body);
    }

    var _DECISIONES_TC_DEFAULT = [
        { resultado: 'PASA', color: 'pass', significado: 'El test case se ejecutó y cumplió el criterio de aceptación.', impacto: 'Ninguno.', accion: 'Ninguna.' },
        { resultado: 'PASA CON OBSERVACIONES', color: 'passObs', significado: 'Cumplió el criterio, con desvíos menores documentados.', impacto: 'Bajo.', accion: 'Registrar observación, sin bloquear.' },
        { resultado: 'NO PASA', color: 'fail', significado: 'No cumplió el criterio de aceptación.', impacto: 'Alto.', accion: 'Abrir NCR, definir CAPA.' },
        { resultado: 'NO APLICA', color: 'neutral', significado: 'El test case no aplica al contexto de ejecución.', impacto: 'Ninguno.', accion: 'Justificar y documentar.' },
    ];
    var _DECISIONES_TC_COLORS = { pass: '#27AE60', passObs: '#E67E22', fail: '#C0392B', neutral: '#717D8A' };
    function renderTablaDecisionesTcBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var tieneFilas = Array.isArray(sec.filas) && sec.filas.length;
        var filas = tieneFilas ? sec.filas : _DECISIONES_TC_DEFAULT;
        if (!tieneFilas) body.appendChild(el('div', { className: 've-smart-note', text: 'No hay filas propias en el JSON -- se muestra la tabla de referencia estándar (la misma que usa el PDF por default).' }));
        var cols = [
            { key: 'resultado', label: 'Resultado', width: 22, render: function (f) { return _badgeSpan(f.resultado, _DECISIONES_TC_COLORS[f.color] || '#717D8A'); } },
            { key: 'significado', label: 'Significado', width: 34 }, { key: 'impacto', label: 'Impacto', width: 22 }, { key: 'accion', label: 'Acción', width: 22 },
        ];
        body.appendChild(_buildSmartTable(cols, filas));
        _readOnlyNote(body);
    }

    function renderVsrCronologiaFasesBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var fases = Array.isArray(sec.fases) ? sec.fases : [];
        if (!fases.length) { body.appendChild(_emptyBanner('Sin fases cargadas.')); _readOnlyNote(body); return; }
        var row = el('div', { className: 've-cronologia-row' });
        fases.forEach(function (f) {
            var cell = el('div', { className: 've-cronologia-cell' });
            cell.appendChild(el('div', { text: f.codigo || '', attrs: { style: 'font-size:16px;font-weight:700;color:var(--vsc-azul);' } }));
            if (f.label) cell.appendChild(el('div', { text: f.label, attrs: { style: 'font-size:11px;color:#666;' } }));
            if (f.cierre) cell.appendChild(el('div', { text: f.cierre, attrs: { style: 'font-size:11px;color:#666;' } }));
            if (f.estado) cell.appendChild(_badgeSpan(f.estado, _estadoColor(f.estado)));
            row.appendChild(cell);
        });
        body.appendChild(row);
        _readOnlyNote(body);
    }

    function renderVsrHallazgosResumenBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var h = Array.isArray(sec.hallazgos) ? sec.hallazgos : [];
        if (!h.length) { body.appendChild(_emptyBanner('Sin hallazgos.')); _readOnlyNote(body); return; }
        var cerradas = h.filter(function (x) { return /CERR/.test(String(x.estado || '').toUpperCase()); }).length;
        var criticas = h.filter(function (x) { return /CRITIC/.test(String(x.criticidad || '').toUpperCase()); }).length;
        body.appendChild(_kpiGrid([
            { label: 'Total', value: h.length }, { label: 'Cerradas', value: cerradas, color: '#27AE60' },
            { label: 'Abiertas', value: h.length - cerradas, color: (h.length - cerradas) ? '#C0392B' : '#27AE60' },
            { label: 'Críticas', value: criticas, color: criticas ? '#C0392B' : '#27AE60' },
        ]));
        var cols = [
            { key: 'id', label: 'NC-ID', width: 8 }, { key: 'criticidad', label: 'Criticidad', width: 10, render: function (x) { return x.criticidad ? _badgeSpan(x.criticidad, _nivelColor(x.criticidad)) : ''; } },
            { key: 'tcRef', label: 'TC origen', width: 10 }, { key: 'descripcion', label: 'Descripción', width: 32 }, { key: 'accion', label: 'Acción CAPA', width: 32 },
            { key: 'estado', label: 'Estado', width: 8, render: function (x) { return x.estado ? _badgeSpan(x.estado, _estadoColor(x.estado)) : ''; } },
        ];
        body.appendChild(_buildSmartTable(cols, h));
        _readOnlyNote(body);
    }

    // Aceptación formal del riesgo residual (aceptacion-riesgo-residual): conclusión + lista
    // completa de puntos (el fallback genérico solo mostraba 3 y cortaba el resto).
    function renderAceptacionRiesgoResidualBody(sec, body) {
        if (sec.conclusion) body.appendChild(el('div', { className: 've-smart-intro', text: sec.conclusion }));
        var items = sec.items;
        if (Array.isArray(items) && items.length) {
            var ul = el('ul', { className: 've-escala-items' });
            items.forEach(function (it) {
                ul.appendChild(el('li', { text: typeof it === 'string' ? it : JSON.stringify(it) }));
            });
            body.appendChild(ul);
        }
        if (sec.firmas) {
            body.appendChild(el('div', { className: 've-smart-kv' }, [
                el('span', { className: 've-smart-key', text: 'firmas:' }),
                el('span', { className: 've-smart-val', text: JSON.stringify(sec.firmas) }),
            ]));
        }
        body.appendChild(el('div', { className: 've-smart-note', text: 'Vista de solo lectura — editá en modo JSON para modificar esta sección.' }));
    }

    // ──────────────────────────────────────────────────────────────────
    // HELPERS COMPARTIDOS para las tablas/paneles "smart" de solo lectura
    // que siguen (matriz-tc, release-*, ncr-*, resumenes de ejecución,
    // singles). Mismo criterio que RA: mostrar todo, sin truncar, con
    // proporciones de columna razonables en vez del ancho uniforme del
    // fallback genérico.
    // ──────────────────────────────────────────────────────────────────

    // Color por nivel de riesgo (BAJO/MEDIO/ALTO) -- mismos umbrales que _nivelRiesgo,
    // pero a partir de la etiqueta ya calculada (varios tipos la traen hecha, no el score).
    function _nivelColor(nivel) {
        var s = String(nivel || '').toUpperCase();
        if (s.indexOf('ALTO') >= 0 || s.indexOf('CRITIC') >= 0) return '#C0392B';
        if (s.indexOf('MEDIO') >= 0 || s.indexOf('MAYOR') >= 0) return '#E67E22';
        if (s.indexOf('BAJO') >= 0 || s.indexOf('MENOR') >= 0) return '#27AE60';
        return '#717D8A';
    }

    // Color genérico por estado/decisión -- heurística por regex, cubre los vocabularios
    // reales de estado que aparecen en TCs, NCRs, releases y VSR (PASS/FAIL/OBS, aprobado/
    // pendiente, cerrado/abierto, etc.). Mismo criterio de "aproximado y consistente" que
    // ya usa el PDF real en cada template (cada uno con su propia regex).
    function _estadoColor(v) {
        var s = String(v || '').toUpperCase();
        if (/PASS|APROB|CERR|CUMPL|VERIF|VALID/.test(s)) return '#27AE60';
        if (/FAIL|ABIERT|CRITIC|RECHAZ|NO\s*PASA|NO\s*APROB/.test(s)) return '#C0392B';
        if (/OBS|MEDIO|CURSO|APLIC|PEND/.test(s)) return '#E67E22';
        return '#717D8A';
    }

    function _badgeSpan(text, color) {
        return el('span', { className: 've-badge', text: text || '—', attrs: { style: 'color:' + color + ';border-color:' + color + ';' } });
    }

    function _emptyBanner(text) {
        return el('div', { className: 've-empty-banner', text: text });
    }

    // Tabla genérica: cols = [{key, label, width (relativo), render(row) -> string|Node}].
    // Si no hay filas, muestra el banner vacío en vez de "Sin filas." pelado.
    function _buildSmartTable(cols, rows, emptyText) {
        var wrap = el('div');
        if (!rows || !rows.length) {
            wrap.appendChild(_emptyBanner(emptyText || 'Sin datos.'));
            return wrap;
        }
        var tbl = el('table', { className: 've-tabla ve-tabla-smart' });
        var colgroup = document.createElement('colgroup');
        var totalW = cols.reduce(function (s, c) { return s + (c.width || 1); }, 0);
        cols.forEach(function (c) {
            var col = document.createElement('col');
            col.style.width = ((c.width || 1) * 100 / totalW) + '%';
            colgroup.appendChild(col);
        });
        tbl.appendChild(colgroup);
        var thead = el('thead'), headRow = el('tr');
        cols.forEach(function (c) { headRow.appendChild(el('th', { className: 've-th', text: c.label })); });
        thead.appendChild(headRow);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        rows.forEach(function (row) {
            var tr = el('tr');
            cols.forEach(function (c) {
                var td = el('td', { className: 've-td' });
                var content = c.render ? c.render(row) : row[c.key];
                if (content instanceof Node) td.appendChild(content);
                else td.textContent = (content === null || content === undefined) ? '' : String(content);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.appendChild(el('div', { className: 've-tabla-wrap' }, [tbl]));
        return wrap;
    }

    // Grilla de KPIs (N celdas iguales con valor grande + etiqueta chica) -- reusada por
    // resúmenes ejecutivos, cierre de NCR, hallazgos VSR. items = [{label, value, color?}].
    function _kpiGrid(items) {
        var grid = el('div', { className: 've-kpi-grid' });
        items.forEach(function (it) {
            var cell = el('div', { className: 've-kpi-cell' });
            cell.appendChild(el('div', {
                className: 've-kpi-value', text: String(it.value == null ? '—' : it.value),
                attrs: it.color ? { style: 'color:' + it.color + ';' } : {}
            }));
            cell.appendChild(el('div', { className: 've-kpi-label', text: it.label }));
            grid.appendChild(cell);
        });
        return grid;
    }

    function _readOnlyNote(body) {
        body.appendChild(el('div', { className: 've-smart-note', text: 'Vista de solo lectura — editá en modo JSON para modificar esta sección.' }));
    }

    // ──────────────────────────────────────────────────────────────────
    // matriz-tc -- IIQ, IOQ, IPQ, PIQ, POQ, PPQ (6 tipos de documento).
    // Columnas variables por columnasVisibles[]; sin eso, el set legado. Registro de
    // columnas conocidas con ancho relativo, mismo criterio que el registro real
    // (_iq-shared.js buildColumnRegistry) pero sin necesitar ese módulo acá.
    // ──────────────────────────────────────────────────────────────────
    var _MATRIZ_TC_REGISTRY = {
        tcId:           { label: 'TC-ID', width: 7 },
        titulo:         { label: 'Título', width: 22 },
        componente:     { label: 'Componente', width: 12 },
        grupo:          { label: 'Grupo', width: 12 },
        tipoTC:         { label: 'Tipo', width: 8 },
        raScore:        { label: 'RA', width: 8, render: function (tc) {
            if (tc.raScore == null && !tc.nivel) return '';
            var box = el('span');
            box.appendChild(el('span', { text: tc.raScore != null ? String(tc.raScore) : '', attrs: { style: 'font-weight:700;display:block;' } }));
            if (tc.nivel) box.appendChild(_badgeSpan(tc.nivel, _nivelColor(tc.nivel)));
            return box;
        } },
        ursVinculados:  { label: 'URS', width: 12, render: function (tc) { return Array.isArray(tc.ursVinculados) ? tc.ursVinculados.join(', ') : (tc.ursVinculados || ''); } },
        raVinculado:    { label: 'RA Ref.', width: 8 },
        profundidad:    { label: 'Profundidad', width: 10 },
        estado:         { label: 'Estado', width: 8, render: function (tc) { return tc.estado ? _badgeSpan(tc.estado, _estadoColor(tc.estado)) : ''; } },
        ejecutor:       { label: 'Ejecutor', width: 12 },
        fechaEjecucion: { label: 'Fecha', width: 8 },
        evidenciasCount:{ label: 'Evid.', width: 6 },
    };
    var _MATRIZ_TC_DEFAULT_COLS = ['tcId', 'titulo', 'componente', 'raScore', 'ursVinculados', 'profundidad', 'estado'];

    function renderMatrizTcBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var keys = Array.isArray(sec.columnasVisibles) && sec.columnasVisibles.length
            ? sec.columnasVisibles.filter(function (k) { return _MATRIZ_TC_REGISTRY[k]; })
            : _MATRIZ_TC_DEFAULT_COLS;
        var cols = keys.map(function (k) { return Object.assign({ key: k }, _MATRIZ_TC_REGISTRY[k]); });
        body.appendChild(_buildSmartTable(cols, sec.tcs, 'Sin test cases en esta matriz.'));
        _readOnlyNote(body);
    }

    // ──────────────────────────────────────────────────────────────────
    // release-* -- RIQ, ROQ, RPQ (y release-resumen-ejecutivo también en VSR).
    // ──────────────────────────────────────────────────────────────────
    function renderReleasePortadaDecisionBody(sec, body) {
        var color = _estadoColor(sec.decision);
        var box = el('div', { className: 've-decision-banner', attrs: { style: 'background:' + color + ';' } });
        box.appendChild(el('div', { className: 've-decision-label', text: 'DECISIÓN DE LIBERACIÓN' }));
        box.appendChild(el('div', { className: 've-decision-text', text: sec.decision || '—' }));
        if (sec.subtitulo) box.appendChild(el('div', { className: 've-decision-sub', text: sec.subtitulo }));
        body.appendChild(box);
        _readOnlyNote(body);
    }

    function renderReleaseResumenEjecutivoBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var k = sec.kpis || {};
        var fila1 = [
            ['TCs Ejecutados', k.totalTcsEjecutados], ['PASS', k.pass, '#27AE60'], ['FAIL', k.fail, '#C0392B'],
            ['OBS', k.obs, '#E67E22'], ['N/A', k.na], ['Cobertura', k.cobertura != null ? k.cobertura + '%' : null],
        ].filter(function (r) { return r[1] != null; }).map(function (r) { return { label: r[0], value: r[1], color: r[2] }; });
        if (fila1.length) body.appendChild(_kpiGrid(fila1));
        var fila2 = [
            ['Negativos', k.negativos], ['Negativos FAIL', k.negativosFail, k.negativosFail ? '#C0392B' : null],
            ['Críticas abiertas', k.criticasAbiertas, k.criticasAbiertas ? '#C0392B' : '#27AE60'],
            ['Estado global', k.estadoGlobal, k.estadoGlobal ? _estadoColor(k.estadoGlobal) : null],
            ['Hallazgos', k.hallazgosTotal], ['Hallazgos cerrados', k.hallazgosCerrados],
            ['Hallazgos abiertos', k.hallazgosAbiertos, k.hallazgosAbiertos ? '#C0392B' : '#27AE60'],
        ].filter(function (r) { return r[1] != null; }).map(function (r) { return { label: r[0], value: r[1], color: r[2] }; });
        if (fila2.length) body.appendChild(_kpiGrid(fila2));
        if (sec.fundamento) body.appendChild(el('div', { className: 've-smart-intro', text: sec.fundamento, attrs: { style: 'margin-top:10px;' } }));
        _readOnlyNote(body);
    }

    // Compartida con vsr-inventario-paquete -- mismo shape {documentos:[{codigo,tipo,version,estado,observacion}]}.
    function _renderDocumentosTable(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var cols = [
            { key: 'codigo', label: 'Código', width: 20 },
            { key: 'tipo', label: 'Tipo', width: 10 },
            { key: 'version', label: 'Versión', width: 8 },
            { key: 'estado', label: 'Estado', width: 12, render: function (d) { return d.estado ? _badgeSpan(d.estado, _estadoColor(d.estado)) : ''; } },
            { key: 'observacion', label: 'Observación', width: 30 },
        ];
        body.appendChild(_buildSmartTable(cols, sec.documentos, 'Sin documentos.'));
        _readOnlyNote(body);
    }
    function renderReleaseTrazabilidadCierreBody(sec, body) { _renderDocumentosTable(sec, body); }
    function renderVsrInventarioPaqueteBody(sec, body) { _renderDocumentosTable(sec, body); }

    function renderReleaseCondicionantesBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var cond = sec.condicionantes;
        if (!Array.isArray(cond) || !cond.length) {
            body.appendChild(_emptyBanner('Sin condicionantes.'));
        } else {
            var cols = [
                { key: 'descripcion', label: 'Condicionante', width: 40 },
                { key: 'responsable', label: 'Responsable', width: 20 },
                { key: 'plazo', label: 'Plazo', width: 15 },
                { key: 'estado', label: 'Estado', width: 15, render: function (c) { return c.estado ? _badgeSpan(c.estado, _estadoColor(c.estado)) : ''; } },
            ];
            body.appendChild(_buildSmartTable(cols, cond));
        }
        _readOnlyNote(body);
    }

    function renderReleaseDecisionFormalBody(sec, body) {
        var color = _estadoColor(sec.decision);
        var box = el('div', { className: 've-decision-box', attrs: { style: 'border-color:' + color + ';color:' + color + ';' } });
        box.appendChild(el('div', { className: 've-decision-label', text: 'DECISIÓN FORMAL' }));
        box.appendChild(el('div', { className: 've-decision-text', text: sec.decision || '—' }));
        body.appendChild(box);
        if (sec.textoFormal) body.appendChild(el('div', { className: 've-smart-intro', text: sec.textoFormal, attrs: { style: 'margin-top:10px;' } }));
        _readOnlyNote(body);
    }

    // ──────────────────────────────────────────────────────────────────
    // ncr-* -- NCR (único tipo de documento, 5 tipos de sección propios).
    // Las 4 secciones "gateadas" (registro/analisis/capa/cierre) comparten el mismo
    // envoltorio {estado, firmasRequeridas, firmas} y la misma tabla de firmas al pie.
    // ──────────────────────────────────────────────────────────────────
    function _buildFirmasTable(sec) {
        var req = Array.isArray(sec.firmasRequeridas) ? sec.firmasRequeridas : [];
        var firmas = Array.isArray(sec.firmas) ? sec.firmas : [];
        var rows = req.length ? req.map(function (r) {
            var f = firmas.filter(function (x) { return x.rol === r.rol; })[0];
            return {
                rol: r.rol, obligatoria: r.obligatoria ? 'Sí' : 'No',
                nombre: f ? f.nombre : '', firma: f ? (f.iniciales || (f._signedAt ? '✓' : '')) : '',
                fecha: f ? f.fecha : '',
            };
        }) : firmas.map(function (f) { return { rol: f.rol, obligatoria: '', nombre: f.nombre, firma: f.iniciales || '', fecha: f.fecha }; });
        if (!rows.length) return el('div');
        var cols = [
            { key: 'rol', label: 'Rol', width: 26 }, { key: 'obligatoria', label: 'Obligatoria', width: 12 },
            { key: 'nombre', label: 'Nombre', width: 24 }, { key: 'firma', label: 'Firma', width: 12 }, { key: 'fecha', label: 'Fecha', width: 12 },
        ];
        var out = el('div', { attrs: { style: 'margin-top:12px;' } });
        out.appendChild(el('div', { className: 've-escala-titulo', text: 'Firmas' }));
        out.appendChild(_buildSmartTable(cols, rows));
        return out;
    }

    function _ncrEstadoBadge(sec, body) {
        if (sec.estado) body.appendChild(_badgeSpan(sec.estado, _estadoColor(sec.estado)));
    }

    function renderNcrWorkflowIndicatorBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        body.appendChild(el('div', {
            className: 've-smart-note',
            text: 'El indicador de flujo (Registro → Análisis → CAPA → Cierre) se calcula automáticamente en el PDF a partir del estado de las otras secciones NCR de este documento.'
        }));
    }

    function renderNcrRegistroHallazgosBody(sec, body) {
        _ncrEstadoBadge(sec, body);
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var cols = [
            { key: 'id', label: 'NC-ID', width: 8 }, { key: 'tipo', label: 'Tipo', width: 10 },
            { key: 'criticidad', label: 'Criticidad', width: 10, render: function (h) { return h.criticidad ? _badgeSpan(h.criticidad, _nivelColor(h.criticidad)) : ''; } },
            { key: 'tcRef', label: 'TC Ref.', width: 10 }, { key: 'docOrigen', label: 'Doc Origen', width: 12 },
            { key: 'descripcion', label: 'Descripción', width: 38 }, { key: 'fechaApertura', label: 'F. Apertura', width: 12 },
        ];
        body.appendChild(_buildSmartTable(cols, sec.hallazgos, 'Sin hallazgos registrados.'));
        body.appendChild(_buildFirmasTable(sec));
        _readOnlyNote(body);
    }

    function renderNcrAnalisisCausaBody(sec, body) {
        _ncrEstadoBadge(sec, body);
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var items = Array.isArray(sec.analisis) ? sec.analisis : [];
        if (!items.length) body.appendChild(_emptyBanner('Sin análisis de causa cargado.'));
        items.forEach(function (a) {
            var card = el('div', { className: 've-ncr-card' });
            card.appendChild(el('div', { className: 've-ncr-card-title', text: (a.ncId || '') + ' · ' + (a.tipoAnalisis || '') }));
            if (Array.isArray(a.porques) && a.porques.length) {
                var ol = el('ol', { className: 've-escala-items' });
                a.porques.forEach(function (p, i) {
                    var li = el('li', { text: p });
                    if (i === a.porques.length - 1) li.setAttribute('style', 'font-weight:700;color:var(--vsc-azul);');
                    ol.appendChild(li);
                });
                card.appendChild(ol);
            }
            if (a.causaRaizIdentificada) card.appendChild(el('div', { className: 've-smart-intro', text: a.causaRaizIdentificada }));
            var flags = [];
            if (a.factorSistemico != null) flags.push(['Factor sistémico', a.factorSistemico, true]);
            if (a.recurrente != null) flags.push(['Recurrente', a.recurrente, true]);
            if (a.impactoScope) flags.push(['Alcance de impacto', a.impactoScope, false]);
            if (flags.length) {
                var flagsRow = el('div', { className: 've-ncr-flags' });
                flags.forEach(function (f) {
                    var text = f[2] ? (f[0] + ': ' + (f[1] ? 'Sí' : 'No')) : (f[0] + ': ' + f[1]);
                    var color = f[2] ? (f[1] ? '#C0392B' : '#27AE60') : '#717D8A';
                    flagsRow.appendChild(_badgeSpan(text, color));
                });
                card.appendChild(flagsRow);
            }
            body.appendChild(card);
        });
        body.appendChild(_buildFirmasTable(sec));
        _readOnlyNote(body);
    }

    function renderNcrPlanCapaBody(sec, body) {
        _ncrEstadoBadge(sec, body);
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var items = Array.isArray(sec.capas) ? sec.capas : [];
        if (!items.length) body.appendChild(_emptyBanner('Sin plan CAPA cargado.'));
        var FIELDS = [['accionCorrectiva', 'Acción Correctiva'], ['accionPreventiva', 'Acción Preventiva'], ['responsable', 'Responsable'],
            ['fechaCompromiso', 'F. Compromiso'], ['fechaCierre', 'F. Cierre'], ['evidenciaCierre', 'Evidencia de cierre'], ['verificadoPor', 'Verificado por']];
        items.forEach(function (c) {
            var card = el('div', { className: 've-ncr-card' });
            var head = el('div', { className: 've-ncr-card-title', text: (c.ncId || '') + ' ' });
            if (c.estadoCapa) head.appendChild(_badgeSpan(c.estadoCapa, _estadoColor(c.estadoCapa)));
            card.appendChild(head);
            FIELDS.forEach(function (f) {
                var v = c[f[0]];
                if (!v) return;
                card.appendChild(el('div', { className: 've-smart-kv' }, [
                    el('span', { className: 've-smart-key', text: f[1] + ':' }),
                    el('span', { className: 've-smart-val', text: String(v) }),
                ]));
            });
            body.appendChild(card);
        });
        body.appendChild(_buildFirmasTable(sec));
        _readOnlyNote(body);
    }

    function renderNcrCierreAprobacionBody(sec, body) {
        _ncrEstadoBadge(sec, body);
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var r = sec.resumen || {};
        var items = [
            ['Total NCs', r.totalNcs], ['NCs Cerradas', r.ncCerradas, '#27AE60'], ['NCs Abiertas', r.ncAbiertas, r.ncAbiertas ? '#C0392B' : '#27AE60'],
            ['NCs Críticas', r.ncCriticas], ['Críticas cerradas', r.criticasCerradas], ['Días prom. cierre', r.diasPromedioCierre],
        ].filter(function (x) { return x[1] != null; }).map(function (x) { return { label: x[0], value: x[1], color: x[2] }; });
        if (items.length) body.appendChild(_kpiGrid(items));
        if (r.factorSistemico != null) {
            body.appendChild(_badgeSpan('Factor sistémico: ' + (r.factorSistemico ? 'Sí' : 'No'), r.factorSistemico ? '#E67E22' : '#27AE60'));
        }
        if (r.decisionFinal) {
            var color = _estadoColor(r.decisionFinal);
            var box = el('div', { className: 've-decision-box', attrs: { style: 'border-color:' + color + ';color:' + color + ';margin-top:10px;' } });
            box.appendChild(el('div', { className: 've-decision-label', text: 'DECISIÓN FINAL' }));
            box.appendChild(el('div', { className: 've-decision-text', text: r.decisionFinal }));
            body.appendChild(box);
        }
        body.appendChild(_buildFirmasTable(sec));
        _readOnlyNote(body);
    }

    // ──────────────────────────────────────────────────────────────────
    // hallazgos-consolidados / resumen-ejecucion-{iq,oq,pq} -- IIQ, IOQ, IPQ.
    // En documentos reales suelen venir vacíos: el PDF los recalcula automáticamente
    // desde la matriz de test cases del documento al generarse -- se avisa eso en vez
    // de decir "sin hallazgos" como si fuera un hecho, que sería engañoso.
    // ──────────────────────────────────────────────────────────────────
    function renderHallazgosConsolidadosBody(sec, body) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var flat = [];
        (Array.isArray(sec.tcs) ? sec.tcs : []).forEach(function (tc) {
            (Array.isArray(tc.hallazgos) ? tc.hallazgos : []).forEach(function (h) {
                flat.push({ id: h.id, severidad: h.severidad, tcTitulo: tc.titulo || h.tcRef, descripcion: h.descripcion, accion: h.accion });
            });
        });
        if (!flat.length) {
            body.appendChild(_emptyBanner('Sin hallazgos cargados acá directamente -- si el documento no trae hallazgos propios, el PDF los recolecta automáticamente desde la matriz de test cases al generarse.'));
        } else {
            var cols = [
                { key: 'id', label: 'NC-ID', width: 8 },
                { key: 'severidad', label: 'Severidad', width: 10, render: function (h) { return h.severidad ? _badgeSpan(h.severidad, _nivelColor(h.severidad)) : ''; } },
                { key: 'tcTitulo', label: 'TC Asociado', width: 20 }, { key: 'descripcion', label: 'Descripción', width: 38 }, { key: 'accion', label: 'Acción', width: 24 },
            ];
            body.appendChild(_buildSmartTable(cols, flat));
        }
        _readOnlyNote(body);
    }

    function _renderResumenEjecucionBody(sec, body, fase) {
        if (sec.intro) body.appendChild(el('div', { className: 've-smart-intro', text: sec.intro }));
        var tcs = Array.isArray(sec.tcs) ? sec.tcs : [];
        if (!tcs.length) {
            body.appendChild(_emptyBanner('Sin datos de ejecución cargados acá -- el PDF calcula este resumen automáticamente a partir de la matriz de test cases del documento.'));
            _readOnlyNote(body);
            return;
        }
        var grupos = {};
        tcs.forEach(function (tc) {
            var g = tc.grupo || 'Sin grupo';
            grupos[g] = grupos[g] || { total: 0, PASS: 0, FAIL: 0, OBS: 0, NA: 0 };
            grupos[g].total++;
            var e = String(tc.estado || '').toUpperCase();
            if (/PASS/.test(e)) grupos[g].PASS++;
            else if (/FAIL/.test(e)) grupos[g].FAIL++;
            else if (/OBS/.test(e)) grupos[g].OBS++;
            else grupos[g].NA++;
        });
        var rows = Object.keys(grupos).map(function (g) { return Object.assign({ grupo: g }, grupos[g]); });
        var tot = rows.reduce(function (a, r) { a.total += r.total; a.PASS += r.PASS; a.FAIL += r.FAIL; a.OBS += r.OBS; a.NA += r.NA; return a; },
            { grupo: 'TOTAL', total: 0, PASS: 0, FAIL: 0, OBS: 0, NA: 0 });
        rows.push(tot);
        var cols = [
            { key: 'grupo', label: 'Grupo', width: 30 }, { key: 'total', label: 'Total', width: 10 },
            { key: 'PASS', label: 'PASS', width: 12 }, { key: 'FAIL', label: 'FAIL', width: 12 },
            { key: 'OBS', label: 'OBS', width: 12 }, { key: 'NA', label: 'N/A', width: 12 },
        ];
        body.appendChild(_buildSmartTable(cols, rows));
        var estado = tot.FAIL > 0 ? (fase + ' NO APROBADA') : (tot.OBS > 0 ? (fase + ' APROBADA CON OBSERVACIONES') : (fase + ' APROBADA'));
        var color = tot.FAIL > 0 ? '#C0392B' : (tot.OBS > 0 ? '#E67E22' : '#27AE60');
        var box = el('div', { className: 've-decision-box', attrs: { style: 'border-color:' + color + ';color:' + color + ';margin-top:10px;' } });
        box.appendChild(el('div', { className: 've-decision-text', text: estado }));
        body.appendChild(box);
        _readOnlyNote(body);
    }
    function renderResumenEjecucionIqBody(sec, body) { _renderResumenEjecucionBody(sec, body, 'IQ'); }
    function renderResumenEjecucionOqBody(sec, body) { _renderResumenEjecucionBody(sec, body, 'OQ'); }
    function renderResumenEjecucionPqBody(sec, body) { _renderResumenEjecucionBody(sec, body, 'PQ'); }

    // Tarjeta de GAP editable (tarjeta-gap y tarjeta-gap-rrm)
    function renderTarjetaGapBody(sec, body) {
        var FIELDS = sec.tipo === 'tarjeta-gap-rrm'
            ? [['id','ID'],['norma','Norma'],['requisito','Requisito'],['descripcion','Descripción'],
               ['impacto','Impacto'],['severidad','Severidad'],['accion','Acción recomendada'],
               ['controlesCompensatorios','Controles compensatorios'],['ursAfectados','URS afectados']]
            : [['id','ID'],['norma','Norma'],['descripcion','Descripción'],['severidad','Severidad'],
               ['severidadLabel','Nivel severidad'],['impacto','Impacto'],['control','Control compensatorio'],
               ['aceptacion','Aceptación']];
        var form = el('div', { className: 've-tarjeta-gap-form' });
        FIELDS.forEach(function(pair) {
            var key = pair[0], label = pair[1];
            var val = sec[key] != null ? String(sec[key]) : '';
            var row = el('div', { className: 've-gap-row' });
            row.appendChild(el('label', { className: 've-gap-label', text: label }));
            row.appendChild(el('input', { className: 've-gap-input', attrs: { type: 'text', value: val, placeholder: label + '…' }, dataset: { gapField: key } }));
            form.appendChild(row);
        });
        body.appendChild(form);
    }

    // Smart fallback: muestra todos los campos del JSON en forma legible (solo lectura)
    function renderSmartFallbackBody(sec, body) {
        var SKIP = new Set(['tipo', 'titulo', 'numero']);
        var hasContent = false;
        // intro primero si existe
        if (sec.intro) {
            body.appendChild(el('div', { className: 've-bloque-texto ve-smart-intro', text: sec.intro }));
            hasContent = true;
        }
        Object.keys(sec).forEach(function(k) {
            if (SKIP.has(k) || k === 'intro') return;
            var v = sec[k];
            if (v === null || v === undefined || v === '') return;
            hasContent = true;
            if (typeof v === 'string') {
                var row = el('div', { className: 've-smart-kv' });
                row.appendChild(el('span', { className: 've-smart-key', text: k + ':' }));
                row.appendChild(el('span', { className: 've-smart-val', text: v }));
                body.appendChild(row);
            } else if (typeof v === 'number' || typeof v === 'boolean') {
                var row2 = el('div', { className: 've-smart-kv' });
                row2.appendChild(el('span', { className: 've-smart-key', text: k + ':' }));
                row2.appendChild(el('span', { className: 've-smart-val', text: String(v) }));
                body.appendChild(row2);
            } else if (Array.isArray(v)) {
                var badge = el('div', { className: 've-smart-array-badge' });
                badge.innerHTML = '<strong>' + k + '</strong> <span class="ve-smart-count">' + v.length + ' elemento(s)</span>';
                body.appendChild(badge);
                // Previsualizar hasta 3 items
                var preview = v.slice(0, 3);
                preview.forEach(function(item) {
                    var line = el('div', { className: 've-smart-array-item' });
                    line.textContent = typeof item === 'object' ? JSON.stringify(item).slice(0, 120) : String(item).slice(0, 120);
                    body.appendChild(line);
                });
                if (v.length > 3) {
                    body.appendChild(el('div', { className: 've-smart-more', text: '… y ' + (v.length - 3) + ' más' }));
                }
            } else if (typeof v === 'object') {
                var objBadge = el('div', { className: 've-smart-kv' });
                objBadge.appendChild(el('span', { className: 've-smart-key', text: k + ':' }));
                objBadge.appendChild(el('span', { className: 've-smart-val', text: JSON.stringify(v).slice(0, 150) }));
                body.appendChild(objBadge);
            }
        });
        if (!hasContent) {
            body.appendChild(el('div', { className: 've-smart-empty', text: 'Sección sin contenido editable en este modo. Usá el modo JSON.' }));
        }
        body.appendChild(el('div', { className: 've-smart-note', text: 'Vista de solo lectura — editá en modo JSON para modificar esta sección.' }));
    }

    // ──────────────────────────────────────────────────────────────────
    // SERIALIZERS (HTML → JSON)
    // ──────────────────────────────────────────────────────────────────

    function serializeHeader(data, container) {
        const titleEl = container.querySelector('.ve-doc-title');
        if (titleEl) {
            data.document = data.document || {};
            data.document.titleEs = readEditableText(titleEl);
        }
        container.querySelectorAll('.ve-field-input').forEach(inp => {
            const field = inp.dataset.field;
            if (!field) return;
            const [parent, key] = field.split('.');
            data[parent] = data[parent] || {};
            data[parent][key] = inp.value;
        });
        // Extras
        const extrasList = container.querySelector('.ve-extras-list');
        if (extrasList) {
            const extras = {};
            extrasList.querySelectorAll('.ve-extra-row').forEach(row => {
                const k = (row.querySelector('.ve-extra-key') || {}).value || '';
                const v = (row.querySelector('.ve-extra-value') || {}).value || '';
                if (k.trim()) extras[k.trim()] = v;
            });
            data.document = data.document || {};
            data.document.extras = extras;
        }
        // Control de versiones
        const ccBlock = container.querySelector('[data-header-block="controlCambios"]');
        if (ccBlock) {
            const rows = [];
            ccBlock.querySelectorAll('[data-collection="cc-rows"] > tr').forEach(tr => {
                const obj = {};
                tr.querySelectorAll('td[data-cc-field]').forEach(td => { obj[td.dataset.ccField] = readEditableMultiline(td); });
                if (Object.values(obj).some(v => v)) rows.push(obj);
            });
            data.controlCambios = rows;
        }
        // Matriz de aprobaciones
        const maBlock = container.querySelector('[data-header-block="matrizAprobaciones"]');
        if (maBlock) {
            const rows = [];
            maBlock.querySelectorAll('[data-collection="ma-rows"] > tr').forEach(tr => {
                const obj = {};
                tr.querySelectorAll('td[data-ma-field]').forEach(td => { obj[td.dataset.maField] = readEditableMultiline(td); });
                // Restaurar campos de firma si los tenía
                if (tr._signatureFields) {
                    Object.assign(obj, tr._signatureFields);
                }
                if (Object.values(obj).some(v => v)) rows.push(obj);
            });
            data.matrizAprobaciones = rows;
        }
    }

    function serializeSection(secEl) {
        const tipo = secEl.dataset.sectionType;
        // Empezamos de la copia original (asegura que campos no editables se preserven)
        const out = secEl._rawSection ? JSON.parse(JSON.stringify(secEl._rawSection)) : { tipo };

        // Título común
        const titEl = secEl.querySelector(':scope > .ve-section-title');
        if (titEl) out.titulo = readEditableText(titEl);

        switch (tipo) {
            case 'texto':                    serializeTextoBody(out, secEl); break;
            case 'lista-incluido-excluido':  serializeListaBody(out, secEl); break;
            case 'tabla':                    serializeTablaBody(out, secEl); break;
            case 'tabla-info':               serializeTablaInfoBody(out, secEl); break;
            case 'subseccion':               serializeSubseccionBody(out, secEl); break;
            case 'caja-nota':
            case 'caja-justificacion':
            case 'caja-criterio':            serializeCajaBody(out, secEl); break;
            case 'arbol-decision-gamp':      serializeArbolGampBody(out, secEl); break;
            case 'caja-resultado':           serializeCajaResultadoBody(out, secEl); break;
            case 'tabla-docs-aplicables':    serializeTablaDocsBody(out, secEl); break;
            case 'caja-conclusion':          serializeCajaBody(out, secEl); break;
            case 'tarjeta-gap':
            case 'tarjeta-gap-rrm':          serializeTarjetaGapBody(out, secEl); break;
            case 'tabla-firmas-final':        serializeTablaFirmasFinalBody(out, secEl); break;
            case 'tabla-test-case':           serializeTablaTCBody(out, secEl); break;
            case 'vsr-decision-final':
            case 'vsr-portada-final':         serializeVsrDecisionBody(out, secEl); break;
            // tabla-fmea, tabla-norma, etc.: solo lectura — _rawSection preserva los datos
            default: /* fallback: dejamos out tal como vino de _rawSection */ break;
        }
        return out;
    }

    function serializeTextoBody(out, secEl) {
        const bloquesEl = secEl.querySelector('[data-collection="bloques"]');
        if (!bloquesEl) return;
        const bloques = [];
        bloquesEl.querySelectorAll(':scope > .ve-bloque').forEach(bEl => {
            const sub = readEditableText(bEl.querySelector('.ve-bloque-subtitulo'));
            const tex = readEditableMultiline(bEl.querySelector('.ve-bloque-texto'));
            const bullets = [];
            const ul = bEl.querySelector('.ve-bullets');
            if (ul) {
                ul.querySelectorAll(':scope > .ve-bullet').forEach(li => {
                    const t = readEditableText(li.querySelector('.ve-bullet-text'));
                    if (t) bullets.push(t);
                });
            }
            const obj = {};
            if (sub) obj.subtitulo = sub;
            if (tex) obj.texto = tex;
            if (bullets.length) obj.bullets = bullets;
            if (Object.keys(obj).length) bloques.push(obj);
        });
        out.bloques = bloques;
        // Si había un campo legacy "contenido" o "texto" suelto, lo limpiamos
        delete out.contenido;
        delete out.texto;
    }

    function serializeListaBody(out, secEl) {
        secEl.querySelectorAll('.ve-lista-block').forEach(block => {
            const key = block.dataset.listaKey;       // incluido / excluido
            const subKey = block.dataset.listaSubKey; // subIncluido / subExcluido
            const subtit = readEditableText(block.querySelector('.ve-lista-subtitulo'));
            const items = [];
            block.querySelectorAll(':scope > .ve-bullets > .ve-bullet').forEach(li => {
                const t = readEditableText(li.querySelector('.ve-bullet-text'));
                if (t) items.push(t);
            });
            out[key] = items;
            if (subtit) out[subKey] = subtit; else delete out[subKey];
        });
    }

    function serializeTablaBody(out, secEl) {
        const tbl = secEl.querySelector('.ve-tabla');
        if (!tbl) return;
        const cols = [];
        tbl.querySelectorAll('thead > tr > th:not(.ve-th-actions)').forEach(th => {
            cols.push(readEditableText(th));
        });
        const filas = [];
        tbl.querySelectorAll('tbody > tr').forEach(tr => {
            // Fila de agrupación: se reemite con su forma original ({subheader, …}),
            // conservando cualquier propiedad extra que traía, y actualizando el texto
            // si el usuario lo editó. NO se renombra la clave: los renderers actuales
            // (shared-renderers.js:362) leen `subheader`, cambiarla sería una migración.
            if (tr.dataset.filaKind === 'subheader') {
                const td = tr.querySelector('td.ve-td-subheader');
                const base = (tr._rawFila && typeof tr._rawFila === 'object') ? tr._rawFila : {};
                filas.push(Object.assign({}, base, { subheader: readEditableMultiline(td) }));
                return;
            }

            const celdas = [];
            tr.querySelectorAll('td:not(.ve-td-actions)').forEach(td => {
                const raw = td._rawCell;
                const kind = td.dataset.cellKind;

                // Opaca: se devuelve intacta. Fabricarle un `text` con su propio JSON la
                // corrompería igual que el bug original.
                if (kind === 'opaca') { celdas.push(raw); return; }

                const texto = readEditableMultiline(td);
                if (kind === 'text')      { celdas.push(Object.assign({}, raw, { text: texto })); return; }
                if (kind === 'contenido') { celdas.push(Object.assign({}, raw, { contenido: texto })); return; }

                // Primitivo no-string (0, false): si el usuario no lo tocó, se devuelve con
                // su tipo original en vez de convertirlo en string (o peor, en '').
                if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'object') {
                    if (texto === String(raw)) { celdas.push(raw); return; }
                }
                if (raw === null && texto === '') { celdas.push(null); return; }
                celdas.push(texto);
            });

            // Fila que venía como objeto {columna: valor}: se reemite como objeto,
            // no se aplana a array (aplanarla cambia la forma que leen los extractores).
            if (tr.dataset.filaKind === 'objeto') {
                const base = (tr._rawFila && typeof tr._rawFila === 'object') ? tr._rawFila : {};
                const obj = Object.assign({}, base);
                cols.forEach((c, i) => { if (i < celdas.length) obj[c] = celdas[i]; });
                filas.push(obj);
                return;
            }

            filas.push(celdas);
        });
        // No inyectar `columnas` si la sección no la tenía (caso noHeader): agregar una
        // clave ausente ensucia el round-trip aunque el renderer la ignore.
        if (cols.length > 0 || Object.prototype.hasOwnProperty.call(out, 'columnas')) {
            out.columnas = cols;
        }
        out.filas = filas;
    }

    function serializeTablaInfoBody(out, secEl) {
        const list = secEl.querySelector('[data-collection="campos"]');
        if (!list) return;
        const filas = [];
        list.querySelectorAll(':scope > .ve-info-row').forEach(row => {
            const campo = (row.querySelector('.ve-info-key') || {}).value || '';
            const valor = (row.querySelector('.ve-info-value') || {}).value || '';
            if (campo.trim() || valor.trim()) filas.push({ campo, valor });
        });
        out.filas = filas;
        delete out.campos; // eliminar key legacy si existía
    }

    function serializeArbolGampBody(out, secEl) {
        const introEl = secEl.querySelector('[data-field="intro"]');
        if (introEl) out.intro = readEditableMultiline(introEl);
        const list = secEl.querySelector('[data-collection="preguntas"]');
        if (!list) return;
        const preguntas = [];
        list.querySelectorAll(':scope > .ve-pregunta-row').forEach(row => {
            const pregunta = (row.querySelector('.ve-pregunta-q') || {}).value || '';
            const respuesta = (row.querySelector('.ve-pregunta-r') || {}).value || '';
            if (pregunta.trim() || respuesta.trim()) preguntas.push({ pregunta, respuesta });
        });
        out.preguntas = preguntas;
    }

    function serializeCajaResultadoBody(out, secEl) {
        const inp = secEl.querySelector('[data-field="subtitulo"]');
        if (inp) out.subtitulo = inp.value;
    }

    function serializeTablaFirmasFinalBody(out, secEl) {
        const introEl = secEl.querySelector('[data-field="intro"]');
        if (introEl) out.intro = readEditableMultiline(introEl);
        const roles = [];
        secEl.querySelectorAll('.ve-role-input').forEach(function(inp) {
            if (inp.value.trim()) roles.push(inp.value.trim());
        });
        out.rolesPlaceholder = roles;
        // firmas y nota se preservan desde _rawSection
    }

    function serializeTarjetaGapBody(out, secEl) {
        secEl.querySelectorAll('.ve-gap-input').forEach(function(inp) {
            var key = inp.dataset.gapField;
            if (key) out[key] = inp.value;
        });
    }

    function serializeTablaDocsBody(out, secEl) {
        const introEl = secEl.querySelector('[data-field="intro"]');
        if (introEl) out.intro = readEditableMultiline(introEl);
        var COLS = ['documento', 'estado', 'aplicacion'];
        var filas = [];
        secEl.querySelectorAll('.ve-tabla-docs tbody > tr').forEach(function(tr) {
            var cells = Array.from(tr.querySelectorAll('td:not(.ve-td-actions)'));
            if (cells.length >= COLS.length) {
                var fila = {};
                COLS.forEach(function(c, i) { fila[c] = readEditableMultiline(cells[i]); });
                if (COLS.some(function(c) { return fila[c]; })) filas.push(fila);
            }
        });
        out.filas = filas;
    }

    function serializeSubseccionBody(out, secEl) {
        const intro = readEditableMultiline(secEl.querySelector('.ve-subseccion-intro'));
        if (intro) out.intro = intro;
        else delete out.intro;
    }

    function serializeCajaBody(out, secEl) {
        const list = secEl.querySelector('[data-collection="parrafos"]');
        if (!list) return;
        const parrafos = [];
        list.querySelectorAll(':scope > .ve-parrafo').forEach(row => {
            const t = readEditableMultiline(row.querySelector('.ve-parrafo-text'));
            if (t) parrafos.push(t);
        });
        out.parrafos = parrafos;
        delete out.contenido;
        delete out.texto;
    }

    // ──────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ──────────────────────────────────────────────────────────────────

    /** Deja el container montado en modo lectura: saca contenteditable y
     *  oculta los controles de edición/aprobación, sin tocar el HTML que
     *  ya armó render() (mismo marcado, mismo _rawSection para serialize). */
    function applyReadOnly(container) {
        container.classList.add('ve-readonly');
        container.querySelectorAll('[contenteditable]').forEach(function (node) {
            node.removeAttribute('contenteditable');
        });
        container.querySelectorAll('button').forEach(function (btn) {
            btn.style.display = 'none';
        });
    }

    /** Oculta solo la barra de "Aprobar sección" -- para hosts (Firmas) que tienen
     *  su propio flujo de aprobación/firma y no usan el de este editor. */
    function applyHideApproval(container) {
        container.querySelectorAll('.ve-section-approval-bar').forEach(function (bar) {
            bar.style.display = 'none';
        });
    }

    /** Renderiza data JSON como vista documento dentro de container.
     *  opts.readOnly: true → sin edición (para revisores).
     *  opts.hideApproval: true → sin barra de "Aprobar sección" (host con su propio flujo). */
    function render(data, container, opts) {
        opts = opts || {};
        container.innerHTML = '';
        if (!data || typeof data !== 'object') {
            container.appendChild(el('div', { className: 've-empty', text: 'No hay JSON cargado. Cargá un doc desde el dropdown de plantillas o el paquete.' }));
            return;
        }
        container.appendChild(renderHeader(data));
        const secs = el('div', { className: 've-sections' });
        (data.secciones || []).forEach((sec, idx) => {
            secs.appendChild(renderSection(sec, idx));
        });
        container.appendChild(secs);
        if (opts.readOnly) applyReadOnly(container);
        if (opts.hideApproval) applyHideApproval(container);
    }

    /** Reconstruye el objeto JSON desde el HTML editable.
     *  originalData se usa como base para preservar todo lo que el visual
     *  editor no representa (auth metadata, schemas custom, etc.). */
    function serialize(originalData, container) {
        const data = originalData ? JSON.parse(JSON.stringify(originalData)) : {};
        serializeHeader(data, container);
        const secs = [];
        container.querySelectorAll(':scope > .ve-sections > .ve-section').forEach(secEl => {
            secs.push(serializeSection(secEl));
        });
        data.secciones = secs;
        return data;
    }

    VS.visualEditor.render = render;
    VS.visualEditor.serialize = serialize;

})(window);
