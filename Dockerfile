FROM python:3.13-slim

WORKDIR /app

# Analytics service dependencies (FastAPI, uvicorn, pydantic, openpyxl)
COPY analytics-service/requirements.txt /tmp/analytics-req.txt
RUN pip install --no-cache-dir -r /tmp/analytics-req.txt

# Main server (stdlib only — no pip needed for server.py)
COPY SMART_Validation/ ./
COPY analytics-service/ ./analytics-service/

# Persistent data directories (mounted as Railway Volume at /data)
RUN mkdir -p /data/photos /data/exports /data/source /data/snapshots /data/evidence

EXPOSE 8080

ENV PORT=8080
ENV ENV=production
ENV DATA_DIR=/data

CMD ["python", "server.py"]
