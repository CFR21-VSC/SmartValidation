# Lecciones Aprendidas — Validation Suite

Documento vivo. Acá vamos anotando todo lo que sale mal o requirió ajuste durante la implementación de cada renderer, para que los próximos tipos de documento (URS, VP, RA, etc.) lo tengan resuelto desde el día uno.

---

## 1. Layout y dimensiones de página

### Page margins fijos: `[70, 90, 70, 60]`
- Izquierdo y derecho **70pt** (no 50, no 60). Probado: márgenes menores se ven "apretados" al borde.
- Superior **90pt** para dar espacio al header que dibuja `template-base.js`.
- Inferior **60pt** para footer.
- **Ancho útil resultante: `CONTENT_WIDTH = 455pt`** (constante exportada en `templateBase.CONTENT_WIDTH`).

### Anchos de tabla
- **Siempre sumar EXACTAMENTE 455pt entre todas las columnas.** No 460, no 450. Sí 455.
- Si los widths suman más → la tabla desborda a la derecha.
- Si suman menos → queda visualmente desbalanceada con espacio muerto.
- Ejemplos verificados que suman 455:
  - 2 col: `[150, 305]` (key/value)
  - 3 col: `[200, 100, 155]` (docs aplicables)
  - 4 col: `[50, 70, 120, 215]` (control cambios) | `[165, 155, 65, 70]` (aprobaciones)
  - 5 col: `[40, 70, 200, 50, 95]` (factores IRO)

### Líneas decorativas (canvas)
- `lineWidth: 1.2` para separadores debajo de títulos de sección.
- `lineWidth: 0.8` para líneas de header de página.
- `lineWidth: 0.5` para líneas finas decorativas (debajo del subtítulo en portada).
- `x2` siempre = `455` (ancho útil), o `395` con offset `x1: 60` para líneas centradas en portada.

---

## 2. Tablas

### Reglas obligatorias en TODA tabla
```js
table: {
    widths: [...],          // suman 455 con vsTableLayout (padding 6); 401-419 con vsTableLayoutDense (padding 3)
    body: [...],
    dontBreakRows: true,    // filas individuales no se cortan entre páginas
    headerRows: 1           // header se repite en cada página
}
```

### CRÍTICO: el padding del layout NO está incluido en `widths`
- pdfMake suma el padding de las celdas **fuera** del ancho declarado en `widths`. Si los widths suman 455 pero el layout tiene padding 6 lateral × 9 columnas, son **108pt extra** que desbordan la página.
- **Regla**: `suma(widths) + (paddingLeft + paddingRight) × Ncols = 455`
- Layouts disponibles:
  - `vsTableLayout()` (padding 6 lateral): ideal para tablas con pocas columnas (≤6). Widths suman `455 - 12 × Ncols`. Para 5 cols: 395. Para 6 cols: 383.
  - `vsTableLayoutDense()` (padding 3 lateral): para tablas con muchas columnas (≥7) tipo matrices FMEA. Widths suman `455 - 6 × Ncols`. Para 9 cols: 401. Para 10 cols: 395.
- Bug histórico (RA y IRA): widths sumaban 455 con `vsTableLayout` y 9-10 cols → desbordaban ~100pt por página. Fix: cambiar a `vsTableLayoutDense` y reducir widths.

### Auto-compactación por cantidad de filas
- Si la tabla tiene **más de 6 filas** → automáticamente fontSize 9 + padding `[5,3,5,3]`.
- Hasta 6 filas → fontSize 10 + padding `[6,5,6,5]`.
- Implementado como helper en cada `renderTabla*`.

### Headers cortos
- Headers como "Verificar en OQ" se cortan feo en columnas estrechas.
- **Usar abreviaturas**: "Verif. OQ", "Cant.", "%", "Cat. GAMP".
- Si no hay forma → ampliar el ancho de la columna.

### Word wrapping
- Por default pdfMake wrappea texto en celdas. **No desactivar `noWrap`**.
- Si el contenido no entra → la celda crece en alto. Con `dontBreakRows:true` se respeta entre páginas.
- `lineHeight: 1.25` en `vsTd` mejora legibilidad cuando hay multilínea.

---

## 3. Saltos de página

### `marginTop` entre secciones
- **Usar `10pt` entre secciones**, NO 18 ni 20. Valores grandes empujan secciones cortas a la siguiente página dejando huecos vacíos.

### `unbreakable: true` — usar con MUCHO cuidado
- Solo en **tarjetas GAP** (header de color separado del cuerpo queda horrible).
- Solo en **caja-conclusión** (no se debe partir).
- Solo en **caja-resultado** y **box-resultado-rai** (cajas chicas).
- **NO usar en**: secciones grandes (formula-rai con tabla de factores), tablas largas. Si una sección unbreakable no entra en lo que queda de la página, deja un hueco vacío gigante.

### Headers que se repiten al partir
- `headerRows: 1` en CADA tabla: cuando una tabla se parte, en la página nueva se vuelve a dibujar la fila de encabezados.
- Combinado con `dontBreakRows: true` (las filas individuales no se cortan), las tablas largas se ven prolijas.

### `pageBreak: 'after'` solo donde hace sentido
- Después de la portada (forzar página nueva).
- Después de la página 2 (control y aprobaciones).
- **NO antes de cada sección de contenido** (deja huecos).

---

## 4. Portada (página 1)

### Debe entrar en 1 sola página
- Logo: 70pt (no 90).
- Título empresa: 20pt (no 22).
- Título documento: 19pt (no 22).
- Subtítulo italic: 11pt (no 12).
- Banner azul: padding `[16, 12, 16, 12]` (no `[20, 18, 20, 18]`).
- Tabla metadata: fontSize 9 + padding `[10, 5, 10, 5]` (no 10/8).
- Espaciados verticales reducidos en general (24pt en vez de 36, 18pt en vez de 28).

### Copyright al pie
- **NUNCA** usar `absolutePosition` en el flujo de contenido — pdfMake lo evalúa cuando ya está procesando la página 2 → se superpone con el contenido siguiente.
- **Solución**: usar callback `docDefinition.background` que verifica `currentPage === 1` y dibuja el copyright al pie.
- Ya implementado en `templateBase.buildBackground(data)`.

---

## 5. Header y footer de página

### Header (todas las páginas excepto portada)
- Logo izq (24pt) | Empresa + título doc (centro) | Código doc (der)
- Línea inferior `lineWidth: 0.8`, color `VS_COLORS.primary`.
- `currentPage === 1` retorna `null` (la portada no tiene header).

### Footer (todas las páginas excepto portada)
- Línea superior `lineWidth: 0.5`, color `VS_COLORS.border`.
- 3 columnas: `© 2026 Empresa` | `CÓDIGO-DOC vN` | `Página N de M`
- **Importante**: numeración de página excluye la portada → mostrar `currentPage - 1` y `totalPages - 1`.

---

## 6. Estructura JSON

### Schema base (todos los documentos)
- `package` — datos del paquete (1 vez por proyecto)
- `document` — datos del documento (varían por archivo)
- `controlCambios` — array (puede estar vacío)
- `matrizAprobaciones` — array (sin tope de firmantes)
- `trazabilidad` — `{ recibeDe: [], alimentaA: [] }`
- `secciones` — array de objetos con `tipo`, `titulo`, etc.

### Convenciones de naming
- `titleEs` y `titleEn` (no solo `title`).
- `headerTitle` opcional, default = `titleEs`.
- `documentCode` se autogenera como `${type}-${package.code}` si no se provee.
- Estados: usar `"Aprobado"`, `"Borrador"`, `"En revisión"` (el getStatusColor reconoce esos).

### Matriz de aprobaciones — sin tope
- Es un array. Puede tener 4, 6, 10 firmantes.
- Cada firmante: `{ rol, nombre, iniciales, fecha, firmaImage? }`.
- `firmaImage` (PNG dataURL) opcional → se renderiza imagen en vez de iniciales.

### Renombrar siglas confusas
- `RAI` → `IRO` (Índice de Riesgo Operativo). Evita confusión con "Risk Assessment Indicators".
- En el fixture: `formula: "IRO = P × G × D × I × PR × S"`, `labelCalculo: "IRO CALCULADO"`.

---

## 7. Patrones de fixtures

### Fixture completo + template vacío
- Cada tipo de documento debe tener **DOS fixtures**:
  - `{tipo}-{codigo}.json` — fixture completo basado en el modelo (para ejemplo y testing visual).
  - `{tipo}-template-vacio.json` — esqueleto sin datos del modelo (lo que Claude Desktop completa con datos reales).

### Datos hardcodeados PROHIBIDOS
- El template vacío NO debe tener nombres reales del modelo (Federico Bongiovanni, Lucas Santarenz, DRP-SIS-001, etc.).
- Solo debe tener:
  - Estructura
  - Etiquetas estándar (subtítulos de sección, títulos de tabla, fórmula IRO)
  - Roles estándar de firmantes (sin nombres)

---

## 8. Tipos de sección (catálogo HLRA)

| Tipo | Cuándo usar | Render |
|---|---|---|
| `texto` | Párrafos simples | Soporta `bloques: [{subtitulo, texto, bullets}]` |
| `lista-incluido-excluido` | Alcance del documento | Dos bloques con bullets |
| `tabla` | Tabla genérica con columnas variables | Auto-compacta si >6 filas |
| `tabla-info` | Key/value (Campo \| Valor) | Auto-compacta si >6 filas |
| `arbol-decision-gamp` | Categorización GAMP | Última fila destacada |
| `caja-resultado` | Banner con conclusión (categoría) | Unbreakable |
| `tabla-docs-aplicables` | Docs con estado coloreado | Estados conocidos: Obligatorio/No aplica/Opcional |
| `formula-rai` | Fórmula IRO + tabla factores | Sin unbreakable global |
| `box-resultado-rai` | Doble box (Cálculo \| Nivel) | Unbreakable |
| `tarjeta-gap` | GAPs con header de color por severidad | Unbreakable |
| `caja-conclusion` | Caja con borde para conclusión | Unbreakable |
| `tabla-firmas-final` | Tabla de firma al final del doc | Celdas de 60pt de alto |

---

## 9. Tabla de firmas final

- Es **diferente** de la matriz de aprobaciones de página 2.
- La matriz de página 2 → es la matriz administrativa del documento.
- La tabla-firmas-final → es donde se ejecutan las firmas reales (digitales o manuscritas escaneadas).
- Tiene celdas de **60pt de alto** para que entre la firma física.
- Si `firmas: []` está vacío → genera filas vacías con los `rolesPlaceholder`.

---

## 10. Reglas para Claude Desktop al generar JSON

### SIEMPRE incluir
- `schemaVersion: "1.0"`
- `type` (en mayúsculas: `HLRA`, `VP`, `URS`, etc.)
- `package` completo
- `document` completo (al menos `titleEs`, `version`)
- `matrizAprobaciones` (puede tener 1 o N firmantes)
- `secciones` con sus `tipo` correctos

### NUNCA
- Inventar siglas o normas que no estén verificadas.
- Llenar campos con texto genérico tipo "Lorem ipsum".
- Omitir campos obligatorios (validateDocumentJson devuelve errores).
- Usar widths que no sumen 455 en arrays con `widths` explícitos.

### Convenciones de fechas
- Formato `YYYY-MM-DD` o `DD/MM/YYYY` (la suite formatea automáticamente).
- Formato libre como "Febrero 2026" también se acepta tal cual (no se reformatea).

---

## 11. Lecciones del VP (Plan de Validación)

### Refactor: tipos compartidos en `shared-renderers.js`
- Ahora `texto`, `lista-incluido-excluido`, `tabla`, `tabla-info` y `caja-conclusion` viven en `js/validation-suite/core/shared-renderers.js`.
- Cada renderer específico (HLRA, VP, etc.) usa `VS.shared.render*()` para los tipos comunes.
- **Regla**: cuando agreguemos un nuevo tipo que se va a reusar en >1 documento, va a `shared-renderers.js` desde el inicio.

### Tipos nuevos compartidos (agregados con el VP)
| Tipo | Para qué sirve |
|---|---|
| `subseccion` | Sub-títulos numerados (8.1, 8.2) con línea más fina que `sectionTitle` |
| `caja-nota` | Callout amarillo italic, para notas de aclaración (≠ `caja-conclusion`) |
| `caja-justificacion` | Caja con borde + título destacado, para justificar exclusiones (PQ no aplica) |
| `caja-criterio` | Banner verde con título, para "El sistema se considera VALIDADO cuando..." |

### Tablas con bullets dentro de celdas
- `renderTabla` ahora acepta celdas tipo `{ bullets: ["a", "b", "c"] }` además de string y `{ text, ... }`.
- Útil para cronogramas (semana | actividades como bullets | docs como bullets | hito).
- Tamaño de fuente del bullet = celda - 0.5pt (más chico para densidad visual).

### `document.extras` para campos extra de portada
- Cada tipo de documento puede agregar campos a la tabla de metadata de la portada via `document.extras: {"Etiqueta": "Valor"}`.
- El VP usa: `"Documento base (HLRA)"`, `"Tipo de Validación"`.
- El templateBase los detecta y agrega después de los campos estándar.
- **Regla**: si un campo solo aparece en 1 tipo de documento, va en `extras`. Si aparece en >2, considerar agregarlo al schema base.

### Auto-carga de logo
- El logo está en `js/validation-suite/assets/logo-drp.png` (extraído del PDF modelo).
- `document-renderer.js` lo carga automáticamente al primer `renderDocument()` mediante `tryAutoLoadLogo()`.
- Si el archivo no existe, no genera error — la portada queda sin logo.
- **Regla**: para customizar logo por proyecto, llamar `VS.templateBase.setLogoDataUrl(dataUrl)` antes de generar.

### Tablas chicas: `unbreakable` para evitar header huérfano
- **Problema observado**: si una tabla con `headerRows: 1` empieza al final de una página y solo cabe el header, se renderea: header solo + nueva página + header repetido + filas. Queda feo.
- **Fix**: en el dispatcher principal (en `pv.js` y `hlra.js`), si la tabla tiene **≤8 filas**, envolver `título + tabla` en un `stack: { unbreakable: true }`.
- Resultado: tablas chicas saltan completas a la siguiente página si no caben enteras (no quedan headers solos).
- Tablas grandes (>8 filas) mantienen `headerRows: 1` (no podrían caber unbreakable en una sola página).
- **Tipos de tabla considerados "chicos"**: `tabla`, `tabla-info`, `arbol-decision-gamp`, `tabla-docs-aplicables`, `tabla-decisiones-tc`.

### Sección obligatoria VP: DECISIONES DE EJECUCIÓN
- Cuadro estandarizado con los 4 resultados (PASA, PASA CON OBSERVACIONES, NO PASA, NO APLICA), su significado, impacto en liberación y acción.
- Tipo `tabla-decisiones-tc`: si no se proveen `filas`, el renderer usa las default GxP estándar.
- **Regla**: incluir esta sección también en POQ, IOQ, RIQ, ROQ, IF (donde aplique describir resultados de TC).

### Tabla "Documentos del Proyecto" — sin columna Estado
- En el modelo VP original había una columna "Estado" (Aprobado/Pendiente).
- **Conclusión**: redundante. Al momento del VP todo está Pendiente excepto HLRA y el VP mismo. Lo natural se sobreentiende.
- **Regla aplicada**: omitir columna Estado en tabla de documentos del proyecto. La caja-nota debajo aclara que todo está pendiente por avance natural.

### Anchos verificados VP (suman 455)
- Tabla Documentos del Proyecto: `[25, 130, 175, 125]`
- Tabla Cronograma: `[50, 175, 130, 100]`
- Tabla Áreas IQ: `[140, 195, 120]`
- Tabla Áreas OQ: `[150, 230, 75]`
- Tabla Severidad NCs: `[80, 215, 160]`
- Tabla Cambios post-validación: `[180, 160, 115]`
- Tabla Criterios Aceptación: `[25, 270, 160]`
- Tabla Decisiones TC: `[90, 145, 130, 90]`

---

## 12. Lecciones del URS

### Sub-headers de grupo en tablas (`{ subheader: "..." }`)
- En tablas grandes con categorías (ej: 50 requerimientos agrupados en 7.1, 7.2... 7.9), usar **sub-headers de grupo** dentro del array `filas`.
- Sintaxis: `{ "subheader": "7.1 Autenticación y Control de Acceso" }`
- El renderer detecta automáticamente y dibuja la fila con `colSpan = N` en color secundario azul, texto blanco bold.
- **Implementado en**: `shared-renderers.js → renderTabla`.

### `headerRows: 0` automático cuando hay sub-headers
- **Problema**: si la tabla tiene sub-headers Y `headerRows: 1`, al partir entre páginas queda: header de tabla repetido + sub-header inmediatamente, viéndose como "doble encabezado" sin filas de contenido entre ambos.
- **Fix**: el renderer detecta automáticamente la presencia de sub-headers y desactiva `headerRows`. Los sub-headers actúan como contexto suficiente en cada página.
- **Aplica a todas las tablas con `{ subheader }` en filas**.

### `noHeader: true` para tablas-leyenda
- Algunas tablas (como la leyenda de criticidad del URS) no tienen una fila de encabezado tradicional.
- Usar `"noHeader": true` para que el renderer omita la fila de header.
- Combinable con `compact: true` y `widths` custom.

### Stack en celdas (resumen estadístico de 3 columnas)
- Para tablas tipo "dashboard" donde cada celda es un mini-cuadro con varios datos, usar `{ stack: [...] }` como contenido de celda.
- Soporta texto, líneas decorativas (`canvas`), y formato por fila.
- Útil para resúmenes ejecutivos y stats agrupados.

### Override de celdas en tablas grandes (URS funcional)
- Cada celda puede tener override de estilo: `{ "text": "...", "bold": true, "color": "...", "fontSize": ..., "italics": true, "alignment": "center" }`.
- Útil para colorear códigos URS, IDs, criticidades, tipos M/D.
- Ejemplo URS: cada criticidad tiene su color exacto (`#C0392B` rojo, `#E67E22` naranja, `#717D8A` gris).

### Tabla gigante (50+ filas) NO unbreakable
- Las tablas con muchas filas no caben unbreakable en una sola página.
- En el dispatcher de URS, solo se wrappea unbreakable si tiene `<=6` filas (más conservador que HLRA/VP que usa 8).
- Esto evita que la tabla de requerimientos quede mal renderizada.

### Convenciones de naming URS
- IDs funcionales: `URS-001`, `URS-002`, ... `URS-NNN`
- IDs no funcionales: `URS-NF-001`, `URS-NF-002`, ...
- Fuentes: `MAN §X.X`, `SOP-USO §X.X`, `SOP-ADM §X.X`, o normas (`ANMAT 4159/2023 Pto.X`)
- Cada URS empieza con verbo en infinitivo después de "El sistema DEBERÁ..."

### Anchos verificados URS (suman 455)
- Tabla Responsabilidades: `[160, 295]`
- Tabla Definiciones: `[125, 330]`
- Tabla Usuarios del Sistema: `[110, 165, 180]`
- Tabla Leyenda Requerimientos: `[85, 175, 195]`
- Tabla-leyenda Criticidad: `[120, 335]`
- Tabla Requerimientos Funcionales: `[50, 80, 220, 30, 75]`
- Tabla Requerimientos No Funcionales: `[55, 80, 215, 30, 75]`
- Tabla Exclusiones: `[165, 200, 90]`
- Tabla Criterios Aceptación: `[25, 290, 140]`
- Tabla Resumen Estadístico: `[140, 120, 195]`

---

## Lecciones específicas de FRS

### Trazabilidad bidireccional URS → FRS es OBLIGATORIA
- Cada FRS debe tener su columna `URS Origen` poblada (puede listar múltiples URS).
- No se permiten FRS huérfanos. Si surge una necesidad técnica sin URS de origen, primero se actualiza el URS.
- El cliente del skill (Claude Desktop) debe rechazar cualquier FRS sin URS, no inventarlo.

### Diferencia FRS vs URS (a memorizar)
- **URS** dice QUÉ necesita el usuario (lenguaje de negocio).
- **FRS** dice QUÉ funciones ejecutará el sistema (lenguaje técnico funcional).
- **DS** dice CÓMO se implementarán (lenguaje técnico de diseño).
- Si un FRS describe el COMO (ej. "se usa Java + Oracle"), está mal redactado: pertenece al DS.

### Sección "REFERENCIA AL URS" (tabla-info) es obligatoria
- Materializa la trazabilidad de origen en una tabla-info con campos: URS de referencia, total URS de origen, FRS generados, ratio URS:FRS, categoría GAMP, configuración requerida, trazabilidad bidireccional.
- Esta sección no aparece en URS — es exclusiva de FRS.

### Sección dedicada para REQUERIMIENTOS DE INTERFAZ
- A diferencia del URS (donde las integraciones están dispersas), el FRS tiene una **sección 7 dedicada** a interfaces externas.
- IDs separados: `FRS-XXX` (funcionales) vs `FRS-IF-XXX` (interfaces).
- Cada interfaz documenta: dirección (Sistema A → Sistema B), datos, frecuencia, protocolo, criticidad.

### Performance con métricas numéricas concretas
- Cada métrica de la tabla de Performance DEBE tener objetivo numérico (`≤ 2 segundos`, `≥ 100 usuarios`, `99.5% uptime`).
- Sin "rápido", "eficiente" ni "alta capacidad" como objetivos. Eso pertenece al URS-NF.

### Matriz de aprobaciones del FRS — incluye Revisor Técnico/IT
- A diferencia del URS (donde el revisor técnico es opcional), el FRS tiene componente técnica fuerte → siempre incluye Revisor Técnico (IT).
- En GAMP 4 con vendor externo, agregar también Vendor (confirmación técnica).
- Total típico: 5-6 firmantes (vs 3-4 del URS).

### Anchos verificados FRS (suman 455)
- Tabla Responsabilidades: `[160, 295]`
- Tabla Definiciones: `[125, 330]`
- Tabla-info Referencia URS: `labelWidth: 170`
- Tabla FRS Funcionales: `[50, 70, 230, 30, 75]`
- Tabla FRS Interfaces: `[60, 70, 175, 80, 70]`
- Tabla Performance: `[165, 120, 170]`
- Tabla Manejo de Errores: `[140, 200, 115]`
- Tabla Criterios Aceptación: `[25, 290, 140]`

### FRS abstracto vs FRS extendido
- **Hay dos escuelas válidas del FRS en GAMP/ANMAT** y ambas se usan en la industria.
- **FRS abstracto**: solo describe QUÉ funciones ejecuta el sistema (FRS) sin entrar en algoritmos. Adecuado para GAMP 3 puros y GAMP 4 con producto sin algoritmia compleja.
- **FRS extendido**: incluye además sección "REGLAS DE NEGOCIO Y LÓGICA FUNCIONAL" con tipo `flujo-logico`. Recomendado para GAMP 4 con algoritmia compleja (SAP EWM, LIMS, MES) y GAMP 5 custom.
- En GAMP 4, la algoritmia describe el comportamiento del producto **bajo la configuración GxP del cliente** — no implica desarrollo. Es válido y útil.
- **La elección debe consultarse con el usuario antes de generar.** No es "más correcto" un modo que el otro.
- Caso de uso real (cliente DRP, SAP EWM): documentar la algoritmia de entrada/salida (putaway, replenishment, picking, packing, outbound) fue muy valioso para el POQ.

### Tipo NUEVO: `flujo-logico` (exclusivo de FRS extendido)
- Cada algoritmo tiene: `id`, `nombre`, `frsAsociados`, `trigger`, `pasos` (array de strings o {n, accion}), `decisiones` (array de {condicion, accion}), `ejemplo`.
- El renderer dibuja: header con ID+nombre+FRS, caja "Trigger" con fondo soft, tabla de pasos numerados, tabla de decisiones (si/entonces), caja "Ejemplo" con borde verde a la izquierda.
- Si el algoritmo es chico (≤8 pasos+decisiones), se renderiza con `unbreakable: true` para no partir entre páginas.
- **Regla de oro de redacción**: los pasos describen lógica funcional con nombres de tabla/permiso/secuencia (válidos como configuración GxP visible) pero NO con nombres de método/clase/librería (eso es DS).
- Cantidad típica: 3-8 algoritmos por sistema. Más de 10 sugiere documentar lógica trivial.
- Tamaño típico de cada algoritmo: 5-12 pasos. Si tiene más, dividir en ALG-XXXa y ALG-XXXb.

### IDs de algoritmos
- `ALG-001`, `ALG-002`, ... (numeración correlativa simple).
- Si hay categorías muy claras (entrada vs salida en EWM): `ALG-IN-001`, `ALG-OUT-001`.
- No mezclar con FRS-XXX (son cosas distintas).

### Numeración automática de secciones
- El renderer FRS numera por índice (`idx + 1`).
- Si se omite la sección `flujo-logico` (modo abstracto), las secciones siguientes se renumeran solas.
- No hay que forzar números fijos en el JSON — el renderer los pone.

---

## Lecciones específicas de DS

### Tipo NUEVO: `diagrama-arquitectura`
- Es el primer tipo de sección **exclusivo del DS** (no se reutiliza en otros documentos).
- Renderiza capas verticales con flecha `▼` automática entre ellas.
- Cada capa tiene `nombre`, `tecnologia`, `color` (`primary | secondary | accent | hex`), `componentes` (lista de strings).
- Mínimo 3 capas, máximo 5. Las 4 estándar: Presentación / Aplicación / Datos / Infraestructura.
- Se renderiza con `unbreakable: true` para evitar partir una capa entre páginas.
- Cada capa cabe en un área limitada (margen `[40, 0, 40, 4]` para que no llegue al borde).

### Diferencia FRS vs DS (a memorizar)
- **FRS**: "el sistema generará un código único MC-YYYYMMDD-NNNN al registrar muestras"
- **DS**: "Sample Manager (Java/WildFly) genera el código mediante secuencia Oracle SAMPLE_SEQ + plantilla configurada en CONFIG_PARAMS.SAMPLE_PATTERN. La generación es atómica con la inserción en SAMPLES."

### En GAMP 4, el DS documenta CONFIGURACIÓN no DESARROLLO
- Si una decisión del DS dice "se programa..." en GAMP 4 → está mal.
- En GAMP 4 todo es: "se configura el parámetro X en el módulo Y", "se selecciona el workflow Z de los disponibles", "se carga la plantilla W en el motor de reportes".
- En GAMP 5 (custom) sí se permite hablar de lenguajes, frameworks, código.

### Cobertura completa de FRS — es la regla más importante del DS
- Cada FRS debe estar referenciado en al menos UNA sección del DS:
  - FRS funcionales → Tabla de Componentes (columna "FRS asociados")
  - FRS de interfaz → Tabla de Diseño de Interfaz Técnica
  - FRS de seguridad → Tabla de Diseño de Seguridad Técnica
  - FRS de backup/HA → Tabla de Componentes (Backup & HA) y Modelo de Datos
- Si un FRS no aparece, falta documentar el componente o decisión que lo implementa.

### Sección de seguridad técnica con parámetros concretos
- TLS: especificar versión y suite (`TLS 1.3 ECDHE-RSA-AES256-GCM-SHA384`).
- Contraseñas: parámetros numéricos (mín N chars, rotación X días, histórico Y).
- Timeout sesión: minutos exactos.
- Bloqueo cuenta: intentos / ventana / duración.
- Audit Trail: implementación concreta (trigger DB, WORM, retención).
- Sin "cifrado fuerte" o "buena política de contraseñas" como descripción.

### Configuración GxP del cliente — valores reales
- La sección de Configuración GxP debe tener valores reales del cliente, no placeholders.
- Cantidad concreta de workflows, plantillas, roles, integraciones activas.
- Si el skill no tiene los valores, debe pedirlos al usuario (no inventar).

### Matriz de aprobaciones del DS — incluye Arquitecto Vendor
- En GAMP 4 con vendor externo: el Arquitecto Vendor es co-autor del diseño (no solo revisor).
- Total típico: 6 firmantes (Validador, Arquitecto Vendor, Revisor IT, Process Owner, Jefe Validaciones, Gerente QA).
- En GAMP 5 puro custom, reemplazar Arquitecto Vendor por Tech Lead interno.

### Anchos verificados DS (suman 455)
- Tabla Responsabilidades: `[160, 295]`
- Tabla Definiciones: `[125, 330]`
- Tabla Componentes: `[115, 145, 90, 105]`
- Tabla Interfaz Técnica: `[55, 165, 85, 60, 90]`
- Tabla Modelo de Datos: `[120, 195, 60, 80]`
- Tabla Seguridad Técnica: `[125, 235, 95]`
- Tabla Configuración GxP: `[140, 315]`

---

## Lecciones específicas de RA

### PRINCIPIO RECTOR — SEVERIDAD INMUTABLE
- **La Severidad (S, también llamada Gravedad) NO baja con mitigación.** Es propiedad inherente del peligro, no del control.
- La mitigación reduce **solo P (Probabilidad)** y/o **D (Detectabilidad)**.
- Por eso: `RR = S × P_post × D_post` y siempre `RR ≥ S × 1 × 1 = S`.
- Regla de validación obligatoria del skill: antes de escribir `RR`, verificar que `RR / S` sea entero ≥ 1. Si no, está mal calculado.
- Esta regla se enuncia explícitamente en la `notaInferior` de la tabla-fmea (renderizada con borde azul destacado).
- Conforme ISO 31000, ICH Q9 R1 y GAMP 5.

### División de roles en cálculo
- **Renderer**: calcula `RI = S × P × D` y lo pinta. NO calcula RR.
- **Skill (Claude Desktop)**: calcula `RR` respetando S inmutable. Lo pasa pre-calculado en el JSON.
- **Validador humano**: revisa que el RR sea coherente con el control documentado.

### Tipos NUEVOS exclusivos de RA
1. **`escalas-fmea`** — grid 2×2 con 4 mini tablas (S, P, D, niveles RI/RR). Layout compacto que cabe en una sola página. Acepta `nota` que se renderiza con borde azul a la izquierda.
2. **`tabla-fmea`** — matriz principal con 9 columnas: RA-ID | URS | Peligro | S | P | D | RI | Control | RR. Las celdas RI/RR son `stack` con número grande + nivel pequeño coloreado. Soporta sub-headers de módulo. La `notaInferior` queda destacada con borde y fondo amarillo.
3. **`aceptacion-riesgo-residual`** — caja conclusion + items numerados + tabla mini de firmas (default 2: Process Owner + Gerente QA). NO usar `tabla-firmas-final` para RA.

### Colores de niveles de riesgo (FMEA standard)
- BAJO (1-6) → verde `#27AE60`
- MEDIO (7-14) → naranja `#E67E22`
- ALTO (15-27) → rojo `#C0392B`
- Estos colores se aplican automáticamente por el renderer en RI y RR.

### Anchos verificados RA tabla-fmea (suman 401, FIJOS — usa layout denso)
- `[35, 46, 90, 16, 16, 16, 28, 120, 34]`
- RA-ID 35 | URS 46 | Peligro 90 | S 16 | P 16 | D 16 | RI 28 | Control 120 | RR 34
- Total **401** (no 455) porque usa `vsTableLayoutDense()` con padding 3px lateral (6px por celda × 9 cols = 54). El padding NO se cuenta dentro de los widths — pdfMake lo suma aparte.
- Regla general: si una tabla con muchas columnas (≥7) usaba `vsTableLayout()` (padding 6) sumaba ~84+ extra que desbordaba. Con `vsTableLayoutDense()` (padding 3) el extra se reduce a la mitad.
- Estos anchos son fijos en el renderer (no configurables vía JSON) porque están optimizados para que las columnas SPD sean compactas (números cortos) y Peligro/Control tengan espacio.

### Sub-headers en tabla-fmea
- Cada fila puede ser `{ "subheader": "MÓDULO X — ..." }` para agrupar por módulo funcional.
- A diferencia de URS/FRS, en RA/IRA el `headerRows: 1` **se mantiene siempre** (también con sub-headers). Razón: las matrices FMEA tienen muchas columnas (9-10) y al lector se le hace imposible orientarse sin el header (P/G/I/IRA/Verif son siglas que nadie recuerda 5 páginas adentro).
- Trade-off aceptado: cuando un sub-header queda al inicio de página, puede aparecer "header tabla + sub-header" pegados (lo que en URS llamábamos "doble encabezado"). En FMEA se considera preferible al alternativa de perder contexto de columnas.
- `keepWithHeaderRows: 1` ayuda a que el header no quede solo al final de página sin filas debajo.

### Trazabilidad obligatoria
- Cada riesgo `urs` lista 1+ URS de origen separados por ` | `.
- GAPs del HLRA se mencionan en el campo `control` (ej: "GAP-001: ..."). NO en columna separada.
- En el campo `control` también se mencionan los TC del POQ que verificarán el control (ej: "TC-OQ-006 verifica...").
- Esta triple trazabilidad (URS↔RA↔TC) se materializa después en la MTR.

### Aceptación formal — solo 2 firmas por default
- Diferencia con `tabla-firmas-final` (que tiene 4-5 firmantes): la aceptación formal del riesgo residual es responsabilidad **únicamente** de Process Owner + Gerente QA.
- Para sumar firmantes en proyectos críticos, override vía `rolesPlaceholder`.

---

## Lecciones específicas de IRA

### IRA NO es lo mismo que RA — distinta metodología
- **RA** usa `S × P × D` (FMEA clásico) con niveles 1-6 BAJO / 7-14 MEDIO / 15-27 ALTO. Granularidad por modo de fallo. Tiene mitigación con RR.
- **IRA** usa `P × G × I` (Proceso GxP × Gravedad × Integridad de Datos) con niveles **1-4 BAJO / 5-8 MEDIO / 9-27 ALTO** (rangos distintos). Granularidad por componente técnico. NO tiene mitigación: el IQ mismo es la "verificación" que justifica el componente.
- Output operativo del RA = test cases del POQ. Output del IRA = alcance y profundidad del PIQ.

### Gravedad inmutable (analogía con S del RA)
- En IRA, la **G (Gravedad)** es propiedad inherente del componente, igual que la S del RA.
- Aunque IRA no tenga "RR", el principio aplica: la verificación exhaustiva en el IQ no "baja G" — solo confirma instalación correcta.
- En la `nota` de `escalas-ira` se enuncia este principio explícitamente.

### Tipos NUEVOS exclusivos de IRA
1. **`escalas-ira`** — grid 2×2 con escalas P, G, I y niveles de profundidad de IQ. Estructura visual idéntica a `escalas-fmea` pero con métricas y rangos distintos.
2. **`tabla-componentes-ira`** — matriz principal con 10 columnas: COMP-ID | Tipo | Componente | Descripción | P | G | I | IRA | Verif. IQ | TC-IQ. La columna "Verif. IQ" se rellena automáticamente del nivel calculado (Básica/Estándar/Exhaustiva). Sub-headers por categoría.
3. **`tabla-alcance-piq`** — tabla detallada componente → IRA → criterio de aceptación → TC-IQ. Es el **output operativo del IRA** que alimenta directamente al PIQ. No incluye sub-headers.

### Convención de naming componentes
- Prefijos OBLIGATORIOS por categoría:
  - `COMP-SW-NN` (Software): app, panel, motor, módulo
  - `COMP-INF-NN` (Infraestructura): servidor, BD, storage, backup, red, UPS, climatización
  - `COMP-SEC-NN` (Seguridad): TLS, firewall, IAM, VPN, política contraseñas, MFA
- Test cases siempre `TC-IQ-NNN`.

### Categorías difieren según arquitectura
- **Cloud (SaaS/PaaS)**: 3 categorías estándar (Software / Cloud Infra / Seguridad). El proveedor de hosting cubre el resto.
- **On-premise**: incluir adicionalmente componentes de **facility** (UPS, climatización, detección de incendios, cableado estructurado, switches físicos). Estos suelen olvidarse cuando el equipo viene del mundo cloud — el skill los menciona explícitamente.

### Anchos verificados IRA (ambas usan layout denso)
- `tabla-componentes-ira` (10 cols, suma **395** + 60 padding = 455): `[45, 32, 58, 110, 14, 14, 14, 25, 42, 41]`
- `tabla-alcance-piq` (6 cols, suma **419** + 36 padding = 455): `[46, 70, 26, 124, 121, 32]`
- Tabla Resumen (común, layout estándar): `[165, 60, 80, 80, 70]` suma 455.
- Recordatorio: las tablas FMEA usan `vsTableLayoutDense()` (padding 3px lateral) — los widths NO incluyen padding.

### Colores de niveles IRA (distintos al RA porque rangos cambian)
- BAJO (1-4) → verde `#27AE60` (mismo color que RA pero rango distinto)
- MEDIO (5-8) → naranja `#E67E22`
- ALTO (9-27) → rojo `#C0392B`

### División de alcance RA vs IRA en sistemas on-premise
- RA: software + lógica de negocio + workflows + interfaces + audit trail (lógica)
- IRA: hardware + red + OS + BD + facility + backup físico + HA infraestructural
- Audit trail va en RA (es lógica del software). Backup físico va en IRA.
- En sistemas cloud-hosted, el módulo F del RA puede absorber riesgos de infra y el IRA queda más "magro" (cubierto por SOC-2 del proveedor).

---

## Lecciones específicas de RRM

### Documento DIFERENCIADOR del paquete
- El RRM (ex-MCN) es lo que diferencia el paquete DRP de la competencia: trazabilidad cruzada Norma↔URS↔RA↔TC en una sola fuente, con estados visuales que un auditor entiende en 5 segundos.
- Es el documento que se abre primero en una auditoría regulatoria.

### Tipos NUEVOS exclusivos de RRM
1. **`tabla-norma`** — matriz por cada dimensión normativa con 8 columnas: Punto | Requisito | Aplic. | **Estado coloreado** | URS | RA Ref. | TC-OQ | Observaciones. Soporta sub-headers de capítulo o subpart (ej. SUBPART B / SUBPART C en 21 CFR Part 11). Headers densos (fontSize 8, margin lateral 3) y `vsTableLayoutDense()` por la cantidad de columnas.
2. **`tarjeta-gap-rrm`** — tarjeta detallada por GAP. Header pintado por severidad (Mayor/Crítico=rojo, Menor=naranja). Tabla key-value con campos estructurados: norma, requisito, impacto, descripción, URS afectados, controles compensatorios (array → lista numerada o string → párrafo), acción requerida. Flag visual destacado "⚠ REQUIERE FIRMA FORMAL" cuando `requiereFirma: true`.

### Estados coloreados (palabra exacta requerida)
- `CUMPLE` → verde `#1E7E34` con fondo `#E8F5E9`
- `PARCIAL` → naranja `#B85F0F` con fondo `#FFF4E5`
- `GAP` (o `NO CUMPLE`) → rojo `#A52A2A` con fondo `#FDECEA`
- `N/A` → gris `#717D8A` con fondo `#F4F6F8`
- El renderer aplica el color por palabra exacta. Variantes como "Conforme" o "Cumple parcial" NO funcionan.

### Sección de GAPs es OPCIONAL — supeditada a su existencia
- Si el sistema NO tiene GAPs → omitir la sección completa o reemplazar por un mensaje breve ("No se identificaron brechas regulatorias durante el mapeo realizado").
- NO incluir tarjetas-gap-rrm vacías como placeholder.
- El template-vacio incluye 1 ejemplo placeholder de tarjeta-gap-rrm que el autor debe borrar si no hay GAPs.

### `requiereFirma: true` solo en GAPs Mayores
- GAP Menor / NC Menor → `requiereFirma: false`. Acción típica: emitir versión corregida del documento afectado.
- GAP Mayor / NC Crítico → `requiereFirma: true`. Acción: aceptación formal con firma de Process Owner + Gerente QA. El renderer agrega banner destacado con borde rojo + fondo amarillo.

### 5 dimensiones estándar de mapeo
1. ANMAT 4159/2023 Anexo VI (Argentina, ~15 puntos lineales)
2. 21 CFR Part 11 (FDA USA, Subpart B siempre + Subpart C condicional)
3. EU Annex 11 / PIC/S PI 011-3 (Europa, mapeo cruzado con ANMAT)
4. ICH Q9 R1 2023 (~6 principios QRM)
5. GAMP 5 Segunda Edición 2022 (~11 capítulos)
- Total esperado: 50-60 artículos mapeados en sistemas GAMP 3/4 estándar.

### Anchos verificados RRM
- `tabla-norma` (8 cols, suma **407** + 48 padding denso = 455 con vsTableLayoutDense): `[32, 95, 28, 38, 60, 35, 35, 84]`
- Tabla resumen GAPs: `[50, 60, 90, 75, 100, 80]` suma 455 (layout normal)
- Tabla resumen cumplimiento: `[125, 50, 50, 60, 35, 135]` suma 455
- Tabla referencias: `[40, 165, 250]` suma 455

### Trazabilidad obligatoria
- Cada fila de `tabla-norma` debe tener al menos `urs` o `raRef` poblado. Si es N/A, ambos pueden ser "—" pero la observación debe justificar la N/A.
- Equivalencias ANMAT↔EU Annex 11: en la tabla de EU Annex 11 las observaciones referencian "Equivalente a ANMAT §X" para evitar duplicar texto largo.

### Subpart C de 21 CFR Part 11 — patrón típico
- Si el sistema NO tiene firma electrónica nativa: listar Subpart C como **N/A** con justificación, referenciar GAP-002 (sin firma electrónica nativa).
- Si SÍ tiene firma electrónica nativa: mapear punto por punto Subpart C como cualquier otra norma.

---

## Lecciones específicas de MTR

### VALIDACIÓN INTERNA AUTOMÁTICA — feature distintivo del MTR
- Es el primer documento del paquete que tiene **validador integrado**. El renderer llama a `VS.validateDocument(data)` antes de generar el PDF y agrega una **caja destacada** al inicio con el resultado:
  - ✓ verde "Validación interna OK" si no hay inconsistencias
  - ⚠ amarillo "Validación con advertencias" si hay warnings
  - ✕ rojo "Validación FALLIDA" si hay errors
- Configurable vía `_validacion`:
  - `estricta: true` → aborta render si hay errors (muestra texto rojo grande)
  - `estricta: false` (default) → solo muestra la caja con detalle
  - `mostrarCaja: false` → oculta la caja (útil para versiones finales firmadas)

### Engine extensible: `js/validation-suite/core/document-validator.js`
- `VS.validators[type]` mapa de validators por tipo de documento.
- `VS.validateDocument(data)` API genérica que dispatcha al validator correcto.
- Helpers exportados: `VS.validatorHelpers.ID_PATTERNS`, `matchesIdPattern`, `splitMultiId`.
- Reglas chequeadas en MTR: formato de IDs, unicidad URS, cobertura URS→TC-OQ, criticidad válida, coherencia conteo resumen vs filas reales.
- **Diseñado para extender**: futuros validadores (RA, IRA, RRM) se agregan sin tocar el engine.

### Tipos NUEVOS exclusivos de MTR
1. **`tabla-trazabilidad`** — matriz principal con 8 columnas: URS-ID | Descripción | **Criticidad coloreada** | Módulo | RA-ID | TC-IQ | TC-OQ | Fecha Ejecución. Sub-headers de módulo.
2. **`caja-validacion`** — auto-inyectada por el renderer (no se pone en el JSON). Borde lateral del color del estado (verde/amarillo/rojo) + lista de errores y warnings (top 8 cada uno).

### Patrones de IDs validados (regex en `ID_PATTERNS`)
- `URS`: `^URS-(\d{3,4}|NF-\d{3,4})$` → URS-001, URS-NF-005
- `RA`: `^RA-\d{3,4}$` → RA-024
- `IRA`: `^COMP-(SW|INF|SEC)-\d{2,3}$` → COMP-SW-01
- `TC_IQ` / `TC_OQ`: `^TC-(IQ|OQ)-\d{3}$` → TC-IQ-014, TC-OQ-047
- `GAP`: `^GAP-\d{3}$`
- `FRS`: `^FRS-(\d{3}|IF-\d{3})$`

Multi-IDs en una celda: separados por ` | ` (con espacios). Ej: `"TC-IQ-002 | TC-IQ-012"`. El validador hace split y valida cada uno.

### Anchos verificados MTR (suman 407 + 48 padding denso = 455)
- `tabla-trazabilidad` (8 cols): `[40, 130, 45, 50, 35, 35, 35, 37]`

### Cobertura URS→TC-OQ debe ser 100%
- Regla GAMP 5 §7.4: cada URS debe tener al menos un TC-OQ asignado.
- El validador genera **error** (no warning) si encuentra un URS sin TC-OQ.
- TC-IQ es opcional según módulo (URS funcional puro NO requiere TC-IQ).

### TODO futuro: cross-validation
- La validación INTERNA de hoy (autocontención) es Fase 1.
- Fase 2 será validación CRUZADA: cada URS-ID en MTR debe existir en URS-DRP-SIS-001.json, cada RA-ID en RA, etc. Requiere "workspace" en la UI que cargue múltiples JSONs.
- El engine actual está preparado: agregar `VS.crossValidate({ urs, ra, mtr, ... })` cuando llegue.

---

## Lecciones específicas de PIQ + IIQ (Calificación de Instalación)

### Schema unificado de Test Case — un objeto sirve para 2 documentos
- El mismo objeto `testCase` se usa en PIQ (protocolo) y IIQ (informe).
- **PIQ**: campos de ejecución (`estado`, `ejecutor`, `fechaEjecucion`, `firma`, `evidenciasGestor`, `hallazgos`) **NO presentes** o `null`.
- **IIQ**: esos campos **poblados** con datos de ejecución.
- El renderer detecta el modo (`mode='protocolo'` o `mode='informe'`) y rendea distinto.
- Ventaja: un solo schema, un solo "language" para Claude Desktop, máxima reutilización.

### Renderer compartido `_iq-shared.js` — `VS.iqShared`
- API expuesta: `renderMatrizUnificadaTC`, `renderBloqueTestCase`, `renderSeccionTabla`, `renderSeccionMatriz`, `nivelIraScore`, `estadoTcColor`, `isModeInforme`.
- Cargar **antes** de piq.js e iiq.js en `index.html`.
- El piq.js y el iiq.js solo registran el type y delegan al shared.

### Tipos NUEVOS para PIQ/IIQ
1. **`matriz-tc`** — vista ejecutiva: 1 fila por TC. 7 columnas (TC-ID | Título | Componente | RA | URS | Profundidad | Estado). En PIQ "Estado" muestra "PENDIENTE", en IIQ muestra PASS/FAIL coloreado.
2. **`tabla-test-case`** — bloques detallados por TC. Soporta `agruparPorGrupo: true` que inserta sub-headers azules por grupo funcional. Cada bloque: header del TC + tabla metadata (4 cols) + objetivo + precondiciones + criterios + evidencia esperada + resultado.
3. **`resumen-ejecucion-iq`** (solo IIQ) — auto-calcula PASS/FAIL/OBS/NA por grupo desde el array `tcs`. Caja de decisión final (verde/rojo según resultado global).
4. **`hallazgos-consolidados`** (solo IIQ) — recolecta los `hallazgos` embebidos en cada TC y los muestra en tabla unificada. Si todos los TCs tienen `hallazgos: []`, muestra "Sin hallazgos" en caja verde.

### Filosofía CSA — el cambio mental más importante del PIQ/IIQ
- **CSV viejo (que NO seguimos)**: scripts micro-prescriptivos paso a paso ("abrir browser, navegar URL, verificar HTTPS"). Mucho papeleo, poca evidencia útil.
- **CSA moderno (FDA 2022, que SÍ seguimos)**: **risk-based, criterios consolidados, evidencia proporcional al impacto**. Cada TC tiene 2-6 criterios de qué se verifica, no 10 pasos de cómo hacerlo.
- En el JSON: usar `criterios: [...]` (array corto) + `evidenciaEsperada: "..."` (string descriptivo). NO crear `pasos: [...]` con `instruccion`/`resultadoEsperado`.
- Sección obligatoria al final del PIQ: "Justificación de Proporcionalidad / Critical Thinking" — explica por qué el alcance es suficiente para la categoría GAMP del sistema. Sin esa sección un auditor pregunta "¿por qué tan poco?".

### Profundidad heredada del IRA-Score
- IRA-Score 9-27 (ALTO) → `profundidad: "Exhaustiva"`
- IRA-Score 5-8 (MEDIO) → `profundidad: "Estándar"`
- IRA-Score 1-4 (BAJO) → `profundidad: "Básica"`
- El renderer pinta la profundidad con el color del nivel para que el ejecutor identifique rápido los TCs críticos.

### Trazabilidad declarativa — sin auto-import
- Cada TC declara explícitamente: `componente` (formato IRA `COMP-XX-NN`), `ursVinculados` (array), `raVinculado` (formato `RA-NNN`).
- El JSON del PIQ/IIQ es **standalone** — no importa datos de otros JSON. Esto preserva trazabilidad regulatoria (un auditor pregunta "¿de dónde sale este dato?" → respuesta: "del JSON declarado por el validador").
- Validación cruzada con IRA/URS/RA queda para Fase 2 (workspace concept).

### Vinculación con el Gestor de Evidencias (Fase 2-friendly)
- En el IIQ, `evidenciasGestor` es un array por TC con refs a las capturas hechas en el Gestor.
- El campo `testCaseRef` que agregamos a las capturas del Gestor matchea con `tcId` del TC.
- Hoy: el skill IIQ recibe info del usuario sobre evidencias y las pone en el array.
- Futuro: la UI carga IIQ + proyecto del Gestor y autocompleta `evidenciasGestor` con imágenes incrustadas.

### Validador PIQ + IIQ (esEsforme=true para IIQ)
- Función única `validateIqDocument(data, esInforme)` que se reusa para PIQ e IIQ con flag.
- Reglas comunes: `tcId` formato regex, unicidad, `componente` formato IRA, `raScore` 1-27, criticidad de URS válida, `criterios` debe tener al menos 1 (sino warning "enfoque CSA requiere criterios consolidados").
- Reglas IIQ extras: TCs con `estado` poblado deben tener `ejecutor` + `fechaEjecucion` (warning si falta), hallazgos formato `NC-NNN`, severidad válida.

### Anchos verificados PIQ/IIQ (suman 413 + 42 padding denso = 455)
- `matriz-tc` (7 cols): `[35, 130, 60, 30, 60, 50, 48]`
- `tabla-test-case` no es una tabla individual sino bloques apilados — usa anchos de tabla key-value para metadata: `[85, 145, 75, 145]` = 450 + padding default 12*4=48 ≈ ojo aquí, son 4 cols × 12 padding = 48, 450+48 = 498 (excede). FIX: usar anchos `[85, 145, 75, 145]` con `vsTableLayout` da 498 que pasa el ancho. Verificar visualmente — si desborda, ajustar.

### Decisión: 2 types separados, no flag mode en uno solo
- Optamos por `type: "PIQ"` y `type: "IIQ"` separados (consistente con HLRA, VP, URS, etc.).
- NO usamos un único type con `mode: "protocolo"` / `"informe"`.
- Razón: cada documento se firma independientemente y tiene su propio control de cambios. El IIQ puede tener varias versiones (re-ejecuciones) sin tocar el PIQ aprobado.

---

## Notas finales

- Cuando se agregue un nuevo tipo de documento, copiar este archivo y agregar al final una sección "Lecciones específicas de {TIPO}".
- Si surgen patrones nuevos (ej. tablas con merging, gráficos, etc.), agregarlos a este doc antes de codear.
- El objetivo es que el primer PDF generado de un nuevo tipo de documento ya salga 90% bien.
