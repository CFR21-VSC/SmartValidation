// Prueba INDIVIDUAL por regla del validador del contrato v3.0.
//
//   node contrato-documentos/reglas-test.cjs
//   node contrato-documentos/reglas-test.cjs --verbose
//
// Por que una prueba por regla y no un archivo "instancia.invalida.json":
// un archivo con veinte defectos a la vez no demuestra que cada regla funcione.
// Si una regla deja de dispararse, el archivo sigue siendo rechazado por las
// otras diecinueve y el test sigue en verde. Fue exactamente lo que paso: las
// ocho mutaciones de la Ronda 4 daban cero errores y el --demo seguia pasando.
//
// Aca cada caso parte de una instancia que valida LIMPIA, aplica UNA mutacion y
// declara el conjunto EXACTO de reglas que debe dispararse. Si aparece una regla
// de mas, tambien falla: una regla que sobre-dispara produce falsos positivos
// sobre documentos reales y correctos.
//
// No modifica ningun archivo.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = p => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));

// Se carga validar() sin ejecutar el CLI.
const fuente = fs.readFileSync(path.join(__dirname, 'validar.cjs'), 'utf8').split('// ── CLI')[0];
const ctx = { require, __dirname };
vm.createContext(ctx);
vm.runInContext(fuente + '\nthis.validar = validar;', ctx);

const SKEL_URS = leer('contrato-documentos/urs.skeleton.v3.json');
const BASE_URS = leer('contrato-documentos/ejemplos/urs.instancia.valida.json');

const sec = (d, id) => d.secciones.find(s => s.id === id);
const iSec = (d, id) => d.secciones.findIndex(s => s.id === id);

// ── Casos ──────────────────────────────────────────────────────────────────
// reglas: conjunto EXACTO de reglas que debe producir la mutacion.
const CASOS = [
  // 1. Identidad del documento
  { regla: 'identidad', que: 'el campo de tipo de la instancia no es el del esqueleto',
    reglas: ['identidad'], mutar: d => { d.type = 'VP'; } },
  { regla: 'identidad', que: 'referencia a un esqueleto de otro tipo de documento',
    reglas: ['identidad'], mutar: d => { d.esqueleto.tipo = 'VP'; } },
  { regla: 'identidad', que: 'referencia a una version de contrato que no es la validada',
    reglas: ['identidad'], mutar: d => { d.esqueleto.version = '2.9'; } },
  { regla: 'autoridad', que: 'la instancia se declara a si misma obligatoria',
    reglas: ['autoridad'], mutar: d => { sec(d, 'proposito').obligatoriedad = 'opcional'; } },

  // 2. Arbol
  { regla: 'arbol', que: 'dos secciones con el mismo id',
    // Se AGREGA un duplicado en vez de renombrar: renombrar tambien hacia
    // desaparecer la seccion original y el caso dejaba de aislar la regla.
    reglas: ['arbol'], mutar: d => { d.secciones.push(JSON.parse(JSON.stringify(sec(d, 'proposito')))); } },
  { regla: 'arbol', que: 'clase fuera de {seccion, bloque}',
    reglas: ['arbol', 'clase'], mutar: d => { sec(d, 'proposito').clase = 'capitulo'; } },
  { regla: 'arbol', que: 'una seccion es su propio padre',
    reglas: ['arbol', 'parentesco'], mutar: d => { sec(d, 'proposito').padre = 'proposito'; } },
  { regla: 'arbol', que: 'un bloque sin padre',
    reglas: ['arbol', 'parentesco'],
    // La madre elegida tiene contenido propio: asi la mutacion no vacia
    // tambien una seccion requerida y el caso mide solo el parentesco.
    mutar: d => { delete sec(d, 'leyenda-de-la-tabla-de-requeri-b').padre; } },
  { regla: 'arbol', que: 'padre que no existe en el documento',
    reglas: ['arbol', 'parentesco'], mutar: d => { sec(d, 'descripcion-general').padre = 'no-existe'; } },
  { regla: 'arbol', que: 'el padre declarado es un bloque, no una seccion',
    reglas: ['arbol', 'parentesco'],
    mutar: d => { sec(d, 'descripcion-general').padre = 'usuarios-del-sistema-b'; } },
  { regla: 'arbol', que: 'ciclo de parentesco entre dos secciones',
    reglas: ['arbol', 'parentesco'], mutar: d => {
      sec(d, 'proposito').padre = 'alcance';
      sec(d, 'alcance').padre = 'proposito';
    } },

  // 3. Numeracion
  { regla: 'numeracion', que: 'numero como string en vez de entero',
    reglas: ['numeracion'], mutar: d => { sec(d, 'proposito').numero = '1'; } },

  // 3bis. Conformidad con el esqueleto
  { regla: 'tipo', que: 'tipo distinto del que declara el esqueleto',
    reglas: ['tipo'], mutar: d => { sec(d, 'proposito').tipo = 'tipo-inexistente'; } },
  { regla: 'parentesco', que: 'padre semanticamente incorrecto pero existente',
    reglas: ['parentesco'], mutar: d => { sec(d, 'descripcion-general').padre = 'proposito'; } },
  { regla: 'clase', que: 'una seccion declarada como bloque',
    reglas: ['clase'], mutar: d => { sec(d, 'descripcion-general').clase = 'bloque'; } },
  { regla: 'desconocida', que: 'seccion que el esqueleto no declara',
    reglas: ['desconocida'], mutar: d => {
      d.secciones.push({ id: 'seccion-colada', clase: 'bloque', padre: 'proposito',
                         tipo: 'texto', titulo: 'Colada', contenido: 'x' });
    } },

  // 3ter. Secciones requeridas vacias
  { regla: 'vacia', que: 'seccion requerida sin contenido ni hijos con contenido',
    reglas: ['vacia'], mutar: d => {
      const s = sec(d, 'proposito');
      ['bloques', 'texto', 'contenido', 'parrafos', 'intro'].forEach(k => delete s[k]);
      s.filas = [];
    } },

  // 4. Obligatoriedad y estados
  { regla: 'obligatoriedad', que: 'falta una seccion requerida',
    reglas: ['obligatoriedad'], mutar: d => { d.secciones.splice(iSec(d, 'definiciones'), 1); } },
  { regla: 'obligatoriedad', que: 'noAplica sobre una seccion requerida',
    reglas: ['obligatoriedad', 'noAplica'], mutar: d => {
      const s = sec(d, 'definiciones');   // requerida: el noAplica es ilegitimo
      s.noAplica = { justificacion: 'no corresponde' };
      s.filas = [];
    } },
  { regla: 'noAplica', que: 'noAplica sin justificacion',
    reglas: ['noAplica'], mutar: d => {
      const s = sec(d, 'exclusiones-explicitas');
      s.noAplica = { justificacion: '   ' };
      s.filas = [];
    } },
  { regla: 'noAplica', que: 'noAplica conviviendo con filas activas',
    reglas: ['noAplica'], mutar: d => {
      sec(d, 'exclusiones-explicitas').noAplica = { justificacion: 'no corresponde' };
    } },

  // 5. Forma de instancia (compatibilidad con los extractores)
  { regla: 'forma', que: 'las filas colgadas de sec.tabla.filas, donde los extractores no miran',
    // Mover las filas fuera de sec.filas las esconde de TODO el que lea
    // sec.filas: los extractores, el minimo de filas y el chequeo de vacio.
    reglas: ['forma', 'vacia', 'minFilas'], mutar: d => {
      const s = sec(d, 'definiciones');
      s.tabla = { filas: s.filas };
      s.filas = [];
    } },
  { regla: 'forma', que: 'fila objeto en una tabla con ID (el tracer descarta las no-array)',
    reglas: ['forma'], mutar: d => {
      const s = sec(d, 'requerimientos-funcionales');
      s.filas.push({ ursId: 'URS-900', texto: 'x' });
    } },
  { regla: 'forma', que: 'ID rico en fila objeto (coherence_pack hace str() y no matchea)',
    reglas: ['forma'], mutar: d => {
      const s = sec(d, 'requerimientos-funcionales');
      s.filas.push({ ursId: { text: 'URS-901' } });
    } },

  // 6. Columnas, IDs, enums, minFilasDatos
  { regla: 'columnas', que: 'la instancia no trae columnas donde el contrato las declara',
    reglas: ['columnas'], mutar: d => { delete sec(d, 'requerimientos-funcionales').columnas; } },
  { regla: 'columnas', que: 'distinta cantidad de columnas que el contrato',
    reglas: ['columnas'], mutar: d => { sec(d, 'requerimientos-funcionales').columnas.pop(); } },
  { regla: 'columnas', que: 'columnas renombradas (cambia el significado de la tabla)',
    reglas: ['columnas'], mutar: d => {
      sec(d, 'requerimientos-funcionales').columnas =
        sec(d, 'requerimientos-funcionales').columnas.map(() => 'incorrecta');
    } },
  { regla: 'id', que: 'ID con todos los digitos en cero (la numeracion arranca en 1)',
    reglas: ['id', 'resumen'], mutar: d => {
      sec(d, 'requerimientos-funcionales').filas.find(Array.isArray)[0] = 'URS-0000';
    } },
  { regla: 'id', que: 'ID que no matchea el patron del contrato',
    reglas: ['id', 'resumen'], mutar: d => {
      sec(d, 'requerimientos-funcionales').filas.find(Array.isArray)[0] = 'REQ-1';
    } },
  { regla: 'id', que: 'el mismo ID definido dos veces',
    reglas: ['id', 'resumen'], mutar: d => {
      const f = sec(d, 'requerimientos-funcionales').filas.filter(Array.isArray);
      f[1][0] = f[0][0];
    } },

  // 7. Resumen derivado
  { regla: 'resumen', que: 'requirementsSummary que no es un objeto',
    reglas: ['resumen'], mutar: d => { d.requirementsSummary = 'muchos'; } },
  { regla: 'resumen', que: 'conteo negativo en requirementsSummary',
    reglas: ['resumen'], mutar: d => { d.requirementsSummary = { total: -100 }; } },

  // Caso de la Ronda 11: el resumen cerraba consigo mismo y mentia sobre los
  // datos. Con todo en cero y las listas vacias, las tres sumas y las dos
  // longitudes cierran — y la tabla tiene 55 requerimientos.
  { regla: 'resumen', que: 'resumen coherente consigo mismo pero en cero contra una tabla de 55',
    reglas: ['resumen'], mutar: d => {
      d.requirementsSummary = { total: 0, functional: 0, nonFunctional: 0, mandatory: 0,
                                desirable: 0, critical: 0, high: 0, medium: 0,
                                functionalIds: [], nonFunctionalIds: [] };
    } },
  { regla: 'resumen', que: 'lista de IDs inventados con la longitud correcta',
    reglas: ['resumen'], mutar: d => {
      d.requirementsSummary.functionalIds =
        d.requirementsSummary.functionalIds.map((_, i) => `URS-9${String(i).padStart(2, '0')}`);
    } },

  // ── Casos de la Ronda 9 ────────────────────────────────────────────────
  // Ocho mutaciones que el validador aceptaba en silencio. Todas caen dentro
  // del alcance ya discutido: forma de fila, contenido obligatorio, resumen y
  // representacion canonica del ID.
  { regla: 'tipo', que: 'seccion SIN tipo (antes solo se miraba la discrepancia)',
    reglas: ['tipo'], mutar: d => { delete sec(d, 'proposito').tipo; } },
  { regla: 'celda', que: 'requerimiento sin ID',
    reglas: ['celda', 'resumen'], mutar: d => {
      sec(d, 'requerimientos-funcionales').filas.find(Array.isArray)[0] = '';
    } },
  { regla: 'celda', que: 'requerimiento sin enunciado',
    reglas: ['celda'], mutar: d => {
      sec(d, 'requerimientos-funcionales').filas.find(Array.isArray)[2] = '';
    } },
  { regla: 'enum', que: 'criticidad fuera de los valores que declara el generador',
    reglas: ['enum', 'resumen'], mutar: d => {
      sec(d, 'requerimientos-funcionales').filas.find(Array.isArray)[4] = 'CUALQUIERA';
    } },
  { regla: 'arity', que: 'fila con menos celdas que columnas (corre el contenido)',
    reglas: ['arity', 'celda', 'resumen'], mutar: d => {
      const f = sec(d, 'requerimientos-funcionales').filas;
      f[f.findIndex(Array.isArray)] = [f.find(Array.isArray)[0]];
    } },
  { regla: 'resumen', que: 'requirementsSummary con un solo campo y total inventado',
    reglas: ['resumen'], mutar: d => { d.requirementsSummary = { total: 999999 }; } },
  { regla: 'id', que: 'URS-0001: otra grafia del mismo numero que URS-001',
    reglas: ['id', 'resumen'], mutar: d => {
      // El resumen tambien se rompe, y con razon: functionalIds sigue listando
      // la grafia vieja, asi que el documento se contradice a si mismo.
      sec(d, 'requerimientos-funcionales').filas.find(Array.isArray)[0] = 'URS-0001';
      d.requirementsSummary.functionalIds[0] = 'URS-0001';
      d.requirementsSummary.total = 999;
    } },
  { regla: 'vacia', que: 'seccion con bloques:[{}] — array no vacio que no dibuja nada',
    reglas: ['vacia'], mutar: d => {
      const s = sec(d, 'proposito');
      ['texto', 'contenido', 'parrafos', 'intro'].forEach(k => delete s[k]);
      s.filas = [];
      s.bloques = [{}];
    } },
];

// ── Corrida ────────────────────────────────────────────────────────────────
const verbose = process.argv.includes('--verbose');
const clon = o => JSON.parse(JSON.stringify(o));

// Precondicion: sin mutar, la instancia base no puede tener un solo error.
// Si la tuviera, cualquier regla "se dispararia" sin que la mutacion la cause.
const linea = ctx.validar(SKEL_URS, clon(BASE_URS), 'base');
if (linea.errores.length) {
  console.log('PRECONDICION ROTA: la instancia base ya produce errores; ningun caso seria concluyente.');
  linea.errores.forEach(e => console.log(`   [${e.regla}] ${e.msg}`));
  process.exit(2);
}
console.log(`Prueba por regla — base limpia (0 errores), ${CASOS.length} casos\n`);

let fallos = 0;
const cubiertas = new Set();
for (const c of CASOS) {
  const d = clon(BASE_URS);
  c.mutar(d);
  const r = ctx.validar(SKEL_URS, d, c.regla);
  const vistas = [...new Set(r.errores.map(e => e.regla))].sort();
  const esperadas = [...new Set(c.reglas)].sort();
  const ok = vistas.join('|') === esperadas.join('|');
  if (ok) cubiertas.add(c.regla);
  else fallos++;

  console.log(`${ok ? ' OK ' : 'FALLA'}  [${c.regla}] ${c.que}`);
  if (!ok) {
    console.log(`         esperaba exactamente: ${esperadas.join(', ') || '(ninguna)'}`);
    console.log(`         se dispararon:        ${vistas.join(', ') || '(ninguna)'}`);
  }
  if (!ok || verbose) r.errores.slice(0, 6).forEach(e => console.log(`         · [${e.regla}] ${e.msg}`));
}

const todas = [...new Set(CASOS.map(c => c.regla))];
console.log(`\nReglas con al menos un caso propio: ${todas.length} (${todas.join(', ')})`);
if (fallos) {
  console.log(`RESULTADO: FALLA — ${fallos}/${CASOS.length} casos`);
  process.exitCode = 1;
} else {
  console.log(`RESULTADO: OK — ${CASOS.length}/${CASOS.length} casos, cada regla se dispara sola y no de mas`);
}
