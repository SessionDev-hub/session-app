/* Session extra effects: Bitcrusher, Pitch Shifter, Formant Filter, Vibrato, Bass Enhancer,
 * Tape, Auto-Pan and Phaser. They're all built from Web Audio, so they run the same on Windows,
 * Mac and Android, and the same in live playback and WAV export. */
(function () {
  const Studio = window.Studio;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const dryWet = (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    input.connect(dry); dry.connect(output); wet.connect(output);
    const setMix = (m) => { dry.gain.value = Math.cos((m * Math.PI) / 2); wet.gain.value = Math.sin((m * Math.PI) / 2); };
    return { input, output, wet, setMix };
  };
  const passthrough = (ctx, why) => { console.warn('[' + why + '] worklet unavailable, passing audio through'); const g = ctx.createGain(); return { input: g, output: g, setParam() {}, destroy() {} }; };
  const k = (name, def, min, max) => `{ name: '${name}', defaultValue: ${def}, minValue: ${min}, maxValue: ${max}, automationRate: 'k-rate' }`;

  /* ================= Bitcrusher (worklet) ================= */
  Studio.registerWorklet('ss-crush', `
    class SsCrush extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [${k('bits', 8, 1, 16)}, ${k('rate', 11025, 300, 48000)}, ${k('mix', 1, 0, 1)}]; }
      constructor() { super(); this.held = []; this.ph = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0];
        if (!inp || !inp.length) return true;
        const n = inp[0].length;
        const levels = Math.pow(2, Math.round(p.bits[0]) - 1);
        const step = Math.min(1, p.rate[0] / sampleRate);
        const mix = p.mix[0];
        let ph = this.ph;
        for (let i = 0; i < n; i++) {
          ph += step;
          const grab = ph >= 1;
          if (grab) ph -= Math.floor(ph);
          for (let c = 0; c < out.length; c++) {
            const x = inp[c < inp.length ? c : inp.length - 1][i];
            if (grab || this.held[c] === undefined) this.held[c] = Math.round(x * levels) / levels;
            out[c][i] = x * (1 - mix) + this.held[c] * mix;
          }
        }
        this.ph = ph;
        return true;
      }
    }
    registerProcessor('ss-crush', SsCrush);`);

  Studio.registerPlugin({
    id: 'ss-bitcrusher',
    name: 'Session Bitcrusher',
    category: 'Distortion',
    color: '#f472b6',
    description: 'Lo-fi crunch — fewer bits and a lower sample rate for that retro, video-game grit',
    params: [
      { id: 'bits', name: 'Bits', min: 1, max: 16, step: 1, default: 8 },
      { id: 'rate', name: 'Sample rate', unit: 'Hz', min: 300, max: 48000, step: 1, default: 11025, scale: 'log' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Crush', params: ['bits', 'rate'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: '8-bit game', params: { bits: 6, rate: 8000, mix: 100 } },
      { name: 'Subtle grit', params: { bits: 10, rate: 22050, mix: 40 } },
      { name: 'Old sampler', params: { bits: 12, rate: 26040, mix: 100 } },
      { name: 'Destroyed', params: { bits: 3, rate: 2500, mix: 100 } },
    ],
    create(ctx) {
      let node;
      try { node = new AudioWorkletNode(ctx, 'ss-crush', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' }); } catch (e) { return passthrough(ctx, 'bitcrusher'); }
      return { input: node, output: node, setParam(id, v) { const p = node.parameters.get(id); if (p) p.value = id === 'mix' ? v / 100 : v; } };
    },
  });

  /* ================= Pitch Shifter (worklet: two crossfaded read heads) ================= */
  Studio.registerWorklet('ss-pitch', `
    /* Pitch shifter with waveform-matched splices.
     * One read head plays the recent past at the new speed. When it drifts too far from "now", a second
     * head takes over — placed where its waveform lines up best with the old one (cross-correlation), then
     * a short crossfade hands over. Because the two heads are in phase, nothing cancels or warbles: steady
     * notes stay steady and voices keep their body. Also used by the Octaver and the Harmonizer. */
    class SsPitch extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [${k('semis', 0, -12, 12)}, ${k('cents', 0, -100, 100)}, ${k('grain', 60, 20, 120)}, ${k('mix', 1, 0, 1)}]; }
      constructor() {
        super();
        this.size = 1 << 16; this.mask = this.size - 1;
        this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
        this.mono = new Float32Array(this.size);
        this.w = 0; this.n = 0;
        this.head = -1; this.next = -1; this.xf = 0; this.XF = 0;
      }
      rd(b, pos) { const i = Math.floor(pos), f = pos - i; const a = b[i & this.mask], c = b[(i + 1) & this.mask]; return a + (c - a) * f; }
      // best place for a new head near "guess", whose next L samples (read at rate r) match the current head's
      match(cur, guess, range, L, r) {
        const m = this.mono, M = this.mask, step = 2, cnt = L >> 1;
        const seg = this.seg && this.seg.length >= cnt ? this.seg : (this.seg = new Float32Array(cnt));
        for (let k = 0; k < cnt; k++) seg[k] = this.rd(m, cur + k * step * r);
        const score = (cand, exact) => {
          let xy = 0, yy = 1e-9;
          for (let k = 0; k < cnt; k++) { const b = exact ? this.rd(m, cand + k * step * r) : m[Math.round(cand + k * step * r) & M]; xy += seg[k] * b; yy += b * b; }
          return xy / Math.sqrt(yy);
        };
        // coarse pass every 6 samples, then a fine pass around the winner
        let best = guess, bs = -Infinity;
        for (let d = -range; d <= range; d += 6) { const sc = score(guess + d, false); if (sc > bs) { bs = sc; best = guess + d; } }
        const c0 = best; bs = -Infinity;
        for (let d = -6; d <= 6; d++) { const sc = score(c0 + d, true); if (sc > bs) { bs = sc; best = c0 + d; } }
        return best;
      }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0];
        if (!inp || !inp.length) return true;
        const n = inp[0].length, chans = out.length;
        const r = Math.pow(2, (p.semis[0] + p.cents[0] / 100) / 12);
        const mix = p.mix[0];
        const W = Math.max(256, Math.round(p.grain[0] / 1000 * sampleRate));   // how far the head may drift
        const XF = Math.min(1024, Math.max(128, Math.round(W * 0.35)));         // handover crossfade
        const L = Math.min(XF, 512);                                            // samples compared when matching
        const minD = Math.ceil(L * Math.max(1, r) + 64), maxD = minD + W;
        const range = Math.round(Math.min(0.012 * sampleRate, W * 0.4));        // search ±12 ms
        for (let i = 0; i < n; i++) {
          const w = this.w, wi = w & this.mask;   // w counts up forever; wi is its slot in the ring
          let ms = 0;
          for (let c = 0; c < 2; c++) { const x = inp[Math.min(c, inp.length - 1)][i]; this.buf[c][wi] = x; ms += x; }
          this.mono[wi] = ms * 0.5;
          this.n++;
          if (this.head < 0) this.head = w - (r < 1 ? minD : maxD);
          const delay = w - this.head;
          // start a handover when the head drifts out of range (and there is enough history to search)
          if (this.xf === 0 && Math.abs(r - 1) > 1e-4 && this.n > maxD + range + 2 * L && (delay > maxD || delay < minD)) {
            const guess = r < 1 ? w - minD - range : w - maxD + range;
            this.next = this.match(this.head, guess, range, L, r);
            this.XF = XF; this.xf = XF;
          }
          let a = 0;
          if (this.xf > 0) a = 1 - this.xf / this.XF;
          for (let c = 0; c < chans; c++) {
            const b = this.buf[c];
            let y = this.rd(b, this.head);
            if (this.xf > 0) y = y * (1 - a) + this.rd(b, this.next) * a;
            const x = inp[Math.min(c, inp.length - 1)][i];
            out[c][i] = Math.abs(r - 1) < 1e-4 ? x : x * (1 - mix) + y * mix;
          }
          this.head += r;
          if (this.xf > 0) { this.next += r; if (--this.xf === 0) this.head = this.next; }
          this.w = w + 1;
        }
        return true;
      }
    }
    registerProcessor('ss-pitch', SsPitch);`);

  Studio.registerPlugin({
    id: 'ss-pitchshift',
    name: 'Session Pitch Shifter',
    category: 'Pitch',
    color: '#22d3ee',
    description: 'Shift a voice or sound up or down — chipmunk, deep voice, or blended harmonies',
    params: [
      { id: 'semis', name: 'Semitones', unit: 'st', min: -12, max: 12, step: 1, default: 0 },
      { id: 'cents', name: 'Fine', unit: 'ct', min: -100, max: 100, step: 1, default: 0 },
      { id: 'grain', name: 'Smoothness', unit: 'ms', min: 20, max: 120, step: 1, default: 60 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Pitch', params: ['semis', 'cents'] }, { title: 'Sound', params: ['grain', 'mix'] }],
    presets: [
      { name: 'Deep voice', params: { semis: -5, cents: 0, grain: 70, mix: 100 } },
      { name: 'Chipmunk', params: { semis: 7, cents: 0, grain: 40, mix: 100 } },
      { name: 'Octave down layer', params: { semis: -12, cents: 0, grain: 80, mix: 40 } },
      { name: 'Fifth harmony', params: { semis: 7, cents: 0, grain: 60, mix: 35 } },
      { name: 'Wide detune', params: { semis: 0, cents: 12, grain: 50, mix: 45 } },
    ],
    create(ctx) {
      let node;
      try { node = new AudioWorkletNode(ctx, 'ss-pitch', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' }); } catch (e) { return passthrough(ctx, 'pitch shifter'); }
      return { input: node, output: node, setParam(id, v) { const p = node.parameters.get(id); if (p) p.value = id === 'mix' ? v / 100 : v; } };
    },
  });

  /* ================= Formant / Vowel filter ================= */
  // formant centres (Hz) and levels for each vowel, roughly an adult voice
  const VOWELS = { A: [[800, 1], [1150, 0.5], [2900, 0.25]], E: [[400, 1], [2100, 0.45], [2800, 0.3]], I: [[300, 1], [2300, 0.35], [3000, 0.3]], O: [[450, 1], [800, 0.5], [2830, 0.2]], U: [[325, 1], [700, 0.35], [2530, 0.15]] };
  const VORDER = ['A', 'E', 'I', 'O', 'U'];
  Studio.registerPlugin({
    id: 'ss-formant',
    name: 'Session Formant Filter',
    category: 'Filter',
    color: '#fb923c',
    description: 'Talk-box style vowel filter — morph between A, E, I, O, U and shift the voice character',
    params: [
      { id: 'vowel', name: 'Vowel', min: 0, max: 4, step: 0.01, default: 0 },
      { id: 'shift', name: 'Character', unit: 'st', min: -12, max: 12, step: 0.5, default: 0 },
      { id: 'q', name: 'Resonance', min: 2, max: 20, step: 0.1, default: 8 },
      { id: 'rate', name: 'Auto-morph', unit: 'Hz', min: 0, max: 4, step: 0.01, default: 0 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 70 },
    ],
    layout: [{ title: 'Vowel', params: ['vowel', 'shift', 'q'] }, { title: 'Motion', params: ['rate', 'mix'] }],
    presets: [
      { name: 'Talk box "A"', params: { vowel: 0, shift: 0, q: 9, rate: 0, mix: 80 } },
      { name: 'Wah-wah yoi', params: { vowel: 2, shift: 0, q: 10, rate: 1.2, mix: 75 } },
      { name: 'Giant voice', params: { vowel: 3, shift: -6, q: 6, rate: 0, mix: 55 } },
      { name: 'Tiny voice', params: { vowel: 1, shift: 7, q: 6, rate: 0, mix: 55 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const bands = [0, 1, 2].map(() => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; const g = ctx.createGain(); dw.input.connect(f); f.connect(g); g.connect(dw.wet); return { f, g }; });
      const makeup = 2.5;
      const st = { vowel: 0, shift: 0, q: 8, rate: 0, mix: 0.7 };
      let timer = null, t0 = 0;
      const setVowel = (pos, when) => {
        const i = clamp(Math.floor(pos), 0, 3), fr = clamp(pos - i, 0, 1);
        const a = VOWELS[VORDER[i]], b = VOWELS[VORDER[Math.min(4, i + 1)]];
        const mul = Math.pow(2, st.shift / 12);
        bands.forEach((bd, j) => {
          const f = (a[j][0] + (b[j][0] - a[j][0]) * fr) * mul, lv = a[j][1] + (b[j][1] - a[j][1]) * fr;
          bd.f.frequency.setTargetAtTime(clamp(f, 60, 16000), when || ctx.currentTime, 0.02);
          bd.f.Q.value = st.q;
          bd.g.gain.value = lv * makeup;
        });
      };
      const apply = () => {
        dw.setMix(st.mix);
        if (timer) { clearInterval(timer); timer = null; }
        // auto-morph runs only live; export renders the static vowel (an OfflineAudioContext has no timers)
        if (st.rate > 0 && typeof ctx.startRendering !== 'function') {
          t0 = ctx.currentTime;
          timer = setInterval(() => { const ph = (ctx.currentTime - t0) * st.rate; setVowel(2 + 2 * Math.sin(ph * 2 * Math.PI)); }, 25);
        } else setVowel(st.vowel);
      };
      apply();
      return {
        input: dw.input, output: dw.output,
        setParam(id, v) { st[id] = id === 'mix' ? v / 100 : v; apply(); },
        destroy() { if (timer) clearInterval(timer); },
      };
    },
  });

  /* ================= Vibrato ================= */
  Studio.registerPlugin({
    id: 'ss-vibrato',
    name: 'Session Vibrato',
    category: 'Modulation',
    color: '#c084fc',
    description: 'Pitch wobble — from a singer’s natural vibrato to a warped tape drift',
    params: [
      { id: 'rate', name: 'Rate', unit: 'Hz', min: 0.1, max: 12, step: 0.01, default: 5.5, scale: 'log' },
      { id: 'depth', name: 'Depth', unit: 'ct', min: 0, max: 100, step: 1, default: 25 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Wobble', params: ['rate', 'depth'] }, { title: 'Blend', params: ['mix'] }],
    presets: [
      { name: 'Singer vibrato', params: { rate: 5.5, depth: 25, mix: 100 } },
      { name: 'Warped tape', params: { rate: 0.6, depth: 40, mix: 100 } },
      { name: 'Seasick', params: { rate: 1.5, depth: 90, mix: 100 } },
      { name: 'Light shimmer', params: { rate: 7, depth: 12, mix: 60 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const delay = ctx.createDelay(0.1), lfo = ctx.createOscillator(), dep = ctx.createGain();
      lfo.type = 'sine';
      dw.input.connect(delay); delay.connect(dw.wet);
      lfo.connect(dep); dep.connect(delay.delayTime);
      try { lfo.start(); } catch (e) {}
      const st = { rate: 5.5, depth: 25, mix: 1 };
      const apply = () => {
        // pitch deviation from a swept delay: Δf/f ≈ 2π·rate·amp, so amp = (2^(c/1200) − 1) / (2π·rate)
        const amp = (Math.pow(2, st.depth / 1200) - 1) / (2 * Math.PI * st.rate);
        lfo.frequency.value = st.rate;
        dep.gain.value = amp;
        delay.delayTime.value = amp + 0.002;
        dw.setMix(st.mix);
      };
      apply();
      return { input: dw.input, output: dw.output, setParam(id, v) { st[id] = id === 'mix' ? v / 100 : v; apply(); }, destroy() { try { lfo.stop(); } catch (e) {} } };
    },
  });

  /* ================= Bass Enhancer ================= */
  Studio.registerPlugin({
    id: 'ss-bass',
    name: 'Session Bass Enhancer',
    category: 'EQ',
    color: '#f59e0b',
    description: 'Bigger low end that still shows up on phone speakers — adds harmonics and a sub boost',
    params: [
      { id: 'freq', name: 'Focus', unit: 'Hz', min: 40, max: 200, step: 1, default: 90, scale: 'log' },
      { id: 'harm', name: 'Harmonics', unit: '%', min: 0, max: 100, step: 1, default: 40 },
      { id: 'sub', name: 'Sub boost', unit: 'dB', min: 0, max: 12, step: 0.5, default: 3 },
      { id: 'output', name: 'Output', unit: 'dB', min: -12, max: 6, step: 0.5, default: 0 },
    ],
    layout: [{ title: 'Low end', params: ['freq', 'sub'] }, { title: 'Weight', params: ['harm', 'output'] }],
    presets: [
      { name: 'Phone-speaker 808', params: { freq: 60, harm: 65, sub: 2, output: -1 } },
      { name: 'Warm bass', params: { freq: 100, harm: 30, sub: 4, output: -1 } },
      { name: 'Chest voice', params: { freq: 150, harm: 20, sub: 2, output: 0 } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain();
      const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(3 * x) / Math.tanh(3); }
      shaper.curve = curve; shaper.oversample = '2x';
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
      const harm = ctx.createGain();
      input.connect(shelf); shelf.connect(output);
      input.connect(lp); lp.connect(shaper); shaper.connect(hp); hp.connect(harm); harm.connect(output);
      const st = { freq: 90, harm: 0.4, sub: 3, output: 0 };
      const apply = () => {
        shelf.frequency.value = st.freq; shelf.gain.value = st.sub;
        lp.frequency.value = st.freq * 1.5;
        hp.frequency.value = st.freq * 1.6; // keep only the new harmonics, not the original lows
        harm.gain.value = st.harm * 1.2;
        output.gain.value = Math.pow(10, st.output / 20);
      };
      apply();
      return { input, output, setParam(id, v) { st[id] = id === 'harm' ? v / 100 : v; apply(); } };
    },
  });

  /* ================= Tape ================= */
  Studio.registerPlugin({
    id: 'ss-tape',
    name: 'Session Tape',
    category: 'Creative',
    color: '#a3e635',
    description: 'Old-tape character — warm saturation, wobbly wow & flutter and rolled-off highs',
    params: [
      { id: 'drive', name: 'Saturation', unit: '%', min: 0, max: 100, step: 1, default: 35 },
      { id: 'wow', name: 'Wow & flutter', unit: '%', min: 0, max: 100, step: 1, default: 30 },
      { id: 'tone', name: 'Tone', unit: 'Hz', min: 2000, max: 18000, step: 10, default: 9000, scale: 'log' },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    ],
    layout: [{ title: 'Tape', params: ['drive', 'wow'] }, { title: 'Tone', params: ['tone', 'mix'] }],
    presets: [
      { name: 'Warm cassette', params: { drive: 40, wow: 30, tone: 8000, mix: 100 } },
      { name: 'Lo-fi beat tape', params: { drive: 55, wow: 60, tone: 5000, mix: 100 } },
      { name: 'Subtle analog', params: { drive: 20, wow: 8, tone: 15000, mix: 100 } },
      { name: 'Broken VHS', params: { drive: 70, wow: 100, tone: 3500, mix: 100 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const pre = ctx.createGain(), shaper = ctx.createWaveShaper(), post = ctx.createGain();
      const delay = ctx.createDelay(0.1), wow = ctx.createOscillator(), wowG = ctx.createGain(), flut = ctx.createOscillator(), flutG = ctx.createGain();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 35;
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = x >= 0 ? Math.tanh(1.6 * x) / Math.tanh(1.6) : Math.tanh(1.9 * x) / Math.tanh(1.9); } // slightly asymmetric = tape-like even harmonics
      shaper.curve = curve; shaper.oversample = '2x';
      wow.frequency.value = 0.55; flut.frequency.value = 7.3;
      wow.connect(wowG); flut.connect(flutG); wowG.connect(delay.delayTime); flutG.connect(delay.delayTime);
      try { wow.start(); flut.start(); } catch (e) {}
      dw.input.connect(pre); pre.connect(shaper); shaper.connect(post); post.connect(delay); delay.connect(lp); lp.connect(hp); hp.connect(dw.wet);
      const st = { drive: 0.35, wow: 0.3, tone: 9000, mix: 1 };
      const apply = () => {
        const g = 1 + st.drive * 5;
        // unity for quiet audio (the curve's slope at 0 is ~1.74); louder parts get squashed into warm saturation
        pre.gain.value = g; post.gain.value = 1 / (g * 1.74);
        wowG.gain.value = st.wow * 0.0016; flutG.gain.value = st.wow * 0.00012;
        delay.delayTime.value = 0.004 + st.wow * 0.0018;
        lp.frequency.value = st.tone;
        dw.setMix(st.mix);
      };
      apply();
      return { input: dw.input, output: dw.output, setParam(id, v) { st[id] = id === 'tone' ? v : v / 100; apply(); }, destroy() { try { wow.stop(); flut.stop(); } catch (e) {} } };
    },
  });

  /* ================= Auto-Pan ================= */
  Studio.registerPlugin({
    id: 'ss-autopan',
    name: 'Session Auto-Pan',
    category: 'Modulation',
    color: '#34d399',
    description: 'Sweeps the sound left and right — great on ad-libs, hats and pads',
    params: [
      { id: 'rate', name: 'Rate', unit: 'Hz', min: 0.05, max: 10, step: 0.01, default: 0.5, scale: 'log' },
      { id: 'depth', name: 'Width', unit: '%', min: 0, max: 100, step: 1, default: 70 },
      { id: 'shape', name: 'Shape', type: 'select', options: ['Smooth', 'Hard'], default: 'Smooth' },
    ],
    layout: [{ title: 'Motion', params: ['rate', 'depth', 'shape'] }],
    presets: [
      { name: 'Slow drift', params: { rate: 0.25, depth: 60, shape: 'Smooth' } },
      { name: 'Ping-pong 1/8', params: { rate: 2, depth: 90, shape: 'Hard' } },
      { name: 'Headphone swirl', params: { rate: 0.8, depth: 100, shape: 'Smooth' } },
    ],
    create(ctx) {
      const input = ctx.createGain(), output = ctx.createGain(), pan = ctx.createStereoPanner(), lfo = ctx.createOscillator(), dep = ctx.createGain();
      input.connect(pan); pan.connect(output); lfo.connect(dep); dep.connect(pan.pan);
      try { lfo.start(); } catch (e) {}
      const st = { rate: 0.5, depth: 0.7, shape: 'Smooth' };
      const apply = () => { lfo.frequency.value = st.rate; lfo.type = st.shape === 'Hard' ? 'square' : 'sine'; dep.gain.value = st.depth; };
      apply();
      return { input, output, setParam(id, v) { st[id] = id === 'depth' ? v / 100 : v; apply(); }, destroy() { try { lfo.stop(); } catch (e) {} } };
    },
  });

  /* ================= Phaser ================= */
  Studio.registerPlugin({
    id: 'ss-phaser',
    name: 'Session Phaser',
    category: 'Modulation',
    color: '#60a5fa',
    description: 'Swirling phase sweep — classic on synths, guitars and dreamy vocals',
    params: [
      { id: 'rate', name: 'Rate', unit: 'Hz', min: 0.05, max: 8, step: 0.01, default: 0.4, scale: 'log' },
      { id: 'depth', name: 'Depth', unit: '%', min: 0, max: 100, step: 1, default: 70 },
      { id: 'feedback', name: 'Feedback', unit: '%', min: 0, max: 85, step: 1, default: 40 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 50 },
    ],
    layout: [{ title: 'Sweep', params: ['rate', 'depth'] }, { title: 'Tone', params: ['feedback', 'mix'] }],
    presets: [
      { name: 'Slow swirl', params: { rate: 0.2, depth: 80, feedback: 50, mix: 50 } },
      { name: 'Fast warble', params: { rate: 3, depth: 50, feedback: 30, mix: 45 } },
      { name: 'Deep space', params: { rate: 0.1, depth: 100, feedback: 75, mix: 55 } },
    ],
    create(ctx) {
      const dw = dryWet(ctx);
      const stages = [0, 1, 2, 3, 4, 5].map(() => { const f = ctx.createBiquadFilter(); f.type = 'allpass'; f.Q.value = 0.7; return f; });
      const lfo = ctx.createOscillator(), fb = ctx.createGain(), fbDelay = ctx.createDelay(0.01);
      fbDelay.delayTime.value = 0.0005;
      dw.input.connect(stages[0]);
      for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1]);
      const last = stages[stages.length - 1];
      last.connect(dw.wet);
      last.connect(fb); fb.connect(fbDelay); fbDelay.connect(stages[0]); // feedback loop (a DelayNode keeps it legal)
      const deps = stages.map((f) => { const g = ctx.createGain(); lfo.connect(g); g.connect(f.frequency); return g; });
      try { lfo.start(); } catch (e) {}
      const st = { rate: 0.4, depth: 0.7, feedback: 0.4, mix: 0.5 };
      const apply = () => {
        lfo.frequency.value = st.rate;
        stages.forEach((f, i) => { const c = 400 * Math.pow(1.6, i); f.frequency.value = c; deps[i].gain.value = c * 0.85 * st.depth; });
        fb.gain.value = st.feedback;
        dw.setMix(st.mix);
      };
      apply();
      return { input: dw.input, output: dw.output, setParam(id, v) { st[id] = v / 100; if (id === 'rate') st.rate = v; apply(); }, destroy() { try { lfo.stop(); } catch (e) {} } };
    },
  });
})();
