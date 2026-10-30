/* Noise Gate: silences a track between notes/words so background noise, hiss and mic bleed disappear. */
(function () {
  // Runs on the audio thread. One detector for all channels so the stereo image never wobbles.
  const SOURCE = `
    class PsGate extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
        return [k('threshold', -45, -90, 0), k('range', -70, -90, 0), k('attack', 1, 0.1, 100), k('hold', 60, 0, 1000), k('release', 150, 5, 2000)];
      }
      constructor() {
        super();
        this.env = 0;
        this.gDb = 0; // current gain in dB (0 = open)
        this.open = false;
        this.holdLeft = 0;
        this.decay = Math.exp(-1 / (sampleRate * 0.004));
      }
      process(inputs, outputs, params) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input.length) return true;
        const n = input[0].length;
        const thrOpen = Math.pow(10, params.threshold[0] / 20);
        const thrClose = thrOpen * 0.708; // 3 dB hysteresis so it does not chatter
        const rangeDb = Math.min(0, params.range[0]);
        const span = Math.max(6, -rangeDb);
        // attack / release are the time to travel the whole reduction range, in dB, so they behave like a hardware gate
        const upStep = span / (sampleRate * params.attack[0] / 1000);
        const downStep = span / (sampleRate * params.release[0] / 1000);
        const holdN = Math.round(sampleRate * params.hold[0] / 1000);
        let env = this.env, gDb = this.gDb, open = this.open, holdLeft = this.holdLeft;
        for (let i = 0; i < n; i++) {
          let a = 0;
          for (let c = 0; c < input.length; c++) { const v = Math.abs(input[c][i]); if (v > a) a = v; }
          env = a > env ? a : env * this.decay;
          if (env > thrOpen) { open = true; holdLeft = holdN; }
          else if (env < thrClose) { if (holdLeft > 0) holdLeft--; else open = false; }
          const target = open ? 0 : rangeDb;
          if (target > gDb) gDb = Math.min(target, gDb + upStep);
          else if (target < gDb) gDb = Math.max(target, gDb - downStep);
          const gain = gDb >= 0 ? 1 : Math.pow(10, gDb / 20);
          for (let c = 0; c < output.length; c++) {
            const src = input[c < input.length ? c : input.length - 1];
            output[c][i] = src[i] * gain;
          }
        }
        this.env = env; this.gDb = gDb; this.open = open; this.holdLeft = holdLeft;
        return true;
      }
    }
    registerProcessor('ps-gate', PsGate);
  `;
  Studio.registerWorklet('ps-gate', SOURCE);

  /** Frame peaks (dB) over every clip on the track, with clip gain applied. */
  function framePeaksDb(track) {
    const out = [];
    for (const c of track.clips) {
      if (c.muted) continue;
      const buf = Studio.buffers.get(c.asset);
      if (!buf) continue;
      const F = Math.max(64, Math.round(buf.sampleRate * 0.01));
      const a = Math.floor(c.offset * buf.sampleRate);
      const b = Math.min(buf.length, a + Math.floor(c.dur * buf.sampleRate));
      for (let p = a; p + F <= b; p += F) {
        let peak = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = p; i < p + F; i++) peak = Math.max(peak, Math.abs(d[i]));
        }
        peak *= c.gain || 1;
        if (peak > 1e-5) out.push(20 * Math.log10(peak));
      }
    }
    return out;
  }

  Studio.registerPlugin({
    id: 'fx-gate',
    name: 'Noise Gate',
    category: 'Dynamics',
    description: 'Silences hiss and room noise between notes and words',
    layout: [
      { title: 'Detector', params: ['threshold', 'range'] },
      { title: 'Timing', params: ['attack', 'hold', 'release'] },
    ],
    presets: [
      { name: 'Default', params: {} },
      { name: 'Vocal (natural)', params: { threshold: -48, range: -25, attack: 2, hold: 80, release: 220 } },
      { name: 'Tight drums', params: { threshold: -30, range: -70, attack: 0.5, hold: 30, release: 60 } },
      { name: 'Guitar amp hiss', params: { threshold: -55, range: -40, attack: 1, hold: 120, release: 300 } },
    ],
    type: 'effect',
    params: [
      { id: 'threshold', name: 'Threshold', unit: 'dB', min: -90, max: 0, step: 0.5, default: -45 },
      { id: 'range', name: 'Reduction', unit: 'dB', min: -90, max: 0, step: 1, default: -70 },
      { id: 'attack', name: 'Attack', unit: 'ms', min: 0.1, max: 100, default: 1, scale: 'log' },
      { id: 'hold', name: 'Hold', unit: 'ms', min: 0, max: 1000, step: 1, default: 60 },
      { id: 'release', name: 'Release', unit: 'ms', min: 5, max: 2000, default: 150, scale: 'log' },
    ],
    actions: [
      {
        label: 'Auto threshold',
        title: 'Listen to this track and set the threshold between the background noise and the signal',
        run({ owner, set }) {
          if (!owner || !owner.clips) throw new Error('Auto threshold works on a track. Put the gate on the track you want to clean up.');
          const db = framePeaksDb(owner).sort((a, b) => a - b);
          if (db.length < 20) throw new Error('Not enough audio on this track to measure. Record or import something first.');
          const at = (q) => db[Math.min(db.length - 1, Math.floor(q * db.length))];
          const noise = at(0.1);
          const signal = at(0.9);
          const gap = signal - noise;
          const thr = Math.max(-80, Math.min(-6, gap < 8 ? noise + gap / 2 : noise + gap * 0.35));
          set('threshold', Math.round(thr * 2) / 2);
          const r = Math.round(thr) + ' dB';
          return gap < 8
            ? 'Noise (' + Math.round(noise) + ' dB) and signal (' + Math.round(signal) + ' dB) are close together. Threshold set to ' + r + '; check it by ear.'
            : 'Background noise about ' + Math.round(noise) + ' dB, signal about ' + Math.round(signal) + ' dB. Threshold set to ' + r + '.';
        },
      },
    ],
    create(ctx) {
      let node;
      try {
        // no outputChannelCount: the output follows the input, so a mono track stays mono and levels match the bypassed sound
        node = new AudioWorkletNode(ctx, 'ps-gate', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' });
      } catch (e) {
        console.warn('[noise gate] worklet unavailable, passing audio through', e);
        const g = ctx.createGain();
        return { input: g, output: g, setParam() {}, destroy() {} };
      }
      return {
        input: node,
        output: node,
        setParam(id, v) {
          const p = node.parameters.get(id);
          if (p) p.value = v;
        },
        destroy() {},
      };
    },
  });
})();
