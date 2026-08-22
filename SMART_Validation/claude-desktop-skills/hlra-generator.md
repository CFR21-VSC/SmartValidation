---
name: hlra-generator
description: Genera el JSON de un documento HLRA (Análisis de Calificación y Criticidad GxP) para la Validation Suite de DRP. Usar cuando el usuario provee información sobre un sistema computarizado a categorizar (manual, URS, descripción del sistema, etc.) y necesita el documento HLRA listo para importar en la Suite. El JSON resultante es input directo del renderer HLRA — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# HLRA Generator — Validation Suite

Generador del documento **HLRA (High Level Risk Assessment)** según GAMP 5 Segunda Edición, ANMAT 4159/2023 Anexo VI e ICH Q9, para uso con la Validation Suite de DRP Assurance.

## Cuándo usar este skill

- El usuario provee información de un sistema computarizado y pide "generar el HLRA" o "categorización GAMP".
- Inputs típicos:
  - Manual de usuario del sistema
  - URS o documento de requerimientos
  - Descripción funcional + arquitectura
  - Datos del cliente y del sistema

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin ningún texto fuera del JSON. El usuario lo va a copiar/pegar y cargar directamente.

## Schema del JSON HLRA

```json
{
  "schemaVersion": "1.0",
  "type": "HLRA",
  "package": {
    "code": "<CODIGO-INVENTARIO>",
    "systemName": "<NOMBRE_SISTEMA>",
    "systemVersion": "<VERSION>",
    "systemSubtitle": "<SUBTITULO_OPCIONAL>",
    "client": "<EMPRESA>",
    "vendor": "<PROVEEDOR>",
    "qmsLabel": "Sistema de Gestión de Calidad GxP",
    "normativeFramework": "ANMAT 4159/2023 | 21 CFR Part 11 | EU Annex 11 | ICH Q9",
    "year": <AÑO>
  },
  "document": {
    "code": "HLRA-<CODIGO-INVENTARIO>",
    "titleEs": "ANÁLISIS DE CALIFICACIÓN Y CRITICIDAD GxP",
    "titleEn": "QUALIFICATION AND GxP CRITICALITY ASSESSMENT (HLRA)",
    "headerTitle": "Análisis de Calificación y Criticidad GxP",
    "version": "<X.Y>",
    "issueDate": "<YYYY-MM-DD o 'Mes YYYY'>",
    "status": "Aprobado | Borrador | En revisión",
    "processOwner": "<NOMBRE>",
    "gampCategory": "GAMP <N> — <Descripción>",
    "normativeFramework": "<Marco normativo aplicable>"
  },
  "controlCambios": [
    { "version": "1.0", "fecha": "<fecha>", "autor": "<nombre>", "descripcion": "Versión inicial" }
  ],
  "matrizAprobaciones": [
    { "rol": "Redactor (Validador)", "nombre": "<nombre>", "iniciales": "<XX>", "fecha": "<fecha>" },
    { "rol": "Revisor (Process Owner)", "nombre": "<nombre>", "iniciales": "<XX>", "fecha": "<fecha>" },
    { "rol": "Aprobador (Jefe de Validaciones)", "nombre": "<nombre>", "iniciales": "<XX>", "fecha": "<fecha>" },
    { "rol": "Aprobador (Gerente QA)", "nombre": "<nombre>", "iniciales": "<XX>", "fecha": "<fecha>" }
  ],
  "trazabilidad": {
    "recibeDe": [],
    "alimentaA": ["VP", "URS", "RA", "IRA", "RRM", "MTR"]
  },
  "secciones": [ ... ]
}
```

## Secciones obligatorias del HLRA (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)
Define para qué se hace este HLRA. **Siempre 4-6 líneas justificadas.**

```json
{
  "tipo": "texto",
  "titulo": "PROPÓSITO",
  "bloques": [
    { "texto": "El presente documento constituye el Análisis de Calificación y Criticidad GxP del sistema <NOMBRE>... [propósito específico, marco normativo aplicable]" }
  ]
}
```

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

```json
{
  "tipo": "lista-incluido-excluido",
  "titulo": "ALCANCE",
  "subIncluido": "2.1 Incluido en el análisis",
  "incluido": [
    "Sistema: <nombre> versión <X>",
    "URL/Acceso: ...",
    "Funcionalidades: ...",
    "Roles de usuario: ...",
    "Marco normativo: ..."
  ],
  "subExcluido": "2.2 Excluido del análisis",
  "excluido": [
    "Infraestructura cloud subyacente — cubierta por otro proceso",
    "Código fuente y desarrollo interno (perspectiva del vendor)",
    "..."
  ]
}
```

### 3. RESPONSABILIDADES (`tipo: "tabla"`)

```json
{
  "tipo": "tabla",
  "titulo": "RESPONSABILIDADES",
  "columnas": ["Rol", "Responsabilidad"],
  "widths": [200, 255],
  "filas": [
    ["Equipo de Validaciones (DRP)", "Redactar y mantener este HLRA"],
    ["Process Owner", "Revisar y aprobar la categorización GAMP"],
    ["QA / Gerente de Calidad", "Aprobar el documento"],
    ["IT / Administrador del Sistema", "Proveer información técnica"]
  ]
}
```

### 4. DEFINICIONES (`tipo: "tabla"`)

```json
{
  "tipo": "tabla",
  "titulo": "DEFINICIONES",
  "columnas": ["Término", "Definición"],
  "widths": [80, 375],
  "filas": [
    ["GAMP 5", "Good Automated Manufacturing Practice — Guía de validación..."],
    ["HLRA", "High Level Risk Assessment — Análisis de criticidad..."],
    ["IRO", "Índice de Riesgo Operativo — calculado mediante fórmula multidimensional"],
    ["GAMP <N>", "<descripción de la categoría>"],
    ["GxP", "Conjunto de regulaciones de buenas prácticas..."],
    ["GAP", "Brecha regulatoria que requiere control compensatorio"]
  ]
}
```

### 5. DESCRIPCIÓN DEL SISTEMA (`tipo: "tabla-info"`)

```json
{
  "tipo": "tabla-info",
  "titulo": "DESCRIPCIÓN DEL SISTEMA",
  "filas": [
    { "campo": "Nombre Comercial", "valor": "<...>" },
    { "campo": "Código de Inventario", "valor": "<...>" },
    { "campo": "Vendor / Proveedor", "valor": "<...>" },
    { "campo": "Versión Validada", "valor": "<...>" },
    { "campo": "Tipo de Sistema", "valor": "<...>" },
    { "campo": "URL de Acceso", "valor": "<...>" },
    { "campo": "Hosting", "valor": "<...>" },
    { "campo": "Disponibilidad SLA", "valor": "<...>" },
    { "campo": "Estado", "valor": "<...>" }
  ]
}
```

### 6. CATEGORIZACIÓN GAMP (`tipo: "arbol-decision-gamp"`)

Árbol de decisión GAMP 5 — última pregunta es la conclusión.

```json
{
  "tipo": "arbol-decision-gamp",
  "titulo": "CATEGORIZACIÓN GAMP",
  "intro": "<contexto de cómo se aplicó el árbol de decisión>",
  "preguntas": [
    { "pregunta": "¿Es infraestructura base (SO, BD, red)?", "respuesta": "No → Descarta GAMP 1" },
    { "pregunta": "¿Es software comercial estándar (COTS)?", "respuesta": "Sí — SaaS provisto por vendor" },
    { "pregunta": "¿El usuario puede realizar configuración GxP significativa?", "respuesta": "No → no hay configuración" },
    { "pregunta": "¿Conclusión?", "respuesta": "GAMP 3 — Software Estándar Comercial" }
  ]
}
```

### 7. CATEGORÍA DETERMINADA (`tipo: "caja-resultado"`)

```json
{
  "tipo": "caja-resultado",
  "titulo": "GAMP <N> — <Descripción corta>",
  "subtitulo": "<Justificación en una línea>",
  "icono": "✓",
  "color": "primary"
}
```

### 8. IMPLICACIONES PARA LA VALIDACIÓN (`tipo: "tabla-docs-aplicables"`)

**REGLA CRÍTICA — TRÍADA INSEPARABLE**: Los documentos de calificación viajan siempre en ternas:
- **IQ**: PIQ (Protocolo) → IIQ (Informe de ejecución) → RIQ (Reporte de Decisión)
- **OQ**: POQ (Protocolo) → IOQ (Informe de ejecución) → ROQ (Reporte de Decisión)
- **PQ**: PPQ (Protocolo) → IPQ (Informe de ejecución) → RPQ (Reporte de Decisión)

Si el Protocolo es `"Obligatorio"`, el Informe y el Reporte también son `"Obligatorio"`. Nunca marcar solo el Protocolo y omitir los otros dos. Si el Protocolo es `"No aplica"`, los tres son `"No aplica"`.

**La tabla debe contener SIEMPRE los 20 documentos**, en este orden exacto. Valores permitidos para `estado`: `"Obligatorio"`, `"No aplica"`, `"Opcional"`.

```json
{
  "tipo": "tabla-docs-aplicables",
  "titulo": "Implicaciones para la Validación",
  "intro": "<contexto de qué docs son obligatorios para esta categoría GAMP y por qué>",
  "filas": [
    { "documento": "HLRA",                         "estado": "Obligatorio",                        "aplicacion": "Este documento — base de la estrategia de validación" },
    { "documento": "VP — Validation Plan",         "estado": "Obligatorio",                        "aplicacion": "A generar a partir de este HLRA" },
    { "documento": "URS",                          "estado": "Obligatorio",                        "aplicacion": "Base de todos los requisitos del paquete" },
    { "documento": "FRS",                          "estado": "<GAMP 3: No aplica | GAMP 4: Obligatorio | GAMP 5: Obligatorio>", "aplicacion": "<GAMP 3: COTS sin configuración GxP significativa | GAMP 4/5: requerido>" },
    { "documento": "DS — Design Specification",    "estado": "<GAMP 3: No aplica | GAMP 4: Opcional | GAMP 5: Obligatorio>",   "aplicacion": "<GAMP 5: diseño custom | GAMP 4: si hay configuración técnica documentable>" },
    { "documento": "RA — Risk Assessment",         "estado": "Obligatorio",                        "aplicacion": "Análisis FMEA operativo S×P×D para riesgos funcionales" },
    { "documento": "IRA — Infrastructure Risk Assessment", "estado": "<Cloud/Híbrido: Obligatorio | On-premise simple: Opcional>", "aplicacion": "Riesgo de componentes de infraestructura (SW, INF, SEC)" },
    { "documento": "RRM — Risk Register Matrix",   "estado": "Obligatorio",                        "aplicacion": "Mapeo norma ↔ URS ↔ RA — cumplimiento normativo" },
    { "documento": "MTR — Master Traceability Report", "estado": "Obligatorio",                   "aplicacion": "Trazabilidad URS→RA→TC — cierra la cadena documental" },
    { "documento": "PIQ — Protocolo IQ",           "estado": "Obligatorio",                        "aplicacion": "Define TC-IQ (test cases de instalación y verificación de componentes)" },
    { "documento": "IIQ — Informe IQ",             "estado": "Obligatorio",                        "aplicacion": "Registra ejecución del PIQ con evidencias y resultados por TC" },
    { "documento": "RIQ — Reporte Decisión IQ",    "estado": "Obligatorio",                        "aplicacion": "Dictamen formal de cierre fase IQ — NCs gestionadas + decisión" },
    { "documento": "POQ — Protocolo OQ",           "estado": "Obligatorio",                        "aplicacion": "Define TC-OQ (test cases operacionales de funciones críticas GxP)" },
    { "documento": "IOQ — Informe OQ",             "estado": "Obligatorio",                        "aplicacion": "Registra ejecución del POQ con evidencias y resultados por TC" },
    { "documento": "ROQ — Reporte Decisión OQ",    "estado": "Obligatorio",                        "aplicacion": "Dictamen formal de cierre fase OQ — NCs gestionadas + decisión" },
    { "documento": "PPQ — Protocolo PQ",           "estado": "<GAMP 3 sin KPIs GxP: No aplica | GAMP 4 con métricas: Opcional | GAMP 5: Obligatorio>", "aplicacion": "<justificación según GAMP y existencia de KPIs de performance GxP>" },
    { "documento": "IPQ — Informe PQ",             "estado": "<igual que PPQ>",                    "aplicacion": "Aplica solo si PPQ aplica — registra ejecución del PPQ" },
    { "documento": "RPQ — Reporte Decisión PQ",    "estado": "<igual que PPQ>",                    "aplicacion": "Aplica solo si PPQ aplica — dictamen de cierre fase PQ" },
    { "documento": "NCR — Non-Conformance Reports","estado": "Obligatorio",                        "aplicacion": "Gestión de NCs detectadas en IIQ/IOQ/IPQ — 4 etapas CAPA" },
    { "documento": "VSR — Validation Summary Report","estado": "Obligatorio",                      "aplicacion": "Cierre del ciclo — dictamen final de validación del sistema" }
  ]
}
```

### 9. ANÁLISIS DE CRITICIDAD OPERATIVA (`tipo: "formula-rai"`)

**Importante: usar IRO, no RAI.**

```json
{
  "tipo": "formula-rai",
  "titulo": "ANÁLISIS DE CRITICIDAD OPERATIVA",
  "intro": "El Índice de Riesgo Operativo (IRO) se calcula mediante la siguiente fórmula multidimensional...",
  "formula": "IRO = P × G × D × I × PR × S",
  "factores": [
    { "var": "P",  "factor": "Proceso",   "descripcion": "<...>", "escala": "1-3", "valor": <1|2|3> },
    { "var": "G",  "factor": "GAMP",      "descripcion": "<...>", "escala": "1-3", "valor": <1|2|3> },
    { "var": "D",  "factor": "Dato GxP",  "descripcion": "<...>", "escala": "1-3", "valor": <1|2|3> },
    { "var": "I",  "factor": "Impacto",   "descripcion": "<...>", "escala": "1-3", "valor": <1|2|3> },
    { "var": "PR", "factor": "Proveedor", "descripcion": "<...>", "escala": "1-3", "valor": <1|2|3> },
    { "var": "S",  "factor": "Servicio",  "descripcion": "<...>", "escala": "1-3", "valor": <1|2|3> }
  ]
}
```

**Cálculo del IRO**: multiplicación directa de los 6 valores. Rangos:
- 1-50 = **BAJO**
- 51-200 = **BAJO-MEDIO** o **MEDIO**
- 201-486 = **ALTO**

### 10. RESULTADO IRO (`tipo: "box-resultado-rai"`)

```json
{
  "tipo": "box-resultado-rai",
  "titulo": "Resultado IRO",
  "labelCalculo": "IRO CALCULADO",
  "calculo": "<P> × <G> × <D> × <I> × <PR> × <S> = <RESULTADO>",
  "nivel": "BAJO | BAJO-MEDIO | MEDIO | ALTO",
  "rangos": "Rango: 1-50 = Bajo | 51-200 = Bajo-Medio / Medio | 201-486 = Alto"
}
```

### 11. PROCESOS GxP IMPACTADOS (`tipo: "tabla"`)

> **Nota de scope**: esta sección identifica los procesos GxP afectados a alto nivel (máx. 5-7 filas). El análisis detallado de riesgos (fila a fila con S/P/D/RR) corresponde al **RA**. No duplicar aquí lo que va en RA.

```json
{
  "tipo": "tabla",
  "titulo": "PROCESOS GxP IMPACTADOS",
  "columnas": ["Proceso GxP", "Función del sistema", "Criticidad"],
  "widths": [150, 205, 100],
  "filas": [
    ["<Proceso>", "<Cómo el sistema lo impacta>", "Alta | Media | Baja"]
  ]
}
```

### 12. FUNCIONES CRÍTICAS GxP (`tipo: "tabla"`)

> **Nota de scope**: listar las funciones críticas a nivel de nombre + criticidad (máx. 8-10 filas). Los test cases de verificación detallados (pasos, criterios de aceptación, evidencias) van en **PIQ** / **POQ**. No escribir aquí procedimientos de testing.

Header `"Verif. OQ"` (corto).

```json
{
  "tipo": "tabla",
  "titulo": "FUNCIONES CRÍTICAS GxP",
  "columnas": ["Función", "Impacto GxP", "Criticidad", "Verif. OQ"],
  "widths": [125, 195, 70, 65],
  "filas": [
    ["<función>", "<impacto>", "Crítica | Alta | Media", "Sí | No"]
  ]
}
```

### 13. HALLAZGOS Y BRECHAS (opcional — `tipo: "tarjeta-gap"`)

**Solo incluir si efectivamente hay GAPs**. Una tarjeta por GAP. Severidades: `"menor"`, `"mayor"`, `"critico"`, `"info"`.

```json
{
  "tipo": "tarjeta-gap",
  "id": "GAP-001",
  "titulo": "<título corto del GAP>",
  "severidad": "menor",
  "severidadLabel": "NC Menor",
  "norma": "ANMAT 4159/2023 Punto X",
  "descripcion": "<qué se detectó>",
  "control": "<control compensatorio aplicado>",
  "impacto": "<evaluación del impacto>",
  "aceptacion": "<si requiere aceptación formal>"
}
```

### 14. ESTRATEGIA DE VALIDACIÓN (`tipo: "texto"` con bloques)

```json
{
  "tipo": "texto",
  "titulo": "ESTRATEGIA DE VALIDACIÓN",
  "bloques": [
    {
      "subtitulo": "Enfoque General",
      "texto": "<contexto del enfoque>",
      "bullets": [
        "Confianza en el testing del vendor para funciones estándar",
        "Verificación funcional de las funciones críticas GxP",
        "Documentación de GAPs y controles compensatorios",
        "Testing basado en riesgo"
      ]
    }
  ]
}
```

### 15. DOCUMENTOS DE LA VALIDACIÓN (`tipo: "tabla"`)

Lista los documentos que se generarán en el proceso. **INCLUIR SIEMPRE las 20 filas**. Omitir solo los documentos con `estado: "No aplica"` en la sección 8. No usar `...`.

```json
{
  "tipo": "tabla",
  "titulo": "Documentos de la Validación",
  "columnas": ["#", "Código", "Documento", "Responsable"],
  "widths": [25, 110, 200, 120],
  "filas": [
    ["1",  "HLRA-<CODE>", "High Level Risk Assessment",              "<nombre>"],
    ["2",  "VP-<CODE>",   "Plan de Validación",                      "<nombre>"],
    ["3",  "URS-<CODE>",  "User Requirements Specification",         "<nombre>"],
    ["4",  "FRS-<CODE>",  "Functional Requirements Specification",   "<nombre>"],
    ["5",  "DS-<CODE>",   "Design Specification",                    "<nombre>"],
    ["6",  "RA-<CODE>",   "Risk Assessment",                         "<nombre>"],
    ["7",  "IRA-<CODE>",  "Infrastructure Risk Assessment",          "<nombre>"],
    ["8",  "RRM-<CODE>",  "Risk Register Matrix",                    "<nombre>"],
    ["9",  "MTR-<CODE>",  "Master Traceability Report",              "<nombre>"],
    ["10", "PIQ-<CODE>",  "Protocolo de Calificación de Instalación","<nombre>"],
    ["11", "IIQ-<CODE>",  "Informe de Calificación de Instalación",  "<nombre>"],
    ["12", "RIQ-<CODE>",  "Reporte de Decisión IQ",                  "<nombre>"],
    ["13", "POQ-<CODE>",  "Protocolo de Calificación Operacional",   "<nombre>"],
    ["14", "IOQ-<CODE>",  "Informe de Calificación Operacional",     "<nombre>"],
    ["15", "ROQ-<CODE>",  "Reporte de Decisión OQ",                  "<nombre>"],
    ["16", "PPQ-<CODE>",  "Protocolo de Calificación de Performance","<nombre>"],
    ["17", "IPQ-<CODE>",  "Informe de Calificación de Performance",  "<nombre>"],
    ["18", "RPQ-<CODE>",  "Reporte de Decisión PQ",                  "<nombre>"],
    ["19", "NCR-<CODE>",  "Non-Conformance Reports",                 "<nombre>"],
    ["20", "VSR-<CODE>",  "Validation Summary Report",               "<nombre>"]
  ]
}
```

### 16. CONCLUSIÓN (`tipo: "caja-conclusion"`)

```json
{
  "tipo": "caja-conclusion",
  "titulo": "CONCLUSIÓN",
  "parrafos": [
    "<Párrafo 1: Confirmación de la categoría GAMP determinada>",
    "<Párrafo 2: IRO calculado y nivel de riesgo>",
    "<Párrafo 3: GAPs identificados y conclusión sobre la viabilidad de continuar>"
  ]
}
```

### 17. REFERENCIAS (`tipo: "tabla"`)

```json
{
  "tipo": "tabla",
  "titulo": "REFERENCIAS",
  "columnas": ["Código / Referencia", "Título"],
  "widths": [180, 275],
  "filas": [
    ["MAN-XXX-001 v1.0", "Manual de Usuario — <sistema>"],
    ["SOP-XXX-001 v1.0", "Procedimiento de Uso — <sistema>"],
    ["ANMAT 4159/2023 Anexo VI", "Guía de Buenas Prácticas de Sistemas Informatizados"],
    ["GAMP 5 — 2da Ed. 2022", "Risk-Based Approach to Compliant GxP Computerized Systems (ISPE)"],
    ["ICH Q9 R1 (2023)", "Quality Risk Management"],
    ["21 CFR Part 11", "Electronic Records; Electronic Signatures (FDA)"],
    ["EU Annex 11", "Computerised Systems (EMA, revisión 2011)"]
  ]
}
```

### 18. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`)

Siempre incluir, al final del documento.

```json
{
  "tipo": "tabla-firmas-final",
  "titulo": "FIRMAS DE EJECUCIÓN",
  "intro": "Las firmas digitales o electrónicas siguientes evidencian la revisión y aprobación formal de este documento. La trazabilidad legal queda registrada en el log adjunto al paquete de validación.",
  "firmas": [],
  "rolesPlaceholder": [
    "Ejecutor (Validador)",
    "Revisor (Process Owner)",
    "Aprobador (Jefe de Validaciones)",
    "Aprobador (Gerente QA)"
  ],
  "nota": "Documento sujeto a firma electrónica. La firma manuscrita en este recuadro solo aplica como respaldo físico cuando no es viable la firma digital."
}
```

---

## Reglas de contenido

### Categorización GAMP — guía rápida

| Categoría | Descripción | Cuándo aplica |
|---|---|---|
| **GAMP 1** | Infraestructura | SO, BD, antivirus, redes — no se valida funcionalmente |
| **GAMP 3** | COTS no configurado | Software comercial usado tal cual, sin configuración GxP |
| **GAMP 4** | COTS configurado | Software comercial con parámetros configurados (workflows, campos) |
| **GAMP 5** | Custom / desarrollo a medida | Sistemas únicos desarrollados a la medida del cliente |

### Matriz de documentos obligatorios por categoría GAMP

Esta tabla **es la fuente de verdad** para completar la sección 8. Usarla directamente — no inferir de memoria.

| Documento | GAMP 3 | GAMP 4 | GAMP 5 | Nota |
|---|---|---|---|---|
| HLRA | Obligatorio | Obligatorio | Obligatorio | Siempre |
| VP | Obligatorio | Obligatorio | Obligatorio | Siempre |
| URS | Obligatorio | Obligatorio | Obligatorio | Siempre |
| FRS | No aplica | Obligatorio | Obligatorio | GAMP 3: COTS estándar no requiere FRS |
| DS | No aplica | Opcional | Obligatorio | GAMP 4: solo si hay diseño técnico documentable |
| RA | Obligatorio | Obligatorio | Obligatorio | Siempre |
| IRA | Obligatorio | Obligatorio | Obligatorio | Siempre — ajustar alcance según cloud/on-premise |
| RRM | Obligatorio | Obligatorio | Obligatorio | Siempre |
| MTR | Obligatorio | Obligatorio | Obligatorio | Siempre |
| **PIQ** | **Obligatorio** | **Obligatorio** | **Obligatorio** | Protocolo IQ — siempre |
| **IIQ** | **Obligatorio** | **Obligatorio** | **Obligatorio** | Informe IQ — inseparable de PIQ |
| **RIQ** | **Obligatorio** | **Obligatorio** | **Obligatorio** | Reporte Decisión IQ — inseparable de PIQ |
| **POQ** | **Obligatorio** | **Obligatorio** | **Obligatorio** | Protocolo OQ — siempre |
| **IOQ** | **Obligatorio** | **Obligatorio** | **Obligatorio** | Informe OQ — inseparable de POQ |
| **ROQ** | **Obligatorio** | **Obligatorio** | **Obligatorio** | Reporte Decisión OQ — inseparable de POQ |
| PPQ | No aplica | Opcional | Obligatorio | Solo si hay KPIs GxP de performance |
| IPQ | No aplica | Opcional | Obligatorio | Igual que PPQ — inseparable |
| RPQ | No aplica | Opcional | Obligatorio | Igual que PPQ — inseparable |
| NCR | Obligatorio | Obligatorio | Obligatorio | Siempre |
| VSR | Obligatorio | Obligatorio | Obligatorio | Siempre |

**Regla GAMP 3 PQ**: si el sistema GAMP 3 no tiene métricas de performance con impacto GxP (throughput, tiempos de respuesta bajo carga, etc.), PPQ/IPQ/RPQ son `"No aplica"`. Si las tiene, son `"Opcional"`.

**Regla GAMP 4 FRS**: siempre Obligatorio para GAMP 4 — aunque sea un FRS abstracto de 2 páginas. No marcarlo como No aplica.

**Regla universal de la tríada de calificación**:
- IQ siempre va completo: PIQ + IIQ + RIQ (los tres Obligatorio)
- OQ siempre va completo: POQ + IOQ + ROQ (los tres Obligatorio)
- PQ va completo o no va: PPQ + IPQ + RPQ (los tres con el mismo estado)

### Cálculo del IRO — escalas (1-3 cada factor)

| Factor | Valor 1 (Bajo) | Valor 2 (Medio) | Valor 3 (Alto) |
|---|---|---|---|
| **P** Proceso | Sin impacto en proceso GxP | Impacto indirecto (apoyo) | Impacto directo en proceso productivo |
| **G** GAMP | Cat. 1 | Cat. 3-4 | Cat. 5 |
| **D** Dato GxP | Sin datos GxP | Datos auditables (reportes) | Datos críticos para decisiones GxP |
| **I** Impacto | Sin impacto en producto | Impacto en decisiones | Impacto directo en calidad/seguridad |
| **PR** Proveedor | Vendor con QMS y soporte | Vendor conocido | Sin vendor / desarrollo interno |
| **S** Servicio | Manual + SOPs disponibles | Documentación parcial | Sin documentación |

### Marco normativo típico (Argentina)

Para sistemas en mercado argentino con compliance internacional:
```
"normativeFramework": "ANMAT 4159/2023 Anexo VI | ICH Q9 | GAMP 5 | 21 CFR Part 11 | EU GMP Annex 11"
```

Si solo es local: `"ANMAT 4159/2023 Anexo VI | ICH Q9 | GAMP 5"`

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **No inventar normas, artículos o estándares**. Si no estás seguro, omitir.
3. **No inventar nombres de personas**. Si el usuario no los provee, dejar `"nombre": ""`.
4. **No inventar GAPs ni NCs.** Solo incluir tarjetas-gap si el usuario menciona inconsistencias o gaps verificables.
5. **Anchos de tabla siempre suman 455 cuando se especifican.** Esto incluye los `widths` en `tipo: "tabla"`.
6. **No usar siglas inconsistentes**: siempre IRO (no RAI) para el índice de riesgo operativo.
7. **Status del documento** debe ser uno de: `"Borrador"`, `"En revisión"`, `"Aprobado"`.
8. **`type: "HLRA"` siempre en mayúsculas.**
9. **La sección 8 SIEMPRE contiene los 20 documentos**, en el orden de la matriz de gobernanza. No acortar con `...`. No omitir ningún documento.
10. **Tríada de calificación inseparable**: si PIQ es Obligatorio → IIQ y RIQ también son Obligatorio. Si POQ es Obligatorio → IOQ y ROQ también. Si PPQ es No aplica → IPQ y RPQ también. Nunca marcar solo el Protocolo sin los correspondientes Informe y Reporte.
11. **Siglas canónicas en filas de la sección 8**: usar exactamente `PIQ`, `IIQ`, `RIQ`, `POQ`, `IOQ`, `ROQ`, `PPQ`, `IPQ`, `RPQ`, `NCR`, `VSR`. No usar nombres alternativos ni legacy.

---

## Ejemplo de input → output

### Input del usuario:
> "Genera el HLRA para CalQR — un sistema web SaaS de DRP Assurance que valida códigos QR sanitarios. Es categoría GAMP 4 con configuración del cliente. Inventario CALQR-2026-001. Vendor DRP. Process Owner: Juan Pérez. Cliente: Laboratorios MediCorp."

### Output esperado:
```json
{
  "schemaVersion": "1.0",
  "type": "HLRA",
  "package": {
    "code": "CALQR-2026-001",
    "systemName": "CalQR",
    "systemVersion": "v1.0",
    "systemSubtitle": "Sistema de Validación de Códigos QR Sanitarios",
    "client": "Laboratorios MediCorp",
    "qmsLabel": "Sistema de Gestión de Calidad GxP",
    "year": 2026
  },
  "document": {
    "code": "HLRA-CALQR-2026-001",
    "titleEs": "ANÁLISIS DE CALIFICACIÓN Y CRITICIDAD GxP",
    "titleEn": "QUALIFICATION AND GxP CRITICALITY ASSESSMENT (HLRA)",
    "headerTitle": "Análisis de Calificación y Criticidad GxP",
    "version": "1.0",
    "issueDate": "...",
    "status": "Borrador",
    "processOwner": "Juan Pérez",
    "gampCategory": "GAMP 4 — Configurado",
    "normativeFramework": "ANMAT 4159/2023 Anexo VI | ICH Q9 | GAMP 5"
  },
  ...
}
```
