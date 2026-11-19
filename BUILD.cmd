@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if errorlevel 1 (
  echo.
  echo Build failed. Press any key to close.
  pause >nul
  exit /b 1
)
echo.
echo Next: double-click START.cmd and load the extension folder in both browsers.
echo See README.md for the browser steps.
pause
