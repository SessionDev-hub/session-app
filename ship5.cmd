@echo off
REM Session release - bumps the version automatically, makes GitHub match your local code
REM (force push over the old divergent history), then tags it to trigger the build.
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo - Bumping the version...
for /f "delims=" %%v in ('node scripts\bump.js') do set VER=%%v
if "!VER!"=="" (echo [X] version bump failed - screenshot this and send it to Claude. & pause & exit /b 1)

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
echo     For the Android app, run build-android.cmd (it uses this same version).
echo.
pause
