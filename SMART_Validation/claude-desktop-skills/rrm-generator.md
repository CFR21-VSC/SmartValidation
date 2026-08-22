---
name: rrm-generator
description: Genera el JSON de un documento RRM (Regulatory Requirements Matrix / Matriz de Requerimientos Regulatorios) para la Validation Suite de DRP. Documento DIFERENCIADOR del paquete: mapea cada artículo de las normas regulatorias aplicables (ANMAT 4159/2023, 21 CFR Part 11, EU Annex 11, ICH Q9 R1, GAMP 5) a los URS del sistema con estado coloreado (CUMPLE/PARCIAL/GAP/N/A) y trazabilidad bidireccional a RA y TC-OQ. Usar cuando el usuario tiene HLRA, URS y RA aprobados. El JSON resultante es input directo del renderer RRM — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# RRM Generator — Validation Suite

Generador del documento **RRM (Regulatory Requirements Matrix / Matriz de Requerimientos Regulatorios)**, ex-MCN.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes (anchos de tabla, márgenes, layouts densos, etc.). Este skill solo cubre lo específico del RRM.

## Cuándo usar este skill

- El usuario ya tiene **HLRA, URS y RA aprobados** (inputs principales).
- Necesita demostrar cumplimiento regulatorio de forma sistemática y auditable.
- El RRM es **el documento que da respuesta inmediata ante una auditoría** ANMAT, FDA o EMA — su valor está en la trazabilidad cruzada.
- Inputs típicos:
  - URS del paquete actual (cada requerimiento normativo se mapea a uno o más URS).
  - HLRA del paquete actual (para los GAPs e IRO global).
  - RA del paquete actual (para referenciar riesgos individuales).
  - VP del paquete actual (para alinear marco normativo y categoría GAMP).
  - Conocimiento profundo de las normas aplicables (ANMAT 4159/2023, 21 CFR Part 11, EU Annex 11, ICH Q9 R1, GAMP 5).

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Por qué es el documento DIFERENCIADOR del paquete

Lo que hace único al RRM:
- **Trazabilidad bidireccional**: Norma → URS → RA → TC → Evidencia (forward) y reverso (backward).
- **Estados coloreados** (CUMPLE/PARCIAL/GAP/N/A) que permiten al auditor identificar el nivel de cumplimiento de un vistazo.
- **Tarjetas detalladas por GAP** con severidad, controles compensatorios y flag de "REQUIERE FIRMA FORMAL" cuando aplica.
- **Una sola fuente de verdad** para responder cualquier observación regulatoria sin tener que cruzar múltiples documentos.

## Estructura del JSON RRM

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "RRM",
  "package": { /* mismo de HLRA/VP/URS/RA */ },
  "document": {
    "code": "RRM-<CODIGO>",
    "titleEs": "MATRIZ DE REQUERIMIENTOS REGULATORIOS",
    "titleEn": "REGULATORY REQUIREMENTS MATRIX (RRM)",
    "headerTitle": "Matriz de Requerimientos Regulatorios (RRM)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA>",
    "normativeFramework": "<lista de normas>",
    "extras": {
      "Documento base (URS)": "URS-<CODE> v<X> — <N> requerimientos",
      "RA Global (HLRA)": "<N> — <NIVEL>",
      "Normas mapeadas": "<N> dimensiones: ANMAT, FDA, EMA, ICH, ISPE",
      "GAPs identificados": "<N> (<X> Mayores / <Y> Menores) — todos con controles compensatorios"
    }
  },
  "trazabilidad": {
    "recibeDe": ["URS", "HLRA", "RA", "IRA"],
    "alimentaA": ["MTR", "POQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del RRM (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

Texto en 2-3 párrafos. Mencionar SIEMPRE:
- Demuestra cumplimiento regulatorio sistemático y trazable.
- Vinculación bidireccional URS ↔ Normas ↔ RA ↔ TC.
- Permite respuesta inmediata ante auditoría (interna o regulatoria).
- Listar las 4 fuentes de input: URS, normas aplicables, hallazgos de HLRA/RA, test cases del POQ.

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

**Incluido típico**: sistema completo, módulos, roles, mercados regulatorios (Argentina/USA/Europa).

**Excluido típico**: infraestructura calificada por proveedor, funcionalidades de versión Pro, **cualquier subpart o capítulo de norma que se excluya con justificación** (ej: 21 CFR Part 11 Subpart C cuando no hay firma electrónica nativa — referenciar GAP-002).

### 3. RESPONSABILIDADES (`tipo: "tabla"`)

Roles típicos del RRM:
- Validador CSV — crea, mantiene y actualiza la matriz.
- Process Owner — valida mapeo URS→Normas, acepta GAPs.
- QA Regulatorio — revisa completitud y validez de controles compensatorios.
- Gerente QA — aprobación final, co-firmante en GAPs Mayores.

### 4. DEFINICIONES Y ABREVIATURAS (`tipo: "tabla"`)

Términos OBLIGATORIOS a incluir:
- `RRM` — qué es y de qué deriva
- `URS`, `GAP`, `Control Compensatorio`
- `RA Global` (referencia al HLRA)
- `GAMP 3/4/5` (categoría asignada)
- `Trazabilidad Forward` y `Backward`
- **Estados coloreados**: `CUMPLE`, `PARCIAL`, `GAP`, `N/A` con su descripción precisa.

### 5. METODOLOGÍA DE MAPEO (`tipo: "texto"` con bloques de subtítulos)

Describir las 5 dimensiones del mapeo, una por norma. Para cada dimensión:
- Norma de referencia (texto completo).
- Aplicabilidad al sistema.
- Justificación de exclusiones si aplica.

Las 5 dimensiones estándar:
1. **ANMAT 4159/2023 Anexo VI** — Argentina, equivalente a EU Annex 11
2. **21 CFR Part 11** — FDA USA (Subpart B siempre aplicable, Subpart C condicional)
3. **EU Annex 11 / PIC/S PI 011-3** — Europa (mapeo cruzado con ANMAT)
4. **ICH Q9 R1 (2023)** — Quality Risk Management
5. **GAMP 5 Segunda Edición (2022)** — buenas prácticas ISPE

### 6. MATRICES DE CUMPLIMIENTO (`tipo: "tabla-norma"`) — UNA POR DIMENSIÓN

**Esta es la sección principal del documento.** Una tabla `tabla-norma` por cada norma. Cada tabla tiene:
- Título: "<NORMA EN MAYÚSCULAS>"
- `intro`: norma de referencia + aplicabilidad
- `cobertura`: línea de resumen ("Cobertura: 15/15 puntos | 11 CUMPLEN | 4 PARCIAL/GAP")
- `filas`: array con sub-headers de capítulo/subpart cuando aplique + filas de datos

```json
{
  "tipo": "tabla-norma",
  "titulo": "ANMAT 4159/2023 ANEXO VI",
  "intro": "Norma de referencia: ANMAT Disposición 4159/2023, Anexo VI...",
  "cobertura": "Cobertura: 15/15 puntos evaluados | 11 CUMPLEN | 4 PARCIAL/GAP documentado",
  "filas": [
    { "subheader": "SUBPART B — REGISTROS ELECTRÓNICOS" },
    {
      "punto": "1",
      "requisito": "Texto resumido del requisito normativo",
      "aplica": "Sí | No | Parcial",
      "estado": "CUMPLE | PARCIAL | GAP | N/A",
      "urs": "URS-001 | URS-NF-003",
      "raRef": "HLRA §X | RA-XXX | GAP-XXX",
      "tcOq": "TC-OQ-001 | TC-IQ-005",
      "observaciones": "Texto de controles aplicados y justificación"
    }
  ]
}
```

#### Estados coloreados (renderer aplica color automáticamente)

- **CUMPLE** → verde `#1E7E34` con fondo `#E8F5E9`
- **PARCIAL** → naranja `#B85F0F` con fondo `#FFF4E5`
- **GAP** (o "NO CUMPLE") → rojo `#A52A2A` con fondo `#FDECEA`
- **N/A** → gris `#717D8A` con fondo `#F4F6F8`

#### Sub-headers de capítulo / Subpart

Útiles cuando la norma se divide en secciones lógicas:
- 21 CFR Part 11: `SUBPART B — REGISTROS ELECTRÓNICOS` y `SUBPART C — FIRMAS ELECTRÓNICAS`
- GAMP 5: capítulos numerados (`Cap. 1 Introducción`, `Cap. 2 Conceptos clave`, etc.)
- ANMAT 4159/2023: típicamente sin subdivisión (15 puntos lineales)

### 7. ANÁLISIS DE BRECHAS REGULATORIAS (GAP ANALYSIS) — solo si hay GAPs

> **IMPORTANTE**: esta sección es **OPCIONAL**, supeditada a la existencia de GAPs.
> - Si el sistema **NO tiene GAPs** → omitir esta sección completa O reemplazar por una `caja-nota` con texto: "No se identificaron brechas regulatorias durante el mapeo realizado."
> - Si el sistema **SÍ tiene GAPs** → incluir tabla resumen + 1 tarjeta detallada por GAP.

#### 7.1 Tabla resumen (`tipo: "tabla"`)

```json
{
  "tipo": "tabla",
  "titulo": "ANÁLISIS DE BRECHAS REGULATORIAS — RESUMEN",
  "intro": "Texto introductorio.",
  "columnas": ["GAP-ID", "Tipo", "Norma", "Impacto", "URS Afectados", "Estado"],
  "widths": [50, 60, 90, 75, 100, 80],
  "filas": [
    ["GAP-001", "NC Menor", "ANMAT §9", "BAJO", "URS-XXX", { "text": "Control comp. definido", "color": "#B85F0F", "bold": true }]
  ]
}
```

#### 7.2 Tarjeta detallada por GAP (`tipo: "tarjeta-gap-rrm"`)

Una tarjeta por cada GAP. Estructura:

```json
{
  "tipo": "tarjeta-gap-rrm",
  "id": "GAP-002",
  "severidad": "GAP Mayor",
  "titulo": "Sin Firma Electrónica Nativa",
  "norma": "ANMAT §13 | 21 CFR Part 11 Subpart C | EU Annex 11 §14",
  "requisito": "Texto del requisito normativo violado",
  "impacto": "MEDIO — texto del impacto GxP",
  "descripcion": "Texto descriptivo del GAP",
  "ursAfectados": "URS-XXX | URS-YYY",
  "controlesCompensatorios": [
    "Control 1 ...",
    "Control 2 ...",
    "Control 3 ..."
  ],
  "accion": "Texto de acción requerida",
  "requiereFirma": true
}
```

**Campos clave:**
- `severidad`: `GAP Mayor` | `GAP Menor` | `NC Crítico` | `NC Menor`. El renderer pinta el header de la tarjeta con color por severidad (rojo=Mayor/Crítico, naranja=Menor).
- `controlesCompensatorios`: puede ser un array (renderiza lista numerada) o un string (renderiza párrafo único).
- `requiereFirma`: boolean. Si es `true`, el renderer agrega un banner destacado "⚠ REQUIERE FIRMA FORMAL DEL PROCESS OWNER + GERENTE QA". Usar solo en GAPs Mayores que requieren aceptación formal.

### 8. RESUMEN DE CUMPLIMIENTO NORMATIVO (`tipo: "tabla"`)

Tabla con totales por norma:

```json
{
  "tipo": "tabla",
  "titulo": "RESUMEN DE CUMPLIMIENTO NORMATIVO",
  "columnas": ["Norma", "Total Arts.", "CUMPLE", "PARCIAL/GAP", "N/A", "Observación"],
  "widths": [125, 50, 50, 60, 35, 135],
  "filas": [
    ["ANMAT 4159/2023 Anexo VI", { "text": "15", "alignment": "center" }, { "text": "11", "alignment": "center", "color": "#1E7E34", "bold": true }, ...],
    ...
    [{ "text": "TOTAL", "bold": true, "fillColor": "#EAF1F8" }, ...]
  ]
}
```

Colores manuales en celdas: verde (`#1E7E34`) para CUMPLE, naranja (`#B85F0F`) para PARCIAL/GAP, gris (`#717D8A`) para N/A. El total en negrita con fondo `#EAF1F8`.

### 9. CONCLUSIÓN Y DECISIÓN FORMAL (`tipo: "caja-conclusion"`)

Texto en párrafos. Estructura típica:
1. Nivel general de cumplimiento (% que cumple).
2. Resumen de GAPs identificados y controles compensatorios.
3. Valor del RRM como documento de referencia para auditorías.
4. **DECISIÓN explícita**: estado del sistema y firmas requeridas para avanzar a la siguiente fase.

### 10. REFERENCIAS DOCUMENTALES (`tipo: "tabla"`)

Tabla 3 columnas: `Ref. | Documento | Descripción`. Numerar referencias `[1]`, `[2]`, etc. Incluir SIEMPRE:
- Las 5 normas mapeadas (ANMAT, 21 CFR, EU Annex 11, PIC/S, ICH Q9, GAMP 5).
- Documentos del paquete: HLRA, URS, VP, RA, IRA.
- Documentación fuente: MAN, SOPs.

### 11. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`)

Estándar 4 firmantes. La `nota` debe mencionar que la aceptación de GAPs Mayores requiere firma formal de Process Owner + Gerente QA.

---

## Reglas de contenido

### Cómo escribir un buen requerimiento mapeado

1. **`requisito` en lenguaje claro y abreviado** (no copiar la norma textual completa).
   - ✅ Bueno: "Audit trail debe registrar creación, modificación y borrado de registros GxP."
   - ❌ Malo: copy-paste de 200 palabras de la norma original.

2. **`urs` siempre con referencia concreta**.
   - ✅ Bueno: "URS-001 al URS-016 | URS-NF-001"
   - ❌ Malo: "Varios URS de seguridad"
   - Si no hay URS asociado, usar "—" (no dejar vacío).

3. **`raRef` referencia al riesgo**.
   - ✅ Bueno: "RA-001 al RA-006" o "GAP-002" o "HLRA §6"
   - Si no aplica: "—"

4. **`tcOq` referencia al test case del POQ**.
   - ✅ Bueno: "TC-OQ-001 al TC-OQ-008"
   - Si el test es de IQ: "TC-IQ-XXX"
   - Si está pendiente: "—" o "PIQ + POQ (Fase 6)"

5. **`observaciones` documenta el control concreto** que justifica el estado.
   - ✅ Bueno: "Bloqueo automático tras 5 intentos (URS-003). Audit trail con IP. SOP-USO §6.1 documenta procedimiento."
   - ❌ Malo: "El sistema cumple esta norma."

### Cantidad típica de puntos por norma

| Norma | Puntos típicos |
|---|---|
| ANMAT 4159/2023 Anexo VI | 15 puntos lineales |
| 21 CFR Part 11 | 11 controles Subpart B + 5-7 Subpart C (= 16-18) |
| EU Annex 11 | 17 puntos (mapean con ANMAT) |
| ICH Q9 R1 | 6 principios |
| GAMP 5 (2da Ed.) | 11 capítulos |

Total esperado: **50-60 artículos mapeados** en sistemas GAMP 3/4 estándar.

### Distribución típica de estados

En sistemas bien diseñados:
- **CUMPLE**: 75-85% de los puntos
- **PARCIAL**: 5-15%
- **GAP**: 0-5% (raro tener GAP=NO CUMPLE en sistemas validables)
- **N/A**: 5-15% (con justificación documentada)

Sistemas con > 10% en GAP probablemente requieren rediseño antes de validar.

### GAPs y firma formal

- **GAP Menor / NC Menor**: corrección documental o procedimental. NO requiere firma formal sobre el RRM (`requiereFirma: false`). Acción: emitir versión corregida del documento afectado.
- **GAP Mayor / NC Crítica**: limitación funcional aceptada con controles compensatorios. **REQUIERE firma formal de Process Owner + Gerente QA** (`requiereFirma: true`). El renderer agrega banner destacado.

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **Cada `estado` debe ser uno de**: `CUMPLE`, `PARCIAL`, `GAP`, `N/A`. No usar variantes como "Conforme", "Cumple parcial", etc. — el renderer aplica color por palabra exacta.
3. **`type: "RRM"`** siempre en mayúsculas.
4. **`document.extras` debe incluir** `"Documento base (URS)"`, `"RA Global (HLRA)"`, `"Normas mapeadas"` y `"GAPs identificados"`.
5. **Anchos de tabla `tabla-norma` son fijos** en el renderer (no configurar). Lo mismo para `tarjeta-gap-rrm`.
6. **Sección de GAPs es supeditada a su existencia.** Si el sistema no tiene GAPs, OMITIR la sección o reemplazar por mensaje breve. NO incluir tarjetas vacías.
7. **`requiereFirma: true` solo para GAPs Mayores / NC Críticos** que requieren aceptación formal. No usar en GAPs Menores.
8. **Trazabilidad obligatoria**: cada fila de `tabla-norma` debe tener al menos `urs` o `raRef` poblado (no ambos vacíos). Excepción: filas N/A pueden tener `urs="—"` y `raRef="—"`.
9. **Subpart C de 21 CFR Part 11**: si el sistema NO tiene firma electrónica nativa, listar Subpart C como **N/A** con justificación, y referenciar GAP-002 (sin firma).
10. **Equivalencias ANMAT ↔ EU Annex 11**: en la tabla de EU Annex 11, las observaciones deben mencionar la equivalencia ("Equivalente a ANMAT §X") para evitar duplicar todo el texto.

---

## Ejemplo de input mínimo

> "Generá el RRM para DRP-GAMP Categorizador™ (DRP-SIS-001). Tengo HLRA-DRP-SIS-001 (GAMP 3, RA Global=32, 4 GAPs identificados: GAP-001 inconsistencia documental Menor, GAP-002 sin firma electrónica Mayor, GAP-003 sin almacenamiento Mayor, GAP-004 sin 2FA Menor), URS-DRP-SIS-001 (55 requerimientos), RA-DRP-SIS-001 (24 riesgos), VP-DRP-SIS-001. Mercados: Argentina, USA, Europa. Process Owner: Federico Bongiovanni. Subpart C de 21 CFR Part 11 excluida (relacionada a GAP-002)."

El skill genera el JSON RRM completo con:
- 5 dimensiones mapeadas (ANMAT, 21 CFR, EU Annex 11, ICH Q9, GAMP 5).
- Cada punto normativo con estado coloreado (CUMPLE/PARCIAL/GAP/N/A) y trazabilidad URS↔RA↔TC.
- Sección de GAP Analysis con tabla resumen + 4 tarjetas detalladas (GAP-002 y GAP-003 con `requiereFirma: true`).
- Resumen estadístico, conclusión con DECISIÓN formal, referencias completas.
