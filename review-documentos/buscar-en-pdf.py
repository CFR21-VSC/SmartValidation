"""Busca texto dentro de un PDF generado por pdfMake, descomprimiendo sus streams.

    python review-documentos/buscar-en-pdf.py <archivo.pdf> <texto> [texto...]

Sirve para verificar si una seccion llego realmente al PDF, sin depender de
abrirlo a mano. No modifica nada.
"""
import re
import sys
import zlib

LITERAL = re.compile(rb"\(((?:[^()\\]|\\.)*)\)")


def paginas_con_texto(path):
    data = open(path, 'rb').read()
    paginas = []
    for m in re.finditer(rb'stream\r?\n', data):
        ini = m.end()
        fin = data.find(b'endstream', ini)
        if fin < 0:
            continue
        try:
            raw = zlib.decompress(data[ini:fin])
        except Exception:
            continue
        trozos = [g.group(1) for g in LITERAL.finditer(raw)]
        if not trozos:
            continue
        s = b''.join(trozos).decode('latin1')
        s = s.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
        if len(s) > 30:
            paginas.append(s)
    return paginas


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    path = sys.argv[1]
    claves = sys.argv[2:]
    paginas = paginas_con_texto(path)
    print('%s -> %d streams de texto' % (path, len(paginas)))
    encontrados = {}
    for i, t in enumerate(paginas, 1):
        plano = t.replace(' ', '')
        for c in claves:
            if c.replace(' ', '') in plano:
                encontrados.setdefault(c, []).append(i)
    print()
    for c in claves:
        d = encontrados.get(c)
        print('  %-28s %s' % (c, ('streams ' + ', '.join(map(str, d))) if d else 'NO APARECE'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
