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
      '<button onclick="window.location.replace(\'/login.html\')" style="background:#0891b2;color:#fff;border:none;padding:11px 28px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;width:100%;">Iniciar sesión nuevamente</button>' +
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
     * Fire-and-forget: push the full active snapshot to the server.
     * Called from saveCurrentToActive() — must never block the UI.
     */
    syncSnapshot(projectId, snapshot) {
      if (!projectId || !snapshot) return;
      _apiFetch("POST", `/api/projects/${encodeURIComponent(projectId)}/snapshot`, {
        snapshot,
      }).then((r) => {
        if (r && r.data && r.data.ok) {
          _available = true;
        }
      }).catch(() => {});
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

    /**
     * Fire-and-forget: sube una imagen de evidencia al servidor para persistencia
     * entre sesiones y máquinas. compoundId = "{projId}_{imageId}" sanitizado.
     */
    uploadEvidence(compoundId, base64data) {
      if (!compoundId || !base64data) return;
      _apiFetch("POST", `/api/evidence/${encodeURIComponent(compoundId)}`, {
        data: base64data,
      }).catch(() => {});
    },

    /** Descarga una imagen de evidencia del servidor como data URL. */
    async fetchEvidence(compoundId) {
      const r = await _apiFetch(
        "GET",
        `/api/evidence/${encodeURIComponent(compoundId)}`
      );
      if (!r || r.status !== 200 || !r.data.ok) return null;
      return r.data.data || null;
    },

    /**
     * Descarga múltiples imágenes del servidor en una sola request.
     * ids: array de compound IDs (máx 500).
     * Retorna {compoundId: "data:..." | null}.
     */
    async fetchEvidenceBatch(ids) {
      if (!ids || !ids.length) return {};
      const r = await _apiFetch("POST", "/api/evidence-batch", { ids });
      if (!r || r.status !== 200 || !r.data.ok) return {};
      return r.data.results || {};
    },

    /**
     * Sube un lote de imágenes al servidor.
     * images: {compoundId: "data:image/...", ...}
     * Envía en chunks de 50 para no saturar la red.
     */
    async bulkUploadEvidence(images) {
      if (!images || !Object.keys(images).length) return;
      const entries = Object.entries(images);
      const CHUNK = 50;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = Object.fromEntries(entries.slice(i, i + CHUNK));
        await _apiFetch("POST", "/api/evidence-batch-upload", { images: chunk })
          .catch(() => {});
      }
    },
  };

  // Expose under VS namespace (matches existing pattern)
  global.VS = global.VS || {};
  global.VS.Storage = Storage;

  // Probe on load — non-blocking
  _probe();
})(window);
