/* Beat Lab — the UI. FL-style power, BandLab-simple look:
 *  • Channel rack with lots of sounds per drum, velocity per step, volume + pan per channel
 *  • Patterns (up to 16 bars each) and a Song view to arrange them
 *  • 808 with slides (overlap two notes), distortion / decay / glide / punch / tone
 *  • 12 melodic instruments, a piano roll with note lengths up to a full bar
 *  • Play notes from your computer keyboard (FL layout or one-row) or a MIDI keyboard, and record them live
 * Everything lives in project.beat, so it saves and travels with the song.
 */
(function () {
  const S = window.Studio;
  const BL = (S.beatlab = {});
  const B = () => S.beat;
  const BI = () => S.beatInstruments;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  const KB_KEY = 'ps.beatKeys';

  let overlay = null;
  const state = { tab: 'rack', velMode: false, roll: {}, kb: loadKb() };
  let paint = null;
  function loadKb() { try { return Object.assign({ layout: 'fl', rec: false, vel: 0.9 }, JSON.parse(localStorage.getItem(KB_KEY)) || {}); } catch (e) { return { layout: 'fl', rec: false, vel: 0.9 }; } }
  function saveKb() { try { localStorage.setItem(KB_KEY, JSON.stringify({ layout: state.kb.layout, vel: state.kb.vel })); } catch (e) {} }

  function style() {
    if (document.getElementById('bl-style')) return;
    const s = document.createElement('style'); s.id = 'bl-style';
    s.textContent = `
    body.bl-open .ctxmenu{z-index:420}
    #beatlab{position:fixed;inset:0;z-index:380;display:flex;flex-direction:column;background:var(--bg,#0b0c10);color:var(--text,#e9eaf0);font:13px/1.4 var(--font,'Segoe UI',system-ui,sans-serif)}
    #beatlab .bl-top{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
    #beatlab .bl-title{font-weight:800;font-size:16px;letter-spacing:-.01em;margin-right:4px}
    #beatlab .bl-sp{flex:1}
    #beatlab .bl-grp{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.025)}
    #beatlab .bl-tabs{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap;align-items:center}
    #beatlab .bl-tab{appearance:none;border:1px solid transparent;background:transparent;color:var(--text);font:inherit;font-weight:700;padding:7px 15px;border-radius:999px;cursor:pointer}
    #beatlab .bl-tab:hover{background:rgba(255,255,255,.06)}
    #beatlab .bl-tab.on{background:var(--accent-grad);color:#fff}
    #beatlab .bl-body{flex:1;min-height:0;overflow:hidden;padding:12px 14px;display:flex;flex-direction:column}
    #beatlab .bl-io{font-size:11.5px;color:var(--dim);margin:0 0 8px}
    #beatlab .bl-num{width:58px;background:#14161c;border:1px solid var(--line-hi);color:var(--text);border-radius:7px;padding:5px 6px;font:inherit;text-align:center}
    #beatlab select.bl-sel{background:#14161c;border:1px solid var(--line-hi);color:var(--text);border-radius:7px;padding:5px 6px;font:inherit;max-width:170px}
    #beatlab .bl-page{flex:1;min-height:0;display:flex;flex-direction:column}
    #beatlab .bl-scroll{flex:1;min-height:0;overflow:auto;background:linear-gradient(180deg,#16181f,#101117);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 12px 12px 0}
    #beatlab .bl-inner{display:flex;flex-direction:column;gap:7px;min-height:100%}
    #beatlab .bl-row,#beatlab .bl-ruler{display:flex;align-items:stretch;gap:10px}
    #beatlab .bl-row{flex:1 1 0;min-height:52px;max-height:96px}
    #beatlab .bl-name{position:sticky;left:0;z-index:2;width:196px;flex:none;display:flex;flex-direction:column;justify-content:center;gap:6px;background:linear-gradient(180deg,#2a2d37,#1e212a);border:1px solid rgba(255,255,255,.08);border-radius:0 8px 8px 0;padding:6px 10px;box-shadow:4px 0 10px rgba(0,0,0,.35)}
    #beatlab .bl-ruler .bl-name{background:transparent;border:0;box-shadow:none;padding:0}
    #beatlab .bl-nrow{display:flex;align-items:center;gap:6px}
    #beatlab .bl-dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 7px currentColor}
    #beatlab .bl-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;font-weight:700}
    #beatlab .bl-nm small{display:block;font-weight:500;color:var(--dim);font-size:10.5px}
    #beatlab .bl-nm:hover{color:#fff}
    #beatlab .bl-led{width:20px;height:20px;flex:none;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:#14161c;cursor:pointer;color:var(--dim);font-size:9px;font-weight:700;line-height:1}
    #beatlab .bl-mute.on{background:radial-gradient(circle at 50% 38%,#ff9a6b,#ff4d5e);border-color:transparent;color:#2a0f10;box-shadow:0 0 9px rgba(255,90,80,.75)}
    #beatlab .bl-solo.on{background:radial-gradient(circle at 50% 38%,#8ff0b0,#36d47a);border-color:transparent;color:#0c2a17;box-shadow:0 0 9px rgba(70,220,130,.75)}
    #beatlab .bl-mix{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--dim)}
    #beatlab .bl-vol{flex:1;min-width:0;height:4px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.16);border-radius:3px;outline:none;cursor:pointer}
    #beatlab .bl-vol::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#cdd3e6;cursor:pointer}
    #beatlab .bl-pan{width:54px;flex:none}
    #beatlab .bl-cells{flex:1;min-width:0;display:flex;gap:3px;align-items:stretch}
    #beatlab .long .bl-cells{flex:none}
    #beatlab .bl-cell{flex:1 1 0;min-width:0;border-radius:6px;background:linear-gradient(180deg,#191b22,#111218);border:1px solid rgba(255,255,255,.06);box-shadow:0 1px 2px rgba(0,0,0,.5) inset;cursor:pointer;position:relative}
    #beatlab .long .bl-cell{flex:none;width:26px}
    #beatlab .bl-cell.beat4{background:linear-gradient(180deg,#22252f,#15171e)}
    #beatlab .bl-cell.grp{margin-left:7px}
    #beatlab .bl-cell.bar{margin-left:14px}
    #beatlab .bl-cell.on{background:linear-gradient(180deg,#ffbe5c,#ff7a1f);border-color:rgba(255,190,110,.6);box-shadow:0 0 11px rgba(255,140,45,.6),0 1px 0 rgba(255,255,255,.4) inset;opacity:calc(.35 + .65 * var(--v,1))}
    #beatlab .bl-cell.on::after{content:'';position:absolute;left:3px;right:3px;bottom:3px;height:calc((100% - 6px) * var(--v,1));border-radius:3px;background:rgba(255,255,255,.18);pointer-events:none}
    #beatlab .bl-cell.playing{outline:2px solid #fff;outline-offset:-1px}
    #beatlab .bl-rnums{flex:1;min-width:0;display:flex;gap:3px}
    #beatlab .long .bl-rnums{flex:none}
    #beatlab .bl-rn{flex:1 1 0;min-width:0;text-align:center;font-size:10px;color:var(--dim);overflow:hidden}
    #beatlab .long .bl-rn{flex:none;width:26px}
    #beatlab .bl-rn.grp{margin-left:7px}
    #beatlab .bl-rn.bar{margin-left:14px}
    #beatlab .bl-rn.b1{color:var(--text);font-weight:700}
    #beatlab .bl-add{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;flex:none;align-items:center}
    #beatlab .bl-rtools{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;flex:none}
    #beatlab .bl-knob{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dim)}
    #beatlab .bl-knob input{width:80px}
    /* piano roll */
    #beatlab .bl-prow{display:flex;align-items:center;gap:10px;height:22px;flex:none}
    #beatlab .bl-prow.blk .bl-pcells{background:rgba(0,0,0,.25)}
    #beatlab .bl-key{position:sticky;left:0;z-index:2;width:58px;flex:none;font-size:10.5px;color:#cfd2dc;text-align:right;padding:0 8px 0 0;height:20px;line-height:20px;background:#e9e9ee;color:#222;border-radius:0 4px 4px 0;cursor:pointer;user-select:none}
    #beatlab .bl-key.black{background:#1b1c22;color:#aaa}
    #beatlab .bl-key:active{filter:brightness(.8)}
    #beatlab .bl-pcells{flex:1;min-width:0;display:flex;gap:3px;align-items:center;border-radius:4px}
    #beatlab .long .bl-pcells{flex:none}
    #beatlab .bl-pc{flex:1 1 0;min-width:0;height:19px;border-radius:4px;background:linear-gradient(180deg,#191b22,#111218);border:1px solid rgba(255,255,255,.05);cursor:pointer}
    #beatlab .long .bl-pc{flex:none;width:26px}
    #beatlab .bl-pc.beat4{background:linear-gradient(180deg,#22252f,#15171e)}
    #beatlab .bl-pc.grp{margin-left:7px}
    #beatlab .bl-pc.bar{margin-left:14px}
    #beatlab .bl-pc.on{background:linear-gradient(180deg,#9aa6ff,#5c6cff);border-color:transparent;box-shadow:0 0 8px rgba(110,120,255,.6)}
    #beatlab .bl-pc.tail{background:rgba(110,120,255,.38);border-color:transparent}
    #beatlab .bl-pc.playing{outline:2px solid rgba(255,255,255,.75);outline-offset:-1px}
    #beatlab .bl-seg{display:inline-flex;border:1px solid var(--line-hi);border-radius:8px;overflow:hidden}
    #beatlab .bl-seg button{background:transparent;border:0;color:var(--text);padding:5px 10px;cursor:pointer;font:inherit}
    #beatlab .bl-seg button.on{background:var(--accent);color:#fff}
    #beatlab .bl-lbl{font-size:11px;color:var(--dim)}
    #beatlab .bl-tog.on{background:var(--accent);color:#fff;border-color:transparent}
    #beatlab .bl-rec.on{background:#ff4d5e;color:#fff;border-color:transparent}
    /* song */
    #beatlab .bl-song{display:flex;flex-direction:column;gap:14px;overflow:auto}
    #beatlab .bl-pal{display:flex;flex-wrap:wrap;gap:8px}
    #beatlab .bl-arr{display:flex;flex-wrap:wrap;gap:8px;padding:12px;min-height:84px;border:1px dashed var(--line-hi);border-radius:12px}
    #beatlab .bl-blk{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:10px;background:linear-gradient(180deg,rgba(var(--accent-rgb),.35),rgba(var(--accent-rgb),.18));border:1px solid rgba(var(--accent-rgb),.6);min-width:92px}
    #beatlab .bl-blk.playing{box-shadow:0 0 0 2px #fff}
    #beatlab .bl-blk b{font-size:12.5px}
    #beatlab .bl-blk .bl-lbl{color:#e4e0ff}
    #beatlab .bl-blk .row{display:flex;gap:4px}
    #beatlab .bl-blk button{padding:2px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:#fff;cursor:pointer}
    @media (orientation: portrait) and (max-width: 900px){
      #beatlab{font-size:12px}
      #beatlab .bl-top{gap:5px;padding:6px 8px}
      #beatlab .bl-title,#beatlab .bl-top .bl-lbl{display:none}
      #beatlab .bl-grp{padding:2px 4px}
      #beatlab .bl-tabs{padding:5px 8px;gap:2px}
      #beatlab .bl-tab{padding:5px 10px}
      #beatlab .bl-body{padding:8px}
      #beatlab .bl-rtools > .bl-io{display:none}
      #beatlab .bl-name{width:118px;padding:4px 6px;gap:3px}
      #beatlab .bl-nm small{display:none}
      #beatlab .bl-mix{font-size:0}
      #beatlab .bl-pan{display:none}
      #beatlab .bl-led{width:18px;height:18px}
      #beatlab .bl-row{flex:none;height:54px;min-height:0;max-height:none}
      #beatlab .bl-add{margin-top:6px;gap:3px}
      #beatlab .bl-add .btn{padding:3px 6px}
    }`;
    document.head.appendChild(s);
  }
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const button = (txt, cls, on) => { const b = el('button', cls); b.type = 'button'; b.textContent = txt; if (on) b.onclick = on; return b; };
  const DOT = ['#ff6b6b', '#ffd166', '#4dd2ff', '#a78bfa', '#52e3a4', '#ff9f43', '#f472b6', '#60a5fa', '#f9739a', '#6ee7b7'];
  const slider = (min, max, step, val, oninput, cls) => { const r = el('input', cls || 'bl-vol'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val; r.oninput = () => oninput(+r.value); return r; };
  const menu = (x, y, items) => S.clips.menu(x, y, items);
  // which step boundaries get extra spacing: every beat, and a bigger gap every bar
  const gapCls = (s, b) => (s > 0 && s % b.steps === 0 ? ' bar' : s % 4 === 0 && s > 0 ? ' grp' : '') + (s % 4 === 0 ? ' beat4' : '');

  BL.open = () => {
    style();
    S.beat.ensure(S.project);
    if (!overlay) { overlay = el('div'); overlay.id = 'beatlab'; document.body.appendChild(overlay); }
    overlay.style.display = 'flex';
    document.body.classList.add('bl-open');
    render();
    initMidi();
    const btn = document.getElementById('btn-beat'); if (btn) btn.classList.add('on');
  };
  BL.close = () => { if (overlay) overlay.style.display = 'none'; document.body.classList.remove('bl-open'); if (S.beat.isPlaying()) S.beat.stop(); const b = document.getElementById('btn-beat'); if (b) b.classList.remove('on'); };
  BL.isOpen = () => !!overlay && overlay.style.display !== 'none';
  BL.toggle = () => (BL.isOpen() ? BL.close() : BL.open());

  function render() {
    if (!overlay) return;
    const keepScroll = overlay.querySelector('.bl-scroll');
    const sx = keepScroll ? keepScroll.scrollLeft : 0, sy = keepScroll ? keepScroll.scrollTop : 0;
    overlay.textContent = '';
    overlay.append(topBar(), tabBar(), bodyFor(state.tab));
    const ns = overlay.querySelector('.bl-scroll'); if (ns) { ns.scrollLeft = sx; ns.scrollTop = sy; }
    highlight(S.beat.currentStep, null);
  }
  const renderBody = () => { const old = overlay && overlay.querySelector('.bl-body'); if (!old) return render(); const sc = old.querySelector('.bl-scroll'); const sx = sc ? sc.scrollLeft : 0, sy = sc ? sc.scrollTop : 0; const nb = bodyFor(state.tab); old.replaceWith(nb); const n2 = nb.querySelector('.bl-scroll'); if (n2) { n2.scrollLeft = sx; n2.scrollTop = sy; } };

  /* ---------- top bar ---------- */
  function topBar() {
    const beat = S.beat.get(), pat = S.beat.pattern();
    const bar = el('div', 'bl-top');
    const play = button(S.beat.isPlaying() ? '■ Stop' : '▶ Play', 'btn primary', () => S.beat.toggle()); play.id = 'bl-play';
    play.title = 'Play / stop (Space)';
    const mode = el('span', 'bl-seg');
    [['pattern', 'Pattern'], ['song', 'Song']].forEach(([m, l]) => { const b = button(l, beat.mode === m ? 'on' : '', () => { S.beat.setMode(m); render(); }); b.title = m === 'song' ? 'Play the whole arrangement from the Song tab' : 'Loop the pattern you are editing'; mode.appendChild(b); });
    const bpm = el('input', 'bl-num'); bpm.type = 'number'; bpm.min = 20; bpm.max = 400; bpm.value = S.project.bpm || 120; bpm.title = 'Tempo (BPM)';
    bpm.onchange = () => { const v = Math.max(20, Math.min(400, parseInt(bpm.value, 10) || 120)); S.project.bpm = v; bpm.value = v; if (S.tempo && S.tempo.refresh) try { S.tempo.refresh(); } catch (e) {} S.beat.restart(); };
    // pattern picker
    const psel = el('select', 'bl-sel'); psel.title = 'Pattern you are editing';
    beat.patterns.forEach((p, i) => { const o = el('option'); o.value = i; o.textContent = p.name + ' · ' + p.bars + (p.bars > 1 ? ' bars' : ' bar'); psel.appendChild(o); });
    psel.value = beat.cur; psel.onchange = () => { S.beat.selectPattern(+psel.value); render(); };
    const pmenu = button('⋯', 'btn ghost sm', (e) => menu(e.clientX, e.clientY, [
      { label: 'New empty pattern', action: () => { S.beat.addPattern(); render(); } },
      { label: 'Duplicate this pattern', action: () => { S.beat.addPattern(beat.cur); render(); } },
      { label: 'Rename…', action: async () => { const n = await S.askText('Rename pattern', { value: pat.name }); if (n && n.trim()) { pat.name = n.trim().slice(0, 40); render(); } } },
      { sep: true },
      { label: 'Delete this pattern', danger: true, disabled: beat.patterns.length <= 1, action: () => { if (confirm('Delete ' + pat.name + '?')) { S.beat.removePattern(beat.cur); render(); } } },
    ])); pmenu.title = 'New, duplicate, rename or delete patterns';
    const newP = button('＋', 'btn ghost sm', () => { S.beat.addPattern(); render(); }); newP.title = 'New pattern';
    // length
    const bars = el('select', 'bl-sel'); bars.title = 'Pattern length';
    [1, 2, 4, 8, 16].forEach((n) => { const o = el('option'); o.value = n; o.textContent = n + (n > 1 ? ' bars' : ' bar'); bars.appendChild(o); });
    bars.value = pat.bars; bars.onchange = () => { S.beat.resize(beat.steps, +bars.value); render(); };
    // swing
    const swing = slider(0, 60, 1, Math.round((beat.swing || 0) * 100), (v) => { beat.swing = v / 100; S.beat.restart(); }); swing.style.width = '80px'; swing.style.flex = 'none'; swing.title = 'Swing';
    // kits
    const kit = el('select', 'bl-sel'); kit.title = 'Swap every drum to a matching kit';
    kit.appendChild(Object.assign(el('option'), { value: '', textContent: 'Kit…' }));
    BI().KITS.forEach((k) => { const o = el('option'); o.value = k.id; o.textContent = k.name; kit.appendChild(o); });
    kit.onchange = () => { applyKit(kit.value); render(); };
    const clear = button('Clear', 'btn ghost', () => { if (confirm('Clear everything in ' + pat.name + '?')) { S.beat.clear(); render(); } });
    const add = button('＋ Add to track', 'btn', addToTrack); add.id = 'bl-add-track';
    bar.append(el('span', 'bl-title', 'Beat Lab'), play, mode,
      wrapGrp(el('span', 'bl-lbl', 'BPM'), bpm),
      wrapGrp(psel, newP, pmenu, bars),
      wrapGrp(el('span', 'bl-lbl', 'Swing'), swing), kit,
      el('span', 'bl-sp'), clear, add, button('✕ Close', 'btn ghost', BL.close));
    return bar;
  }
  const wrapGrp = (...kids) => { const g = el('span', 'bl-grp'); g.append(...kids); return g; };

  function applyKit(id) {
    const k = BI().KITS.find((x) => x.id === id); if (!k) return;
    for (const c of S.beat.get().channels) {
      if (c.type === 'drum' && k.map[c.kind]) c.sound = k.map[c.kind];
      if (c.type === 'bass' && k.bass) { c.preset = k.bass; c.p = {}; }
    }
    S.beat.channelChanged();
    S.toast(k.name + ' kit loaded on every drum' + (k.bass ? ' and the 808' : '') + '.');
  }

  function tabBar() {
    const bar = el('div', 'bl-tabs');
    [['rack', 'Channel rack'], ['bass', '808'], ['keys', 'Keys'], ['custom', 'Custom'], ['song', 'Song']].forEach(([id, label]) => bar.appendChild(button(label, 'bl-tab' + (state.tab === id ? ' on' : ''), () => { state.tab = id; render(); })));
    return bar;
  }

  function bodyFor(tab) {
    const body = el('div', 'bl-body');
    if (tab === 'rack') body.append(rack());
    else if (tab === 'song') body.append(songView());
    else body.append(instrEditor(tab));
    return body;
  }

  /* ---------- ruler ---------- */
  function ruler(total, beat, padW) {
    const r = el('div', 'bl-ruler');
    const pad = el('div', padW ? 'bl-key' : 'bl-name'); if (padW) { pad.style.background = 'transparent'; pad.style.cursor = 'default'; }
    r.append(pad);
    const nums = el('div', 'bl-rnums');
    for (let s = 0; s < total; s++) {
      const n = el('div', 'bl-rn' + gapCls(s, beat) + (s % 4 === 0 ? ' b1' : ''));
      n.textContent = s % beat.steps === 0 ? (s / beat.steps + 1) + '' : s % 4 === 0 ? '·' : '';
      if (s % beat.steps === 0) n.title = 'Bar ' + (s / beat.steps + 1);
      nums.appendChild(n);
    }
    r.appendChild(nums);
    return r;
  }

  /* ---------- channel rack ---------- */
  function rack() {
    const beat = S.beat.get(), total = S.beat.totalSteps(beat);
    const wrap = el('div', 'bl-page');
    const tools = el('div', 'bl-rtools');
    const vel = button('Velocity', 'btn ghost sm bl-tog' + (state.velMode ? ' on' : ''), () => { state.velMode = !state.velMode; vel.classList.toggle('on', state.velMode); });
    vel.title = 'Velocity mode: tap a lit pad to step its loudness 100% → 75% → 50% → 25%. (Right-click a pad does it any time.)';
    tools.append(el('span', 'bl-io', 'Tap pads to build the beat (drag to paint). Click a channel name to change its sound. 808 / Keys open their piano roll.'), el('span', 'bl-sp'), vel);
    const sc = el('div', 'bl-scroll' + (total > 32 ? ' long' : ''));
    const inner = el('div', 'bl-inner');
    inner.append(ruler(total, beat));
    beat.channels.forEach((c, i) => inner.append(c.type === 'drum' ? drumRow(c, total, i, beat) : pitchedRow(c, total, i, beat)));
    sc.append(inner);
    const add = el('div', 'bl-add');
    add.append(el('span', 'bl-lbl', 'Add:'));
    BI().FAMILIES.forEach(([k, label]) => add.append(button('＋ ' + label.replace(/s$/, ''), 'btn ghost sm', () => { S.beat.addChannel('drum', { kind: k, name: label.replace(/s$/, '') }); renderBody(); })));
    add.append(button('＋ 808', 'btn ghost sm', () => { S.beat.addChannel('bass', { name: '808 ' + (beat.channels.filter((c) => c.type === 'bass').length + 1), preset: '808-clean' }); renderBody(); }));
    add.append(button('＋ Instrument', 'btn ghost sm', () => { S.beat.addChannel('keys', { name: 'Keys ' + (beat.channels.filter((c) => c.type === 'keys').length + 1), preset: 'piano' }); renderBody(); }));
    wrap.append(tools, sc, add);
    return wrap;
  }

  function nameBlock(c, idx, subtitle, onName) {
    const name = el('div', 'bl-name');
    const nrow = el('div', 'bl-nrow');
    const dot = el('span', 'bl-dot'); dot.style.color = DOT[idx % DOT.length]; dot.style.background = 'currentColor';
    const nm = el('span', 'bl-nm'); nm.textContent = c.name; const sub = el('small'); sub.textContent = subtitle; nm.appendChild(sub);
    nm.title = 'Click: change sound, rename, tune, remove';
    nm.onclick = (e) => onName(e);
    const mute = button('M', 'bl-led bl-mute' + (c.mute ? ' on' : ''), () => { c.mute = !c.mute; mute.classList.toggle('on', c.mute); S.beat.restart(); }); mute.title = 'Mute';
    const solo = button('S', 'bl-led bl-solo' + (c.solo ? ' on' : ''), () => { c.solo = !c.solo; solo.classList.toggle('on', c.solo); S.beat.restart(); }); solo.title = 'Solo';
    nrow.append(dot, nm, mute, solo);
    const mix = el('div', 'bl-mix');
    const vol = slider(0, 100, 1, Math.round(c.vol * 100), (v) => S.beat.setChannelVol(c.id, v / 100)); vol.title = 'Volume';
    const pan = slider(-100, 100, 1, Math.round((c.pan || 0) * 100), (v) => S.beat.setChannelPan(c.id, Math.abs(v) < 4 ? 0 : v / 100), 'bl-vol bl-pan'); pan.title = 'Pan (left ↔ right)';
    pan.ondblclick = () => { pan.value = 0; S.beat.setChannelPan(c.id, 0); };
    mix.append('Vol', vol, 'Pan', pan);
    name.append(nrow, mix);
    return name;
  }

  function channelMenuItems(c) {
    return [
      { label: 'Rename…', action: async () => { const n = await S.askText('Rename channel', { value: c.name }); if (n && n.trim()) { c.name = n.trim().slice(0, 30); renderBody(); } } },
      { label: 'Tune up 1 semitone', hint: (c.tune > 0 ? '+' : '') + c.tune, action: () => { c.tune = Math.min(24, (c.tune || 0) + 1); S.beat.channelChanged(); renderBody(); } },
      { label: 'Tune down 1 semitone', action: () => { c.tune = Math.max(-24, (c.tune || 0) - 1); S.beat.channelChanged(); renderBody(); } },
      { sep: true },
      { label: 'Remove channel', danger: true, action: () => { if (confirm('Remove ' + c.name + ' (from every pattern)?')) { S.beat.removeChannel(c.id); renderBody(); } } },
    ];
  }

  function audition(c, opts) { if (!S.ctx) return; try { const g = S.ctx.createGain(); g.gain.value = c.vol; const p = S.ctx.createStereoPanner(); p.pan.value = c.pan || 0; g.connect(p).connect(S.ctx.destination); BI().make(S.ctx, c).trigger(g, S.ctx.currentTime + 0.005, opts); setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 4000); } catch (e) {} }

  function drumRow(c, total, idx, beat) {
    const row = el('div', 'bl-row');
    const snd = BI().sound(c.sound);
    const name = nameBlock(c, idx, (snd ? snd.name : c.kind) + (c.tune ? ' · ' + (c.tune > 0 ? '+' : '') + c.tune : ''), (e) => {
      const items = [];
      for (const [fam, label] of BI().FAMILIES) {
        const list = BI().soundsOf(fam);
        if (fam !== c.kind) continue;
        items.push({ label: label.toUpperCase(), disabled: true });
        list.forEach((s) => items.push({ label: s.name, checked: s.id === c.sound, action: () => { c.sound = s.id; S.beat.channelChanged(); audition(c, { vel: 1 }); renderBody(); } }));
      }
      items.push({ sep: true }, { label: 'Other sounds…', hint: 'any family', action: () => familyMenu(c, e) }, { sep: true }, ...channelMenuItems(c));
      menu(e.clientX, e.clientY, items);
    });
    const cells = el('div', 'bl-cells');
    const data = S.beat.cells(c);
    const draw = (s) => { const v = data[s]; const cell = cells.children[s]; cell.classList.toggle('on', v > 0); cell.style.setProperty('--v', v > 0 ? v : 1); cell.title = v > 0 ? 'Velocity ' + Math.round(v * 100) + '%' : ''; };
    const cycle = (v) => (v >= 0.99 ? 0.75 : v >= 0.74 ? 0.5 : v >= 0.49 ? 0.25 : 1);
    for (let s = 0; s < total; s++) {
      const cell = el('div', 'bl-cell' + gapCls(s, beat));
      cell.dataset.step = s;
      cell.addEventListener('pointerdown', (e) => {
        if (e.button === 2) return;
        e.preventDefault();
        if (state.velMode && data[s] > 0) { data[s] = cycle(data[s]); draw(s); audition(c, { vel: data[s] }); return; }
        const on = !(data[s] > 0); data[s] = on ? 1 : 0; draw(s); paint = { kind: 'drum', value: on, chId: c.id };
        if (on) audition(c, { vel: 1 });
      });
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); if (data[s] > 0) { data[s] = cycle(data[s]); draw(s); audition(c, { vel: data[s] }); } });
      cells.appendChild(cell);
    }
    for (let s = 0; s < total; s++) draw(s);
    cells.addEventListener('pointermove', (e) => {
      if (!paint || paint.kind !== 'drum' || paint.chId !== c.id) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const cell = t && t.closest && t.closest('.bl-cell');
      if (cell && cell.parentElement === cells) { const s = +cell.dataset.step; const want = paint.value ? 1 : 0; if ((data[s] > 0) !== paint.value) { data[s] = want; draw(s); if (want) audition(c, { vel: 1 }); } }
    });
    row.append(name, cells);
    return row;
  }
  function familyMenu(c, e) {
    const items = [];
    for (const [fam, label] of BI().FAMILIES) {
      items.push({ label: label.toUpperCase(), disabled: true });
      BI().soundsOf(fam).forEach((s) => items.push({ label: s.name, checked: s.id === c.sound, action: () => { c.sound = s.id; c.kind = fam; S.beat.channelChanged(); audition(c, { vel: 1 }); renderBody(); } }));
    }
    menu(e.clientX, Math.max(10, e.clientY - 200), items);
  }

  // 808 / keys / custom in the rack: a mini preview of the notes; click to open the piano roll
  function pitchedRow(c, total, idx, beat) {
    const row = el('div', 'bl-row');
    const sub = c.type === 'bass' ? ((BI().BASS_PRESETS.find((x) => x.id === c.preset) || {}).name || '808') : c.type === 'keys' ? ((BI().KEY_PRESETS.find((x) => x.id === c.preset) || {}).name || 'Piano') : 'Custom sample';
    const name = nameBlock(c, idx, sub, (e) => menu(e.clientX, e.clientY, [{ label: 'Open piano roll', action: () => openRoll(c) }, { sep: true }, ...channelMenuItems(c)]));
    const cells = el('div', 'bl-cells');
    const notes = S.beat.notes(c);
    const has = new Array(total).fill(0);
    for (const n of notes) for (let k = 0; k < Math.max(1, n.len || 1); k++) if (n.step + k < total) has[n.step + k] = k === 0 ? 2 : Math.max(has[n.step + k], 1);
    for (let s = 0; s < total; s++) {
      const cell = el('div', 'bl-cell' + gapCls(s, beat));
      cell.dataset.step = s;
      if (has[s]) { cell.classList.add('on'); cell.style.background = has[s] === 2 ? 'linear-gradient(180deg,#9aa6ff,#5c6cff)' : 'rgba(110,120,255,.35)'; cell.style.boxShadow = 'none'; cell.style.setProperty('--v', 1); }
      cell.onclick = () => openRoll(c);
      cells.appendChild(cell);
    }
    cells.title = 'Click to edit ' + c.name + ' in the piano roll';
    row.append(name, cells);
    return row;
  }
  function openRoll(c) { state.roll.sel = c.id; state.tab = c.type === 'bass' ? 'bass' : c.type === 'keys' ? 'keys' : 'custom'; render(); }

  /* ---------- piano roll pages (808 / keys / custom) ---------- */
  function instrEditor(tab) {
    const beat = S.beat.get();
    const wrap = el('div', 'bl-page');
    const type = tab === 'bass' ? 'bass' : tab === 'keys' ? 'keys' : 'custom';
    const list = beat.channels.filter((c) => c.type === type);
    if (type === 'custom') { wrap.append(customTab(list.find((c) => c.id === state.roll.sel) || list[0])); return wrap; }
    let ch = list.find((c) => c.id === state.roll.sel) || list[0];
    if (!ch) ch = S.beat.addChannel(type, { name: type === 'bass' ? '808' : 'Keys', preset: type === 'bass' ? '808-clean' : 'piano' });
    state.roll.sel = ch.id;
    wrap.append(rollTools(ch, list), soundTools(ch), pianoRoll(ch));
    return wrap;
  }

  function rollTools(ch, list) {
    const tools = el('div', 'bl-rtools');
    const st = (state.roll[ch.id] = state.roll[ch.id] || { len: ch.type === 'bass' ? 4 : 2, oct: 0 });
    if (list && list.length > 1) {
      const pick = el('select', 'bl-sel'); list.forEach((c) => { const o = el('option'); o.value = c.id; o.textContent = c.name; pick.appendChild(o); });
      pick.value = ch.id; pick.onchange = () => { state.roll.sel = pick.value; renderBody(); };
      tools.append(pick);
    }
    const lenSeg = el('span', 'bl-seg');
    [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, '1 bar']].forEach(([n, l]) => { const b = button(l, st.len === n ? 'on' : ''); b.onclick = () => { st.len = n; lenSeg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }; lenSeg.appendChild(b); });
    const oct = el('span', 'bl-seg');
    oct.append(button('Oct –', '', () => { st.oct = Math.max(-3, (st.oct || 0) - 1); renderBody(); }), button('Oct +', '', () => { st.oct = Math.min(4, (st.oct || 0) + 1); renderBody(); }));
    const vol = slider(0, 100, 1, Math.round(ch.vol * 100), (v) => S.beat.setChannelVol(ch.id, v / 100)); vol.style.width = '90px'; vol.style.flex = 'none'; vol.title = 'Volume';
    // computer / MIDI keyboard
    const layout = el('select', 'bl-sel'); layout.title = 'Play notes from your computer keyboard';
    [['fl', 'Keys: FL layout (Z–M, Q–U)'], ['row', 'Keys: one row (A–K)'], ['off', 'Keys: off']].forEach(([v, l]) => { const o = el('option'); o.value = v; o.textContent = l; layout.appendChild(o); });
    layout.value = state.kb.layout; layout.onchange = () => { state.kb.layout = layout.value; saveKb(); };
    const rec = button('● Rec', 'btn ghost sm bl-rec' + (state.kb.rec ? ' on' : ''), () => { state.kb.rec = !state.kb.rec; rec.classList.toggle('on', state.kb.rec); if (state.kb.rec && !S.beat.isPlaying()) S.toast('Press Play, then play your keyboard — notes land on the grid in time.'); });
    rec.title = 'Record what you play (keyboard or MIDI) into the pattern while it loops';
    tools.append(el('span', 'bl-lbl', 'Note'), lenSeg, oct, el('span', 'bl-lbl', 'Vol'), vol, layout, rec,
      button('Clear notes', 'btn ghost sm', () => { S.beat.notes(ch).length = 0; S.beat.restart(); renderBody(); }));
    return tools;
  }

  // sound designer row: 808 type + knobs, or instrument picker
  function soundTools(ch) {
    const row = el('div', 'bl-rtools');
    if (ch.type === 'bass') {
      const sel = el('select', 'bl-sel'); BI().BASS_PRESETS.forEach((p) => { const o = el('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
      sel.value = ch.preset || '808-clean'; sel.onchange = () => { ch.preset = sel.value; ch.p = {}; S.beat.channelChanged(); audition(ch, { note: 36, vel: 1, dur: 0.6 }); renderBody(); };
      const base = (BI().BASS_PRESETS.find((p) => p.id === ch.preset) || BI().BASS_PRESETS[0]).p;
      const cur = Object.assign({}, base, ch.p || {});
      const knob = (key, label, min, max, step, fmt) => {
        const w = el('label', 'bl-knob'); const val = el('b'); const show = (v) => (val.textContent = fmt(v));
        const r = slider(min, max, step, cur[key], (v) => { ch.p = Object.assign({}, ch.p || {}, { [key]: v }); show(v); S.beat.channelChanged(); });
        r.onchange = () => audition(ch, { note: 36, vel: 1, dur: 0.6 });
        show(cur[key]); w.append(label, r, val); return w;
      };
      row.append(el('span', 'bl-lbl', '808'), sel,
        knob('drive', 'Distortion', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'),
        knob('decay', 'Length', 0.2, 3, 0.05, (v) => v.toFixed(1) + 's'),
        knob('glide', 'Slide', 0.01, 0.3, 0.01, (v) => Math.round(v * 1000) + 'ms'),
        knob('punch', 'Punch', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'),
        knob('tone', 'Tone', 800, 12000, 50, (v) => (v / 1000).toFixed(1) + 'k'),
        el('span', 'bl-io', 'Tip: let a note overlap the next one and the 808 slides into it.'));
    } else {
      const sel = el('select', 'bl-sel'); BI().KEY_PRESETS.forEach((p) => { const o = el('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
      sel.value = ch.preset || 'piano'; sel.onchange = () => { ch.preset = sel.value; S.beat.channelChanged(); audition(ch, { note: 60, vel: 0.9, dur: 0.6 }); renderBody(); };
      row.append(el('span', 'bl-lbl', 'Instrument'), sel);
    }
    return row;
  }

  function rollRange(ch) {
    const st = state.roll[ch.id] || { oct: 0 };
    const root = (ch.type === 'bass' ? 24 : 48) + (st.oct || 0) * 12;
    return { root, rows: ch.type === 'bass' ? 25 : 37 };
  }

  function pianoRoll(ch) {
    const beat = S.beat.get(), total = S.beat.totalSteps(beat), st = state.roll[ch.id];
    const { root, rows } = rollRange(ch);
    const sc = el('div', 'bl-scroll' + (total > 32 ? ' long' : ''));
    const inner = el('div', 'bl-inner'); inner.style.gap = '2px';
    inner.append(ruler(total, beat, true));
    const notes = S.beat.notes(ch);
    const startAt = (n, s) => notes.find((x) => x.note === n && x.step === s);
    const covering = (n, s) => notes.find((x) => x.note === n && s >= x.step && s < x.step + Math.max(1, x.len || 1));
    const rowEls = {};
    const drawRow = (n) => {
      const cells = rowEls[n]; if (!cells) return;
      for (let s = 0; s < total; s++) { const c = cells.children[s]; const a = startAt(n, s), cv = !a && covering(n, s); c.classList.toggle('on', !!a); c.classList.toggle('tail', !!cv); }
    };
    for (let r = rows - 1; r >= 0; r--) {
      const note = root + r;
      const isBlack = NOTE_NAMES[note % 12].includes('#');
      const prow = el('div', 'bl-prow' + (isBlack ? ' blk' : ''));
      const key = el('div', 'bl-key' + (isBlack ? ' black' : ''), noteName(note));
      key.onpointerdown = () => audition(ch, { note, vel: state.kb.vel, dur: 0.4 });
      const cells = el('div', 'bl-pcells'); rowEls[note] = cells;
      for (let s = 0; s < total; s++) {
        const pc = el('div', 'bl-pc' + gapCls(s, beat));
        pc.dataset.step = s; pc.dataset.note = note;
        pc.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const hit = covering(note, s);
          if (hit) { notes.splice(notes.indexOf(hit), 1); paint = { kind: 'roll', value: false, chId: ch.id }; }
          else { notes.push({ step: s, note, len: Math.min(st.len, total - s), vel: state.kb.vel }); paint = { kind: 'roll', value: true, chId: ch.id }; audition(ch, { note, vel: state.kb.vel, dur: st.len * S.beat.stepDur(beat) }); }
          drawRow(note);
        });
        cells.appendChild(pc);
      }
      cells.addEventListener('pointermove', (e) => {
        if (!paint || paint.kind !== 'roll' || paint.chId !== ch.id) return;
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const pc = t && t.closest && t.closest('.bl-pc'); if (!pc) return;
        const n = +pc.dataset.note, s = +pc.dataset.step, hit = covering(n, s);
        if (paint.value && !hit) { notes.push({ step: s, note: n, len: Math.min(st.len, total - s), vel: state.kb.vel }); drawRow(n); }
        else if (!paint.value && hit) { notes.splice(notes.indexOf(hit), 1); drawRow(n); }
      });
      prow.append(key, cells);
      inner.appendChild(prow);
      drawRow(note);
    }
    sc.append(inner);
    // start scrolled to the middle of the range
    requestAnimationFrame(() => { if (sc.scrollTop === 0) sc.scrollTop = Math.max(0, (sc.scrollHeight - sc.clientHeight) / 2); });
    BL._rollRedraw = () => { for (const n in rowEls) drawRow(+n); };
    return sc;
  }

  /* ---------- Custom tab ---------- */
  function customTab(ch) {
    const wrap = el('div', 'bl-page');
    wrap.append(el('p', 'bl-io', 'Pick one of your saved sounds or import a new one, then play it on the grid (or your keyboard).'));
    const bar = el('div', 'bl-rtools');
    bar.append(button('＋ Import a sound…', 'btn primary', () => importCustom()));
    wrap.append(bar);
    const lib = el('div'); lib.style.cssText = 'margin-bottom:10px;flex:none';
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
    if (ch && ch.assetId) { state.roll.sel = ch.id; wrap.append(rollTools(ch), pianoRoll(ch)); }
    else wrap.append(el('p', 'bl-io', 'Load or import a sound to start playing it.'));
    return wrap;
  }
  async function loadLibrarySound(id, name) {
    try {
      const rec = await S.sounds.getOne(id); if (!rec) return;
      const buf = await S.ctx.decodeAudioData(await rec.blob.arrayBuffer());
      const assetId = S.addAsset(name, buf);
      let ch = S.beat.get().channels.find((c) => c.type === 'custom');
      if (ch) { ch.assetId = assetId; ch.name = name; ch.soundId = id; S.beat.channelChanged(); } else ch = S.beat.addChannel('custom', { name, assetId, soundId: id, root: 60 });
      state.roll.sel = ch.id; render();
    } catch (e) { S.toast && S.toast('Could not load that sound'); }
  }
  function importCustom() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'audio/*,.wav,.mp3,.flac,.ogg,.m4a';
    i.onchange = async () => {
      const f = i.files[0]; if (!f) return;
      state.tab = 'custom';
      if (S.sounds && S.sounds.importFiles) { let rec = null; try { await S.sounds.importFiles([f], (r) => { rec = r; }); } catch (e) {} if (rec) return loadLibrarySound(rec.id, rec.name); }
      try {
        const buf = await S.ctx.decodeAudioData(await f.arrayBuffer());
        const name = f.name.replace(/\.[^.]+$/, '');
        const assetId = S.addAsset(name, buf);
        let ch = S.beat.get().channels.find((c) => c.type === 'custom');
        if (ch) { ch.assetId = assetId; ch.name = name; S.beat.channelChanged(); } else ch = S.beat.addChannel('custom', { name, assetId, root: 60 });
        state.roll.sel = ch.id; render();
      } catch (e) { S.toast && S.toast('Could not read that sound'); }
    };
    i.click();
  }

  /* ---------- Song view ---------- */
  function songView() {
    const beat = S.beat.get();
    const wrap = el('div', 'bl-page bl-song');
    wrap.append(el('p', 'bl-io', 'Build the full beat: tap a pattern to add it to the end of the song, then use ← → to reorder. Switch the top bar to “Song” to hear the whole thing, and “Add to track” drops the full song onto your timeline.'));
    const pal = el('div', 'bl-pal');
    beat.patterns.forEach((p, i) => pal.append(button('＋ ' + p.name + ' (' + p.bars + (p.bars > 1 ? ' bars)' : ' bar)'), 'btn', () => { S.beat.songAdd(i); renderBody(); })));
    pal.append(button('New pattern', 'btn ghost', () => { S.beat.addPattern(); render(); }));
    const arr = el('div', 'bl-arr');
    if (!beat.song.length) arr.append(el('span', 'bl-lbl', 'Your song is empty — tap a pattern above to start it. (While it’s empty, “Song” mode just plays the current pattern.)'));
    beat.song.forEach((pi, k) => {
      const p = beat.patterns[pi];
      const blk = el('div', 'bl-blk'); blk.dataset.seg = k;
      blk.append(el('b', null, p.name), el('span', 'bl-lbl', p.bars + (p.bars > 1 ? ' bars' : ' bar')));
      const r = el('div', 'row');
      r.append(button('←', '', () => { S.beat.songMove(k, -1); renderBody(); }), button('→', '', () => { S.beat.songMove(k, 1); renderBody(); }), button('✕', '', () => { S.beat.songRemove(k); renderBody(); }));
      blk.append(r);
      blk.ondblclick = () => { S.beat.selectPattern(pi); state.tab = 'rack'; render(); };
      blk.title = 'Double-click to edit this pattern';
      arr.append(blk);
    });
    const secs = S.beat.songSeconds();
    const foot = el('div', 'bl-rtools');
    foot.append(el('span', 'bl-lbl', beat.song.length ? 'Song length: ' + Math.floor(secs / 60) + ':' + String(Math.round(secs % 60)).padStart(2, '0') : ''),
      button('▶ Play song', 'btn primary', () => { S.beat.setMode('song'); if (!S.beat.isPlaying()) S.beat.play(); else S.beat.restart(); render(); }));
    wrap.append(el('div', 'bl-lbl', 'PATTERNS'), pal, el('div', 'bl-lbl', 'SONG'), arr, foot);
    return wrap;
  }

  /* ---------- add to the timeline ---------- */
  async function addToTrack() {
    const btn = document.getElementById('bl-add-track');
    const beat = S.beat.get(), what = beat.mode === 'song' && beat.song.length ? 'song' : 'pattern';
    if (btn) { btn.disabled = true; btn.textContent = 'Rendering…'; }
    try {
      const buf = await S.beat.renderOffline(1, what);
      const id = S.addAsset(what === 'song' ? 'Beat (song)' : 'Beat · ' + S.beat.pattern().name, buf);
      let idx = S.project.tracks.findIndex((t) => t.arm);
      if (idx < 0) { S.project.tracks.push(S.newTrack(S.project.tracks.length)); idx = S.project.tracks.length - 1; }
      S.addClip(idx, id, S.playhead || 0);
      S.refresh.structure(); S.timeline.resize();
      S.toast && S.toast((what === 'song' ? 'Full song' : 'Pattern') + ' added to track ' + (idx + 1) + '.');
    } catch (e) { S.toast && S.toast('Could not add the beat: ' + (e.message || e)); }
    if (btn) { btn.disabled = false; btn.textContent = '＋ Add to track'; }
  }

  /* ---------- live highlight ---------- */
  function highlight(step, pi) {
    if (!overlay) return;
    overlay.querySelectorAll('.playing').forEach((e) => e.classList.remove('playing'));
    if (step < 0) return;
    const beat = S.beat.get();
    if (pi == null || pi === beat.cur) overlay.querySelectorAll('[data-step="' + step + '"]').forEach((e) => e.classList.add('playing'));
    if (state.tab === 'song' && S.beat.currentSeg >= 0) { const b = overlay.querySelector('.bl-blk[data-seg="' + S.beat.currentSeg + '"]'); if (b && beat.mode === 'song') b.classList.add('playing'); }
  }

  /* ---------- computer keyboard + MIDI keyboard ---------- */
  const LAYOUTS = {
    fl: { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12, l: 13, '.': 14, q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28 },
    row: { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 },
  };
  function currentRollChannel() {
    if (!BL.isOpen() || !['bass', 'keys', 'custom'].includes(state.tab)) return null;
    return S.beat.get().channels.find((c) => c.id === state.roll.sel) || null;
  }
  function playNote(ch, note, vel) {
    audition(ch, { note, vel, dur: ch.type === 'bass' ? 0.8 : 0.5 });
    if (!state.kb.rec || !S.beat.isPlaying()) return;
    const pos = S.beat.liveStepFloat(); if (!pos) return;
    const beat = S.beat.get(), total = S.beat.totalSteps(beat), st = state.roll[ch.id] || { len: 2 };
    const step = Math.round(pos.step) % total;
    const notes = S.beat.notes(ch);
    if (!notes.some((n) => n.note === note && n.step === step)) notes.push({ step, note, len: Math.min(st.len, total - step), vel });
    if (BL._rollRedraw) BL._rollRedraw();
  }
  function onKey(e) {
    if (!BL.isOpen()) return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) S.beat.toggle(); return; }
    if (k === 'escape') { e.stopImmediatePropagation(); BL.close(); return; }
    const ch = currentRollChannel();
    if (!ch || state.kb.layout === 'off') { e.stopImmediatePropagation(); return; } // don't let Beat Lab keys trigger timeline shortcuts
    const st = (state.roll[ch.id] = state.roll[ch.id] || { len: 2, oct: 0 });
    if (k === '[' || k === ']') { e.preventDefault(); e.stopImmediatePropagation(); st.oct = S.clamp((st.oct || 0) + (k === ']' ? 1 : -1), -3, 4); S.toast('Octave ' + (st.oct > 0 ? '+' : '') + st.oct); renderBody(); return; }
    const map = LAYOUTS[state.kb.layout] || LAYOUTS.fl;
    if (map[k] == null) { e.stopImmediatePropagation(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    const base = (ch.type === 'bass' ? 36 : 60) + (st.oct || 0) * 12;
    playNote(ch, base + map[k], state.kb.vel);
  }
  let midiTried = false;
  function initMidi() {
    if (midiTried || !navigator.requestMIDIAccess) return;
    midiTried = true;
    navigator.requestMIDIAccess({ sysex: false }).then((acc) => {
      const hook = () => acc.inputs.forEach((inp) => { inp.onmidimessage = (m) => {
        const [st, note, vel] = m.data; const cmd = st & 0xf0;
        if (cmd === 0x90 && vel > 0) { const ch = currentRollChannel(); if (ch) playNote(ch, note, Math.max(0.1, vel / 127)); }
      }; });
      hook(); acc.onstatechange = hook;
    }).catch(() => {});
  }

  BL.init = () => {
    window.addEventListener('pointerup', () => { paint = null; });
    window.addEventListener('keydown', onKey, true);
    const b = document.getElementById('btn-beat');
    if (b) b.onclick = () => BL.toggle();
    try { S.on && S.on('beat-step', (s) => { if (BL.isOpen()) highlight(s, S.beat.currentPi); }); } catch (e) {}
    try { S.on && S.on('project-replaced', () => { if (S.beat.isPlaying()) S.beat.stop(); if (BL.isOpen()) render(); }); } catch (e) {}
  };
})();
