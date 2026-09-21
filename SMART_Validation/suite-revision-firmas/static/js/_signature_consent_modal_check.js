/* ====================================================================
   Ronda 19, tercera devolución de Codex (2026-09-21) -- "Ejecuté en Node las funciones
   reales extraídas de ambos HTML, con DOM/API simulados, controlando las respuestas."

   Regresión permanente del mismo método: carga signature-consent.js (el módulo real que
   ahora usan review.html y approval.html) con un DOM mínimo simulado y un apiFetch
   controlable a mano (se resuelve cuando el script decide, no cuando llega solo), para
   poder reproducir carreras exactas: aceptar → cancelar antes de que responda el servidor
   → la respuesta llega tarde. Invocado por tests/test_signature_consent.py::
   test_consent_modal_cancel_race_condition como subprocess, igual que el contrato de
   wrappers -- "no hace falta infraestructura nueva para un script Node".

   Imprime un JSON con los resultados de cada escenario a stdout; exit code 0 si todo pasó.
   ==================================================================== */
'use strict';

function makeElement(id) {
    const classes = new Set();
    return {
        id,
        _text: '',
        get textContent() { return this._text; },
        set textContent(v) { this._text = v; },
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
        style: { display: 'none' },
        disabled: false,
        addEventListener() { /* bindConsentModalEvents no se ejercita acá -- se llaman las funciones directo */ },
    };
}

const elements = {};
['consent-error', 'consent-text', 'consent-accept', 'consent-backdrop', 'consent-cancel'].forEach((id) => {
    elements[id] = makeElement(id);
});

global.window = global;
global.document = { getElementById: (id) => elements[id] };

// apiFetch controlable: cada llamada queda pendiente hasta que el script la resuelva a
// mano -- así se puede simular una respuesta que llega DESPUÉS de que el usuario canceló.
const pendingCalls = [];
global.apiFetch = function (path, opts) {
    return new Promise((resolve) => {
        pendingCalls.push({ path, opts: opts || {}, resolve });
    });
};
function resolvePending(index, status, data) {
    const call = pendingCalls[index];
    call.resolve({ status, data });
}

const sc = require('./signature-consent.js');

const results = [];
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ label, ok, actual, expected });
}

async function scenarioVersionAndStale() {
    let calledBack = false;
    sc.openConsentModal({ current_statement_text: 'Texto v1', current_version: 'v1' }, () => { calledBack = true; });
    check('A1: texto mostrado al abrir', elements['consent-text'].textContent, 'Texto v1');

    const p1 = sc.submitConsentAccept();
    check('A2: primer click manda version v1', pendingCalls[0].opts.body, { version: 'v1' });
    resolvePending(0, 409, { error: { error: 'stale_consent_version', current_statement_text: 'Texto v2', current_version: 'v2' } });
    await p1;
    check('A3: 409 obsoleto NO ejecuta callback', calledBack, false);
    check('A4: 409 obsoleto actualiza texto/version mostrados', [elements['consent-text'].textContent, sc._getShownVersion()], ['Texto v2', 'v2']);

    const p2 = sc.submitConsentAccept();
    check('A5: segundo click manda la version NUEVA (v2), no reintenta la vieja', pendingCalls[1].opts.body, { version: 'v2' });
    resolvePending(1, 200, { ok: true });
    await p2;
    check('A6: 200 ejecuta el callback', calledBack, true);
    check('A7: 200 cierra el modal', elements['consent-backdrop'].style.display, 'none');
}

async function scenarioCancelRace() {
    let calledBack = false;
    sc.openConsentModal({ current_statement_text: 'Texto', current_version: 'v1' }, () => { calledBack = true; });
    const idx = pendingCalls.length;
    const p = sc.submitConsentAccept();

    // El usuario cancela ANTES de que el servidor responda -- mismo click que
    // "Cancelar" dispara (closeConsentModal), sin esperar el POST.
    sc.closeConsentModal();

    // La respuesta del servidor llega DESPUÉS, y es un 200 -- el bug exacto que reprodujo
    // Codex: "llega 200: ejecuta el callback igualmente, abriendo la continuación de firma
    // aunque se canceló el modal."
    resolvePending(idx, 200, { ok: true });
    await p;

    check('B1: respuesta tardía tras cancelar NO ejecuta el callback', calledBack, false);
    check('B2: modal sigue cerrado', elements['consent-backdrop'].style.display, 'none');
}

async function scenarioReplaceModalBeforeResponse() {
    // "Testear también cerrar y abrir otro modal antes de que llegue la respuesta
    // anterior, para que no consuma el callback nuevo."
    let calledA = false, calledB = false;
    sc.openConsentModal({ current_statement_text: 'A', current_version: 'v1' }, () => { calledA = true; });
    const idxA = pendingCalls.length;
    const pA = sc.submitConsentAccept();

    // Antes de que responda el POST de A, se abre un modal NUEVO (B) -- p.ej. el usuario
    // canceló A y de inmediato disparó otra acción que requiere firmar otra cosa.
    sc.openConsentModal({ current_statement_text: 'B', current_version: 'v1' }, () => { calledB = true; });

    // La respuesta tardía de A llega ahora, con 200.
    resolvePending(idxA, 200, { ok: true });
    await pA;
    check('C1: respuesta tardía de A no ejecuta el callback de A', calledA, false);
    check('C2: respuesta tardía de A tampoco ejecuta el callback de B', calledB, false);
    check('C3: el modal de B sigue abierto (A no lo pisó)', elements['consent-backdrop'].style.display, 'flex');

    // Ahora sí se acepta B de verdad.
    const idxB = pendingCalls.length;
    const pB = sc.submitConsentAccept();
    resolvePending(idxB, 200, { ok: true });
    await pB;
    check('C4: aceptar B ejecuta el callback de B', calledB, true);
}

(async () => {
    await scenarioVersionAndStale();
    await scenarioCancelRace();
    await scenarioReplaceModalBeforeResponse();

    const failed = results.filter((r) => !r.ok);
    console.log(JSON.stringify({ results, allPassed: failed.length === 0 }));
    process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
    console.log(JSON.stringify({ results, allPassed: false, error: String(e && e.stack || e) }));
    process.exit(1);
});
