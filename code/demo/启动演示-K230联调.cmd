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
echo   《株迹可循》K230 真实图传联调
echo   服务监听 0.0.0.0:8765（K230 才能连进来）
echo   本机 IP（填到 K230 脚本 SERVER_HOST）：
ipconfig | findstr /i "IPv4"
echo ============================================
echo 若 K230 连接超时：管理员 PowerShell 执行一次
echo   netsh advfirewall firewall add rule name="株迹可循8765" dir=in action=allow protocol=TCP localport=8765
echo ============================================
start "株迹可循-K230联调服务" "%PY%" "server\app.py" --host 0.0.0.0 --port 8765
timeout /t 2 >nul
start "" "http://127.0.0.1:8765/"
echo 已启动。K230 跑 firmware\k230\push_frames.py 后，图传页角标会变“K230 实拍”。
timeout /t 5 >nul
exit /b 0
