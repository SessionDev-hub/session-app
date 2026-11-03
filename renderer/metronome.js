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

  // iterative radix-2 FFT (in-place)
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
          const bi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr;
        }
      }
    }
  }

  /* Auto-BPM: spectral-flux onset detection (robust on real music), autocorrelation of the
   * onset envelope, then a harmonic-comb score with a preference around 120 BPM so it picks the
   * true tempo instead of a half/double octave. Returns BPM to one decimal. */
  S.detectBpm = (buf) => {
    if (!buf || !buf.length) return null;
    const sr = buf.sampleRate, ch = buf.numberOfChannels;
    const N = 1024, H = 512;
    const total = Math.min(buf.length, Math.floor(sr * 45)); // up to 45 s
    const nF = Math.floor((total - N) / H);
    if (nF < 24) return null;
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const re = new Float64Array(N), im = new Float64Array(N);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    const prev = new Float64Array(N / 2);
    const flux = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      const start = f * H;
      for (let i = 0; i < N; i++) { let s = 0; for (let c = 0; c < ch; c++) s += chans[c][start + i]; re[i] = (s / ch) * win[i]; im[i] = 0; }
      fft(re, im);
      let fl = 0;
      for (let k = 0; k < N / 2; k++) { const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]); const d = mag - prev[k]; if (d > 0) fl += d; prev[k] = mag; }
      flux[f] = fl;
    }
    // detrend: subtract a local moving average so sustained loud sections don't dominate
    const fps = sr / H, wlen = Math.max(4, Math.round(fps * 0.4));
    const env = new Float32Array(nF);
    let acc = 0;
    for (let i = 0; i < nF; i++) {
      acc += flux[i]; if (i >= wlen) acc -= flux[i - wlen];
      const avg = acc / Math.min(i + 1, wlen);
      const v = flux[i] - avg; env[i] = v > 0 ? v : 0;
    }
    const minBpm = 50, maxBpm = 210;
    const minLag = Math.max(2, Math.floor((fps * 60) / maxBpm));
    const maxLag = Math.min(nF - 1, Math.ceil((fps * 60) / minBpm));
    const ac = new Float64Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) { let s = 0; for (let i = lag; i < nF; i++) s += env[i] * env[i - lag]; ac[lag] = s; }
    // 1) find the fundamental periodicity (autocorrelation tends to favour slower sub-tempos)
    let fLag = minLag, fBest = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = ac[lag];
      if (lag * 2 <= maxLag) score += 0.5 * ac[lag * 2];
      if ((lag >> 1) >= minLag) score += 0.5 * ac[lag >> 1];
      if (score > fBest) { fBest = score; fLag = lag; }
    }
    if (fBest <= 0) return null;
    const f0 = (60 * fps) / fLag;

    // 2) resolve the octave with a phase-aligned comb filter: for each octave candidate, how
    //    strongly do onsets sit on that tempo's beat grid? Normalising by sqrt(beats) means a
    //    faster tempo only wins when the extra (off-)beats actually carry energy.
    function comb(bpm) {
      const P = (fps * 60) / bpm; if (P < 2) return -1;
      let best = -1;
      for (let ph = 0; ph < P; ph += Math.max(1, P / 10)) {
        let s = 0, c = 0;
        for (let t = ph; t < nF; t += P) { const i = Math.round(t); if (i < nF) { s += env[i]; c++; } }
        if (c > 2) { const sc = s / Math.pow(c, 0.75); if (sc > best) best = sc; }
      }
      return best;
    }
    const cands = new Set();
    [0.25, 0.5, 1, 1.5, 2, 3, 4].forEach((m) => { let t = f0 * m; while (t < 70) t *= 2; while (t > 180) t /= 2; if (t >= 70 && t <= 180) cands.add(Math.round(t * 10) / 10); });
    let bpm = 120, bb = -1;
    cands.forEach((t) => {
      const pref = Math.exp(-0.5 * Math.pow(Math.log2(t / 128) / 0.7, 2)); // gentle nudge toward musical tempos
      const sc = comb(t) * pref;
      if (sc > bb) { bb = sc; bpm = t; }
    });
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
