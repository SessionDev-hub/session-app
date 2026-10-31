/* Tuner — a live pitch meter (like FL's Tuner). Listens to your mic and shows the note you're
 * singing/playing and how many cents sharp or flat. Pure pitch detection; it changes nothing. */
(function () {
  const S = window.Studio;
  const T = (S.tuner = {});
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Normalized autocorrelation pitch detection on a time-domain buffer.
  function detectPitch(buf, sr) {
    const n = buf.length;
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.008) return -1; // too quiet
    let best = -1, bestVal = 0;
    const MINT = Math.floor(sr / 1000); // up to 1000 Hz
    const MAXT = Math.floor(sr / 60);   // down to 60 Hz
    // find first trough so we don't lock onto lag 0
    let c = new Float32Array(MAXT + 2);
    for (let lag = MINT; lag <= MAXT; lag++) {
      let s = 0;
      for (let i = 0; i < n - lag; i++) s += buf[i] * buf[i + lag];
      c[lag] = s;
      if (s > bestVal) { bestVal = s; best = lag; }
    }
    if (best < 0) return -1;
    // parabolic interpolation around the peak for sub-sample accuracy
    const x1 = c[best - 1] || c[best], x2 = c[best], x3 = c[best + 1] || c[best];
    const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
    let T0 = best;
    if (a) T0 = best - b / (2 * a);
    const f = sr / T0;
    return f > 55 && f < 1100 ? f : -1;
  }

  T.init = () => {
    const btn = document.getElementById('btn-tuner');
    if (btn) btn.onclick = () => T.open();
  };

  T.open = async () => {
    const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
    const dlg = el('dialog', 'modal tuner-dlg');
    dlg.innerHTML =
      '<div class="set-head"><span class="set-ic">' + S.ui.icon('note', 18) + '</span><h3>Tuner</h3><div class="pw-sp"></div><button class="pw-ib tn-x" title="Close">' + S.ui.icon('x', 14) + '</button></div>' +
      '<div class="tn-body">' +
      '  <div class="tn-note"><span class="tn-letter">–</span><span class="tn-oct"></span></div>' +
      '  <div class="tn-meter"><div class="tn-ticks"></div><div class="tn-needle"></div><div class="tn-center"></div></div>' +
      '  <div class="tn-read"><span class="tn-cents">listening…</span><span class="tn-hz"></span></div>' +
      '  <p class="hint tn-hint">Sing or play one note. Green and centered means you’re in tune. Use headphones so the mic only hears you.</p>' +
      '</div>';
    const letter = dlg.querySelector('.tn-letter');
    const oct = dlg.querySelector('.tn-oct');
    const needle = dlg.querySelector('.tn-needle');
    const centsEl = dlg.querySelector('.tn-cents');
    const hzEl = dlg.querySelector('.tn-hz');
    dlg.querySelector('.tn-x').onclick = () => dlg.close();

    let raf = 0, analyser = null, data = null, stopped = false;
    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (analyser) { try { analyser.disconnect(); } catch (e) {} analyser = null; }
    };
    dlg.addEventListener('close', () => { cleanup(); dlg.remove(); });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());

    document.body.appendChild(dlg);
    dlg.showModal();

    if (!(await S.ensureInput())) { centsEl.textContent = 'No microphone available'; return; }
    const ctx = S.engine.ctx;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    data = new Float32Array(analyser.fftSize);
    try { S.engine.mic.input.connect(analyser); } catch (e) {}

    let smoothCents = 0, held = 0;
    const tick = () => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(data);
      const f = detectPitch(data, ctx.sampleRate);
      if (f > 0) {
        const midi = 69 + 12 * Math.log2(f / 440);
        const near = Math.round(midi);
        const cents = (midi - near) * 100;
        smoothCents = smoothCents * 0.6 + cents * 0.4; // steady needle
        const name = NOTES[((near % 12) + 12) % 12];
        const octave = Math.floor(near / 12) - 1;
        letter.textContent = name;
        oct.textContent = octave;
        const off = Math.max(-50, Math.min(50, smoothCents));
        needle.style.left = (50 + off) + '%';
        const inTune = Math.abs(off) <= 5;
        needle.style.background = inTune ? '#34d399' : (off < 0 ? '#60a5fa' : '#fbbf24');
        letter.style.color = inTune ? '#34d399' : '#eceef3';
        centsEl.textContent = (off >= 0 ? '+' : '') + Math.round(off) + ' cents';
        hzEl.textContent = f.toFixed(1) + ' Hz';
        held = 8;
      } else if (held > 0) {
        held--;
      } else {
        letter.textContent = '–'; oct.textContent = ''; letter.style.color = '#eceef3';
        needle.style.left = '50%'; needle.style.background = '#55596a';
        centsEl.textContent = 'listening…'; hzEl.textContent = '';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
  };
})();
