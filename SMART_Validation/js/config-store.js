// Módulo central de configuración del cliente.
// UMD: funciona en browser (window) y en Node.js/Jest (module.exports).

(function (root, factory) {
    var result = factory();
    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = result;
    } else {
        root.ConfigStore = result.ConfigStore;
        root.APP_VERSION = result.APP_VERSION;
    }
    // Garantizar exposición en window aunque xlsx/jszip/pdfmake hayan definido `module`
    if (typeof window !== 'undefined') {
        window.APP_VERSION = result.APP_VERSION;
        window.ConfigStore = result.ConfigStore;
    }
})(typeof window !== 'undefined' ? window : global, function () {

    var APP_VERSION = '1.0.0-beta';

    var STORAGE_KEY = 'smart_validation_config';

    var DEFAULT_CONFIG = {
        version: APP_VERSION,
        organizacion: {
            nombre: '',
            logo: null,
            responsable: '',
            regulacion: 'ANMAT 4159/2023 + GAMP 5'
        }
    };

    function save(config) {
        if (typeof localStorage === 'undefined') {
            throw new Error('localStorage no disponible en este entorno');
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
            return true;
        } catch (e) {
            console.error('[ConfigStore] Error al guardar:', e);
            return false;
        }
    }

    function load() {
        if (typeof localStorage === 'undefined') {
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            var parsed = JSON.parse(raw);
            // Merge con defaults para tolerar campos nuevos en versiones futuras
            return {
                version: parsed.version || APP_VERSION,
                organizacion: Object.assign(
                    {}, DEFAULT_CONFIG.organizacion, parsed.organizacion || {}
                )
            };
        } catch (e) {
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
    }

    function validate(config) {
        if (!config) {
            return { valid: false, errors: ['Configuración vacía'] };
        }
        if (!config.organizacion) {
            return { valid: false, errors: ['Falta sección organizacion'] };
        }
        var errors = [];
        if (!config.organizacion.nombre || !config.organizacion.nombre.trim()) {
            errors.push('Nombre de organización requerido');
        }
        return { valid: errors.length === 0, errors: errors };
    }

    function reset() {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(STORAGE_KEY);
    }

    function isConfigured() {
        return validate(load()).valid;
    }

    function getVersion() {
        return APP_VERSION;
    }

    var ConfigStore = {
        save: save,
        load: load,
        validate: validate,
        reset: reset,
        isConfigured: isConfigured,
        getVersion: getVersion,
        DEFAULT_CONFIG: DEFAULT_CONFIG,
        STORAGE_KEY: STORAGE_KEY
    };

    return { ConfigStore: ConfigStore, APP_VERSION: APP_VERSION };
});
