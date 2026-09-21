/* ====================================================================
   Ronda 19, segunda devolución de Codex (2026-09-21) — "comparar Python y JS no
   requiere infraestructura nueva; usar el mismo JSON y comparar salida normalizada."

   Script standalone de Node (sin framework de test JS en este repo, ver package.json)
   que carga libro-firmas.js con un stub mínimo de ValidationSuite, llama a
   wrapSignatureBookAsDoc con el `book_data`/`project_meta` que le pasen por argv, e
   imprime el resultado como JSON a stdout -- para que un test de pytest (Python) lo
   invoque como subproceso y compare contra wrap_signature_book_as_document (book.py)
   con la MISMA entrada. Ver tests/test_signature_consent.py::test_python_and_js_wrappers_agree.

   Uso: node _libro_firmas_wrapper_contract.js '<book_data JSON>' '<project_meta JSON>' '<onlySealed: "true"|"false">'
   ==================================================================== */
'use strict';

global.window = global;
global.ValidationSuite = { registerRenderer: () => {}, shared: {} };

require('./libro-firmas.js');

const bookData = JSON.parse(process.argv[2]);
const projectMeta = JSON.parse(process.argv[3]);
const onlySealed = process.argv[4] === 'true';

const wrapped = global.ValidationSuite.libroFirmas.wrapSignatureBookAsDoc(bookData, projectMeta, onlySealed);
process.stdout.write(JSON.stringify(wrapped));
