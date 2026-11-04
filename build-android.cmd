@echo off
rem Builds the Android app: dist\Session-<version>.apk
rem Needs Android Studio installed once (it brings Java and the Android SDK),
rem and a signing key (run make-key.cmd once before the first build).
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem --- find Android Studio's bundled Java (the folder that has bin\java.exe) ---
set "JH="
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" set "JH=%JAVA_HOME%"
call :jprobe "%ProgramFiles%\Android\Android Studio\jbr"
call :jprobe "%ProgramFiles%\Android\Android Studio\jre"
call :jprobe "%ProgramFiles(x86)%\Android\Android Studio\jbr"
call :jprobe "%LOCALAPPDATA%\Programs\Android Studio\jbr"
call :jprobe "%LOCALAPPDATA%\Programs\Android Studio\jre"
if not defined JH for /d %%D in ("%ProgramFiles%\Android\*" "%LOCALAPPDATA%\Programs\Android*" "%ProgramFiles%\JetBrains\*") do (
  call :jprobe "%%~D\jbr"
  call :jprobe "%%~D\jre"
)
if not defined JH (
  echo Java was not found. Install Android Studio from https://developer.android.com/studio
  echo (or tell me where it's installed) and run this again.
  pause & exit /b 1
)
set "JAVA_HOME=!JH!"
echo Using Java: !JAVA_HOME!

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%ANDROID_HOME%\platforms" (
  echo The Android SDK was not found in %ANDROID_HOME%.
  echo Open Android Studio once and finish its setup wizard, then run this again.
  pause & exit /b 1
)
if not exist "android\keystore.properties" (
  echo No signing key yet. Run make-key.cmd ONCE first, then run this again.
  pause & exit /b 1
)
echo sdk.dir=%ANDROID_HOME:\=\\%> android\local.properties
echo [1/3] Installing tools (first time only)...
call npm install --no-audit --no-fund || goto :fail
echo [2/3] Copying the app into the Android project (syncs the version too)...
call npm run android:sync || goto :fail
echo [3/3] Building the APK (the first build downloads Gradle and takes a few minutes)...
pushd android
call gradlew.bat assembleRelease || (popd & goto :fail)
popd
if not exist dist mkdir dist
for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" package.json') do set "VER=%%~v"
copy /y "android\app\build\outputs\apk\release\app-release.apk" "dist\Session-!VER!.apk" >nul
if errorlevel 1 (echo [X] Build finished but the signed APK was not found - send me the last 30 lines. & pause & exit /b 1)
echo.
echo Done! dist\Session-!VER!.apk is your Android app.
explorer dist
pause & exit /b 0

:jprobe
if not defined JH if exist "%~1\bin\java.exe" set "JH=%~1"
exit /b 0

:fail
echo.
echo The build failed. Copy the last 30 lines above and send them to me.
pause & exit /b 1
