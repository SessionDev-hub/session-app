@echo off
REM ============================================================================
REM  Session - one-click Android build.
REM  Needs the Android SDK (Android Studio's setup wizard installs it) + internet
REM  the first time. Everything else (Java, signing key) it sets up by itself.
REM  Output: dist\Session-<version>.apk  (signed, ready to send to testers)
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ---------- 1. Java 17 (download once, kept outside the repo) ----------
set "JROOT=%LOCALAPPDATA%\Programs\session-jdk17"
set "JAVA_HOME="
for /d %%D in ("%JROOT%\jdk-17*") do if not defined JAVA_HOME if exist "%%~D\bin\java.exe" set "JAVA_HOME=%%~D"
REM also accept an already-installed 17 or 21 if present (faster, no download)
if not defined JAVA_HOME for %%L in (C D E F) do for /d %%D in ("%%L:\Program Files\Java\jdk-17*" "%%L:\Program Files\Java\jdk-21*" "%%L:\Program Files\Eclipse Adoptium\jdk-17*" "%%L:\Program Files\Eclipse Adoptium\jdk-21*" "%%L:\Program Files\Microsoft\jdk-17*" "%%L:\Program Files\Microsoft\jdk-21*") do if not defined JAVA_HOME if exist "%%~D\bin\java.exe" set "JAVA_HOME=%%~D"
if not defined JAVA_HOME (
  echo [setup] No Java 17 found. Downloading a small one just for building ^(one time, ~180 MB^)...
  if not exist "%JROOT%" mkdir "%JROOT%"
  curl -L -o "%JROOT%\jdk17.zip" "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
  if errorlevel 1 (echo [X] Could not download Java. Check your internet and try again. & pause & exit /b 1)
  echo [setup] Unpacking Java...
  powershell -NoProfile -Command "Expand-Archive -Force '%JROOT%\jdk17.zip' '%JROOT%'"
  if errorlevel 1 (echo [X] Could not unpack Java. & pause & exit /b 1)
  del "%JROOT%\jdk17.zip" >nul 2>&1
  for /d %%D in ("%JROOT%\jdk-17*") do if not defined JAVA_HOME set "JAVA_HOME=%%~D"
)
if not defined JAVA_HOME (echo [X] Java setup failed. & pause & exit /b 1)
echo Using Java: %JAVA_HOME%

REM ---------- 2. Android SDK ----------
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%ANDROID_HOME%\platforms" (
  echo The Android SDK was not found in %ANDROID_HOME%.
  echo Open Android Studio once and finish its setup wizard ^(it installs the SDK^), then run this again.
  pause & exit /b 1
)
echo sdk.dir=%ANDROID_HOME:\=\\%> android\local.properties

REM ---------- 3. Signing key (create once if missing) ----------
if not exist "android\keystore.properties" (
  echo [setup] Creating a signing key ^(one time^)...
  set "SP=session-!RANDOM!!RANDOM!!RANDOM!"
  "%JAVA_HOME%\bin\keytool.exe" -genkeypair -v -keystore "android\session-release.jks" -alias session -keyalg RSA -keysize 2048 -validity 10000 -storepass "!SP!" -keypass "!SP!" -dname "CN=Session, O=Session, C=US"
  if errorlevel 1 (echo [X] Could not create the signing key. & pause & exit /b 1)
  > "android\keystore.properties" echo storeFile=session-release.jks
  >> "android\keystore.properties" echo storePassword=!SP!
  >> "android\keystore.properties" echo keyAlias=session
  >> "android\keystore.properties" echo keyPassword=!SP!
  echo [setup] Key created. BACK UP android\session-release.jks and android\keystore.properties somewhere safe!
)

REM ---------- 4. Build ----------
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
echo ==== Done! dist\Session-!VER!.apk is your signed Android app. ====
explorer dist
pause & exit /b 0

:fail
echo.
echo The build failed. Copy the last 30 lines above and send them to me.
pause & exit /b 1
