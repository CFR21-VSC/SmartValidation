// Prueba end-to-end con la aplicación real (Chrome headless) y dos sesiones contra un servidor
// descartable: reproduce el defecto original (una sesión atrasada reabría lo que otra finalizó).
// Uso: node tests/e2e_sync_delta_app.cjs      (Playwright se toma del skill gxp-evidencias)
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

(async () => {
  const port = await libre(); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv_delta_'));
  const env = { ...process.env, DATA_DIR: tmp, DB_PATH: path.join(tmp, 'smart_validation.db'), ALLOW_NO_AUTH: 'true', PORT: String(port) };
  delete env.AUTH_SECRET_KEY; delete env.DATABASE_URL;
  const log = fs.openSync(path.join(tmp, 'server.log'), 'w');
  const srv = spawn('python', ['-u', 'server.py', String(port)], { cwd: SRV, env, stdio: ['ignore', log, log] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await esperar(300); }
  const b = await chromium.launch();
  const srvSnap = async (pid) => (await (await fetch(`${base}/api/projects/${pid}/snapshot`)).json()).snapshot;
  try {
    const A = await (await b.newContext()).newPage(), B = await (await b.newContext()).newPage();
    A.on('pageerror', e => console.log('  [A pageerror]', e.message));
    B.on('pageerror', e => console.log('  [B pageerror]', e.message));
    await A.goto(base + '/', { waitUntil: 'domcontentloaded' }); await esperar(2500);

    // 1) A crea el proyecto (la página recarga sola) y arma protocolo, carpeta y dos pruebas
    await A.evaluate(() => window.ValidationSuite.projects.createNew({ name: 'E2E delta' }).catch(() => {}));
    await esperar(3500);
    await A.waitForLoadState('domcontentloaded');
    const PID = await hasta(() => A.evaluate(() => window.ValidationSuite.projects.getActiveId()));
    ok(!!PID, 'A tiene un proyecto activo (' + PID + ')');
    await A.evaluate(() => {
      protocols.push({ id: 'p1', code: 'PIQ-E2E', name: 'Protocolo', finalized: false });
      groups.push({ id: 'g1', name: 'A', protocolId: 'p1', finalized: false });
      tests.push({ id: 't1', tcId: 'TC-1', name: 'Prueba 1', groupId: 'g1', evidences: [], finalized: false });
      tests.push({ id: 't2', tcId: 'TC-2', name: 'Prueba 2', groupId: 'g1', evidences: [], finalized: false });
      groups.push({ id: 'g2', name: 'B', protocolId: 'p1', finalized: false });
      tests.push({ id: 't3', tcId: 'TC-3', name: 'Prueba 3', groupId: 'g2', evidences: [], finalized: false });
      return saveToStorage();
    });
    const lleg = await hasta(async () => { const s = await srvSnap(PID); return s && (s.tests || []).length === 3 ? s : null; });
    ok(!!lleg, 'el servidor recibió el protocolo, 2 carpetas y 3 pruebas');
    ok(lleg && lleg.groups[0]._srev > 0, 'los elementos quedaron sellados con su revisión (_srev)');

    // 2) B abre el proyecto desde el servidor (otro navegador)
    await B.goto(base + '/', { waitUntil: 'domcontentloaded' }); await esperar(2500);
    await B.evaluate((pid) => window.ValidationSuite.projects.switchTo(pid).catch(() => {}), PID);
    await esperar(3500); await B.waitForLoadState('domcontentloaded'); await esperar(1500);
    const bTiene = await hasta(() => B.evaluate(() => tests.length === 3 && groups.length === 2));
    ok(!!bTiene, 'B cargó el proyecto del servidor (3 pruebas, 2 carpetas)');
    ok(await B.evaluate((pid) => window.VS.Storage.hasDeltaBase(pid), PID), 'B tiene base de diferencias (puede sincronizar por diferencias)');

    // 3) A finaliza las pruebas y la carpeta A (en orden, como en la aplicación)
    await A.evaluate(() => { tests[0].finalized = true; tests[1].finalized = true; groups[0].finalized = true; groups[0].resultado = 'PASA'; return saveToStorage(); });
    const fin = await hasta(async () => { const s = await srvSnap(PID); return s.groups[0].finalized && s.tests[0].finalized ? s : null; });
    ok(!!fin, 'el servidor tiene las pruebas y la carpeta finalizadas');

    // 4) B, atrasada (su copia local sigue con la carpeta abierta), edita OTRA cosa y guarda
    ok(await B.evaluate(() => groups[0].finalized === false && tests[0].finalized === false), 'B sigue viendo la carpeta abierta (copia atrasada)');
    await B.evaluate(() => { tests[2].name = 'Prueba 3 editada por B'; return saveToStorage(); });
    const b4 = await hasta(async () => { const s = await srvSnap(PID); return s.tests[2].name === 'Prueba 3 editada por B' ? s : null; });
    ok(!!b4, 'la edición de B llegó al servidor');
    ok(b4 && b4.groups[0].finalized === true && b4.tests[0].finalized === true && b4.tests[1].finalized === true,
       'LA CARPETA Y SUS PRUEBAS SIGUEN FINALIZADAS en el servidor (antes se reabrían)');

    // 5) B recibe lo de A y lo ve en pantalla
    const vio = await hasta(() => B.evaluate(() => groups[0].finalized === true && tests[0].finalized === true));
    ok(!!vio, 'B recibió y aplicó la finalización hecha por A');

    // 6) conflicto real: A y B editan la MISMA prueba. B atrasada
    // A se pone al día primero (como haría el sondeo de 15 s): baja la edición de B
    await A.evaluate((pid) => window.VS.Storage.syncProject(pid, JSON.parse(localStorage.getItem('vscTestsData_v3')), undefined, { force: true }), PID);
    ok(!!(await hasta(() => A.evaluate(() => tests[2].name === 'Prueba 3 editada por B'))), 'A bajó la edición de B (sincronización en ambos sentidos)');
    await A.evaluate(() => { tests[2].name = 'Prueba 3 (A)'; return saveToStorage(); });
    await hasta(async () => (await srvSnap(PID)).tests[2].name === 'Prueba 3 (A)');
    await B.evaluate(() => { tests[2].name = 'Prueba 3 (B)'; return saveToStorage(); });
    const quedo = await hasta(async () => { await esperar(1500); return (await srvSnap(PID)).tests[2].name; });
    ok(quedo === 'Prueba 3 (A)', `ante conflicto en el mismo elemento gana lo del servidor (${quedo})`);
    const bNombre = await hasta(() => B.evaluate(() => tests[2].name === 'Prueba 3 (A)' ? 'ok' : null));
    ok(!!bNombre, 'B terminó mostrando la versión del servidor');
    ok(await B.evaluate(() => !document.getElementById('_snapshotConflictBanner')), 'sin cartel rojo de copia desactualizada (se fusionó por elemento)');

    // 7) lo no conflictivo de B se conservó
    const sFin = await srvSnap(PID);
    ok(sFin.tests[2].name === 'Prueba 3 (A)' && sFin.groups[0].finalized, 'el servidor conserva lo finalizado por A y la versión ganadora');

    // 8) el servidor hace cumplir la jerarquía: no se acepta finalizar la carpeta B con su prueba abierta
    const rej = await B.evaluate(async () => {
      let ev = null; window.addEventListener('vs:sync-rejected', (e) => { ev = e.detail; });
      groups[1].finalized = true;
      await saveToStorage(); await new Promise(r => setTimeout(r, 2500));
      return ev;
    });
    ok(rej && rej.violations && rej.violations.length > 0, 'finalizar una carpeta con pruebas abiertas es rechazado por el servidor (' + (rej && rej.violations && rej.violations[0]) + ')');
    ok(!(await srvSnap(PID)).groups[1].finalized, 'la carpeta B sigue abierta en el servidor');

    // 9) un navegador NUEVO (sin proyecto activo) baja el proyecto solo, al arrancar, y debe poder guardar
    //    (caso del skill de evidencias: perfil limpio de Chrome)
    const C = await (await b.newContext()).newPage();
    C.on('pageerror', e => console.log('  [C pageerror]', e.message));
    await C.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const cOk = await hasta(() => C.evaluate(() => window.ValidationSuite.projects.getActiveId() && tests.length === 3 ? true : null), 20000);
    ok(!!cOk, 'un navegador nuevo descarga el proyecto del servidor al arrancar');
    ok(await C.evaluate((pid) => window.VS.Storage.hasDeltaBase(pid) && window.VS.Storage.getBaseRev(pid) > 0, PID), 'ese navegador adoptó la revisión del servidor (puede guardar por diferencias)');
    await C.evaluate(() => { tests[2].name = 'Prueba 3 (C, navegador nuevo)'; return saveToStorage(); });
    const cLlego = await hasta(async () => (await srvSnap(PID)).tests[2].name === 'Prueba 3 (C, navegador nuevo)');
    ok(!!cLlego, 'el guardado del navegador nuevo llega al servidor');
    ok(await C.evaluate(() => !document.getElementById('_snapshotConflictBanner')), 'sin cartel de copia desactualizada en el navegador nuevo');
  } catch (e) { console.log('ERROR', e.stack || e.message); fallos++; }
  finally { await b.close(); srv.kill(); }
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
