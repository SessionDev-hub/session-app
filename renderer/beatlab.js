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
    #beatlab .bl-body{flex:1;min-height:0;overflow:auto;padding:14px}
    #beatlab .bl-io{font-size:11px;color:var(--dim,#8a8d99);margin:0 0 10px}
    /* drum grid */
    #beatlab .bl-rows{display:flex;flex-direction:column;gap:6px}
    #beatlab .bl-row{display:flex;align-items:center;gap:8px}
    #beatlab .bl-name{width:120px;flex:none;display:flex;align-items:center;gap:6px;font-weight:600}
    #beatlab .bl-name .bl-mute{width:16px;height:16px;border-radius:4px;border:1px solid var(--line-hi,rgba(255,255,255,.14));background:transparent;cursor:pointer;color:var(--dim);font-size:10px;line-height:1}
    #beatlab .bl-name .bl-mute.on{background:var(--rec,#ff4d5e);border-color:transparent;color:#fff}
    #beatlab .bl-cells{display:grid;grid-auto-flow:column;gap:4px;flex:1}
    #beatlab .bl-cell{height:30px;border-radius:6px;background:var(--panel2,#1c1e25);border:1px solid var(--line,rgba(255,255,255,.07));cursor:pointer}
    #beatlab .bl-cell.beat4{background:rgba(255,255,255,.06)}
    #beatlab .bl-cell.on{background:var(--accent,#8b7bff);border-color:transparent}
    #beatlab .bl-cell.playing{outline:2px solid #fff}
    #beatlab .bl-add{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}
    /* piano roll */
    #beatlab .bl-roll{display:flex;flex-direction:column;gap:3px}
    #beatlab .bl-prow{display:flex;align-items:center;gap:8px}
    #beatlab .bl-key{width:54px;flex:none;font-size:11px;color:var(--dim);text-align:right}
    #beatlab .bl-key.black{color:var(--text)}
    #beatlab .bl-pcells{display:grid;grid-auto-flow:column;gap:3px;flex:1}
    #beatlab .bl-pc{height:20px;border-radius:4px;background:var(--panel2,#1c1e25);border:1px solid var(--line,rgba(255,255,255,.06));cursor:pointer}
    #beatlab .bl-pc.beat4{background:rgba(255,255,255,.05)}
    #beatlab .bl-pc.on{background:var(--accent,#8b7bff);border-color:transparent}
    #beatlab .bl-pc.playing{outline:1px solid rgba(255,255,255,.6)}
    #beatlab .bl-seg{display:inline-flex;border:1px solid var(--line-hi,rgba(255,255,255,.14));border-radius:8px;overflow:hidden}
    #beatlab .bl-seg button{background:transparent;border:0;color:var(--text);padding:5px 10px;cursor:pointer;font:inherit}
    #beatlab .bl-seg button.on{background:var(--accent,#8b7bff);color:#fff}
    #beatlab .bl-lbl{font-size:11px;color:var(--dim)}
    `;
    document.head.appendChild(s);
  }
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const button = (txt, cls, on) => { const b = el('button', cls); b.type = 'button'; b.textContent = txt; if (on) b.onclick = on; return b; };

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
    const add = button('＋ Add to track', 'btn', addToTrack); add.id = 'bl-add-track';
    bar.append(el('span', 'bl-title', 'Beat Lab'), play, barsSeg, el('span', 'bl-lbl', 'Swing'), swing,
      el('span', 'bl-sp'), el('span', 'bl-lbl', (S.project.bpm || 120) + ' BPM · set in Tempo'), add,
      button('✕ Close', 'btn ghost', BL.close));
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
    const wrap = el('div');
    wrap.append(el('p', 'bl-io', 'Tap cells to build your drum pattern. Each column is a step.'));
    const rows = el('div', 'bl-rows');
    beat.channels.filter((c) => c.type === 'drum').forEach((c) => rows.append(drumRow(c, total)));
    wrap.append(rows);
    const add = el('div', 'bl-add');
    S.beatInstruments.DRUM_KINDS.forEach((k) => add.append(button('＋ ' + k, 'btn ghost sm', () => { S.beat.addChannel('drum', { kind: k, name: k[0].toUpperCase() + k.slice(1) }); render(); })));
    wrap.append(add);
    return wrap;
  }
  function drumRow(c, total) {
    const row = el('div', 'bl-row');
    const name = el('div', 'bl-name');
    const mute = button('M', 'bl-mute' + (c.mute ? ' on' : ''), () => { c.mute = !c.mute; mute.classList.toggle('on', c.mute); if (S.beat.isPlaying()) S.beat.restart(); });
    const nm = el('span'); nm.textContent = c.name; nm.title = 'Click to remove'; nm.style.cursor = 'pointer';
    nm.onclick = () => { if (confirm('Remove ' + c.name + '?')) { S.beat.removeChannel(c.id); render(); } };
    name.append(mute, nm);
    const cells = el('div', 'bl-cells'); cells.style.gridTemplateColumns = 'repeat(' + total + ',1fr)';
    for (let s = 0; s < total; s++) {
      const cell = el('div', 'bl-cell' + (s % 4 === 0 ? ' beat4' : '') + (c.cells[s] ? ' on' : ''));
      cell.dataset.step = s;
      cell.onclick = () => {
        c.cells[s] = !c.cells[s]; cell.classList.toggle('on', c.cells[s]);
        if (c.cells[s] && S.ctx) S.beatInstruments.make(S.ctx, c).trigger(S.ctx.destination, S.ctx.currentTime, { vel: c.vol }); // audition
      };
      cells.appendChild(cell);
    }
    row.append(name, cells);
    return row;
  }

  /* ---------- pitched editors (808 / keys / custom) ---------- */
  function instrEditor(tab) {
    const beat = B().get();
    let ch = beat.channels.find((c) => c.type === tab);
    const wrap = el('div');
    if (tab === 'custom' && !ch) {
      wrap.append(el('p', 'bl-io', 'Import one of your own sounds to play as an instrument.'));
      wrap.append(button('＋ Import a sound…', 'btn primary', importCustom));
      return wrap;
    }
    if (!ch) { ch = S.beat.addChannel(tab, { name: tab === 'bass' ? '808' : 'Keys' }); }
    wrap.append(el('p', 'bl-io', 'Click the grid to place notes. Pick a note length first.'));
    // length segment
    const tools = el('div'); tools.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap';
    const lenSeg = el('span', 'bl-seg');
    const st = (state.roll[ch.id] = state.roll[ch.id] || { len: 2 });
    [1, 2, 4].forEach((n) => { const b = button(n + ' step' + (n > 1 ? 's' : ''), st.len === n ? 'on' : ''); b.onclick = () => { st.len = n; lenSeg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }; lenSeg.appendChild(b); });
    tools.append(el('span', 'bl-lbl', 'Note length'), lenSeg, button('Clear notes', 'btn ghost sm', () => { ch.notes = []; render(); }));
    if (tab === 'custom') tools.append(button('Replace sound', 'btn ghost sm', () => importCustom(ch)));
    wrap.append(tools);
    wrap.append(pianoRoll(ch, st));
    return wrap;
  }

  function pianoRoll(ch, st) {
    const beat = B().get();
    const total = S.beat.totalSteps(beat);
    const root = ch.type === 'bass' ? 36 : 60; // 808 low, keys mid
    const rows = ch.type === 'bass' ? 13 : 25;  // one or two octaves
    const roll = el('div', 'bl-roll');
    const noteAt = (note, step) => (ch.notes || []).find((x) => x.note === note && x.step === step);
    for (let r = rows - 1; r >= 0; r--) {
      const note = root + r;
      const prow = el('div', 'bl-prow');
      const key = el('div', 'bl-key' + (NOTE_NAMES[note % 12].includes('#') ? ' black' : ''), noteName(note));
      const cells = el('div', 'bl-pcells'); cells.style.gridTemplateColumns = 'repeat(' + total + ',1fr)';
      for (let s = 0; s < total; s++) {
        const pc = el('div', 'bl-pc' + (s % 4 === 0 ? ' beat4' : '') + (noteAt(note, s) ? ' on' : ''));
        pc.dataset.step = s; pc.dataset.note = note;
        pc.onclick = () => {
          const ex = noteAt(note, s);
          if (ex) { ch.notes = ch.notes.filter((x) => x !== ex); pc.classList.remove('on'); }
          else {
            ch.notes.push({ step: s, note, len: st.len, vel: 1 });
            pc.classList.add('on');
            if (S.ctx) S.beatInstruments.make(S.ctx, ch).trigger(S.ctx.destination, S.ctx.currentTime, { note, vel: ch.vol, dur: st.len * S.beat.stepDur(beat) }); // audition
          }
        };
        cells.appendChild(pc);
      }
      prow.append(key, cells);
      roll.appendChild(prow);
    }
    return roll;
  }

  function importCustom(existing) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'audio/*,.wav,.mp3,.flac,.ogg,.m4a';
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return;
      try {
        const buf = await S.ctx.decodeAudioData(await f.arrayBuffer());
        const assetId = S.addAsset(f.name.replace(/\.[^.]+$/, ''), buf);
        if (existing) { existing.assetId = assetId; existing.name = f.name.replace(/\.[^.]+$/, ''); }
        else S.beat.addChannel('custom', { name: f.name.replace(/\.[^.]+$/, ''), assetId, root: 60 });
        state.tab = 'custom'; render();
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
    const b = document.getElementById('btn-beat');
    if (b) b.onclick = () => BL.toggle();
    try { S.on && S.on('beat-step', (s) => { if (BL.isOpen()) highlight(s); }); } catch (e) {}
    try { S.on && S.on('project-replaced', () => { if (BL.isOpen()) render(); }); } catch (e) {}
  };
})();
