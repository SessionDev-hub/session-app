@echo off
REM One-click release for Session. Double-click this, or run it from the project folder.
REM It commits everything, pushes, and tags v0.24.2 — which triggers the GitHub Actions
REM build (Windows + macOS) and publishes both to Session-Releases.
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   Shipping Session v0.24.2
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [X] git is not installed or not on PATH. Install Git for Windows, then run this again.
  pause & exit /b 1
)

echo - Staging all changes...
git add -A

echo - Committing...
git commit -m "v0.24.2: Soundcheck, Discord presence, silent OAuth, release notes; fix timeline blank + output-device switch" || echo   (nothing new to commit - continuing)

echo - Pushing to GitHub...
git push || (echo [X] git push failed - check your sign-in/remote. & pause & exit /b 1)

echo - Tagging v0.24.2...
git tag v0.24.2 2>nul || echo   (tag v0.24.2 already exists - continuing)

echo - Pushing the tag (this starts the build)...
git push origin v0.24.2 || (echo [X] pushing the tag failed. & pause & exit /b 1)

echo.
echo ============================================
echo   Done. GitHub Actions is now building
echo   Windows + macOS and publishing to
echo   Session-Releases. Watch it in the
echo   Actions tab of SessionDev-hub/session-app.
echo ============================================
echo.
pause
