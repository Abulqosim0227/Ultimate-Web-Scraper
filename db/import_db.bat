@echo off
setlocal
cd /d "%~dp0"
if not exist ragdb.dump (
  echo ragdb.dump not found in %~dp0
  exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%a in ("..\.env") do if "%%a"=="DATABASE_URL" set "DATABASE_URL=%%b"
if not defined DATABASE_URL (
  echo DATABASE_URL not found in ..\.env
  exit /b 1
)
echo This REPLACES all RAG tables and data in the database from DATABASE_URL in .env.
set /p CONFIRM=Type YES to continue: 
if not "%CONFIRM%"=="YES" (
  echo Cancelled, nothing changed.
  exit /b 1
)
set "PG_RESTORE=pg_restore"
if defined PG_BIN set "PG_RESTORE=%PG_BIN%\pg_restore.exe"
"%PG_RESTORE%" --dbname="%DATABASE_URL%" --no-owner --no-privileges --clean --if-exists ragdb.dump
if errorlevel 1 (
  echo Import finished with errors. Check that the database exists and pgvector is installed.
  exit /b 1
)
echo Imported ragdb.dump
