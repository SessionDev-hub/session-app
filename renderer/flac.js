/* FLAC encoder (lossless). Pure JavaScript, no dependencies — works on Windows, Mac and Android.
 * Fixed linear prediction (orders 0–4) with partitioned Rice coding, and the best of
 * left/right, left/side, side/right or mid/side per block. 16- or 24-bit, any sample rate.
 * Output decodes bit-exactly in ffmpeg, the reference `flac` tool and every player. */
(function () {
  const S = window.Studio || (window.Studio = {});

  /* ---------- bit writer ---------- */
  class Bits {
    constructor(cap) { this.buf = new Uint8Array(cap || 1 << 16); this.pos = 0; this.acc = 0; this.n = 0; }
    grow(extra) {
      if (this.pos + extra + 8 <= this.buf.length) return;
      let c = this.buf.length * 2; while (c < this.pos + extra + 8) c *= 2;
      const nb = new Uint8Array(c); nb.set(this.buf.subarray(0, this.pos)); this.buf = nb;
    }
    // write up to 32 bits of an unsigned value
    put(v, bits) {
      if (bits > 24) { this.put(Math.floor(v / 0x1000000) >>> 0, bits - 24); v = v % 0x1000000; bits = 24; }
      this.acc = (this.acc * (1 << bits) + (v & ((1 << bits) - 1))) >>> 0; // fits: acc < 2^8 before shift
      this.n += bits;
      while (this.n >= 8) {
        this.n -= 8;
        this.grow(1);
        this.buf[this.pos++] = (this.acc >>> this.n) & 0xff;
        this.acc &= (1 << this.n) - 1;
      }
    }
    putSigned(v, bits) { this.put(v < 0 ? v + Math.pow(2, bits) : v, bits); }
    unary0(q) { // q zeros then a one
      while (q >= 24) { this.put(0, 24); q -= 24; }
      this.put(1, q + 1);
    }
    align() { if (this.n) this.put(0, 8 - this.n); }
    bytes() { return this.buf.subarray(0, this.pos); }
  }

  /* ---------- CRCs ---------- */
  const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; CRC8[i] = c;
    let d = i << 8; for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff; CRC16[i] = d;
  }
  const crc8 = (b, a, z) => { let c = 0; for (let i = a; i < z; i++) c = CRC8[c ^ b[i]]; return c; };
  const crc16 = (b, a, z) => { let c = 0; for (let i = a; i < z; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

  /* ---------- residual coding ---------- */
  // Sum of |residual| for fixed predictor orders 0..4 in one pass (used to pick the order and the stereo mode).
  function orderCosts(x, n) {
    const c = [0, 0, 0, 0, 0];
    for (let i = 4; i < n; i++) {
      const e0 = x[i], e1 = e0 - x[i - 1], e2 = e1 - (x[i - 1] - x[i - 2]);
      const e3 = e2 - (x[i - 1] - 2 * x[i - 2] + x[i - 3]);
      const e4 = e3 - (x[i - 1] - 3 * x[i - 2] + 3 * x[i - 3] - x[i - 4]);
      c[0] += Math.abs(e0); c[1] += Math.abs(e1); c[2] += Math.abs(e2); c[3] += Math.abs(e3); c[4] += Math.abs(e4);
    }
    return c;
  }
  const estBits = (sumAbs, cnt) => { const mean = sumAbs / Math.max(1, cnt); return cnt * (mean > 0 ? Math.log2(mean + 1) + 1.5 : 1); };
  function bestOrder(x, n) {
    if (n < 5) return { o: 0, bits: 1e15 };
    const c = orderCosts(x, n);
    let o = 0; for (let k = 1; k < 5; k++) if (c[k] < c[o]) o = k;
    return { o, bits: estBits(c[o], n) };
  }
  function residual(x, n, order, out) {
    for (let i = order; i < n; i++) {
      let r;
      switch (order) {
        case 0: r = x[i]; break;
        case 1: r = x[i] - x[i - 1]; break;
        case 2: r = x[i] - 2 * x[i - 1] + x[i - 2]; break;
        case 3: r = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
        default: r = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
      }
      out[i] = r >= 0 ? 2 * r : -2 * r - 1; // zig-zag to unsigned
    }
  }
  const kFor = (sum, cnt) => { let k = 0; while (k < 30 && cnt * Math.pow(2, k + 1) <= sum) k++; return k; };
  // exact bits of a partition for parameter k
  function partBits(u, a, z, k) { const d = Math.pow(2, k); let b = (z - a) * (k + 1); for (let i = a; i < z; i++) b += Math.floor(u[i] / d); return b; }
  function planRice(u, n, order) {
    let best = null;
    for (let po = 0; po <= 6; po++) {
      const parts = 1 << po;
      if (n % parts) break;
      const psize = n / parts;
      if (psize <= order) break;
      let bits = 0; const params = [];
      for (let p = 0; p < parts; p++) {
        const a = p === 0 ? order : p * psize, z = (p + 1) * psize;
        let sum = 0; for (let i = a; i < z; i++) sum += u[i];
        let k = kFor(sum, z - a), bk = partBits(u, a, z, k);
        if (k > 0) { const b2 = partBits(u, a, z, k - 1); if (b2 < bk) { bk = b2; k--; } }
        params.push(k); bits += bk + 5;
      }
      if (!best || bits < best.bits) best = { porder: po, params, bits };
      else break; // finer partitions stopped helping
    }
    return best;
  }

  /* ---------- one subframe ---------- */
  function subframe(bw, x, n, bps, u) {
    let same = true; for (let i = 1; i < n; i++) if (x[i] !== x[0]) { same = false; break; }
    if (same) { bw.put(0, 1); bw.put(0, 6); bw.put(0, 1); bw.putSigned(x[0], bps); return; }
    const o = Math.min(bestOrder(x, n).o, n - 1);
    residual(x, n, o, u);
    const plan = planRice(u, n, o);
    if (o * bps + plan.bits + 6 >= n * bps) { // verbatim is smaller
      bw.put(0, 1); bw.put(1, 6); bw.put(0, 1);
      bw.grow(n * 4);
      for (let i = 0; i < n; i++) bw.putSigned(x[i], bps);
      return;
    }
    bw.put(0, 1); bw.put(8 | o, 6); bw.put(0, 1);
    for (let i = 0; i < o; i++) bw.putSigned(x[i], bps);
    const wide = plan.params.some((k) => k > 14);
    bw.put(wide ? 1 : 0, 2);
    bw.put(plan.porder, 4);
    const parts = 1 << plan.porder, psize = n / parts;
    for (let p = 0; p < parts; p++) {
      const k = plan.params[p];
      bw.put(k, wide ? 5 : 4);
      const a = p === 0 ? o : p * psize, z = (p + 1) * psize;
      const div = Math.pow(2, k);
      bw.grow((z - a) * 8 + 64);
      for (let i = a; i < z; i++) {
        const q = Math.floor(u[i] / div);
        bw.unary0(q);
        if (k) bw.put(u[i] - q * div, k);
      }
    }
  }

  /* ---------- MD5 of the raw samples (stored in STREAMINFO so `flac -t` can verify the file) ---------- */
  function md5(bytes) {
    const K = new Uint32Array(64), R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    const len = bytes.length, padLen = ((len + 8) >> 6) + 1 << 6;
    const m = new Uint8Array(padLen); m.set(bytes); m[len] = 0x80;
    const bitLen = len * 8; const dv = new DataView(m.buffer);
    dv.setUint32(padLen - 8, bitLen >>> 0, true); dv.setUint32(padLen - 4, Math.floor(bitLen / 4294967296), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + ((F << R[i]) | (F >>> (32 - R[i])))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16), o = new DataView(out.buffer);
    o.setUint32(0, a0, true); o.setUint32(4, b0, true); o.setUint32(8, c0, true); o.setUint32(12, d0, true);
    return out;
  }

  // UTF-8 style frame number
  function utf8Num(bw, v) {
    if (v < 0x80) return bw.put(v, 8);
    const bytes = [];
    let len = v < 0x800 ? 2 : v < 0x10000 ? 3 : v < 0x200000 ? 4 : v < 0x4000000 ? 5 : 6;
    for (let i = len - 1; i > 0; i--) { bytes.unshift(0x80 | (v & 0x3f)); v = Math.floor(v / 64); }
    const lead = [0, 0, 0xc0, 0xe0, 0xf0, 0xf8, 0xfc][len];
    bw.put(lead | v, 8); for (const b of bytes) bw.put(b, 8);
  }

  /**
   * Encode an AudioBuffer (or { sampleRate, channels: [Float32Array...] }) as FLAC bytes.
   * opts.bits = 16 (default) or 24. Samples are dithered-free rounded and clipped to the range.
   */
  S.encodeFlac = (buf, opts = {}) => {
    const bps = opts.bits === 24 ? 24 : 16;
    const sr = buf.sampleRate;
    const chans = buf.getChannelData ? Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)) : buf.channels;
    const nch = Math.min(chans.length, 8), total = chans[0].length;
    const BS = 4096, full = Math.pow(2, bps - 1);
    // to integers
    const ints = chans.slice(0, nch).map((f) => {
      const a = new Int32Array(total);
      for (let i = 0; i < total; i++) { let v = Math.round(f[i] * full); if (v > full - 1) v = full - 1; else if (v < -full) v = -full; a[i] = v; }
      return a;
    });
    const bw = new Bits(Math.max(1 << 16, total * nch * (bps / 8) * 0.7));
    // ---- header + STREAMINFO (MD5 left as zero = "not computed", which is allowed) ----
    bw.put(0x664c6143, 32); // "fLaC"
    bw.put(1, 1); bw.put(0, 7); bw.put(34, 24);
    bw.put(BS, 16); bw.put(BS, 16);
    const minFramePos = bw.pos; bw.put(0, 24); bw.put(0, 24); // min/max frame size, patched later
    bw.put(sr, 20); bw.put(nch - 1, 3); bw.put(bps - 1, 5);
    bw.put(Math.floor(total / 0x100000000), 4); bw.put(total >>> 0, 32);
    const md5Pos = bw.pos;
    for (let i = 0; i < 16; i++) bw.put(0, 8);
    const srCode = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 }[sr] || 0;
    const bpsCode = bps === 16 ? 4 : 6;
    const scratch = new Float64Array(BS);
    const sideBuf = new Int32Array(BS), midBuf = new Int32Array(BS);
    let minF = 1e9, maxF = 0, frameNo = 0;
    for (let start = 0; start < total; start += BS, frameNo++) {
      const n = Math.min(BS, total - start);
      const fstart = bw.pos;
      // stereo decorrelation: try all four, keep the smallest
      let mode = nch - 1, subs = ints.map((a) => a.subarray(start, start + n)), sbps = subs.map(() => bps);
      if (nch === 2) {
        const L = subs[0], R = subs[1];
        for (let i = 0; i < n; i++) { sideBuf[i] = L[i] - R[i]; midBuf[i] = (L[i] + R[i]) >> 1; }
        const side = sideBuf.subarray(0, n), mid = midBuf.subarray(0, n);
        const cost = (x) => bestOrder(x, n).bits;
        const cL = cost(L), cR = cost(R), cS = cost(side), cM = cost(mid);
        const opts2 = [[cL + cR, 1, [L, R], [bps, bps]], [cL + cS, 8, [L, side], [bps, bps + 1]], [cS + cR, 9, [side, R], [bps + 1, bps]], [cM + cS, 10, [mid, side], [bps, bps + 1]]];
        opts2.sort((a, b) => a[0] - b[0]);
        mode = opts2[0][1]; subs = opts2[0][2]; sbps = opts2[0][3];
      }
      // ---- frame header ----
      bw.put(0x3ffe, 14); bw.put(0, 1); bw.put(0, 1); // sync, reserved, fixed blocksize
      const bsCode = n === BS ? 12 : 7; // 4096, or "8-bit (n-1) at end of header"... use 16-bit below
      const useCode = n === BS ? 12 : 7;
      bw.put(useCode, 4); bw.put(srCode, 4); bw.put(mode, 4); bw.put(bpsCode, 3); bw.put(0, 1);
      utf8Num(bw, frameNo);
      if (useCode === 7) bw.put(n - 1, 16);
      if (srCode === 0) { /* rate only in STREAMINFO: code 0 means "get from STREAMINFO" */ }
      bw.align();
      bw.put(crc8(bw.buf, fstart, bw.pos), 8);
      // ---- subframes ----
      for (let c = 0; c < subs.length; c++) subframe(bw, subs[c], n, sbps[c], scratch);
      bw.align();
      bw.put(crc16(bw.buf, fstart, bw.pos), 16);
      const fsize = bw.pos - fstart;
      if (fsize < minF) minF = fsize; if (fsize > maxF) maxF = fsize;
      void bsCode;
    }
    const out = bw.bytes().slice();
    const patch = (pos, v) => { out[pos] = (v >> 16) & 255; out[pos + 1] = (v >> 8) & 255; out[pos + 2] = v & 255; };
    patch(minFramePos, minF === 1e9 ? 0 : minF); patch(minFramePos + 3, maxF);
    // MD5 of the interleaved little-endian samples, as FLAC defines it
    const bb = bps / 8, raw = new Uint8Array(total * nch * bb);
    for (let i = 0, p = 0; i < total; i++) for (let c = 0; c < nch; c++) { const v = ints[c][i]; raw[p++] = v & 255; raw[p++] = (v >> 8) & 255; if (bb === 3) raw[p++] = (v >> 16) & 255; }
    out.set(md5(raw), md5Pos);
    return out;
  };
})();
