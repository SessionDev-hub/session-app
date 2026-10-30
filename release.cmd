@echo off
rem One command to publish a new version to GitHub Releases.
rem Testers' installed apps then update on their own (Windows) or offer a 1-tap update (Android).
cd /d "%~dp0"
setlocal
if "%GH_TOKEN%"=="" (
  echo.
  echo  You need a GitHub token first. Open SETUP-UPDATES.txt and follow "One-time setup".
  echo  Then run:  set GH_TOKEN=ghp_your_token_here    and run this again.
  echo.
  pause & exit /b 1
)
for /f %%o in ('node -e "process.stdout.write(require('./updates.config.json').github.owner)"') do set "OWNER=%%o"
for /f %%r in ('node -e "process.stdout.write(require('./updates.config.json').github.repo)"') do set "REPO=%%r"
for /f %%v in ('node -e "process.stdout.write(require('./package.json').version)"') do set "VER=%%v"
if "%OWNER%"=="YOUR_GITHUB_USERNAME" (
  echo Put your GitHub username in updates.config.json first ^(the "owner" line^).
  pause & exit /b 1
)
echo Installing tools (first time only)...
call npm install --no-audit --no-fund || goto fail
echo Publishing Session v%VER% to %OWNER%/%REPO% (code is protected automatically)...
call node scripts\build-release.js --publish || goto fail
if exist "dist\Session-%VER%.apk" (
  call node scripts\make-feed.js
  where gh >nul 2>nul
  if %errorlevel%==0 (
    gh release upload v%VER% "dist\Session-%VER%.apk" "dist\latest.json" --clobber
  ) else (
    echo.
    echo  Windows is published. For the Android update, install GitHub CLI ^(gh^) and run:
    echo     gh release upload v%VER% "dist\Session-%VER%.apk" "dist\latest.json" --clobber
  )
) else (
  echo.
  echo  Windows is published. No Android APK found for v%VER%.
  echo  To ship an Android update too: run build-android.cmd, then release.cmd again.
)
echo.
echo  Done. Release v%VER% is live. Testers get it automatically.
pause & exit /b 0
:fail
echo.
echo  Release failed. Copy the last 20 lines above and send them to me.
pause & exit /b 1
