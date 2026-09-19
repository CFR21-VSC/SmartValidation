// Reproducción aislada: no guarda documentos ni modifica datos del proyecto.
// Ejecutar desde la raíz: node review-documentos/roundtrip-probe.cjs
const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const fixtureDir = 'SMART_Validation/js/validation-suite/fixtures';
    for (const editor of [
      'SMART_Validation/js/validation-suite/ui/visual-editor.js',
      'SMART_Validation/suite-revision-firmas/static/js/validation-suite/ui/visual-editor.js',
    ]) {
      const page = await browser.newPage();
      await page.setContent('<div id="editor"></div>');
      await page.addScriptTag({ path: editor });
      for (const file of fs.readdirSync(fixtureDir).filter(f => f.endsWith('.json'))) {
        const data = JSON.parse(fs.readFileSync(`${fixtureDir}/${file}`, 'utf8'));
        const result = await page.evaluate(data => {
          const container = document.getElementById('editor');
          ValidationSuite.visualEditor.render(data, container);
          const output = ValidationSuite.visualEditor.serialize(data, container);
          const losses = [];
          let groups = 0;
          (data.secciones || []).forEach((section, i) => {
            (section.filas || []).forEach((row, j) => {
              if (row && row.subheader) {
                groups++;
                const after = output.secciones[i].filas[j];
                if (JSON.stringify(row) !== JSON.stringify(after))
                  losses.push({ section: i, row: j, before: row, after });
              }
            });
          });
          return { groups, losses };
        }, data);
        if (result.groups) console.log(JSON.stringify({ editor, file, ...result }));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
