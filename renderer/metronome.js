/* Metronome — a click on every beat while playing or recording, locked to the transport.
 * Uses a short lookahead scheduler so clicks land sample-accurately. The click goes straight
 * to the speakers (never into a track), so it is heard but never recorded. */
(function () {
  const S = window.Studio;
  const M = (S.metronome = {});
  let on = false, timer = 0, nextBeat = 0;
  const LOOKAHEAD = 0.12; // schedule this far ahead (s)

  function click(at, accent) {
    const ctx = S.ctx; if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1760 : 1040; // bar-start click is higher
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g);
    g.connect(ctx.destination); // straight out — not through any track, so it isn't recorded
    o.start(at);
    o.stop(at + 0.06);
  }

  function tick() {
    const e = S.engine;
    if (!on || !e || !e.playing) { stop(); return; }
    const ctx = S.ctx;
    const bpm = S.clamp(S.project.bpm || 120, 20, 400);
    const beatDur = 60 / bpm;
    const bpb = Math.max(1, S.project.beatsPerBar || 4);
    const horizon = ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (guard++ < 2000) {
      const songPos = nextBeat * beatDur;
      const at = e.startTime + (songPos - e.startPos); // map song time -> context time
      if (at > horizon) break;
      if (at >= ctx.currentTime - 0.005 && songPos >= e.startPos - 1e-6) click(at, nextBeat % bpb === 0);
      nextBeat++;
    }
  }

  function start() {
    if (timer) return;
    const bpm = S.clamp(S.project.bpm || 120, 20, 400);
    const beatDur = 60 / bpm;
    nextBeat = Math.max(0, Math.ceil((S.engine.startPos - 1e-6) / beatDur));
    timer = setInterval(tick, 25);
    tick();
  }
  function stop() { if (timer) { clearInterval(timer); timer = 0; } }

  function updateBtn() {
    const b = document.getElementById('btn-metro');
    if (b) b.classList.toggle('active', on);
  }

  M.isOn = () => on;
  M.toggle = () => {
    on = !on;
    try { localStorage.setItem('ps.metro', on ? '1' : '0'); } catch (e) {}
    updateBtn();
    if (on && S.engine && S.engine.playing) start(); else if (!on) stop();
    return on;
  };

  /* Auto-BPM: build an onset-novelty curve from the audio, autocorrelate it, and take the
   * strongest periodicity as the tempo. Folds the result into a musical 70–180 range. */
  S.detectBpm = (buf) => {
    if (!buf || !buf.length) return null;
    const sr = buf.sampleRate;
    const a = buf.getChannelData(0);
    const b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const hop = Math.max(1, Math.floor(sr / 200)); // ~5 ms frames
    const maxFrames = 200 * 40; // analyze up to ~40 s — plenty, keeps it fast
    const nF = Math.min(Math.floor(a.length / hop), maxFrames);
    if (nF < 20) return null;
    const env = new Float32Array(nF);
    for (let i = 0; i < nF; i++) {
      let s = 0; const start = i * hop, end = start + hop;
      for (let k = start; k < end; k++) { const v = b ? (a[k] + b[k]) * 0.5 : a[k]; s += v * v; }
      env[i] = Math.sqrt(s / hop);
    }
    const nov = new Float32Array(nF);
    for (let i = 1; i < nF; i++) { const d = env[i] - env[i - 1]; nov[i] = d > 0 ? d : 0; }
    const fps = sr / hop;
    const minBpm = 60, maxBpm = 200;
    const minLag = Math.max(1, Math.floor((fps * 60) / maxBpm));
    const maxLag = Math.min(nF - 1, Math.ceil((fps * 60) / minBpm));
    let bestLag = minLag, best = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = lag; i < nF; i++) sum += nov[i] * nov[i - lag];
      if (sum > best) { best = sum; bestLag = lag; }
    }
    if (best <= 0) return null;
    let bpm = (60 * fps) / bestLag;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return Math.round(bpm * 10) / 10;
  };

  M.init = () => {
    try { on = localStorage.getItem('ps.metro') === '1'; } catch (e) {}
    const b = document.getElementById('btn-metro');
    if (b) b.onclick = () => M.toggle();
    updateBtn();
    // (re)start the scheduler whenever the transport starts (play OR record both emit this)
    S.on('transport', () => { if (on && S.engine.playing) { stop(); start(); } });
  };
})();
