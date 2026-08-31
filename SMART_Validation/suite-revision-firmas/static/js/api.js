/* api.js — fetch wrapper compartido por todas las páginas de la Suite de Revisión y Firmas.
   Cookie de sesión httpOnly (rf_session) va sola con credentials:'include' — nunca se
   maneja el token a mano en JS. */

const API_BASE = '';

/**
 * @param {string} path        p.ej. '/auth/login'
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.body] se serializa a JSON automáticamente
 * @returns {Promise<{status:number, data:any}>}
 */
async function apiFetch(path, opts = {}) {
    const fetchOpts = {
        method: opts.method || 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    };
    if (opts.body !== undefined) fetchOpts.body = JSON.stringify(opts.body);

    let res;
    try {
        res = await fetch(API_BASE + path, fetchOpts);
    } catch (e) {
        return { status: 0, data: { ok: false, error: 'No se pudo conectar con el servidor.' } };
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* respuesta sin body (204, etc.) */ }
    if (!res.ok && data.detail && !data.error) data.error = data.detail;
    return { status: res.status, data };
}

/**
 * Evita que el botón/gesto "Atrás" del navegador saque al usuario de la app
 * a mitad de un trámite (p. ej. quedar en la pestaña "Nueva pestaña" con el
 * buscador de Google, típico cuando la app corre en modo --app= de Chrome con
 * un perfil dedicado sin más historial detrás). No bloquea el gesto: cuando
 * el navegador dispara popstate, se vuelve a apilar la URL actual, así que
 * "Atrás" no tiene efecto visible en vez de sacar a la persona del sistema.
 * Cada página con sesión ya tiene sus propios botones de navegación
 * ("Volver al dashboard", "Cerrar sesión"), así que no se pierde ninguna
 * forma real de moverse por la app.
 */
function trapBackNavigation() {
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', () => {
        history.pushState(null, '', location.href);
    });
}

/**
 * Redirige a login si la sesión no es válida, o a pin-setup.html si el usuario
 * todavía no configuró su PIN de firma (requisito del primer login, sección 3
 * Capa 2). Pasar {allowNoPin:true} en páginas que no lo necesitan (p. ej. la
 * propia pin-setup.html, o pantallas de solo lectura sin acciones de firma).
 * Devuelve la sesión ({ok, display_name, role, is_superadmin, pin_set}) si pasa.
 */
async function requireSession(opts = {}) {
    trapBackNavigation();
    startIdleLogoutTimer();
    const { status, data } = await apiFetch('/auth/session');
    if (status !== 200) {
        window.location.href = '/app/login.html';
        return null;
    }
    if (!data.pin_set && !opts.allowNoPin) {
        window.location.href = '/app/pin-setup.html';
        return null;
    }
    return data;
}

/**
 * Logout automático por inactividad (15 min sin interacción del usuario) — requisito
 * típico GxP/21 CFR Part 11 para no dejar una sesión abierta con datos sensibles en
 * pantalla si alguien se aleja. Se reinicia con cualquier interacción real; corre en
 * TODAS las páginas con sesión porque requireSession() la arranca siempre.
 */
const IDLE_LOGOUT_MS = 15 * 60 * 1000;
let _idleTimer = null;

function startIdleLogoutTimer() {
    if (_idleTimer !== null) return; // ya está corriendo en esta página, no duplicar listeners
    const resetIdleTimer = () => {
        if (_idleTimer) clearTimeout(_idleTimer);
        _idleTimer = setTimeout(() => {
            doLogout('idle');
        }, IDLE_LOGOUT_MS);
    };
    ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
        window.addEventListener(evt, resetIdleTimer, { passive: true })
    );
    resetIdleTimer();
}

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function fmtDateTime(epochSeconds) {
    if (!epochSeconds) return '—';
    return new Date(epochSeconds * 1000).toLocaleString('es-AR');
}

function showToast(msg, isError) {
    const t = document.createElement('div');
    t.className = 'rf-toast' + (isError ? ' rf-toast-error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
}

async function doLogout(reason) {
    await apiFetch('/auth/logout', { method: 'POST' });
    window.location.href = reason === 'idle' ? '/app/login.html?idle=1' : '/app/login.html';
}
