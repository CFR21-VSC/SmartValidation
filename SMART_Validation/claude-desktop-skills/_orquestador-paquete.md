---
name: orquestador-paquete-validacion
description: Orquesta la generación EN CADENA del paquete documental de validación GxP completo (HLRA → VP → URS → FRS → DS → RA → IRA → RRM → MTR → PIQ → IIQ → RIQ → POQ → IOQ → ROQ → PPQ → IPQ → RPQ → NCR → VSR). Usar al ARRANCAR un paquete nuevo o al retomar uno en curso. Captura los invariantes del sistema una sola vez, dicta el orden de generación, indica qué documento/info alimentar en cada paso, y aplica las reglas de coherencia transversales para que los 20 docs salgan mutuamente consistentes. NO genera los JSON — eso lo hacen los skills individuales (hlra-generator, urs-generator, etc.). Este skill es el "director de orquesta": mantiene el contexto y el control del flujo.
---

# Orquestador del Paquete de Validación — Validation Suite DRP

Este skill **no genera documentos**. Su trabajo es mantener la **coherencia de la cadena**: que los 20 documentos del paquete compartan el mismo contexto, los mismos códigos, las mismas convenciones, y que las referencias cruzadas (URS↔RA↔TC↔GAP) cierren.

Cada documento individual lo genera su skill propio (`hlra-generator`, `urs-generator`, etc.). Este orquestador te dice **qué generar, en qué orden, con qué input, y bajo qué reglas**.

> **Filosofía**: cadena con control. Cada documento es un checkpoint humano — se genera, se revisa, se importa a la Suite, y recién ahí se pasa al siguiente. La IA propone; el humano valida y firma.

---

## PASO 0 — Capturar el contexto del paquete (UNA SOLA VEZ)

Antes de generar el primer documento, establecé los **invariantes** del sistema. Estos datos NO cambian a lo largo del paquete y deben aparecer idénticos en los 20 documentos.

Pedile al usuario:

| Dato | Ejemplo | Dónde impacta |
|---|---|---|
| **Nombre del sistema** | `DRP-GAMP Categorizador` | `package.systemName` en todos los docs |
| **Código del paquete** | `DRP-SIS-001` | `package.code` + prefijo de todo código de doc |
| **Versión del sistema** | `1.1` | `package.systemVersion` |
| **Cliente / Empresa** | `DRP Assurance Solutions` | `package.client` |
| **Categoría GAMP** | `GAMP 3` / `GAMP 4` / `GAMP 5` | Define si FRS/DS aplican + profundidad de tests |
| **Tipo de sistema** | `Web SaaS` / `On-premise` / `Híbrido` | Define alcance del IRA (cloud vs facility) |
| **Proveedor** | `DRP Assurance Solutions` | `package.vendor` |
| **Fecha de inicio del ciclo** | `Marzo 2026` | Base para fechas de emisión |
| **Marco normativo aplicable** | `ANMAT 4159/2023 \| 21 CFR Part 11 \| EU Annex 11 \| ICH Q9` | `package.normativeFramework` |
| **QMS / etiqueta de calidad** | `Sistema de Gestión de Calidad GxP` | `package.qmsLabel` |

### Output del Paso 0 — el bloque de contexto

Construí este bloque y **devolvéselo al usuario para que lo guarde**. Es lo que se pega al inicio del prompt de cada skill individual:

```
═══ CONTEXTO DEL PAQUETE — pegar al inicio de cada generación ═══
package.code        : DRP-SIS-001
package.systemName  : DRP-GAMP Categorizador
package.systemVersion: 1.1
package.client      : DRP Assurance Solutions
package.vendor      : DRP Assurance Solutions
package.qmsLabel    : Sistema de Gestión de Calidad GxP
package.normativeFramework: ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | ICH Q9
Categoría GAMP      : GAMP 3
Tipo de sistema     : Web SaaS
Fecha inicio ciclo  : Marzo 2026
Versión inicial de TODOS los docs: 1.0
═══════════════════════════════════════════════════════════════
```

El objeto `package` JSON que va **idéntico en los 20 documentos** (canon completo — incluye todos los campos aunque alguno quede vacío):

```json
"package": {
  "code": "DRP-SIS-001",
  "systemName": "DRP-GAMP Categorizador",
  "systemVersion": "1.1",
  "systemSubtitle": "<subtítulo o descripción corta del sistema — opcional>",
  "client": "DRP Assurance Solutions",
  "vendor": "DRP Assurance Solutions",
  "qmsLabel": "Sistema de Gestión de Calidad GxP",
  "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | ICH Q9",
  "year": 2026
}
```

> **Nota**: `systemSubtitle` puede omitirse si el nombre del sistema es suficientemente descriptivo. `year` es el año de inicio del ciclo de validación. Todos los demás campos son obligatorios.

---

## PROTOCOLO DE COHERENCIA — OBLIGATORIO ANTES DE CADA DOCUMENTO

> **Desde el tercer documento en adelante** (es decir, cualquier documento que pueda
> referenciar IDs ya existentes), ejecutar el protocolo del skill `_coherence-enforcer`
> ANTES de invocar el generador específico.

Flujo comprimido:
1. `GET /api/projects/{id}/documents` → obtener docs actuales
2. `POST http://localhost:8765/coherence-pack` con `generatingFor: "TIPO"` → Context Pack
3. Verificar `isClean: true` y `sequenceGaps: []` antes de proceder
4. Usar `nextId` del Context Pack para todos los IDs nuevos
5. Usar solo IDs de `validReferenceIds` en referencias cruzadas

Ver `_coherence-enforcer.md` para el protocolo completo y la checklist post-generación.

---

## LA CADENA DE GENERACIÓN

Generá los documentos en este orden. Cada fila indica: qué skill usar, qué alimentarle como input, qué produce, y qué documentos posteriores dependen de él.

### Fase A — Especificación

| # | Doc | Skill | Input que necesita | Produce / IDs que define |
|---|---|---|---|---|
| 1 | **HLRA** | `hlra-generator` | Manual del sistema, descripción, SOPs | Categoría GAMP confirmada, criticidad GxP, **GAP-NNN**, estrategia de validación |
| 2 | **VP** | `vp-generator` | HLRA generado | Plan de validación, cronograma, alcance IQ/OQ/PQ |
| 3 | **URS** | `urs-generator` | Manual, SOPs, HLRA, VP | **URS-NNN** y **URS-NF-NNN** (requerimientos) — base de TODO lo que sigue |
| 4 | **FRS** | `frs-generator` | URS generado | **FRS-NNN**, **FRS-IF-NNN**, **ALG-NNN** (si modo extendido). *Opcional según GAMP — ver nota.* |
| 5 | **DS** | `ds-generator` | FRS generado | Diseño técnico, componentes. *Opcional según GAMP — ver nota.* |

### Fase B — Análisis de Riesgo

| # | Doc | Skill | Input que necesita | Produce / IDs que define |
|---|---|---|---|---|
| 6 | **RA** | `ra-generator` | URS generado, GAPs del HLRA | **RA-NNN** (riesgos FMEA operativos S×P×D) |
| 7 | **IRA** | `ira-generator` | Arquitectura del sistema, tipo (cloud/on-premise) | **COMP-SW/INF/SEC-NN** (componentes), score IRA |
| 8 | **RRM** | `rrm-generator` | URS, RA, marco normativo | Mapeo Norma↔URS↔RA, GAPs normativos |
| 9 | **MTR** | `mtr-generator` | URS, RA, IRA (los IDs de cada uno) | Matriz de trazabilidad — **linkea todo**. Tiene validador interno. |

### Fase C — Calificación de Instalación (IQ)

| # | Doc | Skill | Input que necesita | Produce / IDs que define |
|---|---|---|---|---|
| 10 | **PIQ** | `piq-generator` | IRA generado (componentes + score) | **TC-IQ-NNN** (test cases de instalación) |
| 11 | **IIQ** | `iiq-generator` | PIQ generado + evidencias capturadas en el Gestor | Resultados de ejecución, **NC-NNN** (hallazgos) |
| 12 | **RIQ** | `riq-generator` | IIQ generado | Cierre IQ: NCs gestionadas + decisión final |

### Fase D — Calificación Operacional (OQ)

| # | Doc | Skill | Input que necesita | Produce / IDs que define |
|---|---|---|---|---|
| 13 | **POQ** | `poq-generator` | URS + RA (riesgos funcionales) | **TC-OQ-NNN** (test cases operacionales, procedimiento numerado) |
| 14 | **IOQ** | `ioq-generator` | POQ generado + evidencias del Gestor | Resultados de ejecución, NCs |
| 15 | **ROQ** | `roq-generator` | IOQ generado | Cierre OQ: NCs gestionadas + decisión final |

### Fase E — Calificación de Performance (PQ)

| # | Doc | Skill | Input que necesita | Produce / IDs que define |
|---|---|---|---|---|
| 16 | **PPQ** | `ppq-generator` | URS + RA (escenarios end-to-end de uso real) | **TC-PQ-NNN** (escenarios de performance) |
| 17 | **IPQ** | `ipq-generator` | PPQ generado + evidencias del Gestor | Resultados de ejecución, NCs |
| 18 | **RPQ** | `rpq-generator` | IPQ generado | Cierre PQ: NCs gestionadas + decisión final |

### Fase F — Cierre

| # | Doc | Skill | Input que necesita | Produce / IDs que define |
|---|---|---|---|---|
| 19 | **NCR** | (skill NCR) | Cualquier desvío detectado en IIQ/IOQ/IPQ | Gestión 4 etapas: registro → causa raíz → CAPA → cierre |
| 20 | **VSR** | (skill VSR) | **TODO el paquete generado** | Reporte resumen del ciclo + decisión global de validación |
| — | **AEX** | (desde el Gestor) | Evidencias raw capturadas | Anexo de ejecución (Tomo II del libro) — no se genera con skill |

### Nota sobre FRS/DS según GAMP

- **GAMP 3** (software estándar configurable): FRS y DS suelen ser **opcionales** o muy livianos. El HLRA lo confirma.
- **GAMP 4** (configurado): FRS sí, en **modo abstracto** o **extendido** (con `flujo-logico`) según haya algoritmia significativa. DS documenta CONFIGURACIÓN, no desarrollo.
- **GAMP 5** (custom): FRS extendido + DS completo obligatorios.
- **La decisión FRS abstracto vs extendido se consulta con el usuario** antes de generar el FRS.

---

## REGLAS DE COHERENCIA TRANSVERSALES

Estas reglas aplican a **todos** los documentos. Son las que mantienen la cadena consistente. Verificalas en cada generación.

### 1. El bloque `package` es idéntico en los 20 docs
Copiá el bloque del Paso 0 sin modificar ni un campo. Si cambió algo del sistema, se actualiza en TODOS los docs, no en uno solo.

### 2. Versión inicial = `1.0` (nunca `0.1`)
Todo documento nuevo arranca en `document.version: "1.0"`. El primer registro de `controlCambios` también dice `"version": "1.0"`. Sin excepciones.

### 3. Siglas canónicas — NO usar variantes legacy
| Canónico | Legacy PROHIBIDO |
|---|---|
| `HLRA` | — |
| `VP` | `PV` |
| `URS` | — |
| `FRS` | `ERF` |
| `DS` | `ED` |
| `RA` | `RAI` ⚠ |
| `IRA` | `IRAI` ⚠ |
| `RRM` | `MCN` ⚠ |
| `MTR` | — |
| `PIQ / IIQ / RIQ` | — |
| `POQ / IOQ / ROQ` | — |
| `PPQ / IPQ / RPQ` | — |
| `NCR` | — |
| `VSR` | `IF` (Informe Final) |
| `AEX` | — |

### 4. Códigos de documento: `{TIPO}-{package.code}`
- `URS-DRP-SIS-001`, `RA-DRP-SIS-001`, `PIQ-DRP-SIS-001`, etc.
- El renderer lo autogenera si no se provee, pero es mejor declararlo explícito en `document.code`.

### 5. IDs internos — formato fijo y consistencia entre docs
| Tipo de ID | Formato | Definido en | Referenciado en |
|---|---|---|---|
| Requerimiento funcional | `URS-001` … `URS-NNN` | URS | RA, RRM, MTR, POQ, PPQ |
| Requerimiento no funcional | `URS-NF-001` … | URS | RRM, MTR, POQ |
| Requerimiento funcional técnico | `FRS-001`, `FRS-IF-001` | FRS | DS, MTR |
| Algoritmo | `ALG-001` … | FRS extendido | DS |
| Riesgo operativo (FMEA) | `RA-001` … `RA-NNN` | RA | RRM, MTR, POQ |
| Componente de infraestructura | `COMP-SW-01`, `COMP-INF-01`, `COMP-SEC-01` | IRA | PIQ, MTR |
| GAP regulatorio | `GAP-001` … | HLRA / RRM | RA (campo `control`), RRM |
| Test Case IQ | `TC-IQ-001` … | PIQ | IIQ, RIQ, MTR |
| Test Case OQ | `TC-OQ-001` … | POQ | IOQ, ROQ, MTR, RA (campo `control`) |
| Test Case PQ | `TC-PQ-001` … | PPQ | IPQ, RPQ, MTR |
| No conformidad | `NC-001` … | IIQ/IOQ/IPQ (embebida en TC) | NCR, RIQ/ROQ/RPQ, VSR |

**Regla crítica de la cadena:** si el RA referencia `URS-005`, ese `URS-005` DEBE existir en el URS generado antes. Cuando generes un documento que referencia IDs de un doc anterior, **pedile al usuario el doc anterior** (o sus IDs) como input — no inventes IDs.

### 6. Formatos de fecha — uno por campo, consistente
| Campo | Formato | Ejemplo |
|---|---|---|
| `document.issueDate` | Mes-largo + año | `"Marzo 2026"` |
| `controlCambios[].fecha` | Mes-corto + año | `"Mar 2026"` |
| `matrizAprobaciones[].fecha` | DD/MM/YYYY | `"15/03/2026"` |

### 7. Severidad — dos escalas distintas, no mezclar
- **Clasificación de NC** (femenino, pharma estándar): exactamente 4 niveles en este orden: `OBSERVACIÓN / MENOR / MAYOR / CRÍTICA` → usar en NCR, VSR, VP, HLRA (severidad de GAP).
  - ⚠️ Nunca usar `"NC CRÍTICA"` — el prefijo `"NC "` está prohibido. El valor canónico es `"CRÍTICA"` a secas.
  - ⚠️ Nunca usar la escala masculina (`ALTO`, `CRÍTICO`) para clasificar NCs.
- **Intensidad de prioridad** (masculino): `CRÍTICO / ALTO / MEDIO / BAJO` → usar en MTR (criticidad de trazabilidad), severidad de impacto de TC.
- **RA / IRA** usan numérico S/P/D/RR — sin labels textuales.
- **Severidad inmutable**: en RA, la `S` NO baja con mitigación. Solo P y D bajan. `RR = S × P_post × D_post`, siempre `RR ≥ S`.

### 8. Trazabilidad obligatoria — sin huérfanos
- Ningún `FRS` sin `URS` de origen. Ningún `RA` sin `URS` vinculado. Ningún `TC-OQ` sin `URS` que verifica.
- Si surge una necesidad sin origen, **primero se actualiza el documento aguas arriba**, no se inventa el link.
- La `MTR` materializa toda la cadena — si la MTR marca un URS sin TC-OQ, es un error real, no un warning.

### 9. Output de cada skill = un único objeto JSON
Sin Markdown, sin notas, sin texto fuera del JSON. El JSON entra directo por "Importar doc al proyecto" en la Suite.

### 10. Formato de `trazabilidad.recibeDe` según tipo de documento

El campo `recibeDe` tiene dos formatos según si el documento es de **planificación** o de **ejecución**:

- **Documentos de planificación** (HLRA, VP, URS, FRS, DS, RA, IRA, RRM, MTR, PIQ, POQ, PPQ): array de strings simples.
  ```json
  "recibeDe": ["HLRA", "URS", "RA"]
  ```

- **Documentos de ejecución y reporte** (IIQ, IOQ, IPQ, RIQ, ROQ, RPQ, NCR, VSR): array de objetos con referencia completa.
  ```json
  "recibeDe": [{ "tipo": "PIQ", "code": "PIQ-<CODE>", "version": "v1.0", "estado": "aprobado" }]
  ```

La lógica es semántica: los documentos de ejecución declaran formalmente *de qué versión aprobada del protocolo* parten. Los documentos de planificación solo nombran la categoría de input.

### 11. Skip de FRS y DS según categoría GAMP

La obligatoriedad de FRS y DS depende de la categoría GAMP determinada en el HLRA:

| Documento | GAMP 3 | GAMP 4 | GAMP 5 |
|---|---|---|---|
| FRS | No aplica | Obligatorio | Obligatorio |
| DS  | No aplica | Opcional    | Obligatorio |

En el Modo A (Claude Desktop Project), esta decisión debe tomarse explícitamente al llegar al paso 4/5 de la cadena: si GAMP 3, saltar FRS y DS y continuar con RA. No hay mecanismo automático de skip — el usuario decide en base al `gampCategory` del HLRA aprobado.

---

## CHECKPOINT HUMANO — después de cada documento

No avances al siguiente documento hasta completar este ciclo:

1. **Generar** — el skill individual produce el JSON.
2. **Revisar** — el humano lee el JSON: nombres reales, fechas, GAPs reales (no inventados), IDs coherentes con docs previos.
3. **Importar** — cargar el JSON en la Validation Suite (botón "Importar doc al proyecto" o pegar en Suite Validación).
4. **Previsualizar** — generar el PDF y verificar que renderiza bien (sin desbordes, firmas en su lugar).
5. **Firmar** (opcional en esta etapa) — firma electrónica por rol con PIN.
6. **Recién ahí** — pasar al siguiente documento de la cadena.

Si un documento posterior necesita IDs de uno anterior, el anterior ya está revisado e importado → los IDs son confiables.

---

## CÓMO TRABAJAR CON ESTE ORQUESTADOR

**Al arrancar un paquete nuevo:**
1. Invocá este skill → completá el Paso 0 → guardá el bloque de contexto.
2. Seguí la cadena fila por fila.
3. Para cada documento: pegá el bloque de contexto + el input que pide esa fila, e invocá el skill individual correspondiente.
4. Aplicá el checkpoint humano antes de avanzar.

**Al retomar un paquete en curso:**
1. Invocá este skill → indicá hasta qué documento ya generaste.
2. El orquestador te dice cuál sigue y qué necesita de input.
3. Continuás desde ahí.

**Si un documento sale incoherente** (ID que no existe, sigla legacy, versión 0.1):
- Es una falla de coherencia de cadena. Revisá contra las "Reglas de coherencia transversales".
- Corregí el documento, no el orquestador.

---

## RESUMEN DE LA CADENA (referencia rápida)

```
Paso 0: CONTEXTO ──────────────────────────────────────┐
                                                       │ (se pega en cada paso)
  FASE A — Especificación                              │
  1. HLRA ──→ 2. VP ──→ 3. URS ──→ 4. FRS ──→ 5. DS    │
                          │                            │
  FASE B — Riesgo         ▼                            │
  6. RA ──→ 7. IRA ──→ 8. RRM ──→ 9. MTR ◀── (linkea)  │
                                   │                   │
  FASE C — IQ                      ▼                   │
  10. PIQ ──→ 11. IIQ ──→ 12. RIQ                      │
                                                       │
  FASE D — OQ                                          │
  13. POQ ──→ 14. IOQ ──→ 15. ROQ                      │
                                                       │
  FASE E — PQ                                          │
  16. PPQ ──→ 17. IPQ ──→ 18. RPQ                      │
                                                       │
  FASE F — Cierre                                      │
  19. NCR (transversal)  20. VSR (recibe todo)  AEX ◀──┘
```

Cada flecha `──→` es un checkpoint humano: generar → revisar → importar → recién avanzar.
