# Suite Revisión y Firmas — Arquitectura

> Documento vivo. Diseño funcional a cargo del usuario; las notas técnicas/stack (marcadas como
> tal) son propuestas de Claude Code sujetas a aprobación. No se implementa nada hasta que el
> diseño acá escrito esté suficientemente cerrado.

## 1. Qué es

Construida de cero. Separada de la Suite de Validación (el "backend" del usuario, donde se
generan los documentos GxP). Mismo despliegue, pieza propia.

Es la cara del sistema que ve el cliente.

**Aislamiento total (confirmado 2026-08-29):**
- URL distinta a la de la Suite de Validación — **no accesible desde una hacia la otra, ni
  viceversa.** Sin links cruzados entre ambas.
- Autenticación propia e independiente (ver sección 3, Capa 1) — no comparte usuarios ni sesión
  con la Suite de Validación.

## 2. Relación con la Suite de Validación

- Comparten código donde sirva (motor de renderizado, componentes, lo que se decida).
- **No se retroalimentan** — al menos en esta primera instancia: Validación produce documentos,
  Revisión y Firmas los consume. Nada de lo que pasa en Revisión y Firmas (comentarios,
  aprobaciones) modifica el documento vivo en Validación.

### Traspaso manual del documento (operativo)

No hay integración entre las dos suites — el traspaso es copiar/pegar JSON a mano:
1. En la Suite de Validación, abrir el documento → toggle **"Técnico"** → copiar el JSON crudo
   completo del textarea.
2. En la Suite de Revisión y Firmas, Dashboard → "+ Cargar documento" → mismo `project_id` que
   usa la otra suite para ese proyecto (para no perder la referencia) → `doc_type` debe coincidir
   con el `"type"` que trae el JSON (si no, "Ver PDF" no encuentra el renderer) → pegar el JSON →
   Guardar.
- No existe un "crear proyecto" separado: un proyecto es simplemente el `project_id` que aparece
  la primera vez que se carga un documento bajo ese código — texto libre, sin entidad propia.
- Recargar el mismo `project_id` + `doc_type` pisa la versión anterior (mientras no esté sellado).

### Limpieza previa (confirmado 2026-08-29)

Se construye de cero en serio: se elimina todo lo que quedó del primer intento de `/firmas/`
(código de `firmas/index.html` y las tablas `signing_rounds`, `signing_round_signers`,
`validation_book_blocks`) — para no contaminar el proceso nuevo. No se migra ni reusa ese
esquema. *(Nota de ejecución: al llegar a la etapa de implementar, confirmar explícitamente antes
de borrar datos/tablas reales.)*

## 3. Capas del sistema

### Capa 1 — Login

Acceso al sistema.

**Independencia total del sistema de auth viejo (confirmado 2026-08-29):**
- El sistema de auth actual (`admin`/`auditor`/`client`, usado hoy en la Suite de Validación y en
  el `/firmas/` viejo) **deja de usarse para todo lo que sea firmas/cliente.** Se reemplaza por
  completo con este diseño nuevo.
- La Suite de Firmas tiene su **propio sistema de usuarios**, totalmente independiente. Se
  bootstrapea con un superadmin (mismo patrón que ya existe para la Suite de Validación — ver
  memoria `superadmin_alerts.md`), y desde ahí se crean las cuentas.
- El usuario DRP del owner (fbongiovanni) en esta suite nueva es una cuenta **separada** de su
  usuario en la Suite de Validación — mismo humano, dos logins distintos, sin relación entre sí.

### Capa 2 — Roles y permisos

**Perfiles:**
- **DRP (owner) y designados** — permisos totales: gestionar usuarios/roles, invitar gente,
  ver todo, asociar accesos a proyectos/documentos, y además pueden actuar ellos mismos como
  firmantes en cualquier documento.
- **Cliente (invitado)** — permisos acotados: revisar, comentar y firmar/aprobar. Solo ve lo que
  se le habilitó explícitamente.

**Registro de usuarios:**
- Se registra el usuario con su rol y su email.
- Por email se lo invita a loguearse y participar en revisión/firma.

**Modelo de acceso (clave):**
- La invitación/habilitación es **a nivel documento**, no a nivel proyecto completo.
- Un proyecto puede tener varios documentos cargados; el invitado asociado a ese proyecto no ve
  todos automáticamente — el owner/admin decide cuáles documentos están habilitados para ese
  usuario en ese momento (visibilidad controlable, no un invite único de todo-o-nada).

**Relación con roles del sistema de auth existente (resuelto 2026-08-29):**
- No coexisten: el sistema viejo (`admin`/`auditor`/`client`) se reemplaza por completo para todo
  lo que sea firmas/cliente (ver Capa 1, arriba). Esta suite tiene su propio esquema de roles
  desde cero.
- El rol de sistema (DRP / Cliente invitado) define **permisos** (qué puede gestionar, invitar,
  ver).
- El rol que aparece en cada firma (Redactor, Revisor/Key User, Aprobador/Process Owner,
  Aprobador/CEO, etc.) es otra cosa: sale tal cual de la **Matriz de Aprobaciones** que ya viene
  dentro del JSON de cada documento — no se inventa ni configura en la suite nueva. Todos los
  firmantes son a la vez revisores y aprobadores, según diga esa matriz para ese documento.

**PIN de firma (confirmado 2026-08-29):**
- Al primer login (DRP o Cliente por igual), el usuario debe configurar su PIN de firma.
- Ese PIN se pide luego para dar conformidad/firmar un documento.

**Notificaciones:**
- Los usuarios invitados reciben la invitación/notificación por email.
- Proveedor: **Resend** (ya integrado en el proyecto para alertas — ver memoria
  `superadmin_alerts.md`).

## 4. Revisión de documentos — la vista

Referencia visual: captura de la Suite Documental, documento HLRA-EMQC-001 (ver conversación
2026-08-29). Layout de 3 columnas:

- **Sidebar "Estructura"** — outline navegable: Metadata, Control & Aprobaciones, Secciones (19).
- **Panel central** — contenido del documento en modo lectura tipo Word.
- **Panel derecho "Preview PDF"** — el PDF real generado (709 KB, 22 págs. en el ejemplo).

Esta vista es la base a reusar/espejar para la Suite de Revisión. Lo que se descarta por ser
exclusivo del rol autor/admin de la Suite Documental (no del revisor/firmante):
- Toggle "Técnico" (JSON crudo).
- Acciones de edición: `+ versión`, `+ firmante`, `Guardar cambios`, `Aprobar sección`.

**Resuelto 2026-08-29: no se reemplazan por nada.** La idea es que el lado del revisor sea
sencillo — esas herramientas de autoría simplemente no existen en esta vista.

**Regla dura (confirmado 2026-08-29): el modo "Técnico" (JSON crudo, llaves y corchetes) NUNCA
se muestra en la Suite de Revisión y Firmas — para nadie, ni DRP ni cliente.** Es exclusivo de la
Suite de Validación interna. Bugs reales encontrados y corregidos en dos rondas de QA:
`review.html` tenía fallbacks (tabla de metadata, contenido de sección, y el propio "Cargar")
que mostraban `JSON.stringify` crudo — visible para cualquiera con acceso al documento. Los de
solo-lectura se reemplazaron por un renderer genérico (tabla/lista legible) que nunca emite
sintaxis JSON.

**Cargar documento = elegir archivo, no pegar texto (confirmado 2026-08-29):** ni el DRP debe ver
ni tipear JSON crudo. El "Cargar" (en `dashboard.html` y en `review.html`) es un selector de
archivo (`<input type="file" accept=".json">`), mismo patrón que `vsImportFileInput` en la Suite
de Validación — se lee el archivo con `FileReader`, se valida que sea JSON parseable, y se sube
sin mostrar el contenido en pantalla en ningún momento.

### Esquema de carga y edición (confirmado 2026-08-29)

- El DRP carga el JSON del documento manualmente y queda persistente en la Suite de Revisión.
- **Panel izquierdo** — muestra el JSON tal cual fue cargado (fuente inmutable durante la
  revisión). Botones `Cargar` / `Descargar` — visibles **solo para DRP**, los clientes no los ven.
- **Panel derecho** — en vez del preview PDF, muestra las mismas secciones pero en un modelo
  editable: ahí el cliente (o el propio DRP durante la rueda de revisión) escribe las
  correcciones/mejoras solicitadas, sección por sección. Autoguardado.
- Esas correcciones se guardan **aparte**, nunca pisan el JSON de la izquierda — no hay
  aplicación automática. El DRP las lee y las aplica a mano, después, en la Suite Documental.
  Esto es justamente el mecanismo concreto de la regla "no se retroalimentan" (sección 2).

### Botón "Ver PDF" (confirmado 2026-08-29)

- Mismo botón que ya existe en la Suite Documental.
- Para el cliente: **solo vista, sin descarga**.
- Renderiza el documento **con las correcciones aplicadas** (la versión del panel derecho), no
  el JSON original de la izquierda — muestra cómo queda armado el documento corregido.

**Resuelto 2026-08-29:** DRP también solo visualiza acá, igual que el cliente — **no hay
descarga en la vista de revisión de la Suite de Firmas, ni siquiera para DRP.** Si DRP necesita
descargar el PDF, lo hace desde la Suite de Validación, que ya tiene esa función.

## 5. Firma — dos etapas separadas (confirmado 2026-08-29)

Son dos momentos de firma distintos, con reglas de orden distintas:

### 5.1 Firma de Revisión
- Sucede en la vista de revisión (sección 4): panel izquierdo JSON fuente + panel derecho editable
  con correcciones.
- Condición para firmar: el documento no tiene revisiones pendientes, o las que hubo ya fueron
  confirmadas/resueltas.
- Cada firmante debe firmar para que el documento avance.
- **No importa el orden de firma** — es más un "confirmo que revisé y no tengo más objeciones".
- Cada firma queda registrada en una tabla propia.

### 5.2 Firma de Aprobación (nueva etapa/pantalla, post-revisión)
- Suite/pantalla nueva: DRP carga manualmente la **versión final** del documento (de nuevo, a
  mano). Acá **no** hay panel editable — solo:
  - Vista del PDF final (cómo va a quedar el documento).
  - Panel de firmantes al lado.
- **Sí importa el orden** — se configura como secuencia lógica, y **solo DRP puede
  configurarla**.
- Se puede configurar uno o varios documentos a la vez, en ambas vistas (revisión y aprobación).
- **DRP (fbongiovanni) firma siempre último.** Su firma es el evento de sellado — no hay un paso
  separado de "sellar": el momento en que fbongiovanni firma, el proceso queda sellado e
  inmovilizado.
- **Texto justificativo obligatorio (confirmado 2026-08-29):** cada firma de Aprobación requiere,
  además del PIN, un texto de conformidad/justificación escrito por el firmante. (La firma de
  Revisión, sección 5.1, no lo requiere — solo PIN.)

### 5.3 Inmutabilidad
- Al sellarse (firma final de DRP), el documento queda inmutable.
- Se hashea el PDF generado **y** el JSON — ambos quedan inmovilizados.

### 5.4 Notificaciones de evento
- Se notifica por mail (Resend) en dos eventos: cada vez que se firma un documento, y cuando un
  documento se inmoviliza (sellado final).
- Mismo mecanismo que las notificaciones de invitación (sección 3, Capa 2) — Resend ya integrado.

## 6. Libro de Validación — People / Audit Trail, capa de datos (confirmado 2026-08-29)

- Las firmas alimentan el Libro de Validación, sección **People** (involucrados y firmantes).
- El libro funciona como audit trail del proyecto completo, registrando:
  - Quiénes están autorizados al proyecto.
  - Quién solicitó cambios y qué cambios pidió.
  - Quién revisó y avanzó (firmó).
  - Todo trazado con fecha, hora y evento descriptivo.
- **Por ahora es una capa de datos, sin interfaz visual todavía** — se diseña la visualización
  más adelante.

## 7. Libro de Validación — Generación del Tomo I / Libro 1 (confirmado 2026-08-29)

- Concepto central del proyecto, ya construido en la Suite de Validación (`book-builder.js`):
  compila los documentos del paquete en un único PDF tipo libro — tapa, prefacio, índice
  navegable, registro maestro de firmas, cada doc uno tras otro, numeración global. Muy laborioso
  de armar — el código de esa parte está bien, se replica tal cual funciona.
- El código actual distingue **Tomo I** (ciclo narrativo: HLRA→VP→URS→FRS→...→VSR, `PHASE_ORDER`)
  de **Tomo II** (AEX, anexos de evidencia de ejecución, `AEX_TYPES`).
- **En la Suite de Firmas se genera SOLO el Libro 1 / Tomo I** — armado con los documentos que
  se van firmando ahí (no con los documentos vivos de la Suite de Validación).
- **Los demás libros/tomos (incluido el Tomo II / Libro de Evidencia) NO se tocan acá.** Siguen
  siendo entregables exclusivos de DRP, generados y entregados solo desde la Suite de Validación.

**Herencia de reglas de render (confirmado 2026-08-29):**
- El Libro de Validación es un documento más, con la **misma estructura** que los demás
  protocolos, y se inserta dentro del libro compilado igual que cualquier otro.
- El libro compilado ya contempla, dentro de sí, su propio **Libro de Firmas** (sección de
  registro de firmantes) — no es algo a agregar de cero.
- Todas las reglas de render (anchos de fila/columna, estilos, maquetado) se **heredan tal cual**
  del motor existente — ya están ajustadas, cero reinvención. Esta suite debe mostrar
  visualmente lo mismo que la Suite de Validación, con la diferencia de que se llena con las
  firmas reales generadas acá.

## 8. Decisiones técnicas / stack

*(propuestas de Claude Code. El usuario delegó estas decisiones con tres restricciones: (1) no
romper las funciones que hay que replicar tal cual — motor de render pdfMake/book-builder — (2)
Postgres como base de datos, (3) pensado para Railway. Confirmado 2026-08-29, listo para
implementar salvo objeción.)*

### 8.1 Deployment — Railway, segundo servicio en el mismo proyecto

- El repo ya tiene un único servicio Railway (`railway.toml` raíz, Dockerfile, `python server.py`).
- Se agrega un **segundo servicio Railway** dentro del mismo proyecto: `suite-revision-firmas`.
  Railway le asigna su propio dominio automáticamente → satisface "URL distinto, no accesible
  desde la otra suite" sin routing manual ni riesgo de que las sesiones se crucen.
- **Comparte la misma instancia de Postgres** (un solo plugin, un solo costo). Aislamiento
  lógico vía **prefijo de tablas `rf_*`** (no un schema Postgres separado — se evaluó, pero un
  schema separado complica el manejo de `search_path` en el pool de conexiones reusado de
  `db_adapter.py`; el prefijo da el mismo aislamiento con menos riesgo). Implementado y
  verificado 2026-08-29.
- Carpeta propia en el repo: `SMART_Validation/suite-revision-firmas/` — código, Dockerfile y
  `railway.toml` independientes de `server.py`.

### 8.2 Backend — FastAPI + uvicorn

- Ya hay precedente en el repo (`analytics-service`, FastAPI). Para una pieza nueva, FastAPI da
  validación de requests, manejo de sesión/cookies más simple y menos código repetitivo que el
  `ThreadingHTTPServer` crudo de `server.py` — mejor ajuste para "optimizar el flujo".
- Acceso a datos: se copia y adapta `db_adapter.py` (mismo patrón dual SQLite-local /
  Postgres-Railway ya probado) apuntando al schema `revision_firmas`. Dev local sigue sin
  necesitar Postgres corriendo.

### 8.3 Auth — independiente, mismos mecanismos probados

- Tabla `users` propia dentro de `revision_firmas` (roles `drp` / `cliente`), sin relación con la
  tabla `users` de la Suite de Validación.
- Hashing de password/PIN: se reusa el mismo esquema PBKDF2-SHA256 ya implementado en `server.py`
  (se copia el helper, no se importa en vivo).
- Cookie de sesión con nombre distinto (p. ej. `rf_session` vs `smart_token`) — cero posibilidad
  de colisión o lectura cruzada entre las dos suites.
- Bootstrap de superadmin: mismo patrón ya usado (`SUPERADMIN_USERNAME` por env var).

### 8.4 Email — Resend (reuso directo)

- Se copia el helper `_send_email` / integración Resend ya existente en `server.py`.
- Triggers: invitación de usuario, cada firma (revisión y aprobación), sellado/inmovilización.

### 8.5 Storage de artefactos inmutables — Cloudflare R2

- Se reusa `r2_adapter.py` tal cual (ya soporta fallback gracioso si no está configurado),
  apuntando a un prefijo/bucket propio de esta suite — separado del bucket de evidencias de
  Validación.
- Ahí se guardan el PDF final y el JSON, en el momento del sellado, junto con sus hashes.

### 8.6 Motor de render (pdfMake, templates, book-builder) — copia vendorizada

- Se copian tal cual a la carpeta estática de la nueva suite los archivos necesarios:
  `template-base.js`, `shared-renderers.js`, `document-renderer.js`, los templates por tipo de
  documento efectivamente usados, `book-builder.js`, `book-preview.js`.
- Es una copia única al momento de construir, no una dependencia en vivo del otro servicio —
  coherente con "no se retroalimentan" y con que el motor "ya está ajustado, se hereda tal cual".
- Si el motor recibe un fix en la Suite de Validación a futuro, es una decisión manual traerlo acá
  (no hay sincronización automática).

### 8.7 Frontend

- HTML/CSS/JS plano, sin build step — mismo criterio que el resto del proyecto.

### 8.8 Modelo de datos (schema `revision_firmas`, Postgres)

- `users` — drp/cliente, pin_hash, password_hash, pin configurado en primer login.
- `document_access_grants` — user_id + project_id + doc_type (habilitación granular).
- `documents` — proyecto, tipo, json_data cargado a mano, status, locked, pdf_hash, json_hash,
  locked_at.
- `section_corrections` — correcciones del panel derecho en revisión, por sección, autoguardado.
- `review_signatures` — firmas de revisión (sin orden).
- `approval_rounds` / `approval_signers` — firmas de aprobación (con sign_order, role_label desde
  la matriz del doc, justification_text, pin verificado).
- `people_book_events` — audit trail: autorizados, solicitudes de cambio, revisiones, firmas —
  todo con fecha/hora/evento descriptivo.

## 9. Historial de decisiones

- 2026-08-29: Confirmado — se construye de cero, suite separada, mismo despliegue.
- 2026-08-29: Confirmado — comparten código pero sin retroalimentación (por ahora).
- 2026-08-29: Confirmado — roles DRP (admin) y Cliente (revisar/comentar/aprobar).
- 2026-08-29: Diseño funcional cerrado (secciones 1-7). Delegadas las decisiones técnicas
  (sección 8) con restricciones: no romper el motor de render existente, Postgres, pensado para
  Railway.
- 2026-08-29: **Fase 1 implementada** — scaffold de `suite-revision-firmas/` (FastAPI, Capa 1
  login + Capa 2 roles/permisos/invitaciones/accesos por documento). 17/17 tests unitarios
  pasando. Ver [suite-revision-firmas-test-plan.md](suite-revision-firmas-test-plan.md).
- 2026-08-29: **Fase 2 implementada** — documentos (carga por DRP) + correcciones autoguardadas
  por sección (sección 4). 30/30 tests pasando.
- 2026-08-29: **Fase 3 implementada** — firma de revisión, firma de aprobación con sellado e
  inmutabilidad, notificaciones por email, y el Libro de Validación sección People (audit trail,
  capa de datos). 44/44 tests pasando. Se agregó `/auth/set-pin` (gap real de Capa 1: el
  superadmin bootstrapeado no tenía forma de fijar su PIN) y una regla no especificada
  explícitamente pero necesaria por coherencia: todo firmante de una ronda de aprobación debe
  tener ya un grant de acceso al documento. Detalle completo en el plan de testing.
- 2026-08-29: **Fase 4 implementada** — motor de render vendorizado + 7 páginas de frontend
  (login, pin-setup, invite, dashboard, users, review, approval), construidas en paralelo por 4
  agentes con un contrato de API/CSS/JS compartido. Verificado con servidor real: flujo de
  negocio completo (invitación → carga → corrección → firma de revisión → ronda de aprobación →
  sellado inmutable) funcionando de punta a punta. Bug real encontrado y corregido: el link de
  invitación apuntaba al endpoint JSON crudo en vez de a la página de activación. Pendiente:
  tests de UI en navegador (Playwright), botón de generación del Libro 1/Tomo I, verificación de
  Resend contra una cuenta real. Detalle completo en el plan de testing.
