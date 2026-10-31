/* Session Match EQ — a 10-band graphic EQ. On its own it's a clean graphic EQ you can tweak;
 * the "Match" assistant fills the bands automatically to steer your voice toward a reference. */
(function () {
  const Studio = window.Studio;
  const FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  Studio.registerWorklet(
    'ss-matcheq',
    `
    const FREQS = [31,63,125,250,500,1000,2000,4000,8000,16000];
    function peaking(freq, dB, sr) {
      const A = Math.pow(10, dB/40), w = 2*Math.PI*freq/sr, c = Math.cos(w), s = Math.sin(w), Q = 1.4, al = s/(2*Q);
      const a0 = 1 + al/A;
      return { b0:(1+al*A)/a0, b1:(-2*c)/a0, b2:(1-al*A)/a0, a1:(-2*c)/a0, a2:(1-al/A)/a0, x1:0,x2:0,y1:0,y2:0 };
    }
    class SsMatchEq extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
        const p = FREQS.map((f, i) => k('b' + i, 0, -18, 18));
        p.push(k('output', 0, -24, 24));
        return p;
      }
      constructor() {
        super();
        this.sr = sampleRate;
        this.gains = FREQS.map(() => 0);
        this.ch = [0, 1].map(() => FREQS.map((f) => peaking(f, 0, this.sr)));
      }
      run(bi, x) {
        const y = bi.b0*x + bi.b1*bi.x1 + bi.b2*bi.x2 - bi.a1*bi.y1 - bi.a2*bi.y2;
        bi.x2 = bi.x1; bi.x1 = x; bi.y2 = bi.y1; bi.y1 = y; return y;
      }
      process(inputs, outputs, P) {
        const inp = inputs[0], out = outputs[0];
        if (!out || !out.length) return true;
        if (!inp || !inp.length) { for (let c=0;c<out.length;c++) out[c].fill(0); return true; }
        // update any band whose gain changed
        for (let i = 0; i < FREQS.length; i++) {
          const g = P['b'+i][0];
          if (g !== this.gains[i]) {
            this.gains[i] = g;
            for (let c = 0; c < this.ch.length; c++) {
              const co = peaking(FREQS[i], g, this.sr), old = this.ch[c][i];
              co.x1=old.x1; co.x2=old.x2; co.y1=old.y1; co.y2=old.y2; // keep filter state (no click)
              this.ch[c][i] = co;
            }
          }
        }
        const outG = Math.pow(10, P.output[0]/20);
        const n = out[0].length, nCh = Math.min(out.length, this.ch.length);
        for (let c = 0; c < nCh; c++) {
          const src = inp[Math.min(c, inp.length-1)], dst = out[c], bands = this.ch[c];
          for (let i = 0; i < n; i++) {
            let x = src[i];
            for (let band = 0; band < bands.length; band++) x = this.run(bands[band], x);
            dst[i] = x * outG;
          }
        }
        return true;
      }
    }
    registerProcessor('ss-matcheq', SsMatchEq);
  `
  );

  Studio.registerPlugin({
    id: 'ss-matcheq',
    name: 'Session Match EQ',
    type: 'effect',
    category: 'EQ',
    color: '#22d3ee',
    description: 'A 10-band EQ the Match assistant fills to shape your voice like a reference',
    params: [
      ...FREQS.map((f, i) => ({ id: 'b' + i, name: f >= 1000 ? f / 1000 + 'k' : f + '', unit: 'dB', min: -18, max: 18, step: 0.1, default: 0 })),
      { id: 'output', name: 'Output', unit: 'dB', min: -24, max: 24, step: 0.1, default: 0 },
    ],
    layout: [
      { title: 'Low', params: ['b0', 'b1', 'b2'] },
      { title: 'Mid', params: ['b3', 'b4', 'b5', 'b6'] },
      { title: 'High', params: ['b7', 'b8', 'b9'] },
      { title: 'Output', params: ['output'] },
    ],
    presets: [
      { name: 'Flat', params: {} },
      { name: 'Vocal lift', params: { b2: -2, b6: 2.5, b7: 3, b8: 2 } },
      { name: 'Warm', params: { b1: 2, b2: 1.5, b8: -2, b9: -3 } },
    ],
    create(ctx) {
      const node = new AudioWorkletNode(ctx, 'ss-matcheq', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const P = (k) => node.parameters.get(k);
      return {
        input: node,
        output: node,
        setParam(id, v) { if (P(id)) P(id).value = v; },
        destroy() {},
      };
    },
  });

  Studio.MATCH_FREQS = FREQS;
})();
