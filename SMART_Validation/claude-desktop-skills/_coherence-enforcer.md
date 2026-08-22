---
name: coherence-enforcer
description: >
  PROTOCOLO OBLIGATORIO de coherencia GxP. Cargar ANTES de cualquier skill generador
  (urs-generator, ra-generator, piq-generator, poq-generator, ioq-generator, mtr-generator, etc.).
  Establece el flujo pre-generación → generación → post-validación que garantiza que
  los IDs sean secuenciales sin saltos, las referencias sean a IDs que existen, y ningún
  auditor pueda encontrar una incoherencia de numeración o trazabilidad.
---

# Enforcer de Coherencia GxP — Protocolo Obligatorio

> **Regla de oro**: Un auditor GxP compara cada ID con cada referencia. Un ID inventado,
> un salto en la numeración, o una referencia a algo que no existe en el paquete
> es una **No-Conformidad automática**. Este protocolo existe para hacer eso imposible.

---

## FASE 0 — Antes de generar: obtener el Context Pack

**Nunca empieces a generar un documento sin ejecutar este paso.**

### 0.1 Pedir los documentos existentes al usuario

Antes de llamar al motor de analytics, necesitás los JSON actuales del proyecto.
Pedile al usuario que ejecute en la Suite (o en la consola del servidor):

```
GET http://localhost:11294/api/projects/{PROJECT_ID}/documents
```

Esto devuelve un objeto `{ "docs": { "URS": {...}, "RA": {...}, "PIQ": {...}, ... } }`.

### 0.2 Llamar al endpoint de coherencia

Con los documentos, llamar al motor de analytics:

```http
POST http://localhost:8765/coherence-pack
Content-Type: application/json

{
  "projectId": "EMQC-001",
  "documents": { /* los docs del paso 0.1 */ },
  "generatingFor": "IOQ"   ← tipo de doc que vas a generar
}
```

### 0.3 Leer el Context Pack y anclarte a él

El Context Pack devuelve:

```jsonc
{
  "idInventory": {
    "URS":   { "existing": ["URS-001",...,"URS-015"], "nextId": "URS-016", "gaps": [] },
    "RA":    { "existing": ["RA-001",...,"RA-007"],   "nextId": "RA-008",  "gaps": [] },
    "TC-IQ": { "existing": ["TC-IQ-001",...,"TC-IQ-010"], "nextId": "TC-IQ-011", "gaps": [] },
    "TC-OQ": { "existing": ["TC-OQ-001",...,"TC-OQ-018"], "nextId": "TC-OQ-019", "gaps": [] }
  },
  "validReferenceIds": {
    "allUrsIds": ["URS-001", ..., "URS-015", "URS-NF-001", ...],
    "allRaIds":  ["RA-001", ..., "RA-007"]
  },
  "coverage": {
    "ursWithoutIQ": ["URS-011", "URS-012"],   ← los que NECESITAN TCs nuevos
    "raWithoutTc":  ["RA-006", "RA-007"]       ← riesgos sin mitigación
  },
  "generationConstraints": {
    "nextTcId":    "TC-IQ-011",
    "ursIdsToUse": [...],
    "raIdsToUse":  [...]
  },
  "sequenceGaps":    [],   ← DEBE estar vacío antes de generar
  "referenceErrors": [],   ← DEBE estar vacío antes de generar
  "isClean": true
}
```

**Si `isClean` es `false`**: detener, reportar los problemas al usuario, y NO generar hasta que se resuelvan. Un documento construido sobre bases incoherentes hereda y amplifica la incoherencia.

---

## FASE 1 — Reglas absolutas de generación

Una vez que tenés el Context Pack, aplicar estas reglas sin excepción:

### R1 — Secuencialidad estricta de IDs

El próximo ID de cada prefijo es EXACTAMENTE `nextId` del Context Pack.

```
✅ CORRECTO (Context Pack dice nextId = "TC-OQ-019"):
   Primer TC nuevo → TC-OQ-019
   Segundo TC nuevo → TC-OQ-020
   Tercer TC nuevo  → TC-OQ-021

❌ PROHIBIDO:
   TC-OQ-019, TC-OQ-021 (salto — NC automática)
   TC-OQ-025 (número inventado)
   TC-OQ-018 (ya existe — duplicado)
```

### R2 — Solo referencias a IDs validados

Cada campo de referencia cruzada (`ursVinculados`, `raVinculado`, `frsOrigen`, `ursId`) debe contener SOLO IDs que aparecen en `validReferenceIds`.

```
✅ CORRECTO (URS-003 está en allUrsIds):
   "ursVinculados": ["URS-003", "URS-007"]

❌ PROHIBIDO:
   "ursVinculados": ["URS-099"]   ← no existe
   "ursVinculados": ["URS-003", "URS-099"]   ← uno válido, uno inventado
   "raVinculado": "RA-015"   ← no existe si solo hay RA-001..RA-007
```

### R3 — Cobertura prioritaria de gaps

Antes de agregar TCs para URS ya cubiertos, cubrir primero los que están en `coverage.ursWithoutIQ` (o `ursWithoutOQ` según la fase). Ídem para `raWithoutTc`.

```
Si ursWithoutIQ = ["URS-011", "URS-012"]:
  → Los primeros TCs nuevos deben cubrir URS-011 y URS-012.
  → Solo después generar TCs adicionales para URS ya cubiertos (mayor profundidad).
```

### R4 — Consistencia del texto con el requisito vinculado

El texto de cada TC debe ser inequívocamente derivable del URS y/o RA que referencia. Si el URS-007 describe "el sistema debe calcular OOS/OOT aplicando la regla 3-sigma", el TC vinculado debe describir exactamente eso, no otra funcionalidad.

### R5 — Sin inventar especificaciones

Los valores aceptables, criterios de aprobación, y parámetros de configuración de cada TC deben basarse en lo que dice el URS/FRS/RA vinculado. Nunca inventar criterios que no estén respaldados por un requisito documentado.

### R6 — Formato de ID siempre con 3 dígitos

```
✅ TC-IQ-001, TC-OQ-019, RA-007, URS-015
❌ TC-IQ-1, TC-OQ-19, RA-7, URS-15
```

---

## FASE 2 — Post-generación: auto-auditoría antes de entregar

Antes de entregar el JSON generado al usuario, realizar esta checklist:

### Checklist de coherencia interna

```
□ 1. SECUENCIA: Los IDs nuevos son una secuencia continua desde nextId.
      No hay saltos. El último ID nuevo = nextId + (cantidad_generada - 1).

□ 2. REFERENCIAS URS: Cada "ursVinculados" contiene solo IDs de allUrsIds.
      Ningún URS-XXX que no exista en el Context Pack.

□ 3. REFERENCIAS RA: Cada "raVinculado" contiene solo IDs de allRaIds.
      Si el RA está vacío o no aplica, usar cadena vacía "", nunca un ID inventado.

□ 4. COBERTURA GAP-FIRST: Los URS de ursWithoutIQ/ursWithoutOQ están cubiertos
      por al menos un TC nuevo.

□ 5. DUPLICADOS: Ningún tcId, ursId, raId aparece dos veces en el documento generado.

□ 6. CONSISTENCIA DE TEXTO: El objetivo/descripción de cada TC coincide con
      lo que describe el URS o RA vinculado (leer ambos y verificar).

□ 7. PROFUNDIDAD VS RIESGO: Si RA vinculado es CRÍTICO → nivel "Exhaustivo" (≥ 3 pasos).
      ALTO → "Estándar" (≥ 2 pasos). MEDIO/BAJO → "Básico" (≥ 1 paso).

□ 8. SIN CAMPOS VACÍOS OBLIGATORIOS: tcId, ursVinculados, objetivo, pasosPrueba,
      criterioAceptacion, resultado (= "Pendiente") deben estar siempre presentes.
```

### Si algún ítem del checklist falla

Corregir ANTES de entregar. Si hay una ambigüedad genuina (ej. no se sabe a qué RA vincular un TC), señalarlo explícitamente al usuario en un bloque separado fuera del JSON:

```
⚠️ DECISIÓN PENDIENTE:
   TC-OQ-023 → No hay RA asociado al requisito URS-012 (módulo de exportación CSV).
   Opciones: (a) vincular a RA-005 (riesgo de integridad de datos), (b) crear RA-008 nuevo.
   El TC fue generado con raVinculado="" hasta que el usuario decida.
```

---

## FASE 3 — Validación post-importación (con el motor Python)

Una vez que el usuario importa el documento a la Suite, correr el análisis completo:

```http
POST http://localhost:8765/analyze
Content-Type: application/json

{
  "projectId": "EMQC-001",
  "documents": { /* todos los docs incluyendo el recién importado */ }
}
```

El resultado incluye:
- `cascadeIssues`: incoherencias entre documentos consecutivos
- `gaps`: URS sin cobertura de TC
- `coherenceIssues`: TCs con profundidad insuficiente para su score de riesgo
- `score`: 0-100 (70% cobertura URS + 30% mitigación riesgos)

**Objetivo mínimo GxP**: `score ≥ 85` y `gaps` vacío antes de ejecutar protocolos.

---

## Resumen del flujo completo

```
┌─────────────────────────────────────────────────────────────────────┐
│  FASE 0  GET /api/projects/{id}/documents → documentos existentes   │
│          POST /coherence-pack → Context Pack (isClean debe ser true)│
├─────────────────────────────────────────────────────────────────────┤
│  FASE 1  Generar documento usando SOLO IDs del Context Pack         │
│          nextId para nuevos, allUrsIds/allRaIds para referencias     │
│          Priorizar ursWithoutIQ, raWithoutTc                        │
├─────────────────────────────────────────────────────────────────────┤
│  FASE 2  Auto-auditoría 8-puntos antes de entregar JSON             │
│          Reportar decisiones pendientes fuera del JSON              │
├─────────────────────────────────────────────────────────────────────┤
│  FASE 3  POST /analyze con todos los docs → score ≥ 85, gaps = []  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Cómo integrar este skill con los generadores

Este skill se **pre-pende** a cualquier generador. El flujo de uso en Claude Desktop es:

1. Cargar `_coherence-enforcer` (este skill)
2. Cargar el generador específico (`ioq-generator`, `ra-generator`, etc.)
3. Pegar el Context Pack obtenido en Fase 0
4. Ejecutar la generación

Si el usuario ya tiene el Context Pack en la ventana de contexto (porque lo obtuvo en una sesión anterior o lo tiene guardado), puede pegarlo directamente y saltar al paso 4.

---

## Señales de alarma — detener inmediatamente si ves:

| Señal | Acción |
|---|---|
| `sequenceGaps` tiene elementos | Reportar gaps al usuario. No generar hasta que se rellenen o se justifiquen. |
| `referenceErrors` tiene elementos | Reportar al usuario. Los TCs que citan IDs inválidos son NC automáticas. |
| El usuario pide "saltear" la validación previa | Explicar que un auditor detectará los saltos. Ofrecer generar el Context Pack primero. |
| Se genera un ID que no sigue de nextId | Corregir inmediatamente, no avanzar. |
| Un campo `ursVinculados` queda vacío | Reportar como decisión pendiente, no dejar vacío silenciosamente. |
