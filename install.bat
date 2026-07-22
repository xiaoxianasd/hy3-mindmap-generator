@echo off
echo ========================================
echo   MindGraph AI - Install Dependencies
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Installing backend dependencies (Python)...
cd backend
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Backend install failed. Check Python environment.
    pause
    exit /b 1
)
cd ..

echo.
echo [2/2] Installing frontend dependencies (Node.js)...
cd frontend
call npm install
if errorlevel 1 (
    echo [ERROR] Frontend install failed. Check Node.js environment.
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo   Done! Now run start.bat to launch.
echo ========================================
pause
