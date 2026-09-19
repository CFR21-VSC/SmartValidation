// Valida los documentos REALES contra el contrato candidato 3.1, en memoria.
//
//   node contrato-documentos/cadena-v31-test.cjs
//
// La conversion a claves canonicas se hace con `mapa-esperado.json`, que esta
// escrito a mano. Si se usara el asignador, esto validaria el contrato contra
// la salida del algoritmo en vez de contra una lectura independiente.
//
// Asignar 18 claves no implica que el documento valide completo: este test es
// el que comprueba lo segundo. No escribe ningun archivo.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const abs = p => (path.isAbsolute(p) || /^[A-Za-z]:/.test(p)) ? p : path.join(RAIZ, p);
const leer = p => JSON.parse(fs.readFileSync(abs(p), 'utf8').replace(/^﻿/, ''));

const fuente = fs.readFileSync(path.join(__dirname, 'validar.cjs'), 'utf8').split('// ── CLI')[0];
const ctx = { require, __dirname };
vm.createContext(ctx);
vm.runInContext(fuente + '\nthis.validar = validar;', ctx);

const ESPERADO = leer('contrato-documentos/mapa-esperado.json');
const CANDIDATO = {
  URS: 'contrato-documentos/urs.skeleton.v3.1.candidato.json',
  VP: 'contrato-documentos/vp.skeleton.v3.1.candidato.json',
};

let fallos = 0;
const parciales = [];
const caso = (nombre, ok, detalle) => {
  console.log(`${ok ? ' OK ' : 'FALLA'}  ${nombre}`);
  if (!ok) { fallos++; if (detalle) console.log(`        ${detalle}`); }
};

for (const [etiqueta, info] of Object.entries(ESPERADO)) {
  if (etiqueta.startsWith('_')) continue;
  if (!fs.existsSync(abs(info.archivo))) {
    // Omitirlo daba el mismo OK de "cadena completa" con el perfil incompleto.
    caso(`el documento del perfil existe: ${etiqueta}`, false, `falta ${info.archivo}`);
    continue;
  }

  if (info.sinEsqueleto || !CANDIDATO[info.tipo]) {
    // Este tipo todavia no tiene esqueleto candidato: no se puede validar
    // contra un contrato que no existe. Se dice y se cuenta como parcial, no
    // se omite en silencio ni se da por OK.
    console.log(`
-- ${etiqueta} (${info.tipo}): SIN ESQUELETO, no se valida`);
    parciales.push(etiqueta);
    continue;
  }
  const skel = leer(CANDIDATO[info.tipo]);
  const doc = leer(info.archivo);
  const antes = JSON.stringify(doc);

  // Conversion a claves canonicas SEGUN EL MAPA ESCRITO A MANO.
  const inst = JSON.parse(antes);
  const porClave = new Map(skel.secciones.map(s => [s.id, s]));
  inst.secciones.forEach((s, i) => {
    const clave = info.mapa[String(i)];
    if (!clave) return;
    s.id = clave;
    const def = porClave.get(clave);
    if (def && def.padre) s.padre = def.padre; else delete s.padre;
    if (def) s.clase = def.clase;
    delete s.obligatoriedad;
  });
  inst.esqueleto = { tipo: info.tipo, version: '3.1', archivo: path.basename(CANDIDATO[info.tipo]) };

  const r = ctx.validar(skel, inst, etiqueta);
  console.log(`\n── ${etiqueta} (${info.tipo}) contra el candidato 3.1`);
  // La expectativa se declara por documento en el mapa, no se deduce del
  // resultado: el fixture es anterior a `requirementsSummary` obligatorio y su
  // rechazo por esa regla es correcto. Cualquier otra regla es una regresion.
  const permitidas = new Set(((info.esperaErrores || {}).reglas) || []);
  const inesperados = r.errores.filter(e => !permitidas.has(e.regla));
  caso(permitidas.size
         ? `solo produce los errores declarados (${[...permitidas].join(', ')})`
         : 'valida sin errores contra el contrato candidato',
       inesperados.length === 0,
       inesperados.slice(0, 6).map(e => `[${e.regla}] ${e.msg}`).join('\n        '));
  if (permitidas.size) {
    // Permitir una regla sin exigirla dejaba pasar tambien cero errores: si la
    // excepcion deja de ocurrir hay que sacarla del mapa, no ignorarla.
    const presentes = new Set(r.errores.map(e => e.regla));
    caso(`la excepcion declarada ocurre (${[...permitidas].join(', ')})`,
         [...permitidas].every(x => presentes.has(x)),
         `no ocurrio; si ya no aplica, sacarla de mapa-esperado.json`);
  }
  caso('el documento de origen no se modifico', JSON.stringify(doc) === antes);
  caso('todas las secciones recibieron clave canonica',
       inst.secciones.every(s => porClave.has(s.id)),
       inst.secciones.filter(s => !porClave.has(s.id)).map(s => s.id).join(', '));
  if (r.advertencias.length)
    r.advertencias.slice(0, 3).forEach(w => console.log(`        aviso [${w.regla}] ${w.msg}`));
}

console.log();
if (parciales.length)
  console.log(`PERFIL PARCIAL: ${parciales.length} documento(s) sin esqueleto, no validados: ${parciales.join(', ')}`);
if (fallos) { console.log(`RESULTADO: FALLA — ${fallos} caso(s)`); process.exitCode = 1; }
else console.log('RESULTADO: OK — los documentos reales validan contra el contrato candidato 3.1');
