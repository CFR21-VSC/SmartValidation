// Verifica que la migracion aditiva NO altera la numeracion que produce el
// renderer actual (que no conoce `clase` ni `padre`).
//
//   node contrato-documentos/numeracion-test.cjs
//
// Responde al contraejemplo de Codex (Ronda 4): con la instancia v3 anterior, el
// item 27 del VP pasaba de 14 a 19 porque se habia cambiado `tipo: subseccion`
// a `texto` y quitado los prefijos de titulo. La migracion aditiva no toca esos
// campos, asi que el numerador legacy debe dar exactamente lo mismo.
//
// Sale con codigo != 0 si alguna numeracion difiere.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SHARED = path.join(RAIZ, 'SMART_Validation/js/validation-suite/core/shared-renderers.js');

function leer(p) { let s = fs.readFileSync(p, 'utf8'); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return JSON.parse(s); }

function origenURS() { return leer(path.join(RAIZ, 'SMART_Validation/js/validation-suite/fixtures/urs-drp-sis-001.json')); }
function origenVP() {
  const snap = leer(path.join(RAIZ, 'proj_1786639073632_2h83bp.project.json'));
  return snap.documents.map(d => d && d.content && d.content.data).find(d => d && d.type === 'VP');
}

const CASOS = [
  ['URS', origenURS, 'contrato-documentos/ejemplos/urs.instancia.valida.json'],
  ['VP',  origenVP,  'contrato-documentos/ejemplos/vp.instancia.valida.json'],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<div></div>');
  // shared-renderers necesita el namespace creado; template-base no hace falta
  // para createSectionNumberer.
  await page.evaluate(() => { window.ValidationSuite = { shared: {} }; });
  await page.addScriptTag({ path: SHARED });

  let fallas = 0;
  for (const [tipo, cargarOrigen, rutaV3] of CASOS) {
    const orig = cargarOrigen();
    const v3 = leer(path.join(RAIZ, rutaV3));

    const r = await page.evaluate(({ a, b }) => {
      const num = secs => {
        const n = ValidationSuite.shared.createSectionNumberer();
        return secs.map(s => n(s));
      };
      return { antes: num(a.secciones), despues: num(b.secciones) };
    }, { a: orig, b: v3 });

    const iguales = JSON.stringify(r.antes) === JSON.stringify(r.despues);
    console.log(`── ${tipo}: ${orig.secciones.length} elementos`);
    console.log(`   numeracion original : [${r.antes.join(', ')}]`);
    console.log(`   numeracion con v3   : [${r.despues.join(', ')}]`);
    if (iguales) {
      console.log('   OK — identica\n');
    } else {
      fallas++;
      const dif = r.antes.map((v, i) => [i + 1, v, r.despues[i]]).filter(([, a, b]) => a !== b);
      console.log(`   FALLA — ${dif.length} posiciones distintas:`);
      dif.slice(0, 8).forEach(([i, a, b]) => console.log(`      item ${i}: ${a} -> ${b}`));
      console.log('');
    }
  }
  await browser.close();

  if (fallas) { console.log(`RESULTADO: ${fallas} documento(s) con numeracion alterada.`); process.exitCode = 1; }
  else console.log('RESULTADO: OK — la migracion aditiva no altera la numeracion legacy.');
})().catch(e => { console.error(e); process.exitCode = 1; });
