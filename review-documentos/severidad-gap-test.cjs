// El color de la tarjeta de gap tiene que corresponder a la severidad.
//
//   node review-documentos/severidad-gap-test.cjs
//
// shared-renderers.js declara el vocabulario canonico de Escala A para la
// severidad del gap del HLRA: CRITICA / MAYOR / MENOR / OBSERVACION, "TODO en
// mayuscula al persistir en JSON".
//
// El mapa de colores de hlra.js conocia solo 'menor'/'mayor'/'critico'/'info'
// en minuscula. Medido: de los cuatro valores CANONICOS, dos no se reconocian
// y caian al color por defecto, que es el de MENOR:
//
//   CRITICA      -> #C0392B (el de menor)   en vez del rojo critico #A93226
//   OBSERVACION  -> #C0392B (el de menor)   en vez del azul info   #2980B9
//
// Un gap clasificado CRITICA se dibujaba con el mismo color que uno menor, sin
// error ni aviso. Este test mide el color real que produce el renderer para
// cada valor, canonico e historico. No genera PDF ni escribe archivos.

const path = require('path');
const { chromium } = require('@playwright/test');
const SV = p => path.join(__dirname, '..', 'SMART_Validation', p);

const CRITICO = '#A93226';

(async () => {
  const browser = await chromium.launch({ headless: true });
  let out;
  try {
    const page = await browser.newPage();
    await page.setContent('<div></div>');
    for (const f of ['lib/pdfmake.min.js', 'lib/vfs_fonts.js',
      'js/validation-suite/core/template-base.js',
      'js/validation-suite/core/shared-renderers.js',
      'js/validation-suite/core/document-renderer.js',
      'js/validation-suite/templates/hlra.js']) await page.addScriptTag({ path: SV(f) });

    out = await page.evaluate(() => {
      const VS = window.ValidationSuite;
      const C = VS.templateBase.VS_COLORS;
      const medir = (sev) => {
        const doc = { type: 'HLRA', document: {}, secciones: [
          { tipo: 'tarjeta-gap', id: 'GAP-001', titulo: 'x', severidad: sev,
            norma: 'n', descripcion: 'd' }] };
        const m = JSON.stringify(VS.renderers.HLRA(doc)).match(/"fillColor":"(#[0-9A-Fa-f]{6})"/);
        return m ? m[1] : null;
      };
      const vals = ['CRÍTICA', 'MAYOR', 'MENOR', 'OBSERVACIÓN',
                    'critico', 'mayor', 'menor', 'info', 'Crítica', 'CRITICA'];
      const res = {};
      vals.forEach(v => { res[v] = medir(v); });
      return { res, paleta: { menor: C.sevMenor, mayor: C.sevMayor, info: C.sevInfo } };
    });
  } finally { await browser.close(); }

  const P = out.paleta;
  const esperado = {
    // Canonicos (Escala A, como los declara shared-renderers.js)
    'CRÍTICA': CRITICO, 'MAYOR': P.mayor, 'MENOR': P.menor, 'OBSERVACIÓN': P.info,
    // Historicos, ya presentes en documentos escritos
    'critico': CRITICO, 'mayor': P.mayor, 'menor': P.menor, 'info': P.info,
    // Variantes de caja y acento: no deben cambiar el resultado
    'Crítica': CRITICO, 'CRITICA': CRITICO,
  };

  console.log('Color de la tarjeta de gap por severidad\n');
  let mal = 0;
  for (const [v, esp] of Object.entries(esperado)) {
    const got = out.res[v];
    const ok = got === esp;
    if (!ok) mal++;
    console.log(`${ok ? ' OK ' : 'FALLA'}  ${v.padEnd(14)} ${got}${ok ? '' : `   esperado ${esp}`}`);
  }
  console.log();
  if (mal) { console.log(`RESULTADO: FALLA - ${mal} valor(es) con el color equivocado`); process.exitCode = 1; }
  else console.log('RESULTADO: OK - los cuatro valores canonicos y los historicos dan su color');
})().catch(e => { console.error(e); process.exitCode = 2; });
