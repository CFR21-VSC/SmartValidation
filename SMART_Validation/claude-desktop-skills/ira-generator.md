---
name: ira-generator
description: Genera el JSON de un documento IRA (Infrastructure Risk Analysis / Análisis de Riesgos de Componentes) para la Validation Suite de DRP. Usar cuando el usuario tiene HLRA, RA, URS y SOP-ADM aprobados, y necesita evaluar los riesgos individuales de cada componente técnico (software, infraestructura, seguridad) para determinar el alcance del PIQ. El JSON resultante es input directo del renderer IRA — no debe contener Markdown, ni notas, ni texto fuera del objeto JSON.
---

# IRA Generator — Validation Suite

Generador del documento **IRA (Infrastructure Risk Analysis / Análisis de Riesgos de Componentes)** según GAMP 5 §8.2 e ICH Q9 R1.

> **Antes de empezar**: leer [`_LECCIONES-APRENDIDAS.md`](./_LECCIONES-APRENDIDAS.md) para reglas comunes (anchos de tabla, márgenes, sub-headers de grupo, etc.). Este skill solo cubre lo específico del IRA.

## Cuándo usar este skill

- El usuario ya tiene **HLRA, RA, URS aprobados** y **SOP-ADM** del sistema.
- Necesita identificar los **componentes técnicos** del sistema y evaluar el riesgo individual de cada uno para determinar la profundidad del IQ.
- Inputs típicos:
  - HLRA del paquete actual
  - RA del paquete actual
  - URS del paquete actual
  - SOP-ADM (procedimiento de administración) — **fuente principal de componentes**
  - MAN del sistema (sección de requisitos / arquitectura)
  - Topología de infraestructura del cliente (especialmente importante en on-premise)

## Output esperado

**Un único objeto JSON** que valide contra el schema de la Validation Suite. Sin texto fuera del JSON.

## Diferencia clave RA vs IRA

| | RA (Risk Analysis) | IRA (Infrastructure Risk Analysis) |
|---|---|---|
| Pregunta que responde | ¿Qué riesgos operativos tiene cada función? | ¿Qué tan crítico es cada componente y qué profundidad de IQ necesita? |
| Granularidad | 1 fila por modo de fallo | 1 fila por componente técnico |
| Metodología | FMEA: `S × P × D` | Componente: `P × G × I` |
| Niveles | 1-6 BAJO / 7-14 MEDIO / 15-27 ALTO | 1-4 BAJO / 5-8 MEDIO / 9-27 ALTO |
| Mitigación | Sí (RR pre-calculado) | No — el IQ mismo "mitiga" verificando |
| Output operativo | Test cases priorizados para POQ | Alcance del PIQ (cuántos TCs y de qué profundidad) |
| Sub-headers | Por módulo funcional | Por categoría: Software / Infraestructura / Seguridad |

## Metodología IRA-Score = P × G × I

- **P (Proceso GxP)** — vinculación al proceso GxP:
  - 1 Bajo: sin vinculación directa
  - 2 Medio: soporte indirecto
  - 3 Alto: directamente involucrado en proceso GxP crítico

- **G (Gravedad de Fallo)** — impacto en continuidad del servicio:
  - 1 Baja: fallo no afecta continuidad
  - 2 Media: fallo interrumpe parcialmente
  - 3 Alta: fallo total, servicio no disponible o datos comprometidos

- **I (Integridad de Datos)** — impacto en datos GxP:
  - 1 Baja: no compromete integridad
  - 2 Media: compromete de forma recuperable
  - 3 Alta: compromete irreversiblemente datos GxP

**Cálculo:** `IRA-Score = P × G × I` (rango 1-27).

**Niveles y profundidad de IQ:**
- **1-4 BAJO** → Verificación Básica (1 TC funcional simple)
- **5-8 MEDIO** → Verificación Estándar (1-2 TCs con criterios específicos)
- **9-27 ALTO** → Verificación Exhaustiva (TCs detallados con múltiples checkpoints)

## Principio de Gravedad inmutable (analogía con RA)

Igual que en el RA con la Severidad, **la Gravedad (G) en IRA es propiedad inherente del componente y no se reduce**. La verificación exhaustiva en el IQ no "baja G" — solo confirma que el componente está bien instalado/configurado, manteniendo G como propiedad del componente. No hay análisis de mitigación en IRA.

## Estructura del JSON IRA

### Header / Metadata

```json
{
  "schemaVersion": "1.0",
  "type": "IRA",
  "package": { /* mismo de HLRA/RA/URS */ },
  "document": {
    "code": "IRA-<CODIGO>",
    "titleEs": "ANÁLISIS DE RIESGOS DE COMPONENTES",
    "titleEn": "INFRASTRUCTURE RISK ANALYSIS BY COMPONENT (IRA)",
    "headerTitle": "Análisis de Riesgos de Componentes (IRA)",
    "version": "<X.Y>",
    "issueDate": "<...>",
    "status": "Aprobado | Borrador",
    "processOwner": "<NOMBRE>",
    "gampCategory": "<de HLRA>",
    "normativeFramework": "<de HLRA>",
    "extras": {
      "Componentes evaluados": "<N> (<S> Software / <I> Infraestructura / <SEC> Seguridad)",
      "Metodología": "IRA-Score = P × G × I | GAMP 5 §8.2 | ICH Q9 R1",
      "Fuente de datos": "SOP-ADM-<CODE> v<X> | MAN-<CODE> v<X>"
    }
  },
  "controlCambios": [...],
  "matrizAprobaciones": [...],
  "trazabilidad": {
    "recibeDe": ["HLRA", "VP", "URS", "RA"],
    "alimentaA": ["PIQ", "MTR"]
  },
  "secciones": [...]
}
```

## Secciones obligatorias del IRA (en este orden)

### 1. PROPÓSITO (`tipo: "texto"`)

Texto en 2 párrafos. Mencionar SIEMPRE:
- Evalúa los riesgos individuales de cada componente técnico para determinar el alcance del IQ.
- Complementa al RA (riesgos por función) aportando la dimensión técnica de la instalación.
- Componentes identificados de la documentación fuente oficial (SOP-ADM y MAN).

### 2. METODOLOGÍA: IRA-Score = P × G × I (`tipo: "escalas-ira"`)

Sección obligatoria con las 4 escalas (P, G, I, niveles):

```json
{
  "tipo": "escalas-ira",
  "titulo": "METODOLOGÍA: IRA-Score = P × G × I",
  "escalaP": [
    { "valor": 1, "nivel": "Bajo", "descripcion": "Sin vinculación directa a proceso GxP." },
    { "valor": 2, "nivel": "Medio", "descripcion": "Soporte indirecto a proceso GxP." },
    { "valor": 3, "nivel": "Alto", "descripcion": "Directamente involucrado en proceso GxP crítico." }
  ],
  "escalaG": [
    { "valor": 1, "nivel": "Baja", "descripcion": "Fallo no afecta continuidad del servicio." },
    { "valor": 2, "nivel": "Media", "descripcion": "Fallo interrumpe parcialmente el servicio." },
    { "valor": 3, "nivel": "Alta", "descripcion": "Fallo total: servicio no disponible o datos comprometidos." }
  ],
  "escalaI": [
    { "valor": 1, "nivel": "Baja", "descripcion": "Fallo no compromete integridad de datos GxP." },
    { "valor": 2, "nivel": "Media", "descripcion": "Fallo puede comprometer integridad de forma recuperable." },
    { "valor": 3, "nivel": "Alta", "descripcion": "Fallo compromete irreversiblemente datos GxP." }
  ],
  "niveles": [
    { "rango": "1-4", "nivel": "BAJO", "verificacion": "Verificación Básica" },
    { "rango": "5-8", "nivel": "MEDIO", "verificacion": "Verificación Estándar" },
    { "rango": "9-27", "nivel": "ALTO", "verificacion": "Verificación Exhaustiva" }
  ],
  "nota": "El IRA-Score determina la profundidad del IQ (no la mitigación). La Gravedad (G) es propiedad inherente del componente: nunca se reduce."
}
```

### 3. MATRIZ DE RIESGOS POR COMPONENTE (LA TABLA PRINCIPAL — `tipo: "tabla-componentes-ira"`)

Tabla con 10 columnas, agrupada por categoría usando sub-headers:

```json
{
  "tipo": "tabla-componentes-ira",
  "titulo": "MATRIZ DE RIESGOS POR COMPONENTE",
  "intro": "Componentes identificados de SOP-ADM §X.X y MAN §X.X.",
  "filas": [
    { "subheader": "CATEGORÍA 1 — SOFTWARE DE APLICACIÓN" },
    {
      "id": "COMP-SW-01",
      "tipo": "Software",
      "componente": "App Web Principal",
      "descripcion": "<Texto descriptivo + ubicación + referencia a SOP/MAN>",
      "P": 3, "G": 3, "I": 3,
      "tcIq": "TC-IQ-001"
    },
    ...
    { "subheader": "CATEGORÍA 2 — INFRAESTRUCTURA <CLOUD | ON-PREMISE>" },
    ...
    { "subheader": "CATEGORÍA 3 — CONTROLES DE SEGURIDAD" },
    ...
  ]
}
```

**Cálculo automático:**
- El renderer calcula `IRA = P × G × I` y lo muestra con su nivel coloreado (BAJO/MEDIO/ALTO).
- La columna "Verif. IQ" se rellena automáticamente del nivel (Básica/Estándar/Exhaustiva).
- El skill solo provee P, G, I, y los textos.

**Colores de niveles:**
- BAJO (1-4) → verde `#27AE60`
- MEDIO (5-8) → naranja `#E67E22`
- ALTO (9-27) → rojo `#C0392B`

### Convención de naming de componentes

Prefijos obligatorios por categoría:
- **Software**: `COMP-SW-NN` (App, Panel Admin, Motor PDF, Audit Trail, Algoritmo, etc.)
- **Infraestructura**: `COMP-INF-NN` (Servidor, BD, Storage, Backup, Red, UPS, Climatización, etc.)
- **Seguridad**: `COMP-SEC-NN` (TLS, Firewall, IAM, VPN, Política de contraseñas, 2FA, etc.)

Test cases referenciados: `TC-IQ-NNN` (formato estándar).

### Categorías típicas por arquitectura

#### Sistema CLOUD (SaaS / PaaS / IaaS)
- **CATEGORÍA 1 — SOFTWARE DE APLICACIÓN**: App principal, Panel admin, Portal verificación, Motor PDF, Motor hash, Audit trail, SMTP, Algoritmos.
- **CATEGORÍA 2 — INFRAESTRUCTURA CLOUD**: Servidor compute (EC2/Azure VM), BD (RDS/Cosmos), Object storage (S3/Blob), Backup automático, Consola IAM, Acceso SSH/RDP.
- **CATEGORÍA 3 — CONTROLES DE SEGURIDAD**: Certificado TLS, Firewall (Security Groups/NSG), Política contraseñas, MFA si aplica.

#### Sistema ON-PREMISE
- **CATEGORÍA 1 — SOFTWARE DE APLICACIÓN**: App, módulos del producto, agentes, conectores.
- **CATEGORÍA 2 — INFRAESTRUCTURA FÍSICA**: Servidores físicos (App / DB / File), Sistema operativo (Windows Server / RHEL), BD (Oracle / SQL Server / PostgreSQL self-hosted), Storage (SAN / NAS / RAID), **UPS y respaldo eléctrico**, **Climatización del datacenter**, **Switches de red**, Backup físico (cintas LTO / appliance), **Sistema de detección de incendios**, Monitoreo (Nagios / Zabbix).
- **CATEGORÍA 3 — CONTROLES DE SEGURIDAD**: Certificado TLS interno (PKI corporativa), Firewall perimetral, VPN site-to-site, Política contraseñas, Active Directory / LDAP, MFA, Hardening OS, Antivirus.

> **Importante para on-premise**: incluir SIEMPRE componentes de facility (UPS, climatización, detección de incendios, cableado estructurado) — son responsabilidad del cliente y suelen olvidarse en sistemas que vienen del mundo cloud.

### 4. RESUMEN DE RESULTADOS (`tipo: "tabla"`)

Tabla con totales por categoría:

```json
{
  "tipo": "tabla",
  "titulo": "RESUMEN DE RESULTADOS",
  "intro": "Distribución de componentes por categoría y nivel de IRA-Score.",
  "columnas": ["Categoría", "Total", "IRA ALTO (9-27)", "IRA MEDIO (5-8)", "IRA BAJO (1-4)"],
  "widths": [165, 60, 80, 80, 70],
  "filas": [
    ["Software de Aplicación", { "text": "<N>", "alignment": "center" }, ...],
    ["Infraestructura <Cloud | On-Premise>", ...],
    ["Controles de Seguridad", ...],
    [{ "text": "TOTAL", "bold": true, "fillColor": "#EAF1F8" }, ...]
  ]
}
```

Después una `caja-conclusion` con interpretación (ej: "12/16 componentes con IRA ALTO es coherente con la arquitectura SaaS centralizada").

### 5. ALCANCE DE VERIFICACIÓN EN EL PIQ (`tipo: "tabla-alcance-piq"`)

**Sección OPERATIVA principal del IRA.** Tabla detallada componente → TC-IQ → criterio:

```json
{
  "tipo": "tabla-alcance-piq",
  "titulo": "ALCANCE DE VERIFICACIÓN EN EL PIQ",
  "intro": "La siguiente tabla traduce los resultados del IRA en requerimientos de verificación para el PIQ-<CODE>, asignando a cada componente su criterio de aceptación exacto y el TC-IQ correspondiente.",
  "filas": [
    {
      "compId": "COMP-SW-01",
      "componente": "App Web",
      "ira": 27,
      "verificacion": "<Texto: qué se verifica en el IQ>",
      "criterio": "<Texto: cuál es el criterio de aceptación específico y verificable>",
      "tcIq": "TC-IQ-001"
    },
    ...
  ]
}
```

**No hace falta listar todos los componentes** — solo los que requieren verificación en IQ (típicamente los ALTO y algunos MEDIO/BAJO representativos).

### 6. CONCLUSIÓN (`tipo: "caja-conclusion"`)

Lista numerada con:
- Total de componentes evaluados y distribución por nivel.
- Interpretación de la concentración de ALTO (estructural, no hallazgo).
- Trazabilidad URS → IRA → TC.
- Estimación de TCs IQ totales.

### 7. REFERENCIAS

Tabla 2 columnas (`Código | Título`). Incluir SIEMPRE:
- RA del paquete actual
- URS del paquete actual
- HLRA del paquete actual
- SOP-ADM (fuente de componentes)
- MAN del sistema
- GAMP 5 §8.2 — 2da Ed. 2022 (Installation Qualification)
- ICH Q9 R1 (2023)

### 8. FIRMAS DE EJECUCIÓN (`tipo: "tabla-firmas-final"`) — OBLIGATORIA

Tabla estándar de 4 firmantes (Validador, Process Owner, Jefe Validaciones, Gerente QA). El IRA no tiene aceptación de riesgo residual (no hay RR), entonces las firmas finales son la única instancia formal de aprobación del documento.

```json
{
  "tipo": "tabla-firmas-final",
  "titulo": "FIRMAS DE EJECUCIÓN",
  "intro": "Las firmas digitales o electrónicas siguientes evidencian la revisión y aprobación formal del Análisis de Riesgos de Componentes (IRA). El alcance del PIQ definido en este documento (Sección 5) será input directo del PIQ.",
  "firmas": [
    { "rol": "Redactor (Validador)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" },
    { "rol": "Revisor (Process Owner)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" },
    { "rol": "Aprobador (Jefe de Validaciones)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" },
    { "rol": "Aprobador (Gerente QA)", "nombre": "<Nombre>", "iniciales": "<XX>", "fecha": "<DD/MM/YYYY>" }
  ],
  "nota": "Documento sujeto a firma electrónica."
}
```

---

## Reglas de contenido

### Cantidad típica de componentes

| Arquitectura | Cantidad típica |
|---|---|
| Cloud SaaS simple | 10-20 componentes |
| Cloud SaaS complejo (multi-microservicio) | 20-40 componentes |
| On-premise simple | 15-30 componentes |
| On-premise enterprise (planta industrial) | 30-60 componentes (incluye facility) |

### Distribución típica por categoría

- Software: 30-50% del total
- Infraestructura: 30-50%
- Seguridad: 15-25%

### Distribución típica por nivel

En sistemas SaaS centralizados (caso DRP-SIS-001):
- IRA ALTO: 60-80% (concentración estructural)
- IRA MEDIO: 10-25%
- IRA BAJO: 10-20%

En sistemas on-premise distribuidos:
- IRA ALTO: 40-55% (más componentes auxiliares dispersos)
- IRA MEDIO: 25-40%
- IRA BAJO: 15-25%

### Asignación de P, G, I

**Componente con datos GxP críticos (BD, audit trail, motor de cálculo):**
- P=3 (proceso GxP directo), G=3 (fallo total), I=3 (compromete integridad)
- IRA = 27 ALTO

**Componente de soporte (consola admin, monitoreo):**
- P=2 (soporte indirecto), G=2 (parcial), I=1 (no compromete)
- IRA = 4 BAJO

**Componente de seguridad central (TLS, firewall):**
- P=3, G=3, I=2 a 3
- IRA = 18-27 ALTO

**Componente de notificación (SMTP):**
- P=2 (no afecta categorización), G=2 (parcial), I=1
- IRA = 4 BAJO

---

## Reglas estrictas (NUNCA violar)

1. **Output: solo el objeto JSON.** Sin Markdown, sin notas, sin texto explicativo.
2. **Cada componente extraído de SOP-ADM o MAN documentados.** No inventar componentes.
3. **Naming obligatorio**: `COMP-SW-NN`, `COMP-INF-NN`, `COMP-SEC-NN`.
4. **`type: "IRA"`** siempre en mayúsculas.
5. **`document.extras` debe incluir** `"Componentes evaluados"`, `"Metodología"` y `"Fuente de datos"`.
6. **El renderer calcula automáticamente** IRA-Score y nivel — el skill solo provee P, G, I.
7. **Anchos de tabla `tabla-componentes-ira` son fijos** en el renderer (no configurar). Lo mismo `tabla-alcance-piq`.
8. **Sub-headers en tabla-componentes-ira**: usar `{ "subheader": "..." }` para agrupar por categoría. El renderer detecta y desactiva `headerRows` automáticamente.
9. **Para sistemas on-premise**: incluir SIEMPRE componentes de facility (UPS, climatización, detección de incendios). No omitir.
10. **No hay análisis de mitigación / RR**: el IRA evalúa estado actual del componente. La "mitigación" es la verificación exhaustiva en el IQ.
11. **`tabla-alcance-piq` solo lista componentes que requieren verificación en IQ** — no es necesario duplicar todo lo de la matriz principal. Típicamente todos los ALTO + algunos MEDIO representativos.
12. **`recibeDe`: ["HLRA", "VP", "URS", "RA"]`** y **`alimentaA`: ["PIQ", "MTR"]`**.

---

## Ejemplo de input mínimo

### Sistema cloud (caso DRP)

> "Generá el IRA para DRP-GAMP Categorizador™ (DRP-SIS-001). Tengo HLRA-DRP-SIS-001, RA-DRP-SIS-001, URS-DRP-SIS-001, SOP-ADM-GAMP-001 v1.0 y MAN-GAMP-CAT-001 v1.0. Sistema SaaS Python/Django en AWS US-East-1, BD SQLite, motor SHA-256, portal de verificación QR, audit trail, TLS Let's Encrypt, firewall AWS Security Groups."

El skill genera el JSON IRA con ~16 componentes en 3 categorías (Software 8, Infraestructura Cloud 5, Seguridad 3), cada uno con P/G/I evaluados, IRA-Score calculado automáticamente, alcance del PIQ con TCs específicos por componente.

### Sistema on-premise (planta industrial)

> "Generá el IRA para LIMS-FarmaCorp en planta de Pilar. Sistema on-premise: 2 servidores físicos Dell R750 (App + DB Oracle), Storage NAS NetApp, BD Oracle 19c, integración con SAP-MM y equipos HPLC vía LIMS-Bridge, AD corporativo, VPN site-to-site con casa central. Datacenter propio con UPS APC Galaxy, climatización Mitsubishi 24/7, detección de incendios FM-200, Switches Cisco Catalyst, Firewall Fortinet, antivirus McAfee. SOP-ADM-LIMS v2.0 documenta toda la infraestructura."

El skill genera el JSON IRA con ~30 componentes incluyendo: Software (8), Infraestructura física con facility (15: servidores, OS, BD, NAS, switches, UPS, climatización, FM-200, backup LTO), Seguridad (7: TLS interno, Fortinet, AD, VPN, política contraseñas, hardening, antivirus). Cada componente con su P/G/I, IRA-Score, y mapeo al PIQ.
