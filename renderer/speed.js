/* Speed up / slow down clips (a verse, a hook, a whole beat).
 *  • "Sped up / slowed" — changes speed AND pitch together, like the TikTok sped-up and slowed+reverb edits.
 *  • "Keep pitch" — changes only the speed (WSOLA time-stretch), so the vocal stays in key.
 * The original recording is kept untouched; the clip gets a new processed copy (Undo brings it back). */
(function () {
  const S = window.Studio;
  const SP = (S.speed = {});
  const breathe = () => new Promise((r) => setTimeout(r, 0));

  /** Resample: speed and pitch change together. */
  SP.resample = async (buf, rate) => {
    const n = Math.max(1, Math.round(buf.length / rate));
    const oc = new OfflineAudioContext(buf.numberOfChannels, n, buf.sampleRate);
    const s = oc.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    s.connect(oc.destination); s.start(0);
    return oc.startRendering();
  };

  /** WSOLA time-stretch: speed changes, pitch stays. rate > 1 = faster/shorter. */
  SP.stretch = async (buf, rate, onProgress) => {
    const sr = buf.sampleRate, nch = buf.numberOfChannels, len = buf.length;
    const N = 2 * Math.round(0.02 * sr);           // ~40 ms frames
    const Hs = N / 2;                                // synthesis hop (50% overlap)
    const Ha = Hs * rate;                            // analysis hop
    const TOL = Math.round(0.012 * sr);              // search ±12 ms for the best-matching splice
    const outLen = Math.max(1, Math.round(len / rate));
    const ch = Array.from({ length: nch }, (_, c) => buf.getChannelData(c));
    // mono, 4x decimated copy just for finding splice points (fast)
    const D = 4, mlen = Math.floor(len / D), mono = new Float32Array(mlen);
    for (let i = 0; i < mlen; i++) { let s = 0; for (let c = 0; c < nch; c++) s += ch[c][i * D]; mono[i] = s / nch; }
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const out = Array.from({ length: nch }, () => new Float32Array(outLen + N));
    const norm = new Float32Array(outLen + N);
    const frames = Math.ceil(outLen / Hs) + 1;
    let prev = 0; // input position of the previous frame
    const L = Math.floor(Hs / D); // correlation length (decimated)
    for (let k = 0; k < frames; k++) {
      const nominal = Math.round(k * Ha);
      let pos = nominal;
      if (k > 0) {
        // the waveform that would naturally follow the previous frame
        const ref = Math.floor((prev + Hs) / D);
        let best = -Infinity, bestPos = nominal;
        for (let d = -TOL; d <= TOL; d += D) {
          const p = nominal + d; if (p < 0 || p + N >= len) continue;
          const q = Math.floor(p / D);
          let c = 0;
          for (let i = 0; i < L; i++) { const a = mono[ref + i] || 0, b = mono[q + i] || 0; c += a * b; }
          if (c > best) { best = c; bestPos = p; }
        }
        pos = bestPos;
      }
      pos = Math.max(0, Math.min(len - 1, pos));
      const o = k * Hs;
      for (let i = 0; i < N; i++) {
        const src = pos + i; if (src >= len) break;
        const w = win[i], oi = o + i; if (oi >= outLen + N) break;
        for (let c = 0; c < nch; c++) out[c][oi] += ch[c][src] * w;
        norm[oi] += w;
      }
      prev = pos;
      if (k % 400 === 0) { if (onProgress) onProgress(k / frames); await breathe(); }
    }
    const res = new AudioBuffer({ numberOfChannels: nch, length: outLen, sampleRate: sr });
    for (let c = 0; c < nch; c++) {
      const d = res.getChannelData(c), o = out[c];
      for (let i = 0; i < outLen; i++) d[i] = norm[i] > 1e-3 ? o[i] / Math.max(norm[i], 0.5) : 0;
    }
    return res;
  };

  /** Cut the audible part of a clip out of its recording. */
  function clipBuffer(clip) {
    const buf = S.buffers.get(clip.asset); if (!buf) return null;
    const a = Math.max(0, Math.floor(clip.offset * buf.sampleRate));
    const n = Math.max(1, Math.min(buf.length - a, Math.round(clip.dur * buf.sampleRate)));
    const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: n, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(a, a + n));
    return out;
  }

  /**
   * Change the speed of clips. items = [{clip, track}], rate e.g. 1.25 (25% faster) or 0.8 (slower).
   * keepPitch: time-stretch instead of resample. push: move later clips on the same track so nothing overlaps.
   */
  SP.apply = async (items, rate, { keepPitch = false, push = true } = {}) => {
    S.history.push();
    let done = 0;
    for (const { clip, track } of items) {
      const src = clipBuffer(clip); if (!src) continue;
      const out = keepPitch ? await SP.stretch(src, rate) : await SP.resample(src, rate);
      const oldEnd = clip.start + clip.dur;
      const pct = Math.round(rate * 100);
      clip.asset = S.addAsset(clip.name.replace(/ \(\d+%( · pitch kept)?\)$/, '') + ' (' + pct + '%' + (keepPitch ? ' · pitch kept' : '') + ')', out);
      clip.name = S.project.assets[clip.asset].name;
      clip.offset = 0;
      clip.dur = out.duration;
      clip.fadeIn = Math.min(clip.fadeIn || 0, clip.dur / 2); clip.fadeOut = Math.min(clip.fadeOut || 0, clip.dur / 2);
      const delta = clip.start + clip.dur - oldEnd;
      if (push && Math.abs(delta) > 1e-4) for (const c of track.clips) if (c !== clip && c.start >= oldEnd - 1e-4) c.start = Math.max(0, c.start + delta);
      done++;
    }
    S.refresh.structure();
    S.timeline.resize();
    return done;
  };

  /** The Speed dialog for a clip (or every selected clip, if this one is part of the selection). */
  SP.dialog = (clip, track) => {
    const sel = S.timeline.selectedClips ? S.timeline.selectedClips() : [];
    const items = sel.some((x) => x.clip === clip) && sel.length > 1 ? sel : [{ clip, track }];
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.style.width = 'min(460px, 94vw)';
    dlg.innerHTML = `<h3>Speed — ${items.length > 1 ? items.length + ' clips' : '“' + clip.name.replace(/[<>&]/g, '') + '”'}</h3>
      <div class="sp-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"></div>
      <div class="param"><label>Speed</label><input type="range" class="sp-r" min="50" max="200" step="1" value="125"><span class="val sp-v"></span></div>
      <div style="display:flex;gap:8px;margin:10px 0" class="sp-mode"></div>
      <p class="hint sp-hint" style="margin:0 0 8px"></p>
      <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0 14px"><input type="checkbox" class="sp-push" checked> Move the clips after it so nothing overlaps</label>
      <div class="sp-prog hint" style="min-height:16px"></div>
      <div class="row"><button type="button" class="btn sp-cancel">Cancel</button><button type="button" class="btn primary sp-go">Apply</button></div>`;
    const $ = (s) => dlg.querySelector(s);
    let keep = false;
    const r = $('.sp-r'), v = $('.sp-v');
    const show = () => { const x = +r.value; v.textContent = x + '%' + (x > 100 ? ' (faster)' : x < 100 ? ' (slower)' : ''); $('.sp-hint').textContent = keep ? 'Keep pitch: only the speed changes — the vocal stays in key. Best for small changes (75–135%).' : 'Sped up / slowed: speed and pitch change together, like the TikTok sped-up or slowed + reverb versions.'; };
    [[50, 'Half'], [75, 'Slowed'], [85, 'Slightly slow'], [115, 'Slightly fast'], [125, 'Sped up'], [150, 'Nightcore'], [200, 'Double']].forEach(([p, l]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost sm'; b.textContent = l + ' ' + p + '%';
      b.onclick = () => { r.value = p; show(); }; $('.sp-presets').appendChild(b);
    });
    const modeBtns = [['Sped up / slowed (pitch changes)', false], ['Keep pitch', true]].map(([l, k]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm' + (k === keep ? ' primary' : ''); b.textContent = l;
      b.onclick = () => { keep = k; modeBtns.forEach((x) => x.className = 'btn sm' + (x._k === keep ? ' primary' : '')); show(); };
      b._k = k; $('.sp-mode').appendChild(b); return b;
    });
    r.oninput = show; show();
    $('.sp-cancel').onclick = () => dlg.close();
    $('.sp-go').onclick = async () => {
      const rate = +r.value / 100;
      if (Math.abs(rate - 1) < 0.005) return dlg.close();
      $('.sp-go').disabled = true; $('.sp-prog').textContent = keep ? 'Time-stretching…' : 'Processing…';
      await breathe();
      try {
        const n = await SP.apply(items, rate, { keepPitch: keep, push: $('.sp-push').checked });
        S.toast((n > 1 ? n + ' clips' : 'Clip') + ' set to ' + Math.round(rate * 100) + '% speed' + (keep ? ' (pitch kept)' : '') + '. Undo (Ctrl+Z) to go back.');
        dlg.close();
      } catch (e) { $('.sp-prog').textContent = 'Could not change the speed: ' + (e.message || e); $('.sp-go').disabled = false; }
    };
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  };
})();

/* Duplicate a track: same clips, effects, volume/pan and colour, placed right below the original. */
(function () {
  const S = window.Studio;
  S.duplicateTrack = (track) => {
    const p = S.project, i = p.tracks.indexOf(track);
    if (i < 0) return null;
    S.history.push();
    const t = JSON.parse(JSON.stringify(track));
    t.id = S.uid();
    t.name = (track.name || 'Track') + ' copy';
    t.arm = false; t.solo = false;
    t.fx = (t.fx || []).map((f) => Object.assign(f, { id: S.uid() }));
    t.clips = (t.clips || []).map((c) => Object.assign(c, { id: S.uid() }));
    p.tracks.splice(i + 1, 0, t);
    S.refresh.structure();
    S.timeline.resize();
    S.toast('Duplicated “' + (track.name || 'track') + '”.');
    return t;
  };
})();
