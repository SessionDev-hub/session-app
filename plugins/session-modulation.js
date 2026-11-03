/* Session modulation effects — Flanger and Chorus.
 * Both are modulated-delay effects built from native Web Audio nodes (a delay line whose
 * time is swept by an LFO), so they run identically in live playback and in WAV export.
 * Flanger: short delay + feedback = the classic jet-sweep. Chorus: longer, detuned voices
 * = a thicker, wider sound. */
(function () {
  const Studio = window.Studio;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------- Flanger ---------------- */
  Studio.registerPlugin({
    id: 'ss-flanger',
    name: 'Session Flanger',
    type: 'effect',
    category: 'Modulation',
    color: '#38bdf8',
    description: 'Classic jet-sweep flanger — a swept short delay with feedback',
    params: [
      { id: 'rate', name: 'Rate', unit: 'Hz', min: 0.05, max: 8, step: 0.01, default: 0.4, scale: 'log' },
      { id: 'depth', name: 'Depth', unit: 'ms', min: 0.1, max: 6, step: 0.1, default: 2.5 },
      { id: 'feedback', name: 'Feedback', unit: '%', min: 0, max: 90, step: 1, default: 45 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 50 },
    ],
    layout: [{ title: 'Sweep', params: ['rate', 'depth'] }, { title: 'Tone', params: ['feedback', 'mix'] }],
    presets: [
      { name: 'Jet sweep', params: { rate: 0.25, depth: 3.5, feedback: 70, mix: 50 } },
      { name: 'Subtle movement', params: { rate: 0.5, depth: 1.2, feedback: 20, mix: 35 } },
      { name: 'Metallic', params: { rate: 0.15, depth: 5, feedback: 85, mix: 50 } },
    ],
    create(ctx) {
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const delay = ctx.createDelay(0.05);
      const fb = ctx.createGain();
      const lfo = ctx.createOscillator();
      const depthGain = ctx.createGain();
      lfo.type = 'sine';

      input.connect(dry); dry.connect(output);
      input.connect(delay); delay.connect(wet); wet.connect(output);
      delay.connect(fb); fb.connect(delay); // feedback loop (legal: a DelayNode sits in it)
      lfo.connect(depthGain); depthGain.connect(delay.delayTime);
      try { lfo.start(); } catch (e) {}

      const st = { rate: 0.4, depth: 2.5, feedback: 0.45, mix: 0.5 };
      const now = () => ctx.currentTime;
      const apply = () => {
        const dep = st.depth / 1000;            // seconds
        lfo.frequency.value = st.rate;
        depthGain.gain.value = dep;              // LFO swings ±dep
        delay.delayTime.value = dep + 0.0006;    // centered so it never goes negative
        fb.gain.value = clamp(st.feedback, 0, 0.9);
        dry.gain.value = Math.cos((st.mix * Math.PI) / 2);
        wet.gain.value = Math.sin((st.mix * Math.PI) / 2);
      };
      apply();
      return {
        input, output,
        setParam(id, v) {
          if (id === 'rate') st.rate = v;
          else if (id === 'depth') st.depth = v;
          else if (id === 'feedback') st.feedback = v / 100;
          else if (id === 'mix') st.mix = v / 100;
          apply();
        },
        destroy() { try { lfo.stop(); } catch (e) {} },
      };
    },
  });

  /* ---------------- Chorus ---------------- */
  Studio.registerPlugin({
    id: 'ss-chorus',
    name: 'Session Chorus',
    type: 'effect',
    category: 'Modulation',
    color: '#a78bfa',
    description: 'Lush chorus — detuned voices that thicken and widen the sound',
    params: [
      { id: 'rate', name: 'Rate', unit: 'Hz', min: 0.05, max: 6, step: 0.01, default: 0.8, scale: 'log' },
      { id: 'depth', name: 'Depth', unit: 'ms', min: 1, max: 12, step: 0.1, default: 4 },
      { id: 'spread', name: 'Width', unit: '%', min: 0, max: 100, step: 1, default: 70 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 50 },
    ],
    layout: [{ title: 'Movement', params: ['rate', 'depth'] }, { title: 'Image', params: ['spread', 'mix'] }],
    presets: [
      { name: 'Lush vocals', params: { rate: 0.6, depth: 4, spread: 80, mix: 45 } },
      { name: 'Wide synth', params: { rate: 1.2, depth: 6, spread: 100, mix: 60 } },
      { name: 'Gentle double', params: { rate: 0.4, depth: 2.5, spread: 50, mix: 35 } },
    ],
    create(ctx) {
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      input.connect(dry); dry.connect(output);
      wet.connect(output);

      // two detuned voices, panned opposite for width
      const BASE = 0.018; // 18 ms center delay
      const voices = [
        { rate: 1.0, panDefault: -1 },
        { rate: 1.33, panDefault: 1 },
      ].map((cfg) => {
        const delay = ctx.createDelay(0.05);
        const lfo = ctx.createOscillator();
        const depthGain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        lfo.type = 'sine';
        input.connect(delay); delay.connect(pan); pan.connect(wet);
        lfo.connect(depthGain); depthGain.connect(delay.delayTime);
        try { lfo.start(Math.random() * 0.5); } catch (e) {}
        return { delay, lfo, depthGain, pan, cfg };
      });

      const st = { rate: 0.8, depth: 4, spread: 0.7, mix: 0.5 };
      const apply = () => {
        const dep = st.depth / 1000;
        voices.forEach((v) => {
          v.lfo.frequency.value = st.rate * v.cfg.rate;
          v.depthGain.gain.value = dep;
          v.delay.delayTime.value = BASE + dep + 0.0006;
          v.pan.pan.value = v.cfg.panDefault * st.spread;
        });
        dry.gain.value = Math.cos((st.mix * Math.PI) / 2);
        wet.gain.value = Math.sin((st.mix * Math.PI) / 2);
      };
      apply();
      return {
        input, output,
        setParam(id, v) {
          if (id === 'rate') st.rate = v;
          else if (id === 'depth') st.depth = v;
          else if (id === 'spread') st.spread = v / 100;
          else if (id === 'mix') st.mix = v / 100;
          apply();
        },
        destroy() { voices.forEach((v) => { try { v.lfo.stop(); } catch (e) {} }); },
      };
    },
  });
})();
