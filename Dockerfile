FROM python:3.13-slim

WORKDIR /app

# Analytics service dependencies (FastAPI, uvicorn, pydantic, openpyxl)
COPY analytics-service/requirements.txt /tmp/analytics-req.txt
RUN pip install --no-cache-dir -r /tmp/analytics-req.txt

# Main server dependencies (psycopg2 for PostgreSQL when DATABASE_URL is set)
COPY requirements.txt /tmp/main-req.txt
RUN pip install --no-cache-dir -r /tmp/main-req.txt

COPY SMART_Validation/ ./
COPY analytics-service/ ./analytics-service/

# Persistent data directories (mounted as Railway Volume at /data)
RUN mkdir -p /data/photos /data/exports /data/source /data/snapshots /data/evidence

EXPOSE 8080

ENV PORT=8080
ENV ENV=production
ENV DATA_DIR=/data

CMD ["python", "server.py"]
