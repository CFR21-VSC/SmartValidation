@echo off
title SMART Validation - Servidor Local
cd /d "C:\Users\fjbon\OneDrive\Escritorio\SMART Validation\SMART_Validation"

echo =============================================
echo  SMART Validation - Servidor de desarrollo
echo =============================================
echo.

:: Cerrar instancias previas en ambos puertos
echo  Cerrando instancias previas...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":11294 " ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8765 " ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>nul
)
ping -n 3 127.0.0.1 >nul

:: Variables de entorno
set ALLOW_NO_AUTH=true
set AUTH_SECRET_KEY=
set DATA_DIR=C:\Users\fjbon\OneDrive\Escritorio\SMART Validation\data
set FIRMAS_BASE_URL=http://localhost:8090
set BRIDGE_API_KEY=dev-bridge-key-local-no-usar-en-produccion

:: ── Motor de coherencia documental (puerto 8765) ──────────────────────────
echo  Iniciando motor de analítica (puerto 8765)...
start "SMART Analytics" /d "C:\Users\fjbon\OneDrive\Escritorio\SMART Validation\analytics-service" /b "..\SMART_Validation\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8765

:: Pequeña pausa para que el analytics levante antes que el browser abra
ping -n 3 127.0.0.1 >nul

:: ── Browser ────────────────────────────────────────────────────────────────
set CHROME_PROFILE=%LOCALAPPDATA%\SmartValidation\ChromeProfile
start /b powershell -NoProfile -WindowStyle Hidden -Command "$url='http://localhost:11294'; $prof='%CHROME_PROFILE%'; Start-Sleep 5; $paths=@('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',\"$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe\"); $c=''; foreach($p in $paths){if(Test-Path $p){$c=$p;break}}; if($c){Start-Process $c \"--app=$url --user-data-dir=\`\"$prof\`\" --no-first-run\"}else{Start-Process $url}"

echo  Servidor principal en http://localhost:11294
echo  Motor de analitica en http://localhost:8765
echo  (browser abre en ~5 segundos)
echo.
echo  Ctrl+C o cerrar ventana para detener AMBOS servicios.
echo.

:: ── Servidor principal (puerto 11294) — bloquea hasta Ctrl+C ──────────────
".venv\Scripts\python.exe" server.py 11294

:: Al cerrar el principal, matar también el analytics
echo.
echo  Deteniendo motor de analitica...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8765 " ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>nul
)

echo  Servidor detenido.
pause
