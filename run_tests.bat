@echo off
call .venv\Scripts\activate.bat
python -m compileall app.py
if errorlevel 1 exit /b 1
python -m pytest -q test_app.py
