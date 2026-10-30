/* Mastering effects: Limiter and Stereo Width. */
(function () {
  const dbToGain = (db) => Math.pow(10, db / 20);

  /** Hard-clip curve: keeps every sample inside +/- ceiling no matter what the compressor missed. */
  function clipCurve(ceiling) {
    const n = 4097;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.max(-ceiling, Math.min(ceiling, x));
    }
    return c;
  }

  Studio.registerPlugin({
    id: 'fx-limiter',
    name: 'Limiter',
    category: 'Mastering',
    description: 'Brick-wall limiter used by Master…',
    visual: { type: 'dynamics', threshold: 'ceiling', ratio: null, limiter: true, drive: 'gain' },
    presets: [
      { name: 'Default', params: {} },
      { name: 'Safe ceiling', params: { gain: 0, ceiling: -1, release: 0.15 } },
      { name: 'Louder', params: { gain: 6, ceiling: -0.5, release: 0.1 } },
    ],
    type: 'effect',
    params: [
      { id: 'gain', name: 'Input gain', unit: 'dB', min: -12, max: 24, step: 0.1, default: 0 },
      { id: 'ceiling', name: 'Ceiling', unit: 'dB', min: -6, max: 0, step: 0.1, default: -1 },
      { id: 'release', name: 'Release', unit: 's', min: 0.02, max: 0.6, default: 0.12, scale: 'log' },
    ],
    create(ctx) {
      const input = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.knee.value = 0;
      comp.ratio.value = 20;
      comp.attack.value = 0.001;
      const clip = ctx.createWaveShaper();
      clip.oversample = '2x';
      input.connect(comp);
      comp.connect(clip);
      return {
        input,
        output: clip,
        getReduction: () => [comp.reduction || 0],
        setParam(id, v) {
          const t = ctx.currentTime;
          if (id === 'gain') input.gain.setTargetAtTime(dbToGain(v), t, 0.01);
          else if (id === 'ceiling') {
            comp.threshold.value = v - 0.5;
            clip.curve = clipCurve(dbToGain(v));
          } else if (id === 'release') comp.release.value = v;
        },
        destroy() {},
      };
    },
  });

  Studio.registerPlugin({
    id: 'fx-width',
    name: 'Stereo Width',
    category: 'Utility',
    description: 'Narrow to mono or widen the stereo image',
    presets: [
      { name: 'Default', params: {} },
      { name: 'Mono', params: { width: 0 } },
      { name: 'Wide', params: { width: 1.5 } },
      { name: 'Extra wide', params: { width: 2 } },
    ],
    type: 'effect',
    params: [{ id: 'width', name: 'Width', min: 0, max: 2, step: 0.01, default: 1 }],
    create(ctx) {
      const input = ctx.createGain();
      input.channelCount = 2;
      input.channelCountMode = 'explicit';
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      input.connect(split);
      const gain = (v) => {
        const g = ctx.createGain();
        g.gain.value = v;
        return g;
      };
      const mid = gain(1);
      const side = gain(1);
      const sideInv = gain(-1);
      const mL = gain(0.5);
      const mR = gain(0.5);
      const sL = gain(0.5);
      const sR = gain(-0.5);
      split.connect(mL, 0);
      split.connect(mR, 1);
      split.connect(sL, 0);
      split.connect(sR, 1);
      mL.connect(mid);
      mR.connect(mid);
      sL.connect(side);
      sR.connect(side);
      const left = gain(1);
      const right = gain(1);
      mid.connect(left);
      side.connect(left);
      mid.connect(right);
      side.connect(sideInv);
      sideInv.connect(right);
      left.connect(merge, 0, 0);
      right.connect(merge, 0, 1);
      return {
        input,
        output: merge,
        setParam(id, v) {
          if (id === 'width') side.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
        },
        destroy() {},
      };
    },
  });
})();
