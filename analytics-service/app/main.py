from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import AnalyzeRequest, AnalyzeResponse, CoherencePackRequest
from .tracer import analyze
from .cascade_checker import check_cascade
from .reg_matrix import build_reg_matrix
from .coherence_pack import build_coherence_pack

app = FastAPI(title="SMART Validation Analytics", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # Acepta cualquier origen local (localhost, 127.0.0.1, IPs privadas LAN)
    # en cualquier puerto. En producción, configurar SMART_ANALYTICS_CORS_ORIGIN.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|(10|192\.168)\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}):\d+",
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "smart-validation-analytics"}


@app.post("/coherence-pack", response_model=dict)
def coherence_pack(req: CoherencePackRequest):
    """
    Genera el Context Pack de coherencia ANTES de crear un documento.
    Devuelve el inventario completo de IDs, próximos IDs disponibles,
    gaps en secuencias y lista de referencias válidas.

    El cliente (SMART Validation frontend / Claude) debe llamar este
    endpoint antes de generar cualquier documento para garantizar que
    los IDs generados sean secuenciales y las referencias sean válidas.
    """
    try:
        pack = build_coherence_pack(
            documents=req.documents,
            project_id=req.projectId,
            generating_for=req.generatingFor,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return pack


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_cycle(req: AnalyzeRequest):
    try:
        result = analyze(req.documents, req.executionExcelB64)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    cascade  = check_cascade(req.documents)
    reg_mat  = build_reg_matrix(req.documents)

    return AnalyzeResponse(
        projectId=req.projectId,
        status=result['status'],
        score=result['score'],
        traceability=result['stats'],
        matrix=result['matrix'],
        gaps=result['gaps'],
        coherenceIssues=result['coherence'],
        cascadeIssues=cascade,
        regMatrix=reg_mat,
        executionGaps=result['execGaps'],
        summary=result['summary'],
    )
