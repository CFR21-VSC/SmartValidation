# SMART Validation — Instrucciones para Claude Code

Proyecto: Gestor de Evidencias GxP para DRP Assurance / EMARA (Enlace Molecular SRL).
Directorio principal: `SMART_Validation/` — servidor Python + SQLite + frontend JS.
Analytics service: `analytics-service/` — FastAPI en puerto 8765.
Skills de generación: `SMART_Validation/claude-desktop-skills/`

---

## REGLA CRÍTICA — Generación de documentos GxP

**Cuando el usuario pida generar cualquier documento GxP** (URS, FRS, RA, IRA, PIQ, POQ, PPQ,
IOQ, IIQ, IPQ, MTR, NCR, VSR, HLRA, VP, DS, RRM, RIQ, ROQ, RPQ, EVRA, EVPROT, EVIR),
SIEMPRE ejecutar este protocolo antes de generar una sola línea del documento:

### 1. Obtener el Context Pack

```bash
curl -s "http://localhost:11294/api/projects/{PROJECT_ID}/coherence-pack?for={DOC_TYPE}"
```

Leer el JSON completo. Si `isClean` es `false` o `sequenceGaps` no está vacío,
reportar los problemas al usuario ANTES de continuar.

### 2. Usar SOLO los IDs que el pack autoriza

- **Nuevos IDs**: usar `idInventory.{PREFIJO}.nextId` como primer ID, incrementar de a 1.
  Nunca inventar, nunca saltar, nunca duplicar.
- **Referencias cruzadas**: solo IDs de `validReferenceIds.allUrsIds` y `validReferenceIds.allRaIds`.
- **Prioridad**: cubrir primero los URS en `coverage.ursWithoutIQ` / `ursWithoutOQ`.

### 3. Leer el skill generador del tipo de documento

```
SMART_Validation/claude-desktop-skills/{tipo-lowercase}-generator.md
```

Seguir el schema JSON definido ahí exactamente. El renderer de pdfMake consume ese schema.

### 4. Checklist pre-entrega

Antes de entregar el JSON, verificar:
- IDs nuevos forman una secuencia continua desde nextId (sin saltos)
- Todas las referencias apuntan a IDs que existen en el Context Pack
- Todos los campos obligatorios del schema están presentes
- El nivel de profundidad de TCs es coherente con el score del RA vinculado

---

## Arquitectura del sistema

```
Puerto 11294: server.py (Python, ThreadingHTTPServer)
  - GET  /api/projects/                           → lista proyectos
  - GET  /api/projects/{id}/coherence-pack?for=X  → Context Pack de coherencia
  - GET  /api/projects/{id}/documents             → lista docs (sin json_data)
  - GET  /api/projects/{id}/documents/{type}      → un documento con json_data
  - PUT  /api/projects/{id}/documents/{type}      → crear/actualizar documento
  - POST /auth/login                              → login (SQLite)
  - GET  /auth/session                            → sesión activa

Puerto 8765: analytics-service (FastAPI/uvicorn)
  - POST /analyze                                 → análisis completo post-generación
  - POST /coherence-pack                          → context pack pre-generación
  - GET  /health                                  → health check

Dev mode: ALLOW_NO_AUTH=true (en DEV.bat e INICIAR.bat)
  → _check_auth devuelve {u:"dev", d:"Desarrollador", r:"admin"} sin cookie
```

## Almacenamiento de documentos

SQLite en `data/smart_validation.db`. Tabla `documents`:
- `project_id TEXT` + `doc_type TEXT` → UNIQUE (un doc por tipo por proyecto)
- `json_data TEXT` → el documento GxP completo como JSON string
- `status TEXT` → 'draft' | 'approved'

## Roles y auth

- `admin`: acceso total, gestión de usuarios, generación de documentos
- `auditor`: solo lectura + firma de rondas de revisión
- `client`: solo acceso a sus proyectos asignados, firma con PIN

## IDs de documentos GxP — formatos canónicos

| Prefijo | Regex | Ejemplo |
|---------|-------|---------|
| URS funcional | `URS-\d{3}` | URS-001 |
| URS no funcional | `URS-NF-\d{3}` | URS-NF-001 |
| Riesgo FMEA | `RA-\d{3}` | RA-007 |
| TC fase IQ | `TC-IQ-\d{3}` | TC-IQ-001 |
| TC fase OQ | `TC-OQ-\d{3}` | TC-OQ-019 |
| TC fase PQ | `TC-PQ-\d{3}` | TC-PQ-001 |
| Requisito FRS | `FRS-\d{3}` | FRS-023 |
| FRS interfaz | `FRS-IF-\d{3}` | FRS-IF-004 |
| Componente IRA | `COMP-\d{3}` | COMP-001 |

## Skill disponible

`/gxp-generate` — genera un documento GxP completo con coherence enforcement automático.
Uso: `/gxp-generate [tipo] [project_id]`
