@echo off
setlocal enabledelayedexpansion
title Gestor de Evidencias GxP — DRP Assurance Solutions

echo ============================================
echo   Gestor de Evidencias GxP  v1.0.0-beta
echo   DRP Assurance Solutions
echo ============================================
echo.

:: ── Directorios base ──────────────────────────────────────────────────────
set ROOT=%~dp0
set VENV_DIR=%ROOT%.venv
set ENV_FILE=%ROOT%.env
set REQS=%ROOT%requirements.txt

:: ── Base de datos canonica (siempre en OneDrive, independiente del launcher)
set DATA_DIR=C:\Users\fjbon\OneDrive\Escritorio\SMART Validation\data

:: ── Modo local (sin login) ────────────────────────────────────────────────
set AUTH_SECRET_KEY=
set ALLOW_NO_AUTH=true

:: ── 1. Detectar Python ───────────────────────────────────────────────────
set PYTHON_EXE=

:: Primero: venv local (si ya fue creado)
if exist "%VENV_DIR%\Scripts\python.exe" (
    set PYTHON_EXE="%VENV_DIR%\Scripts\python.exe"
    goto :check_api_key
)

:: Si no hay venv, usar Python del sistema
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 ( set PYTHON_EXE=python & goto :create_venv )

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 ( set PYTHON_EXE=py & goto :create_venv )

for %%v in (313 312 311 310 39) do (
    if exist "%LOCALAPPDATA%\Programs\Python\Python%%v\python.exe" (
        set PYTHON_EXE="%LOCALAPPDATA%\Programs\Python\Python%%v\python.exe"
        goto :create_venv
    )
)
for %%d in ("%USERPROFILE%\anaconda3" "%USERPROFILE%\miniconda3" "%LOCALAPPDATA%\anaconda3") do (
    if exist "%%~d\python.exe" ( set PYTHON_EXE="%%~d\python.exe" & goto :create_venv )
)

echo  [ERROR] No se encontro Python en este sistema.
echo  Instala Python 3.10+ desde https://python.org
echo.
pause & goto :end

:create_venv
echo  Creando entorno virtual (primera vez)...
%PYTHON_EXE% -m venv "%VENV_DIR%"
if !ERRORLEVEL! NEQ 0 (
    echo  No se pudo crear venv, usando Python del sistema directamente.
    goto :check_api_key
)
echo  Instalando dependencias...
"%VENV_DIR%\Scripts\pip.exe" install -r "%REQS%" --quiet
set PYTHON_EXE="%VENV_DIR%\Scripts\python.exe"
echo.

:check_api_key
:: ── 2. Verificar API key de Anthropic ────────────────────────────────────
set HAS_KEY=0
if exist "%ENV_FILE%" (
    findstr /C:"ANTHROPIC_API_KEY=sk-ant-" "%ENV_FILE%" >nul 2>nul
    if !ERRORLEVEL! EQU 0 set HAS_KEY=1
)

if "!HAS_KEY!"=="0" (
    echo  [OPCIONAL] Ingresa tu API key de Anthropic para el generador IA.
    echo  Sin ella el sistema funciona normalmente (solo queda sin IA).
    echo.
    set /p USER_KEY="  API key (sk-ant-...) o Enter para omitir: "
    if not "!USER_KEY!"=="" (
        echo ANTHROPIC_API_KEY=!USER_KEY!> "%ENV_FILE%"
        echo  Guardada. Podes modificarla luego en el archivo .env
        echo.
    )
)

:: ── 3. Cerrar instancias previas ─────────────────────────────────────────
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":11294 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>nul
)
timeout /t 2 >nul

:: ── 4. Abrir browser y lanzar servidor ──────────────────────────────────
call :open_browser_delayed
%PYTHON_EXE% "%ROOT%server.py" 11294
goto :end

:open_browser_delayed
echo  Iniciando servidor...
echo.
echo  Accesos:
echo    Panel principal: http://localhost:11294
echo    Portal cliente:  http://localhost:11294/client/
echo.
start /b powershell -NoProfile -Command "$url='http://localhost:11294'; $prof=$env:LOCALAPPDATA+'\SmartValidation\ChromeProfile'; $sw=[System.Diagnostics.Stopwatch]::StartNew(); while($sw.Elapsed.TotalSeconds -lt 30){ try{ $null=Invoke-WebRequest $url -TimeoutSec 1 -UseBasicParsing -EA Stop; break }catch{ Start-Sleep 1 } }; $c=''; $paths=@('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',$env:LOCALAPPDATA+'\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe','C:\Program Files\Microsoft\Edge\Application\msedge.exe'); foreach($p in $paths){ if(Test-Path $p){ $c=$p; break } }; if($c){ Start-Process $c ('--app='+$url+' --window-size=1400,900 --user-data-dir='+$prof+' --no-first-run') } else { Start-Process $url }"
goto :eof

:end
echo.
echo  ============================================
echo   El servidor se detuvo.
echo   Revisa los mensajes de error arriba.
echo  ============================================
echo.
pause
endlocal
