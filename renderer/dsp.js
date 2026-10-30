/* Signal-processing helpers (pure functions on Float32Arrays, no DOM, no audio device):
 *   detectKey      – musical key of a recording (chromagram + Krumhansl-Schmuckler profiles)
 *   pitchTrack     – monophonic pitch contour (YIN)
 *   autoTune       – pitch correction to a scale (pitch-synchronous overlap-add)
 *   measureLoudness – integrated loudness (LUFS, ITU-R BS.1770-4 / EBU R128) and peak level
 */
(function () {
  const S = window.Studio;
  const D = (S.dsp = {});

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  D.NOTE_NAMES = NOTE_NAMES;
  D.SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mod12 = (n) => ((n % 12) + 12) % 12;

  /* ---------- helpers ---------- */

  /** Average all channels into one Float32Array. */
  D.toMono = (chans) => {
    if (chans.length === 1) return chans[0];
    const n = chans[0].length;
    const out = new Float32Array(n);
    for (const c of chans) for (let i = 0; i < n; i++) out[i] += c[i];
    const k = 1 / chans.length;
    for (let i = 0; i < n; i++) out[i] *= k;
    return out;
  };

  /** In-place radix-2 FFT. re/im length must be a power of two. */
  D.fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k;
          const b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
  };

  /* ---------- key detection ---------- */

  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function pearson(a, b) {
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < 12; i++) {
      ma += a[i];
      mb += b[i];
    }
    ma /= 12;
    mb /= 12;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < 12; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
  }

  /** Pitch-class energy (12 values, C..B) of a mono signal. */
  D.chromagram = (x, sr) => {
    const N = 16384;
    const chroma = new Float64Array(12);
    if (x.length < N) {
      const pad = new Float32Array(N);
      pad.set(x);
      x = pad;
    }
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const frames = Math.min(240, Math.max(1, Math.floor((x.length - N) / (N / 2)) + 1));
    const step = frames > 1 ? (x.length - N) / (frames - 1) : 0;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const kmin = Math.ceil((80 * N) / sr);
    const kmax = Math.min(N / 2 - 2, Math.floor((2000 * N) / sr));
    let used = 0;
    for (let f = 0; f < frames; f++) {
      const p = Math.floor(f * step);
      let e = 0;
      for (let i = 0; i < N; i++) {
        const v = x[p + i];
        e += v * v;
        re[i] = v * win[i];
        im[i] = 0;
      }
      if (Math.sqrt(e / N) < 0.002) continue; // silence
      D.fft(re, im);
      const mag = new Float32Array(kmax + 2);
      let top = 0;
      for (let k = kmin - 1; k <= kmax + 1; k++) {
        mag[k] = Math.hypot(re[k], im[k]);
        if (k >= kmin && k <= kmax) top = Math.max(top, mag[k]);
      }
      if (top <= 0) continue;
      used++;
      for (let k = kmin; k <= kmax; k++) {
        const m = mag[k];
        if (m < top * 0.04 || m < mag[k - 1] || m <= mag[k + 1]) continue; // spectral peaks only
        // parabolic refinement of the peak frequency
        const a = Math.log(mag[k - 1] + 1e-12);
        const b = Math.log(m + 1e-12);
        const c = Math.log(mag[k + 1] + 1e-12);
        const den = a - 2 * b + c;
        const off = den < 0 ? (0.5 * (a - c)) / den : 0;
        const freq = ((k + off) * sr) / N;
        const midi = 69 + 12 * Math.log2(freq / 440);
        chroma[mod12(Math.round(midi))] += m / top;
      }
    }
    return { chroma: Array.from(chroma), frames: used };
  };

  /**
   * Find the musical key. Returns { tonic: 0-11, mode: 'major'|'minor', name: 'A minor',
   * confidence: 0-1, ranking: [{tonic, mode, name, score}...] } or null if there is no usable audio.
   */
  D.detectKey = (x, sr) => {
    const { chroma, frames } = D.chromagram(x, sr);
    if (!frames) return null;
    const cands = [];
    for (let t = 0; t < 12; t++) {
      for (const [mode, prof] of [
        ['major', KK_MAJOR],
        ['minor', KK_MINOR],
      ]) {
        const rot = Array.from({ length: 12 }, (_, i) => prof[mod12(i - t)]);
        cands.push({ tonic: t, mode, name: NOTE_NAMES[t] + ' ' + mode, score: pearson(chroma, rot) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const gap = cands[0].score - cands[1].score;
    const confidence = Math.max(0, Math.min(1, cands[0].score * 0.7 + gap * 3));
    return Object.assign({}, cands[0], { confidence, ranking: cands.slice(0, 4) });
  };

  /* ---------- pitch tracking (YIN) ---------- */

  /**
   * Pitch contour of a monophonic signal. Returns { f0: Float32Array (Hz, 0 = unvoiced),
   * hop, offset } where frame i is centred at sample `offset + i * hop` of the input.
   */
  D.pitchTrack = (x, sr, { fmin = 70, fmax = 900 } = {}) => {
    const n = Math.max(1, Math.round(sr / 11025)); // decimate to ~11 kHz
    const srd = sr / n;
    const M = Math.floor(x.length / n);
    const d = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += x[i * n + j];
      d[i] = s / n;
    }
    const W = 512;
    const hop = 128;
    const tauMin = Math.max(2, Math.floor(srd / fmax));
    const tauMax = Math.min(W - 1, Math.ceil(srd / fmin));
    const frames = Math.max(0, Math.floor((M - W - tauMax) / hop) + 1);
    const f0 = new Float32Array(frames);
    const diff = new Float32Array(tauMax + 2);
    const cm = new Float32Array(tauMax + 2);
    for (let f = 0; f < frames; f++) {
      const p = f * hop;
      let e = 0;
      for (let j = 0; j < W; j++) e += d[p + j] * d[p + j];
      if (Math.sqrt(e / W) < 0.004) continue;
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        let s = 0;
        for (let j = 0; j < W; j++) {
          const v = d[p + j] - d[p + j + tau];
          s += v * v;
        }
        diff[tau] = s;
      }
      let run = 0;
      cm[0] = 1;
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        run += diff[tau];
        cm[tau] = run > 0 ? (diff[tau] * tau) / run : 1;
      }
      let tau = -1;
      for (let t = tauMin; t <= tauMax; t++) {
        if (cm[t] < 0.15) {
          while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++;
          tau = t;
          break;
        }
      }
      if (tau < 0) continue;
      const a = cm[tau - 1];
      const b = cm[tau];
      const c = cm[tau + 1];
      const den = a - 2 * b + c;
      const off = den > 1e-9 ? (0.5 * (a - c)) / den : 0;
      f0[f] = srd / (tau + Math.max(-1, Math.min(1, off)));
    }
    // clean up: median filter in the log domain, drop tiny voiced islands
    const clean = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      if (!f0[i]) continue;
      const w = [];
      for (let k = -2; k <= 2; k++) if (f0[i + k] > 0) w.push(Math.log2(f0[i + k]));
      w.sort((p, q) => p - q);
      clean[i] = Math.pow(2, w[w.length >> 1]);
    }
    for (let i = 0; i < frames; ) {
      if (!clean[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < frames && clean[j]) j++;
      if (j - i < 3) for (let k = i; k < j; k++) clean[k] = 0;
      i = j;
    }
    return { f0: clean, hop: hop * n, offset: (W / 2) * n };
  };

  /* ---------- auto-tune ---------- */

  const hannCache = new Map();
  function hann(L) {
    let w = hannCache.get(L);
    if (!w) {
      w = new Float32Array(L);
      for (let i = 0; i < L; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / L);
      hannCache.set(L, w);
      if (hannCache.size > 400) hannCache.delete(hannCache.keys().next().value);
    }
    return w;
  }

  /** Allowed pitch classes for a key, e.g. { tonic: 9, mode: 'minor' } or { mode: 'chromatic' }. */
  D.scaleSet = (key) => {
    const steps = D.SCALES[(key && key.mode) || 'chromatic'] || D.SCALES.chromatic;
    const tonic = (key && key.tonic) || 0;
    return new Set(steps.map((s) => mod12(s + tonic)));
  };

  /** Nearest allowed note (MIDI number, fractional input) with a little hysteresis to stop flutter. */
  function nearestNote(midi, allowed, prev) {
    if (prev != null && Math.abs(midi - prev) < 0.62) return prev;
    const base = Math.round(midi);
    let best = base;
    let bd = Infinity;
    for (let n = base - 3; n <= base + 3; n++) {
      if (!allowed.has(mod12(n))) continue;
      const dist = Math.abs(n - midi);
      if (dist < bd) {
        bd = dist;
        best = n;
      }
    }
    return best;
  }

  /**
   * Pitch-correct audio to a scale.
   *   channels : Float32Array[]  (one per channel, all the same length)
   *   opts     : { key: {tonic, mode}|null (null = chromatic), speed: ms (0 = instant, ~25 = hard,
   *                ~150 = natural), strength: 0..1, onProgress(0..1) }
   * Returns { channels: Float32Array[], stats: { voicedFraction, medianCents, notes } }.
   * Works best on a single voice or instrument (monophonic).
   */
  D.autoTune = async (channels, sr, opts = {}) => {
    const { key = null, speed = 20, strength = 1, onProgress } = opts;
    const N = channels[0].length;
    const mono = D.toMono(channels);
    const allowed = D.scaleSet(key);
    if (onProgress) onProgress(0.05);
    await tick();
    const tr = D.pitchTrack(mono, sr);
    if (onProgress) onProgress(0.5);
    await tick();

    // 1. per-frame correction, in semitones
    const F = tr.f0.length;
    const shift = new Float32Array(F);
    let prevNote = null;
    let smooth = 0;
    const alpha = speed <= 0 ? 1 : 1 - Math.exp(-(tr.hop / sr) / (speed / 1000));
    let voiced = 0;
    const devs = [];
    for (let i = 0; i < F; i++) {
      if (!tr.f0[i]) {
        prevNote = null;
        smooth = 0;
        continue;
      }
      voiced++;
      const midi = 69 + 12 * Math.log2(tr.f0[i] / 440);
      const note = nearestNote(midi, allowed, prevNote);
      prevNote = note;
      const want = (note - midi) * strength;
      smooth += (want - smooth) * alpha;
      shift[i] = smooth;
      devs.push(Math.abs(note - midi) * 100);
    }
    devs.sort((a, b) => a - b);

    // 2. grain list: where to read from, where to write to, how long
    const frameAt = (t) => (t - tr.offset) / tr.hop;
    const infoAt = (t) => {
      const fi = frameAt(t);
      const i = Math.round(fi);
      if (i < 0 || i >= F || !tr.f0[i]) return null;
      const lo = Math.max(0, Math.min(F - 1, Math.floor(fi)));
      const hi = Math.min(F - 1, lo + 1);
      const fr = Math.max(0, Math.min(1, fi - lo));
      const f0 = tr.f0[lo] && tr.f0[hi] ? tr.f0[lo] * (1 - fr) + tr.f0[hi] * fr : tr.f0[i];
      const sh = tr.f0[lo] && tr.f0[hi] ? shift[lo] * (1 - fr) + shift[hi] * fr : shift[i];
      return { f0, ratio: Math.pow(2, sh / 12) };
    };

    const grains = [];
    let ts = 0;
    while (ts < N + 512) {
      const info = infoAt(ts);
      if (info && Math.abs(info.ratio - 1) > 1e-4) {
        const Ta = sr / info.f0;
        const half = Math.round(Ta / 2);
        // line the grain up on a waveform peak so successive grains stay in phase
        const c = Math.round(ts);
        let best = c;
        let bv = -Infinity;
        for (let k = -half; k <= half; k++) {
          const v = c + k >= 0 && c + k < N ? mono[c + k] : -Infinity;
          if (v > bv) {
            bv = v;
            best = c + k;
          }
        }
        grains.push({ out: Math.round(ts), src: best, len: 2 * Math.max(8, Math.round(Ta)) });
        ts += Ta / info.ratio;
      } else {
        const Ta = info ? sr / info.f0 : 256;
        const len = info ? 2 * Math.max(8, Math.round(Ta)) : 512;
        grains.push({ out: Math.round(ts), src: Math.round(ts), len });
        ts += info ? Ta : 256;
      }
    }
    if (onProgress) onProgress(0.7);
    await tick();

    // 3. overlap-add every channel with the same grains
    const outChans = [];
    for (let ci = 0; ci < channels.length; ci++) {
      const x = channels[ci];
      const out = new Float32Array(N);
      const wsum = new Float32Array(N);
      for (const g of grains) {
        const w = hann(g.len);
        const o0 = g.out - (g.len >> 1);
        const s0 = g.src - (g.len >> 1);
        for (let j = 0; j < g.len; j++) {
          const oi = o0 + j;
          if (oi < 0 || oi >= N) continue;
          const si = s0 + j;
          const v = si >= 0 && si < N ? x[si] : 0;
          out[oi] += v * w[j];
          wsum[oi] += w[j];
        }
      }
      for (let i = 0; i < N; i++) out[i] = wsum[i] > 0.05 ? out[i] / wsum[i] : x[i];
      outChans.push(out);
      if (onProgress) onProgress(0.7 + (0.3 * (ci + 1)) / channels.length);
      await tick();
    }
    return {
      channels: outChans,
      stats: { voicedFraction: F ? voiced / F : 0, medianCents: devs.length ? devs[devs.length >> 1] : 0, frames: F },
    };
  };

  /* ---------- loudness (ITU-R BS.1770-4) ---------- */

  function biquad(b0, b1, b2, a0, a1, a2) {
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  /** The two K-weighting filters (shelving + high-pass) for any sample rate. */
  function kWeighting(sr) {
    // stage 1: high shelf, +4 dB above ~1.7 kHz
    const G = 3.999843853973347;
    const f0 = 1681.9744509555319;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sr);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    const shelf = biquad(Vh + (Vb * K) / Q + K * K, 2 * (K * K - Vh), Vh - (Vb * K) / Q + K * K, a0, 2 * (K * K - 1), 1 - K / Q + K * K);
    // stage 2: high-pass at ~38 Hz
    const f1 = 38.13547087602444;
    const Q1 = 0.5003270373238773;
    const K1 = Math.tan((Math.PI * f1) / sr);
    const hp = biquad(1, -2, 1, 1 + K1 / Q1 + K1 * K1, 2 * (K1 * K1 - 1), 1 - K1 / Q1 + K1 * K1);
    return [shelf, hp];
  }

  function runBiquad(f, x, y) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const o = f.b0 * v + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
      x2 = x1;
      x1 = v;
      y2 = y1;
      y1 = o;
      y[i] = o;
    }
  }

  /**
   * Integrated loudness of 1 or 2 channels. Returns { lufs, peakDb, truePeakDb } where lufs is
   * -Infinity for silence. peakDb is the sample peak, truePeakDb adds an inter-sample estimate.
   */
  D.measureLoudness = (channels, sr) => {
    const N = channels[0].length;
    const filters = kWeighting(sr);
    const seg = Math.round(sr * 0.1); // 100 ms segments; a 400 ms block is 4 segments
    const nSeg = Math.floor(N / seg);
    const energy = new Float64Array(nSeg); // weighted sum of mean squares per segment
    let peak = 0;
    let tpeak = 0;
    const tmp = new Float32Array(N);
    const tmp2 = new Float32Array(N);
    for (const ch of channels) {
      runBiquad(filters[0], ch, tmp);
      runBiquad(filters[1], tmp, tmp2);
      for (let s = 0; s < nSeg; s++) {
        let sum = 0;
        for (let i = s * seg; i < (s + 1) * seg; i++) sum += tmp2[i] * tmp2[i];
        energy[s] += sum / seg;
      }
      for (let i = 0; i < N; i++) {
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
        if (a > 0.35 && i > 1 && i < N - 2) {
          // 4x cubic interpolation around loud samples
          for (let k = 1; k < 4; k++) {
            const t = k / 4;
            const p0 = ch[i - 1];
            const p1 = ch[i];
            const p2 = ch[i + 1];
            const p3 = ch[i + 2];
            const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
            if (Math.abs(v) > tpeak) tpeak = Math.abs(v);
          }
        }
      }
    }
    tpeak = Math.max(tpeak, peak);
    const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
    const blocks = [];
    for (let s = 0; s + 4 <= nSeg; s++) blocks.push((energy[s] + energy[s + 1] + energy[s + 2] + energy[s + 3]) / 4);
    const lk = (e) => -0.691 + 10 * Math.log10(e);
    const abs = blocks.filter((e) => e > 0 && lk(e) > -70);
    if (!abs.length) return { lufs: -Infinity, peakDb: toDb(peak), truePeakDb: toDb(tpeak) };
    const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((e) => lk(e) > rel);
    const mean = gated.reduce((a, b) => a + b, 0) / gated.length;
    return { lufs: lk(mean), peakDb: toDb(peak), truePeakDb: toDb(tpeak) };
  };

  /** Loudness of a single track's audio over a clip's range (for balancing levels). */
  D.rmsDb = (channels, from, to) => {
    let sum = 0;
    let n = 0;
    for (const ch of channels)
      for (let i = from; i < to; i++) {
        sum += ch[i] * ch[i];
        n++;
      }
    return n && sum > 0 ? 10 * Math.log10(sum / n) : -Infinity;
  };
})();
