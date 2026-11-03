/* App wiring: transport, recording, file I/O, shortcuts. */
(function () {
  const S = window.Studio;
  const $ = (id) => document.getElementById(id);
  // .session is the project format (like .flp). Old .pstudio files still open.
  const FILTERS = [{ name: 'Session project', extensions: ['session', 'pstudio'] }];

  let playFrom = 0;
  let takeCount = 0;

  // Recording mode: 'replace' = a new take over existing audio becomes the take (like BandLab retake);
  // 'layer' = keep both (overdub). Saved on this computer.
  const RECKEY = 'ps.recordMode';
  S.recordMode = (() => { try { return localStorage.getItem(RECKEY) || 'replace'; } catch (e) { return 'replace'; } })();
  S.setRecordMode = (m) => { S.recordMode = m === 'layer' ? 'layer' : 'replace'; try { localStorage.setItem(RECKEY, S.recordMode); } catch (e) {} };

  // Load a .pstudio project from its text (used by Open, and by Messages' "Open in Session").
  S.openProjectText = (text) => loadEnvelope(text);

  /** Remove the [s,e] span from other clips on a track (trim/split/remove), leaving the new take clean. */
  function clearSpan(track, s, e, exceptId) {
    const EPS = 1e-3;
    for (const c of [...track.clips]) {
      if (c.id === exceptId) continue;
      const cs = c.start, ce = c.start + c.dur;
      if (ce <= s + EPS || cs >= e - EPS) continue;          // no overlap
      if (cs >= s - EPS && ce <= e + EPS) { S.clipOps.remove(track, c); continue; } // fully covered
      if (cs < s && ce > e) { const r = S.clipOps.split(track, c, e); if (r) S.clipOps.trimEnd(c, s); else S.clipOps.remove(track, c); continue; } // take sits inside: keep both ends
      if (cs < s) { S.clipOps.trimEnd(c, s); continue; }     // keep the left part
      S.clipOps.trimStart(c, e);                             // keep the right part
    }
  }

  S.refresh = {
    structure() {
      S.engine.sync(S.project);
      S.timeline.renderHeaders();
      S.mixer.render();
      S.timeline.dirty = true;
      document.title = S.project.name + ' – Session';
      $('proj-name').value = S.project.name;
      syncGridUI();
    },
    mix() {
      S.engine.applyAllMix();
    },
  };

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
  };

  /* ---------- input ---------- */
  async function populateInputs() {
    const devs = await S.engine.listInputs();
    const sel = $('sel-input');
    const keep = sel.value;
    const current = S.engine.mic && S.engine.mic.stream.getAudioTracks()[0].getSettings().deviceId;
    sel.innerHTML = '<option value="">Default input</option>';
    for (const d of devs) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || 'Input ' + (sel.length + 1);
      sel.appendChild(o);
    }
    if (current) sel.value = current;
    else if (keep) sel.value = keep;
  }

  S.ensureInput = async () => {
    if (S.engine.mic) return true;
    try {
      await S.engine.openInput($('sel-input').value || undefined);
      await populateInputs();
      return true;
    } catch (e) {
      S.toast('Microphone unavailable: ' + (e.message || e.name));
      return false;
    }
  };

  /* ---------- transport ---------- */
  function updateButtons() {
    $('btn-rec').classList.toggle('active', S.engine.isRecording);
    const playing = S.engine.playing && !S.engine.isRecording;
    const pb = $('btn-play');
    pb.classList.toggle('active', playing);
    // show a pause icon while a song is playing, a play triangle when stopped
    pb.innerHTML = S.ui.icon(playing ? 'pause' : 'play', 18);
  }

  const collabTx = (type, pos) => { try { if (S.collab && S.collab.active()) S.collab.notifyTransport(type, pos); } catch (e) {} };

  S.play = () => {
    if (S.engine.playing) return;
    playFrom = S.playhead;
    S.engine.play(S.playhead);
    updateButtons();
    collabTx('play', S.playhead);
  };

  // Setting: on stop, rewind to where playback began (default) or stay where it is now.
  const stopReturns = () => { try { const v = localStorage.getItem('ps.stopReturns'); return v === null ? true : v === '1'; } catch (e) { return true; } };

  S.stopTransport = () => {
    if (S.engine.isRecording) return finishRecording();
    if (S.engine.playing) {
      const here = S.playhead; // current position while playing
      S.engine.stop();
      S.playhead = stopReturns() ? playFrom : here;
    } else {
      S.playhead = 0;
    }
    updateButtons();
    S.timeline.dirty = true;
    collabTx('stop', S.playhead);
  };

  // Jump the playhead back to the very start.
  S.toStart = () => { S.seek(0); };

  S.seek = (t) => {
    S.playhead = t;
    if (S.engine.playing && !S.engine.isRecording) S.engine.play(t);
    S.timeline.dirty = true;
    collabTx('seek', t);
  };

  async function startRecording() {
    const armed = S.project.tracks.find((t) => t.arm);
    if (!armed) return S.toast('Arm a track first (the R button on a track)');
    if (!(await S.ensureInput())) return;
    if (S.engine.playing) S.engine.stop();
    playFrom = S.playhead;
    try {
      S.engine.startRecording(armed.id, S.playhead);
    } catch (e) {
      return S.toast(e.message);
    }
    updateButtons();
  }

  // Loudest sample in a take. Below this the mic captured nothing usable (a quiet
  // room still floors around -55 dB); ~ -56 dBFS, so we only flag truly dead input.
  const SILENCE_PEAK = 0.0016;
  function takePeak(buffer) {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      const step = Math.max(1, Math.floor(d.length / 200000)); // sample up to ~200k points
      for (let i = 0; i < d.length; i += step) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
      }
    }
    return peak;
  }

  function finishRecording() {
    const res = S.engine.stopRecording();
    updateButtons();
    if (!res) return S.toast('Nothing was recorded');
    const idx = S.project.tracks.findIndex((t) => t.id === res.trackId);
    if (idx < 0) return;
    const silent = takePeak(res.buffer) < SILENCE_PEAK;
    S.history.push(); // make the take (and any replaced audio) one undo step
    const id = S.addAsset('Take ' + ++takeCount, res.buffer);
    const clip = S.addClip(idx, id, res.startPos + res.startShift, { offset: res.compensation, dur: res.buffer.duration - res.compensation });
    // Retake: a new take over existing audio replaces it, unless Layer mode is on.
    if (S.recordMode !== 'layer' && !silent) clearSpan(S.project.tracks[idx], clip.start, clip.start + clip.dur, clip.id);
    S.timeline.selected = clip.id;
    S.playhead = clip.start + clip.dur;
    S.timeline.resize();
    S.refresh.structure();
    S.tools.afterContent();
    // No mic activity: don't pretend a take exists and line it up to the beat. Warn, and offer a redo.
    if (silent) return warnNoMicActivity(idx, clip);
    const ms = Math.round((res.compensation - res.startShift) * 1000);
    S.toast('Take aligned: shifted ' + ms + ' ms earlier (' + (S.engine.calibrated != null ? 'measured' : 'estimated') + ' latency). Late or early? ' + (document.documentElement.classList.contains('platform-mobile') ? 'Long-press the take and choose Nudge.' : 'Use [ and ] to nudge it.'));
  }

  /** Shown after a recording that came through silent. Recurs every time it happens. */
  function warnNoMicActivity(trackIdx, clip) {
    const start = clip.start;
    const removeTake = () => {
      const tr = S.project.tracks[trackIdx];
      if (tr) S.clipOps.remove(tr, clip);
      S.timeline.selected = null;
      S.playhead = start;
      S.timeline.resize();
      S.refresh.structure();
      S.tools.afterContent();
    };
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `<form method="dialog"><h3>No sound from your mic</h3>
      <p>That take came through silent — Session heard no mic activity, so it was <b>not</b> lined up to the beat. Check that:</p>
      <ul>
        <li>the right mic is chosen in the <b>Input</b> box (not a disconnected device or your headphones)</li>
        <li>the mic is not muted and its level is turned up</li>
        <li>Session is allowed to use the microphone</li>
        <li>the mic is plugged in and working</li>
      </ul>
      <div class="row"><button value="keep" class="btn">Keep the silent take</button><button value="del" class="btn">Delete it</button><button value="again" class="btn primary">Record again</button></div></form>`;
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      dlg.remove();
      if (v === 'del') removeTake();
      else if (v === 'again') {
        removeTake();
        setTimeout(() => startRecording(), 120); // let the dialog close first
      }
    });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  /* ---------- import / files ---------- */
  async function importFiles(files, targetIdx) {
    const tracks = S.project.tracks;
    // drop onto a track -> that track; otherwise the armed track, else the first
    let idx = (targetIdx != null && targetIdx >= 0) ? targetIdx : Math.max(0, tracks.findIndex((t) => t.arm));
    for (const f of files) {
      try {
        const buf = await S.ctx.decodeAudioData(await f.arrayBuffer());
        while (idx >= S.project.tracks.length) S.project.tracks.push(S.newTrack(S.project.tracks.length));
        const id = S.addAsset(f.name.replace(/\.[^.]+$/, ''), buf);
        S.addClip(idx, id, S.playhead);
        idx++;
      } catch (e) {
        S.toast('Could not read ' + f.name);
      }
    }
    S.refresh.structure();
    S.timeline.resize();
    S.tools.afterContent();
  }

  async function loadEnvelope(text) {
    let obj = JSON.parse(text);
    if (obj.encrypted) {
      const pass = await S.askText('This session is encrypted. Enter the passphrase', { password: true });
      if (!pass) return;
      obj = await S.decryptPacked(obj, pass);
    }
    const project = await S.unpackProject(obj, S.ctx);
    if (S.engine.mic) S.engine.setMonitor(null);
    if (S.sessions) S.sessions.currentId = null; // opened from a file, not an in-app slot
    S.setProject(project);
    S.refresh.structure();
    S.timeline.resize();
    S.toast('Opened "' + project.name + '"');
  }

  const safeName = () => (S.project.name || 'session').replace(/[^\w\- ]+/g, '_');

  async function save() {
    try {
      await S.native.syncStates();
      const text = JSON.stringify(S.packProject());
      const path = await window.studioHost.saveFile({ data: text, defaultName: safeName() + '.session', filters: FILTERS });
      if (path) S.toast('Saved');
    } catch (e) {
      S.toast('Save failed: ' + e.message);
    }
  }

  async function share() {
    const pass = await S.askText('Passphrase for the encrypted copy (8+ characters)', { password: true });
    if (!pass) return;
    if (pass.length < 8) return S.toast('Use at least 8 characters');
    const again = await S.askText('Type the passphrase again', { password: true });
    if (again !== pass) return S.toast('Passphrases did not match');
    try {
      S.toast('Encrypting…');
      await S.native.syncStates();
      const text = await S.encryptPacked(S.packProject(), pass);
      const path = await window.studioHost.saveFile({
        data: text,
        defaultName: safeName() + ' (encrypted).session',
        filters: FILTERS,
      });
      if (path) S.toast('Encrypted copy saved. Send the file and tell them the passphrase separately.');
    } catch (e) {
      S.toast('Share failed: ' + e.message);
    }
  }

  async function open() {
    const f = await window.studioHost.openFile({ filters: FILTERS });
    if (!f) return;
    try {
      await loadEnvelope(f.data);
    } catch (e) {
      S.toast('Open failed: ' + e.message);
    }
  }

  /** The whole song as an AudioBuffer (offline render, or real-time bounce when VST3 plugins are used). */
  S.renderSongBuffer = async () => {
    if (S.native.projectUsesNative(S.project)) {
      if (S.engine.isRecording || S.engine.playing) S.stopTransport();
      S.toast('VST3 plugins are in use, so the export plays in real time. It takes as long as the song.');
      return S.native.bounce(S.project);
    }
    return S.renderMix(S.project);
  };
  /** The whole song as WAV bytes (used by the Vault and WAV export). */
  S.renderSongWav = async () => S.encodeWav(await S.renderSongBuffer());

  /** Encode an AudioBuffer to MP3 bytes with the vendored lamejs encoder. */
  S.encodeMp3 = (buf, { bitrate = 256 } = {}) => {
    const L = window.lamejs;
    if (!L || !L.Mp3Encoder) throw new Error('MP3 encoder not loaded');
    const ch = buf.numberOfChannels >= 2 ? 2 : 1;
    const enc = new L.Mp3Encoder(ch, buf.sampleRate, bitrate);
    const toInt16 = (f) => {
      const o = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const s = Math.max(-1, Math.min(1, f[i]));
        o[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return o;
    };
    const left = toInt16(buf.getChannelData(0));
    const right = ch > 1 ? toInt16(buf.getChannelData(1)) : null;
    const out = [];
    const block = 1152;
    for (let i = 0; i < left.length; i += block) {
      const lc = left.subarray(i, i + block);
      const rc = right ? right.subarray(i, i + block) : null;
      const mp3 = ch > 1 ? enc.encodeBuffer(lc, rc) : enc.encodeBuffer(lc);
      if (mp3.length) out.push(mp3);
    }
    const end = enc.flush();
    if (end.length) out.push(end);
    let len = 0;
    out.forEach((a) => (len += a.length));
    const res = new Uint8Array(len);
    let off = 0;
    out.forEach((a) => {
      res.set(a, off);
      off += a.length;
    });
    return res;
  };

  S.importFiles = (files, idx) => importFiles(files, idx);

  async function exportSong(format, bitrate) {
    try {
      if (!S.native.projectUsesNative(S.project)) S.toast('Rendering mixdown…');
      const buf = await S.renderSongBuffer();
      let bytes, ext;
      if (format === 'mp3') {
        S.toast('Encoding MP3…');
        bytes = S.encodeMp3(buf, { bitrate });
        ext = 'mp3';
      } else {
        bytes = S.encodeWav(buf);
        ext = 'wav';
      }
      const path = await window.studioHost.saveFile({
        data: bytes,
        binary: true,
        defaultName: safeName() + '.' + ext,
        filters: [{ name: ext.toUpperCase() + ' audio', extensions: [ext] }],
      });
      if (path) S.toast('Exported ' + ext.toUpperCase() + (format === 'mp3' ? ' (' + bitrate + ' kbps)' : ''));
    } catch (e) {
      S.toast('Export failed: ' + e.message);
    }
  }

  /** Little menu off the Export button: pick WAV or an MP3 quality. */
  function exportMenu(x, y) {
    S.clips.menu(x, y, [
      { label: 'WAV — lossless', hint: 'best quality', action: () => exportSong('wav') },
      { sep: true },
      { label: 'MP3 — 320 kbps', hint: 'highest MP3', action: () => exportSong('mp3', 320) },
      { label: 'MP3 — 256 kbps', hint: 'great', action: () => exportSong('mp3', 256) },
      { label: 'MP3 — 192 kbps', hint: 'smaller file', action: () => exportSong('mp3', 192) },
      { label: 'MP3 — 128 kbps', hint: 'smallest', action: () => exportSong('mp3', 128) },
    ]);
  }

  /* ---------- main loop ---------- */
  let inShown = 0;
  function loop() {
    // if the audio context slipped out of 'running' while we're meant to be playing
    // (device change, sleep, power event), bring it back so sound doesn't stay dead
    if (S.engine.playing && S.engine.ensureRunning) S.engine.ensureRunning();
    const pos = S.engine.position();
    if (pos !== null) {
      S.playhead = pos;
      const lp = S.project.loop;
      const looping = lp && lp.on && !S.engine.isRecording && lp.end - lp.start > 0.05;
      if (looping && pos >= lp.end) {
        S.engine.play(lp.start); // jump back to the loop start and keep going
        S.playhead = lp.start;
      } else if (!S.engine.isRecording && !looping && pos > S.projectLength() + 0.4) S.stopTransport();
      // while looping we never auto-stop at the end of content — the loop region drives playback,
      // so a loop that extends past the last clip still wraps correctly.
    }
    $('time').textContent = fmtTime(S.playhead);
    $('bbt').textContent = S.grid.bbt(S.playhead);
    // skip drawing whatever panel is hidden by the current view, to keep things smooth
    const view = S.workspace ? S.workspace.current() : 'both';
    if (view !== 'mixer') S.timeline.draw();
    if (view !== 'playlist') S.mixer.updateMeters();
    const lvl = S.engine.inputLevel();
    inShown = Math.max(lvl, inShown * 0.93); // instant rise, smooth fall
    $('in-meter').style.width = (S.clamp(((inShown > 0.00003 ? 20 * Math.log10(inShown) : -90) + 60) / 60, 0, 1) * 100).toFixed(1) + '%';
    requestAnimationFrame(loop);
  }


  /* ---------- undo / redo ---------- */
  function doUndo() {
    if (S.engine.isRecording) return;
    if (!S.history.undo()) S.toast('Nothing to undo');
  }
  function doRedo() {
    if (S.engine.isRecording) return;
    if (!S.history.redo()) S.toast('Nothing to redo');
  }
  function updateHistoryButtons() {
    $('btn-undo').disabled = !S.history.canUndo();
    $('btn-redo').disabled = !S.history.canRedo();
  }

  /* ---------- latency calibration (saved per input device) ---------- */
  const calKey = () => 'ps.latency.' + ($('sel-input').value || 'default');
  const readStore = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch (e) {
      return null;
    }
  };
  const writeStore = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  };

  function updateLatencyReadout() {
    const el = $('lat-readout');
    const measured = S.engine.calibrated != null;
    const ms = Math.round((measured ? S.engine.calibrated : S.engine.latencySeconds()) * 1000);
    el.textContent = (measured ? '' : '~') + ms + ' ms';
    $('btn-cal').title = 'Recording delay: ' + ms + ' ms (' + (measured ? 'measured' : 'estimate') + '). Click to measure it so recorded takes line up with the beat.';
  }

  function loadSavedCalibration() {
    const saved = readStore(calKey());
    S.engine.calibrated = saved && saved.sampleRate === S.ctx.sampleRate && saved.seconds >= 0 && saved.seconds <= 0.5 ? saved.seconds : null;
    updateLatencyReadout();
  }

  // No-mic fallback: use the browser's reported output/input delay. Works on headphones,
  // interfaces, anything — no clicks needed. Less exact than the acoustic measure, but a
  // good baseline so recorded takes still line up.
  function useAutoLatency(quiet) {
    const sec = (S.ctx.baseLatency || 0) + (S.ctx.outputLatency || 0) + S.engine.inputLatency();
    const clamped = Math.min(0.5, Math.max(0, sec));
    S.engine.calibrated = clamped;
    writeStore(calKey(), { seconds: clamped, sampleRate: S.ctx.sampleRate });
    updateLatencyReadout();
    if (!quiet) S.toast('Using automatic latency estimate: ' + Math.round(clamped * 1000) + ' ms');
  }
  S.useAutoLatency = useAutoLatency;

  async function runCalibration() {
    if (S.engine.isRecording) return S.toast('Stop recording first');
    if (!(await S.ensureInput())) return;
    const btn = $('btn-cal');
    btn.disabled = true;
    S.toast('Measuring… you will hear a few clicks');
    try {
      if (S.engine.playing) S.stopTransport();
      const r = await S.engine.calibrateLatency();
      writeStore(calKey(), { seconds: r.seconds, sampleRate: S.ctx.sampleRate });
      S.toast('Latency measured: ' + Math.round(r.seconds * 1000) + ' ms');
    } catch (e) {
      S.toast(e.message);
      // Mic couldn't hear the clicks (headphones / quiet mic) — fall back to the automatic
      // estimate so the user still gets a usable, aligned value instead of nothing.
      if (/hear the test clicks/i.test(e.message || '')) useAutoLatency();
    } finally {
      btn.disabled = false;
      updateLatencyReadout();
    }
  }

  /** First launch only: offer to measure latency (opens the mic only if the person agrees). */
  function offerFirstRunCalibration() {
    if (readStore('ps.calOffered')) return;
    writeStore('ps.calOffered', true);
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `<form method="dialog"><h3>Line up your recordings</h3>
      <p>Every setup has a small delay between hearing the backing track and the mic picking you up. Private Studio can measure it with a few test clicks so takes land on the beat.</p>
      <p>This test needs the mic to hear the speakers: turn the volume up and put them near the mic, or plug a loopback cable from output to input. With headphones on it cannot hear anything. In that case skip it and use the <b>Nudge ms</b> box, or select a take and press <b>[</b> / <b>]</b> to shift it earlier or later. You can run this test any time with <b>Fix latency</b>.</p>
      <div class="row"><button value="later" class="btn">Not now</button><button value="go" class="btn primary">Measure now</button></div></form>`;
    dlg.addEventListener('close', () => {
      const go = dlg.returnValue === 'go';
      dlg.remove();
      if (go) runCalibration();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  /* ---------- tempo, grid and tools ---------- */
  function syncGridUI() {
    const p = S.grid.ensure(S.project);
    if (document.activeElement !== $('bpm')) $('bpm').value = p.bpm;
    $('sig').value = String(p.beatsPerBar);
    $('grid-mode').value = p.grid.mode;
    const divs = p.grid.mode === 'bars' ? S.grid.BAR_DIVS : S.grid.TIME_DIVS;
    $('grid-div').innerHTML = divs.map((d) => '<option value="' + d.id + '">' + d.label + '</option>').join('');
    $('grid-div').value = p.grid.mode === 'bars' ? p.grid.div : p.grid.timeDiv;
    $('btn-snap').classList.toggle('on', !!p.grid.snap);
    $('btn-snap').title = 'Snap to grid is ' + (p.grid.snap ? 'ON' : 'OFF') + ' (G). Hold Alt while dragging to move freely.';
    S.timeline.dirty = true;
  }

  function setBpm(v) {
    if (!(v >= 20 && v <= 400)) return syncGridUI();
    S.project.bpm = Math.round(v * 100) / 100;
    syncGridUI();
    S.emit('tempo-changed', { bpm: S.project.bpm, beatsPerBar: S.project.beatsPerBar });
  }

  // Auto-detect tempo from the BEAT on a chosen track. Asks which track when there's more
  // than one with audio, then reads the tempo from that track's longest clip (its groove).
  function detectFromTrack(t) {
    let buf = null;
    for (const c of t.clips || []) { const b = S.buffers.get(c.asset); if (b && (!buf || b.duration > buf.duration)) buf = b; }
    if (!buf) return S.toast('That track has no audio.');
    if (!S.detectBpm) return;
    S.toast('Finding the beat…');
    setTimeout(() => {
      const bpm = S.detectBpm(buf);
      if (!bpm) return S.toast('Couldn’t find a clear beat on “' + (t.name || 'track') + '”.');
      setBpm(bpm);
      // Tempo octave is ambiguous (e.g. 150 vs 75) — offer one-tap half/double so it's always right.
      const half = Math.round(bpm / 2 * 10) / 10, dbl = Math.round(bpm * 2 * 10) / 10;
      const items = [{ label: 'Keep ' + bpm + ' BPM', hint: 'detected', action: () => {} }];
      if (half >= 40) items.push({ label: 'Half-time: ' + half + ' BPM', action: () => setBpm(half) });
      if (dbl <= 300) items.push({ label: 'Double-time: ' + dbl + ' BPM', action: () => setBpm(dbl) });
      const btn = $('btn-autobpm'), r = btn && btn.getBoundingClientRect();
      if (r && S.clips && S.clips.menu) S.clips.menu(r.left, r.bottom + 4, items);
      S.toast('Detected ' + bpm + ' BPM from “' + (t.name || 'track') + '”. Not feeling it? Pick half or double.');
    }, 20);
  }
  function autoBpm() {
    const withAudio = S.project.tracks.filter((t) => (t.clips || []).some((c) => S.buffers.has(c.asset)));
    if (!withAudio.length) return S.toast('Import or record something first — Auto reads the beat from a track.');
    if (withAudio.length === 1) return detectFromTrack(withAudio[0]);
    const btn = $('btn-autobpm');
    const r = btn.getBoundingClientRect();
    const items = withAudio.map((t, i) => ({
      label: t.name || ('Track ' + (S.project.tracks.indexOf(t) + 1)),
      hint: 'read the beat here',
      action: () => detectFromTrack(t),
    }));
    if (S.clips && S.clips.menu) S.clips.menu(r.left, r.bottom + 4, items);
    else detectFromTrack(withAudio[0]);
  }

  const taps = [];
  function tapTempo() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length < 3) return S.toast('Keep tapping in time…');
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(Math.round(60000 / avg));
  }

  function initGridControls() {
    $('sig').innerHTML = [2, 3, 4, 5, 6, 7, 9, 12].map((n) => '<option value="' + n + '">' + n + '/4</option>').join('');
    $('bpm').onchange = (e) => setBpm(+e.target.value);
    $('bpm').onkeydown = (e) => {
      if (e.key === 'Enter') e.target.blur();
      e.stopPropagation();
    };
    $('btn-tap').onclick = tapTempo;
    { const ab = $('btn-autobpm'); if (ab) ab.onclick = autoBpm; }
    $('sig').onchange = (e) => {
      S.project.beatsPerBar = +e.target.value;
      syncGridUI();
      S.emit('tempo-changed', { bpm: S.project.bpm, beatsPerBar: S.project.beatsPerBar });
    };
    $('grid-mode').onchange = (e) => {
      S.project.grid.mode = e.target.value;
      syncGridUI();
    };
    $('grid-div').onchange = (e) => {
      if (S.project.grid.mode === 'bars') S.project.grid.div = e.target.value;
      else S.project.grid.timeDiv = e.target.value;
      syncGridUI();
    };
    $('btn-snap').onclick = toggleSnap;
    document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => S.timeline.setTool(b.dataset.tool)));
    S.timeline.setTool('select');
  }

  function toggleSnap() {
    S.project.grid.snap = !S.project.grid.snap;
    syncGridUI();
    S.toast('Snap to grid ' + (S.project.grid.snap ? 'on' : 'off'));
  }

  /* ---------- mixer panel: resize + hide ---------- */
  function initMixerPanel() {
    const panel = $('mix-panel');
    const btn = $('btn-mix-toggle');
    const saved = readStore('ps.mixer') || { collapsed: innerHeight < 600 }; // small screens start with the mixer folded away
    if (saved.h) panel.style.height = S.clamp(saved.h, 160, 700) + 'px';
    const setCollapsed = (c) => {
      panel.classList.toggle('collapsed', c);
      btn.textContent = c ? 'Show' : 'Hide';
      writeStore('ps.mixer', { h: parseInt(panel.style.height) || 360, collapsed: c });
    };
    setCollapsed(!!saved.collapsed);
    btn.onclick = () => setCollapsed(!panel.classList.contains('collapsed'));
    S.toggleMixer = btn.onclick;
    S.showMixer = () => setCollapsed(false);
    S.setMixerHeight = (h) => {
      panel.style.height = S.clamp(h, 160, Math.max(200, innerHeight - 260)) + 'px';
      writeStore('ps.mixer', { h: parseInt(panel.style.height), collapsed: false });
    };
    // the drag handle (#mix-split) is wired by workspace.js, so it works both docked bottom and right
  }

  /* ---------- load screen ---------- */
  const splashStart = performance.now();
  /* the bar glides toward each step and keeps creeping while a step is busy, so it never sits still or jumps */
  let spTarget = 0;
  let spShown = 0;
  let spRunning = false;
  function spFrame() {
    const bar = $('sp-progress');
    if (!bar) return (spRunning = false);
    const goal = spTarget >= 100 ? 100 : Math.min(spTarget + 12, 96);
    const rate = spTarget >= 100 ? 0.16 : spShown < spTarget ? 0.09 : 0.012;
    spShown += (goal - spShown) * rate;
    bar.style.width = spShown.toFixed(2) + '%';
    requestAnimationFrame(spFrame);
  }
  function splash(pct, text) {
    spTarget = Math.max(spTarget, pct);
    if (!spRunning) {
      spRunning = true;
      requestAnimationFrame(spFrame);
    }
    if (text && $('sp-status')) $('sp-status').textContent = text;
  }
  function hideSplash() {
    splash(100, 'Ready');
    const wait = Math.max(450, 1500 - (performance.now() - splashStart));
    return new Promise((res) =>
      setTimeout(() => {
        const el = $('splash');
        if (el) {
          el.classList.add('done');
          setTimeout(() => el.remove(), 700);
        }
        res();
      }, wait)
    );
  }

  async function init() {
    S.ui.applyIcons();
    splash(12, 'Loading plugins…');
    let pluginReport = [];
    try {
      pluginReport = await S.loadPlugins();
    } catch (e) {
      console.warn(e);
    }
    splash(45, 'Starting the audio engine…');
    S.ctx = new AudioContext({ latencyHint: 'interactive' });
    await S.prepareContext(S.ctx);
    S.engine = new S.Engine(S.ctx);
    splash(65, 'Looking for VST3 plugins…');
    S.native.loadCached();
    splash(80, 'Building your studio…');
    $('btn-vst3').onclick = () => S.native.openDialog();
    S.timeline.init($('tl-scroll'), $('tl-canvas'), $('tl-headers'));
    S.mixer.init($('mixer'));
    for (const r of pluginReport) if (r.error) S.toast('Plugin ' + r.file + ': ' + r.error);
    S.engine.onInputLost = () => {
      if (S.engine.isRecording) finishRecording();
      S.engine.closeInput();
      populateInputs();
      S.toast('The input was disconnected. Plug it back in and press Record again.');
    };
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => populateInputs().catch(() => {}));
    $('btn-plugin-import').onclick = async () => {
      let urls;
      try {
        urls = await window.studioHost.importPlugins();
      } catch (e) {
        return S.toast('Import failed: ' + e.message);
      }
      if (!urls || !urls.length) return;
      const reports = [];
      for (const u of urls) reports.push(await S.loadPluginUrl(u));
      await S.prepareContext(S.ctx);
      S.engine.reloadChangedPlugins();
      S.refresh.structure();
      const ok = reports.flatMap((r) => r.names);
      if (ok.length) S.toast('Loaded: ' + ok.join(', ') + '. Find it under + Add effect on any strip.');
      for (const r of reports) if (r.error) S.toast(r.file + ': ' + r.error);
    };

    $('btn-rec').onclick = () => (S.engine.isRecording ? finishRecording() : startRecording());
    $('btn-play').onclick = () => (S.engine.playing ? S.stopTransport() : S.play());
    $('btn-stop').onclick = () => S.stopTransport();
    { const h = $('btn-home'); if (h) h.onclick = () => S.toStart(); }
    $('btn-zoom-in').onclick = () => S.timeline.zoom(1.3);
    $('btn-zoom-out').onclick = () => S.timeline.zoom(1 / 1.3);
    $('btn-split').onclick = () => S.timeline.splitSelected();
    $('btn-del').onclick = () => S.timeline.deleteSelected();
    $('btn-save').onclick = (e) => (S.sessions ? S.sessions.saveMenu(e.clientX, e.clientY, save) : save());
    $('btn-share').onclick = share;
    $('btn-open').onclick = (e) => (S.sessions ? S.sessions.openMenu(e.clientX, e.clientY, open) : open());
    $('btn-export').onclick = (e) => exportMenu(e.clientX, e.clientY);
    $('btn-plugins').onclick = () => window.studioHost.openPluginFolder();
    $('btn-import').onclick = () => $('file-import').click();
    $('file-import').onchange = (e) => {
      importFiles([...e.target.files]);
      e.target.value = '';
    };
    $('btn-new').onclick = () => {
      if (!confirm('Start a new session? Unsaved changes will be lost.')) return;
      S.engine.stop();
      S.buffers.clear();
      if (S.sessions) S.sessions.currentId = null;
      S.setProject(S.newProject());
      S.refresh.structure();
    };
    $('proj-name').onchange = (e) => {
      S.project.name = e.target.value || 'Untitled Session';
      document.title = S.project.name + ' – Session';
    };
    $('lat').onchange = (e) => (S.engine.latencyOffsetMs = +e.target.value || 0);
    $('btn-cal').onclick = runCalibration;
    $('btn-undo').onclick = doUndo;
    $('btn-redo').onclick = doRedo;
    S.on('history-changed', updateHistoryButtons);
    S.tools.init();
    S.background.init();
    if (S.settings) { S.settings.init(); S.settings.checkWhatsNew(); }
    if (S.vault) S.vault.init();
    if (S.messages) S.messages.init(); // repoints the Vault button to the Messages panel
    if (S.match) S.match.init();
    if (S.sounds) S.sounds.init();
    if (S.sessions) S.sessions.init();
    if (S.tuner) S.tuner.init();
    if (S.metronome) S.metronome.init();
    if (S.collab) S.collab.init();
    if (S.updates) S.updates.init();
    initGridControls();
    initMixerPanel();
    if (S.workspace) S.workspace.init(); // after the mixer panel exists (uses S.showMixer / setMixerHeight)
    updateHistoryButtons();
    $('sel-input').onchange = async () => {
      if (!S.engine.mic) return;
      const mon = S.engine.monitorTrackId;
      try {
        await S.engine.openInput($('sel-input').value || undefined);
        if (mon) S.engine.setMonitor(mon);
        loadSavedCalibration();
      } catch (e) {
        S.toast('Could not open that input: ' + e.message);
      }
    };

    // drag & drop audio files
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const all = [...e.dataTransfer.files];
      const pic = all.find((f) => f.type.startsWith('image/'));
      if (pic) {
        S.background.setImageFile(pic).catch((err) => S.toast('Could not use that picture: ' + err.message));
        return;
      }
      const files = all.filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f.name));
      const target = S.timeline && S.timeline.trackAtClient ? S.timeline.trackAtClient(e.clientX, e.clientY) : -1;
      if (files.length) importFiles(files, target);
    });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      if (tag === 'select' || tag === 'textarea') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        save();
      } else if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        doRedo();
      } else if (mod && k === 'c') {
        e.preventDefault();
        S.timeline.copySelected();
      } else if (mod && k === 'v') {
        e.preventDefault();
        S.timeline.pasteAtPlayhead();
      } else if (mod && k === 'd') {
        e.preventDefault();
        S.timeline.duplicateSelected();
      } else if (mod && k === 'a') {
        e.preventDefault();
        S.timeline.selectAll();
      } else if (e.key === 'Escape') {
        S.timeline.selected = null;
      } else if (e.key === 'F9') {
        e.preventDefault();
        S.toggleMixer && S.toggleMixer();
      } else if (!mod && !e.altKey && ['v', 'c', 'e', 'm'].includes(k)) {
        S.timeline.setTool({ v: 'select', c: 'slice', e: 'erase', m: 'mute' }[k]);
      } else if (!mod && !e.altKey && k === 'l') {
        if (S.timeline.toggleLoop) S.timeline.toggleLoop();
      } else if (!mod && k === 'g') {
        toggleSnap();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (S.engine.playing || S.engine.isRecording) S.stopTransport();
        else S.play();
      } else if (e.key === 'r' || e.key === 'R') {
        if (!mod) S.engine.isRecording ? finishRecording() : startRecording();
      } else if (e.key === 's' || e.key === 'S') {
        if (!mod) S.timeline.splitSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        S.timeline.deleteSelected();
      } else if (e.key === '[' || e.key === ']') {
        const step = (e.shiftKey ? 1 : e.altKey ? 50 : 5) / 1000;
        S.timeline.nudgeSelected(e.key === '[' ? -step : step);
      } else if (e.key === 'Home') {
        S.seek(0);
      }
    });

    S.refresh.structure();
    loadSavedCalibration();
    requestAnimationFrame(loop);
    await hideSplash();
    offerFirstRunCalibration();
  }

  window.addEventListener('DOMContentLoaded', () =>
    init().catch((e) => {
      console.error(e);
      hideSplash();
      S.toast('Something went wrong while starting: ' + e.message);
    })
  );
})();
