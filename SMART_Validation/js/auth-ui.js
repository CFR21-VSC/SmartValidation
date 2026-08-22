/* ====================================================================
   AUTH UI - Login + recovery + user chip + logout + user management
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    if (!VS.auth) {
        console.error('[auth-ui] VS.auth no esta cargado.');
        return;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function roleLabel(role) {
        return ({
            admin:   'Administrador',
            auditor: 'Auditor (read-only)',
            client:  'Cliente',
            user:    'Usuario'
        })[role] || role;
    }

    function roleBadgeColor(role) {
        return ({
            admin:   '#A52A2A',
            auditor: '#586574',
            client:  '#1A5276',
            user:    '#1E7E34'
        })[role] || '#586574';
    }

    // ====================================================================
    // LOGIN MODAL
    // ====================================================================
    function openLoginModal(opts) {
        opts = opts || {};
        const modal = document.getElementById('modalLogin');
        if (!modal) return;

        // Reset form
        const userInput = modal.querySelector('#loginUsername');
        const passInput = modal.querySelector('#loginPassword');
        const rememberInput = modal.querySelector('#loginRemember');
        const errorBox = modal.querySelector('#loginError');
        if (userInput) userInput.value = '';
        if (passInput) passInput.value = '';
        if (rememberInput) rememberInput.checked = false;
        if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }

        modal.style.display = 'flex';
        // Focus
        setTimeout(() => { if (userInput) userInput.focus(); }, 100);
    }

    function closeLoginModal() {
        const modal = document.getElementById('modalLogin');
        if (modal) modal.style.display = 'none';
    }

    async function handleLoginSubmit(e) {
        if (e && e.preventDefault) e.preventDefault();
        const modal = document.getElementById('modalLogin');
        if (!modal) return;
        const username = modal.querySelector('#loginUsername').value.trim();
        const password = modal.querySelector('#loginPassword').value;
        const remember = modal.querySelector('#loginRemember').checked;
        const errorBox = modal.querySelector('#loginError');
        const submitBtn = modal.querySelector('#loginSubmitBtn');

        if (!username || !password) {
            showError(errorBox, 'Completa usuario y contrasena');
            return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verificando...';
        try {
            // Autenticar contra el servidor primero (usuarios gestionados en SQLite).
            // Solo si el servidor es inalcanzable (catch) se cae al IndexedDB local.
            try {
                const resp = await fetch('/auth/login', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                    signal: AbortSignal.timeout(5000),
                });
                const data = await resp.json();
                if (data.ok) {
                    if (data.must_change) {
                        closeLoginModal();
                        openForcedPasswordChange(username);
                        return;
                    }
                    // Servidor autenticó: escribir sesión local con rol real
                    const expires = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
                    localStorage.setItem('vscActiveSession', JSON.stringify({
                        userId:        'srv_' + username.toLowerCase(),
                        username:      username.toLowerCase(),
                        displayName:   data.display || username,
                        email:         '',
                        role:          data.role || 'admin',
                        loggedInAt:    new Date().toISOString(),
                        expiresAt:     expires,
                        remember:      remember,
                        serverVerified: true,
                    }));
                    closeLoginModal();
                    onSessionEstablished();
                    return;
                }
                // Servidor respondió pero rechazó las credenciales: mostrar su error
                showError(errorBox, data.error || 'Credenciales incorrectas');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Iniciar sesion';
                return;
            } catch (_) {
                // Servidor inalcanzable — intentar login local (IndexedDB)
            }

            const result = await VS.auth.login(username, password, { remember });
            if (result.ok) {
                if (result.mustChangePassword) {
                    closeLoginModal();
                    openForcedPasswordChange(username);
                    return;
                }
                closeLoginModal();
                onSessionEstablished();
            } else {
                showError(errorBox, result.error || 'Error de login');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Iniciar sesion';
            }
        } catch (e) {
            showError(errorBox, 'Error: ' + e.message);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Iniciar sesion';
        }
    }

    function showError(el, msg) {
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'block';
    }

    function onSessionEstablished() {
        const sess = VS.auth.getActiveSession();
        if (!sess) return;

        // Sincronizar el campo #ejecutor del sys-panel con el user logueado.
        // syncSystemFields() en logica-modular.js escucha el evento 'input' y
        // actualiza la variable global `executor` + persiste via saveToStorage.
        // Así los logs de auditoría siguientes ya quedan a nombre real, sin reload.
        const ejecInput = document.getElementById('ejecutor');
        if (ejecInput) {
            ejecInput.value = sess.displayName || sess.username;
            ejecInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Backup directo del global por si syncSystemFields no estaba activo
        if (typeof window.executor !== 'undefined') {
            window.executor = sess.displayName || sess.username;
        }

        refreshUserChip();
        // NO recargamos: la app sigue corriendo limpiamente.
    }

    // ====================================================================
    // RECOVERY MODAL
    // ====================================================================
    function openRecoveryModal() {
        closeLoginModal();
        const modal = document.getElementById('modalRecovery');
        if (!modal) return;
        // Reset
        modal.querySelector('#recoveryUsername').value = '';
        modal.querySelector('#recoveryAnswer').value = '';
        modal.querySelector('#recoveryNewPass').value = '';
        modal.querySelector('#recoveryQuestion').textContent = '';
        modal.querySelector('#recoveryStep1').style.display = 'block';
        modal.querySelector('#recoveryStep2').style.display = 'none';
        const err = modal.querySelector('#recoveryError');
        err.style.display = 'none'; err.textContent = '';
        modal.style.display = 'flex';
        setTimeout(() => modal.querySelector('#recoveryUsername').focus(), 100);
    }

    function closeRecoveryModal() {
        const modal = document.getElementById('modalRecovery');
        if (modal) modal.style.display = 'none';
    }

    async function handleRecoveryStep1(e) {
        if (e && e.preventDefault) e.preventDefault();
        const modal = document.getElementById('modalRecovery');
        const username = modal.querySelector('#recoveryUsername').value.trim();
        const errorBox = modal.querySelector('#recoveryError');
        if (!username) { showError(errorBox, 'Ingresa el usuario'); return; }
        try {
            const info = await VS.auth.getSecretQuestion(username);
            if (!info) { showError(errorBox, 'Usuario no encontrado'); return; }
            modal.querySelector('#recoveryQuestion').textContent = info.question;
            modal.querySelector('#recoveryDisplayName').textContent = info.displayName;
            modal.querySelector('#recoveryStep1').style.display = 'none';
            modal.querySelector('#recoveryStep2').style.display = 'block';
            errorBox.style.display = 'none';
            setTimeout(() => modal.querySelector('#recoveryAnswer').focus(), 100);
        } catch (e) {
            showError(errorBox, 'Error: ' + e.message);
        }
    }

    async function handleRecoveryStep2(e) {
        if (e && e.preventDefault) e.preventDefault();
        const modal = document.getElementById('modalRecovery');
        const username = modal.querySelector('#recoveryUsername').value.trim();
        const answer = modal.querySelector('#recoveryAnswer').value;
        const newPass = modal.querySelector('#recoveryNewPass').value;
        const errorBox = modal.querySelector('#recoveryError');
        if (!answer || !newPass) { showError(errorBox, 'Completa todos los campos'); return; }
        if (newPass.length < 6) { showError(errorBox, 'La contrasena debe tener al menos 6 caracteres'); return; }
        try {
            const r = await VS.auth.resetPasswordBySecret(username, answer, newPass);
            if (r.ok) {
                closeRecoveryModal();
                alert('Contrasena cambiada con exito. Inicia sesion con la nueva.');
                openLoginModal();
            } else {
                showError(errorBox, r.error);
            }
        } catch (e) {
            showError(errorBox, 'Error: ' + e.message);
        }
    }

    // ====================================================================
    // PASSWORD CHANGE (forced o voluntario)
    // ====================================================================
    function openForcedPasswordChange(username) {
        // Reusa modal de recovery con flag (skip step 1, mostrar mensaje)
        const modal = document.getElementById('modalRecovery');
        if (!modal) return;
        modal.querySelector('#recoveryUsername').value = username;
        modal.querySelector('#recoveryQuestion').textContent = 'Cambio obligatorio en primer login';
        modal.querySelector('#recoveryDisplayName').textContent = username;
        modal.querySelector('#recoveryStep1').style.display = 'none';
        modal.querySelector('#recoveryStep2').style.display = 'block';
        modal.style.display = 'flex';
    }

    // ====================================================================
    // USER CHIP en el header
    // ====================================================================
    function refreshUserChip() {
        const chip = document.getElementById('userSessionChip');
        const optBtn = document.getElementById('btnUserOptions');
        const menuUserMgmt = document.getElementById('menuUserMgmt');
        if (!chip) return;
        const sess = VS.auth.getActiveSession();
        if (!sess) {
            chip.style.display = 'none';
            if (optBtn) optBtn.style.display = 'none';
            return;
        }
        chip.style.display = '';
        if (optBtn) optBtn.style.display = '';
        const nameEl = chip.querySelector('.user-chip-name');
        const roleEl = chip.querySelector('.user-chip-role');
        if (nameEl) nameEl.textContent = sess.displayName || sess.username;
        if (roleEl) {
            roleEl.textContent = roleLabel(sess.role);
            roleEl.style.background = roleBadgeColor(sess.role);
        }
        chip.title = 'Usuario: ' + (sess.displayName || sess.username) +
                     '\nRol: ' + roleLabel(sess.role) +
                     '\nSesion expira: ' + new Date(sess.expiresAt).toLocaleString('es-AR');
        // Gestion de usuarios solo visible para admin
        if (menuUserMgmt) {
            menuUserMgmt.style.display = (sess.role === 'admin') ? '' : 'none';
        }
        // Rondas de revisión: admin y auditor únicamente (endpoint requiere ambos roles)
        const menuReview = document.getElementById('menuReviewDashboard');
        if (menuReview) {
            menuReview.style.display = (sess.role === 'admin' || sess.role === 'auditor') ? '' : 'none';
        }
    }

    function toggleUserMenu(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const menu = document.getElementById('userOptionsMenu');
        if (!menu) return;
        const open = menu.style.display !== 'none';
        menu.style.display = open ? 'none' : 'block';
        if (!open) {
            // Cerrar al click fuera
            setTimeout(() => {
                document.addEventListener('click', closeMenuOnce, { once: true });
            }, 0);
        }
    }
    function closeMenuOnce() {
        const menu = document.getElementById('userOptionsMenu');
        if (menu) menu.style.display = 'none';
    }

    async function handleLogout() {
        if (!confirm('¿Cerrar sesión?')) return;
        try {
            await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (_) {}
        try { VS.auth.logout(); } catch (_) {}
        window.location.replace('/login.html');
    }

    // ====================================================================
    // BOOTSTRAP UI - al cargar, verificar sesion
    // ====================================================================
    async function init() {
        try {
            await VS.auth.bootstrap();
        } catch (e) { console.error('[auth-ui] bootstrap fallo:', e); }

        const sess = VS.auth.getActiveSession();
        if (sess) {
            refreshUserChip();
        } else {
            // No hay sesion local. Si auth-sync.js verificó el servidor,
            // _serverAuthOk estará en true y el modal no debe abrirse.
            // Esperamos un poco más para darle tiempo a auth-sync.js.
            setTimeout(() => {
                if (global._serverAuthOk) {
                    // Sesión creada por auth-sync.js: refrescar chip y salir
                    refreshUserChip();
                    return;
                }
                openLoginModal();
            }, 4900);
        }
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    global.openLoginModal = openLoginModal;
    global.closeLoginModal = closeLoginModal;
    global.handleLoginSubmit = handleLoginSubmit;
    global.openRecoveryModal = openRecoveryModal;
    global.closeRecoveryModal = closeRecoveryModal;
    global.handleRecoveryStep1 = handleRecoveryStep1;
    global.handleRecoveryStep2 = handleRecoveryStep2;
    global.refreshUserChip = refreshUserChip;
    global.handleLogout = handleLogout;
    global.toggleUserMenu = toggleUserMenu;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window);
