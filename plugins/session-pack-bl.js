/* Session plugin pack 1 — the effects BandLab has that Session didn't:
 * Opto Compressor (BA-2A style), Graphic EQ, Tremolo, Auto-Wah, Amp (overdrive / distortion / fuzz + cabinet),
 * Rotary Speaker, Ring Modulator and Octaver. All Web Audio / AudioWorklet, so they run on Windows, Mac and
 * Android and sound the same live and in exports (no timers: modulation runs on the audio clock). */
(function () {
  const Studio = window.Studio;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const db = (x) => Math.pow(10, x / 20);
  const k = (name, def, min, max) => `{ name: '${name}', defaultValue: ${def}, minValue: ${min}, maxValue: ${max}, automationRate: 'k-rate' }`;
  const passthrough = (ctx, why) => { console.warn('[' + why + '] worklet unavailable, passing audio through'); const g = ctx.createGain(); return { input: g, output: g, setParam() {}, destroy() {} }; };
  const dryWet = (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    input.connect(dry); dry.connect(output); wet.connect(output);
    const setMix = (m) => { dry.gain.value = Math.cos((m * Math.PI) / 2); wet.gain.value = Math.sin((m * Math.PI) / 2); };
    return { input, output, wet, setMix };
  };
  const worklet = (ctx, name) => new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });

  /* ================= Opto Compressor (BA-2A / LA-2A style) =================
   * Smooth optical cell: soft knee, gentle ratio, and the famous two-stage release (fast at first,
   * then slow), so vocals sit forward without pumping. Two knobs, like the original. */
  Studio.registerWorklet('ss-opto', `
    class SsOpto extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [${k('peak', 40, 0, 100)}, ${k('gain', 0, 0, 40)}, ${k('limit', 0, 0, 1)}, ${k('mix', 1, 0, 1)}, ${k('emph', 0, 0, 1)}]; }
      constructor() { super(); this.env = 0; this.fast = 0; this.slow = 0; this.hp = [0, 0]; this.hx = [0, 0]; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0];
        if (!inp || !inp.length) return true;
        const n = inp[0].length, L = inp[0], R = inp[1] || inp[0];
        const thr = -p.peak[0] * 0.42;                       // 0..100 -> 0..-42 dB
        const ratio = p.limit[0] > 0.5 ? 12 : 3.2, knee = 10;
        const mk = Math.pow(10, p.gain[0] / 20), mix = p.mix[0], emph = p.emph[0];
        const aAtt = Math.exp(-1 / (0.010 * sampleRate));
        const aFast = Math.exp(-1 / (0.06 * sampleRate)), aSlow = Math.exp(-1 / (1.6 * sampleRate));
        const hpA = Math.exp(-2 * Math.PI * 1200 / sampleRate);
        for (let i = 0; i < n; i++) {
          const l = L[i], r = R[i];
          // side-chain: optional high-frequency emphasis (the "R37" mod) so bright, sibilant parts compress more
          let sc = Math.max(Math.abs(l), Math.abs(r));
          if (emph > 0) { const m = (l + r) * 0.5; const h = m - this.hx[0]; this.hx[0] = m * (1 - hpA) + this.hx[0] * hpA; sc = sc * (1 - emph * 0.5) + Math.abs(h) * emph * 1.5; }
          const lv = 20 * Math.log10(sc + 1e-9);
          const over = lv - thr;
          let gr = 0;
          if (over > knee / 2) gr = over * (1 - 1 / ratio);
          else if (over > -knee / 2) gr = (1 - 1 / ratio) * (over + knee / 2) * (over + knee / 2) / (2 * knee);
          // two-stage optical release
          if (gr > this.fast) this.fast = gr + (this.fast - gr) * aAtt; else this.fast = gr + (this.fast - gr) * aFast;
          if (gr > this.slow) this.slow = gr + (this.slow - gr) * aAtt; else this.slow = gr + (this.slow - gr) * aSlow;
          const g = Math.pow(10, -(0.55 * this.fast + 0.45 * this.slow) / 20) * mk;
          this.env = 0.55 * this.fast + 0.45 * this.slow;
          for (let c = 0; c < out.length; c++) {
            const x = c === 0 ? l : r;
            let y = x * g;
            y = y - 0.04 * y * y * y;                            // a touch of tube colour
            out[c][i] = x * (1 - mix) + y * mix;
          }
        }
        return true;
      }
    }
    registerProcessor('ss-opto', SsOpto);`);
  Studio.registerPlugin({
    id: 'ss-opto',
    name: 'Session Opto Comp',
    category: 'Dynamics',
    color: '#f5d0a9',
    description: 'Classic optical leveling amp (BA-2A / LA-2A style): two knobs, silky vocals that sit right up front',
    params: [
      { id: 'peak', name: 'Peak reduction', min: 0, max: 100, step: 1, default: 40 },
      { id: 'gain', name: 'Gain', unit: 'dB', min: 0, max: 40, step: 0.5, default: 6 },
      { id: 'mode', name: 'Mode', type: 'select', options: ['Compress', 'Limit'], default: 'Compress' },
      { id: 'emph', name: 'HF emphasis', unit: '%', min: 0, max: 100, step: 1, default: 0 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Opto', params: ['peak', 'gain', 'mode'] }, { title: 'Extra', params: ['emph', 'mix'] }],
    presets: [
      { name: 'Vocal leveler', params: { peak: 45, gain: 8, mode: 'Compress', emph: 0, mix: 100 } },
      { name: 'Smash & blend', params: { peak: 80, gain: 16, mode: 'Limit', emph: 0, mix: 45 } },
      { name: 'Bass glue', params: { peak: 35, gain: 5, mode: 'Compress', emph: 0, mix: 100 } },
      { name: 'Bright vocal tame', params: { peak: 50, gain: 9, mode: 'Compress', emph: 60, mix: 100 } },
    ],
    create(ctx) {
      let node;
      try { node = worklet(ctx, 'ss-opto'); } catch (e) { return passthrough(ctx, 'opto'); }
      const set = (id, v) => { const p = node.parameters.get(id); if (p) p.value = v; };
      return {
        input: node, output: node,
        setParam(id, v) {
          if (id === 'mode') set('limit', v === 'Limit' ? 1 : 0);
          else if (id === 'mix' || id === 'emph') set(id, v / 100);
          else set(id, v);
        },
      };
    },
  });

  /* ================= Graphic EQ (10 band) ================= */
  const GEQ = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const gLabel = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));
  Studio.registerPlugin({
    id: 'ss-geq',
    name: 'Session Graphic EQ',
    category: 'EQ',
    color: '#e8e2d0',
    description: '10 sliders, one per octave — the quick way to shape a sound by ear',
    params: [
      ...GEQ.map((f) => ({ id: 'b' + f, name: gLabel(f), unit: 'dB', min: -12, max: 12, step: 0.1, default: 0 })),
      { id: 'q', name: 'Width', min: 0.5, max: 3, step: 0.05, default: 1.4 },
      { id: 'level', name: 'Level', unit: 'dB', min: -12, max: 12, step: 0.1, default: 0 },
    ],
    layout: [{ title: 'Low', params: ['b31', 'b63', 'b125', 'b250', 'b500'] }, { title: 'High', params: ['b1000', 'b2000', 'b4000', 'b8000', 'b16000'] }, { title: 'Output', params: ['q', 'level'] }],
    presets: [
      { name: 'Vocal presence', params: { b125: -2, b250: -2, b500: -1, b2000: 1.5, b4000: 3, b8000: 2.5, b16000: 2 } },
      { name: 'Smile', params: { b31: 3, b63: 3, b125: 1, b500: -2, b1000: -2, b2000: -1, b8000: 2, b16000: 3 } },
      { name: 'Telephone', params: { b31: -12, b63: -12, b125: -10, b250: -4, b1000: 4, b2000: 3, b4000: -6, b8000: -12, b16000: -12 } },
      { name: 'Mud cut', params: { b250: -4, b500: -2.5 } },
      { name: 'Air', params: { b8000: 2.5, b16000: 4.5 } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain();
      const bands = GEQ.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === GEQ.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = i === 0 ? 45 : i === GEQ.length - 1 ? 11000 : f; b.Q.value = 1.4; b.gain.value = 0;
        return b;
      });
      let node = input; for (const b of bands) { node.connect(b); node = b; } node.connect(output);
      return {
        input, output,
        setParam(id, v) {
          if (id === 'level') output.gain.value = db(v);
          else if (id === 'q') bands.forEach((b, i) => { if (b.type === 'peaking') b.Q.value = v; });
          else { const i = GEQ.indexOf(+id.slice(1)); if (i >= 0) bands[i].gain.value = v; }
        },
      };
    },
  });

  /* ================= Tremolo ================= */
  Studio.registerPlugin({
    id: 'ss-tremolo',
    name: 'Session Tremolo',
    category: 'Modulation',
    color: '#a3e635',
    description: 'Volume wobble — vintage amp shimmer, choppy trance gate, or a slow stereo pulse',
    params: [
      { id: 'rate', name: 'Rate', unit: 'Hz', min: 0.1, max: 20, step: 0.01, default: 5, scale: 'log' },
      { id: 'depth', name: 'Depth', unit: '%', min: 0, max: 100, step: 1, default: 60 },
      { id: 'shape', name: 'Shape', type: 'select', options: ['Smooth', 'Triangle', 'Choppy'], default: 'Smooth' },
      { id: 'stereo', name: 'Stereo', unit: '°', min: 0, max: 180, step: 1, default: 0 },
    ],
    layout: [{ title: 'Tremolo', params: ['rate', 'depth'] }, { title: 'Character', params: ['shape', 'stereo'] }],
    presets: [
      { name: 'Vintage amp', params: { rate: 5.5, depth: 55, shape: 'Smooth', stereo: 0 } },
      { name: 'Trance chop', params: { rate: 8, depth: 100, shape: 'Choppy', stereo: 0 } },
      { name: 'Stereo pulse', params: { rate: 2, depth: 70, shape: 'Smooth', stereo: 180 } },
      { name: 'Helicopter', params: { rate: 14, depth: 90, shape: 'Triangle', stereo: 40 } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain();
      const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
      input.channelCount = 2; input.channelCountMode = 'explicit';
      input.connect(split);
      const vca = [0, 1].map((c) => { const g = ctx.createGain(); split.connect(g, c); g.connect(merge, 0, c); return g; });
      merge.connect(output);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5;
      const shaper = ctx.createWaveShaper();          // shapes the LFO: smooth / triangle / choppy (soft square)
      const depthL = ctx.createGain(), depthR = ctx.createGain(), phase = ctx.createDelay(5);
      lfo.connect(shaper); shaper.connect(depthL); shaper.connect(phase); phase.connect(depthR);
      depthL.connect(vca[0].gain); depthR.connect(vca[1].gain);
      lfo.start();
      const st = { rate: 5, depth: 0.6, shape: 'Smooth', stereo: 0 };
      const curve = (shape) => {
        const c = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = shape === 'Choppy' ? Math.tanh(x * 6) / Math.tanh(6) : x; }
        return c;
      };
      const apply = () => {
        lfo.type = st.shape === 'Triangle' ? 'triangle' : st.shape === 'Choppy' ? 'square' : 'sine';
        shaper.curve = curve(st.shape);
        lfo.frequency.value = st.rate;
        const d = st.depth / 2;
        vca.forEach((g) => (g.gain.value = 1 - d));
        depthL.gain.value = d; depthR.gain.value = d;
        phase.delayTime.value = clamp(st.stereo / 360 / st.rate, 0, 4.9);
      };
      apply();
      return {
        input, output,
        setParam(id, v) { st[id] = id === 'depth' ? v / 100 : v; apply(); },
        destroy() { try { lfo.stop(); } catch (e) {} },
      };
    },
  });

  /* ================= Auto-Wah / Envelope filter ================= */
  Studio.registerWorklet('ss-autowah', `
    class SsWah extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [${k('sens', 60, 0, 100)}, ${k('lo', 350, 80, 2000)}, ${k('hi', 2600, 300, 8000)}, ${k('q', 5, 0.7, 15)}, ${k('att', 8, 1, 100)}, ${k('rel', 120, 10, 1000)}, ${k('lp', 0, 0, 1)}, ${k('down', 0, 0, 1)}, ${k('mix', 1, 0, 1)}]; }
      constructor() { super(); this.env = 0; this.s = [[0, 0], [0, 0]]; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0];
        if (!inp || !inp.length) return true;
        const n = inp[0].length;
        const aA = Math.exp(-1 / (p.att[0] / 1000 * sampleRate)), aR = Math.exp(-1 / (p.rel[0] / 1000 * sampleRate));
        const sens = p.sens[0] / 100, lo = p.lo[0], hi = Math.max(lo + 50, p.hi[0]), q = p.q[0], mix = p.mix[0], lp = p.lp[0] > 0.5, down = p.down[0] > 0.5;
        const damp = 1 / q;
        for (let i = 0; i < n; i++) {
          let a = 0; for (let c = 0; c < inp.length; c++) a = Math.max(a, Math.abs(inp[c][i]));
          this.env = a > this.env ? a + (this.env - a) * aA : a + (this.env - a) * aR;
          let e = Math.min(1, this.env * (1 + sens * 30) * sens);
          if (down) e = 1 - e;
          const fc = lo * Math.pow(hi / lo, e);
          const f = 2 * Math.sin(Math.PI * Math.min(fc, sampleRate / 6) / sampleRate);
          for (let c = 0; c < out.length; c++) {
            const x = inp[c < inp.length ? c : inp.length - 1][i];
            const st = this.s[c];
            // Chamberlin state-variable filter
            const low = st[1] + f * st[0];
            const high = x - low - damp * st[0];
            const band = f * high + st[0];
            st[0] = band; st[1] = low;
            const y = lp ? low : band * 1.3;
            out[c][i] = x * (1 - mix) + y * mix;
          }
        }
        return true;
      }
    }
    registerProcessor('ss-autowah', SsWah);`);
  Studio.registerPlugin({
    id: 'ss-autowah',
    name: 'Session Auto-Wah',
    category: 'Filter',
    color: '#f97316',
    description: 'Envelope filter that opens as you play or sing louder — funk guitar quack, talky synths, wah vocals',
    params: [
      { id: 'sens', name: 'Sensitivity', unit: '%', min: 0, max: 100, step: 1, default: 60 },
      { id: 'lo', name: 'From', unit: 'Hz', min: 80, max: 2000, step: 1, default: 350, scale: 'log' },
      { id: 'hi', name: 'To', unit: 'Hz', min: 300, max: 8000, step: 1, default: 2600, scale: 'log' },
      { id: 'q', name: 'Resonance', min: 0.7, max: 15, step: 0.1, default: 5 },
      { id: 'att', name: 'Attack', unit: 'ms', min: 1, max: 100, step: 1, default: 8 },
      { id: 'rel', name: 'Release', unit: 'ms', min: 10, max: 1000, step: 1, default: 120, scale: 'log' },
      { id: 'type', name: 'Filter', type: 'select', options: ['Band (wah)', 'Low-pass'], default: 'Band (wah)' },
      { id: 'dir', name: 'Direction', type: 'select', options: ['Up', 'Down'], default: 'Up' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Envelope', params: ['sens', 'att', 'rel', 'dir'] }, { title: 'Filter', params: ['lo', 'hi', 'q', 'type'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: 'Funk quack', params: { sens: 70, lo: 300, hi: 2400, q: 7, att: 5, rel: 90, type: 'Band (wah)', dir: 'Up', mix: 100 } },
      { name: 'Synth sweep', params: { sens: 55, lo: 200, hi: 5000, q: 9, att: 15, rel: 300, type: 'Low-pass', dir: 'Up', mix: 100 } },
      { name: 'Talky vocal', params: { sens: 50, lo: 500, hi: 2200, q: 4, att: 10, rel: 150, type: 'Band (wah)', dir: 'Up', mix: 50 } },
      { name: 'Reverse wah', params: { sens: 65, lo: 300, hi: 2600, q: 6, att: 8, rel: 140, type: 'Band (wah)', dir: 'Down', mix: 100 } },
    ],
    create(ctx) {
      let node;
      try { node = worklet(ctx, 'ss-autowah'); } catch (e) { return passthrough(ctx, 'auto-wah'); }
      const set = (id, v) => { const p = node.parameters.get(id); if (p) p.value = v; };
      return {
        input: node, output: node,
        setParam(id, v) {
          if (id === 'type') set('lp', v === 'Low-pass' ? 1 : 0);
          else if (id === 'dir') set('down', v === 'Down' ? 1 : 0);
          else if (id === 'mix') set('mix', v / 100);
          else set(id, v);
        },
      };
    },
  });

  /* ================= Amp: overdrive / distortion / fuzz + cabinet ================= */
  const AMP_CURVES = {
    Overdrive: (x) => (x >= 0 ? Math.tanh(x) : Math.tanh(x * 0.8) / 0.8 * 0.95),            // soft, asymmetric (even harmonics)
    Distortion: (x) => Math.max(-0.9, Math.min(0.9, x)) / 0.9 * 0.98 + 0.02 * Math.tanh(x * 4), // hard clip
    Fuzz: (x) => Math.sign(x) * (1 - Math.exp(-Math.abs(x) * 3)) * (x > 0 ? 1 : 0.7),        // gated, spitty
    Tube: (x) => Math.tanh(x + 0.18 * x * x),                                                    // warm, round
  };
  Studio.registerPlugin({
    id: 'ss-amp',
    name: 'Session Amp',
    category: 'Distortion',
    color: '#ef4444',
    description: 'Overdrive, distortion, fuzz and tube drive with tone, mids and a speaker cabinet — guitars, 808s, gritty vocals',
    params: [
      { id: 'type', name: 'Type', type: 'select', options: ['Overdrive', 'Tube', 'Distortion', 'Fuzz'], default: 'Overdrive' },
      { id: 'drive', name: 'Drive', unit: 'dB', min: 0, max: 48, step: 0.5, default: 18 },
      { id: 'tone', name: 'Tone', unit: '%', min: 0, max: 100, step: 1, default: 55 },
      { id: 'mid', name: 'Mids', unit: 'dB', min: -12, max: 12, step: 0.5, default: 0 },
      { id: 'cab', name: 'Cabinet', type: 'select', options: ['Off', 'Combo 1x12', 'Stack 4x12', 'Radio'], default: 'Off' },
      { id: 'level', name: 'Level', unit: 'dB', min: -24, max: 6, step: 0.5, default: -6 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Amp', params: ['type', 'drive', 'tone', 'mid'] }, { title: 'Output', params: ['cab', 'level', 'mix'] }],
    presets: [
      { name: 'Crunchy guitar', params: { type: 'Overdrive', drive: 22, tone: 55, mid: 3, cab: 'Combo 1x12', level: -14, mix: 100 } },
      { name: 'Metal stack', params: { type: 'Distortion', drive: 38, tone: 60, mid: -4, cab: 'Stack 4x12', level: -12, mix: 100 } },
      { name: 'Distorted 808', params: { type: 'Tube', drive: 16, tone: 45, mid: 2, cab: 'Off', level: -6, mix: 70 } },
      { name: 'Fuzz vocal', params: { type: 'Fuzz', drive: 20, tone: 50, mid: 4, cab: 'Radio', level: -10, mix: 45 } },
      { name: 'Old radio', params: { type: 'Tube', drive: 10, tone: 40, mid: 6, cab: 'Radio', level: -11, mix: 100 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const pre = ctx.createBiquadFilter(); pre.type = 'highpass'; pre.frequency.value = 40;
      const driveG = ctx.createGain(), sh = ctx.createWaveShaper(); sh.oversample = '4x';
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 800; mid.Q.value = 0.8;
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.6;
      const cab1 = ctx.createBiquadFilter(), cab2 = ctx.createBiquadFilter(), cab3 = ctx.createBiquadFilter();
      const level = ctx.createGain();
      const dcb = ctx.createBiquadFilter(); dcb.type = 'highpass'; dcb.frequency.value = 25; // removes the DC the asymmetric curves make
      dw.input.connect(pre); pre.connect(driveG); driveG.connect(sh); sh.connect(dcb); dcb.connect(mid); mid.connect(tone);
      tone.connect(cab1); cab1.connect(cab2); cab2.connect(cab3); cab3.connect(level); level.connect(dw.wet);
      const st = { type: 'Overdrive', drive: 18, tone: 0.55, mid: 0, cab: 'Off', level: -6, mix: 1 };
      const apply = () => {
        const f = AMP_CURVES[st.type] || AMP_CURVES.Overdrive, c = new Float32Array(4097);
        for (let i = 0; i < 4097; i++) c[i] = f((i / 2048 - 1) * 1.6);
        let mx = 0; for (const v of c) mx = Math.max(mx, Math.abs(v)); for (let i = 0; i < c.length; i++) c[i] /= mx || 1;
        sh.curve = c;
        driveG.gain.value = db(st.drive) / 1.6;
        mid.gain.value = st.mid;
        tone.frequency.value = 900 * Math.pow(18, st.tone);           // 900 Hz .. 16 kHz
        const C = { 'Off': [['allpass', 1000, 0.7, 0], ['allpass', 1000, 0.7, 0], ['allpass', 1000, 0.7, 0]],
          'Combo 1x12': [['highpass', 90, 0.7, 0], ['peaking', 2200, 1.2, 4], ['lowpass', 5200, 0.8, 0]],
          'Stack 4x12': [['highpass', 70, 0.8, 0], ['peaking', 120, 1, 3], ['lowpass', 4200, 1.1, 0]],
          'Radio': [['highpass', 380, 0.8, 0], ['peaking', 1600, 1, 6], ['lowpass', 3200, 0.9, 0]] }[st.cab] || [];
        [cab1, cab2, cab3].forEach((b, i) => { const [t, fr, q, g] = C[i]; b.type = t; b.frequency.value = fr; b.Q.value = q; b.gain.value = g; });
        level.gain.value = db(st.level);
        dw.setMix(st.mix);
      };
      apply();
      return { input: dw.input, output: dw.output, setParam(id, v) { st[id] = id === 'tone' || id === 'mix' ? v / 100 : v; apply(); } };
    },
  });

  /* ================= Rotary speaker (Leslie) ================= */
  Studio.registerWorklet('ss-rotary', `
    class SsRotary extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [${k('fast', 0, 0, 1)}, ${k('ramp', 1.5, 0.1, 6)}, ${k('drive', 0, 0, 1)}, ${k('width', 1, 0, 1)}, ${k('mix', 1, 0, 1)}]; }
      constructor() {
        super(); this.N = 4096; this.buf = [new Float32Array(this.N), new Float32Array(this.N)]; this.w = 0;
        this.hornPh = 0; this.drumPh = 0.25; this.hornHz = 0.8; this.drumHz = 0.7; this.lp = 0;
      }
      rd(b, pos) { const N = this.N, i = Math.floor(pos), f = pos - i; const a = b[(i % N + N) % N], c = b[((i + 1) % N + N) % N]; return a + (c - a) * f; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0];
        if (!inp || !inp.length) return true;
        const n = inp[0].length, fast = p.fast[0] > 0.5;
        const hornT = fast ? 6.8 : 0.8, drumT = fast ? 5.9 : 0.7;
        const a = Math.exp(-1 / (p.ramp[0] * sampleRate / 3));
        const drv = 1 + p.drive[0] * 6, width = p.width[0], mix = p.mix[0];
        const xa = Math.exp(-2 * Math.PI * 800 / sampleRate);
        for (let i = 0; i < n; i++) {
          // the horn speeds up quicker than the heavy drum
          this.hornHz = hornT + (this.hornHz - hornT) * a;
          this.drumHz = drumT + (this.drumHz - drumT) * Math.pow(a, 0.6);
          this.hornPh += this.hornHz / sampleRate; this.hornPh -= Math.floor(this.hornPh);
          this.drumPh += this.drumHz / sampleRate; this.drumPh -= Math.floor(this.drumPh);
          let x = 0; for (let c = 0; c < inp.length; c++) x += inp[c][i]; x /= inp.length;
          x = Math.tanh(x * drv) / Math.tanh(drv);
          this.lp = x * (1 - xa) + this.lp * xa;            // 800 Hz crossover
          const lo = this.lp, hi = x - this.lp;
          this.buf[0][this.w] = hi; this.buf[1][this.w] = lo;
          const hs = Math.sin(2 * Math.PI * this.hornPh), hc = Math.cos(2 * Math.PI * this.hornPh);
          const ds = Math.sin(2 * Math.PI * this.drumPh), dc = Math.cos(2 * Math.PI * this.drumPh);
          // doppler: read position wobbles; amplitude follows which way the speaker faces
          const hL = this.rd(this.buf[0], this.w - 40 - 28 * hs) * (0.75 + 0.25 * hc);
          const hR = this.rd(this.buf[0], this.w - 40 + 28 * hs) * (0.75 - 0.25 * hc);
          const dL = this.rd(this.buf[1], this.w - 40 - 10 * ds) * (0.85 + 0.15 * dc);
          const dR = this.rd(this.buf[1], this.w - 40 + 10 * ds) * (0.85 - 0.15 * dc);
          let L = (hL + dL) * 0.8, R = (hR + dR) * 0.8; const M = (L + R) / 2; L = M + (L - M) * width; R = M + (R - M) * width;
          this.w = (this.w + 1) % this.N;
          const dl = inp[0][i], dr = (inp[1] || inp[0])[i];
          out[0][i] = dl * (1 - mix) + L * mix; if (out[1]) out[1][i] = dr * (1 - mix) + R * mix;
        }
        return true;
      }
    }
    registerProcessor('ss-rotary', SsRotary);`);
  Studio.registerPlugin({
    id: 'ss-rotary',
    name: 'Session Rotary',
    category: 'Modulation',
    color: '#d97706',
    description: 'Spinning speaker cabinet (Leslie) — organ swirl, dreamy guitars, wobbly vocals; switch Slow / Fast for the ramp',
    params: [
      { id: 'speed', name: 'Speed', type: 'select', options: ['Slow', 'Fast'], default: 'Slow' },
      { id: 'ramp', name: 'Ramp', unit: 's', min: 0.1, max: 6, step: 0.1, default: 1.5 },
      { id: 'drive', name: 'Drive', unit: '%', min: 0, max: 100, step: 1, default: 15 },
      { id: 'width', name: 'Width', unit: '%', min: 0, max: 100, step: 1, default: 100 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Rotor', params: ['speed', 'ramp'] }, { title: 'Sound', params: ['drive', 'width', 'mix'] }],
    presets: [
      { name: 'Organ chorale', params: { speed: 'Slow', ramp: 1.5, drive: 20, width: 100, mix: 100 } },
      { name: 'Organ tremolo', params: { speed: 'Fast', ramp: 1.2, drive: 25, width: 100, mix: 100 } },
      { name: 'Dreamy vocal', params: { speed: 'Slow', ramp: 2, drive: 0, width: 80, mix: 35 } },
    ],
    create(ctx) {
      let node;
      try { node = worklet(ctx, 'ss-rotary'); } catch (e) { return passthrough(ctx, 'rotary'); }
      const set = (id, v) => { const p = node.parameters.get(id); if (p) p.value = v; };
      return { input: node, output: node, setParam(id, v) { if (id === 'speed') set('fast', v === 'Fast' ? 1 : 0); else if (id === 'ramp') set('ramp', v); else set(id, v / 100); } };
    },
  });

  /* ================= Ring modulator ================= */
  Studio.registerPlugin({
    id: 'ss-ringmod',
    name: 'Session Ring Mod',
    category: 'Modulation',
    color: '#94a3b8',
    description: 'Multiplies the sound with a tone — robot voices, metallic bells, sci-fi textures',
    params: [
      { id: 'freq', name: 'Frequency', unit: 'Hz', min: 1, max: 4000, step: 0.1, default: 120, scale: 'log' },
      { id: 'wobble', name: 'Wobble', unit: '%', min: 0, max: 100, step: 1, default: 0 },
      { id: 'rate', name: 'Wobble rate', unit: 'Hz', min: 0.05, max: 10, step: 0.01, default: 0.5, scale: 'log' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 60 },
    ],
    layout: [{ title: 'Carrier', params: ['freq', 'wobble', 'rate'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: 'Robot voice', params: { freq: 60, wobble: 0, rate: 0.5, mix: 70 } },
      { name: 'Metal bells', params: { freq: 740, wobble: 0, rate: 0.5, mix: 55 } },
      { name: 'Sci-fi sweep', params: { freq: 300, wobble: 80, rate: 0.3, mix: 60 } },
      { name: 'Slow tremble', params: { freq: 6, wobble: 0, rate: 0.5, mix: 100 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const vca = ctx.createGain(); vca.gain.value = 0;
      const car = ctx.createOscillator(); car.frequency.value = 120;
      const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
      lfo.connect(lfoAmt); lfoAmt.connect(car.frequency);
      car.connect(vca.gain); dw.input.connect(vca); vca.connect(dw.wet);
      car.start(); lfo.start();
      const st = { freq: 120, wobble: 0, rate: 0.5, mix: 0.6 };
      const apply = () => { car.frequency.value = st.freq; lfo.frequency.value = st.rate; lfoAmt.gain.value = st.freq * st.wobble * 0.9; dw.setMix(st.mix); };
      apply();
      return {
        input: dw.input, output: dw.output,
        setParam(id, v) { st[id] = id === 'mix' || id === 'wobble' ? v / 100 : v; apply(); },
        destroy() { try { car.stop(); lfo.stop(); } catch (e) {} },
      };
    },
  });

  /* ================= Octaver ================= */
  Studio.registerPlugin({
    id: 'ss-octaver',
    name: 'Session Octaver',
    category: 'Pitch',
    color: '#38bdf8',
    description: 'Adds an octave below and/or above — fat bass, 808 doubling, huge vocal layers',
    params: [
      { id: 'down', name: 'Octave down', unit: '%', min: 0, max: 100, step: 1, default: 60 },
      { id: 'up', name: 'Octave up', unit: '%', min: 0, max: 100, step: 1, default: 0 },
      { id: 'dry', name: 'Dry', unit: '%', min: 0, max: 100, step: 1, default: 100 },
      { id: 'tone', name: 'Down tone', unit: 'Hz', min: 150, max: 4000, step: 1, default: 900, scale: 'log' },
    ],
    layout: [{ title: 'Octaves', params: ['down', 'up', 'dry'] }, { title: 'Tone', params: ['tone'] }],
    presets: [
      { name: 'Sub bass', params: { down: 80, up: 0, dry: 100, tone: 400 } },
      { name: 'Vocal octave layer', params: { down: 40, up: 20, dry: 100, tone: 1500 } },
      { name: '12-string', params: { down: 0, up: 45, dry: 100, tone: 900 } },
      { name: 'Monster', params: { down: 100, up: 0, dry: 40, tone: 700 } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain();
      input.connect(dry); dry.connect(output);
      const mk = (semis) => {
        let n;
        try { n = new AudioWorkletNode(ctx, 'ss-pitch', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' }); } catch (e) { return null; }
        n.parameters.get('semis').value = semis; n.parameters.get('grain').value = semis < 0 ? 90 : 45; n.parameters.get('mix').value = 1;
        return n;
      };
      const dn = mk(-12), up = mk(12), dnG = ctx.createGain(), upG = ctx.createGain(), dnLp = ctx.createBiquadFilter();
      dnLp.type = 'lowpass'; dnLp.frequency.value = 900; dnLp.Q.value = 0.6;
      if (dn) { input.connect(dn); dn.connect(dnLp); dnLp.connect(dnG); dnG.connect(output); }
      if (up) { input.connect(up); up.connect(upG); upG.connect(output); }
      return {
        input, output,
        setParam(id, v) {
          if (id === 'down') dnG.gain.value = v / 100 * 1.2;
          else if (id === 'up') upG.gain.value = v / 100;
          else if (id === 'dry') dry.gain.value = v / 100;
          else if (id === 'tone') dnLp.frequency.value = v;
        },
      };
    },
  });
})();
