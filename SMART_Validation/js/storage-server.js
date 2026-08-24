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

  async function _apiFetch(method, path, body) {
    try {
      const opts = {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) opts.body = JSON.stringify(body);
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

  const Storage = {
    isAvailable() { return _available; },

    /**
     * Push snapshot to server. Returns a Promise — awaitable when called from createNew()
     * so the project appears on the server before reload. Also safe as fire-and-forget.
     */
    syncSnapshot(projectId, snapshot, projectName) {
      if (!projectId || !snapshot) return Promise.resolve(null);
      const body = { snapshot };
      if (projectName) body.projectName = String(projectName);
      return _apiFetch("POST", `/api/projects/${encodeURIComponent(projectId)}/snapshot`, body)
        .then((r) => {
          if (r && r.data && r.data.ok) {
            _available = true;
            try {
              const ts = (r.data.updated_at || (Date.now() / 1000));
              localStorage.setItem(`_myLastUpload_${projectId}`, String(ts));
              // Actualizar siempre: el banner "Actualizar" solo aparece cuando OTRO usuario sube cambios.
              localStorage.setItem(`_serverSyncFrom_${projectId}`, String(ts));
            } catch (_) {}
          }
          return r;
        }).catch(() => null);
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

    /** Descarga una imagen de evidencia del servidor como data URL. rawImageId es el ID local. */
    async fetchEvidence(rawImageId) {
      const projId = (global.ValidationSuite && global.ValidationSuite.projects &&
                      global.ValidationSuite.projects.getActiveId()) || null;
      if (!projId) return null;
      const compoundId = (projId + "_" + rawImageId).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 300);
      const r = await _apiFetch("GET",
        `/api/projects/${encodeURIComponent(projId)}/evidence/${encodeURIComponent(compoundId)}`
      );
      if (!r || r.status !== 200 || !r.data.ok) return null;
      return r.data.data || null;
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
