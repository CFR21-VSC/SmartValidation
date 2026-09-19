// Reproduccion visual de H-9: renderiza el VP REAL con la cadena de renderers
// autentica y guarda el PDF para inspeccion.
//
//   node review-documentos/render-vp.cjs [salida.pdf]
//
// No toca la base ni los documentos. Solo lee y produce un PDF local.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SV = path.join(RAIZ, 'SMART_Validation');
const SALIDA = process.argv[2] || path.join(__dirname, 'vp-real.pdf');

// Mismo orden de carga que usa la app (ver ensurePdfLibsLoaded en review.html)
const SCRIPTS = [
  'lib/pdfmake.min.js',
  'lib/vfs_fonts.js',
  'js/validation-suite/core/template-base.js',
  'js/validation-suite/core/shared-renderers.js',
  'js/validation-suite/core/document-renderer.js',
  'js/validation-suite/templates/vp.js',
].map(p => path.join(SV, p));

(async () => {
  // VP real del snapshot
  const snap = JSON.parse(fs.readFileSync(path.join(RAIZ, 'proj_1786639073632_2h83bp.project.json'), 'utf8'));
  const vp = snap.documents
    .map(d => d && d.content && d.content.data)
    .find(d => d && d.type === 'VP');
  if (!vp) throw new Error('No se encontro el VP en el snapshot');

  console.log(`VP: ${vp.secciones.length} secciones`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', m => console.log(`   [browser ${m.type()}] ${m.text().slice(0, 160)}`));
  page.on('pageerror', e => console.log(`   [browser ERROR] ${e.message.slice(0, 200)}`));

  await page.setContent('<div id="app"></div>');
  for (const s of SCRIPTS) {
    if (!fs.existsSync(s)) throw new Error('falta ' + s);
    await page.addScriptTag({ path: s });
  }

  const r = await page.evaluate(async data => {
    const VS = window.ValidationSuite;
    if (!VS || !VS.renderDocument) return { error: 'ValidationSuite no cargo' };
    if (!VS.renderers || !VS.renderers.VP) return { error: 'renderer VP no registrado' };
    try {
      const blob = await VS.renderDocument(data, { download: false });
      const buf = await blob.arrayBuffer();
      return { ok: true, bytes: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }, vp);

  await browser.close();

  if (r.error) { console.error('ERROR al renderizar:', r.error); process.exitCode = 1; return; }
  fs.writeFileSync(SALIDA, Buffer.from(r.bytes));
  console.log(`PDF generado: ${SALIDA}  (${(r.bytes.length / 1024).toFixed(0)} KB)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
