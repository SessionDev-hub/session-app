/* Export stems: every track as its own audio file, all the same length and starting at 0:00, so they line up
 * when dropped into FL Studio, Ableton, Pro Tools, Logic, BandLab… Packed into one .zip.
 *   • Mixed  — each track through its own effects, volume and pan (no master effects), like a mixer stem.
 *   • Raw    — just the clips, no effects, volume at 0 dB, centred.
 *   • Both   — two folders in the zip. */
(function () {
  const S = window.Studio;
  const ST = (S.stems = {});
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const breathe = () => new Promise((r) => setTimeout(r, 20));
  const safe = (t) => String(t || 'Track').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'Track';

  /* ---- tiny ZIP writer (stored, no compression: audio doesn't shrink anyway) ---- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  ST.zip = (files) => {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); // UTF-8 names
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, a) => n + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  };

  /** One track on its own. mixed: its effects + fader + pan. raw: clips only. Master effects are never applied. */
  ST.renderTrack = async (track, mixed) => {
    const p = clone(S.project);
    p.master = Object.assign({}, p.master, { fx: [], vol: 1 });
    for (const t of p.tracks) {
      const me = t.id === track.id;
      t.solo = false; t.mute = !me;
      // other tracks: keep their clips (so every stem is the full song length) but silence and skip them
      if (!me) { t.fx = []; (t.clips || []).forEach((c) => (c.muted = true)); }
      if (me && !mixed) { t.fx = []; t.vol = 1; t.pan = 0; }
    }
    const usesVst = mixed && S.native && S.native.projectUsesNative(p);
    if (!usesVst) return S.renderMix(p, { tail: 2.5 });
    // VST3 effects only run live: play just this track through the real engine and record it (takes the song's length)
    const real = S.project, saved = { tracks: real.tracks.map((t) => ({ solo: t.solo, mute: t.mute })), mfx: (real.master.fx || []).map((f) => f.bypass), mvol: real.master.vol };
    try {
      real.tracks.forEach((t) => { t.solo = t.id === track.id; t.mute = false; });
      (real.master.fx || []).forEach((f) => (f.bypass = true));
      real.master.vol = 1;
      S.engine.sync(real);
      await breathe();
      return await S.native.bounce(real, { tail: 2.5 });
    } finally {
      real.tracks.forEach((t, i) => Object.assign(t, saved.tracks[i]));
      (real.master.fx || []).forEach((f, i) => (f.bypass = saved.mfx[i]));
      real.master.vol = saved.mvol;
      S.engine.sync(real);
    }
  };

  const encode = async (buf, fmt) => (fmt === 'flac' ? S.encodeFlac(buf, { bits: 24 }) : S.encodeWav(buf));

  ST.dialog = () => {
    const tracks = S.project.tracks.filter((t) => (t.clips || []).length);
    if (!tracks.length) return S.toast('Nothing to export yet: no clips on any track.');
    if (S.engine.isRecording) return S.toast('Stop recording first.');
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.style.width = 'min(480px, 94vw)';
    const vstTracks = tracks.filter((t) => (t.fx || []).some((f) => !f.bypass && /^vst3:/.test(f.pluginId || '')));
    dlg.innerHTML = `<h3 style="margin:0 0 4px">Export stems</h3>
      <p class="hint" style="margin:0 0 12px">Every track as its own file, all starting at 0:00 and the same length, so they line up in FL Studio, Ableton, Pro Tools, Logic or BandLab. ${tracks.length} track${tracks.length > 1 ? 's' : ''} with audio.</p>
      <div class="param"><label>Stems</label><span class="seg rec-seg st-mode"></span></div>
      <p class="hint st-mode-hint" style="margin:2px 0 10px"></p>
      <div class="param"><label>Format</label><span class="seg rec-seg st-fmt"></span></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin:12px 0 4px"><input type="checkbox" class="st-mix" checked> Also include the full mix (with master effects)</label>
      ${vstTracks.length ? '<p class="hint" style="margin:6px 0 0">' + vstTracks.length + ' track' + (vstTracks.length > 1 ? 's use' : ' uses') + ' VST3 plugins: for Mixed stems those play through in real time, so they take as long as the song each.</p>' : ''}
      <div class="hint st-prog" style="min-height:18px;margin-top:10px"></div>
      <div class="row"><button type="button" class="btn st-cancel">Cancel</button><button type="button" class="btn primary st-go">Export stems</button></div>`;
    const $ = (s) => dlg.querySelector(s);
    let mode = 'mixed', fmt = 'wav', busy = false;
    const seg = (box, opts, get, set, after) => opts.forEach(([v, l]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'seg-b' + (get() === v ? ' on' : ''); b.textContent = l;
      b.onclick = () => { set(v); box.querySelectorAll('.seg-b').forEach((x) => x.classList.remove('on')); b.classList.add('on'); if (after) after(); };
      box.appendChild(b);
    });
    const modeHint = () => ($('.st-mode-hint').textContent = { mixed: 'Each track with its effects, volume and pan, the way it sounds in your mixer (no master effects).', raw: 'Just the recorded/imported audio: no effects, 0 dB, centred. Best if someone else will mix it.', both: 'Two folders in the zip: Mixed and Raw.' }[mode]);
    seg($('.st-mode'), [['mixed', 'Mixed (with effects)'], ['raw', 'Raw (no effects)'], ['both', 'Both']], () => mode, (v) => (mode = v), modeHint);
    seg($('.st-fmt'), [['wav', 'WAV'], ['flac', 'FLAC 24-bit (smaller)']], () => fmt, (v) => (fmt = v));
    modeHint();
    $('.st-cancel').onclick = () => { if (!busy) dlg.close(); };
    $('.st-go').onclick = async () => {
      busy = true; $('.st-go').disabled = true; $('.st-cancel').disabled = true;
      const prog = $('.st-prog'), files = [], ext = fmt === 'flac' ? 'flac' : 'wav';
      const modes = mode === 'both' ? ['mixed', 'raw'] : [mode];
      if (S.engine.playing) S.stopTransport();
      try {
        const used = {};
        for (const m of modes) {
          for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            prog.textContent = (m === 'mixed' ? 'Mixed' : 'Raw') + ' stem ' + (i + 1) + ' of ' + tracks.length + ': ' + (t.name || 'Track') + '…';
            await breathe();
            const buf = await ST.renderTrack(t, m === 'mixed');
            let base = String(S.project.tracks.indexOf(t) + 1).padStart(2, '0') + ' ' + safe(t.name);
            const key = m + base; used[key] = (used[key] || 0) + 1; if (used[key] > 1) base += ' (' + used[key] + ')';
            files.push({ name: (modes.length > 1 ? (m === 'mixed' ? 'Mixed' : 'Raw') + '/' : '') + base + '.' + ext, data: await encode(buf, fmt) });
          }
        }
        if ($('.st-mix').checked) {
          prog.textContent = 'Full mix…'; await breathe();
          files.push({ name: '00 Full mix.' + ext, data: await encode(await S.renderSongBuffer(), fmt) });
        }
        prog.textContent = 'Packing the zip…'; await breathe();
        const zip = ST.zip(files);
        const name = safe(S.project.name || 'Session') + ' stems.zip';
        const path = await window.studioHost.saveFile({ data: zip, binary: true, defaultName: name, filters: [{ name: 'Zip', extensions: ['zip'] }] });
        if (path) { S.toast('Exported ' + files.length + ' stems.'); dlg.close(); }
        else prog.textContent = 'Not saved.';
      } catch (e) { prog.textContent = 'Couldn’t export stems: ' + (e.message || e); }
      busy = false; $('.st-go').disabled = false; $('.st-cancel').disabled = false;
    };
    dlg.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  };
})();
