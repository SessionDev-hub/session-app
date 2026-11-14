/* Beat Lab instrument plugins — the FL / BandLab style instruments, played from the piano roll:
 *   Session Synth  (3xOsc / Harmless style subtractive synth: 2 oscillators + sub + noise, unison, filter, envelopes, LFO)
 *   Session FM     (Sytrus / DX style FM: e-pianos, bells, FM bass, glassy keys)
 *   Session Acid   (Transistor Bass / 303 style: resonant squelch with accent)
 *   Session Pluck  (physical-model string: guitars, harp, koto, pizzicato, bass guitar)
 *   Session Organ  (9 drawbars, percussion, key click, vibrato)
 * plus the upgraded custom-sample player: a Sampler (envelope, start/end, loop, reverse) and a Slicer
 * (chops a loop at its hits, one slice per key, like Slicex / Fruity Slicer).
 *
 * A "keys" channel with channel.inst = one of the ids below plays that instrument with channel.ip (its
 * settings). Everything is plain Web Audio, so it plays the same live, in Beat Lab exports and on Android. */
(function () {
  const S = window.Studio;
  const BI = S.beatInstruments;
  if (!BI) return;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const db = (x) => Math.pow(10, x / 20);

  /* ---------- shared building blocks ---------- */
  const noiseBufs = new WeakMap();
  function noise(ctx) {
    let b = noiseBufs.get(ctx);
    if (!b) { b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseBufs.set(ctx, b); }
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; return s;
  }
  /** ADSR on an AudioParam. Times in seconds, sustain 0..1. Returns when the sound has fully ended. */
  function adsr(param, t, dur, a, d, s, r, peak, floor) {
    floor = floor == null ? 0.0001 : floor;
    const relAt = t + Math.max(dur, 0.005), susV = Math.max(floor, peak * s), tau = Math.max(0.001, d / 3);
    param.cancelScheduledValues(t);
    param.setValueAtTime(floor, t);
    let at;
    if (relAt <= t + a) { // note ends while still rising: stop the rise where it is
      at = floor + (peak - floor) * ((relAt - t) / Math.max(1e-4, a));
      param.linearRampToValueAtTime(at, relAt);
    } else {
      param.linearRampToValueAtTime(peak, t + a);
      param.setTargetAtTime(susV, t + a, tau);
      at = susV + (peak - susV) * Math.exp(-(relAt - t - a) / tau);
      param.setValueAtTime(at, relAt);
    }
    param.setTargetAtTime(floor, relAt, Math.max(0.001, r / 4));
    return relAt + r * 1.2 + 0.02;
  }
  const WAVES = { Saw: 'sawtooth', Square: 'square', Triangle: 'triangle', Sine: 'sine' };

  /* ---------- the instruments ---------- */
  const SYN = {};

  /* Session Synth */
  SYN.synth = {
    name: 'Session Synth', desc: 'Two oscillators + sub + noise, unison, resonant filter with its own envelope and LFO — leads, supersaws, pads, plucks, basses',
    params: [
      { id: 'w1', name: 'Osc 1', type: 'select', options: ['Saw', 'Square', 'Triangle', 'Sine'], default: 'Saw', g: 'Oscillators' },
      { id: 'w2', name: 'Osc 2', type: 'select', options: ['Saw', 'Square', 'Triangle', 'Sine'], default: 'Saw', g: 'Oscillators' },
      { id: 'oct2', name: 'Osc 2 octave', min: -2, max: 2, step: 1, default: 0, g: 'Oscillators' },
      { id: 'det2', name: 'Osc 2 detune', unit: 'ct', min: -50, max: 50, step: 1, default: 7, g: 'Oscillators' },
      { id: 'mix2', name: 'Osc 2 level', unit: '%', min: 0, max: 100, step: 1, default: 60, g: 'Oscillators' },
      { id: 'sub', name: 'Sub', unit: '%', min: 0, max: 100, step: 1, default: 0, g: 'Oscillators' },
      { id: 'noise', name: 'Noise', unit: '%', min: 0, max: 100, step: 1, default: 0, g: 'Oscillators' },
      { id: 'uni', name: 'Unison', min: 1, max: 7, step: 1, default: 1, g: 'Unison' },
      { id: 'spread', name: 'Spread', unit: 'ct', min: 0, max: 60, step: 1, default: 18, g: 'Unison' },
      { id: 'cut', name: 'Cutoff', unit: 'Hz', min: 60, max: 18000, step: 1, default: 4000, scale: 'log', g: 'Filter' },
      { id: 'res', name: 'Resonance', min: 0.5, max: 20, step: 0.1, default: 1.5, g: 'Filter' },
      { id: 'fenv', name: 'Env amount', unit: 'oct', min: 0, max: 6, step: 0.1, default: 2, g: 'Filter' },
      { id: 'fa', name: 'Filter attack', unit: 'ms', min: 0, max: 2000, step: 1, default: 2, g: 'Filter' },
      { id: 'fd', name: 'Filter decay', unit: 'ms', min: 10, max: 4000, step: 1, default: 350, g: 'Filter' },
      { id: 'fs', name: 'Filter sustain', unit: '%', min: 0, max: 100, step: 1, default: 20, g: 'Filter' },
      { id: 'a', name: 'Attack', unit: 'ms', min: 0, max: 4000, step: 1, default: 4, g: 'Amp' },
      { id: 'd', name: 'Decay', unit: 'ms', min: 10, max: 4000, step: 1, default: 300, g: 'Amp' },
      { id: 's', name: 'Sustain', unit: '%', min: 0, max: 100, step: 1, default: 75, g: 'Amp' },
      { id: 'r', name: 'Release', unit: 'ms', min: 5, max: 6000, step: 1, default: 220, g: 'Amp' },
      { id: 'lrate', name: 'LFO rate', unit: 'Hz', min: 0.1, max: 12, step: 0.01, default: 5, g: 'LFO' },
      { id: 'lpitch', name: 'Vibrato', unit: 'ct', min: 0, max: 100, step: 1, default: 0, g: 'LFO' },
      { id: 'lcut', name: 'Filter wobble', unit: 'oct', min: 0, max: 4, step: 0.1, default: 0, g: 'LFO' },
      { id: 'vol', name: 'Volume', unit: 'dB', min: -24, max: 6, step: 0.5, default: -6, g: 'Amp' },
    ],
    presets: [
      { name: 'Rage lead', p: { w1: 'Saw', w2: 'Saw', det2: 9, mix2: 80, uni: 7, spread: 26, cut: 7000, res: 1.2, fenv: 1.5, fd: 400, fs: 60, a: 3, d: 300, s: 80, r: 250, vol: -10 } },
      { name: 'Supersaw', p: { w1: 'Saw', w2: 'Saw', det2: -12, mix2: 70, uni: 7, spread: 40, cut: 9000, res: 0.8, fenv: 0.5, a: 10, s: 90, r: 500, vol: -12 } },
      { name: 'Plucky', p: { w1: 'Saw', w2: 'Square', oct2: 1, det2: 0, mix2: 30, uni: 2, spread: 10, cut: 500, res: 6, fenv: 4.5, fd: 180, fs: 0, a: 1, d: 260, s: 0, r: 200, vol: -6 } },
      { name: 'Warm pad', p: { w1: 'Saw', w2: 'Triangle', det2: 6, mix2: 60, uni: 5, spread: 22, cut: 1600, res: 1, fenv: 1, fa: 900, fd: 2000, fs: 60, a: 700, d: 1000, s: 85, r: 1800, lpitch: 6, lrate: 4.5, vol: -12 } },
      { name: 'Reese bass', p: { w1: 'Saw', w2: 'Saw', oct2: 0, det2: 22, mix2: 100, sub: 60, uni: 2, spread: 14, cut: 700, res: 2, fenv: 1, fs: 60, a: 2, s: 100, r: 120, vol: -8 } },
      { name: 'BooBass', p: { w1: 'Sine', w2: 'Triangle', oct2: 0, det2: 0, mix2: 40, sub: 40, cut: 1200, res: 0.7, fenv: 1.5, fd: 200, fs: 30, a: 2, d: 500, s: 60, r: 120, vol: -4 } },
      { name: 'Brass stab', p: { w1: 'Saw', w2: 'Saw', det2: 8, mix2: 70, uni: 3, spread: 12, cut: 900, res: 1.5, fenv: 2.5, fa: 60, fd: 300, fs: 50, a: 40, d: 250, s: 70, r: 180, vol: -9 } },
      { name: 'Chiptune', p: { w1: 'Square', w2: 'Square', oct2: 1, det2: 0, mix2: 25, cut: 18000, res: 0.5, fenv: 0, a: 1, d: 120, s: 70, r: 40, lpitch: 15, lrate: 7, vol: -12 } },
      { name: 'Wobble bass', p: { w1: 'Saw', w2: 'Square', oct2: -1, mix2: 70, sub: 50, cut: 300, res: 9, fenv: 0.5, s: 100, r: 100, lrate: 3, lcut: 3.5, vol: -8 } },
      { name: 'Soft keys', p: { w1: 'Triangle', w2: 'Sine', oct2: 1, mix2: 35, cut: 2500, res: 0.7, fenv: 1.5, fd: 600, fs: 10, a: 3, d: 900, s: 30, r: 500, vol: -6 } },
    ],
    voice(ctx, dest, t, note, vel, dur, P) {
      const f = hz(note), out = ctx.createGain(), filt = ctx.createBiquadFilter(), amp = ctx.createGain();
      filt.type = 'lowpass'; filt.Q.value = P.res;
      const mixer = ctx.createGain(); mixer.connect(filt); filt.connect(amp); amp.connect(out); out.connect(dest);
      out.gain.value = db(P.vol) * (0.35 + 0.65 * vel);
      const end = adsr(amp.gain, t, dur, P.a / 1000, P.d / 1000, P.s / 100, P.r / 1000, 1);
      // filter envelope (in cents on detune so it follows the cutoff knob)
      filt.frequency.value = P.cut;
      const fe = adsr(filt.detune, t, dur, P.fa / 1000, P.fd / 1000, P.fs / 100, P.r / 1000, P.fenv * 1200 * (0.6 + 0.4 * vel), 0);
      const lfo = ctx.createOscillator(); lfo.frequency.value = P.lrate; lfo.start(t); lfo.stop(end);
      if (P.lcut > 0) { const lg = ctx.createGain(); lg.gain.value = P.lcut * 1200; lfo.connect(lg); lg.connect(filt.detune); }
      let vib = null;
      if (P.lpitch > 0) { vib = ctx.createGain(); vib.gain.value = P.lpitch; lfo.connect(vib); }
      const uni = Math.round(P.uni), oscs = [];
      const add = (wave, freq, cents, gain) => {
        const o = ctx.createOscillator(); o.type = WAVES[wave] || 'sawtooth'; o.frequency.value = freq; o.detune.value = cents;
        if (vib) vib.connect(o.detune);
        const g = ctx.createGain(); g.gain.value = gain; o.connect(g); g.connect(mixer); o.start(t); o.stop(end); oscs.push(o);
      };
      const norm = 1 / Math.sqrt(uni);
      for (let u = 0; u < uni; u++) {
        const sp = uni === 1 ? 0 : (u / (uni - 1) * 2 - 1) * P.spread;
        add(P.w1, f, sp, 0.5 * norm);
        if (P.mix2 > 0) add(P.w2, f * Math.pow(2, P.oct2), P.det2 + sp * 0.8, 0.5 * norm * P.mix2 / 100);
      }
      if (P.sub > 0) add('Sine', f / 2, 0, 0.6 * P.sub / 100);
      if (P.noise > 0) { const n = noise(ctx), g = ctx.createGain(); g.gain.value = 0.25 * P.noise / 100; n.connect(g); g.connect(mixer); n.start(t); n.stop(end); }
      void fe;
      return end;
    },
  };

  /* Session FM */
  SYN.fm = {
    name: 'Session FM', desc: 'FM synthesis like Sytrus / DX7 — electric pianos, bells, glassy keys, FM basses and brass',
    params: [
      { id: 'algo', name: 'Algorithm', type: 'select', options: ['2 operators', '3-op stack', '2 carriers + mod'], default: '2 operators', g: 'Operators' },
      { id: 'r1', name: 'Mod ratio', min: 0.5, max: 14, step: 0.01, default: 1, g: 'Operators' },
      { id: 'i1', name: 'Mod amount', min: 0, max: 15, step: 0.01, default: 2.5, g: 'Operators' },
      { id: 'md', name: 'Mod decay', unit: 'ms', min: 10, max: 5000, step: 1, default: 600, g: 'Operators' },
      { id: 'ms', name: 'Mod sustain', unit: '%', min: 0, max: 100, step: 1, default: 15, g: 'Operators' },
      { id: 'r2', name: 'Op 3 ratio', min: 0.5, max: 14, step: 0.01, default: 3, g: 'Operators' },
      { id: 'i2', name: 'Op 3 amount', min: 0, max: 15, step: 0.01, default: 0, g: 'Operators' },
      { id: 'vs', name: 'Velocity → brightness', unit: '%', min: 0, max: 100, step: 1, default: 60, g: 'Operators' },
      { id: 'a', name: 'Attack', unit: 'ms', min: 0, max: 3000, step: 1, default: 2, g: 'Amp' },
      { id: 'd', name: 'Decay', unit: 'ms', min: 10, max: 6000, step: 1, default: 1600, g: 'Amp' },
      { id: 's', name: 'Sustain', unit: '%', min: 0, max: 100, step: 1, default: 20, g: 'Amp' },
      { id: 'r', name: 'Release', unit: 'ms', min: 5, max: 6000, step: 1, default: 600, g: 'Amp' },
      { id: 'vol', name: 'Volume', unit: 'dB', min: -24, max: 6, step: 0.5, default: -6, g: 'Amp' },
    ],
    presets: [
      { name: 'E-Piano', p: { algo: '2 operators', r1: 1, i1: 2.2, md: 900, ms: 10, vs: 70, a: 2, d: 2200, s: 15, r: 500 } },
      { name: 'Tine Rhodes', p: { algo: '2 carriers + mod', r1: 1, i1: 1.6, r2: 14, i2: 1.2, md: 700, ms: 5, vs: 80, a: 1, d: 2500, s: 10, r: 600 } },
      { name: 'DX Bells', p: { algo: '2 operators', r1: 3.5, i1: 4, md: 1800, ms: 0, vs: 40, a: 1, d: 3500, s: 0, r: 1500, vol: -8 } },
      { name: 'Glass keys', p: { algo: '3-op stack', r1: 2, i1: 2, r2: 7, i2: 1.5, md: 500, ms: 20, a: 2, d: 1500, s: 30, r: 800, vol: -8 } },
      { name: 'FM bass', p: { algo: '2 operators', r1: 1, i1: 5, md: 180, ms: 20, vs: 50, a: 1, d: 400, s: 70, r: 80, vol: -4 } },
      { name: 'Marimba', p: { algo: '2 operators', r1: 4, i1: 1.5, md: 80, ms: 0, a: 1, d: 450, s: 0, r: 200 } },
      { name: 'FM brass', p: { algo: '2 operators', r1: 1, i1: 3.5, md: 300, ms: 70, a: 50, d: 300, s: 80, r: 200, vol: -9 } },
      { name: 'Clav', p: { algo: '3-op stack', r1: 3, i1: 3, r2: 1, i2: 2, md: 220, ms: 15, a: 1, d: 600, s: 25, r: 120, vol: -8 } },
    ],
    voice(ctx, dest, t, note, vel, dur, P) {
      const f = hz(note), out = ctx.createGain(), amp = ctx.createGain();
      out.gain.value = db(P.vol) * (0.35 + 0.65 * vel); amp.connect(out); out.connect(dest);
      const end = adsr(amp.gain, t, dur, P.a / 1000, P.d / 1000, P.s / 100, P.r / 1000, 0.5);
      const bright = 1 - P.vs / 100 + (P.vs / 100) * vel;
      const op = (ratio) => { const o = ctx.createOscillator(); o.frequency.value = f * ratio; o.start(t); o.stop(end); return o; };
      const modEnv = (o, idx, depthRatio) => { const g = ctx.createGain(); const peak = f * depthRatio * idx * bright; adsr(g.gain, t, dur, 0.001, P.md / 1000, P.ms / 100, P.r / 1000, Math.max(0.01, peak), 0); o.connect(g); return g; };
      const car = op(1); car.connect(amp);
      const m1 = op(P.r1), g1 = modEnv(m1, P.i1, P.r1);
      if (P.algo === '3-op stack') { const m2 = op(P.r2), g2 = modEnv(m2, P.i2, P.r2); g2.connect(m1.frequency); g1.connect(car.frequency); }
      else if (P.algo === '2 carriers + mod') { g1.connect(car.frequency); const c2 = op(P.r2), g2 = ctx.createGain(); g2.gain.value = P.i2 * 0.12; c2.connect(g2); g2.connect(amp); const gm = ctx.createGain(); gm.gain.value = 0.6; g1.connect(gm); gm.connect(c2.frequency); }
      else g1.connect(car.frequency);
      return end;
    },
  };

  /* Session Acid */
  SYN.acid = {
    name: 'Session Acid', desc: 'TB-303 / Transistor Bass style — squelchy resonant bass lines; loud notes (high velocity) get the accent',
    params: [
      { id: 'wave', name: 'Wave', type: 'select', options: ['Saw', 'Square'], default: 'Saw', g: 'Acid' },
      { id: 'cut', name: 'Cutoff', unit: 'Hz', min: 80, max: 6000, step: 1, default: 500, scale: 'log', g: 'Acid' },
      { id: 'res', name: 'Resonance', min: 1, max: 28, step: 0.1, default: 14, g: 'Acid' },
      { id: 'env', name: 'Env mod', unit: 'oct', min: 0, max: 5, step: 0.1, default: 3, g: 'Acid' },
      { id: 'dec', name: 'Decay', unit: 'ms', min: 40, max: 2000, step: 1, default: 300, g: 'Acid' },
      { id: 'acc', name: 'Accent', unit: '%', min: 0, max: 100, step: 1, default: 60, g: 'Acid' },
      { id: 'drive', name: 'Drive', unit: '%', min: 0, max: 100, step: 1, default: 30, g: 'Acid' },
      { id: 'vol', name: 'Volume', unit: 'dB', min: -24, max: 6, step: 0.5, default: -6, g: 'Acid' },
    ],
    presets: [
      { name: 'Classic squelch', p: { wave: 'Saw', cut: 450, res: 16, env: 3.2, dec: 280, acc: 70, drive: 30 } },
      { name: 'Deep rubber', p: { wave: 'Square', cut: 260, res: 10, env: 2, dec: 400, acc: 40, drive: 15 } },
      { name: 'Screamer', p: { wave: 'Saw', cut: 800, res: 24, env: 4, dec: 200, acc: 90, drive: 70, vol: -9 } },
      { name: 'Soft acid', p: { wave: 'Saw', cut: 350, res: 8, env: 2.2, dec: 500, acc: 30, drive: 0 } },
    ],
    voice(ctx, dest, t, note, vel, dur, P) {
      const f = hz(note), accent = vel > 0.85 ? P.acc / 100 : 0;
      const o = ctx.createOscillator(); o.type = P.wave === 'Square' ? 'square' : 'sawtooth'; o.frequency.value = f;
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(); f1.type = f2.type = 'lowpass';
      f1.Q.value = P.res; f2.Q.value = 0.707; f1.frequency.value = f2.frequency.value = P.cut;
      const envC = P.env * 1200 * (1 + accent * 0.6), dec = P.dec / 1000 * (1 - accent * 0.4);
      for (const fl of [f1, f2]) { fl.detune.setValueAtTime(envC, t); fl.detune.setTargetAtTime(0, t + 0.003, dec / 3); }
      const sat = ctx.createWaveShaper(), dr = 1 + P.drive / 100 * 8, cv = new Float32Array(1025);
      for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * dr) / Math.tanh(dr); }
      sat.curve = cv;
      const amp = ctx.createGain(), out = ctx.createGain(); out.gain.value = db(P.vol) * (0.55 + 0.45 * vel) * (1 + accent * 0.5) / (1 + P.res * 0.04);
      const len = Math.max(0.06, dur), endT = t + len + 0.05;
      amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(1, t + 0.003);
      amp.gain.setValueAtTime(1, t + len); amp.gain.setTargetAtTime(0.0001, t + len, 0.012);
      o.connect(f1); f1.connect(f2); f2.connect(sat); sat.connect(amp); amp.connect(out); out.connect(dest);
      o.start(t); o.stop(endT + 0.05);
      return endT + 0.05;
    },
  };

  /* Session Pluck — Karplus-Strong string, rendered per note and cached */
  const ksCache = new Map();
  function ksBuffer(ctx, note, P, len) {
    const key = [ctx.sampleRate, note, P.bright, P.damp, P.pick, P.body, Math.round(len * 10)].join('|');
    let b = ksCache.get(key);
    if (b) return b;
    const sr = ctx.sampleRate, f = hz(note), N = Math.floor(len * sr);
    const period = sr / f, D = Math.floor(period - 0.5), frac = period - 0.5 - D;
    const apC = (1 - frac) / (1 + frac);                      // allpass fine-tuning
    const line = new Float32Array(D + 2);
    // excitation: noise, low-passed by "brightness", with the pick position comb
    let lp = 0; const bA = Math.exp(-2 * Math.PI * (300 + P.bright / 100 * 9000) / sr);
    for (let i = 0; i < line.length; i++) { lp = (Math.random() * 2 - 1) * (1 - bA) + lp * bA; line[i] = lp; }
    const pk = Math.max(1, Math.floor(line.length * clamp(P.pick / 100, 0.02, 0.5)));
    for (let i = line.length - 1; i >= pk; i--) line[i] -= line[i - pk];
    // loss per period from the "sustain" (damp) knob: seconds for -60 dB
    const t60 = 0.15 + Math.pow(P.damp / 100, 1.6) * 9;
    const g = Math.pow(0.001, 1 / (t60 * f));
    const out = new Float32Array(N);
    let idx = 0, prev = 0, apx = 0, apy = 0;
    for (let n = 0; n < N; n++) {
      const cur = line[idx];
      out[n] = cur;
      const avg = 0.5 * (cur + prev) * g;                     // averaging low-pass = string loss
      prev = cur;
      const y = apC * avg + apx - apC * apy; apx = avg; apy = y; // fractional delay
      line[idx] = y;
      idx = idx + 1 >= D ? 0 : idx + 1;
    }
    // body: a gentle resonance so guitars sound woody, not like plain strings
    let peak = 0; for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(out[n]));
    const k = 0.6 / (peak || 1); for (let n = 0; n < N; n++) out[n] *= k;
    b = ctx.createBuffer(1, N, sr); b.getChannelData(0).set(out);
    if (ksCache.size > 120) ksCache.delete(ksCache.keys().next().value);
    ksCache.set(key, b);
    return b;
  }
  SYN.pluck = {
    name: 'Session Pluck', desc: 'Physical-model strings — nylon & steel guitar, harp, koto, pizzicato and bass guitar that ring like the real thing',
    params: [
      { id: 'bright', name: 'Brightness', unit: '%', min: 0, max: 100, step: 1, default: 55, g: 'String' },
      { id: 'damp', name: 'Sustain', unit: '%', min: 0, max: 100, step: 1, default: 55, g: 'String' },
      { id: 'pick', name: 'Pick position', unit: '%', min: 2, max: 50, step: 1, default: 18, g: 'String' },
      { id: 'body', name: 'Body', unit: '%', min: 0, max: 100, step: 1, default: 50, g: 'Tone' },
      { id: 'tone', name: 'Tone', unit: 'Hz', min: 800, max: 16000, step: 1, default: 7000, scale: 'log', g: 'Tone' },
      { id: 'r', name: 'Release', unit: 'ms', min: 20, max: 3000, step: 1, default: 250, g: 'Tone' },
      { id: 'vol', name: 'Volume', unit: 'dB', min: -24, max: 6, step: 0.5, default: -3, g: 'Tone' },
    ],
    presets: [
      { name: 'Nylon guitar', p: { bright: 40, damp: 55, pick: 20, body: 70, tone: 5000, r: 250 } },
      { name: 'Steel guitar', p: { bright: 75, damp: 65, pick: 12, body: 45, tone: 11000, r: 300 } },
      { name: 'Harp', p: { bright: 50, damp: 80, pick: 35, body: 30, tone: 8000, r: 900 } },
      { name: 'Koto', p: { bright: 85, damp: 50, pick: 8, body: 25, tone: 12000, r: 400 } },
      { name: 'Pizzicato', p: { bright: 35, damp: 20, pick: 30, body: 60, tone: 4000, r: 120 } },
      { name: 'Bass guitar', p: { bright: 30, damp: 60, pick: 25, body: 40, tone: 2500, r: 150, vol: 0 } },
      { name: 'Music box', p: { bright: 95, damp: 70, pick: 5, body: 0, tone: 14000, r: 800, vol: -6 } },
    ],
    voice(ctx, dest, t, note, vel, dur, P) {
      const ring = 0.15 + Math.pow(P.damp / 100, 1.6) * 9;
      const len = Math.min(6, Math.max(dur + P.r / 1000, Math.min(ring, 4)) + 0.05);
      const s = ctx.createBufferSource(); s.buffer = ksBuffer(ctx, note, P, len);
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 180; body.Q.value = 1.2; body.gain.value = P.body / 100 * 7;
      const body2 = ctx.createBiquadFilter(); body2.type = 'peaking'; body2.frequency.value = 2400; body2.Q.value = 1.5; body2.gain.value = P.body / 100 * 3;
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = P.tone * (0.6 + 0.4 * vel);
      const amp = ctx.createGain(); amp.gain.value = db(P.vol) * (0.3 + 0.7 * vel);
      const relAt = t + Math.max(0.03, dur);
      amp.gain.setValueAtTime(amp.gain.value, relAt); amp.gain.setTargetAtTime(0.0001, relAt, P.r / 4000);
      s.connect(body); body.connect(body2); body2.connect(tone); tone.connect(amp); amp.connect(dest);
      const end = Math.min(t + len, relAt + P.r / 1000 * 1.3 + 0.02);
      s.start(t); s.stop(end);
      return end;
    },
  };

  /* Session Organ — 9 drawbars */
  const BARS = [['b16', "16'", 0.5], ['b513', "5⅓'", 1.5], ['b8', "8'", 1], ['b4', "4'", 2], ['b223', "2⅔'", 3], ['b2', "2'", 4], ['b135', "1⅗'", 5], ['b113', "1⅓'", 6], ['b1', "1'", 8]];
  SYN.organ = {
    name: 'Session Organ', desc: 'Tonewheel organ with 9 drawbars, percussion and key click — try it through Session Rotary',
    params: [
      ...BARS.map(([id, name], i) => ({ id, name, min: 0, max: 8, step: 1, default: [8, 8, 8, 0, 0, 0, 0, 0, 0][i], g: 'Drawbars' })),
      { id: 'perc', name: 'Percussion', type: 'select', options: ['Off', '2nd', '3rd'], default: 'Off', g: 'Voice' },
      { id: 'click', name: 'Key click', unit: '%', min: 0, max: 100, step: 1, default: 30, g: 'Voice' },
      { id: 'vib', name: 'Vibrato', unit: '%', min: 0, max: 100, step: 1, default: 0, g: 'Voice' },
      { id: 'drive', name: 'Drive', unit: '%', min: 0, max: 100, step: 1, default: 10, g: 'Voice' },
      { id: 'vol', name: 'Volume', unit: 'dB', min: -24, max: 6, step: 0.5, default: -9, g: 'Voice' },
    ],
    presets: [
      { name: 'Jazz', p: { b16: 8, b513: 8, b8: 8, b4: 0, b223: 0, b2: 0, b135: 0, b113: 0, b1: 0, perc: '3rd', click: 40, vib: 30 } },
      { name: 'Gospel', p: { b16: 8, b513: 8, b8: 8, b4: 8, b223: 0, b2: 0, b135: 0, b113: 0, b1: 8, perc: 'Off', click: 30, vib: 50, drive: 20 } },
      { name: 'Rock', p: { b16: 8, b513: 8, b8: 8, b4: 8, b223: 8, b2: 8, b135: 8, b113: 8, b1: 8, perc: 'Off', click: 50, drive: 60, vol: -12 } },
      { name: 'Soft flute', p: { b16: 0, b513: 0, b8: 8, b4: 6, b223: 0, b2: 0, b135: 0, b113: 0, b1: 0, perc: 'Off', click: 0, vib: 40 } },
      { name: 'Church', p: { b16: 8, b513: 6, b8: 8, b4: 8, b223: 4, b2: 6, b135: 0, b113: 3, b1: 4, perc: 'Off', click: 10, vib: 0 } },
    ],
    voice(ctx, dest, t, note, vel, dur, P) {
      const f = hz(note), sum = ctx.createGain(), amp = ctx.createGain(), out = ctx.createGain();
      const len = Math.max(0.03, dur), end = t + len + 0.08;
      out.gain.value = db(P.vol) * 0.9;
      amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(1, t + 0.004);
      amp.gain.setValueAtTime(1, t + len); amp.gain.setTargetAtTime(0.0001, t + len, 0.012);
      let vib = null;
      if (P.vib > 0) { const l = ctx.createOscillator(); l.frequency.value = 6.7; vib = ctx.createGain(); vib.gain.value = P.vib / 100 * 18; l.connect(vib); l.start(t); l.stop(end); }
      let total = 0;
      BARS.forEach(([id, , mul]) => {
        const lv = P[id] || 0; if (!lv || f * mul > 16000) return;
        const o = ctx.createOscillator(); o.frequency.value = f * mul; if (vib) vib.connect(o.detune);
        const g = ctx.createGain(); g.gain.value = Math.pow(10, (lv - 8) * 3 / 20) * (lv > 0 ? 1 : 0); total += g.gain.value;
        o.connect(g); g.connect(sum); o.start(t); o.stop(end);
      });
      if (P.perc !== 'Off') { // decaying 2nd / 3rd harmonic on the attack
        const o = ctx.createOscillator(); o.frequency.value = f * (P.perc === '2nd' ? 2 : 3);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.setTargetAtTime(0.0001, t, 0.15);
        o.connect(g); g.connect(sum); o.start(t); o.stop(Math.min(end, t + 1.2)); total += 0.4;
      }
      if (P.click > 0) { const n = noise(ctx), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.8; g.gain.setValueAtTime(P.click / 100 * 0.5, t); g.gain.setTargetAtTime(0.0001, t, 0.004); n.connect(bp); bp.connect(g); g.connect(sum); n.start(t); n.stop(t + 0.05); }
      const sat = ctx.createWaveShaper(), dr = 1 + P.drive / 100 * 5, cv = new Float32Array(1025);
      for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * dr) / Math.tanh(dr); }
      sat.curve = cv;
      sum.gain.value = 0.45 / Math.max(1, total * 0.55);
      sum.connect(sat); sat.connect(amp); amp.connect(out); out.connect(dest);
      return end;
    },
  };

  BI.SYNTHS = SYN;
  BI.synthParams = (id, ip) => {
    const def = SYN[id]; if (!def) return {};
    const P = {}; for (const p of def.params) P[p.id] = p.default;
    return Object.assign(P, ip || {});
  };

  /* ---------- sampler / slicer ---------- */
  const revCache = new WeakMap();
  function reversed(buf) {
    let r = revCache.get(buf); if (r) return r;
    r = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) { const s = buf.getChannelData(c), d = r.getChannelData(c); for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i]; }
    revCache.set(buf, r); return r;
  }
  BI.SAMPLER_DEFAULTS = { attack: 2, release: 60, start: 0, end: 100, loop: false, reverse: false, gain: 0, follow: true };
  /** Find the hits in a loop (onset detection on a smoothed energy curve). Returns slice start times in seconds. */
  BI.detectSlices = (buf, opts) => {
    opts = opts || {};
    const sr = buf.sampleRate, hop = Math.round(sr * 0.005), n = Math.floor(buf.length / hop);
    const ch = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) { let v = 0; for (const d of ch) v += d[j]; s += v * v; } e[i] = Math.log10(1e-9 + s / hop); }
    // spectral-flux-like rise of the log energy, with an adaptive threshold
    const rise = new Float32Array(n); for (let i = 2; i < n; i++) rise[i] = Math.max(0, e[i] - Math.max(e[i - 1], e[i - 2]));
    const sens = clamp(opts.sensitivity == null ? 0.5 : opts.sensitivity, 0, 1);
    const minGap = Math.round((opts.minGap || 0.07) / 0.005);
    const out = [0];
    let mean = 0; for (let i = 0; i < n; i++) mean += rise[i]; mean /= Math.max(1, n);
    const thr = mean * (6 - sens * 4.5) + 0.15 * (1 - sens);
    let last = -minGap;
    for (let i = 1; i < n - 1; i++) {
      if (rise[i] > thr && rise[i] >= rise[i - 1] && rise[i] >= rise[i + 1] && i - last >= minGap) {
        // find the exact first sample of the hit: the first one above 10% of the hit's peak, then back off 1 ms
        const from = Math.max(0, (i - 2) * hop), to = Math.min(buf.length, (i + 3) * hop);
        let pk = 0; for (let j = from; j < to; j++) { let v = 0; for (const d of ch) v += Math.abs(d[j]); if (v > pk) pk = v; }
        let at = from;
        // skip the previous sound's tail: start looking from the quietest point just before the hit
        let q = Infinity; for (let j = from; j < (i + 1) * hop && j < buf.length; j++) { let v = 0; for (const d of ch) v += Math.abs(d[j]); if (v < q) { q = v; at = j; } }
        for (let j = at; j < to; j++) { let v = 0; for (const d of ch) v += Math.abs(d[j]); if (v > pk * 0.1 + q) { at = j; break; } }
        const tt = Math.max(0, at / sr - 0.001);
        if (tt - out[out.length - 1] > 0.03) out.push(tt);
        last = i;
      }
    }
    return out.slice(0, opts.max || 64);
  };
  BI.equalSlices = (buf, count) => { const d = buf.duration; return [...Array(count)].map((_, i) => (i * d) / count); };

  function playSample(ctx, dest, t, opts, def) {
    const raw = def.assetId && S.buffers.get(def.assetId);
    if (!raw) return;
    const sp = Object.assign({}, BI.SAMPLER_DEFAULTS, def.sp || {});
    const v = opts.vel == null ? 0.9 : opts.vel;
    const tune = def.tune || 0;
    const baseNote = opts.note == null ? 60 : opts.note;
    let buf = raw, off, len, rate;
    if (Array.isArray(def.slices) && def.slices.length) {
      const i = baseNote - (def.root == null ? 48 : def.root);
      if (i < 0 || i >= def.slices.length) return;
      off = def.slices[i]; len = (i + 1 < def.slices.length ? def.slices[i + 1] : raw.duration) - off;
      rate = Math.pow(2, tune / 12);
      if (sp.reverse) { buf = reversed(raw); off = raw.duration - off - len; }
    } else {
      const a = clamp(sp.start, 0, 99) / 100 * raw.duration, b = clamp(sp.end, 1, 100) / 100 * raw.duration;
      off = Math.min(a, b - 0.005); len = Math.max(0.005, b - off);
      rate = sp.follow ? Math.pow(2, (baseNote + tune - (def.root == null ? 60 : def.root)) / 12) : Math.pow(2, tune / 12);
      if (sp.reverse) { buf = reversed(raw); off = raw.duration - off - len; }
    }
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = ctx.createGain(), peak = v * db(sp.gain || 0), A = Math.max(0.001, sp.attack / 1000), R = Math.max(0.003, sp.release / 1000);
    const dur = opts.dur == null ? len / rate : opts.dur;
    const playFor = sp.loop ? dur : Math.min(dur, len / rate);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + A);
    g.gain.setValueAtTime(peak, t + Math.max(A, playFor)); g.gain.setTargetAtTime(0.0001, t + Math.max(A, playFor), R / 4);
    s.connect(g); g.connect(dest);
    if (sp.loop) { s.loop = true; s.loopStart = off; s.loopEnd = off + len; s.start(t, off); }
    else s.start(t, off, len);
    s.stop(t + Math.max(A, playFor) + R * 1.3 + 0.02);
  }

  /* ---------- hook into Beat Lab's instrument factory ---------- */
  const baseMake = BI.make;
  BI.make = (ctx, def) => {
    const inst = baseMake(ctx, def);
    if (def.type === 'keys' && def.inst && SYN[def.inst]) {
      const syn = SYN[def.inst];
      inst.trigger = (dest, time, opts) => {
        opts = opts || {};
        try { syn.voice(ctx, dest, time, (opts.note == null ? 60 : opts.note) + (def.tune || 0), opts.vel == null ? 0.9 : opts.vel, opts.dur == null ? 0.25 : opts.dur, BI.synthParams(def.inst, def.ip)); } catch (e) { console.warn('[synth]', e); }
      };
    } else if (def.type === 'custom') {
      inst.trigger = (dest, time, opts) => { try { playSample(ctx, dest, time, opts || {}, def); } catch (e) {} };
    }
    return inst;
  };
})();
