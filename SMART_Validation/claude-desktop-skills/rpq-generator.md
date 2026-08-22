---
name: rpq-generator
description: Genera el JSON de un documento RPQ (Qualification Release Report — Reporte de Calificación PQ / Liberación de Etapa) para la Validation Suite de DRP. Documento ejecutivo de 5-10 páginas que un Sponsor firma para AUTORIZAR la LIBERACIÓN PRODUCTIVA GxP del sistema (cierre de la fase PQ). Usar cuando el usuario tiene el IPQ aprobado y necesita el cierre formal de la última etapa de calificación. El JSON resultante es input directo del renderer release-report — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# RPQ Generator — Validation Suite

Generador del documento **RPQ (Reporte de Calificación PQ — Liberación de Etapa)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md), [`ipq-generator.md`](./ipq-generator.md) (el RPQ cierra lo que el IPQ ejecutó) y [`riq-generator.md`](./riq-generator.md) (mismo schema, etapa distinta). RIQ, ROQ y RPQ comparten el renderer `release-report.js`.

## Cuándo usar este skill

- El usuario ya tiene el **IPQ aprobado** (la fase PQ — performance bajo condiciones reales — fue ejecutada).
- Necesita el **cierre ejecutivo** de la última etapa de calificación.
- **Diferencia clave**: el RPQ no autoriza "la fase siguiente" — autoriza la **LIBERACIÓN PRODUCTIVA GxP** del sistema. Es el último reporte de fase del ciclo. Después de él sólo viene el VSR (reporte maestro).
- Inputs típicos:
  - IPQ del paquete (resultado global de los escenarios end-to-end).
  - NCR asociado si hubo hallazgos en PQ.
  - Lista de documentos base del paquete con su estado.
  - Decisión del Sponsor: APROBADO / APROBADO CON CONDICIONES / NO APROBADO.

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Estructura del JSON RPQ

```json
{
  "schemaVersion": "1.0",
  "type": "RPQ",
  "etapa": "PQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "RPQ-<CODIGO>",
    "titleEs": "REPORTE DE CALIFICACIÓN PQ — LIBERACIÓN DE ETAPA",
    "titleEn": "QUALIFICATION RELEASE REPORT (RPQ)",
    "headerTitle": "Reporte de Calificación PQ (RPQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "Etapa cubierta": "PPQ → IPQ → RPQ",
      "Documento base (Informe)": "IPQ-<CODE> v<X>",
      "NCR consolidado": "<NCR-CODE v.X o '— No aplica (sin hallazgos en PQ) —'>",
      "Decisión": "APROBADO — LIBERACIÓN PRODUCTIVA GxP AUTORIZADA"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del RPQ. Cierre de la fase PQ con <X>/<Y> escenarios PASS. Sistema autorizado para uso productivo GxP. Habilita la emisión del VSR (Reporte Maestro de Validación)." }
  ],
  "matrizAprobaciones": [
    { "rol": "Sponsor / Director", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Gerente QA", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Process Owner", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": [
      { "tipo": "IPQ", "code": "IPQ-<CODE>", "version": "v1.0", "estado": "aprobado" },
      { "tipo": "NCR", "code": "NCR-<CODE>", "version": "v1.0", "estado": "cerrado" }
    ],
    "alimentaA": ["LIBERACIÓN PRODUCTIVA GxP", "VSR — Reporte Maestro de Validación"]
  },
  "secciones": [ ... ]
}
```

> **Nota**: El NCR en `recibeDe` es condicional — incluirlo solo si hubo hallazgos en PQ que generaron un NCR. Si PQ no tuvo hallazgos, dejar `recibeDe` con solo el IPQ.

## Secciones obligatorias del RPQ (mismo orden que RIQ/ROQ)

1. **DECISIÓN DE LIBERACIÓN** (`release-portada-decision`) — `decision` + `subtitulo: "Cierre formal de la fase de Calificación de Performance"`.

2. **PROPÓSITO Y ALCANCE** (`texto`) — qué cierra y qué autoriza. **Acá el "qué autoriza" es la liberación productiva GxP, no una fase siguiente.**

3. **RESUMEN EJECUTIVO** (`release-resumen-ejecutivo`)
   - Mismos `kpis`. Para PQ los TCs son escenarios end-to-end (`totalTcsProtocolos` cuenta escenarios).
   - `fundamento`: justifica que el sistema demostró performance bajo condiciones reales.

4. **TRAZABILIDAD DEL CIERRE** (`release-trazabilidad-cierre`) — `documentos[]` con URS, RA, PPQ, IPQ, NCR si aplica.

5. **CONDICIONANTES DE LA APROBACIÓN** (`release-condicionantes`)
   - Si el sistema se libera con obligaciones pendientes (ej. "monitoreo de performance los primeros 30 días"), van acá. Vacío `[]` si la liberación es plena.

6. **DECISIÓN FORMAL Y AUTORIZACIÓN** (`release-decision-formal`)
   - `textoFormal`: párrafo formal de **autorización de uso productivo GxP**. No menciona "fase siguiente" — menciona liberación productiva y la emisión del VSR.

7. **REFERENCIAS** (`tabla`, `["Documento", "Título"]`, widths `[180, 275]`).

8. **FIRMAS EJECUTIVAS** (`tabla-firmas-final`) — `rolesPlaceholder: ["Sponsor / Director", "Gerente QA", "Process Owner"]`, `nota: "PQ APROBADA. Sistema autorizado para uso productivo GxP. Habilita emisión del VSR."`

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **`type: "RPQ"`** y **`etapa: "PQ"`** siempre.
3. **`decision` coherente** entre portada, decisión formal y `extras.Decisión`.
4. **El RPQ autoriza LIBERACIÓN PRODUCTIVA, no "fase PQ siguiente"** — no existe fase posterior. El `alimentaA` apunta a "LIBERACIÓN PRODUCTIVA GxP" y "VSR".
5. **`kpis.fail > 0` incompatible con `APROBADO`.** Hallazgos abiertos bloquean — deben cerrarse vía NCR antes.
6. **Condicionantes ⇒ `APROBADO CON CONDICIONES`.**
7. **Versión `1.0`**. Fechas: `issueDate` mes largo, `controlCambios.fecha` mes corto, firmas `DD/MM/AAAA`.
8. **`firmas` pobladas siempre.**

## Ejemplo de input mínimo

> "Generá el RPQ para DRP-GAMP Categorizador™. El IPQ-DRP-SIS-001 v1.0 cerró la PQ con 8/8 escenarios end-to-end PASS, conducida por auditor externo (María González), sin hallazgos. Decisión del Sponsor: APROBADO — liberación productiva GxP autorizada. Firman FB Sponsor, LS Gerente QA, FB Process Owner, el 15/05/2026."

El skill genera el RPQ con banner APROBADO, KPIs 8/8 PASS cobertura 100%, condicionantes vacíos, decisión formal autorizando uso productivo GxP, nota habilitando el VSR, firmas pobladas.
