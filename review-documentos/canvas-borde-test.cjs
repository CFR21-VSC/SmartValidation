// El canvas corrupto, ¿explica el borde de tabla que no cierra?
//
//   node review-documentos/canvas-borde-test.cjs [URS.json]
//
// Contexto. Quedaba abierto un defecto: en el URS real, el borde de una tabla
// no encierra la fila alta. Se probaron unbreakable, keepWithHeaderRows, anchos
// y layouts, y un sintetico con la MISMA forma de celda renderizaba bien. Es
// decir: la forma de la celda no era la causa.
//
// La prueba del canvas dio una pista mejor. Con y=2710.5 el bloque no solo
// pierde la linea separadora: pasa de ocupar 1 pagina a ocupar 3. Una celda
// cuyo contenido mide 2710pt de alto es exactamente una fila que ningun borde
// puede encerrar.
//
// Esta prueba renderiza el URS REAL con el renderer de produccion, con el
// canvas como esta y con el canvas reparado, y compara. No modifica archivos.

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const RAIZ = path.join(__dirname, '..');
const POR_DEFECTO = 'C:/Users/fjbon/OneDrive/Escritorio/EMQC_Emara/Proyecto demo 1 - Emara/ai-docs/URS-EMQC-001.json';
const FUENTE = process.argv[2] || POR_DEFECTO;

const SCRIPTS = [
  'lib/pdfmake.min.js', 'lib/vfs_fonts.js',
  'js/validation-suite/core/template-base.js',
  'js/validation-suite/core/shared-renderers.js',
  'js/validation-suite/core/document-renderer.js',
  'js/validation-suite/templates/urs.js',
];

/** La reparacion propuesta: devolver la regla a su forma authoreada.
 *  El ancho se conserva del propio nodo corrupto (x2-x1), no se inventa. */
function repararCanvas(nodo) {
  if (nodo.type !== 'line' || nodo.y1 !== nodo.y2) return null;   // solo reglas horizontales
  const ancho = nodo.x2 - nodo.x1;
  return { ...nodo, x1: 0, y1: 0, x2: ancho, y2: 0 };
}

async function render(doc, etiqueta) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div></div>');
    for (const f of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, 'SMART_Validation', f) });
    await page.addScriptTag({ path: path.join(RAIZ, 'SMART_Validation/lib/pdf.min.js') });
    const worker = fs.readFileSync(path.join(RAIZ, 'SMART_Validation/lib/pdf.worker.min.js'), 'utf8');
    return await page.evaluate(async ({ d, worker }) => {
      const blob = await ValidationSuite.renderDocument(d, { download: false });
      const datos = new Uint8Array(await blob.arrayBuffer());
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
      const pdf = await pdfjsLib.getDocument({ data: datos }).promise;
      // Se busca la pagina del RESUMEN y se mide cuanto blanco queda debajo
      // del ultimo texto: una celda inflada deja la pagina practicamente vacia.
      let pagResumen = null, vacias = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const t = await (await pdf.getPage(i)).getTextContent();
        // pdf.js parte el texto en fragmentos: se compara sin espacios ni
        // acentos, si no el titulo no se encuentra nunca (dio null la 1a vez).
        const txt = t.items.map(x => x.str).join('')
          .normalize('NFD').replace(/[̀-ͯ\s]/g, '').toUpperCase();
        if (pagResumen === null && txt.includes('RESUMENESTADISTICO')) pagResumen = i;
        if (t.items.length < 8) vacias++;
      }
      // Alto real del contenido en la pagina del RESUMEN: si la celda se
      // infla, el ultimo texto queda mucho mas abajo (o directamente no cabe).
      let alturas = null;
      if (pagResumen) {
        const pg = await pdf.getPage(pagResumen);
        const tc = await pg.getTextContent();
        const ys = tc.items.map(x => x.transform[5]);
        alturas = { itemsEnPagina: tc.items.length,
                    yMin: Math.round(Math.min(...ys)), yMax: Math.round(Math.max(...ys)),
                    alto: Math.round(pg.getViewport({ scale: 1 }).height) };
      }
      // Se rasteriza la pagina del RESUMEN y se mide el borde: se cuentan las
      // filas y columnas de pixeles que forman lineas largas y continuas. Un
      // borde que cierra da 2 horizontales (arriba/abajo) y 2 verticales.
      let borde = null;
      if (pagResumen) {
        const pg = await pdf.getPage(pagResumen);
        const vp = pg.getViewport({ scale: 2 });
        const cv = document.createElement('canvas');
        cv.width = vp.width; cv.height = vp.height;
        await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        const oscuro = (x, y) => {
          const i = (y * cv.width + x) * 4;
          return (px[i] + px[i + 1] + px[i + 2]) / 3 < 200;
        };
        const tramo = (n, get) => { let run = 0, max = 0; for (let k = 0; k < n; k++) { if (get(k)) { run++; max = Math.max(max, run); } else run = 0; } return max; };
        let hor = 0, ver = 0;
        for (let y = 0; y < cv.height; y++) if (tramo(cv.width, x => oscuro(x, y)) > cv.width * 0.5) hor++;
        for (let x = 0; x < cv.width; x++) if (tramo(cv.height, y => oscuro(x, y)) > cv.height * 0.3) ver++;
        borde = { horizontales: hor, verticales: ver };
      }
      return { paginas: pdf.numPages, pagResumen, vacias, alturas, borde, bytes: datos.length };
    }, { d: doc, worker });
  } finally { await browser.close(); }
}

(async () => {
  const base = JSON.parse(fs.readFileSync(FUENTE, 'utf8').replace(/^\uFEFF/, ''));
  console.log('El canvas corrupto, ¿explica el borde que no cierra?\n');
  console.log('  documento:', path.basename(FUENTE));

  const comoEsta = JSON.parse(JSON.stringify(base));
  const reparado = JSON.parse(JSON.stringify(base));

  // Reparar SOLO los canvas de este documento, en memoria. Nada se escribe.
  let tocados = 0;
  const recorrer = o => {
    if (Array.isArray(o)) return o.forEach(recorrer);
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.canvas)) {
      o.canvas = o.canvas.map(n => { const r = repararCanvas(n); if (r) tocados++; return r || n; });
    }
    Object.values(o).forEach(recorrer);
  };
  recorrer(reparado);
  console.log('  canvas reparados en memoria:', tocados);

  const a = await render(comoEsta, 'como-esta');
  const b = await render(reparado, 'reparado');

  const linea = (etq, r) => `  ${etq}: ${r.paginas} paginas · RESUMEN en pag ${r.pagResumen}` +
    (r.alturas ? ` · ${r.alturas.itemsEnPagina} textos, y de ${r.alturas.yMin} a ${r.alturas.yMax} sobre ${r.alturas.alto}pt` : '') +
    (r.borde ? ` · borde: ${r.borde.horizontales} h / ${r.borde.verticales} v` : '');
  console.log('\n' + linea('como esta', a));
  console.log(linea('reparado ', b));

  const dif = a.paginas - b.paginas;
  const bordeIgual = JSON.stringify(a.borde) === JSON.stringify(b.borde);
  console.log('\n  CONCLUSION:');
  console.log(`    Paginacion: el canvas corrupto agrega ${dif} pagina(s) al documento real.`);
  if (bordeIgual) {
    console.log('    Borde: IDENTICO en ambas variantes en la pagina del RESUMEN. El canvas');
    console.log('    NO explica el defecto del borde; son dos problemas distintos. La');
    console.log('    reparacion del canvas sigue siendo correcta por si misma (recupera la');
    console.log('    linea separadora y la paginacion), pero no cierra el defecto abierto.');
  } else {
    console.log('    Borde: DISTINTO entre variantes. El canvas afecta el cierre del borde;');
    console.log('    hay que mirar el raster de la pagina antes de darlo por explicado.');
  }
})().catch(e => { console.error(e); process.exitCode = 2; });
