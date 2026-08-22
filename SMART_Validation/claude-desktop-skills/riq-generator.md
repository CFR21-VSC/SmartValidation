---
name: riq-generator
description: Genera el JSON de un documento RIQ (Qualification Release Report — Reporte de Calificación IQ / Liberación de Etapa) para la Validation Suite de DRP. Documento ejecutivo de 5-10 páginas que un Sponsor firma para AUTORIZAR el paso de la fase IQ a la fase OQ. Usar cuando el usuario tiene el IIQ aprobado y necesita el cierre formal de la etapa de Instalación. El JSON resultante es input directo del renderer release-report — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# RIQ Generator — Validation Suite

Generador del documento **RIQ (Reporte de Calificación IQ — Liberación de Etapa)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) e [`iiq-generator.md`](./iiq-generator.md) (el RIQ cierra lo que el IIQ ejecutó). RIQ, ROQ y RPQ comparten el mismo renderer (`release-report.js`) — sólo cambia `etapa`.

## Cuándo usar este skill

- El usuario ya tiene el **IIQ aprobado** (la fase IQ fue ejecutada y documentada).
- Necesita el **cierre ejecutivo** de la etapa de Instalación que autoriza el avance a OQ.
- El RIQ NO repite el detalle técnico del IIQ — es ejecutivo: KPIs, decisión, condicionantes, firma del Sponsor.
- Inputs típicos:
  - IIQ del paquete (resultado global, TCs PASS/FAIL/OBS, hallazgos).
  - NCR asociado si hubo hallazgos en IQ (normalmente IQ no tiene).
  - Lista de documentos base del paquete con su estado.
  - Decisión del Sponsor: APROBADO / APROBADO CON CONDICIONES / NO APROBADO.

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Diferencia clave Informe (IIQ) vs Reporte (RIQ)

| | IIQ — Informe | RIQ — Reporte de Liberación |
|---|---|---|
| Longitud | 40-60 páginas (detalle técnico) | 5-10 páginas (ejecutivo) |
| Audiencia | Validador, Process Owner | Sponsor / Director / Gerente QA |
| Contenido | Cada TC con su procedimiento y evidencia | KPIs consolidados + decisión formal |
| Lo que produce | Documentación de ejecución | **Autorización de avance de fase** |
| Firmas | Ejecutor + Revisor | Sponsor / Director, Gerente QA, Process Owner |

## Estructura del JSON RIQ

```json
{
  "schemaVersion": "1.0",
  "type": "RIQ",
  "etapa": "IQ",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "RIQ-<CODIGO>",
    "titleEs": "REPORTE DE CALIFICACIÓN IQ — LIBERACIÓN DE ETAPA",
    "titleEn": "QUALIFICATION RELEASE REPORT (RIQ)",
    "headerTitle": "Reporte de Calificación IQ (RIQ)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 §8 | FDA CSA 2022",
    "extras": {
      "Etapa cubierta": "PIQ → IIQ → RIQ",
      "Documento base (Informe)": "IIQ-<CODE> v<X>",
      "NCR consolidado": "<NCR-CODE v.X o '— No aplica (sin hallazgos en IQ) —'>",
      "Decisión": "APROBADO"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del RIQ. Cierre de la fase IQ con <X>/<Y> TCs PASS. <hallazgos>. Sistema apto para iniciar Calificación Operacional (OQ)." }
  ],
  "matrizAprobaciones": [
    { "rol": "Sponsor / Director", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Gerente QA", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Process Owner", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": [{ "tipo": "IIQ", "code": "IIQ-<CODE>", "version": "v1.0", "estado": "aprobado" }],
    "alimentaA": ["OQ — Calificación Operacional"]
  },
  "secciones": [ ... ]
}
```

## Secciones obligatorias del RIQ (en este orden)

1. **DECISIÓN DE LIBERACIÓN** (`tipo: "release-portada-decision"`)
   - `decision`: `"APROBADO"` | `"APROBADO CON CONDICIONES"` | `"NO APROBADO"`.
   - `subtitulo`: ej. `"Cierre formal de la fase de Calificación de Instalación"`.
   - El renderer dibuja un banner enorme coloreado según la decisión (verde/naranja/rojo).

2. **PROPÓSITO Y ALCANCE** (`tipo: "texto"`) — 2 bloques. Qué cierra el RIQ y qué autoriza.

3. **RESUMEN EJECUTIVO** (`tipo: "release-resumen-ejecutivo"`)
   - `kpis`: objeto con `totalTcsProtocolos`, `totalTcsEjecutados`, `pass`, `fail`, `obs`, `na`, `pendiente`, `negativos`, `negativosFail`, `cobertura` (%), `estadoGlobal`, `hallazgosTotal`, `hallazgosCerrados`, `hallazgosAbiertos`, `criticasAbiertas`.
   - `fundamento`: párrafo que justifica la decisión con números concretos.
   - **Nota**: si los `kpis` se dejan todos en `null`, el renderer los auto-completa desde el paquete cargado en el suite. Pero para un sample completo, poblarlos.

4. **TRAZABILIDAD DEL CIERRE** (`tipo: "release-trazabilidad-cierre"`)
   - `documentos`: array de `{ codigo, tipo, version, estado, observacion }` — los docs base referenciados (URS, RA, PIQ, IIQ del paquete).
   - Si se deja `documentos: []`, el renderer lo auto-llena desde el paquete.

5. **CONDICIONANTES DE LA APROBACIÓN** (`tipo: "release-condicionantes"`)
   - `condicionantes`: array de `{ descripcion, responsable, plazo, estado }`. **Vacío `[]`** si la aprobación es plena (lo normal para IQ).
   - Si hay condicionantes, la `decision` debería ser `"APROBADO CON CONDICIONES"`.

6. **DECISIÓN FORMAL Y AUTORIZACIÓN** (`tipo: "release-decision-formal"`)
   - `decision`: misma que la portada.
   - `textoFormal`: párrafo formal de autorización (o denegación). Menciona explícitamente la fase siguiente (OQ).

7. **REFERENCIAS** (`tipo: "tabla"`, columnas `["Documento", "Título"]`, widths `[180, 275]`).

8. **FIRMAS EJECUTIVAS** (`tipo: "tabla-firmas-final"`)
   - `rolesPlaceholder`: `["Sponsor / Director", "Gerente QA", "Process Owner"]`.
   - `firmas`: array poblado (es un documento aprobado).
   - `nota`: ej. `"IQ APROBADA. Sistema autorizado para iniciar POQ-<CODE>."`

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **`type: "RIQ"`** y **`etapa: "IQ"`** siempre.
3. **`decision` debe ser coherente** entre las 3 secciones que la usan (portada, decisión formal, extras del document). Valores: `APROBADO` / `APROBADO CON CONDICIONES` / `NO APROBADO`.
4. **Si hay condicionantes**, la decisión NO puede ser `APROBADO` a secas — es `APROBADO CON CONDICIONES`.
5. **`kpis.fail > 0` es incompatible con `decision: "APROBADO"`** — un FAIL bloquea la liberación. Sería `NO APROBADO` o requiere NCR previo.
6. **Versión inicial `1.0`**. Fechas: `issueDate` mes largo, `controlCambios.fecha` mes corto, firmas `DD/MM/AAAA`.
7. **El RIQ NO repite el detalle de los TCs** — eso vive en el IIQ. El RIQ consolida.
8. **`firmas` pobladas siempre** (documento ejecutivo firmado por Sponsor).

## Ejemplo de input mínimo

> "Generá el RIQ para DRP-GAMP Categorizador™. El IIQ-DRP-SIS-001 v1.0 cerró la IQ con 15/15 TCs PASS, sin hallazgos. Decisión del Sponsor (Federico Bongiovanni): APROBADO. Firman FB como Sponsor, Lucas Santarenz como Gerente QA, FB como Process Owner, el 20/03/2026."

El skill genera el RIQ con banner APROBADO, KPIs 15/15 PASS cobertura 100%, condicionantes vacíos, decisión formal autorizando el avance a OQ, y las 3 firmas ejecutivas pobladas.
