@echo off
rem Builds the Android app: dist\Session-<version>.apk
rem Needs Android Studio installed once (it brings Java and the Android SDK).
cd /d "%~dp0"
setlocal
if not defined JAVA_HOME if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if not defined JAVA_HOME (
  echo Java was not found. Install Android Studio from https://developer.android.com/studio and run this again.
  pause & exit /b 1
)
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%ANDROID_HOME%\platforms" (
  echo The Android SDK was not found in %ANDROID_HOME%.
  echo Open Android Studio once and finish its setup wizard, then run this again.
  pause & exit /b 1
)
echo sdk.dir=%ANDROID_HOME:\=\\%> android\local.properties
echo [1/3] Installing tools (first time only)...
call npm install --no-audit --no-fund || goto :fail
echo [2/3] Copying the app into the Android project...
call npm run android:sync || goto :fail
echo [3/3] Building the APK (the first build downloads Gradle and takes a few minutes)...
pushd android
call gradlew.bat assembleRelease || (popd & goto :fail)
popd
if not exist dist mkdir dist
for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" package.json') do set "VER=%%~v"
copy /y "android\app\build\outputs\apk\release\app-release.apk" "dist\Session-%VER%.apk" >nul
echo.
echo Done! dist\Session-%VER%.apk is your Android app.
explorer dist
pause & exit /b 0
:fail
echo.
echo The build failed. Copy the last 30 lines above and send them to me.
pause & exit /b 1
