@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   MindGraph AI - 安装依赖
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 安装后端依赖 (Python)...
cd backend
pip install -r requirements.txt
if errorlevel 1 (
    echo [错误] 后端依赖安装失败，请检查 Python 环境。
    pause
    exit /b 1
)
cd ..

echo.
echo [2/2] 安装前端依赖 (Node.js)...
cd frontend
call npm install
if errorlevel 1 (
    echo [错误] 前端依赖安装失败，请检查 Node.js 环境。
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo   依赖安装完成！请双击 start.bat 启动。
echo ========================================
pause
