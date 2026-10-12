"""
Pruebas de estrés/concurrencia contra server.py real (vía el fixture
live_server). server.py es un ThreadingHTTPServer con SQLite en modo WAL +
timeout de conexión de 30s (ver db_adapter.py) Y un cap duro de hilos
concurrentes (_BoundedServer, _MAX_THREADS=32, ver server.py ~línea 4713).

Pregunta que importa: ¿bajo carga concurrente NORMAL (por debajo del cap de
32 hilos de _BoundedServer) hay errores, pérdida o corrupción de datos? --
no debería haber ninguno, y estos tests lo confirman.

Nota aparte (no cubierta por un test, confirmada leyendo el código): al
superar el cap de 32 hilos, server.py hoy cierra la conexión en silencio
(sin 503, sin respuesta) en vez de encolar o avisar que está ocupado -- ver
_BoundedServer.process_request en server.py ~línea 4713-4726. Forzar esa
condición de forma confiable necesitaría un endpoint artificial que tarde
(no existe uno real), así que se documenta por lectura de código y no por
un test de timing que sería frágil.
"""
import base64
import concurrent.futures
import socket
import statistics
import time
from urllib.parse import urlparse

import requests

TINY_PNG_B64 = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108"
    "0600000031b215370000000a4944415478da6364000000020001"
    "e221bc330000000049454e44ae426082"
)).decode()
TINY_PNG = f"data:image/png;base64,{TINY_PNG_B64}"

# Por debajo de _MAX_THREADS (32) con margen cómodo -- estos tests miden
# comportamiento bajo carga real, no el límite exacto del cap.
SAFE_CONCURRENCY = 15


def _timed(fn, *args, **kwargs):
    t0 = time.monotonic()
    result = fn(*args, **kwargs)
    return result, time.monotonic() - t0


def _report(label, elapsed_list, n_errors, total_wall):
    print(
        f"\n[{label}] n={len(elapsed_list)} errores={n_errors} "
        f"total={total_wall:.2f}s avg={statistics.mean(elapsed_list)*1000:.0f}ms "
        f"p95={sorted(elapsed_list)[int(len(elapsed_list)*0.95)]*1000:.0f}ms "
        f"max={max(elapsed_list)*1000:.0f}ms"
    )


def test_concurrent_health_checks_never_fail(live_server):
    N = 60
    t_wall0 = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=SAFE_CONCURRENCY) as pool:
        futures = [pool.submit(_timed, requests.get, f"{live_server}/health", timeout=10) for _ in range(N)]
        results = [f.result() for f in futures]
    wall = time.monotonic() - t_wall0

    statuses = [r.status_code for r, _ in results]
    elapsed = [t for _, t in results]
    errors = sum(1 for s in statuses if s != 200)
    _report(f"health x{N} (concurrencia {SAFE_CONCURRENCY})", elapsed, errors, wall)
    assert errors == 0, f"{errors}/{N} requests de /health fallaron bajo concurrencia normal"


def test_concurrent_evidence_uploads_different_images(live_server):
    """N subidas concurrentes de evidencias DISTINTAS al mismo proyecto --
    debe entrar cada una sin pisarse ni perderse ninguna."""
    N = 40
    # _proj_id_from_compound asume exactamente 3 partes separadas por "_"
    # ("proj", dígitos, 6 chars) para reconstruir el project_id desde el
    # compound_id -- un id de prueba con más partes rompe esa extracción
    # (no es un bug del server, es la convención real de ids de proyecto).
    proj_id = "proj_9001001_strjs1"
    ids = [f"{proj_id}_test_stress_evidence_{i}" for i in range(N)]

    def upload(local_id):
        return requests.post(
            f"{live_server}/api/evidence/{local_id}",
            json={"data": TINY_PNG},
            timeout=15,
        )

    t_wall0 = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=SAFE_CONCURRENCY) as pool:
        futures = [pool.submit(_timed, upload, cid) for cid in ids]
        results = [f.result() for f in futures]
    wall = time.monotonic() - t_wall0

    statuses = [r.status_code for r, _ in results]
    elapsed = [t for _, t in results]
    errors = sum(1 for s in statuses if s != 200)
    _report(f"{N} uploads (concurrencia {SAFE_CONCURRENCY}, imágenes distintas)", elapsed, errors, wall)
    assert errors == 0, f"{errors}/{N} uploads concurrentes fallaron"

    # Verificar que las N imágenes realmente quedaron, ninguna se perdió. OJO:
    # /api/evidence/{id} (la ruta real que usa el cliente -- storage-server.js)
    # guarda en FILESYSTEM cuando R2 no está configurado (como en este test,
    # dev sin credenciales), NO en la tabla SQL evidence_images -- esa tabla
    # la llena la ruta /api/projects/{id}/evidence[/{cid}], un camino
    # DISTINTO que en este entorno queda vacío. Por eso la verificación es
    # por GET individual (mismo camino que el guardado), no por el bulk SQL.
    for local_id in ids:
        r = requests.get(f"{live_server}/api/evidence/{local_id}", timeout=10)
        assert r.status_code == 200, f"{local_id} no se pudo leer después de subirla"


def test_concurrent_writes_to_same_compound_id_no_corruption(live_server):
    """N escrituras concurrentes a LA MISMA clave -- no debe haber excepción
    ni datos corruptos (mezcla de dos payloads distintos); al final tiene que
    haber quedado EXACTAMENTE uno de los valores enviados, completo."""
    N = 15
    proj_id = "proj_9001002_strjs2"
    local_id = f"{proj_id}_test_stress_shared_evidence"

    # Un data-URI distinguible por índice -- el servidor no valida que el
    # base64 sea un PNG real, solo que decodifique, así que basta con bytes
    # cualquiera (no podemos "marcar" TINY_PNG agregándole texto: rompería el
    # decode de base64 y el request fallaría con 400 por una razón ajena a lo
    # que este test quiere probar).
    payloads = [
        "data:image/png;base64," + base64.b64encode(f"marker-{i}".encode()).decode()
        for i in range(N)
    ]

    def upload(data_uri):
        return requests.post(
            f"{live_server}/api/evidence/{local_id}",
            json={"data": data_uri},
            timeout=15,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=SAFE_CONCURRENCY) as pool:
        futures = [pool.submit(upload, p) for p in payloads]
        statuses = [f.result().status_code for f in futures]

    errors = sum(1 for s in statuses if s != 200)
    assert errors == 0, f"{errors}/{N} escrituras concurrentes a la misma clave fallaron"

    r = requests.get(f"{live_server}/api/evidence/{local_id}", timeout=10)
    assert r.status_code == 200
    final_data = r.json()["data"]
    assert final_data in payloads, (
        "el dato final no coincide con NINGÚN payload enviado -- posible corrupción "
        "por interleaving de escrituras concurrentes"
    )


def test_server_survives_sustained_mixed_burst(live_server):
    """Ráfaga mixta (lecturas + escrituras) sostenida, por debajo del cap --
    el proceso tiene que seguir vivo y respondiendo al final, no solo
    durante la ráfaga."""
    n_requests = 45
    proj_id = "proj_9001003_strjs3"

    def mixed_request(i):
        if i % 3 == 0:
            local_id = f"{proj_id}_test_burst_evidence_{i}"
            return requests.post(
                f"{live_server}/api/evidence/{local_id}",
                json={"data": TINY_PNG}, timeout=15,
            )
        return requests.get(f"{live_server}/health", timeout=10)

    with concurrent.futures.ThreadPoolExecutor(max_workers=SAFE_CONCURRENCY) as pool:
        futures = [pool.submit(mixed_request, i) for i in range(n_requests)]
        statuses = [f.result().status_code for f in futures]

    errors = sum(1 for s in statuses if s not in (200,))
    assert errors == 0, f"{errors}/{n_requests} requests de la ráfaga mixta fallaron"

    # El servidor sigue en pie después de la ráfaga.
    r = requests.get(f"{live_server}/health", timeout=10)
    assert r.status_code == 200


def test_large_burst_survives_whether_or_not_cap_triggers(live_server):
    """server.py cappea a 32 hilos concurrentes (_BoundedServer, ver
    server.py ~línea 4713) y -- confirmado LEYENDO el código, no por este
    test -- al superarlo cierra la conexión en silencio (sin 503) en vez de
    encolar o avisar que está ocupado.

    Este test NO intenta forzar ese límite de forma confiable: /health
    resuelve tan rápido (una sola 'SELECT 1') que el permiso del semáforo se
    libera casi apenas se toma, incluso abriendo 70 sockets crudos antes de
    leer ninguna respuesta -- para ejercitar el cap de verdad haría falta un
    endpoint que tarde (no existe ninguno así, y agregar uno solo para el
    test sería probar un camino que no es el real). Lo que SÍ se puede
    afirmar sin inventar nada: la ráfaga, dispare o no el cap, nunca deja al
    servidor en un estado ambiguo -- cada conexión termina en 200 limpio o
    cortada limpia, nunca una respuesta corrupta, y el servidor sigue
    sirviendo después."""
    n_requests = 70  # bien por encima de _MAX_THREADS=32
    parsed = urlparse(live_server)
    host, port = parsed.hostname, parsed.port
    request_bytes = (
        f"GET /health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    ).encode()

    socks = []
    for _ in range(n_requests):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(8)
        try:
            s.connect((host, port))
            s.sendall(request_bytes)
            socks.append(s)
        except OSError:
            socks.append(None)  # ni se pudo conectar -- cuenta como "dropped"

    results = []
    for s in socks:
        if s is None:
            results.append("dropped")
            continue
        try:
            data = s.recv(4096)
            results.append(200 if b" 200 " in data.split(b"\r\n", 1)[0] else "error")
        except OSError:
            results.append("dropped")
        finally:
            s.close()

    ok = results.count(200)
    dropped = sum(1 for r in results if r != 200)
    print(f"\n[cap de hilos] {n_requests} simultáneos (sockets crudos) -> {ok} OK, {dropped} descartados/erróneos")

    # Lo que SÍ nos importa: ninguno queda en un estado ambiguo -- o
    # responde 200 limpio, o se cae limpiamente (nunca una respuesta corrupta).
    # No afirmamos nada sobre CUÁNTOS caen -- eso depende de timing que este
    # test no controla (ver docstring).
    assert all(r in (200, "dropped") for r in results)

    # El servidor tiene que seguir sirviendo bien DESPUÉS de la ráfaga.
    time.sleep(1)
    r = requests.get(f"{live_server}/health", timeout=10)
    assert r.status_code == 200
