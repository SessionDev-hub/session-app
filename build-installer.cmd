@echo off
rem Builds the Session setup wizard with Inno Setup: dist\Session-Setup-<version>.exe
cd /d "%~dp0"
if not exist "bin\ps-host.exe" (
  echo bin\ps-host.exe is missing. Build it first with native-host\build.cmd, then run this again.
  pause & exit /b 1
)
set "ISCC="
for %%V in (6 7) do for %%P in ("%ProgramFiles(x86)%\Inno Setup %%V\ISCC.exe" "%ProgramFiles%\Inno Setup %%V\ISCC.exe" "%LOCALAPPDATA%\Programs\Inno Setup %%V\ISCC.exe") do if exist %%P set "ISCC=%%~P"
if not defined ISCC (
  echo Inno Setup was not found. Install it from https://jrsoftware.org/isdl.php and run this again.
  pause & exit /b 1
)
echo [1/2] Building the app folder...
call npm install --no-audit --no-fund || goto :fail
call npm run dist:dir || goto :fail
echo [2/2] Building the setup wizard...
"%ISCC%" "installer\session.iss" || goto :fail
echo.
echo Done! dist\Session-Setup-*.exe is your installer.
explorer dist
pause & exit /b 0
:fail
echo.
echo The build failed. Copy the last 30 lines above and send them to me.
pause & exit /b 1
