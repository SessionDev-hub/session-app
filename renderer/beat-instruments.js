/* Beat Lab — instruments. Pure Web Audio voices (no samples, no licensing) plus a custom-sample
 * player. Every instrument is fire-and-forget: trigger(dest, time, opts) schedules one voice that
 * cleans itself up. Works the same in the live context and in an OfflineAudioContext (bounce).
 *
 *   S.beatInstruments.make(ctx, def) -> { def, trigger(dest, time, {note, vel, dur}), dispose() }
 *
 * def = { id, name, type:'drum'|'bass'|'keys'|'custom', kind?, assetId?, params? }
 */
(function () {
  const S = window.Studio;
  const BI = (S.beatInstruments = {});

  const noiseBufs = new WeakMap();
  function noiseBuffer(ctx) {
    let b = noiseBufs.get(ctx);
    if (b) return b;
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(ctx, b);
    return b;
  }
  function noise(ctx, t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    s.loop = true;
    s.start(t);
    s.stop(t + dur + 0.02);
    return s;
  }
  const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const env = (ctx, t, peak, a, d) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  };

  /* ---------- drum voices ---------- */
  const DRUMS = {
    kick(ctx, dest, t, v) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(49, t + 0.12);
      const g = env(ctx, t, v, 0.002, 0.34);
      o.connect(g).connect(dest); o.start(t); o.stop(t + 0.4);
      // click transient for punch
      const c = noise(ctx, t, 0.01); const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 1200;
      const cg = env(ctx, t, v * 0.5, 0.001, 0.02); c.connect(cf).connect(cg).connect(dest);
    },
    snare(ctx, dest, t, v) {
      const n = noise(ctx, t, 0.2); const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1400;
      const ng = env(ctx, t, v * 0.8, 0.001, 0.2); n.connect(nf).connect(ng).connect(dest);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t);
      const og = env(ctx, t, v * 0.5, 0.001, 0.12); o.connect(og).connect(dest); o.start(t); o.stop(t + 0.16);
    },
    hat(ctx, dest, t, v) {
      const n = noise(ctx, t, 0.05); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
      const g = env(ctx, t, v * 0.5, 0.001, 0.045); n.connect(f).connect(g).connect(dest);
    },
    openhat(ctx, dest, t, v) {
      const n = noise(ctx, t, 0.35); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = env(ctx, t, v * 0.45, 0.001, 0.33); n.connect(f).connect(g).connect(dest);
    },
    clap(ctx, dest, t, v) {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.7;
      f.connect(dest);
      [0, 0.012, 0.024, 0.04].forEach((off, i) => {
        const n = noise(ctx, t + off, 0.09);
        const g = env(ctx, t + off, v * (i === 3 ? 0.6 : 0.35), 0.001, i === 3 ? 0.12 : 0.05);
        n.connect(g).connect(f);
      });
    },
    tom(ctx, dest, t, v) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.2);
      const g = env(ctx, t, v, 0.002, 0.3); o.connect(g).connect(dest); o.start(t); o.stop(t + 0.34);
    },
    rim(ctx, dest, t, v) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(400, t);
      const g = env(ctx, t, v * 0.5, 0.001, 0.03); o.connect(g).connect(dest); o.start(t); o.stop(t + 0.05);
    },
    perc(ctx, dest, t, v) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.1);
      const g = env(ctx, t, v * 0.6, 0.001, 0.12); o.connect(g).connect(dest); o.start(t); o.stop(t + 0.16);
    },
  };
  BI.DRUM_KINDS = Object.keys(DRUMS); // kick snare hat openhat clap tom rim perc

  /* ---------- pitched voices ---------- */
  function trigger808(ctx, dest, t, note, v, dur) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = midiToHz(note);
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06); // glide = classic 808 thump
    const decay = Math.max(0.25, dur);
    const g = env(ctx, t, Math.min(1, v), 0.004, decay);
    const sat = ctx.createWaveShaper(); sat.curve = SAT; // gentle drive for weight
    o.connect(sat).connect(g).connect(dest); o.start(t); o.stop(t + decay + 0.05);
  }
  const SAT = (() => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * 2); } return c; })();

  function triggerKeys(ctx, dest, t, note, v, dur) {
    const f = midiToHz(note);
    const sus = Math.max(0.1, dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.5, t + 0.01);
    g.gain.setValueAtTime(v * 0.5, t + sus * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sus + 0.15);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
    lp.connect(g).connect(dest);
    [-0.08, 0.08].forEach((det) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f; o.detune.value = det * 100;
      o.connect(lp); o.start(t); o.stop(t + sus + 0.2);
    });
  }

  /* ---------- factory ---------- */
  BI.make = (ctx, def) => {
    const type = def.type || 'drum';
    return {
      def,
      trigger(dest, time, opts) {
        opts = opts || {};
        const v = opts.vel == null ? 0.9 : opts.vel;
        const note = opts.note == null ? 60 : opts.note;
        const dur = opts.dur == null ? 0.25 : opts.dur;
        try {
          if (type === 'drum') (DRUMS[def.kind] || DRUMS.kick)(ctx, dest, time, v);
          else if (type === 'bass') trigger808(ctx, dest, time, note, v, dur);
          else if (type === 'keys') triggerKeys(ctx, dest, time, note, v, dur);
          else if (type === 'custom') {
            const buf = def.assetId && S.buffers.get(def.assetId);
            if (!buf) return;
            const s = ctx.createBufferSource(); s.buffer = buf;
            s.playbackRate.value = Math.pow(2, (note - (def.root == null ? 60 : def.root)) / 12);
            const g = ctx.createGain(); g.gain.value = v;
            s.connect(g).connect(dest); s.start(time);
            // let it ring for the note length (0 = play whole sample)
            if (opts.dur) s.stop(time + dur + 0.05);
          }
        } catch (e) { /* never let one bad voice break the scheduler */ }
      },
      dispose() {},
    };
  };

  // default channel set for a fresh beat
  BI.defaultChannels = () => ([
    { id: S.uid(), type: 'drum', kind: 'kick', name: 'Kick' },
    { id: S.uid(), type: 'drum', kind: 'snare', name: 'Snare' },
    { id: S.uid(), type: 'drum', kind: 'hat', name: 'Hat' },
    { id: S.uid(), type: 'drum', kind: 'clap', name: 'Clap' },
    { id: S.uid(), type: 'bass', name: '808' },
    { id: S.uid(), type: 'keys', name: 'Keys' },
  ]);
})();
