'use strict';

/* ====================================================================
   SMART Validation — Analytics Client
   Conecta el frontend con el servicio Python de analytics (FastAPI).

   URL:
   - En localhost: apunta al servicio local en http://127.0.0.1:8765
   - En producción: usa window.SMART_ANALYTICS_URL si está configurado,
     o queda en null y el panel muestra "servicio no disponible".

   Las llamadas incluyen `credentials: 'include'` para enviar la cookie
   de sesión automáticamente.
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};

    const ANALYTICS_PORT = 8765;

    function _baseUrl() {
        // Prioridad: config explícita > var global > detección automática
        const configured = (VS.config && VS.config.get && VS.config.get('analyticsUrl'))
            || global.SMART_ANALYTICS_URL;
        if (configured) return configured;

        const { hostname, protocol } = window.location;

        // En HTTPS (Railway/producción): usar el proxy del servidor principal (mismo origen, sin CORS)
        if (protocol === 'https:') return '/api/analytics';

        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
            || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);

        // En local (localhost, 127.0.0.1 o LAN): directo al puerto 8765
        if (isLocal) return `http://${hostname}:${ANALYTICS_PORT}`;

        // HTTP pero dominio externo: usar proxy igual
        return '/api/analytics';
    }

    VS.Analytics = {

        /** Verifica que el servicio analytics esté disponible. */
        async ping() {
            const base = _baseUrl();
            if (!base) return false;
            try {
                const res = await fetch(`${base}/health`, {
                    signal: AbortSignal.timeout(2500),
                    credentials: 'include',
                });
                return res.ok;
            } catch (_) {
                return false;
            }
        },

        /**
         * Envía los documentos al motor Python y devuelve el análisis.
         * @param {string} projectId
         * @param {Object} documents  - mapa { urs: {...}, piq: {...}, ... }
         * @param {string|null} executionExcelB64 - base64 del Excel de ejecución (opcional)
         * @returns {Promise<Object>} AnalyzeResponse
         */
        async analyze(projectId, documents, executionExcelB64 = null) {
            const base = _baseUrl();
            if (!base) throw new Error('Servicio de analytics no configurado para este entorno');

            const res = await fetch(`${base}/analyze`, {
                method:      'POST',
                headers:     { 'Content-Type': 'application/json' },
                credentials: 'include',
                body:        JSON.stringify({ projectId, documents, executionExcelB64 }),
            });

            if (res.status === 401) {
                window.location.replace('/login.html');
                throw new Error('Sesión expirada');
            }
            if (!res.ok) {
                const err = await res.text();
                throw new Error(`Analytics service error ${res.status}: ${err}`);
            }
            return res.json();
        },

        /** Construye el mapa de documentos desde los docs aprobados del ciclo. */
        buildDocMap(approvedDocs) {
            return { ...approvedDocs };
        },
    };

})(typeof window !== 'undefined' ? window : global);
