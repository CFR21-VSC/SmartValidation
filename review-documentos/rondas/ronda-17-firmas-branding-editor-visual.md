
---

# Ronda 17 — Claude. Ronda 16 cerrada, cinco piezas de trabajo distintas antes de retomar el contrato de identidad

Ronda 16 quedó cerrada con una propuesta: publicar el 3.1 de URS/VP (probado de punta a
punta) y tratar la extensión a los 22 tipos restantes como trabajo aparte. Esa publicación
**todavía no pasó** — sigue en `urs.skeleton.v3.1.candidato.json` / `vp.skeleton.v3.1.candidato.json`,
sin promover. Lo digo primero porque es fácil perderlo de vista: esta ronda no tocó nada del
contrato de identidad ni del numerador. Lo que sigue es una serie de pedidos del usuario, en
orden, sobre la Suite de Firmas y el editor visual — ninguno toca `contrato-documentos/`.

Cinco piezas, cada una cerrada con verificación antes de pasar a la siguiente.

## 1. HLRA — severidad de gap y contrato de identidad

Bug real encontrado por inspección directa, no reportado por el usuario: `hlra.js` tenía un
mapa de severidad propio, incompleto, que solo reconocía formas en minúscula (`'critico'`,
`'info'`). Los valores canónicos (`CRÍTICA`, `OBSERVACIÓN`) caían en el default y salían del
color de MENOR. Arreglado con un normalizador compartido (`VS.shared.normalizarSeveridadGap`)
en `shared-renderers.js`, verificado con una prueba que mide el `fillColor` real que arma
pdfMake para los 8 valores posibles (4 canónicos + 4 históricos): 10/10 OK
(`review-documentos/severidad-gap-test.cjs`, permanece en el repo como regresión).

De paso: contrato de identidad `HLRA_V3` agregado a `identidad.py`, con soporte de **roles
repetibles** (`gaps`, con `idOcurrencia: 'id'`) que no existía antes — hasta ahora
`asignar()` solo sabía de roles únicos. Probado contra tres ejemplares reales (`HLRA real`,
`HLRA drp-sis`, `HLRA plantilla`), cero problemas de asignación. Sigue **sin esqueleto v3.1**
propio (HLRA nunca tuvo uno) — `cadena-test.py`/`cadena-v31-test.cjs` lo marcan como "PERFIL
PARCIAL" en vez de darlo por bueno en silencio, así que la cadena real sigue siendo honesta
sobre esto.

## 2. Suite de Firmas — la vista de revisión no usaba el motor real

El usuario mandó screenshots: HLRA se veía roto en Firmas (dump de JSON crudo como tabla) pero
perfecto en Validación. Encontré la causa exacta antes de tocar nada: `review.html` tenía su
**propio** parser (`renderSource` → `renderKnownSectionBody` → `renderPlainObject`),
incompleto, separado del motor real (`visual-editor.js`) que Firmas ya cargaba pero solo para
el modo "Editor visual" (activado a mano, oculto por default).

Propuesta del usuario, confirmada antes de escribir código: la columna "Documento" pasa a usar
siempre `visual-editor.js` (el mismo motor real), con dos modos nuevos y aditivos que no
tocan cómo lo usa Validación (`render(data, container, opts)`):

- `opts.readOnly` — sin edición, para quien no es `drp`.
- `opts.hideApproval` — sin la barra "Aprobar sección" de Validación, que no aplica en Firmas
  (tiene su propio flujo de firma vía comentarios + "Firmar revisión").

La columna derecha pasa de "Ver PDF" en modal a vista previa embebida en vivo, con
"Comentarios" como panel que la reemplaza en el mismo lugar en vez de ser una tercera columna
fija. El guardado sigue el mismo camino (`visualEditor.serialize` + `PUT`), sin tocarlo.

Se eliminaron ~120 líneas de código muerto (`renderPlainObject` y compañía).

**Verificación**: Playwright contra los dos servidores reales levantados (no mocks), con un
HLRA real de 19 secciones, en los dos roles:

| | drp | revisor (no-drp) |
|---|---|---|
| secciones renderizadas | 19 | 19 (mismo contenido) |
| campos editables | 364 | 0 |
| barra de aprobación visible | 0 (oculta) | 0 (oculta) |
| botones de edición visibles | — | 0 |
| Guardar/Cargar/Descargar visible | sí | no |
| PDF embebido carga (blob real) | sí | sí |
| toggle a Comentarios | funciona | funciona |

Cero errores de consola en ningún caso.

## 3. Marca de partner/cliente en el PDF

Pedido: que los PDF de un proyecto puedan mostrar el logo de un cliente/partner además del de
DRP Assurance, y que el proyecto "nombre a las dos empresas".

Primer diseño tenía un problema que el usuario mismo detectó — "no expliqué bien la
dominancia": había agregado un campo `partner_name` nuevo que competía con `projects.cliente`,
ya existente ("Cliente / Sponsor" del modal). Corregido: **no hay campo nuevo de nombre**, se
reusa `cliente` tal cual. Lo único genuinamente nuevo es el logo (`partner_logo`). La marca
doble se activa por la presencia del **logo** (acción explícita), no por tener `cliente`
cargado — así ningún proyecto existente empieza a mostrar una segunda marca sin que nadie lo
pida.

De paso corregido un bug preexistente: editar "Cliente / Sponsor" en el modal solo se
guardaba en `localStorage`, llegaba al servidor recién con "Subir al servidor" manual. Ahora
guardar el logo también empuja `cliente` al servidor de inmediato.

Arquitectura: `buildCoverPage`/`buildPageHeader`/`buildPageFooter` en `template-base.js` leen
`data._partnerBranding` (nunca se persiste, solo se adjunta al momento de renderizar) — cuando
no hay partner, el layout queda **byte-idéntico** al de siempre. Documento → Firmas viaja el
branding en el mismo payload del bridge existente, sin ruta nueva.

**Verificación**: proyección estructural del árbol pdfMake (no screenshot) de un HLRA real,
con y sin partner:

```
sin-partner   portada: 1 imagen | header: "DRP ASSURANCE"
con-partner   portada: 2 imagenes | header: "DRP ASSURANCE · ENLACE MOLECULAR SRL"
```

Y round-trip real del endpoint contra un server.py vivo: crear, actualizar solo el logo (el
nombre no se pisa), limpiar — los tres casos correctos.

## 4. Vinculación automática Validación → Firmas

Pregunta del usuario sobre "dominancia" en otro sentido: quién crea el proyecto, cómo se
enteran las dos suites. Hoy: Firmas nunca "crea" un proyecto explícito, aparece recién cuando
llega el primer documento. Pedido: que crear el proyecto en Validación lo cree también en
Firmas de una, sin esperar el primer push.

Implementado como llamada fire-and-forget (thread daemon, mismo patrón que `_send_email`) para
que crear un proyecto en Validación siga siendo instantáneo aunque Firmas esté caída — nunca
bloquea ni falla la creación. Enganchado en los **dos** caminos reales de alta de un proyecto
en `server.py` (`_api_projects_create` y `_api_snapshot_save`, este último es el que usa el
wizard normal vía IndexedDB — no hay un único punto de entrada).

Explícitamente **no** se restringió la carga manual de un documento en Firmas bajo cualquier
`project_id` (que sigue sin cruzar contra Validación) — el usuario pidió dejarlo así, es la
vía que usa para demos sueltas sin pasar por Validación primero.

**Verificación**: los dos servidores reales levantados y hablando entre sí. Crear proyecto vía
API directa → aparece en `rf_projects` con `display_name` correcto. Sync vía snapshot (nuevo)
→ mismo resultado. Segundo snapshot del mismo proyecto → no dispara una segunda creación
(confirmado por el log: un solo `PUT /bridge/projects/...`).

## 5. Cobertura del editor visual — 23 tipos de sección que caían al fallback

El más largo. Usuario cargó un RA real: la tabla FMEA se veía rota, y algunas secciones
salían "parciales". Diagnóstico exacto antes de tocar nada:

- `tabla-fmea` compartía renderer con tablas genéricas simples. El ancho de columna se infiere
  por regex sobre el **nombre de la clave** (`_htmlColPct`) — "S", "P", "D" (un dígito) no
  matcheaban ningún patrón de columna angosta y terminaban con más ancho relativo que
  "peligro"/"control" (párrafos completos). Con datos reales (57 filas, texto largo) esto se
  ve genuinamente roto, no es un problema cosmético menor.
- `escalas-fmea` y `aceptacion-riesgo-residual` no tenían caso en el `switch`, caían al
  fallback genérico (`renderSmartFallbackBody`), que **trunca cualquier array a 3 items** y
  muestra el resto como "y N más". Con 7 items de conclusión, se perdían 4 sin aviso real de
  que faltaban (el "y N más" es chico y fácil de no ver).

Arreglado con un renderer dedicado para `tabla-fmea` (mismas proporciones relativas que usa el
PDF real de `templates/ra.js`, incluyendo el RI calculado con su nivel de riesgo coloreado) y
renderers propios para los otros dos, mostrando todo sin truncar.

Antes de cerrar esto, armé un inventario completo (no solo RA): cuántos tipos de sección, en
qué tipos de documento, seguían cayendo al mismo fallback trunco. Resultado — **22 tipos más**,
repartidos en 15 tipos de documento:

| grupo | tipos de sección | dónde pega |
|---|---|---|
| `matriz-tc` | 1 | IIQ, IOQ, IPQ, PIQ, POQ, PPQ (6 documentos) |
| `release-*` | 5 | RIQ, ROQ, RPQ (+ parcial VSR) |
| `ncr-*` | 5 | NCR (documento completo) |
| resúmenes IQ/OQ/PQ | 4 | IIQ, IOQ, IPQ |
| sueltos | 9 | IRA, AEX, DS, FRS, HLRA×2, VP, VSR×3 |

Usuario autorizó explícitamente completar todo sin pedir confirmación por tipo ("levanta cada
uno vos y revisalo, completa todo sin preguntarme"). Investigué el shape JSON real de cada uno
contra la base local (no supuesto) y el renderer PDF de referencia correspondiente
(`templates/{tipo}.js`) para mantener las mismas proporciones/colores que ya usa el documento
final. Construí helpers compartidos (`_buildSmartTable`, `_kpiGrid`, `_badgeSpan`,
`_estadoColor`, `_nivelColor`, `_emptyBanner`) para no repetir la misma lógica de tabla/badge
23 veces.

**Verificación**: exporté un documento real por cada uno de los 17 tipos de documento
afectados (el que más tipos nuevos cubre de cada uno) y los corrí todos por el editor visual
con Playwright:

```
17/17 tipos de documento · 0 errores de consola · 0 secciones aun en fallback · 0 truncadas
```

Más capturas de pantalla puntuales (matriz-tc, ncr-analisis-causa, release-resumen-ejecutivo,
release-portada-decision, diagrama-arquitectura) para confirmar a ojo que el layout no es solo
"no rompe" sino legible — cinco muestras, todas correctas.

Re-corrida la batería completa de contrato/numeración al final (`cadena-test.py`,
`cadena-v31-test.cjs`, `identidad-test.py`, `reglas-test.cjs`, `numeracion-test.cjs`,
`severidad-gap-test.cjs`) como chequeo de que nada de esto toca `secciones`/numeración — todo
sigue en el mismo estado que al cierre de la Ronda 16.

## Estado

| | resultado |
|---|---|
| HLRA severidad + contrato de identidad | OK, en producción |
| Firmas usa el motor real (visual-editor.js) | OK, verificado en los dos roles |
| Marca de partner/cliente en PDF | OK, verificado end-to-end |
| Auto-vinculación Validación → Firmas | OK, verificado con los dos servidores vivos |
| Editor visual: RA + 22 tipos más | OK, 17/17 tipos de documento verificados |
| **Publicación v3.1 de URS/VP (Ronda 16)** | **sigue pendiente — no se tocó esta ronda** |
| Contrato de identidad para los 22 tipos restantes | sigue en 2/24 (URS, VP) — esta ronda fue sobre la VISTA, no sobre identidad/numeración |

Dos cosas para no confundir de cara a la próxima ronda: la cobertura del editor visual (recién
cerrada, 24/24 tipos de documento) y la cobertura del contrato de identidad
(`contrato-documentos/`, sigue en 2/24) son ejes completamente distintos — uno es "se ve bien
en pantalla", el otro es "el sistema puede validar/numerar ese tipo contra un esqueleto
publicado". No hay overlap de trabajo entre ambos, pero es fácil leer "22 tipos cubiertos" y
asumir que es lo mismo que la Ronda 16 venía pidiendo. No lo es.
