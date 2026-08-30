# Suite Revisión y Firmas — Plan de Testing

> Documento vivo, en paralelo a la implementación. Cada fase de desarrollo incremental agrega su
> propia sección con casos cubiertos y el resultado de la última corrida.

## Estrategia

- Tests unitarios con `pytest` + `fastapi.testclient.TestClient`, por fase de desarrollo.
- Cada test corre contra un SQLite temporal propio (`tests/conftest.py`), nunca contra
  `./data/revision_firmas.db` — cero riesgo de contaminar datos reales.
- La DB se vacía y se re-siembra el superadmin antes de cada test (`clean_db` autouse) — tests
  independientes entre sí, sin orden implícito.
- Antes de dar una fase por cerrada: todos los tests de esa fase y de las anteriores deben pasar.
- Comando: `cd suite-revision-firmas && .venv/Scripts/python.exe -m pytest`

## Fase 1 — Capa 1 (Login) + Capa 2 (Roles y permisos)

**Alcance cubierto:**
- Login con usuario/contraseña, sesión vía cookie firmada (`rf_session`), logout con revocación.
- Bootstrap del superadmin DRP desde variables de entorno.
- Alta de usuario + invitación por email (Resend, no-op en tests sin API key) — solo DRP.
- Aceptación de invitación: setea password + PIN de firma en un solo paso, token de un solo uso,
  expiración respetada.
- Rechazo de rol inválido, email duplicado, PIN corto.
- Autorización: endpoints de `/users/*` exigen rol DRP (401 sin sesión, 403 con sesión de rol
  cliente).
- Habilitación granular de documentos: otorgar / listar / revocar acceso a un `project_id` +
  `doc_type` puntual por usuario. Idempotencia (otorgar dos veces no duplica).

**Casos NO cubiertos todavía (fuera de alcance de esta fase):**
- Verificación de PIN al momento de firmar (no existe firma todavía).
- Expiración real de invitación por tiempo (se verifica la condición en código; no hay test que
  fuerce un reloj simulado — pendiente si se juzga necesario).
- Envío real de email vía Resend (se prueba el flujo sin API key; falta un test de humo contra
  Resend en un entorno con key real, fuera del alcance de tests automatizados).

**Última corrida:** 2026-08-29 — `17 passed, 1 warning in 18.33s` (warning cosmético de
`starlette.testclient` sobre `httpx2`, no bloqueante).

| Archivo | Casos | Resultado |
|---|---|---|
| `tests/test_auth.py` | 9 | ✅ 9/9 |
| `tests/test_users.py` | 8 | ✅ 8/8 |

## Fase 2 — Revisión de documentos (implementada)

**Alcance cubierto:**
- Carga (y recarga) del JSON fuente por DRP — panel izquierdo, inmutable en revisión.
- Correcciones autoguardadas por sección (panel derecho), `UPSERT` por `(document_id,
  section_key)` — no duplican, no pisan el JSON fuente.
- Control de acceso granular: DRP ve/edita todo; cliente solo lee/corrige documentos con grant
  explícito para ese `project_id` + `doc_type`.
- Listado de documentos por proyecto, filtrado por rol.

**Bug encontrado y corregido durante esta fase (no en la app, en el harness de tests):**
`tests/test_documents.py` reusaba el mismo `TestClient` (misma cookie jar) para simular al DRP y
al cliente invitado — loguear al cliente pisaba la cookie de sesión de DRP en el mismo objeto,
haciendo que llamadas posteriores "como DRP" en realidad corrieran autenticadas como cliente.
Fix: el fixture `cliente_client` ahora crea su propio `TestClient` independiente.

**Casos NO cubiertos todavía:** botón "Ver PDF" (requiere el motor de render vendorizado,
frontend — fase aparte), gating de correcciones cuando el documento está sellado en combinación
con firma (se prueba en Fase 3, junto con `resolved`).

**Última corrida:** 2026-08-29 — `30 passed, 1 warning in 27.98s`.

| Archivo | Casos | Resultado |
|---|---|---|
| `tests/test_documents.py` | 13 | ✅ 13/13 |

## Fase 3 — Firma (revisión + aprobación) (pendiente)

## Fase 3 — Firma (revisión + aprobación) + Audit Trail (implementada)

**Alcance cubierto:**
- Firma de Revisión: sin orden, requiere PIN, bloqueada si el documento tiene correcciones con
  `resolved=0`; DRP puede marcar una corrección `resolved` para destrabar. Rechaza firma
  duplicada y PIN incorrecto.
- Autoservicio de PIN (`POST /auth/set-pin`) — cubre el caso del superadmin bootstrapeado, que no
  pasa por el flujo de invitación y por lo tanto no tenía forma de fijar su PIN (gap real de la
  Fase 1, corregido acá).
- Firma de Aprobación: ronda creada por DRP con firmantes ordenados; **regla nueva agregada
  durante la implementación**: todo firmante de la ronda debe ya tener un grant de acceso al
  documento (ser firmante no es una puerta trasera para saltarse la habilitación de Capa 2). El
  último `sign_order` debe ser un usuario `is_superadmin`. Firma fuera de turno rechazada
  (409). Solo una ronda abierta por documento a la vez.
- Sellado: la firma del último firmante (DRP/superadmin) exige adjuntar el PDF final
  (`pdf_base64`) — si falta, se rechaza *antes* de grabar nada (ver bug corregido abajo). Al
  sellar: `rf_documents.locked=1`, hash SHA-256 del JSON (siempre) y del PDF (del blob
  adjuntado), ronda pasa a `sealed`. Documento sellado rechaza nuevas cargas (`PUT`) y nuevas
  correcciones (409 en ambos casos).
- Notificación por email (Resend) en cada firma y en el sellado — mismo helper de Fase 1, no
  bloqueante si no hay `RESEND_API_KEY`.
- Libro de Validación, sección People (`GET .../people-book`, DRP-only): devuelve el trail
  completo ordenado por fecha — carga de documento, correcciones guardadas/resueltas, firmas.
  Sin interfaz visual todavía (según diseño), pero la capa de datos y su API ya están completas
  y probadas.

**Bugs encontrados y corregidos durante esta fase:**
1. **Orden de validación en el sellado**: la firma del último firmante escribía `signed_at` en la
   base ANTES de validar que viniera el PDF adjunto — si faltaba, el firmante quedaba marcado
   "ya firmó" sin que el documento se sellara, y no podía reintentar (bloqueo permanente sin
   intervención manual). Corregido: se valida `pdf_base64` antes de escribir cualquier cambio.
2. **Regla de negocio faltante**: nada impedía crear una ronda de aprobación con firmantes que
   nunca habían recibido acceso al documento. Se agregó la validación (ver arriba) — hallada
   escribiendo el primer test de flujo completo, no reportada por el usuario.

**Última corrida:** 2026-08-29 — `44 passed, 1 warning in 52.52s`.

| Archivo | Casos | Resultado |
|---|---|---|
| `tests/test_auth.py` (incluye `set-pin`) | 12 | ✅ 12/12 |
| `tests/test_signatures.py` | 12 | ✅ 12/12 |

## Fase 4 — Frontend (implementada)

**Alcance cubierto:**
- Motor de render vendorizado tal cual (pdfMake + vfs_fonts + template-base/shared-renderers/
  document-renderer/book-builder + los 22 templates por tipo de documento que ya usaba el
  `/firmas/` viejo) en `static/lib/` y `static/js/validation-suite/`.
- Fundación compartida: `static/css/base.css` (tema navy/gold) y `static/js/api.js` (fetch
  wrapper con cookie de sesión, `requireSession()` con redirect a login o a pin-setup según
  corresponda).
- 7 páginas: `login.html`, `pin-setup.html`, `invite.html`, `dashboard.html`, `users.html`,
  `review.html` (vista de 3 columnas + correcciones + Ver PDF + firma de revisión), `approval.html`
  (ronda de aprobación + firma en orden + sellado).
- Construidas en paralelo por 4 agentes (uno para auth, uno para dashboard/usuarios, uno para
  revisión, uno para aprobación), cada uno con el mismo contrato de API/CSS/JS por escrito para
  evitar inconsistencias entre páginas.

**Verificación hecha (no son tests automatizados de UI todavía — ver "pendiente" abajo):**
1. `node --check` sobre cada bloque `<script>` de las 7 páginas + `api.js` — sin errores de sintaxis.
2. Servidor real levantado localmente (`uvicorn`, SQLite temporal) — las 7 páginas y todos los
   assets vendorizados (`lib/pdfmake.min.js`, `lib/vfs_fonts.js`, los 22 templates, etc.)
   responden 200 bajo `/app/...`.
3. **Flujo de negocio completo ejecutado contra el servidor real vía API** (no solo tests con DB
   en memoria): login DRP → set-pin → crear cliente invitado → aceptar invitación → otorgar
   acceso a un documento puntual → DRP carga JSON → cliente guarda corrección → firma de revisión
   bloqueada por corrección sin resolver (409) → DRP resuelve → firma de revisión ok → ronda de
   aprobación → firma fuera de orden rechazada → firmante 1 firma → DRP firma último con PDF →
   sella → hashes de PDF y JSON grabados → recarga del documento rechazada (409, inmutable) →
   Libro de Validación sección People muestra el trail completo de 8 eventos en orden correcto.
4. Rutas de API llamadas desde `review.html` y `approval.html` verificadas por inspección línea a
   línea contra las rutas reales del backend — coinciden exactamente.

**Bug real encontrado y corregido durante la verificación (no en el código de los agentes, en el
mío):** el `invite_link` devuelto por `POST /users` y enviado por email apuntaba a
`{APP_BASE_URL}/invite/{token}` — el endpoint JSON crudo de la API, no a la página
`/app/invite.html?token={token}`. Un usuario invitado que clickeara el link real de un email
habría recibido un JSON en blanco en vez del formulario de activación. Corregido en
`app/routers/users.py`; los tests que parseaban la forma vieja de la URL (`rsplit("/",1)`) se
actualizaron para leer el query param `token`.

**Bug de exposición encontrado post-verificación (2026-08-29):** `review.html` mostraba JSON
crudo (`<pre>JSON.stringify(...)</pre>`) en el panel de documento fuente cuando la estructura no
tenía `secciones`/`sections` — visible para cualquiera con acceso, incluido cliente. El modo
"Técnico" es exclusivo de la Suite de Validación por regla de diseño (sección 4). Corregido:
reemplazado por un renderer genérico (tabla/lista) que nunca emite sintaxis JSON.

**Ronda de QA end-to-end #2 (2026-08-29, Claude en Chrome) — bugs reales encontrados y corregidos:**
1. **Bloqueo crítico**: no había forma de crear el primer proyecto/documento desde la UI — el
   formulario de carga solo aparecía con un proyecto ya seleccionado, y no existía un "crear
   proyecto". Agregado botón "+ Nuevo" en la sidebar del dashboard.
2. **Exposición de JSON crudo, dos focos más** (además del ya corregido en la ronda #1): la tabla
   de metadata y `getSectionContentText` caían a `JSON.stringify(...)` cuando un valor no era
   texto plano — visible para cliente. Ambos reemplazados por `renderPlainObject`.
3. **Estado "resuelta" no llegaba al cliente**: `GET .../documents/{doc_type}` no incluía la
   columna `resolved` en las correcciones (sí la incluía el endpoint separado `/corrections`, que
   la UI no usa). El cliente veía "Pendiente" aunque DRP ya la había marcado resuelta — pudo
   firmar igual porque el backend sí lo tenía correcto, pero la UI mentía. Corregido agregando la
   columna al SELECT.
4. **`last_login` quedaba `null`** después de activar una invitación (el auto-login del accept no
   lo registraba, solo el login por formulario). Corregido: activar cuenta cuenta como primer
   acceso.
5. Un test propio (`test_invite_accept_full_flow`) tenía el mismo bug de cookie compartida ya
   visto en la ronda #1 (reusaba `client`/`drp_client` como si fuera un tercer usuario anónimo) —
   corregido con un `TestClient` independiente.

**Circuito de firma/aprobación/sellado verificado de punta a punta manualmente** (revisión con dos
firmantes → ronda de aprobación con orden → sellado con PDF adjunto → inmutabilidad confirmada
con un PUT directo devolviendo 409). Validación de PIN contra el backend confirmada (rechazó un
PIN incorrecto).

**Pendiente (no cubierto en esta fase):**
- Tests de UI automatizados (Playwright u otro) que efectivamente carguen las páginas en un
  navegador y validen el DOM/flujos de click — la verificación de esta fase fue: sintaxis JS +
  smoke test de red + flujo de negocio por API cruda, no interacción real de navegador.
- Botón de generación del Libro 1/Tomo I (sección 7 del diseño) usando `book-builder.js` — está
  vendorizado pero ninguna página lo invoca todavía.
- Notificaciones por email no verificadas contra una cuenta Resend real (siguen siendo no-op sin
  `RESEND_API_KEY`, como en fases anteriores).

**Última corrida del backend (sin cambios de lógica, solo el fix de invite_link):** 2026-08-29 —
`46 passed, 1 warning in 51.27s`.

## Fase 5 — Proyectos (ciclo de vida) + dos audit trails + Libro 1 (implementada)

**Alcance cubierto:**
- `rf_projects`: un proyecto sigue naciendo implícito al cargar su primer documento (no hay
  "crear proyecto" separado), pero ahora tiene estado propio: `active` | `closed` | `archived`.
- Ciclo de vida (DRP-only): `PATCH .../close`, `PATCH .../archive`, `PATCH .../reopen`,
  `DELETE /projects/{id}` (bloqueado 409 si algún documento del proyecto está sellado).
- `DELETE /projects/{id}/documents/{doc_type}` — borra un documento puntual (bloqueado si está
  sellado). El evento va al audit trail de sistema, **no** al People Book.
- Proyecto cerrado o archivado bloquea (409) cargar, corregir, firmar revisión, crear ronda de
  aprobación y firmar aprobación — congela toda actividad hasta reabrir.
- **Dos audit trails separados, confirmado por el usuario:**
  - `rf_people_book_events` (ya existía, sección 6) — solo eventos GxP del documento, es el que
    se integra al Libro de Validación.
  - `rf_system_audit_log` (nuevo) — acciones administrativas: alta de usuarios, grants
    otorgados/revocados, ciclo de vida de proyectos/documentos. `GET .../audit-log` (DRP-only).
    Verificado que `document_deleted` NO aparece en el People Book del documento borrado (solo en
    el de sistema) — la separación se sostiene incluso cuando ambos podrían solaparse.
- `GET /projects/{id}/book-package` — arma el paquete para `book-builder.js`: solo documentos
  **sellados**, inyectando en cada uno una sección `tipo: 'tabla-firmas-final'` con las firmas
  reales (revisión + aprobación combinadas, `nombre`/`rol`/`iniciales`/`fecha`), sin persistir esa
  inyección en `rf_documents.json_data` (el panel izquierdo sigue siendo el JSON fuente puro).
  Devuelve `skipped_not_sealed` con los tipos excluidos por no estar sellados.
- Frontend (`dashboard.html`): botones Cerrar/Archivar/Reabrir/Eliminar por proyecto (con modal de
  confirmación genérica), Eliminar por documento, toggle "Mostrar archivados", modal de auditoría
  de sistema, y "📖 Generar Libro 1" (reusa el mismo motor vendorizado que Ver PDF, vía
  `VS.bookBuilder.generate(docs, {tomo:1})`).

**Optimización de infraestructura de tests:** las 600.000 iteraciones PBKDF2 de producción hacían
que la suite completa (con los nuevos tests de firma) tardara ~8 minutos. Se agregó
`RF_PBKDF2_ITERS` (config), default 600k en producción, 1000 en tests — la fuerza del hash no es
lo que se está probando ahí. Suite completa: de minutos a 9 segundos.

**Verificado con servidor real:** flujo completo (cargar 2 docs → firmar → sellar HLRA →
book-package con 4 firmas agregadas correctamente y URS excluido → intento de eliminar proyecto
rechazado por sellado → eliminar URS sin sellar OK → cerrar proyecto → carga posterior rechazada
→ archivar otro proyecto → listado por default lo oculta, `include_archived=true` lo muestra →
audit trail de sistema con los 3 eventos en orden correcto).

**Última corrida:** 2026-08-30 — `66 passed, 1 warning in 9.45s`.

| Archivo | Casos | Resultado |
|---|---|---|
| `tests/test_projects.py` | 19 | ✅ 19/19 |

**Pendiente / fuera de alcance de esta fase:**
- Hash criptográfico por firma individual (`_signatureHashRef` que espera book-builder.js para el
  KPI "Con hash 21 CFR") — no implementado, el libro se genera igual pero ese KPI queda en 0.
- Tests de UI en navegador de los nuevos botones (mismo criterio que fases anteriores).
- Renombrar un proyecto — no existe, `project_id` es una clave estable usada en grants/documentos.
