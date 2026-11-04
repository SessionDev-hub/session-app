@echo off
REM Run this ONCE to create your Android signing key. After this, build-android.cmd signs every APK
REM with it automatically. BACK UP the two files it makes - every future update must use the same key.
setlocal enabledelayedexpansion
cd /d "%~dp0"

if exist "android\keystore.properties" (
  echo A signing key already exists ^(android\keystore.properties^).
  echo You do NOT need to run this again - just use build-android.cmd.
  echo.
  echo To replace it with a brand-new key, first delete android\keystore.properties and
  echo android\session-release.jks. WARNING: a new key means every tester must uninstall the
  echo old app before they can install the update.
  pause & exit /b 0
)

REM --- find keytool (ships with Android Studio's bundled Java) ---
set "KT="
call :probe "%JAVA_HOME%\bin\keytool.exe"
call :probe "%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe"
call :probe "%ProgramFiles%\Android\Android Studio\jre\bin\keytool.exe"
call :probe "%ProgramFiles(x86)%\Android\Android Studio\jbr\bin\keytool.exe"
call :probe "%LOCALAPPDATA%\Programs\Android Studio\jbr\bin\keytool.exe"
call :probe "%LOCALAPPDATA%\Programs\Android Studio\jre\bin\keytool.exe"
if not defined KT for /d %%D in ("%ProgramFiles%\Android\*" "%LOCALAPPDATA%\Programs\Android*" "%ProgramFiles%\JetBrains\*") do (
  call :probe "%%~D\jbr\bin\keytool.exe"
  call :probe "%%~D\jre\bin\keytool.exe"
)
if not defined KT for /f "delims=" %%W in ('where keytool 2^>nul') do if not defined KT set "KT=%%W"
if not defined KT (
  echo Could not find keytool. It comes with Android Studio's Java.
  echo Open Android Studio, or tell me where it's installed, and I'll point the script at it.
  echo [tip] In Android Studio: File ^> Project Structure shows the JDK location; keytool is in its \bin.
  pause & exit /b 1
)
echo Using keytool: !KT!

set "SP=session-!RANDOM!!RANDOM!!RANDOM!"
echo Creating android\session-release.jks ...
"!KT!" -genkeypair -v -keystore "android\session-release.jks" -alias session -keyalg RSA -keysize 2048 -validity 10000 -storepass "!SP!" -keypass "!SP!" -dname "CN=Session, O=Session, C=US"
if errorlevel 1 (echo [X] Could not create the key. Send me the message above. & pause & exit /b 1)

> "android\keystore.properties" echo storeFile=session-release.jks
>> "android\keystore.properties" echo storePassword=!SP!
>> "android\keystore.properties" echo keyAlias=session
>> "android\keystore.properties" echo keyPassword=!SP!

echo.
echo ==== Signing key created. ====
echo Your APKs will now be signed automatically.
echo.
echo BACK UP THESE TWO FILES somewhere safe (a password manager, cloud drive, etc.):
echo     android\session-release.jks
echo     android\keystore.properties
echo Every future update MUST be signed with this same key. If you lose it, testers will have to
echo uninstall and reinstall to get updates. (Both files are kept out of git automatically.)
echo.
pause
exit /b 0

:probe
if not defined KT if exist "%~1" set "KT=%~1"
exit /b 0
