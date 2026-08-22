/* ====================================================================
   PEOPLE UI — Modales y handlers para gestión de personas + firma con PIN
   Depende de window.PeopleManager.

   API expuesta:
     openPeopleManagerModal()
     openSignWithPinModal({ onSigned, rolSugerido, packageCode })
        → callback recibe el objeto firma listo para insertar.
   ==================================================================== */

(function (global) {
    'use strict';

    const PM = global.PeopleManager;
    if (!PM) {
        console.error('[people-ui] PeopleManager no esta cargado');
        return;
    }

    // ====================================================================
    // HELPERS DOM
    // ====================================================================
    function $(id) { return document.getElementById(id); }
    function show(el) { if (el) el.style.display = 'flex'; }
    function hide(el) { if (el) el.style.display = 'none'; }
    function setText(el, txt) { if (el) el.textContent = txt; }
    function notify(msg, type) {
        if (typeof global.showNotification === 'function') global.showNotification(msg, type);
        else if (type === 'error') alert(msg);
        else console.log('[people-ui]', msg);
    }

    // ====================================================================
    // MODAL: GESTIÓN DE PERSONAS DEL PAQUETE
    // ====================================================================
    function renderPeopleTable() {
        const code = PM.getPackageCode();
        const cont = $('pmTableBody');
        const empty = $('pmEmptyState');
        const codeBadge = $('pmPackageBadge');
        if (codeBadge) codeBadge.textContent = code || '— sin paquete activo —';

        if (!cont) return;
        if (!code) {
            cont.innerHTML = '';
            if (empty) { empty.style.display = 'block'; empty.textContent = 'Cargá un protocolo (PIQ/POQ/PPQ) o un paquete primero. Las personas viven dentro del paquete activo.'; }
            return;
        }

        const personas = PM.list(code);
        if (personas.length === 0) {
            cont.innerHTML = '';
            if (empty) { empty.style.display = 'block'; empty.textContent = 'No hay personas registradas. Agregá la primera con el botón "+ Nueva persona". La primera se marca automáticamente como user maestro.'; }
            return;
        }
        if (empty) empty.style.display = 'none';

        cont.innerHTML = personas.map((p, idx) => {
            const maestroBadge = p.esMaestro
                ? '<span style="background:#1F3C56;color:#FFF;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;">MAESTRO</span>'
                : '';
            const firmaCell = p.firmaImage
                ? `<img src="${p.firmaImage}" alt="firma" style="height:36px; max-width:90px; object-fit:contain; background:#FFF; border:1px solid #C8D2DC; border-radius:3px;" title="Click para regenerar" onclick="handleCaptureSignature('${p.id}')">`
                : `<button class="pm-action pm-action-attention" data-action="captureFirma" data-id="${p.id}" title="Capturar trazado de firma">✎ Capturar firma</button>`;
            return `
                <tr style="background:${idx % 2 === 1 ? '#F4F6F8' : '#FFF'};">
                    <td style="padding:8px;font-weight:600;">${escapeHtml(p.nombre)}</td>
                    <td style="padding:8px;text-align:center;font-weight:700;color:#1F3C56;">${escapeHtml(p.iniciales)}</td>
                    <td style="padding:8px;font-size:12px;color:#586574;">${escapeHtml(p.rol || '—')}</td>
                    <td style="padding:8px;text-align:center;">${firmaCell}</td>
                    <td style="padding:8px;text-align:center;">${maestroBadge}</td>
                    <td style="padding:8px;text-align:center;">
                        <button class="pm-action" data-action="changePin" data-id="${p.id}" title="Cambiar PIN propio">PIN</button>
                        ${!p.esMaestro ? `<button class="pm-action" data-action="resetPin" data-id="${p.id}" title="Reset por user maestro">Reset</button>` : ''}
                        <button class="pm-action" data-action="edit" data-id="${p.id}" title="Editar datos">Editar</button>
                        <button class="pm-action pm-danger" data-action="remove" data-id="${p.id}" title="Eliminar persona">×</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Bind acciones
        cont.querySelectorAll('.pm-action').forEach(btn => {
            btn.addEventListener('click', e => {
                const action = btn.getAttribute('data-action');
                const id = btn.getAttribute('data-id');
                if (action === 'remove') handleRemove(id);
                else if (action === 'changePin') handleChangePinSelf(id);
                else if (action === 'resetPin') handleResetPin(id);
                else if (action === 'edit') handleEdit(id);
                else if (action === 'captureFirma') handleCaptureSignature(id);
            });
        });
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    /**
     * Abre el modal visual de registro de firmante: form + canvas para garabatear
     * la firma con mouse/touch + opción de capturar desde celular.
     */
    function handleAddPersona() {
        const code = PM.getPackageCode();
        if (!code) { notify('Cargá un paquete primero', 'error'); return; }
        openRegistroFirmanteModal({ mode: 'new', packageCode: code });
    }

    /** Captura/regenera el trazado de firma de una persona ya registrada. */
    function handleCaptureSignature(personaId) {
        const code = PM.getPackageCode();
        if (!code) return;
        const p = PM.find(code, personaId);
        if (!p) return;
        openRegistroFirmanteModal({
            mode: 'signature-only',
            packageCode: code,
            personaId: personaId,
            existingFirma: p.firmaImage
        });
    }

    // ====================================================================
    // MODAL DE REGISTRO DE FIRMANTE (con canvas)
    // ====================================================================
    let _currentSignatureCanvas = null;

    function openRegistroFirmanteModal(opts) {
        opts = opts || {};
        const modal = $('modalRegistroFirmante');
        if (!modal) {
            notify('Modal de registro no presente en el DOM', 'error');
            return;
        }

        // Si el modal de People Manager está abierto, lo cerramos temporalmente
        // para que el de registro quede al frente (evita stacking visual). Se
        // reabre al cerrar/confirmar el de registro.
        const peopleModal = $('modalPeopleManager');
        if (peopleModal && peopleModal.style.display !== 'none') {
            peopleModal.style.display = 'none';
            modal._peopleManagerWasOpen = true;
        } else {
            modal._peopleManagerWasOpen = false;
        }
        const titleEl = $('rfTitle');
        const formBlock = $('rfFormBlock');
        const code = opts.packageCode || PM.getPackageCode();

        // Setup según modo
        if (opts.mode === 'signature-only' && opts.personaId) {
            const p = PM.find(code, opts.personaId);
            titleEl.textContent = 'Capturar firma — ' + p.nombre;
            formBlock.style.display = 'none';
        } else {
            titleEl.textContent = 'Registrar nuevo firmante';
            formBlock.style.display = 'block';
            // Reset form fields
            $('rfNombre').value = '';
            $('rfRol').value = '';
            $('rfIniciales').value = '';
            $('rfEmail').value = '';
            $('rfPin').value = '';
            $('rfPinConfirm').value = '';
        }
        $('rfError').style.display = 'none';
        $('rfError').textContent = '';

        // Setup canvas
        const canvas = $('rfCanvas');
        if (_currentSignatureCanvas) {
            try { _currentSignatureCanvas.detach(); } catch (e) {}
        }
        _currentSignatureCanvas = global.SignatureCanvas.attach(canvas, {
            color: '#1F3C56',
            lineWidth: 2.8
        });

        // Si es regenerar y hay firma previa, cargarla como base
        modal.style.display = 'flex';
        if (opts.mode === 'signature-only' && opts.existingFirma) {
            // Pequeño delay para que el canvas ya esté visible y tenga dimensiones
            setTimeout(() => {
                _currentSignatureCanvas.loadDataURL(opts.existingFirma).catch(() => {});
            }, 50);
        } else {
            setTimeout(() => _currentSignatureCanvas.clear(), 50);
        }

        // Stash mode + ids para usar en confirm
        modal._rfMode = opts.mode || 'new';
        modal._rfPersonaId = opts.personaId || null;
        modal._rfPackageCode = code;
        // Resetear mobile sync si estuviera activo
        cleanupMobileSignatureSync();
    }

    function closeRegistroFirmanteModal() {
        const modal = $('modalRegistroFirmante');
        if (!modal) return;
        modal.style.display = 'none';
        if (_currentSignatureCanvas) {
            try { _currentSignatureCanvas.detach(); } catch (e) {}
            _currentSignatureCanvas = null;
        }
        cleanupMobileSignatureSync();

        // Reabrir el modal de People Manager si estaba abierto antes
        if (modal._peopleManagerWasOpen) {
            modal._peopleManagerWasOpen = false;
            const peopleModal = $('modalPeopleManager');
            if (peopleModal) {
                peopleModal.style.display = 'flex';
                // Refrescar la tabla por si se agregó/editó un firmante
                if (typeof renderPeopleTable === 'function') {
                    try { renderPeopleTable(); } catch (e) {}
                }
            }
        }
    }

    function clearRegistroFirmanteCanvas() {
        if (_currentSignatureCanvas) _currentSignatureCanvas.clear();
    }

    async function confirmRegistroFirmante() {
        const modal = $('modalRegistroFirmante');
        const errEl = $('rfError');
        errEl.style.display = 'none';
        const mode = modal._rfMode;
        const code = modal._rfPackageCode;

        // Validar firma
        if (!_currentSignatureCanvas || _currentSignatureCanvas.isEmpty()) {
            errEl.textContent = 'Por favor garabatea la firma en el recuadro (o capturala desde el celular).';
            errEl.style.display = 'block';
            return;
        }
        const firmaImage = _currentSignatureCanvas.toDataURL();

        try {
            if (mode === 'signature-only') {
                await PM.setFirmaImage(code, modal._rfPersonaId, firmaImage);
                notify('Firma capturada correctamente');
            } else {
                // Registro completo
                const nombre = $('rfNombre').value.trim();
                const rol = $('rfRol').value.trim();
                const iniciales = $('rfIniciales').value.trim();
                const email = $('rfEmail').value.trim();
                const pin = $('rfPin').value;
                const pin2 = $('rfPinConfirm').value;
                if (!nombre) { errEl.textContent = 'Nombre requerido'; errEl.style.display = 'block'; return; }
                if (!pin || pin.length < 4) { errEl.textContent = 'PIN mínimo 4 caracteres'; errEl.style.display = 'block'; return; }
                if (pin !== pin2) { errEl.textContent = 'Los PINs no coinciden'; errEl.style.display = 'block'; return; }
                await PM.add(code, { nombre, rol, iniciales, email, firmaImage }, pin);
                notify('Firmante "' + nombre + '" registrado en el paquete');
            }
            closeRegistroFirmanteModal();
            renderPeopleTable();
        } catch (e) {
            errEl.textContent = e.message;
            errEl.style.display = 'block';
        }
    }

    // ====================================================================
    // MOBILE SIGNATURE SYNC
    // El usuario activa "Capturar desde celular" → genera token + QR → el celu
    // navega a la URL, dibuja con dedo y submitea. La PC polea cada 2s y al
    // recibir la firma la dibuja en el canvas.
    // ====================================================================
    let _mobileSigToken = null;
    let _mobileSigPollInterval = null;

    function cleanupMobileSignatureSync() {
        if (_mobileSigPollInterval) {
            clearInterval(_mobileSigPollInterval);
            _mobileSigPollInterval = null;
        }
        _mobileSigToken = null;
        const qrPanel = $('rfMobileQrPanel');
        if (qrPanel) qrPanel.style.display = 'none';
    }

    async function startMobileSignatureCapture() {
        try {
            // Obtener IP del server
            let serverIp = 'localhost';
            try {
                const r = await fetch('/sync/info');
                if (r.ok) {
                    const info = await r.json();
                    serverIp = info.ip || 'localhost';
                }
            } catch (e) { /* fallback localhost */ }

            const port = window.location.port || '8080';

            // Registrar en el server — el server genera el token (VULN-02: ignorar token del cliente)
            const reg = await fetch('/sync/signature/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!reg.ok) throw new Error('No se pudo registrar token en el server');
            const regData = await reg.json();
            _mobileSigToken = regData.token;   // token generado por el server
            const url = 'http://' + serverIp + ':' + port + '/?sigtoken=' + _mobileSigToken;

            // Mostrar el panel con QR
            const qrPanel = $('rfMobileQrPanel');
            const qrUrl = $('rfMobileQrUrl');
            const qrImg = $('rfMobileQrImg');
            qrUrl.textContent = url;
            _renderQrToImg(qrImg, url, 200);
            qrPanel.style.display = 'block';

            // Polling cada 2s para esperar la firma del celu
            _mobileSigPollInterval = setInterval(async () => {
                try {
                    const r = await fetch('/sync/signature/' + _mobileSigToken);
                    if (!r.ok) return;
                    const data = await r.json();
                    if (data.firmaImage) {
                        // Recibida! Pintar en el canvas y limpiar polling
                        await _currentSignatureCanvas.loadDataURL(data.firmaImage);
                        cleanupMobileSignatureSync();
                        notify('Firma recibida desde el celular');
                    }
                } catch (e) { /* silencioso, sigue poleando */ }
            }, 2000);
        } catch (e) {
            notify('Error iniciando captura móvil: ' + e.message, 'error');
        }
    }

    async function handleEdit(personaId) {
        const code = PM.getPackageCode();
        const p = PM.find(code, personaId);
        if (!p) return;
        const nombre = prompt('Nombre completo:', p.nombre);
        if (nombre == null) return;
        const rol = prompt('Rol:', p.rol || '');
        if (rol == null) return;
        const iniciales = prompt('Iniciales:', p.iniciales);
        if (iniciales == null) return;
        try {
            await PM.update(code, personaId, { nombre, rol, iniciales });
            notify('Datos actualizados');
            renderPeopleTable();
        } catch (e) {
            notify(e.message, 'error');
        }
    }

    async function handleRemove(personaId) {
        const code = PM.getPackageCode();
        const p = PM.find(code, personaId);
        if (!p) return;
        if (!confirm(`Eliminar a "${p.nombre}" del paquete? Esta acción no se puede deshacer.`)) return;
        try {
            await PM.remove(code, personaId);
            notify(`"${p.nombre}" eliminado del paquete`);
            renderPeopleTable();
        } catch (e) {
            notify(e.message, 'error');
        }
    }

    async function handleChangePinSelf(personaId) {
        const code = PM.getPackageCode();
        const p = PM.find(code, personaId);
        if (!p) return;
        const current = prompt(`Cambio de PIN para "${p.nombre}".\n\nIngresá el PIN actual:`);
        if (!current) return;
        const next = prompt('Nuevo PIN (mínimo 4 caracteres):');
        if (!next) return;
        const next2 = prompt('Confirmá el nuevo PIN:');
        if (next !== next2) { notify('Los PINs no coinciden', 'error'); return; }
        try {
            await PM.setPin(code, personaId, current, next);
            notify('PIN actualizado correctamente');
        } catch (e) {
            notify(e.message, 'error');
        }
    }

    async function handleResetPin(personaId) {
        const code = PM.getPackageCode();
        const maestro = PM.getMaestro(code);
        const target = PM.find(code, personaId);
        if (!maestro) { notify('No hay user maestro en el paquete', 'error'); return; }
        if (!target) return;
        if (!confirm(`Reset de PIN de "${target.nombre}".\n\nRequiere autenticación del user maestro (${maestro.nombre}).\n\nContinuar?`)) return;
        const maestroPin = prompt(`Ingresá el PIN del user maestro (${maestro.nombre}):`);
        if (!maestroPin) return;
        const newPin = prompt(`Nuevo PIN para "${target.nombre}" (mínimo 4 caracteres):`);
        if (!newPin) return;
        try {
            await PM.resetPinByMaestro(code, personaId, maestro.id, maestroPin, newPin);
            notify(`PIN de "${target.nombre}" reseteado por user maestro`);
        } catch (e) {
            notify(e.message, 'error');
        }
    }

    global.openPeopleManagerModal = function () {
        const modal = $('modalPeopleManager');
        if (!modal) return;
        renderPeopleTable();
        show(modal);
        // Bind close si no fue bound
        if (!modal._pmBound) {
            modal.querySelectorAll('[data-pm-close]').forEach(el => el.addEventListener('click', () => hide(modal)));
            const addBtn = $('pmBtnAddPersona');
            if (addBtn) addBtn.addEventListener('click', handleAddPersona);
            modal._pmBound = true;
        }
    };

    // Handlers globales que el HTML usa via onclick
    global.handleCaptureSignature = handleCaptureSignature;
    global.closeRegistroFirmanteModal = closeRegistroFirmanteModal;
    global.clearRegistroFirmanteCanvas = clearRegistroFirmanteCanvas;
    global.confirmRegistroFirmante = confirmRegistroFirmante;
    global.startMobileSignatureCapture = startMobileSignatureCapture;

    // ====================================================================
    // MODAL: FIRMAR ELECTRÓNICAMENTE
    //   - Lista las personas del paquete
    //   - Usuario elige una + ingresa PIN
    //   - Callback recibe el objeto firma listo para insertar
    // ====================================================================
    global.openSignWithPinModal = function (opts) {
        opts = opts || {};
        const code = opts.packageCode || PM.getPackageCode();
        const modal = $('modalSignWithPin');
        if (!modal) return;

        const personas = PM.list(code);
        const sel = $('signPersonaSelect');
        const rolHint = $('signRolHint');
        const pinInput = $('signPinInput');
        const titleEl = $('signTitleLabel');
        const errEl = $('signErrorMsg');

        if (titleEl) titleEl.textContent = opts.title || 'Firmar electrónicamente';
        if (rolHint) rolHint.textContent = opts.rolSugerido ? `Rol sugerido: ${opts.rolSugerido}` : '';
        if (errEl) errEl.textContent = '';
        if (pinInput) pinInput.value = '';

        if (sel) {
            sel.innerHTML = personas.length === 0
                ? '<option value="">— Sin personas registradas en el paquete —</option>'
                : '<option value="">— Elegir firmante —</option>' + personas.map(p =>
                    `<option value="${p.id}">${escapeHtml(p.nombre)} (${escapeHtml(p.iniciales)}) — ${escapeHtml(p.rol || 'sin rol')}</option>`
                ).join('');
            // Preselect si hay rolSugerido y matchea
            if (opts.rolSugerido) {
                const match = personas.find(p => (p.rol || '').toLowerCase().includes(opts.rolSugerido.toLowerCase()));
                if (match) sel.value = match.id;
            }
        }

        // Wire confirm
        const confirmBtn = $('signConfirmBtn');
        if (confirmBtn) {
            confirmBtn.onclick = async function () {
                if (errEl) errEl.textContent = '';
                const personaId = sel ? sel.value : '';
                const pin = pinInput ? pinInput.value : '';
                if (!personaId) { if (errEl) errEl.textContent = 'Elegí un firmante'; return; }
                if (!pin || pin.length < 4) { if (errEl) errEl.textContent = 'PIN mínimo 4 caracteres'; return; }
                try {
                    const firma = await PM.signWithPin(code, personaId, pin, { rolDeclarado: opts.rolSugerido });
                    if (!firma) { if (errEl) errEl.textContent = 'PIN incorrecto.'; return; }
                    hide(modal);
                    if (typeof opts.onSigned === 'function') opts.onSigned(firma);
                } catch (e) {
                    if (errEl) errEl.textContent = e.message;
                }
            };
        }
        const cancelBtn = $('signCancelBtn');
        if (cancelBtn) cancelBtn.onclick = function () { hide(modal); if (typeof opts.onCancel === 'function') opts.onCancel(); };

        show(modal);
        if (pinInput) setTimeout(() => pinInput.focus(), 100);
    };

})(window);
