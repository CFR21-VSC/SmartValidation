// Máquina de estados para documentos GxP.
// Estados: draft → in_review → approved → locked
// Transiciones controladas por rol. Record locking incluido.
// Persiste en localStorage por proyecto. UMD para tests.

(function (root, factory) {
    var result = factory();
    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = result;
    } else {
        root.DocWorkflow = result.DocWorkflow;
    }
})(typeof window !== 'undefined' ? window : global, function () {

    // ── Constantes ───────────────────────────────────────────────────────

    var STATES = {
        DRAFT:      'draft',
        IN_REVIEW:  'in_review',
        APPROVED:   'approved',
        LOCKED:     'locked'
    };

    var ROLES = {
        AUTHOR:   'author',
        REVIEWER: 'reviewer',
        APPROVER: 'approver',
        ADMIN:    'admin'
    };

    // Transiciones permitidas: { desde: { rol: hasta } }
    var TRANSITIONS = {
        draft: {
            author:   'in_review',
            admin:    'in_review'
        },
        in_review: {
            reviewer: 'draft',      // devolver con comentarios
            approver: 'approved',
            admin:    'approved'
        },
        approved: {
            approver: 'locked',
            admin:    'locked'
        },
        locked: {
            // Solo admin puede reabrir — manejado por reopen()
        }
    };

    // Estados que bloquean edición
    var LOCKED_STATES = ['approved', 'locked'];

    // Orden estricto de la cascada documental GxP
    var CASCADE_ORDER = [
        'HLRA','VP','URS','FRS','DS',
        'RA','IRA','RRM',
        'MTR',
        'PIQ','POQ','PPQ',
        'IIQ','IOQ','IPQ',
        'RIQ','ROQ','RPQ',
        'NCR','VSR'
    ];

    // ── Storage por proyecto ─────────────────────────────────────────────

    var STORAGE_PREFIX = 'doc_workflow_';

    function _storageKey(projectId) {
        return STORAGE_PREFIX + (projectId || 'default');
    }

    function _loadMap(projectId) {
        if (typeof localStorage === 'undefined') return {};
        try {
            var raw = localStorage.getItem(_storageKey(projectId));
            return raw ? JSON.parse(raw) : {};
        } catch (_) { return {}; }
    }

    function _saveMap(projectId, map) {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(_storageKey(projectId), JSON.stringify(map));
    }

    // ── API ──────────────────────────────────────────────────────────────

    /**
     * Retorna el estado actual de un documento.
     * @param {string} docId
     * @param {string} projectId
     * @returns {{ estado, updatedAt, updatedBy } | null}
     */
    function getState(docId, projectId) {
        var map = _loadMap(projectId);
        return map[docId] || { estado: STATES.DRAFT, updatedAt: null, updatedBy: null, signatures: [] };
    }

    /**
     * Retorna el tipo de documento que bloquea el avance de docType en la cascada.
     * Un documento solo puede avanzar (draft→in_review, in_review→approved)
     * si el documento anterior en la cascada está en 'approved' o 'locked'.
     * @param {string} docType — código del documento (ej. 'URS', 'FRS')
     * @param {string} projectId
     * @returns {string|null} — tipo del doc bloqueador, o null si no hay bloqueo
     */
    function getBlockingPrerequisite(docType, projectId) {
        var type = (docType || '').toUpperCase();
        var idx = CASCADE_ORDER.indexOf(type);
        if (idx <= 0) return null; // HLRA o tipo no reconocido: sin bloqueo

        var prevType = CASCADE_ORDER[idx - 1];
        var prevState = getState(prevType, projectId).estado;
        if (prevState !== STATES.APPROVED && prevState !== STATES.LOCKED) {
            return prevType;
        }
        return null;
    }

    /**
     * Intenta hacer una transición de estado.
     * @param {string} docId
     * @param {string} projectId
     * @param {string} role  — rol del usuario que realiza la acción
     * @param {string} username
     * @returns {{ ok: boolean, estado?: string, error?: string }}
     */
    function transition(docId, projectId, role, username) {
        var current = getState(docId, projectId);
        var currentState = current.estado;
        var allowed = TRANSITIONS[currentState];

        if (!allowed || !allowed[role]) {
            return {
                ok: false,
                error: 'Transición no permitida: rol "' + role + '" no puede mover de "' + currentState + '"'
            };
        }

        var nextState = allowed[role];

        // Bloqueo de cascada: para avances hacia adelante, el doc anterior debe estar aprobado
        var isForward = (currentState === STATES.DRAFT    && nextState === STATES.IN_REVIEW) ||
                        (currentState === STATES.IN_REVIEW && nextState === STATES.APPROVED);
        if (isForward) {
            var blocker = getBlockingPrerequisite(docId, projectId);
            if (blocker) {
                return {
                    ok: false,
                    error: 'El documento "' + blocker + '" debe estar aprobado antes de avanzar este documento en la cascada.'
                };
            }
        }

        var map = _loadMap(projectId);
        map[docId] = {
            estado: nextState,
            updatedAt: new Date().toISOString(),
            updatedBy: username || 'unknown',
            previousState: currentState,
            signatures: (current.signatures || [])
        };
        _saveMap(projectId, map);

        return { ok: true, estado: nextState, previous: currentState };
    }

    /**
     * Verifica si un documento puede ser editado.
     * Docs en 'approved' o 'locked' requieren reopen() primero.
     * @returns {{ editable: boolean, reason?: string }}
     */
    function canEdit(docId, projectId) {
        var s = getState(docId, projectId).estado;
        if (LOCKED_STATES.indexOf(s) >= 0) {
            return { editable: false, reason: 'Documento en estado "' + s + '". Requerís justificación para reabrir.' };
        }
        return { editable: true };
    }

    /**
     * Reabre un documento aprobado/bloqueado.
     * Solo admins. Requiere justificación. Regresa a draft.
     * @param {string} docId
     * @param {string} projectId
     * @param {string} username
     * @param {string} justification — requerido, mínimo 10 chars
     * @returns {{ ok: boolean, error?: string }}
     */
    function reopen(docId, projectId, username, justification) {
        if (!justification || justification.trim().length < 10) {
            return { ok: false, error: 'Justificación requerida (mínimo 10 caracteres)' };
        }

        var current = getState(docId, projectId);
        if (LOCKED_STATES.indexOf(current.estado) < 0) {
            return { ok: false, error: 'El documento no está en estado aprobado/bloqueado' };
        }

        var map = _loadMap(projectId);
        map[docId] = {
            estado: STATES.DRAFT,
            updatedAt: new Date().toISOString(),
            updatedBy: username || 'unknown',
            previousState: current.estado,
            reopenJustification: justification.trim(),
            signatures: [] // las firmas se invalidan al reabrir
        };
        _saveMap(projectId, map);

        return { ok: true, estado: STATES.DRAFT, signaturesInvalidated: true };
    }

    /**
     * Registra una firma en el workflow de un documento.
     * Si el doc no está al menos en 'approved', rechaza.
     * @param {string} docId
     * @param {string} projectId
     * @param {{ nombre, rol, declaracion }} certStatement
     * @param {string} docHash — hash del contenido del doc al momento de firmar
     * @returns {{ ok: boolean, error?: string }}
     */
    function registerSignature(docId, projectId, certStatement, docHash) {
        var current = getState(docId, projectId);
        if (current.estado !== STATES.APPROVED && current.estado !== STATES.LOCKED) {
            return { ok: false, error: 'Solo se puede firmar un documento aprobado o bloqueado' };
        }

        var map = _loadMap(projectId);
        var entry = map[docId] || current;
        if (!Array.isArray(entry.signatures)) entry.signatures = [];

        entry.signatures.push({
            nombre:      certStatement.nombre,
            rol:         certStatement.rol,
            declaracion: certStatement.declaracion || 'Confirmo la exactitud y completitud de este documento.',
            fecha:       new Date().toISOString(),
            docHash:     docHash || null,
            estado:      'valida'
        });

        map[docId] = entry;
        _saveMap(projectId, map);

        return { ok: true };
    }

    /**
     * Invalida todas las firmas de un documento (llamar cuando el contenido cambia post-firma).
     * @param {string} docId
     * @param {string} projectId
     * @returns {number} cantidad de firmas invalidadas
     */
    function invalidateSignatures(docId, projectId) {
        var map = _loadMap(projectId);
        var entry = map[docId];
        if (!entry || !Array.isArray(entry.signatures)) return 0;

        var count = 0;
        entry.signatures.forEach(function (sig) {
            if (sig.estado === 'valida') { sig.estado = 'INVALIDADA'; count++; }
        });

        map[docId] = entry;
        _saveMap(projectId, map);
        return count;
    }

    /**
     * Retorna todas las firmas de un documento.
     * @returns {Array<{ nombre, rol, declaracion, fecha, docHash, estado }>}
     */
    function getSignatures(docId, projectId) {
        return getState(docId, projectId).signatures || [];
    }

    /**
     * Limpia el estado de workflow de todos los docs de un proyecto.
     * Solo llamar al borrar el proyecto completo.
     */
    function clearProject(projectId) {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(_storageKey(projectId));
    }

    var DocWorkflow = {
        STATES:                   STATES,
        ROLES:                    ROLES,
        CASCADE_ORDER:            CASCADE_ORDER,
        getState:                 getState,
        transition:               transition,
        canEdit:                  canEdit,
        reopen:                   reopen,
        registerSignature:        registerSignature,
        invalidateSignatures:     invalidateSignatures,
        getSignatures:            getSignatures,
        clearProject:             clearProject,
        getBlockingPrerequisite:  getBlockingPrerequisite
    };

    return { DocWorkflow: DocWorkflow };
});
