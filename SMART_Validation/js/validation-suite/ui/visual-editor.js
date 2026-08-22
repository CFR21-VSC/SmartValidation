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
            case 'tabla-fmea':
            case 'tabla-norma':
            case 'tabla-trazabilidad':
            case 'tabla-componentes-ira':
            case 'tabla-alcance-piq':
            case 'aex-matriz-trazabilidad':  renderTablaConIntroBody(sec, body); break;
            // Tarjetas de gap editables
            case 'tarjeta-gap':
            case 'tarjeta-gap-rrm':          renderTarjetaGapBody(sec, body); break;
            case 'tabla-firmas-final':        renderTablaFirmasFinalBody(sec, body); break;
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
            Array.from(tbody.children).forEach(tr => {
                const newTd = el('td', { contentEditable: true, text: '', className: 've-td' });
                tr.insertBefore(newTd, tr.lastChild);
            });
        }));
    }

    function renderTablaFila(fila, cols) {
        const tr = el('tr');
        let arr;
        if (Array.isArray(fila)) {
            arr = fila;
        } else if (fila && typeof fila === 'object') {
            // Objeto con keys por columna
            arr = cols.map(c => fila[c] != null ? fila[c] : '');
        } else {
            arr = cols.map(() => '');
        }
        arr.forEach(cell => {
            const cellText = (cell && typeof cell === 'object')
                ? (cell.text || cell.contenido || JSON.stringify(cell))
                : (cell || '');
            tr.appendChild(el('td', { contentEditable: true, text: cellText, className: 've-td' }));
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
            const cells = [];
            tr.querySelectorAll('td:not(.ve-td-actions)').forEach(td => {
                cells.push(readEditableMultiline(td));
            });
            filas.push(cells);
        });
        out.columnas = cols;
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

    /** Renderiza data JSON como vista documento editable dentro de container. */
    function render(data, container) {
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
