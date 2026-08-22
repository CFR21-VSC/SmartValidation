---
name: ioq-generator
description: Genera el JSON de un documento IOQ (Operational Qualification Report / Informe de Calificación Operacional) para la Validation Suite de DRP. Reporta los resultados de ejecución de los TCs definidos en el POQ. Usar cuando el usuario tiene POQ aprobado y los TCs ya fueron ejecutados (con evidencias capturadas vía Gestor de Evidencias). El JSON resultante es input directo del renderer IOQ — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# IOQ Generator — Validation Suite

Generador del documento **IOQ (Operational Qualification Report / Informe de Calificación Operacional)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md), [`poq-generator.md`](./poq-generator.md) (mismo schema del TC, IOQ agrega ejecución), y [`iiq-generator.md`](./iiq-generator.md) (mismo patrón ejecución-de-protocolo).

## Cuándo usar este skill

- El usuario ya tiene **POQ aprobado y ejecutado** (los TCs fueron probados sobre el sistema operacional).
- Tiene los **resultados de ejecución** y referencias a evidencias capturadas en el Gestor de Evidencias.
- En el IOQ SÍ van: resultados de cada TC (PASS/FAIL/OBS/NA), `resultadoReal` por paso (opcional), `criterioObservado`, ejecutor, fecha, firma, evidencias del gestor, hallazgos.
- Inputs típicos:
  - POQ del paquete actual (la base — los TCs se copian del POQ y se completan).
  - Resultados de ejecución (PASS/FAIL por TC + observaciones).
  - Referencias a evidencias del Gestor (con `testCaseRef = tcId` y opcionalmente `criterioRef = "Paso N"` o `"Criterio aceptación"`).
  - Hallazgos identificados (si los hay).

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Diferencia clave POQ vs IOQ

| | POQ | IOQ |
|---|---|---|
| Schema del TC | Mismo (`schemaModo: "procedimiento"`) | Mismo |
| `procedimiento[].resultadoReal` | NO incluir | Poblado (opcional, libre) |
| `criterioObservado` | NO incluir | Poblado (qué se observó) |
| Campos de ejecución (`estado`, `ejecutor`, etc.) | NO incluir | Poblados |
| `evidenciasGestor` | NO incluir | Array con refs |
| `hallazgos` por TC | NO incluir | Array (vacío si no hay) |
| Sección "Resumen de Ejecución" | NO existe | Sí (auto-calculada) |
| Sección "Hallazgos Consolidados" | NO existe | Sí |
| Sección "Conclusión y Decisión" | NO existe | Sí |

## Schema del Test Case OQ con campos de ejecución

```json
{
  "tcId": "TC-OQ-001",
  "titulo": "Login con credenciales válidas e inválidas",
  "tipoTC": "POSITIVO",
  "grupo": "Autenticación y Seguridad de Acceso",
  "grupoFuncional": "Autenticación y Seguridad de Acceso",
  "raScore": 27,
  "nivel": "CRÍTICO",
  "ursVinculados": ["URS-001", "URS-002"],
  "raVinculado": "RAI-001",
  "objetivo": "...",
  "precondiciones": ["..."],
  "procedimiento": [
    { "paso": 1, "instruccion": "...", "resultadoEsperado": "...", "resultadoReal": "Pantalla cargó en 1.2s. Login OK." },
    { "paso": 2, "instruccion": "...", "resultadoEsperado": "...", "resultadoReal": "Dashboard visible con sesión activa." },
    { "paso": 3, "instruccion": "...", "resultadoEsperado": "...", "resultadoReal": "" }
  ],
  "criterioAceptacion": "Login exitoso con credenciales válidas redirige al dashboard. Credenciales inválidas muestran mensaje genérico sin revelar datos sensibles.",

  "criterioObservado": "Login exitoso. Dashboard visible. Mensaje de error en credenciales inválidas: 'Usuario o contraseña incorrectos' (sin revelar cuál falló). Cumple criterio.",
  "estado": "PASS",
  "ejecutor": "Federico Bongiovanni",
  "fechaEjecucion": "03/04/2026",
  "firma": "FB",
  "evidenciasGestor": [
    {
      "descripcion": "Screenshot dashboard post-login",
      "criterioRef": "Paso 3",
      "timestamp": "03/04/2026 09:15",
      "usuarioPrueba": "contacto@test.com",
      "rolPrueba": "Usuario Final"
    },
    {
      "descripcion": "Screenshot error credenciales inválidas",
      "criterioRef": "Paso 4",
      "timestamp": "03/04/2026 09:18",
      "usuarioPrueba": "—",
      "rolPrueba": "—"
    }
  ],
  "hallazgos": [],
  "notas": ""
}
```

### Campos de ejecución — reglas

- `procedimiento[].resultadoReal`: **opcional** por paso. String libre. Vacío `""` si el ejecutor no llenó. El renderer muestra columna sólo si hay al menos un valor.
- `criterioObservado`: **obligatorio** si `estado` es PASS, FAIL o OBS (es el "qué se observó frente al criterio"). Vacío `""` si `estado: "NA"`.
- `estado`: PASS / FAIL / OBS / NA (mismas semánticas que IIQ).
- `ejecutor` y `fechaEjecucion`: obligatorios para todo TC con `estado` distinto de NA.
- `firma`: iniciales del ejecutor (ej. "FB", "LS").
- `evidenciasGestor`: array de objetos con `criterioRef` que apunta a `"Paso N"` o `"Criterio aceptación"`. Si la captura cubre el TC en general (sin paso específico), usar `"Criterio aceptación"`.
- `hallazgos`: array vacío si no hay. Cada hallazgo: `{id: "NC-NNN", severidad, descripcion, accion}`.

### Estado del TC

- **PASS** — criterio de aceptación cumplido. Evidencias capturadas.
- **FAIL** — criterio NO cumplido. Requiere hallazgo + CAPA. **Bloquea aprobación del OQ**.
- **OBS** — pasa con observaciones (hallazgo menor que no bloquea — ej. UX no estandarizado pero funcional).
- **NA** — no aplica (ej. funcionalidad opcional no instalada en versión demo).

### TCs negativos en ejecución

- Mantener `tipoTC: "NEGATIVO"` en el TC (heredado del POQ).
- Es PASS si el sistema rechaza correctamente.
- En `criterioObservado` documentar **explícitamente que el rechazo se observó**: "Sistema bloqueó al 5to intento. Mensaje 'Cuenta bloqueada por seguridad' visible. Cumple criterio negativo."
- Contabilizarlos separadamente en `extras.TCs negativos ejecutados`.

## Estructura del JSON IOQ

```json
{
  "schemaVersion": "1.0",
  "type": "IOQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "IOQ-<CODIGO>",
    "titleEs": "INFORME DE CALIFICACIÓN OPERACIONAL",
    "titleEn": "OPERATIONAL QUALIFICATION REPORT (IOQ)",
    "headerTitle": "Informe de Calificación Operacional (IOQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría GAMP del paquete>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "Protocolo ejecutado": "POQ-<CODE> v<X>",
      "Fecha de ejecución": "<DD/MM/AAAA>",
      "Ejecutor": "<nombre>",
      "Total TCs ejecutados": "<X>/<Y> TCs",
      "TCs negativos ejecutados": "<N> TCs (todos PASS)",
      "Resultado global": "<X> PASS / <Y> FAIL / <Z> OBS / <W> NA",
      "Decisión": "OQ APROBADA — sistema apto para PQ"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del IOQ. Ejecución de <N>/<N> TCs del POQ-<CODE>. <X> PASS, <Y> CON OBS, <Z> NO PASA. <hallazgos>." }
  ],
  "matrizAprobaciones": [
    { "rol": "Elaboró", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Revisó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Aprobó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": ["POQ"],
    "alimentaA": ["ROQ", "PPQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del IOQ (en este orden)

1. **PROPÓSITO Y OBJETIVO** (`tipo: "texto"`) — documenta resultados de ejecución del POQ. Mencionar fecha de ejecución y resultado global.

2. **DATOS DE EJECUCIÓN** (`tipo: "tabla-info"`)
   - Protocolo ejecutado (POQ-XXX v0.X)
   - Fecha de ejecución
   - Ejecutor
   - Ambiente
   - Total TCs ejecutados (X de Y)
   - **TCs negativos ejecutados** (importante diferenciador de IIQ)
   - Hallazgos / Desvíos (cantidad)

3. **MATRIZ DE TEST CASES OQ — RESULTADOS** (`tipo: "matriz-tc"`)
   - `columnasVisibles: ["tcId", "titulo", "grupo", "tipoTC", "raScore", "nivel", "ursVinculados", "estado", "ejecutor", "fechaEjecucion", "evidenciasCount"]`
   - 1 fila por TC con `estado` poblado.

4. **DETALLE DE EJECUCIÓN POR TEST CASE** (`tipo: "tabla-test-case"`)
   - `agruparPorGrupo: true`.
   - `schemaModo: "procedimiento"` ← obligatorio.
   - Cada TC con TODOS los campos de ejecución poblados.

5. **RESUMEN DE EJECUCIÓN** (`tipo: "resumen-ejecucion-oq"`)
   - El renderer auto-calcula desde los TCs (PASS/FAIL/OBS/NA por grupo + por nivel).
   - **TCs negativos contabilizados separadamente** (1 sección/columna distinta).
   - Decisión global (OQ APROBADA / NO APROBADA / APROBADA CON OBSERVACIONES).
   - Pasar el array `tcs` con `grupo`, `nivel`, `tipoTC`, `estado` por TC.

6. **HALLAZGOS Y DESVÍOS** (`tipo: "hallazgos-consolidados"`)
   - Renderer extrae los `hallazgos` de cada TC.
   - Cada hallazgo trazado a NC/CAPA correspondiente.

7. **CONCLUSIÓN Y DECISIÓN FORMAL** (`tipo: "caja-conclusion"`)
   - 3-5 párrafos.
   - Declarar resultado global con números (X/Y PASS, etc.).
   - Mencionar TCs negativos: "Los N TCs negativos se ejecutaron correctamente — el sistema rechazó adecuadamente las acciones inválidas."
   - **DECISIÓN explícita**: OQ APROBADA / NO APROBADA / APROBADA CON OBSERVACIONES.
   - Si APROBADA: "el sistema está apto para iniciar la PQ" (o uso productivo según corresponda al alcance del paquete).
   - Si NO APROBADA: "se requiere CAPA antes de proceder a PQ" + lista de TCs FAIL.

8. **REFERENCIAS** + **FIRMAS DE EJECUCIÓN Y APROBACIÓN**.

## Vinculación con el Gestor de Evidencias

Cada TC puede tener `evidenciasGestor` con refs a las capturas hechas en el Gestor:

```json
"evidenciasGestor": [
  {
    "descripcion": "Screenshot login admin exitoso",
    "criterioRef": "Paso 2",
    "timestamp": "03/04/2026 10:05",
    "usuarioPrueba": "admin_drp",
    "rolPrueba": "Administrador"
  }
]
```

**`criterioRef` apunta a una de**: `"Paso 0"`, `"Paso 1"`, ..., `"Paso N"` (donde N es el número de paso del procedimiento), o `"Criterio aceptación"` (para una captura que cubre el TC sin paso específico).

**Hoy (manual)**: el skill recibe info del usuario sobre las evidencias capturadas y las pone en este array.

**Futuro (Fase 2)**: la UI carga el JSON del IOQ + el proyecto del Gestor, busca capturas con `testCaseRef = tcId` matching, y rellena este array automáticamente con las imágenes incrustadas.

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **Cada TC del IOQ debe tener `estado` poblado** (no null). Si no se ejecutó, omitir el TC del documento o usar `estado: "NA"` con justificación en `criterioObservado`.
3. **`ejecutor` y `fechaEjecucion` obligatorios** en TCs ejecutados (PASS / FAIL / OBS).
4. **`criterioObservado` obligatorio** si `estado ≠ "NA"`. Es el "qué se vio" — sin esto, el auditor no puede validar.
5. **`type: "IOQ"`** siempre en mayúsculas.
6. **`schemaModo: "procedimiento"`** en `tabla-test-case`.
7. **El array `tcs` se repite en 4 secciones** (matriz-tc, tabla-test-case, resumen-ejecucion-oq, hallazgos-consolidados). Es intencional. NO sacarlo.
8. **`hallazgos` con id formato `NC-NNN`** (3 dígitos).
9. **`severidad` válida**: Mayor / Menor / Crítico. Sin variantes.
10. **`firmas` poblar SIEMPRE** en el IOQ (es un documento ejecutado).
11. **Decisión formal explícita** en la sección de conclusión.
12. **TCs negativos contabilizados aparte** en extras y en datos de ejecución y en resumen — el auditor lo lee como métrica de cobertura de seguridad.
13. **NO modificar `objetivo`, `precondiciones`, `procedimiento.instruccion`, `procedimiento.resultadoEsperado`, `criterioAceptacion`** vs el POQ — esos son inmutables. El IOQ solo agrega `resultadoReal`, `criterioObservado` y campos de ejecución.

## Ejemplo de input mínimo

> "Generá el IOQ para DRP-GAMP Categorizador™. El POQ-DRP-SIS-001 v0.1 se ejecutó del 03/04/2026 al 12/04/2026 por Federico Bongiovanni. Los 47 TCs pasaron PASS, incluidos los 2 TCs negativos (TC-OQ-020, TC-OQ-023). Sin hallazgos críticos. 1 hallazgo menor (NC-001) en TC-OQ-014: política de contraseñas no fuerza caracteres especiales — observación documentada, no bloquea aprobación. Acá va la lista de evidencias capturadas en el Gestor por TC: [...]"

El skill genera el JSON IOQ con: 47 TCs con `estado` poblado, `criterioObservado` descriptivo, ejecutor/fecha/firma, `evidenciasGestor` por TC con `criterioRef` apuntando a Paso N o Criterio aceptación, `hallazgos` populados sólo en TC-OQ-014. Resumen 47/47 ejecutados (45 PASS, 1 OBS, 1 PASS con NC menor). Los 2 TCs negativos contabilizados aparte. Conclusión con DECISIÓN: OQ APROBADA CON OBSERVACIONES, sistema apto para PQ.
