/* Patch notes, newest first. Add an entry here each release; the matching version shows a
 * "What's new" popup after updating, and the list appears in Settings -> About. */
window.__PATCH_NOTES__ = [
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
