// Read-only adversarial validation probes. Run from repository root.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');
const src = fs.readFileSync('contrato-documentos/validar.cjs', 'utf8').split('// ── CLI')[0];
const context = { require, __dirname: path.resolve('contrato-documentos') };
vm.createContext(context);
vm.runInContext(src + '\nthis.validate = validar;', context);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const skeleton = read('contrato-documentos/urs.skeleton.v3.json');
const base = read('contrato-documentos/ejemplos/urs.instancia.valida.json');
const row = d => d.secciones.find(s => s.id === 'requerimientos-funcionales').filas.find(Array.isArray);
const cases = {
  missingType: d => { delete d.secciones[0].tipo; },
  missingRequirementId: d => { row(d)[0] = ''; },
  missingRequirementText: d => { row(d)[2] = ''; },
  unknownCriticality: d => { row(d)[4] = 'CUALQUIERA'; },
  shortRow: d => { row(d).splice(1); },
  wrongPositiveTotal: d => { d.requirementsSummary = { total: 999999 }; },
  numericAlias: d => { row(d)[0] = 'URS-0001'; },
  structurallyEmptyPurpose: d => {
    const s = d.secciones[0]; delete s.texto; delete s.contenido; s.bloques = [{}];
  },
};
for (const [name, mutation] of Object.entries(cases)) {
  const d = structuredClone(base); mutation(d);
  console.log(JSON.stringify({ name, errors: context.validate(skeleton, d, name).errores }));
}
for (const args of [
  ['contrato-documentos/urs.skeleton.v3.json', 'contrato-documentos/ejemplos/urs.instancia.invalida.json'],
  ['contrato-documentos/urs.skeleton.v3.json'],
]) {
  const r = spawnSync(process.execPath, ['contrato-documentos/validar.cjs', ...args], { encoding: 'utf8' });
  console.log(JSON.stringify({ cliArgs: args, exitCode: r.status, reportedErrors: /ERRORES: [1-9]/.test(r.stdout) }));
}
