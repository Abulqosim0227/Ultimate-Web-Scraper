@echo off
setlocal
call .venv\Scripts\activate.bat
if errorlevel 1 (
  echo Virtual environment not found. Run install.bat first.
  pause
  exit /b 1
)
python -m uvicorn app:app --host 127.0.0.1 --port 8000
pause
