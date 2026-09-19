// Adversarial review probe. No production files or documents are modified.
const fs = require('fs');
const vm = require('vm');
const { chromium } = require('@playwright/test');
const source = fs.readFileSync('contrato-documentos/validar.cjs', 'utf8').split('// ── CLI')[0];
const ctx = { require, __dirname: require('path').resolve('contrato-documentos') };
vm.createContext(ctx);
vm.runInContext(source + '\nthis.validate = validar;', ctx);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const skeleton = read('contrato-documentos/urs.skeleton.v3.json');
const base = read('contrato-documentos/ejemplos/urs.instancia.valida.json');
const cases = {
  wrongSkeletonType: d => { d.esqueleto.tipo = 'VP'; },
  wrongSectionType: d => { d.secciones[0].tipo = 'tipo-inexistente'; },
  wrongParent: d => { d.secciones.find(s => s.id === 'descripcion-general').padre = 'proposito'; },
  emptyPurpose: d => { const s = d.secciones[0]; delete s.bloques; delete s.texto; delete s.contenido; },
  changedColumnLabels: d => { d.secciones[11].columnas = d.secciones[11].columnas.map(() => 'incorrecta'); },
  missingColumns: d => { delete d.secciones[11].columnas; },
  badSummary: d => { d.requirementsSummary = { total: -100 }; },
  zeroFourDigits: d => { d.secciones[11].filas.find(Array.isArray)[0] = 'URS-0000'; },
};
for (const [name, mutate] of Object.entries(cases)) {
  const d = structuredClone(base); mutate(d);
  const result = ctx.validate(skeleton, d, name);
  console.log(JSON.stringify({ kind: 'validation', name, errors: result.errores }));
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const editor of ['SMART_Validation/js/validation-suite/ui/visual-editor.js', 'SMART_Validation/suite-revision-firmas/static/js/validation-suite/ui/visual-editor.js']) {
      const page = await browser.newPage();
      await page.setContent('<div id="editor"></div>');
      await page.addScriptTag({ path: editor });
      const results = await page.evaluate(() => {
        const cells = [{ text: '', bold: true }, { stack: [{ text: 'A' }] }, { text: [{ text: 'A', bold: true }, 'B'] }, { contenido: 'A' }, 0, false];
        const out = [];
        for (const cell of cells) {
          const d = { secciones: [{ tipo: 'tabla', columnas: ['X'], filas: [[cell]] }] };
          const c = document.getElementById('editor');
          ValidationSuite.visualEditor.render(d, c);
          out.push({ before: cell, after: ValidationSuite.visualEditor.serialize(d, c).secciones[0].filas[0][0] });
        }
        const d = { secciones: [{ tipo: 'tabla', columnas: ['A', 'B'], filas: [{ subheader: 'Grupo' }, ['a', 'b']] }] };
        const c = document.getElementById('editor');
        ValidationSuite.visualEditor.render(d, c);
        [...c.querySelectorAll('button')].find(b => b.textContent === '+ columna').click();
        const table = c.querySelector('.ve-td-subheader').closest('table');
        out.push({ addColumn: { groupColspan: table.querySelector('.ve-td-subheader').colSpan, groupCells: table.querySelector('tbody tr').children.length, headers: table.querySelectorAll('thead th:not(.ve-th-actions)').length } });
        return out;
      });
      console.log(JSON.stringify({ kind: 'editor', editor, results }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
