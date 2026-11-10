/* Beats — the in-app beat store. Producers publish beats, everyone can listen, download and use them.
 * Free for now (every beat is a free download with credit to the producer).
 * Browsing / playing / downloading works everywhere (desktop + Android). Publishing needs Discord
 * sign-in (desktop). Server: session-collab-auth on fly.dev (/v1/beats). */
(function () {
  const S = window.Studio;
  const BS = (S.beatStore = {});
  const GENRES = ['Trap', 'Rage', 'Drill', 'R&B', 'Pluggnb', 'Boom Bap', 'Lo-Fi', 'Afrobeats', 'Pop', 'Jersey Club', 'Phonk', 'Other'];
  const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const api = () => ((window.__APINATOR__ && window.__APINATOR__.authEndpoint) || 'https://session-collab-auth.fly.dev/v1/collab/auth').replace(/\/collab\/auth$/, '');
  const token = async () => { try { return S.gate && S.gate.getToken ? await S.gate.getToken() : (S.auth && S.auth.token); } catch (e) { return null; } };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const fmtTime = (s) => (s > 0 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : '');
  const ago = (t) => { const d = (Date.now() / 1000 - t) / 86400; return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? Math.floor(d) + ' days ago' : new Date(t * 1000).toLocaleDateString(); };
  const hue = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

  let overlay = null, audio = null, playingId = null;
  const st = { q: '', genre: '', sort: 'new', view: 'browse', beats: [], total: 0, loading: false, error: '' };

  function style() {
    if (document.getElementById('bs-style')) return;
    const s = document.createElement('style'); s.id = 'bs-style';
    s.textContent = `
    body.bs-open .ctxmenu{z-index:420}
    #beatstore{position:fixed;inset:0;z-index:385;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:13px/1.4 var(--font)}
    #beatstore .bs-top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
    #beatstore .bs-title{font-weight:800;font-size:17px}
    #beatstore .bs-free{font-size:10.5px;font-weight:800;letter-spacing:.08em;padding:3px 8px;border-radius:999px;background:linear-gradient(90deg,#34d399,#10b981);color:#04210f}
    #beatstore .bs-sp{flex:1}
    #beatstore .bs-search{flex:1;min-width:180px;max-width:360px;background:#14161c;border:1px solid var(--line-hi);color:var(--text);border-radius:9px;padding:7px 11px;font:inherit}
    #beatstore .bs-bar{display:flex;gap:6px;padding:9px 16px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
    #beatstore .bs-chip{border:1px solid var(--line-hi);background:transparent;color:var(--text);border-radius:999px;padding:5px 12px;font:600 12px var(--font);cursor:pointer}
    #beatstore .bs-chip.on{background:var(--accent);border-color:transparent;color:#fff}
    #beatstore .bs-body{flex:1;min-height:0;overflow:auto;padding:16px}
    #beatstore .bs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
    #beatstore .bs-card{background:linear-gradient(180deg,#1a1c24,#13151b);border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
    #beatstore .bs-cover{position:relative;aspect-ratio:1/1;background-size:cover;background-position:center;display:flex;align-items:flex-end;padding:10px}
    #beatstore .bs-play{position:absolute;inset:0;margin:auto;width:58px;height:58px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:22px;cursor:pointer;backdrop-filter:blur(4px)}
    #beatstore .bs-play:hover{background:var(--accent)}
    #beatstore .bs-prog{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(0,0,0,.4);cursor:pointer}
    #beatstore .bs-prog i{display:block;height:100%;width:0;background:var(--accent)}
    #beatstore .bs-meta{padding:10px 12px 12px;display:flex;flex-direction:column;gap:5px}
    #beatstore .bs-name{font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #beatstore .bs-prod{color:var(--dim);font-size:12px}
    #beatstore .bs-info{display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:#c9cbd6}
    #beatstore .bs-info span{background:rgba(255,255,255,.06);border-radius:6px;padding:2px 7px}
    #beatstore .bs-acts{display:flex;gap:6px;margin-top:4px}
    #beatstore .bs-acts .btn{flex:1;justify-content:center}
    #beatstore .bs-empty{text-align:center;color:var(--dim);padding:60px 10px}
    #beatstore .bs-form{max-width:620px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
    #beatstore .bs-form label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--dim)}
    #beatstore .bs-form input[type=text],#beatstore .bs-form select{background:#14161c;border:1px solid var(--line-hi);color:var(--text);border-radius:8px;padding:8px 10px;font:inherit}
    #beatstore .bs-src{display:flex;gap:8px;flex-wrap:wrap}
    #beatstore .bs-agree{flex-direction:row !important;align-items:flex-start;gap:9px !important;color:var(--text) !important;font-size:12.5px !important}
    `;
    document.head.appendChild(s);
  }

  BS.open = () => {
    style();
    if (!overlay) { overlay = el('div'); overlay.id = 'beatstore'; document.body.appendChild(overlay); }
    overlay.style.display = 'flex'; document.body.classList.add('bs-open');
    render(); if (st.view === 'browse') load();
  };
  BS.close = () => { if (overlay) overlay.style.display = 'none'; document.body.classList.remove('bs-open'); stopAudio(); };

  function render() {
    overlay.textContent = '';
    const top = el('div', 'bs-top');
    top.innerHTML = '<span class="bs-title">Beats</span><span class="bs-free">FREE FOR NOW</span>';
    const search = el('input', 'bs-search'); search.placeholder = 'Search beats, producers, tags…'; search.value = st.q;
    let t = null; search.oninput = () => { clearTimeout(t); t = setTimeout(() => { st.q = search.value.trim(); load(); }, 300); };
    search.onkeydown = (e) => e.stopPropagation();
    const tab = (id, label) => { const b = el('button', 'btn ' + (st.view === id ? 'primary' : 'ghost')); b.textContent = label; b.onclick = () => { st.view = id; render(); if (id === 'browse') load(); else if (id === 'mine') loadMine(); }; return b; };
    const close = el('button', 'btn ghost'); close.textContent = '✕ Close'; close.onclick = BS.close;
    top.append(search, el('span', 'bs-sp'), tab('browse', 'Browse'), tab('mine', 'My beats'), tab('publish', '＋ Publish a beat'), close);
    overlay.append(top);
    if (st.view === 'browse') {
      const bar = el('div', 'bs-bar');
      ['', ...GENRES].forEach((g) => { const b = el('button', 'bs-chip' + (st.genre === g ? ' on' : '')); b.textContent = g || 'All'; b.onclick = () => { st.genre = g; render(); load(); }; bar.appendChild(b); });
      const sort = el('select', 'sel'); sort.innerHTML = '<option value="new">Newest</option><option value="popular">Most popular</option>'; sort.value = st.sort; sort.style.marginLeft = 'auto';
      sort.onchange = () => { st.sort = sort.value; load(); };
      bar.appendChild(sort);
      overlay.append(bar);
    }
    const body = el('div', 'bs-body'); body.id = 'bs-body';
    overlay.append(body);
    if (st.view === 'publish') body.append(publishForm());
    else drawList(body);
  }

  function drawList(body) {
    body = body || document.getElementById('bs-body'); if (!body) return;
    body.textContent = '';
    if (st.loading) return body.append(el('div', 'bs-empty', 'Loading beats…'));
    if (st.error) return body.append(el('div', 'bs-empty', esc(st.error)));
    if (!st.beats.length) return body.append(el('div', 'bs-empty', st.view === 'mine' ? 'You haven’t published any beats yet. Hit <b>＋ Publish a beat</b> to share your first one.' : 'No beats here yet — be the first to publish one!'));
    const grid = el('div', 'bs-grid');
    st.beats.forEach((b) => grid.append(card(b)));
    body.append(grid);
    if (st.view === 'browse' && st.beats.length < st.total) {
      const more = el('button', 'btn'); more.textContent = 'Load more'; more.style.margin = '16px auto'; more.style.display = 'block';
      more.onclick = () => load(true); body.append(more);
    }
  }

  function card(b) {
    const c = el('div', 'bs-card');
    const cover = el('div', 'bs-cover');
    const h = hue(b.id);
    cover.style.backgroundImage = b.cover ? 'url("' + api() + '/beats/' + b.id + '/cover")' : 'linear-gradient(135deg,hsl(' + h + ' 70% 45%),hsl(' + ((h + 60) % 360) + ' 70% 22%))';
    const play = el('button', 'bs-play'); play.textContent = playingId === b.id && audio && !audio.paused ? '❚❚' : '▶'; play.dataset.id = b.id;
    play.onclick = () => togglePlay(b, play, prog);
    const prog = el('div', 'bs-prog'); prog.appendChild(el('i')); prog.dataset.id = b.id;
    prog.onclick = (e) => { if (playingId === b.id && audio && audio.duration) { const r = prog.getBoundingClientRect(); audio.currentTime = audio.duration * (e.clientX - r.left) / r.width; } };
    cover.append(play, prog);
    const m = el('div', 'bs-meta');
    m.innerHTML = '<div class="bs-name" title="' + esc(b.title) + '">' + esc(b.title) + '</div><div class="bs-prod">prod. ' + esc(b.producer.name) + ' · ' + ago(b.created) + (b.hidden ? ' · <b style="color:#ff8a95">hidden (reported)</b>' : '') + '</div>';
    const info = el('div', 'bs-info');
    [b.genre, b.bpm ? b.bpm + ' BPM' : '', b.key, fmtTime(b.duration), '▶ ' + b.plays, '⬇ ' + b.downloads].filter(Boolean).forEach((x) => info.append(el('span', null, esc(x))));
    if (b.tags && b.tags.length) info.append(el('span', null, esc('#' + b.tags.slice(0, 3).join(' #'))));
    const acts = el('div', 'bs-acts');
    const use = el('button', 'btn primary sm'); use.textContent = '＋ Use in Session'; use.title = 'Put this beat on a new track in your song';
    use.onclick = () => useBeat(b, use);
    const dl = el('button', 'btn sm'); dl.textContent = '⬇ Free download'; dl.onclick = () => download(b, dl);
    const more = el('button', 'btn ghost sm'); more.textContent = '⋯'; more.style.flex = 'none';
    more.onclick = (e) => S.clips.menu(e.clientX, e.clientY, st.view === 'mine'
      ? [{ label: 'Delete this beat', danger: true, action: () => remove(b) }]
      : [{ label: 'Copy credit: “prod. ' + b.producer.name + '”', action: () => { try { navigator.clipboard.writeText('prod. ' + b.producer.name); S.toast('Credit copied.'); } catch (e) {} } }, { sep: true }, { label: 'Report this beat', danger: true, action: () => report(b) }]);
    acts.append(use, dl, more);
    m.append(info, acts);
    c.append(cover, m);
    return c;
  }

  async function load(more) {
    st.view = 'browse';
    if (!more) { st.loading = true; st.error = ''; drawList(); }
    const qs = new URLSearchParams({ q: st.q, genre: st.genre, sort: st.sort, offset: more ? st.beats.length : 0, limit: 30 });
    try {
      const r = await fetch(api() + '/beats?' + qs);
      if (!r.ok) throw new Error('The beat store is offline right now (' + r.status + ').');
      const j = await r.json();
      st.beats = more ? st.beats.concat(j.beats) : j.beats; st.total = j.total;
    } catch (e) { st.error = navigator.onLine === false ? 'You’re offline — connect to the internet to browse beats.' : (e.message || 'Could not load beats.'); }
    st.loading = false; drawList();
  }
  async function loadMine() {
    st.loading = true; st.error = ''; drawList();
    const t = await token();
    if (!t) { st.loading = false; st.error = 'Sign in with Discord (Session for Windows/Mac) to see and publish your beats.'; return drawList(); }
    try {
      const r = await fetch(api() + '/beats/mine', { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) throw new Error('Could not load your beats (' + r.status + ').');
      st.beats = (await r.json()).beats; st.total = st.beats.length;
    } catch (e) { st.error = e.message; }
    st.loading = false; drawList();
  }

  /* ---------- playback (one shared player, streams with seeking) ---------- */
  function stopAudio() { if (audio) { audio.pause(); } playingId = null; syncButtons(); }
  function syncButtons() {
    if (!overlay) return;
    overlay.querySelectorAll('.bs-play').forEach((b) => (b.textContent = b.dataset.id === playingId && audio && !audio.paused ? '❚❚' : '▶'));
  }
  function togglePlay(b) {
    if (!audio) {
      audio = new Audio(); audio.preload = 'none'; audio.crossOrigin = 'anonymous';
      audio.ontimeupdate = () => { const p = overlay && overlay.querySelector('.bs-prog[data-id="' + playingId + '"] i'); if (p && audio.duration) p.style.width = (100 * audio.currentTime / audio.duration) + '%'; };
      audio.onended = () => { playingId = null; syncButtons(); };
      audio.onplay = audio.onpause = syncButtons;
      audio.onerror = () => { S.toast('Could not play that beat.'); playingId = null; syncButtons(); };
    }
    if (playingId === b.id) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
    if (S.engine && S.engine.playing && S.stopTransport) try { S.stopTransport(); } catch (e) {}
    if (S.beat && S.beat.isPlaying && S.beat.isPlaying()) S.beat.stop();
    playingId = b.id; audio.src = api() + '/beats/' + b.id + '/audio'; audio.play().catch(() => {});
    fetch(api() + '/beats/' + b.id + '/play', { method: 'POST' }).catch(() => {});
    syncButtons();
  }

  async function fetchMp3(b) {
    const r = await fetch(api() + '/beats/' + b.id + '/audio');
    if (!r.ok) throw new Error('download failed (' + r.status + ')');
    return r.arrayBuffer();
  }
  const fileName = (b) => (b.title + ' (prod. ' + b.producer.name + ')').replace(/[\\/:*?"<>|]+/g, '_') + '.mp3';
  async function download(b, btn) {
    btn.disabled = true; const t0 = btn.textContent; btn.textContent = 'Downloading…';
    try {
      const bytes = await fetchMp3(b);
      const path = await window.studioHost.saveFile({ data: bytes, binary: true, defaultName: fileName(b), filters: [{ name: 'MP3 audio', extensions: ['mp3'] }] });
      if (path) { S.toast('Saved “' + b.title + '”. Free to use — credit “prod. ' + b.producer.name + '”.'); fetch(api() + '/beats/' + b.id + '/download', { method: 'POST' }).catch(() => {}); }
    } catch (e) { S.toast('Could not download: ' + e.message); }
    btn.disabled = false; btn.textContent = t0;
  }
  async function useBeat(b, btn) {
    btn.disabled = true; const t0 = btn.textContent; btn.textContent = 'Loading…';
    try {
      const buf = await S.ctx.decodeAudioData(await fetchMp3(b));
      S.history.push();
      const id = S.addAsset(b.title + ' (prod. ' + b.producer.name + ')', buf);
      const tr = S.newTrack(S.project.tracks.length); tr.name = 'Beat – ' + b.title.slice(0, 24);
      S.project.tracks.push(tr);
      S.addClip(S.project.tracks.length - 1, id, 0);
      if (b.bpm && S.project.tracks.every((t) => t === tr || !t.clips.length)) { S.project.bpm = b.bpm; if (S.tempo && S.tempo.refresh) try { S.tempo.refresh(); } catch (e) {} }
      S.refresh.structure(); S.timeline.resize();
      fetch(api() + '/beats/' + b.id + '/download', { method: 'POST' }).catch(() => {});
      S.toast('“' + b.title + '” is on a new track' + (b.bpm ? ' (' + b.bpm + ' BPM)' : '') + '. Credit: prod. ' + b.producer.name + '.');
      BS.close();
    } catch (e) { S.toast('Could not load that beat: ' + (e.message || e)); }
    btn.disabled = false; btn.textContent = t0;
  }
  async function report(b) {
    const t = await token(); if (!t) return S.toast('Sign in with Discord to report a beat.');
    const why = await S.askText('Why are you reporting “' + b.title + '”?', { placeholder: 'e.g. stolen beat, offensive, spam' });
    if (why == null) return;
    try { const r = await fetch(api() + '/beats/' + b.id + '/report', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: why }) }); if (!r.ok) throw new Error(r.status); S.toast('Thanks — reported.'); }
    catch (e) { S.toast('Could not report right now.'); }
  }
  async function remove(b) {
    if (!confirm('Delete “' + b.title + '” from the store? This can’t be undone.')) return;
    const t = await token(); if (!t) return;
    try { const r = await fetch(api() + '/beats/' + b.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); if (!r.ok) throw new Error(r.status); S.toast('Deleted.'); loadMine(); }
    catch (e) { S.toast('Could not delete right now.'); }
  }

  /* ---------- publish ---------- */
  function publishForm() {
    const f = el('div', 'bs-form');
    const pk = S.project.key;
    const keyNow = pk && pk.tonic != null ? KEYS[pk.tonic] + ' ' + (pk.mode === 'minor' ? 'minor' : 'major') : '';
    f.innerHTML = `<h2 style="margin:0">Publish a beat</h2><p class="hint" style="margin:0">Share your beat with every Session user. It’s listed as a <b>free download</b> — people can use it as long as they credit you (“prod. your name”). You can delete it any time from <b>My beats</b>.</p>
      <div><div class="hint" style="margin-bottom:6px">What do you want to publish?</div><div class="bs-src"></div><div class="hint bs-srcinfo" style="margin-top:6px"></div></div>
      <label>Title<input type="text" class="bs-t" maxlength="60" placeholder="e.g. Midnight Drive"></label>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><label style="flex:1">Genre<select class="bs-g">${GENRES.map((g) => '<option>' + g + '</option>').join('')}</select></label>
      <label style="width:110px">BPM<input type="text" class="bs-bpm" inputmode="numeric" value="${esc(Math.round(S.project.bpm || 120))}"></label>
      <label style="flex:1">Key<select class="bs-k"><option value="">Not sure</option>${KEYS.flatMap((k) => [k + ' minor', k + ' major']).map((k) => '<option' + (k === keyNow ? ' selected' : '') + '>' + k + '</option>').join('')}</select></label></div>
      <label>Tags (comma separated)<input type="text" class="bs-tags" maxlength="100" placeholder="dark, travis, 808"></label>
      <label>Cover picture (optional)<input type="file" class="bs-cov" accept="image/png,image/jpeg"></label>
      <label class="bs-agree"><input type="checkbox" class="bs-ok"> <span>I made this beat, it has no samples I don’t have the rights to, and I’m OK with it being a free download that people can use with credit.</span></label>
      <div style="display:flex;gap:10px;align-items:center"><button class="btn primary bs-go">Publish beat</button><span class="hint bs-msg"></span></div>`;
    const q = (s) => f.querySelector(s);
    f.addEventListener('keydown', (e) => e.stopPropagation());
    let src = S.beat && S.beat.get && S.beat.get().patterns ? 'beatlab' : 'mix', file = null;
    const srcs = [['beatlab', 'My Beat Lab beat'], ['mix', 'This song’s mix'], ['file', 'An audio file…']];
    const info = { beatlab: 'Renders your Beat Lab beat (the Song if you arranged one, else the current pattern ×4).', mix: 'Renders the whole song as you hear it, with every track and effect.', file: '' };
    const drawSrc = () => {
      const box = q('.bs-src'); box.textContent = '';
      srcs.forEach(([id, l]) => { const b = el('button', 'btn ' + (src === id ? 'primary' : '')); b.type = 'button'; b.textContent = l; b.onclick = () => { src = id; if (id === 'file') pickFile(); drawSrc(); }; box.appendChild(b); });
      q('.bs-srcinfo').textContent = src === 'file' ? (file ? 'File: ' + file.name : 'Choose an MP3 or WAV.') : info[src];
    };
    const pickFile = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'audio/*,.mp3,.wav,.flac'; i.onchange = () => { file = i.files[0] || null; drawSrc(); }; i.click(); };
    drawSrc();
    q('.bs-go').onclick = async () => {
      const msg = q('.bs-msg'), go = q('.bs-go');
      const title = q('.bs-t').value.trim();
      if (!title) return (msg.textContent = 'Give your beat a title.');
      if (!q('.bs-ok').checked) return (msg.textContent = 'Tick the box to confirm it’s your beat.');
      if (src === 'file' && !file) return (msg.textContent = 'Choose an audio file first.');
      const t = await token();
      if (!t) return (msg.textContent = 'Sign in with Discord first (publishing works in Session for Windows/Mac).');
      go.disabled = true;
      try {
        msg.textContent = 'Rendering…'; await new Promise((r) => setTimeout(r, 30));
        let buf;
        if (src === 'file') buf = await S.ctx.decodeAudioData(await file.arrayBuffer());
        else if (src === 'mix') buf = await S.renderSongBuffer();
        else { const bt = S.beat.get(); buf = await S.beat.renderOffline(bt.song.length ? 1 : 4, bt.song.length ? 'song' : 'pattern'); }
        if (!buf || buf.duration < 3) throw new Error('that’s shorter than 3 seconds');
        if (buf.duration > 600) throw new Error('beats can be up to 10 minutes');
        msg.textContent = 'Encoding MP3…'; await new Promise((r) => setTimeout(r, 30));
        const mp3 = S.encodeMp3(buf, { bitrate: buf.duration > 300 ? 192 : 256 });
        if (mp3.byteLength > 20 * 1024 * 1024) throw new Error('the MP3 is over 20 MB — use a shorter beat');
        const fd = new FormData();
        fd.append('audio', new Blob([mp3], { type: 'audio/mpeg' }), 'beat.mp3');
        fd.append('title', title); fd.append('genre', q('.bs-g').value); fd.append('bpm', q('.bs-bpm').value);
        fd.append('key', q('.bs-k').value); fd.append('tags', q('.bs-tags').value); fd.append('agree', '1');
        const cov = q('.bs-cov').files[0];
        if (cov) fd.append('cover', await squareCover(cov), 'cover.jpg');
        msg.textContent = 'Uploading… 0%';
        const res = await new Promise((resolve, reject) => {
          const x = new XMLHttpRequest(); x.open('POST', api() + '/beats'); x.setRequestHeader('Authorization', 'Bearer ' + t);
          x.upload.onprogress = (e) => { if (e.lengthComputable) msg.textContent = 'Uploading… ' + Math.round(100 * e.loaded / e.total) + '%'; };
          x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} x.status === 200 ? resolve(j) : reject(new Error(j.error || 'upload failed (' + x.status + ')')); };
          x.onerror = () => reject(new Error('no connection to the beat store'));
          x.send(fd);
        });
        S.toast('Published “' + res.beat.title + '”! It’s live in Beats.');
        st.view = 'mine'; render(); loadMine();
      } catch (e) { msg.textContent = 'Couldn’t publish: ' + (e.message || e); }
      go.disabled = false;
    };
    return f;
  }
  // crop the cover to a 600x600 JPEG so it stays small
  async function squareCover(file) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas'); c.width = c.height = 600;
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 600, 600);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  }

  BS.init = () => {
    const nav = document.getElementById('btn-beat');
    if (nav && !document.getElementById('btn-beats')) {
      const b = document.createElement('button'); b.className = 'uitab act'; b.id = 'btn-beats'; b.type = 'button';
      b.title = 'Beats: browse, play and download free beats from Session producers — or publish your own';
      b.textContent = '🎧 Beats'; b.onclick = () => BS.open();
      nav.after(b);
    }
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay && overlay.style.display !== 'none' && !document.querySelector('dialog[open]')) BS.close(); }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', BS.init); else BS.init();
})();
