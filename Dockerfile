FROM python:3.13-slim

WORKDIR /app

# Frontend + server
COPY SMART_Validation/ ./

# Volumen de datos persistente: SQLite + fotos + exports
RUN mkdir -p /data/photos /data/exports /data/source /data/snapshots

# Puerto (Railway inyecta $PORT en runtime)
EXPOSE 8080

ENV PORT=8080
ENV ENV=production
ENV DATA_DIR=/data

CMD ["python", "server.py"]
