// Inventario COMPLETO del round-trip: compara el documento entero antes/despues
// de render()+serialize(), sin interaccion, y clasifica TODA diferencia.
//
//   node review-documentos/inventario-roundtrip.cjs [directorio]
//
// A diferencia de preservation-test.cjs (aserciones focalizadas que fallan), esto
// NO falla: inventaria. Sirve para saber que falta, no para bloquear.
// Responde al pedido de Codex: "mantener visible el inventario del resto".

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2] || 'SMART_Validation/js/validation-suite/fixtures';
const EDITOR = 'SMART_Validation/js/validation-suite/ui/visual-editor.js';

function leerJson(p) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return JSON.parse(s);
}

/** Diff recursivo. Devuelve lista de {ruta, tipo, antes, despues}. */
function diff(a, b, ruta = '', out = []) {
  if (a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;

  if (ta !== tb) { out.push({ ruta, tipo: `cambio-de-tipo:${ta}->${tb}`, antes: a, despues: b }); return out; }

  if (ta === 'array') {
    if (a.length !== b.length) out.push({ ruta, tipo: `largo-array:${a.length}->${b.length}`, antes: a.length, despues: b.length });
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff(a[i], b[i], `${ruta}[${i}]`, out);
    return out;
  }
  if (ta === 'object') {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of ks) {
      if (!(k in a)) { out.push({ ruta: `${ruta}.${k}`, tipo: 'clave-agregada', antes: undefined, despues: b[k] }); continue; }
      if (!(k in b)) { out.push({ ruta: `${ruta}.${k}`, tipo: 'clave-eliminada', antes: a[k], despues: undefined }); continue; }
      diff(a[k], b[k], `${ruta}.${k}`, out);
    }
    return out;
  }
  out.push({ ruta, tipo: 'valor-distinto', antes: a, despues: b });
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<div id="e"></div>');
  await page.addScriptTag({ path: EDITOR });

  const porTipo = {};       // tipo de diferencia -> conteo
  const porArchivo = {};    // archivo -> conteo
  const ejemplos = {};      // tipo -> ejemplo
  let archivos = 0, limpios = 0;

  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json'))) {
    const data = leerJson(path.join(DIR, f));
    if (!Array.isArray(data.secciones)) continue;
    archivos++;

    const salida = await page.evaluate(d => {
      const c = document.getElementById('e');
      ValidationSuite.visualEditor.render(d, c);
      return ValidationSuite.visualEditor.serialize(d, c);
    }, data);

    const ds = diff(data, salida);
    if (!ds.length) { limpios++; continue; }
    porArchivo[f] = ds.length;
    for (const d of ds) {
      // normalizar la ruta para agrupar: secciones[3].filas[7].text -> secciones[].filas[].text
      const clave = d.tipo + '  @  ' + d.ruta.replace(/\[\d+\]/g, '[]');
      porTipo[clave] = (porTipo[clave] || 0) + 1;
      if (!ejemplos[clave]) ejemplos[clave] = d;
    }
  }
  await browser.close();

  const total = Object.values(porTipo).reduce((a, b) => a + b, 0);
  console.log(`── Inventario de round-trip ─────────────────────────────────────`);
  console.log(`   corpus   : ${DIR}`);
  console.log(`   archivos : ${archivos}  (${limpios} vuelven IDENTICOS, ${archivos - limpios} con diferencias)`);
  console.log(`   diferencias totales: ${total}`);
  console.log('');

  if (!total) { console.log('   Sin diferencias: el round-trip es exacto.'); return; }

  console.log('   POR CLASE DE DIFERENCIA:');
  Object.entries(porTipo).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
    const e = ejemplos[k];
    const a = JSON.stringify(e.antes), b = JSON.stringify(e.despues);
    console.log(`     ${String(n).padStart(5)}  ${k}`);
    console.log(`            antes=${(a || 'undefined').slice(0, 70)}`);
    console.log(`            despues=${(b || 'undefined').slice(0, 70)}`);
  });
  console.log('');
  console.log('   POR ARCHIVO:');
  Object.entries(porArchivo).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`     ${String(n).padStart(5)}  ${f}`));
})().catch(e => { console.error(e); process.exitCode = 1; });
