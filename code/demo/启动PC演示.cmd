@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.12+ not found. Please install Python or run: python server\app.py
  pause
  exit /b 1
)

echo ============================================
echo   《株迹可循》PC 棚务台 - 本地演示
echo   地址: http://127.0.0.1:8765/pc/
echo   服务窗口不要关；关掉即停止
echo ============================================

rem 8765 已有服务时直接开页面，避免重复启动导致端口占用
powershell -NoProfile -Command "try { Invoke-WebRequest 'http://127.0.0.1:8765/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  start "株迹可循 PC 服务" cmd /k "%PY%" "server\app.py"
  ping -n 4 127.0.0.1 >nul
) else (
  echo 服务已在运行，直接打开页面。
)

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "http://127.0.0.1:8765/pc/"
) else (
  start "" "http://127.0.0.1:8765/pc/"
)
echo.
echo 如果页面没有打开：
echo   1) 看服务窗口是否报错
echo   2) 手动打开 http://127.0.0.1:8765/pc/
echo   3) 端口被占用时，用 python server\app.py --port 8799，再改地址里的端口
echo.
pause
