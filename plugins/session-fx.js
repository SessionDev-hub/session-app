/* Session effect suite: EQ, Compressor, Maximizer, Multiband, Reverb, Tempo Delay, Enhancer,
 * Pattern Gate, Clipper and Transient Shaper. Every effect works in live playback and in WAV export,
 * and exposes live data (EQ curve, gain reduction, step position…) for the plugin window. */
(function () {
  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (g) => (g > 1e-6 ? 20 * Math.log10(g) : -120);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isOffline = (ctx) => typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const smooth = (param, v, ctx, tc = 0.015) => (isOffline(ctx) ? (param.value = v) : param.setTargetAtTime(v, ctx.currentTime, tc));
  const songBpm = () => (Studio.project && Studio.project.bpm) || 120;
  const songBeatsPerBar = () => (Studio.project && Studio.project.beatsPerBar) || 4;

  /** Listen to app events (tempo, project) with a way to stop listening. */
  function listen(names, fn) {
    const h = (e) => fn(e.detail);
    names.forEach((n) => Studio.events.addEventListener(n, h));
    return () => names.forEach((n) => Studio.events.removeEventListener(n, h));
  }

  /** Equal-power dry/wet mix around an effect path. Dry can be delayed to stay aligned with the wet path. */
  function dryWet(ctx, dryDelay = 0) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    if (dryDelay > 0) {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = dryDelay;
      input.connect(d);
      d.connect(dry);
    } else input.connect(dry);
    dry.connect(output);
    wet.connect(output);
    return {
      input,
      output,
      wet,
      setMix(m) {
        smooth(dry.gain, Math.cos((m * Math.PI) / 2), ctx);
        smooth(wet.gain, Math.sin((m * Math.PI) / 2), ctx);
      },
      setMixLinear(m) {
        smooth(dry.gain, 1 - m, ctx);
        smooth(wet.gain, m, ctx);
      },
    };
  }

  /** 4th-order Linkwitz-Riley filter (two cascaded Butterworth biquads): bands sum back flat. */
  function lr4(ctx, type) {
    const a = ctx.createBiquadFilter();
    const b = ctx.createBiquadFilter();
    a.type = b.type = type;
    a.Q.value = b.Q.value = -3.0103; // Web Audio low/high-pass Q is in dB: -3.01 dB = Butterworth
    a.connect(b);
    return {
      input: a,
      output: b,
      set(f) {
        smooth(a.frequency, f, ctx, 0.02);
        smooth(b.frequency, f, ctx, 0.02);
      },
    };
  }

  /** Split a signal into low / mid / high bands that add back together flat. */
  function threeBand(ctx) {
    const input = ctx.createGain();
    const lowLP = lr4(ctx, 'lowpass');
    const restHP = lr4(ctx, 'highpass');
    const midLP = lr4(ctx, 'lowpass');
    const highHP = lr4(ctx, 'highpass');
    // LR4 high-mid split sums to a 2nd-order all-pass, so the low band gets the same one to stay in phase
    const lowAP = ctx.createBiquadFilter();
    lowAP.type = 'allpass';
    lowAP.Q.value = Math.SQRT1_2;
    input.connect(lowLP.input);
    lowLP.output.connect(lowAP);
    input.connect(restHP.input);
    restHP.output.connect(midLP.input);
    restHP.output.connect(highHP.input);
    return {
      input,
      low: lowAP,
      mid: midLP.output,
      high: highHP.output,
      setLow(f) {
        lowLP.set(f);
        restHP.set(f);
      },
      setHigh(f) {
        midLP.set(f);
        highHP.set(f);
        smooth(lowAP.frequency, f, ctx);
      },
    };
  }

  function softClipCurve(ceiling, softness, n = 4096) {
    const c = new Float32Array(n);
    const k = ceiling * (1 - clamp(softness, 0, 0.98));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      let y;
      if (a <= k) y = a;
      else y = k + (ceiling - k) * Math.tanh((a - k) / Math.max(1e-6, ceiling - k));
      c[i] = Math.sign(x) * Math.min(y, ceiling);
    }
    return c;
  }

  function hardClipCurve(ceiling, n = 4097) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = clamp((i / (n - 1)) * 2 - 1, -ceiling, ceiling);
    return c;
  }

  function saturationCurve(amount, n = 2048) {
    const c = new Float32Array(n);
    const k = 1 + amount * 6;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return c;
  }

  /* ======================================================================
   * Dynamics engine (audio thread): a real feed-forward compressor whose threshold / ratio / knee
   * do exactly what they say (the browser's built-in compressor adds hidden make-up gain).
   * ==================================================================== */
  Studio.registerWorklet(
    'ss-dyn',
    `
    class SsDyn extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
        return [k('threshold', -18, -80, 6), k('ratio', 4, 1, 100), k('knee', 6, 0, 40), k('attack', 10, 0.01, 1000), k('release', 150, 1, 5000), k('makeup', 0, -40, 40)];
      }
      constructor() { super(); this.g = 0; this.min = 0; this.cnt = 0; }
      process(inputs, outputs, P) {
        const inp = inputs[0], out = outputs[0];
        if (!out.length) return true;
        const n = out[0].length;
        if (!inp || !inp.length) { for (const o of out) o.fill(0); return true; }
        const T = P.threshold[0], R = P.ratio[0], W = P.knee[0], mk = Math.pow(10, P.makeup[0] / 20);
        const aA = Math.exp(-1 / (sampleRate * P.attack[0] / 1000));
        const aR = Math.exp(-1 / (sampleRate * P.release[0] / 1000));
        let g = this.g, mn = this.min;
        for (let i = 0; i < n; i++) {
          let x = 0;
          for (let c = 0; c < inp.length; c++) { const v = Math.abs(inp[c][i]); if (v > x) x = v; }
          const xd = x > 1e-6 ? 20 * Math.log10(x) : -120;
          let yd;
          const d = xd - T;
          if (2 * d < -W) yd = xd;
          else if (W > 0 && 2 * Math.abs(d) <= W) yd = xd + (1 / R - 1) * (d + W / 2) * (d + W / 2) / (2 * W);
          else yd = T + d / R;
          const target = yd - xd; // <= 0
          g = target < g ? aA * g + (1 - aA) * target : aR * g + (1 - aR) * target;
          if (g < mn) mn = g;
          const gain = Math.pow(10, g / 20) * mk;
          for (let c = 0; c < out.length; c++) out[c][i] = inp[Math.min(c, inp.length - 1)][i] * gain;
        }
        this.g = g; this.min = mn;
        if ((this.cnt += n) > sampleRate / 40) { this.port.postMessage(this.min); this.min = 0; this.cnt = 0; }
        return true;
      }
    }
    registerProcessor('ss-dyn', SsDyn);
  `
  );

  /** A compressor node pair { input, output, set(name, value), reduction() } built on the worklet above. */
  function createDyn(ctx, init = {}) {
    const node = new AudioWorkletNode(ctx, 'ss-dyn', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    let gr = 0;
    node.port.onmessage = (e) => (gr = e.data);
    const set = (k, v) => {
      const p = node.parameters.get(k);
      if (p) p.value = v;
    };
    for (const k of Object.keys(init)) set(k, init[k]);
    return { input: node, output: node, set, reduction: () => gr };
  }
  Studio.createDynamics = createDyn;

  /* ======================================================================
   * Session EQ — 7 bands: high-pass, low shelf, 3 bells, high shelf, low-pass
   * ==================================================================== */
  const EQ_BANDS = [
    { key: 'hp', type: 'highpass', label: 'HP', freq: 30, q: -3, gain: false, on: false },
    { key: 'ls', type: 'lowshelf', label: 'LOW', freq: 100, gain: 0, on: true },
    { key: 'p1', type: 'peaking', label: '1', freq: 300, gain: 0, q: 1, on: true },
    { key: 'p2', type: 'peaking', label: '2', freq: 1200, gain: 0, q: 1, on: true },
    { key: 'p3', type: 'peaking', label: '3', freq: 4000, gain: 0, q: 1, on: true },
    { key: 'hs', type: 'highshelf', label: 'HIGH', freq: 9000, gain: 0, on: true },
    { key: 'lp', type: 'lowpass', label: 'LP', freq: 18000, q: -3, gain: false, on: false },
  ];
  const eqParams = [];
  for (const b of EQ_BANDS) {
    eqParams.push({ id: b.key + 'On', name: b.label + ' on', type: 'boolean', default: b.on });
    eqParams.push({ id: b.key + 'Freq', name: 'Freq', unit: 'Hz', min: 20, max: 20000, default: b.freq, scale: 'log' });
    if (b.gain !== false) eqParams.push({ id: b.key + 'Gain', name: 'Gain', unit: 'dB', min: -18, max: 18, step: 0.1, default: 0 });
    if (b.type === 'peaking') eqParams.push({ id: b.key + 'Q', name: 'Q', min: 0.2, max: 12, default: b.q, scale: 'log' });
    else if (b.q) eqParams.push({ id: b.key + 'Q', name: 'Reso', unit: 'dB', min: -3, max: 18, step: 0.1, default: -3 });
  }
  eqParams.push({ id: 'hpSlope', name: 'Slope', type: 'select', options: ['12 dB', '24 dB'], default: '24 dB' });
  eqParams.push({ id: 'output', name: 'Output', unit: 'dB', min: -18, max: 18, step: 0.1, default: 0 });

  Studio.registerPlugin({
    id: 'ss-eq',
    name: 'Session EQ',
    type: 'effect',
    category: 'EQ',
    color: '#22d3ee',
    description: '7-band parametric equalizer with live spectrum',
    params: eqParams,
    compact: true,
    layout: [
      { title: 'HP', toggle: 'hpOn', params: ['hpFreq', 'hpQ', 'hpSlope'] },
      { title: 'Low', toggle: 'lsOn', params: ['lsFreq', 'lsGain'] },
      { title: 'Bell 1', toggle: 'p1On', params: ['p1Freq', 'p1Gain', 'p1Q'] },
      { title: 'Bell 2', toggle: 'p2On', params: ['p2Freq', 'p2Gain', 'p2Q'] },
      { title: 'Bell 3', toggle: 'p3On', params: ['p3Freq', 'p3Gain', 'p3Q'] },
      { title: 'High', toggle: 'hsOn', params: ['hsFreq', 'hsGain'] },
      { title: 'LP', toggle: 'lpOn', params: ['lpFreq', 'lpQ'] },
      { title: 'Output', params: ['output'] },
    ],
    visual: {
      type: 'eq',
      bands: EQ_BANDS.map((b) => ({ label: b.label, on: b.key + 'On', freq: b.key + 'Freq', gain: b.gain === false ? null : b.key + 'Gain', q: b.q ? b.key + 'Q' : null })),
    },
    presets: [
      { name: 'Flat', params: {} },
      { name: 'Vocal presence', params: { hpOn: true, hpFreq: 90, p1Gain: -2.5, p1Freq: 320, p1Q: 1.2, p3Gain: 3, p3Freq: 3800, p3Q: 0.9, hsGain: 2.5, hsFreq: 11000 } },
      { name: 'Warm bass', params: { lsGain: 3.5, lsFreq: 90, p1Gain: -3, p1Freq: 260, p1Q: 1.4, lpOn: true, lpFreq: 9000 } },
      { name: 'Air & sparkle', params: { hsGain: 5, hsFreq: 12000, p3Gain: 1.5, p3Freq: 5000, p3Q: 0.7 } },
      { name: 'Kick punch', params: { lsGain: 4, lsFreq: 60, p1Gain: -5, p1Freq: 380, p1Q: 2, p3Gain: 4, p3Freq: 3500, p3Q: 1.5 } },
      { name: 'Mud cut', params: { hpOn: true, hpFreq: 60, p1Gain: -4, p1Freq: 250, p1Q: 1.2, p2Gain: -2, p2Freq: 500, p2Q: 1.4 } },
      { name: 'Telephone', params: { hpOn: true, hpFreq: 400, hpSlope: '24 dB', lpOn: true, lpFreq: 3200, p2Gain: 6, p2Freq: 1500, p2Q: 0.8 } },
    ],
    create(ctx) {
      const input = ctx.createGain();
      const out = ctx.createGain();
      const nodes = {};
      let prev = input;
      for (const b of EQ_BANDS) {
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.freq;
        if (b.q) f.Q.value = b.q;
        nodes[b.key] = f;
        prev.connect(f);
        prev = f;
        if (b.key === 'hp') {
          const f2 = ctx.createBiquadFilter(); // second stage for 24 dB/oct
          f2.type = 'highpass';
          f2.Q.value = -3.0103;
          nodes.hp2 = f2;
          prev.connect(f2);
          prev = f2;
        }
      }
      prev.connect(out);
      const st = {};
      for (const p of eqParams) st[p.id] = p.default;
      const nyq = ctx.sampleRate / 2 - 100;
      const apply = (key) => {
        const b = EQ_BANDS.find((x) => x.key === key);
        const f = nodes[key];
        const on = !!st[key + 'On'];
        if (b.type === 'highpass') {
          const fr = on ? st.hpFreq : 5;
          smooth(f.frequency, fr, ctx);
          smooth(f.Q, st.hpQ, ctx);
          smooth(nodes.hp2.frequency, on && st.hpSlope.startsWith('24') ? fr : 5, ctx);
        } else if (b.type === 'lowpass') {
          smooth(f.frequency, on ? Math.min(st.lpFreq, nyq) : nyq, ctx);
          smooth(f.Q, on ? st.lpQ : -3.0103, ctx);
        } else {
          smooth(f.frequency, Math.min(st[key + 'Freq'], nyq), ctx);
          smooth(f.gain, on ? st[key + 'Gain'] : 0, ctx);
          if (b.q) smooth(f.Q, st[key + 'Q'], ctx);
        }
      };
      return {
        input,
        output: out,
        setParam(id, v) {
          st[id] = v;
          if (id === 'output') return smooth(out.gain, dbToGain(v), ctx);
          if (id === 'hpSlope') return apply('hp');
          const key = id.replace(/(On|Freq|Gain|Q)$/, '');
          if (nodes[key]) apply(key);
        },
        /** Magnitude response in dB at the given frequencies (for the EQ display). */
        getResponse(freqs) {
          const total = new Float32Array(freqs.length).fill(gainToDb(dbToGain(st.output)));
          const mag = new Float32Array(freqs.length);
          const ph = new Float32Array(freqs.length);
          for (const f of [...Object.values(nodes)]) {
            f.getFrequencyResponse(freqs, mag, ph);
            for (let i = 0; i < freqs.length; i++) total[i] += gainToDb(mag[i]);
          }
          return total;
        },
        destroy() {},
      };
    },
  });

  /* ======================================================================
   * Session Compressor
   * ==================================================================== */

  Studio.registerPlugin({
    id: 'ss-comp',
    name: 'Session Compressor',
    type: 'effect',
    category: 'Dynamics',
    color: '#8b7bff',
    description: 'Smooth bus / vocal compressor with parallel mix',
    params: [
      { id: 'input', name: 'Input', unit: 'dB', min: -18, max: 18, step: 0.1, default: 0 },
      { id: 'threshold', name: 'Threshold', unit: 'dB', min: -60, max: 0, step: 0.1, default: -18 },
      { id: 'ratio', name: 'Ratio', unit: ':1', min: 1, max: 20, step: 0.1, default: 4, scale: 'log' },
      { id: 'knee', name: 'Knee', unit: 'dB', min: 0, max: 30, step: 0.5, default: 6 },
      { id: 'attack', name: 'Attack', unit: 'ms', min: 0.1, max: 200, default: 10, scale: 'log' },
      { id: 'release', name: 'Release', unit: 'ms', min: 10, max: 1500, default: 150, scale: 'log' },
      { id: 'makeup', name: 'Makeup', unit: 'dB', min: -12, max: 24, step: 0.1, default: 0 },
      { id: 'auto', name: 'Auto makeup', type: 'boolean', default: true },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [
      { title: 'Detector', params: ['threshold', 'ratio', 'knee'] },
      { title: 'Timing', params: ['attack', 'release'] },
      { title: 'Gain', params: ['input', 'makeup', 'auto', 'mix'] },
    ],
    visual: { type: 'dynamics', threshold: 'threshold', ratio: 'ratio', knee: 'knee' },
    presets: [
      { name: 'Default', params: {} },
      { name: 'Gentle glue', params: { threshold: -14, ratio: 2, knee: 10, attack: 30, release: 250 } },
      { name: 'Vocal leveler', params: { threshold: -22, ratio: 3.5, knee: 8, attack: 6, release: 120 } },
      { name: 'Punchy drums', params: { threshold: -20, ratio: 5, knee: 3, attack: 25, release: 80 } },
      { name: 'Parallel smash', params: { threshold: -36, ratio: 12, knee: 0, attack: 1, release: 60, mix: 40 } },
      { name: 'Bass control', params: { threshold: -20, ratio: 4, knee: 6, attack: 15, release: 200 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const inGain = ctx.createGain();
      const comp = createDyn(ctx);
      const makeup = ctx.createGain();
      dw.input.connect(inGain);
      inGain.connect(comp.input);
      comp.output.connect(makeup);
      makeup.connect(dw.wet);
      const st = { threshold: -18, ratio: 4, makeup: 0, auto: true, input: 0 };
      const updMakeup = () => {
        // auto makeup: half of the reduction a full-scale signal would get
        const auto = st.auto ? (-st.threshold * (1 - 1 / st.ratio)) * 0.5 : 0;
        smooth(makeup.gain, dbToGain(st.makeup + auto), ctx);
      };
      return {
        input: dw.input,
        output: dw.output,
        setParam(id, v) {
          st[id] = v;
          if (id === 'input') smooth(inGain.gain, dbToGain(v), ctx);
          else if (['threshold', 'ratio', 'knee', 'attack', 'release'].includes(id)) comp.set(id, v);
          else if (id === 'mix') dw.setMixLinear(v / 100);
          if (['threshold', 'ratio', 'makeup', 'auto'].includes(id)) updMakeup();
        },
        getReduction: () => [comp.reduction()],
        destroy() {},
      };
    },
  });

  /* ======================================================================
   * Session Maximizer — loudness limiter with true ceiling
   * ==================================================================== */
  Studio.registerPlugin({
    id: 'ss-maximizer',
    name: 'Session Maximizer',
    type: 'effect',
    category: 'Mastering',
    color: '#f59e0b',
    description: 'Push loudness up to a ceiling the signal never crosses',
    params: [
      { id: 'gain', name: 'Drive', unit: 'dB', min: 0, max: 24, step: 0.1, default: 4 },
      { id: 'ceiling', name: 'Ceiling', unit: 'dB', min: -6, max: 0, step: 0.1, default: -0.3 },
      { id: 'release', name: 'Release', unit: 'ms', min: 10, max: 800, default: 120, scale: 'log' },
      { id: 'character', name: 'Character', type: 'select', options: ['Clean', 'Warm', 'Punchy'], default: 'Clean' },
    ],
    layout: [{ title: 'Loudness', params: ['gain', 'ceiling', 'release', 'character'] }],
    visual: { type: 'dynamics', threshold: 'ceiling', ratio: null, limiter: true, drive: 'gain' },
    presets: [
      { name: 'Transparent', params: { gain: 3, ceiling: -0.3, release: 150, character: 'Clean' } },
      { name: 'Streaming loud', params: { gain: 6, ceiling: -1, release: 100, character: 'Clean' } },
      { name: 'Warm master', params: { gain: 5, ceiling: -0.5, release: 180, character: 'Warm' } },
      { name: 'Club punch', params: { gain: 9, ceiling: -0.2, release: 60, character: 'Punchy' } },
    ],
    create(ctx) {
      const input = ctx.createGain();
      const sat = ctx.createWaveShaper();
      sat.oversample = '4x';
      sat.curve = saturationCurve(0);
      const comp = ctx.createDynamicsCompressor();
      comp.knee.value = 0;
      comp.ratio.value = 20;
      comp.attack.value = 0.001;
      const clip = ctx.createWaveShaper();
      clip.oversample = '4x';
      input.connect(sat);
      sat.connect(comp);
      comp.connect(clip);
      const st = { ceiling: -0.3, gain: 4, character: 'Clean' };
      const upd = () => {
        const c = dbToGain(st.ceiling);
        comp.threshold.value = st.ceiling - 1;
        clip.curve = st.character === 'Warm' ? softClipCurve(c, 0.25) : hardClipCurve(c);
        sat.curve = st.character === 'Warm' ? saturationCurve(0.35) : saturationCurve(0);
        comp.attack.value = st.character === 'Punchy' ? 0.008 : 0.001;
      };
      upd();
      return {
        input,
        output: clip,
        setParam(id, v) {
          st[id] = v;
          if (id === 'gain') smooth(input.gain, dbToGain(v), ctx);
          else if (id === 'release') comp.release.value = v / 1000;
          else upd();
        },
        getReduction: () => [comp.reduction || 0],
        destroy() {},
      };
    },
  });

  /* ======================================================================
   * Session Multiband — 3-band compressor
   * ==================================================================== */
  const mbBand = (k, name, thr) => [
    { id: k + 'Thr', name: 'Threshold', unit: 'dB', min: -60, max: 0, step: 0.1, default: thr },
    { id: k + 'Ratio', name: 'Ratio', unit: ':1', min: 1, max: 20, step: 0.1, default: 3, scale: 'log' },
    { id: k + 'Gain', name: 'Gain', unit: 'dB', min: -12, max: 12, step: 0.1, default: 0 },
  ];
  Studio.registerPlugin({
    id: 'ss-multiband',
    name: 'Session Multiband',
    type: 'effect',
    category: 'Dynamics',
    color: '#f472b6',
    description: 'Low / mid / high compression with adjustable crossovers',
    params: [
      { id: 'xLow', name: 'Low ↔ Mid', unit: 'Hz', min: 40, max: 1000, default: 180, scale: 'log' },
      { id: 'xHigh', name: 'Mid ↔ High', unit: 'Hz', min: 1000, max: 12000, default: 3200, scale: 'log' },
      ...mbBand('lo', 'Low', -20),
      ...mbBand('mid', 'Mid', -18),
      ...mbBand('hi', 'High', -22),
      { id: 'attack', name: 'Attack', unit: 'ms', min: 0.5, max: 100, default: 12, scale: 'log' },
      { id: 'release', name: 'Release', unit: 'ms', min: 20, max: 1000, default: 160, scale: 'log' },
      { id: 'output', name: 'Output', unit: 'dB', min: -12, max: 12, step: 0.1, default: 0 },
    ],
    layout: [
      { title: 'Crossover', params: ['xLow', 'xHigh'] },
      { title: 'Low', params: ['loThr', 'loRatio', 'loGain'] },
      { title: 'Mid', params: ['midThr', 'midRatio', 'midGain'] },
      { title: 'High', params: ['hiThr', 'hiRatio', 'hiGain'] },
      { title: 'Global', params: ['attack', 'release', 'output'] },
    ],
    visual: { type: 'bands', labels: ['LOW', 'MID', 'HIGH'], crossovers: ['xLow', 'xHigh'] },
    presets: [
      { name: 'Default', params: {} },
      { name: 'Master glue', params: { loThr: -18, loRatio: 2, midThr: -16, midRatio: 1.8, hiThr: -20, hiRatio: 2, attack: 20, release: 200 } },
      { name: 'Tame harsh highs', params: { hiThr: -30, hiRatio: 4, xHigh: 4000, midRatio: 1, loRatio: 1 } },
      { name: 'Tight low end', params: { loThr: -26, loRatio: 5, xLow: 150, midRatio: 1, hiRatio: 1, loGain: 2 } },
      { name: 'Vocal de-mud', params: { midThr: -24, midRatio: 3, xLow: 250, xHigh: 2000, loRatio: 1, hiRatio: 1.5 } },
    ],
    create(ctx) {
      const tb = threeBand(ctx);
      const out = ctx.createGain();
      const bands = [tb.low, tb.mid, tb.high].map((src) => {
        const c = createDyn(ctx, { knee: 6 });
        const g = ctx.createGain();
        src.connect(c.input);
        c.output.connect(g);
        g.connect(out);
        return { c, g };
      });
      const idx = { lo: 0, mid: 1, hi: 2 };
      tb.setLow(180);
      tb.setHigh(3200);
      return {
        input: tb.input,
        output: out,
        setParam(id, v) {
          if (id === 'xLow') return tb.setLow(v);
          if (id === 'xHigh') return tb.setHigh(v);
          if (id === 'output') return smooth(out.gain, dbToGain(v), ctx);
          if (id === 'attack' || id === 'release') return bands.forEach((b) => b.c.set(id, v));
          const m = /^(lo|mid|hi)(Thr|Ratio|Gain)$/.exec(id);
          if (!m) return;
          const b = bands[idx[m[1]]];
          if (m[2] === 'Thr') b.c.set('threshold', v);
          else if (m[2] === 'Ratio') b.c.set('ratio', v);
          else smooth(b.g.gain, dbToGain(v), ctx);
        },
        getReduction: () => bands.map((b) => b.c.reduction()),
        destroy() {},
      };
    },
  });

  /* ======================================================================
   * Session Reverb — algorithmic impulse with early reflections, damping and pre-delay
   * ==================================================================== */
  function makeIR(ctx, p) {
    const sr = ctx.sampleRate;
    const decay = clamp(p.decay, 0.2, 12);
    const len = Math.floor(sr * Math.min(14, decay * 1.4 + 0.15));
    const buf = ctx.createBuffer(2, len, sr);
    let seed = 1234567; // deterministic noise: the same settings always sound (and export) the same
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const size = clamp(p.size, 0, 1);
    const attack = Math.floor(sr * (0.004 + size * 0.05)); // tail builds up over this time
    const hiStart = 18000 * (1 - p.damping * 0.35);
    const hiEnd = 700 + 9000 * Math.pow(1 - p.damping, 2);
    let lpL = 0;
    let lpR = 0;
    let alpha = 1;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if ((i & 63) === 0) {
        const fc = hiStart * Math.pow(hiEnd / hiStart, Math.min(1, t / decay));
        alpha = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      }
      const env = Math.exp((-6.91 * t) / decay) * Math.min(1, i / Math.max(1, attack));
      const nL = rnd();
      const nR = p.width * rnd() + (1 - p.width) * nL;
      lpL += (nL - lpL) * alpha;
      lpR += (nR - lpR) * alpha;
      L[i] = lpL * env;
      R[i] = lpR * env;
    }
    // early reflections
    const nRef = Math.round(6 + size * 18);
    const span = 0.008 + size * 0.07;
    for (let k = 0; k < nRef; k++) {
      const t = 0.002 + ((k + 0.5 + rnd() * 0.4) / nRef) * span;
      const i = Math.floor(t * sr);
      if (i >= len) continue;
      const amp = 0.9 * Math.pow(1 - k / nRef, 1.5) * (0.6 + 0.4 * Math.abs(rnd()));
      (k % 2 ? R : L)[i] += amp * (rnd() > 0 ? 1 : -1);
      (k % 2 ? L : R)[Math.min(len - 1, i + Math.floor(sr * 0.0007))] += amp * 0.5 * p.width;
    }
    // normalise energy so the wet level stays similar for any size / decay
    let e = 0;
    for (let i = 0; i < len; i++) e += L[i] * L[i] + R[i] * R[i];
    const k = Math.sqrt(1 / Math.max(1e-9, e));
    for (let i = 0; i < len; i++) {
      L[i] *= k;
      R[i] *= k;
    }
    return buf;
  }

  Studio.registerPlugin({
    id: 'ss-reverb',
    name: 'Session Reverb',
    type: 'effect',
    category: 'Reverb',
    color: '#60a5fa',
    description: 'Rooms, plates and halls with pre-delay and tone shaping',
    params: [
      { id: 'predelay', name: 'Pre-delay', unit: 'ms', min: 0, max: 250, step: 1, default: 20 },
      { id: 'size', name: 'Size', unit: '%', min: 0, max: 100, step: 1, default: 55 },
      { id: 'decay', name: 'Decay', unit: 's', min: 0.2, max: 12, default: 2.2, scale: 'log' },
      { id: 'damping', name: 'Damping', unit: '%', min: 0, max: 100, step: 1, default: 45 },
      { id: 'lowcut', name: 'Low cut', unit: 'Hz', min: 20, max: 1000, default: 120, scale: 'log' },
      { id: 'highcut', name: 'High cut', unit: 'Hz', min: 1500, max: 20000, default: 12000, scale: 'log' },
      { id: 'width', name: 'Width', unit: '%', min: 0, max: 100, step: 1, default: 100 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 25 },
    ],
    layout: [
      { title: 'Space', params: ['size', 'decay', 'predelay', 'width'] },
      { title: 'Tone', params: ['damping', 'lowcut', 'highcut'] },
      { title: 'Output', params: ['mix'] },
    ],
    visual: { type: 'ir' },
    presets: [
      { name: 'Small room', params: { size: 25, decay: 0.6, predelay: 5, damping: 55, mix: 20 } },
      { name: 'Vocal plate', params: { size: 45, decay: 1.8, predelay: 30, damping: 30, lowcut: 200, highcut: 14000, mix: 22 } },
      { name: 'Large hall', params: { size: 85, decay: 3.6, predelay: 35, damping: 45, mix: 28 } },
      { name: 'Cathedral', params: { size: 100, decay: 7.5, predelay: 60, damping: 35, lowcut: 150, mix: 30 } },
      { name: 'Ambient wash', params: { size: 100, decay: 11, predelay: 90, damping: 60, lowcut: 300, mix: 45 } },
      { name: 'Drum room', params: { size: 35, decay: 0.9, predelay: 0, damping: 50, lowcut: 90, mix: 18 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const pre = ctx.createDelay(1);
      const conv = ctx.createConvolver();
      const hp = ctx.createBiquadFilter();
      const lp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      lp.type = 'lowpass';
      dw.input.connect(pre);
      pre.connect(conv);
      conv.connect(hp);
      hp.connect(lp);
      lp.connect(dw.wet);
      const st = { size: 0.55, decay: 2.2, damping: 0.45, width: 1 };
      let timer = null;
      let env = null;
      const build = () => {
        timer = null;
        conv.buffer = makeIR(ctx, st);
        // envelope for the display
        const d = conv.buffer.getChannelData(0);
        const n = 240;
        const step = Math.max(1, Math.floor(d.length / n));
        env = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let k = i * step; k < Math.min(d.length, (i + 1) * step); k++) m = Math.max(m, Math.abs(d[k]));
          env[i] = m;
        }
      };
      build();
      return {
        input: dw.input,
        output: dw.output,
        setParam(id, v) {
          if (id === 'mix') return dw.setMix(v / 100);
          if (id === 'predelay') return smooth(pre.delayTime, v / 1000, ctx);
          if (id === 'lowcut') return smooth(hp.frequency, v, ctx);
          if (id === 'highcut') return smooth(lp.frequency, Math.min(v, ctx.sampleRate / 2 - 100), ctx);
          st[id] = ['size', 'damping', 'width'].includes(id) ? v / 100 : v;
          // exports need the impulse now; live playback waits for the knob to settle
          if (isOffline(ctx)) build();
          else {
            clearTimeout(timer);
            timer = setTimeout(build, 90);
          }
        },
        getIR: () => ({ env, seconds: conv.buffer ? conv.buffer.duration : 0 }),
        destroy() {
          clearTimeout(timer);
        },
      };
    },
  });

  /* ======================================================================
   * Session Delay — tempo-synced stereo / ping-pong delay
   * ==================================================================== */
  const SYNC = { 'Free (ms)': 0, '1/32': 0.125, '1/16': 0.25, '1/16 dotted': 0.375, '1/8 triplet': 1 / 3, '1/8': 0.5, '1/8 dotted': 0.75, '1/4 triplet': 2 / 3, '1/4': 1, '1/4 dotted': 1.5, '1/2': 2, '1 bar': 'bar' };
  const delaySeconds = (p, bpm, bpb) => {
    const s = SYNC[p.sync];
    if (!s) return p.time / 1000;
    const beat = 60 / bpm;
    return s === 'bar' ? beat * bpb : beat * s;
  };

  Studio.registerPlugin({
    id: 'ss-delay',
    name: 'Session Delay',
    type: 'effect',
    category: 'Delay',
    color: '#34d399',
    description: 'Tempo-synced echo with ping-pong and filtered feedback',
    params: [
      { id: 'sync', name: 'Sync', type: 'select', options: Object.keys(SYNC), default: '1/8 dotted' },
      { id: 'time', name: 'Time', unit: 'ms', min: 1, max: 2000, default: 350, scale: 'log', enabledIf: (p) => p.sync === 'Free (ms)' },
      { id: 'feedback', name: 'Feedback', unit: '%', min: 0, max: 95, step: 1, default: 40 },
      { id: 'pingpong', name: 'Ping-pong', type: 'boolean', default: true },
      { id: 'spread', name: 'Spread', unit: 'ms', min: 0, max: 40, step: 0.5, default: 0 },
      { id: 'lowcut', name: 'Low cut', unit: 'Hz', min: 20, max: 2000, default: 150, scale: 'log' },
      { id: 'highcut', name: 'High cut', unit: 'Hz', min: 1000, max: 20000, default: 7000, scale: 'log' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 25 },
    ],
    layout: [
      { title: 'Time', params: ['sync', 'time', 'spread'] },
      { title: 'Echoes', params: ['feedback', 'pingpong'] },
      { title: 'Tone', params: ['lowcut', 'highcut'] },
      { title: 'Output', params: ['mix'] },
    ],
    visual: { type: 'taps' },
    presets: [
      { name: 'Slapback', params: { sync: 'Free (ms)', time: 95, feedback: 8, pingpong: false, mix: 22, highcut: 6000 } },
      { name: 'Quarter echo', params: { sync: '1/4', feedback: 35, pingpong: false, mix: 22 } },
      { name: 'Dotted eighth', params: { sync: '1/8 dotted', feedback: 42, pingpong: true, mix: 25 } },
      { name: 'Ping-pong 1/8', params: { sync: '1/8', feedback: 50, pingpong: true, mix: 28 } },
      { name: 'Dub throw', params: { sync: '1/4 dotted', feedback: 72, lowcut: 300, highcut: 2800, pingpong: true, mix: 35 } },
      { name: 'Wide doubler', params: { sync: 'Free (ms)', time: 18, feedback: 0, spread: 12, pingpong: false, mix: 40 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createGain(); // sums the stereo and ping-pong outputs (stays stereo)
      dw.input.connect(split);
      const mkLine = () => {
        const d = ctx.createDelay(5);
        const hp = ctx.createBiquadFilter();
        const lp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        lp.type = 'lowpass';
        const fb = ctx.createGain();
        d.connect(hp);
        hp.connect(lp);
        lp.connect(fb);
        return { d, hp, lp, fb };
      };
      // stereo: each side echoes into itself
      const sL = mkLine();
      const sR = mkLine();
      split.connect(sL.d, 0);
      split.connect(sR.d, 1);
      sL.fb.connect(sL.d);
      sR.fb.connect(sR.d);
      const stereoOut = ctx.createGain();
      const sm = ctx.createChannelMerger(2);
      sL.lp.connect(sm, 0, 0);
      sR.lp.connect(sm, 0, 1);
      sm.connect(stereoOut);
      // ping-pong: mono in -> left -> right -> left ...
      const mono = ctx.createGain();
      split.connect(mono, 0);
      split.connect(mono, 1);
      mono.gain.value = 0.5;
      const pL = mkLine();
      const pR = mkLine();
      mono.connect(pL.d);
      pL.lp.connect(pR.d); // left feeds right every time (pR.fb carries feedback back to left)
      pR.fb.connect(pL.d);
      const ppOut = ctx.createGain();
      const pm = ctx.createChannelMerger(2);
      pL.lp.connect(pm, 0, 0);
      pR.lp.connect(pm, 0, 1);
      pm.connect(ppOut);
      const pLtoR = ctx.createGain(); // level of the first right echo
      pL.lp.disconnect(pR.d);
      pL.lp.connect(pLtoR);
      pLtoR.connect(pR.d);
      stereoOut.connect(merge);
      ppOut.connect(merge);
      merge.connect(dw.wet);
      const lines = [sL, sR, pL, pR];
      const st = { sync: '1/8 dotted', time: 350, feedback: 40, pingpong: true, spread: 0 };
      const upd = () => {
        const t = clamp(delaySeconds(st, songBpm(), songBeatsPerBar()), 0.001, 4.9);
        const fb = clamp(st.feedback / 100, 0, 0.95);
        smooth(sL.d.delayTime, t, ctx, 0.03);
        smooth(sR.d.delayTime, clamp(t + st.spread / 1000, 0.001, 4.95), ctx, 0.03);
        smooth(pL.d.delayTime, t, ctx, 0.03);
        smooth(pR.d.delayTime, t, ctx, 0.03);
        smooth(sL.fb.gain, fb, ctx);
        smooth(sR.fb.gain, fb, ctx);
        smooth(pLtoR.gain, Math.sqrt(fb), ctx); // spread each round trip's feedback over both hops
        smooth(pR.fb.gain, Math.sqrt(fb), ctx);
        smooth(stereoOut.gain, st.pingpong ? 0 : 1, ctx, 0.02);
        smooth(ppOut.gain, st.pingpong ? 1 : 0, ctx, 0.02);
        smooth(pL.fb.gain, 0, ctx);
      };
      upd();
      const stop = listen(['tempo-changed', 'project-replaced'], upd);
      return {
        input: dw.input,
        output: dw.output,
        setParam(id, v) {
          st[id] = v;
          if (id === 'mix') return dw.setMix(v / 100);
          if (id === 'lowcut') return lines.forEach((l) => smooth(l.hp.frequency, v, ctx));
          if (id === 'highcut') return lines.forEach((l) => smooth(l.lp.frequency, Math.min(v, ctx.sampleRate / 2 - 100), ctx));
          upd();
        },
        /** Echo times / levels for the display. */
        getTaps() {
          const t = delaySeconds(st, songBpm(), songBeatsPerBar());
          const fb = st.feedback / 100;
          const taps = [];
          let lvl = 1;
          for (let k = 1; k <= 16 && lvl > 0.02; k++) {
            taps.push({ t: k * t, level: lvl, side: st.pingpong ? (k % 2 ? 'L' : 'R') : 'C' });
            lvl *= st.pingpong ? Math.sqrt(fb) : fb;
          }
          return { taps, seconds: t };
        },
        destroy: stop,
      };
    },
  });

  /* ======================================================================
   * Session Enhancer — one-knob "make it sound better" (multiband + warmth + air)
   * ==================================================================== */
  const ENH_MODES = {
    'A · Glue': { ratio: 3, depth: 26, sat: 0, low: 0, air: 0, gain: 0.42 },
    'B · Warm': { ratio: 2.5, depth: 22, sat: 0.55, low: 3, air: 0, gain: 0.4 },
    'C · Bright': { ratio: 3, depth: 24, sat: 0.15, low: 0, air: 5, gain: 0.4 },
    'D · Loud': { ratio: 6, depth: 34, sat: 0.35, low: 1.5, air: 2.5, gain: 0.48 },
  };
  Studio.registerPlugin({
    id: 'ss-enhancer',
    name: 'Session Enhancer',
    type: 'effect',
    category: 'Mastering',
    color: '#fbbf24',
    description: 'One knob: fuller, louder and more polished',
    params: [
      { id: 'amount', name: 'Amount', unit: '%', min: 0, max: 100, step: 1, default: 50 },
      { id: 'mode', name: 'Mode', type: 'select', options: Object.keys(ENH_MODES), default: 'A · Glue' },
      { id: 'output', name: 'Output', unit: 'dB', min: -12, max: 12, step: 0.1, default: 0 },
    ],
    layout: [{ title: 'Enhance', params: ['amount', 'mode', 'output'], big: 'amount' }],
    visual: { type: 'bands', labels: ['LOW', 'MID', 'HIGH'] },
    presets: [
      { name: 'Subtle polish', params: { amount: 30, mode: 'A · Glue' } },
      { name: 'Warm & full', params: { amount: 55, mode: 'B · Warm' } },
      { name: 'Bright vocal', params: { amount: 50, mode: 'C · Bright' } },
      { name: 'Maximum', params: { amount: 85, mode: 'D · Loud' } },
    ],
    create(ctx) {
      const tb = threeBand(ctx);
      tb.setLow(200);
      tb.setHigh(3500);
      const sum = ctx.createGain();
      const comps = [tb.low, tb.mid, tb.high].map((src) => {
        const c = createDyn(ctx, { knee: 10, attack: 12, release: 180 });
        src.connect(c.input);
        c.output.connect(sum);
        return c;
      });
      const satDry = ctx.createGain();
      const satWet = ctx.createGain();
      const sat = ctx.createWaveShaper();
      sat.oversample = '2x';
      sum.connect(satDry);
      sum.connect(sat);
      sat.connect(satWet);
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 110;
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 9500;
      satDry.connect(low);
      satWet.connect(low);
      low.connect(air);
      const makeup = ctx.createGain();
      air.connect(makeup);
      // safety: never clip, whatever the amount
      const lim = createDyn(ctx, { threshold: -1.5, ratio: 30, knee: 0, attack: 0.3, release: 100 });
      const out = ctx.createGain();
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve(dbToGain(-0.5), 0.2);
      makeup.connect(lim.input);
      lim.output.connect(clip);
      clip.connect(out);
      const st = { amount: 50, mode: 'A · Glue', output: 0 };
      const upd = () => {
        const m = ENH_MODES[st.mode] || ENH_MODES['A · Glue'];
        const a = st.amount / 100;
        comps.forEach((c, i) => {
          c.set('threshold', -m.depth * a * (i === 1 ? 0.9 : 1));
          c.set('ratio', 1 + (m.ratio - 1) * a);
        });
        sat.curve = saturationCurve(m.sat * a * 3);
        smooth(satWet.gain, m.sat * a, ctx);
        smooth(satDry.gain, 1 - m.sat * a * 0.5, ctx);
        smooth(low.gain, m.low * a, ctx);
        smooth(air.gain, m.air * a, ctx);
        smooth(makeup.gain, dbToGain(m.depth * a * (1 - 1 / (1 + (m.ratio - 1) * a)) * m.gain + a * 1.5), ctx);
        smooth(out.gain, dbToGain(st.output), ctx);
      };
      upd();
      return {
        input: tb.input,
        output: out,
        setParam(id, v) {
          st[id] = v;
          upd();
        },
        getReduction: () => comps.map((c) => c.reduction()),
        destroy() {},
      };
    },
  });

  /* ======================================================================
   * Session Pattern Gate — tempo-synced gate / stutter / pump patterns (runs on the audio thread)
   * ==================================================================== */
  Studio.registerWorklet(
    'ss-pattern',
    `
    class SsPattern extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
        return [k('bpm', 120, 20, 400), k('bpb', 4, 1, 16), k('pattern', 0xAAAA, 0, 65535), k('rate', 1, 0, 3), k('depth', 1, 0, 1),
                k('smooth', 4, 0.2, 60), k('mode', 0, 0, 2), k('repeats', 2, 1, 8), k('mix', 1, 0, 1)];
      }
      constructor() {
        super();
        this.anchor = { ctxTime: 0, pos: 0 };
        this.g = 1;
        this.size = Math.ceil(sampleRate * 6);
        this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
        this.w = 0;
        this.lastStep = -1;
        this.stepStart = 0;
        this.sent = -1;
        this.port.onmessage = (e) => { if (e.data && e.data.anchor) this.anchor = e.data.anchor; };
      }
      process(inputs, outputs, P) {
        const inp = inputs[0], out = outputs[0];
        if (!out.length) return true;
        const n = out[0].length;
        const bpm = P.bpm[0], bpb = P.bpb[0], bits = P.pattern[0] | 0, depth = P.depth[0], mode = Math.round(P.mode[0]);
        const rate = Math.round(P.rate[0]);
        const cycle = (bpb * 60 / bpm) * [0.5, 1, 2, 4][rate];
        const stepLen = cycle / 16;
        const beatLen = 60 / bpm;
        const coef = 1 - Math.exp(-1 / (sampleRate * P.smooth[0] / 1000));
        const reps = Math.max(1, Math.round(P.repeats[0]));
        const mix = P.mix[0];
        const t0 = this.anchor.pos + (currentTime - this.anchor.ctxTime);
        const chans = Math.max(1, Math.min(2, inp && inp.length ? inp.length : 1));
        let step = 0;
        for (let i = 0; i < n; i++) {
          const t = t0 + i / sampleRate;
          const ph = ((t % cycle) + cycle) % cycle;
          step = Math.min(15, Math.floor(ph / stepLen));
          const on = (bits >> step) & 1;
          const posInStep = ph - step * stepLen;
          if (step !== this.lastStep) { this.lastStep = step; this.stepStart = this.w; }
          // write input to the ring buffer first (stutter reads from it)
          for (let c = 0; c < 2; c++) {
            const src = inp && inp.length ? inp[Math.min(c, inp.length - 1)] : null;
            this.buf[c][this.w] = src ? src[i] : 0;
          }
          let target = 1;
          let wetL, wetR;
          if (mode === 0) {
            target = on ? 1 : 1 - depth;
          } else if (mode === 2) {
            // pump: duck on every "on" step, recover over the next beat
            let back = 0, found = false;
            for (let s = 0; s < 16; s++) { const k = (step - s + 16) % 16; if ((bits >> k) & 1) { back = s; found = true; break; } }
            const since = found ? back * stepLen + posInStep : 1e9;
            const x = Math.min(1, since / beatLen);
            target = 1 - depth * Math.pow(1 - x, 2.2);
          }
          this.g += (target - this.g) * (mode === 2 ? 0.5 : coef);
          if (mode === 1 && on) {
            const slice = Math.max(64, Math.floor(stepLen * sampleRate / reps));
            const posS = Math.floor(posInStep * sampleRate);
            const inSlice = posS % slice;
            const fade = Math.min(1, inSlice / 48, (slice - inSlice) / 48);
            const r = (this.stepStart + inSlice) % this.size;
            wetL = this.buf[0][r] * fade;
            wetR = this.buf[1][r] * fade;
          } else {
            wetL = this.buf[0][this.w] * this.g;
            wetR = this.buf[1][this.w] * this.g;
          }
          const dryL = this.buf[0][this.w], dryR = this.buf[1][this.w];
          out[0][i] = dryL * (1 - mix) + wetL * mix;
          if (out.length > 1) out[1][i] = (chans > 1 ? dryR : dryL) * (1 - mix) + (chans > 1 ? wetR : wetL) * mix;
          this.w = (this.w + 1) % this.size;
        }
        if (step !== this.sent) { this.sent = step; this.port.postMessage({ step }); }
        return true;
      }
    }
    registerProcessor('ss-pattern', SsPattern);
  `
  );

  const PATTERN_PRESETS = {
    'Trance gate 1/16': 0b1011101110111011,
    'Offbeat chop': 0b1100110011001100,
    'Half-time': 0b0000111100001111,
    'Triplet feel': 0b1011011011011011,
    'Every beat': 0b0001000100010001,
    'Build-up': 0b1111111101010101,
  };
  const bitsToStr = (b) => (b >>> 0).toString(2).padStart(16, '0');

  Studio.registerPlugin({
    id: 'ss-pattern',
    name: 'Session Pattern Gate',
    type: 'effect',
    category: 'Creative',
    color: '#fb7185',
    description: 'Tempo-synced gate, stutter and pump patterns',
    params: [
      { id: 'mode', name: 'Mode', type: 'select', options: ['Gate', 'Stutter', 'Pump'], default: 'Gate' },
      { id: 'rate', name: 'Step', type: 'select', options: ['1/32', '1/16', '1/8', '1/4'], default: '1/16' },
      { id: 'pattern', name: 'Pattern', min: 0, max: 65535, step: 1, default: 0b1011101110111011, hidden: true },
      { id: 'depth', name: 'Depth', unit: '%', min: 0, max: 100, step: 1, default: 100, enabledIf: (p) => p.mode !== 'Stutter' },
      { id: 'smooth', name: 'Smooth', unit: 'ms', min: 0.2, max: 60, default: 4, scale: 'log', enabledIf: (p) => p.mode === 'Gate' },
      { id: 'repeats', name: 'Repeats', min: 1, max: 8, step: 1, default: 2, enabledIf: (p) => p.mode === 'Stutter' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [
      { title: 'Pattern', params: ['mode', 'rate'] },
      { title: 'Shape', params: ['depth', 'smooth', 'repeats'] },
      { title: 'Output', params: ['mix'] },
    ],
    visual: { type: 'steps', param: 'pattern' },
    presets: [
      ...Object.entries(PATTERN_PRESETS).map(([name, bits]) => ({ name, params: { mode: 'Gate', pattern: bits } })),
      { name: 'Sidechain pump', params: { mode: 'Pump', rate: '1/16', pattern: 0b0001000100010001, depth: 85 } },
      { name: 'Stutter fill', params: { mode: 'Stutter', rate: '1/16', pattern: 0b1111000000000000, repeats: 4 } },
      { name: 'Glitch stutter', params: { mode: 'Stutter', rate: '1/16', pattern: 0b1010001001001000, repeats: 3 } },
    ],
    create(ctx) {
      const node = new AudioWorkletNode(ctx, 'ss-pattern', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const P = (k) => node.parameters.get(k);
      let step = -1;
      node.port.onmessage = (e) => e.data && typeof e.data.step === 'number' && (step = e.data.step);
      const tempo = () => {
        P('bpm').value = songBpm();
        P('bpb').value = songBeatsPerBar();
      };
      tempo();
      const eng = Studio.engine;
      if (eng && eng.ctx === ctx && eng.playing) node.port.postMessage({ anchor: { ctxTime: eng.startTime, pos: eng.startPos } });
      const stopTempo = listen(['tempo-changed', 'project-replaced'], tempo);
      const stopTransport = listen(['transport'], (d) => d && d.ctx === ctx && node.port.postMessage({ anchor: { ctxTime: d.ctxTime, pos: d.pos } }));
      return {
        input: node,
        output: node,
        setParam(id, v) {
          if (id === 'mode') P('mode').value = ['Gate', 'Stutter', 'Pump'].indexOf(v);
          else if (id === 'rate') P('rate').value = ['1/32', '1/16', '1/8', '1/4'].indexOf(v);
          else if (id === 'depth' || id === 'mix') P(id).value = v / 100;
          else if (P(id)) P(id).value = +v;
        },
        getStep: () => step,
        destroy() {
          stopTempo();
          stopTransport();
        },
      };
    },
  });
  Studio.patternBits = { toStr: bitsToStr };

  /* ======================================================================
   * Session Clipper
   * ==================================================================== */
  Studio.registerPlugin({
    id: 'ss-clipper',
    name: 'Session Clipper',
    type: 'effect',
    category: 'Distortion',
    color: '#f97316',
    description: 'Soft / hard clipping for loud, controlled peaks',
    params: [
      { id: 'drive', name: 'Drive', unit: 'dB', min: 0, max: 24, step: 0.1, default: 3 },
      { id: 'ceiling', name: 'Ceiling', unit: 'dB', min: -12, max: 0, step: 0.1, default: -0.5 },
      { id: 'softness', name: 'Softness', unit: '%', min: 0, max: 100, step: 1, default: 40 },
      { id: 'output', name: 'Output', unit: 'dB', min: -12, max: 12, step: 0.1, default: 0 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [
      { title: 'Clip', params: ['drive', 'ceiling', 'softness'] },
      { title: 'Output', params: ['output', 'mix'] },
    ],
    visual: {
      type: 'curve',
      fn: (p, x) => {
        const c = dbToGain(p.ceiling);
        const k = c * (1 - clamp(p.softness / 100, 0, 0.98));
        const a = Math.abs(x * dbToGain(p.drive));
        const y = a <= k ? a : k + (c - k) * Math.tanh((a - k) / Math.max(1e-6, c - k));
        return Math.sign(x) * Math.min(y, c);
      },
    },
    presets: [
      { name: 'Gentle', params: { drive: 2, ceiling: -0.5, softness: 70 } },
      { name: 'Drum smash', params: { drive: 8, ceiling: -1, softness: 15 } },
      { name: 'Hard 808', params: { drive: 12, ceiling: -0.3, softness: 5 } },
      { name: 'Parallel crunch', params: { drive: 18, softness: 30, mix: 35 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const drive = ctx.createGain();
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '4x';
      const out = ctx.createGain();
      dw.input.connect(drive);
      drive.connect(shaper);
      shaper.connect(out);
      out.connect(dw.wet);
      const st = { ceiling: -0.5, softness: 40 };
      const upd = () => (shaper.curve = softClipCurve(dbToGain(st.ceiling), st.softness / 100));
      upd();
      return {
        input: dw.input,
        output: dw.output,
        setParam(id, v) {
          st[id] = v;
          if (id === 'drive') smooth(drive.gain, dbToGain(v), ctx);
          else if (id === 'output') smooth(out.gain, dbToGain(v), ctx);
          else if (id === 'mix') dw.setMixLinear(v / 100);
          else upd();
        },
        destroy() {},
      };
    },
  });

  /* ======================================================================
   * Session Transient — attack / sustain shaper (audio thread)
   * ==================================================================== */
  Studio.registerWorklet(
    'ss-transient',
    `
    class SsTransient extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
        return [k('attack', 0, -1, 1), k('sustain', 0, -1, 1), k('speed', 1, 0.25, 4), k('output', 0, -24, 24)];
      }
      constructor() {
        super();
        this.e = [0, 0, 0, 0];
        this.g = 1;
        this.cnt = 0;
        this.minDb = 0; this.maxDb = 0;
      }
      process(inputs, outputs, P) {
        const inp = inputs[0], out = outputs[0];
        if (!inp || !inp.length) return true;
        const n = inp[0].length, sr = sampleRate, sp = P.speed[0];
        const co = (ms) => Math.exp(-1 / (sr * ms / 1000));
        // envelope pairs: fast vs slow attack (finds onsets), fast vs slow release (finds tails)
        const A = [co(0.3), co(18 * sp), co(0.5), co(0.5)];
        const R = [co(90 * sp), co(90 * sp), co(25 * sp), co(400 * sp)];
        const atk = P.attack[0] * 1.6, sus = P.sustain[0] * 1.4, outG = Math.pow(10, P.output[0] / 20);
        const gco = co(0.8);
        const e = this.e;
        for (let i = 0; i < n; i++) {
          let x = 0;
          for (let c = 0; c < inp.length; c++) { const v = Math.abs(inp[c][i]); if (v > x) x = v; }
          for (let k = 0; k < 4; k++) e[k] = x > e[k] ? A[k] * e[k] + (1 - A[k]) * x : R[k] * e[k] + (1 - R[k]) * x;
          const onset = Math.max(0, 20 * Math.log10((e[0] + 1e-9) / (e[1] + 1e-9)));
          const tail = Math.max(0, 20 * Math.log10((e[3] + 1e-9) / (e[2] + 1e-9)));
          let db = atk * onset + sus * tail;
          db = Math.max(-30, Math.min(18, db));
          const target = Math.pow(10, db / 20);
          this.g = gco * this.g + (1 - gco) * target;
          const gdb = 20 * Math.log10(this.g);
          if (gdb < this.minDb) this.minDb = gdb;
          if (gdb > this.maxDb) this.maxDb = gdb;
          for (let c = 0; c < out.length; c++) out[c][i] = inp[Math.min(c, inp.length - 1)][i] * this.g * outG;
        }
        if ((this.cnt += n) > sr / 30) {
          this.port.postMessage({ min: this.minDb, max: this.maxDb });
          this.cnt = 0; this.minDb = 0; this.maxDb = 0;
        }
        return true;
      }
    }
    registerProcessor('ss-transient', SsTransient);
  `
  );

  Studio.registerPlugin({
    id: 'ss-transient',
    name: 'Session Transient',
    type: 'effect',
    category: 'Dynamics',
    color: '#a3e635',
    description: 'Bring out or soften the attack and the tail of every hit',
    params: [
      { id: 'attack', name: 'Attack', unit: '%', min: -100, max: 100, step: 1, default: 30 },
      { id: 'sustain', name: 'Sustain', unit: '%', min: -100, max: 100, step: 1, default: 0 },
      { id: 'speed', name: 'Speed', unit: '×', min: 0.25, max: 4, default: 1, scale: 'log' },
      { id: 'output', name: 'Output', unit: 'dB', min: -24, max: 24, step: 0.1, default: 0 },
    ],
    layout: [
      { title: 'Shape', params: ['attack', 'sustain'] },
      { title: 'Detector', params: ['speed'] },
      { title: 'Output', params: ['output'] },
    ],
    visual: { type: 'transient' },
    presets: [
      { name: 'Snappy drums', params: { attack: 55, sustain: -15 } },
      { name: 'Tighten room', params: { attack: 10, sustain: -60 } },
      { name: 'Soften attack', params: { attack: -50, sustain: 10 } },
      { name: 'Long sustain', params: { attack: 0, sustain: 70, output: -3 } },
    ],
    create(ctx) {
      const node = new AudioWorkletNode(ctx, 'ss-transient', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const P = (k) => node.parameters.get(k);
      let meter = { min: 0, max: 0 };
      node.port.onmessage = (e) => e.data && (meter = e.data);
      return {
        input: node,
        output: node,
        setParam(id, v) {
          if (id === 'attack' || id === 'sustain') P(id).value = v / 100;
          else if (P(id)) P(id).value = v;
        },
        getGainRange: () => meter,
        destroy() {},
      };
    },
  });
})();
