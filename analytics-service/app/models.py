from pydantic import BaseModel
from typing import Any, Optional


class AnalyzeRequest(BaseModel):
    projectId: str
    documents: dict[str, Any]
    executionExcelB64: Optional[str] = None


class CoherencePackRequest(BaseModel):
    projectId: str
    documents: dict[str, Any]   # mismo formato que AnalyzeRequest.documents
    generatingFor: str = ''     # tipo de doc que se va a generar (ej: "IOQ", "RA", "FRS")


class TraceabilityGap(BaseModel):
    ursId: str
    description: str
    phase: str        # IQ / OQ / PQ / MTR / RA
    severity: str     # CRITICO / MAYOR / MENOR


class CoherenceIssue(BaseModel):
    docType: str
    tcId: Optional[str] = None
    issue: str
    severity: str


class ExecutionGap(BaseModel):
    tcId: str
    docType: str
    issue: str        # SIN_RESULTADO / RESULTADO_INVALIDO


class TraceabilityStats(BaseModel):
    ursTotal: int
    ursWithTC: int
    ursCoverage: float
    orphanedURS: list[str]
    orphanedTC: list[str]
    risksMitigated: int
    risksTotal: int
    unmitigatedRisks: list[str]
    tcByPhase: dict[str, int]


class MatrixRow(BaseModel):
    ursId: str
    description: str = ''
    tipo: str = 'F'        # F = Funcional, NF = No Funcional
    raVinculado: str = '—'
    raScore: str = '—'
    tcIQ: list[str] = []
    tcOQ: list[str] = []
    tcPQ: list[str] = []
    covered: bool = False
    covIQ: bool = False
    covOQ: bool = False
    covPQ: bool = False


class RegRequirement(BaseModel):
    regulation: str          # "ANMAT 4159/2023"
    article: str             # "Anexo VI §3"
    requirement: str         # descripción del requerimiento
    docsRequired: list[str]  # tipos de doc necesarios (ALL)
    docsAny: list[str]       # al menos uno de estos
    docsPresent: list[str]   # tipos encontrados en el paquete
    satisfied: bool
    severity: str            # CRITICO / MAYOR / MENOR
    gap: str = ''            # qué falta


class CascadeIssue(BaseModel):
    fromDoc: str      # Documento origen (ej. "HLRA")
    toDoc: str        # Documento destino (ej. "VP")
    issue: str        # Descripción del hallazgo
    severity: str     # CRITICO / MAYOR / MENOR
    detail: str = ''  # Justificación GxP


class AnalyzeResponse(BaseModel):
    projectId: str
    status: str
    score: int
    traceability: TraceabilityStats
    matrix: list[MatrixRow] = []
    gaps: list[TraceabilityGap] = []
    coherenceIssues: list[CoherenceIssue] = []
    cascadeIssues: list[CascadeIssue] = []
    regMatrix: list[RegRequirement] = []
    executionGaps: list[ExecutionGap] = []
    summary: str
