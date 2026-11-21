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
echo Next: double-click START.cmd, open chrome://extensions, and load the extension folder.
echo See README.md for the browser steps.
pause
