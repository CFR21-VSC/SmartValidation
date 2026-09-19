// Read-only: a self-consistent summary must also agree with actual requirements.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { require, __dirname: path.resolve('contrato-documentos') };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('contrato-documentos/validar.cjs', 'utf8').split('// ── CLI')[0] + '\nthis.validate = validar;', ctx);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const skeleton = read('contrato-documentos/urs.skeleton.v3.json');
const instance = read('contrato-documentos/ejemplos/urs.instancia.valida.json');
for (const key of Object.keys(instance.requirementsSummary)) {
  instance.requirementsSummary[key] = Array.isArray(instance.requirementsSummary[key]) ? [] : 0;
}
const result = ctx.validate(skeleton, instance, 'summary-zero');
console.log(JSON.stringify({ summary: instance.requirementsSummary, extractedIds: result.ids, errors: result.errores }, null, 2));
