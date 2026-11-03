/* Match (AI mix): analyze a reference song's tonal balance, analyze YOUR vocal, and build an EQ
 * that moves your voice toward that balance — fitted to your own voice. Also offers built-in
 * "vibe" targets so you don't need a reference file. All local; nothing leaves your computer. */
(function () {
  const S = window.Studio;
  const M = (S.match = {});
  const FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  // ---- FFT (iterative radix-2) ----
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
          const bi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr;
        }
      }
    }
  }

  // band edges = geometric midpoints between centres
  const EDGES = FREQS.map((f, i) => (i === 0 ? f / Math.SQRT2 : Math.sqrt(f * FREQS[i - 1])));
  EDGES.push(FREQS[FREQS.length - 1] * Math.SQRT2);

  /** Average 10-band spectrum of an AudioBuffer, in dB. Returns null if too short/silent. */
  M.analyze = (buffer) => {
    const sr = buffer.sampleRate, N = 4096, hop = 2048;
    const len = buffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / buffer.numberOfChannels;
    }
    const maxLen = Math.min(len, sr * 30);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const power = new Float64Array(N / 2);
    let frames = 0, energy = 0;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let start = 0; start + N <= maxLen; start += hop) {
      im.fill(0);
      for (let i = 0; i < N; i++) { const s = mono[start + i]; re[i] = s * win[i]; energy += s * s; }
      fft(re, im);
      for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
    if (frames < 2) return null;
    for (let k = 0; k < N / 2; k++) power[k] /= frames;
    const bands = FREQS.map(() => 0);
    const bandN = FREQS.map(() => 0);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sr) / N;
      for (let b = 0; b < FREQS.length; b++) {
        if (f >= EDGES[b] && f < EDGES[b + 1]) { bands[b] += power[k]; bandN[b]++; break; }
      }
    }
    const db = bands.map((p, i) => 10 * Math.log10((bandN[i] ? p / bandN[i] : 1e-9) + 1e-12));
    const rms = Math.sqrt(energy / (frames * N) + 1e-12);
    return { db, rms };
  };

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const normalize = (a) => { const m = mean(a); return a.map((x) => x - m); };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // built-in tonal targets (relative dB per band; normalized at use)
  M.VIBES = {
    'Modern pop vocal': [-3, -2, -1, 0, 0, 1, 2, 3, 3, 2],
    'Warm rap vocal': [2, 2, 1, 0, 0, 0, -1, -1, -2, -2],
    'Bright & airy': [-2, -2, -1, 0, 0, 1, 2, 3, 4, 4],
    'Lo-fi / vintage': [1, 2, 1, 0, -1, -1, -2, -3, -4, -5],
  };

  /** curve (10 band dB) that moves srcDb toward the target tonal shape. */
  M.curve = (srcDb, targetShape, strength) => {
    const src = normalize(srcDb);
    const tgt = normalize(targetShape);
    return tgt.map((t, i) => clamp((t - src[i]) * strength, -12, 12));
  };

  /* ---- high-resolution matching (1/3-octave) ----
   * The 10-band read is coarse. For a real reference match we analyze both signals at
   * 1/3-octave resolution (~30 bands), build a smoothed difference, ignore bands your vocal
   * barely has (so it doesn't boost hiss or sub it can't produce), then fit that fine curve
   * onto the 10-band EQ. The result follows the reference's tone far more closely. */
  M.analyzeFine = (buffer) => {
    const sr = buffer.sampleRate, N = 4096, hop = 2048, len = buffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / buffer.numberOfChannels; }
    const maxLen = Math.min(len, sr * 30);
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const power = new Float64Array(N / 2);
    let frames = 0, energy = 0; const re = new Float64Array(N), im = new Float64Array(N);
    for (let start = 0; start + N <= maxLen; start += hop) {
      im.fill(0);
      for (let i = 0; i < N; i++) { const s = mono[start + i]; re[i] = s * win[i]; energy += s * s; }
      fft(re, im);
      for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
    if (frames < 2) return null;
    for (let k = 0; k < N / 2; k++) power[k] /= frames;
    const nyq = sr / 2, step = Math.pow(2, 1 / 3), centers = [];
    for (let f = 25; f <= Math.min(20000, nyq); f *= step) centers.push(f);
    const edges = centers.map((f, i) => (i === 0 ? f / Math.pow(2, 1 / 6) : Math.sqrt(f * centers[i - 1])));
    edges.push(centers[centers.length - 1] * Math.pow(2, 1 / 6));
    const bands = centers.map(() => 0), bn = centers.map(() => 0);
    for (let k = 1; k < N / 2; k++) { const f = (k * sr) / N; for (let b = 0; b < centers.length; b++) { if (f >= edges[b] && f < edges[b + 1]) { bands[b] += power[k]; bn[b]++; break; } } }
    const db = bands.map((p, i) => 10 * Math.log10((bn[i] ? p / bn[i] : 1e-9) + 1e-12));
    return { centers, db, rms: Math.sqrt(energy / (frames * N) + 1e-12), peakDb: Math.max.apply(null, db) };
  };

  /** 10-band EQ gains that steer a fine source spectrum toward a fine target spectrum. */
  M.curveFine = (src, tgt, strength) => {
    const n = Math.min(src.db.length, tgt.db.length);
    const sN = normalize(src.db.slice(0, n)), tN = normalize(tgt.db.slice(0, n));
    const diff = new Array(n);
    for (let i = 0; i < n; i++) {
      // confidence: bands >35 dB below the vocal's own peak carry no usable content
      const conf = clamp((src.db[i] - (src.peakDb - 35)) / 20, 0, 1);
      diff[i] = (tN[i] - sN[i]) * conf;
    }
    const sm = diff.map((_, i) => { let s = 0, c = 0; for (let j = -1; j <= 1; j++) { const k = i + j; if (k >= 0 && k < n) { s += diff[k]; c++; } } return s / c; });
    const centers = src.centers.slice(0, n);
    return FREQS.map((fc, b) => {
      let s = 0, c = 0;
      for (let i = 0; i < n; i++) if (centers[i] >= EDGES[b] && centers[i] < EDGES[b + 1]) { s += sm[i]; c++; }
      let g = (c ? s / c : 0) * strength;
      const lo = FREQS[b] < 120 ? -6 : -12, hi = FREQS[b] < 120 ? 4 : 12; // don't chase sub-bass a vocal lacks
      return clamp(Math.round(g * 10) / 10, lo, hi);
    });
  };

  /** Gather up to ~30 s of the track's own audio (the raw vocal) for analysis. */
  function trackBuffer(track) {
    const clips = (track.clips || []).filter((c) => S.buffers.has(c.asset));
    if (!clips.length) return null;
    const sr = S.ctx.sampleRate;
    let total = 0;
    const parts = [];
    for (const c of clips) {
      const b = S.buffers.get(c.asset);
      parts.push(b);
      total += b.length;
      if (total >= sr * 30) break;
    }
    const len = Math.min(total, sr * 30);
    const out = S.ctx.createBuffer(1, len, sr);
    const od = out.getChannelData(0);
    let off = 0;
    for (const b of parts) {
      const n = Math.min(b.length, len - off);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) od[off + i] = d[i];
      off += n;
      if (off >= len) break;
    }
    return out;
  }

  /** Build the list of fx (pluginId + params) a match produces, WITHOUT touching a track.
   *  This is what a saved preset stores, so the artist can reapply the exact sound later. */
  M.buildFx = (curve, outputDb, fullChain) => {
    const mk = (pluginId, over) => {
      const def = S.plugins.get(pluginId);
      const params = Object.assign({}, S.defaultParams(def), over || {});
      return { pluginId, params };
    };
    const list = [];
    if (fullChain) { list.push(mk('ss-comp')); list.push(mk('ss-deesser')); }
    const eqParams = {};
    curve.forEach((g, i) => (eqParams['b' + i] = Math.round(g * 10) / 10));
    if (outputDb != null) eqParams.output = Math.round(outputDb * 10) / 10;
    list.push(mk('ss-matcheq', eqParams));
    return list;
  };

  /** Add/reuse each fx in a built list on a track (reuses an existing instance of the same plugin). */
  M.applyFx = (track, fxList) => {
    S.history.push();
    for (const spec of fxList) {
      let fx = track.fx.find((f) => f.pluginId === spec.pluginId);
      if (!fx) {
        fx = { id: S.uid(), pluginId: spec.pluginId, params: {}, bypass: false };
        track.fx.push(fx);
      }
      fx.params = Object.assign({}, spec.params);
      fx.bypass = false;
    }
    S.refresh.structure();
  };

  /** Apply a computed curve directly to a track (convenience used by the one-shot match). */
  M.apply = (track, curve, outputDb, fullChain) => {
    M.applyFx(track, M.buildFx(curve, outputDb, fullChain));
  };

  // ---- saved presets (persist across sessions) ----
  const PKEY = 'ps.matchPresets';
  M.presets = {
    all() { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch (e) { return []; } },
    save(p) {
      const list = M.presets.all();
      const idx = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (idx >= 0) list[idx] = p; else list.push(p);
      try { localStorage.setItem(PKEY, JSON.stringify(list)); } catch (e) {}
      return p;
    },
    remove(id) {
      const list = M.presets.all().filter((x) => x.id !== id);
      try { localStorage.setItem(PKEY, JSON.stringify(list)); } catch (e) {}
    },
  };

  M.init = () => {
    const btn = document.getElementById('btn-match');
    if (btn) btn.onclick = () => M.open();
  };

  /** Right-click track menu: apply a saved preset, open Match, or change colour. */
  M.trackMenu = (track, x, y) => {
    const items = [];
    const list = M.presets.all();
    if (list.length) {
      list.forEach((p) => {
        items.push({
          label: 'Apply: ' + p.name,
          hint: (p.from || '').replace(/^from /, ''),
          action: () => {
            M.applyFx(track, p.fx);
            S.toast('Applied preset “' + p.name + '” to ' + (track.name || 'track') + '.');
          },
        });
      });
      items.push({ sep: true });
    }
    items.push({ label: 'AI Mix…', hint: list.length ? '' : 'build your first preset', action: () => M.open() });
    items.push({ sep: true });
    items.push({ label: 'Track colour…', action: () => S.ui.colorMenu(track, x, y) });
    S.clips.menu(x, y, items);
  };

  M.open = () => {
    const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
    const dlg = el('dialog', 'modal match-dlg');
    dlg.innerHTML =
      '<div class="set-head"><span class="set-ic">' + S.ui.icon('wand', 18) + '</span><h3>AI Mix</h3><span class="set-ver">beta</span><div class="pw-sp"></div><button class="pw-ib mt-x" title="Close">' + S.ui.icon('x', 14) + '</button></div>' +
      '<div class="mt-body"></div>';
    const body = dlg.querySelector('.mt-body');
    dlg.querySelector('.mt-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('keydown', (e) => e.stopPropagation());

    let refBuf = null, refName = '';
    const state = { mode: 'vibe', vibe: Object.keys(M.VIBES)[0], trackIdx: 0, fullChain: true };
    const tracks = S.project.tracks;
    const sel = S.timeline && S.timeline.selected;
    if (sel) { const ti = tracks.findIndex((t) => (t.clips || []).some((c) => c.id === sel)); if (ti >= 0) state.trackIdx = ti; }
    else { const ti = tracks.findIndex((t) => (t.clips || []).length); if (ti >= 0) state.trackIdx = ti; }

    body.innerHTML =
      '<p class="hint">Point Session at a sound you like, pick your vocal track, and it builds an EQ that shapes your voice toward that tone — fitted to your voice.</p>' +
      '<div class="mt-saved"></div>' +
      '<div class="param"><label>Match to</label><span class="seg mt-mode"></span><span></span></div>' +
      '<div class="mt-target"></div>' +
      '<div class="param"><label>Your vocal track</label><select class="sel mt-track"></select><span></span></div>' +
      '<label class="mt-chk"><input type="checkbox" class="mt-full" checked> Also add a vocal chain (de-esser + compression)</label>' +
      '<div class="param"><label>Save as a preset</label><input class="sel mt-pname" type="text" placeholder="e.g. Drake vocal, My main sound… (optional)" maxlength="40"><span class="hint">Reuse this sound on any track later.</span></div>' +
      '<div class="mt-foot"></div>';

    // saved presets — apply to any track without re-analyzing
    const savedBox = body.querySelector('.mt-saved');
    function drawSaved() {
      const list = M.presets.all();
      if (!list.length) { savedBox.innerHTML = ''; return; }
      savedBox.innerHTML = '<div class="mt-saved-h">Your presets</div>';
      list.forEach((p) => {
        const row = el('div', 'mt-preset');
        const nm = el('span', 'mt-preset-n'); nm.textContent = p.name;
        const sub = el('span', 'mt-preset-s'); sub.textContent = p.from || '';
        const apply = el('button', 'btn sm', 'Apply'); apply.title = 'Apply to the selected vocal track';
        apply.onclick = () => {
          const track = tracks[state.trackIdx];
          if (!track) return S.toast('Pick a track first.');
          M.applyFx(track, p.fx);
          S.toast('Applied preset “' + p.name + '” to ' + (track.name || 'track') + '.');
          dlg.close();
        };
        const del = el('button', 'pw-ib sm', S.ui.icon('x', 12)); del.title = 'Delete preset';
        del.onclick = () => { M.presets.remove(p.id); drawSaved(); };
        row.append(nm, sub, el('span', 'pw-sp'), apply, del);
        savedBox.appendChild(row);
      });
    }

    // mode segmented (Reference file / Vibe)
    const modeBox = body.querySelector('.mt-mode');
    [['vibe', 'A vibe'], ['file', 'A reference track']].forEach(([v, label]) => {
      const b = el('button', 'seg-b' + (state.mode === v ? ' on' : ''));
      b.type = 'button'; b.textContent = label;
      b.onclick = () => { state.mode = v; modeBox.querySelectorAll('.seg-b').forEach((x) => x.classList.remove('on')); b.classList.add('on'); drawTarget(); };
      modeBox.appendChild(b);
    });

    const targetBox = body.querySelector('.mt-target');
    function drawTarget() {
      targetBox.innerHTML = '';
      if (state.mode === 'vibe') {
        const r = el('div', 'param'); r.innerHTML = '<label>Vibe</label>';
        const s = el('select', 'sel');
        Object.keys(M.VIBES).forEach((k) => { const o = el('option'); o.value = k; o.textContent = k; s.appendChild(o); });
        s.value = state.vibe; s.onchange = () => (state.vibe = s.value);
        r.appendChild(s); r.appendChild(el('span')); targetBox.appendChild(r);
      } else {
        const r = el('div', 'param'); r.innerHTML = '<label>Reference</label>';
        const pick = el('button', 'btn', refName ? '♪ ' + refName : 'Choose a song…');
        pick.onclick = async () => {
          const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*,.wav,.mp3,.flac,.ogg,.m4a';
          inp.onchange = async () => {
            const f = inp.files[0]; if (!f) return;
            pick.textContent = 'Reading…'; pick.disabled = true;
            try { refBuf = await S.ctx.decodeAudioData(await f.arrayBuffer()); refName = f.name; pick.textContent = '♪ ' + refName; }
            catch (e) { S.toast('Could not read that audio file'); pick.textContent = 'Choose a song…'; }
            pick.disabled = false;
          };
          inp.click();
        };
        r.appendChild(pick); r.appendChild(el('span', 'hint', 'A song whose vocal tone you want.')); targetBox.appendChild(r);
      }
    }
    drawTarget();

    const trackSel = body.querySelector('.mt-track');
    tracks.forEach((t, i) => { const o = el('option'); o.value = i; o.textContent = (t.name || 'Track ' + (i + 1)) + ((t.clips || []).length ? '' : ' (empty)'); trackSel.appendChild(o); });
    trackSel.value = String(state.trackIdx);
    trackSel.onchange = () => (state.trackIdx = +trackSel.value);
    body.querySelector('.mt-full').onchange = (e) => (state.fullChain = e.target.checked);
    drawSaved();

    const foot = body.querySelector('.mt-foot');
    const cancel = el('button', 'btn ghost', 'Cancel'); cancel.onclick = () => dlg.close();
    const go = el('button', 'btn primary', S.ui.icon('wand', 15) + 'Match my voice');
    foot.append(el('span', 'pw-sp'), cancel, go);

    go.onclick = async () => {
      const track = tracks[state.trackIdx];
      const vbuf = trackBuffer(track);
      if (!vbuf) return S.toast('That track has no audio. Pick a track with your vocal on it.');
      if (state.mode === 'file' && !refBuf) return S.toast('Choose a reference song first.');
      go.disabled = cancel.disabled = true;
      go.innerHTML = '<span class="vd-spin"></span>Analyzing…';
      await new Promise((r) => setTimeout(r)); // let the UI paint
      try {
        let curve, outTrim = 0;
        if (state.mode === 'file') {
          // high-resolution reference match
          const srcF = M.analyzeFine(vbuf), refF = M.analyzeFine(refBuf);
          if (!srcF) throw new Error('Your vocal is too short or quiet to analyze.');
          if (!refF) throw new Error('The reference is too short to analyze.');
          curve = M.curveFine(srcF, refF, 0.9);
          outTrim = clamp(20 * Math.log10((refF.rms + 1e-6) / (srcF.rms + 1e-6)) * 0.4, -6, 6);
        } else {
          const src = M.analyze(vbuf);
          if (!src) throw new Error('Your vocal is too short or quiet to analyze.');
          curve = M.curve(src.db, M.VIBES[state.vibe], 0.8);
        }
        const fxList = M.buildFx(curve, outTrim, state.fullChain);
        M.applyFx(track, fxList);
        const srcLabel = state.mode === 'file' ? refName : state.vibe;
        let pname = (body.querySelector('.mt-pname').value || '').trim();
        let saved = false;
        if (pname) {
          M.presets.save({ id: S.uid(), name: pname, from: 'from ' + srcLabel, fx: fxList });
          saved = true;
        }
        S.toast('Matched “' + (track.name || 'track') + '” to ' + srcLabel + '.' + (saved ? ' Saved preset “' + pname + '”.' : ' Tweak it in the Match EQ.'));
        dlg.close();
      } catch (e) {
        go.disabled = cancel.disabled = false;
        go.innerHTML = S.ui.icon('wand', 15) + 'Match my voice';
        S.toast(e.message || 'Match failed');
      }
    };

    document.body.appendChild(dlg);
    dlg.showModal();
  };
})();
