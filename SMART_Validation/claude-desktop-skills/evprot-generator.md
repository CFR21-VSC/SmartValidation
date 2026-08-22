---
name: evprot-generator
description: Genera el JSON de un EVPROT (Protocolo de Validación de Planilla de Cálculo) bajo GAMP 5. Usar cuando ya existe un EVRA aprobado y se necesitan los casos de prueba documentados para ejecutar y registrar resultados. El JSON resultante es input directo del renderer EVPROT.
---

# EVPROT Generator — Protocolo de Validación de Planilla

Generador del documento **EVPROT (Protocolo de Validación de Planilla de Cálculo)** según GAMP 5 Segunda Edición.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes de formato.

## Cuándo usar este skill

- Existe un EVRA aprobado para la planilla (input principal)
- Se necesita un protocolo ejecutable con casos de prueba concretos
- Los casos de prueba incluyen: verificación de versión, controles de acceso, y verificación de cada cálculo crítico identificado en el EVRA

## Principios para los casos de prueba

1. **TC-001 a TC-003 siempre**: control de versión (nombre de archivo, versión interna, hash/fecha de modificación)
2. **TC sobre protección**: si `hasProtection: true`, verificar que las hojas críticas no permiten edición sin contraseña
3. **TC por fórmula crítica**: al menos un caso de prueba por cada hoja con `isCritical: true`
4. **Valores concretos**: las `entradas` y `resultadoEsperado` deben ser específicos (números reales, no "valores conocidos")
5. **Caso negativo**: al menos un TC que verifica que la planilla rechaza entrada inválida (si hay validación de datos)
6. Los campos `resultadoReal` y `resultado` van vacíos — los completa el ejecutor durante la ejecución

## Estructura de un caso de prueba

Cada caso de prueba en `testCases` tiene:
- `id`: "TC-001", "TC-002", etc. (secuencial global, no por sección)
- `descripcion`: qué se verifica (1 línea clara)
- `procedimiento`: pasos numerados para ejecutar el test
- `entradas`: valores de entrada específicos (o "N/A")
- `resultadoEsperado`: el resultado concreto que debe obtenerse
- `resultadoReal`: "" (vacío — a completar durante ejecución)
- `resultado`: "" (vacío — PASA / FALLA — a completar)
- `observaciones`: "" (vacío)

## Output esperado

**Un único objeto JSON** sin texto fuera del objeto.

## Estructura del JSON EVPROT

```json
{
  "package": {
    "code": "PKG-XXX",
    "client": "Nombre del cliente"
  },
  "document": {
    "titleEs": "Protocolo de Validación — Planilla [Nombre]",
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
  "secciones": [
    {
      "numero": "1",
      "titulo": "OBJETIVO Y ALCANCE",
      "tipo": "texto",
      "contenido": "El presente protocolo establece los casos de prueba para verificar que la planilla [nombre] funciona según lo especificado en el EVRA [referencia]. El protocolo cubre: verificación de identidad del archivo, controles de acceso, e integridad de los cálculos críticos."
    },
    {
      "numero": "2",
      "titulo": "CRITERIOS DE ACEPTACIÓN",
      "tipo": "caja-criterio",
      "contenido": "El 100% de los casos de prueba debe resultar PASA. Cualquier resultado FALLA suspende el uso de la planilla en actividades GxP y requiere emisión de NCR."
    },
    {
      "numero": "3",
      "titulo": "VERIFICACIÓN DE IDENTIDAD Y VERSIÓN",
      "tipo": "tabla-test-cases",
      "testCases": [
        {
          "id": "TC-001",
          "descripcion": "Verificar nombre del archivo",
          "procedimiento": "1. Abrir el explorador de archivos en la ubicación definida.\n2. Verificar que el nombre del archivo es exactamente el especificado.",
          "entradas": "N/A",
          "resultadoEsperado": "Nombre: nombre-planilla.xlsx",
          "resultadoReal": "",
          "resultado": "",
          "observaciones": ""
        },
        {
          "id": "TC-002",
          "descripcion": "Verificar versión interna de la planilla",
          "procedimiento": "1. Abrir el archivo.\n2. Ir a la hoja de configuración o celda donde se registra la versión.\n3. Verificar el valor.",
          "entradas": "N/A",
          "resultadoEsperado": "Versión: v1.0",
          "resultadoReal": "",
          "resultado": "",
          "observaciones": ""
        }
      ]
    },
    {
      "numero": "4",
      "titulo": "VERIFICACIÓN DE CONTROLES DE ACCESO",
      "tipo": "tabla-test-cases",
      "testCases": [
        {
          "id": "TC-003",
          "descripcion": "Verificar protección de hoja crítica",
          "procedimiento": "1. Abrir el archivo.\n2. Intentar modificar una celda con fórmula en la hoja crítica sin contraseña.\n3. Registrar la respuesta del sistema.",
          "entradas": "Intentar editar celda [celda] en hoja [hoja]",
          "resultadoEsperado": "Excel muestra mensaje 'La hoja está protegida' y rechaza la edición",
          "resultadoReal": "",
          "resultado": "",
          "observaciones": ""
        }
      ]
    },
    {
      "numero": "5",
      "titulo": "VERIFICACIÓN DE CÁLCULOS CRÍTICOS",
      "tipo": "tabla-test-cases",
      "testCases": [
        {
          "id": "TC-004",
          "descripcion": "Verificar cálculo [descripción del cálculo]",
          "procedimiento": "1. Ingresar los valores de entrada en las celdas indicadas.\n2. Registrar el valor calculado en la celda de resultado.\n3. Comparar con el resultado esperado.",
          "entradas": "Celda A1: [valor], Celda B1: [valor]",
          "resultadoEsperado": "Celda C1: [resultado exacto con unidades]",
          "resultadoReal": "",
          "resultado": "",
          "observaciones": ""
        }
      ]
    },
    {
      "numero": "6",
      "titulo": "FIRMAS DE EJECUCIÓN",
      "tipo": "tabla-firmas-final"
    }
  ]
}
```

## Reglas de calidad para el EVPROT

1. **Cada riesgo R-XXX del EVRA debe tener al menos un TC asociado**. Si el EVRA tiene R-001 sobre integridad de fórmulas, el EVPROT debe tener al menos un TC que la verifique.
2. **Procedimientos ejecutables**: el ejecutor debe poder seguir los pasos sin ambigüedad. Usar "Celda B5" no "celda de rendimiento".
3. **Resultados esperados numéricos**: "95.00%" no "el rendimiento correcto". Incluir unidades.
4. **Si `hasVBA: true`**: agregar sección "Verificación de Macros" con TC de ejecución controlada.
5. **Si `hasExternalLinks: true`**: agregar TC que verifica que los vínculos apuntan a la versión correcta del archivo externo.
6. **Mínimo 5 TCs** para planillas con hojas críticas. Más es mejor que menos.
7. El `procedimiento` puede usar `\n` para separar pasos numerados.
