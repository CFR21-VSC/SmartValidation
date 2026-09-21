/* ====================================================================
   VALIDATION SUITE — RENDERER LIBRO DE FIRMAS
   Documento nuevo (pedido del usuario 2026-09-20) que reemplaza al cuadro de
   firmas vacío (tabla-firmas-final) que traía cada documento individual.
   Se ve como cualquier otro protocolo del sistema (misma portada, misma
   tipografía) para que se pueda previsualizar e integrar al Libro de
   Validación sin desentonar.

   Estructura:
     1. Declaración de conformidad de firma electrónica -- lista de TODOS los
        firmantes del proyecto con la fecha en que aceptaron (una sola vez,
        de por vida) la certificación estilo 21 CFR Part 11 §11.100. Va
        primero, como conformidad legal antes de mostrar las firmas en sí.
     2. Una sección por documento firmado (revisión + aprobación, formato
        horizontal, hash completo cuando el documento ya está sellado).

   Datos: NO vienen de una skill generadora ni de un JSON cargado a mano --
   se arman en el momento a partir de GET /projects/{id}/signature-book
   (suite-revision-firmas/app/routers/book.py) y se envuelven acá con la
   forma mínima que exige validateDocumentJson (package/document/
   matrizAprobaciones/controlCambios), ver la función wrapSignatureBookAsDoc
   más abajo -- así el mismo botón de "Vista previa" puede usar el pipeline
   estándar de renderDocument() sin cambiarlo.

   Tipos de sección específicos:
     - libro-firmas-declaracion : lista de firmantes + su consentimiento
     - libro-firmas-documento   : firmas de un documento (usa
                                  shared.renderFirmasHorizontal)
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) {
        console.error('[libro-firmas.js] ValidationSuite no esta cargado');
        return;
    }

    // ====================================================================
    // SECCIÓN: DECLARACIÓN DE CONFORMIDAD DE FIRMA ELECTRÓNICA
    // ====================================================================
    function renderDeclaracionConformidad(sec, tb) {
        const C = tb.VS_COLORS;
        const out = [];

        // Ronda 19 (Codex, 2026-09-20): la versión anterior afirmaba que CADA firmante aceptó
        // "antes de emitir su primera firma" -- el backend solo sabe si hay una aceptación
        // vigente para esa persona, no la ordena en el tiempo contra ninguna firma puntual
        // (una firma histórica anterior a este registro podría figurar junto a una aceptación
        // posterior). El texto ahora describe lo que el sistema efectivamente sabe, sin
        // afirmar un orden temporal que no está demostrado.
        out.push({
            text: 'Cada firmante listado a continuación tiene registrada la aceptación de la siguiente '
                + 'declaración de conformidad de firma electrónica, con la fecha y el texto exacto que '
                + 'aceptó. La aceptación es única y vale de por vida -- no se repite por proyecto. Para '
                + 'firmas emitidas antes de que este registro existiera, no hay una aceptación asociada '
                + '(eso no implica necesariamente que no haya ocurrido por otro medio).',
            fontSize: 9.5, color: C.text, alignment: 'justify', lineHeight: 1.4, margin: [0, 0, 0, 10]
        });

        const firmantes = sec.firmantes || [];
        if (firmantes.length === 0) {
            out.push({
                text: 'Todavía no hay firmantes en este proyecto.',
                fontSize: 9, italics: true, color: C.textSoft, margin: [0, 0, 0, 10]
            });
            return out;
        }

        firmantes.forEach((f, idx) => {
            const consent = f.consentimiento;
            const bg = idx % 2 === 1 ? C.bgSoft : null;
            const bodyStack = [
                { text: f.nombre || '—', fontSize: 10, bold: true, color: C.text, margin: [0, 0, 0, 2] }
            ];
            if (consent) {
                bodyStack.push({
                    text: `Aceptó la declaración (versión ${consent.version}) el ${consent.fecha}.`,
                    fontSize: 8.5, color: '#1E7E34', margin: [0, 0, 0, 3]
                });
                bodyStack.push({
                    text: consent.texto,
                    fontSize: 8, italics: true, color: C.textSoft, alignment: 'justify', lineHeight: 1.3
                });
            } else {
                // Antes decía "firmó antes de que existiera este registro" -- una causa que no
                // está demostrada (podría faltar por otros motivos). Se limita a describir el
                // hecho verificado: no hay fila de aceptación para esta persona.
                bodyStack.push({
                    text: 'Sin aceptación de conformidad registrada.',
                    fontSize: 8.5, italics: true, color: '#B85F0F'
                });
            }
            out.push({
                table: { widths: ['*'], body: [[{ stack: bodyStack, fillColor: bg, margin: [10, 8, 10, 8] }]] },
                layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => C.border || '#DDE3E8' },
                margin: [0, 0, 0, 4]
            });
        });

        return out;
    }

    // ====================================================================
    // SECCIÓN: FIRMAS DE UN DOCUMENTO
    // ====================================================================
    function renderDocumentoFirmas(sec, tb) {
        const shared = VS.shared;
        return shared && shared.renderFirmasHorizontal ? shared.renderFirmasHorizontal(sec, tb) : [];
    }

    // ====================================================================
    // WRAPPER — arma un JSON "documento" a partir de la respuesta cruda de
    // GET /projects/{id}/signature-book, para poder pasarlo tal cual a
    // renderDocument() / VS.registerRenderer('LIBRO_FIRMAS', ...).
    //
    // Equivalente a wrap_signature_book_as_document (book.py) -- HOY el único caller real
    // es el botón "Vista previa" con datos sin filtrar (`onlySealed` default false), el de
    // Python es el único que arma el capítulo del Libro de Validación compilado
    // (`only_sealed=True`). El parámetro existe acá también, simétrico al de Python, para
    // que un test de contrato (tests/test_signature_consent.py::
    // test_python_and_js_wrappers_agree_on_the_same_input) pueda darle la MISMA entrada a
    // los dos wrappers y esperar la MISMA salida -- antes de agregarlo, ese test encontró
    // que este lado siempre decía "sellado o no" sin importar el alcance real de los datos
    // (Ronda 19, segunda devolución de Codex, 2026-09-21). Nunca declarar "Sellado" acá --
    // esto es SIEMPRE una proyección generada en el momento, nunca un artefacto persistido
    // con hash propio.
    // ====================================================================
    function wrapSignatureBookAsDoc(bookData, projectMeta, onlySealed) {
        projectMeta = projectMeta || {};
        const secciones = [
            {
                tipo: 'libro-firmas-declaracion',
                titulo: 'Declaración de Conformidad de Firma Electrónica',
                firmantes: bookData.firmantes || []
            }
        ];
        (bookData.documentos || []).forEach((d) => {
            secciones.push({
                tipo: 'libro-firmas-documento',
                titulo: d.tipo,
                tipoDocumento: d.tipo,
                sellado: d.sellado,
                fechaSellado: d.fecha_sellado,
                pdfHash: d.pdf_hash,
                jsonHash: d.json_hash,
                firmasRevision: d.firmas_revision,
                firmasAprobacion: d.firmas_aprobacion
            });
        });
        return {
            type: 'LIBRO_FIRMAS',
            package: {
                code: projectMeta.code || projectMeta.projectId || '',
                systemName: projectMeta.systemName || '',
                client: projectMeta.client || ''
            },
            document: {
                titleEs: 'Libro de Firmas',
                titleEn: 'Signature Book',
                code: 'LIBRO-FIRMAS-' + (projectMeta.projectId || ''),
                version: 'v1.0',
                status: 'Proyección generada el ' + new Date().toLocaleDateString('es-AR') + ' — ' + (
                    onlySealed
                        ? 'incluye solo documentos sellados de este proyecto'
                        : 'incluye cualquier documento con al menos una firma, sellado o no'
                )
            },
            matrizAprobaciones: [],
            controlCambios: [],
            secciones: secciones
        };
    }

    // ====================================================================
    // RENDERER PRINCIPAL
    // ====================================================================
    VS.registerRenderer('LIBRO_FIRMAS', function renderLibroFirmas(data) {
        const tb = VS.templateBase;
        const shared = VS.shared;
        const out = [];
        const secciones = data.secciones || [];

        const numberer = (shared && shared.createSectionNumberer) ? shared.createSectionNumberer() : (() => null);
        secciones.forEach((sec, idx) => {
            const num = numberer(sec);
            let titulo;
            if (sec.tipo === 'libro-firmas-declaracion') {
                titulo = 'Declaración de Conformidad de Firma Electrónica';
            } else if (sec.tipo === 'libro-firmas-documento') {
                titulo = `Firmas — ${sec.titulo || sec.tipoDocumento || ''}`;
            }
            const titleBlock = titulo ? tb.sectionTitle(`${num}. ${titulo}`, { marginTop: idx === 0 ? 0 : 12 }) : [];

            let contentBlock = [];
            switch (sec.tipo) {
                case 'libro-firmas-declaracion': contentBlock = renderDeclaracionConformidad(sec, tb); break;
                case 'libro-firmas-documento': contentBlock = renderDocumentoFirmas(sec, tb); break;
                case 'texto': contentBlock = shared.renderTexto(sec, tb); break;
                case 'tabla': contentBlock = shared.renderTabla(sec, tb); break;
                default:
                    contentBlock = [{ text: `[Tipo de sección desconocido: ${sec.tipo}]`, color: '#FF0000', margin: [0, 0, 0, 12] }];
            }

            out.push(...titleBlock, ...contentBlock);
        });

        return out;
    });

    VS.libroFirmas = { wrapSignatureBookAsDoc: wrapSignatureBookAsDoc };

})(window);
