@echo off
REM Session release - reads the version from package.json automatically, makes GitHub match your
REM local code (force push over the old divergent history), then tags it to trigger the build.
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM --- read "version" from package.json ---
set VER=
for /f "tokens=2 delims=:," %%a in ('findstr /c:"\"version\"" package.json') do (
  if not defined VER (
    set VER=%%~a
  )
)
set VER=!VER: =!
set VER=!VER:"=!
if "!VER!"=="" (echo [X] could not read version from package.json & pause & exit /b 1)

echo.
echo ==== Shipping Session v!VER! (making GitHub match your local code) ====
echo.

git add -A
git commit -m "v!VER!" || echo (nothing new to commit - continuing)

echo - Pushing your code to GitHub (overwriting the old divergent history)...
git push --force -u origin main || (echo [X] push failed - screenshot this and send it to Claude. & pause & exit /b 1)

echo - Tagging and pushing v!VER!...
git tag v!VER! 2>nul || echo (tag already exists - continuing)
git push --force origin v!VER! || (echo [X] tag push failed - screenshot this and send it to Claude. & pause & exit /b 1)

echo.
echo ==== Done. Actions is building Windows + Mac for v!VER!. ====
echo     Watch it in the Actions tab of SessionDev-hub/session-app.
echo.
pause
