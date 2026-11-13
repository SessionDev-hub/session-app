/* Patch notes, newest first. The matching version shows a "What's new" popup after updating, and the
 * list appears in Settings -> About.
 *
 * Don't edit the version entries here by hand. Write what changed — one line per change — in
 * PATCH-NOTES-NEXT.txt (repo root). When you run ship5.cmd, scripts/bump.js bumps the version,
 * adds a new entry at the top with ONLY those lines (anything already listed in an older version is
 * dropped), and empties PATCH-NOTES-NEXT.txt for the next round. */
window.__PATCH_NOTES__ = [
  {
    version: '0.25.26',
    date: '2026-11-13',
    changes: [
      '8 new plugins: Opto Comp (BA-2A style two-knob leveler), Graphic EQ (10 bands), Tremolo, Auto-Wah, Amp (overdrive, tube, distortion, fuzz with speaker cabinets), Rotary speaker, Ring Mod and Octaver, each with presets. They work on Android too, and BandLab preset imports can now use them.',
    ],
  },
  {
    version: '0.25.25',
    date: '2026-11-13',
    changes: [
      'New: Export stems (Export menu, Stems). Every track as its own WAV or FLAC file, all lined up from 0:00, in one zip: Mixed (with each track\'s effects, volume and pan), Raw (no effects) or both, plus the full mix if you want it. Drop them straight into FL Studio, Ableton, Pro Tools or Logic.',
      'Beat Lab and the Beats tab now follow your Glass or Flat style and accent colour instead of a plain flat page.',
      'Exports start at the exact track levels (no tiny fade on the first moment of the song).',
    ],
  },
  {
    version: '0.25.24',
    date: '2026-11-13',
    changes: [
      'New: Copy a BandLab preset. Screenshot the effects in BandLab, drop or paste them into Session (FX & Plugins, BandLab preset, or Chain presets on any track), and Session reads every effect and setting and rebuilds the chain with its own effects. Apply it to a track or save it as a chain preset.',
    ],
  },
  {
    version: '0.25.23',
    date: '2026-11-13',
    changes: [
      'New Playback buffer setting (Settings, Audio): Lowest delay, Balanced or Stable. If playback skips ahead or stutters, pick Stable and restart Session. Session now notices when playback is skipping and tells you how to fix it.',
      'Panels, mixer strips and buttons now take on your accent colour, with a Panel colour slider to set how much (Settings, Appearance), in both Glass and Flat.',
      'New Flat panel opacity slider: make Flat panels fully solid or let your background show through.',
    ],
  },
  {
    version: '0.25.22',
    date: '2026-11-10',
    changes: [
      'Flat style is now properly flat: buttons, tabs, mixer strips, effect chips, menus and dialogs are solid, filled and rounded with no glass, glow or gradients (your background still shows behind the panels).',
    ],
  },
  {
    version: '0.25.21',
    date: '2026-11-10',
    changes: [
      'Low-latency recording: while you record, plugins that add delay on other tracks and the master pause automatically, and your own track no longer waits for delay compensation, so you hear yourself much sooner.',
      'New "Hear yourself through: My interface (0 ms)" option for true zero-latency direct monitoring, plus a live "you hear yourself X ms late" readout with tips in Settings, Audio.',
      'Takes line up more accurately: Session now reads your mic\'s real input delay, and uses the delay that was in effect while you recorded.',
      'Session warns you when you record on Bluetooth headphones (they add 150-300 ms no app can remove).',
    ],
  },
  {
    version: '0.25.20',
    date: '2026-11-10',
    changes: [
      'New Beats tab: producers can publish their beats and everyone can listen, download them free or drop them straight into a session (free for now, credit the producer).',
    ],
  },
  {
    version: '0.25.19',
    date: '2026-11-10',
    changes: [
      'New: duplicate a track — right-click a track (or its mixer strip) → Duplicate track. You get the same clips, effects, volume and colour right below it.',
      'New: speed up or slow down any part of a song — right-click a clip → Speed. Pick “Sped up / slowed” (speed and pitch change together, like the TikTok edits) or “Keep pitch” (only the speed changes, the vocal stays in key). Split a verse first to change just that part, or select several clips to change them together. Later clips move over so nothing overlaps.',
      'New: live backgrounds — 6 moving scenes (Aurora, Sunset Glow, Ocean Drift, Neon Night, Lava, Accent Glow) or your own video / GIF, with a motion-speed slider, in Settings → Appearance. They run on the graphics card, so the app stays just as smooth.',
    ],
  },
  {
    version: '0.25.18',
    date: '2026-11-10',
    changes: [
      'Fixed recording breaking after a while (no waveform in the red box, stopping put nothing down, crackly sound): every finished take and every removed effect kept running in the background forever. They now shut off properly, so you can record take after take with effect chains on.',
      'Auto-Tune uses less than half the CPU (smoother recording with it on several tracks), holds notes through breaths and consonants instead of warbling, and can no longer glitch out the whole mix.',
      'New: export as FLAC (lossless, 16-bit or 24-bit) from the Export menu.',
      'New: pick your accent colour (10 presets or any custom colour) and switch between Glass and Flat looks in Settings → Appearance.',
      'New: set your recording delay yourself — type it in or pick your setup (interface, USB mic, laptop, Bluetooth) in Settings → Audio. Measure with mic now plays 10 clicks and tells you how solid the result is.',
      'Beat Lab overhaul: patterns (make as many as you want, up to 16 bars each) and a Song tab to arrange them into a full beat — “Add to track” drops the whole song on your timeline.',
      'Beat Lab: 56 brand-new sounds made from scratch (free to use, no samples) — 10 kicks, 7 snares, 6 claps, 10 hi-hats/open hats, 10 percussion, toms, rims, cymbals and FX — plus 9 one-tap kits (Trap, Rage, Drill, Plugg, Boom Bap, Lo-Fi, Afrobeats, House, Hard Hitter). Click a channel name to swap its sound.',
      'Beat Lab: way better 808s — 7 types (Clean, Hard, Drill Slide, Long, Short, Growl, Sub) with Distortion, Length, Slide, Punch and Tone. Overlap two 808 notes and it slides into the next one, like FL.',
      'Beat Lab: 12 instruments for melodies (Piano, E-Piano, Bells, Pluck, Pad, Rage Lead, Organ, Flute, Brass, Synth Bass, Choir, Guitar), note lengths up to a full bar, and a bigger piano roll.',
      'Beat Lab: velocity per step (Velocity button or right-click a pad), pan per channel, tune any channel, and long patterns scroll instead of squashing.',
      'Beat Lab: play notes from your computer keyboard (FL layout Z–M / Q–U, or one row A–K; [ and ] change octave) or a plugged-in MIDI keyboard — hit Rec and they land on the grid in time. Space plays/stops.',
    ],
  },
  {
    version: '0.25.17',
    date: '2026-11-05',
    changes: [
      'Vocal Vibe now builds a different chain for every artist — 120+ big artists have their own hand-tuned vocal signature (Drake: dark and close; SZA: airy and stacked; Travis: drenched in reverb…), and every other artist gets their own take on their style instead of the same preset.',
      'Fixed typing in Vocal Vibe on phones — the keyboard’s Go/Enter key now builds the chain.',
      'Fixed naming a save: pressing Enter in the name box used to cancel the save. Saving in the app now always lets you name (or rename) the song, and on Android “Save to a file” asks for a name too.',
    ],
  },
  {
    version: '0.25.16',
    date: '2026-11-05',
    changes: [
      '8 new built-in effects on every device, Android included: Bitcrusher, Pitch Shifter (deep voice / chipmunk / harmonies), Formant Filter (talk-box vowels), Vibrato, Bass Enhancer, Tape, Auto-Pan and Phaser.',
      'Android: fixed effects not showing up at all (the effect list said “No effect matches”) — every built-in effect is back on phones.',
    ],
  },
  {
    version: '0.25.15',
    date: '2026-11-04',
    changes: [
      'Recording latency now sets itself: the first time you record with a new mic or output, Session plays a few quiet clicks (about 3 seconds) and lines your takes up with the beat automatically. On headphones it uses your device’s own figure. You can turn this off in Settings → Audio.',
      'Vocal Vibe now knows 2,000+ popular artists across rap, R&B, pop, drill, country, rock, metal, Latin, Afrobeats, K-pop, indie, soul, EDM and more — and if you name someone it doesn’t know yet, it looks up their genre online and matches the vibe.',
      'Vocal Vibe has new styles: country, rock, metal, reggaeton/Latin, Afrobeats, K-pop, indie, soul, pluggnb, EDM and female rap.',
    ],
  },
  {
    version: '0.25.14',
    date: '2026-11-04',
    changes: [
      'New: Vocal Vibe — type what you want (“make me sound like Travis, in F minor, wetter”) and Session builds the whole vocal chain for you: Auto-Tune, EQ, compression, de-esser, delay, reverb and more. Hit the orange ✦ on any track or ✦ Vocal Vibe in FX & Plugins, then tweak it with “less Auto-Tune”, “brighter”, “more delay”…',
      'You can now see your waveform live while you record, instead of an empty red box.',
    ],
  },
  {
    version: '0.25.13',
    date: '2026-11-04',
    changes: [
      'Android: fixed people getting stuck on the Discord screen — the phone app now opens straight into Session.',
      'Android: you can now turn your phone sideways or hold it upright — the top bar, tabs and Beat Lab rearrange to fit.',
    ],
  },
  {
    version: '0.25.12',
    date: '2026-11-04',
    changes: [
      'Fixed saved songs crashing Session to a dark screen when you open them. Songs saved in the app are now stored much more efficiently: they open in about a second instead of freezing, the Saved sessions list opens instantly, and long songs that used to fail with “Could not save in the app” now save fine. Your existing saved songs still open (and get upgraded the first time you do).',
      'If Session ever crashes, it now reloads itself instead of leaving a blank window.',
    ],
  },
  {
    version: '0.25.11',
    date: '2026-11-04',
    changes: [
      'Fixed Live Collab still freezing when you send a session or go live from Messages.',
      'Messages are back to the classic Vault panel (Soundcheck is gone) — it ran smoother. It now reconnects by itself if The Vault drops instead of getting stuck on “Lost connection to The Vault”.',
    ],
  },
  {
    version: '0.25.10',
    date: '2026-11-04',
    changes: [
      'Fixed the app pegging the CPU and crashing — a single render hiccup could spin at full speed; it now recovers instead of locking up.',
      'Fixed the Discover tab freezing the app — it no longer tries to draw a huge list at once (capped, with search to narrow it down).',
      'Opening a saved song no longer white-screens — it skips any audio that won’t load and keeps the rest of the song.',
    ],
  },
  {
    version: '0.25.9',
    date: '2026-11-04',
    changes: [
      'Fixed Live Collab freezing the whole app when you start or join a session — sending the project and sharing audio no longer lock up the UI.',
    ],
  },
  {
    version: '0.25.8',
    date: '2026-11-04',
    changes: [
      'Beat Lab got a full FL-style makeover — now fills the screen with big glowing pads grouped by the beat, a beat ruler, and a bright playhead. Each channel has colour tags, mute + solo LEDs and its own volume; the top bar has editable BPM, swing and one-tap Clear; the piano roll adds octave scrolling and per-instrument volume. Same simple tap-and-drag workflow.',
      'Beat Lab volume now turns live — drag a channel’s slider and the sound changes instantly.',
      'Beat Lab no longer breaks with busy patterns — 4 bars with lots of channels now lays out cleanly instead of bugging out.',
      'Live Collab: if a session can’t connect it now says so and backs out, instead of hanging.',
      'Fixed Auto-Tune sounding crackly — smoothed the tuning so it no longer buzzes, and added a clip guard so it stays clean even pushed hard.',
    ],
  },
  {
    version: '0.25.5',
    date: '2026-11-04',
    changes: [
      'Messages now show who sent them, and your messages sit on the right while the other person’s sit on the left — like a normal chat.',
      'Fixed freezes when going full-screen and when opening chat — the timeline was getting stuck in a resize loop. Much smoother now.',
    ],
  },
  {
    version: '0.25.3',
    date: '2026-11-03',
    changes: [
      'Fixed the mic not picking up on Mac — Session now asks macOS for microphone access the first time you record, so your voice actually comes through.',
    ],
  },
  {
    version: '0.25.2',
    date: '2026-11-03',
    changes: [
      'Fixed messages not showing when you send them — your message now appears instantly, and if a send ever fails you’ll see why instead of it silently vanishing.',
    ],
  },
  {
    version: '0.25.1',
    date: '2026-11-03',
    changes: [
      'Beat Lab: press and DRAG to paint — swipe across the drum grid or piano roll to lay down notes fast, or tap one at a time.',
      'The Custom tab now scans your saved sounds (Your Sounds) — tap one to load it as an instrument, or import a new sound (it’s saved for next time).',
      'Fixed live-session invites not arriving: the invite is now sent immediately and the room connects in the background, so the other person always gets the Join button.',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-11-03',
    changes: [
      'NEW — Beat Lab: make beats right inside Session. Tap out drums on a step grid, write 808 and melody lines on a mini piano roll, and drop your own sounds in on the Custom tab. Hit “Add to track” to bounce the pattern onto the timeline.',
      'Dedicated tabs for each instrument (Drums, 808, Keys, Custom), live play with swing and 1–4 bar loops — like FL, way simpler. Open it from the 🎹 Beat button up top.',
      'Your beat (and any custom sounds) saves inside the song and travels when you send it.',
      'Sign-in is now fully silent: once you’ve approved Discord once, Session opens straight to the studio — it only checks your Beta role in the background and never shows a sign-in screen again.',
    ],
  },
  {
    version: '0.24.8',
    date: '2026-11-03',
    changes: [
      'Fixed takes landing a full second off on some audio interfaces — Session no longer trusts a bogus latency number the interface can report, so recordings line up properly.',
      'Nudge now works with Shift and Alt: select a take and press [ or ] (Shift = 1 second, Alt = 50 ms, plain = 5 ms). The big steps actually fire now.',
      'Recording offset (Settings → Audio) is now remembered between sessions — set your interface’s latency once and every take lines up.',
    ],
  },
  {
    version: '0.24.7',
    date: '2026-11-03',
    changes: [
      'Smoother everywhere: importing or dragging a beat no longer freezes — waveforms are now drawn off the main thread, so big files load without a hitch.',
      'Stopping a recording is instant now — no more hang when a take lands.',
      'New setting (Settings → Audio → Playback): turn the “Take aligned” note on or off after recording.',
    ],
  },
  {
    version: '0.24.6',
    date: '2026-11-03',
    changes: [
      'Soundcheck: start a live session straight from a chat again — the 🎧 button is back in the message bar, and live invites now show a Join button you can tap to jump in.',
    ],
  },
  {
    version: '0.24.5',
    date: '2026-11-03',
    changes: [
      'New Notes tab: write your lyrics, hooks and ideas in a floating pad while you work. It saves inside your song, so your words travel with the .session when you send it.',
      'Settings is now always in the top bar (next to Collab) — no more hunting for it.',
    ],
  },
  {
    version: '0.24.4',
    date: '2026-11-03',
    changes: [
      'Fixed “Nothing was recorded” for some setups: Session now makes sure the audio engine is actually running before a take starts (waking it if your system paused it), and a take that comes through with no input is kept and clearly flagged instead of vanishing.',
    ],
  },
  {
    version: '0.24.3',
    date: '2026-11-03',
    changes: [
      'Fixed recorded vocals sometimes playing back sped up / higher-pitched — Session now records the mic at the engine’s sample rate so takes always play at the right speed.',
    ],
  },
  {
    version: '0.24.2',
    date: '2026-11-03',
    changes: [
      'Fixed “Could not switch output device” when choosing headphones or another output — Session now has permission to switch outputs, and retries/falls back instead of failing.',
    ],
  },
  {
    version: '0.24.1',
    date: '2026-11-03',
    changes: [
      'Fixed the timeline sometimes going blank/purple (it would clear when the window or a panel resized at the wrong moment and not redraw). The playlist now always repaints and never gets stuck.',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-11-03',
    changes: [
      'Soundcheck: the new friends home — Home, Messages, Friends, Discover and Profile in one place, the same as The Vault. The Messages button now opens Soundcheck.',
      'Discord Rich Presence: while Session is open your Discord shows “Playing Session” and what you’re working on. Turn it off in Settings → About → Discord.',
      'Signing in is now seamless: if you’ve already approved Session, the Discord screen no longer pops up — it only appears the first time or when you need to sign in. Beta access is still checked every launch.',
    ],
  },
  {
    version: '0.23.0',
    date: '2026-11-03',
    changes: [
      'AI Mix: pointing it at an artist’s song now builds a full vocal chain to sound like them — compression, de-ess, match-EQ, enhancer, reverb and loudness (6 plugins), each dialed in from your voice vs the reference, not just an EQ.',
      'Every AI Mix is now saved automatically as a reusable preset (and full chains show up in your BandLab-style chain presets too).',
      'Auto tempo is far more accurate — a rebuilt beat detector locks onto the real BPM, with a one-tap Half-time / Double-time fix if a song is ever read an octave off.',
    ],
  },
  {
    version: '0.22.2',
    date: '2026-11-03',
    changes: [
      'Mac: Session now finds and launches The Vault app, so Messages and live collab work on Mac just like Windows (needs The Vault for Mac installed).',
    ],
  },
  {
    version: '0.22.1',
    date: '2026-11-03',
    changes: [
      'Mac: Session now tells you when a new version is out and gives you a one-click Download (Mac can’t auto-install yet, but you’ll never be stuck on an old build).',
    ],
  },
  {
    version: '0.22.0',
    date: '2026-11-03',
    changes: [
      'Chain presets: save EVERY effect on a track (all plugins + settings) as one named preset and load it onto any track — like BandLab. Use the “Chain presets” button on a mixer strip, or right-click a track.',
    ],
  },
  {
    version: '0.21.2',
    date: '2026-11-03',
    changes: [
      'Saving your own effect presets is now easy to find: a Save button in the plugin window, plus “Save current as preset…” and “Delete this preset” right in the preset menu.',
    ],
  },
  {
    version: '0.21.1',
    date: '2026-11-03',
    changes: [
      'Auto-Tune sounds cleaner: in-tune notes, held notes and consonants no longer get a hollow/phasey colouring, and it no longer warbles between notes when you slide.',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-11-03',
    changes: [
      'AI Mix is far more accurate: it now reads both your vocal and the reference at fine (1/3-octave) resolution and matches the tone closely, without boosting frequencies your voice doesn’t have.',
      'Auto tempo now asks which track and locks onto that track’s beat — point it at your drums for a reliable BPM.',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-03',
    changes: [
      'New tabbed toolbar: Home, Edit, Tempo & Key, Mix, FX & Plugins and Collab — same tools, far less clutter, with the transport always pinned.',
      'Save your own presets on any effect: dial in a sound, hit Save in the plugin window, and reuse it anytime (★ in the preset list). Delete removes your own presets.',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-03',
    changes: [
      'New Session Mic Mod: shape a plain mic toward pro studio-mic characters (condenser, tube, broadcast, ribbon, bright) with Proximity and Air.',
    ],
  },
  {
    version: '0.18.2',
    date: '2026-11-03',
    changes: [
      'Projects now save as .session files — send and open them in Session or straight from Messages, like an FL project.',
      'Older .pstudio projects still open fine.',
    ],
  },
  {
    version: '0.18.1',
    date: '2026-11-03',
    changes: [
      'Two new effects: Session Flanger (jet-sweep) and Session Chorus (thick, wide doubling). Find them under + Add effect.',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-11-03',
    changes: [
      'Metronome: a click on every beat while you play or record (the timer button next to BPM).',
      'Auto tempo: the new “Auto” button detects the BPM from a clip for you.',
    ],
  },
  {
    version: '0.17.3',
    date: '2026-11-03',
    changes: [
      'Audio that cut out after a device change or sleep now comes back on its own — no restart needed.',
      'Latency: new “Estimate (no mic)” option for headphone users, and the mic test now falls back to it automatically when it can’t hear the clicks.',
    ],
  },
  {
    version: '0.17.2',
    date: '2026-11-03',
    changes: [
      'Looping now works for long loops that run past the end of your clips (it no longer stops early).',
      'Fixed the timeline freezing when zoomed all the way out.',
      'Knobs no longer jump to the side when you turn them quickly.',
    ],
  },
  {
    version: '0.17.1',
    date: '2026-11-03',
    changes: [
      'Dropping an audio file onto a track now lands on THAT track, not track 1.',
      'New Back-to-start button (and the Home key) jumps the playhead to the beginning.',
      'Settings → Playback: choose whether Stop rewinds to the start or stays where you are.',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-10-31',
    changes: [
      'Live sessions now share audio: import a song or record a take and the other person hears it too.',
      'Shared audio is end-to-end encrypted with a room key — the relay server only ever sees scrambled data.',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-10-31',
    changes: [
      'Live sessions now sync your edits in real time — move, add, trim or delete clips and everyone in the room sees it.',
      'Volume, pan, mute/solo, effects and tempo stay in sync live too.',
      'Works alongside shared transport, so you can build a track together from anywhere.',
    ],
  },
  {
    version: '0.15.2',
    date: '2026-10-31',
    changes: [
      'Live sessions: fixed joining — the same person can now join from more than one device, and join errors are clearer.',
    ],
  },
  {
    version: '0.15.1',
    date: '2026-10-31',
    changes: [
      'Fixed starting a live session and sending files/mixes — they now send reliably with a caption.',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-10-31',
    changes: [
      'Live sessions: start a real-time session from a chat — send your project, then build together.',
      'See who’s in the room, and play / stop / scrub stays in sync for everyone live.',
      'Powered by your Discord login; only Beta Testers can join a room.',
    ],
  },
  {
    version: '0.14.3',
    date: '2026-10-31',
    changes: [
      'Send a whole session in a message — the other person can Open it in Session and keep building.',
      'Received files and mixes now have Open / Save buttons in the chat.',
    ],
  },
  {
    version: '0.14.2',
    date: '2026-10-31',
    changes: [
      'Messages now opens The Vault in the background for you — no need to launch it yourself.',
      'Send files (up to 25 MB) or your current mix right inside a chat.',
    ],
  },
  {
    version: '0.14.1',
    date: '2026-10-30',
    changes: [
      'Bigger buttons in the Messages header.',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-10-30',
    changes: [
      'Messages: end-to-end encrypted chat with other artists, right inside Session — the Vault button now opens Messages (powered by The Vault, needs The Vault 4.7+).',
    ],
  },
  {
    version: '0.13.2',
    date: '2026-10-30',
    changes: [
      'Settings now uses a gear icon.',
      'Automatic updates switch in Settings → About — turn background updates on or off.',
    ],
  },
  {
    version: '0.13.1',
    date: '2026-10-30',
    changes: [
      'Match is now called AI Mix.',
      'Recording over existing audio now replaces it (retake), like BandLab — with a Layer option in Audio settings to keep both.',
      'New Tuner: see the note you’re singing or playing live, with cents sharp/flat.',
    ],
  },
  {
    version: '0.12.9',
    date: '2026-10-30',
    changes: [
      'Build pipeline hardened — Mac and Windows builds no longer hang or block each other.',
    ],
  },
  {
    version: '0.12.8',
    date: '2026-10-30',
    changes: [
      'Softened scrolling through a track’s effects list so it no longer jumps.',
    ],
  },
  {
    version: '0.12.7',
    date: '2026-10-30',
    changes: [
      'Scroll the effects row on a track to reach all your effects.',
      'Softened the mixer’s sideways scroll so it no longer overshoots.',
    ],
  },
  {
    version: '0.12.6',
    date: '2026-10-30',
    changes: [
      'Fixed the empty timeline area showing the background too brightly — it now matches the app’s tint.',
    ],
  },
  {
    version: '0.12.5',
    date: '2026-10-30',
    changes: [
      'Beta access: Session now requires signing in with Discord and the Beta Tester role.',
    ],
  },
  {
    version: '0.12.4',
    date: '2026-10-30',
    changes: [
      'The timeline now scrolls to follow the playhead and clips as you drag them to the edge.',
      'Dragging no longer blue‑highlights track names and labels.',
      'Save your session inside the app (Save button → Save in app) — no file download needed.',
      'Play button shows a pause icon while a song is playing.',
      'Copy and paste clips with Ctrl+C / Ctrl+V, like you’d expect.',
    ],
  },
  {
    version: '0.12.3',
    date: '2026-10-30',
    changes: [
      'Audio settings: pick your input and output device, with live App output and Input monitor volumes.',
      'Loop tool: drag across the timeline to set a loop region; playback repeats it (press L to toggle).',
      'Auto-Tune config files: save your vocal setting and drop it on any song for hands-free tuning.',
      'Your Sounds: a personal sample library — import your own sounds and add them to any song.',
    ],
  },
  {
    version: '0.12.2',
    date: '2026-10-30',
    changes: [
      'AI Match mixer: match your vocal to a reference song or a built-in vibe.',
      'Save any match as a preset and reuse that sound on any track, any session.',
      'Right-click any track to apply a saved preset instantly.',
      'Check for updates button in Settings (no need to restart to look).',
      'Patch notes: see what changed after every update.',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-10-30',
    changes: [
      'Match (AI mix): analyzes a reference and fits an EQ + vocal chain to your voice.',
      'macOS version (built automatically alongside Windows).',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-10-30',
    changes: [
      'Sign in with Discord, and a Community button to connect with other artists.',
      'The Vault link now requires The Vault installed, with a get-it link.',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-10-29',
    changes: [
      'Session Auto-Tune and a new De-Esser.',
      'Scroll-wheel zoom, MP3 export, per-plugin volume, and a colour wheel.',
      'Workspace tabs (Playlist / Mixer / Both) with a Layout button.',
      'Centered input monitoring, and background auto-updates.',
    ],
  },
];
