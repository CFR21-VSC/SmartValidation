---
name: ppq-generator
description: Genera el JSON de un documento PPQ (Performance Qualification Protocol / Protocolo de Calificación de Performance) para la Validation Suite de DRP. Define los Test Cases ANTES de ejecutar la PQ, con enfoque CSA respetando que las pruebas de performance son escenarios end-to-end de uso productivo real (no instalación, no operación pura). Usar cuando el usuario tiene PIQ + POQ aprobados (todos los TCs PASS) y necesita validar el sistema bajo condiciones representativas reales. El JSON resultante es input directo del renderer PPQ — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# PPQ Generator — Validation Suite

Generador del documento **PPQ (Performance Qualification Protocol / Protocolo de Calificación de Performance)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md), [`poq-generator.md`](./poq-generator.md) (comparten schema y estructura — PPQ se diferencia en el enfoque: escenarios end-to-end vs función específica).

## Cuándo usar este skill

- El usuario ya tiene **PIQ + POQ aprobados** (100% TCs PASS) — pre-requisito obligatorio doble.
- Tiene **URS y RAI aprobados** (los TCs PQ se derivan de escenarios de uso productivo identificados).
- Necesita el protocolo que define los TCs de performance **ANTES** de ejecutarlos.
- En el PPQ NO van resultados, NO van firmas de ejecución. Solo placeholders. Eso es del IPQ.
- Inputs típicos:
  - PIQ aprobado + POQ aprobado (pre-requisito).
  - URS (escenarios de uso productivo).
  - RAI (riesgos funcionales y de performance).
  - Métricas de performance objetivo (response time, concurrencia, uptime, etc.).
  - Casos de uso reales con usuarios productivos (UAT scenarios).

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Filosofía: PQ es comportamiento end-to-end, no función aislada

El PQ verifica que el sistema **funciona en su totalidad bajo condiciones de uso productivo real**. La diferencia con OQ:

| | OQ | PQ |
|---|---|---|
| Naturaleza | Verifica funciones específicas (login, cuestionario, PDF) | Verifica escenarios end-to-end (un caso de uso completo desde inicio a fin) |
| Usuarios | Cuentas de prueba dedicadas | Usuarios reales del negocio (o representativos) |
| Datos | Datos de prueba controlados | Datos productivos o realistas |
| Ambiente | Operativo aislado | Productivo o staging idéntico a productivo |
| Métricas | Funcionalidad correcta | Performance + funcionalidad bajo carga real |
| Riesgo CSA viejo | Sobre-scriptear cada función | Sobre-scriptear cada paso de un escenario |

**CSA aplicado al PQ correctamente**:
- Procedimiento por TC es el **flujo del escenario de negocio** (5-15 pasos representativos).
- Cada paso es una **acción significativa del usuario real** (registrarse, categorizar un sistema real, generar reporte, verificar via QR público).
- **Un único `criterioAceptacion`** consolidado al final mide el éxito del escenario completo.
- Métricas de performance integradas (tiempo de respuesta, concurrencia si aplica).

## Schema del Test Case PQ (idéntico al OQ — schemaModo "procedimiento")

```json
{
  "tcId": "TC-PQ-001",
  "titulo": "Usuario nuevo registra un sistema GAMP 3 y descarga reporte verificable",
  "tipoTC": "POSITIVO",
  "grupo": "Categorización end-to-end",
  "grupoFuncional": "Categorización end-to-end",
  "raScore": 27,
  "nivel": "CRÍTICO",
  "ursVinculados": ["URS-001", "URS-017", "URS-035", "URS-041"],
  "raVinculado": "RAI-001",
  "objetivo": "Verificar que un usuario real (no operador interno) puede ejecutar el flujo completo de categorización: alta de cuenta, primer login, registro de sistema, cuestionario, resultado, descarga de reporte PDF y verificación por QR.",
  "precondiciones": [
    "PIQ + POQ aprobados",
    "Cuenta de prueba productiva creada (no test-only): usuario_real@org.com",
    "Acceso desde navegador típico del usuario final"
  ],
  "procedimiento": [
    { "paso": 1, "instruccion": "Usuario navega a la URL pública del sistema. Solicita alta de cuenta vía formulario.", "resultadoEsperado": "Email de bienvenida recibido en ≤2 minutos." },
    { "paso": 2, "instruccion": "Primer login con credenciales del email. Sistema solicita cambio de contraseña obligatorio.", "resultadoEsperado": "Flujo de primer acceso completo, dashboard accesible tras cambio." },
    { "paso": 3, "instruccion": "Registrar un sistema real con datos representativos (nombre, categoría, ambiente, responsable).", "resultadoEsperado": "Formulario procesado, avanza al cuestionario." },
    { "paso": 4, "instruccion": "Completar el cuestionario adaptativo respondiendo según el sistema real.", "resultadoEsperado": "Resultado de categorización GAMP con índice de confianza ≥90%." },
    { "paso": 5, "instruccion": "Generar y descargar reporte PDF. Verificar tiempo de generación.", "resultadoEsperado": "PDF descargado en ≤30s. Archivo de 4 páginas con QR y hash visible." },
    { "paso": 6, "instruccion": "Escanear QR del reporte con dispositivo móvil. Acceder al portal de verificación.", "resultadoEsperado": "Portal muestra resultado VÁLIDO con metadatos coincidentes con el PDF." }
  ],
  "criterioAceptacion": "Usuario nuevo completa el flujo end-to-end exitosamente: alta → primer login → categorización → reporte → verificación pública. Sin asistencia de soporte. Tiempos dentro de los límites operacionales (email ≤2min, PDF ≤30s).",
  "notas": ""
}
```

**Reglas estrictas del Test Case PQ**:

1. `tcId` formato exacto: `TC-PQ-NNN` (3 dígitos).
2. `tipoTC`: `"POSITIVO"` (flujo end-to-end completo) o `"NEGATIVO"` (escenario adverso — usuario sin permisos, datos inválidos, condición límite).
3. `grupo`: nombre del **escenario de negocio** (ej. "Categorización end-to-end", "Gestión de cuentas", "Verificación pública", "Operación bajo carga").
4. `raScore`: número (RPN del RAI). Típicamente 18-27 (los escenarios end-to-end suelen ser ALTO o CRÍTICO).
5. `nivel`: `"CRÍTICO"`/`"ALTO"`/`"MEDIO"`/`"BAJO"` derivado de raScore.
6. `procedimiento`: array de pasos. **Para PQ típicamente 5-15 pasos** (escenarios más largos que OQ, pero igual no sobre-scriptear).
7. `criterioAceptacion`: string consolidado que mide el éxito del escenario completo (incluyendo métricas de performance si aplican).
8. **NO incluir** campos de ejecución (`resultadoReal`, `criterioObservado`, `estado`, etc.). Eso es del IPQ.

## TCs negativos en PQ

- Identificar escenarios adversos representativos del uso real: usuario nuevo sin entender el cuestionario, intentos de fraude (modificar PDF + intentar verificar), credenciales expiradas, conexión inestable, etc.
- Marcar `tipoTC: "NEGATIVO"`.
- Es PASS si el sistema responde apropiadamente al escenario adverso (lo bloquea, muestra error claro, no compromete la integridad).

## Estructura del JSON PPQ

```json
{
  "schemaVersion": "1.0",
  "type": "PPQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "PPQ-<CODIGO>",
    "titleEs": "PROTOCOLO DE CALIFICACIÓN DE PERFORMANCE",
    "titleEn": "PERFORMANCE QUALIFICATION PROTOCOL (PPQ)",
    "headerTitle": "Protocolo de Calificación de Performance (PPQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría GAMP del paquete>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "URL Sistema": "<URL>",
      "Documento base (URS + RAI)": "URS-<CODE> v<X> + RAI-<CODE> v<X>",
      "Total TCs PQ": "<N> TCs (X CRÍTICO / Y ALTO / Z MEDIO)",
      "TCs negativos": "<N> TCs (TC-PQ-XXX, TC-PQ-YYY)",
      "Pre-requisito": "PIQ-<CODE> + POQ-<CODE> aprobados (TODOS los TCs PASS)"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del PPQ. Define <N> TCs para la calificación de performance del sistema." }
  ],
  "matrizAprobaciones": [
    { "rol": "Elaboró", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Revisó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Aprobó", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" },
    { "rol": "Process Owner", "nombre": "<nombre>", "iniciales": "<iniciales>", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": ["URS", "RA", "RRM", "MTR", "PIQ", "POQ"],
    "alimentaA": ["IPQ", "RPQ"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del PPQ (en este orden)

1. **PROPÓSITO Y OBJETIVO** (`tipo: "texto"`) — Mencionar PIQ + POQ aprobados como pre-requisitos. Mencionar que el PQ valida uso productivo real.
2. **ALCANCE** (`tipo: "lista-incluido-excluido"`) — Incluido: escenarios end-to-end. Excluido: tests aislados de función (cubiertos en OQ).
3. **DOCUMENTOS DE REFERENCIA** (`tipo: "tabla"`).
4. **CONDICIONES DE EJECUCIÓN** (`tipo: "tabla-info"`) — Ambiente productivo o staging idéntico. Pre-requisitos: PIQ + POQ. Usuarios reales o representativos. Herramientas: incluir **"Gestor de Evidencias 3.0"**. Criterio: 100% TCs PASS bajo condiciones reales.
5. **RESUMEN DE TEST CASES PQ** (`tipo: "matriz-tc"`) — `columnasVisibles: ["tcId", "titulo", "grupo", "tipoTC", "raScore", "nivel", "ursVinculados"]`.
6. **TEST CASES — PERFORMANCE QUALIFICATION** (`tipo: "tabla-test-case"`) — `agruparPorGrupo: true`, `schemaModo: "procedimiento"`.
7. **JUSTIFICACIÓN DE PROPORCIONALIDAD** (`tipo: "texto"`) — distribución por nivel, cobertura escenarios, justificación de TCs negativos.
8. **REFERENCIAS** (`tipo: "tabla"`).
9. **FIRMAS DE EJECUCIÓN** (`tipo: "tabla-firmas-final"`).

## Cantidad típica de TCs PQ por sistema

| Categoría GAMP | TCs PQ típicos |
|---|---|
| GAMP 3 (COTS no configurado) | 5-15 TCs (escenarios principales del negocio) |
| GAMP 4 (COTS configurado) | 10-25 TCs |
| GAMP 5 (Custom) | 15-40 TCs |

**Menos TCs que OQ pero más completos** — cada PQ TC cubre un flujo end-to-end de varios módulos.

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown.
2. **`schemaModo: "procedimiento"`** en `tabla-test-case`.
3. **NO campos de ejecución** en los TCs — eso es del IPQ.
4. **Cada TC con 5-15 pasos** representativos del escenario real.
5. **`criterioAceptacion` consolidado** con métricas de performance si aplican (tiempos, concurrencia).
6. **TCs negativos identificados** — sin escenarios adversos, cobertura insuficiente.
7. **`raScore` y `nivel` consistentes**.
8. **`ursVinculados` debe trazar a URS reales** — un PQ TC típicamente toca varios URS (es end-to-end).
9. **`agruparPorGrupo: true`** para mostrar escenarios agrupados.
10. **Mencionar pre-requisito PIQ + POQ aprobados** explícitamente.

## Ejemplo de input mínimo

> "Generá el PPQ para DRP-GAMP Categorizador™. Tengo PIQ + POQ aprobados. Sistema cloud SaaS. Quiero validar 8 escenarios end-to-end: alta de cuenta + primer uso, categorización completa con reporte, verificación pública vía QR, gestión multi-usuario, recovery de contraseña, intento de fraude con PDF modificado (NEG), uso bajo conexión inestable, integridad de audit trail tras múltiples categorizaciones."

El skill genera el JSON PPQ con 8 TCs PQ end-to-end, procedimiento de 5-15 pasos por TC, criterioAceptacion con métricas de performance, 1-2 TCs negativos identificados, distribución por nivel.
