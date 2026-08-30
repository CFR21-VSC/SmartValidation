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

**Ronda de QA real #3 (2026-08-30, Claude en Chrome) — bugs encontrados y corregidos:**
1. **[Media] `DELETE /projects/{id}` devolvía 404 en vez de 409 para proyectos "legacy".**
   Proyectos con documentos cargados ANTES de que existiera `rf_projects` (esta misma fase) no
   tenían fila propia — `_get_project_or_404` fallaba con 404 genuino antes de llegar siquiera a
   evaluar el bloqueo por sellado. El control negativo de QA "protegía" el dato (no borraba
   nada), pero con el código/mensaje equivocado — inaceptable para una herramienta GxP, donde el
   motivo del rechazo tiene que ser explícito. Corregido con self-healing: si el proyecto tiene
   documentos pero no fila, se la crea ahí mismo como `active` antes de continuar.
2. **[Baja] El panel de detalle no se refrescaba al archivar.** `loadProjects()` pedía la lista
   ya filtrada por el estado del checkbox "Mostrar archivados" — un proyecto recién archivado
   desaparecía del array antes de poder leer su nuevo estado, y el panel seguía mostrando
   "activo". Corregido: la lista completa (con archivados) siempre se trae del servidor: el
   filtro del checkbox ahora es puramente de render en la sidebar.
3. **[Baja] El botón "Eliminar documento" seguía visible en proyectos cerrados/archivados**
   (de solo lectura). Ya se ocultaba correctamente para documentos sellados; ahora también se
   oculta si el proyecto no está `active`.

Todo verificado con un test que reproduce el escenario exacto reportado (documento cargado,
fila `rf_projects` borrada a mano para simular el estado legacy, `DELETE` devuelve 409 con el
tipo de documento sellado en el mensaje).

**Feedback directo del usuario (2026-08-30) — dos pedidos más, ambos implementados:**
1. **Logs de auditoría intrazables**: `grant_created`/`grant_revoked` mostraban el `user_id` (un
   UUID) en vez del nombre de la persona — "es imposible de trazar así". Corregido: ambos
   endpoints ahora buscan `display_name`/`email` del usuario destino antes de armar el mensaje.
2. **No había forma de ver el audit trail sin estar dentro de un proyecto** ("el audit trail
   general del sistema no lo logro ver si no estoy dentro de un proyecto"). Se agregó
   `GET /audit-log` (sin prefijo de proyecto, DRP-only) — trae los últimos 500 eventos de
   **todos** los proyectos a la vez, con columna de proyecto visible. Botón "🛡 Auditoría del
   sistema" en el topbar del dashboard, siempre disponible para DRP.
3. **Otorgar acceso pedía escribir `project_id`/`doc_type` a mano** ("sería bueno poder asignar
   desplegando los documentos y proyectos, ya que si es sujeto a mi memoria, estoy complicado").
   La modal de accesos en `users.html` ahora tiene dos `<select>` en cascada: elegís el proyecto
   de una lista real, y el segundo select se llena con los documentos de ese proyecto (marcando
   los sellados).

**Última corrida:** 2026-08-30 — `71 passed, 1 warning in 11.77s`.

**Feedback directo del usuario (2026-08-30), ronda 2:**
1. **Username asignable al crear usuario.** Antes se autogeneraba
   (`email.split('@')[0] + '-' + uuid[:6]`), sin control de DRP. Ahora `POST /users` exige
   `username` explícito (3-40 caracteres: letras, números, `.`/`-`/`_`), validado por unicidad
   igual que el email. Campo agregado al formulario de `users.html`, y columna "Usuario" en la
   tabla. **Rompe compatibilidad**: todos los call sites de test que creaban usuarios necesitaron
   agregar el campo (11 sitios en 5 archivos).
2. **"Puedo seguir firmando después de haber firmado."** El backend en realidad SIEMPRE lo
   bloqueó (409, tanto en revisión como en aprobación — constraints `UNIQUE` de por medio) — el
   problema era puramente de UI: no había manera de saber "¿ya firmé yo?" así que el botón
   seguía habilitado y el usuario podía reintentar (y fallar) sin entender por qué. Corregido:
   - `GET /auth/session` ahora expone `username` (no lo hacía).
   - `review.html`: compara la lista de firmantes contra `session.username`; si ya firmé, el
     botón se deshabilita y cambia a "✓ Ya firmaste la revisión".
   - `approval.html`: mismo criterio — si ya firmé esta ronda, se reemplaza el botón "Firmar"
     por un mensaje "✓ Ya firmaste esta ronda".
   - Agregado test explícito `test_approval_sign_twice_rejected` (ya existía el de revisión) para
     dejar constancia de que el backend siempre lo rechazó — el bug era 100% de UI.

**Última corrida:** 2026-08-30 — `74 passed, 1 warning in 11.26s`.

**Feedback directo del usuario (2026-08-30), ronda 3 — consistencia de la tabla de firmas del
documento (no la del panel de la app, la que trae cada documento como parte de su propio
template, al final):**

Cada documento (HLRA, VP, etc.) trae de fábrica una sección `tabla-firmas-final` en su propio
JSON — es la que ya usa el Libro compilado para armar el "Registro Maestro de Firmas". El
problema: "Ver PDF" de un documento suelto (en `review.html` y en la vista previa de
`approval.html`) renderizaba el JSON fuente crudo, así que esa misma tabla salía vacía o con lo
que trajera el JSON original — inconsistente con lo que después muestra el Libro.

**Implementado:**
- `GET /projects/{p}/documents/{d}/signed-render` (nuevo, cualquiera con acceso al documento) —
  devuelve el JSON del documento con `tabla-firmas-final` rellena con las firmas reales
  (revisión + aprobación), inyectada al vuelo, sin persistirla.
- `include_pending=true` — resuelve un detalle fino que señaló el usuario: la firma que sella
  (la última, la de DRP) todavía no está grabada en el momento de generar el PDF que se va a
  adjuntar al sellado. Si el usuario logueado es firmante de una ronda abierta y no firmó
  todavía, se agrega igual con la fecha de hoy — así el documento que queda hasheado para
  siempre en el sellado muestra el circuito completo, no le falta la firma que lo cierra.
- `review.html` ("Ver PDF") y `approval.html` (vista previa usada para "Usar este PDF para
  sellar") ahora usan este endpoint en vez del JSON fuente crudo.
- Lógica de recolección de firmas extraída de `book.py` a funciones reusables
  (`collect_signatures`, `inject_signatures_section`) — una sola fuente de verdad para el Libro
  y para el render de un documento suelto.

Verificado con servidor real: antes de firmar, `firmas: []`; después de la firma de revisión del
cliente, aparece con rol/nombre/iniciales/fecha correctos, sin tocar el JSON fuente guardado.

**Última corrida:** 2026-08-30 — `80 passed, 1 warning in 12.06s`.

**Feedback directo del usuario (2026-08-30), ronda 4 — de dónde sale el rol del firmante:**
Pregunta real: si el cliente entra con rol de sistema "cliente", ¿cómo sabe el sistema si en el
documento es Redactor/Ejecutor/Revisor/Aprobador? Respuesta honesta antes de este fix: **no lo
sabía** — en revisión no se capturaba ningún rol, y en aprobación DRP lo tipeaba a mano cada vez,
sin relación con el documento. Esto no coincidía con la sección 3 del diseño ("se toman de la
Matriz de Aprobaciones"), que nunca se había implementado.

**Implementado (opción elegida por el usuario: sugerir desde la matriz, con confirmación
manual, nunca automático sin ver):**
- La "Matriz de Aprobaciones" resultó ser la misma sección `tabla-firmas-final` que ya usa el
  motor (`shared-renderers.js` → `renderTablaFirmasFinalSmart`) — antes de firmar trae los roles
  esperados con nombres ya cargados desde la Suite de Validación (`firmas`), o una lista de roles
  sin nombre si el documento es nuevo (`rolesPlaceholder`).
- `getApprovalMatrix()` + `suggestRoleForName()` (duplicadas en `review.html` y `approval.html`
  — son puramente de presentación, no justificaba un módulo compartido nuevo): matchean por
  nombre completo (exacto o por palabras) contra la matriz del documento.
- **Revisión**: el modal de firma ahora pide "Tu rol en este documento", pre-completado por
  matching contra `session.display_name`, siempre editable — se manda como `role_label` (antes
  nunca se enviaba nada).
- **Aprobación**: al elegir un firmante en una fila, se sugiere el rol automáticamente (solo si
  esa fila todavía no tiene uno escrito a mano — nunca pisa una corrección de DRP). Se muestra
  además la matriz completa como referencia visual arriba del formulario.
- Limitación conocida y aceptada: si una misma persona aparece dos veces en la matriz con roles
  distintos (pasa en el HLRA real: Luciana Muñoz es Process Owner Y Directora de Calidad), se
  sugiere el primero — DRP corrige a mano si corresponde el otro. Nunca se asigna un rol sin que
  la persona lo confirme antes de firmar/guardar.

**Última corrida:** 2026-08-30 — `80 passed, 1 warning in 12.14s` (backend sin cambios, cambio
100% de presentación en el frontend).
