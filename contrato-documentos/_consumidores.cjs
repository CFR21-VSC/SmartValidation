// Consumidores REALES de produccion, para las pruebas de cadena.
//
//   node contrato-documentos/_consumidores.cjs <doc.json> [<doc2.json> ...]
//
// Imprime, por documento, un JSON con:
//   numeracion  -> usando VS.shared.createSectionNumberer, el numerador real
//   proyeccion  -> proyeccion ESTRUCTURAL del contenido que el renderer del tipo
//                  produce ANTES del layout: por cada nodo, su clase y su texto.
//
// No es una reimplementacion: la prueba anterior tenia su propia copia del
// numerador, incompleta (ignoraba los overrides enteros de `numero` y excluia
// todas las cajas, que el real no excluye).
//
// No escribe archivos ni genera PDF.

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const RAIZ = path.join(__dirname, '..');
const SV = p => path.join(RAIZ, 'SMART_Validation', p);
const SCRIPTS = [
  'lib/pdfmake.min.js', 'lib/vfs_fonts.js',
  'js/validation-suite/core/template-base.js',
  'js/validation-suite/core/shared-renderers.js',
  'js/validation-suite/core/document-renderer.js',
];

(async () => {
  const rutas = process.argv.slice(2);
  const docs = rutas.map(r => JSON.parse(fs.readFileSync(r, 'utf8').replace(/^\uFEFF/, '')));
  const tipos = [...new Set(docs.map(d => String(d.type || '').toLowerCase()))];

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div></div>');
    for (const f of SCRIPTS) await page.addScriptTag({ path: SV(f) });
    for (const t of tipos) {
      const p = SV(`js/validation-suite/templates/${t}.js`);
      if (fs.existsSync(p)) await page.addScriptTag({ path: p });
    }

    const out = await page.evaluate((docs) => {
      const VS = window.ValidationSuite;
      const proyectar = (nodo, acc, prof) => {
        if (nodo == null || prof > 12) return;
        if (typeof nodo === 'string') { if (nodo.trim()) acc.push('t:' + nodo.trim()); return; }
        if (typeof nodo === 'number' || typeof nodo === 'boolean') { acc.push('v:' + nodo); return; }
        if (Array.isArray(nodo)) { nodo.forEach(n => proyectar(n, acc, prof + 1)); return; }
        // Clase del nodo: que tipo de cosa dibuja, sin sus medidas ni estilos.
        const clase = ['table', 'ul', 'ol', 'stack', 'columns', 'canvas', 'image', 'svg', 'text']
          .find(k => nodo[k] !== undefined);
        if (clase) acc.push('n:' + clase);
        for (const k of Object.keys(nodo)) {
          if (['margin', 'fontSize', 'bold', 'color', 'fillColor', 'widths', 'alignment',
               'lineHeight', 'italics', 'border', 'layout', 'style', 'heights',
               'lineWidth', 'lineColor', 'x1', 'y1', 'x2', 'y2', 'w', 'h'].includes(k)) continue;
          proyectar(nodo[k], acc, prof + 1);
        }
      };

      return docs.map(d => {
        const numberer = VS.shared.createSectionNumberer();
        const numeracion = (d.secciones || []).map(s => numberer(s));
        let proyeccion = null, error = null;
        try {
          const r = VS.renderers && VS.renderers[d.type];
          if (r) { const acc = []; proyectar(r(d) || [], acc, 0); proyeccion = acc; }
          else error = 'no hay renderer para el tipo ' + d.type;
        } catch (e) { error = String(e && e.message || e); }
        return { tipo: d.type, numeracion, proyeccion, error };
      });
    }, docs);

    console.log(JSON.stringify(out));
  } finally { await browser.close(); }
})().catch(e => { console.error(String(e && e.stack || e)); process.exitCode = 1; });
