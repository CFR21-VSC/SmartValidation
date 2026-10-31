/**
 * storage-server.js
 * Write-through adapter: persists project snapshots and AI documents to the
 * server-side SQLite database in the background. The primary storage (IndexedDB /
 * localStorage) remains unchanged and continues to work offline or if the server
 * is unavailable.
 *
 * Public API:
 *   VS.Storage.isAvailable()  → true if server responded on last check
 *   VS.Storage.syncSnapshot(projectId, snapshot)  → fire-and-forget
 *   VS.Storage.listProjects()  → Promise<project[]>
 *   VS.Storage.getDocument(projectId, docType)  → Promise<doc|null>
 */

(function (global) {
  "use strict";

  const BASE = "";               // same origin — server.py serves the API
  let _available = false;        // set to true once a successful /api/projects response arrives

  function _showSupersededModal() {
    if (document.getElementById("_smartSessionSuperseded")) return;
    const el = document.createElement("div");
    el.id = "_smartSessionSuperseded";
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;";
    el.innerHTML =
      '<div style="background:#1e293b;color:#f1f5f9;padding:36px 32px;border-radius:12px;max-width:380px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);">' +
      '<div style="font-size:36px;margin-bottom:14px;">⚡</div>' +
      '<div style="font-size:17px;font-weight:700;margin-bottom:8px;">Sesión reemplazada</div>' +
      '<div style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:22px;">Iniciaste sesión desde otro navegador o dispositivo.<br>Tu sesión aquí fue cerrada automáticamente.</div>' +
      '<button onclick="window.location.replace(\'/session-ended.html\')" style="background:#0891b2;color:#fff;border:none;padding:11px 28px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;width:100%;">Ver detalles de la desconexión</button>' +
      "</div>";
    document.body.appendChild(el);
  }

  // ── Internal fetch wrapper ──────────────────────────────────────────────────

  /** Comprime un string a gzip (null si el navegador no soporta CompressionStream: se manda sin comprimir). */
  async function _gzip(txt) {
    try {
      if (typeof CompressionStream === "undefined") return null;
      const stream = new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (_) { return null; }
  }

  async function _apiFetch(method, path, body) {
    try {
      const opts = {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) {
        const txt = JSON.stringify(body);
        const gz = txt.length > 8192 ? await _gzip(txt) : null;
        if (gz) { opts.body = gz; opts.headers["Content-Encoding"] = "gzip"; }
        else opts.body = txt;
      }
      const res = await fetch(BASE + path, opts);
      if (res.status === 401) {
        const errData = await res.json().catch(() => ({}));
        if (errData && errData.code === "SUPERSEDED") {
          _showSupersededModal();
          return null;
        }
        window.location.replace("/login.html");
        return null;
      }
      const json = await res.json();
      return { status: res.status, data: json };
    } catch (_) {
      return null;   // server unreachable — caller handles gracefully
    }
  }

  // ── Availability probe ──────────────────────────────────────────────────────

  async function _probe() {
    const r = await _apiFetch("GET", "/api/projects");
    _available = !!(r && r.status === 200);
    return _available;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  const _conflicts = {};  // projectId -> true si el servidor rechazó una subida por copia atrasada
  const _inflightImg = {};  // ruta de imagen -> promesa en curso (evita pedir la misma imagen dos veces a la vez)
  const _dqueues = {};    // projectId -> cola de sincronizaciones por diferencias
  const _queues = {};     // projectId -> cola de subidas en vivo (una en vuelo + la última pendiente)
  const _lastSnap = {};   // projectId -> último snapshot descargado
  const _lastRev = {};    // projectId -> revisión del último snapshot descargado


  // ── Sincronización por diferencias (delta) ──────────────────────────────────
  // El cliente guarda la última versión conocida del servidor ("base") y envía solo lo que cambió
  // respecto de ella. El servidor fusiona por elemento y devuelve lo que otras sesiones cambiaron.

  const KINDS = ["tests", "groups", "protocols"];
  const META_KEYS = ["systemInfo", "executor", "projectData", "exportConfig"];

  function _stable(o) {
    if (Array.isArray(o)) return o.map(_stable);
    if (o && typeof o === "object") {
      const r = {};
      Object.keys(o).sort().forEach((k) => { if (k !== "_srev") r[k] = _stable(o[k]); });
      return r;
    }
    return o;
  }
  function _same(a, b) { return JSON.stringify(_stable(a)) === JSON.stringify(_stable(b)); }
  function _clean(o) { return JSON.parse(JSON.stringify(o, (k, v) => (k === "_srev" ? undefined : v))); }
  function _validId(i) { return (typeof i === "string" && i !== "") || typeof i === "number"; }

  /** Cambios de `cur` respecto de `base` (ambos snapshots completos). {} si no hay diferencias. */
  function computeDelta(base, cur) {
    const out = {};
    KINDS.forEach((kind) => {
      const b = new Map(), c = new Map();
      (base[kind] || []).forEach((e) => { if (e && _validId(e.id)) b.set(e.id, e); });
      (cur[kind] || []).forEach((e) => { if (e && _validId(e.id)) c.set(e.id, e); });
      const upsert = [], remove = [];
      c.forEach((e, id) => { const be = b.get(id); if (!be || !_same(be, e)) upsert.push(_clean(e)); });
      b.forEach((_e, id) => { if (!c.has(id)) remove.push(id); });
      if (upsert.length || remove.length) out[kind] = { upsert, remove };
    });
    const meta = {};
    META_KEYS.forEach((k) => { if (k in cur && !_same(base[k], cur[k])) meta[k] = _clean(cur[k]); });
    if (Object.keys(meta).length) out.meta = meta;
    return out;
  }

  /** Snapshot resultante de aplicar lo que cambió en el servidor (serverChanges) sobre `snap`. Función pura. */
  function mergeServerChanges(snap, sc) {
    const out = JSON.parse(JSON.stringify(snap));
    sc = sc || {};
    KINDS.forEach((kind) => {
      const lst = out[kind] || (out[kind] = []);
      (sc[kind] || []).forEach((srv) => {
        const i = lst.findIndex((e) => e && e.id === srv.id);
        if (i >= 0) lst[i] = JSON.parse(JSON.stringify(srv)); else lst.push(JSON.parse(JSON.stringify(srv)));
      });
      const gone = ((sc.removed || {})[kind] || []).map(String);
      out[kind] = lst.filter((e) => !(e && gone.includes(String(e.id))));
    });
    Object.keys(sc.meta || {}).forEach((k) => { out[k] = JSON.parse(JSON.stringify(sc.meta[k])); });
    return out;
  }

  function _hasServerChanges(sc) {
    if (!sc) return false;
    return KINDS.some((k) => (sc[k] || []).length || ((sc.removed || {})[k] || []).length) || Object.keys(sc.meta || {}).length > 0;
  }

  const _bases = {};     // projectId -> { rev, snap }  (última versión conocida del servidor)
  function _loadBase(id) {
    if (_bases[id]) return _bases[id];
    try {
      const raw = localStorage.getItem("_baseSnap_" + id);
      if (raw) { _bases[id] = JSON.parse(raw); return _bases[id]; }
    } catch (_) {}
    return null;
  }
  function _saveBase(id, rev, snap) {
    const b = { rev: Number(rev) || 0, snap };
    _bases[id] = b;
    try {
      localStorage.setItem("_baseSnap_" + id, JSON.stringify(b));
      localStorage.setItem(`_serverRev_${id}`, String(b.rev));
    } catch (_) {}
  }
  function _clearBase(id) {
    delete _bases[id];
    try { localStorage.removeItem("_baseSnap_" + id); } catch (_) {}
  }

  function _postSnapshot(projectId, snapshot, projectName, baseRev) {
    // Conflicto ya detectado para este proyecto: no seguir intentando hasta que el usuario
    // baje la versión del servidor (evita insistir en cada autoguardado).
    if (_conflicts[projectId]) return Promise.resolve({ status: 409, data: { ok: false, conflict: true } });
    const body = { snapshot, baseRev: Number(baseRev) || 0 };
    if (projectName) body.projectName = String(projectName);
    return _apiFetch("POST", `/api/projects/${encodeURIComponent(projectId)}/snapshot`, body)
      .then((r) => {
        if (r && r.status === 409 && r.data && r.data.conflict) {
          _conflicts[projectId] = true;
          try { window.dispatchEvent(new CustomEvent("vs:snapshot-conflict", { detail: { projectId } })); } catch (_) {}
          return r;
        }
        if (r && r.data && r.data.ok) {
          _available = true;
          try {
            const ts = (r.data.updated_at || (Date.now() / 1000));
            localStorage.setItem(`_myLastUpload_${projectId}`, String(ts));
            // Actualizar siempre: el banner "Actualizar" solo aparece cuando OTRO usuario sube cambios.
            localStorage.setItem(`_serverSyncFrom_${projectId}`, String(ts));
            if (r.data.rev) localStorage.setItem(`_serverRev_${projectId}`, String(r.data.rev));
          } catch (_) {}
          if (r.data.rev) _saveBase(projectId, r.data.rev, _clean(snapshot));
        }
        return r;
      }).catch(() => null);
  }

  /** Un ciclo de sincronización de un proyecto: por diferencias si hay base, completo si no. */
  async function _syncOnce(projectId, snapshot, projectName, force) {
    const base = _loadBase(projectId);
    const rev = Storage.getBaseRev(projectId);
    if (!base || !base.snap || Math.abs(base.rev - rev) > 1e-6) {
      return _postSnapshot(projectId, snapshot, projectName, rev);   // sin base: guardado completo estricto
    }
    const delta = computeDelta(base.snap, snapshot);
    if (!force && !Object.keys(delta).length) return { status: 200, data: { ok: true, noop: true } };
    const r = await _apiFetch("POST", `/api/projects/${encodeURIComponent(projectId)}/snapshot/delta`,
                              { baseRev: base.rev, changes: delta });
    if (!r) return null;
    if (r.status === 409 && r.data && r.data.needFull) {
      _clearBase(projectId);
      return _postSnapshot(projectId, snapshot, projectName, rev);
    }
    if (r.status === 422 && r.data && r.data.violations) {
      // El servidor rechazó el cambio por violar las reglas de finalización (p. ej. carpeta finalizada con pruebas abiertas).
      try { window.dispatchEvent(new CustomEvent("vs:sync-rejected", { detail: { projectId, violations: r.data.violations } })); } catch (_) {}
      return r;
    }
    if (r.status === 200 && r.data && r.data.ok) {
      _available = true;
      const sc = r.data.serverChanges || {};
      // El servidor ahora tiene: lo que envié (menos lo rechazado) + lo de otras sesiones. Esa es la nueva base.
      _saveBase(projectId, r.data.rev, _clean(mergeServerChanges(snapshot, sc)));
      try {
        localStorage.setItem(`_myLastUpload_${projectId}`, String(r.data.updated_at || r.data.rev));
        localStorage.setItem(`_serverSyncFrom_${projectId}`, String(r.data.updated_at || r.data.rev));
      } catch (_) {}
      const conflicts = r.data.conflicts || [];
      if (_hasServerChanges(sc) || conflicts.length) {
        try { window.dispatchEvent(new CustomEvent("vs:server-changes", { detail: { projectId, serverChanges: sc, conflicts } })); } catch (_) {}
      }
    }
    return r;
  }

  const Storage = {
    isAvailable() { return _available; },

    /**
     * Push snapshot to server. Returns a Promise — awaitable when called from createNew()
     * so the project appears on the server before reload. Also safe as fire-and-forget.
     */
    syncSnapshot(projectId, snapshot, projectName, baseRev) {
      if (!projectId || !snapshot) return Promise.resolve(null);
      // Reintento encolado: lleva la revisión de cuando se guardó, se envía tal cual (sin fusionar con otras).
      if (baseRev !== undefined && baseRev !== null) return _postSnapshot(projectId, snapshot, projectName, Number(baseRev));
      // Subida "en vivo": una sola en vuelo por proyecto. Si llegan más mientras tanto, solo importa la
      // última, que se envía al terminar la actual con la revisión ya actualizada. Sin esto, dos subidas
      // seguidas salían con la misma base y la segunda se chocaba con la primera (conflicto falso).
      const q = _queues[projectId] || (_queues[projectId] = { busy: false, next: null, waiters: [] });
      if (q.busy) {
        q.next = { snapshot, projectName };
        return new Promise((res) => q.waiters.push(res));
      }
      q.busy = true;
      return (async () => {
        let cur = { snapshot, projectName }, r = null;
        try {
          for (;;) {
            r = await _postSnapshot(projectId, cur.snapshot, cur.projectName, Storage.getBaseRev(projectId));
            if (!q.next || (r && r.status === 409)) break;
            cur = q.next; q.next = null;
          }
        } finally {
          q.busy = false; q.next = null;
          const w = q.waiters; q.waiters = [];
          w.forEach((f) => f(r));
        }
        return r;
      })();
    },

    /**
     * Sincroniza el proyecto con el servidor (por diferencias si hay base). Una sola operación en vuelo por
     * proyecto; las que llegan mientras tanto se reducen a la última. `force` consulta aunque no haya cambios
     * locales (para traer lo que cambió en otras sesiones).
     */
    syncProject(projectId, snapshot, projectName, opts) {
      if (!projectId || !snapshot) return Promise.resolve(null);
      const force = !!(opts && opts.force);
      const q = _dqueues[projectId] || (_dqueues[projectId] = { busy: false, next: null, waiters: [] });
      if (q.busy) {
        q.next = { snapshot, projectName, force: force || (q.next && q.next.force) };
        return new Promise((res) => q.waiters.push(res));
      }
      q.busy = true;
      return (async () => {
        let cur = { snapshot, projectName, force }, r = null;
        try {
          for (;;) {
            r = await _syncOnce(projectId, cur.snapshot, cur.projectName, cur.force);
            if (!q.next || (r && r.status === 409)) break;
            cur = q.next; q.next = null;
          }
        } finally {
          q.busy = false; q.next = null;
          const w = q.waiters; q.waiters = [];
          w.forEach((f) => f(r));
        }
        return r;
      })();
    },

    hasDeltaBase(projectId) {
      const b = _loadBase(projectId);
      return !!(b && b.snap && Math.abs(b.rev - Storage.getBaseRev(projectId)) <= 1e-6);
    },

    computeDelta, mergeServerChanges,

    /** Revisión del servidor sobre la que está basada la copia local (0 = nunca bajó/subió). */
    getBaseRev(projectId) {
      try { return parseFloat(localStorage.getItem(`_serverRev_${projectId}`)) || 0; } catch (_) { return 0; }
    },

    /**
     * Adopta como base la copia del servidor (revisión + snapshot) cuando YA se aplicó a lo local.
     * Sin argumentos usa la del último getSnapshot; switchTo pasa la que guardó la entrada de IndexedDB.
     */
    adoptRev(projectId, rev, snap) {
      const r = (rev !== undefined) ? Number(rev) : _lastRev[projectId];
      if (!r) return;
      const sn = snap || (_lastRev[projectId] === r ? _lastSnap[projectId] : null);
      if (sn) _saveBase(projectId, r, _clean(sn));
      else { _clearBase(projectId); try { localStorage.setItem(`_serverRev_${projectId}`, String(r)); } catch (_) {} }
      delete _conflicts[projectId];
    },

    takeLastRev(projectId) { return _lastRev[projectId] || 0; },

    hasConflict(projectId) { return !!_conflicts[projectId]; },

    /** Revisión vigente en el servidor (consulta liviana, sin snapshot). null si no se pudo consultar. */
    async getRev(projectId) {
      const r = await _apiFetch("GET", `/api/projects/${encodeURIComponent(projectId)}/rev`);
      if (!r || r.status !== 200 || !r.data || !r.data.ok) return null;
      return Number(r.data.rev) || 0;
    },

    async listProjects() {
      const r = await _apiFetch("GET", "/api/projects");
      if (!r || r.status !== 200) return [];
      _available = true;
      return r.data.projects || [];
    },

    async getDocument(projectId, docType) {
      const r = await _apiFetch(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docType)}`
      );
      if (!r || r.status !== 200) return null;
      return r.data.document || null;
    },

    async listDocuments(projectId) {
      const r = await _apiFetch(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/documents`
      );
      if (!r || r.status !== 200) return [];
      return r.data.documents || [];
    },

    async saveDocument(projectId, docType, content, status) {
      const r = await _apiFetch(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docType)}`,
        { content, status: status || "draft" }
      );
      return !!(r && r.data && r.data.ok);
    },

    async deleteDocument(projectId, docType) {
      const r = await _apiFetch(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docType)}`
      );
      return !!(r && r.data && r.data.ok);
    },

    async deleteProject(projectId) {
      const r = await _apiFetch(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}`
      );
      return !!(r && r.data && r.data.ok);
    },

    /** Recupera el snapshot guardado en el servidor para restaurar IndexedDB. */
    async getSnapshot(projectId) {
      const r = await _apiFetch(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/snapshot`
      );
      if (!r || r.status !== 200 || !r.data.ok) return null;
      _available = true;
      _lastRev[projectId] = r.data.rev || 0;
      _lastSnap[projectId] = r.data.snapshot || null;
      return r.data.snapshot || null;
    },

    /** Sube una imagen al servidor. Retorna Promise (awaitable). rawImageId es el ID local (sin prefijo). */
    uploadEvidence(rawImageId, base64data) {
      if (!rawImageId || !base64data) return Promise.resolve(null);
      const projId = (global.ValidationSuite && global.ValidationSuite.projects &&
                      global.ValidationSuite.projects.getActiveId()) || null;
      if (!projId) return Promise.resolve(null);
      const compoundId = (projId + "_" + rawImageId).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 300);
      return _apiFetch("POST",
        `/api/projects/${encodeURIComponent(projId)}/evidence/${encodeURIComponent(compoundId)}`,
        { data: base64data }
      ).catch(() => null);
    },

    /** Índice liviano de las imágenes del proyecto {compoundId: {sha256, size}} (sin los datos). null si el servidor no lo soporta. */
    async fetchEvidenceIndex(projectId) {
      const r = await _apiFetch("GET", `/api/projects/${encodeURIComponent(projectId)}/evidence?index=1`);
      if (!r || r.status !== 200 || !r.data || !r.data.ok || !r.data.index) return null;
      return r.data.index;
    },

    /** Varias imágenes en UNA petición (máx 25): {compoundId: data URI | null}. null si el servidor no soporta lotes. */
    async fetchEvidenceBatchByCompoundIds(projectId, compoundIds) {
      const r = await _apiFetch("POST", `/api/projects/${encodeURIComponent(projectId)}/evidence/batch`, { ids: compoundIds });
      if (!r || r.status !== 200 || !r.data || !r.data.ok) return null;
      return r.data.results || {};
    },

    /** Descarga una imagen por su compoundId completo (el que devuelve el índice). */
    async fetchEvidenceByCompoundId(projectId, compoundId) {
      const r = await _apiFetch("GET", `/api/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(compoundId)}`);
      if (!r || r.status !== 200 || !r.data || !r.data.ok) return null;
      return r.data.data || null;
    },

    /** Descarga una imagen de evidencia del servidor como data URL. rawImageId es el ID local. */
    async fetchEvidence(rawImageId) {
      const projId = (global.ValidationSuite && global.ValidationSuite.projects &&
                      global.ValidationSuite.projects.getActiveId()) || null;
      if (!projId) return null;
      const compoundId = (projId + "_" + rawImageId).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 300);
      const path = `/api/projects/${encodeURIComponent(projId)}/evidence/${encodeURIComponent(compoundId)}`;
      if (_inflightImg[path]) return _inflightImg[path];
      const p = (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await _apiFetch("GET", path);
          if (r && r.status === 200 && r.data && r.data.ok) return r.data.data || null;
          if (r && r.status === 404) return null;                       // no existe: reintentar no sirve (y cuenta contra el límite)
          if (attempt < 1) await new Promise(res => setTimeout(res, 1000));
        }
        return null;
      })();
      _inflightImg[path] = p;
      p.then(() => { delete _inflightImg[path]; }, () => { delete _inflightImg[path]; });
      return p;
    },

    /** Descarga TODAS las imágenes de un proyecto del servidor. */
    async fetchAllEvidence(projectId) {
      const r = await _apiFetch("GET",
        `/api/projects/${encodeURIComponent(projectId)}/evidence`
      );
      if (!r || r.status !== 200 || !r.data.ok) return {};
      return r.data.images || {};
    },

    /**
     * Descarga múltiples imágenes del servidor.
     * rawIds: array de IDs locales (sin prefijo). Retorna {rawId: "data:..." | null}.
     */
    async fetchEvidenceBatch(rawIds) {
      if (!rawIds || !rawIds.length) return {};
      const projId = (global.ValidationSuite && global.ValidationSuite.projects &&
                      global.ValidationSuite.projects.getActiveId()) || null;
      if (!projId) return {};
      const all = await this.fetchAllEvidence(projId);
      const result = {};
      for (const rawId of rawIds) {
        const compoundId = (projId + "_" + rawId).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 300);
        result[rawId] = all[compoundId] || null;
      }
      return result;
    },

    /** Borra una imagen del servidor (R2 + DB). rawImageId es el ID local (sin prefijo). */
    async deleteEvidence(rawImageId) {
      if (!rawImageId) return;
      const projId = (global.ValidationSuite && global.ValidationSuite.projects &&
                      global.ValidationSuite.projects.getActiveId()) || null;
      if (!projId) return;
      const compoundId = (projId + "_" + rawImageId).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 300);
      await _apiFetch("DELETE",
        `/api/projects/${encodeURIComponent(projId)}/evidence/${encodeURIComponent(compoundId)}`
      ).catch(() => {});
    },

    /** Borra TODAS las imágenes y ejecuciones del proyecto del servidor (R2 + DB). */
    async deleteAllEvidence(projectId) {
      if (!projectId) return;
      return _apiFetch("DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/evidence`
      ).catch(() => null);
    },

    /** Sube un lote de imágenes al servidor en chunks de 50. rawImages: {rawId: dataUri}. */
    async bulkUploadEvidence(rawImages) {
      if (!rawImages || !Object.keys(rawImages).length) return;
      const projId = (global.ValidationSuite && global.ValidationSuite.projects &&
                      global.ValidationSuite.projects.getActiveId()) || null;
      if (!projId) return;
      // Formar compound IDs con el projId real en el momento del upload
      const images = {};
      for (const [rawId, data] of Object.entries(rawImages)) {
        const compoundId = (projId + "_" + rawId).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 300);
        images[compoundId] = data;
      }
      const entries = Object.entries(images);
      const CHUNK = 50;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = Object.fromEntries(entries.slice(i, i + CHUNK));
        await _apiFetch("POST",
          `/api/projects/${encodeURIComponent(projId)}/evidence`,
          { images: chunk }
        ).catch(() => {});
      }
    },
  };

  // Expose under VS namespace (matches existing pattern)
  global.VS = global.VS || {};
  global.VS.Storage = Storage;

  // Probe on load — non-blocking
  _probe();

  // ── Session heartbeat ────────────────────────────────────────────────────────
  // Verifica cada 30 s que la sesión siga activa. Si fue reemplazada (SUPERSEDED)
  // redirige de inmediato a session-ended.html sin esperar una acción del usuario.
  (function _startHeartbeat() {
    const INTERVAL_MS = 30000;
    async function _beat() {
      try {
        const res = await fetch("/auth/session", {
          method: "GET",
          credentials: "include",
        });
        if (res.status === 401) {
          const body = await res.json().catch(() => ({}));
          if (body && body.code === "SUPERSEDED") {
            window.location.replace("/session-ended.html");
          }
          // 401 sin SUPERSEDED = no autenticado normalmente, dejar al handler existente
        }
      } catch (_) {
        // Sin conexión — ignorar, el usuario verá el error cuando haga algo
      }
    }
    setInterval(_beat, INTERVAL_MS);
  })();
})(window);
