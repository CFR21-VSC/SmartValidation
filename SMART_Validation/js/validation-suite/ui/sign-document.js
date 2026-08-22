/* ====================================================================
   VALIDATION SUITE — SIGN DOCUMENT (firma genérica con PIN)

   Mecanismo único de firma para cualquier documento del suite que
   tenga sección "tabla-firmas-final" + rolesPlaceholder.

   Funciona para: PIQ, POQ, PPQ, IIQ, IOQ, IPQ, RIQ, ROQ, RPQ, VSR,
   NCR (consolidada), y cualquier doc futuro con la misma estructura.

   API expuesta:
     VS.signDocument.startSigningFlow()         → recorre los roles
                                                   pendientes uno a uno.
     VS.signDocument.signSingleRole(rolName)    → firma un rol puntual.
     VS.signDocument.clearSignatures()          → borra todas las firmas
                                                   (útil para re-firmar).
     VS.signDocument.getSignableRoles(data)     → lista los roles del doc.
     VS.signDocument.updateBarVisibility(data)  → muestra/oculta la barra.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.signDocument = VS.signDocument || {};

    // ====================================================================
    // HELPERS DOM / JSON EDITOR
    // ====================================================================
    function getEditor() {
        return document.getElementById('vsJsonEditor');
    }

    function readJSON() {
        const editor = getEditor();
        if (!editor) { alert('Editor no disponible.'); return null; }
        try {
            return JSON.parse(editor.value);
        } catch (e) {
            alert('El JSON del editor no es válido:\n\n' + e.message);
            return null;
        }
    }

    function writeJSON(data) {
        const editor = getEditor();
        if (!editor) return;
        editor.value = JSON.stringify(data, null, 2);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function notify(msg, type) {
        if (typeof global.showNotification === 'function') global.showNotification(msg, type);
        else console.log('[sign-document]', msg);
    }

    // ====================================================================
    // INTROSPECCIÓN DEL DOC
    // ====================================================================

    /** Encuentra la sección tabla-firmas-final del documento (la principal). */
    function findFirmasSection(data) {
        if (!data || !Array.isArray(data.secciones)) return null;
        return data.secciones.find(s => s.tipo === 'tabla-firmas-final');
    }

    /**
     * Devuelve TODOS los slots de firma del doc:
     *   - kind 'section': secciones gated con `firmasRequeridas[]` (NCR style).
     *   - kind 'final'  : la `tabla-firmas-final` consolidada (resto de docs).
     *
     * Cada slot: { rol, firmada, firma, secIdx, kind, label, secTitulo, obligatoria }
     *
     * El secIdx permite re-localizar la sección luego de re-leer el JSON
     * (no usamos referencias de objeto porque readJSON() reparsea cada vez).
     */
    function getAllSignableSlots(data) {
        const slots = [];
        if (!data || !Array.isArray(data.secciones)) return slots;

        data.secciones.forEach((sec, secIdx) => {
            // Secciones gated estilo NCR: firmasRequeridas[] aparte de tabla-firmas-final
            if (Array.isArray(sec.firmasRequeridas) && sec.firmasRequeridas.length > 0 && sec.tipo !== 'tabla-firmas-final') {
                sec.firmasRequeridas.forEach(req => {
                    const firma = (sec.firmas || []).find(f => f.rol === req.rol);
                    slots.push({
                        rol: req.rol,
                        obligatoria: req.obligatoria !== false,
                        firmada: !!(firma && firma.nombre && firma.fecha),
                        firma: firma || null,
                        secIdx: secIdx,
                        kind: 'section',
                        label: sec.titulo ? `${sec.titulo} · ${req.rol}` : req.rol,
                        secTitulo: sec.titulo
                    });
                });
            }
            // Tabla consolidada final
            if (sec.tipo === 'tabla-firmas-final') {
                const placeholders = sec.rolesPlaceholder || (sec.firmas || []).map(f => f.rol).filter(Boolean);
                placeholders.forEach(rol => {
                    const firma = (sec.firmas || []).find(f => f.rol === rol);
                    slots.push({
                        rol: rol,
                        obligatoria: true,
                        firmada: !!(firma && firma.nombre && firma.fecha),
                        firma: firma || null,
                        secIdx: secIdx,
                        kind: 'final',
                        label: rol,
                        secTitulo: sec.titulo
                    });
                });
            }
        });

        return slots;
    }

    /** Backwards compat: solo roles del final consolidado. */
    function getSignableRoles(data) {
        return getAllSignableSlots(data)
            .filter(s => s.kind === 'final')
            .map(s => ({ rol: s.rol, firmada: s.firmada, firma: s.firma }));
    }

    // ====================================================================
    // FIRMA INDIVIDUAL — versión slot-aware (gated o final)
    // ====================================================================

    /** Abre el modal PIN para firmar UN slot puntual (sección específica + rol). */
    function signSlot(slot, onDone) {
        const data = readJSON();
        if (!data) return;
        const sec = data.secciones && data.secciones[slot.secIdx];
        if (!sec) { alert('Sección no encontrada (idx ' + slot.secIdx + ').'); return; }

        if (typeof global.openSignWithPinModal !== 'function') {
            alert('Módulo de firma con PIN no disponible.');
            return;
        }

        const sectionLabel = sec.titulo || sec.tipo;
        const title = slot.kind === 'final'
            ? `Firmar como "${slot.rol}" — Firmas consolidadas`
            : `Firmar como "${slot.rol}" — ${sectionLabel}`;

        global.openSignWithPinModal({
            title: title,
            rolSugerido: slot.rol,
            onSigned: function (firma) {
                if (!Array.isArray(sec.firmas)) sec.firmas = [];
                firma.rol = slot.rol;
                const idx = sec.firmas.findIndex(f => f.rol === slot.rol);
                if (idx >= 0) sec.firmas[idx] = firma;
                else sec.firmas.push(firma);

                // matrizAprobaciones espejo solo para slots 'final'
                if (slot.kind === 'final' && Array.isArray(data.matrizAprobaciones)) {
                    const apIdx = data.matrizAprobaciones.findIndex(a => a.rol === slot.rol);
                    if (apIdx >= 0) {
                        data.matrizAprobaciones[apIdx] = {
                            rol: slot.rol,
                            nombre: firma.nombre,
                            iniciales: firma.iniciales,
                            fecha: firma.fecha
                        };
                    }
                }
                writeJSON(data);
                const ctx = slot.kind === 'section' ? ` (${sectionLabel})` : '';
                notify(`Firma de "${slot.rol}"${ctx} insertada por ${firma.nombre}.`);
                if (typeof onDone === 'function') onDone(firma);
            },
            onCancel: function () {
                notify('Firma cancelada.');
                if (typeof onDone === 'function') onDone(null);
            }
        });
    }

    /** Backwards compat: firma por rolName.
     *  Prioriza el slot 'final'; si no existe, cae al primer slot 'section' con ese rol. */
    function signSingleRole(rolName, onDone) {
        const data = readJSON();
        if (!data) return;
        const slots = getAllSignableSlots(data);
        const slot = slots.find(s => s.kind === 'final' && s.rol === rolName)
                   || slots.find(s => s.rol === rolName);
        if (!slot) {
            alert('No se encontró slot para el rol "' + rolName + '".');
            return;
        }
        signSlot(slot, onDone);
    }

    /**
     * Recorre TODOS los slots pendientes del doc (gated + final) en orden y
     * los firma uno a uno. Si el usuario cancela un slot, se detiene.
     */
    function startSigningFlow() {
        const data = readJSON();
        if (!data) return;
        const slots = getAllSignableSlots(data);
        if (slots.length === 0) {
            alert('El documento no tiene roles de firma declarados (firmasRequeridas, rolesPlaceholder o firmas previas).');
            return;
        }
        const pendientes = slots.filter(s => !s.firmada);
        if (pendientes.length === 0) {
            if (!confirm('Todas las firmas están completas. ¿Querés re-firmar alguna? (No recomendado — pisará las firmas actuales.)')) return;
        }

        let i = 0;
        const targets = pendientes.length > 0 ? pendientes : slots;

        function next() {
            if (i >= targets.length) {
                notify(`Firma completa: ${targets.length} firma(s) recogida(s).`);
                return;
            }
            const slot = targets[i++];
            signSlot(slot, function (firma) {
                if (firma) next();
                else notify('Firma interrumpida. Roles restantes quedaron pendientes.');
            });
        }
        next();
    }

    /**
     * Limpia TODAS las firmas[] del doc (en cualquier sección que las tenga)
     * + matrizAprobaciones. Antes solo borraba la tabla-firmas-final, lo que
     * dejaba las firmas gated del NCR intactas.
     */
    function clearSignatures() {
        const data = readJSON();
        if (!data) return;

        // Contar antes (para mostrar al usuario qué se va a borrar)
        let totalToClear = 0;
        let secsAffected = 0;
        (data.secciones || []).forEach(sec => {
            if (Array.isArray(sec.firmas) && sec.firmas.length > 0) {
                totalToClear += sec.firmas.length;
                secsAffected++;
            }
        });

        if (totalToClear === 0) {
            notify('No hay firmas para eliminar.');
            return;
        }

        if (!confirm(`Esto eliminará ${totalToClear} firma(s) en ${secsAffected} sección(es). ¿Continuar?`)) return;

        (data.secciones || []).forEach(sec => {
            if (Array.isArray(sec.firmas)) sec.firmas = [];
        });
        if (Array.isArray(data.matrizAprobaciones)) {
            data.matrizAprobaciones.forEach(a => { a.nombre = ''; a.iniciales = ''; a.fecha = ''; });
        }
        writeJSON(data);
        notify(`${totalToClear} firma(s) eliminada(s) en ${secsAffected} sección(es).`);
    }

    // ====================================================================
    // BARRA DE FIRMA EN EL TOOLBAR DEL SUITE
    // Visible si el doc tiene cualquier slot firmable (gated o final).
    // ====================================================================
    function updateBarVisibility(data) {
        const bar = document.getElementById('vsSignDocBar');
        if (!bar) return;
        if (!data) { bar.style.display = 'none'; return; }
        const slots = getAllSignableSlots(data);
        if (slots.length === 0) { bar.style.display = 'none'; return; }

        bar.style.display = 'flex';
        // Contador refleja TODOS los slots (gated + final), no solo el final.
        const counter = document.getElementById('vsSignCounter');
        if (counter) {
            const firmadas = slots.filter(s => s.firmada).length;
            counter.textContent = `${firmadas}/${slots.length} firmadas`;
            counter.style.color = firmadas === slots.length && slots.length > 0 ? '#1E7E34' : '#7A5A1A';
        }
    }

    // ====================================================================
    // EXPORTS
    // ====================================================================
    VS.signDocument.startSigningFlow = startSigningFlow;
    VS.signDocument.signSingleRole = signSingleRole;
    VS.signDocument.signSlot = signSlot;
    VS.signDocument.clearSignatures = clearSignatures;
    VS.signDocument.getSignableRoles = getSignableRoles;
    VS.signDocument.getAllSignableSlots = getAllSignableSlots;
    VS.signDocument.updateBarVisibility = updateBarVisibility;

})(window);
