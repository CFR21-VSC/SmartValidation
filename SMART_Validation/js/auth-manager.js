/* ====================================================================
   AUTH MANAGER - Storage + hashing + login/logout/recovery
   Sistema de autenticacion decorativo para DRP. Hash SHA-256 con salt
   por usuario, persistido en IndexedDB. Roles: admin / user / auditor.

   API:
     VS.auth.bootstrap()              -> inicializa DB + seed users
     VS.auth.listUsers()
     VS.auth.getUserByUsername(u)
     VS.auth.createUser({...}, byAdminId)
     VS.auth.deleteUser(id)
     VS.auth.changePassword(username, oldPw, newPw)
     VS.auth.resetPasswordBySecret(username, answer, newPw)
     VS.auth.login(username, password)        -> {ok, session, error?}
     VS.auth.verifyPin(username, pin)         -> bool
     VS.auth.logout()
     VS.auth.getActiveSession()                -> session | null
     VS.auth.isLoggedIn()                       -> bool
     VS.auth.requireRole(roles[])               -> bool
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.auth = VS.auth || {};

    const DB_NAME = 'DRPAuthDB';
    const DB_VERSION = 1;
    const STORE = 'users';
    const SESSION_KEY = 'vscActiveSession';
    const DEFAULT_SESSION_HOURS = 8;
    const REMEMBER_SESSION_DAYS = 30;
    const MAX_FAILED_ATTEMPTS = 5;
    const LOCKOUT_MINUTES = 15;

    // ====================================================================
    // SEED USERS — vacío intencionalmente.
    // El sistema usa autenticación server-side (SQLite + cookie).
    // Los usuarios se crean desde el panel de administración (admin/users).
    // ====================================================================
    const SEED_USERS = [];

    // ====================================================================
    // INDEXEDDB
    // ====================================================================
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const s = db.createObjectStore(STORE, { keyPath: 'id' });
                    s.createIndex('byUsername', 'username', { unique: true });
                    s.createIndex('byRole', 'role', { unique: false });
                }
            };
        });
    }

    async function dbGet(id) {
        const db = await openDB();
        try {
            return await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readonly');
                const r = tx.objectStore(STORE).get(id);
                r.onsuccess = () => res(r.result || null);
                r.onerror = () => rej(r.error);
            });
        } finally { db.close(); }
    }

    async function dbGetByUsername(username) {
        const db = await openDB();
        try {
            return await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readonly');
                const idx = tx.objectStore(STORE).index('byUsername');
                const r = idx.get(String(username || '').toLowerCase().trim());
                r.onsuccess = () => res(r.result || null);
                r.onerror = () => rej(r.error);
            });
        } finally { db.close(); }
    }

    async function dbPut(entry) {
        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(entry);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally { db.close(); }
        return entry;
    }

    async function dbDelete(id) {
        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(id);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally { db.close(); }
    }

    async function dbListAll() {
        const db = await openDB();
        try {
            return await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readonly');
                const items = [];
                const cur = tx.objectStore(STORE).openCursor();
                cur.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) { items.push(c.value); c.continue(); }
                    else res(items);
                };
                cur.onerror = () => rej(cur.error);
            });
        } finally { db.close(); }
    }

    // ====================================================================
    // CRYPTO - SHA-256 con salt
    // ====================================================================
    function randomSalt() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function hashWithSalt(text, salt) {
        const enc = new TextEncoder().encode(String(salt) + ':' + String(text));
        const buf = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function normalizeAnswer(s) {
        return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    }

    // ====================================================================
    // SESSION MANAGEMENT (localStorage)
    // ====================================================================
    function readSession() {
        try {
            const s = localStorage.getItem(SESSION_KEY);
            if (!s) return null;
            const sess = JSON.parse(s);
            if (!sess.expiresAt || new Date(sess.expiresAt).getTime() < Date.now()) {
                localStorage.removeItem(SESSION_KEY);
                return null;
            }
            return sess;
        } catch (e) {
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
    }

    function writeSession(session) {
        if (session == null) localStorage.removeItem(SESSION_KEY);
        else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }

    function getActiveSession() {
        return readSession();
    }

    function isLoggedIn() {
        return !!readSession();
    }

    function requireRole(roles) {
        const s = readSession();
        if (!s) return false;
        if (!Array.isArray(roles)) roles = [roles];
        return roles.indexOf(s.role) >= 0;
    }

    // ====================================================================
    // SEED + BOOTSTRAP
    // ====================================================================
    async function seedDefaultUsers() {
        const existing = await dbListAll();
        if (existing.length > 0) return false;
        // DB vacia, sembrar
        for (const u of SEED_USERS) {
            const passwordSalt = randomSalt();
            const pinSalt = randomSalt();
            const answerSalt = randomSalt();
            const entry = {
                id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
                username: u.username.toLowerCase().trim(),
                displayName: u.displayName,
                email: u.email || '',
                role: u.role,
                passwordHash: await hashWithSalt(u.password, passwordSalt),
                passwordSalt,
                pinHash: await hashWithSalt(u.pin, pinSalt),
                pinSalt,
                secretQuestion: u.secretQuestion,
                secretAnswerHash: await hashWithSalt(normalizeAnswer(u.secretAnswer), answerSalt),
                secretAnswerSalt: answerSalt,
                createdAt: new Date().toISOString(),
                lastLoginAt: null,
                failedAttempts: 0,
                lockedUntil: null,
                mustChangePassword: false,
                builtin: true
            };
            await dbPut(entry);
        }
        console.info('[auth] Seed users creados (' + SEED_USERS.length + ')');
        return true;
    }

    async function bootstrap() {
        try {
            await seedDefaultUsers();
        } catch (e) {
            console.error('[auth] bootstrap fallo:', e);
        }
    }

    // ====================================================================
    // LOGIN / LOGOUT
    // ====================================================================
    async function login(username, password, opts) {
        opts = opts || {};
        const user = await dbGetByUsername(username);
        if (!user) {
            return { ok: false, error: 'Usuario o contrasena incorrectos' };
        }
        // Lockout check
        if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
            const minLeft = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
            return { ok: false, error: 'Cuenta bloqueada por intentos fallidos. Reintenta en ' + minLeft + ' min.' };
        }
        // Verify password
        const candidateHash = await hashWithSalt(password, user.passwordSalt);
        if (candidateHash !== user.passwordHash) {
            // Failed attempt
            user.failedAttempts = (user.failedAttempts || 0) + 1;
            if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
                user.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString();
            }
            await dbPut(user);
            if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                global.AuditTrail.logAction('USER_LOGIN_FAILED', 'user', user.id, {
                    username: user.username, attempts: user.failedAttempts
                }, 'Login fallido: ' + user.username);
            }
            const left = MAX_FAILED_ATTEMPTS - user.failedAttempts;
            if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
                return { ok: false, error: 'Cuenta bloqueada por ' + LOCKOUT_MINUTES + ' min tras ' + MAX_FAILED_ATTEMPTS + ' intentos fallidos.' };
            }
            return { ok: false, error: 'Usuario o contrasena incorrectos. Intentos restantes: ' + left };
        }
        // OK
        user.failedAttempts = 0;
        user.lockedUntil = null;
        user.lastLoginAt = new Date().toISOString();
        await dbPut(user);
        const hours = opts.remember ? (REMEMBER_SESSION_DAYS * 24) : DEFAULT_SESSION_HOURS;
        const session = {
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            loggedInAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
            remember: !!opts.remember
        };
        writeSession(session);
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('USER_LOGIN', 'user', user.id, {
                username: user.username, role: user.role
            }, 'Login: ' + user.displayName);
        }
        return { ok: true, session, mustChangePassword: !!user.mustChangePassword };
    }

    async function verifyPin(username, pin) {
        const user = await dbGetByUsername(username);
        if (!user) return false;
        const h = await hashWithSalt(pin, user.pinSalt);
        return h === user.pinHash;
    }

    function logout() {
        const sess = readSession();
        if (sess && global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('USER_LOGOUT', 'user', sess.userId || sess.username, {
                username: sess.username
            }, 'Logout: ' + sess.displayName);
        }
        writeSession(null);
    }

    // ====================================================================
    // RECOVERY
    // ====================================================================
    async function getSecretQuestion(username) {
        const user = await dbGetByUsername(username);
        if (!user) return null;
        return { username: user.username, displayName: user.displayName, question: user.secretQuestion };
    }

    async function resetPasswordBySecret(username, answer, newPassword) {
        const user = await dbGetByUsername(username);
        if (!user) return { ok: false, error: 'Usuario no encontrado' };
        const candidateHash = await hashWithSalt(normalizeAnswer(answer), user.secretAnswerSalt);
        if (candidateHash !== user.secretAnswerHash) {
            if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                global.AuditTrail.logAction('USER_RECOVERY_FAILED', 'user', user.id, {
                    username: user.username
                }, 'Recovery con respuesta incorrecta: ' + user.username);
            }
            return { ok: false, error: 'Respuesta incorrecta' };
        }
        const passwordSalt = randomSalt();
        user.passwordHash = await hashWithSalt(newPassword, passwordSalt);
        user.passwordSalt = passwordSalt;
        user.failedAttempts = 0;
        user.lockedUntil = null;
        user.mustChangePassword = false;
        await dbPut(user);
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('USER_PASSWORD_RESET', 'user', user.id, {
                username: user.username, method: 'secret_question'
            }, 'Password reset: ' + user.displayName);
        }
        return { ok: true };
    }

    async function changePassword(username, oldPassword, newPassword) {
        const user = await dbGetByUsername(username);
        if (!user) return { ok: false, error: 'Usuario no encontrado' };
        const oldH = await hashWithSalt(oldPassword, user.passwordSalt);
        if (oldH !== user.passwordHash) {
            return { ok: false, error: 'Contrasena actual incorrecta' };
        }
        const passwordSalt = randomSalt();
        user.passwordHash = await hashWithSalt(newPassword, passwordSalt);
        user.passwordSalt = passwordSalt;
        user.mustChangePassword = false;
        await dbPut(user);
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('USER_PASSWORD_CHANGE', 'user', user.id, {
                username: user.username
            }, 'Password change: ' + user.displayName);
        }
        return { ok: true };
    }

    // ====================================================================
    // USER MANAGEMENT (admin only)
    // ====================================================================
    async function listUsers() {
        const all = await dbListAll();
        // Sanear: NO devolver hashes (UI no los necesita)
        return all.map(u => ({
            id: u.id, username: u.username, displayName: u.displayName,
            email: u.email, role: u.role,
            createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
            failedAttempts: u.failedAttempts || 0,
            lockedUntil: u.lockedUntil,
            builtin: !!u.builtin
        }));
    }

    async function createUser(input, byAdminUsername) {
        if (!requireRole(['admin'])) throw new Error('Solo admin puede crear usuarios');
        const username = String(input.username || '').toLowerCase().trim();
        if (!username) throw new Error('username requerido');
        if (await dbGetByUsername(username)) throw new Error('Username ya existe');
        const passwordSalt = randomSalt();
        const pinSalt = randomSalt();
        const answerSalt = randomSalt();
        const entry = {
            id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
            username,
            displayName: input.displayName || username,
            email: input.email || '',
            role: input.role || 'user',
            passwordHash: await hashWithSalt(input.password || 'temp1234', passwordSalt),
            passwordSalt,
            pinHash: await hashWithSalt(input.pin || '0000', pinSalt),
            pinSalt,
            secretQuestion: input.secretQuestion || 'Pregunta de recuperacion?',
            secretAnswerHash: await hashWithSalt(normalizeAnswer(input.secretAnswer || 'cambiar'), answerSalt),
            secretAnswerSalt: answerSalt,
            createdAt: new Date().toISOString(),
            lastLoginAt: null,
            failedAttempts: 0,
            lockedUntil: null,
            mustChangePassword: !!input.mustChangePassword,
            builtin: false
        };
        await dbPut(entry);
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('USER_CREATE', 'user', entry.id, {
                username, role: entry.role, createdBy: byAdminUsername || 'admin'
            }, 'Usuario creado: ' + entry.displayName);
        }
        return entry;
    }

    async function deleteUser(id) {
        if (!requireRole(['admin'])) throw new Error('Solo admin puede borrar usuarios');
        const user = await dbGet(id);
        if (!user) return;
        if (user.builtin) throw new Error('Usuarios builtin no se pueden eliminar');
        await dbDelete(id);
        if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
            global.AuditTrail.logAction('USER_DELETE', 'user', id, {
                username: user.username
            }, 'Usuario eliminado: ' + user.displayName);
        }
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    VS.auth.bootstrap = bootstrap;
    VS.auth.listUsers = listUsers;
    VS.auth.getUserByUsername = dbGetByUsername;
    VS.auth.createUser = createUser;
    VS.auth.deleteUser = deleteUser;
    VS.auth.changePassword = changePassword;
    VS.auth.resetPasswordBySecret = resetPasswordBySecret;
    VS.auth.getSecretQuestion = getSecretQuestion;
    VS.auth.login = login;
    VS.auth.verifyPin = verifyPin;
    VS.auth.logout = logout;
    VS.auth.getActiveSession = getActiveSession;
    VS.auth.isLoggedIn = isLoggedIn;
    VS.auth.requireRole = requireRole;

})(window);
