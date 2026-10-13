@echo off
setlocal
if not exist "%~dp0.env" copy /y "%~dp0.env.example" "%~dp0.env" >nul
echo Official TypeSafe Jev: https://docs.typesafe.ai/api
echo Set TYPESAFE_API_KEY in the local .env file, then restart the lab.
echo Do not share the key or commit .env.
start "" notepad.exe "%~dp0.env"
endlocal
