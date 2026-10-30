# Session (Private Studio)

*Record / Create / Share.* A private desktop app for **recording and mixing**: multitrack audio recording, a waveform timeline, a mixer with effect plugins, encrypted session sharing, and WAV export.

## Run it

Requires [Node.js](https://nodejs.org) 18+.

```
npm install
npm start
```

`npm run check` runs a headless test of the engine, plugin host, save/open and e## Using it

1. Click **R** on a track to arm it (the app asks for microphone access the first time).
2. Press **●** (or `R`) to record, `Space` to stop. Takes land on the armed track as clips, and existing tracks play along while you record.
3. Click the ruler or empty space to move the playhead. Drag clips to move them (also between tracks). `S` splits the selected clips at the playhead, `Delete` removes them.
4. **Effects live on the track.** Every track header shows its effect chain: **+** adds one (type to search), click an effect to open it, ⏻ bypasses it. Drag an effect to reorder it, or onto another track to move it there. The same chain shows in the mixer strip. Every clip on the track, including new recordings, plays through it.
5. **H** (headphones) on a track routes your live input through that track's effects while you record. Use headphones, otherwise it will feed back.
6. Drag audio files onto the window, or use **Import**, to bring in existing files.

### Editing tools

| Tool | Key | What it does |
| --- | --- | --- |
| Select | `V` | Click to select, Shift-click to add, drag on empty space to box-select. Drag to move (all selected clips move together), Ctrl+drag to copy, Alt+drag inside a clip to slip the audio without moving the clip. Drag clip edges to trim. |
| Slice | `C` | Click a clip to cut it at the (snapped) line shown. Shift+click cuts every track at once. |
| Erase | `E` | Click or drag over clips to delete them. |
| Mute | `M` | Click clips to mute / unmute them. |

**Clip handles:** hover or select a clip to show handles in its title bar. Drag the squares at each end to set the fade in/out, drag the diamond up or down to change clip gain (Shift for fine steps; it snaps to 0 dB). Double-click a handle to reset it.

**Right-click a clip** for split, *slice at every grid line* (chop a loop into beats), trim to the cursor, snap to grid, nudge, duplicate, copy/paste, rename, gain/fades/mute, normalize, reverse, auto-tune and delete. With several clips selected it acts on all of them.

### Snap grid and tempo

Set the song's **BPM** (or press **Tap** in time with the music) and the time signature. The grid follows **Bars** (bar, 1/2, 1/4 beat, 1/8, 1/16, 1/32) or **Seconds**. With **Snap** on (`G`), moving, trimming, slicing, pasting and placing the playhead lock to the grid and to the edges of other clips. Hold **Alt** while dragging to move freely. The clock shows bar.beat.tick under the time.

### Mixer

Each strip has its effect inserts, a pan knob (drag, double-click to centre), a fader with a dB scale (double-click = 0 dB, scroll for 0.5 dB steps, or type a value into the box), stereo meters with peak hold, a peak readout and a clip light (click to reset), plus mute / solo / arm. Right-click a strip name to change the track colour. Drag the bar above the mixer to resize it, or hide it with `F9`. **Balance** and **Master…** are in the mixer header.

udio**, to bring in existing files.

Recording is mono from the selected input, with echo cancellation, noise suppression and auto-gain turned off so you get the raw signal. The first time you launch, the app offers to measure your round-trip delay with a few test clicks (turn the volume up and put the speakers near the mic, or use a loopback cable; headphones won't work for this). Run it again any time with **Fix latency**. The result is remembered per input device. The box next to it is a manual fine-tune in ms on top.

## Key, auto-tune and mastering

- **Key**: the app detects the song's key from your clips (and re-detects after each recording or import while **auto** is ticked). Press **Detect** to run it on the selected clip or the whole song, or pick a key yourself. Detection is a good guess, not a guarantee: relative major/minor pairs (e.g. C major / A minor) can be mixed up, so check it by ear.
- **Auto-tune** (button, or right-click a clip): pulls a voice or single instrument into the key. Choose the retune speed (0 ms = hard robotic effect, 100+ ms = natural) and strength. It processes the selected clip (not live while singing) and can be undone. Works on one pitch at a time, not on chords.
- **Balance levels** sets all faders to sensible relative levels (vocals a little forward) as a starting point for your mix.
- **Master…** builds a master chain (rumble filter, EQ, glue compressor, stereo width, limiter) and raises the limiter until the mix reaches a loudness target (e.g. −14 LUFS for streaming) without going over the ceiling. The chain shows on the Master strip, where every effect can be edited, bypassed or removed. **Measure only** reports loudness (LUFS) and peak without changing anything.
- If a recording sounds early or late against the backing track: select it and press `[` (earlier) or `]` (later) to nudge by 5 ms (Shift 1 ms, Alt 50 ms).

## Noise Gate and backgrounds

- **Noise Gate** (Add effect on any track): silences the track between notes or words so hiss, room noise and mic bleed disappear. Open it and press **Auto threshold**: it listens to the track's audio and sets the threshold between the background noise and your signal. Reduction is how far it turns the sound down when closed (−70 dB is near silence; try −20 to −30 for a more natural sound), Hold keeps it open briefly after you stop, Release is how long it takes to fade out.
- **Background** (top right): pick any colour or choose your own picture (or drop a picture file onto the window). Darken picture and Panel opacity control how much of it shows through the timeline and mixer. It is saved on this computer and is not part of session files.

## Private and shareable

- Nothing leaves your machine. There are no accounts and no network calls.
- **Save** writes a `.pstudio` file with all audio embedded (32-bit float, lossless).
- **Share (encrypted)** writes the same file encrypted with AES-256-GCM, key derived from your passphrase (PBKDF2, 250k iterations). Send the file by any channel and give the passphrase through a different one. A lost passphrase cannot be recovered.

## Session effects

Ten studio effects come built in, each with factory presets and a live display:

| Effect | What it does | Display |
| --- | --- | --- |
| **Session EQ** | 7 bands: low cut (12/24 dB), low shelf, 3 bells, high shelf, high cut | Curve over a live spectrum; drag the points, scroll for Q |
| **Session Compressor** | Threshold, ratio, knee, attack, release, auto make-up, parallel mix | In/out curve with live level dot + gain reduction |
| **Session Maximizer** | Pushes loudness to a ceiling the audio never crosses (Clean / Warm / Punchy) | Limiter curve + gain reduction |
| **Session Multiband** | 3-band compressor with adjustable crossovers | Spectrum with crossovers + 3 gain-reduction meters |
| **Session Reverb** | Size, decay, pre-delay, damping, low/high cut, width | The actual reverb tail |
| **Session Delay** | Tempo-synced (1/32 to 1 bar, dotted, triplet) or free, ping-pong, filtered feedback | Echo taps |
| **Session Enhancer** | One knob for a fuller, louder, polished sound (4 modes), never clips | Spectrum + per-band reduction |
| **Session Pattern Gate** | 16-step gate, stutter or sidechain-style pump, locked to the song tempo | Clickable step grid with the playing step lit |
| **Session Clipper** | Soft to hard clipping with drive and ceiling | Transfer curve + output peak |
| **Session Transient** | Boost or soften the attack and the sustain of every hit | Gain change per hit |

Click an effect on a track to open its window. Drag knobs up/down (Shift = fine), scroll on them, double-click to reset, or click the value to type one. Pick presets with the arrows, bypass with ⏻, reset with ↺. The window floats, so you can keep it open while the song plays, and every change can be undone. The tempo-synced effects follow the BPM you set in the top bar.

## The Vault link

**Vault** (top bar) connects Session to *The Vault*, a private song library app.

- **Send this song:** renders the whole mix (like Export WAV) and puts it in The Vault, either as a **new song** (title, Unfinished / Finished, project, notes) or as a **new version** of a song that's already there. With a new version, the previous file goes into that song's History in The Vault, so nothing is lost. After the first send, the session remembers which Vault song it belongs to, so the next send defaults to "new version of" that song.
- **Bring a Vault song in:** search The Vault and add any song to the session at the playhead.

Session writes into The Vault's library (`SongVault` in your user folder) exactly the way The Vault's own Import and Replace buttons do. If The Vault is already open, switch tabs there to see the new song. Before every change Session keeps a backup of the library database (`vault.db.session-backup`) and checks it, and it waits if The Vault is in the middle of saving. If no library exists yet, sending creates one that The Vault will use.

## Plugins

Built-in: Delay, Reverb, Distortion, Filter, Compressor, 3-band EQ, Limiter, Stereo Width. Add your own with **Import plugin** (pick a `.js`, `.mjs` or `.cjs` file; it is copied into your plugin folder and usable immediately, no restart) or by dropping the file into the folder opened by the **Plugins** button. A plugin that fails to load or crashes is skipped with a message and never takes the session down. See [plugins/README.md](plugins/README.md).

## VST3 plugins (Windows)

Native VST3 effects run in a separate helper program, `bin/ps-host.exe`, which you build once from `native-host/` by double-clicking `build.cmd` (works with Visual Studio 2022, 2026 or newer; see [native-host/README.md](native-host/README.md)). After that, **VST3…** scans your computer and the plugins appear under **+ Add effect**. Delay compensation keeps tracks aligned, and exporting a session that uses VST3 plugins runs in real time.

## Share Session with testers (Windows exe)

Double-click **build-exe.cmd** (needs `bin\ps-host.exe`, see below). It creates two files in `dist`:

- **Session-Portable-<version>.exe**: one file, no install. Testers just run it.
- **Session-Setup-<version>.exe**: an installer with Start menu and desktop shortcuts (no admin rights needed).

Both include the VST3 host, so testers can use their own VST3 effects: **VST3… → Scan default VST3 folders**. They need 64-bit Windows 10 (1607+) or 11 and nothing else: no Visual Studio, no runtimes. Their plugins are not included; each tester scans their own. Because the files aren't code-signed, Windows may show "Windows protected your PC" the first time: **More info → Run anyway**.

## Android (phones and tablets)

The same app also builds as an Android app (`.apk`). Everything runs on the phone (recording, timeline, all Session effects, mixer, mastering, save/open/export), except **VST3 plugins** and **The Vault link**, which are Windows-only. It opens in landscape.

**Touch:** drag clips with a finger, swipe empty space to scroll, pinch to zoom, tap to move the playhead, **long-press** a clip (or empty space) for the menu that right-click opens on PC. Saved sessions and exported WAVs go to *Documents/Session* on the phone and open the share sheet so you can send them on (Drive, WhatsApp, to your PC…). `.pstudio` sessions open on both phone and PC.

**Build the APK:** install [Android Studio](https://developer.android.com/studio) once and open it once so it finishes setting up, then double-click **build-android.cmd**. The APK lands in `dist`. To install it, copy it to the phone and allow "Install unknown apps" for your file manager when asked.

**Keep `android/session-release.jks` and `android/keystore.properties` safe and private.** They are the app's signing key: every future APK must be signed with the same key, or phones will refuse to update and testers have to uninstall first. For each new release raise `versionCode` (and `versionName`) in `android/app/build.gradle`.

## Shortcuts

`Space` play/stop · `R` record · `S` split · `Delete` remove clips · `V` `C` `E` `M` tools · `G` snap on/off · `Ctrl/Cmd+A` select all · `Esc` deselect · `F9` mixer · `Home` go to start · `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redo · `Ctrl/Cmd+C` / `V` / `D` copy, paste, duplicate clip · `Ctrl/Cmd+S` save · `Ctrl/Cmd+wheel` zoom timeline

## Not included (yet)

Punch recording, multi-channel/stereo input capture, VST3 instruments and MIDI, side-chain inputs, plugin automation, macOS/Linux and VST2/AU/CLAP hosting, and class-based Web Audio Modules (WAM).
