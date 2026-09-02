@echo off
title Suite de Revision y Firmas - Servidor Local
cd /d "%~dp0"

echo =============================================
echo  Suite de Revision y Firmas - Servidor dev
echo =============================================
echo.

:: Cerrar instancia previa en el puerto 8090
echo  Cerrando instancias previas...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8090 " ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>nul
)
ping -n 2 127.0.0.1 >nul

:: Variables de entorno de desarrollo (sin DATABASE_URL -> SQLite local en .\data\revision_firmas.db)
set RF_AUTH_SECRET_KEY=dev-secret-local-no-usar-en-produccion
set RF_APP_BASE_URL=http://localhost:8090
set RF_SUPERADMIN_USERNAME=fbongiovanni
set RF_SUPERADMIN_PASSWORD=dev12345678
set RF_SUPERADMIN_EMAIL=fbongiovanni@drpassurance.com
set RF_SUPERADMIN_DISPLAY=Federico Bongiovanni
set BRIDGE_API_KEY=dev-bridge-key-local-no-usar-en-produccion

:: ── Browser ──────────────────────────────────────────────────────────────
set CHROME_PROFILE=%LOCALAPPDATA%\SuiteRevisionFirmas\ChromeProfile
start /b powershell -NoProfile -WindowStyle Hidden -Command "$url='http://localhost:8090/app/login.html'; $prof='%CHROME_PROFILE%'; Start-Sleep 3; $paths=@('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',\"$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe\"); $c=''; foreach($p in $paths){if(Test-Path $p){$c=$p;break}}; if($c){Start-Process $c \"--app=$url --user-data-dir=\`\"$prof\`\" --no-first-run\"}else{Start-Process $url}"

echo  Servidor en http://localhost:8090
echo  Login DRP: %RF_SUPERADMIN_USERNAME% / %RF_SUPERADMIN_PASSWORD%
echo  (browser abre en ~3 segundos)
echo.
echo  Ctrl+C o cerrar ventana para detener.
echo.

:: Bloquea hasta Ctrl+C
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8090

echo.
echo  Servidor detenido.
pause
