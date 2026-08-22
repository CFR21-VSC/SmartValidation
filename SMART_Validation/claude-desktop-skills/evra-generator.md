---
name: evra-generator
description: Genera el JSON de un EVRA (Evaluación de Riesgo de Planilla de Cálculo) bajo GAMP 5 Segunda Edición. Usar cuando el usuario necesita validar una planilla Excel GxP y ya tiene el análisis estructural de la planilla (hojas, fórmulas, propósito). El JSON resultante es input directo del renderer EVRA — sin Markdown, sin texto fuera del objeto JSON.
---

# EVRA Generator — Validación de Planillas GxP

Generador del documento **EVRA (Evaluación de Riesgo de Planilla de Cálculo)** según GAMP 5 Segunda Edición y ANMAT Disposición 4159/2023 Anexo VI.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes de formato.

## Cuándo usar este skill

- El usuario tiene una planilla Excel usada en actividades GxP (cálculos de lote, liberación, calibración, OOS, análisis, etc.)
- Dispone del análisis estructural (hojas, cantidad de fórmulas, propósito por hoja, presencia de VBA/vínculos externos)
- Es el **primer documento** del ciclo de validación de planillas (EVRA → EVPROT → EVIR)

## Clasificación GAMP 5 para planillas

| Categoría | Descripción | Requiere validación |
|-----------|-------------|---------------------|
| Cat 1 | Infraestructura (Excel como software de oficina) | No |
| Cat 3 | No configurada — uso estándar sin macros ni fórmulas críticas | Verificación básica |
| **Cat 4** | Configurada — fórmulas, macros VBA, formatos específicos GxP | **Sí — EVRA + EVPROT + EVIR** |

La mayoría de las planillas GxP caen en **Categoría 4**.

## Categorías de riesgo típicas para planillas

Para el campo `categoria` en cada riesgo, usar alguno de estos:
- **Integridad de fórmulas** — error o modificación accidental de fórmulas críticas
- **Control de acceso** — modificación no autorizada de datos o fórmulas
- **Control de versión** — uso de versión incorrecta de la planilla
- **Integridad de datos de entrada** — ingreso de datos fuera de rango o tipo incorrecto
- **Vínculos externos** — dependencia de archivos externos no controlados
- **Macros VBA** — ejecución de código no validado
- **Portabilidad** — comportamiento diferente en distintas versiones de Excel
- **Trazabilidad** — falta de registro de quién y cuándo llenó la planilla

## Escala de riesgo (Probabilidad × Severidad)

| | Baja severidad | Media severidad | Alta severidad |
|--|--|--|--|
| **Alta probabilidad** | Medio | Alto | Alto |
| **Media probabilidad** | Bajo | Medio | Alto |
| **Baja probabilidad** | Bajo | Bajo | Medio |

Valores para `probabilidad` y `severidad`: "Baja", "Media", "Alta"
Valores para `riesgoInherente` y `riesgoResidual`: "Bajo", "Medio", "Alto"

## Output esperado

**Un único objeto JSON** sin texto fuera del objeto.

## Estructura del JSON EVRA

```json
{
  "package": {
    "code": "PKG-XXX",
    "client": "Nombre del cliente"
  },
  "document": {
    "titleEs": "Evaluación de Riesgo — Planilla [Nombre]",
    "version": "1.0",
    "status": "draft",
    "issueDate": "YYYY-MM-DD"
  },
  "spreadsheet": {
    "fileName": "nombre-planilla.xlsx",
    "purpose": "Descripción del propósito GxP de la planilla",
    "gampCategory": "Cat 4",
    "department": "Departamento responsable",
    "responsible": "Cargo del responsable",
    "frequency": "Frecuencia de uso (ej: Por lote, Diario, Mensual)",
    "version": "v1.0",
    "location": "Ruta o ubicación del archivo",
    "sheets": [
      {
        "name": "NombreHoja",
        "purpose": "Propósito de la hoja",
        "formulaCount": 0,
        "isCritical": false
      }
    ],
    "hasVBA": false,
    "hasExternalLinks": false,
    "hasProtection": false
  },
  "secciones": [
    {
      "numero": "1",
      "titulo": "PROPÓSITO Y ALCANCE",
      "tipo": "texto",
      "contenido": "Párrafo describiendo propósito regulatorio de la evaluación y alcance (qué planilla, qué versión, qué usos GxP cubre)."
    },
    {
      "numero": "2",
      "titulo": "CLASIFICACIÓN GxP",
      "tipo": "tabla-info",
      "items": [
        { "label": "Nombre del archivo", "valor": "nombre-planilla.xlsx" },
        { "label": "Categoría GAMP 5", "valor": "Categoría 4 — Herramienta configurada" },
        { "label": "Impacto GxP", "valor": "Directo / Indirecto — descripción breve" },
        { "label": "Departamento responsable", "valor": "..." },
        { "label": "Frecuencia de uso", "valor": "..." },
        { "label": "Versión evaluada", "valor": "v1.0" },
        { "label": "Responsable de uso", "valor": "..." }
      ]
    },
    {
      "numero": "3",
      "titulo": "ESTRUCTURA DE LA PLANILLA",
      "tipo": "tabla",
      "columnas": ["Hoja", "Propósito", "Fórmulas", "Crítica GxP"],
      "filas": [
        ["NombreHoja", "Propósito de la hoja", "0", "No"]
      ]
    },
    {
      "numero": "4",
      "titulo": "METODOLOGÍA DE EVALUACIÓN DE RIESGO",
      "tipo": "texto",
      "contenido": "Se aplica matriz Probabilidad × Severidad de 3 niveles (Baja/Media/Alta). El riesgo inherente se calcula sin controles. El riesgo residual considera los controles propuestos. Un riesgo residual ALTO requiere controles adicionales antes de aprobar el uso GxP."
    },
    {
      "numero": "5",
      "titulo": "EVALUACIÓN DE RIESGOS",
      "tipo": "tabla-riesgos",
      "riesgos": [
        {
          "id": "R-001",
          "categoria": "Integridad de fórmulas",
          "descripcion": "Descripción clara del riesgo",
          "causa": "Causa raíz del riesgo",
          "efectoGxP": "Impacto en calidad, seguridad del paciente o integridad de datos",
          "probabilidad": "Media",
          "severidad": "Alta",
          "riesgoInherente": "Alto",
          "control": "Control propuesto para mitigar el riesgo",
          "riesgoResidual": "Bajo"
        }
      ]
    },
    {
      "numero": "6",
      "titulo": "CONCLUSIÓN",
      "tipo": "caja-conclusion",
      "contenido": "Párrafo de conclusión indicando el nivel de riesgo general, si la planilla es APTA para uso GxP con los controles implementados, y referencia al EVPROT donde se documentan los casos de prueba."
    }
  ]
}
```

## Reglas de calidad GxP para riesgos

1. **Mínimo 5 riesgos** para planillas Cat 4 con fórmulas críticas. Cubrir al menos: integridad de fórmulas, control de acceso, control de versión, integridad de datos de entrada, y uno específico del contexto.
2. **Si `hasVBA: true`**: agregar riesgo de Macros VBA obligatoriamente.
3. **Si `hasExternalLinks: true`**: agregar riesgo de Vínculos externos.
4. **Si `hasProtection: false`**: el control de "protección de hojas" es prioritario y el riesgo de Integridad de fórmulas tiene probabilidad Alta.
5. El `efectoGxP` debe describir el impacto real en términos regulatorios: "decisión incorrecta sobre aceptación del lote", "riesgo para la seguridad del paciente", "dato incorrecto en registro de lote", etc.
6. **No usar riesgoResidual: "Alto"** sin justificación explícita de por qué no se puede mitigar más.
