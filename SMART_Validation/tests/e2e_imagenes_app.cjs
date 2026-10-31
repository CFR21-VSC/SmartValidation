// Imágenes de evidencia con la aplicación real: carga bajo demanda (no todas en memoria al abrir),
// el flag hasImage sobrevive a guardar sin haber cargado la imagen, sincronización por índice liviano
// (solo se bajan las que faltan) y optimización sin pérdida en el servidor.
// Uso: node tests/e2e_imagenes_app.cjs      (Playwright se toma del skill gxp-evidencias)
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const SRV = path.resolve(__dirname, '..');
const { chromium } = require(path.resolve(SRV, '..', '.claude/skills/gxp-evidencias/node_modules/playwright'));

const libre = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
async function hasta(fn, ms = 15000, paso = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (_) {} await esperar(paso); }
  return null;
}
const N = 6;

(async () => {
  const port = await libre(); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv_img_'));
  const env = { ...process.env, DATA_DIR: tmp, DB_PATH: path.join(tmp, 'smart_validation.db'), ALLOW_NO_AUTH: 'true', PORT: String(port) };
  delete env.AUTH_SECRET_KEY; delete env.DATABASE_URL;
  const log = fs.openSync(path.join(tmp, 'server.log'), 'w');
  const srv = spawn('python', ['-u', 'server.py', String(port)], { cwd: SRV, env, stdio: ['ignore', log, log] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await esperar(300); }
  const b = await chromium.launch();
  try {
    const A = await (await b.newContext()).newPage(), B = await (await b.newContext()).newPage();
    A.on('pageerror', e => console.log('  [A pageerror]', e.message));
    B.on('pageerror', e => console.log('  [B pageerror]', e.message));
    await A.goto(base + '/', { waitUntil: 'domcontentloaded' }); await esperar(2500);
    await A.evaluate(() => window.ValidationSuite.projects.createNew({ name: 'E2E imagenes' }).catch(() => {}));
    await esperar(3500); await A.waitForLoadState('domcontentloaded');
    const PID = await hasta(() => A.evaluate(() => window.ValidationSuite.projects.getActiveId()));
    ok(!!PID, 'proyecto creado (' + PID + ')');

    // 1) A arma una prueba con N evidencias con imagen (capturas sintéticas generadas en un canvas)
    await A.evaluate(async (n) => {
      protocols.push({ id: 'p1', code: 'PIQ-IMG', name: 'P', finalized: false });
      groups.push({ id: 'g1', name: 'A', protocolId: 'p1', finalized: false });
      const t = { id: 't1', tcId: 'TC-1', name: 'Prueba', groupId: 'g1', evidences: [], finalized: false };
      tests.push(t);
      for (let i = 0; i < n; i++) {
        const c = document.createElement('canvas'); c.width = 900; c.height = 500;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 500);
        for (let k = 0; k < 40; k++) { g.fillStyle = `hsl(${(k * 37 + i * 50) % 360},60%,50%)`; g.fillRect(20 + k * 20, 30 + (k % 7) * 60, 160, 40); }
        g.fillStyle = '#000'; g.font = '28px sans-serif'; g.fillText('Captura sintetica ' + i, 40, 480);
        const ev = { step: i + 1, uid: 'u' + i, description: 'ev ' + i, isEmpty: false, image: c.toDataURL('image/png') };
        t.evidences.push(ev);
        await saveImageToDB(evidenceImageKey(t, ev), ev.image);          // sube al servidor, como al agregar una evidencia
      }
      await saveToStorage();
    }, N);
    const idx = await hasta(async () => { const j = await (await fetch(`${base}/api/projects/${PID}/evidence?index=1`)).json(); return Object.keys(j.index).length === N ? j.index : null; });
    ok(!!idx, `el servidor tiene las ${N} imágenes (índice liviano)`);
    const snap = await hasta(async () => { const s = (await (await fetch(`${base}/api/projects/${PID}/snapshot`)).json()).snapshot; return (s.tests[0] && s.tests[0].evidences.length === N) ? s : null; });
    ok(snap && snap.tests[0].evidences.every(e => e.hasImage === true && !e.image), 'el snapshot del servidor marca hasImage y no incluye datos de imagen');
    const unaUri = (await (await fetch(`${base}/api/projects/${PID}/evidence/${Object.keys(idx)[0]}`)).json());
    ok(/^[0-9a-f]{64}$/.test(unaUri.sha256), 'cada imagen tiene su huella SHA-256');

    // 2) A recarga: las imágenes NO se cargan en memoria, pero el flag se conserva y se guarda así
    await A.reload({ waitUntil: 'domcontentloaded' }); await esperar(3500);
    await hasta(() => A.evaluate(() => tests.length === 1));
    const mem = await A.evaluate(() => tests[0].evidences.map(e => ({ img: !!e.image, flag: !!e.hasImage })));
    ok(mem.length === N && mem.every(m => !m.img && m.flag), `tras recargar: 0 de ${N} imágenes en memoria y las ${N} con hasImage (carga bajo demanda)`);
    await A.evaluate(() => saveToStorage());
    await esperar(2500);
    const tras = (await (await fetch(`${base}/api/projects/${PID}/snapshot`)).json()).snapshot;
    ok(tras.tests[0].evidences.every(e => e.hasImage === true), 'guardar sin haber cargado las imágenes NO pierde el flag hasImage');

    // 3) la imagen se trae al pedirla
    const carga = await A.evaluate(async () => { const t = tests[0]; const d = await loadEvidenceImage(t, t.evidences[2]); return d ? d.slice(0, 22) : null; });
    ok(carga === 'data:image/png;base64,', 'loadEvidenceImage trae la imagen cuando se necesita');

    // 4) B (navegador sin imágenes) abre el proyecto: baja solo lo que falta, con el índice
    const reqs = [];
    B.on('request', r => { const u = r.url(); if (/\/evidence/.test(u)) reqs.push(u.replace(base, '')); });
    await B.goto(base + '/', { waitUntil: 'domcontentloaded' }); await esperar(2500);
    await B.evaluate((pid) => window.ValidationSuite.projects.switchTo(pid).catch(() => {}), PID);
    await esperar(3500); await B.waitForLoadState('domcontentloaded'); await esperar(1500);
    await B.evaluate((pid) => _downloadAllEvidenceFromServer(pid), PID);
    await esperar(3500);   // el arranque también sincroniza imágenes (3 s): se cuentan todas las peticiones
    const hay = await B.evaluate(async (n) => {
      const t = tests[0]; let c = 0;
      for (const ev of t.evidences) { if (await getImageFromDB(evidenceImageKey(t, ev), { serverFallback: false })) c++; }
      return c;
    }, N);
    ok(hay === N, `B tiene las ${N} imágenes en su IndexedDB local`);
    ok(reqs.some(u => /evidence\?index=1/.test(u)), 'B consultó primero el índice liviano');
    ok(!reqs.some(u => /\/evidence$/.test(u)), 'B no pidió el volcado completo de imágenes en una sola respuesta');
    ok(reqs.filter(u => /\/evidence\/[^?]+$/.test(u)).length === N, `B bajó cada una de las ${N} imágenes una sola vez`);

    // 5) segunda sincronización: ya las tiene, no baja nada
    reqs.length = 0;
    await B.evaluate((pid) => _syncImagesFromServer(pid), PID); await esperar(1500);
    ok(reqs.filter(u => /\/evidence\/[^?]+$/.test(u)).length === 0, 'una segunda sincronización no vuelve a bajar ninguna imagen');
  } catch (e) { console.log('ERROR', e.stack || e.message); fallos++; }
  finally { await b.close(); srv.kill(); }
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
