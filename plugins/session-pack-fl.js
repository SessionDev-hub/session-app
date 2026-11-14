/* Session plugin pack 2 — FL Studio's signature effects, rebuilt for Session:
 * Time Bender (Gross Beat style), Vocoder (Vocodex style), Harmonizer (Pitcher style), One-Knob Loud
 * (Soundgoodizer style), Filter Motion (Love Philter style), Frequency Shifter, Stereo Shaper and
 * Space Verb (convolution reverb). Everything is Web Audio / AudioWorklet: same sound live and in exports,
 * and it all runs on Android. Tempo-synced ones follow the song's BPM and the play position. */
(function () {
  const Studio = window.Studio;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const db = (x) => Math.pow(10, x / 20);
  const k = (name, def, min, max) => `{ name: '${name}', defaultValue: ${def}, minValue: ${min}, maxValue: ${max}, automationRate: 'k-rate' }`;
  const bpm = () => (Studio.project && Studio.project.bpm) || 120;
  const bpb = () => (Studio.project && Studio.project.beatsPerBar) || 4;
  const passthrough = (ctx, why) => { console.warn('[' + why + '] worklet unavailable, passing audio through'); const g = ctx.createGain(); return { input: g, output: g, setParam() {}, destroy() {} }; };
  const dryWet = (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    input.connect(dry); dry.connect(output); wet.connect(output);
    const setMix = (m) => { dry.gain.value = Math.cos((m * Math.PI) / 2); wet.gain.value = Math.sin((m * Math.PI) / 2); };
    return { input, output, wet, setMix };
  };
  function listen(names, fn) {
    if (!Studio.events) return () => {};
    const h = (e) => fn(e.detail);
    names.forEach((n) => Studio.events.addEventListener(n, h));
    return () => names.forEach((n) => Studio.events.removeEventListener(n, h));
  }
  const worklet = (ctx, name) => new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
  /** Keep a tempo-synced worklet locked to the song: BPM, beats per bar and where playback started. */
  function syncTransport(ctx, node) {
    const P = (id) => node.parameters.get(id);
    const tempo = () => { P('bpm').value = bpm(); P('bpb').value = bpb(); };
    tempo();
    const eng = Studio.engine;
    if (eng && eng.ctx === ctx && eng.playing) node.port.postMessage({ anchor: { ctxTime: eng.startTime, pos: eng.startPos } });
    const a = listen(['tempo-changed', 'project-replaced'], tempo);
    const b = listen(['transport'], (d) => d && d.ctx === ctx && node.port.postMessage({ anchor: { ctxTime: d.ctxTime, pos: d.pos } }));
    return () => { a(); b(); };
  }

  /* ================= Time Bender (Gross Beat style) =================
   * Plays the last few seconds back at a different speed, locked to the bar: half-time, tape stop,
   * stutters, build-up rolls and a slow-down "screw". Reads only audio that has already passed, so it
   * works live with no extra delay. */
  Studio.registerWorklet('ss-timebend', `
    class SsTimeBend extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [${k('bpm', 120, 20, 400)}, ${k('bpb', 4, 1, 16)}, ${k('mode', 0, 0, 6)}, ${k('len', 1, 0, 3)}, ${k('mix', 1, 0, 1)}]; }
      constructor() {
        super(); this.N = 1 << 20; this.buf = [new Float32Array(this.N), new Float32Array(this.N)];
        this.w = 0; this.anchor = { ctxTime: 0, pos: 0 }; this.lastSeg = null; this.segW = 0;
        this.head = null; this.xf = 0; this.xfFrom = 0; this.XF = Math.round(sampleRate * 0.004);
        this.port.onmessage = (e) => { if (e.data && e.data.anchor) { this.anchor = e.data.anchor; this.lastSeg = null; } };
      }
      rd(c, pos) { const N = this.N, i = Math.floor(pos), f = pos - i; const b = this.buf[c]; const a = b[(i % N + N) % N], d = b[((i + 1) % N + N) % N]; return a + (d - a) * f; }
      // seconds into the section to play, for "ph" seconds of real time (never ahead of real time)
      offset(mode, ph, seg, beat) {
        const end = Math.max(0, seg - beat), u = ph - end;
        switch (mode) {
          case 0: return ph * 0.5;                                           // half-time
          case 1: return u <= 0 ? ph : end + u - (u * u) / (2 * beat);       // tape stop over the last beat
          case 2: { const sl = beat / 2; return u <= 0 ? ph : end + (u % sl); }   // 1/8 stutter, last beat
          case 3: { const sl = beat / 4; return u <= 0 ? ph : end + (u % sl); }   // 1/16 stutter, last beat
          case 4: { const q = seg / 4, r = Math.min(3, Math.floor(ph / q)), q0 = r * q, sl = beat / [1, 2, 4, 8][r]; return q0 + ((ph - q0) % sl); } // roll 1/4→1/32
          case 5: return ph - (0.25 * ph * ph) / seg;                        // screw: slows to half speed
          case 6: return u <= 0 ? ph : Math.max(0, end - 2 * u);             // rewind the last beat (2× backwards)
        }
        return ph;
      }
      process(inputs, outputs, P) {
        const inp = inputs[0], out = outputs[0];
        const n = out[0].length;
        const beat = 60 / P.bpm[0], bar = beat * P.bpb[0];
        const mode = Math.round(P.mode[0]), seg = bar * [0.5, 1, 2, 4][Math.round(P.len[0])], mix = P.mix[0];
        const t0 = this.anchor.pos + (currentTime - this.anchor.ctxTime);
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < 2; c++) { const s = inp && inp.length ? inp[Math.min(c, inp.length - 1)] : null; this.buf[c][this.w] = s ? s[i] : 0; }
          const t = t0 + i / sampleRate;
          let y0, y1;
          if (t < 0) { y0 = this.buf[0][this.w]; y1 = this.buf[1][this.w]; }
          else {
            const sIdx = Math.floor(t / seg), ph = t - sIdx * seg;
            if (sIdx !== this.lastSeg) { this.lastSeg = sIdx; this.segW = this.w - Math.round(ph * sampleRate); }
            const off = Math.max(0, Math.min(ph, this.offset(mode, ph, seg, beat)));
            const pos = this.segW + off * sampleRate;
            // any jump in the read head gets a 4 ms crossfade from where the old head was heading, so nothing clicks
            if (this.head !== null && Math.abs(pos - (this.head + 1)) > 1.5 && Math.abs(pos - this.head) > 1.5) { this.xf = this.XF; this.xfFrom = this.head + 1; }
            else if (this.xf > 0) this.xfFrom += 1;
            this.head = pos;
            y0 = this.rd(0, pos); y1 = this.rd(1, pos);
            // the new audio comes in almost at once (keeps the drum hit on the jump), the old tail fades out over 4 ms
            if (this.xf > 0) { const a = this.xf / this.XF, fin = Math.min(1, (this.XF - this.xf + 1) / 4); y0 = y0 * fin + this.rd(0, this.xfFrom) * a; y1 = y1 * fin + this.rd(1, this.xfFrom) * a; this.xf--; }
          }
          const d0 = this.buf[0][this.w], d1 = this.buf[1][this.w];
          out[0][i] = d0 * (1 - mix) + y0 * mix; if (out[1]) out[1][i] = d1 * (1 - mix) + y1 * mix;
          this.w = (this.w + 1) % this.N;
        }
        return true;
      }
    }
    registerProcessor('ss-timebend', SsTimeBend);`);
  const TB_MODES = ['Half-time', 'Tape stop', 'Stutter 1/8', 'Stutter 1/16', 'Build-up roll', 'Screw (slow down)', 'Rewind'];
  Studio.registerPlugin({
    id: 'ss-timebend',
    name: 'Session Time Bender',
    category: 'Creative',
    color: '#f43f5e',
    description: 'Gross Beat-style time tricks locked to your tempo: half-time, tape stops, stutters, build-up rolls, screw and rewind',
    params: [
      { id: 'mode', name: 'Effect', type: 'select', options: TB_MODES, default: 'Half-time' },
      { id: 'len', name: 'Every', type: 'select', options: ['1/2 bar', '1 bar', '2 bars', '4 bars'], default: '1 bar' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Time', params: ['mode', 'len'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: 'Half-time drop', params: { mode: 'Half-time', len: '1 bar', mix: 100 } },
      { name: 'Tape stop every 4', params: { mode: 'Tape stop', len: '4 bars', mix: 100 } },
      { name: 'Trap stutter', params: { mode: 'Stutter 1/16', len: '2 bars', mix: 100 } },
      { name: 'Build-up', params: { mode: 'Build-up roll', len: '4 bars', mix: 100 } },
      { name: 'Chopped & screwed', params: { mode: 'Screw (slow down)', len: '2 bars', mix: 100 } },
      { name: 'DJ rewind', params: { mode: 'Rewind', len: '4 bars', mix: 100 } },
    ],
    create(ctx) {
      let node;
      try { node = worklet(ctx, 'ss-timebend'); } catch (e) { return passthrough(ctx, 'time bender'); }
      const stop = syncTransport(ctx, node);
      const P = (id) => node.parameters.get(id);
      return {
        input: node, output: node,
        setParam(id, v) {
          if (id === 'mode') P('mode').value = Math.max(0, TB_MODES.indexOf(v));
          else if (id === 'len') P('len').value = Math.max(0, ['1/2 bar', '1 bar', '2 bars', '4 bars'].indexOf(v));
          else if (id === 'mix') P('mix').value = v / 100;
        },
        destroy: stop,
      };
    },
  });

  /* ================= Vocoder (Vocodex style) =================
   * Your voice (the modulator) shapes a built-in synth chord (the carrier) through 20 bands. */
  const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const CHORDS = { 'Single note': [0], 'Power (1-5)': [0, 7, 12], 'Major': [0, 4, 7, 12], 'Minor': [0, 3, 7, 12], 'Minor 7': [0, 3, 7, 10], 'Sus 2': [0, 2, 7, 12], 'Octaves': [0, 12, 24] };
  Studio.registerPlugin({
    id: 'ss-vocoder',
    name: 'Session Vocoder',
    category: 'Creative',
    color: '#22d3ee',
    description: 'Robot / Daft Punk voice: your vocal plays a synth chord through 20 bands',
    params: [
      { id: 'key', name: 'Key', type: 'select', options: KEYS, default: 'C' },
      { id: 'chord', name: 'Chord', type: 'select', options: Object.keys(CHORDS), default: 'Minor' },
      { id: 'oct', name: 'Octave', min: 1, max: 5, step: 1, default: 3 },
      { id: 'wave', name: 'Carrier', type: 'select', options: ['Saw', 'Square', 'Saw + noise', 'Whisper (noise)'], default: 'Saw' },
      { id: 'shift', name: 'Formant', unit: 'st', min: -12, max: 12, step: 0.5, default: 0 },
      { id: 'q', name: 'Band width', min: 2, max: 30, step: 0.5, default: 9 },
      { id: 'speed', name: 'Response', unit: 'ms', min: 2, max: 80, step: 1, default: 12 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Carrier', params: ['key', 'chord', 'oct', 'wave'] }, { title: 'Bands', params: ['shift', 'q', 'speed'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: 'Robot choir', params: { key: 'C', chord: 'Minor', oct: 3, wave: 'Saw', shift: 0, q: 9, speed: 12, mix: 100 } },
      { name: 'Daft vocoder', params: { key: 'A', chord: 'Minor 7', oct: 3, wave: 'Saw', shift: 0, q: 12, speed: 8, mix: 100 } },
      { name: 'Monotone robot', params: { key: 'F', chord: 'Single note', oct: 2, wave: 'Square', shift: 0, q: 10, speed: 10, mix: 100 } },
      { name: 'Ghost whisper', params: { key: 'C', chord: 'Single note', oct: 3, wave: 'Whisper (noise)', shift: 2, q: 8, speed: 20, mix: 80 } },
      { name: 'Choir layer', params: { key: 'C', chord: 'Major', oct: 3, wave: 'Saw + noise', shift: 0, q: 9, speed: 14, mix: 45 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const NB = 20, lo = 120, hi = 9000;
      const freqs = Array.from({ length: NB }, (_, i) => lo * Math.pow(hi / lo, i / (NB - 1)));
      // carrier
      const carrier = ctx.createGain(); carrier.gain.value = 0.35;
      let oscs = [];
      const nbuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = nbuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = nbuf; noise.loop = true; const noiseG = ctx.createGain(); noise.connect(noiseG); noiseG.connect(carrier); noise.start();
      // modulator: mono sum of the input
      const mod = ctx.createGain(); mod.channelCount = 1; mod.channelCountMode = 'explicit'; dw.input.connect(mod);
      const rect = new Float32Array(1025); for (let i = 0; i < 1025; i++) rect[i] = Math.abs(i / 512 - 1);
      const out = ctx.createGain(); out.gain.value = 6; out.connect(dw.wet);
      const bands = freqs.map((f) => {
        const mb = ctx.createBiquadFilter(); mb.type = 'bandpass'; mb.frequency.value = f;
        const ws = ctx.createWaveShaper(); ws.curve = rect;
        const env = ctx.createBiquadFilter(); env.type = 'lowpass'; env.frequency.value = 40; env.Q.value = 0.5;
        const cb = ctx.createBiquadFilter(); cb.type = 'bandpass'; cb.frequency.value = f;
        const vca = ctx.createGain(); vca.gain.value = 0;
        mod.connect(mb); mb.connect(ws); ws.connect(env); env.connect(vca.gain);
        carrier.connect(cb); cb.connect(vca); vca.connect(out);
        return { mb, env, cb, f };
      });
      const st = { key: 'C', chord: 'Minor', oct: 3, wave: 'Saw', shift: 0, q: 9, speed: 12, mix: 1 };
      const buildCarrier = () => {
        oscs.forEach((o) => { try { o.stop(); o.disconnect(); } catch (e) {} });
        oscs = [];
        const root = 12 * (st.oct + 1) + KEYS.indexOf(st.key);
        const ivs = st.wave === 'Whisper (noise)' ? [] : CHORDS[st.chord] || [0];
        for (const iv of ivs) {
          const o = ctx.createOscillator(); o.type = st.wave === 'Square' ? 'square' : 'sawtooth';
          o.frequency.value = 440 * Math.pow(2, (root + iv - 69) / 12);
          const g = ctx.createGain(); g.gain.value = 1 / Math.sqrt(ivs.length); o.connect(g); g.connect(carrier); o.start(); oscs.push(o);
        }
        noiseG.gain.value = st.wave === 'Whisper (noise)' ? 1.2 : st.wave === 'Saw + noise' ? 0.25 : 0;
      };
      const apply = () => {
        const sh = Math.pow(2, st.shift / 12);
        bands.forEach((b) => { b.mb.Q.value = st.q; b.cb.Q.value = st.q; b.cb.frequency.value = clamp(b.f * sh, 40, 18000); b.env.frequency.value = 1000 / st.speed / 2; });
        out.gain.value = 11 * Math.sqrt(st.q);
        dw.setMix(st.mix);
      };
      buildCarrier(); apply();
      return {
        input: dw.input, output: dw.output,
        setParam(id, v) {
          st[id] = id === 'mix' ? v / 100 : v;
          if (id === 'key' || id === 'chord' || id === 'oct' || id === 'wave') buildCarrier(); else apply();
        },
        destroy() { oscs.forEach((o) => { try { o.stop(); } catch (e) {} }); try { noise.stop(); } catch (e) {} },
      };
    },
  });

  /* ================= Harmonizer (Pitcher style) ================= */
  const HARMS = { 'Major 3rd + 5th': [4, 7], 'Minor 3rd + 5th': [3, 7], 'Octave up + down': [12, -12], 'Fifth + octave': [7, 12], 'Fourth + fifth': [5, 7], 'Low octave': [-12], 'Thirds (stacked)': [4, -5], 'Choir (5 voices)': [-12, -5, 4, 7, 12] };
  Studio.registerPlugin({
    id: 'ss-harmonizer',
    name: 'Session Harmonizer',
    category: 'Pitch',
    color: '#a78bfa',
    description: 'Instant backing harmonies from one vocal — thirds, fifths, octaves or a whole choir, spread across the stereo field',
    params: [
      { id: 'harm', name: 'Harmony', type: 'select', options: Object.keys(HARMS), default: 'Major 3rd + 5th' },
      { id: 'level', name: 'Harmony level', unit: '%', min: 0, max: 100, step: 1, default: 55 },
      { id: 'spread', name: 'Spread', unit: '%', min: 0, max: 100, step: 1, default: 70 },
      { id: 'humanize', name: 'Humanize', unit: '%', min: 0, max: 100, step: 1, default: 40 },
      { id: 'dry', name: 'Lead level', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Voices', params: ['harm', 'level'] }, { title: 'Character', params: ['spread', 'humanize', 'dry'] }],
    presets: [
      { name: 'Pop harmonies', params: { harm: 'Major 3rd + 5th', level: 55, spread: 70, humanize: 40, dry: 100 } },
      { name: 'Sad minor stack', params: { harm: 'Minor 3rd + 5th', level: 50, spread: 80, humanize: 45, dry: 100 } },
      { name: 'Octave doubles', params: { harm: 'Octave up + down', level: 45, spread: 50, humanize: 30, dry: 100 } },
      { name: 'Gospel choir', params: { harm: 'Choir (5 voices)', level: 60, spread: 100, humanize: 60, dry: 90 } },
      { name: 'Demon voice', params: { harm: 'Low octave', level: 90, spread: 0, humanize: 10, dry: 60 } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wetBus = ctx.createGain();
      input.connect(dry); dry.connect(output); wetBus.connect(output);
      let voices = [];
      const st = { harm: 'Major 3rd + 5th', level: 0.55, spread: 0.7, humanize: 0.4, dry: 1 };
      const build = () => {
        voices.forEach((v) => { try { input.disconnect(v.node); } catch (e) {} Studio.killWorkletNode ? Studio.killWorkletNode(v.node) : v.node.disconnect(); v.pan.disconnect(); });
        voices = [];
        const ivs = HARMS[st.harm] || [4, 7];
        ivs.forEach((iv, i) => {
          let node;
          try { node = new AudioWorkletNode(ctx, 'ss-pitch', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' }); } catch (e) { return; }
          node.parameters.get('semis').value = clamp(iv, -12, 12);
          node.parameters.get('cents').value = (i % 2 ? 1 : -1) * 9 * st.humanize;
          node.parameters.get('grain').value = iv < 0 ? 80 : 55;
          node.parameters.get('mix').value = 1;
          const dl = ctx.createDelay(0.1); dl.delayTime.value = 0.012 + 0.018 * st.humanize * ((i * 7) % 5) / 4;
          const pan = ctx.createStereoPanner(); pan.pan.value = ivs.length === 1 ? 0 : st.spread * (i / (ivs.length - 1) * 2 - 1);
          const g = ctx.createGain(); g.gain.value = 1 / Math.sqrt(ivs.length);
          input.connect(node); node.connect(dl); dl.connect(g); g.connect(pan); pan.connect(wetBus);
          voices.push({ node, pan });
        });
      };
      const apply = () => { wetBus.gain.value = st.level; dry.gain.value = st.dry; };
      build(); apply();
      return {
        input, output,
        setParam(id, v) { st[id] = id === 'harm' ? v : v / 100; if (id === 'harm' || id === 'spread' || id === 'humanize') build(); apply(); },
        destroy() { voices.forEach((v) => Studio.killWorkletNode && Studio.killWorkletNode(v.node)); },
      };
    },
  });

  /* ================= One-Knob Loud (Soundgoodizer style) ================= */
  Studio.registerPlugin({
    id: 'ss-loud',
    name: 'Session One-Knob Loud',
    category: 'Mastering',
    color: '#facc15',
    description: 'One knob that makes anything louder, punchier and brighter (3-band compression + limiter). Four flavours, like Soundgoodizer A–D',
    params: [
      { id: 'mode', name: 'Flavour', type: 'select', options: ['A — clean', 'B — warm', 'C — punchy', 'D — bright'], default: 'A — clean' },
      { id: 'amount', name: 'Amount', unit: '%', min: 0, max: 100, step: 1, default: 50 },
    ],
    layout: [{ title: 'Loud', params: ['mode', 'amount'] }],
    presets: [
      { name: 'Light polish', params: { mode: 'A — clean', amount: 30 } },
      { name: 'Warm & thick', params: { mode: 'B — warm', amount: 55 } },
      { name: 'Punchy drums', params: { mode: 'C — punchy', amount: 65 } },
      { name: 'Bright & loud', params: { mode: 'D — bright', amount: 70 } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain();
      // Linkwitz-Riley-ish 3-way split (2 × 12 dB biquads per edge)
      const xo = (type, f) => { const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(); a.type = b.type = type; a.frequency.value = b.frequency.value = f; a.Q.value = b.Q.value = 0.707; a.connect(b); return [a, b]; };
      const [l1, l2] = xo('lowpass', 200), [m1, m2] = xo('highpass', 200), [m3, m4] = xo('lowpass', 4000), [h1, h2] = xo('highpass', 4000);
      input.connect(l1); input.connect(m1); m2.connect(m3); input.connect(h1);
      const comp = () => { const c = ctx.createDynamicsCompressor(); c.knee.value = 8; return c; };
      const cl = comp(), cm = comp(), ch = comp();
      const gl = ctx.createGain(), gm = ctx.createGain(), gh = ctx.createGain();
      l2.connect(cl); cl.connect(gl); m4.connect(cm); cm.connect(gm); h2.connect(ch); ch.connect(gh);
      const sum = ctx.createGain(); gl.connect(sum); gm.connect(sum); gh.connect(sum);
      const sat = ctx.createWaveShaper(); sat.oversample = '2x';
      const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
      const ceil = ctx.createGain(); ceil.gain.value = 0.94;
      const trim = ctx.createGain();
      sum.connect(trim); trim.connect(sat); sat.connect(lim); lim.connect(ceil); ceil.connect(output);
      const st = { mode: 'A — clean', amount: 0.5 };
      const apply = () => {
        const a = st.amount, m = st.mode[0];
        const tilt = { A: [0, 0, 0], B: [1.5, 0.5, -1], C: [1, 1.5, 0.5], D: [-0.5, 0.5, 2.5] }[m] || [0, 0, 0];
        [[cl, gl, 0], [cm, gm, 1], [ch, gh, 2]].forEach(([c, g, i]) => {
          c.threshold.value = -6 - 22 * a; c.ratio.value = 1.5 + 4 * a; c.attack.value = m === 'C' ? 0.02 : 0.006; c.release.value = m === 'B' ? 0.25 : 0.12;
          g.gain.value = db(6 * a + tilt[i] * a);
        });
        const drive = 1 + (m === 'B' ? 3 : 1.5) * a, cv = new Float32Array(1025);
        for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * drive) / Math.tanh(drive); }
        sat.curve = cv;
        // Web Audio compressors add their own make-up gain, so measure-and-trim: the knob then means
        // 0% = same loudness, 100% ≈ +9 dB louder (measured on a mixed beat at −18 dBFS)
        const MEAS = { A: [4.9, 6.6, 8.4, 9.9, 11.2, 12.2, 13.0, 13.5, 14.0, 14.3, 14.5], B: [4.9, 7.2, 9.4, 11.2, 12.6, 13.6, 14.3, 14.8, 15.2, 15.4, 15.6], C: [5.0, 6.7, 8.6, 10.2, 11.5, 12.6, 13.4, 14.0, 14.4, 14.7, 14.9], D: [4.9, 6.6, 8.4, 9.9, 11.2, 12.1, 12.9, 13.4, 13.8, 14.0, 14.1] }[m] || [];
        const x = a * 10, i0 = Math.min(9, Math.floor(x)), got = MEAS.length ? MEAS[i0] + (MEAS[i0 + 1] - MEAS[i0]) * (x - i0) : 0;
        trim.gain.value = db(9 * a - got);
      };
      apply();
      return { input, output, setParam(id, v) { st[id] = id === 'amount' ? v / 100 : v; apply(); } };
    },
  });

  /* ================= Filter Motion (Love Philter style) ================= */
  const DIVS = { '4 bars': 16, '2 bars': 8, '1 bar': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25 };
  Studio.registerPlugin({
    id: 'ss-filtermotion',
    name: 'Session Filter Motion',
    category: 'Filter',
    color: '#34d399',
    description: 'Moving filter synced to your tempo — sweeps, wobbles, build-up risers and talking filters (Love Philter style)',
    params: [
      { id: 'type', name: 'Filter', type: 'select', options: ['Low-pass', 'High-pass', 'Band-pass', 'Notch', 'Peak'], default: 'Low-pass' },
      { id: 'cutoff', name: 'Cutoff', unit: 'Hz', min: 40, max: 18000, step: 1, default: 1200, scale: 'log' },
      { id: 'res', name: 'Resonance', min: 0.5, max: 20, step: 0.1, default: 6 },
      { id: 'shape', name: 'Motion', type: 'select', options: ['Sine wobble', 'Saw down', 'Saw up', 'Square', 'Triangle'], default: 'Sine wobble' },
      { id: 'div', name: 'Speed', type: 'select', options: Object.keys(DIVS), default: '1/4' },
      { id: 'depth', name: 'Depth', unit: 'oct', min: 0, max: 6, step: 0.1, default: 3 },
      { id: 'drive', name: 'Drive', unit: '%', min: 0, max: 100, step: 1, default: 0 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Filter', params: ['type', 'cutoff', 'res', 'drive'] }, { title: 'Motion', params: ['shape', 'div', 'depth'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: 'Dubstep wobble', params: { type: 'Low-pass', cutoff: 400, res: 9, shape: 'Sine wobble', div: '1/8', depth: 4, drive: 30, mix: 100 } },
      { name: 'Slow sweep', params: { type: 'Low-pass', cutoff: 800, res: 5, shape: 'Triangle', div: '4 bars', depth: 4.5, drive: 0, mix: 100 } },
      { name: 'High-pass riser', params: { type: 'High-pass', cutoff: 120, res: 4, shape: 'Saw up', div: '4 bars', depth: 6, drive: 0, mix: 100 } },
      { name: 'Choppy talk', params: { type: 'Band-pass', cutoff: 900, res: 7, shape: 'Square', div: '1/16', depth: 2, drive: 10, mix: 100 } },
      { name: 'Pluck motion', params: { type: 'Low-pass', cutoff: 600, res: 8, shape: 'Saw down', div: '1/4', depth: 4, drive: 15, mix: 100 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const pre = ctx.createWaveShaper(); pre.oversample = '2x';
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
      const makeup = ctx.createGain();
      dw.input.connect(pre); pre.connect(f1); f1.connect(f2); f2.connect(makeup); makeup.connect(dw.wet);
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.connect(depth); depth.connect(f1.detune); depth.connect(f2.detune);
      lfo.start();
      const st = { type: 'Low-pass', cutoff: 1200, res: 6, shape: 'Sine wobble', div: '1/4', depth: 3, drive: 0, mix: 1 };
      const apply = () => {
        const t = { 'Low-pass': 'lowpass', 'High-pass': 'highpass', 'Band-pass': 'bandpass', 'Notch': 'notch', 'Peak': 'peaking' }[st.type];
        [f1, f2].forEach((f, i) => { f.type = t; f.frequency.value = st.cutoff; f.Q.value = i ? 0.707 : st.res; f.gain.value = t === 'peaking' ? 12 : 0; });
        if (t === 'peaking' || t === 'notch') f2.type = 'allpass';
        // keep the level steady: resonant peaks get turned down, thin band-pass/peak types get turned up
        makeup.gain.value = (t === 'bandpass' ? 2.2 : t === 'peaking' ? 0.55 : 1) / (1 + 0.06 * Math.max(0, st.res - 1)) / (1 + st.drive * 0.6);
        const shapes = { 'Sine wobble': 'sine', 'Square': 'square', 'Triangle': 'triangle', 'Saw up': 'sawtooth', 'Saw down': 'sawtooth' };
        lfo.type = shapes[st.shape] || 'sine';
        lfo.frequency.value = (bpm() / 60) / DIVS[st.div];
        depth.gain.value = (st.shape === 'Saw down' ? -1 : 1) * st.depth * 600;   // cents (±)
        const d = 1 + st.drive * 6, cv = new Float32Array(1025);
        for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * d) / Math.tanh(d); }
        pre.curve = cv;
        dw.setMix(st.mix);
      };
      apply();
      const stop = listen(['tempo-changed', 'project-replaced'], apply);
      return {
        input: dw.input, output: dw.output,
        setParam(id, v) { st[id] = id === 'drive' || id === 'mix' ? v / 100 : v; apply(); },
        destroy() { stop(); try { lfo.stop(); } catch (e) {} },
      };
    },
  });

  /* ================= Frequency Shifter ================= */
  Studio.registerWorklet('ss-fshift', `
    class SsFShift extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [${k('shift', 0, -2000, 2000)}, ${k('fb', 0, 0, 0.9)}, ${k('mix', 1, 0, 1)}, ${k('wide', 0, 0, 1)}]; }
      constructor() {
        super();
        // 90° phase-difference network: two cascades of 4 first-order-in-z² allpass sections
        // (Olli Niemitalo's coefficients). Branch B is delayed one sample so the pair lines up.
        this.A = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map((c) => c * c);
        this.B = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map((c) => c * c);
        this.st = [0, 1].map(() => ({ a: new Float64Array(16), b: new Float64Array(16), d: 0, fb: 0 }));
        this.ph = 0;
      }
      chain(s, cs, x) { // y[n] = c*(x[n] + y[n-2]) - x[n-2]
        let v = x;
        for (let k = 0; k < 4; k++) {
          const o = k * 4, x1 = s[o], x2 = s[o + 1], y1 = s[o + 2], y2 = s[o + 3];
          const y = cs[k] * (v + y2) - x2;
          s[o + 1] = x1; s[o] = v; s[o + 3] = y1; s[o + 2] = y;
          v = y;
        }
        return v;
      }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0];
        if (!inp || !inp.length) return true;
        const n = inp[0].length, fb = p.fb[0], mix = p.mix[0], wide = p.wide[0] > 0.5;
        const inc = 2 * Math.PI * p.shift[0] / sampleRate;
        for (let i = 0; i < n; i++) {
          this.ph += inc; if (this.ph > Math.PI) this.ph -= 2 * Math.PI; else if (this.ph < -Math.PI) this.ph += 2 * Math.PI;
          const co = Math.cos(this.ph), si = Math.sin(this.ph);
          for (let c = 0; c < out.length; c++) {
            const x = inp[c < inp.length ? c : inp.length - 1][i];
            const s = this.st[c];
            const xin = x + s.fb * fb;
            const re = this.chain(s.a, this.A, xin);
            const imNow = this.chain(s.b, this.B, xin), im = s.d; s.d = imNow;
            // upper sideband = shift up; on the right side flip it in "opposite" mode
            const y = c === 1 && wide ? re * co - im * si : re * co + im * si;
            s.fb = y;
            out[c][i] = x * (1 - mix) + y * mix;
          }
        }
        return true;
      }
    }
    registerProcessor('ss-fshift', SsFShift);`);
  Studio.registerPlugin({
    id: 'ss-freqshift',
    name: 'Session Frequency Shifter',
    category: 'Creative',
    color: '#818cf8',
    description: 'Shifts every frequency by the same number of Hz — metallic, alien and barber-pole effects, or a tiny shift for width',
    params: [
      { id: 'shift', name: 'Shift', unit: 'Hz', min: -2000, max: 2000, step: 0.1, default: 0 },
      { id: 'fb', name: 'Feedback', unit: '%', min: 0, max: 90, step: 1, default: 0 },
      { id: 'wide', name: 'Stereo', type: 'select', options: ['Same both sides', 'Opposite sides'], default: 'Same both sides' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Shift', params: ['shift', 'fb'] }, { title: 'Output', params: ['wide', 'mix'] }],
    presets: [
      { name: 'Subtle width', params: { shift: 3, fb: 0, wide: 'Opposite sides', mix: 40 } },
      { name: 'Alien voice', params: { shift: 220, fb: 0, wide: 'Same both sides', mix: 100 } },
      { name: 'Barber pole', params: { shift: 0.6, fb: 70, wide: 'Opposite sides', mix: 60 } },
      { name: 'Metal clang', params: { shift: -380, fb: 30, wide: 'Same both sides', mix: 70 } },
    ],
    create(ctx) {
      let node;
      try { node = worklet(ctx, 'ss-fshift'); } catch (e) { return passthrough(ctx, 'frequency shifter'); }
      const P = (id) => node.parameters.get(id);
      return { input: node, output: node, setParam(id, v) { if (id === 'wide') P('wide').value = v === 'Opposite sides' ? 1 : 0; else if (!P(id)) return; else if (id === 'fb' || id === 'mix') P(id).value = v / 100; else P(id).value = v; } };
    },
  });

  /* ================= Stereo Shaper ================= */
  Studio.registerPlugin({
    id: 'ss-stereo',
    name: 'Session Stereo Shaper',
    category: 'Utility',
    color: '#60a5fa',
    description: 'Width, mid/side balance, mono bass, Haas widening, pan, swap and phase flip — everything about the stereo image in one place',
    params: [
      { id: 'width', name: 'Width', unit: '%', min: 0, max: 200, step: 1, default: 100 },
      { id: 'monobass', name: 'Mono below', unit: 'Hz', min: 0, max: 400, step: 1, default: 0 },
      { id: 'haas', name: 'Haas widen', unit: 'ms', min: 0, max: 30, step: 0.1, default: 0 },
      { id: 'pan', name: 'Pan', min: -100, max: 100, step: 1, default: 0 },
      { id: 'mode', name: 'Channels', type: 'select', options: ['Stereo', 'Swap L/R', 'Mono', 'Flip phase (L)', 'Left only', 'Right only'], default: 'Stereo' },
      { id: 'level', name: 'Level', unit: 'dB', min: -24, max: 12, step: 0.1, default: 0 },
    ],
    layout: [{ title: 'Image', params: ['width', 'monobass', 'haas'] }, { title: 'Channels', params: ['pan', 'mode', 'level'] }],
    presets: [
      { name: 'Wide chorus vocal', params: { width: 150, monobass: 0, haas: 0, pan: 0, mode: 'Stereo', level: 0 } },
      { name: 'Tight low end', params: { width: 110, monobass: 150, haas: 0, pan: 0, mode: 'Stereo', level: 0 } },
      { name: 'Haas double', params: { width: 100, monobass: 0, haas: 14, pan: 0, mode: 'Stereo', level: 0 } },
      { name: 'Mono check', params: { width: 0, monobass: 0, haas: 0, pan: 0, mode: 'Mono', level: 0 } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain();
      input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
      const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
      input.connect(sp);
      // M = (L+R)/2, S = (L-R)/2
      const mL = ctx.createGain(), mR = ctx.createGain(), sL = ctx.createGain(), sR = ctx.createGain();
      mL.gain.value = 0.5; mR.gain.value = 0.5; sL.gain.value = 0.5; sR.gain.value = -0.5;
      const M = ctx.createGain(), Sd = ctx.createGain();
      sp.connect(mL, 0); sp.connect(mR, 1); sp.connect(sL, 0); sp.connect(sR, 1);
      mL.connect(M); mR.connect(M); sL.connect(Sd); sR.connect(Sd);
      // mono bass: Linkwitz-Riley crossover — side keeps only the highs, mid goes through the matching all-pass,
      // so above the crossover mid and side stay in phase and the stereo balance doesn't shift
      const bq = (type) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = 10; f.Q.value = 0.707; return f; };
      const xo = [bq('highpass'), bq('highpass'), bq('lowpass'), bq('lowpass'), bq('highpass'), bq('highpass')];
      const [sh1, sh2, ml1, ml2, mh1, mh2] = xo;
      const sW = ctx.createGain(); Sd.connect(sh1); sh1.connect(sh2); sh2.connect(sW);
      const Mx = ctx.createGain(); M.connect(ml1); ml1.connect(ml2); ml2.connect(Mx); M.connect(mh1); mh1.connect(mh2); mh2.connect(Mx);
      const haas = ctx.createDelay(0.05);
      // L = M + S, R = M - S (R side through the Haas delay)
      const toL = ctx.createGain(), toR = ctx.createGain(), sNeg = ctx.createGain(); sNeg.gain.value = -1;
      Mx.connect(toL); sW.connect(toL); Mx.connect(haas); haas.connect(toR); sW.connect(sNeg); sNeg.connect(toR);
      const gL = ctx.createGain(), gR = ctx.createGain(), xL = ctx.createGain(), xR = ctx.createGain();
      toL.connect(gL); toR.connect(gR); toL.connect(xR); toR.connect(xL);
      gL.connect(mg, 0, 0); xL.connect(mg, 0, 0); gR.connect(mg, 0, 1); xR.connect(mg, 0, 1);
      const lvl = ctx.createGain(); mg.connect(lvl); lvl.connect(output);
      const st = { width: 1, monobass: 0, haas: 0, pan: 0, mode: 'Stereo', level: 0 };
      const apply = () => {
        sW.gain.value = st.mode === 'Mono' ? 0 : st.width;
        xo.forEach((f) => (f.frequency.value = Math.max(10, st.monobass)));
        haas.delayTime.value = st.haas / 1000;
        const p = st.pan / 100, l = Math.min(1, 1 - p), r = Math.min(1, 1 + p);
        let a = [l, 0, 0, r];                                   // gL, xL(R→L), xR(L→R), gR
        if (st.mode === 'Swap L/R') a = [0, l, r, 0];
        if (st.mode === 'Flip phase (L)') a = [-l, 0, 0, r];
        if (st.mode === 'Left only') a = [l, 0, l, 0];
        if (st.mode === 'Right only') a = [0, r, 0, r];
        [gL.gain.value, xL.gain.value, xR.gain.value, gR.gain.value] = a;
        lvl.gain.value = db(st.level);
      };
      apply();
      return { input, output, setParam(id, v) { st[id] = id === 'width' ? v / 100 : v; apply(); } };
    },
  });

  /* ================= Space Verb (convolution reverb with built-in spaces) ================= */
  const SPACES = ['Studio room', 'Vocal plate', 'Concert hall', 'Cathedral', 'Spring', 'Small booth', 'Reverse swell'];
  function makeIR(ctx, type, size, decay, tone) {
    const sr = ctx.sampleRate;
    const base = { 'Studio room': [0.9, 0.5], 'Vocal plate': [2.2, 1.2], 'Concert hall': [3.2, 2.0], 'Cathedral': [6.5, 4.5], 'Spring': [2.0, 1.0], 'Small booth': [0.35, 0.18], 'Reverse swell': [2.5, 1.5] }[type] || [2, 1.2];
    const len = Math.max(0.15, base[0] * size), dec = Math.max(0.05, base[1] * decay);
    const n = Math.floor(len * sr), ir = ctx.createBuffer(2, n, sr);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let e = Math.exp(-t * 6.9 / dec);
        if (type === 'Reverse swell') e = Math.pow(t / len, 2) * Math.exp(-(len - t) * 30);
        let x = rnd() * e;
        if (type === 'Spring') x *= 1 + 0.6 * Math.sin(2 * Math.PI * 7 * t) * Math.sin(2 * Math.PI * (900 + 300 * Math.sin(t * 40)) * t);
        const fc = (1500 + 14000 * tone) * Math.exp(-t / Math.max(0.05, dec) * 1.2) + 250;
        const damp = Math.exp(-2 * Math.PI * fc / sr);
        lp = x * (1 - damp) + lp * damp;
        d[i] = lp;
      }
      // early reflections for rooms
      if (type === 'Studio room' || type === 'Small booth' || type === 'Concert hall') {
        const taps = type === 'Concert hall' ? [0.019, 0.031, 0.043, 0.061, 0.077] : [0.007, 0.011, 0.017, 0.023, 0.029];
        taps.forEach((tp, j) => { const i = Math.floor(tp * size * sr * (c ? 1.07 : 1)); if (i < n) d[i] += (j % 2 ? -1 : 1) * 0.5 / (j + 1); });
      }
    }
    // normalise energy so every space sits at a similar level
    let s = 0; for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) s += d[i] * d[i]; }
    const g = 0.35 / Math.sqrt(s / 2 + 1e-9); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= g; }
    return ir;
  }
  Studio.registerPlugin({
    id: 'ss-spaceverb',
    name: 'Session Space Verb',
    category: 'Reverb',
    color: '#93c5fd',
    description: 'Convolution reverb with real-sounding spaces: room, plate, hall, cathedral, spring, booth and a reverse swell',
    params: [
      { id: 'space', name: 'Space', type: 'select', options: SPACES, default: 'Vocal plate' },
      { id: 'size', name: 'Size', unit: '%', min: 25, max: 200, step: 1, default: 100 },
      { id: 'decay', name: 'Decay', unit: '%', min: 25, max: 200, step: 1, default: 100 },
      { id: 'tone', name: 'Brightness', unit: '%', min: 0, max: 100, step: 1, default: 55 },
      { id: 'predelay', name: 'Pre-delay', unit: 'ms', min: 0, max: 150, step: 1, default: 20 },
      { id: 'lowcut', name: 'Low cut', unit: 'Hz', min: 20, max: 800, step: 1, default: 150, scale: 'log' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 25 },
    ],
    layout: [{ title: 'Space', params: ['space', 'size', 'decay'] }, { title: 'Tone', params: ['tone', 'predelay', 'lowcut'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: 'Vocal plate', params: { space: 'Vocal plate', size: 100, decay: 90, tone: 60, predelay: 25, lowcut: 180, mix: 22 } },
      { name: 'Big hall', params: { space: 'Concert hall', size: 120, decay: 110, tone: 50, predelay: 30, lowcut: 150, mix: 28 } },
      { name: 'Cathedral wash', params: { space: 'Cathedral', size: 140, decay: 140, tone: 45, predelay: 40, lowcut: 200, mix: 35 } },
      { name: 'Tight room', params: { space: 'Studio room', size: 80, decay: 70, tone: 55, predelay: 5, lowcut: 120, mix: 18 } },
      { name: 'Surf spring', params: { space: 'Spring', size: 100, decay: 100, tone: 60, predelay: 0, lowcut: 250, mix: 30 } },
      { name: 'Reverse swell', params: { space: 'Reverse swell', size: 100, decay: 100, tone: 55, predelay: 0, lowcut: 200, mix: 40 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const pre = ctx.createDelay(0.2), lc = ctx.createBiquadFilter(), conv = ctx.createConvolver();
      lc.type = 'highpass'; lc.Q.value = 0.707;
      dw.input.connect(pre); pre.connect(lc); lc.connect(conv); conv.connect(dw.wet);
      const st = { space: 'Vocal plate', size: 1, decay: 1, tone: 0.55, predelay: 20, lowcut: 150, mix: 0.25 };
      let irKey = '';
      const apply = () => {
        const key = [st.space, st.size, st.decay, st.tone].join('|');
        if (key !== irKey) { irKey = key; conv.buffer = makeIR(ctx, st.space, st.size, st.decay, st.tone); }
        pre.delayTime.value = st.predelay / 1000; lc.frequency.value = st.lowcut; dw.setMix(st.mix);
      };
      apply();
      return { input: dw.input, output: dw.output, setParam(id, v) { st[id] = ['size', 'decay', 'tone', 'mix'].includes(id) ? v / 100 : v; apply(); } };
    },
  });
})();
