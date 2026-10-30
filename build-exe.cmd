@echo off
rem Builds Session for Windows: dist\Session-Portable-<version>.exe and dist\Session-Setup-<version>.exe
rem The VST3 host (bin\ps-host.exe) is packed inside both.
cd /d "%~dp0"
if not exist "bin\ps-host.exe" (
  echo bin\ps-host.exe is missing. Build it first with native-host\build.cmd, then run this again.
  pause
  exit /b 1
)
echo Installing build tools (first time only)...
call npm install --no-audit --no-fund || goto :fail
echo Building Session...
call npm run dist || goto :fail
echo.
echo Done! Your files are in the "dist" folder:
dir /b dist\*.exe
explorer dist
pause
exit /b 0
:fail
echo.
echo The build failed. Copy the last 30 lines above and send them to me.
pause
exit /b 1
