/* Session Auto-Tune — real-time pitch correction.
 * How it works: a YIN-style detector finds the sung pitch, we snap it to the nearest
 * note in the chosen key/scale, and a crossfaded granular pitch-shifter glides the voice
 * onto that note. Retune at 0 ms gives the hard "T-Pain" snap; higher is natural.
 * Monophonic (one voice at a time), which is what pitch correction is for. */
(function () {
  const Studio = window.Studio;

  Studio.registerWorklet(
    'ss-autotune',
    `
    const SCALES = [
      [0,1,2,3,4,5,6,7,8,9,10,11], // Chromatic
      [0,2,4,5,7,9,11],            // Major
      [0,2,3,5,7,8,10],            // Minor
      [0,3,5,7,10],                // Minor pentatonic
    ];
    class SsAutotune extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
        return [
          k('keyIdx', 0, 0, 11), k('scaleIdx', 1, 0, 3),
          k('strength', 1, 0, 1), k('retune', 20, 0, 500),
          k('mix', 1, 0, 1), k('inGain', 0, -24, 24), k('outGain', 0, -24, 24),
        ];
      }
      constructor() {
        super();
        this.sr = sampleRate;
        this.G = 1024;                 // grain size (pitch-shift window)
        this.RING = 4096;              // delay ring, must exceed G
        this.ringL = new Float32Array(this.RING);
        this.ringR = new Float32Array(this.RING);
        this.w = 0;                    // write index into the rings
        this.delay = 0;                // grain read offset (drives the shift)
        this.p = 1;                    // current pitch ratio (smoothed)
        this.pTarget = 1;              // ratio we are gliding toward
        this.corrS = 0;                // smoothed dry/wet amount (de-zippered, so it can't click)
        // detection
        this.WIN = 1024;
        this.HOP = 256;
        this.det = new Float32Array(this.WIN);
        this.dec = new Float32Array(this.WIN >> 1); // detector input at half rate (pitch range is far below 12 kHz)
        this.holdN = 0;                // samples we keep the last correction through an unvoiced gap
        this.lastRatio = 1;
        this.dpos = 0;                 // how many samples since last detection
        this.dfill = 0;                // samples written into det so far
        this.f0 = 0;                   // last detected pitch (Hz)
        this.note = -1;                // last snapped MIDI note, for the UI
        this.heldNote = -1;            // note we're currently snapped to (for hysteresis)
        this.cents = 0;
        this.rep = 0;
        this.tauMin = 32;              // ~1378 Hz
        this.tauMax = 500;             // ~88 Hz
        this.yin = new Float32Array(this.tauMax + 2);
      }
      detect() {
        // half-rate copy (pair average = gentle low-pass): the pitch search costs ~4x less CPU,
        // which is what made recording with Auto-Tune on several tracks lag and glitch
        const src = this.det, x = this.dec, N = this.WIN >> 1;
        for (let i = 0; i < N; i++) x[i] = 0.5 * (src[2 * i] + src[2 * i + 1]);
        const tauMax = Math.min(this.tauMax >> 1, (N >> 1) - 1), tauMin = this.tauMin >> 1, d = this.yin;
        const prevF0 = this.f0;
        // RMS gate: skip near-silence / breaths
        let rms = 0;
        for (let i = 0; i < N; i++) rms += x[i] * x[i];
        rms = Math.sqrt(rms / N);
        if (rms < 0.004) { this.f0 = 0; return; }
        // difference function
        d[0] = 1;
        let run = 0;
        for (let tau = 1; tau <= tauMax; tau++) {
          let sum = 0;
          for (let i = 0; i < N - tauMax; i++) { const dv = x[i] - x[i + tau]; sum += dv * dv; }
          run += sum;
          d[tau] = run > 0 ? sum * tau / run : 1; // cumulative mean normalized difference
        }
        // first dip below threshold, else global min
        let tau = -1;
        const thr = 0.12;
        for (let t = tauMin; t <= tauMax; t++) {
          if (d[t] < thr) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
        }
        if (tau < 0) { let best = tauMin; for (let t = tauMin; t <= tauMax; t++) if (d[t] < d[best]) best = t; if (d[best] > 0.5) { this.f0 = 0; return; } tau = best; }
        // parabolic interpolation around the dip
        const a = d[tau - 1] || d[tau], b = d[tau], c = d[tau + 1] || d[tau];
        const denom = a + c - 2 * b;
        let shift = denom !== 0 ? 0.5 * (a - c) / denom : 0;
        if (!(shift > -1 && shift < 1)) shift = 0; // never let interpolation run away (NaN/Infinity guard)
        let f = (this.sr / 2) / (tau + shift);
        // octave guard: a sudden jump of ~an octave from the last pitch is almost always a detection slip
        if (prevF0 > 0) {
          const r = f / prevF0;
          if (r > 1.88 && r < 2.12) f *= 0.5;
          else if (r > 0.47 && r < 0.53) f *= 2;
        }
        this.f0 = isFinite(f) && f > 40 && f < 2000 ? f : 0;
      }
      snap(keyIdx, scaleIdx) {
        const f0 = this.f0;
        if (!f0) return 1;
        const scale = SCALES[scaleIdx | 0] || SCALES[0];
        const midi = 69 + 12 * Math.log2(f0 / 440);
        // search nearby semitones for the closest note allowed by key+scale
        let best = Math.round(midi), bestDist = 1e9;
        for (let cand = Math.floor(midi) - 2; cand <= Math.ceil(midi) + 2; cand++) {
          const pc = (((cand - keyIdx) % 12) + 12) % 12;
          if (scale.indexOf(pc) < 0) continue;
          let dist = Math.abs(midi - cand);
          // hysteresis: hold the current note until the voice moves well past the boundary,
          // so sliding between two scale notes doesn't chatter back and forth (warble)
          if (cand === this.heldNote) dist -= 0.35;
          if (dist < bestDist) { bestDist = dist; best = cand; }
        }
        this.heldNote = best;
        const targetF0 = 440 * Math.pow(2, (best - 69) / 12);
        this.note = best;
        this.cents = Math.round(1200 * Math.log2(targetF0 / f0));
        return targetF0 / f0;
      }
      process(inputs, outputs, P) {
        const inp = inputs[0], out = outputs[0];
        if (!out || !out.length) return true;
        if (!inp || !inp.length) { for (let c = 0; c < out.length; c++) out[c].fill(0); return true; }
        const n = out[0].length, sr = this.sr, G = this.G, RING = this.RING;
        const keyIdx = P.keyIdx[0] | 0, scaleIdx = P.scaleIdx[0] | 0;
        const strength = P.strength[0], retune = P.retune[0], mix = P.mix[0];
        const inG = Math.pow(10, P.inGain[0] / 20), outG = Math.pow(10, P.outGain[0] / 20);
        // Per-sample glide toward the target ratio. NEVER use a hard 0ms step: the target only
        // updates every HOP (256 samples), so a 0ms "snap" re-steps the pitch ~172x/sec and buzzes.
        // Floor it at ~2.5ms — still reads as an instant T-Pain snap, but with no stepping crackle.
        const glideMs = Math.max(retune, 2.5);
        const aRe = Math.exp(-1 / (sr * glideMs / 1000));
        const inL = inp[0], inR = inp.length > 1 ? inp[1] : inp[0];
        const outL = out[0], outR = out.length > 1 ? out[1] : null;
        for (let i = 0; i < n; i++) {
          const dryL = inL[i] * inG, dryR = inR[i] * inG;
          // write into the delay rings
          this.ringL[this.w] = dryL;
          this.ringR[this.w] = dryR;
          // feed the detector (mono) and run it every HOP samples
          this.det[this.dfill++] = (dryL + dryR) * 0.5;
          if (this.dfill >= this.WIN) { // slide window: keep last WIN-HOP, make room
            this.det.copyWithin(0, this.HOP);
            this.dfill = this.WIN - this.HOP;
          }
          if (++this.dpos >= this.HOP) {
            this.dpos = 0;
            this.detect();
            const ratio = this.snap(keyIdx, scaleIdx);
            // apply strength in the cents domain, so 50% = halfway corrected
            if (this.f0) { this.pTarget = Math.pow(ratio, strength); this.lastRatio = this.pTarget; this.holdN = Math.round(sr * 0.08); }
            // short unvoiced gaps (consonants, breaths) keep the current correction instead of snapping
            // back to "no shift" and then re-correcting — that back-and-forth is the warble at word edges
            else if (this.holdN > 0) { this.holdN -= this.HOP; this.pTarget = this.lastRatio; }
            else this.pTarget = 1;
            if (!isFinite(this.pTarget)) this.pTarget = 1;
          }
          // glide the ratio toward the target (retune speed)
          this.p = aRe * this.p + (1 - aRe) * this.pTarget;
          if (!(this.p > 0.25 && this.p < 4)) this.p = 1; // self-heal: a bad value can never stick
          // advance the grain phase; delay drifts at (1 - p) and wraps over one grain
          this.delay = this.delay + (1 - this.p);
          this.delay = ((this.delay % G) + G) % G;
          const d2 = (this.delay + G / 2) % G;
          const win1 = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.delay) / G);
          const win2 = 0.5 - 0.5 * Math.cos((2 * Math.PI * d2) / G);
          const wetL = this.tap(this.ringL, this.w, this.delay, win1) + this.tap(this.ringL, this.w, d2, win2);
          const wetR = outR ? this.tap(this.ringR, this.w, this.delay, win1) + this.tap(this.ringR, this.w, d2, win2) : 0;
          // When almost no shift is needed (ratio ≈ 1) the delay stops moving and the two grain
          // taps become a static comb — which colours in-tune/held/unvoiced audio. Fade the wet
          // to dry across the last ~5 cents so those parts stay clean; real corrections are full wet.
          const corr = Math.min(1, Math.abs(1 - this.p) / 0.003);
          // one-pole smooth the dry/wet amount so switching between the dry and the (phase-shifted)
          // wet never steps — a hard change here is the main source of the crackle.
          this.corrS += (corr - this.corrS) * 0.02;
          const w = mix * this.corrS;
          // soft-clip the output so a hot vocal + gain can't hard-clip into crackle
          outL[i] = this.clip((dryL * (1 - w) + wetL * w) * outG);
          if (outR) outR[i] = this.clip((dryR * (1 - w) + wetR * w) * outG);
          this.w = (this.w + 1) % RING;
        }
        // tell the UI the current note, a few times a second
        if ((this.rep += n) > sr / 24) {
          this.rep = 0;
          this.port.postMessage({ note: this.f0 ? this.note : -1, cents: this.f0 ? this.cents : 0, f0: this.f0 });
        }
        return true;
      }
      // transparent below ~0.9, then smoothly limits (C1-continuous, so no click at the knee)
      clip(x) {
        const t = 0.9;
        if (x > t) return t + (1 - t) * Math.tanh((x - t) / (1 - t));
        if (x < -t) return -t + (1 - t) * Math.tanh((x + t) / (1 - t));
        return x;
      }
      // read the ring at (write - delay) with linear interpolation, scaled by a window
      tap(ring, w, delay, win) {
        const RING = this.RING;
        const pos = w - delay;
        const p0 = ((Math.floor(pos) % RING) + RING) % RING;
        const p1 = (p0 + 1) % RING;
        const frac = pos - Math.floor(pos);
        return (ring[p0] * (1 - frac) + ring[p1] * frac) * win;
      }
    }
    registerProcessor('ss-autotune', SsAutotune);
  `
  );

  const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALE_NAMES = ['Chromatic', 'Major', 'Minor', 'Minor pentatonic'];
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  Studio.registerPlugin({
    id: 'ss-autotune',
    name: 'Session Auto-Tune',
    type: 'effect',
    category: 'Pitch',
    color: '#f472b6',
    description: 'Snap vocals to a key — hard "T-Pain" tuning or natural correction',
    params: [
      { id: 'key', name: 'Key', type: 'select', options: KEYS, default: 'C' },
      { id: 'scale', name: 'Scale', type: 'select', options: SCALE_NAMES, default: 'Major' },
      { id: 'retune', name: 'Retune', unit: 'ms', min: 0, max: 250, step: 1, default: 18, scale: 'log' },
      { id: 'strength', name: 'Amount', unit: '%', min: 0, max: 100, step: 1, default: 100 },
      { id: 'mix', name: 'Mix', unit: '%', min: 0, max: 100, step: 1, default: 100 },
      { id: 'inGain', name: 'In', unit: 'dB', min: -24, max: 24, step: 0.1, default: 0 },
      { id: 'outGain', name: 'Out', unit: 'dB', min: -24, max: 24, step: 0.1, default: 0 },
    ],
    layout: [
      { title: 'Scale', params: ['key', 'scale'] },
      { title: 'Tuning', params: ['retune', 'strength'] },
      { title: 'Output', params: ['mix', 'inGain', 'outGain'] },
    ],
    presets: [
      { name: 'Hard tune (T-Pain)', params: { retune: 0, strength: 100, mix: 100, scale: 'Minor' } },
      { name: 'Natural correction', params: { retune: 60, strength: 85, mix: 100, scale: 'Major' } },
      { name: 'Subtle polish', params: { retune: 120, strength: 55, mix: 100 } },
      { name: 'Robot', params: { retune: 0, strength: 100, mix: 100, scale: 'Chromatic' } },
    ],
    create(ctx) {
      const node = new AudioWorkletNode(ctx, 'ss-autotune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const P = (k) => node.parameters.get(k);
      let live = { note: -1, cents: 0, f0: 0 };
      node.port.onmessage = (e) => e.data && (live = e.data);
      return {
        input: node,
        output: node,
        latencySeconds: () => 512 / ctx.sampleRate, // half a grain
        setParam(id, v) {
          if (id === 'key') P('keyIdx').value = Math.max(0, KEYS.indexOf(String(v)));
          else if (id === 'scale') P('scaleIdx').value = Math.max(0, SCALE_NAMES.indexOf(String(v)));
          else if (id === 'strength') P('strength').value = v / 100;
          else if (id === 'mix') P('mix').value = v / 100;
          else if (P(id)) P(id).value = v;
        },
        // for a future on-screen note readout
        getNote: () => (live.note >= 0 ? NOTE_NAMES[((live.note % 12) + 12) % 12] + (Math.floor(live.note / 12) - 1) : null),
        destroy() {},
      };
    },
  });
})();
