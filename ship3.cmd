@echo off
REM Session release — pull remote changes (rebase), then push + tag v0.24.2.
setlocal
cd /d "%~dp0"
echo.
echo ==== Shipping Session v0.24.2 ====
echo.
git add -A
git commit -m "v0.24.2: Soundcheck, Discord presence, silent OAuth, release notes; fix timeline blank + output-device switch" || echo (nothing new to commit - continuing)

echo - Pulling remote changes (rebase)...
git pull --rebase origin main || (git rebase --abort 2>nul & echo. & echo [X] The remote and your copy conflict and could not auto-merge. & echo     Nothing was changed. Copy this screen and send it to Claude. & pause & exit /b 1)

echo - Pushing main...
git push -u origin main || (echo [X] push failed - copy this screen and send it to Claude. & pause & exit /b 1)

echo - Tagging and pushing v0.24.2...
git tag v0.24.2 2>nul || echo (tag already exists - continuing)
git push origin v0.24.2 || (echo [X] tag push failed - copy this screen and send it to Claude. & pause & exit /b 1)

echo.
echo ==== Done. GitHub Actions is building Windows + Mac now. ====
echo.
pause
