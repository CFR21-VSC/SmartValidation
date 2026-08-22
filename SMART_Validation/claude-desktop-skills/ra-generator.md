---
name: ra-generator
description: Genera el JSON de un documento RA (Risk Analysis / Análisis de Riesgos Operativo) para la Validation Suite de DRP. Usar cuando el usuario tiene HLRA, VP y URS aprobados, y necesita el análisis FMEA de cada riesgo operativo del sistema vinculado a uno o más URS de origen. El JSON resultante es input directo del renderer RA — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# RA Generator — Validation Suite

Generador del documento **RA (Risk Analysis / Análisis de Riesgos Operativo)** según FMEA, ICH Q9 R1 y GAMP 5 Segunda Edición.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes (anchos de tabla, márgenes, sub-headers de grupo, etc.). Este skill solo cubre lo específico del RA.

## Cuándo usar este skill

- El usuario ya tiene **HLRA, VP y URS aprobados** (inputs principales).
- Necesita identificar y evaluar los **riesgos operativos** del sistema usando FMEA.
- Cada riesgo se vincula a uno o más URS de origen y a los GAPs del HLRA.
- Inputs típicos:
  - HLRA del paquete actual (para los GAPs y nivel IRO global)
  - URS del paquete actual (cada riesgo se vincula a 1+ URS)
  - VP del paquete actual (para alinear marco normativo)
  - Manual del sistema (MAN) y SOPs operativos (para identificar peligros)

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Principio fundamental — SEVERIDAD INMUTABLE

> **LA SEVERIDAD (S, también llamada Gravedad) NO PUEDE DISMINUIRSE CON MITIGACIÓN, YA QUE ES INHERENTE AL PELIGRO ASOCIADO.**

Este es el principio rector de FMEA conforme ICH Q9 R1 e ISO 31000:

- **S (Severidad / Gravedad)**: propiedad inherente del peligro. Se evalúa **una vez** y queda fija. Solo baja si se **elimina la causa raíz** (no se mitiga, se elimina el peligro entero).
- **P (Probabilidad)**: puede reducirse con controles preventivos (procedimientos, capacitación, redundancia, validación de input).
- **D (Detectabilidad)**: puede reducirse con controles detectivos (alertas, audit trail, validaciones automáticas, monitoreo).

**Cálculo:**
- `RI (Riesgo Inicial) = S × P × D` (con S, P, D iniciales sin mitigar)
- `RR (Riesgo Residual) = S × P_post × D_post` (S sigue igual, P y D bajan tras mitigación)

**Regla de validación obligatoria del skill:**
- Antes de generar `RR`, **verificar siempre que `RR / S` sea un entero ≥ 1** (es decir, RR es múltiplo de S).
- Si `RR < S`, el cálculo está mal: revisar y volver a calcular sin tocar S.
- En el JSON, el campo `RR` viene **ya calculado por el skill** respetando esta regla. El renderer solo lo pinta con su nivel coloreado.

## Diferencia clave HLRA vs RA

| | HLRA | RA |
|---|---|---|
| Pregunta que responde | ¿Cuán crítico es el sistema en su conjunto? | ¿Qué riesgos operativos específicos tiene cada función? |
| Granularidad | Sistema completo (1 IRO global) | 1 fila por modo de fallo (típico 15-50 filas) |
| Métrica principal | IRO (Índice de Riesgo Operativo) | RI / RR por cada modo de fallo |
| Output | GAPs + decisión sobre nivel de validación | Test cases priorizados por RR para POQ |
| Origen | Manual / SOPs / panorama del sistema | URS + HLRA + Manual + SOPs |

## Estructura del JSON RA

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "RA",
  "package": { /* mismo de HLRA/VP/URS */ },
  "document": {
    "code": "RA-<CODIGO>",
    "titleEs": "ANÁLISIS DE RIESGOS OPERATIVO",
    "titleEn": "RISK ANALYSIS — OPERATIONAL (FMEA)",
    "headerTitle": "Análisis de Riesgos Operativo (RA)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA, ej: GAMP 3 — COTS no configurado>",
    "normativeFramework": "<de HLRA>",
    "extras": {
      "Documento base (URS)": "URS-<CODE> v<X.Y> — <N> requerimientos",
      "Metodología": "FMEA — ICH Q9 R1 — GAMP 5 2da Ed.",
      "Total riesgos evaluados": "<N> riesgos operativos (<F> funcionales + <I> infraestructura)"
    }
  },
  "controlCambios": [...],
  "matrizAprobaciones": [
    /* Roles típicos: Validador, Process Owner, Jefe de Validaciones, Gerente QA */
  ],
  "trazabilidad": {
    "recibeDe": ["HLRA", "VP", "URS"],
    "alimentaA": ["IRA", "MTR", "POQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del RA (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

Texto en 2 párrafos. Mencionar SIEMPRE:
- Identifica y evalúa riesgos operativos usando FMEA conforme ICH Q9 R1 / GAMP 5.
- Cada riesgo está vinculado a uno o más URS de origen (trazabilidad bidireccional).
- Los controles son los del sistema (MAN/SOP-USO/SOP-ADM) o compensatorios documentados en el HLRA.

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

**Incluido típico:**
- Funciones operativas por módulo funcional (autenticación, gestión de usuarios, funcionalidad principal, reportes, integridad, infraestructura).
- Procesos GxP impactados.
- Total de modos de fallo derivados del URS.

**Excluido típico:**
- Riesgos de infraestructura cloud → cubiertos en IRA.
- Riesgos del proceso de desarrollo (perspectiva del vendor).
- Riesgos de funcionalidades no contratadas/no validadas.

### 3. METODOLOGÍA FMEA

Tres sub-secciones:

**3.1 Enfoque** (`tipo: "subseccion"`):
Texto explicando: para cada función → identificar modos de fallo → evaluar SPD inicial → definir controles → recalcular RR.

**3.2 Escalas de Puntuación** (`tipo: "escalas-fmea"`):

```json
{
  "tipo": "escalas-fmea",
  "titulo": "3.2 Escalas de Puntuación",
  "escalaS": [
    { "valor": 1, "nivel": "Baja", "descripcion": "Sin impacto en datos GxP ni en validez del reporte." },
    { "valor": 2, "nivel": "Media", "descripcion": "Impacto indirecto en proceso GxP; resultado auditable comprometido parcialmente." },
    { "valor": 3, "nivel": "Alta", "descripcion": "Impacto directo en validez del reporte, integridad de datos o categorización incorrecta." }
  ],
  "escalaP": [
    { "valor": 1, "nivel": "Baja", "descripcion": "El fallo es improbable bajo uso normal." },
    { "valor": 2, "nivel": "Media", "descripcion": "El fallo puede ocurrir ocasionalmente." },
    { "valor": 3, "nivel": "Alta", "descripcion": "El fallo es probable o ha ocurrido en sistemas similares." }
  ],
  "escalaD": [
    { "valor": 1, "nivel": "Alta detección", "descripcion": "El fallo es obvio e inmediatamente visible para el usuario." },
    { "valor": 2, "nivel": "Media detección", "descripcion": "El fallo puede pasar desapercibido en algunos casos." },
    { "valor": 3, "nivel": "Baja detección", "descripcion": "El fallo puede no detectarse hasta impactar un proceso GxP downstream." }
  ],
  "niveles": [
    { "rango": "1-6", "nivel": "BAJO", "accion": "Aceptable. Monitoreo estándar." },
    { "rango": "7-14", "nivel": "MEDIO", "accion": "Mitigación obligatoria. TC dedicado en OQ." },
    { "rango": "15-27", "nivel": "ALTO", "accion": "Requiere control compensatorio documentado." }
  ],
  "nota": "Objetivo de mitigación: todos los riesgos con RI ALTO (≥15) deberán reducirse a RR MEDIO o BAJO. La SEVERIDAD nunca se reduce con mitigación: es propiedad inherente del peligro."
}
```

Las escalas estándar son S/P/D de 1-3 (escala simple). El renderer las muestra en grid 2×2 (S+P arriba, D+Niveles abajo) y la `nota` queda destacada con borde azul.

### 4. MATRIZ DE RIESGOS FMEA (LA TABLA PRINCIPAL — `tipo: "tabla-fmea"`)

**Esta es la sección más importante del documento.** Tabla con 9 columnas y agrupada por módulo usando sub-headers.

```json
{
  "tipo": "tabla-fmea",
  "titulo": "MATRIZ DE RIESGOS FMEA",
  "intro": "Cada riesgo está mapeado a su URS de origen. Las columnas S, P, D representan Severidad, Probabilidad y Detectabilidad en estado inicial. RI = Riesgo Inicial (S × P × D). RR = Riesgo Residual tras aplicar controles.",
  "filas": [
    { "subheader": "MÓDULO A — <Nombre del módulo> (URS-XXX a URS-YYY)" },
    {
      "id": "RA-001",
      "urs": "URS-XXX",
      "peligro": "<Texto del peligro / modo de fallo + impacto GxP>",
      "S": 3, "P": 2, "D": 2,
      "control": "<Texto del control de mitigación, con referencias a URS / MAN / SOP / TC. Si hay GAP del HLRA: GAP-XXX: descripción.>",
      "RR": 3
    },
    ...
    { "subheader": "MÓDULO B — ..." },
    ...
  ],
  "notaInferior": "LA SEVERIDAD NO PUEDE DISMINUIRSE CON MITIGACIÓN, YA QUE ES INHERENTE AL PELIGRO ASOCIADO Y NO ES POSIBLE DE MITIGAR."
}
```

**Cálculo automático:**
- El renderer calcula `RI = S × P × D` y lo muestra con su nivel coloreado (BAJO/MEDIO/ALTO).
- El renderer **NO recalcula** `RR` — toma el valor que vino. El skill garantiza que `RR = S × P_post × D_post` con S inmutable.

**Colores de niveles:**
- BAJO (1-6) → verde `#27AE60`
- MEDIO (7-14) → naranja `#E67E22`
- ALTO (15-27) → rojo `#C0392B`

#### Cómo escribir un buen riesgo en RA

1. **Cada `peligro` describe el modo de fallo + impacto GxP.**
   - ✅ Bueno: "Acceso no autorizado mediante credenciales compartidas. Un usuario no habilitado accede a funciones de categorización y genera reportes inválidos."
   - ❌ Malo: "Problemas de seguridad."

2. **Cada `control` lista controles concretos del sistema o compensatorios.**
   - ✅ Bueno: "Bloqueo automático tras 3 intentos fallidos (URS-003). Audit trail con IP (URS-006). GAP-001: inconsistencia MAN/SOP corregida en URS-003."
   - ❌ Malo: "El sistema tiene controles de seguridad."
   - **Referenciar siempre**: URS, sección de MAN/SOP, y TC del POQ que verificará el control.

3. **`urs` lista 1+ URS separados por `|`** (sin espacios alrededor: "URS-009 | URS-010 | URS-011").

4. **`id` con formato `RA-NNN`** (correlativo, 3 dígitos).

5. **GAPs del HLRA se mencionan en el control** (no en columna separada). Ej: "GAP-001: ...", "GAP-002 documentado en HLRA §10".

#### Sub-headers típicos por dominio

Adaptar a cada sistema. Ejemplos:

**Sistema con autenticación + funcionalidad central + reportes:**
- MÓDULO A — AUTENTICACIÓN Y CONTROL DE ACCESO
- MÓDULO B — GESTIÓN DE USUARIOS Y ROLES
- MÓDULO C — <Funcionalidad central (cuestionario, workflow, batch, etc.)>
- MÓDULO D — GENERACIÓN DE REPORTES
- MÓDULO E — INTEGRIDAD DE DATOS / FIRMA / HASH
- MÓDULO F — INFRAESTRUCTURA, DISPONIBILIDAD Y AUDIT TRAIL

**LIMS (LIMS-MediCorp):**
- A — Autenticación y RBAC
- B — Recepción y Registro de Muestras
- C — Workflow Analítico
- D — Gestión de Resultados y Liberación
- E — Reportes y CoA
- F — Audit Trail e Integridad
- G — Backup y Continuidad

### 5. RESUMEN DE RESULTADOS (`tipo: "tabla"`)

Tabla con totales por módulo:

```json
{
  "tipo": "tabla",
  "titulo": "RESUMEN DE RESULTADOS",
  "intro": "La siguiente tabla muestra los riesgos medios o superiores y su análisis de riesgo residual. Los riesgos bajos no se incluyen en la tabla, ya que si bien son desafiados, funcionalmente están mitigados por diseño.",
  "columnas": ["Módulo", "Riesgos evaluados", "RI ALTO (≥15)", "RI MEDIO (7-14)", "RR ALTO"],
  "widths": [165, 80, 70, 80, 60],
  "filas": [
    ["A — <Nombre>", { "text": "<N>", "alignment": "center" }, { "text": "<N>", "alignment": "center" }, { "text": "<N>", "alignment": "center" }, { "text": "<N>", "alignment": "center" }],
    ...
    [{ "text": "TOTAL", "bold": true, "fillColor": "#EAF1F8" }, { "text": "<N>", "alignment": "center", "bold": true, "fillColor": "#EAF1F8" }, { "text": "<N>", "alignment": "center", "bold": true, "fillColor": "#EAF1F8" }, { "text": "<N>", "alignment": "center", "bold": true, "fillColor": "#EAF1F8" }, { "text": "<N>", "alignment": "center", "bold": true, "fillColor": "#EAF1F8" }]
  ]
}
```

Después una `caja-conclusion` con 1-2 párrafos: "Ningún riesgo presenta RI ALTO. Todos los riesgos tienen RR BAJO tras mitigación. El sistema es apto para IQ/OQ."

### 6. ACEPTACIÓN FORMAL DEL RIESGO RESIDUAL (`tipo: "aceptacion-riesgo-residual"`)

Sección obligatoria con conclusión + items numerados + tabla mini de firmas (default 2 firmas: Process Owner + Gerente QA):

```json
{
  "tipo": "aceptacion-riesgo-residual",
  "titulo": "ACEPTACIÓN FORMAL DEL RIESGO RESIDUAL",
  "conclusion": "En base al análisis realizado, el Riesgo Residual de todos los peligros identificados es BAJO (RR ≤ 6) tras aplicar los controles de mitigación documentados. Se concluye que:",
  "items": [
    "Ningún riesgo identificado supera RR = 6 (Bajo) tras mitigación.",
    "Los <N> GAPs regulatorios (GAP-001 a GAP-XXX del HLRA) tienen controles compensatorios adecuados al nivel de riesgo GAMP <X> / IRO <NIVEL>.",
    "Los <N> riesgos identificados están cubiertos por test cases en el PIQ o el POQ.",
    "El sistema es apto para proceder a la ejecución de la IQ y OQ."
  ],
  "firmas": [
    { "rol": "Process Owner", "nombre": "<Nombre>", "iniciales": "<Iniciales>", "fecha": "<DD/MM/YYYY>" },
    { "rol": "Gerente QA", "nombre": "<Nombre>", "iniciales": "<Iniciales>", "fecha": "<DD/MM/YYYY>" }
  ]
}
```

Si `firmas` está vacío, usa `rolesPlaceholder` (default `["Process Owner", "Gerente QA"]`). Para sumar firmantes en proyectos críticos, override vía `rolesPlaceholder`: `["Process Owner", "Jefe de Validaciones", "Gerente QA", "Director Médico"]`.

### 7. REFERENCIAS

Tabla 2 columnas (`Código / Referencia | Título`). Incluir SIEMPRE:
- URS del paquete actual (referencia principal)
- HLRA del paquete actual (GAPs e IRO global)
- VP del paquete actual
- Manual del sistema (MAN)
- SOPs operativos (SOP-USO, SOP-ADM)
- ICH Q9 R1 (2023) — Quality Risk Management
- GAMP 5 — 2da Ed. 2022
- ANMAT 4159/2023 Anexo VI
- 21 CFR Part 11

### 8. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`) — OBLIGATORIA

**No confundir con la Aceptación del Riesgo Residual (Sección 6).** Son dos tablas distintas:
- **Sección 6 (`aceptacion-riesgo-residual`)**: 2 firmas específicas (PO + Gerente QA) que aceptan formalmente el RR del análisis FMEA.
- **Sección 8 (`tabla-firmas-final`)**: 4 firmas estándar del documento (Validador, PO, Jefe Validaciones, Gerente QA) que aprueban el documento completo.

```json
{
  "tipo": "tabla-firmas-final",
  "titulo": "FIRMAS DE EJECUCIÓN",
  "intro": "Las firmas digitales o electrónicas siguientes evidencian la revisión y aprobación formal del Análisis de Riesgos Operativo. La aceptación específica del riesgo residual quedó documentada en la Sección 6 con firma de Process Owner + Gerente QA.",
  "firmas": [
    { "rol": "Redactor (Validador)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" },
    { "rol": "Revisor (Process Owner)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" },
    { "rol": "Aprobador (Jefe de Validaciones)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" },
    { "rol": "Aprobador (Gerente QA)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" }
  ],
  "nota": "Documento sujeto a firma electrónica. La firma manuscrita en este recuadro solo aplica como respaldo físico cuando no es viable la firma digital."
}
```

---

## Reglas de contenido

### Cantidad típica de riesgos por categoría GAMP

| Categoría GAMP | Cantidad típica de riesgos |
|---|---|
| GAMP 1 (Infraestructura) | No suele requerir RA formal (cubierto en IRA) |
| GAMP 3 (COTS no configurado) | 15-30 riesgos operativos |
| GAMP 4 (COTS configurado) | 25-60 riesgos operativos |
| GAMP 5 (Custom) | 40-100+ riesgos operativos |

### Distribución típica por módulo

- Autenticación/Acceso: 4-8 riesgos
- Gestión de Usuarios/Roles: 2-4 riesgos
- Funcionalidad central: 4-12 riesgos (depende complejidad)
- Reportes/Salidas: 2-5 riesgos
- Integridad/Hash/Firma: 3-5 riesgos
- Infraestructura/Audit/Backup: 3-6 riesgos

### Distribución típica por nivel

En sistemas bien diseñados (la mayoría de casos):
- **RI ALTO (≥15)**: 0-2 riesgos (excepcional)
- **RI MEDIO (7-14)**: 50-70% de los riesgos
- **RI BAJO (≤6)**: 30-50% de los riesgos
- **RR ALTO**: idealmente 0 (si queda algún ALTO al final → es un GAP nuevo)
- **RR BAJO (≤6)**: idealmente 100%

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **SEVERIDAD INMUTABLE — la regla más importante.** En todas las filas, `RR ≥ S × 1 × 1 = S`. El skill DEBE verificar antes de escribir cada `RR`.
   - Si calculaste P_post=1 y D_post=1 → RR = S × 1 × 1 = S (mínimo posible).
   - Si quisieras RR < S → ERROR. Eso requiere eliminar el peligro, no mitigarlo.
3. **Cada riesgo tiene su `urs` poblado.** No se permiten riesgos huérfanos sin URS de origen.
4. **`id` correlativo `RA-NNN`** (3 dígitos: RA-001, RA-002, ...).
5. **GAPs del HLRA se mencionan en el control**, no en columna separada.
6. **`type: "RA"`** siempre en mayúsculas.
7. **`document.extras` debe incluir** `"Documento base (URS)"`, `"Metodología"` y `"Total riesgos evaluados"`.
8. **Anchos de tabla**: en `tabla-fmea` el renderer usa anchos fijos (no configurar). En tablas auxiliares, sumar exactamente 455.
9. **`tabla-fmea` soporta sub-headers** con `{ "subheader": "..." }`. El renderer detecta y desactiva `headerRows` automáticamente para evitar doble header en saltos de página.
10. **Aceptación formal**: 2 firmas por default (Process Owner + Gerente QA). Override solo si el cliente exige firmas adicionales.
11. **Excluir explícitamente** infraestructura cloud (va en IRA) y desarrollo del producto (perspectiva vendor).
12. **`notaInferior` en tabla-fmea es OBLIGATORIA** y debe contener literalmente el principio de severidad inmutable.

---

## Ejemplo de input mínimo

> "Generá el RA para DRP-GAMP Categorizador™ (DRP-SIS-001). Tengo HLRA-DRP-SIS-001 v0.1 (GAMP 3, IRO 32 Bajo-Medio, 4 GAPs), URS-DRP-SIS-001 v0.1 (45 requerimientos), VP-DRP-SIS-001 v0.1, Manual MAN-GAMP-CAT-001 v1.0 y SOPs USO+ADM. Sistema: web app de categorización GAMP con autenticación, cuestionario adaptativo, reportes PDF firmados con SHA-256, portal QR de verificación, alojado en AWS US-East-1. Process Owner: Federico Bongiovanni."

El skill genera el JSON RA con:
- ~24 riesgos operativos agrupados en 6 módulos (Autenticación, Usuarios/Roles, Cuestionario, Reportes, SHA-256/QR, Infraestructura).
- Cada riesgo con SPD inicial calculado, control extraído del MAN/SOP/URS, GAPs del HLRA referenciados.
- RR pre-calculado respetando S inmutable (todos los RR son múltiplos de S).
- Resumen estadístico, conclusión y aceptación formal con 2 firmantes.
