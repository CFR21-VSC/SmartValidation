---
name: vp-generator
description: Genera el JSON de un documento VP (Validation Plan / Plan de Validación) para la Validation Suite de DRP. Usar cuando el usuario tiene un HLRA aprobado y necesita el Plan de Validación que define la estrategia, cronograma, criterios de aceptación, gestión de NCs y los documentos del paquete a generar. El VP es el segundo documento del paquete y deriva sus decisiones del HLRA. El JSON resultante es input directo del renderer VP — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# VP Generator — Validation Suite

Generador del documento **VP (Validation Plan / Plan de Validación)** según GAMP 5 Segunda Edición, ANMAT 4159/2023 Anexo VI e ICH Q9.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes (anchos de tabla, márgenes, matriz de aprobaciones extensible, etc.). Este skill solo cubre lo específico del VP.

## Cuándo usar este skill

- El usuario ya tiene el HLRA aprobado (o lo provee como input).
- Necesita el plan de acción concreto que traduce el HLRA en estrategia ejecutable.
- Inputs típicos:
  - HLRA generado previamente (categoría GAMP, IRO, GAPs)
  - Cronograma estimado (semanas)
  - Lista de personas y roles
  - Lista de documentos a generar en el paquete

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Estructura del JSON VP

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "VP",
  "package": { /* mismo de HLRA */ },
  "document": {
    "code": "VP-<CODIGO-INVENTARIO>",
    "titleEs": "PLAN DE VALIDACIÓN",
    "titleEn": "VALIDATION PLAN (VP)",
    "headerTitle": "Plan de Validación (VP)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador | En revisión",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA>",
    "normativeFramework": "<de HLRA>",
    "extras": {
      "Documento base (HLRA)": "HLRA-<CODIGO> v<VERSION>",
      "Tipo de Validación": "Prospectiva | Retrospectiva | Concurrente"
    }
  },
  "controlCambios": [...],
  "matrizAprobaciones": [...],
  "trazabilidad": {
    "recibeDe": ["HLRA"],
    "alimentaA": ["URS", "RA", "IRA", "RRM", "MTR", "PIQ", "POQ"]
  },
  "validationScope": {
    "iq": true,
    "oq": true,
    "pq": false
  },
  "secciones": [...]
}
```

**Importante**: el `document.extras` permite agregar campos en la portada que el HLRA no tiene (Documento base, Tipo de Validación). El renderer los muestra automáticamente en la tabla de metadata.

## Secciones obligatorias del VP (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

```json
{
  "tipo": "texto",
  "titulo": "PROPÓSITO",
  "bloques": [
    { "texto": "El presente Plan de Validación (VP) establece la estrategia, alcance, responsabilidades, documentos a generar, cronograma y criterios de aceptación para la validación del sistema <NOMBRE>, conforme a GAMP 5 Segunda Edición (2022)..." },
    { "texto": "Este documento toma como input el análisis de criticidad de alto nivel (HLRA-<CODIGO> v<X>), que determinó la categoría GAMP <N> y un IRO de <VALOR> (nivel <BAJO|MEDIO|ALTO>), y lo traduce en un plan de acción concreto, ejecutable y auditable." }
  ]
}
```

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

```json
{
  "tipo": "lista-incluido-excluido",
  "titulo": "ALCANCE",
  "subIncluido": "2.1 Incluido en este Plan",
  "incluido": [
    "Sistema: <nombre> v<X> — URL/Acceso: <...>",
    "Organización: <empresa> — Mercado regulatorio: <...>",
    "Fases cubiertas: Especificación (URS) → Análisis de riesgos (RA/IRA) → Cumplimiento normativo (RRM) → Calificación (IQ/OQ) → Cierre (VSR)",
    "Tipo de validación: <Prospectiva|Retrospectiva|Concurrente> — <justificación corta>"
  ],
  "subExcluido": "2.2 Excluido de este Plan",
  "excluido": [
    "Infraestructura cloud subyacente — calificada por el proveedor de hosting",
    "Validación desde perspectiva del desarrollador (GAMP 5 interno)",
    "Performance Qualification (PQ/PPQ): <No aplica/Aplica> — <justificación si no aplica>"
  ]
}
```

### 3. RESPONSABILIDADES (`tipo: "tabla"`)

3 columnas: Rol | Nombre | Responsabilidad principal.

```json
{
  "tipo": "tabla",
  "titulo": "RESPONSABILIDADES",
  "columnas": ["Rol", "Nombre", "Responsabilidad principal"],
  "widths": [120, 130, 205],
  "filas": [
    ["Project Manager / Validador", "<nombre>", "Liderar el proyecto..."],
    ["Process Owner", "<nombre>", "Revisar y aprobar..."],
    ["Administrador del Sistema", "<nombre>", "Proveer acceso..."],
    ["QA / Revisor Regulatorio", "<nombre>", "Aprobar documentos..."],
    ["Ejecutor de Protocolos", "<nombre>", "Ejecutar test cases..."]
  ]
}
```

### 4. DEFINICIONES (`tipo: "tabla"`)

Tabla 2 columnas: Término | Definición. Incluir SIEMPRE estos términos:

- Validación, IQ, OQ, PQ, URS, TC, GAMP 5, NC, CAPA, Desviación
- RRM, IRO (Índice de Riesgo Operativo), IRA, NCR, RIQ/ROQ, VSR
- Términos específicos del sistema (ej: SHA-256, COTS) si aparecen en otras secciones

```json
{
  "tipo": "tabla",
  "titulo": "DEFINICIONES",
  "columnas": ["Término", "Definición"],
  "widths": [110, 345],
  "filas": [
    ["Validación", "Proceso documentado que proporciona evidencia objetiva..."],
    ["IQ — Installation Qualification", "Calificación de instalación..."],
    ["OQ — Operational Qualification", "Calificación operacional..."],
    ["PQ — Performance Qualification", "Calificación de performance... <si no aplica, indicarlo>"],
    ["URS", "User Requirements Specification..."],
    ["TC — Test Case", "Caso de prueba..."],
    ["GAMP 5", "Good Automated Manufacturing Practice..."],
    ["NC — No Conformidad", "Incumplimiento de un criterio de aceptación..."],
    ["CAPA", "Corrective and Preventive Action..."],
    ["Desviación", "Incumplimiento de un procedimiento..."],
    ["RRM", "Risk Register Matrix — registro de riesgos, controles y cumplimiento normativo"],
    ["IRO", "Índice de Riesgo Operativo — calculado como producto de 6 factores (P×G×D×I×PR×S)"],
    ["IRA", "Infrastructure Risk Assessment — análisis de riesgo de componentes de infraestructura"],
    ["NCR", "Non-Conformance Report — gestión de no conformidades detectadas en la ejecución"],
    ["RIQ/ROQ", "Reporte de Decisión IQ/OQ — dictamen de liberación por fase de calificación"],
    ["VSR", "Validation Summary Report — informe final de dictamen y cierre del ciclo de validación"]
  ]
}
```

### 5. REFERENCIA AL HLRA (`tipo: "tabla-info"`)

Resumen de los hallazgos del HLRA que guían este VP. **Datos extraídos del HLRA, no inventar**.

```json
{
  "tipo": "tabla-info",
  "titulo": "REFERENCIA AL HLRA — ESTRATEGIA BASADA EN RIESGO",
  "intro": "Este Plan de Validación se basa íntegramente en los hallazgos del documento HLRA-<CODIGO> v<X>. Los datos clave que guían las decisiones de este VP son:",
  "labelWidth": 170,
  "filas": [
    { "campo": "Categoría GAMP", "valor": "GAMP <N> — <Descripción>", "boldValor": true, "colorValor": "primary" },
    { "campo": "IRO Calculado", "valor": "<VALOR> — Nivel <BAJO|MEDIO|ALTO> (rango <1-50|51-200|201-486>)", "boldValor": true, "colorValor": "accent" },
    { "campo": "Fórmula IRO aplicada", "valor": "P(<X>) × G(<X>) × D(<X>) × I(<X>) × PR(<X>) × S(<X>) = <RESULTADO>" },
    { "campo": "Tipo de validación", "valor": "<Prospectiva|...> — <contexto>" },
    { "campo": "GAPs identificados", "valor": "<N> GAPs (<detalle: 1 NC Menor, 2 Mayores aceptados, ...>) — <Bloqueante? / Ninguno bloqueante>" },
    { "campo": "Funciones críticas", "valor": "<N> funciones críticas/altas identificadas — todas verificadas en OQ" },
    { "campo": "PPQ", "valor": "No aplica — <justificación>" }
  ]
}
```

### 6. DOCUMENTOS DEL PROYECTO DE VALIDACIÓN (`tipo: "tabla"`)

**No incluir columna "Estado"** — al momento del VP todos están Pendiente, es redundante.

```json
{
  "tipo": "tabla",
  "titulo": "DOCUMENTOS DEL PROYECTO DE VALIDACIÓN",
  "intro": "El paquete documental completo para GAMP <N> con IRO <VALOR> comprende los siguientes documentos. La secuencia refleja dependencias: cada documento hace referencia al anterior.",
  "columnas": ["#", "Código", "Documento", "Responsable"],
  "widths": [25, 130, 175, 125],
  "filas": [
    ["1", "HLRA-<CODE>", "High Level Risk Assessment", "<responsable>"],
    ["2", "VP-<CODE>", "Plan de Validación", "<responsable>"],
    ["3", "URS-<CODE>", "User Requirements Specification", "<responsable>"],
    ["4", "RA-<CODE>", "Risk Assessment (operativo)", "<responsable>"],
    ["5", "IRA-<CODE>", "Infrastructure Risk Assessment", "<responsable>"],
    ["6", "PIQ-<CODE>", "Protocolo de Calificación de Instalación", "<responsable>"],
    ["7", "POQ-<CODE>", "Protocolo de Calificación Operacional", "<responsable>"],
    ["8", "RRM-<CODE>", "Risk Register Matrix", "<responsable>"],
    ["9", "MTR-<CODE>", "Master Traceability Report", "<responsable>"],
    ["10", "RIQ-<CODE>", "Reporte de Decisión IQ", "<responsable>"],
    ["11", "ROQ-<CODE>", "Reporte de Decisión OQ", "<responsable>"],
    ["12", "NCR-<CODE>", "Non-Conformance Reports", "<responsable>"],
    ["13", "VSR-<CODE>", "Validation Summary Report", "<responsable>"]
  ]
}
```

Seguido inmediatamente de una `caja-nota` (callout amarillo):

```json
{
  "tipo": "caja-nota",
  "titulo": "Notas sobre el paquete documental",
  "parrafos": [
    "Al momento de aprobación de este Plan, todos los documentos del paquete (excepto HLRA y este VP) están en estado Pendiente por avance natural del desarrollo. La completitud y aprobación de cada uno se verifica al momento del cierre del VSR.",
    "Documentos NO aplicables para GAMP <N>: <lista> — Justificados en HLRA-<CODE> Sección 6.3."
  ]
}
```

### 7. CRONOGRAMA (`tipo: "tabla"` con bullets en celdas)

Estimación según la categoría GAMP. Para GAMP 3 ≈ 3 semanas. Para GAMP 5 ≈ 8-12 semanas.

**Importante**: las celdas con listas de actividades/documentos usan el formato `{ bullets: [...] }`:

```json
{
  "tipo": "tabla",
  "titulo": "CRONOGRAMA DEL PROYECTO",
  "intro": "Estimación basada en GAMP <N> — IRO <NIVEL>. Tiempo total estimado: <X> semanas calendario desde aprobación de este VP.",
  "columnas": ["Semana", "Actividades", "Documentos generados", "Hito de cierre"],
  "widths": [50, 175, 130, 100],
  "filas": [
    [
      { "text": "S1", "alignment": "center", "bold": true },
      { "bullets": ["Aprobación VP", "Redacción URS", "Análisis de riesgos RA", "..."] },
      { "bullets": ["URS-<CODE>", "RA-<CODE>", "IRA-<CODE>"] },
      "URS aprobado por Process Owner"
    ],
    /* ... más semanas ... */
  ]
}
```

Después del cronograma, agregar nota condicional:

```json
{
  "tipo": "caja-nota",
  "parrafos": ["Nota: El cronograma puede ajustarse si se identifican desviaciones o NCs durante la ejecución que requieran investigación y CAPA antes del cierre."]
}
```

### 8. ALCANCE DE CALIFICACIÓN IQ / OQ

> **Nota de scope**: el VP define el *alcance y criterios* de cada fase (qué áreas cubre el IQ/OQ, criterio de aceptación numérico). Las tablas de test cases paso-a-paso, evidencias y resultados van en **PIQ/IIQ/RIQ** (IQ) y **POQ/IOQ/ROQ** (OQ). Mantener las tablas de esta sección en no más de 8-10 filas resumen.

Sección con introducción + 3 sub-secciones (8.1 IQ, 8.2 OQ, 8.3 PQ).

```json
{
  "tipo": "texto",
  "titulo": "ALCANCE DE CALIFICACIÓN IQ / OQ",
  "bloques": [
    { "texto": "Esta sección define el alcance funcional de las calificaciones IQ y OQ. <Si aplica/no aplica PQ, justificar acá>." }
  ]
}
```

#### 8.1 IQ — Installation Qualification

```json
{
  "tipo": "subseccion",
  "titulo": "8.1 Installation Qualification (IQ)",
  "intro": "<descripción del alcance del IQ para este sistema>"
}
```

Seguido de la tabla de áreas de verificación:

```json
{
  "tipo": "tabla",
  "columnas": ["Área de verificación IQ", "Qué se verifica", "Criterio de aceptación"],
  "widths": [140, 195, 120],
  "filas": [
    /* áreas estándar IQ: Accesibilidad, Versión, Autenticación, Sesión, Bloqueo,
       Roles, SLA, Backup, Documentación */
  ]
}
```

Y caja-nota con criterio de aceptación:

```json
{
  "tipo": "caja-nota",
  "titulo": "Criterio de aceptación IQ",
  "parrafos": ["100% de TCs con resultado PASA o PASA CON OBSERVACIONES. Cualquier NO PASA detiene la ejecución y abre una NC."]
}
```

#### 8.2 OQ — Operational Qualification

Misma estructura que 8.1 pero con áreas funcionales y prioridad:

```json
{
  "tipo": "tabla",
  "columnas": ["Área funcional OQ", "Qué se verifica", "Prioridad"],
  "widths": [150, 230, 75],
  "filas": [
    ["<área funcional>", "<verificación>", { "text": "Crítica | Alta | Media", "alignment": "center", "bold": true, "color": "<color según prioridad>" }]
  ]
}
```

Colores recomendados:
- Crítica → `"#C0392B"` (rojo)
- Alta → `"#E67E22"` (naranja)
- Media → `"#717D8A"` (gris)

#### 8.3 PQ — Performance Qualification

Si **no aplica**, usar `caja-justificacion`:

```json
{
  "tipo": "subseccion",
  "titulo": "8.3 Performance Qualification (PQ) — No Aplica"
},
{
  "tipo": "caja-justificacion",
  "titulo": "Justificación de exclusión de PQ",
  "parrafos": [
    "<sistema> es un sistema de <descripción>. No controla procesos de manufactura, no genera datos de producto ni tiene métricas de performance críticas...",
    "Según GAMP 5 Sección 8.4 y la guía ISPE para GAMP <N>, el PQ es opcional y se omite cuando no existen KPIs de performance con impacto GxP directo. El IRO de <VALOR> respalda esta decisión."
  ]
}
```

Si **sí aplica** PQ, usar tabla similar a IQ/OQ.

### 9. DECISIONES DE EJECUCIÓN (`tipo: "tabla-decisiones-tc"`)

**Sección obligatoria** que explica los 4 resultados posibles de un TC. La tabla viene predefinida — solo se necesita el título e intro.

```json
{
  "tipo": "tabla-decisiones-tc",
  "titulo": "DECISIONES DE EJECUCIÓN — CRITERIOS DE RESULTADO",
  "intro": "Cada test case ejecutado durante el IQ y el OQ produce uno de los siguientes 4 resultados posibles. La acción derivada de cada resultado es definitoria para el avance o detención de la fase de calificación."
}
```

El renderer pone automáticamente las 4 filas (PASA, PASA CON OBSERVACIONES, NO PASA, NO APLICA) con sus colores, significados, impactos y acciones. Si querés override, podés pasar `filas: [...]` con el mismo schema.

### 10. GESTIÓN DE DESVIACIONES Y NC

```json
{
  "tipo": "tabla",
  "titulo": "GESTIÓN DE DESVIACIONES Y NO CONFORMIDADES",
  "intro": "10.1 Clasificación de severidad",
  "columnas": ["Severidad", "Definición", "Acción requerida"],
  "widths": [80, 215, 160],
  "filas": [
    [{ "text": "CRÍTICA", "alignment": "center", "bold": true, "color": "#C0392B" }, "<def>", "<acción>"],
    [{ "text": "MAYOR", "alignment": "center", "bold": true, "color": "#E67E22" }, "<def>", "<acción>"],
    [{ "text": "MENOR", "alignment": "center", "bold": true, "color": "#2980B9" }, "<def>", "<acción>"]
  ]
}
```

Seguido de `subseccion` 10.2 + `tabla-info` con campos de documentación de NC (NC-ID, TC referenciado, Descripción del fallo, Severidad, Causa raíz, CAPA, Resultado re-test, Estado/Cierre).

### 11. GESTIÓN DE CAMBIOS

`texto` con bullets para 11.1 (Durante validación) + `subseccion` + `tabla` para 11.2 (Post-validación).

### 12. CRITERIOS DE ACEPTACIÓN GENERALES

**Importante**: usar `caja-criterio` (banner verde) ANTES de la tabla:

```json
{
  "tipo": "caja-criterio",
  "titulo": "El sistema se considera VALIDADO cuando se cumplen TODOS los siguientes criterios"
},
{
  "tipo": "tabla",
  "titulo": "CRITERIOS DE ACEPTACIÓN GENERALES",
  "columnas": ["#", "Criterio", "Verificación"],
  "widths": [25, 270, 160],
  "filas": [
    ["1", "IQ: 100% de test cases con resultado PASA (incluye PASA CON OBSERVACIONES)", "Informe IIQ-<CODE> / Reporte RIQ-<CODE>"],
    ["2", "OQ: ≥ 95% de test cases con resultado PASA (incluye PASA CON OBSERVACIONES)", "Informe IOQ-<CODE> / Reporte ROQ-<CODE>"],
    ["3", "0 NCs críticas abiertas al momento del cierre", "Registro de NCs en ROQ/RIQ"],
    ["4", "100% de NCs mayores cerradas con CAPA aprobada", "Sección de NCs en VSR"],
    ["5", "100% de URS trazados a al menos un TC con resultado PASA", "Matriz de trazabilidad en VSR"],
    ["6", "Todos los GAPs documentados en HLRA tienen control compensatorio aceptado", "RRM-<CODE>"],
    ["7", "VSR firmado por Process Owner y Gerente QA", "VSR-<CODE>"]
  ]
}
```

### 13. REFERENCIAS

Tabla 2 columnas: Código / Referencia | Título.

Incluir siempre como mínimo:
- HLRA del paquete actual
- Manuales y SOPs del sistema
- ANMAT 4159/2023 Anexo VI
- GAMP 5 — 2da Ed. 2022
- ICH Q9 R1 (2023)
- 21 CFR Part 11
- EU Annex 11

### 14. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`)

**Siempre incluir**, al final del documento. Mismo formato que el HLRA.

```json
{
  "tipo": "tabla-firmas-final",
  "titulo": "FIRMAS DE EJECUCIÓN",
  "intro": "Las firmas digitales o electrónicas siguientes evidencian la revisión y aprobación formal de este documento. La trazabilidad legal queda registrada en el log adjunto al paquete de validación.",
  "firmas": [],
  "rolesPlaceholder": [
    "Ejecutor (Validador)",
    "Revisor (Process Owner)",
    "Aprobador (Jefe de Validaciones)",
    "Aprobador (Gerente QA)"
  ],
  "nota": "Documento sujeto a firma electrónica. La firma manuscrita en este recuadro solo aplica como respaldo físico cuando no es viable la firma digital."
}
```

---

## Reglas de contenido

### Tipo de validación

| Tipo | Cuándo aplica |
|---|---|
| **Prospectiva** | Se valida antes de poner en producción. Ideal. |
| **Retrospectiva** | Sistema ya en producción sin validación previa. Se documenta lo existente. |
| **Concurrente** | Se valida mientras se usa, en paralelo (raro, justificable). |

### Cronograma estimado por categoría GAMP

| Categoría | Tiempo típico (sistema simple) |
|---|---|
| GAMP 1 (Infraestructura) | No aplica validación funcional |
| GAMP 3 (COTS no configurado) | 3 semanas |
| GAMP 4 (COTS configurado) | 6-8 semanas |
| GAMP 5 (Custom) | 10-16 semanas |

### Criterios de aceptación numéricos

- **IQ**: 100% PASA o PASA CON OBSERVACIONES (toda falla bloquea hasta resolver).
- **OQ**: ≥ 95% PASA o PASA CON OBSERVACIONES, **0 NCs críticas abiertas**, todas las NCs mayores cerradas con CAPA.
- **Ratio TC/URS**: 1:1 a 1.2:1 (cada URS verificado por al menos un TC).

### Severidades de NC (siempre estas 4)

| Severidad | Color hex | Característica |
|---|---|---|
| **CRÍTICA** | `#C0392B` | Afecta integridad GxP, autenticación, integridad de datos. Bloqueante. |
| **MAYOR** | `#E67E22` | Función importante pero no crítica. Requiere CAPA con plazo. |
| **MENOR** | `#2980B9` | Baja criticidad / desviación procedimental sin impacto. |
| **OBSERVACIÓN** | `#27AE60` | Hallazgo sin incumplimiento de criterio de aceptación. No bloquea. |

### Campos mínimos de documentación de NC (sección 10.2)

NC-ID, TC referenciado, Descripción del fallo, Severidad, Causa raíz, CAPA, Resultado re-test, Estado / Cierre.

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **No inventar datos del HLRA**. Si el usuario no provee el HLRA, pedirle los datos clave (categoría GAMP, IRO, GAPs) antes de generar el VP.
3. **No incluir columna "Estado"** en la tabla 6 (Documentos del Proyecto). Es redundante al momento del VP.
4. **Usar siglas canónicas**: IRO (no RAI), RA (no RAI), IRA (no IRAI), RRM (no MCN), VSR (no IF).
5. **Anchos de tabla siempre suman 455** cuando se especifican.
6. **Sección 9 (DECISIONES DE EJECUCIÓN) es OBLIGATORIA**. No omitir.
7. **`type: "VP"` siempre en mayúsculas**.
8. **`document.extras` debe incluir** `"Documento base (HLRA)"` y `"Tipo de Validación"`.
9. **Si PQ no aplica**, justificar con `caja-justificacion` y referenciar el IRO calculado en el HLRA.
10. **Severidades de NC**: usar siempre los 4 colores hex exactos del listado de arriba.
11. **`validationScope` es OBLIGATORIO** en el root del JSON. Controla qué documentos genera el AI Generator automáticamente. El mapping por categoría GAMP es **estricto** — no desviarse sin justificación explícita:

    | Categoría GAMP | `iq` | `oq` | `pq` | Documentos que se saltean |
    |---|---|---|---|---|
    | **GAMP 3** (COTS no configurado) | `true` | `true` | **`false`** | PPQ, IPQ, RPQ, FRS, DS |
    | **GAMP 4** (COTS configurado) | `true` | `true` | `true`* | DS |
    | **GAMP 5** (Custom) | `true` | `true` | `true` | — |

    *Para GAMP 4: `pq: false` si el sistema no tiene KPIs de performance medibles en producción (ver criterio abajo).

    - `"iq"` → casi siempre `true`. Solo `false` para infraestructura pura (no aplica a CSV).
    - `"oq"` → `true` para toda validación CSV bajo GAMP 3/4/5.
    - `"pq"` → **PQ aplica** para LIMS, ERP, EDMS, sistemas de gestión de lotes (flujos en producción). **PQ NO aplica** para GAMP 3 ni para sistemas sin KPIs de performance con impacto GxP.

    Este campo es leído por el motor del AI Generator al aprobar el VP: si `pq: false`, salta PPQ/IPQ/RPQ automáticamente además de los skips GAMP ya aplicados al cargar el proyecto.

---

## Ejemplo de input mínimo

> "Generá el VP para el sistema CalQR (HLRA-CALQR-2026-001 v0.1, GAMP 4, IRO 48 nivel BAJO-MEDIO, 2 GAPs menores, 6 funciones críticas). Cliente Laboratorios MediCorp. Process Owner: Juan Pérez. Validador: María García. Cronograma 6 semanas. Tipo prospectiva."

El skill genera el JSON completo del VP con esos datos, los cronogramas correspondientes para GAMP 4 (6 semanas), referencia al HLRA, y todas las secciones obligatorias incluyendo las DECISIONES DE EJECUCIÓN.
