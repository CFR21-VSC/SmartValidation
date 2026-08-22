---
name: urs-generator
description: Genera el JSON de un documento URS (User Requirements Specification) para la Validation Suite de DRP. Usar cuando el usuario tiene HLRA y VP aprobados, y la documentación técnica del sistema (Manual, SOPs), y necesita extraer los requerimientos verificables de usuario que servirán de base para el POQ y la matriz de cumplimiento normativo (MCN). El JSON resultante es input directo del renderer URS — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# URS Generator — Validation Suite

Generador del documento **URS (User Requirements Specification)** según GAMP 5 Segunda Edición.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes (anchos de tabla, márgenes, sub-headers de grupo, etc.). Este skill solo cubre lo específico del URS.

## Cuándo usar este skill

- El usuario ya tiene HLRA y VP aprobados.
- Tiene la documentación fuente del sistema: Manual de Usuario, SOPs de uso y administración.
- Necesita extraer **requerimientos verificables, cuantitativos y trazables** que el sistema DEBE cumplir.
- Inputs típicos:
  - Manual de Usuario del sistema (MAN)
  - SOPs (uso, administración, mantenimiento)
  - HLRA + VP ya generados (para alinear marco normativo y categoría GAMP)

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Principio fundamental

**Todos los requerimientos deben ser EXTRAÍDOS** de la documentación fuente (Manual, SOPs). **Ninguno debe ser inferido o inventado**. Cada URS debe tener su `Fuente` con la sección exacta del documento de origen (`MAN §X.X`, `SOP-USO §X.X`, etc.).

## Estructura del JSON URS

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "URS",
  "package": { /* mismo de HLRA/VP */ },
  "document": {
    "code": "URS-<CODIGO>",
    "titleEs": "ESPECIFICACIÓN DE REQUERIMIENTOS DE USUARIO",
    "titleEn": "USER REQUIREMENTS SPECIFICATION (URS)",
    "headerTitle": "Especificación de Requerimientos de Usuario (URS)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA>",
    "normativeFramework": "<de HLRA>",
    "extras": {
      "Total de requerimientos": "<N> requerimientos (<F> Funcionales + <NF> No Funcionales)",
      "Documentos fuente": "MAN-<CODE> v<X> | SOP-USO-<CODE> v<X> | SOP-ADM-<CODE> v<X>"
    }
  },
  "controlCambios": [...],
  "matrizAprobaciones": [...],
  "trazabilidad": {
    "recibeDe": ["HLRA", "VP"],
    "alimentaA": ["MCN", "MTR", "POQ"]
  },
  "requirementsSummary": {
    "total": 28,
    "functional": 22,
    "nonFunctional": 6,
    "mandatory": 26,
    "desirable": 2,
    "critical": 12,
    "high": 10,
    "medium": 6,
    "functionalIds": ["URS-001", "URS-002", "..."],
    "nonFunctionalIds": ["URS-NF-001", "URS-NF-002", "..."]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del URS (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

Texto justificado en 1-2 párrafos. Mencionar SIEMPRE:
- Define QUÉ debe hacer el sistema desde la perspectiva del usuario.
- Sirve como base para el POQ y la MCN.
- Los requerimientos fueron extraídos exclusivamente de la documentación técnica aprobada (NO inventados).

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

Mismo patrón que HLRA/VP. Incluido: módulos del sistema, requerimientos no funcionales, roles. Excluido: funcionalidades de versión Pro, infraestructura subyacente, integraciones externas.

### 3. RESPONSABILIDADES (`tipo: "tabla"`)

Roles típicos en el URS: Process Owner, Validador, QA / Revisor Regulatorio, Ejecutor de OQ.

### 4. DEFINICIONES (`tipo: "tabla"`)

Términos OBLIGATORIOS a incluir:
- `Requerimiento (M)` — Mandatory: el sistema DEBE cumplirlo. Fallo = NC crítica/mayor.
- `Requerimiento (D)` — Desirable: el sistema debería cumplirlo. Fallo = NC menor.
- `Criticidad CRÍTICA / ALTA / MEDIA` — qué impacto tiene el fallo.
- Términos del sistema (SHA-256, Audit Trail, etc.) si aparecen en la tabla de requerimientos.
- `Trazabilidad` — define la vinculación URS ↔ TC ↔ Resultado.

### 5. CONTEXTO DEL SISTEMA

`texto` general + 3 sub-secciones (`tipo: "subseccion"`):
- **5.1 Descripción General**: 1 párrafo que describe el sistema y su flujo principal.
- **5.2 Usuarios del Sistema**: tabla con `Rol | Perfil | Acciones principales`.
- **5.3 Integraciones con Otros Sistemas**: texto corto (típicamente "El sistema es standalone..." si no hay integraciones).

### 6. LEYENDA DE LA TABLA DE REQUERIMIENTOS

Dos tablas seguidas:

**6.a — Tabla principal** explicando los campos:
```json
{
  "tipo": "tabla",
  "titulo": "LEYENDA DE LA TABLA DE REQUERIMIENTOS",
  "columnas": ["Campo", "Valores posibles", "Significado"],
  "widths": [85, 175, 195],
  "filas": [
    ["Tipo", "M = Mandatorio | D = Deseable", "Obligatoriedad del requerimiento"],
    ["Criticidad", "CRÍTICO | ALTO | MEDIO", "Impacto en seguridad/integridad GxP si el requerimiento falla"],
    ["Fuente", "MAN §X.X | SOP-USO §X.X | SOP-ADM §X.X | Reg.", "Sección exacta del documento fuente que respalda el requerimiento"]
  ]
}
```

**6.b — Tabla-leyenda de criticidad** (sin header, fondo amarillo claro):
```json
{
  "tipo": "tabla",
  "noHeader": true,
  "compact": true,
  "widths": [120, 335],
  "filas": [
    [
      { "text": "Criticidad CRÍTICA", "color": "#C0392B", "bold": true, "fillColor": "#FFF8DC" },
      { "text": "<lista de funciones críticas>", "fillColor": "#FFF8DC" }
    ],
    [
      { "text": "Criticidad ALTA", "color": "#E67E22", "bold": true, "fillColor": "#FFF8DC" },
      { "text": "<lista>", "fillColor": "#FFF8DC" }
    ],
    [
      { "text": "Criticidad MEDIA", "color": "#717D8A", "bold": true, "fillColor": "#FFF8DC" },
      { "text": "<lista>", "fillColor": "#FFF8DC" }
    ]
  ]
}
```

### 7. REQUERIMIENTOS FUNCIONALES (LA TABLA GIGANTE)

**Esta es la tabla más importante del documento**. Tiene 5 columnas y agrupa requerimientos por categoría usando **sub-headers de grupo**.

```json
{
  "tipo": "tabla",
  "titulo": "REQUERIMIENTOS FUNCIONALES",
  "intro": "Todos los requerimientos listados a continuación fueron extraídos exclusivamente de la documentación técnica aprobada del sistema (...). La fuente exacta se indica en la columna 'Fuente'.",
  "compact": true,
  "columnas": ["URS-ID", "Fuente", "El sistema DEBERÁ...", "Tipo", "Criticidad"],
  "widths": [50, 80, 220, 30, 75],
  "filas": [
    { "subheader": "7.1 <Categoría 1>" },
    [ /* fila 1 */ ],
    [ /* fila 2 */ ],
    ...
    { "subheader": "7.2 <Categoría 2>" },
    [ /* fila */ ],
    ...
  ]
}
```

**Cada fila de requerimiento** tiene este formato exacto:

```json
[
  { "text": "URS-XXX", "bold": true, "color": "#1F3C56" },
  { "text": "<Fuente>", "italics": true, "fontSize": 8 },
  "<texto del requerimiento, comenzando en minúscula con verbo en infinitivo>",
  { "text": "M | D", "bold": true, "alignment": "center", "color": "#1F3C56" },
  { "text": "CRÍTICO | ALTO | MEDIO", "bold": true, "alignment": "center", "color": "<color hex>" }
]
```

Colores de criticidad (hex exactos):
- **CRÍTICO** → `#C0392B` (rojo)
- **ALTO** → `#E67E22` (naranja)
- **MEDIO** → `#717D8A` (gris)

Para `D` (Desirable), usar color `#717D8A` (gris) en vez de `#1F3C56` (azul).

#### Categorías típicas (sub-headers) del URS

Adaptar a cada sistema, pero típicamente:
- 7.1 Autenticación y Control de Acceso
- 7.2 Gestión de Usuarios y Roles
- 7.3 Registro / Configuración del Sistema
- 7.4 Funcionalidad principal del sistema
- 7.5 / 7.6 Componentes específicos (UI, módulos)
- 7.7 Generación de Reportes / Salidas
- 7.8 Integridad / Seguridad de datos
- 7.9 Infraestructura, Disponibilidad y Seguridad Técnica

### 8. REQUERIMIENTOS NO FUNCIONALES

Misma estructura que sección 7, pero con sub-headers de grupos NF:
- 8.1 Seguridad y Control de Acceso (compensatorios cuando aplique)
- 8.2 Performance
- 8.3 Compliance Regulatorio — Audit Trail
- 8.4 Integridad de Datos
- 8.5 Backup y Recuperación

IDs de los requerimientos no funcionales: `URS-NF-001`, `URS-NF-002`, etc.

### 9. EXCLUSIONES EXPLÍCITAS

Tabla 3 columnas: `Funcionalidad excluida | Justificación | Referencia`. Documenta qué NO está bajo validación y por qué.

```json
{
  "tipo": "tabla",
  "titulo": "EXCLUSIONES EXPLÍCITAS",
  "intro": "Los siguientes elementos NO son requerimientos del sistema en la versión <X> bajo validación:",
  "columnas": ["Funcionalidad excluida", "Justificación", "Referencia"],
  "widths": [165, 200, 90],
  "filas": [
    ["<funcionalidad>", "<por qué se excluye>", "HLRA §<X> GAP-<XXX> | MAN §<X.X>"]
  ]
}
```

### 10. CRITERIOS DE ACEPTACIÓN DEL URS

Tabla numerada de criterios:

```json
{
  "tipo": "tabla",
  "titulo": "CRITERIOS DE ACEPTACIÓN DEL URS",
  "columnas": ["#", "Criterio", "Verificación"],
  "widths": [25, 290, 140],
  "filas": [
    ["1", "El 100% de los URS tipo Mandatory (M) con criticidad CRÍTICA tienen al menos 1 test case asociado en el POQ", "Matriz de trazabilidad URS"],
    ["2", "El 100% de los URS tipo Mandatory (M) con criticidad ALTA tienen al menos 1 test case asociado en el POQ", "Matriz de trazabilidad URS"],
    ["3", "Los URS tipo Desirable (D) tienen al menos 1 TC o una justificación documentada", "POQ / Sección de exclusiones"],
    ["4", "Cada URS tiene fuente documental citada verificable", "Columna 'Fuente' de este URS"],
    ["5", "100% de los URS con resultado PASA al finalizar la OQ → Sistema APROBADO para producción", "ROQ — Informe Final"]
  ]
}
```

### 11. RESUMEN ESTADÍSTICO

Tabla de 3 columnas con stacks (texto + contador):

```json
{
  "tipo": "tabla",
  "titulo": "RESUMEN ESTADÍSTICO DE REQUERIMIENTOS",
  "columnas": ["Por tipo", "Por criticidad", "Por módulo"],
  "widths": [140, 120, 195],
  "filas": [
    [
      { "stack": [
        { "text": "Mandatory (M): <N>", "bold": true, "fontSize": 9, "margin": [0,0,0,4] },
        { "text": "Desirable (D): <N>", "fontSize": 9, "margin": [0,0,0,4] },
        { "text": "Total funcionales: <N>", "bold": true, "fontSize": 9, "margin": [0,0,0,4] },
        { "text": "No funcionales: <N> (NF)", "fontSize": 9, "margin": [0,0,0,8] },
        { "canvas": [{ "type": "line", "x1": 0, "y1": 0, "x2": 130, "y2": 0, "lineWidth": 0.5, "lineColor": "#D0D5DB" }] },
        { "text": "TOTAL: <N> URS", "bold": true, "fontSize": 10, "color": "#1F3C56", "margin": [0,6,0,0] }
      ]},
      { "stack": [
        { "text": "CRÍTICO: <N>", "color": "#C0392B", "bold": true, "fontSize": 9, "margin": [0,0,0,4] },
        { "text": "ALTO: <N>", "color": "#E67E22", "bold": true, "fontSize": 9, "margin": [0,0,0,4] },
        { "text": "MEDIO: <N>", "color": "#717D8A", "bold": true, "fontSize": 9 }
      ]},
      { "stack": [
        { "text": "<Categoría>: <N>", "fontSize": 9, "margin": [0,0,0,3] }
      ]}
    ]
  ]
}
```

### 12. REFERENCIAS

Tabla 2 columnas: `Código / Referencia | Título`.

Incluir SIEMPRE:
- Manual del sistema (MAN-XXX)
- SOPs de uso y administración (SOP-USO, SOP-ADM)
- HLRA del paquete actual
- VP del paquete actual
- ANMAT 4159/2023 Anexo VI
- GAMP 5 — 2da Ed. 2022
- ICH Q9 R1 (2023)
- 21 CFR Part 11
- EU Annex 11

### 13. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`)

**Siempre incluir**, al final del documento. Mismo formato que HLRA/VP.

---

## Reglas de contenido

### Cómo escribir un buen requerimiento URS

Cada requerimiento debe ser:

1. **Verificable**: se puede demostrar con un test case si se cumple o no.
   - ✅ Bueno: "expirar la sesión tras 30 minutos de inactividad"
   - ❌ Malo: "ser fácil de usar"

2. **Cuantitativo cuando sea posible**: usar números concretos, no rangos vagos.
   - ✅ Bueno: "bloquear la cuenta tras 5 intentos fallidos consecutivos"
   - ❌ Malo: "bloquear la cuenta tras varios intentos"

3. **Trazable**: cada URS tiene su `Fuente` que apunta a la sección exacta del documento.
   - ✅ Bueno: `MAN §5.2 | SOP-USO §7.1`
   - ❌ Malo: `Manual del sistema`

4. **Comienza con verbo en infinitivo después de "El sistema DEBERÁ..."**:
   - ✅ "permitir el acceso..."
   - ✅ "expirar la sesión..."
   - ✅ "registrar todas las acciones..."

5. **Una idea por requerimiento**: no agrupar varias funcionalidades en un mismo URS.

### Distribución típica por categoría GAMP

| Categoría GAMP | Cantidad típica de URS |
|---|---|
| GAMP 1 (Infraestructura) | No aplica URS |
| GAMP 3 (COTS no configurado) | 30–60 URS |
| GAMP 4 (COTS configurado) | 60–120 URS |
| GAMP 5 (Custom) | 100–300+ URS |

### Distribución típica por criticidad

- **CRÍTICO**: 30–50% de los URS (autenticación, integridad, audit trail, generación de reportes).
- **ALTO**: 30–40% (gestión de usuarios, recuperación de password, validación de input).
- **MEDIO**: 10–20% (UI, mensajes de error, ayudas contextuales).

### Tipo (M / D)

- **Mandatory (M)**: ~95% de los URS. Cualquier requerimiento ligado a compliance, seguridad o función crítica.
- **Desirable (D)**: ~5%. Reservado para mejoras de UX que no impactan compliance ni función crítica.

### Sub-headers de grupo en la tabla de requerimientos

Cuando una tabla tiene `{ subheader: "..." }` entre las filas, **el renderer NO repite el header de la tabla en cada salto de página**. Los sub-headers actúan como contexto suficiente. Esto es automático y correcto.

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **NO inventar requerimientos.** Cada URS debe tener fuente verificable en MAN/SOP.
3. **NO inventar normas o secciones.** Si no estás seguro, omitir.
4. **NO usar siglas inconsistentes.** Usar IRO (no RA / RAI) para el índice del HLRA.
5. **Anchos de tabla siempre suman 455** cuando se especifican.
6. **Cada requerimiento tiene su `Fuente` exacta** (MAN §X.X | SOP-USO §X.X).
7. **`type: "URS"`** siempre en mayúsculas.
8. **`document.extras` debe incluir** `"Total de requerimientos"` y `"Documentos fuente"`.
9. **El total de requerimientos en `extras` debe coincidir** con la suma de URS funcionales + no funcionales.
10. **Colores de criticidad: usar siempre los hex exactos** (`#C0392B`, `#E67E22`, `#717D8A`).
11. **Usar `compact: true`** en la tabla de requerimientos (50+ filas necesita densidad alta).
12. **Si el sistema tiene GAPs en HLRA**, mencionarlos en la sección 9 (Exclusiones) referenciando `HLRA §10 GAP-XXX`.
13. **`requirementsSummary` es OBLIGATORIO** en el root del JSON. Debe reflejar los conteos EXACTOS de los requerimientos realmente generados — contados después de escribir la tabla, no estimados. Campos requeridos: `total`, `functional`, `nonFunctional`, `mandatory`, `desirable`, `critical`, `high`, `medium`, `functionalIds` (array de todos los URS-XXX generados), `nonFunctionalIds` (array de todos los URS-NF-XXX generados). Este campo es la fuente de verdad que usan RA, RRM, MTR y PIQ/POQ para referenciar los requerimientos sin recontarlos.

---

## Ejemplo de input mínimo

> "Generá el URS para CalQR (sistema GAMP 4 ya con HLRA y VP). Acabamos de recibir el manual MAN-CALQR-001 v1.0 y el SOP-USO-CALQR-001 v1.0. El sistema valida códigos QR sanitarios, tiene autenticación con email+password (5 intentos antes de bloqueo), genera reportes PDF firmados con SHA-256, audit trail completo. Cliente Laboratorios MediCorp."

El skill genera el JSON URS extrayendo requerimientos de los documentos provistos, agrupándolos en sub-headers según sus áreas, asignando criticidad (CRÍTICO/ALTO/MEDIO) según impacto GxP, y referenciando cada uno a su sección fuente.
