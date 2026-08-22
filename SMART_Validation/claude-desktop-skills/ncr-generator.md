---
name: ncr-generator
description: Genera el JSON de un documento NCR (Non-Conformance Report — Reporte de No Conformidades y CAPA) para la Validation Suite de DRP. Documento unificado que registra los hallazgos de ejecución, su análisis de causa raíz, el plan de acciones correctivas/preventivas (CAPA) y el cierre formal. Workflow gated de 4 etapas con firmas por etapa. Usar cuando aparecen hallazgos durante la ejecución de un IIQ/IOQ/IPQ que requieren gestión formal. El JSON resultante es input directo del renderer NCR — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# NCR Generator — Validation Suite

Generador del documento **NCR (Reporte de No Conformidades y CAPA)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) e [`iiq-generator.md`](./iiq-generator.md) / [`ioq-generator.md`](./ioq-generator.md) (los hallazgos del NCR vienen de los TCs ejecutados ahí).

## Cuándo usar este skill

- Durante la ejecución de un **IIQ / IOQ / IPQ** aparecieron hallazgos (NCs) que requieren gestión formal de causa raíz + CAPA.
- El usuario necesita consolidar esos hallazgos en un documento con workflow controlado.
- Inputs típicos:
  - Documento(s) de origen de los hallazgos (IIQ/IOQ/IPQ + el `tcRef` de cada NC).
  - Descripción de cada NC, su criticidad, fecha de apertura.
  - Análisis de causa raíz aplicado (5-porqués, Ishikawa, etc.).
  - Plan CAPA: acción correctiva + acción preventiva por NC.
  - Evidencia de cierre y verificación.

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Workflow gated de 4 etapas

El NCR tiene 4 secciones gated. **Cada sección queda "BLOQUEADA" hasta que la anterior tenga todas sus firmas obligatorias.** El renderer aplica el gating visualmente. Las 4 etapas en orden:

```
1. ncr-registro-hallazgos  → firma: Validador Ejecutor
2. ncr-analisis-causa      → firmas: Process Owner + QA Reviewer
3. ncr-plan-capa           → firmas: Responsable CAPA + Aprobador QA
4. ncr-cierre-aprobacion   → firmas: Gerente QA + (opcional) Director
```

Cada sección gated tiene:
- `estado`: `"pendiente"` | `"en_revision"` | `"aprobada"` | `"rechazada"`.
- `firmasRequeridas`: array de `{ rol, obligatoria }`.
- `firmas`: array de firmas reales `{ rol, nombre, iniciales, fecha }`.

Para un NCR completo (estado final), las 4 secciones van con `estado: "aprobada"` y sus `firmas` pobladas.

## Estructura del JSON NCR

```json
{
  "schemaVersion": "1.0",
  "type": "NCR",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "NCR-<CODIGO>",
    "titleEs": "REPORTE DE NO CONFORMIDADES Y CAPA",
    "titleEn": "NON-CONFORMANCE REPORT (NCR)",
    "headerTitle": "Reporte de No Conformidades y CAPA (NCR)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §6 | ICH Q9",
    "extras": {
      "Documento(s) base (Hallazgos)": "IOQ-<CODE> v<X> (<N> TCs ejecutados)",
      "NCs registradas": "<N> (<NC-001 OBS / NC-002 CRÍTICA>)",
      "Estado del workflow": "CERRADO — todas las CAPAs verificadas",
      "Etapa actual": "4 — Cierre y Aprobación Final (CERRADA)"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del NCR. Consolida los <N> hallazgos del <doc origen>. Workflow completado en 4 etapas con firmas trazables por etapa." }
  ],
  "matrizAprobaciones": [
    { "rol": "Identificador NC (Ejecutor)", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Process Owner", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Responsable CAPA", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Aprobador (Gerente QA)", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": [{ "tipo": "IOQ", "code": "IOQ-<CODE>", "version": "v1.0", "estado": "aprobado" }],
    "alimentaA": ["ROQ", "VSR"]
  },
  "secciones": [ ... ]
}
```

> **Nota de fase — recibeDe y alimentaA varían según el origen del NCR:**
> | Fase de origen | `recibeDe[0].tipo` | `alimentaA` |
> |---|---|---|
> | IQ | `"IIQ"` | `["RIQ", "VSR"]` |
> | OQ | `"IOQ"` | `["ROQ", "VSR"]` |
> | PQ | `"IPQ"` | `["RPQ", "VSR"]` |
>
> El template usa OQ como ejemplo. Ajustar según la fase real donde se originaron los hallazgos.

## Secciones del NCR (en este orden)

1. **PROPÓSITO Y OBJETIVO** (`tipo: "texto"`) — qué consolida el NCR + explicación del workflow gated de 4 etapas.

2. **DATOS GENERALES** (`tipo: "tabla-info"`, `labelWidth: 165`) — documento(s) base, NCs registradas, período de gestión, etapa actual, estado workflow.

3. **ESTADO DEL WORKFLOW** (`tipo: "ncr-workflow-indicator"`) — indicador visual del progreso de las 4 etapas. Sólo `titulo` + `intro`, el renderer lo dibuja desde el estado de las secciones gated.

4. **ETAPA 1 — REGISTRO DE HALLAZGOS** (`tipo: "ncr-registro-hallazgos"`)
   - `estado: "aprobada"`, `firmasRequeridas: [{ rol: "Validador Ejecutor", obligatoria: true }]`, `firmas: [...]`.
   - `hallazgos`: array de `{ id, tipo, criticidad, tcRef, docOrigen, descripcion, fechaApertura }`.
     - `id`: formato `NC-NNN`.
     - `tipo`: `"OBS"` | `"NC"`.
     - `criticidad`: `"OBSERVACIÓN"` | `"MENOR"` | `"MAYOR"` | `"CRÍTICA"`.

5. **ETAPA 2 — ANÁLISIS DE CAUSA RAÍZ** (`tipo: "ncr-analisis-causa"`)
   - `estado: "aprobada"`, `firmasRequeridas: [{ rol: "Process Owner", obligatoria: true }, { rol: "QA Reviewer", obligatoria: true }]`, `firmas: [...]`.
   - `analisis`: array (1 por NC) de `{ ncId, tipoAnalisis, porques: [...], causaRaizIdentificada, factorSistemico, recurrente, ncRecurrenteRef, impactoScope }`.
     - `tipoAnalisis`: `"5-porqués"`, `"5-porqués (abreviado)"`, `"Ishikawa"`, etc.
     - `porques`: array de strings — la cadena de porqués hasta la causa raíz.
     - `impactoScope`: `"TC"` | `"sistema"` | `"proceso"`.

6. **ETAPA 3 — PLAN CAPA** (`tipo: "ncr-plan-capa"`)
   - `estado: "aprobada"`, `firmasRequeridas: [{ rol: "Responsable CAPA", obligatoria: true }, { rol: "Aprobador QA", obligatoria: true }]`, `firmas: [...]`.
   - `capas`: array (1 por NC) de `{ ncId, accionCorrectiva, accionPreventiva, responsable, fechaCompromiso, fechaCierre, evidenciaCierre, verificadoPor, estadoCapa }`.
     - `accionCorrectiva` (CA): el fix inmediato del problema puntual.
     - `accionPreventiva` (PA): la acción sistémica para evitar recurrencia.
     - `estadoCapa`: `"PENDIENTE"` | `"EN CURSO"` | `"VERIFICADA"`.

7. **ETAPA 4 — CIERRE Y APROBACIÓN FINAL** (`tipo: "ncr-cierre-aprobacion"`)
   - `estado: "aprobada"`, `firmasRequeridas: [{ rol: "Gerente QA", obligatoria: true }, { rol: "Director (firma final)", obligatoria: false }]`, `firmas: [...]`.
   - `resumen`: objeto `{ totalNcs, ncCerradas, ncAbiertas, ncCriticas, criticasCerradas, diasPromedioCierre, factorSistemico, decisionFinal }`.
     - `decisionFinal`: párrafo de cierre formal.

8. **REFERENCIAS** (`tipo: "tabla"`, `["Documento", "Título"]`, widths `[180, 275]`).

9. **FIRMAS CONSOLIDADAS DEL PROCESO** (`tipo: "tabla-firmas-final"`)
   - `rolesPlaceholder: ["Identificador NC (Ejecutor)", "Process Owner", "Responsable CAPA", "Aprobador (Gerente QA)"]`.
   - `nota`: ej. `"NCR cerrado el DD/MM/AAAA — sistema apto para <fase siguiente>."`

## Principio CAPA — el más importante del NCR

Cada NC se gestiona con **DOS acciones distintas**:
- **Acción Correctiva (CA)**: arregla el problema puntual. "Apliqué el fix CSS en commit X."
- **Acción Preventiva (PA)**: evita que la causa raíz vuelva a generar el problema en el futuro. "Incorporé verificación cross-browser al checklist del SOP-QA-007."

Si una NC sólo tiene CA y no PA, el análisis de causa raíz quedó incompleto — la causa raíz sistémica no se atacó. Un NCR bien hecho siempre tiene PA cuando `factorSistemico: true`.

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **`type: "NCR"`** siempre.
3. **Los IDs de NC (`NC-NNN`) deben coincidir** entre las 4 etapas: el `id` del registro, el `ncId` del análisis, el `ncId` de la CAPA, y el conteo del cierre. Trazabilidad interna obligatoria.
4. **Cada NC registrada en etapa 1 debe tener su análisis en etapa 2 y su CAPA en etapa 3.** Sin huérfanos.
5. **El workflow es gated**: para un NCR cerrado, las 4 secciones van con `estado: "aprobada"` y `firmas` pobladas que cumplen las `firmasRequeridas` obligatorias.
6. **`criticidad` válida**: `OBSERVACIÓN` / `MENOR` / `MAYOR` / `CRÍTICA` (escala de clasificación de NC — femenino). NO usar la escala de intensidad (CRÍTICO/ALTO/MEDIO/BAJO).
7. **`factorSistemico: true` ⇒ debe haber `accionPreventiva`** en la CAPA correspondiente.
8. **`resumen.ncAbiertas` debe ser 0** para que el NCR esté en estado CERRADO. Si hay NCs abiertas, el workflow no está completo.
9. **Versión `1.0`**. Fechas: `issueDate` mes largo, `controlCambios.fecha` mes corto, firmas `DD/MM/AAAA`.

## Ejemplo de input mínimo

> "Generá el NCR para DRP-GAMP Categorizador™. Durante la ejecución del IOQ-DRP-SIS-001 v1.0 aparecieron 2 hallazgos: NC-001 (OBS, TC-OQ-024) — calendar picker no renderiza en Firefox, bug menor de UI; NC-002 (CRÍTICA, TC-OQ-032) — hash SHA-256 no coincide con caracteres especiales en el nombre del sistema. Causa raíz NC-002: la función de hash no normaliza UTF-8. CAPA NC-002: fix de normalización NFC + ampliación de la metodología de generación de TCs para cubrir UTF-8. Ambas NCs cerradas con CAPA verificada. Workflow firmado en 4 etapas."

El skill genera el NCR con las 4 etapas gated aprobadas, NC-001 y NC-002 trazadas a través de registro → análisis 5-porqués → plan CAPA (CA + PA) → cierre, resumen con 2/2 cerradas, factor sistémico true, firmas por etapa pobladas.
