// El color de un badge de estado en el editor visual tiene que corresponder al
// significado real del estado (aprobado/pasa = verde, rechazado/no aprobado = rojo,
// con reservas = naranja, no aplica = neutral).
//
//   node review-documentos/estado-color-test.cjs
//
// _estadoColor() (visual-editor.js) evaluaba el patron positivo (PASS|APROB|...) antes
// que la negacion. "NO APROBADO" y "NO VALIDADO" contienen "APROB"/"VALID" como
// substring, asi que un estado NEGADO se pintaba de exito. Encontrado en revision de
// Codex, 2026-09-19 (Ronda 17). Este test mide el color real que produce el render de
// matriz-tc (no llama a la funcion interna directo) para el vocabulario real que usan
// los documentos, en las dos copias del arbol.

const path = require('path');
const { chromium } = require('@playwright/test');

const VERDE = '#27AE60';
const ROJO = '#C0392B';
const NARANJA = '#E67E22';
const GRIS = '#717D8A';

const CASOS = {
  'PASA': VERDE, 'PASS': VERDE, 'NO PASA': ROJO, 'FAIL': ROJO,
  'APROBADO': VERDE, 'NO APROBADO': ROJO, 'VALIDADO': VERDE, 'NO VALIDADO': ROJO,
  'CUMPLE': VERDE, 'NO CUMPLE': ROJO,
  'CERRADO': VERDE, 'ABIERTO': ROJO, 'CRITICA': ROJO, 'RECHAZADO': ROJO,
  'PASA CON OBSERVACIONES': NARANJA, 'PENDIENTE': NARANJA, 'OBS': NARANJA,
  'NO APLICA': GRIS, 'N/A': GRIS,
};

async function medir(archivoRelativo) {
  const SV = p => path.join(__dirname, '..', archivoRelativo, p);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ path: SV('js/validation-suite/ui/visual-editor.js') });
    return await page.evaluate((casos) => {
      const res = {};
      Object.keys(casos).forEach((estado) => {
        const doc = { type: 'IIQ', document: {}, secciones: [
          { tipo: 'matriz-tc', titulo: 'x', tcs: [{ tcId: 'TC-001', titulo: 't', estado }] }
        ] };
        const container = document.getElementById('root');
        window.ValidationSuite.visualEditor.render(doc, container);
        const badge = container.querySelector('.ve-badge');
        res[estado] = badge ? badge.style.color : null;
      });
      return res;
    }, CASOS);
  } finally { await browser.close(); }
}

function hexOf(rgbOrHex) {
  if (!rgbOrHex) return null;
  if (rgbOrHex.startsWith('#')) return rgbOrHex.toUpperCase();
  const m = rgbOrHex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return rgbOrHex;
  return '#' + m.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

(async () => {
  const arboles = [
    ['SMART_Validation', 'SMART_Validation'],
    ['suite-revision-firmas', 'SMART_Validation/suite-revision-firmas/static'],
  ];
  let fallos = 0;
  for (const [label, dir] of arboles) {
    console.log(`\n-- ${label} --`);
    const res = await medir(dir);
    for (const [estado, esperado] of Object.entries(CASOS)) {
      const got = hexOf(res[estado]);
      const ok = got === esperado.toUpperCase();
      if (!ok) fallos++;
      console.log(`${ok ? ' OK ' : 'FALLA'}  ${estado.padEnd(24)} ${got}${ok ? '' : `   esperado ${esperado}`}`);
    }
  }
  console.log();
  if (fallos) { console.log(`RESULTADO: FALLA - ${fallos} caso(s) con el color equivocado`); process.exitCode = 1; }
  else console.log('RESULTADO: OK - el vocabulario real de estados da el color correcto en las dos copias');
})().catch(e => { console.error(e); process.exitCode = 2; });
