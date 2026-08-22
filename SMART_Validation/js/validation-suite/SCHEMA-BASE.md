# Validation Suite — Schema Base

Estructura JSON común a **todos** los documentos del paquete de validación (HLRA, VP, URS, FRS, DS, RA, IRA, MCN, MTR, PIQ, IIQ, RIQ, POQ, IOQ, NOTIF, ROQ, IF).

Cada tipo de documento extiende este esquema agregando su propia sección `secciones[]` con tipos específicos (definidos en sus respectivos schema-{TYPE}.md).

## Estructura mínima

```json
{
  "schemaVersion": "1.0",
  "type": "HLRA",

  "package": {
    "code": "DRP-SIS-001",
    "systemName": "DRP-GAMP Categorizador™",
    "systemVersion": "v1.1",
    "systemSubtitle": "Sistema de Categorización GAMP 5",
    "client": "DRP Assurance",
    "qmsLabel": "Sistema de Gestión de Calidad GxP",
    "year": 2026
  },

  "document": {
    "code": "HLRA-DRP-SIS-001",
    "titleEs": "ANÁLISIS DE CRITICIDAD DE ALTO NIVEL",
    "titleEn": "HIGH LEVEL RISK ASSESSMENT (HLRA)",
    "headerTitle": "Análisis de Criticidad de Alto Nivel",
    "version": "1.0",
    "issueDate": "2026-02-08",
    "status": "Aprobado",
    "processOwner": "Federico Bongiovanni",
    "gampCategory": "GAMP 3 — Software Estándar Comercial",
    "normativeFramework": "ANMAT 4159/2023 Anexo VI | ICH Q9 | GAMP 5"
  },

  "controlCambios": [
    { "version": "1.0", "fecha": "2026-02-08", "autor": "Federico Bongiovanni", "descripcion": "Versión inicial" }
  ],

  "matrizAprobaciones": [
    { "rol": "Redactor (Validador)", "nombre": "Lucas Santarenz", "iniciales": "LS", "fecha": "2026-02-08" },
    { "rol": "Revisor (Process Owner)", "nombre": "Federico Bongiovanni", "iniciales": "FB", "fecha": "2026-02-08" },
    { "rol": "Aprobador (Jefe de Validaciones)", "nombre": "Lucas Santarenz", "iniciales": "LS", "fecha": "2026-02-08" },
    { "rol": "Aprobador (Gerente QA)", "nombre": "Federico Bongiovanni", "iniciales": "FB", "fecha": "2026-02-08" }
  ],

  "trazabilidad": {
    "recibeDe": [],
    "alimentaA": ["VP", "RA"]
  },

  "notaFirmas": null,

  "secciones": []
}
```

## Campos obligatorios

| Campo | Tipo | Descripción |
|---|---|---|
| `schemaVersion` | string | Versión del schema (siempre `"1.0"` por ahora) |
| `type` | string | Tipo de documento: `HLRA`, `VP`, `URS`, `FRS`, `DS`, etc. |
| `package.code` | string | Código de inventario del paquete (ej. `DRP-SIS-001`) |
| `package.systemName` | string | Nombre del sistema validado |
| `package.client` | string | Empresa propietaria del paquete |
| `document.titleEs` | string | Título del documento en español (mayúsculas) |
| `document.version` | string | Versión del documento (ej. `"1.0"`, `"0.1"`) |
| `controlCambios` | array | Tabla de versiones (puede estar vacío) |
| `matrizAprobaciones` | array | Tabla de firmantes (puede estar vacío) |
| `secciones` | array | Contenido específico del documento |

## Campos opcionales (con defaults)

| Campo | Default | Descripción |
|---|---|---|
| `document.code` | `${type}-${package.code}` | Se autogenera si no se provee |
| `package.year` | año actual | Para el copyright en footer |
| `package.qmsLabel` | "Sistema de Gestión de Calidad GxP" | Subtítulo bajo el logo |
| `document.headerTitle` | `document.titleEs` | Versión corta para el header de página |
| `notaFirmas` | nota DocuSign por defecto | Si querés custom o suprimir, pasar `""` o texto custom |

## Matriz de aprobaciones — sin límite

`matrizAprobaciones` es un array de cualquier longitud. Casos típicos:

**Documento simple (4 firmantes — caso por defecto)**:
```json
"matrizAprobaciones": [
  { "rol": "Redactor (Validador)", "nombre": "...", "iniciales": "LS", "fecha": "..." },
  { "rol": "Revisor (Process Owner)", "nombre": "...", "iniciales": "FB", "fecha": "..." },
  { "rol": "Aprobador (Jefe de Validaciones)", "nombre": "...", "iniciales": "LS", "fecha": "..." },
  { "rol": "Aprobador (Gerente QA)", "nombre": "...", "iniciales": "FB", "fecha": "..." }
]
```

**Documento con cliente (6+ firmantes — IF, ROQ típicamente)**:
```json
"matrizAprobaciones": [
  { "rol": "Redactor (Validador DRP)", "nombre": "...", "iniciales": "LS", "fecha": "..." },
  { "rol": "Revisor (Process Owner DRP)", "nombre": "...", "iniciales": "FB", "fecha": "..." },
  { "rol": "Aprobador (Jefe Validaciones DRP)", "nombre": "...", "iniciales": "LS", "fecha": "..." },
  { "rol": "Aprobador (Gerente QA DRP)", "nombre": "...", "iniciales": "FB", "fecha": "..." },
  { "rol": "Aprobador (QA Cliente)", "nombre": "...", "iniciales": "JP", "fecha": "..." },
  { "rol": "Aprobador (Process Owner Cliente)", "nombre": "...", "iniciales": "MG", "fecha": "..." },
  { "rol": "Aprobador (Director de Calidad Cliente)", "nombre": "...", "iniciales": "AS", "fecha": "..." }
]
```

Cada firmante puede tener:
- `rol`: rol descriptivo
- `nombre`: nombre completo
- `iniciales`: iniciales (default si no hay imagen de firma)
- `firma`: alias de `iniciales` (compatible)
- `firmaImage`: dataURL PNG de la firma manuscrita escaneada (opcional, se renderiza en la celda)
- `fecha`: fecha en formato `YYYY-MM-DD` o `DD/MM/YYYY`

## Trazabilidad

Cada documento declara qué documentos consume y a cuáles alimenta. Esto permite que el IDL (índice del paquete) se genere automáticamente.

```json
"trazabilidad": {
  "recibeDe": ["URS", "VP", "IRA"],
  "alimentaA": ["IIQ"]
}
```

Tipos válidos: `HLRA`, `VP`, `URS`, `FRS`, `DS`, `RA`, `IRA`, `MCN`, `MTR`, `PIQ`, `IIQ`, `RIQ`, `NOTIF`, `POQ`, `IOQ`, `ROQ`, `IF`.

## Auto-generado por la Suite

Estos campos NO van en el JSON, los calcula la Suite:

- Numeración de páginas y secciones
- Header/footer de cada página (a partir de `package` y `document`)
- Código del documento si no se provee (`{type}-{package.code}`)
- Color del estado (verde si "Aprobado", naranja si "Borrador")
- Tabla de Control de Cambios y Matriz de Aprobaciones (renderizadas desde los arrays)
- Mapa de referencias cruzadas en el IDL (a partir de `trazabilidad`)
- Catálogo de documentos en el IDL
- Bookmarks del libro consolidado
