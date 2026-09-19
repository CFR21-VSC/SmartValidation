// Reproduccion: de donde salen las coordenadas absolutas en los canvas guardados.
//
//   node review-documentos/canvas-probe.cjs
//
// Hallazgo que motiva la prueba. La MISMA linea de canvas, en el mismo lugar
// (secciones[15].filas[0][0].stack[4]), aparece con tres formas distintas:
//
//   fixture urs-drp-sis-001.json      x1:0   y1:0        x2:130 y2:0
//   Proyecto_Prueba_2026_RECOVERED    x1:50  y1:677.625  x2:180 y2:677.625   + nodeInfo
//   snapshot citado en la Ronda 7     ...    y1:2710.5
//
// El fixture es el original confiable: una regla horizontal de 130pt dibujada
// en el origen local, que es como se authorea un canvas en pdfMake. Las otras
// dos traen coordenadas ABSOLUTAS de pagina, distintas entre si, y una de ellas
// arrastra ademas `nodeInfo`, que es una clave interna de pdfMake (esta en
// lib/pdfmake.min.js, no la escribe ningun codigo nuestro).
//
// Hipotesis: no son tres documentos distintos con datos raros. Es un unico
// defecto —pdfMake escribiendo su layout resuelto sobre los nodos que recibe—
// cuyo residuo quedo guardado. y1 2710.5 vs 677.625 es la misma linea en otra
// posicion de pagina, no otro dato.
//
// Esta prueba no modifica ningun archivo.

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const RAIZ = path.join(__dirname, '..');
const LIB = p => path.join(RAIZ, 'SMART_Validation/lib', p);

// El canvas tal como lo trae el original confiable.
const ORIGINAL = { type: 'line', x1: 0, y1: 0, x2: 130, y2: 0, lineWidth: 0.5, lineColor: '#D0D5DB' };

const construirDoc = (canvasNode) => ({
  pageSize: 'A4',
  pageMargins: [50, 50, 50, 50],
  content: [
    // Relleno para empujar el canvas hacia abajo: si pdfMake escribe la posicion
    // resuelta, el y1 que quede reflejara ESA posicion y no el 0 original.
    ...Array.from({ length: 30 }, (_, i) => ({ text: `linea de relleno ${i + 1}`, margin: [0, 4, 0, 4] })),
    { stack: [{ canvas: [canvasNode] }] },
  ],
});

async function render(clonar) {
  // Un browser por variante: pdfMake muta los nodos entre renders y encadenar
  // dos variantes en la misma pagina contamina la segunda.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div></div>');
    await page.addScriptTag({ path: LIB('pdfmake.min.js') });
    await page.addScriptTag({ path: LIB('vfs_fonts.js') });
    return await page.evaluate(async ({ original, clonar }) => {
      const nodo = JSON.parse(JSON.stringify(original));
      const doc = {
        pageSize: 'A4',
        pageMargins: [50, 50, 50, 50],
        content: [
          ...Array.from({ length: 30 }, (_, i) => ({ text: `linea de relleno ${i + 1}`, margin: [0, 4, 0, 4] })),
          { stack: [{ canvas: [nodo] }] },
        ],
      };
      const entregado = clonar ? JSON.parse(JSON.stringify(doc)) : doc;
      await new Promise((ok, fail) => {
        try { pdfMake.createPdf(entregado).getBuffer(() => ok()); } catch (e) { fail(e); }
      });
      return { nodo, claves: Object.keys(nodo) };
    }, { original: ORIGINAL, clonar });
  } finally { await browser.close(); }
}

(async () => {
  console.log('Canvas: origen de las coordenadas absolutas\n');
  console.log('  original confiable (fixture):', JSON.stringify(ORIGINAL));

  const sinClon = await render(false);
  const conClon = await render(true);

  const igual = a => JSON.stringify(a.nodo) === JSON.stringify(ORIGINAL);

  console.log('\n  entregado a pdfMake SIN clonar:');
  console.log('    nodo despues del render:', JSON.stringify(sinClon.nodo));
  console.log('    claves:', sinClon.claves.join(', '));
  console.log('    intacto:', igual(sinClon) ? 'SI' : 'NO — pdfMake lo reescribio');

  console.log('\n  entregado a pdfMake CON deep clone (lo que hace hoy el renderer):');
  console.log('    nodo despues del render:', JSON.stringify(conClon.nodo));
  console.log('    claves:', conClon.claves.join(', '));
  console.log('    intacto:', igual(conClon) ? 'SI' : 'NO — pdfMake lo reescribio');

  const muta = !igual(sinClon);
  const protege = igual(conClon);
  console.log('\n  CONCLUSION:');
  if (muta && protege) {
    console.log('    Confirmado: sin clonar, pdfMake reescribe el nodo de canvas con su');
    console.log('    layout resuelto; con el deep clone el original queda intacto. Las');
    console.log('    coordenadas absolutas guardadas son residuo de ese defecto, ya');
    console.log('    corregido en el renderer. No es un dato de origen a "limpiar".');
  } else if (!muta) {
    console.log('    REFUTADA: pdfMake NO toco el nodo. La hipotesis no explica el dato');
    console.log('    guardado; hay que buscar el origen en otro lado (editor, importador).');
  } else {
    console.log('    PARCIAL: pdfMake muta, pero el clon no alcanza a proteger el nodo.');
  }
  process.exitCode = muta && protege ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 2; });
