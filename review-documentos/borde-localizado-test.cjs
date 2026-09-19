// Localiza la tabla y compara el borde contra las cajas de texto, por celda.
//
//   node review-documentos/borde-localizado-test.cjs [URS.json]
//
// Por que existe
// --------------
// El test anterior contaba lineas en TODA la pagina y concluia "el borde es
// identico". Codex retiro esa conclusion con razon: 138 horizontales y 12
// verticales incluyen la tabla de criterios anterior, encabezados, fondos y
// el pie. Igual cantidad de pixeles clasificados como linea no implica mismo
// borde ni mismas coordenadas, y no dice donde el texto se sale.
//
// Este test no cuenta: localiza. Para cada pagina donde vive la tabla del
// resumen, busca sus verticales (los unicos trazos verticales largos de esa
// banda), acota la tabla entre ellas, y compara la horizontal inferior contra
// la linea de texto mas baja encerrada. Si el texto queda por debajo del borde,
// informa por cuantos puntos y en que pagina.
//
// Si el defecto no aparece en el artefacto actual, se registra como
// "no reproducido" junto al hash del PDF, en vez de seguir buscando causas de
// una reproduccion que no esta fijada.
//
// No modifica ningun archivo.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const RAIZ = path.join(__dirname, '..');
const POR_DEFECTO = 'C:/Users/fjbon/OneDrive/Escritorio/EMQC_Emara/Proyecto demo 1 - Emara/ai-docs/URS-EMQC-001.json';
const FUENTE = process.argv[2] || POR_DEFECTO;
const TITULO = 'RESUMENESTADISTICO';

const SCRIPTS = [
  'lib/pdfmake.min.js', 'lib/vfs_fonts.js',
  'js/validation-suite/core/template-base.js',
  'js/validation-suite/core/shared-renderers.js',
  'js/validation-suite/core/document-renderer.js',
  'js/validation-suite/templates/urs.js',
];

(async () => {
  const doc = JSON.parse(fs.readFileSync(FUENTE, 'utf8').replace(/^\uFEFF/, ''));
  // Huellas del contenido de la seccion, para reconocer tambien las paginas de
  // continuacion, que no repiten el titulo. Sin esto, "no continua en otra
  // pagina" era un artefacto del filtro, no una observacion.
  const seccion = (doc.secciones || []).find(s =>
    (s.titulo || '').normalize('NFD').replace(/[̀-ͯ\s]/g, '').toUpperCase().includes(TITULO));
  const huellas = [];
  (function juntar(o, prof) {
    if (prof > 8 || o == null) return;
    if (typeof o === 'string') { if (o.trim().length >= 14) huellas.push(o.trim()); return; }
    if (Array.isArray(o)) return o.forEach(x => juntar(x, prof + 1));
    if (typeof o === 'object') Object.values(o).forEach(x => juntar(x, prof + 1));
  })(seccion, 0);

  const browser = await chromium.launch({ headless: true });
  let out;
  try {
    const page = await browser.newPage();
    await page.setContent('<div></div>');
    for (const f of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, 'SMART_Validation', f) });
    await page.addScriptTag({ path: path.join(RAIZ, 'SMART_Validation/lib/pdf.min.js') });
    const worker = fs.readFileSync(path.join(RAIZ, 'SMART_Validation/lib/pdf.worker.min.js'), 'utf8');

    out = await page.evaluate(async ({ d, worker, TITULO, huellas }) => {
      const blob = await ValidationSuite.renderDocument(d, { download: false });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const tam = bytes.length;      // pdf.js se queda con el buffer: se mide antes
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

      const limpio = s => s.normalize('NFD').replace(/[\u0300-\u036f\s]/g, '').toUpperCase();
      const ESCALA = 3;                       // pt -> px
      const paginas = [];

      // Seleccionar paginas por el TITULO dejaba fuera las continuaciones: una
      // tabla que sigue en la pagina siguiente no repite su titulo, asi que
      // afirmar "no continua en otra pagina" era un artefacto del filtro. Se
      // buscan tambien las cadenas propias del contenido de esa seccion.
      const marcas = [TITULO, ...(huellas || []).map(limpio)].filter(x => x && x.length > 5);

      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const tc = await pg.getTextContent();
        const txt = limpio(tc.items.map(x => x.str).join(''));
        const marcasAqui = marcas.filter(m => txt.includes(m));
        if (!marcasAqui.length) continue;

        // Geometria EXACTA: se leen los trazos que el PDF dibuja, con su
        // transformacion, en vez de inferirlos de pixeles. El intento anterior
        // por raster contaba 908 "verticales" —eran astas de letras y bandas de
        // relleno oscuro— y tomaba el pie de pagina como texto de la tabla.
        const OPS = pdfjsLib.OPS;
        const ol = await pg.getOperatorList();
        const mul = (a, b) => [
          a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
          a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
          a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
        ];
        const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

        let ctm = [1, 0, 0, 1, 0, 0];
        const pila = [];
        const segV = [], segH = [];
        const cajaPg = pg.getViewport({ scale: 1 });
        const anotar = (x1, y1, x2, y2) => {
          const [ax, ay] = ap(ctm, x1, y1), [bx, by] = ap(ctm, x2, y2);
          const largo = Math.hypot(bx - ax, by - ay);
          if (largo < 5) return;
          // Un trazo fuera de la caja de pagina no se ve. Ademas es por donde
          // entraba la linea del canvas corrupto (y~2846 en una pagina de 842),
          // que acotaba una "tabla" de 2700pt de alto.
          const dentroPg = v => v >= -2 && v <= cajaPg.height + 2;
          const dentroX = v => v >= -2 && v <= cajaPg.width + 2;
          if (!dentroPg(ay) || !dentroPg(by) || !dentroX(ax) || !dentroX(bx)) return;
          if (Math.abs(ax - bx) < 0.6) segV.push({ x: ax, y1: Math.min(ay, by), y2: Math.max(ay, by), largo });
          else if (Math.abs(ay - by) < 0.6) segH.push({ y: ay, x1: Math.min(ax, bx), x2: Math.max(ax, bx), largo });
        };

        for (let k = 0; k < ol.fnArray.length; k++) {
          const fn = ol.fnArray[k], ar = ol.argsArray[k];
          if (fn === OPS.save) pila.push(ctm.slice());
          else if (fn === OPS.restore) ctm = pila.pop() || [1, 0, 0, 1, 0, 0];
          else if (fn === OPS.transform) ctm = mul(ctm, ar);
          else if (fn === OPS.constructPath) {
            const ops = ar[0], co = ar[1];
            let c = 0, px0 = 0, py0 = 0;
            for (const op of ops) {
              if (op === OPS.moveTo) { px0 = co[c]; py0 = co[c + 1]; c += 2; }
              else if (op === OPS.lineTo) { anotar(px0, py0, co[c], co[c + 1]); px0 = co[c]; py0 = co[c + 1]; c += 2; }
              else if (op === OPS.curveTo) c += 6;
              else if (op === OPS.rectangle) {
                const [x, y, w, h] = [co[c], co[c + 1], co[c + 2], co[c + 3]]; c += 4;
                anotar(x, y, x + w, y); anotar(x, y + h, x + w, y + h);
                anotar(x, y, x, y + h); anotar(x + w, y, x + w, y + h);
                px0 = x; py0 = y;
              }
            }
          }
        }

        // Coordenadas de pagina con y hacia abajo, para leerlas como se ven.
        const altoPg = pg.getViewport({ scale: 1 }).height;
        const aY = y => altoPg - y;
        const items = tc.items.filter(x => x.str.trim()).map(x => {
          const [, , , , tx, ty] = x.transform;
          return { str: x.str, x: tx, y: aY(ty), alto: x.height || 9 };
        });
        // Ancla: el titulo si esta, y si no (pagina de continuacion) la primera
        // aparicion del contenido propio de la seccion.
        const titulo = items.find(x => limpio(x.str).includes('RESUMEN')) ||
          items.find(x => limpio(x.str).length >= 14 && marcasAqui.includes(limpio(x.str)));
        if (!titulo) { paginas.push({ pagina: i, sinAncla: true }); continue; }

        // La tabla: verticales largas que empiezan por debajo del titulo.
        const vTabla = segV.filter(s => aY(s.y2) >= titulo.y - 4 && s.largo > 12);
        if (vTabla.length < 2) { paginas.push({ pagina: i, verticales: vTabla.length }); continue; }
        const xIzq = Math.min(...vTabla.map(s => s.x));
        const xDer = Math.max(...vTabla.map(s => s.x));
        const yIni = Math.min(...vTabla.map(s => aY(s.y2)));
        const yFin = Math.max(...vTabla.map(s => aY(s.y1)));

        // Horizontales que cruzan la tabla de lado a lado.
        // pdfMake puede dibujar el borde por celda en vez de una linea entera.
        // Se agrupan por y los segmentos de la banda y se mide que fraccion del
        // ancho de la tabla cubren entre todos.
        const banda = segH.filter(s => aY(s.y) >= yIni - 2 && aY(s.y) <= yFin + 6 &&
                                       s.x2 >= xIzq - 2 && s.x1 <= xDer + 2);
        const porY = new Map();
        for (const s of banda) {
          const k = Math.round(aY(s.y) * 2) / 2;
          if (!porY.has(k)) porY.set(k, []);
          porY.get(k).push(s);
        }
        const anchoTabla = xDer - xIzq;
        // UNION de intervalos, no suma: sumar tramos superpuestos daba
        // coberturas del 200%, que no son cobertura sino doble conteo.
        const unir = ss => {
          const iv = ss.map(s => [Math.max(s.x1, xIzq), Math.min(s.x2, xDer)])
            .filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
          let total = 0, ini = null, fin = null;
          for (const [a, b] of iv) {
            if (ini === null) { ini = a; fin = b; continue; }
            if (a <= fin) fin = Math.max(fin, b);
            else { total += fin - ini; ini = a; fin = b; }
          }
          return total + (ini === null ? 0 : fin - ini);
        };
        const lineas = [...porY.entries()].map(([y, ss]) => ({
          y, tramos: ss.length, cobertura: unir(ss) / anchoTabla,
        })).sort((a, b) => a.y - b.y);
        const hTabla = lineas.filter(l => l.cobertura > 0.9);
        const bordeInferior = hTabla.length ? Math.max(...hTabla.map(l => l.y)) : null;
        const lineasDebug = lineas.slice(-6);

        // Que texto pertenece a la tabla no se decide por geometria —ni por el
        // borde que se quiere evaluar, ni por un hueco vertical inventado, que
        // cortaba el bloque en el encabezado y dejaba afuera el contenido—.
        // Se decide por CONTENIDO: los fragmentos que reproducen texto de esa
        // seccion del documento. Es la unica referencia independiente del PDF.
        const deLaSeccion = new Set((huellas || []).map(limpio));
        const dentro = items.filter(x => {
          const t = limpio(x.str);
          if (t.length < 3) return false;
          if (x.x < xIzq - 2 || x.x > xDer + 2) return false;
          for (const h of deLaSeccion) if (h.includes(t)) return true;
          return false;
        });
        const yTextoMasBajo = dentro.length ? Math.max(...dentro.map(x => x.y)) : null;
        const masBajo = dentro.find(x => x.y === yTextoMasBajo);
        const cortadoPorHueco = false;

        paginas.push({
          pagina: i, verticales: vTabla.length, horizontales: hTabla.length,
          tabla: { xIzq, xDer, yIni, yFin },
          bordeInferior, yTextoMasBajo, lineasDebug, cortadoPorHueco,
          textosEnTabla: dentro.length,
          textoMasBajo: masBajo ? masBajo.str.slice(0, 40) : null,
          excede: (bordeInferior != null && yTextoMasBajo != null) ? yTextoMasBajo - bordeInferior : null,
        });
      }
      return { paginas, paginasTotales: pdf.numPages, tam };
    }, { d: doc, worker, TITULO, huellas });
  } finally { await browser.close(); }

  console.log('Borde de la tabla del resumen: localizado, no contado\n');
  console.log('  documento:', path.basename(FUENTE));
  console.log('  hash del JSON de entrada:',
    crypto.createHash('sha256').update(fs.readFileSync(FUENTE)).digest('hex').slice(0, 16));
  console.log(`  paginas del PDF: ${out.paginasTotales} · tamano ${out.tam} bytes`);

  if (!out.paginas.length) {
    console.log('\n  NO REPRODUCIDO: no se ubico la tabla del resumen en este artefacto.');
    process.exitCode = 0;
    return;
  }

  let defecto = false;
  for (const p of out.paginas) {
    console.log(`\n  pagina ${p.pagina}: ${p.verticales} vertical(es), ${p.horizontales} horizontal(es) en la banda`);
    if (p.sinAncla) { console.log('    contenido de la seccion presente pero sin ancla distintiva: no evaluable'); continue; }
    if (!p.tabla) { console.log('    no se pudo acotar la tabla (menos de 2 verticales)'); continue; }
    console.log(`    tabla acotada  x ${p.tabla.xIzq.toFixed(1)}..${p.tabla.xDer.toFixed(1)}pt · y ${p.tabla.yIni.toFixed(1)}..${p.tabla.yFin.toFixed(1)}pt`);
    console.log(`    borde inferior y=${p.bordeInferior == null ? 'NO HAY' : p.bordeInferior.toFixed(1)}pt`);
    (p.lineasDebug || []).forEach(l => console.log(`      horizontal y=${l.y.toFixed(1)}pt · ${l.tramos} tramo(s) · cubre ${(l.cobertura * 100).toFixed(0)}% del ancho`));
    console.log(`    texto de la seccion en esta pagina: ${p.textosEnTabla} fragmento(s)`);
    console.log(`    texto mas bajo y=${p.yTextoMasBajo == null ? 'ninguno' : p.yTextoMasBajo.toFixed(1)}pt  ${p.textoMasBajo ? JSON.stringify(p.textoMasBajo) : ''}`);
    if (p.excede != null && p.excede > 1) {
      defecto = true;
      console.log(`    >> EL TEXTO EXCEDE EL BORDE por ${p.excede.toFixed(1)}pt`);
    } else if (p.bordeInferior == null) {
      defecto = true;
      console.log('    >> NO HAY BORDE INFERIOR: la tabla no cierra en esta pagina');
    } else {
      console.log('    borde por debajo del ultimo texto: cierra');
    }
  }

  const evaluadas = out.paginas.filter(p => p.tabla).map(p => p.pagina);
  const noEvaluadas = out.paginas.filter(p => !p.tabla).map(p => p.pagina);
  console.log('\n  CONCLUSION:');
  if (defecto) {
    console.log('    Defecto LOCALIZADO, con pagina y magnitud. Sirve como reproduccion fijada.');
  } else {
    console.log(`    NO REPRODUCIDO en la(s) pagina(s) evaluada(s): ${evaluadas.join(', ') || 'ninguna'}.`);
    if (noEvaluadas.length)
      console.log(`    Paginas con texto de la seccion pero SIN evaluar: ${noEvaluadas.join(', ')}.`);
    console.log('    Esto es una observacion local sobre este artefacto, con su hash. NO es');
    console.log('    prueba de ausencia de overflow en el documento ni en otros documentos.');
  }
})().catch(e => { console.error(e); process.exitCode = 2; });
