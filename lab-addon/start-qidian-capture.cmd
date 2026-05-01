@echo off
setlocal
set "DEVICE_ID=%~1"
if "%DEVICE_ID%"=="" set "DEVICE_ID=23091JEGR04484"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\qidian-capture-oneclick.ps1" -DeviceId "%DEVICE_ID%" -ClearJsonl

echo.
pause
