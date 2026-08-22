'use strict';

(function (global) {

    // ── API helper ─────────────────────────────────────────────────────────────

    const _api = async (method, path, body) => {
        const res = await fetch(path, {
            method,
            credentials: 'include',
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok && data.ok === undefined) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    };

    // ── Estado interno ─────────────────────────────────────────────────────────

    let _activeFilter = 'all';   // 'all' | 'admin' | 'auditor' | 'client'
    let _projects = [];
    let _editingUserId = null;

    const ROLE_LABELS = { admin: 'Admin', auditor: 'Auditor', client: 'Cliente' };
    const ROLE_COLORS = {
        admin:   { bg: '#1A3A6E', border: '#2D5AAF', text: '#90C0F0' },
        auditor: { bg: '#2A3A1A', border: '#4A7A2D', text: '#90D080' },
        client:  { bg: '#3A2A1A', border: '#8A5A2D', text: '#D0A070' },
    };

    function _badge(role) {
        const c = ROLE_COLORS[role] || ROLE_COLORS.client;
        return `<span style="background:${c.bg};border:1px solid ${c.border};color:${c.text};
            padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;
            letter-spacing:0.5px;text-transform:uppercase">${ROLE_LABELS[role] || role}</span>`;
    }

    function _esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Abrir / cerrar modal ───────────────────────────────────────────────────

    global.openUserMgmt = async function () {
        document.getElementById('umModal').style.display = 'flex';
        _hideAllPanels();
        _projects = [];
        await _loadUsers();
    };

    global.closeUserMgmt = function () {
        document.getElementById('umModal').style.display = 'none';
    };

    // ── Filtro por rol ─────────────────────────────────────────────────────────

    global.umSetFilter = function (role) {
        _activeFilter = role;
        document.querySelectorAll('.um-filter-btn').forEach(b => {
            b.style.background   = b.dataset.role === role ? '#2A5A8F' : 'rgba(255,255,255,0.07)';
            b.style.borderColor  = b.dataset.role === role ? '#3A7ABF' : 'rgba(255,255,255,0.15)';
        });
        _loadUsers();
    };

    // ── Cargar lista de usuarios ───────────────────────────────────────────────

    async function _loadUsers() {
        const tbody = document.getElementById('umTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="color:#8FA8C4;padding:16px;text-align:center">Cargando...</td></tr>';
        try {
            const qs = _activeFilter !== 'all' ? `?role=${_activeFilter}` : '';
            const data = await _api('GET', `/admin/users${qs}`);
            if (!data.ok) { _showTableMsg(data.error || 'Error'); return; }
            _renderTable(data.users || []);
        } catch (e) {
            _showTableMsg('Error: ' + e.message, true);
        }
    }

    function _showTableMsg(msg, isError) {
        document.getElementById('umTableBody').innerHTML =
            `<tr><td colspan="5" style="color:${isError ? '#e06060' : '#8FA8C4'};padding:16px;text-align:center">${_esc(msg)}</td></tr>`;
    }

    function _renderTable(users) {
        const tbody = document.getElementById('umTableBody');
        if (!users.length) {
            _showTableMsg('Sin usuarios. Usá "+ Nuevo usuario" para crear el primero.');
            return;
        }
        const now = Date.now() / 1000;
        tbody.innerHTML = users.map(u => {
            const inactive = !u.is_active;
            const isLocked = u.locked_until && u.locked_until > now;
            const minsLeft = isLocked ? Math.ceil((u.locked_until - now) / 60) : 0;
            const style = inactive ? 'opacity:0.5;' : '';
            const lockBadge = isLocked
                ? ` <span style="color:#E06060;font-size:10px" title="Bloqueada ${minsLeft} min">[🔒 ${minsLeft}m]</span>`
                : '';
            return `<tr style="border-bottom:1px solid rgba(45,82,120,0.4);${style}" data-uid="${_esc(u.id)}">
                <td style="padding:8px 10px;color:#E0EAF5;font-weight:600">${_esc(u.username)}${inactive ? ' <span style="color:#E06060;font-size:10px">[inactivo]</span>' : ''}${lockBadge}</td>
                <td style="padding:8px 10px;color:#B0C8E0">${_esc(u.display_name || '—')}</td>
                <td style="padding:8px 10px">${_badge(u.role)}</td>
                <td style="padding:8px 10px;text-align:center;color:#B0C8E0;font-size:12px">
                    ${u.role === 'client'
                        ? (u.pin_set ? '<span style="color:#7BBF5A">✓ PIN</span>' : '<span style="color:#E09050">Sin PIN</span>')
                        : '<span style="color:#5A8AAA">·</span>'}
                </td>
                <td style="padding:8px 10px;text-align:right;white-space:nowrap">
                    ${isLocked ? `<button onclick="umUnlockUser('${_esc(u.id)}','${_esc(u.username)}')"
                        class="um-btn um-btn-warn" title="Desbloquear cuenta">🔓 Desbloquear</button>` : ''}
                    ${u.role === 'client' ? `<button onclick="umShowProjects('${_esc(u.id)}','${_esc(u.username)}')"
                        class="um-btn um-btn-blue">📁</button>` : ''}
                    ${u.role === 'client' ? `<button onclick="umShowPinForm('${_esc(u.id)}','${_esc(u.username)}')"
                        class="um-btn um-btn-blue">🔑 PIN</button>` : `<button onclick="umShowPasswordForm('${_esc(u.id)}','${_esc(u.username)}')"
                        class="um-btn um-btn-blue">🔑 Clave</button>`}
                    <button onclick="umToggleActive('${_esc(u.id)}', ${u.is_active})"
                        class="um-btn ${u.is_active ? 'um-btn-warn' : 'um-btn-blue'}">${u.is_active ? 'Suspender' : 'Activar'}</button>
                    <button onclick="umDeleteUser('${_esc(u.id)}','${_esc(u.username)}')"
                        class="um-btn um-btn-red">✕</button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Crear usuario ──────────────────────────────────────────────────────────

    global.umShowCreate = function () {
        _hideAllPanels();
        _editingUserId = null;
        document.getElementById('umCreatePanel').style.display = 'block';
        document.getElementById('umCreateRole').value = 'client';
        _umUpdateCreateFields();
        document.getElementById('umCreateUsername').value = '';
        document.getElementById('umCreateDisplay').value = '';
        document.getElementById('umCreateUsername').focus();
    };

    global.umUpdateCreateFields = _umUpdateCreateFields;
    function _umUpdateCreateFields() {
        const role = document.getElementById('umCreateRole').value;
        document.getElementById('umFieldPassword').style.display = role !== 'client' ? 'block' : 'none';
        document.getElementById('umFieldPin').style.display      = role === 'client'  ? 'block' : 'none';
    }

    global.umSubmitCreate = async function () {
        const username = document.getElementById('umCreateUsername').value.trim();
        const display  = document.getElementById('umCreateDisplay').value.trim();
        const role     = document.getElementById('umCreateRole').value;
        const password = document.getElementById('umCreatePassword').value.trim();
        const pin      = document.getElementById('umCreatePin').value.trim();

        if (!username) { alert('El nombre de usuario es requerido'); return; }

        const body = { username, display_name: display || username, role };
        if (role === 'client' && pin) body.pin = pin;
        if (role !== 'client')        body.password = password;

        try {
            const res = await _api('POST', '/admin/users', body);
            if (res.ok) {
                _hideAllPanels();
                await _loadUsers();
            } else {
                alert(res.error || 'Error al crear usuario');
            }
        } catch (e) {
            alert('Error: ' + e.message);
        }
    };

    // ── Cambiar contraseña (admin/auditor) ─────────────────────────────────────

    global.umShowPasswordForm = function (userId, username) {
        _hideAllPanels();
        const panel = document.getElementById('umPasswordPanel');
        panel.dataset.uid = userId;
        document.getElementById('umPwdUsername').textContent = username;
        document.getElementById('umNewPassword').value = '';
        panel.style.display = 'block';
    };

    global.umSubmitPassword = async function () {
        const panel    = document.getElementById('umPasswordPanel');
        const userId   = panel.dataset.uid;
        const password = document.getElementById('umNewPassword').value.trim();
        if (!password) { alert('Ingresá la nueva contraseña'); return; }
        try {
            const res = await _api('POST', `/admin/users/${userId}/password`, { password });
            if (res.ok) {
                alert('Contraseña actualizada.');
                _hideAllPanels();
            } else {
                alert(res.error || 'Error al cambiar contraseña');
            }
        } catch (e) { alert('Error: ' + e.message); }
    };

    // ── Resetear PIN (cliente) ─────────────────────────────────────────────────

    global.umShowPinForm = function (userId, username) {
        _hideAllPanels();
        const panel = document.getElementById('umPinPanel');
        panel.dataset.uid = userId;
        document.getElementById('umPinUsername').textContent = username;
        document.getElementById('umNewPin').value = '';
        panel.style.display = 'block';
    };

    global.umSubmitPin = async function () {
        const panel  = document.getElementById('umPinPanel');
        const userId = panel.dataset.uid;
        const pin    = document.getElementById('umNewPin').value.trim();
        if (!pin) { alert('Ingresá un PIN de 4 a 6 dígitos'); return; }
        try {
            const res = await _api('POST', `/admin/users/${userId}/pin`, { pin });
            if (res.ok) {
                alert('PIN temporal seteado. El cliente deberá cambiarlo al entrar.');
                _hideAllPanels();
                await _loadUsers();
            } else {
                alert(res.error || 'Error al resetear PIN');
            }
        } catch (e) { alert('Error: ' + e.message); }
    };

    // ── Suspender / activar ────────────────────────────────────────────────────

    global.umToggleActive = async function (userId, currentlyActive) {
        const action = currentlyActive ? 'suspender' : 'activar';
        if (!confirm(`¿${action.charAt(0).toUpperCase() + action.slice(1)} este usuario?`)) return;
        try {
            const res = await _api('PATCH', `/admin/users/${userId}`, { is_active: !currentlyActive });
            if (res.ok) await _loadUsers();
            else alert(res.error || 'Error');
        } catch (e) { alert('Error: ' + e.message); }
    };

    // ── Desbloquear cuenta ────────────────────────────────────────────────────

    global.umUnlockUser = async function (userId, username) {
        if (!confirm(`¿Desbloquear la cuenta de "${username}"?\nSe resetearán los intentos fallidos.`)) return;
        try {
            const res = await _api('POST', `/admin/users/${userId}/unlock`);
            if (res.ok) { await _loadUsers(); }
            else alert(res.error || 'Error al desbloquear');
        } catch (e) { alert('Error: ' + e.message); }
    };

    // ── Borrar usuario ─────────────────────────────────────────────────────────

    global.umDeleteUser = async function (userId, username) {
        if (!confirm(`¿Eliminar usuario "${username}"?\nEsta acción no se puede deshacer.`)) return;
        try {
            const res = await _api('DELETE', `/admin/users/${userId}`);
            if (res.ok) { _hideAllPanels(); await _loadUsers(); }
            else alert(res.error || 'Error al eliminar');
        } catch (e) { alert('Error: ' + e.message); }
    };

    // ── Proyectos asignados (solo clients) ────────────────────────────────────

    global.umShowProjects = async function (userId, username) {
        _hideAllPanels();
        const panel = document.getElementById('umProjectsPanel');
        panel.dataset.uid = userId;
        document.getElementById('umProjUsername').textContent = username;
        document.getElementById('umProjList').innerHTML = '<span style="color:#8FA8C4">Cargando...</span>';
        panel.style.display = 'block';

        try {
            if (!_projects.length) {
                const pd = await _api('GET', '/api/projects');
                _projects = pd.projects || [];
            }
            const ud = await _api('GET', `/admin/users/${userId}`);
            if (!ud.ok) { document.getElementById('umProjList').innerHTML = `<span style="color:#e06060">${_esc(ud.error)}</span>`; return; }
            _renderProjectList(userId, (ud.user || {}).access || []);
        } catch (e) {
            document.getElementById('umProjList').innerHTML = `<span style="color:#e06060">Error: ${_esc(e.message)}</span>`;
        }
    };

    function _renderProjectList(userId, access) {
        const container    = document.getElementById('umProjList');
        const assignedIds  = access.map(a => a.project_id);
        const available    = _projects.filter(p => !assignedIds.includes(p.id));
        let html = '';

        if (access.length) {
            html += '<div style="font-size:11px;color:#8FA8C4;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Acceso actual</div>';
            html += access.map(a => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:rgba(30,74,110,0.3);border-radius:4px;margin-bottom:4px">
                    <span style="color:#B0D0F0;font-size:12px">📁 ${_esc(a.project_name || a.project_id)}
                        <span style="color:#8FA8C4;margin-left:6px">(${_esc(a.access_level)})</span>
                    </span>
                    <button onclick="umRevokeAccess('${_esc(userId)}','${_esc(a.project_id)}')" class="um-btn um-btn-red" style="padding:2px 8px;font-size:11px">Revocar</button>
                </div>`).join('');
        }

        if (available.length) {
            html += '<div style="font-size:11px;color:#8FA8C4;margin:10px 0 6px;text-transform:uppercase;letter-spacing:0.5px">Asignar proyecto</div>';
            html += '<div style="display:flex;gap:6px;align-items:center">';
            html += `<select id="umSelProject" style="flex:1;background:#0E2A40;border:1px solid #2D5278;color:#E0EAF5;padding:5px 8px;border-radius:4px;font-size:12px">
                <option value="">Seleccioná...</option>
                ${available.map(p => `<option value="${_esc(p.id)}">${_esc(p.name || p.id)}</option>`).join('')}
            </select>
            <select id="umSelLevel" style="background:#0E2A40;border:1px solid #2D5278;color:#E0EAF5;padding:5px 8px;border-radius:4px;font-size:12px">
                <option value="read">Solo lectura</option>
                <option value="sign">Puede firmar</option>
            </select>
            <button onclick="umGrantAccess('${_esc(userId)}')" class="um-btn um-btn-green">Asignar</button>`;
            html += '</div>';
        } else if (!access.length) {
            html += '<p style="color:#8FA8C4;font-size:12px;margin-top:8px">No hay proyectos disponibles todavía.</p>';
        }

        container.innerHTML = html;
    }

    global.umGrantAccess = async function (userId) {
        const projectId = document.getElementById('umSelProject').value;
        const level     = document.getElementById('umSelLevel').value;
        if (!projectId) { alert('Seleccioná un proyecto'); return; }
        try {
            const res = await _api('POST', `/admin/users/${userId}/access`, { project_id: projectId, access_level: level });
            if (res.ok) {
                _projects = [];
                const username = document.getElementById('umProjUsername').textContent;
                await umShowProjects(userId, username);
                await _loadUsers();
            } else {
                alert(res.error || 'Error al asignar');
            }
        } catch (e) { alert('Error: ' + e.message); }
    };

    global.umRevokeAccess = async function (userId, projectId) {
        if (!confirm('¿Revocar acceso a este proyecto?')) return;
        try {
            const res = await _api('DELETE', `/admin/users/${userId}/access/${projectId}`);
            if (res.ok) {
                const username = document.getElementById('umProjUsername').textContent;
                await umShowProjects(userId, username);
                await _loadUsers();
            } else {
                alert(res.error || 'Error al revocar');
            }
        } catch (e) { alert('Error: ' + e.message); }
    };

    // ── Helpers UI ─────────────────────────────────────────────────────────────

    function _hideAllPanels() {
        ['umCreatePanel','umPasswordPanel','umPinPanel','umProjectsPanel']
            .forEach(id => document.getElementById(id).style.display = 'none');
    }

    global.umHidePanel = function (id) {
        document.getElementById(id).style.display = 'none';
    };

})(window);
