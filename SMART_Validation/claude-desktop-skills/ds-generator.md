---
name: ds-generator
description: Genera el JSON de un documento DS (Design Specification / Especificación de Diseño) para la Validation Suite de DRP. Usar cuando el usuario tiene FRS aprobado y necesita documentar las decisiones técnicas concretas (arquitectura, componentes, interfaces técnicas, modelo de datos, configuración GxP, seguridad técnica) que implementarán cada requerimiento funcional. El JSON resultante es input directo del renderer DS — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# DS Generator — Validation Suite

Generador del documento **DS (Design Specification / Especificación de Diseño)** según GAMP 5 Segunda Edición.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes (anchos de tabla, márgenes, sub-headers de grupo, etc.). Este skill solo cubre lo específico del DS.

## Cuándo usar este skill

- El usuario ya tiene **FRS aprobado** (input principal e indispensable).
- El sistema típicamente es **GAMP 4 (COTS configurado)** o **GAMP 5 (Custom)**.
- Necesita documentar **CÓMO** se implementarán técnicamente los FRS del FRS.
- Inputs típicos:
  - FRS del paquete actual (input principal)
  - URS, HLRA, VP del paquete actual
  - Documentación de arquitectura del vendor (en GAMP 4)
  - Restricciones de infraestructura del cliente
  - Decisiones de configuración GxP del cliente

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Diferencia clave FRS vs DS

| | FRS | DS |
|---|---|---|
| Pregunta que responde | ¿QUÉ funciones debe ejecutar el sistema? | ¿CÓMO se va a implementar técnicamente cada función? |
| Audiencia | Validador funcional, Process Owner | Arquitecto, IT, Vendor, Validador técnico |
| Origen | URS | FRS |
| Ejemplo | "El sistema generará automáticamente un código único MC-YYYYMMDD-NNNN al registrar muestras" | "Sample Manager (Java/WildFly) genera el código mediante secuencia Oracle SAMPLE_SEQ + plantilla configurada en CONFIG_PARAMS.SAMPLE_PATTERN. La generación es atómica con la inserción en SAMPLES." |

## Estructura del JSON DS

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "DS",
  "package": { /* mismo del FRS/URS/HLRA/VP */ },
  "document": {
    "code": "DS-<CODIGO>",
    "titleEs": "ESPECIFICACIÓN DE DISEÑO",
    "titleEn": "DESIGN SPECIFICATION (DS)",
    "headerTitle": "Especificación de Diseño (DS)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA>",
    "normativeFramework": "<de HLRA>",
    "extras": {
      "Documento base (FRS)": "FRS-<CODE> v<X.Y>",
      "Tipo de Diseño": "GAMP 4 — Configuración por Vendor (no customización) | GAMP 5 — Custom",
      "Vendor": "<nombre del vendor o N/A si es custom>"
    }
  },
  "controlCambios": [...],
  "matrizAprobaciones": [
    /* DS requiere SIEMPRE: Validador, Arquitecto Vendor (en GAMP 4), Revisor IT, Process Owner, Jefe Validaciones, Gerente QA */
  ],
  "trazabilidad": {
    "recibeDe": ["FRS", "URS"],
    "alimentaA": ["IIQ", "POQ", "MTR"]
  },
  "secciones": [...]
}
```

> **Importante**: en GAMP 4, la matriz de aprobaciones debe incluir **Arquitecto del Vendor** (no es "revisor" sino "co-autor" del diseño). En GAMP 5 puro, el vendor se reemplaza por el Tech Lead interno del cliente.

## Secciones obligatorias del DS (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

Texto justificado en 1-2 párrafos. Mencionar SIEMPRE:
- Define **CÓMO** se implementarán técnicamente los FRS del FRS.
- Traduce los FRS en arquitectura, componentes, modelo de datos, interfaces técnicas y configuración GxP.
- Sirve como input directo para el IIQ y el POQ.
- Si es GAMP 4: el diseño se limita a la configuración del producto comercial — no aplica desarrollo de código fuente.

### 2. ALCANCE (`tipo: "lista-incluido-excluido"`)

Incluido típico: arquitectura, componentes contratados, configuración GxP, interfaces, modelo de datos relevante, seguridad técnica, decisiones de infraestructura.

Excluido típico (GAMP 4): diseño interno del producto (responsabilidad del vendor), customización de código fuente (no permitida), infraestructura del proveedor cloud, diseño de sistemas integrados.

### 3. RESPONSABILIDADES (`tipo: "tabla"`)

Roles específicos del DS:
- Validador — coordina con vendor, verifica que cada FRS tiene su solución técnica documentada.
- **Arquitecto Vendor** (GAMP 4) — define el diseño técnico aplicable según el producto.
- Revisor Técnico / IT — valida viabilidad técnica en la infraestructura del cliente.
- Process Owner — valida que el diseño cumple los FRS desde la perspectiva del usuario.
- QA / Revisor Regulatorio — verifica cumplimiento técnico de los requerimientos GxP.

### 4. DEFINICIONES (`tipo: "tabla"`)

Términos OBLIGATORIOS a incluir:
- `DS (Design Specification)` — qué es y de qué deriva.
- `Configuración GxP` — parámetros configurables del producto que afectan funciones GxP.
- Términos de la arquitectura específica del sistema (HA, RTO/RPO, TLS, audit trail con WORM, etc.).
- Componentes propietarios del vendor que aparecen en el diseño (ej. "LIMS-Bridge", "SAP Connector").

### 5. ARQUITECTURA DE ALTO NIVEL (`tipo: "diagrama-arquitectura"`)

**Sección obligatoria y CARACTERÍSTICA del DS**. Tipo de sección nuevo, exclusivo del DS.

Estructura:
```json
{
  "tipo": "diagrama-arquitectura",
  "titulo": "ARQUITECTURA DE ALTO NIVEL",
  "intro": "Texto descriptivo de la arquitectura por capas.",
  "capas": [
    {
      "nombre": "Capa de Presentación",
      "tecnologia": "Web App + Cliente Pesado",
      "color": "primary",
      "componentes": [
        "Portal Web (HTML5 + Angular 16)",
        "Cliente Pesado Windows (.NET WPF)"
      ]
    },
    {
      "nombre": "Capa de Aplicación",
      "tecnologia": "<producto> sobre <runtime>",
      "color": "secondary",
      "componentes": [...]
    },
    {
      "nombre": "Capa de Datos",
      "tecnologia": "<DBMS> + <esquema HA>",
      "color": "accent",
      "componentes": [...]
    },
    {
      "nombre": "Capa de Infraestructura",
      "tecnologia": "<hosting + topología>",
      "color": "#5C7080",
      "componentes": [...]
    }
  ],
  "nota": "Texto opcional al final, ej. RTO/RPO."
}
```

Capas estándar (4 capas — Presentación / Aplicación / Datos / Infraestructura). Adaptar nombres y tecnologías al sistema real.

Colores recomendados (en orden descendente):
- `"primary"` (azul oscuro) — Presentación
- `"secondary"` (azul medio) — Aplicación
- `"accent"` (verde) — Datos
- `"#5C7080"` (gris oscuro) — Infraestructura

### 6. COMPONENTES DEL SISTEMA (`tipo: "tabla"`)

Tabla con TODOS los componentes principales agrupados con sub-headers (Funcionales / Integración).

```json
{
  "tipo": "tabla",
  "titulo": "COMPONENTES DEL SISTEMA",
  "compact": true,
  "columnas": ["Componente", "Propósito", "FRS asociados", "Configuración"],
  "widths": [115, 145, 90, 105],
  "filas": [
    { "subheader": "6.1 Componentes Funcionales" },
    ["<Componente>", "<descripción>", "FRS-XXX a FRS-YYY", "<config aplicable>"],
    ...
    { "subheader": "6.2 Componentes de Integración" },
    ...
  ]
}
```

**Cobertura obligatoria**: cada FRS funcional del FRS debe estar referenciado en algún componente. Si un FRS no aparece, falta documentar el componente que lo implementa.

### 7. DISEÑO DE INTERFAZ TÉCNICA (`tipo: "tabla"`)

Para CADA FRS-IF del FRS, una fila con detalle técnico:

```json
{
  "tipo": "tabla",
  "titulo": "DISEÑO DE INTERFAZ TÉCNICA",
  "compact": true,
  "columnas": ["FRS-IF", "Endpoint / Mecanismo", "Frecuencia", "Auth", "Manejo de fallos"],
  "widths": [55, 165, 85, 60, 90],
  "filas": [
    [
      { "text": "FRS-IF-001", "bold": true, "color": "#1F3C56" },
      "<endpoint concreto + protocolo + cifrado>",
      "<frecuencia>",
      "<mecanismo de auth>",
      "<estrategia de retry/fallback>"
    ]
  ]
}
```

### 8. MODELO DE DATOS — TABLAS GxP CRÍTICAS

Tabla resumen (no exhaustiva) de las tablas/colecciones GxP-relevantes:

```json
{
  "tipo": "tabla",
  "titulo": "MODELO DE DATOS — TABLAS GxP CRÍTICAS",
  "compact": true,
  "columnas": ["Tabla", "Propósito", "Audit", "Replicación"],
  "widths": [120, 195, 60, 80],
  "filas": [
    ["<TABLA_NOMBRE>", "<propósito>", "Sí | Sí (WORM) | No", "Síncrona | Asíncrona | N/A"]
  ]
}
```

**Mínimo obligatorio**: incluir tablas de USERS, ROLE_PERMISSIONS, AUDIT_LOG, ELECTRONIC_SIGNATURES si el sistema las tiene.

### 9. DISEÑO DE SEGURIDAD TÉCNICA (`tipo: "tabla"`)

Para cada FRS de seguridad/compliance, una decisión técnica concreta:

```json
{
  "tipo": "tabla",
  "titulo": "DISEÑO DE SEGURIDAD TÉCNICA",
  "columnas": ["Requerimiento", "Implementación técnica", "FRS"],
  "widths": [125, 235, 95],
  "filas": [
    ["Cifrado en tránsito", "TLS 1.3 con suite ECDHE-RSA-AES256-GCM-SHA384...", "FRS-018, FRS-IF-XXX"],
    ["Cifrado en reposo", "<DBMS> TDE sobre tablespace USERS y AUDIT", "FRS-019"],
    ["Autenticación", "<mecanismo concreto: LDAP, SSO, MFA>", "FRS-XXX"],
    ["RBAC", "<implementación concreta>", "FRS-XXX"],
    ["Política de contraseñas", "<parámetros concretos>", "FRS-XXX"],
    ["Timeout sesión", "<minutos>", "FRS-XXX"],
    ["Bloqueo cuenta", "<intentos / ventana / duración>", "FRS-XXX"],
    ["Firma electrónica", "<mecanismo cumpliendo 21 CFR Part 11>", "FRS-XXX"],
    ["Audit Trail", "<implementación: trigger, logs, WORM, retención>", "FRS-XXX"]
  ]
}
```

### 10. CONFIGURACIÓN GxP DEL CLIENTE (`tipo: "tabla"`)

Parámetros configurados específicamente para ESTE cliente:

```json
{
  "tipo": "tabla",
  "titulo": "CONFIGURACIÓN GxP DEL CLIENTE",
  "intro": "Parámetros y recursos configurados específicamente para <CLIENTE>. Esta configuración será verificada en POQ.",
  "columnas": ["Categoría", "Configuración aplicable al cliente"],
  "widths": [140, 315],
  "filas": [
    ["<Categoría>", "<valor concreto>"]
  ]
}
```

Categorías típicas: workflows, plantillas de reporte, roles, política de contraseñas, métodos analíticos, timezone, idioma, branding, frecuencias de backup, integraciones activas.

### 11. CRITERIOS DE CALIDAD DEL DISEÑO (`tipo: "caja-criterio"`)

Lista de items que se deben cumplir:

```json
{
  "tipo": "caja-criterio",
  "titulo": "CRITERIOS DE CALIDAD DEL DISEÑO",
  "items": [
    "El 100% de los FRS del FRS tienen su solución técnica documentada en este DS.",
    "Toda decisión de diseño respeta las restricciones de GAMP <X> — <constraint>.",
    "Las interfaces técnicas tienen endpoint, frecuencia, autenticación y manejo de errores definidos.",
    "Las tablas GxP críticas tienen audit trail automático y replicación síncrona.",
    "El diseño cumple ANMAT 4159/2023 Anexo VI, 21 CFR Part 11 y EU Annex 11.",
    "El vendor confirma viabilidad técnica de cada decisión documentada."
  ]
}
```

### 12. REFERENCIAS

Tabla 2 columnas (`Código / Referencia | Título`). Incluir SIEMPRE:
- FRS del paquete actual (referencia principal)
- URS del paquete actual
- HLRA del paquete actual
- VP del paquete actual
- Manual del vendor (si GAMP 4)
- Documento de configuración del vendor (si GAMP 4)
- **Documento de arquitectura del vendor** (específico del DS)
- SOPs operativos
- ANMAT 4159/2023 Anexo VI
- GAMP 5 — 2da Ed. 2022
- ICH Q9 R1 (2023)
- 21 CFR Part 11
- EU Annex 11

### 13. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`)

Roles típicos del DS:
- Ejecutor (Validador)
- **Arquitecto (Vendor)** — específico de DS
- Revisor Técnico (IT)
- Revisor (Process Owner)
- Aprobador (Jefe de Validaciones)
- Aprobador (Gerente QA)

---

## Reglas de contenido

### Cómo escribir un buen DS

1. **Concreto y técnico**: cada decisión de diseño es específica. No genérica.
   - ✅ Bueno: "TLS 1.3 con suite ECDHE-RSA-AES256-GCM-SHA384"
   - ❌ Malo: "Comunicación cifrada"

2. **Trazado a FRS**: cada componente, decisión de seguridad o tabla referencia el FRS que implementa.
   - ✅ Bueno: en columna "FRS asociados" → "FRS-001 a FRS-004"
   - ❌ Malo: dejar la columna vacía

3. **Coherente con la categoría GAMP**:
   - **GAMP 4**: el DS documenta CONFIGURACIÓN del producto, no desarrollo. Si dice "se programa", está mal.
   - **GAMP 5**: el DS documenta DESARROLLO custom + configuración. Puede mencionar lenguajes, frameworks, librerías.

4. **Específico del cliente cuando aplique**: la sección de Configuración GxP debe tener valores reales (cantidad de workflows, plantillas, roles, etc.), no placeholders.

5. **Cobertura completa de FRS**: si en el FRS hay 32 FRS, todos deben estar referenciados en alguna parte del DS (componentes, interfaces, seguridad, modelo de datos).

### Cobertura mínima por categoría GAMP

| Categoría GAMP | Secciones imprescindibles del DS |
|---|---|
| GAMP 3 (COTS no configurado) | DS suele ser breve: arquitectura, configuración mínima, sin diseño funcional |
| GAMP 4 (COTS configurado) | TODAS las secciones, énfasis en Componentes y Configuración GxP |
| GAMP 5 (Custom) | TODAS las secciones, énfasis adicional en Modelo de Datos completo y Diseño de Algoritmos críticos |

### Tipo nuevo: `diagrama-arquitectura`

- Es **exclusivo del DS**. No usar en otros documentos.
- Mínimo 3 capas, máximo 5 (más capas vuelven el diagrama ilegible).
- Cada capa tiene `nombre`, `tecnologia`, `color`, `componentes` (lista de strings).
- Color recomendado: `primary | secondary | accent | "#5C7080"` en orden descendente.
- El renderer dibuja flechas `▼` automáticamente entre capas.

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **Cada componente, interfaz, decisión de seguridad debe trazarse a uno o más FRS.** No componentes huérfanos.
3. **El DS describe CÓMO, no QUÉ.** Si una sección no agrega información técnica nueva al FRS, está mal redactada.
4. **NO inventar capacidades del producto.** En GAMP 4, todo lo documentado debe estar disponible en la versión contratada.
5. **NO documentar customizaciones de código fuente** en sistemas GAMP 4 (no permitido).
6. **Anchos de tabla siempre suman 455** cuando se especifican.
7. **`type: "DS"`** siempre en mayúsculas.
8. **`document.extras` debe incluir** `"Documento base (FRS)"`, `"Tipo de Diseño"` y `"Vendor"`.
9. **Sección 5 (Arquitectura) usa `tipo: "diagrama-arquitectura"`.** No usar `texto` ni tabla.
10. **Matriz de aprobaciones debe incluir Arquitecto Vendor** (en GAMP 4) o Tech Lead interno (en GAMP 5 custom).
11. **TLS, cifrado, audit trail, RBAC, política de contraseñas: con parámetros concretos, no generalidades.**
12. **Configuración GxP debe tener valores reales del cliente** (no placeholders).

---

## Ejemplo de input mínimo

> "Generá el DS para LIMS-MediCorp v2.0. El FRS-LIMS-MC-001 v1.0 ya está aprobado con 32 FRS (28 funcionales + 4 de interfaz). Sistema GAMP 4 configurado por LIMS-Tech Solutions sobre Java 17 / WildFly 30 / Oracle 19c con replicación síncrona. Frontend Angular 16 + cliente pesado .NET WPF. HA activo-pasivo Oracle Data Guard. Cliente Laboratorios MediCorp tiene 32 workflows configurados, 5 roles (Analista, Supervisor, QA, Admin, Auditor), integración con SAP-MM, SAP-QM, AD, equipos HPLC/GC vía OPC UA."

El skill genera el JSON DS documentando arquitectura por 4 capas (Presentación → Aplicación → Datos → Infraestructura), componentes técnicos del producto, interfaces detalladas (endpoint + auth + retry), modelo de datos GxP (incluyendo audit trail WORM), seguridad técnica con parámetros concretos (TLS 1.3, TDE, política de contraseñas, RBAC), y configuración específica de MediCorp. Cada elemento queda trazado a su(s) FRS de origen.
