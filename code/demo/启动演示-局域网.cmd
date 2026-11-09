@echo off
setlocal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.12+ not found. Please install Python or run: python server\app.py
  pause
  exit /b 1
)

echo ============================================================
echo   ZhuJiKeXun Demo - LAN mode (same Wi-Fi / same network)
echo   Open one of the URLs below on another device:
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '    http://' + $_.IPAddress + ':8765/' }"
echo   If Windows Firewall asks, click Allow (private networks).
echo   Note: this PC must stay on and the server window must stay open.
echo ============================================================
start "ZhuJiKeXun Demo Server (LAN)" cmd /k %PY% "server\app.py" --host 0.0.0.0
ping -n 4 127.0.0.1 >nul

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "http://127.0.0.1:8765/"
) else (
  start "" "http://127.0.0.1:8765/"
)
echo.
pause
