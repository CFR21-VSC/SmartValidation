---
name: vsr-generator
description: Genera el JSON de un documento VSR (Validation Summary Report — Reporte Maestro de Validación) para la Validation Suite de DRP. Documento ejecutivo final que consolida TODO el ciclo de validación en un solo entregable — la "carátula" del paquete que un auditor regulatorio lee primero. Usar cuando el ciclo completo está cerrado (RIQ + ROQ + RPQ aprobados, NCs cerradas). El JSON resultante es input directo del renderer VSR — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# VSR Generator — Validation Suite

Generador del documento **VSR (Reporte Maestro de Validación — Ciclo Completo)**.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md). El VSR consolida TODO — conviene tener a mano los reportes de fase (RIQ, ROQ, RPQ) y el NCR ya generados.

## Cuándo usar este skill

- El ciclo de validación está **completo**: RIQ, ROQ y RPQ aprobados, y todas las NCs cerradas vía NCR.
- El usuario necesita el **documento maestro** que cierra el paquete — el último documento del ciclo.
- **Diferencia clave vs reportes de fase**: los R* (RIQ/ROQ/RPQ) liberan UNA fase cada uno. El VSR es la liberación COMPLETA del sistema. Un auditor regulatorio lo abre primero — es la carátula del paquete entero.
- Inputs típicos:
  - Inventario completo del paquete documental (todos los docs con código, tipo, versión, estado).
  - KPIs globales del ciclo (TCs totales de las 3 fases, cobertura, hallazgos).
  - Cronología de cierre de cada fase (IQ, OQ, PQ).
  - Consolidado de todas las NCs del ciclo con su estado final.
  - Decisión global de validación.

## Output esperado

**Un único objeto JSON** que valide contra el schema. Sin texto fuera del JSON.

## Estructura del JSON VSR

```json
{
  "schemaVersion": "1.0",
  "type": "VSR",
  "package": { /* mismo del paquete */ },
  "document": {
    "code": "VSR-<CODIGO>",
    "titleEs": "REPORTE MAESTRO DE VALIDACIÓN — CICLO COMPLETO",
    "titleEn": "VALIDATION SUMMARY REPORT (VSR)",
    "headerTitle": "Reporte Maestro de Validación (VSR)",
    "version": "1.0",
    "issueDate": "<Mes Año>",
    "status": "Aprobado",
    "processOwner": "<nombre>",
    "gampCategory": "<categoría>",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | GAMP 5 (Second Edition 2022) | FDA CSA 2022",
    "extras": {
      "Paquete documental": "<CODE> (<N> documentos)",
      "Ciclo cubierto": "HLRA → VP → URS → ... → RPQ",
      "Período de validación": "<Mes Año> — <Mes Año>",
      "Decisión global": "SISTEMA VALIDADO Y AUTORIZADO PARA USO PRODUCTIVO GxP"
    }
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<Mes Año>", "autor": "<nombre> — Process Owner", "descripcion": "Emisión inicial del VSR consolidando el ciclo completo del paquete <CODE>. Reúne los <N> documentos del paquete con sus métricas y decisiones de cada fase. Sistema validado — todas las NCs identificadas fueron cerradas antes del cierre del ciclo." }
  ],
  "matrizAprobaciones": [
    { "rol": "Sponsor", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Director Técnico", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Gerente QA", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" },
    { "rol": "Process Owner", "nombre": "...", "iniciales": "...", "fecha": "DD/MM/AAAA" }
  ],
  "trazabilidad": {
    "recibeDe": [
      { "tipo": "RIQ", "code": "RIQ-<CODE>", "version": "v1.0", "estado": "aprobado" },
      { "tipo": "ROQ", "code": "ROQ-<CODE>", "version": "v1.0", "estado": "aprobado" },
      { "tipo": "RPQ", "code": "RPQ-<CODE>", "version": "v1.0", "estado": "aprobado" },
      { "tipo": "NCR", "code": "NCR-<CODE>", "version": "v1.0", "estado": "aprobado" }
    ],
    "alimentaA": ["Sistema productivo GxP", "Auditoría regulatoria", "Revisión periódica de validación"]
  },
  "secciones": [ ... ]
}
```

## Secciones obligatorias del VSR (en este orden)

1. **AUTORIZACIÓN MAESTRA DE VALIDACIÓN** (`tipo: "vsr-portada-final"`)
   - `decision`: ej. `"SISTEMA VALIDADO"` (el renderer detecta APROB/VALID/LIBER → verde; CONDIC/OBS → naranja; resto → rojo).
   - `subtitulo`: ej. `"Sistema <nombre> v<X> — Paquete <CODE>"`.
   - `statsResumen`: `{ totalDocs, totalTcs, cobertura, ncsGestionadas }` — los 4 números grandes del banner.

2. **PROPÓSITO Y ALCANCE** (`tipo: "texto"`) — 3 bloques: qué es el VSR, qué consolida (la cadena completa de docs), y que se emite tras el RPQ como último doc del paquete.

3. **IDENTIFICACIÓN DEL SISTEMA VALIDADO** (`tipo: "tabla-info"`, `labelWidth: 165`)
   - Sistema, Cliente, URL productiva, Categoría GAMP, Código del paquete, Período de validación, Decisión global.

4. **RESUMEN EJECUTIVO DEL CICLO** (`tipo: "release-resumen-ejecutivo"`) — reusa el renderer de release-report.
   - `kpis`: mismos campos que los reportes R* pero CONSOLIDADOS del ciclo entero (los 3 protocolos sumados).
   - `fundamento`: párrafo que resume el ciclo completo con números (TCs totales, fases, NCs gestionadas).

5. **INVENTARIO DEL PAQUETE DOCUMENTAL** (`tipo: "vsr-inventario-paquete"`)
   - `documentos`: array de TODOS los docs del paquete `{ codigo, tipo, version, estado, observacion }`.
   - El renderer los agrupa automáticamente por fase del ciclo (Pre-validación / Análisis de riesgo / IQ / OQ / PQ / Evidencias).

6. **CRONOLOGÍA DE FASES DEL CICLO** (`tipo: "vsr-cronologia-fases"`)
   - `fases`: array de `{ codigo, label, cierre, estado }` — típicamente IQ, OQ, PQ, VSR.
   - `estado`: `"aprobada"` / `"pendiente"`. El renderer dibuja un timeline visual con conectores.

7. **HALLAZGOS Y CAPAs CONSOLIDADOS DEL CICLO** (`tipo: "vsr-hallazgos-resumen"`)
   - `hallazgos`: array de TODAS las NCs del ciclo `{ id, criticidad, severidad, tcRef, descripcion, accion, estado }`.
     - `criticidad`: `"OBSERVACIÓN"` / `"MENOR"` / `"MAYOR"` / `"CRÍTICA"`.
     - `severidad`: `"BAJO"` / `"MEDIO"` / `"ALTO"` (intensidad de impacto).
     - `estado`: `"CERRADO"` / `"ABIERTO"`.
   - Para un VSR válido, **todas** deben estar `"CERRADO"`.

8. **DECISIÓN FORMAL DE VALIDACIÓN** (`tipo: "vsr-decision-final"`)
   - `decision`: misma que la portada.
   - `textoFormal`: párrafo formal de autorización de uso productivo GxP, mencionando los marcos normativos.
   - `validez`: ej. `"Validez plena hasta DD/MM/AAAA (revalidación anual) o hasta cambio significativo vía Control de Cambios."`

9. **REFERENCIAS NORMATIVAS** (`tipo: "tabla"`, `["Documento", "Título"]`, widths `[180, 275]`).

10. **FIRMAS EJECUTIVAS DE VALIDACIÓN** (`tipo: "tabla-firmas-final"`)
    - `rolesPlaceholder: ["Sponsor", "Director Técnico", "Gerente QA", "Process Owner"]`.
    - `nota`: ej. `"Sistema VALIDADO el DD/MM/AAAA — autorizado para uso productivo GxP."`

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.**
2. **`type: "VSR"`** siempre.
3. **El VSR es el ÚLTIMO documento del ciclo** — sólo se emite con RIQ + ROQ + RPQ aprobados. Su `trazabilidad.recibeDe` los referencia a los tres + el NCR.
4. **El inventario debe listar TODOS los docs del paquete** — si falta alguno, el auditor lo nota. Usar las siglas canónicas.
5. **Todas las NCs del consolidado deben estar `"CERRADO"`** para una decisión `SISTEMA VALIDADO`. Una NC abierta ⇒ la decisión es `VALIDACIÓN NO COMPLETADA` o `VALIDADO CON CONDICIONES`.
6. **`decision` coherente** entre portada (`vsr-portada-final`), decisión final (`vsr-decision-final`) y `extras."Decisión global"`.
7. **Los KPIs del resumen son CONSOLIDADOS del ciclo** — no de una fase. `totalTcsEjecutados` suma los TCs de IQ + OQ + PQ.
8. **Versión `1.0`**. Fechas: `issueDate` mes largo, `controlCambios.fecha` mes corto, firmas `DD/MM/AAAA`.
9. **4 firmas ejecutivas** — Sponsor, Director Técnico, Gerente QA, Process Owner. Es la firma de más alto nivel del paquete.

## Ejemplo de input mínimo

> "Generá el VSR para DRP-GAMP Categorizador™. Ciclo completo cerrado: 17 documentos en el paquete DRP-SIS-001, período Marzo–Mayo 2026. 70 TCs ejecutados en las 3 fases, 100% cobertura, 69 PASS + 1 OBS. 2 NCs identificadas en OQ (NC-001 OBS, NC-002 crítica) — ambas cerradas vía NCR. Fases cerradas: IQ 20/03, OQ 26/04, PQ 15/05. Decisión global: SISTEMA VALIDADO. Firman FB Sponsor, LS Director Técnico, FB Gerente QA, LS Process Owner, el 20/05/2026. Validez hasta 20/05/2027."

El skill genera el VSR con banner SISTEMA VALIDADO + statsResumen (17 docs, 70 TCs, 100%, 2 NCs), inventario de los 17 docs agrupados por fase, resumen ejecutivo consolidado, cronología timeline de las 4 fases cerradas, los 2 hallazgos consolidados en estado CERRADO, decisión formal con validez anual, y las 4 firmas ejecutivas pobladas.
