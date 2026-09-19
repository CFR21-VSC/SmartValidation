// Comprueba que el canvas corrupto produce un defecto VISIBLE, y que la
// reparacion propuesta lo corrige, sin cambiar nada mas de la pagina.
//
//   node review-documentos/canvas-visual-test.cjs
//
// El stack de "RESUMEN ESTADISTICO DE REQUERIMIENTOS" es identico en el fixture
// confiable y en URS-EMQC-001: seis nodos, mismos roles, solo cambian los
// numeros. La unica diferencia estructural es el canvas de stack[4]:
//
//   fixture           x1:0   y1:0      x2:130 y2:0        <- regla de 130pt en el origen
//   URS-EMQC-001      x1:200 y1:2710.5 x2:330 y2:2710.5   <- misma regla (330-200=130) desplazada
//
// Con y=2710.5 la linea se dibuja 2710pt por debajo del ancla: fuera de la
// pagina. El separador no se ve. Esta prueba lo mide en pixeles en vez de dar
// por bueno que el PDF se genere sin excepcion.
//
// No modifica ningun archivo.

const path = require('path');
const { chromium } = require('@playwright/test');

const RAIZ = path.join(__dirname, '..');
const LIB = p => path.join(RAIZ, 'SMART_Validation/lib', p);

const CORRUPTO = { type: 'line', x1: 200, y1: 2710.5, x2: 330, y2: 2710.5, lineWidth: 0.5, lineColor: '#D0D5DB' };
const REPARADO = { type: 'line', x1: 0, y1: 0, x2: 130, y2: 0, lineWidth: 0.5, lineColor: '#D0D5DB' };

// El stack real de URS-EMQC-001, con su canvas como variable.
const stack = canvas => [
  { text: 'Mandatory (M): 107', bold: true, fontSize: 9, margin: [0, 0, 0, 4] },
  { text: 'Desirable (D): 7', fontSize: 9, margin: [0, 0, 0, 4] },
  { text: 'Total funcionales: 98', bold: true, fontSize: 9, margin: [0, 0, 0, 4] },
  { text: 'No funcionales: 16 (NF)', fontSize: 9, margin: [0, 0, 0, 8] },
  { canvas: [canvas] },
  { text: 'TOTAL: 114 URS', bold: true, fontSize: 10, color: '#1F3C56', margin: [0, 6, 0, 0] },
];

async function rasterizar(canvas) {
  // Un browser por variante: pdfMake muta los nodos entre renders.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
    await page.setContent('<div id="v"></div>');
    await page.addScriptTag({ path: LIB('pdfmake.min.js') });
    await page.addScriptTag({ path: LIB('vfs_fonts.js') });
    await page.addScriptTag({ path: LIB('pdf.min.js') });
    // pdf.js exige un worker. Se lo sirve desde el propio archivo del repo,
    // convertido a blob: no hay red en esta pagina.
    const worker = require('fs').readFileSync(LIB('pdf.worker.min.js'), 'utf8');
    return await page.evaluate(async ({ nodos, worker }) => {
      const doc = {
        pageSize: 'A4', pageMargins: [50, 50, 50, 50],
        content: [{ table: { widths: [200], body: [[{ stack: nodos }]] } }],
      };
      const datos = await new Promise(ok => pdfMake.createPdf(doc).getBuffer(b => ok(b)));
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(datos) }).promise;
      const pag = await pdf.getPage(1);
      const vp = pag.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await pag.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      // Se cuentan filas de pixeles que contienen un tramo horizontal claro y
      // largo: eso es una regla dibujada, no texto.
      let reglas = 0;
      for (let y = 0; y < c.height; y++) {
        let run = 0, max = 0;
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const gris = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (gris < 245 && gris > 150) { run++; max = Math.max(max, run); } else run = 0;
        }
        if (max > 150) reglas++;
      }
      return { reglas, paginas: pdf.numPages };
    }, { nodos: stackSerializado, worker });
  } finally { await browser.close(); }
}

let stackSerializado;
(async () => {
  console.log('Canvas: el defecto es visible?\n');
  stackSerializado = stack(CORRUPTO);
  const malo = await rasterizar();
  stackSerializado = stack(REPARADO);
  const bueno = await rasterizar();

  console.log(`  canvas corrupto (y=2710.5): ${malo.reglas} fila(s) de regla, ${malo.paginas} pagina(s)`);
  console.log(`  canvas reparado (y=0)     : ${bueno.reglas} fila(s) de regla, ${bueno.paginas} pagina(s)`);

  const ok = malo.reglas === 0 && bueno.reglas > 0;
  console.log('\n  CONCLUSION:');
  if (ok) {
    console.log('    El separador NO se dibuja con el canvas corrupto y SI con el reparado.');
    console.log('    El defecto es visible y la reparacion lo corrige.');
  } else if (malo.reglas > 0 && bueno.reglas > 0) {
    console.log('    Ambos dibujan la regla: el defecto NO es visible en esta pagina.');
    console.log('    La reparacion sigue siendo correcta, pero no cierra un defecto visual.');
  } else {
    console.log('    Resultado inesperado: revisar la deteccion antes de concluir nada.');
  }
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 2; });
