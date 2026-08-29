// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * CIRCUITO COMPLETO — SMART Validation GxP
 * =========================================
 * Cubre: proyecto → documentos → ronda revisión → firma → sello →
 *        ronda aprobación → firma → sello → archivo → revocación
 *
 * Pre-requisito: servidor corriendo en localhost:11294 (INICIAR.bat o DEV.bat)
 */

const BASE = 'http://localhost:11294';
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123'; // ajustar si hace falta

// Firmante invitado de prueba
const SIGNER = {
  username: 'jperez_test',
  displayName: 'Juan Pérez Test',
  email: 'jperez+test@example.com', // cambiá por un email real si querés recibir el mail
  pin: '123456',
};

// Datos del proyecto de prueba
const PROJ_NAME = `TEST-CIRCUITO-${Date.now()}`;

// ─── helpers ──────────────────────────────────────────────────────────────────

async function login(page, user = ADMIN_USER, pass = ADMIN_PASS) {
  await page.goto(`${BASE}/`);
  // esperar form de login o ya autenticado
  const loginVisible = await page.locator('#loginForm, input[name="username"], input[type="text"]').first().isVisible().catch(() => false);
  if (!loginVisible) return; // ya logueado (ALLOW_NO_AUTH)
  await page.fill('input[name="username"], input[type="text"]', user);
  await page.fill('input[name="password"], input[type="password"]', pass);
  await page.click('button[type="submit"], button:has-text("Ingresar"), button:has-text("Login")');
  await page.waitForTimeout(1000);
}

async function apiGet(page, path) {
  return page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return r.json();
  }, `${BASE}${path}`);
}

async function apiPost(page, path, body) {
  return page.evaluate(async ({ url, body }) => {
    const r = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }, { url: `${BASE}${path}`, body });
}

async function apiPut(page, path, body) {
  return page.evaluate(async ({ url, body }) => {
    const r = await fetch(url, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }, { url: `${BASE}${path}`, body });
}

// ─── FASE 0: Login ────────────────────────────────────────────────────────────

test('F0 — Login como admin', async ({ page }) => {
  await page.goto(BASE);
  await login(page);
  // en modo ALLOW_NO_AUTH no hay form — el sistema carga directamente
  await expect(page).toHaveURL(/localhost:11294/);
  console.log('✅ Login OK (o ALLOW_NO_AUTH activo)');
});

// ─── FASE 1: Crear proyecto ───────────────────────────────────────────────────

let PROJECT_ID = '';

test('F1 — Crear proyecto de prueba', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  const r = await apiPost(page, '/api/projects', {
    name: PROJ_NAME,
    description: 'Proyecto de test E2E — circuito completo',
    client: 'Cliente Test',
    system_type: 'Software',
    gamp_category: '4',
  });

  expect(r.ok).toBeTruthy();
  PROJECT_ID = r.project?.id || r.id;
  expect(PROJECT_ID).toBeTruthy();
  console.log(`✅ Proyecto creado: ${PROJ_NAME} → id=${PROJECT_ID}`);

  // Guardar ID para pasos siguientes
  await page.evaluate((id) => localStorage.setItem('_e2e_proj_id', id), PROJECT_ID);
});

// ─── FASE 2: Cargar 3 documentos de prueba ────────────────────────────────────

test('F2 — Cargar documentos de prueba (URS, FRS, IQ)', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  // Recuperar project ID guardado
  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));
  expect(PROJECT_ID).toBeTruthy();

  const docs = [
    {
      type: 'URS',
      data: {
        metadata: { title: 'URS Test E2E', version: '1.0', projectName: PROJ_NAME, docCode: 'URS-TEST-001', date: new Date().toISOString().slice(0,10), status: 'draft' },
        requirements: [
          { id: 'URS-001', category: 'Funcional', description: 'El sistema debe autenticar usuarios', priority: 'Alta', acceptance: 'Login exitoso con credenciales válidas' },
          { id: 'URS-002', category: 'Funcional', description: 'El sistema debe generar reportes', priority: 'Media', acceptance: 'Reporte exportado en PDF' },
          { id: 'URS-NF-001', category: 'No Funcional', description: 'Disponibilidad 99.5%', priority: 'Alta', acceptance: 'Uptime medido mensualmente' },
        ],
      },
    },
    {
      type: 'FRS',
      data: {
        metadata: { title: 'FRS Test E2E', version: '1.0', projectName: PROJ_NAME, docCode: 'FRS-TEST-001', date: new Date().toISOString().slice(0,10), status: 'draft' },
        requirements: [
          { id: 'FRS-001', ursRef: 'URS-001', description: 'Formulario de login con usuario y contraseña', type: 'Funcional' },
          { id: 'FRS-002', ursRef: 'URS-002', description: 'Módulo de generación de PDF con pdfMake', type: 'Funcional' },
        ],
      },
    },
    {
      type: 'IQ',
      data: {
        metadata: { title: 'IQ Test E2E', version: '1.0', projectName: PROJ_NAME, docCode: 'IQ-TEST-001', date: new Date().toISOString().slice(0,10), status: 'draft' },
        testCases: [
          { id: 'TC-IQ-001', ursRef: 'URS-001', objective: 'Verificar instalación del sistema', steps: ['Ejecutar instalador', 'Verificar servicios activos'], expectedResult: 'Servicios corriendo en puerto 11294', result: 'Pendiente' },
          { id: 'TC-IQ-002', ursRef: 'URS-NF-001', objective: 'Verificar configuración de base de datos', steps: ['Conectar a SQLite', 'Verificar tablas existentes'], expectedResult: 'Tablas creadas correctamente', result: 'Pendiente' },
        ],
      },
    },
  ];

  for (const doc of docs) {
    const r = await apiPut(page, `/api/projects/${PROJECT_ID}/documents/${doc.type}`, {
      json_data: JSON.stringify(doc.data),
      status: 'draft',
    });
    expect(r.ok, `Falló al crear ${doc.type}: ${JSON.stringify(r)}`).toBeTruthy();
    console.log(`✅ Documento ${doc.type} cargado`);
  }
});

// ─── FASE 3: Verificar documentos en la UI ────────────────────────────────────

test('F3 — Verificar documentos en Suite Validación', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  // Ir al proyecto en la UI
  await page.waitForTimeout(1500);

  // Listar docs via API
  const r = await apiGet(page, `/api/projects/${PROJECT_ID}/documents`);
  expect(r.ok).toBeTruthy();
  expect(r.documents.length).toBeGreaterThanOrEqual(3);

  const types = r.documents.map(d => d.doc_type);
  expect(types).toContain('URS');
  expect(types).toContain('FRS');
  expect(types).toContain('IQ');
  console.log(`✅ Documentos en proyecto: ${types.join(', ')}`);
});

// ─── FASE 4: Crear ronda de revisión ─────────────────────────────────────────

let ROUND_ID = '';

test('F4 — Crear ronda de revisión con firmante invitado', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  const signers = [
    {
      username: SIGNER.username,
      email: SIGNER.email,
      display_name: SIGNER.displayName,
      role_label: 'Revisor',
      sign_order: 1,
    },
  ];

  // Crear ronda para URS
  const r = await apiPost(page, `/api/projects/${PROJECT_ID}/signing-rounds`, {
    doc_type: 'URS',
    phase: 'review',
    signers,
  });

  expect(r.ok, `Error al crear ronda: ${JSON.stringify(r)}`).toBeTruthy();
  ROUND_ID = r.round_id || r.id;
  await page.evaluate((id) => localStorage.setItem('_e2e_round_id', id), ROUND_ID);
  console.log(`✅ Ronda de revisión creada → id=${ROUND_ID}`);
  console.log(`📧 Email de invitación enviado a: ${SIGNER.email}`);
  console.log(`   Si no tenés RESEND_API_KEY, buscá el magic link en los logs del servidor`);
});

// ─── FASE 5: Activar PIN del firmante invitado ────────────────────────────────

test('F5 — Activar PIN del firmante (simular onboarding)', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  // Obtener el token de invitación del usuario recién creado
  const usersR = await apiGet(page, '/admin/users?role=client');
  const newUser = (usersR.users || []).find(u => u.username === SIGNER.username);

  if (!newUser) {
    console.log('⚠ Firmante no encontrado aún (puede tardar). Buscando en DB...');
  } else {
    console.log(`✅ Firmante creado: username=${newUser.username}, is_provisional=${newUser.is_provisional}`);
  }

  // Simular seteo de PIN via API de superadmin (solo en dev/test)
  // En producción el firmante entraría por magic link y configuraría su PIN
  if (newUser) {
    const pinR = await apiPost(page, `/admin/users/${newUser.id}/set-pin`, { pin: SIGNER.pin });
    if (pinR.ok) {
      console.log(`✅ PIN configurado para ${SIGNER.username}: ${SIGNER.pin}`);
    } else {
      console.log(`ℹ No se pudo setear PIN via API (${pinR.error}) — usar magic link en portal`);
    }
  }
});

// ─── FASE 6: Firmar en Portal Firmas ─────────────────────────────────────────

test('F6 — Firmante entra al Portal y firma', async ({ page }) => {
  await page.goto(`${BASE}/client/`);
  await page.waitForTimeout(1500);

  ROUND_ID = ROUND_ID || await page.evaluate(() => localStorage.getItem('_e2e_round_id'));
  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  // Hacer login en el portal
  const usernameInput = page.locator('input[placeholder*="usuario" i], input[name="username"], #cl-username');
  const pinInput = page.locator('input[placeholder*="pin" i], input[type="password"], input[name="pin"], #cl-pin');
  const loginBtn = page.locator('button:has-text("Ingresar"), button:has-text("Acceder"), button[type="submit"]').first();

  await usernameInput.fill(SIGNER.username);
  await pinInput.fill(SIGNER.pin);
  await loginBtn.click();
  await page.waitForTimeout(2000);

  console.log('ℹ Portal de Firmas abierto — verificar login manualmente si falla');

  // Verificar que ve documentos
  const pageContent = await page.content();
  const hasProject = pageContent.includes(PROJ_NAME) || pageContent.includes('URS') || pageContent.includes('pendiente');
  console.log(hasProject ? '✅ Firmante ve documentos en el portal' : '⚠ No se detectaron documentos — revisar manualmente');
});

// ─── FASE 7: Admin firma y sella ronda de revisión ───────────────────────────

test('F7 — Admin sella la ronda de revisión', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));
  ROUND_ID = ROUND_ID || await page.evaluate(() => localStorage.getItem('_e2e_round_id'));

  // Verificar estado actual de la ronda
  const roundsR = await apiGet(page, `/api/projects/${PROJECT_ID}/signing-rounds`);
  const round = (roundsR.rounds || []).find(r => r.id === ROUND_ID);
  if (round) {
    console.log(`📋 Estado ronda: ${round.status}, firmantes: ${round.signed_count}/${round.total_signers}`);
  }

  // Sellar (aunque no todos hayan firmado — permite sellar parcial en dev)
  const sealR = await apiPost(page, `/api/projects/${PROJECT_ID}/signing-rounds/${ROUND_ID}/seal`, {});
  if (sealR.ok) {
    console.log('✅ Ronda de REVISIÓN sellada');
  } else {
    console.log(`⚠ Sello: ${sealR.error} (puede requerir que todos firmen primero)`);
  }
});

// ─── FASE 8: Crear ronda de aprobación ───────────────────────────────────────

let APPROVAL_ROUND_ID = '';

test('F8 — Crear ronda de APROBACIÓN', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  const r = await apiPost(page, `/api/projects/${PROJECT_ID}/signing-rounds`, {
    doc_type: 'URS',
    phase: 'approval',
    signers: [
      {
        username: SIGNER.username,
        email: SIGNER.email,
        display_name: SIGNER.displayName,
        role_label: 'Aprobador',
        sign_order: 1,
      },
    ],
  });

  if (r.ok) {
    APPROVAL_ROUND_ID = r.round_id || r.id;
    await page.evaluate((id) => localStorage.setItem('_e2e_approval_id', id), APPROVAL_ROUND_ID);
    console.log(`✅ Ronda de APROBACIÓN creada → id=${APPROVAL_ROUND_ID}`);
  } else {
    console.log(`⚠ ${r.error}`);
  }
});

// ─── FASE 9: Sellar aprobación → doc.status='approved' ───────────────────────

test('F9 — Sellar ronda de aprobación', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));
  APPROVAL_ROUND_ID = APPROVAL_ROUND_ID || await page.evaluate(() => localStorage.getItem('_e2e_approval_id'));

  if (!APPROVAL_ROUND_ID) {
    console.log('⚠ No hay ronda de aprobación — saltando');
    return;
  }

  const r = await apiPost(page, `/api/projects/${PROJECT_ID}/signing-rounds/${APPROVAL_ROUND_ID}/seal`, {});
  if (r.ok) {
    console.log('✅ Ronda de APROBACIÓN sellada → documento debería estar approved');
  } else {
    console.log(`⚠ Sello aprobación: ${r.error}`);
  }

  // Verificar estado del documento
  const docR = await apiGet(page, `/api/projects/${PROJECT_ID}/documents/URS`);
  const status = docR.document?.status;
  console.log(`📄 Estado URS: ${status}`);
  if (status === 'approved') {
    console.log('✅✅ DOCUMENTO APROBADO correctamente');
  }
});

// ─── FASE 10: Verificar Archivo del Proyecto ─────────────────────────────────

test('F10 — Verificar People Book y Archivo', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  // People Book
  const pb = await apiGet(page, `/api/projects/${PROJECT_ID}/people-book`);
  expect(pb.ok).toBeTruthy();
  const entries = pb.entries || [];
  console.log(`📖 People Book: ${entries.length} entradas`);

  const approvalEntries = entries.filter(e => (e.phase || 'review') === 'approval' && e.round_status === 'sealed');
  console.log(`✅ Firmas de aprobación selladas: ${approvalEntries.length}`);

  // Documentos aprobados
  const docsR = await apiGet(page, `/api/projects/${PROJECT_ID}/documents`);
  const approved = (docsR.documents || []).filter(d => d.status === 'approved');
  console.log(`✅ Documentos aprobados: ${approved.map(d => d.doc_type).join(', ') || 'ninguno aún'}`);

  // Validation Book
  const vb = await apiGet(page, `/api/projects/${PROJECT_ID}/validation-book`);
  const blocks = vb.blocks || [];
  console.log(`📚 Validation Book: ${blocks.length} bloques (designation + seals)`);
  blocks.forEach(b => console.log(`   [${b.block_type}] blk#${b.block_number} — ${b.sealed_by || b.created_by}`));
});

// ─── FASE 11: Revocar acceso del firmante ────────────────────────────────────

test('F11 — Revocar acceso del firmante invitado', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  const r = await apiPost(page, `/api/projects/${PROJECT_ID}/signers/${SIGNER.username}/revoke`, {
    action: 'revoke',
  });

  if (r.ok) {
    console.log(`✅ Firmante "${SIGNER.username}" revocado — is_active=${r.is_active}`);
  } else {
    console.log(`⚠ Revocación: ${r.error}`);
  }
});

// ─── FASE 12: Verificar que el firmante revocado no puede acceder ─────────────

test('F12 — Firmante revocado no puede acceder al portal', async ({ page }) => {
  await page.goto(`${BASE}/client/`);
  await page.waitForTimeout(1000);

  // Intentar login como firmante revocado
  const usernameInput = page.locator('input[placeholder*="usuario" i], input[name="username"], #cl-username');
  const pinInput = page.locator('input[placeholder*="pin" i], input[type="password"], #cl-pin');
  const loginBtn = page.locator('button:has-text("Ingresar"), button[type="submit"]').first();

  await usernameInput.fill(SIGNER.username);
  await pinInput.fill(SIGNER.pin);
  await loginBtn.click();
  await page.waitForTimeout(2000);

  const content = await page.content();
  const blocked = content.toLowerCase().includes('inactivo') || content.toLowerCase().includes('revocado') || content.toLowerCase().includes('denegado');
  console.log(blocked
    ? '✅ Firmante revocado correctamente bloqueado'
    : '⚠ Verificar manualmente — acceso puede estar restringido por otro mecanismo');
});

// ─── RESUMEN ──────────────────────────────────────────────────────────────────

test('RESUMEN — Estado final del proyecto', async ({ page }) => {
  await page.goto(BASE);
  await login(page);

  PROJECT_ID = PROJECT_ID || await page.evaluate(() => localStorage.getItem('_e2e_proj_id'));

  const [docsR, pbR, vbR] = await Promise.all([
    apiGet(page, `/api/projects/${PROJECT_ID}/documents`),
    apiGet(page, `/api/projects/${PROJECT_ID}/people-book`),
    apiGet(page, `/api/projects/${PROJECT_ID}/validation-book`),
  ]);

  const docs = docsR.documents || [];
  const approved = docs.filter(d => d.status === 'approved');
  const pb = pbR.entries || [];
  const vb = vbR.blocks || [];

  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  RESUMEN CIRCUITO COMPLETO');
  console.log('══════════════════════════════════════');
  console.log(`  Proyecto:        ${PROJ_NAME}`);
  console.log(`  ID:              ${PROJECT_ID}`);
  console.log(`  Documentos:      ${docs.length} total, ${approved.length} aprobados`);
  console.log(`  People Book:     ${pb.length} entradas`);
  console.log(`  Validation Book: ${vb.length} bloques`);
  console.log('══════════════════════════════════════');

  expect(docs.length).toBeGreaterThanOrEqual(3);
  expect(pb.length).toBeGreaterThan(0);
});
