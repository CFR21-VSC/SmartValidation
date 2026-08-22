'use strict';

/* ====================================================================
   AUTH SYNC
   Verifica la sesión del servidor (/auth/session) y, si está activa,
   crea automáticamente la sesión local de la app (IndexedDB + localStorage)
   sin pedir contraseña de nuevo.

   Corre ANTES del temporizador del login modal (4.7s), así que si el
   servidor confirma al usuario, el modal nunca aparece.
   ==================================================================== */

(function (global) {
    const SESSION_KEY = 'vscActiveSession';
    const SYNC_FLAG   = '_serverAuthOk';

    function _readLocalSession() {
        try {
            const s = localStorage.getItem(SESSION_KEY);
            if (!s) return null;
            const sess = JSON.parse(s);
            if (!sess.expiresAt || new Date(sess.expiresAt).getTime() < Date.now()) {
                localStorage.removeItem(SESSION_KEY);
                return null;
            }
            return sess;
        } catch (_) { return null; }
    }

    function _writeLocalSession(serverUser) {
        const expires = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
        const sess = {
            userId:      'srv_' + serverUser.username,
            username:    serverUser.username,
            displayName: serverUser.displayName || serverUser.username,
            email:       serverUser.email || '',
            role:        serverUser.role || 'admin',
            loggedInAt:  new Date().toISOString(),
            expiresAt:   expires,
            remember:    false,
            serverVerified: true,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
        return sess;
    }

    async function syncServerSession() {
        try {
            const res = await fetch('/auth/session', {
                credentials: 'include',
                signal: AbortSignal.timeout(4000),
            });

            if (!res.ok) {
                // Servidor activo pero no autenticado → redirect al login
                // (no debería pasar porque server.py ya redirige a /login.html)
                return;
            }

            const serverUser = await res.json();
            if (!serverUser.ok || !serverUser.username) return;

            // Marcar que el servidor ya autenticó: suprime el modal de login
            global[SYNC_FLAG] = true;

            // Si ya hay sesión local con el mismo usuario, solo actualizar role si cambió
            const local = _readLocalSession();
            if (local && local.username === serverUser.username) {
                if (local.role !== serverUser.role) {
                    local.role = serverUser.role;
                    localStorage.setItem(SESSION_KEY, JSON.stringify(local));
                    if (typeof global.refreshUserChip === 'function') global.refreshUserChip();
                }
                return;
            }

            // Crear sesión local desde los datos del servidor
            _writeLocalSession(serverUser);

            // Si auth-ui ya cargó, actualizar el chip inmediatamente
            if (typeof global.refreshUserChip === 'function') {
                global.refreshUserChip();
            }

        } catch (_) {
            // fetch falló (sin servidor auth o timeout): no bloquear la app,
            // el auth local (IndexedDB) actuará como fallback.
        }
    }

    // Logout centralizado: cierra sesión en servidor Y en cliente
    global.handleLogout = async function () {
        if (!confirm('¿Cerrar sesión?')) return;

        // IMPORTANTE: await garantiza que la cookie se limpie ANTES de navegar.
        // Sin await, el browser puede navegar antes de que /auth/logout responda
        // y el servidor sigue viendo la cookie vieja → redirige de vuelta a /.
        try {
            await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (_) {}

        // Cerrar sesión local
        const VS = global.ValidationSuite;
        if (VS && VS.auth && typeof VS.auth.logout === 'function') {
            VS.auth.logout();
        } else {
            localStorage.removeItem(SESSION_KEY);
        }

        window.location.replace('/login.html');
    };

    // Ejecutar sincronización al cargar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncServerSession);
    } else {
        syncServerSession();
    }

})(window);
