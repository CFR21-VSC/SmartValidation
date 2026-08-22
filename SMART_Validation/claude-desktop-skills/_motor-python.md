# Motor Python — Arquitectura del Backend GxP

Este archivo describe el motor de persistencia y control de la Suite de Validación. **No genera documentos** — es contexto esencial para entender cómo el JSON que Claude genera se almacena, protege y firma en el sistema. Leer antes de generar documentos para proyectos en curso (no nuevos).

---

## Visión general

El backend es un `ThreadingHTTPServer` Python puro, sin frameworks. Sirve los archivos estáticos de la app y expone una API REST sobre SQLite con WAL (Write-Ahead Logging). Corre en el puerto 11294. Todo el ciclo documental GxP vive en la DB — el JSON que Claude genera se importa a la Suite y se persiste ahí.

```
Claude Desktop → JSON → Suite (browser) → POST /api/projects/:id/documents/:type → SQLite
```

---

## Base de datos — tablas clave

| Tabla | Rol |
|---|---|
| `projects` | Un proyecto por ciclo de validación. Tiene `gamp_category`, `cliente`, `status`. |
| `documents` | **Un doc por tipo por proyecto** (`UNIQUE(project_id, doc_type)`). Almacena el JSON completo en `json_data`. |
| `users` | Tabla unificada: roles `admin`, `auditor`, `client`. Auth por contraseña (admin/auditor) o PIN numérico (client). |
| `project_access` | Qué usuario tiene acceso a qué proyecto (`read` o `sign`). |
| `signing_rounds` | Rondas de revisión/firma: `open` → `sealed` o `cancelled`. |
| `signing_round_signers` | Firmantes de cada ronda, con `signed_at` y `audit_hash` por firma. |
| `validation_book_blocks` | Cadena de bloques encadenada (hash chain) — el Libro de Validación inmutable. |
| `audit_events` | Log de todas las acciones: creación, modificación, firma, acceso, eliminación. |
| `document_signatures` | Firma simple con PIN (para clientes sin ronda). |

---

## Ciclo de vida de un documento

```
draft → for_review → approved (INMUTABLE)
              ↘ needs_revision → draft
```

**Reglas que el backend enforcea sin excepción:**

1. **Un solo documento por tipo por proyecto**: `UNIQUE(project_id, doc_type)`. Si Claude genera HLRA dos veces para el mismo proyecto, el segundo sobrescribe el primero — pero solo si no está `approved` o `for_review`.
2. **Documentos aprobados son intocables**: ningún endpoint permite sobreescribir un documento en `approved`. El backend devuelve HTTP 409 si se intenta.
3. **Documentos en `for_review` tampoco se pueden sobreescribir** — están en proceso de firma activo.
4. **No se pueden eliminar proyectos con documentos aprobados** — retención regulatoria GxP.
5. **No se puede firmar un documento que no esté en `for_review`** — el estado es la guardia del flujo.

---

## El campo `type` — crítico para la trazabilidad

El `doc_type` en la DB es el valor del campo `"type"` del JSON raíz que Claude genera. **Este valor es la clave primaria del documento dentro del proyecto.**

| JSON generado por Claude | `doc_type` en DB |
|---|---|
| `"type": "HLRA"` | `HLRA` |
| `"type": "VP"` | `VP` |
| `"type": "RA"` | `RA` |
| `"type": "IRA"` | `IRA` |
| `"type": "RRM"` | `RRM` |
| `"type": "MTR"` | `MTR` |
| ... (20 tipos en total) | ... |

**Consecuencia directa para la generación**: si Claude genera un documento con `"type": "RAI"` en lugar de `"type": "RA"`, el sistema lo almacena como un tipo distinto y el documento correcto queda inexistente para el renderer. La trazabilidad del ciclo se rompe. Usar siempre las siglas canónicas sin excepción.

---

## Trazabilidad en el motor: los tres niveles

### Nivel 1 — JSON interno (trazabilidad documental)
El campo `trazabilidad.recibeDe` y `trazabilidad.alimentaA` del JSON son **declarativos**: le dicen al renderer qué documentos anteceden y siguen al actual. Permiten al sistema construir la vista de la cadena y detectar gaps de cobertura.

### Nivel 2 — Audit trail (`audit_events`)
Cada acción sobre el sistema se registra: quién creó qué documento, cuándo, desde qué IP, qué cambió. Este log es el registro de auditoría operativo — requerido por 21 CFR Part 11 y ANMAT 4159/2023.

### Nivel 3 — Validation Book (`validation_book_blocks`)
Cuando una ronda de firma se **sella** (`/sign/seal`), el servidor:
1. Hashea el contenido del documento (SHA-256 del `json_data`).
2. Firma el hash con HMAC-SHA256 usando `AUDIT_HMAC_KEY` — no recalculable sin la clave secreta.
3. Encadena el bloque con el hash del bloque anterior (`prev_block_hash`).
4. Persiste el bloque en `validation_book_blocks`.

El resultado es una cadena de bloques donde alterar cualquier documento rompe todos los hashes subsiguientes. Esta es la garantía de integridad del Libro de Validación GxP — el entregable final para reguladores.

---

## Signing Rounds — el flujo de aprobación

```
Admin crea ronda (POST /signing-rounds)
  → doc pasa a status='for_review'
  → email a cada firmante (Resend API)

Firmante revisa y firma (POST /signing-rounds/:id/sign)
  → audit_hash del JSON en ese momento

Firmante pide revisión (POST /signing-rounds/:id/request-revision)
  → ronda cancelada
  → doc vuelve a 'needs_revision'
  → email a admins

Admin sella la ronda (POST /signing-rounds/:id/seal)
  → doc pasa a status='approved'
  → bloque creado en validation_book_blocks
  → doc inmutable para siempre
```

---

## Roles y permisos

| Rol | Puede crear/editar documentos | Puede firmar con PIN | Ve todos los proyectos | Gestiona usuarios |
|---|---|---|---|---|
| `admin` | ✓ | — | ✓ | ✓ |
| `auditor` | ✓ | — | ✓ | — |
| `client` | — | ✓ (si `access_level='sign'`) | Solo los asignados | — |

---

## Implicaciones para la generación con Claude Desktop

1. **El `package.code` es el identificador del proyecto** — debe ser idéntico en todos los documentos de la cadena. Un cambio de un solo caracter rompe la coherencia visual del ciclo.

2. **El `document.version` siempre es `"1.0"` en el primer documento generado**. Si el documento ya existe en la DB con versión superior (porque fue modificado), Claude debe respetar la versión que el usuario le indique.

3. **No existe un mecanismo de rollback automático**: si se aprueba un documento con un error, la corrección requiere una nueva versión con incremento de versión y firma nuevamente. Por eso la revisión humana del JSON antes de importar es el checkpoint más crítico del ciclo.

4. **La cadena de dependencias en la DB es por tipo, no por contenido**: el sistema no verifica automáticamente que el RA referencie los mismos URS-NNN que el URS aprobado. Esa coherencia es responsabilidad de los IDs que Claude genera a partir de los JSONs previos cargados en Knowledge.

5. **El AI Generator de la Suite** llama directamente al backend (`/api/generate`) con la clave Anthropic inyectada por el servidor. El motor limita a 10 generaciones IA por IP por minuto y usa streaming para documentos largos (timeout de 12 minutos para MTR, RRM, VSR).

---

## Reglas estrictas (NUNCA violar para este contexto)

1. **`"type"` siempre en MAYÚSCULAS exactas**: `"HLRA"`, `"VP"`, `"RA"`, etc. — nunca `"hlra"`, nunca `"Hlra"`, nunca sigla legacy (`"RAI"`, `"MCN"`, `"IF"`).
2. **`package.code` idéntico en los 20 documentos del ciclo** — es la clave de agrupación del proyecto.
3. **`"version": "1.0"` en el primer borrador** — nunca `"0.1"`, nunca `"v1.0"`.
4. **No inventar IDs de personas** — `"nombre": ""` si no hay datos. Un campo vacío es válido; un nombre inventado contamina el audit trail.
5. **No alterar el `json_data` de documentos en `approved`** — la Suite lo bloquea y el Libro de Validación lo detectaría como hash inválido.
