// Test de preservación del round-trip del editor visual.
//
//   node review-documentos/preservation-test.cjs
//
// Complementa a roundtrip-probe.cjs (que reproduce y reporta) agregando ASERCIONES:
// sale con código != 0 si alguna de las cuatro invariantes se rompe, en cualquiera de
// las dos copias del editor.
//
// Invariantes verificadas, sobre render() + serialize() SIN interacción del usuario:
//   A. Filas de agrupación {subheader} se reemiten idénticas (N-2).
//   B. Celdas ricas {text,color,bold,fillColor,…} conservan todas sus propiedades (H-6).
//   C. No se inyecta `columnas` en secciones que no la tenían (round-trip limpio).
//   D. Celdas opacas (objeto SIN `text`, p.ej. {bullets:[…]}) vuelven intactas.
//
// Aserciones FOCALIZADAS a propósito: no comparan el documento entero. Existen otras
// normalizaciones conocidas en el round-trip que este test no debe ocultar ni
// bloquear; se inventarían aparte (ver INFORME §7, paso 1).
//
// No escribe en ninguna base ni modifica fixtures.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Corpus por defecto: los fixtures del repo. Se puede apuntar a documentos reales:
//   node review-documentos/preservation-test.cjs "C:/.../ai-docs"
const FIXTURE_DIR = process.argv[2] || 'SMART_Validation/js/validation-suite/fixtures';

/** Los documentos reales vienen con BOM UTF-8; JSON.parse falla con BOM. */
function leerJson(p) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return JSON.parse(s);
}
const EDITORES = [
  'SMART_Validation/js/validation-suite/ui/visual-editor.js',
  'SMART_Validation/suite-revision-firmas/static/js/validation-suite/ui/visual-editor.js',
];

function esCeldaRica(c) {
  return c && typeof c === 'object' && !Array.isArray(c) && typeof c.text === 'string';
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const fallas = [];
  const resumen = { subheaders: 0, celdasRicas: 0, celdasOpacas: 0, secciones: 0, archivos: 0 };

  try {
    for (const editor of EDITORES) {
      const page = await browser.newPage();
      await page.setContent('<div id="editor"></div>');
      await page.addScriptTag({ path: editor });

      const archivos = fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json'));
      for (const file of archivos) {
        const data = leerJson(path.join(FIXTURE_DIR, file));
        if (!Array.isArray(data.secciones)) continue;

        const r = await page.evaluate(({ data }) => {
          const cont = document.getElementById('editor');
          ValidationSuite.visualEditor.render(data, cont);
          const out = ValidationSuite.visualEditor.serialize(data, cont);

          const rico = c => c && typeof c === 'object' && !Array.isArray(c) && typeof c.text === 'string';
          const res = { subheaders: 0, celdasRicas: 0, celdasOpacas: 0, secciones: 0, fallas: [] };

          (data.secciones || []).forEach((sec, i) => {
            const post = (out.secciones || [])[i];
            res.secciones++;
            if (!post) { res.fallas.push({ tipo: 'seccion-perdida', i }); return; }

            // C. columnas fantasma
            if (!('columnas' in sec) && ('columnas' in post)) {
              res.fallas.push({ tipo: 'columnas-inyectada', i, tipoSec: sec.tipo });
            }

            (sec.filas || []).forEach((fila, j) => {
              const after = (post.filas || [])[j];

              // A. agrupaciones
              if (fila && typeof fila === 'object' && !Array.isArray(fila) && fila.subheader != null) {
                res.subheaders++;
                if (JSON.stringify(fila) !== JSON.stringify(after)) {
                  res.fallas.push({ tipo: 'subheader-perdido', i, j, antes: fila, despues: after });
                }
                return;
              }

              // D. celdas opacas: objeto SIN `text` ({bullets}, {stack}) → intactas
              if (Array.isArray(fila)) {
                fila.forEach((celda, k) => {
                  const esOpaca = celda && typeof celda === 'object' && !Array.isArray(celda)
                                  && celda.text == null && celda.contenido == null;
                  if (!esOpaca) return;
                  res.celdasOpacas = (res.celdasOpacas || 0) + 1;
                  const ac = Array.isArray(after) ? after[k] : undefined;
                  if (JSON.stringify(ac) !== JSON.stringify(celda)) {
                    res.fallas.push({ tipo: 'celda-opaca-alterada', i, j, k, antes: celda, despues: ac });
                  }
                });
              }

              // B. celdas ricas
              if (Array.isArray(fila)) {
                fila.forEach((celda, k) => {
                  if (!rico(celda)) return;
                  res.celdasRicas++;
                  const ac = Array.isArray(after) ? after[k] : undefined;
                  if (!rico(ac)) {
                    res.fallas.push({ tipo: 'celda-aplanada', i, j, k, antes: celda, despues: ac });
                    return;
                  }
                  for (const prop of Object.keys(celda)) {
                    if (prop === 'text') continue;
                    if (JSON.stringify(ac[prop]) !== JSON.stringify(celda[prop])) {
                      res.fallas.push({ tipo: 'prop-perdida', i, j, k, prop, antes: celda[prop], despues: ac[prop] });
                    }
                  }
                });
              }
            });
          });
          return res;
        }, { data });

        resumen.archivos++;
        resumen.subheaders += r.subheaders;
        resumen.celdasRicas += r.celdasRicas;
        resumen.celdasOpacas += (r.celdasOpacas || 0);
        resumen.secciones += r.secciones;
        r.fallas.forEach(f => fallas.push({ editor: path.basename(path.dirname(path.dirname(path.dirname(path.dirname(editor))))), file, ...f }));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('── Test de preservación del round-trip ──────────────────────────');
  console.log(`  archivos analizados : ${resumen.archivos}`);
  console.log(`  secciones           : ${resumen.secciones}`);
  console.log(`  agrupaciones        : ${resumen.subheaders}`);
  console.log(`  celdas ricas        : ${resumen.celdasRicas}`);
  console.log(`  celdas opacas       : ${resumen.celdasOpacas}`);
  console.log('');

  if (!fallas.length) {
    console.log('  RESULTADO: OK — las 4 invariantes se cumplen en ambas copias.');
    return;
  }

  const porTipo = fallas.reduce((a, f) => { a[f.tipo] = (a[f.tipo] || 0) + 1; return a; }, {});
  console.log(`  RESULTADO: FALLA — ${fallas.length} pérdidas`);
  Object.entries(porTipo).forEach(([t, n]) => console.log(`    ${t}: ${n}`));
  console.log('');
  fallas.slice(0, 8).forEach(f => console.log('    ' + JSON.stringify(f).slice(0, 220)));
  if (fallas.length > 8) console.log(`    … y ${fallas.length - 8} más`);
  process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
