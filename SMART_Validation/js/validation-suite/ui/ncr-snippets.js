/* ====================================================================
   VALIDATION SUITE — NCR SNIPPET INSERTER
   Inserta bloques pre-armados en el JSON activo del editor para que
   un humano complete el contenido sin tener que escribir la
   estructura desde cero.

   Filosofía (modelo A confirmado por el usuario):
     - Claude/IA no completa el análisis automáticamente.
     - Las personas hacen el juicio experto (causa raíz, CAPA, firmas).
     - El sistema baja la barrera de entrada poniendo la estructura
       lista para tipear.

   API expuesta:
     VS.ncrSnippets.addHallazgo()
     VS.ncrSnippets.add5Porques()
     VS.ncrSnippets.addIshikawa()
     VS.ncrSnippets.addManualLibre()
     VS.ncrSnippets.addCAPA()
     VS.ncrSnippets.signSection(sectionType)
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite = global.ValidationSuite || {};

    // ====================================================================
    // HELPERS
    // ====================================================================

    function getEditor() {
        return document.getElementById('vsJsonEditor');
    }

    function readJSON() {
        const editor = getEditor();
        if (!editor) {
            alert('Editor no disponible.');
            return null;
        }
        try {
            return JSON.parse(editor.value);
        } catch (e) {
            alert('El JSON actual no es válido. Corregir antes de insertar snippets.\n\n' + e.message);
            return null;
        }
    }

    function writeJSON(data) {
        const editor = getEditor();
        if (!editor) return;
        editor.value = JSON.stringify(data, null, 2);
        // Disparar validación en vivo
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function ensureNCR(data) {
        if (!data) return false;
        if (data.type !== 'NCR') {
            alert('El documento actual no es un NCR. Cargá la plantilla NCR primero.');
            return false;
        }
        return true;
    }

    function getSection(data, tipo) {
        return (data.secciones || []).find(s => s.tipo === tipo);
    }

    function nextNcId(data) {
        const reg = getSection(data, 'ncr-registro-hallazgos');
        if (!reg || !Array.isArray(reg.hallazgos)) return 'NC-001';
        const ids = reg.hallazgos.map(h => (h.id || '').toString());
        let max = 0;
        ids.forEach(id => {
            const m = id.match(/(\d+)$/);
            if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
        });
        return 'NC-' + String(max + 1).padStart(3, '0');
    }

    function todayShort() {
        const d = new Date();
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    }

    // ====================================================================
    // SNIPPETS — HALLAZGO
    // ====================================================================
    VS.ncrSnippets = VS.ncrSnippets || {};

    VS.ncrSnippets.addHallazgo = function () {
        const data = readJSON();
        if (!ensureNCR(data)) return;
        const reg = getSection(data, 'ncr-registro-hallazgos');
        if (!reg) { alert('El NCR no tiene sección "ncr-registro-hallazgos".'); return; }
        if (!Array.isArray(reg.hallazgos)) reg.hallazgos = [];

        const newH = {
            id: nextNcId(data),
            tipo: 'NC',
            criticidad: 'MAYOR',
            tcRef: '',
            docOrigen: '',
            descripcion: '',
            fechaApertura: todayShort()
        };
        reg.hallazgos.push(newH);
        writeJSON(data);
        showSnippetToast(`Hallazgo ${newH.id} agregado al registro. Completá los campos en el editor.`);
    };

    // ====================================================================
    // SNIPPETS — ANALISIS DE CAUSA RAIZ (3 métodos)
    // ====================================================================
    function addAnalisis(data, payload) {
        const ana = getSection(data, 'ncr-analisis-causa');
        if (!ana) { alert('El NCR no tiene sección "ncr-analisis-causa".'); return false; }
        if (!Array.isArray(ana.analisis)) ana.analisis = [];
        ana.analisis.push(payload);
        return true;
    }

    VS.ncrSnippets.add5Porques = function () {
        const data = readJSON();
        if (!ensureNCR(data)) return;
        const payload = {
            ncId: '',
            tipoAnalisis: '5-porqués',
            porques: [
                '¿Por qué ocurrió X? Porque ...',
                '¿Por qué ...? Porque ...',
                '¿Por qué ...? Porque ...',
                '¿Por qué ...? Porque ...',
                'Causa raíz: ...'
            ],
            causaRaizIdentificada: '',
            factorSistemico: false,
            recurrente: false,
            ncRecurrenteRef: null,
            impactoScope: 'TC'
        };
        if (addAnalisis(data, payload)) {
            writeJSON(data);
            showSnippetToast('Análisis 5-porqués agregado. Asigná el ncId del hallazgo y completá los porqués.');
        }
    };

    VS.ncrSnippets.addIshikawa = function () {
        const data = readJSON();
        if (!ensureNCR(data)) return;
        const payload = {
            ncId: '',
            tipoAnalisis: 'ishikawa-6m',
            ishikawa: {
                manoDeObra: '',
                metodo: '',
                maquina: '',
                material: '',
                medicion: '',
                medioAmbiente: ''
            },
            causaRaizIdentificada: '',
            factorSistemico: false,
            recurrente: false,
            ncRecurrenteRef: null,
            impactoScope: 'TC'
        };
        if (addAnalisis(data, payload)) {
            writeJSON(data);
            showSnippetToast('Análisis Ishikawa (6M) agregado. Completá las 6 categorías relevantes (las que no aplican dejá vacías).');
        }
    };

    VS.ncrSnippets.addManualLibre = function () {
        const data = readJSON();
        if (!ensureNCR(data)) return;
        const payload = {
            ncId: '',
            tipoAnalisis: 'manual-libre',
            analisisLibre: '',
            causaRaizIdentificada: '',
            factorSistemico: false,
            recurrente: false,
            ncRecurrenteRef: null,
            impactoScope: 'TC'
        };
        if (addAnalisis(data, payload)) {
            writeJSON(data);
            showSnippetToast('Análisis libre agregado. Escribí el razonamiento en analisisLibre.');
        }
    };

    // ====================================================================
    // SNIPPETS — CAPA
    // ====================================================================
    VS.ncrSnippets.addCAPA = function () {
        const data = readJSON();
        if (!ensureNCR(data)) return;
        const plan = getSection(data, 'ncr-plan-capa');
        if (!plan) { alert('El NCR no tiene sección "ncr-plan-capa".'); return; }
        if (!Array.isArray(plan.capas)) plan.capas = [];
        plan.capas.push({
            ncId: '',
            accionCorrectiva: '',
            accionPreventiva: '',
            responsable: '',
            fechaCompromiso: '',
            fechaCierre: '',
            evidenciaCierre: '',
            verificadoPor: '',
            estadoCapa: 'EN CURSO'
        });
        writeJSON(data);
        showSnippetToast('CAPA agregada. Asigná el ncId del hallazgo y completá CA + PA + responsable + fechas.');
    };

    // ====================================================================
    // SNIPPETS — FIRMAR SECCION
    // Marca una sección gated como "aprobada" agregando la(s) firma(s).
    // Si hay personas registradas en el paquete (PeopleManager), usa el
    // modal de firma con PIN. Si no, cae al prompt simple (legacy).
    // ====================================================================
    VS.ncrSnippets.signSection = function (sectionType) {
        const data = readJSON();
        if (!ensureNCR(data)) return;
        const sec = getSection(data, sectionType);
        if (!sec) { alert('Sección no encontrada: ' + sectionType); return; }

        const requeridas = (sec.firmasRequeridas || []).filter(r => r.obligatoria !== false);
        if (requeridas.length === 0) {
            alert('La sección no declara firmas requeridas. Editá "firmasRequeridas" primero.');
            return;
        }

        // Verificar que la sección anterior esté aprobada (gating soft)
        const order = ['ncr-registro-hallazgos', 'ncr-analisis-causa', 'ncr-plan-capa', 'ncr-cierre-aprobacion'];
        const idx = order.indexOf(sectionType);
        if (idx > 0) {
            const prev = getSection(data, order[idx - 1]);
            if (prev && prev.estado !== 'aprobada') {
                if (!confirm('La etapa anterior ("' + order[idx - 1] + '") no está aprobada. ¿Firmar igual? (No recomendado — rompe el gating.)')) return;
            }
        }

        if (!Array.isArray(sec.firmas)) sec.firmas = [];

        // ¿Modo nuevo (firma con PIN) disponible?
        const PM = global.PeopleManager;
        const personasDisponibles = PM ? PM.list().length : 0;
        const modoPIN = !!(PM && personasDisponibles > 0 && typeof global.openSignWithPinModal === 'function');

        if (modoPIN) {
            // Modo firma electrónica con PIN: secuencial, una firma a la vez
            return collectSignaturesWithPin(data, sec, requeridas, sectionType, 0);
        }

        // Fallback legacy: prompts secos
        const fecha = todayShort();
        let firmasRecogidas = 0;

        requeridas.forEach(req => {
            const existing = sec.firmas.find(f => f.rol === req.rol);
            if (existing && existing.nombre && existing.fecha) {
                return; // ya firmada
            }
            const nombre = prompt(`Firmar como "${req.rol}".\n\nIngresá el NOMBRE completo del firmante:`, existing ? existing.nombre : '');
            if (!nombre) return;
            const iniciales = prompt(`Iniciales / firma corta (ej. "FB"):`, existing ? existing.iniciales : '');
            if (!iniciales) return;
            const fechaInput = prompt(`Fecha de firma (DD/MM/AAAA):`, fecha);
            if (!fechaInput) return;

            if (existing) {
                existing.nombre = nombre;
                existing.iniciales = iniciales;
                existing.fecha = fechaInput;
            } else {
                sec.firmas.push({ rol: req.rol, nombre, iniciales, fecha: fechaInput });
            }
            firmasRecogidas++;
        });

        if (firmasRecogidas === 0) {
            showSnippetToast('Sin firmas nuevas registradas.');
            return;
        }

        // Verificar si quedó completa → marcar aprobada
        const todasObtenidas = requeridas.every(r => {
            const f = sec.firmas.find(x => x.rol === r.rol);
            return f && f.nombre && f.fecha;
        });
        if (todasObtenidas) {
            sec.estado = 'aprobada';
            showSnippetToast(`Sección "${sectionType}" APROBADA. Habilitada la siguiente etapa.`);
        } else {
            sec.estado = 'en_revision';
            showSnippetToast(`Sección "${sectionType}" en revisión — faltan firmas para aprobar.`);
        }
        writeJSON(data);
    };

    // ====================================================================
    // FIRMA CON PIN — pide modal por cada rol requerido en secuencia.
    // Cuando termina, evalúa si la sección queda completa y persiste.
    // ====================================================================
    function collectSignaturesWithPin(data, sec, requeridas, sectionType, startIdx) {
        // Saltear roles que ya están firmados completos
        let i = startIdx;
        while (i < requeridas.length) {
            const req = requeridas[i];
            const existing = sec.firmas.find(f => f.rol === req.rol);
            if (existing && existing.nombre && existing.fecha && existing._signedBy) break;
            i++;
        }
        // Si todos firmados → cerrar
        if (i >= requeridas.length) {
            // Aún puede haber casos: usuario quiere re-firmar uno legacy sin _signedBy.
            // Encontrar el primero que falte.
            i = requeridas.findIndex(req => {
                const f = sec.firmas.find(x => x.rol === req.rol);
                return !(f && f.nombre && f.fecha && f._signedBy);
            });
            if (i < 0) {
                finalizeSignSection(data, sec, requeridas, sectionType);
                return;
            }
        }
        const req = requeridas[i];

        // Abrir modal
        global.openSignWithPinModal({
            title: `Firmar como "${req.rol}"`,
            rolSugerido: req.rol,
            onSigned: function (firma) {
                // firma viene con nombre, iniciales, rol, fecha, _signedBy, etc.
                // Forzar el rol declarado del slot
                firma.rol = req.rol;
                const existingIdx = sec.firmas.findIndex(f => f.rol === req.rol);
                if (existingIdx >= 0) sec.firmas[existingIdx] = firma;
                else sec.firmas.push(firma);
                writeJSON(data);
                // Pasar al siguiente
                collectSignaturesWithPin(data, sec, requeridas, sectionType, i + 1);
            },
            onCancel: function () {
                showSnippetToast(`Firma cancelada. La sección "${sectionType}" queda en revisión.`);
                sec.estado = 'en_revision';
                writeJSON(data);
            }
        });
    }

    function finalizeSignSection(data, sec, requeridas, sectionType) {
        const todasObtenidas = requeridas.every(r => {
            const f = sec.firmas.find(x => x.rol === r.rol);
            return f && f.nombre && f.fecha;
        });
        if (todasObtenidas) {
            sec.estado = 'aprobada';
            showSnippetToast(`Sección "${sectionType}" APROBADA. Habilitada la siguiente etapa.`);
        } else {
            sec.estado = 'en_revision';
            showSnippetToast(`Sección "${sectionType}" en revisión — faltan firmas para aprobar.`);
        }
        writeJSON(data);
    }

    // ====================================================================
    // TOAST simple (reusa el showNotification del gestor si existe)
    // ====================================================================
    function showSnippetToast(msg) {
        if (typeof global.showNotification === 'function') {
            global.showNotification(msg);
        } else {
            console.log('[NCR snippet]', msg);
        }
    }

    // ====================================================================
    // VISIBILIDAD DE LA BARRA DE SNIPPETS
    // Llamada cuando cambia el JSON: si type=NCR, muestra; sino, oculta.
    // ====================================================================
    VS.ncrSnippets.updateVisibility = function (data) {
        const bar = document.getElementById('vsNcrSnippetBar');
        if (!bar) return;
        if (data && data.type === 'NCR') {
            bar.style.display = 'flex';
        } else {
            bar.style.display = 'none';
        }
    };

})(window);
