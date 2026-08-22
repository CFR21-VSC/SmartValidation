---
name: iiq-generator
description: Genera el JSON de un documento IIQ (Installation Qualification Report / Informe de Calificación de Instalación) para la Validation Suite de DRP. Reporta los resultados de ejecución de los TCs definidos en el PIQ. Usar cuando el usuario tiene PIQ aprobado y los TCs ya fueron ejecutados (con evidencias capturadas vía Gestor de Evidencias). El JSON resultante es input directo del renderer IIQ — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# IIQ Generator — Validation Suite

Generador del documento **IIQ (Installation Qualification Report / Informe de Calificación de Instalación)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) y [`piq-generator.md`](./piq-generator.md) (el IIQ comparte el schema del Test Case con el PIQ).

## Cuándo usar este skill

- El usuario ya tiene **PIQ aprobado y ejecutado** (los TCs fueron probados sobre el sistema instalado).
- Tiene los **resultados de ejecución** y opcionalmente referencias a evidencias capturadas en el Gestor de Evidencias.
- En el IIQ SÍ van: resultados de cada TC (PASS/FAIL/OBS/NA), ejecutor, fecha, firma, evidencias del gestor, hallazgos.
- Inputs típicos:
  - PIQ del paquete actual (la base — los TCs se copian del PIQ y se completan).
  - Resultados de ejecución (PASS/FAIL por TC + observaciones).
  - Referencias a evidencias del Gestor (con `testCaseRef = tcId` matching).
  - Hallazgos identificados (si los hay).

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Diferencia clave PIQ vs IIQ

| | PIQ | IIQ |
|---|---|---|
| Schema del TC | Mismo | Mismo |
| Campos de ejecución (`estado`, `ejecutor`, etc.) | NULL / NO incluir | Poblados |
| `evidenciasGestor` | NO incluir | Array con refs |
| `hallazgos` por TC | NO incluir | Array (vacío si no hay) |
| Sección "Resumen de Ejecución" | NO existe | Sí (auto-calculada) |
| Sección "Hallazgos Consolidados" | NO existe | Sí |
| Sección "Conclusión y Decisión" | NO existe | Sí |

## Schema del Test Case (con campos de ejecución)

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
  "objetivo": "...",
  "criterios": ["...", "...", "..."],
  "evidenciaEsperada": "...",

  // === Campos NUEVOS en IIQ (poblados, no null) ===
  "estado": "PASS",                    // PASS | FAIL | OBS | NA
  "resultadoObservado": "URL responde HTTPS 200 OK. Versión v1.0 visible. Sin advertencias.",
  "ejecutor": "Federico Bongiovanni",
  "fechaEjecucion": "02/03/2026",
  "firma": "FB",
  "evidenciasGestor": [
    {
      "descripcion": "Screenshot pantalla principal con URL y versión",
      "timestamp": "02/03/2026 09:15",
      "usuarioPrueba": "—",     // del Gestor — opcional
      "rolPrueba": "—"           // del Gestor — opcional
    }
  ],
  "hallazgos": []                       // array vacío si no hay
}
```

### Estado del TC

- **PASS** — todos los criterios verificados, sin observaciones.
- **FAIL** — al menos un criterio no se cumple. Requiere hallazgo + CAPA.
- **OBS** — pasa con observaciones. Puede haber hallazgo menor que no bloquea.
- **NA** — no aplica (ej. funcionalidad no instalada en versión actual).

### Hallazgos por TC

```json
{
  "id": "NC-001",
  "severidad": "Mayor | Menor | Crítico",
  "descripcion": "Descripción del desvío",
  "accion": "CAPA propuesta o requerida"
}
```

Solo incluir si el TC tiene hallazgos. Si no, dejar `hallazgos: []`.

## Estructura del JSON IIQ

Mismo header que PIQ + secciones extras. Estructura completa del JSON raíz:

```json
{
  "schemaVersion": "1.0",
  "type": "IIQ",
  "package": { /* mismo objeto package del paquete */ },
  "document": {
    "code": "IIQ-<CODIGO>",
    "titleEs": "INFORME DE CALIFICACIÓN DE INSTALACIÓN",
    "titleEn": "INSTALLATION QUALIFICATION REPORT (IIQ)",
    "headerTitle": "Informe de Calificación de Instalación (IIQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría GAMP del paquete>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "Protocolo ejecutado": "PIQ-<CODE> v<X>",
      "Fecha de ejecución": "<DD/MM/AAAA>",
      "Ejecutor": "<nombre>",
      "Total TCs ejecutados": "<N>/<N> (100%)",
      "Hallazgos / Desvíos": "<N> — Sin hallazgos | N Mayor | N Menor"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del IIQ. Ejecución de <N>/<N> TCs del PIQ-<CODE>. <X> PASS, <Y> CON OBS, <Z> NO PASA. <hallazgos>." }
  ],
  "matrizAprobaciones": [
    { "rol": "Elaboró", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Revisó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Aprobó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": [{ "tipo": "PIQ", "code": "PIQ-<CODE>", "version": "v1.0", "estado": "aprobado" }],
    "alimentaA": ["RIQ"]
  },
  "secciones": [ /* ver secciones obligatorias abajo */ ]
}
```

Secciones obligatorias del IIQ (en este orden):

1. **PROPÓSITO Y OBJETIVO** (`tipo: "texto"`)
   - Documenta resultados de ejecución del PIQ
   - Mencionar fecha de ejecución y resultado global

2. **DATOS DE EJECUCIÓN** (`tipo: "tabla-info"`)
   - Protocolo ejecutado (PIQ-XXX v0.X)
   - Fecha de ejecución
   - Ejecutor
   - Ambiente
   - Total TCs ejecutados (X de Y)
   - Hallazgos / Desvíos (cantidad)

3. **MATRIZ DE TEST CASES — RESULTADOS** (`tipo: "matriz-tc"`)
   - Misma matriz que el PIQ pero con `estado` poblado en cada TC
   - El renderer pinta PASS verde, FAIL rojo, OBS naranja, NA gris

4. **DETALLE DE EJECUCIÓN POR TEST CASE** (`tipo: "tabla-test-case"`)
   - `agruparPorGrupo: true`
   - Cada TC con TODOS los campos de ejecución poblados
   - El renderer muestra: estado coloreado, resultado observado, ejecutor/fecha/firma, evidencias del gestor, hallazgos

5. **RESUMEN DE EJECUCIÓN** (`tipo: "resumen-ejecucion-iq"`)
   - El renderer auto-calcula desde los TCs (PASS/FAIL/OBS/NA por grupo)
   - Decisión global (IQ APROBADA / NO APROBADA)
   - **Importante**: el array `tcs` debe tener el mismo formato (al menos `grupo` y `estado` por TC) para que el resumen calcule bien

6. **HALLAZGOS Y DESVÍOS** (`tipo: "hallazgos-consolidados"`)
   - El renderer extrae los `hallazgos` de cada TC y los muestra en una tabla consolidada
   - Si todos los TCs tienen `hallazgos: []`, muestra mensaje "Sin hallazgos"
   - **Pasar el mismo array `tcs`** que tiene los hallazgos embebidos

7. **CONCLUSIÓN Y DECISIÓN FORMAL** (`tipo: "caja-conclusion"`)
   - 3-5 párrafos
   - Declarar resultado global
   - **DECISIÓN explícita**: IQ APROBADA / NO APROBADA / APROBADA CON OBSERVACIONES
   - Si APROBADA: "el sistema está apto para iniciar la OQ"
   - Si NO APROBADA: "se requiere CAPA antes de proceder"

8. **REFERENCIAS** + **FIRMAS DE EJECUCIÓN Y APROBACIÓN**

## Vinculación con el Gestor de Evidencias

Cada TC puede tener `evidenciasGestor` con refs a las capturas hechas en el Gestor. La vinculación es vía `testCaseRef = tcId`:

```json
"evidenciasGestor": [
  {
    "descripcion": "Screenshot login admin exitoso",
    "timestamp": "02/03/2026 10:05",
    "usuarioPrueba": "admin_drp",   // del Gestor (opcional)
    "rolPrueba": "Administrador"     // del Gestor (opcional)
  }
]
```

**Hoy (manual)**: el skill recibe info del usuario sobre las evidencias capturadas y las pone en este array.

**Futuro (Fase 2 con workspace)**: la UI carga el JSON del IIQ + el proyecto del Gestor, busca capturas con `testCaseRef = tcId` matching, y rellena este array automáticamente con las imágenes incrustadas.

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **Cada TC del IIQ debe tener `estado` poblado** (no null). Si no se ejecutó, omitir el TC del documento o usar `estado: "NA"` con justificación.
3. **`ejecutor` y `fechaEjecucion` obligatorios** en TCs ejecutados.
4. **`type: "IIQ"`** siempre en mayúsculas.
5. **El array `tcs` se repite en 4 secciones** (matriz-tc, tabla-test-case, resumen-ejecucion-iq, hallazgos-consolidados). Es intencional — cada renderer extrae lo que necesita. NO sacarlo de ninguna.
6. **`hallazgos` con id formato `NC-NNN`** (3 dígitos).
7. **`severidad` válida**: Mayor / Menor / Crítico. Sin variantes.
8. **`firmas` poblar SIEMPRE** en el IIQ (es un documento ejecutado). El PIQ puede tener firmas o placeholders, el IIQ no.
9. **Decisión formal explícita** en la sección de conclusión — un auditor busca esa frase.
10. **NO modificar criterios ni objetivo del TC** vs el PIQ — esos son inmutables. El IIQ solo agrega resultados.

## Ejemplo de input mínimo

> "Generá el IIQ para DRP-GAMP Categorizador™. El PIQ-DRP-SIS-001 v0.1 se ejecutó el 02/03/2026 por Federico Bongiovanni. Los 15 TCs pasaron PASS. Sin hallazgos. Acá va la lista de evidencias capturadas en el Gestor de Evidencias por TC: [...]"

El skill genera el JSON IIQ con: 15 TCs con estado=PASS, resultadoObservado descriptivo, ejecutor, fecha, firma, evidenciasGestor por TC, hallazgos: []. Resumen estadístico que muestra 15/15 PASS. Sección de hallazgos con mensaje "Sin hallazgos". Conclusión con DECISIÓN: IQ APROBADA, sistema apto para OQ.
