@echo off
REM Session release — sets the upstream the first time, then tags v0.24.2 to trigger the build.
setlocal
cd /d "%~dp0"
echo.
echo ==== Shipping Session v0.24.2 ====
echo.
git add -A
git commit -m "v0.24.2: Soundcheck, Discord presence, silent OAuth, release notes; fix timeline blank + output-device switch" || echo (nothing new to commit - continuing)
echo - Pushing main (and setting upstream)...
git push -u origin main || (echo [X] push failed - if it asked you to sign in to GitHub, do that and run this again. & pause & exit /b 1)
echo - Tagging and pushing v0.24.2...
git tag v0.24.2 2>nul || echo (tag already exists - continuing)
git push origin v0.24.2 || (echo [X] tag push failed. & pause & exit /b 1)
echo.
echo ==== Done. Actions is building Windows + Mac now. ====
echo.
pause
