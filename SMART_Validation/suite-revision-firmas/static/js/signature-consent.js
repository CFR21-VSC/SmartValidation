/* ====================================================================
   Declaración de conformidad de firma electrónica (una vez, de por vida) -- lógica del
   modal de consentimiento, compartida entre review.html y approval.html.

   Ronda 19 (2026-09-20/21): esta lógica vivía duplicada e idéntica en los dos HTML.
   Codex encontró el mismo bug ("cancelar antes de que termine el POST → llega 200 →
   ejecuta el callback igualmente") en ambos archivos por separado -- exactamente el riesgo
   de mantener dos copias sincronizadas a mano que ya se había señalado para los wrappers
   Python/JS del Libro de Firmas. Se extrae acá, cargada por <script src> en ambas páginas
   (que ya comparten los mismos ids de DOM: consent-backdrop/consent-text/consent-error/
   consent-accept/consent-cancel), para que exista una sola versión y quede testeable con
   Node (ver tests/test_signature_consent.py::test_consent_modal_cancel_race_condition,
   que la carga con document/apiFetch simulados, igual que Codex hizo ad hoc).

   API expuesta (globals, mismo estilo que el resto de esta suite -- sin bundler/módulos):
     checkSignatureConsent()          -> Promise<{accepted, current_statement_text, current_version}>
     openConsentModal(consentInfo, onAccepted)
     closeConsentModal()
     submitConsentAccept()            -> disparado por el click en "Acepto"
     openSignModalWithConsentGate(openSignModalFn) -- ver uso en cada página
   ==================================================================== */

let _consentShownVersion = null;
let _consentRequestToken = 0;

async function checkSignatureConsent() {
    const { status, data } = await apiFetch('/auth/signature-consent');
    return status === 200 && data.ok ? data : { accepted: false, current_statement_text: '', current_version: null };
}

function openConsentModal(consentInfo, onAccepted) {
    const err = document.getElementById('consent-error');
    err.textContent = ''; err.classList.remove('visible');
    document.getElementById('consent-text').textContent = consentInfo.current_statement_text || '';
    _consentShownVersion = consentInfo.current_version || null;
    _consentRequestToken++;
    window._consentOnAccepted = onAccepted;
    document.getElementById('consent-accept').disabled = false;
    document.getElementById('consent-backdrop').style.display = 'flex';
}

function closeConsentModal() {
    document.getElementById('consent-backdrop').style.display = 'none';
    _consentShownVersion = null;
    // Ronda 19, tercera devolución de Codex (2026-09-21): incrementar el token acá (se
    // dispara tanto por "Cancelar" como por un aceptar exitoso) invalida cualquier
    // submitConsentAccept en vuelo de una apertura anterior -- una respuesta 200 tardía ya
    // no coincide con el token vigente y no puede abrir el modal de firma "solo".
    _consentRequestToken++;
    window._consentOnAccepted = null;
}

async function submitConsentAccept() {
    const err = document.getElementById('consent-error');
    err.textContent = ''; err.classList.remove('visible');
    if (!_consentShownVersion) {
        err.textContent = 'No se pudo determinar la versión de la declaración — cerrá y volvé a intentar.';
        err.classList.add('visible');
        return;
    }
    const myToken = _consentRequestToken;
    const btn = document.getElementById('consent-accept');
    btn.disabled = true;
    const { status, data } = await apiFetch('/auth/signature-consent', {
        method: 'POST', body: { version: _consentShownVersion },
    });
    if (myToken !== _consentRequestToken) {
        // El modal se cerró/canceló/reabrió mientras este POST estaba en vuelo -- lo que el
        // servidor haya registrado queda registrado (correcto, no se deshace), pero la
        // continuación de UI (abrir el modal de firma) ya no corresponde a lo que el
        // usuario está viendo. No tocar nada.
        return;
    }
    btn.disabled = false;
    if (status === 200 && data.ok) {
        const cb = window._consentOnAccepted;
        closeConsentModal();
        if (cb) cb();
        return;
    }
    if (status === 409 && data.error && data.error.error === 'stale_consent_version') {
        // El texto cambió entre el GET que lo mostró y este POST -- se vuelve a mostrar el
        // texto/versión NUEVOS y se exige otro click explícito, nunca se acepta solo.
        document.getElementById('consent-text').textContent = data.error.current_statement_text || '';
        _consentShownVersion = data.error.current_version || null;
        err.textContent = 'La declaración cambió — revisala de nuevo y confirmá.';
        err.classList.add('visible');
        return;
    }
    err.textContent = (data.error && data.error.message) || (typeof data.error === 'string' ? data.error : null) || 'No se pudo registrar la aceptación.';
    err.classList.add('visible');
}

/** Gate genérico: si falta aceptar la declaración, la muestra primero y recién después
 *  llama a `openTargetModalFn` (el modal real de firma de cada página). */
async function openSignModalWithConsentGate(openTargetModalFn) {
    const consentInfo = await checkSignatureConsent();
    if (consentInfo.accepted) { openTargetModalFn(); return; }
    openConsentModal(consentInfo, openTargetModalFn);
}

function bindConsentModalEvents() {
    document.getElementById('consent-cancel').addEventListener('click', closeConsentModal);
    document.getElementById('consent-accept').addEventListener('click', submitConsentAccept);
}

// Node (tests) no tiene `document` global de verdad al importar -- exportar solo ahí.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkSignatureConsent, openConsentModal, closeConsentModal, submitConsentAccept,
        openSignModalWithConsentGate, bindConsentModalEvents,
        _getShownVersion: () => _consentShownVersion,
        _getRequestToken: () => _consentRequestToken,
    };
}
