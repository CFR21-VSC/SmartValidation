$ErrorActionPreference = "Stop"

$SOURCE_ROOT  = Split-Path -Parent $MyInvocation.MyCommand.Path
$SOURCE_APP   = Join-Path $SOURCE_ROOT "SMART_Validation"
$SOURCE_DATA  = Join-Path $SOURCE_ROOT "data"
$DEST         = "$env:LOCALAPPDATA\Programs\SmartValidation"
$DEST_APP     = "$DEST\app"
$DEST_DATA    = "$DEST\data"
$DEST_VENV    = "$DEST\venv"
$LAUNCHER_VBS = "$DEST\launch.vbs"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SMART Validation - Instalador" -ForegroundColor Cyan
Write-Host "  DRP Assurance Solutions" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Destino: $DEST" -ForegroundColor Gray
Write-Host ""

# --- 1. Crear directorios ---
Write-Host "[1/5] Preparando directorios..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $DEST      | Out-Null
New-Item -ItemType Directory -Force -Path $DEST_APP  | Out-Null
New-Item -ItemType Directory -Force -Path $DEST_DATA | Out-Null

# --- 2. Copiar archivos de la app ---
Write-Host "[2/5] Copiando archivos de la aplicacion..." -ForegroundColor Yellow
robocopy $SOURCE_APP $DEST_APP /E /XD ".venv" "venv" "__pycache__" ".git" /XF "*.pyc" /NFL /NDL /NJH /NJS | Out-Null
Write-Host "      Archivos copiados." -ForegroundColor Gray

# --- 3. Preservar o copiar la base de datos ---
Write-Host "[3/5] Gestionando base de datos..." -ForegroundColor Yellow
$destDb = "$DEST_DATA\smart_validation.db"
if (Test-Path $destDb) {
    Write-Host "      DB existente detectada: datos preservados." -ForegroundColor Green
} else {
    $srcDb = "$SOURCE_DATA\smart_validation.db"
    if (Test-Path $srcDb) {
        Copy-Item $srcDb $destDb -Force
        Write-Host "      Base de datos copiada." -ForegroundColor Green
    } else {
        Write-Host "      Sin DB previa (se creara al primer inicio)." -ForegroundColor Gray
    }
}

$srcPhotos = "$SOURCE_DATA\photos"
if (Test-Path $srcPhotos) {
    robocopy $srcPhotos "$DEST_DATA\photos" /E /NFL /NDL /NJH /NJS | Out-Null
}

# --- 4. Entorno virtual Python ---
Write-Host "[4/5] Configurando entorno Python..." -ForegroundColor Yellow
$pyExe = $null
$pyCandidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe"
)
foreach ($p in $pyCandidates) {
    if (Test-Path $p) { $pyExe = $p; break }
}
if (-not $pyExe) {
    try { $null = python --version 2>&1; if ($LASTEXITCODE -eq 0) { $pyExe = "python" } } catch {}
}
if (-not $pyExe) {
    Write-Host "ERROR: No se encontro Python 3.10+." -ForegroundColor Red
    Write-Host "Instala Python desde https://python.org y vuelve a ejecutar." -ForegroundColor Red
    Read-Host "Enter para salir"
    exit 1
}
Write-Host "      Python: $pyExe" -ForegroundColor Gray
if (Test-Path "$DEST_VENV\Scripts\pythonw.exe") {
    Write-Host "      Entorno virtual existente reutilizado." -ForegroundColor Gray
} else {
    Write-Host "      Creando entorno virtual..." -ForegroundColor Gray
    & $pyExe -m venv $DEST_VENV 2>&1 | Out-Null
    if (-not (Test-Path "$DEST_VENV\Scripts\pythonw.exe")) {
        Write-Host "ERROR: No se pudo crear el entorno virtual." -ForegroundColor Red
        Read-Host "Enter para salir"
        exit 1
    }
}
$reqFile = "$DEST_APP\requirements.txt"
if (Test-Path $reqFile) {
    Write-Host "      Instalando dependencias..." -ForegroundColor Gray
    & "$DEST_VENV\Scripts\pip.exe" install -r $reqFile --quiet 2>&1 | Out-Null
    Write-Host "      Dependencias OK." -ForegroundColor Gray
}

# --- 5. Crear lanzador VBS + acceso directo ---
Write-Host "[5/5] Creando lanzador y acceso directo..." -ForegroundColor Yellow

$vbsContent = @'
Option Explicit
Dim wsh, fso, root, pyW, profile, browser, i, env, http, ok, attempt
Dim chromePaths(4)
Set wsh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
pyW  = root & "\venv\Scripts\pythonw.exe"

wsh.Run "cmd /c for /f ""tokens=5"" %p in ('netstat -ano ^| findstr "":11294 "" ^| findstr LISTENING') do taskkill /PID %p /F >nul 2>nul", 0, True
WScript.Sleep 1500

Set env = wsh.Environment("PROCESS")
env("AUTH_SECRET_KEY") = ""
env("ALLOW_NO_AUTH") = "true"

If Not fso.FileExists(pyW) Then
    MsgBox "No se encontro el entorno virtual. Vuelve a ejecutar INSTALAR.ps1.", vbCritical, "SMART Validation"
    WScript.Quit 1
End If
wsh.Run Chr(34) & pyW & Chr(34) & " " & Chr(34) & root & "\app\server.py" & Chr(34) & " 11294", 0, False

Set http = CreateObject("MSXML2.XMLHTTP")
ok = False
For attempt = 1 To 20
    WScript.Sleep 500
    On Error Resume Next
    http.Open "GET", "http://localhost:11294", False
    http.Send
    If Err.Number = 0 And http.Status > 0 Then ok = True : Exit For
    On Error GoTo 0
Next

profile = wsh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\SmartValidation\ChromeProfile"
chromePaths(0) = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePaths(1) = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
chromePaths(2) = wsh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe"
chromePaths(3) = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
chromePaths(4) = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
browser = ""
For i = 0 To 4
    If fso.FileExists(chromePaths(i)) Then browser = chromePaths(i) : Exit For
Next
If browser <> "" Then
    wsh.Run Chr(34) & browser & Chr(34) & " --app=http://localhost:11294 --window-size=1400,900 --user-data-dir=" & Chr(34) & profile & Chr(34) & " --no-first-run", 1, False
Else
    wsh.Run "http://localhost:11294"
End If
'@

[System.IO.File]::WriteAllText($LAUNCHER_VBS, $vbsContent, [System.Text.Encoding]::GetEncoding(1252))
Write-Host "      Lanzador VBS creado." -ForegroundColor Gray

$desktopPath = [System.Environment]::GetFolderPath("Desktop")
$lnkPath     = "$desktopPath\SMART Validation.lnk"
$shell       = New-Object -ComObject WScript.Shell
$lnk         = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = "wscript.exe"
$lnk.Arguments        = "`"$LAUNCHER_VBS`""
$lnk.WorkingDirectory = $DEST
$lnk.Description      = "SMART Validation - DRP Assurance Solutions"
$icoCandidate = "$DEST_APP\favicon.ico"
if (Test-Path $icoCandidate) { $lnk.IconLocation = $icoCandidate }
$lnk.Save()
Write-Host "      Acceso directo creado en el escritorio." -ForegroundColor Gray

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Instalacion completada." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  App en:    $DEST" -ForegroundColor White
Write-Host "  Datos en:  $DEST_DATA" -ForegroundColor White
Write-Host "  Atajo:     Escritorio > SMART Validation" -ForegroundColor White
Write-Host ""
Write-Host "  Doble click en el icono del escritorio para iniciar." -ForegroundColor Cyan
Write-Host ""
Read-Host "Enter para cerrar"
