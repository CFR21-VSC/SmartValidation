'use strict';

(function (global) {
    const _api = async (method, path, body) => {
        const res = await fetch(path, {
            method,
            credentials: 'include',
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok && data.ok === undefined) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        return data;
    };

    let _projects = [];

    // ── Abrir / cerrar modal ─────────────────────────────────────────────────

    global.openClientPortalUsers = async function () {
        const m = document.getElementById('modalClientPortalUsers');
        m.style.display = 'flex';
        _hideCreateForm();
        _hidePinForm();
        _hideProjectsPanel();
        await _loadUsers();
    };

    global.closeClientPortalUsers = function () {
        document.getElementById('modalClientPortalUsers').style.display = 'none';
    };

    // ── Listar usuarios ──────────────────────────────────────────────────────

    async function _loadUsers() {
        const tbody = document.getElementById('cpuTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="color:#8FA8C4;padding:16px;text-align:center">Cargando...</td></tr>';
        try {
            const data = await _api('GET', '/admin/users');
            if (!data.ok) {
                tbody.innerHTML = `<tr><td colspan="5" style="color:#e06060;padding:16px">${_esc(data.error || 'Error al cargar usuarios')}</td></tr>`;
                return;
            }
            _renderUsers(data.users || []);
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" style="color:#e06060;padding:16px">Error: ${_esc(e.message)}</td></tr>`;
        }
    }

    function _renderUsers(users) {
        const tbody = document.getElementById('cpuTableBody');
        if (!users.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="color:#8FA8C4;padding:20px;text-align:center">Sin usuarios. Usá "+ Nuevo usuario" para crear el primero.</td></tr>';
            return;
        }
        tbody.innerHTML = users.map(u => `
            <tr style="border-bottom:1px solid rgba(45,82,120,0.4);" data-uid="${_esc(u.id)}">
                <td style="padding:8px 10px;color:#E0EAF5;font-weight:600">${_esc(u.username)}</td>
                <td style="padding:8px 10px;color:#B0C8E0">${_esc(u.display_name || '—')}</td>
                <td style="padding:8px 10px;text-align:center">
                    ${u.pin_set
                        ? '<span style="color:#7BBF5A;font-size:12px">✓ Seteado</span>'
                        : '<span style="color:#E09050;font-size:12px">Pendiente</span>'}
                </td>
                <td style="padding:8px 10px;text-align:center;color:#B0C8E0">${u.project_count || 0}</td>
                <td style="padding:8px 10px;text-align:right;white-space:nowrap">
                    <button onclick="cpuShowProjects('${_esc(u.id)}','${_esc(u.username)}')"
                        style="margin-right:4px;background:#1E4A6E;border:1px solid #2D6A9F;color:#B0D0F0;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px">
                        📁 Proyectos</button>
                    <button onclick="cpuShowPinForm('${_esc(u.id)}','${_esc(u.username)}')"
                        style="margin-right:4px;background:#1E4A6E;border:1px solid #2D6A9F;color:#B0D0F0;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px">
                        🔑 PIN</button>
                    <button onclick="cpuDeleteUser('${_esc(u.id)}','${_esc(u.username)}')"
                        style="background:#5C1A1A;border:1px solid #8B2020;color:#F0A0A0;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px">
                        ✕ Borrar</button>
                </td>
            </tr>
        `).join('');
    }

    // ── Crear usuario ────────────────────────────────────────────────────────

    global.cpuShowCreateForm = function () {
        _hideProjectsPanel();
        _hidePinForm();
        const f = document.getElementById('cpuCreateForm');
        f.style.display = 'block';
        document.getElementById('cpuNewUser').value = '';
        document.getElementById('cpuNewDisplay').value = '';
        document.getElementById('cpuNewPin').value = '';
        document.getElementById('cpuNewUser').focus();
    };

    global.cpuSubmitCreate = async function () {
        const username = document.getElementById('cpuNewUser').value.trim();
        const display  = document.getElementById('cpuNewDisplay').value.trim();
        const pin      = document.getElementById('cpuNewPin').value.trim();
        if (!username) { alert('El nombre de usuario es requerido'); return; }
        const body = { username, display_name: display || username };
        if (pin) body.initial_pin = pin;
        try {
            const res = await _api('POST', '/admin/users', body);
            if (res.ok) {
                _hideCreateForm();
                await _loadUsers();
            } else {
                alert(res.error || 'Error al crear usuario');
            }
        } catch (e) {
            alert('Error al crear usuario: ' + e.message);
        }
    };

    function _hideCreateForm() {
        document.getElementById('cpuCreateForm').style.display = 'none';
    }

    // ── Resetear PIN ─────────────────────────────────────────────────────────

    global.cpuShowPinForm = function (userId, username) {
        _hideProjectsPanel();
        _hideCreateForm();
        const panel = document.getElementById('cpuPinPanel');
        panel.dataset.uid = userId;
        document.getElementById('cpuPinUsername').textContent = username;
        document.getElementById('cpuNewPinValue').value = '';
        panel.style.display = 'block';
    };

    global.cpuSubmitPin = async function () {
        const panel  = document.getElementById('cpuPinPanel');
        const userId = panel.dataset.uid;
        const pin    = document.getElementById('cpuNewPinValue').value.trim();
        if (!pin) { alert('Ingresá un PIN de 4 a 6 dígitos'); return; }
        try {
            const res = await _api('POST', `/admin/users/${userId}/pin`, { pin });
            if (res.ok) {
                alert('PIN actualizado. El usuario deberá cambiarlo al entrar.');
                _hidePinForm();
                await _loadUsers();
            } else {
                alert(res.error || 'Error al resetear PIN');
            }
        } catch (e) {
            alert('Error al resetear PIN: ' + e.message);
        }
    };

    function _hidePinForm() {
        document.getElementById('cpuPinPanel').style.display = 'none';
    }

    // ── Proyectos asignados ──────────────────────────────────────────────────

    global.cpuShowProjects = async function (userId, username) {
        _hideCreateForm();
        _hidePinForm();
        const panel = document.getElementById('cpuProjectsPanel');
        panel.dataset.uid = userId;
        document.getElementById('cpuProjectsUsername').textContent = username;
        document.getElementById('cpuProjectsList').innerHTML = '<span style="color:#8FA8C4">Cargando...</span>';
        panel.style.display = 'block';

        try {
            if (!_projects.length) {
                const pd = await _api('GET', '/api/projects');
                _projects = pd.projects || [];
            }
            const userData = await _api('GET', `/admin/users/${userId}`);
            if (!userData.ok) {
                document.getElementById('cpuProjectsList').innerHTML = `<span style="color:#e06060">${_esc(userData.error)}</span>`;
                return;
            }
            const access = (userData.user || {}).access || [];
            _renderProjectList(userId, access);
        } catch (e) {
            document.getElementById('cpuProjectsList').innerHTML = `<span style="color:#e06060">Error: ${_esc(e.message)}</span>`;
        }
    };

    function _renderProjectList(userId, access) {
        const container = document.getElementById('cpuProjectsList');
        const assignedIds = access.map(a => a.project_id);
        const available   = _projects.filter(p => !assignedIds.includes(p.id));

        let html = '';

        if (access.length) {
            html += '<div style="margin-bottom:12px">';
            html += '<div style="font-size:11px;color:#8FA8C4;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Acceso actual</div>';
            html += access.map(a => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:rgba(30,74,110,0.3);border-radius:4px;margin-bottom:4px">
                    <span style="color:#B0D0F0;font-size:12px">📁 ${_esc(a.project_name || a.project_id)}
                        <span style="color:#8FA8C4;margin-left:6px">(${_esc(a.access_level)})</span>
                    </span>
                    <button onclick="cpuRevokeAccess('${_esc(userId)}','${_esc(a.project_id)}')"
                        style="background:#5C1A1A;border:1px solid #8B2020;color:#F0A0A0;border-radius:3px;padding:2px 7px;cursor:pointer;font-size:11px">
                        Revocar</button>
                </div>`).join('');
            html += '</div>';
        }

        if (available.length) {
            html += '<div style="font-size:11px;color:#8FA8C4;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Asignar proyecto</div>';
            html += '<div style="display:flex;gap:6px;align-items:center">';
            html += `<select id="cpuSelectProject" style="flex:1;background:#0E2A40;border:1px solid #2D5278;color:#E0EAF5;padding:5px 8px;border-radius:4px;font-size:12px">
                <option value="">Seleccioná un proyecto...</option>
                ${available.map(p => `<option value="${_esc(p.id)}">${_esc(p.name || p.id)}</option>`).join('')}
            </select>`;
            html += `<select id="cpuSelectLevel" style="background:#0E2A40;border:1px solid #2D5278;color:#E0EAF5;padding:5px 8px;border-radius:4px;font-size:12px">
                <option value="read">Solo lectura</option>
                <option value="sign">Puede firmar</option>
            </select>`;
            html += `<button onclick="cpuGrantAccess('${_esc(userId)}')"
                style="background:#1A5E1A;border:1px solid #2A8A2A;color:#A0F0A0;border-radius:4px;padding:5px 12px;cursor:pointer;font-size:12px">
                Asignar</button>`;
            html += '</div>';
        } else if (!access.length) {
            html += '<p style="color:#8FA8C4;font-size:12px">No hay proyectos disponibles. Creá un proyecto primero desde el panel principal.</p>';
        } else {
            html += '<p style="color:#8FA8C4;font-size:12px;margin-top:8px">Todos los proyectos ya están asignados.</p>';
        }

        container.innerHTML = html;
    }

    global.cpuGrantAccess = async function (userId) {
        const projectId = document.getElementById('cpuSelectProject').value;
        const level     = document.getElementById('cpuSelectLevel').value;
        if (!projectId) { alert('Seleccioná un proyecto'); return; }
        try {
            const res = await _api('POST', `/admin/users/${userId}/access`, { project_id: projectId, access_level: level });
            if (res.ok) {
                _projects = [];  // invalidar cache
                const username = document.getElementById('cpuProjectsUsername').textContent;
                await cpuShowProjects(userId, username);
                await _loadUsers();
            } else {
                alert(res.error || 'Error al asignar acceso');
            }
        } catch (e) {
            alert('Error al asignar acceso: ' + e.message);
        }
    };

    global.cpuRevokeAccess = async function (userId, projectId) {
        if (!confirm('¿Revocar acceso a este proyecto?')) return;
        try {
            const res = await _api('DELETE', `/admin/users/${userId}/access/${projectId}`);
            if (res.ok) {
                const username = document.getElementById('cpuProjectsUsername').textContent;
                await cpuShowProjects(userId, username);
                await _loadUsers();
            } else {
                alert(res.error || 'Error al revocar acceso');
            }
        } catch (e) {
            alert('Error al revocar acceso: ' + e.message);
        }
    };

    global.cpuDeleteUser = async function (userId, username) {
        if (!confirm(`¿Eliminar usuario "${username}"?\nEsta acción no se puede deshacer.`)) return;
        try {
            const res = await _api('DELETE', `/admin/users/${userId}`);
            if (res.ok) {
                _hideProjectsPanel();
                await _loadUsers();
            } else {
                alert(res.error || 'Error al eliminar usuario');
            }
        } catch (e) {
            alert('Error al eliminar usuario: ' + e.message);
        }
    };

    function _hideProjectsPanel() {
        document.getElementById('cpuProjectsPanel').style.display = 'none';
    }

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})(window);
