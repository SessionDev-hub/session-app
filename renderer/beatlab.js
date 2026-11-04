/* Beat Lab — the UI. "FL but way simpler": dedicated tabs per instrument, a step grid for drums,
 * a mini piano roll for 808 / keys / custom samples, live playback, and one button to drop the
 * finished pattern onto a track. Everything lives in project.beat, so it saves and travels.
 */
(function () {
  const S = window.Studio;
  const BL = (S.beatlab = {});
  const B = () => S.beat;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

  let overlay = null, state = { tab: 'drums', roll: {} /* channelId -> {len} */ };
  let paint = null; // active drag: { kind:'drum'|'roll', value, chId } — press a cell and drag to paint

  function style() {
    if (document.getElementById('bl-style')) return;
    const s = document.createElement('style'); s.id = 'bl-style';
    s.textContent = `
    #beatlab{position:fixed;inset:0;z-index:380;display:flex;flex-direction:column;background:var(--bg,#0b0c10);color:var(--text,#e9eaf0);font:13px/1.4 var(--font,'Segoe UI',system-ui,sans-serif)}
    #beatlab .bl-top{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.08));flex-wrap:wrap}
    #beatlab .bl-title{font-weight:800;font-size:16px;letter-spacing:-.01em;margin-right:6px}
    #beatlab .bl-sp{flex:1}
    #beatlab .bl-tabs{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.08));flex-wrap:wrap}
    #beatlab .bl-tab{appearance:none;border:1px solid transparent;background:transparent;color:var(--text);font:inherit;font-weight:700;padding:7px 15px;border-radius:999px;cursor:pointer}
    #beatlab .bl-tab:hover{background:rgba(255,255,255,.06)}
    #beatlab .bl-tab.on{background:var(--accent-grad,#8b7bff);color:#fff}
    #beatlab .bl-body{flex:1;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column}
    #beatlab .bl-io{font-size:11px;color:var(--dim,#8a8d99);margin:0 0 10px}
    #beatlab .bl-num{width:60px;background:#14161c;border:1px solid rgba(255,255,255,.14);color:var(--text);border-radius:7px;padding:5px 7px;font:inherit;text-align:center}
    #beatlab .bl-page{flex:1;min-height:0;display:flex;flex-direction:column}
    /* FL-style channel rack — fills the screen */
    #beatlab .bl-rack{flex:1;min-height:0;display:flex;flex-direction:column;background:linear-gradient(180deg,#16181f,#101117);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px}
    #beatlab .bl-rows{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px}
    #beatlab .bl-row{flex:1 1 0;min-height:44px;max-height:98px;display:flex;align-items:stretch;gap:10px}
    #beatlab .bl-name{width:170px;flex:none;display:flex;flex-direction:column;justify-content:center;gap:8px;font-weight:600;background:linear-gradient(180deg,#2a2d37,#1e212a);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 11px;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 2px 5px rgba(0,0,0,.35)}
    #beatlab .bl-nrow{display:flex;align-items:center;gap:7px}
    #beatlab .bl-dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 7px currentColor}
    #beatlab .bl-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
    #beatlab .bl-led{width:19px;height:19px;flex:none;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:#14161c;cursor:pointer;color:var(--dim);font-size:9px;font-weight:700;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,.5) inset}
    #beatlab .bl-mute.on{background:radial-gradient(circle at 50% 38%,#ff9a6b,#ff4d5e);border-color:transparent;color:#2a0f10;box-shadow:0 0 9px rgba(255,90,80,.75)}
    #beatlab .bl-solo.on{background:radial-gradient(circle at 50% 38%,#8ff0b0,#36d47a);border-color:transparent;color:#0c2a17;box-shadow:0 0 9px rgba(70,220,130,.75)}
    #beatlab .bl-vol{width:100%;height:4px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.16);border-radius:3px;outline:none;cursor:pointer}
    #beatlab .bl-vol::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#cdd3e6;cursor:pointer}
    #beatlab .bl-cells{flex:1;display:flex;gap:4px;align-items:stretch}
    #beatlab .bl-cell{flex:1 1 0;min-width:12px;border-radius:6px;background:linear-gradient(180deg,#191b22,#111218);border:1px solid rgba(255,255,255,.06);box-shadow:0 1px 2px rgba(0,0,0,.5) inset;cursor:pointer;transition:transform .05s}
    #beatlab .bl-cell.beat4{background:linear-gradient(180deg,#22252f,#15171e)}
    #beatlab .bl-cell.grp{margin-left:12px}
    #beatlab .bl-cell:active{transform:scale(.96)}
    #beatlab .bl-cell.on{background:linear-gradient(180deg,#ffbe5c,#ff7a1f);border-color:rgba(255,190,110,.6);box-shadow:0 0 11px rgba(255,140,45,.6),0 1px 0 rgba(255,255,255,.4) inset}
    #beatlab .bl-cell.playing{outline:2px solid #fff;outline-offset:-1px}
    #beatlab .bl-cell.on.playing{box-shadow:0 0 18px rgba(255,165,65,.95),0 1px 0 rgba(255,255,255,.55) inset}
    /* beat-number ruler */
    #beatlab .bl-ruler{display:flex;gap:10px;align-items:center;margin:0 0 10px;flex:none}
    #beatlab .bl-rpad{width:170px;flex:none}
    #beatlab .bl-rnums{flex:1;display:flex;gap:4px}
    #beatlab .bl-rn{flex:1 1 0;min-width:12px;text-align:center;font-size:10px;color:var(--dim)}
    #beatlab .bl-rn.grp{margin-left:12px}
    #beatlab .bl-rn.b1{color:var(--text);font-weight:700}
    #beatlab .bl-add{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;flex:none}
    /* piano roll */
    #beatlab .bl-roll{flex:1;min-height:0;overflow:auto;background:linear-gradient(180deg,#16181f,#101117);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px}
    #beatlab .bl-rpad-k{width:52px;flex:none}
    #beatlab .bl-rtools{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;flex:none}
    #beatlab .bl-prow{display:flex;align-items:center;gap:10px;height:21px}
    #beatlab .bl-prow.blk{background:rgba(0,0,0,.22);border-radius:4px}
    #beatlab .bl-key{width:52px;flex:none;font-size:10.5px;color:var(--dim);text-align:right;padding-right:6px}
    #beatlab .bl-key.black{color:#767985}
    #beatlab .bl-pcells{flex:1;display:flex;gap:4px;align-items:center}
    #beatlab .bl-pc{flex:1 1 0;min-width:10px;height:19px;border-radius:4px;background:linear-gradient(180deg,#191b22,#111218);border:1px solid rgba(255,255,255,.05);box-shadow:0 1px 2px rgba(0,0,0,.5) inset;cursor:pointer}
    #beatlab .bl-pc.beat4{background:linear-gradient(180deg,#22252f,#15171e)}
    #beatlab .bl-pc.grp{margin-left:12px}
    #beatlab .bl-pc.on{background:linear-gradient(180deg,#9aa6ff,#5c6cff);border-color:transparent;box-shadow:0 0 8px rgba(110,120,255,.6),0 1px 0 rgba(255,255,255,.3) inset}
    #beatlab .bl-pc.playing{outline:2px solid rgba(255,255,255,.75);outline-offset:-1px}
    #beatlab .bl-seg{display:inline-flex;border:1px solid var(--line-hi,rgba(255,255,255,.14));border-radius:8px;overflow:hidden}
    #beatlab .bl-seg button{background:transparent;border:0;color:var(--text);padding:5px 10px;cursor:pointer;font:inherit}
    #beatlab .bl-seg button.on{background:var(--accent,#8b7bff);color:#fff}
    #beatlab .bl-lbl{font-size:11px;color:var(--dim)}
    `;
    document.head.appendChild(s);
  }
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const button = (txt, cls, on) => { const b = el('button', cls); b.type = 'button'; b.textContent = txt; if (on) b.onclick = on; return b; };
  const DOT = ['#ff6b6b', '#ffd166', '#4dd2ff', '#a78bfa', '#52e3a4', '#ff9f43', '#f472b6', '#60a5fa', '#f9739a', '#6ee7b7'];

  // beat-number ruler that lines up with the step grid (one number per group of 4 steps = 1 beat)
  function ruler(total, padCls, cellW) {
    const r = el('div', 'bl-ruler');
    r.append(el('div', padCls));
    const nums = el('div', 'bl-rnums');
    for (let s = 0; s < total; s++) {
      const n = el('div', 'bl-rn' + (s % 4 === 0 ? ' b1' : '') + (s % 4 === 0 && s > 0 ? ' grp' : ''));
      if (cellW) n.style.width = cellW;
      n.textContent = s % 4 === 0 ? String(s / 4 + 1) : '';
      nums.appendChild(n);
    }
    r.appendChild(nums);
    return r;
  }

  BL.open = () => {
    style();
    B().ensure ? B().ensure(S.project) : S.beat.ensure(S.project);
    if (!overlay) { overlay = el('div'); overlay.id = 'beatlab'; document.body.appendChild(overlay); }
    overlay.style.display = 'flex';
    render();
    const btn = document.getElementById('btn-beat'); if (btn) btn.classList.add('on');
  };
  BL.close = () => { if (overlay) overlay.style.display = 'none'; if (S.beat.isPlaying()) S.beat.stop(); const b = document.getElementById('btn-beat'); if (b) b.classList.remove('on'); };
  BL.isOpen = () => !!overlay && overlay.style.display !== 'none';
  BL.toggle = () => (BL.isOpen() ? BL.close() : BL.open());

  function render() {
    if (!overlay) return;
    overlay.textContent = '';
    overlay.append(topBar(), tabBar(), bodyFor(state.tab));
    highlight(S.beat.currentStep);
  }

  function topBar() {
    const bar = el('div', 'bl-top');
    const play = button('▶ Play', 'btn primary', () => { S.beat.toggle(); document.getElementById('bl-play').textContent = S.beat.isPlaying() ? '■ Stop' : '▶ Play'; });
    play.id = 'bl-play'; if (S.beat.isPlaying()) play.textContent = '■ Stop';
    const beat = B().get();
    // bars selector
    const barsSeg = el('span', 'bl-seg');
    [1, 2, 4].forEach((n) => { const b = button(n + (n > 1 ? ' bars' : ' bar'), beat.bars === n ? 'on' : ''); b.onclick = () => { S.beat.resize(beat.steps, n); render(); }; barsSeg.appendChild(b); });
    // swing
    const swing = el('input'); swing.type = 'range'; swing.min = 0; swing.max = 60; swing.value = Math.round((beat.swing || 0) * 100); swing.style.width = '90px';
    swing.oninput = () => { beat.swing = swing.value / 100; if (S.beat.isPlaying()) S.beat.restart(); };
    // editable tempo, right here in Beat Lab
    const bpm = el('input', 'bl-num'); bpm.type = 'number'; bpm.min = 20; bpm.max = 400; bpm.value = S.project.bpm || 120;
    bpm.onchange = () => { const v = Math.max(20, Math.min(400, parseInt(bpm.value, 10) || 120)); S.project.bpm = v; bpm.value = v; if (S.tempo && S.tempo.refresh) try { S.tempo.refresh(); } catch (e) {} if (S.beat.isPlaying()) S.beat.restart(); };
    const clear = button('Clear', 'btn ghost', () => { if (confirm('Clear the whole pattern?')) { S.beat.clear(); render(); } });
    const add = button('＋ Add to track', 'btn', addToTrack); add.id = 'bl-add-track';
    bar.append(el('span', 'bl-title', 'Beat Lab'), play, el('span', 'bl-lbl', 'BPM'), bpm, barsSeg, el('span', 'bl-lbl', 'Swing'), swing,
      el('span', 'bl-sp'), clear, add, button('✕ Close', 'btn ghost', BL.close));
    return bar;
  }

  function tabBar() {
    const bar = el('div', 'bl-tabs');
    [['drums', 'Drums'], ['bass', '808'], ['keys', 'Keys'], ['custom', 'Custom']].forEach(([id, label]) => {
      const b = button(label, 'bl-tab' + (state.tab === id ? ' on' : ''), () => { state.tab = id; render(); });
      bar.appendChild(b);
    });
    return bar;
  }

  function bodyFor(tab) {
    const body = el('div', 'bl-body');
    if (tab === 'drums') body.append(drumGrid());
    else body.append(instrEditor(tab));
    return body;
  }

  /* ---------- drum channel-rack ---------- */
  function drumGrid() {
    const beat = B().get();
    const total = S.beat.totalSteps(beat);
    const wrap = el('div', 'bl-page');
    wrap.append(el('p', 'bl-io', 'Tap the pads to build your beat — press and drag to paint a row. M = mute, S = solo, slider = volume.'));
    const rack = el('div', 'bl-rack');
    rack.append(ruler(total, 'bl-rpad'));
    const rows = el('div', 'bl-rows');
    beat.channels.filter((c) => c.type === 'drum').forEach((c, i) => rows.append(drumRow(c, total, i)));
    rack.append(rows);
    wrap.append(rack);
    const add = el('div', 'bl-add');
    S.beatInstruments.DRUM_KINDS.forEach((k) => add.append(button('＋ ' + k, 'btn ghost sm', () => { S.beat.addChannel('drum', { kind: k, name: k[0].toUpperCase() + k.slice(1) }); render(); })));
    wrap.append(add);
    return wrap;
  }
  function drumRow(c, total, idx) {
    const row = el('div', 'bl-row');
    const name = el('div', 'bl-name');
    const nrow = el('div', 'bl-nrow');
    const dot = el('span', 'bl-dot'); dot.style.color = DOT[idx % DOT.length]; dot.style.background = 'currentColor';
    const nm = el('span', 'bl-nm'); nm.textContent = c.name; nm.title = 'Click to remove';
    nm.onclick = () => { if (confirm('Remove ' + c.name + '?')) { S.beat.removeChannel(c.id); render(); } };
    const mute = button('M', 'bl-led bl-mute' + (c.mute ? ' on' : ''), () => { c.mute = !c.mute; mute.classList.toggle('on', c.mute); if (S.beat.isPlaying()) S.beat.restart(); });
    mute.title = 'Mute';
    const solo = button('S', 'bl-led bl-solo' + (c.solo ? ' on' : ''), () => { c.solo = !c.solo; solo.classList.toggle('on', c.solo); if (S.beat.isPlaying()) S.beat.restart(); });
    solo.title = 'Solo';
    nrow.append(dot, nm, mute, solo);
    const vol = el('input', 'bl-vol'); vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = Math.round((c.vol == null ? 0.9 : c.vol) * 100); vol.title = 'Volume';
    vol.oninput = () => { c.vol = vol.value / 100; };
    vol.onchange = () => { if (S.beat.isPlaying()) S.beat.restart(); };
    name.append(nrow, vol);
    const cells = el('div', 'bl-cells');
    const setCell = (s, on) => { c.cells[s] = on; cells.children[s].classList.toggle('on', on); };
    const audition = () => { if (S.ctx) try { S.beatInstruments.make(S.ctx, c).trigger(S.ctx.destination, S.ctx.currentTime, { vel: c.vol }); } catch (e) {} };
    for (let s = 0; s < total; s++) {
      const cell = el('div', 'bl-cell' + (s % 4 === 0 ? ' beat4' : '') + (s % 4 === 0 && s > 0 ? ' grp' : '') + (c.cells[s] ? ' on' : ''));
      cell.dataset.step = s;
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const on = !c.cells[s]; setCell(s, on); paint = { kind: 'drum', value: on, chId: c.id };
        if (on) audition();
      });
      cells.appendChild(cell);
    }
    // drag to paint across the row (press-and-drag), mouse and touch
    cells.addEventListener('pointermove', (e) => {
      if (!paint || paint.kind !== 'drum' || paint.chId !== c.id) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const cell = t && t.closest && t.closest('.bl-cell');
      if (cell && cell.parentElement === cells) { const s = +cell.dataset.step; if (c.cells[s] !== paint.value) { setCell(s, paint.value); if (paint.value) audition(); } }
    });
    row.append(name, cells);
    return row;
  }

  /* ---------- pitched editors (808 / keys / custom) ---------- */
  function instrEditor(tab) {
    const beat = B().get();
    const wrap = el('div', 'bl-page');
    if (tab === 'custom') { wrap.append(customTab(beat.channels.find((c) => c.type === 'custom'))); return wrap; }
    let ch = beat.channels.find((c) => c.type === tab);
    if (!ch) ch = S.beat.addChannel(tab, { name: tab === 'bass' ? '808' : 'Keys' });
    wrap.append(el('p', 'bl-io', 'Click the grid to place notes, or press and drag to paint. Pick a note length, scroll octaves, set the volume.'));
    wrap.append(rollTools(ch), pianoRoll(ch, state.roll[ch.id] = state.roll[ch.id] || { len: 2, oct: 0 }));
    return wrap;
  }

  function rollTools(ch) {
    const tools = el('div', 'bl-rtools');
    const st = (state.roll[ch.id] = state.roll[ch.id] || { len: 2, oct: 0 });
    const lenSeg = el('span', 'bl-seg');
    [1, 2, 4].forEach((n) => { const b = button(n + ' step' + (n > 1 ? 's' : ''), st.len === n ? 'on' : ''); b.onclick = () => { st.len = n; lenSeg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }; lenSeg.appendChild(b); });
    // octave nav — shifts which octaves the grid shows
    const octSeg = el('span', 'bl-seg');
    const octDn = button('–', '', () => { st.oct = Math.max(-3, (st.oct || 0) - 1); render(); });
    const octUp = button('+', '', () => { st.oct = Math.min(4, (st.oct || 0) + 1); render(); });
    octSeg.append(octDn, octUp);
    // per-instrument volume
    const vol = el('input', 'bl-vol'); vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = Math.round((ch.vol == null ? 0.9 : ch.vol) * 100); vol.style.width = '110px'; vol.title = 'Volume';
    vol.oninput = () => { ch.vol = vol.value / 100; };
    vol.onchange = () => { if (S.beat.isPlaying()) S.beat.restart(); };
    tools.append(el('span', 'bl-lbl', 'Note length'), lenSeg, el('span', 'bl-lbl', 'Octave'), octSeg,
      el('span', 'bl-lbl', 'Volume'), vol, button('Clear notes', 'btn ghost sm', () => { ch.notes = []; render(); }));
    return tools;
  }

  /* ---------- Custom tab: scan Your Sounds + import, then play on the roll ---------- */
  function customTab(ch) {
    const wrap = el('div', 'bl-page');
    wrap.append(el('p', 'bl-io', 'Pick one of your saved sounds, or import a new one, then play it on the grid.'));
    const bar = el('div'); bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px';
    bar.append(button('＋ Import a sound…', 'btn primary', () => importCustom(B().get().channels.find((c) => c.type === 'custom'))));
    wrap.append(bar);
    // scan the user's sound library
    const lib = el('div'); lib.style.cssText = 'margin-bottom:12px';
    lib.append(el('span', 'bl-lbl', 'Scanning your sounds…'));
    wrap.append(lib);
    if (S.sounds && S.sounds.list) {
      S.sounds.list().then((rows) => {
        lib.textContent = '';
        if (!rows || !rows.length) { lib.append(el('span', 'bl-lbl', 'No saved sounds yet — import one above (it’s saved to Your Sounds).')); return; }
        lib.append(el('div', 'bl-lbl', 'Your sounds — tap one to load it:'));
        const grid = el('div'); grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
        rows.forEach((r) => { const active = ch && ch.soundId === r.id; grid.append(button((active ? '● ' : '') + r.name, 'btn ghost sm' + (active ? ' on' : ''), () => loadLibrarySound(r.id, r.name))); });
        lib.append(grid);
      }).catch(() => { lib.textContent = ''; });
    }
    if (ch && ch.assetId) {
      wrap.append(el('p', 'bl-io', 'Playing: ' + ch.name + ' — click/drag the grid to place notes.'));
      wrap.append(rollTools(ch), pianoRoll(ch, state.roll[ch.id] = state.roll[ch.id] || { len: 2, oct: 0 }));
    } else {
      wrap.append(el('p', 'bl-io', 'Load or import a sound to start playing it.'));
    }
    return wrap;
  }

  async function loadLibrarySound(id, name) {
    try {
      const rec = await S.sounds.getOne(id);
      if (!rec) return;
      const buf = await S.ctx.decodeAudioData(await rec.blob.arrayBuffer());
      const assetId = S.addAsset(name, buf);
      let ch = B().get().channels.find((c) => c.type === 'custom');
      if (ch) { ch.assetId = assetId; ch.name = name; ch.soundId = id; }
      else ch = S.beat.addChannel('custom', { name, assetId, soundId: id, root: 60 });
      render();
    } catch (e) { S.toast && S.toast('Could not load that sound'); }
  }

  function pianoRoll(ch, st) {
    const beat = B().get();
    const total = S.beat.totalSteps(beat);
    const root = (ch.type === 'bass' ? 36 : 60) + (st.oct || 0) * 12; // 808 low, keys mid; octave-shiftable
    const rows = ch.type === 'bass' ? 13 : 25;  // one or two octaves
    const roll = el('div', 'bl-roll');
    roll.append(ruler(total, 'bl-rpad-k')); // beat numbers line up with the key grid
    const noteAt = (note, step) => (ch.notes || []).find((x) => x.note === note && x.step === step);
    for (let r = rows - 1; r >= 0; r--) {
      const note = root + r;
      const isBlack = NOTE_NAMES[note % 12].includes('#');
      const prow = el('div', 'bl-prow' + (isBlack ? ' blk' : ''));
      const key = el('div', 'bl-key' + (isBlack ? ' black' : ''), noteName(note));
      const cells = el('div', 'bl-pcells');
      const audition = (n) => { if (S.ctx) try { S.beatInstruments.make(S.ctx, ch).trigger(S.ctx.destination, S.ctx.currentTime, { note: n, vel: ch.vol, dur: st.len * S.beat.stepDur(beat) }); } catch (e) {} };
      const setNote = (pc, n, s, on) => {
        const ex = noteAt(n, s);
        if (on && !ex) { ch.notes.push({ step: s, note: n, len: st.len, vel: 1 }); pc.classList.add('on'); audition(n); }
        else if (!on && ex) { ch.notes = ch.notes.filter((x) => x !== ex); pc.classList.remove('on'); }
      };
      for (let s = 0; s < total; s++) {
        const pc = el('div', 'bl-pc' + (s % 4 === 0 ? ' beat4' : '') + (s % 4 === 0 && s > 0 ? ' grp' : '') + (noteAt(note, s) ? ' on' : ''));
        pc.dataset.step = s; pc.dataset.note = note;
        pc.addEventListener('pointerdown', (e) => { e.preventDefault(); const on = !noteAt(note, s); setNote(pc, note, s, on); paint = { kind: 'roll', value: on, chId: ch.id }; });
        cells.appendChild(pc);
      }
      // drag to paint notes (press-and-drag) across steps and pitches
      cells.addEventListener('pointermove', (e) => {
        if (!paint || paint.kind !== 'roll' || paint.chId !== ch.id) return;
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const pc = t && t.closest && t.closest('.bl-pc');
        if (pc) setNote(pc, +pc.dataset.note, +pc.dataset.step, paint.value);
      });
      prow.append(key, cells);
      roll.appendChild(prow);
    }
    return roll;
  }

  function importCustom() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'audio/*,.wav,.mp3,.flac,.ogg,.m4a';
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return;
      state.tab = 'custom';
      // Save it to Your Sounds so it's scannable next time, then load it as the custom instrument.
      if (S.sounds && S.sounds.importFiles) {
        let rec = null;
        try { await S.sounds.importFiles([f], (r) => { rec = r; }); } catch (e) {}
        if (rec) return loadLibrarySound(rec.id, rec.name);
      }
      // fallback if the library isn't available
      try {
        const buf = await S.ctx.decodeAudioData(await f.arrayBuffer());
        const name = f.name.replace(/\.[^.]+$/, '');
        const assetId = S.addAsset(name, buf);
        let ch = B().get().channels.find((c) => c.type === 'custom');
        if (ch) { ch.assetId = assetId; ch.name = name; } else S.beat.addChannel('custom', { name, assetId, root: 60 });
        render();
      } catch (e) { S.toast && S.toast('Could not read that sound'); }
    };
    i.click();
  }

  /* ---------- add the pattern to a track ---------- */
  async function addToTrack() {
    const btn = document.getElementById('bl-add-track');
    if (btn) { btn.disabled = true; btn.textContent = 'Rendering…'; }
    try {
      const buf = await S.beat.renderOffline(1);
      const id = S.addAsset('Beat', buf);
      // onto the armed track, else a fresh one
      let idx = S.project.tracks.findIndex((t) => t.arm);
      if (idx < 0) { S.project.tracks.push(S.newTrack(S.project.tracks.length)); idx = S.project.tracks.length - 1; }
      S.addClip(idx, id, S.playhead || 0);
      S.refresh.structure();
      S.timeline.resize();
      S.toast && S.toast('Beat added to track ' + (idx + 1) + '. Close Beat Lab to arrange it.');
    } catch (e) { S.toast && S.toast('Could not add the beat: ' + (e.message || e)); }
    if (btn) { btn.disabled = false; btn.textContent = '＋ Add to track'; }
  }

  /* ---------- live playing-step highlight ---------- */
  function highlight(step) {
    if (!overlay) return;
    overlay.querySelectorAll('.playing').forEach((e) => e.classList.remove('playing'));
    if (step < 0) return;
    overlay.querySelectorAll('[data-step="' + step + '"]').forEach((e) => e.classList.add('playing'));
  }

  BL.init = () => {
    window.addEventListener('pointerup', () => { paint = null; });
    const b = document.getElementById('btn-beat');
    if (b) b.onclick = () => BL.toggle();
    try { S.on && S.on('beat-step', (s) => { if (BL.isOpen()) highlight(s); }); } catch (e) {}
    try { S.on && S.on('project-replaced', () => { if (BL.isOpen()) render(); }); } catch (e) {}
  };
})();
