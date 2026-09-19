// Test de formas de celda y de interaccion del editor visual.
//
//   node review-documentos/celdas-test.cjs
//
// Cubre los contraejemplos adversariales de Codex (Ronda 4) mas los casos de
// interaccion que el test de preservacion no toca porque no simula edicion.
// Sale con codigo != 0 si algo se rompe. Corre contra AMBAS copias del editor.

const { chromium } = require('@playwright/test');
const path = require('path');

const EDITORES = [
  'SMART_Validation/js/validation-suite/ui/visual-editor.js',
  'SMART_Validation/suite-revision-firmas/static/js/validation-suite/ui/visual-editor.js',
];

// Formas de celda que deben volver IDENTICAS de un round-trip sin edicion.
const CELDAS = [
  ['string simple',              'texto'],
  ['string vacio',               ''],
  ['numero 0',                   0],
  ['booleano false',             false],
  ['null',                       null],
  ['{text} simple',              { text: 'X' }],
  ['{text} con formato',         { text: 'URS-001', bold: true, color: '#1F3C56' }],
  ['{text:""} con formato',      { text: '', bold: true }],
  ['{text} como ARRAY',          { text: [{ text: 'A', bold: true }, 'B'] }],
  ['{contenido}',                { contenido: 'A' }],
  ['{bullets}',                  { bullets: ['uno', 'dos'] }],
  ['{stack}',                    { stack: [{ text: 'A' }] }],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  let ok = 0; const fallas = [];

  for (const editor of EDITORES) {
    const et = path.basename(path.dirname(path.dirname(path.dirname(path.dirname(editor)))));
    const page = await browser.newPage();
    await page.setContent('<div id="e"></div>');
    await page.addScriptTag({ path: editor });

    // ── 1. Round-trip por forma de celda ────────────────────────────────────
    for (const [nombre, celda] of CELDAS) {
      const r = await page.evaluate(c => {
        const data = { type: 'X', secciones: [{ tipo: 'tabla', columnas: ['A'], filas: [[c]] }] };
        const cont = document.getElementById('e');
        ValidationSuite.visualEditor.render(data, cont);
        return ValidationSuite.visualEditor.serialize(data, cont).secciones[0].filas[0][0];
      }, celda);
      if (JSON.stringify(r) === JSON.stringify(celda)) ok++;
      else fallas.push({ editor: et, caso: nombre, antes: celda, despues: r });
    }

    // ── 2. Edicion real: cambiar el texto NO debe tocar el resto ─────────────
    const edit = await page.evaluate(() => {
      const data = { type: 'X', secciones: [{ tipo: 'tabla', columnas: ['A'],
        filas: [[{ text: 'viejo', bold: true, color: '#abc' }]] }] };
      const cont = document.getElementById('e');
      ValidationSuite.visualEditor.render(data, cont);
      cont.querySelector('tbody td.ve-td').textContent = 'nuevo';
      return ValidationSuite.visualEditor.serialize(data, cont).secciones[0].filas[0][0];
    });
    if (edit && edit.text === 'nuevo' && edit.bold === true && edit.color === '#abc') ok++;
    else fallas.push({ editor: et, caso: 'edicion preserva formato', despues: edit });

    // ── 3. "+ columna" sobre tabla con agrupacion ───────────────────────────
    const col = await page.evaluate(() => {
      const data = { type: 'X', secciones: [{ tipo: 'tabla', columnas: ['A', 'B'],
        filas: [{ subheader: 'Grupo 1' }, ['x', 'y']] }] };
      const cont = document.getElementById('e');
      ValidationSuite.visualEditor.render(data, cont);
      const btn = Array.from(cont.querySelectorAll('button, .ve-add-btn'))
        .find(b => (b.textContent || '').includes('+ columna'));
      if (btn) btn.click();
      const tdSub = cont.querySelector('td.ve-td-subheader');
      const out = ValidationSuite.visualEditor.serialize(data, cont);
      return {
        hallado: !!btn,
        colspan: tdSub ? tdSub.getAttribute('colspan') : null,
        celdasEnGrupo: tdSub ? tdSub.parentElement.querySelectorAll('td:not(.ve-td-actions)').length : null,
        agrupacion: out.secciones[0].filas[0],
      };
    });
    if (col.hallado && col.colspan === '3' && col.celdasEnGrupo === 1 &&
        JSON.stringify(col.agrupacion) === JSON.stringify({ subheader: 'Grupo 1' })) ok++;
    else fallas.push({ editor: et, caso: '+ columna con agrupacion', despues: col });

    // ── 4. Segundo ciclo render/serialize (idempotencia) ────────────────────
    const doble = await page.evaluate(() => {
      const data = { type: 'X', secciones: [{ tipo: 'tabla', columnas: ['A'],
        filas: [{ subheader: 'G' }, [{ text: 'v', bold: true }], [0], [{ bullets: ['a'] }]] }] };
      const cont = document.getElementById('e');
      ValidationSuite.visualEditor.render(data, cont);
      const uno = ValidationSuite.visualEditor.serialize(data, cont);
      ValidationSuite.visualEditor.render(uno, cont);
      const dos = ValidationSuite.visualEditor.serialize(uno, cont);
      return { uno: uno.secciones[0].filas, dos: dos.secciones[0].filas };
    });
    if (JSON.stringify(doble.uno) === JSON.stringify(doble.dos)) ok++;
    else fallas.push({ editor: et, caso: 'idempotencia (2do ciclo)', antes: doble.uno, despues: doble.dos });

    await page.close();
  }
  await browser.close();

  console.log('── Test de formas de celda e interaccion ────────────────────────');
  console.log(`   verificaciones OK : ${ok}`);
  console.log(`   fallas            : ${fallas.length}`);
  if (fallas.length) {
    console.log('');
    fallas.forEach(f => console.log('   ' + JSON.stringify(f).slice(0, 240)));
    process.exitCode = 1;
  } else {
    console.log('\n   RESULTADO: OK en ambas copias del editor.');
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
