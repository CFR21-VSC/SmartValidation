// Controlled comparison: original vs local canvas coordinates, in memory only.
// node review-documentos/round7-border-probe.cjs <URS.json>
const fs = require('fs');
const { chromium } = require('@playwright/test');
(async () => {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  for (const variant of ['original', 'local-canvas']) {
    const input = structuredClone(data);
    const section = input.secciones.find(s => (s.titulo || '').includes('RESUMEN ESTAD'));
    const line = section.filas[0][0].stack.find(n => n.canvas).canvas[0];
    const before = structuredClone(line);
    if (variant === 'local-canvas') Object.assign(line, { x1: 0, y1: 0, x2: 100, y2: 0 });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div></div>');
      for (const file of ['lib/pdfmake.min.js', 'lib/vfs_fonts.js', 'js/validation-suite/core/template-base.js', 'js/validation-suite/core/shared-renderers.js', 'js/validation-suite/core/document-renderer.js', 'js/validation-suite/templates/urs.js'])
        await page.addScriptTag({ path: 'SMART_Validation/' + file });
      const bytes = await page.evaluate(async d => {
        const blob = await ValidationSuite.renderDocument(d, { download: false });
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }, input);
      fs.writeFileSync(`review-documentos/round7-${variant}.pdf`, Buffer.from(bytes));
      console.log(JSON.stringify({ variant, before, after: line, bytes: bytes.length }));
    } finally { await browser.close(); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
