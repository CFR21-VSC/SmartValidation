---
name: poq-generator
description: Genera el JSON de un documento POQ (Operational Qualification Protocol / Protocolo de Calificación Operacional) para la Validation Suite de DRP. Define los Test Cases ANTES de ejecutar la OQ, con enfoque CSA pero respetando que las pruebas operacionales son comportamentales y requieren procedimiento numerado con resultado esperado por paso (a diferencia del IQ que usa criterios consolidados). Usar cuando el usuario tiene PIQ aprobado (todos los TCs PASS) y los riesgos funcionales identificados en RAI. El JSON resultante es input directo del renderer POQ — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# POQ Generator — Validation Suite

Generador del documento **POQ (Operational Qualification Protocol / Protocolo de Calificación Operacional)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) y [`piq-generator.md`](./piq-generator.md) (comparten estructura general — el POQ se diferencia en el schema del TC y en que verifica comportamiento, no instalación).

## Cuándo usar este skill

- El usuario ya tiene **PIQ aprobado y ejecutado** (100% TCs PASS) — pre-requisito obligatorio.
- Tiene **RAI aprobado** (los TCs OQ se derivan de los riesgos funcionales del RAI).
- Necesita el protocolo que define los TCs operacionales **ANTES** de ejecutarlos.
- En el POQ NO van resultados, NO van firmas de ejecución. Solo placeholders. Eso es del IOQ.
- Inputs típicos:
  - PIQ aprobado del paquete actual (estado de aprobación).
  - URS (requerimientos funcionales y no funcionales).
  - RAI (riesgos funcionales con RPN — los TCs cubren cada riesgo de RPN ≥ 12 típicamente).
  - HLRA (categoría GAMP, IRO).
  - MCN (matriz de cumplimiento normativo — para identificar GAPs que requieren TC específico).

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Filosofía: por qué OQ usa procedimiento (no criterios) — y sigue siendo CSA

CSA (FDA 2022) dice "rigor proporcional al riesgo, sin sobre-scripting". Eso aplica tanto al IQ como al OQ, pero la **forma** cambia:

| | IQ (instalación) | OQ (operación) |
|---|---|---|
| Naturaleza | Verificación de **estado** (existe / responde / configurado) | Verificación de **comportamiento** (acción → respuesta esperada) |
| Forma del TC | Criterios consolidados (lista de chequeo) | Procedimiento numerado (acción → resultado esperado por paso) |
| Por qué | "Está instalado" se verifica con un screenshot y 3 chequeos | "El login bloquea al 5to intento" requiere ejecutar 5 intentos y observar respuesta |
| Riesgo CSA viejo | Sobre-scriptear instalación (cierre de cada tornillo) | Sobre-scriptear comportamiento (cada movimiento de mouse) |

**CSA aplicado al OQ correctamente**:
- Procedimiento sí, pero pasos con **acciones operacionales significativas** — NO "hacer click en X botón", SÍ "iniciar sesión con credenciales válidas".
- 4-8 pasos por TC es lo razonable. >12 pasos = sobre-scripting (revisar).
- Cada paso tiene `resultadoEsperado` claro pero no exhaustivo.
- **Un único `criterioAceptacion` consolidado** al final es lo que determina PASS/FAIL — los pasos son evidencia, no checklist atómico.

## Schema del Test Case OQ (CRÍTICO — distinto del IQ)

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
  "objetivo": "Verificar que el sistema autentica con credenciales válidas y rechaza credenciales inválidas.",
  "precondiciones": [
    "Usuario de prueba activo: contacto@test.com",
    "Credenciales válidas configuradas",
    "Credenciales inválidas preparadas"
  ],
  "procedimiento": [
    { "paso": 1, "instruccion": "Abrir navegador y navegar a la URL del sistema", "resultadoEsperado": "Pantalla de login visible" },
    { "paso": 2, "instruccion": "Ingresar usuario válido y contraseña válida. Click en 'Iniciar sesión'", "resultadoEsperado": "Login exitoso. Sistema redirige al dashboard" },
    { "paso": 3, "instruccion": "Capturar screenshot del dashboard post-login con sesión activa", "resultadoEsperado": "Screenshot con sesión documentada" },
    { "paso": 4, "instruccion": "Cerrar sesión. Volver a la pantalla de login. Ingresar credenciales inválidas. Click 'Iniciar sesión'", "resultadoEsperado": "Sistema rechaza el acceso. Mensaje genérico sin revelar datos sensibles" }
  ],
  "criterioAceptacion": "Login exitoso con credenciales válidas redirige al dashboard. Credenciales inválidas muestran mensaje de error genérico sin revelar datos sensibles.",
  "notas": ""
}
```

**Reglas estrictas del Test Case OQ:**

1. `tcId` formato exacto: `TC-OQ-NNN` (3 dígitos).
2. `tipoTC`: `"POSITIVO"` (verifica que el sistema HACE algo) o `"NEGATIVO"` (verifica que el sistema RECHAZA algo). El renderer muestra badge distintivo.
3. `grupo`: nombre del grupo funcional (ej. "Autenticación", "Roles y Permisos", "Cuestionario GAMP", "Reporte PDF"). Es el campo de agrupación en la matriz.
4. `grupoFuncional`: opcional — usar si el grupo administrativo difiere del grupo funcional. Si no, repetir el de `grupo`.
5. `raScore`: número (RPN heredado del RAI). Típicamente 6, 9, 12, 18, 27.
6. `nivel`: derivado del raScore — `"CRÍTICO"` (RPN ≥ 27), `"ALTO"` (18-26), `"MEDIO"` (9-17), `"BAJO"` (≤ 8).
7. `procedimiento`: array de objetos `{paso, instruccion, resultadoEsperado}`. Mínimo 3 pasos, máximo 12. **No micro-prescribir clicks** — cada paso debe ser una acción operacional significativa.
8. `criterioAceptacion`: string consolidado (1-3 oraciones) que determina PASS/FAIL del TC global.
9. **NO incluir** campos de ejecución (`resultadoReal` por paso, `criterioObservado`, `estado`, `ejecutor`, `fechaEjecucion`, `firma`, `evidenciasGestor`, `hallazgos`). Esos son del IOQ.
10. `notas`: opcional — usar para deviations conocidas, configuración demo vs prod, etc.

## TCs negativos (importantes en OQ)

- Identificar TCs que verifican que el sistema **rechaza** correctamente algo (login con credenciales inválidas, usuario sin permisos, parámetros fuera de rango, archivo inválido).
- Marcar como `tipoTC: "NEGATIVO"`.
- Es PASS si el sistema rechaza correctamente — no si el sistema lo permite.
- Mencionar en el `criterioAceptacion` que el rechazo es el resultado correcto.
- En el `objetivo` ser explícito: "Verificar que el sistema NO permite ..." o "Verificar que el sistema rechaza ...".
- **Auditor lo busca**: un OQ sin TCs negativos suele tener cobertura insuficiente de seguridad y validación de inputs.

## Estructura del JSON POQ

```json
{
  "schemaVersion": "1.0",
  "type": "POQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "POQ-<CODIGO>",
    "titleEs": "PROTOCOLO DE CALIFICACIÓN OPERACIONAL",
    "titleEn": "OPERATIONAL QUALIFICATION PROTOCOL (POQ)",
    "headerTitle": "Protocolo de Calificación Operacional (POQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría GAMP del paquete>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "URL Sistema": "<URL>",
      "Documento base (RA/RAI)": "RAI-<CODE> v<X> — <N> riesgos funcionales",
      "Total TCs OQ": "<N> TCs (X CRÍTICO / Y ALTO / Z MEDIO / W BAJO)",
      "TCs negativos": "<N> TCs (TC-OQ-XXX, TC-OQ-YYY)",
      "Pre-requisito": "PIQ-<CODE> aprobado (TODOS los TCs PASS)"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del POQ. Define <N> TCs para la calificación operacional del sistema." }
  ],
  "matrizAprobaciones": [
    { "rol": "Elaboró", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Revisó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Aprobó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Process Owner", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": ["URS", "RA", "RRM", "MTR", "PIQ"],
    "alimentaA": ["IOQ", "ROQ", "PPQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del POQ (en este orden)

1. **PROPÓSITO Y OBJETIVO** (`tipo: "texto"`)
   - Mencionar PIQ aprobado como pre-requisito (con código y versión).
   - Mencionar URS y RAI de origen.
   - Mencionar enfoque CSA aplicado al OQ (procedimiento operacional, no scripts micro).

2. **ALCANCE** (`tipo: "lista-incluido-excluido"`)
   - Incluido: total URS cubiertas, agrupación funcional, total TCs.
   - Excluido: instalación física (PIQ), pruebas de carga/stress (no aplica GAMP 3-4 típicamente), integraciones externas si no existen.

3. **DOCUMENTOS DE REFERENCIA** (`tipo: "tabla"`) — todos los del paquete + manuales de usuario + SOPs aplicables.

4. **CONDICIONES DE EJECUCIÓN** (`tipo: "tabla-info"`)
   - Ambiente (productivo o staging según política de la empresa).
   - Pre-requisitos (PIQ aprobado, cuentas de prueba creadas, herramientas).
   - Herramientas (incluir **"Gestor de Evidencias 3.0"**).
   - Cuentas de prueba (listar todas las cuentas requeridas con su rol).
   - Criterio global: 100% TCs PASS. TCs negativos: PASS si rechaza correctamente. Cualquier FAIL requiere NC + CAPA.

5. **RESUMEN DE TEST CASES OQ** (`tipo: "matriz-tc"`)
   - `columnasVisibles: ["tcId", "titulo", "grupo", "tipoTC", "raScore", "nivel", "ursVinculados"]`
   - 1 fila por TC.

6. **TEST CASES — OPERATIONAL QUALIFICATION** (`tipo: "tabla-test-case"`)
   - `agruparPorGrupo: true` para sub-headers por grupo funcional.
   - `schemaModo: "procedimiento"` ← **OBLIGATORIO** para que el renderer use tabla numerada.
   - Array `tcs` con todos los TCs.

7. **JUSTIFICACIÓN DE PROPORCIONALIDAD (CRITICAL THINKING)** (`tipo: "texto"`)
   - Distribución de TCs por nivel (CRÍTICO/ALTO/MEDIO/BAJO).
   - Cobertura URS↔TC (cada URS funcional debe estar cubierta por al menos 1 TC).
   - Justificación de TCs negativos incluidos.
   - Aceptación del enfoque CSA aplicado al OQ.

8. **REFERENCIAS** (`tipo: "tabla"`)
   - FDA Draft Guidance 2022 (CSA), GAMP 5 §8.3 (OQ), ICH Q9 R1, ANMAT, EU Annex 11, 21 CFR Part 11.

9. **FIRMAS DE EJECUCIÓN** (`tipo: "tabla-firmas-final"`)
   - 4 firmas estándar.
   - Completadas (es protocolo aprobado).

## Cantidad típica de TCs por sistema

| Categoría GAMP | TCs OQ típicos |
|---|---|
| GAMP 3 (COTS no configurado) | 25-50 TCs |
| GAMP 4 (COTS configurado) | 35-60 TCs |
| GAMP 5 (Custom) | 50-100 TCs |

Distribución típica:
- POSITIVOS: 80-90% del total.
- NEGATIVOS: 10-20% (cobertura mínima de seguridad/validación).
- Por nivel: CRÍTICO 30-50%, ALTO 30-40%, MEDIO 10-25%, BAJO 5-15%.

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown.
2. **`schemaModo: "procedimiento"`** en `tabla-test-case` (sin esto, el renderer no sabe qué mostrar).
3. **NO incluir campos de ejecución** en los TCs (`resultadoReal`, `criterioObservado`, `estado`, etc.) — esos son del IOQ.
4. **Cada TC con procedimiento de 3-12 pasos** — menos es trivial, más es sobre-scripting.
5. **Cada TC con un único `criterioAceptacion` consolidado** — no múltiples criterios paralelos al estilo IQ.
6. **TCs negativos identificados con `tipoTC: "NEGATIVO"`** — un OQ sin TCs negativos es sospechoso de cobertura insuficiente.
7. **`raScore` y `nivel` consistentes** — `nivel` se deriva de `raScore` (no inventar).
8. **`ursVinculados` debe trazar a URS reales** del paquete — si no traza, falla la matriz de trazabilidad.
9. **`agruparPorGrupo: true`** en `tabla-test-case` para que el renderer agrupe por grupo funcional.
10. **Mencionar pre-requisito PIQ aprobado** explícitamente en propósito + condiciones de ejecución (sin esto el OQ no debería ejecutarse).

## Ejemplo de input mínimo

> "Generá el POQ para DRP-GAMP Categorizador™. Tengo PIQ-DRP-SIS-001 v0.1 aprobado (15/15 TCs PASS), URS-DRP-SIS-001 con 55 URS, RAI-DRP-SIS-001 con 24 riesgos funcionales (RPN 9-27). HLRA categoriza GAMP 3 con IRO 32. Process Owner Federico Bongiovanni. Sistema cloud SaaS Python/Django. URL https://categorizador.drpassurance.com/. Cuentas de prueba: contacto@test.com (Usuario Final), bloqueo_test@test.com (prueba bloqueo), admin (Administrador). Quiero 8 grupos funcionales: Autenticación, Roles y Permisos, Registro, Cuestionario GAMP, GAMPI y Analytics, Reporte PDF, SHA-256 y QR, Infraestructura/NF."

El skill genera el JSON POQ con: ~47 TCs (1+ por riesgo del RAI con RPN ≥ 12), agrupados por los 8 grupos funcionales, procedimiento de 4-8 pasos por TC, criterioAceptacion consolidado al pie, 2 TCs negativos identificados (TC-OQ-020, TC-OQ-023), distribución CRÍTICO/ALTO/MEDIO/BAJO según RPN, justificación CSA al final, firmas completadas.
