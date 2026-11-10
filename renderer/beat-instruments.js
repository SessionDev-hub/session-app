/* Beat Lab — instruments. Every sound is synthesised from scratch in Web Audio (no samples, so
 * everything is 100% free to use, forever), plus a custom-sample player.
 * Works the same live and in an OfflineAudioContext (bounce).
 *
 *   S.beatInstruments.make(ctx, channel) -> { trigger(dest, time, {note, vel, dur}), triggerChain(dest, notes) }
 *
 * Drums: channel.sound = an id from SOUNDS (pick from many kicks, snares, hats…), channel.kind = family.
 * 808:   channel.preset = an id from BASS_PRESETS, channel.p = { drive, decay, punch, glide, tone } overrides.
 * Keys:  channel.preset = an id from KEY_PRESETS.
 */
(function () {
  const S = window.Studio;
  const BI = (S.beatInstruments = {});

  /* ---------- helpers ---------- */
  const noiseBufs = new WeakMap();
  function noiseBuffer(ctx) {
    let b = noiseBufs.get(ctx);
    if (b) return b;
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
    noiseBufs.set(ctx, b);
    return b;
  }
  function noise(ctx, t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx); s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return s;
  }
  const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // percussive envelope: fast attack, exponential decay
  function env(ctx, t, peak, a, d) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  }
  function osc(ctx, type, f, t, dur) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + 0.05); return o; }
  function filt(ctx, type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  const curves = {};
  function shaper(ctx, amt) {
    const k = Math.round(amt * 20) / 20;
    let c = curves[k];
    if (!c) { c = new Float32Array(2048); const d = 1 + k * 12; for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1; c[i] = Math.tanh(x * d) / Math.tanh(d); } curves[k] = c; }
    const w = ctx.createWaveShaper(); w.curve = c; w.oversample = '2x'; return w;
  }

  /* ---------- drum engines ---------- */
  const ENG = {
    // p: f0 start Hz, f1 body Hz, pd pitch-drop time, d decay, click, drive
    kick(ctx, out, t, v, p) {
      const o = osc(ctx, 'sine', p.f0, t, p.d + 0.1);
      o.frequency.exponentialRampToValueAtTime(p.f1, t + p.pd);
      const g = env(ctx, t, v, 0.002, p.d);
      let n = o;
      if (p.drive) { const w = shaper(ctx, p.drive); o.connect(w); n = w; }
      n.connect(g).connect(out);
      if (p.click) { const c = noise(ctx, t, 0.012); const hp = filt(ctx, 'highpass', 2500); c.connect(hp).connect(env(ctx, t, v * p.click, 0.0005, 0.012)).connect(out); }
    },
    // p: tone Hz, td tone decay, nd noise decay, hp, lp, mix (0 tone .. 1 noise), snap
    snare(ctx, out, t, v, p) {
      const o = osc(ctx, 'triangle', p.tone, t, p.td + 0.05);
      o.frequency.exponentialRampToValueAtTime(p.tone * 0.75, t + p.td);
      o.connect(env(ctx, t, v * (1 - p.mix) * 1.2, 0.001, p.td)).connect(out);
      const n = noise(ctx, t, p.nd + 0.05);
      const hp = filt(ctx, 'highpass', p.hp), lp = filt(ctx, 'lowpass', p.lp);
      n.connect(hp).connect(lp).connect(env(ctx, t, v * p.mix, 0.001, p.nd)).connect(out);
      if (p.snap) { const s = noise(ctx, t, 0.02); s.connect(filt(ctx, 'bandpass', 4000, 1)).connect(env(ctx, t, v * p.snap, 0.0005, 0.018)).connect(out); }
    },
    // p: f center, q, bursts, spread s, d tail decay
    clap(ctx, out, t, v, p) {
      const bp = filt(ctx, 'bandpass', p.f, p.q); bp.connect(out);
      for (let i = 0; i < p.bursts; i++) {
        const tt = t + i * p.spread, last = i === p.bursts - 1;
        noise(ctx, tt, (last ? p.d : 0.02) + 0.03).connect(env(ctx, tt, v * (last ? 0.9 : 0.6), 0.0008, last ? p.d : 0.012)).connect(bp);
      }
    },
    // p: hp, d, metal (0..1 metallic square cluster), lp
    hat(ctx, out, t, v, p) {
      const g = env(ctx, t, v * 0.55, 0.0008, p.d);
      const hp = filt(ctx, 'highpass', p.hp), lp = filt(ctx, 'lowpass', p.lp || 16000);
      hp.connect(lp).connect(g).connect(out);
      noise(ctx, t, p.d + 0.02).connect(hp);
      if (p.metal) {
        const mg = ctx.createGain(); mg.gain.value = p.metal * 0.18; mg.connect(hp);
        for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) osc(ctx, 'square', 40 * r * 7.9, t, p.d).connect(mg);
      }
    },
    // tonal perc: p: f, f2 (end), d, type (sine/triangle/square), noise, bp
    tone(ctx, out, t, v, p) {
      const o = osc(ctx, p.type || 'sine', p.f, t, p.d);
      if (p.f2) o.frequency.exponentialRampToValueAtTime(p.f2, t + p.d * 0.7);
      let n = o; if (p.bp) { const b = filt(ctx, 'bandpass', p.bp, 2); o.connect(b); n = b; }
      n.connect(env(ctx, t, v * (p.gain || 0.8), 0.001, p.d)).connect(out);
      if (p.noise) noise(ctx, t, 0.03).connect(filt(ctx, 'highpass', 3000)).connect(env(ctx, t, v * p.noise, 0.0005, 0.025)).connect(out);
    },
    // cowbell / bell: two detuned squares through a bandpass
    bell(ctx, out, t, v, p) {
      const bp = filt(ctx, 'bandpass', p.bp, 3); const g = env(ctx, t, v * 0.6, 0.001, p.d);
      bp.connect(g).connect(out);
      for (const f of p.fs) osc(ctx, p.type || 'square', f, t, p.d).connect(bp);
    },
    // noise sweeps & shakers: p: f0, f1, d, q, a (attack)
    sweep(ctx, out, t, v, p) {
      const n = noise(ctx, t, p.d + 0.05); const b = filt(ctx, 'bandpass', p.f0, p.q || 1.2);
      b.frequency.setValueAtTime(p.f0, t); b.frequency.exponentialRampToValueAtTime(p.f1, t + p.d);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.7, t + (p.a || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + p.d);
      n.connect(b).connect(g).connect(out);
    },
  };

  /* ---------- the sound library: lots of each, grouped by family ---------- */
  const SND = (id, kind, name, eng, p) => ({ id, kind, name, eng, p });
  const SOUNDS = [
    // kicks
    SND('k-808', 'kick', '808 Boom', 'kick', { f0: 140, f1: 44, pd: 0.09, d: 0.75, click: 0.25 }),
    SND('k-punch', 'kick', 'Punchy', 'kick', { f0: 190, f1: 52, pd: 0.05, d: 0.32, click: 0.6, drive: 0.2 }),
    SND('k-trap', 'kick', 'Trap Knock', 'kick', { f0: 230, f1: 55, pd: 0.035, d: 0.38, click: 0.8, drive: 0.45 }),
    SND('k-hard', 'kick', 'Hard Clipped', 'kick', { f0: 260, f1: 58, pd: 0.04, d: 0.42, click: 0.9, drive: 0.9 }),
    SND('k-rage', 'kick', 'Rage Distorted', 'kick', { f0: 300, f1: 50, pd: 0.06, d: 0.55, click: 0.7, drive: 1 }),
    SND('k-boombap', 'kick', 'Boom Bap', 'kick', { f0: 150, f1: 60, pd: 0.05, d: 0.28, click: 0.4, drive: 0.35 }),
    SND('k-lofi', 'kick', 'Lo-Fi Thud', 'kick', { f0: 110, f1: 50, pd: 0.06, d: 0.25, click: 0.1, drive: 0.15 }),
    SND('k-house', 'kick', 'House 4x4', 'kick', { f0: 170, f1: 48, pd: 0.045, d: 0.45, click: 0.5, drive: 0.25 }),
    SND('k-deep', 'kick', 'Deep Sub', 'kick', { f0: 100, f1: 38, pd: 0.12, d: 0.9, click: 0.1 }),
    SND('k-tight', 'kick', 'Tight Click', 'kick', { f0: 320, f1: 70, pd: 0.025, d: 0.16, click: 1, drive: 0.3 }),
    // snares
    SND('s-trap', 'snare', 'Trap Snare', 'snare', { tone: 220, td: 0.08, nd: 0.18, hp: 1800, lp: 11000, mix: 0.72, snap: 0.5 }),
    SND('s-tight', 'snare', 'Tight', 'snare', { tone: 260, td: 0.05, nd: 0.1, hp: 2500, lp: 12000, mix: 0.7, snap: 0.6 }),
    SND('s-fat', 'snare', 'Fat Body', 'snare', { tone: 180, td: 0.14, nd: 0.24, hp: 1200, lp: 9000, mix: 0.55, snap: 0.3 }),
    SND('s-lofi', 'snare', 'Lo-Fi Dusty', 'snare', { tone: 200, td: 0.09, nd: 0.16, hp: 900, lp: 4500, mix: 0.65, snap: 0.1 }),
    SND('s-drill', 'snare', 'Drill Rim Snare', 'snare', { tone: 330, td: 0.04, nd: 0.12, hp: 3000, lp: 13000, mix: 0.6, snap: 0.9 }),
    SND('s-piccolo', 'snare', 'Piccolo', 'snare', { tone: 400, td: 0.06, nd: 0.09, hp: 3500, lp: 14000, mix: 0.6, snap: 0.7 }),
    SND('s-rock', 'snare', 'Big Room', 'snare', { tone: 190, td: 0.12, nd: 0.35, hp: 1000, lp: 10000, mix: 0.7, snap: 0.4 }),
    // claps
    SND('c-classic', 'clap', 'Classic Clap', 'clap', { f: 1500, q: 0.7, bursts: 4, spread: 0.012, d: 0.14 }),
    SND('c-trap', 'clap', 'Trap Clap', 'clap', { f: 1800, q: 0.9, bursts: 3, spread: 0.009, d: 0.11 }),
    SND('c-wide', 'clap', 'Wide Layered', 'clap', { f: 1300, q: 0.5, bursts: 5, spread: 0.014, d: 0.22 }),
    SND('c-snap', 'clap', 'Finger Snap', 'clap', { f: 2600, q: 2.2, bursts: 1, spread: 0, d: 0.05 }),
    SND('c-verb', 'clap', 'Big Verb Clap', 'clap', { f: 1400, q: 0.6, bursts: 4, spread: 0.013, d: 0.45 }),
    SND('c-lofi', 'clap', 'Lo-Fi Clap', 'clap', { f: 1100, q: 0.9, bursts: 3, spread: 0.011, d: 0.12 }),
    // closed hats
    SND('h-trap', 'hat', 'Trap Hat', 'hat', { hp: 8200, d: 0.04, metal: 0.4 }),
    SND('h-crisp', 'hat', 'Crisp', 'hat', { hp: 9500, d: 0.028, metal: 0.2 }),
    SND('h-metal', 'hat', 'Metallic 808', 'hat', { hp: 7000, d: 0.05, metal: 1 }),
    SND('h-lofi', 'hat', 'Lo-Fi Hat', 'hat', { hp: 6000, d: 0.045, lp: 9000, metal: 0.3 }),
    SND('h-shaker', 'hat', 'Shaker', 'sweep', { f0: 6000, f1: 7500, d: 0.08, q: 0.8, a: 0.02 }),
    SND('h-tick', 'hat', 'Tick', 'hat', { hp: 11000, d: 0.015, metal: 0.1 }),
    // open hats
    SND('o-open', 'openhat', 'Open Hat', 'hat', { hp: 7000, d: 0.32, metal: 0.5 }),
    SND('o-808', 'openhat', '808 Open', 'hat', { hp: 6500, d: 0.42, metal: 1 }),
    SND('o-short', 'openhat', 'Short Open', 'hat', { hp: 7800, d: 0.18, metal: 0.4 }),
    SND('o-lofi', 'openhat', 'Lo-Fi Open', 'hat', { hp: 5500, d: 0.3, lp: 8000, metal: 0.3 }),
    // percussion
    SND('p-cowbell', 'perc', '808 Cowbell', 'bell', { fs: [540, 800], bp: 1000, d: 0.3 }),
    SND('p-bell', 'perc', 'Bell', 'bell', { fs: [1046, 1568, 2637], bp: 1800, d: 0.6, type: 'sine' }),
    SND('p-conga', 'perc', 'Conga', 'tone', { f: 330, f2: 260, d: 0.22, type: 'sine', noise: 0.15 }),
    SND('p-bongo', 'perc', 'Bongo', 'tone', { f: 520, f2: 420, d: 0.14, type: 'sine', noise: 0.15 }),
    SND('p-wood', 'perc', 'Woodblock', 'tone', { f: 900, f2: 860, d: 0.07, type: 'triangle', bp: 900 }),
    SND('p-shaker', 'perc', 'Shaker Loop', 'sweep', { f0: 5000, f1: 6500, d: 0.12, q: 0.8, a: 0.04 }),
    SND('p-blip', 'perc', 'Blip', 'tone', { f: 1600, f2: 800, d: 0.08, type: 'square', gain: 0.4 }),
    SND('p-pluck', 'perc', 'Pluck Hit', 'tone', { f: 700, f2: 350, d: 0.12, type: 'triangle' }),
    SND('p-clave', 'perc', 'Clave', 'tone', { f: 2500, d: 0.05, type: 'sine', gain: 0.7 }),
    SND('p-tri', 'perc', 'Triangle', 'bell', { fs: [3200, 4800], bp: 4000, d: 0.7, type: 'sine' }),
    // toms / rims
    SND('t-low', 'tom', 'Low Tom', 'tone', { f: 120, f2: 80, d: 0.4, type: 'sine', noise: 0.1 }),
    SND('t-mid', 'tom', 'Mid Tom', 'tone', { f: 180, f2: 120, d: 0.3, type: 'sine', noise: 0.1 }),
    SND('t-high', 'tom', 'High Tom', 'tone', { f: 260, f2: 180, d: 0.25, type: 'sine', noise: 0.1 }),
    SND('r-rim', 'rim', 'Rimshot', 'tone', { f: 420, d: 0.04, type: 'square', bp: 1700, noise: 0.3, gain: 0.6 }),
    SND('r-stick', 'rim', 'Side Stick', 'tone', { f: 600, d: 0.035, type: 'triangle', bp: 2200, noise: 0.4, gain: 0.6 }),
    // cymbals & fx
    SND('y-crash', 'crash', 'Crash', 'hat', { hp: 4500, d: 1.4, metal: 0.6 }),
    SND('y-ride', 'crash', 'Ride', 'hat', { hp: 6000, d: 0.9, metal: 1 }),
    SND('x-riser', 'fx', 'Noise Riser', 'sweep', { f0: 400, f1: 9000, d: 1.6, q: 1.5, a: 1.2 }),
    SND('x-down', 'fx', 'Down Sweep', 'sweep', { f0: 8000, f1: 300, d: 0.9, q: 1.5 }),
    SND('x-zap', 'fx', 'Laser Zap', 'tone', { f: 3000, f2: 120, d: 0.25, type: 'sawtooth', gain: 0.35 }),
    SND('x-impact', 'fx', 'Impact', 'kick', { f0: 90, f1: 30, pd: 0.4, d: 1.6, click: 0.6, drive: 0.4 }),
  ];
  const BY_ID = new Map(SOUNDS.map((s) => [s.id, s]));
  BI.SOUNDS = SOUNDS;
  BI.FAMILIES = [['kick', 'Kicks'], ['snare', 'Snares'], ['clap', 'Claps'], ['hat', 'Hi-hats'], ['openhat', 'Open hats'], ['perc', 'Percussion'], ['tom', 'Toms'], ['rim', 'Rims'], ['crash', 'Cymbals'], ['fx', 'FX']];
  BI.soundsOf = (kind) => SOUNDS.filter((s) => s.kind === kind);
  BI.sound = (id) => BY_ID.get(id);
  // first sound of each family (also the default for old projects that only stored a kind)
  const DEFAULT_SOUND = { kick: 'k-808', snare: 's-trap', clap: 'c-classic', hat: 'h-trap', openhat: 'o-open', perc: 'p-cowbell', tom: 't-mid', rim: 'r-rim', crash: 'y-crash', fx: 'x-riser' };
  BI.defaultSound = (kind) => DEFAULT_SOUND[kind] || 'k-808';

  /* ---------- kits: one tap swaps every drum channel to a matching set ---------- */
  BI.KITS = [
    { id: 'trap', name: 'Trap', map: { kick: 'k-trap', snare: 's-trap', clap: 'c-trap', hat: 'h-trap', openhat: 'o-808', perc: 'p-cowbell', rim: 'r-rim' }, bass: '808-hard' },
    { id: 'rage', name: 'Rage', map: { kick: 'k-rage', snare: 's-tight', clap: 'c-trap', hat: 'h-crisp', openhat: 'o-short', perc: 'p-blip' }, bass: '808-growl' },
    { id: 'drill', name: 'Drill', map: { kick: 'k-punch', snare: 's-drill', clap: 'c-snap', hat: 'h-crisp', openhat: 'o-short', perc: 'p-bell', rim: 'r-stick' }, bass: '808-slide' },
    { id: 'plugg', name: 'Plugg', map: { kick: 'k-808', snare: 's-fat', clap: 'c-wide', hat: 'h-tick', openhat: 'o-open', perc: 'p-bell' }, bass: '808-clean' },
    { id: 'boombap', name: 'Boom Bap', map: { kick: 'k-boombap', snare: 's-fat', clap: 'c-lofi', hat: 'h-lofi', openhat: 'o-lofi', perc: 'p-wood', rim: 'r-stick' }, bass: '808-short' },
    { id: 'lofi', name: 'Lo-Fi', map: { kick: 'k-lofi', snare: 's-lofi', clap: 'c-lofi', hat: 'h-lofi', openhat: 'o-lofi', perc: 'p-shaker' }, bass: '808-sub' },
    { id: 'afro', name: 'Afrobeats', map: { kick: 'k-punch', snare: 's-piccolo', clap: 'c-snap', hat: 'h-shaker', openhat: 'o-short', perc: 'p-conga', tom: 't-high', rim: 'r-stick' }, bass: '808-short' },
    { id: 'house', name: 'House', map: { kick: 'k-house', snare: 's-rock', clap: 'c-wide', hat: 'h-crisp', openhat: 'o-open', perc: 'p-clave' }, bass: '808-sub' },
    { id: 'hard', name: 'Hard Hitter', map: { kick: 'k-hard', snare: 's-tight', clap: 'c-verb', hat: 'h-metal', openhat: 'o-808', perc: 'p-cowbell' }, bass: '808-hard' },
  ];

  /* ---------- 808 ---------- */
  // p: drive (0..1), decay (s), punch (pitch drop amount 0..1), glide (s, for slides), tone (lowpass Hz), harm (0..1 extra harmonics)
  BI.BASS_PRESETS = [
    { id: '808-clean', name: 'Clean 808', p: { drive: 0.15, decay: 1.2, punch: 0.4, glide: 0.08, tone: 9000, harm: 0.1 } },
    { id: '808-hard', name: 'Hard 808 (distorted)', p: { drive: 0.75, decay: 1.4, punch: 0.6, glide: 0.07, tone: 7000, harm: 0.3 } },
    { id: '808-slide', name: 'Drill Slide 808', p: { drive: 0.45, decay: 1.6, punch: 0.3, glide: 0.14, tone: 6000, harm: 0.2 } },
    { id: '808-long', name: 'Long 808', p: { drive: 0.3, decay: 2.6, punch: 0.4, glide: 0.1, tone: 8000, harm: 0.15 } },
    { id: '808-short', name: 'Short Punchy', p: { drive: 0.35, decay: 0.45, punch: 0.8, glide: 0.05, tone: 9000, harm: 0.2 } },
    { id: '808-growl', name: 'Growl / Rage', p: { drive: 1, decay: 1.5, punch: 0.5, glide: 0.08, tone: 3500, harm: 0.8 } },
    { id: '808-sub', name: 'Pure Sub', p: { drive: 0, decay: 1.4, punch: 0.15, glide: 0.08, tone: 2000, harm: 0 } },
  ];
  const bassP = (c) => Object.assign({}, (BI.BASS_PRESETS.find((x) => x.id === c.preset) || BI.BASS_PRESETS[0]).p, c.p || {});
  /**
   * Play a legato chain of 808 notes on ONE voice: overlapping notes slide (glide) into each other
   * like FL's slide notes instead of retriggering. notes = [{ t, note, vel, dur }] sorted by t.
   */
  function bassChain(ctx, dest, notes, p) {
    if (!notes.length) return;
    const t0 = notes[0].t, last = notes[notes.length - 1];
    const end = last.t + Math.max(0.12, Math.min(last.dur, p.decay));
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = midiToHz(notes[0].note);
    o.frequency.setValueAtTime(f0 * (1 + p.punch), t0);
    o.frequency.exponentialRampToValueAtTime(f0, t0 + 0.05);
    for (let i = 1; i < notes.length; i++) {
      const f = midiToHz(notes[i].note);
      o.frequency.setValueAtTime(midiToHz(notes[i - 1].note), notes[i].t);
      o.frequency.exponentialRampToValueAtTime(f, notes[i].t + Math.max(0.01, p.glide));
    }
    const mix = ctx.createGain();
    o.connect(mix);
    let h = null;
    if (p.harm > 0) { // a quiet triangle an octave up adds the harmonics that phone speakers can actually play
      h = ctx.createOscillator(); h.type = 'triangle';
      h.frequency.setValueAtTime(f0 * 2 * (1 + p.punch), t0); h.frequency.exponentialRampToValueAtTime(f0 * 2, t0 + 0.05);
      for (let i = 1; i < notes.length; i++) { h.frequency.setValueAtTime(midiToHz(notes[i - 1].note) * 2, notes[i].t); h.frequency.exponentialRampToValueAtTime(midiToHz(notes[i].note) * 2, notes[i].t + Math.max(0.01, p.glide)); }
      const hg = ctx.createGain(); hg.gain.value = p.harm * 0.35; h.connect(hg).connect(mix);
    }
    const sat = shaper(ctx, p.drive);
    const lp = filt(ctx, 'lowpass', p.tone, 0.7);
    const g = ctx.createGain();
    const v = Math.min(1, notes[0].vel == null ? 1 : notes[0].vel);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v * 0.9, t0 + 0.004);
    // hold through the chain, then decay from the last note
    g.gain.setValueAtTime(v * 0.9, Math.max(t0 + 0.005, last.t));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.02);
    mix.connect(sat).connect(lp).connect(g).connect(dest);
    o.start(t0); o.stop(end + 0.08);
    if (h) { h.start(t0); h.stop(end + 0.08); }
  }

  /* ---------- keys / melodic instruments ---------- */
  BI.KEY_PRESETS = [
    { id: 'piano', name: 'Piano' }, { id: 'epiano', name: 'E-Piano' }, { id: 'bell', name: 'Bells' }, { id: 'pluck', name: 'Pluck' },
    { id: 'pad', name: 'Pad' }, { id: 'lead', name: 'Rage Lead' }, { id: 'organ', name: 'Organ' }, { id: 'flute', name: 'Flute' },
    { id: 'brass', name: 'Brass' }, { id: 'synthbass', name: 'Synth Bass' }, { id: 'choir', name: 'Choir Pad' }, { id: 'guitar', name: 'Nylon Guitar' },
  ];
  function keyVoice(ctx, dest, t, note, v, dur, preset) {
    const f = midiToHz(note), sus = Math.max(0.08, dur);
    const out = ctx.createGain(); out.connect(dest);
    const ampEnv = (a, hold, rel, peak) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.setValueAtTime(peak, t + Math.max(a, hold)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, hold) + rel);
      g.connect(out); return { g, end: t + Math.max(a, hold) + rel };
    };
    let e;
    switch (preset) {
      case 'epiano': case 'bell': { // two-operator FM: bright attack that mellows
        const ratio = preset === 'bell' ? 3.5 : 1, idx = preset === 'bell' ? 4 : 2.2;
        e = ampEnv(0.003, preset === 'bell' ? 0.01 : sus * 0.5, preset === 'bell' ? 1.6 : 0.9, v * 0.35);
        const c = osc(ctx, 'sine', f, t, e.end - t), m = osc(ctx, 'sine', f * ratio, t, e.end - t);
        const mg = ctx.createGain(); mg.gain.setValueAtTime(f * idx, t); mg.gain.exponentialRampToValueAtTime(f * 0.2 + 1, t + 0.6);
        m.connect(mg).connect(c.frequency); c.connect(e.g); break;
      }
      case 'pluck': case 'guitar': {
        e = ampEnv(0.002, 0.01, preset === 'guitar' ? 0.9 : 0.45, v * 0.35);
        const lp = filt(ctx, 'lowpass', preset === 'guitar' ? 3000 : 5000, 2); lp.frequency.setValueAtTime(preset === 'guitar' ? 3000 : 6000, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.4);
        osc(ctx, preset === 'guitar' ? 'triangle' : 'sawtooth', f, t, e.end - t).connect(lp); lp.connect(e.g); break;
      }
      case 'pad': case 'choir': {
        e = ampEnv(0.35, sus, 0.8, v * 0.16);
        const lp = filt(ctx, 'lowpass', preset === 'choir' ? 1600 : 2400, 0.8); lp.connect(e.g);
        for (const d of [-9, -3, 4, 10]) { const o = osc(ctx, 'sawtooth', f, t, e.end - t); o.detune.value = d; o.connect(lp); }
        if (preset === 'choir') { const b = filt(ctx, 'bandpass', 900, 3); lp.disconnect(); lp.connect(b).connect(e.g); }
        break;
      }
      case 'lead': {
        e = ampEnv(0.004, sus * 0.7, 0.25, v * 0.12);
        const lp = filt(ctx, 'lowpass', 6000, 0.9); lp.connect(e.g);
        for (const d of [-18, -10, -4, 0, 5, 11, 19]) { const o = osc(ctx, 'sawtooth', f, t, e.end - t); o.detune.value = d; o.connect(lp); }
        break;
      }
      case 'organ': {
        e = ampEnv(0.01, sus, 0.08, v * 0.16);
        [1, 2, 3, 4].forEach((h, i) => { const o = osc(ctx, 'sine', f * h, t, e.end - t); const g = ctx.createGain(); g.gain.value = [1, 0.6, 0.35, 0.25][i]; o.connect(g).connect(e.g); });
        break;
      }
      case 'flute': {
        e = ampEnv(0.06, sus, 0.18, v * 0.3);
        const o = osc(ctx, 'sine', f, t, e.end - t); const vib = osc(ctx, 'sine', 5.2, t, e.end - t); const vg = ctx.createGain(); vg.gain.value = f * 0.006; vib.connect(vg).connect(o.frequency);
        o.connect(e.g); noise(ctx, t, e.end - t).connect(filt(ctx, 'bandpass', f * 2, 3)).connect((() => { const g = ctx.createGain(); g.gain.value = 0.05; return g; })()).connect(e.g);
        break;
      }
      case 'brass': {
        e = ampEnv(0.04, sus, 0.2, v * 0.2);
        const lp = filt(ctx, 'lowpass', 600, 1.5); lp.frequency.setValueAtTime(600, t); lp.frequency.linearRampToValueAtTime(3200, t + 0.08); lp.frequency.exponentialRampToValueAtTime(1600, t + 0.4);
        osc(ctx, 'sawtooth', f, t, e.end - t).connect(lp); const o2 = osc(ctx, 'sawtooth', f, t, e.end - t); o2.detune.value = 7; o2.connect(lp); lp.connect(e.g);
        break;
      }
      case 'synthbass': {
        e = ampEnv(0.003, sus * 0.8, 0.12, v * 0.3);
        const lp = filt(ctx, 'lowpass', 900, 4); lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.25);
        osc(ctx, 'sawtooth', f, t, e.end - t).connect(lp); osc(ctx, 'square', f / 2, t, e.end - t).connect(lp); lp.connect(e.g);
        break;
      }
      default: { // piano: struck, decaying, slightly bright
        e = ampEnv(0.002, 0.02, Math.min(2.2, 0.5 + sus), v * 0.3);
        const lp = filt(ctx, 'lowpass', 5000, 0.5); lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(1200, t + 1);
        for (const [h, gn, d] of [[1, 1, 0], [2, 0.45, 3], [3, 0.2, -4], [4, 0.1, 2]]) { const o = osc(ctx, 'triangle', f * h, t, e.end - t); o.detune.value = d; const g = ctx.createGain(); g.gain.value = gn; o.connect(g).connect(lp); }
        lp.connect(e.g);
      }
    }
  }

  /* ---------- factory ---------- */
  BI.make = (ctx, def) => {
    const type = def.type || 'drum';
    const tune = def.tune || 0;
    return {
      def,
      trigger(dest, time, opts) {
        opts = opts || {};
        const v = opts.vel == null ? 0.9 : opts.vel;
        const note = (opts.note == null ? 60 : opts.note) + tune;
        const dur = opts.dur == null ? 0.25 : opts.dur;
        try {
          if (type === 'drum') {
            const s = BY_ID.get(def.sound) || BY_ID.get(BI.defaultSound(def.kind));
            ENG[s.eng](ctx, dest, time, v, tune ? Object.assign({}, s.p, s.p.f0 ? { f0: s.p.f0 * Math.pow(2, tune / 12), f1: s.p.f1 * Math.pow(2, tune / 12) } : s.p.f ? { f: s.p.f * Math.pow(2, tune / 12), f2: s.p.f2 && s.p.f2 * Math.pow(2, tune / 12) } : {}) : s.p);
          } else if (type === 'bass') bassChain(ctx, dest, [{ t: time, note, vel: v, dur }], bassP(def));
          else if (type === 'keys') keyVoice(ctx, dest, time, note, v, dur, def.preset || 'piano');
          else if (type === 'custom') {
            const buf = def.assetId && S.buffers.get(def.assetId);
            if (!buf) return;
            const s = ctx.createBufferSource(); s.buffer = buf;
            s.playbackRate.value = Math.pow(2, (note - (def.root == null ? 60 : def.root)) / 12);
            const g = ctx.createGain(); g.gain.value = v;
            s.connect(g).connect(dest); s.start(time);
            if (opts.dur) s.stop(time + dur + 0.05);
          }
        } catch (e) { /* one bad voice never breaks the scheduler */ }
      },
      // 808 legato chain (slides). notes: [{t, note, vel, dur}]
      triggerChain(dest, notes) {
        try { bassChain(ctx, dest, notes.map((n) => Object.assign({}, n, { note: n.note + tune })), bassP(def)); } catch (e) {}
      },
      dispose() {},
    };
  };

  // default channel set for a fresh beat
  BI.defaultChannels = () => ([
    { id: S.uid(), type: 'drum', kind: 'kick', sound: 'k-808', name: 'Kick' },
    { id: S.uid(), type: 'drum', kind: 'snare', sound: 's-trap', name: 'Snare' },
    { id: S.uid(), type: 'drum', kind: 'hat', sound: 'h-trap', name: 'Hat' },
    { id: S.uid(), type: 'drum', kind: 'clap', sound: 'c-classic', name: 'Clap' },
    { id: S.uid(), type: 'drum', kind: 'openhat', sound: 'o-open', name: 'Open Hat' },
    { id: S.uid(), type: 'drum', kind: 'perc', sound: 'p-cowbell', name: 'Perc' },
    { id: S.uid(), type: 'bass', name: '808', preset: '808-clean' },
    { id: S.uid(), type: 'keys', name: 'Keys', preset: 'piano' },
  ]);
})();
