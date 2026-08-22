@echo off
cd /d "%~dp0"
echo Iniciando SMART Validation Analytics...
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
pause
