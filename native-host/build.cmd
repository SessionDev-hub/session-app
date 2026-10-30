@echo off
rem Double-click this to build ps-host.exe (runs build.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
pause
