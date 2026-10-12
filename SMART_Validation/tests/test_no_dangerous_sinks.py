"""
Guardia estática contra RCE: server.py hoy no tiene ningún sink peligroso
(eval/exec/pickle/yaml.load inseguro/subprocess con input del usuario). Este
test no "encuentra" una vulnerabilidad -- la PRESERVA: si alguien agrega uno
de estos patrones en el futuro, falla acá antes de llegar a producción, en vez
de descubrirse en un pentest.

No es un linter genérico: cada patrón bloqueado es uno que, combinado con
input de un endpoint HTTP, se convierte directamente en ejecución de código.
"""
import re
from pathlib import Path

SERVER_PY = Path(__file__).resolve().parent.parent / "server.py"

FORBIDDEN_PATTERNS = {
    r"\beval\s*\(": "eval() -- ejecuta cualquier string como código Python",
    r"\bexec\s*\(": "exec() -- ejecuta cualquier string como código Python",
    r"\bos\.system\s*\(": "os.system() -- ejecuta el string en el shell",
    r"\bos\.popen\s*\(": "os.popen() -- ejecuta el string en el shell",
    r"\bpickle\.loads?\s*\(": "pickle.load(s) -- deserializar pickle no confiable = RCE",
    r"\byaml\.load\s*\((?!.*Loader\s*=\s*yaml\.SafeLoader)": "yaml.load() sin SafeLoader",
    r"__import__\s*\(": "__import__() dinámico con input externo",
    r"(?<!re\.)\bcompile\s*\(": "compile() builtin -- compila código arbitrario (re.compile no cuenta)",
    r"shell\s*=\s*True": "subprocess con shell=True -- expone al shell del OS",
}

def _read_server_source() -> str:
    return SERVER_PY.read_text(encoding="utf-8")


def test_server_py_exists():
    assert SERVER_PY.is_file(), f"No se encontró {SERVER_PY}"


def test_no_forbidden_sinks_in_server():
    source = _read_server_source()
    violations = []
    for pattern, reason in FORBIDDEN_PATTERNS.items():
        for m in re.finditer(pattern, source):
            line_no = source.count("\n", 0, m.start()) + 1
            line_text = source.splitlines()[line_no - 1].strip()
            violations.append(f"línea {line_no}: {line_text}  <-- {reason}")
    assert not violations, (
        "Se encontraron sinks peligrosos nuevos en server.py:\n" + "\n".join(violations)
    )


def test_subprocess_popen_calls_use_hardcoded_argv():
    """Si aparece un subprocess.Popen/run/call NUEVO, confirmar a mano que su
    argv es una lista literal fija (no construida con str del request) antes
    de agregarlo a _ALLOWED_SUBPROCESS_LINES. Este test solo cuenta cuántos hay
    -- si el número cambia, hay que revisar el nuevo a mano."""
    source = _read_server_source()
    calls = re.findall(r"\b\w*subprocess\.(?:Popen|run|call|check_call|check_output)\s*\(", source)
    assert len(calls) == 1, (
        f"Se esperaba exactamente 1 llamada a subprocess (el lanzador fijo del "
        f"analytics-service), se encontraron {len(calls)}. Si agregaste una nueva, "
        f"confirmá a mano que su argv no incorpora ningún dato del request antes "
        f"de subir este número."
    )
