/* Session De-Esser — tames harsh "s"/"t"/"sh" sounds on vocals.
 * It splits the signal at a crossover, watches only the high (sibilant) band, and ducks
 * just that band when it gets too loud — so the rest of the voice is untouched. */
(function () {
  const Studio = window.Studio;

  Studio.registerWorklet(
    'ss-deesser',
    `
    // one biquad (Direct Form I), reused for the Linkwitz-Riley crossover
    function makeBiquad() { return { b0:1,b1:0,b2:0,a1:0,a2:0, x1:0,x2:0,y1:0,y2:0 }; }
    function lp(bi, f, sr) { const w=2*Math.PI*f/sr, c=Math.cos(w), s=Math.sin(w), q=Math.SQRT1_2, al=s/(2*q);
      const a0=1+al; bi.b0=((1-c)/2)/a0; bi.b1=(1-c)/a0; bi.b2=((1-c)/2)/a0; bi.a1=(-2*c)/a0; bi.a2=(1-al)/a0; }
    function hp(bi, f, sr) { const w=2*Math.PI*f/sr, c=Math.cos(w), s=Math.sin(w), q=Math.SQRT1_2, al=s/(2*q);
      const a0=1+al; bi.b0=((1+c)/2)/a0; bi.b1=(-(1+c))/a0; bi.b2=((1+c)/2)/a0; bi.a1=(-2*c)/a0; bi.a2=(1-al)/a0; }
    function run(bi, x) { const y = bi.b0*x + bi.b1*bi.x1 + bi.b2*bi.x2 - bi.a1*bi.y1 - bi.a2*bi.y2;
      bi.x2=bi.x1; bi.x1=x; bi.y2=bi.y1; bi.y1=y; return y; }

    class SsDeesser extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
        return [ k('freq', 6500, 2000, 14000), k('threshold', -28, -60, 0), k('range', 10, 0, 24), k('wide', 0, 0, 1) ];
      }
      constructor() {
        super();
        this.sr = sampleRate;
        this.ch = [0,1].map(() => ({ lp1:makeBiquad(), lp2:makeBiquad(), hp1:makeBiquad(), hp2:makeBiquad() }));
        [].concat(this.ch).forEach(c => { lp(c.lp1,6500,this.sr); lp(c.lp2,6500,this.sr); hp(c.hp1,6500,this.sr); hp(c.hp2,6500,this.sr); });
        this.curF = 6500;
        this.env = 0;      // sibilance detector envelope (linear)
        this.gr = 1;       // current gain applied to the high band (linear)
        this.minGrDb = 0; this.rep = 0;
        this.atk = Math.exp(-1/(this.sr*0.0005)); // 0.5 ms
        this.rel = Math.exp(-1/(this.sr*0.040));  // 40 ms
      }
      process(inputs, outputs, P) {
        const inp = inputs[0], out = outputs[0];
        if (!out || !out.length) return true;
        if (!inp || !inp.length) { for (let c=0;c<out.length;c++) out[c].fill(0); return true; }
        const n = out[0].length, sr = this.sr;
        const f = P.freq[0];
        if (Math.abs(f - this.curF) > 1) { this.curF = f; for (const c of this.ch) { lp(c.lp1,f,sr); lp(c.lp2,f,sr); hp(c.hp1,f,sr); hp(c.hp2,f,sr); } }
        const thr = Math.pow(10, P.threshold[0]/20);
        const range = P.range[0];
        const wide = P.wide[0] > 0.5;
        const outN = Math.min(out.length, this.ch.length);
        for (let i=0;i<n;i++) {
          // split every OUTPUT channel (mono input feeds both), build a high-band detector
          let hiDet = 0;
          const his = [], los = [];
          for (let c=0;c<outN;c++) {
            const x = inp[Math.min(c, inp.length-1)][i];
            const hi = run(this.ch[c].hp2, run(this.ch[c].hp1, x));  // LR4 high
            const lo = run(this.ch[c].lp2, run(this.ch[c].lp1, x));  // LR4 low
            his[c]=hi; los[c]=lo;
            const a=Math.abs(hi); if (a>hiDet) hiDet=a;
          }
          // detector envelope on the sibilant band
          this.env = hiDet > this.env ? this.atk*this.env + (1-this.atk)*hiDet : this.rel*this.env + (1-this.rel)*hiDet;
          // how far over threshold, turned into gain reduction (capped by Range)
          let targetGr = 1;
          if (this.env > thr && thr > 0) {
            const overDb = 20*Math.log10(this.env/thr);
            const redDb = Math.min(range, overDb);
            targetGr = Math.pow(10, -redDb/20);
          }
          // follow the target quickly down, ease back up
          this.gr = targetGr < this.gr ? this.atk*this.gr + (1-this.atk)*targetGr : this.rel*this.gr + (1-this.rel)*targetGr;
          const grDb = 20*Math.log10(this.gr); if (grDb < this.minGrDb) this.minGrDb = grDb;
          for (let c=0;c<outN;c++) {
            out[c][i] = wide ? (los[c]+his[c])*this.gr : los[c] + his[c]*this.gr;
          }
        }
        if ((this.rep += n) > sr/24) { this.port.postMessage({ gr: this.minGrDb }); this.rep=0; this.minGrDb=0; }
        return true;
      }
    }
    registerProcessor('ss-deesser', SsDeesser);
  `
  );

  Studio.registerPlugin({
    id: 'ss-deesser',
    name: 'Session De-Esser',
    type: 'effect',
    category: 'Dynamics',
    color: '#60a5fa',
    description: 'Tame harsh S and T sounds on vocals without dulling the voice',
    params: [
      { id: 'freq', name: 'Frequency', unit: 'Hz', min: 2000, max: 14000, default: 6500, step: 10, scale: 'log' },
      { id: 'threshold', name: 'Threshold', unit: 'dB', min: -60, max: 0, default: -28, step: 0.1 },
      { id: 'range', name: 'Range', unit: 'dB', min: 0, max: 24, default: 10, step: 0.1 },
      { id: 'wide', name: 'Mode', type: 'select', options: ['Split', 'Wide'], default: 'Split' },
    ],
    layout: [
      { title: 'Listen', params: ['freq', 'threshold'] },
      { title: 'Reduce', params: ['range', 'wide'] },
    ],
    presets: [
      { name: 'Gentle vocal', params: { freq: 7000, threshold: -26, range: 6 } },
      { name: 'Strong de-ess', params: { freq: 6500, threshold: -32, range: 14 } },
      { name: 'Bright / airy voice', params: { freq: 8500, threshold: -24, range: 8 } },
      { name: 'Harsh T / sh', params: { freq: 5500, threshold: -30, range: 12 } },
    ],
    create(ctx) {
      const node = new AudioWorkletNode(ctx, 'ss-deesser', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const P = (k) => node.parameters.get(k);
      let meter = { gr: 0 };
      node.port.onmessage = (e) => e.data && (meter = e.data);
      return {
        input: node,
        output: node,
        setParam(id, v) {
          if (id === 'wide') P('wide').value = String(v) === 'Wide' ? 1 : 0;
          else if (P(id)) P(id).value = v;
        },
        getGainRange: () => ({ min: meter.gr, max: 0 }),
        destroy() {},
      };
    },
  });
})();
