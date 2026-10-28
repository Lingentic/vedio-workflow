@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-services.ps1" %*
set "LAUNCH_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %LAUNCH_EXIT%
