"""Read-only counterexample: a missing mandatory section must not steal another role."""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'contrato-documentos'))
from identidad import asignar

with open(os.path.join(ROOT, 'SMART_Validation/js/validation-suite/fixtures/urs-drp-sis-001.json'), encoding='utf-8') as f:
    original = json.load(f)

doc = copy.deepcopy(original)
removed = doc['secciones'].pop(6)
assignments, problems = asignar(doc)
print(json.dumps({
    'removed': removed.get('titulo'),
    'usuarios': assignments.get('contexto.usuarios'),
    'integraciones': assignments.get('contexto.integraciones'),
    'problems': problems,
}, ensure_ascii=True, indent=2))
if 'contexto.usuarios' in assignments or not any(p[0] in ('FALTA', 'AMBIGUO') and p[1] == 'contexto.usuarios' for p in problems):
    print('FAIL: missing Usuarios silently receives another section.')
    sys.exit(1)
print('OK: missing mandatory role is reported without a false assignment.')
