@echo off
setlocal
call .venv\Scripts\activate.bat
if errorlevel 1 (
  echo Virtual environment not found. Run install.bat first.
  pause
  exit /b 1
)

echo Checking Ollama...
curl -fsS http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo Ollama is not running. Starting Ollama...
  start "Ollama" ollama serve
  timeout /t 3 /nobreak >nul
)

echo Starting RAG UI at http://127.0.0.1:8000
start "RAG UI" http://127.0.0.1:8000
python -m uvicorn app:app --host 127.0.0.1 --port 8000
pause
