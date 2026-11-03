@echo off
REM Session release — the GitHub repo has an old, separate history; your local folder is the real
REM source. This makes GitHub match your local repo (force), then tags v0.24.2 to trigger the build.
setlocal
cd /d "%~dp0"
echo.
echo ==== Shipping Session v0.24.2 (making GitHub match your local code) ====
echo.
git add -A
git commit -m "v0.24.2: Soundcheck, Discord presence, silent OAuth, release notes; fix timeline blank + output-device switch" || echo (nothing new to commit - continuing)

echo - Pushing your code to GitHub (overwriting the old divergent history)...
git push --force -u origin main || (echo [X] push failed - copy this screen and send it to Claude. & pause & exit /b 1)

echo - Tagging and pushing v0.24.2...
git tag v0.24.2 2>nul || echo (tag already exists - continuing)
git push --force origin v0.24.2 || (echo [X] tag push failed - copy this screen and send it to Claude. & pause & exit /b 1)

echo.
echo ==== Done. GitHub now matches your code. Actions is building Windows + Mac. ====
echo     Watch it in the Actions tab of SessionDev-hub/session-app.
echo.
pause
