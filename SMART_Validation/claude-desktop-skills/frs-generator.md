---
name: frs-generator
description: Genera el JSON de un documento FRS (Functional Requirements Specification / Especificación de Requerimientos Funcionales) para la Validation Suite de DRP. Usar cuando el usuario tiene URS aprobado y necesita traducir cada requerimiento de usuario en uno o más requerimientos técnicos verificables que servirán como input para la Design Specification (DS) y el Protocolo de Calificación Operacional (POQ). El JSON resultante es input directo del renderer FRS — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# FRS Generator — Validation Suite

Generador del documento **FRS (Functional Requirements Specification / Especificación de Requerimientos Funcionales)** según GAMP 5 Segunda Edición.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes (anchos de tabla, márgenes, sub-headers de grupo, etc.). Este skill solo cubre lo específico del FRS.

## Cuándo usar este skill

- El usuario ya tiene **URS aprobado** (input principal e indispensable).
- El sistema típicamente es **GAMP 4 (COTS configurado)** o **GAMP 5 (Custom)** — los GAMP 3 puros no requieren FRS formal.
- Necesita traducir cada URS en uno o más **FRS técnicos verificables** que describan **QUÉ** debe hacer el sistema (no CÓMO — eso va en el DS).
- Inputs típicos:
  - URS del paquete actual (input principal)
  - HLRA + VP del paquete actual
  - Documentación del vendor cuando aplica (configuración disponible)
  - SOPs operativos relevantes

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Principio fundamental

**Cada FRS debe estar trazado a uno o más URS de origen**. La trazabilidad URS → FRS es bidireccional y se materializa en la columna `URS Origen` de la tabla principal. **NO se permiten FRS huérfanos** (sin URS de origen). Si surge una necesidad técnica sin URS, primero se actualiza el URS.

## Diferencia clave URS vs FRS

| | URS | FRS |
|---|---|---|
| Lenguaje | Negocio / usuario | Técnico funcional |
| Pregunta que responde | ¿QUÉ necesita el usuario? | ¿QUÉ funciones debe ejecutar el sistema? |
| Audiencia | Process Owner, QA | Validador técnico, Vendor, Diseñador |
| Origen | Necesidad operativa | URS |
| Ejemplo | "El sistema debe permitir registrar muestras" | "El sistema generará automáticamente un código único MC-YYYYMMDD-NNNN al registrar cada muestra" |

## FRS Abstracto vs FRS Extendido (decisión clave)

El FRS puede generarse en dos modos según la complejidad y la categoría GAMP:

### Modo ABSTRACTO (default para GAMP 4 simple)
- Solo describe QUÉ funciones ejecuta el sistema (FRS-XXX) sin entrar en algoritmos.
- Sección 7 "Reglas de Negocio y Lógica Funcional" se **omite**.
- Adecuado cuando el producto es estándar y la algoritmia interna es opaca al usuario (ej. un EDMS comercial).

### Modo EXTENDIDO (recomendado para GAMP 4 con algoritmia compleja, GAMP 5 custom, sistemas con flujos críticos)
- Incluye además la sección 7 "Reglas de Negocio y Lógica Funcional" con tipo `flujo-logico`.
- Documenta los **algoritmos críticos** del sistema como secuencia de pasos lógicos + decisiones (si/entonces) + ejemplo concreto.
- En GAMP 4 con producto configurado, la algoritmia describe el comportamiento del producto **bajo la configuración GxP del cliente** — no implica desarrollo de código.
- Cada algoritmo es input directo de uno o más Test Cases en el POQ.

**Cuándo elegir EXTENDIDO** (regla práctica):
- El sistema tiene flujos de decisión no triviales (workflows con bifurcación, validaciones complejas, cálculos derivados).
- Auditores o reguladores piden trazabilidad completa de decisiones automáticas (típico en lotes de farma, biotech).
- El POQ va a tener test cases que prueben rutas lógicas específicas.
- Casos típicos: **SAP EWM (putaway, replenishment, picking)**, **LIMS (workflow OOS, captura de equipos, liberación)**, **MES (batch genealogy, hold/release)**, **EDMS con workflow de aprobación condicional**.

**Cuándo elegir ABSTRACTO**:
- Sistemas con funciones lineales sin algoritmia significativa (catálogos, repositorios documentales sin workflow).
- Sistemas GAMP 3 puros donde el producto es black-box.
- Cuando el cliente prefiere mantener el FRS corto y dejar la algoritmia para el DS técnico.

> **Importante**: NO es "más correcto" un modo que el otro. La elección depende del sistema, el cliente y la cultura regulatoria. Si hay duda, preguntar al usuario antes de generar.

## Estructura del JSON FRS

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "FRS",
  "package": { /* mismo del URS/HLRA/VP */ },
  "document": {
    "code": "FRS-<CODIGO>",
    "titleEs": "ESPECIFICACIÓN DE REQUERIMIENTOS FUNCIONALES",
    "titleEn": "FUNCTIONAL REQUIREMENTS SPECIFICATION (FRS)",
    "headerTitle": "Especificación de Requerimientos Funcionales (FRS)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA, típicamente GAMP 4 o 5>",
    "normativeFramework": "<de HLRA>",
    "extras": {
      "Documento base (URS)": "URS-<CODE> v<X.Y>",
      "Total de FRS": "<N> requerimientos funcionales (<F> funcionales + <I> de interfaz)",
      "Tipo de Validación": "Prospectiva — Sistema configurado por proveedor | Prospectiva — Custom"
    }
  },
  "controlCambios": [...],
  "matrizAprobaciones": [
    /* Roles típicos del FRS: Validador, Process Owner, Revisor Técnico/IT, Jefe Validaciones, Gerente QA, opcional Vendor */
  ],
  "trazabilidad": {
    "recibeDe": ["URS"],
    "alimentaA": ["DS", "POQ", "MTR"]
  },
  "secciones": [...]
}
```

> **Importante**: la matriz de aprobaciones del FRS debe incluir **Revisor Técnico / IT** (no aparece en URS) porque el FRS tiene componente técnica fuerte. En GAMP 4 con vendor externo, también se recomienda agregar firma del vendor para confirmar viabilidad técnica.

## Secciones obligatorias del FRS (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

Texto justificado en 1-2 párrafos. Mencionar SIEMPRE:
- Traduce los URS en FRS técnicos verificables.
- Describe **QUÉ** funciones específicas debe ejecutar el sistema (no CÓMO — eso va en el DS).
- Sirve como input directo para el DS (Design Specification) y el POQ.
- La trazabilidad URS → FRS → TC es bidireccional y garantiza cobertura 100%.

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

Mismo patrón que URS. Incluido típicamente: módulos contratados, integraciones, configuración GxP específica, roles del cliente. Excluido: módulos no contratados, customizaciones de código fuente del vendor (no permitidas en GAMP 4), infraestructura subyacente, integraciones futuras.

### 3. RESPONSABILIDADES (`tipo: "tabla"`)

Roles típicos del FRS:
- Process Owner — valida que cada FRS refleje el comportamiento esperado según URS.
- Validador — descompone URS en FRS verificables.
- **Revisor Técnico / IT** — verifica viabilidad técnica, dependencias, coordinación con vendor.
- QA / Revisor Regulatorio — valida cumplimiento de FRS de compliance.
- **Vendor** (en GAMP 4) — confirma capacidad del producto para implementar cada FRS.

### 4. DEFINICIONES (`tipo: "tabla"`)

Términos OBLIGATORIOS a incluir:
- `FRS (Functional Requirement Specification)` — requerimiento técnico verificable que describe una función específica.
- `URS-FRS Trazabilidad` — vínculo bidireccional entre cada URS y los FRS que lo implementan.
- `Configuración GxP` — parámetros configurables que afectan funciones GxP-relevantes.
- `Vendor` (si aplica GAMP 4) — proveedor del software comercial.
- `Audit Trail` — registro electrónico cronológico no modificable.
- `TC — Test Case` — caso de prueba en el POQ que verifica el cumplimiento de uno o más FRS.
- Términos del dominio del sistema (LIMS, MES, EDMS, etc.) si aparecen.

### 5. REFERENCIA AL URS (`tipo: "tabla-info"`)

Sección obligatoria que materializa la trazabilidad de origen. Tabla de información con campos clave:

```json
{
  "tipo": "tabla-info",
  "titulo": "REFERENCIA AL URS",
  "intro": "Este FRS deriva del documento URS-<CODE> v<X.Y>. Los datos clave del URS que guían las decisiones técnicas de este documento son:",
  "labelWidth": 170,
  "filas": [
    { "campo": "URS de referencia", "valor": "URS-<CODE> v<X.Y>", "boldValor": true, "colorValor": "primary" },
    { "campo": "Total URS de origen", "valor": "<N> URS funcionales + <NF> URS no funcionales = <Total> URS" },
    { "campo": "FRS generados", "valor": "<N> FRS (cobertura 100% de URS)", "boldValor": true, "colorValor": "accent" },
    { "campo": "Ratio URS:FRS", "valor": "1:1 promedio (algunos URS complejos generan 2-3 FRS)" },
    { "campo": "Categoría GAMP", "valor": "<de HLRA>" },
    { "campo": "Configuración requerida", "valor": "<descripción de qué se configura>" },
    { "campo": "Trazabilidad bidireccional", "valor": "Cada FRS referencia su URS de origen. Cada URS lista sus FRS asociados (en MTR)." }
  ]
}
```

### 6. REQUERIMIENTOS FUNCIONALES (LA TABLA GIGANTE)

**Esta es la tabla más importante del documento**. 5 columnas, agrupada por **sub-headers de módulo funcional**.

```json
{
  "tipo": "tabla",
  "titulo": "REQUERIMIENTOS FUNCIONALES",
  "intro": "Cada FRS describe una función técnica específica del sistema. Toda funcionalidad listada está soportada por la configuración contratada y referenciada al URS de origen.",
  "compact": true,
  "columnas": ["FRS-ID", "URS Origen", "El sistema implementará...", "Tipo", "Criticidad"],
  "widths": [50, 70, 230, 30, 75],
  "filas": [
    { "subheader": "6.1 <Módulo 1>" },
    [ /* fila 1 */ ],
    ...
    { "subheader": "6.2 <Módulo 2>" },
    ...
  ]
}
```

**Cada fila de FRS** tiene este formato exacto:

```json
[
  { "text": "FRS-XXX", "bold": true, "color": "#1F3C56" },
  { "text": "URS-XXX | URS-YYY", "italics": true, "fontSize": 8 },
  "<texto del FRS, comenzando en minúscula con sustantivo o verbo>",
  { "text": "M | D", "bold": true, "alignment": "center", "color": "#1F3C56" },
  { "text": "CRÍTICO | ALTO | MEDIO", "bold": true, "alignment": "center", "color": "<color hex>" }
]
```

Colores de criticidad (hex exactos, mismos que URS):
- **CRÍTICO** → `#C0392B` (rojo)
- **ALTO** → `#E67E22` (naranja)
- **MEDIO** → `#717D8A` (gris)

#### Sub-headers típicos del FRS (módulos funcionales)

Adaptar a cada sistema. Ejemplos por dominio:

**LIMS (Laboratory Information Management System)**:
- 6.1 Recepción y Registro de Muestras
- 6.2 Workflow Analítico
- 6.3 Gestión de Resultados y Liberación
- 6.4 Reportes y Certificados (CoA)
- 6.5 Control de Acceso y Roles
- 6.6 Audit Trail e Integridad
- 6.7 Backup, Continuidad y Disponibilidad

**MES (Manufacturing Execution System)**:
- 6.1 Order Management
- 6.2 Batch Execution / Electronic Batch Record
- 6.3 Equipment Integration
- 6.4 Quality Holds y Liberación
- 6.5 Material Tracking y Genealogía
- 6.6 Audit Trail
- 6.7 Reportes

**EDMS (Electronic Document Management)**:
- 6.1 Creación y Edición de Documentos
- 6.2 Workflow de Aprobación
- 6.3 Firma Electrónica
- 6.4 Versionado y Controlled Copies
- 6.5 Búsqueda y Recuperación
- 6.6 Audit Trail

### 7. REGLAS DE NEGOCIO Y LÓGICA FUNCIONAL (`tipo: "flujo-logico"`) — solo FRS extendido

**Sección OPCIONAL.** Solo incluir cuando se eligió el modo EXTENDIDO. Documenta los algoritmos críticos del sistema como secuencias de pasos + decisiones + ejemplos.

Estructura:
```json
{
  "tipo": "flujo-logico",
  "titulo": "REGLAS DE NEGOCIO Y LÓGICA FUNCIONAL",
  "intro": "Esta sección documenta los algoritmos críticos del sistema desde la perspectiva funcional (QUÉ decide el sistema y cómo encadena los pasos). En GAMP 4 con producto configurado, la algoritmia descripta refleja el comportamiento del producto bajo la configuración GxP del cliente — no implica desarrollo de código fuente. Cada algoritmo es input directo de uno o más Test Cases en el POQ.",
  "algoritmos": [
    {
      "id": "ALG-001",
      "nombre": "<Nombre conciso del algoritmo>",
      "frsAsociados": "FRS-001, FRS-002",
      "trigger": "<Evento o acción del usuario que dispara el algoritmo>",
      "pasos": [
        "Paso 1: acción concreta...",
        "Paso 2: ...",
        ...
      ],
      "decisiones": [
        { "condicion": "Si <condición>", "accion": "<qué hace el sistema>" },
        ...
      ],
      "ejemplo": "<Caso concreto con valores reales que ilustra el algoritmo>"
    }
  ]
}
```

#### Cómo escribir un buen algoritmo `flujo-logico`

1. **El `trigger` siempre es un evento concreto.**
   - ✅ Bueno: "El usuario completa el formulario de recepción y presiona 'Registrar'."
   - ✅ Bueno: "El equipo HPLC finaliza una corrida y emite un evento OPC UA."
   - ❌ Malo: "Cuando se necesita registrar una muestra."

2. **Los `pasos` describen la lógica funcional, no el código.**
   - ✅ Bueno: "Validar que el analista figure como activo en USERS y que su rol tenga permiso 'sample.create' en ROLE_PERMISSIONS."
   - ❌ Malo: "Ejecutar `userService.checkActive(user)` y `permissionService.has(user, 'sample.create')`."
   - **Regla**: nombres de tabla/permiso/secuencia están bien (son configuración GxP visible al validador). Nombres de método/clase/librería NO (eso es DS).

3. **Las `decisiones` son ramificaciones críticas, no validaciones obvias.**
   - ✅ Bueno: condiciones de error, edge cases, validaciones GxP, anti-tampering.
   - ❌ Malo: "Si el usuario presiona Cancelar → cancelar la operación." (obvio, no agrega valor.)
   - Cada decisión debe poder mapearse a un test case del POQ.

4. **El `ejemplo` debe ser concreto con valores reales.**
   - ✅ Bueno: "Resultado HPLC: 102.7% para un activo con criterio [98.0%, 102.0%]. Sistema detecta OOS, bloquea avance, genera NC-2026-0073."
   - ❌ Malo: "Cuando el sistema detecta un OOS, ejecuta el flujo correspondiente."

5. **Ámbito de cada algoritmo: una decisión funcional unitaria.**
   - ✅ Bueno: "Liberación de lote con doble verificación y firma electrónica" (alcance claro).
   - ❌ Malo: "Ciclo de vida de la muestra" (demasiado amplio, mejor descomponer).
   - Tamaño típico: 5-12 pasos. Si tiene más, dividir en ALG-XXXa y ALG-XXXb.

6. **Trazabilidad a FRS es obligatoria.**
   - Cada algoritmo lista 1+ FRS en `frsAsociados`.
   - Idealmente cada FRS crítico tiene ≥1 algoritmo que lo describe.

#### Cantidad típica de algoritmos por sistema

| Sistema | Algoritmos típicos |
|---|---|
| LIMS | Generación código, validación OOS, captura de equipo, liberación, audit trail |
| MES | Batch genealogy, hold/release, weighing, dispensing, EBR signature |
| EDMS | Workflow de aprobación, versionado, controlled copy, retención |
| SAP EWM | Putaway, replenishment, picking, packing, inbound/outbound |
| Sistema custom | 1 algoritmo por flujo crítico de negocio |

Cantidad típica: **3-8 algoritmos** por sistema. Más de 10 sugiere que se está documentando lógica trivial — revisar criterio.

#### Naming de IDs de algoritmos

- `ALG-001`, `ALG-002`, ... (numeración correlativa).
- Si hay categorías muy claras (entrada vs salida en EWM), permitido usar prefijos: `ALG-IN-001`, `ALG-OUT-001`.
- No mezclar con FRS-XXX (son cosas distintas).

### 8. REQUERIMIENTOS DE INTERFAZ

Sección dedicada a las interfaces externas (críticas en GAMP 4/5). Misma estructura de tabla pero con columnas distintas:

```json
{
  "tipo": "tabla",
  "titulo": "REQUERIMIENTOS DE INTERFAZ",
  "intro": "Interfaces externas del sistema. Cada interfaz tiene FRS técnicos asociados sobre protocolo, frecuencia, manejo de errores y trazabilidad.",
  "compact": true,
  "columnas": ["FRS-IF-ID", "URS Origen", "Interfaz", "Protocolo", "Criticidad"],
  "widths": [60, 70, 175, 80, 70],
  "filas": [
    [
      { "text": "FRS-IF-001", "bold": true, "color": "#1F3C56" },
      { "text": "URS-XXX", "italics": true, "fontSize": 8 },
      "<descripción direccional: Sistema A → Sistema B con frecuencia y datos>",
      { "text": "<protocolo: REST, SOAP, OPC UA, LDAP, Webhook>", "fontSize": 9 },
      { "text": "CRÍTICO | ALTO", "bold": true, "alignment": "center", "color": "<hex>" }
    ]
  ]
}
```

IDs de interfaces: `FRS-IF-001`, `FRS-IF-002`, etc. Distinguir prefijo del FRS regular para facilitar trazabilidad.

### 9. REQUERIMIENTOS DE PFRSORMANCE

Tabla cuantitativa con métricas concretas. **Cada métrica DEBE tener un objetivo numérico**.

```json
{
  "tipo": "tabla",
  "titulo": "REQUERIMIENTOS DE PFRSORMANCE",
  "intro": "Cuantificación de tiempos de respuesta y capacidad esperada del sistema en condiciones operativas normales.",
  "columnas": ["Métrica", "Objetivo", "Justificación / Origen"],
  "widths": [165, 120, 170],
  "filas": [
    ["Tiempo de respuesta consulta", "≤ 2 segundos", "URS-NF-002 — productividad usuario"],
    ["Capacidad concurrente", "≥ 100 usuarios simultáneos", "Personal del cliente"],
    ["Volumen / día", "≥ 5,000 registros", "Histórico operativo"],
    ["Disponibilidad anual (SLA)", "99.5% (~44 hs downtime/año)", "URS-NF-005 — contrato vendor"]
  ]
}
```

### 10. MANEJO DE ERRORES Y EXCEPCIONES

Tabla con comportamiento esperado del sistema ante condiciones de error:

```json
{
  "tipo": "tabla",
  "titulo": "MANEJO DE ERRORES Y EXCEPCIONES",
  "intro": "Comportamiento esperado del sistema ante condiciones de error. Cada caso tiene FRS técnicos asociados.",
  "columnas": ["Tipo de error", "Comportamiento esperado", "Notificación"],
  "widths": [140, 200, 115],
  "filas": [
    ["<error>", "<qué hace el sistema>", "<a quién y cómo se notifica>"]
  ]
}
```

### 11. CRITERIOS DE ACEPTACIÓN DEL FRS

Tabla numerada de criterios. Modelo recomendado (adaptar a cada sistema):

```json
{
  "tipo": "tabla",
  "titulo": "CRITERIOS DE ACEPTACIÓN DEL FRS",
  "columnas": ["#", "Criterio", "Verificación"],
  "widths": [25, 290, 140],
  "filas": [
    ["1", "El 100% de los URS Mandatory tienen al menos 1 FRS asociado", "Matriz de Trazabilidad URS↔FRS"],
    ["2", "Cada FRS es verificable mediante un test case en el POQ", "Trazabilidad FRS↔TC en MTR"],
    ["3", "Cada FRS describe QUÉ debe hacer el sistema (no CÓMO)", "Revisión de redacción"],
    ["4", "Cada FRS de criticidad CRÍTICA tiene criterios de aceptación cuantitativos", "Revisión Process Owner + QA"],
    ["5", "Las interfaces externas (FRS-IF-XXX) tienen protocolo y frecuencia definidos", "Sección 7"],
    ["6", "Vendor confirma capacidad del producto para implementar todos los FRS", "Acta de revisión técnica con vendor"],
    ["7", "FRS aprobado antes de inicio de generación del Design Specification (DS)", "Firmas finales"]
  ]
}
```

### 12. REFERENCIAS

Tabla 2 columnas (`Código / Referencia | Título`). Incluir SIEMPRE:
- URS del paquete actual
- HLRA del paquete actual
- VP del paquete actual
- Manual del vendor (si GAMP 4)
- Documento de configuración del vendor (si GAMP 4)
- SOPs de uso
- ANMAT 4159/2023 Anexo VI
- GAMP 5 — 2da Ed. 2022
- ICH Q9 R1 (2023)
- 21 CFR Part 11
- EU Annex 11

### 13. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`)

> **Nota sobre numeración**: la numeración mostrada arriba (1-13) corresponde al modo **EXTENDIDO**. En modo **ABSTRACTO** se omite la sección 7 (Reglas de Negocio y Lógica Funcional) y todas las posteriores se renumeran automáticamente (Interfaz pasa a 7, Performance a 8, etc.). El renderer numera por índice — no es necesario forzar números en el JSON.

**Siempre incluir**, al final del documento. Roles típicos del FRS:
- Ejecutor (Validador)
- Revisor Técnico (IT)
- Revisor (Process Owner)
- Aprobador (Jefe de Validaciones)
- Aprobador (Gerente QA)
- Aprobador (Vendor — confirmación técnica) [opcional, recomendado en GAMP 4]

---

## Reglas de contenido

### Cómo escribir un buen FRS

Cada FRS debe ser:

1. **Técnico y específico**: describe QUÉ función ejecuta el sistema, no la necesidad de negocio.
   - ✅ Bueno: "generación automática de código único en formato MC-YYYYMMDD-NNNN al registrar cada muestra"
   - ❌ Malo: "el sistema debe permitir identificar muestras"

2. **Verificable mediante test case**: cada FRS debe poder ser probado en el POQ.
   - ✅ Bueno: "validación obligatoria de campos críticos antes de aceptar la muestra: código de lote no vacío, tipo de ensayo válido, analista activo"
   - ❌ Malo: "el sistema debe ser robusto"

3. **Cuantitativo cuando aplique**: usar números concretos.
   - ✅ Bueno: "timeout de sesión a 30 minutos de inactividad. Bloqueo tras 5 intentos fallidos consecutivos. Política de contraseñas: mín 10 caracteres, rotación cada 90 días"
   - ❌ Malo: "el sistema bloquea cuentas tras varios intentos"

4. **Trazado a URS**: cada FRS tiene su columna `URS Origen` poblada. Si un FRS no tiene URS de origen → se actualiza el URS antes de incluir el FRS.

5. **NO describe el CÓMO**: eso va en el Design Specification (DS).
   - ✅ FRS dice: "el sistema generará un Certificado de Análisis (CoA) en PDF con plantilla configurada incluyendo encabezado corporativo, datos del lote, resultados, firmas electrónicas, código QR de verificación"
   - ❌ FRS NO dice: "se usará la librería iText 7.2.5 con templating XSL-FO compilado en JBoss EAP"

6. **Una idea por FRS**: no agrupar varias funcionalidades en un mismo FRS. Si el URS lo requiere, dividir en FRS-A, FRS-B.

### Distribución típica de FRS por categoría GAMP

| Categoría GAMP | Cantidad típica de FRS |
|---|---|
| GAMP 3 (COTS no configurado) | No suele requerir FRS formal |
| GAMP 4 (COTS configurado) | 30–80 FRS + 4–10 FRS-IF |
| GAMP 5 (Custom) | 80–250+ FRS + 5–20 FRS-IF |

### Ratio URS:FRS

Promedio típico: **1:1**. Casos especiales:
- URS complejos (workflows multi-paso) → 1 URS genera 2-3 FRS.
- URS simples (acceso, password) → varios URS pueden mapear a 1 FRS consolidado.

Importante: la cobertura inversa debe ser 100% (todo URS Mandatory → ≥ 1 FRS).

### Tipo (M / D)

- **Mandatory (M)**: ~95% de los FRS. Cualquier FRS ligado a URS Mandatory.
- **Desirable (D)**: solo cuando el URS de origen también es Desirable.

### Sub-headers de módulo en la tabla de FRS

Cuando una tabla tiene `{ subheader: "..." }` entre las filas, **el renderer NO repite el header de la tabla en cada salto de página**. Los sub-headers actúan como contexto suficiente. Esto es automático y correcto.

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **Cada FRS debe tener `URS Origen` poblado.** No se permiten FRS huérfanos.
3. **NO describir el CÓMO.** El "cómo" pertenece al DS. El FRS describe QUÉ funciones ejecuta el sistema.
4. **NO inventar capacidades técnicas.** Si el sistema es GAMP 4 (configurado por vendor), confirmar que el vendor implementa cada FRS antes de incluirlo.
5. **Anchos de tabla siempre suman 455** cuando se especifican.
6. **`type: "FRS"`** siempre en mayúsculas.
7. **`document.extras` debe incluir** `"Documento base (URS)"`, `"Total de FRS"` y `"Tipo de Validación"`.
8. **El total de FRS en `extras` debe coincidir** con la suma de FRS funcionales + FRS-IF.
9. **Colores de criticidad: usar siempre los hex exactos** (`#C0392B`, `#E67E22`, `#717D8A`).
10. **Usar `compact: true`** en la tabla de FRS y en la tabla de interfaces.
11. **IDs FRS-IF-XXX para interfaces, FRS-XXX para funcionales.** No mezclar.
12. **Performance: cada métrica DEBE tener objetivo numérico.** Sin "rápido" ni "eficiente" como objetivo.
13. **Sección "REFERENCIA AL URS" (tabla-info) es obligatoria.** Materializa la trazabilidad de origen.
14. **Matriz de aprobaciones del FRS debe incluir Revisor Técnico/IT.** En GAMP 4 con vendor externo, se recomienda firma del vendor.
15. **En modo EXTENDIDO, la sección `flujo-logico` describe la lógica funcional, NO el código.** Si una decisión menciona clases/métodos/librerías, está mal redactada — eso pertenece al DS.
16. **Cada algoritmo debe tener `trigger`, `pasos` y `frsAsociados` completos.** El campo `decisiones` y `ejemplo` son opcionales pero recomendados.

---

## Ejemplos de input

### Modo ABSTRACTO

> "Generá el FRS (modo abstracto) para LIMS-MediCorp v2.0. El URS-LIMS-MC-001 v1.0 ya está aprobado, son 27 URS funcionales + 5 URS NF. Vendor LIMS-Tech Solutions. Cliente Laboratorios MediCorp. Tiene integraciones con SAP-MM (REST), AD (LDAP), equipos HPLC/GC (OPC UA via LIMS-Bridge), SAP-QM (Webhook)."

El skill genera el JSON FRS descomponiendo cada URS en uno o más FRS técnicos, agrupándolos en sub-headers por módulo funcional, asignando criticidad heredada del URS, y generando una sección dedicada de FRS-IF para las interfaces externas. **Sin sección de Lógica Funcional.**

### Modo EXTENDIDO (recomendado para sistemas con algoritmia significativa)

> "Generá el FRS (modo extendido) para SAP EWM en CD Buenos Aires. El URS ya está aprobado con 45 URS. Sistema GAMP 4 configurado por SAP. Documentar especialmente la algoritmia de putaway (slotting por estrategia FIFO/LIFO/expiry), replenishment (waves automáticas), picking (cluster vs zone vs batch picking), packing (HU consolidation) y outbound shipment (EDI/IDOC con cliente). Cliente: <Empresa>."

El skill genera además de la tabla de FRS, una sección 7 con tipo `flujo-logico` que documenta cada algoritmo crítico:
- `ALG-IN-001`: Putaway estratégico (slotting + storage type determination)
- `ALG-IN-002`: Confirmación de inbound delivery con captura RFID
- `ALG-OUT-001`: Wave management y replenishment automático
- `ALG-OUT-002`: Picking strategy decision (cluster vs zone vs batch)
- `ALG-OUT-003`: Packing y consolidación de Handling Units
- `ALG-OUT-004`: Outbound shipment con generación de IDOC

Cada algoritmo tiene trigger + pasos + decisiones + ejemplo concreto, listos para mapearse a Test Cases del POQ.
