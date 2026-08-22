---
name: roq-generator
description: Genera el JSON de un documento ROQ (Qualification Release Report — Reporte de Calificación OQ / Liberación de Etapa) para la Validation Suite de DRP. Documento ejecutivo de 5-10 páginas que un Sponsor firma para AUTORIZAR el paso de la fase OQ a la fase PQ. Usar cuando el usuario tiene el IOQ aprobado (y el NCR cerrado si hubo hallazgos) y necesita el cierre formal de la etapa Operacional. El JSON resultante es input directo del renderer release-report — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# ROQ Generator — Validation Suite

Generador del documento **ROQ (Reporte de Calificación OQ — Liberación de Etapa)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md), [`ioq-generator.md`](./ioq-generator.md) (el ROQ cierra lo que el IOQ ejecutó) y [`riq-generator.md`](./riq-generator.md) (mismo schema, etapa distinta). RIQ, ROQ y RPQ comparten el renderer `release-report.js`.

## Cuándo usar este skill

- El usuario ya tiene el **IOQ aprobado** y, si hubo hallazgos en OQ, el **NCR cerrado**.
- Necesita el **cierre ejecutivo** de la etapa Operacional que autoriza el avance a PQ.
- La OQ suele tener hallazgos (es la fase donde se prueba comportamiento funcional) → el ROQ frecuentemente referencia un NCR y puede tener condicionantes.
- Inputs típicos:
  - IOQ del paquete (resultado global, TCs PASS/FAIL/OBS, TCs negativos, hallazgos).
  - NCR asociado (NCs identificadas en OQ, su estado de cierre).
  - Lista de documentos base del paquete con su estado.
  - Decisión del Sponsor: APROBADO / APROBADO CON CONDICIONES / NO APROBADO.

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Estructura del JSON ROQ

```json
{
  "schemaVersion": "1.0",
  "type": "ROQ",
  "etapa": "OQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "ROQ-<CODIGO>",
    "titleEs": "REPORTE DE CALIFICACIÓN OQ — LIBERACIÓN DE ETAPA",
    "titleEn": "QUALIFICATION RELEASE REPORT (ROQ)",
    "headerTitle": "Reporte de Calificación OQ (ROQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "Etapa cubierta": "POQ → IOQ → ROQ",
      "Documento base (Informe)": "IOQ-<CODE> v<X>",
      "NCR consolidado": "<NCR-CODE v.X — N NCs cerradas, o '— No aplica —'>",
      "Decisión": "APROBADO"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del ROQ. Cierre de la fase OQ con <X>/<Y> TCs PASS. <N hallazgos gestionados vía NCR>. Sistema apto para iniciar Calificación de Performance (PQ)." }
  ],
  "matrizAprobaciones": [
    { "rol": "Sponsor / Director", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Gerente QA", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Process Owner", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": [
      { "tipo": "IOQ", "code": "IOQ-<CODE>", "version": "v1.0", "estado": "aprobado" },
      { "tipo": "NCR", "code": "NCR-<CODE>", "version": "v1.0", "estado": "aprobado" }
    ],
    "alimentaA": ["PQ — Calificación de Performance"]
  },
  "secciones": [ ... ]
}
```

## Secciones obligatorias del ROQ (mismo orden que RIQ)

1. **DECISIÓN DE LIBERACIÓN** (`release-portada-decision`) — `decision` + `subtitulo: "Cierre formal de la fase de Calificación Operacional"`.

2. **PROPÓSITO Y ALCANCE** (`texto`) — qué cierra y qué autoriza (avance a PQ).

3. **RESUMEN EJECUTIVO** (`release-resumen-ejecutivo`)
   - Mismos `kpis` que RIQ. Para OQ: poblar `negativos` y `negativosFail` (la OQ tiene TCs negativos), y `hallazgosTotal` / `hallazgosCerrados` / `hallazgosAbiertos` / `criticasAbiertas` reflejando el NCR.
   - `fundamento`: justifica la decisión mencionando hallazgos gestionados.

4. **TRAZABILIDAD DEL CIERRE** (`release-trazabilidad-cierre`) — `documentos[]` con URS, RA, POQ, IOQ, NCR.

5. **CONDICIONANTES DE LA APROBACIÓN** (`release-condicionantes`)
   - En OQ es más común tener condicionantes (ej. "verificar fix en producción antes de PQ"). `condicionantes`: `[{ descripcion, responsable, plazo, estado }]`.
   - Si hay condicionantes → `decision: "APROBADO CON CONDICIONES"`.

6. **DECISIÓN FORMAL Y AUTORIZACIÓN** (`release-decision-formal`) — `textoFormal` menciona la fase PQ.

7. **REFERENCIAS** (`tabla`, `["Documento", "Título"]`, widths `[180, 275]`).

8. **FIRMAS EJECUTIVAS** (`tabla-firmas-final`) — `rolesPlaceholder: ["Sponsor / Director", "Gerente QA", "Process Owner"]`, `nota: "OQ APROBADA. Sistema autorizado para iniciar PPQ-<CODE>."`

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **`type: "ROQ"`** y **`etapa: "OQ"`** siempre.
3. **`decision` coherente** entre portada, decisión formal y `extras.Decisión`.
4. **Si el IOQ tuvo hallazgos** → el ROQ DEBE referenciar el NCR en `trazabilidad.recibeDe` y en `extras."NCR consolidado"`. Un ROQ APROBADO con `hallazgosAbiertos > 0` es inválido — las NCs deben estar cerradas antes de liberar la etapa.
5. **`kpis.fail > 0` incompatible con `APROBADO`.** Un FAIL sin cerrar bloquea.
6. **Condicionantes ⇒ `APROBADO CON CONDICIONES`.**
7. **Versión `1.0`**. Fechas: `issueDate` mes largo, `controlCambios.fecha` mes corto, firmas `DD/MM/AAAA`.
8. **`firmas` pobladas siempre.**

## Ejemplo de input mínimo

> "Generá el ROQ para DRP-GAMP Categorizador™. El IOQ-DRP-SIS-001 v1.0 cerró la OQ con 47/47 TCs PASS (incluidos 2 negativos). Hubo 2 NCs (NC-001 OBS, NC-002 crítica) — ambas cerradas vía NCR-DRP-SIS-001 v1.0 con CAPAs verificadas. Decisión del Sponsor: APROBADO. Firman FB Sponsor, LS Gerente QA, FB Process Owner, el 26/04/2026."

El skill genera el ROQ con banner APROBADO, KPIs 47/47 PASS + 2 NCs cerradas, trazabilidad referenciando IOQ + NCR, decisión formal autorizando avance a PQ, firmas pobladas.
