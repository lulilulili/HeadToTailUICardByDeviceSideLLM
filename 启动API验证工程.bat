@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0edge-api-lab\launch.ps1"
if errorlevel 1 pause
endlocal
