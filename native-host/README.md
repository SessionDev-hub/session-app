# Native VST3 host (Windows)

`ps-host.exe` is a small separate program that loads your installed **VST3 effect** plugins and processes audio for Private Studio. Private Studio starts it by itself when you use a VST3 plugin and talks to it over a private connection on your own computer (loopback only, protected by a random token). Nothing goes over the network.

## Build it once

You need three free tools:

1. **Visual Studio 2022 or 2026** (Community or Build Tools, https://visualstudio.microsoft.com/downloads/). In the installer tick **Desktop development with C++**. Newer versions work too.
2. **CMake** (`winget install Kitware.CMake`). Optional if you have Visual Studio: the build script uses the CMake that comes with it.
3. **Git** (`winget install Git.Git`).

Then double-click **`build.cmd`** in the `private-studio\native-host` folder, or in PowerShell from that folder:

```
.\build.ps1
```

The script finds the newest Visual Studio on your computer by itself, so you never have to type its version. Add `-Clean` to start a build from scratch (do this after upgrading Visual Studio).

The first run downloads JUCE 8.0.16 (the audio framework, about 100 MB) and takes several minutes. When it finishes, `ps-host.exe` is copied to `private-studio\bin\ps-host.exe`, which is where the app looks for it. It is built with the runtime included, so no Visual C++ Redistributable install is needed.

Building by hand instead: `cmake -B build -A x64` then `cmake --build build --config Release` (CMake picks your Visual Studio; add `-G "Visual Studio 18 2026"` or `-G "Visual Studio 17 2022"` to choose one).

## Use it

1. `npm start`
2. Click **VST3…** → **Scan default VST3 folders** (the standard folder is `C:\Program Files\Common Files\VST3`). Use **Add folder and scan…** for plugins installed elsewhere.
3. Every effect plugin found shows up under **+ Add effect** on any strip, labelled “(VST3)”.
4. Click the effect's name to open the plugin's own window. Its settings are saved with the session and also when the window is closed.

If a plugin crashes during a scan it is skipped on the next scan. If it crashes while running, Private Studio keeps playing (that strip passes audio through) and tells you; press **VST3…** to restart the host.

## What to expect

- **Effects only**, stereo in/out. No instruments, MIDI, side-chain input or automation yet.
- **Delay.** Each plugin adds about 16 ms (at 48 kHz) plus whatever delay the plugin reports itself. Private Studio delays the other tracks by the same amount so everything stays lined up, and takes it into account when aligning recordings. Do not monitor your voice *through* a VST3 effect while recording (use headphones with direct monitoring or a JavaScript effect); the delay is too long for that.
- **Export WAV** with VST3 plugins in the session plays the song in real time and records the result, so it takes as long as the song. Sessions without VST3 plugins still render instantly.
- **Sharing sessions:** the plugin settings travel inside the `.pstudio` file, but the other person needs the same plugin installed to hear it. Without it, that effect shows as “(missing)” and is skipped.

## If the build fails

Copy the last 30 lines of the error and send them to me. This code was written without access to a Windows compiler, so small fixes may be needed on the first build.
