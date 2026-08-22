---
name: mtr-generator
description: Genera el JSON de un documento MTR (Requirements Traceability Matrix / Matriz de Trazabilidad de Requisitos) para la Validation Suite de DRP. Vincula cada URS con su cadena completa de trazabilidad: URS → RA-ID → TC-IQ → TC-OQ → Estado. Tiene VALIDACIÓN INTERNA automática que el renderer aplica antes de generar el PDF (formato de IDs, unicidad, cobertura, conteos coherentes). Usar cuando el usuario tiene URS, RA y al menos los esqueletos de PIQ/POQ aprobados. El JSON resultante es input directo del renderer MTR — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# MTR Generator — Validation Suite

Generador del documento **MTR (Requirements Traceability Matrix / Matriz de Trazabilidad de Requisitos)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes. Este skill solo cubre lo específico del MTR.

## Cuándo usar este skill

- El usuario ya tiene **URS y RA aprobados** + esqueletos definidos del PIQ y POQ (al menos los IDs de TC).
- Necesita demostrar **cobertura 100% URS→TC-OQ** y trazabilidad bidireccional.
- El MTR es **el documento que un auditor pide para verificar que todos los URS están cubiertos** por test cases.
- Inputs típicos:
  - URS del paquete actual (cada URS-ID listado).
  - RA del paquete actual (RA-IDs por riesgo, mapeados a URS).
  - PIQ con TC-IQ-IDs definidos (al menos los IDs).
  - POQ con TC-OQ-IDs definidos (al menos los IDs).
  - HLRA del paquete actual (para los GAPs normativos heredados).

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## VALIDACIÓN INTERNA AUTOMÁTICA

El renderer del MTR **valida automáticamente** el JSON antes de generar el PDF y agrega una caja destacada al inicio del documento con el resultado:
- ✓ verde: sin inconsistencias
- ⚠ amarillo: warnings (no bloqueantes)
- ✕ rojo: errores (bloqueantes en modo estricto)

### Reglas de validación

El skill DEBE generar JSON que pase la validación interna. Reglas chequeadas:

1. **Formato de IDs** (regex):
   - URS-ID: `URS-NNN` o `URS-NF-NNN` (3-4 dígitos)
   - RA-ID: `RA-NNN` (3-4 dígitos, separados por `|` si múltiples)
   - TC-IQ: `TC-IQ-NNN` (puede ser `—` si no aplica)
   - TC-OQ: `TC-OQ-NNN`

2. **Unicidad**: ningún URS-ID se repite en la matriz.

3. **Cobertura URS→TC-OQ obligatoria**: cada URS debe tener al menos un TC-OQ. Si no, el sistema marca **error** (el modo estricto aborta el render).

4. **Criticidad válida**: solo `CRÍTICO`, `ALTO` o `MEDIO`. Variantes ("Critico", "Alta", "Media") generan error.

5. **Coherencia del resumen**: el TOTAL declarado en la tabla "RESUMEN ESTADÍSTICO POR MÓDULO" debe coincidir con la cuenta real de filas en la matriz.

### Configuración de validación

En el JSON se puede incluir:
```json
{
  "_validacion": {
    "estricta": false,    // si true, aborta render con texto rojo si hay errors
    "mostrarCaja": true   // si false, oculta la caja de validación en el PDF
  }
}
```

Defaults: `estricta: false`, `mostrarCaja: true`.

## Estructura del JSON MTR

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "MTR",
  "package": { /* mismo de URS/RA/etc */ },
  "document": {
    "code": "MTR-<CODIGO>",
    "titleEs": "MATRIZ DE TRAZABILIDAD DE REQUISITOS",
    "titleEn": "REQUIREMENTS TRACEABILITY MATRIX (MTR)",
    "headerTitle": "Matriz de Trazabilidad de Requisitos (MTR)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA>",
    "normativeFramework": "<de HLRA>",
    "extras": {
      "Documento base (URS)": "URS-<CODE> v<X> — <N> requerimientos",
      "RA Global (HLRA)": "<N> — <NIVEL>",
      "Total Test Cases": "<N+M> (<N> IQ + <M> OQ)",
      "Cobertura URS→TC-OQ": "<%>%"
    }
  },
  "_validacion": { "estricta": false, "mostrarCaja": true },
  "trazabilidad": {
    "recibeDe": ["HLRA", "URS", "RA", "IRA", "RRM", "PIQ", "POQ"],
    "alimentaA": ["PIQ", "POQ", "IIQ", "IOQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del MTR (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

Texto en 2 párrafos. Mencionar SIEMPRE:
- Vincula cada URS con su cadena completa de trazabilidad.
- Cada URS está trazado a (a) RA, (b) PIQ cuando aplica, (c) POQ siempre.
- Trazabilidad bidireccional es requisito GAMP 5 §7.4.

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

**Incluido típico**:
- N requerimientos URS (rango)
- M riesgos RA con trazabilidad
- X TC-IQ del PIQ
- Y TC-OQ del POQ
- Z módulos funcionales

**Excluido típico**:
- Requerimientos de versiones futuras
- TC de PQ si no aplica (GAMP 3)
- Reportes de ejecución (RIQ/ROQ)

### 3. METODOLOGÍA Y LEYENDA DE COLUMNAS

Sub-sección 3.1 con texto explicando la metodología URS→Riesgo→Calificación (GAMP 5 §7.4).

Tabla "LEYENDA DE COLUMNAS" con descripción de cada columna de la matriz principal.

Tabla "ESCALA DE CRITICIDAD" con los 3 niveles coloreados (CRÍTICO rojo, ALTO naranja, MEDIO verde).

### 4. MATRIZ DE TRAZABILIDAD COMPLETA (LA TABLA PRINCIPAL — `tipo: "tabla-trazabilidad"`)

**Esta es la sección principal del documento.** Tabla con 8 columnas, agrupada por módulo:

```json
{
  "tipo": "tabla-trazabilidad",
  "titulo": "MATRIZ DE TRAZABILIDAD COMPLETA",
  "intro": "Texto introductorio.",
  "filas": [
    { "subheader": "MÓDULO A — AUTENTICACIÓN Y CONTROL DE ACCESO (URS-001 a URS-008)" },
    {
      "ursId": "URS-001",
      "descripcion": "Login con credenciales únicas (email + contraseña).",
      "criticidad": "CRÍTICO",
      "modulo": "Autenticación",
      "raId": "RA-001",
      "tcIq": "TC-IQ-014",
      "tcOq": "TC-OQ-001",
      "fechaEjecucion": null
    },
    ...
  ]
}
```

#### Reglas obligatorias por fila

1. **`ursId`**: formato exacto `URS-NNN` o `URS-NF-NNN`.
2. **`descripcion`**: resumen corto del URS (extraído del URS-DRP-SIS-001 — NO inventar).
3. **`criticidad`**: una de `CRÍTICO`, `ALTO`, `MEDIO`. Sin variantes.
4. **`modulo`**: nombre del módulo funcional (debe coincidir con el sub-header).
5. **`raId`**: RA-ID asociado, formato `RA-NNN`. Múltiples separados por ` | `. Si no hay riesgo asociado: `"—"`.
6. **`tcIq`**: TC-IQ-NNN o `"—"` si no aplica IQ. Múltiples separados por ` | `.
7. **`tcOq`**: TC-OQ-NNN — **OBLIGATORIO** (no puede ser `—`).
8. **`fechaEjecucion`**: `null` si pendiente, o `"DD/MM/YYYY"` si ya ejecutado.

#### Sub-headers de módulo

Una fila `{ "subheader": "MÓDULO X — Nombre (URS-NNN a URS-MMM)" }` antes de cada grupo. El renderer pinta el subheader con fondo azul oscuro y texto blanco, abarcando las 8 columnas.

### 5. RESUMEN ESTADÍSTICO POR MÓDULO (`tipo: "tabla"`)

Tabla con totales por módulo:

```json
{
  "tipo": "tabla",
  "titulo": "RESUMEN ESTADÍSTICO POR MÓDULO",
  "columnas": ["Módulo", "Rango URS", "Total URS", "TCs IQ", "TCs OQ"],
  "widths": [165, 120, 60, 50, 60],
  "filas": [
    ["A — Autenticación", "URS-001 a 008", { "text": "8", "alignment": "center" }, ...],
    ...
    [{ "text": "TOTAL", "bold": true, "fillColor": "#EAF1F8" }, ...]
  ]
}
```

> **Importante**: el TOTAL declarado en esta tabla debe coincidir con la cuenta real de filas en la matriz. La validación interna lo chequea — si no coincide, genera warning.

Después una `caja-conclusion` con cobertura: "Cobertura URS→TC-OQ: 100%. Estado global: PENDIENTE — pendiente de ejecución formal en Fase 6."

### 6. ANÁLISIS DE GAPS DE COBERTURA

Tres sub-secciones:

#### 6.1 URS sin TC-IQ asignado (texto)

Justifica por qué algunos módulos no tienen TC-IQ propio (verificación funcional íntegra en OQ). Para GAMP 3 esto es estándar.

#### 6.2 Cobertura OQ (texto)

Si todos los URS tienen TC-OQ → "Sin GAPs de cobertura OQ detectados".

Si hay TC-OQ que cubren múltiples URS, mencionarlos: "TC-OQ-014 cubre URS-014, URS-015 y URS-016 — diseñados conjuntamente para verificar el grupo funcional."

#### 6.3 GAPs Normativos del HLRA con Impacto en MTR (`tipo: "tabla"`)

**Tabla OPCIONAL** — solo si el HLRA identificó GAPs. Cada fila lista el GAP-ID, URS afectado, descripción y control compensatorio.

```json
{
  "tipo": "tabla",
  "titulo": "6.3 GAPs Normativos del HLRA con Impacto en MTR",
  "columnas": ["GAP-ID", "URS Afectado", "Descripción del GAP", "Control Compensatorio"],
  "widths": [55, 75, 155, 170],
  "filas": [
    ["GAP-001", "URS-003", "<descripción>", "<control comp.>"]
  ]
}
```

### 7. REFERENCIAS (`tipo: "tabla"`)

Tabla 2 columnas (`Documento | Título y Versión`). Incluir SIEMPRE:
- URS, RA, IRA, HLRA, VP del paquete actual.
- PIQ y POQ del paquete (al menos referenciados, pueden estar en generación).
- RRM del paquete actual.
- GAMP 5 — 2da Ed., ICH Q9 R1, ANMAT 4159/2023, 21 CFR Part 11.

### 8. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`)

Estándar 4 firmantes (Validador, Process Owner, Jefe Validaciones, Gerente QA). La `nota` debe mencionar que la MTR es el documento de referencia para responder observaciones regulatorias sobre cobertura URS↔TC.

---

## Reglas de contenido

### Cómo asignar TCs a URS

1. **TC-OQ**: cada URS funcional o no funcional **DEBE** tener al menos un TC-OQ. Sin excepción.
2. **TC-IQ**: solo para URS de infraestructura, autenticación, integridad y backup. URS puramente funcionales (cuestionario, reportes) NO requieren TC-IQ.
3. **Múltiples TCs por URS**: separados por ` | ` (ej: `"TC-IQ-002 | TC-IQ-012"`). Útil cuando un URS se verifica desde múltiples ángulos.
4. **Un TC para múltiples URS**: el mismo TC-OQ-NNN puede aparecer en varias filas de URS (ej: TC-OQ-014 cubre URS-014, URS-015, URS-016).

### Asignación de criticidad

- **CRÍTICO**: fallo impacta directamente integridad de datos GxP, seguridad, validez del reporte. Típicamente: autenticación, audit trail, hash de integridad, categorización, firma.
- **ALTO**: fallo afecta significativamente uso correcto del sistema o controles GxP secundarios. Típicamente: roles/permisos, recuperación de password, compatibilidad de browsers críticos.
- **MEDIO**: fallo genera inconvenientes pero no compromete integridad GxP. Típicamente: tooltips, dashboards, mensajes de error, exportaciones secundarias.

### Cobertura típica por módulo (sistema GAMP 3 web)

| Módulo | URS típicos | TC-IQ | TC-OQ |
|---|---|---|---|
| Autenticación | 6-8 | 4-6 | 6-8 |
| Usuarios/Roles | 6-8 | 0-1 | 4-6 |
| Funcionalidad central | 8-15 | 0 | 5-10 |
| Reportes | 4-6 | 0-1 | 3-5 |
| Integridad/Hash | 3-5 | 0-2 | 3-5 |
| Infraestructura | 5-8 | 4-6 | 5-7 |
| No Funcionales | 4-6 | 2-4 | 4-6 |

Total esperado: **40-60 URS** con cobertura 100% en TC-OQ.

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **Cobertura URS→TC-OQ debe ser 100%.** Si no se puede asignar TC-OQ a algún URS, NO se incluye en la matriz (justificar exclusión en sección 6).
3. **Cada `criticidad` debe ser exactamente** `CRÍTICO`, `ALTO` o `MEDIO`. La validación interna falla con variantes.
4. **`type: "MTR"`** siempre en mayúsculas.
5. **`document.extras` debe incluir** `"Documento base (URS)"`, `"RA Global (HLRA)"`, `"Total Test Cases"` y `"Cobertura URS→TC-OQ"`.
6. **NO inventar IDs**: todos los URS-ID, RA-ID, TC-IQ y TC-OQ deben existir en sus respectivos documentos. Si el usuario no proveyó algún listado, pedirlo antes de generar.
7. **Anchos de tabla `tabla-trazabilidad` son fijos** en el renderer (no configurar).
8. **Sub-headers de módulo abarcan las 8 columnas** automáticamente vía `colSpan`.
9. **El TOTAL declarado en el resumen estadístico** debe coincidir con la cuenta de filas en la matriz. La validación interna lo chequea.
10. **GAPs Normativos en sección 6.3**: tabla opcional. Si no hay GAPs en el HLRA, omitir la sección o reemplazar por mensaje breve.
11. **`fechaEjecucion`**: `null` para PENDIENTE (default). Solo poblar si el TC ya se ejecutó (post Fase 6).
12. **Validación interna se ejecuta automáticamente.** No agregar caja-validacion manualmente al JSON — el renderer la inyecta.

---

## Ejemplo de input mínimo

> "Generá el MTR para DRP-GAMP Categorizador™ (DRP-SIS-001). Tengo URS-DRP-SIS-001 con 55 URS (URS-001 a URS-050 + URS-NF-001 a URS-NF-005), RA-DRP-SIS-001 con 24 riesgos (RA-001 a RA-024), HLRA-DRP-SIS-001 con 4 GAPs identificados, PIQ con 15 TC-IQ definidos (TC-IQ-001 a TC-IQ-015), POQ con 47 TC-OQ definidos (TC-OQ-001 a TC-OQ-047). 9 módulos: Autenticación, Usuarios/Roles, Registro, Cuestionario, GAMPI/Analytics, Reportes PDF, SHA-256/QR, Infraestructura, No Funcionales."

El skill genera el JSON MTR con:
- 55 filas en la matriz principal organizadas en 9 sub-headers de módulo.
- Cada URS con descripción, criticidad coloreada, módulo, RA-ID, TC-IQ (o `—`), TC-OQ obligatorio.
- Resumen estadístico con totales que cuadran con la matriz.
- Sección de GAPs heredados del HLRA con sus controles compensatorios.
- Validación interna automática (pasará verde si los datos están consistentes).
