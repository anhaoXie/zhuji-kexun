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

echo ==========================================
echo   ZhuJiKeXun Demo - local server + web UI
echo   URL: http://127.0.0.1:8765/
echo   A new window is the server. Close it to stop.
echo ==========================================
start "ZhuJiKeXun Demo Server" cmd /k %PY% "server\app.py"
ping -n 4 127.0.0.1 >nul

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "http://127.0.0.1:8765/"
) else (
  start "" "http://127.0.0.1:8765/"
)
echo.
echo If the page does not open:
echo   1) check the server window for an error message
echo   2) open http://127.0.0.1:8765/ manually in a browser
echo   3) or use the offline HTML launcher (no server needed)
echo.
pause
