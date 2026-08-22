# Skills de Claude Desktop — Validation Suite DRP

Esta carpeta contiene los skills de generación documental para dos modos de uso:
- **Modo API** (AI Generator de la Suite): skills invoicados automáticamente por el wizard
- **Modo Claude Desktop Project** (sin costo por token): proyecto con Knowledge + instrucciones — ver sección abajo

---

## Modo A — Claude Desktop Project (recomendado para proyectos largos)

Este modo usa un proyecto de Claude Desktop con Knowledge estático (skills) + JSONs del proyecto cargados en tiempo real. No tiene costo por token — usa la suscripción flat-fee de Claude.

### Configuración del proyecto (una sola vez)

1. Crear un nuevo proyecto en Claude Desktop (ej: "SMART Validation Engine").
2. En el campo **Project Instructions** del proyecto: pegar el contenido completo de [`_INSTRUCCIONES-PROYECTO.md`](./_INSTRUCCIONES-PROYECTO.md) (es el system prompt del proyecto).
3. En **Project Knowledge**: cargar los siguientes archivos de esta carpeta:
   - `_orquestador-paquete.md`
   - Todos los `*-generator.md` (hlra, vp, urs, frs, ds, ra, ira, rrm, mtr, piq, iiq, riq, poq, ioq, roq, ppq, ipq, rpq, ncr, vsr)

### Por cada proyecto de validación

4. **Iniciar conversación nueva** dentro del proyecto configurado.
5. Pegar el contexto del sistema (descripción, manual, datos del cliente) y pedir: `"Genera el HLRA para [nombre del sistema]"`.
6. Claude responde con el JSON puro → copiarlo → importar en la Suite.
7. **Cargar el JSON generado en Project Knowledge** (como `hlra-[codigo].json`) para que el siguiente documento tenga acceso a los IDs.
8. Repetir para cada documento de la cadena, en el orden que dicta el orquestador.
9. Al terminar el proyecto: **eliminar los JSONs del proyecto de Knowledge** pero mantener los skill files para el próximo proyecto.

### Diferencias vs el AI Generator de la Suite

| Dimensión | AI Generator (API) | Claude Desktop Project |
|---|---|---|
| Costo | Por token (caro en paquetes largos) | Incluido en suscripción |
| Cascada | Automática (wizard controla el flujo) | Manual (el usuario controla el checkpoint) |
| Contexto previo | Automático (el wizard lo inyecta) | Manual (cargar JSONs en Knowledge) |
| Velocidad de setup | Inmediata | Configuración inicial única |
| Capacidad de contexto | Ventana por request | Proyecto con Knowledge persistente |

---

## Modo B — Skills CLI (AI Generator de la Suite)

1. Copiar los archivos `*.md` de esta carpeta a `~/.claude/skills/` (Linux/Mac) o `%USERPROFILE%\.claude\skills\` (Windows).
2. Reiniciar Claude Desktop.
3. **Al arrancar un paquete nuevo**: invocar primero el [`_orquestador-paquete.md`](./_orquestador-paquete.md) — captura el contexto del sistema una vez y dicta el orden de la cadena.
4. Para cada documento: pegar el bloque de contexto + el input que pide el orquestador, e invocar el skill individual (ej. "armá el HLRA para X"). Claude Desktop detecta el skill por su `description`.
5. Copiar el JSON resultante.
6. En la Validation Suite del Gestor → Importar doc al proyecto → previsualizar PDF.
7. Revisar + (opcional) firmar → recién ahí avanzar al siguiente documento de la cadena.

## El orquestador (leer primero)

[`_orquestador-paquete.md`](./_orquestador-paquete.md) es el **director de orquesta**. No genera documentos — mantiene la **coherencia de la cadena**: que los 20 docs compartan el mismo `package`, los mismos códigos, las mismas convenciones, y que las referencias cruzadas (URS↔RA↔TC↔GAP) cierren. Define el orden de generación, qué alimentar en cada paso, y las reglas transversales (versión inicial 1.0, siglas canónicas, formatos de fecha, severidad inmutable, trazabilidad sin huérfanos).

## Catálogo de skills

| Skill | Estado | Genera |
|---|---|---|
| [`_orquestador-paquete.md`](./_orquestador-paquete.md) | ✅ Listo | **Orquestador de la cadena** — contexto + orden + reglas de coherencia (no genera docs) |
| [`hlra-generator.md`](./hlra-generator.md) | ✅ Listo | HLRA — Análisis de Calificación y Criticidad GxP |
| [`vp-generator.md`](./vp-generator.md) | ✅ Listo | VP — Validation Plan / Plan de Validación |
| [`urs-generator.md`](./urs-generator.md) | ✅ Listo | URS — User Requirements Specification |
| [`frs-generator.md`](./frs-generator.md) | ✅ Listo | FRS — Functional Requirements Specification |
| [`ds-generator.md`](./ds-generator.md) | ✅ Listo | DS — Design Specification |
| [`ra-generator.md`](./ra-generator.md) | ✅ Listo | RA — Risk Analysis (operativo, FMEA) |
| [`ira-generator.md`](./ira-generator.md) | ✅ Listo | IRA — Infrastructure Risk Analysis (componentes) |
| [`rrm-generator.md`](./rrm-generator.md) | ✅ Listo | RRM — Regulatory Requirements Matrix (mapeo normativo) |
| [`mtr-generator.md`](./mtr-generator.md) | ✅ Listo | MTR — Requirements Traceability Matrix (con validación interna automática) |
| [`piq-generator.md`](./piq-generator.md) | ✅ Listo | PIQ — Protocolo IQ (enfoque CSA, criterios consolidados) |
| [`iiq-generator.md`](./iiq-generator.md) | ✅ Listo | IIQ — Informe IQ (ejecución + evidencias del Gestor + hallazgos) |
| [`poq-generator.md`](./poq-generator.md) | ✅ Listo | POQ — Protocolo OQ (Operational Qualification Protocol) |
| [`ioq-generator.md`](./ioq-generator.md) | ✅ Listo | IOQ — Informe OQ (ejecución del protocolo + evidencias) |
| [`ppq-generator.md`](./ppq-generator.md) | ✅ Listo | PPQ — Protocolo PQ (Performance Qualification) |
| [`ipq-generator.md`](./ipq-generator.md) | ✅ Listo | IPQ — Informe PQ (ejecución del protocolo + evidencias) |
| [`riq-generator.md`](./riq-generator.md) | ✅ Listo | RIQ — Reporte de Calificación IQ (liberación de etapa, ejecutivo) |
| [`roq-generator.md`](./roq-generator.md) | ✅ Listo | ROQ — Reporte de Calificación OQ (liberación de etapa, ejecutivo) |
| [`rpq-generator.md`](./rpq-generator.md) | ✅ Listo | RPQ — Reporte de Calificación PQ (liberación productiva GxP) |
| [`ncr-generator.md`](./ncr-generator.md) | ✅ Listo | NCR — Non-Conformance Report (4 etapas gated: registro → causa raíz → CAPA → cierre) |
| [`vsr-generator.md`](./vsr-generator.md) | ✅ Listo | VSR — Validation Summary Report (reporte maestro del ciclo completo) |

> **Catálogo completo.** Los 21 tipos de documento del ciclo de validación tienen su skill generador. El renderer de cada uno ya está implementado en la Suite — el skill produce el JSON que se importa.

## Documentación de soporte

- [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) — Patrones, reglas y errores frecuentes detectados durante la implementación. **Leer antes de crear un skill nuevo.**

## Flujo de trabajo recomendado

1. **Arrancar con el orquestador** — invocar `_orquestador-paquete.md`, completar el Paso 0 (contexto del sistema), guardar el bloque de contexto.
2. **Cliente provee información** sobre el sistema (manual, URS, descripción, etc.).
3. **Claude Desktop genera el JSON** usando el skill del documento que toca en la cadena, con el bloque de contexto pegado al inicio.
4. **Humano revisa el JSON** (corrige nombres, fechas, GAPs reales, IDs coherentes con docs previos).
5. **Importar en la Validation Suite** → previsualizar el PDF.
6. **Firmar electrónicamente** desde la suite (firma con PIN 21 CFR Part 11).
7. **Recién ahí** avanzar al siguiente documento de la cadena (checkpoint humano).
8. **Exportar el "libro de validación"** consolidado al final.

## Filosofía: humano firma, no la IA

La IA propone borradores. El humano revisa, ajusta y firma. La trazabilidad de la firma queda en el log de DocuSign + en la matriz de aprobaciones del documento.

La Suite **no embebe IA**: solo recibe JSON validado y renderiza. Esto la mantiene auditable y defensible ante reguladores.
