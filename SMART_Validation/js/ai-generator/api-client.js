'use strict';

/* ====================================================================
   AI GENERATOR — API CLIENT
   Llama al proxy local POST /ai/generate (server.py), que a su vez
   llama a la API de Anthropic. La API key nunca toca el browser.
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.AIGenerator = VS.AIGenerator || {};

    const PROXY_ENDPOINT = '/ai/generate';

    const MODELS = {
        sonnet: 'claude-sonnet-4-6',
        opus:   'claude-opus-4-7'
    };

    function _mergeSignals(...signals) {
        const ctrl = new AbortController();
        signals.forEach(s => {
            if (!s) return;
            if (s.aborted) { ctrl.abort(); return; }
            s.addEventListener('abort', () => ctrl.abort(), { once: true });
        });
        return ctrl.signal;
    }

    const ApiClient = {
        MODELS,
        DEFAULT_MODEL: MODELS.sonnet,

        /**
         * Genera texto via Claude.
         * @param {object} opts
         * @param {string} opts.userPrompt   — prompt principal (requerido)
         * @param {string} [opts.systemPrompt] — instrucciones de sistema
         * @param {string} [opts.model]      — MODELS.sonnet | MODELS.opus
         * @returns {Promise<string>}        — texto de la respuesta
         */
        async generate({ userPrompt, systemPrompt = '', model = MODELS.sonnet, signal }) {
            if (!userPrompt || !userPrompt.trim()) {
                throw new Error('userPrompt requerido');
            }

            // Timeout de 12 minutos — protocolos con muchos TCs (POQ, IOQ, PPQ) pueden tardar bastante
            const FETCH_TIMEOUT_MS = 12 * 60 * 1000;
            const timeoutCtrl = new AbortController();
            const timeoutId   = setTimeout(() => timeoutCtrl.abort(), FETCH_TIMEOUT_MS);
            // Combinar con señal externa (cancelación manual)
            const combined = signal
                ? _mergeSignals(signal, timeoutCtrl.signal)
                : timeoutCtrl.signal;

            let response;
            try {
                response = await fetch(PROXY_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        systemPrompt: systemPrompt || '',
                        userPrompt: userPrompt.trim()
                    }),
                    signal: combined
                });
            } catch (networkErr) {
                clearTimeout(timeoutId);
                if (networkErr.name === 'AbortError') {
                    if (signal && signal.aborted) throw new Error('Generación cancelada por el usuario.');
                    throw new Error('La solicitud tardó más de 12 minutos y fue cancelada. Intentá de nuevo.');
                }
                throw new Error(
                    `No se pudo conectar al servidor local. ¿Está corriendo server.py? (${networkErr.message})`
                );
            }
            clearTimeout(timeoutId);

            let data;
            try {
                data = await response.json();
            } catch (_) {
                throw new Error(`Respuesta inválida del servidor (HTTP ${response.status})`);
            }

            if (!data.ok) {
                const err = new Error(data.error || `Error del servidor: HTTP ${response.status}`);
                if (data.truncated) err.truncated = true;
                throw err;
            }

            return data.content;
        },

        /**
         * Verifica que el proxy esté operativo y la API key configurada.
         * Hace una llamada mínima (sin system prompt).
         */
        async ping() {
            const result = await this.generate({
                userPrompt: 'Responde solo con la palabra: OK',
                model: MODELS.sonnet
            });
            return result.trim().toUpperCase().includes('OK');
        }
    };

    VS.AIGenerator.ApiClient = ApiClient;

})(typeof window !== 'undefined' ? window : global);
