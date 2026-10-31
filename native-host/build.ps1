# Builds ps-host.exe with whatever Visual Studio is installed (2022, 2026 or newer).
# Usage (PowerShell, from this folder):  .\build.ps1        add -Clean to start over
param([switch]$Clean)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 1. Find the newest Visual Studio (any edition, incl. Build Tools) that has the C++ compiler.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Visual Studio was not found. Install it with "Desktop development with C++".' }
$vs = & $vswhere -latest -products * -prerelease -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json | Select-Object -First 1
if (-not $vs) { throw 'Visual Studio is installed but the C++ tools are missing. In the Visual Studio Installer, tick "Desktop development with C++".' }
Write-Host "Using $($vs.displayName) $($vs.installationVersion)"

# 2. Prefer the CMake that ships with that Visual Studio: it always knows its own version,
#    whereas an older standalone CMake may not recognise Visual Studio 2026.
$cmake = Join-Path $vs.installationPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
if (-not (Test-Path $cmake)) {
  $cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
  if (-not $cmake) { throw 'CMake not found. Run: winget install Kitware.CMake' }
}
Write-Host "Using CMake: $cmake"

# 3. Generator name from the VS major version (17 = 2022, 18 = 2026, ...).
$major = [int]($vs.installationVersion.Split('.')[0])
$years = @{ 16 = '2019'; 17 = '2022'; 18 = '2026' }
$gen = if ($years.ContainsKey($major)) { "Visual Studio $major $($years[$major])" } else { $null }

if ($Clean -and (Test-Path build)) { Remove-Item -Recurse -Force build }
# A build folder made by a different Visual Studio can't be reused.
if ((Test-Path build\CMakeCache.txt) -and $gen -and -not (Select-String -Path build\CMakeCache.txt -SimpleMatch "CMAKE_GENERATOR:INTERNAL=$gen" -Quiet)) {
  Write-Host 'Build folder was made with another Visual Studio; starting fresh.'
  Remove-Item -Recurse -Force build
}

$cfg = @('-B', 'build', '-A', 'x64', "-DCMAKE_GENERATOR_INSTANCE=$($vs.installationPath)")
if ($gen) { $cfg = @('-G', $gen) + $cfg }
& $cmake @cfg
if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed (see above).' }
& $cmake --build build --config Release
if ($LASTEXITCODE -ne 0) { throw 'Build failed (see above).' }
Write-Host "`nDone: ..\bin\ps-host.exe" -ForegroundColor Green
