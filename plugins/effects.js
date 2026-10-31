/* Built-in effects: Delay, Reverb, Distortion, Filter, Compressor. */
(function () {
  /** dry/wet helper: returns { input, output, dry, wet, setMix } */
  function dryWet(ctx) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    input.connect(dry);
    dry.connect(output);
    wet.connect(output);
    return {
      input,
      output,
      wet,
      setMix(m) {
        const t = ctx.currentTime;
        dry.gain.setTargetAtTime(1 - m * 0.6, t, 0.01);
        wet.gain.setTargetAtTime(m, t, 0.01);
      },
    };
  }

  const mixParam = (d) => ({ id: 'mix', name: 'Mix', min: 0, max: 1, step: 0.01, default: d });

  Studio.registerPlugin({
    id: 'fx-delay',
    name: 'Delay',
    type: 'effect',
    category: 'Delay',
    description: 'Simple mono echo with a tone control',
    presets: [
      { name: 'Default', params: {} },
      { name: 'Slapback', params: { time: 110, feedback: 0.1, tone: 5000, mix: 0.25 } },
      { name: 'Long echo', params: { time: 600, feedback: 0.55, tone: 3000, mix: 0.3 } },
      { name: 'Dark repeats', params: { time: 420, feedback: 0.7, tone: 1200, mix: 0.35 } },
    ],
    params: [
      { id: 'time', name: 'Time', unit: 'ms', min: 20, max: 1000, step: 1, default: 330 },
      { id: 'feedback', name: 'Feedback', min: 0, max: 0.9, step: 0.01, default: 0.4 },
      { id: 'tone', name: 'Tone', unit: 'Hz', min: 500, max: 12000, default: 4000, scale: 'log' },
      mixParam(0.3),
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const delay = ctx.createDelay(2);
      const fb = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      dw.input.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(dw.wet);
      return {
        input: dw.input,
        output: dw.output,
        setParam(id, v) {
          const t = ctx.currentTime;
          if (id === 'time') delay.delayTime.setTargetAtTime(v / 1000, t, 0.02);
          else if (id === 'feedback') fb.gain.setTargetAtTime(v, t, 0.01);
          else if (id === 'tone') lp.frequency.setTargetAtTime(v, t, 0.01);
          else if (id === 'mix') dw.setMix(v);
        },
        destroy() {},
      };
    },
  });

  Studio.registerPlugin({
    id: 'fx-reverb',
    name: 'Reverb',
    type: 'effect',
    category: 'Reverb',
    description: 'Quick, simple room reverb',
    presets: [
      { name: 'Default', params: {} },
      { name: 'Small room', params: { size: 0.6, damping: 0.6, mix: 0.2 } },
      { name: 'Big space', params: { size: 4, damping: 0.35, mix: 0.3 } },
    ],
    params: [
      { id: 'size', name: 'Size', unit: 's', min: 0.3, max: 5, step: 0.1, default: 1.8 },
      { id: 'damping', name: 'Damping', min: 0, max: 1, step: 0.01, default: 0.5 },
      mixParam(0.25),
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const conv = ctx.createConvolver();
      dw.input.connect(conv);
      conv.connect(dw.wet);
      const st = { size: 1.8, damping: 0.5 };
      let timer = null;
      const build = () => {
        const len = Math.floor(ctx.sampleRate * st.size);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = buf.getChannelData(c);
          let lpState = 0;
          const k = 1 - st.damping * 0.92;
          for (let i = 0; i < len; i++) {
            const n = Math.random() * 2 - 1;
            lpState += (n - lpState) * k; // damping lowpass on the noise
            d[i] = lpState * Math.pow(1 - i / len, 3);
          }
        }
        conv.buffer = buf;
      };
      build();
      return {
        input: dw.input,
        output: dw.output,
        setParam(id, v) {
          if (id === 'mix') return dw.setMix(v);
          st[id] = v;
          // an export needs the new impulse right away; live playback waits for the knob to settle
          if (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext) return build();
          clearTimeout(timer);
          timer = setTimeout(build, 120); // debounce slider drags
        },
        destroy() {
          clearTimeout(timer);
        },
      };
    },
  });

  Studio.registerPlugin({
    id: 'fx-distortion',
    name: 'Distortion',
    type: 'effect',
    category: 'Distortion',
    description: 'Warm overdrive to fuzz, with a tone filter',
    visual: {
      type: 'curve',
      fn: (p, x) => {
        const k = 1 + p.drive * 60;
        return (1 - p.mix * 0.6) * x + p.mix * (Math.tanh(k * x) / Math.tanh(k));
      },
    },
    presets: [
      { name: 'Default', params: {} },
      { name: 'Light drive', params: { drive: 0.15, tone: 9000, mix: 0.5 } },
      { name: 'Crunch', params: { drive: 0.45, tone: 6000, mix: 0.7 } },
      { name: 'Fuzz', params: { drive: 0.95, tone: 3500, mix: 0.9 } },
    ],
    params: [
      { id: 'drive', name: 'Drive', min: 0, max: 1, step: 0.01, default: 0.4 },
      { id: 'tone', name: 'Tone', unit: 'Hz', min: 500, max: 16000, default: 8000, scale: 'log' },
      mixParam(0.6),
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '4x';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      dw.input.connect(shaper);
      shaper.connect(lp);
      lp.connect(dw.wet);
      const curve = (drive) => {
        const n = 2048;
        const c = new Float32Array(n);
        const k = 1 + drive * 60;
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * 2 - 1;
          c[i] = Math.tanh(k * x) / Math.tanh(k);
        }
        return c;
      };
      return {
        input: dw.input,
        output: dw.output,
        setParam(id, v) {
          if (id === 'drive') shaper.curve = curve(v);
          else if (id === 'tone') lp.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
          else if (id === 'mix') dw.setMix(v);
        },
        destroy() {},
      };
    },
  });

  Studio.registerPlugin({
    id: 'fx-filter',
    name: 'Filter',
    type: 'effect',
    category: 'Filter',
    description: 'Low-pass, high-pass or band-pass filter',
    visual: { type: 'eq', bands: [{ label: 'F', on: null, freq: 'cutoff', gain: null, q: 'resonance' }] },
    presets: [
      { name: 'Default', params: {} },
      { name: 'Muffled', params: { type: 'lowpass', cutoff: 600, resonance: 0.8 } },
      { name: 'Thin', params: { type: 'highpass', cutoff: 900, resonance: 0.8 } },
      { name: 'Radio', params: { type: 'bandpass', cutoff: 1500, resonance: 2 } },
      { name: 'Resonant sweep', params: { type: 'lowpass', cutoff: 1200, resonance: 9 } },
    ],
    params: [
      { id: 'type', name: 'Type', type: 'select', options: ['lowpass', 'highpass', 'bandpass'], default: 'lowpass' },
      { id: 'cutoff', name: 'Cutoff', unit: 'Hz', min: 40, max: 18000, default: 1800, scale: 'log' },
      { id: 'resonance', name: 'Resonance', min: 0.1, max: 20, step: 0.1, default: 1 },
    ],
    create(ctx) {
      const f = ctx.createBiquadFilter();
      return {
        input: f,
        output: f,
        getResponse(freqs) {
          const m = new Float32Array(freqs.length);
          f.getFrequencyResponse(freqs, m, new Float32Array(freqs.length));
          return m.map((v) => 20 * Math.log10(Math.max(v, 1e-6)));
        },
        setParam(id, v) {
          const t = ctx.currentTime;
          if (id === 'type') f.type = v;
          else if (id === 'cutoff') f.frequency.setTargetAtTime(v, t, 0.01);
          else if (id === 'resonance') f.Q.setTargetAtTime(v, t, 0.01);
        },
        destroy() {},
      };
    },
  });

  Studio.registerPlugin({
    id: 'fx-compressor',
    name: 'Compressor',
    type: 'effect',
    category: 'Dynamics',
    description: 'Classic compressor',
    visual: { type: 'dynamics', threshold: 'threshold', ratio: 'ratio' },
    presets: [
      { name: 'Default', params: {} },
      { name: 'Gentle', params: { threshold: -14, ratio: 2, attack: 0.03, release: 0.25, makeup: 2 } },
      { name: 'Vocal', params: { threshold: -22, ratio: 4, attack: 0.006, release: 0.12, makeup: 5 } },
      { name: 'Heavy', params: { threshold: -32, ratio: 10, attack: 0.002, release: 0.08, makeup: 10 } },
    ],
    params: [
      { id: 'threshold', name: 'Threshold', unit: 'dB', min: -60, max: 0, step: 1, default: -18 },
      { id: 'ratio', name: 'Ratio', min: 1, max: 20, step: 0.5, default: 4 },
      { id: 'attack', name: 'Attack', unit: 's', min: 0.001, max: 0.3, default: 0.01, scale: 'log' },
      { id: 'release', name: 'Release', unit: 's', min: 0.02, max: 1, default: 0.2, scale: 'log' },
      { id: 'makeup', name: 'Makeup', unit: 'dB', min: 0, max: 18, step: 0.5, default: 3 },
    ],
    create(ctx) {
      const out = ctx.createGain();
      // accurate compressor from the Session suite (threshold / ratio behave exactly); browser compressor as a fallback
      if (Studio.createDynamics && typeof AudioWorkletNode !== 'undefined' && Studio.worklets.has('ss-dyn')) {
        const dyn = Studio.createDynamics(ctx, { knee: 3 });
        dyn.output.connect(out);
        return {
          input: dyn.input,
          output: out,
          getReduction: () => [dyn.reduction()],
          setParam(id, v) {
            if (id === 'makeup') out.gain.setTargetAtTime(Math.pow(10, v / 20), ctx.currentTime, 0.01);
            else if (id === 'attack' || id === 'release') dyn.set(id, v * 1000);
            else dyn.set(id, v);
          },
          destroy() {},
        };
      }
      const comp = ctx.createDynamicsCompressor();
      comp.connect(out);
      return {
        input: comp,
        output: out,
        getReduction: () => [comp.reduction || 0],
        setParam(id, v) {
          if (id === 'makeup') out.gain.setTargetAtTime(Math.pow(10, v / 20), ctx.currentTime, 0.01);
          else if (comp[id] && comp[id].value !== undefined) comp[id].value = v;
        },
        destroy() {},
      };
    },
  });

  Studio.registerPlugin({
    id: 'fx-eq3',
    name: 'EQ (3-band)',
    type: 'effect',
    category: 'EQ',
    description: 'Quick tone control: low, mid and high',
    visual: { type: 'eq', bands: [{ label: 'M', on: null, freq: 'midFreq', gain: 'mid', q: null }] },
    presets: [
      { name: 'Flat', params: {} },
      { name: 'Smile', params: { low: 4, mid: -2, high: 4 } },
      { name: 'Warm', params: { low: 3, high: -3 } },
      { name: 'Presence', params: { mid: 3, midFreq: 3000, high: 1.5 } },
    ],
    params: [
      { id: 'low', name: 'Low (150 Hz)', unit: 'dB', min: -15, max: 15, step: 0.5, default: 0 },
      { id: 'mid', name: 'Mid', unit: 'dB', min: -15, max: 15, step: 0.5, default: 0 },
      { id: 'midFreq', name: 'Mid freq', unit: 'Hz', min: 300, max: 5000, default: 1000, scale: 'log' },
      { id: 'high', name: 'High (6 kHz)', unit: 'dB', min: -15, max: 15, step: 0.5, default: 0 },
    ],
    create(ctx) {
      const lo = ctx.createBiquadFilter();
      lo.type = 'lowshelf';
      lo.frequency.value = 150;
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.Q.value = 0.9;
      const hi = ctx.createBiquadFilter();
      hi.type = 'highshelf';
      hi.frequency.value = 6000;
      lo.connect(mid);
      mid.connect(hi);
      return {
        input: lo,
        output: hi,
        getResponse(freqs) {
          const total = new Float32Array(freqs.length);
          const m = new Float32Array(freqs.length);
          const ph = new Float32Array(freqs.length);
          for (const f of [lo, mid, hi]) {
            f.getFrequencyResponse(freqs, m, ph);
            for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(Math.max(m[i], 1e-6));
          }
          return total;
        },
        setParam(id, v) {
          const t = ctx.currentTime;
          if (id === 'low') lo.gain.setTargetAtTime(v, t, 0.01);
          else if (id === 'mid') mid.gain.setTargetAtTime(v, t, 0.01);
          else if (id === 'midFreq') mid.frequency.setTargetAtTime(v, t, 0.01);
          else if (id === 'high') hi.gain.setTargetAtTime(v, t, 0.01);
        },
        destroy() {},
      };
    },
  });
})();
