@echo off
title SMART Validation Server
cd /d "c:\Users\fjbon\OneDrive\Escritorio\SMART Validation"
echo Iniciando SMART Validation...
echo Puerto: 11294
echo Presiona Ctrl+C para detener.
echo.
"C:\Users\fjbon\AppData\Local\Programs\Python\Python313\python.exe" SMART_Validation\server.py
pause
