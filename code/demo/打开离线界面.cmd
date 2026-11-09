@echo off
setlocal
cd /d "%~dp0"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "%~dp0web\index.html"
) else (
  start "" "%~dp0web\index.html"
)
