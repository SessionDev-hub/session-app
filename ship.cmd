@echo off
REM ship.cmd - releases Session to GitHub (builds Windows + Mac in the cloud).
REM Double-click this, or run it from this folder. It reads the version from package.json.
setlocal
cd /d "%~dp0"

for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set VER=%%v
if "%VER%"=="" (
  echo Could not read the version from package.json.
  pause
  exit /b 1
)

echo ============================================
echo   Shipping Session  v%VER%
echo ============================================
echo.

git add -A
git commit -m "v%VER%"
git tag v%VER%
git push origin v%VER%

echo.
if errorlevel 1 (
  echo.
  echo Push did not fully succeed. Common causes:
  echo   - tag v%VER% already exists  ^(bump "version" in package.json, then run again^)
  echo   - token missing the "workflow" scope
  echo   - not signed in to GitHub
) else (
  echo Pushed v%VER%. Watch the build here:
  echo   https://github.com/SessionDev-hub/session-app/actions
)
echo.
pause
