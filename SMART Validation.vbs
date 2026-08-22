Option Explicit
Dim wsh, fso, base, pyExe, http, ok, attempt, browser, i
Dim chromePaths(4)
Set wsh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)

' Usar python.exe (no pythonw) con style=0 para ocultarlo
' pythonw bloquea el servidor por stdout nulo
pyExe = base & "\SMART_Validation\.venv\Scripts\python.exe"

If Not fso.FileExists(pyExe) Then
    MsgBox "No se encontro el entorno Python." & vbCrLf & _
           "Ruta esperada: " & pyExe, vbCritical, "SMART Validation"
    WScript.Quit 1
End If

' Matar instancia previa
wsh.Run "cmd /c for /f ""tokens=5"" %p in ('netstat -ano ^| findstr "":11294 "" ^| findstr LISTENING') do taskkill /PID %p /F >nul 2>nul", 0, True
WScript.Sleep 1500

' Variables de entorno (heredadas por el proceso hijo)
Dim env : Set env = wsh.Environment("PROCESS")
env("AUTH_SECRET_KEY")    = ""
env("ALLOW_NO_AUTH")      = "true"
env("DATA_DIR")           = base & "\data"
env("PYTHONUNBUFFERED")   = "1"

' Lanzar servidor: style=0 oculta la ventana de python.exe, -u unbuffered
Dim cmd
cmd = Chr(34) & pyExe & Chr(34) & " -u " & _
      Chr(34) & base & "\SMART_Validation\server.py" & Chr(34) & " 11294"
wsh.Run cmd, 0, False

' Esperar respuesta (hasta 15 segundos)
Set http = CreateObject("MSXML2.XMLHTTP")
ok = False
For attempt = 1 To 30
    WScript.Sleep 500
    On Error Resume Next
    http.Open "GET", "http://localhost:11294", False
    http.Send
    If Err.Number = 0 And http.Status > 0 Then ok = True : Exit For
    On Error GoTo 0
Next

If Not ok Then
    MsgBox "El servidor no respondio en 15 segundos." & vbCrLf & _
           "Revisa que Python tenga todas las dependencias.", _
           vbExclamation, "SMART Validation"
    WScript.Quit 1
End If
WScript.Sleep 800

' Abrir Chrome/Edge en modo app
Dim profile
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
    wsh.Run Chr(34) & browser & Chr(34) & _
        " --app=http://localhost:11294" & _
        " --window-size=1400,900" & _
        " --user-data-dir=" & Chr(34) & profile & Chr(34) & _
        " --no-first-run", 1, False
Else
    wsh.Run "http://localhost:11294"
End If