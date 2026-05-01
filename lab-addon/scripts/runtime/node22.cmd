@echo off
setlocal
set VERSION=22.20.0
set ROOT=%~dp0..\..
set NODE_DIR=%ROOT%\runtime\node\win32-x64
set NODE_EXE=%NODE_DIR%\node.exe

if not exist "%NODE_EXE%" (
  powershell -ExecutionPolicy Bypass -File "%~dp0bootstrap-node.ps1" -Version %VERSION%
  if errorlevel 1 exit /b 1
)

"%NODE_EXE%" %*
