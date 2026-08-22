/* ====================================================================
   PEOPLE MANAGER — Firma electrónica con PIN (21 CFR Part 11 ready)

   Las personas viven dentro de packageDocs como una entrada tipo "PEOPLE"
   con code "PEOPLE-{packageCode}". Eso permite que viajen exportadas con
   el paquete y se restauren al cargarlo.

   Schema de una persona:
     {
       id: "person_xxx",            // único en el paquete
       nombre: "Federico Bongiovanni",
       iniciales: "FB",
       rol: "Process Owner",
       email: "fb@drp.com",         // opcional
       pinHash: "abc123...",        // SHA-256 hex
       esMaestro: true,             // true para el "user maestro" del paquete
       createdAt: "2026-05-11T...",
       updatedAt: "2026-05-11T..."
     }

   API expuesta:
     PeopleManager.list(packageCode)
     PeopleManager.add(packageCode, persona, pin)
     PeopleManager.remove(packageCode, personaId)
     PeopleManager.update(packageCode, personaId, patch)
     PeopleManager.setPin(packageCode, personaId, newPin, opts)
     PeopleManager.resetPin(packageCode, personaId, byPersonaId, newPin)
     PeopleManager.verifyPin(packageCode, personaId, pin)
     PeopleManager.signWithPin(packageCode, personaId, pin)  // devuelve obj firma o null
     PeopleManager.getMaestro(packageCode)
   ==================================================================== */

(function (global) {
    'use strict';

    const PM = {};

    // ====================================================================
    // HASH SHA-256 vía Web Crypto API
    // ====================================================================
    async function sha256(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ====================================================================
    // ACCESO AL PAQUETE DE PERSONAS (entrada PEOPLE en packageDocs)
    // ====================================================================

    function getPackageCode(explicitCode) {
        if (explicitCode) return explicitCode;
        // Usar el code del primer doc del paquete
        const pkg = global.packageDocs || [];
        if (pkg.length === 0) return null;
        // El primer doc con .data.package.code
        for (const d of pkg) {
            const c = d.data && d.data.package && d.data.package.code;
            if (c) return c;
        }
        return null;
    }

    function peopleDocCode(packageCode) {
        return 'PEOPLE-' + packageCode;
    }

    /** Obtiene la entrada PEOPLE del paquete; la crea vacía si no existe. */
    function ensurePeopleDoc(packageCode) {
        if (!packageCode) throw new Error('packageCode requerido');
        const code = peopleDocCode(packageCode);
        const pkg = global.packageDocs;
        if (!Array.isArray(pkg)) throw new Error('packageDocs no inicializado');

        let entry = pkg.find(d => d.type === 'PEOPLE' && d.code === code);
        if (!entry) {
            entry = {
                type: 'PEOPLE',
                code: code,
                version: '1.0',
                title: 'Lista de personas firmantes del paquete ' + packageCode,
                data: {
                    schemaVersion: '1.0',
                    type: 'PEOPLE',
                    packageCode: packageCode,
                    personas: []
                },
                fileName: code + '.json',
                loadedAt: new Date().toISOString(),
                derivedRefs: null
            };
            pkg.push(entry);
        }
        if (!entry.data.personas) entry.data.personas = [];
        return entry;
    }

    function listPersonas(packageCode) {
        const code = packageCode || getPackageCode();
        if (!code) return [];
        const entry = ensurePeopleDoc(code);
        return entry.data.personas.slice();
    }

    function findPersona(packageCode, personaId) {
        const entry = ensurePeopleDoc(packageCode);
        return entry.data.personas.find(p => p.id === personaId) || null;
    }

    function getMaestro(packageCode) {
        const code = packageCode || getPackageCode();
        if (!code) return null;
        const entry = ensurePeopleDoc(code);
        return entry.data.personas.find(p => p.esMaestro) || null;
    }

    // ====================================================================
    // CRUD DE PERSONAS
    // ====================================================================

    /**
     * Agrega una persona. La primera persona del paquete se marca maestro
     * automáticamente si no se indica. El PIN se hashea.
     */
    async function addPersona(packageCode, persona, pin) {
        const code = packageCode || getPackageCode();
        if (!code) throw new Error('No hay paquete activo. Cargá un protocolo primero.');
        if (!persona || !persona.nombre) throw new Error('Nombre requerido');
        if (!pin || pin.length < 4) throw new Error('PIN mínimo 4 caracteres');

        const entry = ensurePeopleDoc(code);
        // Iniciales auto si no fueron declaradas
        const iniciales = persona.iniciales
            || persona.nombre.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 3).join('');

        // Validar nombre único
        if (entry.data.personas.some(p => p.nombre.trim().toLowerCase() === persona.nombre.trim().toLowerCase())) {
            throw new Error(`Ya existe una persona con el nombre "${persona.nombre}" en este paquete.`);
        }

        const pinHash = await sha256(pin);
        const esMaestro = persona.esMaestro != null
            ? !!persona.esMaestro
            : (entry.data.personas.length === 0); // primera = maestro

        const nueva = {
            id: 'person_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            nombre: persona.nombre.trim(),
            iniciales: iniciales,
            rol: (persona.rol || '').trim(),
            email: (persona.email || '').trim(),
            pinHash: pinHash,
            firmaImage: persona.firmaImage || null, // data URL PNG del trazado, opcional
            esMaestro: esMaestro,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        entry.data.personas.push(nueva);
        await persist();
        logAudit('SIGNER_REGISTERED', nueva.id, {
            nombre: nueva.nombre, rol: nueva.rol, esMaestro: nueva.esMaestro,
            hasFirmaImage: !!nueva.firmaImage, packageCode: code
        }, 'Firmante registrado: ' + nueva.nombre);
        return nueva;
    }

    /** Captura/actualiza solo el trazado de firma de una persona. */
    async function setFirmaImage(packageCode, personaId, firmaImageDataUrl) {
        const entry = ensurePeopleDoc(packageCode);
        const p = entry.data.personas.find(x => x.id === personaId);
        if (!p) throw new Error('Persona no encontrada');
        p.firmaImage = firmaImageDataUrl || null;
        p.updatedAt = new Date().toISOString();
        await persist();
        logAudit('SIGNATURE_CAPTURED', personaId, {
            nombre: p.nombre, packageCode, length: firmaImageDataUrl ? firmaImageDataUrl.length : 0
        }, 'Firma manuscrita capturada para: ' + p.nombre);
        return p;
    }

    async function updatePersona(packageCode, personaId, patch) {
        const entry = ensurePeopleDoc(packageCode);
        const p = entry.data.personas.find(x => x.id === personaId);
        if (!p) throw new Error('Persona no encontrada');
        // Reglas: si patch.esMaestro=true, asegurar que sea el único maestro
        const allowed = ['nombre', 'iniciales', 'rol', 'email', 'esMaestro', 'firmaImage'];
        allowed.forEach(k => { if (patch[k] !== undefined) p[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k]; });
        if (patch.esMaestro === true) {
            entry.data.personas.forEach(x => { if (x.id !== personaId) x.esMaestro = false; });
        }
        p.updatedAt = new Date().toISOString();
        await persist();
        logAudit('SIGNER_UPDATED', personaId, {
            nombre: p.nombre, packageCode, fieldsChanged: Object.keys(patch)
        }, 'Firmante actualizado: ' + p.nombre);
        return p;
    }

    async function removePersona(packageCode, personaId) {
        const entry = ensurePeopleDoc(packageCode);
        const idx = entry.data.personas.findIndex(p => p.id === personaId);
        if (idx < 0) return false;
        const p = entry.data.personas[idx];
        // Si es maestro y hay más personas, exigir transferir el rol primero
        if (p.esMaestro && entry.data.personas.length > 1) {
            throw new Error('No se puede eliminar al user maestro. Asigná el rol a otra persona primero.');
        }
        entry.data.personas.splice(idx, 1);
        await persist();
        logAudit('SIGNER_DELETED', personaId, { nombre: p.nombre, packageCode }, 'Firmante eliminado: ' + p.nombre);
        return true;
    }

    // ====================================================================
    // PIN: SET / RESET / VERIFY
    // ====================================================================

    /** Cambia el PIN propio (requiere PIN actual) */
    async function setPin(packageCode, personaId, currentPin, newPin) {
        if (!newPin || newPin.length < 4) throw new Error('Nuevo PIN mínimo 4 caracteres');
        const entry = ensurePeopleDoc(packageCode);
        const p = entry.data.personas.find(x => x.id === personaId);
        if (!p) throw new Error('Persona no encontrada');
        const currentHash = await sha256(currentPin || '');
        if (currentHash !== p.pinHash) throw new Error('PIN actual incorrecto');
        p.pinHash = await sha256(newPin);
        p.updatedAt = new Date().toISOString();
        await persist();
        return true;
    }

    /** Reset de PIN por el user maestro (sin pedir el actual) */
    async function resetPinByMaestro(packageCode, targetId, byPersonaId, byPin, newPin) {
        if (!newPin || newPin.length < 4) throw new Error('Nuevo PIN mínimo 4 caracteres');
        const entry = ensurePeopleDoc(packageCode);
        const by = entry.data.personas.find(x => x.id === byPersonaId);
        if (!by) throw new Error('User maestro no encontrado');
        if (!by.esMaestro) throw new Error('Solo el user maestro puede resetear PINs ajenos');
        const byHash = await sha256(byPin || '');
        if (byHash !== by.pinHash) throw new Error('PIN del user maestro incorrecto');

        const target = entry.data.personas.find(x => x.id === targetId);
        if (!target) throw new Error('Persona target no encontrada');
        target.pinHash = await sha256(newPin);
        target.updatedAt = new Date().toISOString();
        target._lastResetBy = byPersonaId;
        target._lastResetAt = new Date().toISOString();
        await persist();
        return true;
    }

    /** Verifica un PIN sin crear firma. Devuelve true/false. */
    async function verifyPin(packageCode, personaId, pin) {
        const entry = ensurePeopleDoc(packageCode);
        const p = entry.data.personas.find(x => x.id === personaId);
        if (!p) return false;
        const h = await sha256(pin || '');
        return h === p.pinHash;
    }

    // ====================================================================
    // FIRMA CON PIN — devuelve objeto firma listo para insertar en el doc
    // ====================================================================

    /**
     * Verifica PIN y genera un objeto firma con timestamp.
     * Si rolDeclarado se pasa, lo usa; si no, usa el rol de la persona.
     * Devuelve null si el PIN es incorrecto.
     */
    async function signWithPin(packageCode, personaId, pin, opts) {
        opts = opts || {};
        const code = packageCode || getPackageCode();
        const ok = await verifyPin(code, personaId, pin);
        if (!ok) {
            logAudit('SIGN_PIN_FAILED', personaId, {
                packageCode: code, rolDeclarado: opts.rolDeclarado || null
            }, 'Intento de firma con PIN incorrecto');
            return null;
        }
        const p = findPersona(code, personaId);
        const fechaShort = opts.fecha || (new Date()).toLocaleDateString('es-AR');
        const firma = {
            rol: opts.rolDeclarado || p.rol || '—',
            nombre: p.nombre,
            iniciales: p.iniciales,
            fecha: fechaShort,
            // El trazado manuscrito se incluye en la firma → los renderers
            // (shared.renderTablaFirmasFinalSmart) lo usan como image en lugar
            // del placeholder de iniciales si está presente.
            firmaImage: p.firmaImage || null,
            _signedBy: p.id,
            _signedAt: new Date().toISOString(),
            _signatureHashRef: (p.pinHash || '').substring(0, 12) // marcador (no es el hash completo del PIN)
        };
        logAudit('SIGN_INSERTED', p.id, {
            packageCode: code, rol: firma.rol, nombre: p.nombre,
            hasFirmaImage: !!firma.firmaImage
        }, 'Firma insertada: ' + p.nombre + ' (' + firma.rol + ')');
        return firma;
    }

    /** Helper de audit log que sobrevive si AuditTrail no cargó todavía. */
    function logAudit(action, entityId, details, label) {
        try {
            if (global.AuditTrail && typeof global.AuditTrail.logAction === 'function') {
                global.AuditTrail.logAction(action, 'signer', entityId, details, label);
            }
        } catch (e) { /* silencioso */ }
    }

    // ====================================================================
    // PERSISTENCIA
    // ====================================================================
    async function persist() {
        if (typeof global.saveToStorage === 'function') {
            try { await global.saveToStorage(); } catch (e) { /* silencioso */ }
        }
        if (typeof global.renderPackagePanel === 'function') {
            try { global.renderPackagePanel(); } catch (e) {}
        }
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    PM.list = listPersonas;
    PM.find = findPersona;
    PM.add = addPersona;
    PM.update = updatePersona;
    PM.remove = removePersona;
    PM.setFirmaImage = setFirmaImage;
    PM.setPin = setPin;
    PM.resetPinByMaestro = resetPinByMaestro;
    PM.verifyPin = verifyPin;
    PM.signWithPin = signWithPin;
    PM.getMaestro = getMaestro;
    PM.getPackageCode = getPackageCode;
    PM._sha256 = sha256; // expuesto para tests

    global.PeopleManager = PM;

})(window);
