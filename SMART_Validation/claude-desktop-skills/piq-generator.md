---
name: piq-generator
description: Genera el JSON de un documento PIQ (Installation Qualification Protocol / Protocolo de Calificación de Instalación) para la Validation Suite de DRP. Define los Test Cases ANTES de ejecutar la IQ, con enfoque CSA (Computer Software Assurance, FDA 2022) — risk-based, criterios consolidados, sin scripts micro-prescriptivos. Usar cuando el usuario tiene IRA aprobado y los componentes técnicos identificados. El JSON resultante es input directo del renderer PIQ — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# PIQ Generator — Validation Suite

Generador del documento **PIQ (Installation Qualification Protocol / Protocolo de Calificación de Instalación)** con enfoque **CSA (Computer Software Assurance, FDA 2022)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md). Este skill solo cubre lo específico del PIQ.

## Cuándo usar este skill

- El usuario ya tiene **IRA aprobado** (input crítico — los componentes a calificar salen del IRA).
- Necesita el protocolo que define los TCs **ANTES** de ejecutarlos.
- En el PIQ NO van resultados, NO van hallazgos, NO van firmas de ejecución. Solo placeholders. Eso es del IIQ.
- Inputs típicos:
  - IRA del paquete actual (16 componentes con RA-Score).
  - URS (URSs vinculados a cada componente).
  - RA (RA-IDs vinculados).
  - HLRA (categoría GAMP, IRO).

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Filosofía CSA — qué generar y qué NO generar

### ❌ NO generar (estilo CSV viejo)
- Tablas de "Procedimiento" con 6-8 pasos micro-prescriptivos por TC ("Abrir Chrome", "Hacer click en URL", "Verificar candado verde"...).
- Columna "Resultado Esperado" por paso individual.
- Columna "Resultado Real" por paso (los resultados van en el IIQ, no acá).
- Cualquier dato de ejecución (estado, ejecutor, fecha, firma).

### ✅ SÍ generar (estilo CSA moderno)
- **Matriz unificada** al inicio (vista ejecutiva): 1 fila por TC con su componente, RA, URS, profundidad.
- **Bloques detallados por TC**: objetivo + precondiciones + criterios consolidados + evidencia esperada.
- **Profundidad de verificación** explícita según RA Score (Básica/Estándar/Exhaustiva).
- **Justificación de proporcionalidad** al final (por qué este alcance es suficiente para la categoría GAMP del sistema).

## Schema del Test Case del PIQ (solo especificación — sin campos de ejecución)

```json
{
  "tcId": "TC-IQ-001",
  "titulo": "Verificar accesibilidad y versión App Web",
  "componente": "COMP-SW-01",
  "componenteDesc": "App Web (https://...)",
  "raScore": 27,
  "ursVinculados": ["URS-044"],
  "raVinculado": "RA-021",
  "grupo": "Aplicación Web",
  "profundidad": "Exhaustiva",
  "objetivo": "Confirmar que la URL responde HTTPS 200 y la versión es visible.",
  "precondiciones": ["Sistema operacional", "Navegador disponible"],
  "criterios": [
    "Endpoint HTTPS responde 200 OK",
    "Versión publicada coincide con IRA",
    "Sin advertencias de certificado"
  ],
  "evidenciaEsperada": "Screenshot de la pantalla principal con URL y versión visibles",
  "notas": "Opcional — observaciones técnicas"
}
```

**Reglas estrictas del Test Case:**
1. `tcId` formato exacto: `TC-IQ-NNN` (3 dígitos).
2. `componente` formato del IRA: `COMP-SW-NN`, `COMP-INF-NN`, `COMP-SEC-NN` o `"—"` si es transversal.
3. `raScore`: número 1-27 (heredado del IRA-Score). Si no aplica → `null`.
4. `profundidad`: derivada del raScore — `"Exhaustiva"` (9-27), `"Estándar"` (5-8), `"Básica"` (1-4).
5. `criterios`: array de strings — qué se verifica. Mínimo 2-3, máximo 6 por TC.
6. `evidenciaEsperada`: string descriptivo — qué evidencia se va a capturar.
7. **NO incluir** campos de ejecución (`estado`, `ejecutor`, `fechaEjecucion`, `firma`, `evidenciasGestor`, `hallazgos`). Esos son del IIQ.

## Estructura del JSON PIQ

```json
{
  "schemaVersion": "1.0",
  "type": "PIQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "PIQ-<CODIGO>",
    "titleEs": "PROTOCOLO DE CALIFICACIÓN DE INSTALACIÓN",
    "titleEn": "INSTALLATION QUALIFICATION PROTOCOL (PIQ)",
    "headerTitle": "Protocolo de Calificación de Instalación (PIQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría GAMP del paquete>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "URL Sistema": "<URL>",
      "Documento base (IRA)": "IRA-<CODE> v<X> — <N> componentes",
      "Total TCs IQ": "<N> TCs (X ALTO / Y MEDIO / Z BAJO)",
      "Enfoque": "CSA (Computer Software Assurance) — risk-based, criterios consolidados"
    }
  },
  "trazabilidad": {
    "recibeDe": ["IRA", "URS", "RA", "RRM", "MTR"],
    "alimentaA": ["IIQ", "RIQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del PIQ (en este orden)

1. **PROPÓSITO Y OBJETIVO** (`tipo: "texto"`)
   - Mencionar IRA + URS de origen
   - **Mencionar explícitamente el enfoque CSA** (no CSV)
   - Justificar por qué CSA aplica al sistema

2. **ALCANCE** (`tipo: "lista-incluido-excluido"`)
   - Incluido: componentes del IRA, categorías funcionales
   - Excluido: funcionalidad operacional (OQ), PQ si no aplica, integraciones futuras

3. **DOCUMENTOS DE REFERENCIA** (`tipo: "tabla"`) — todos los del paquete

4. **CONDICIONES DE EJECUCIÓN** (`tipo: "tabla-info"`)
   - Ambiente
   - Pre-requisitos (qué necesita el ejecutor antes de empezar)
   - Herramientas (incluir **"Gestor de Evidencias 3.0"** si aplica)
   - Criterio global (típicamente: 100% PASS para aprobar)

5. **MATRIZ UNIFICADA DE TEST CASES** (`tipo: "matriz-tc"`)
   - Vista ejecutiva: 1 fila por TC
   - Columnas auto-renderizadas por el renderer

6. **TEST CASES — INSTALLATION QUALIFICATION** (`tipo: "tabla-test-case"`)
   - `agruparPorGrupo: true` para que el renderer cree sub-headers por grupo funcional
   - Array `tcs` con todos los TCs

7. **JUSTIFICACIÓN DE PROPORCIONALIDAD (CRITICAL THINKING)** (`tipo: "texto"`)
   - Por qué este alcance es suficiente para la categoría GAMP del sistema
   - Distribución de TCs por profundidad
   - Cobertura URS↔TC-IQ (mencionar MTR)
   - Aceptación del enfoque CSA

8. **REFERENCIAS** (`tipo: "tabla"`)
   - Incluir SIEMPRE: FDA Draft Guidance 2022 (CSA), GAMP 5 §8.2, ICH Q9 R1, ANMAT, EU Annex 11, 21 CFR Part 11

9. **FIRMAS DE APROBACIÓN DEL PROTOCOLO** (`tipo: "tabla-firmas-final"`)
   - 4 firmas estándar (Elaboró / Revisó / Aprobó / Process Owner)
   - Son las firmas que APRUEBAN el protocolo antes de la ejecución, NO firmas de ejecución
   - Las firmas de ejecución van en el IIQ, no acá

## Cantidad típica de TCs por sistema

| Categoría GAMP | TCs típicos |
|---|---|
| GAMP 3 (COTS no configurado) | 10-20 TCs |
| GAMP 4 (COTS configurado) | 15-30 TCs |
| GAMP 5 (Custom) | 25-50 TCs |

Distribución típica por profundidad (en sistemas SaaS):
- Exhaustiva (RA ALTO): 60-80%
- Estándar (RA MEDIO): 10-25%
- Básica (RA BAJO): 10-20%

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown.
2. **NO incluir campos de ejecución** en los TCs (`estado`, `ejecutor`, etc.) — esos son del IIQ.
3. **NO escribir scripts paso a paso** en lugar de criterios consolidados (estilo CSV viejo).
4. **Cada TC debe tener componente del IRA** (formato `COMP-XX-NN`) — sin componente, no hay trazabilidad.
5. **`profundidad` debe coincidir con el raScore**: 9-27 → Exhaustiva, 5-8 → Estándar, 1-4 → Básica.
6. **`criterios` array con 2-6 items** — ni 1 (insuficiente) ni 10+ (volvés al CSV viejo).
7. **`evidenciaEsperada` debe ser concreto** — describir qué se captura, no genérico.
8. **`agruparPorGrupo: true`** en `tabla-test-case` para que el renderer agrupe por grupo funcional.
9. **Justificación CSA al final es OBLIGATORIA** — sin esa sección un auditor pregunta "¿por qué tan poco testing?".
10. **Trazabilidad declarativa**: cada TC menciona explícitamente el `componente` (IRA), `ursVinculados` (URS), `raVinculado` (RA). Sin estos, NO se puede generar el PIQ.

## Ejemplo de input mínimo

> "Generá el PIQ para DRP-GAMP Categorizador™. Tengo IRA-DRP-SIS-001 con 16 componentes, URS-DRP-SIS-001 con 55 URS, RA-DRP-SIS-001 con 24 riesgos, HLRA categoriza GAMP 3 con IRO 32. Process Owner Federico Bongiovanni. Sistema cloud SaaS Python/Django en AWS, URL https://categorizador.drpassurance.com/."

El skill genera el JSON PIQ con: ~15 TCs (1 por componente del IRA), agrupados por categoría funcional (App Web, Seguridad TLS, Panel Admin, Servicios Auxiliares, Infraestructura Cloud, Documentación), profundidad heredada del IRA-Score, criterios consolidados (no scripts), justificación CSA al final.
