---
name: evir-generator
description: Genera el JSON de un EVIR (Informe de Validación de Planilla de Cálculo) bajo GAMP 5. Usar cuando el EVPROT fue ejecutado y se tienen los resultados reales de cada caso de prueba. El JSON resultante es input directo del renderer EVIR.
---

# EVIR Generator — Informe de Validación de Planilla

Generador del documento **EVIR (Informe de Validación de Planilla de Cálculo)** según GAMP 5 Segunda Edición.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes de formato.

## Cuándo usar este skill

- El EVPROT fue ejecutado y los campos `resultadoReal` y `resultado` de cada TC están completados
- Se necesita consolidar los resultados en un informe formal que concluye si la planilla queda APROBADA
- Es el **documento de cierre** del ciclo EVRA → EVPROT → EVIR

## Estado de validación posibles

- **APROBADA**: 100% de TCs resultaron PASA. La planilla puede usarse en actividades GxP.
- **APROBADA CON RESTRICCIONES**: Algunos TCs fallaron pero se documentaron acciones correctivas aceptadas por QA. Uso condicional.
- **NO APROBADA**: Fallas no resueltas. La planilla no puede usarse en actividades GxP hasta resolución.

## Output esperado

**Un único objeto JSON** sin texto fuera del objeto.

## Estructura del JSON EVIR

```json
{
  "package": {
    "code": "PKG-XXX",
    "client": "Nombre del cliente"
  },
  "document": {
    "titleEs": "Informe de Validación — Planilla [Nombre]",
    "version": "1.0",
    "status": "draft",
    "issueDate": "YYYY-MM-DD"
  },
  "spreadsheet": {
    "fileName": "nombre-planilla.xlsx",
    "purpose": "...",
    "gampCategory": "Cat 4",
    "department": "...",
    "responsible": "...",
    "version": "v1.0",
    "sheets": [],
    "hasVBA": false,
    "hasExternalLinks": false,
    "hasProtection": false
  },
  "resultados": {
    "totalTestCases": 8,
    "pasados": 8,
    "fallados": 0,
    "pendientes": 0,
    "fechaEjecucion": "YYYY-MM-DD",
    "ejecutadoPor": "Nombre del ejecutor"
  },
  "secciones": [
    {
      "numero": "1",
      "titulo": "RESUMEN EJECUTIVO",
      "tipo": "texto",
      "contenido": "Párrafo que resume: qué planilla se validó, cuándo, quién ejecutó, cuántos TCs se ejecutaron, resultado global, y el estado de validación resultante. Debe ser legible de forma independiente."
    },
    {
      "numero": "2",
      "titulo": "RESULTADOS DE PRUEBAS",
      "tipo": "tabla-resumen-pruebas",
      "testCases": [
        {
          "id": "TC-001",
          "descripcion": "Descripción del caso de prueba",
          "resultadoEsperado": "El resultado esperado",
          "resultadoReal": "El resultado real observado durante ejecución",
          "resultado": "PASA",
          "observaciones": ""
        }
      ]
    },
    {
      "numero": "3",
      "titulo": "DESVÍOS Y OBSERVACIONES",
      "tipo": "tabla",
      "columnas": ["ID Desvío", "TC Relacionado", "Descripción", "Acción Correctiva", "Estado"],
      "filas": []
    },
    {
      "numero": "4",
      "titulo": "CONCLUSIÓN Y ESTADO DE VALIDACIÓN",
      "tipo": "caja-estado-validacion",
      "estado": "APROBADA",
      "contenido": "Párrafo formal de conclusión: la planilla [nombre] versión [v] ha superado los casos de prueba establecidos en el EVPROT [referencia]. Los controles de acceso, integridad de fórmulas y control de versión han sido verificados satisfactoriamente. La planilla queda APROBADA para uso en actividades GxP en [departamento]."
    },
    {
      "numero": "5",
      "titulo": "FIRMAS",
      "tipo": "tabla-firmas-final"
    }
  ]
}
```

## Reglas de calidad para el EVIR

1. **El `resultados.pasados + fallados + pendientes` debe sumar `totalTestCases`** exactamente.
2. **Si `fallados > 0`**: la sección de desvíos no puede estar vacía. Cada FALLA debe tener una fila con acción correctiva.
3. **`estado` en `caja-estado-validacion`** debe ser consistente con el resultado:
   - `fallados === 0` → "APROBADA"
   - `fallados > 0` con acciones correctivas documentadas → "APROBADA CON RESTRICCIONES"
   - `fallados > 0` sin resolución → "NO APROBADA"
4. **El resumen ejecutivo** debe mencionar explícitamente la fecha de ejecución y el ejecutor.
5. **Copiar los TCs del EVPROT** al campo `testCases` de `tabla-resumen-pruebas`, completando `resultadoReal` y `resultado` con los datos reales de ejecución.
6. Si el usuario no provee los resultados reales, usar `resultado: "PASA"` y `resultadoReal: "[igual al esperado]"` como template — el ejecutor lo completa durante la ejecución.
