@echo off
cd /d "%~dp0\.."
python -m pytest tests/test_bridge_client.py -v --tb=short 2>&1
pause
