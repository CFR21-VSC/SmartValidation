---
name: ipq-generator
description: Genera el JSON de un documento IPQ (Performance Qualification Report / Informe de Calificación de Performance) para la Validation Suite de DRP. Reporta los resultados de ejecución de los TCs definidos en el PPQ. Usar cuando el usuario tiene PPQ aprobado y los escenarios end-to-end ya fueron ejecutados (con evidencias capturadas vía Gestor de Evidencias). El JSON resultante es input directo del renderer IPQ — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# IPQ Generator — Validation Suite

Generador del documento **IPQ (Performance Qualification Report / Informe de Calificación de Performance)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md), [`ppq-generator.md`](./ppq-generator.md) (mismo schema del TC, IPQ agrega ejecución), y [`ioq-generator.md`](./ioq-generator.md) (mismo patrón ejecución-de-protocolo).

## Cuándo usar este skill

- El usuario ya tiene **PPQ aprobado y ejecutado** (los escenarios end-to-end fueron probados con usuarios reales o representativos).
- Tiene los **resultados de ejecución** y referencias a evidencias capturadas en el Gestor de Evidencias.
- En el IPQ SÍ van: resultados de cada TC (PASS/FAIL/OBS/NA), `resultadoReal` por paso (opcional), `criterioObservado`, ejecutor, fecha, firma, evidencias del gestor, hallazgos.
- Inputs típicos:
  - PPQ del paquete actual (la base — los TCs se copian del PPQ y se completan).
  - Resultados de ejecución (PASS/FAIL por TC + observaciones).
  - Métricas de performance observadas (tiempos reales, concurrencia, errores).
  - Referencias a evidencias del Gestor.
  - Hallazgos identificados.

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Diferencia clave PPQ vs IPQ (idéntica al patrón POQ vs IOQ)

| | PPQ | IPQ |
|---|---|---|
| Schema del TC | Mismo (`schemaModo: "procedimiento"`) | Mismo |
| `procedimiento[].resultadoReal` | NO incluir | Poblado (opcional, libre) |
| `criterioObservado` | NO incluir | Poblado (qué se observó vs criterio + métricas reales) |
| Campos de ejecución | NO incluir | Poblados |
| `evidenciasGestor` | NO incluir | Array con refs |
| `hallazgos` por TC | NO incluir | Array (vacío si no hay) |
| Sección "Resumen de Ejecución" | NO existe | Sí (auto-calculada) |
| Sección "Hallazgos Consolidados" | NO existe | Sí |
| Sección "Conclusión y Decisión" | NO existe | Sí (apto/no apto para liberación productiva) |

## Schema del Test Case PQ con campos de ejecución

```json
{
  "tcId": "TC-PQ-001",
  "titulo": "Usuario nuevo registra un sistema GAMP 3 y descarga reporte verificable",
  "tipoTC": "POSITIVO",
  "grupo": "Categorización end-to-end",
  "raScore": 27,
  "nivel": "CRÍTICO",
  "ursVinculados": ["URS-001", "URS-017", "URS-035", "URS-041"],
  "raVinculado": "RAI-001",
  "objetivo": "...",
  "precondiciones": ["..."],
  "procedimiento": [
    { "paso": 1, "instruccion": "...", "resultadoEsperado": "...", "resultadoReal": "Email recibido en 47s (dentro del límite de 2min)." },
    { "paso": 2, "instruccion": "...", "resultadoEsperado": "...", "resultadoReal": "Cambio pwd completado. Dashboard cargó en 1.2s." }
  ],
  "criterioAceptacion": "Usuario nuevo completa el flujo end-to-end...",

  "criterioObservado": "Flujo completo exitoso. Tiempos observados: email 47s, PDF 18s, verificación QR <2s. Usuario no requirió asistencia.",
  "estado": "PASS",
  "ejecutor": "María González (Auditor QA externo)",
  "fechaEjecucion": "10/05/2026",
  "firma": "MG",
  "evidenciasGestor": [
    {
      "descripcion": "Email de bienvenida recibido",
      "criterioRef": "Paso 1",
      "timestamp": "10/05/2026 09:15",
      "usuarioPrueba": "maria.gonzalez@ext.com",
      "rolPrueba": "Usuario nuevo (representativo)"
    },
    {
      "descripcion": "Reporte PDF descargado + portal QR mostrando VÁLIDO",
      "criterioRef": "Paso 6",
      "timestamp": "10/05/2026 09:22"
    }
  ],
  "hallazgos": []
}
```

### Métricas de performance en `criterioObservado`

A diferencia del IOQ, el IPQ debe **explicitar las métricas observadas** vs los límites del criterio:
- "Tiempos: email 47s ≤2min ✓, PDF 18s ≤30s ✓"
- "Concurrencia: 15 usuarios simultáneos sin degradación"
- "Carga: 50 categorizaciones consecutivas, sin errores"

### TCs negativos en PQ (escenarios adversos)

- Mantener `tipoTC: "NEGATIVO"` desde el PPQ.
- Es PASS si el sistema **maneja correctamente el escenario adverso** (lo bloquea, muestra error claro, no compromete integridad).
- En `criterioObservado` documentar **qué se observó del manejo del escenario**: "Sistema rechazó el PDF modificado con mensaje claro 'Documento alterado'. Portal QR mostró INVÁLIDO. Sin filtración de datos."

## Estructura del JSON IPQ

```json
{
  "schemaVersion": "1.0",
  "type": "IPQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "IPQ-<CODIGO>",
    "titleEs": "INFORME DE CALIFICACIÓN DE PERFORMANCE",
    "titleEn": "PERFORMANCE QUALIFICATION REPORT (IPQ)",
    "headerTitle": "Informe de Calificación de Performance (IPQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría GAMP del paquete>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "Protocolo ejecutado": "PPQ-<CODE> v<X>",
      "Fecha de ejecución": "<DD/MM/AAAA>",
      "Ejecutor": "<nombre>",
      "Total TCs ejecutados": "<X>/<Y> TCs",
      "TCs negativos ejecutados": "<N> TCs (todos PASS)",
      "Resultado global": "<X> PASS / <Y> FAIL / <Z> OBS / <W> NA",
      "Decisión": "PQ APROBADA — sistema apto para liberación productiva"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del IPQ. Ejecución de <N>/<N> TCs del PPQ-<CODE>. <X> PASS, <Y> CON OBS, <Z> NO PASA. <hallazgos>." }
  ],
  "matrizAprobaciones": [
    { "rol": "Elaboró", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Revisó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Aprobó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": ["PPQ"],
    "alimentaA": ["RPQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del IPQ (en este orden)

1. **PROPÓSITO Y OBJETIVO** (`tipo: "texto"`) — documenta resultados de ejecución del PPQ. Mencionar fecha de ejecución, ambiente real, resultado global.
2. **DATOS DE EJECUCIÓN** (`tipo: "tabla-info"`) — Protocolo ejecutado (PPQ-XXX), Fecha, Ejecutor (idealmente externo/independiente), Ambiente, TCs ejecutados, TCs negativos, Hallazgos.
3. **MATRIZ DE TEST CASES PQ — RESULTADOS** (`tipo: "matriz-tc"`) — `columnasVisibles: ["tcId", "titulo", "grupo", "tipoTC", "raScore", "nivel", "ursVinculados", "estado", "ejecutor", "fechaEjecucion", "evidenciasCount"]`.
4. **DETALLE DE EJECUCIÓN POR TEST CASE** (`tipo: "tabla-test-case"`) — `agruparPorGrupo: true`, `schemaModo: "procedimiento"`.
5. **RESUMEN DE EJECUCIÓN** (`tipo: "resumen-ejecucion-pq"`) — auto-calculado, decisión global.
6. **HALLAZGOS Y DESVÍOS** (`tipo: "hallazgos-consolidados"`).
7. **CONCLUSIÓN Y DECISIÓN FORMAL** (`tipo: "caja-conclusion"`):
   - DECISIÓN explícita: PQ APROBADA / NO APROBADA / APROBADA CON OBSERVACIONES.
   - Si APROBADA: "el sistema es apto para liberación productiva GxP".
   - Si NO APROBADA: "se requiere CAPA antes de liberar".
8. **REFERENCIAS** + **FIRMAS DE EJECUCIÓN Y APROBACIÓN**.

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **Cada TC del IPQ debe tener `estado` poblado** (no null). Si no ejecutado, omitir el TC o usar `estado: "NA"` con justificación.
3. **`ejecutor` y `fechaEjecucion` obligatorios** en TCs ejecutados.
4. **`criterioObservado` obligatorio** si `estado ≠ "NA"`. Debe incluir métricas de performance observadas vs los límites del criterio.
5. **`type: "IPQ"`** siempre en mayúsculas.
6. **`schemaModo: "procedimiento"`** en `tabla-test-case`.
7. **`hallazgos` con id formato `NC-NNN`** (3 dígitos).
8. **`firmas` poblar SIEMPRE** en el IPQ (es un documento ejecutado).
9. **Decisión formal explícita** mencionando liberación productiva.
10. **TCs negativos contabilizados aparte** en extras y conclusión.

## Ejemplo de input mínimo

> "Generá el IPQ para DRP-GAMP Categorizador™. El PPQ-DRP-SIS-001 v0.1 se ejecutó del 10/05/2026 al 12/05/2026. Ejecutor externo: María González (Auditor QA). Los 8 TCs pasaron PASS incluido el TC negativo TC-PQ-006 (intento de fraude con PDF modificado). Métricas observadas: email <1min, PDF <20s, QR <2s en todos los TCs. Sin hallazgos. Acá va la lista de evidencias por TC: [...]"

El skill genera el JSON IPQ con 8 TCs con `estado` poblado, `criterioObservado` con métricas reales vs límites, ejecutor/fecha/firma, evidencias del gestor, hallazgos:[]. Conclusión: PQ APROBADA — sistema apto para liberación productiva GxP.
