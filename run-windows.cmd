@echo off
rem Keeps ps5snipe running on a Windows PC: if it ever exits, start it again a minute later.
rem Task Scheduler starts this at boot (see README "Keep it running 24/7"). Output goes to logs\ps5snipe.log.
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
if not exist logs mkdir logs

:loop
echo ===== %date% %time% starting ps5snipe>> logs\ps5snipe.log
".venv\Scripts\python.exe" -m ps5snipe >> logs\ps5snipe.log 2>&1
echo ===== %date% %time% ps5snipe exited (code %errorlevel%), restarting in 60 s>> logs\ps5snipe.log
rem "timeout" fails when there is no console (scheduled task), so wait with ping instead
ping -n 61 127.0.0.1 >nul
goto loop
