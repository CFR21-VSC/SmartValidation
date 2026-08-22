Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "c:\Users\fjbon\OneDrive\Escritorio\SMART Validation"
shell.Run """C:\Users\fjbon\AppData\Local\Programs\Python\Python313\python.exe"" SMART_Validation\server.py", 0, False
Set shell = Nothing
