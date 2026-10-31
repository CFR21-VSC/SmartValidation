// Prueba end-to-end del cliente de sincronización contra un servidor descartable (base temporal).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
// Playwright se toma del skill gxp-evidencias (npm install allí). Uso: node tests/e2e_sync_navegador.cjs
const SRV = path.resolve(__dirname, '..');
const { chromium } = require(path.resolve(SRV, '..', '.claude/skills/gxp-evidencias/node_modules/playwright'));

const libre = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

(async () => {
  const port = await libre(); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv_nav_'));
  const env = { ...process.env, DATA_DIR: tmp, DB_PATH: path.join(tmp, 'smart_validation.db'), ALLOW_NO_AUTH: 'true', PORT: String(port) };
  delete env.AUTH_SECRET_KEY; delete env.DATABASE_URL;
  const log = fs.openSync(path.join(tmp, 'server.log'), 'w');
  const srv = spawn('python', ['-u', 'server.py', String(port)], { cwd: SRV, env, stdio: ['ignore', log, log] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await esperar(300); }
  const b = await chromium.launch();
  try {
    const PID = 'proj_nav_' + Date.now();
    const ctxA = await b.newContext(), ctxB = await b.newContext();
    const A = await ctxA.newPage(), B = await ctxB.newPage();
    const posts = [];
    A.on('request', r => { if (r.method() === 'POST' && /\/snapshot$/.test(r.url())) posts.push({ enc: r.headers()['content-encoding'], t: Date.now() }); });
    await A.goto(base + '/', { waitUntil: 'domcontentloaded' }); await esperar(2500);
    await B.goto(base + '/', { waitUntil: 'domcontentloaded' }); await esperar(2500);
    const tieneVS = await A.evaluate(() => !!(window.VS && window.VS.Storage && window.VS.Storage.getBaseRev));
    ok(tieneVS, 'VS.Storage con control de versión cargado en la página');

    const snap = (m, n = 0) => ({ systemInfo: { nombreSistema: 'Nav' }, tests: Array.from({ length: n }, (_, i) => ({ id: 't' + i, name: 'prueba larga '.repeat(30) })), groups: [], protocols: [], marca: m });

    // 1) alta + ráfaga de 6 subidas simultáneas: no debe haber conflicto falso y debe quedar la última
    const r0 = await A.evaluate(async ([pid, s]) => (await window.VS.Storage.syncSnapshot(pid, s, 'Nav')).data, [PID, snap('alta', 0)]);
    ok(r0 && r0.ok, 'alta del proyecto aceptada');
    const antes = posts.length;
    let conflictoFalso = false;
    await A.evaluate(() => { window.__conf = 0; window.addEventListener('vs:snapshot-conflict', () => window.__conf++); });
    const res = await A.evaluate(async ([pid, snaps]) => {
      const rs = await Promise.all(snaps.map(s => window.VS.Storage.syncSnapshot(pid, s, 'Nav')));
      return { statuses: rs.map(r => r && r.status), conf: window.__conf };
    }, [PID, [1, 2, 3, 4, 5, 6].map(i => snap('rafaga-' + i, 300))]);
    ok(res.conf === 0 && res.statuses.every(s => s === 200), `ráfaga de 6 subidas sin conflicto falso (${JSON.stringify(res.statuses)})`);
    ok(posts.length - antes <= 2, `6 subidas simultáneas se redujeron a ${posts.length - antes} envío(s) al servidor`);
    ok(posts.slice(antes).some(p => p.enc === 'gzip'), 'el cuerpo grande se envió comprimido (Content-Encoding: gzip)');
    const srvSnap = await (await fetch(`${base}/api/projects/${PID}/snapshot`)).json();
    ok(srvSnap.snapshot.marca === 'rafaga-6', `el servidor quedó con la última (${srvSnap.snapshot.marca})`);

    // 2) la sesión B nunca bajó el proyecto: no puede pisarlo
    const rB = await B.evaluate(async ([pid, s]) => { const r = await window.VS.Storage.syncSnapshot(pid, s, 'Nav'); return r && r.status; }, [PID, snap('copia-vieja-de-B')]);
    ok(rB === 409, `B (sin copia del servidor) es rechazada con 409 (${rB})`);
    const aviso = await B.evaluate(() => !!document.getElementById('_snapshotConflictBanner'));
    ok(aviso, 'B ve el aviso rojo de copia desactualizada');
    const tras = await (await fetch(`${base}/api/projects/${PID}/snapshot`)).json();
    ok(tras.snapshot.marca === 'rafaga-6', 'el servidor conserva lo de A');

    // 3) B baja la versión del servidor y desde ahí sí puede subir
    await B.evaluate(async (pid) => {
      const snapSrv = await window.VS.Storage.getSnapshot(pid);
      window.VS.Storage.adoptRev(pid);
      window.__snapSrv = snapSrv;
    }, PID);
    const rB2 = await B.evaluate(async (pid) => { const s = { ...window.__snapSrv, marca: 'B-con-base-correcta' }; const r = await window.VS.Storage.syncSnapshot(pid, s, 'Nav'); return r && r.status; }, PID);
    ok(rB2 === 200, `B, después de bajar la versión del servidor, sube sin problema (${rB2})`);

    // 4) A ahora está atrasada: su próxima subida debe ser rechazada
    const rA = await A.evaluate(async (pid) => { const r = await window.VS.Storage.syncSnapshot(pid, { systemInfo: {}, tests: [], groups: [], protocols: [], marca: 'A-atrasada' }, 'Nav'); return r && r.status; }, PID);
    ok(rA === 409, `A, ahora atrasada, es rechazada (${rA})`);
    const fin = await (await fetch(`${base}/api/projects/${PID}/snapshot`)).json();
    ok(fin.snapshot.marca === 'B-con-base-correcta', 'el servidor conserva lo de B');

    // 5) consulta liviana
    const rev = await A.evaluate(async (pid) => await window.VS.Storage.getRev(pid), PID);
    ok(typeof rev === 'number' && rev > 0, `getRev devuelve la revisión (${rev})`);
  } catch (e) { console.log('ERROR', e.message); fallos++; }
  finally { await b.close(); srv.kill(); }
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
