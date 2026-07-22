@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   MindGraph AI - Starting...
echo ========================================
echo.

cd /d "%~dp0"

REM ── 清理可能残留的旧进程 ──
taskkill /FI "WINDOWTITLE eq MindGraph-Backend*" /F 2>nul
taskkill /FI "WINDOWTITLE eq MindGraph-Frontend*" /F 2>nul

echo [1/2] Starting backend (Python FastAPI)...
start "MindGraph-Backend" cmd /c "cd /d %~dp0backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo [2/2] Starting frontend (Next.js)...
start "MindGraph-Frontend" cmd /c "cd /d %~dp0frontend && npm run dev"

echo.
echo ========================================
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo ========================================
echo.
echo Press any key to stop both services...
pause >nul

taskkill /FI "WINDOWTITLE eq MindGraph-Backend*" /F 2>nul
taskkill /FI "WINDOWTITLE eq MindGraph-Frontend*" /F 2>nul
echo Stopped.
