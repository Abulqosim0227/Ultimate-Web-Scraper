@echo off
setlocal
cd /d "%~dp0"
for /f "usebackq tokens=1,* delims==" %%a in ("..\.env") do if "%%a"=="DATABASE_URL" set "DATABASE_URL=%%b"
if not defined DATABASE_URL (
  echo DATABASE_URL not found in ..\.env
  exit /b 1
)
set "PG_DUMP=pg_dump"
if defined PG_BIN set "PG_DUMP=%PG_BIN%\pg_dump.exe"
"%PG_DUMP%" --dbname="%DATABASE_URL%" --format=custom --no-owner --no-privileges --file=ragdb.dump
if errorlevel 1 (
  echo Export failed. If pg_dump is not on PATH, run: set PG_BIN=C:\Program Files\PostgreSQL\17\bin
  exit /b 1
)
echo Exported to %~dp0ragdb.dump
