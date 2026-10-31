/* Your Sounds — a personal sample library kept on this computer (IndexedDB). Import your own
 * audio files once, then drop them onto the timeline whenever you want. Nothing leaves your machine. */
(function () {
  const S = window.Studio;
  const M = (S.sounds = {});
  const DBN = 'session-sounds';
  const STORE = 'samples';

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DBN, 1); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(store)).then((v) => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  M.list = () => tx('readonly', (s) => reqP(s.getAll())).then((rows) => (rows || []).sort((a, b) => (b.added || 0) - (a.added || 0))).catch(() => []);
  M.put = (rec) => tx('readwrite', (s) => s.put(rec));
  M.del = (id) => tx('readwrite', (s) => s.delete(id));
  M.getOne = (id) => tx('readonly', (s) => reqP(s.get(id)));

  /* ---------- import ---------- */
  M.importFiles = async (files, onEach) => {
    let n = 0;
    for (const f of files) {
      try {
        const bytes = await f.arrayBuffer();
        // decode once to validate + get duration; store the ORIGINAL bytes (small, exact)
        const buf = await S.ctx.decodeAudioData(bytes.slice(0));
        const rec = { id: S.uid(), name: f.name.replace(/\.[^.]+$/, ''), type: f.type || 'audio/*', blob: new Blob([bytes], { type: f.type || 'audio/*' }), dur: buf.duration, added: Date.now() };
        await M.put(rec);
        bufCache.set(rec.id, buf);
        n++;
        if (onEach) onEach(rec);
      } catch (e) {
        S.toast('Could not add ' + f.name);
      }
    }
    return n;
  };

  /* ---------- decode cache + preview ---------- */
  const bufCache = new Map();
  async function bufferFor(id) {
    if (bufCache.has(id)) return bufCache.get(id);
    const rec = await M.getOne(id);
    if (!rec) throw new Error('missing');
    const buf = await S.ctx.decodeAudioData(await rec.blob.arrayBuffer());
    bufCache.set(id, buf);
    return buf;
  }

  let preview = null;
  function stopPreview() {
    if (preview) { try { preview.stop(); } catch (e) {} preview = null; }
  }
  async function playPreview(id, onEnd) {
    stopPreview();
    await S.ctx.resume();
    const buf = await bufferFor(id);
    const src = S.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(S.engine && S.engine.appOut ? S.engine.appOut : S.ctx.destination);
    src.onended = () => { if (preview === src) preview = null; onEnd && onEnd(); };
    src.start();
    preview = src;
  }

  /* ---------- put a sample on the timeline ---------- */
  M.addToTimeline = async (id) => {
    const rec = await M.getOne(id);
    if (!rec) return;
    const buf = await bufferFor(id);
    const tracks = S.project.tracks;
    let idx = tracks.findIndex((t) => t.arm);
    if (idx < 0) idx = tracks.findIndex((t) => (t.clips || []).length === 0);
    if (idx < 0) idx = 0;
    while (idx >= tracks.length) tracks.push(S.newTrack(tracks.length));
    S.history.push();
    const asset = S.addAsset(rec.name, buf);
    S.addClip(idx, asset, S.playhead);
    S.refresh.structure();
    S.timeline.resize();
    S.tools.afterContent();
    S.toast('Added “' + rec.name + '” to ' + (tracks[idx].name || 'track ' + (idx + 1)) + ' at the playhead.');
  };

  /* ---------- UI ---------- */
  const fmtDur = (s) => { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  M.init = () => {
    const btn = document.getElementById('btn-sounds');
    if (btn) btn.onclick = () => M.open();
  };

  M.open = async () => {
    const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
    const dlg = el('dialog', 'modal sounds-dlg');
    dlg.innerHTML =
      '<div class="set-head"><span class="set-ic">' + S.ui.icon('music', 18) + '</span><h3>Your sounds</h3><div class="pw-sp"></div><button class="pw-ib snd-x" title="Close">' + S.ui.icon('x', 14) + '</button></div>' +
      '<p class="hint">Keep your own samples, loops and one-shots here — imported once, ready for any song. Saved on this computer.</p>' +
      '<div class="snd-bar"></div>' +
      '<div class="snd-list"></div>' +
      '<input type="file" class="snd-file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a" multiple hidden>';
    const bar = dlg.querySelector('.snd-bar');
    const listEl = dlg.querySelector('.snd-list');
    const fileInp = dlg.querySelector('.snd-file');
    dlg.querySelector('.snd-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => { stopPreview(); dlg.remove(); });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());

    const imp = el('button', 'btn primary', S.ui.icon('import', 15) + 'Import sounds…');
    imp.onclick = () => fileInp.click();
    bar.appendChild(imp);
    fileInp.onchange = async () => {
      const files = [...fileInp.files];
      fileInp.value = '';
      if (!files.length) return;
      imp.disabled = true; imp.textContent = 'Importing…';
      const n = await M.importFiles(files);
      imp.disabled = false; imp.innerHTML = S.ui.icon('import', 15) + 'Import sounds…';
      if (n) S.toast('Added ' + n + ' sound' + (n > 1 ? 's' : '') + ' to your library.');
      draw();
    };

    async function draw() {
      const rows = await M.list();
      listEl.innerHTML = '';
      if (!rows.length) {
        listEl.appendChild(el('p', 'hint snd-empty', 'No sounds yet. Import a few and they’ll show up here for every song.'));
        return;
      }
      for (const r of rows) {
        const row = el('div', 'snd-row');
        const play = el('button', 'pw-ib', S.ui.icon('play', 14)); play.title = 'Preview';
        let playing = false;
        play.onclick = async () => {
          if (playing) { stopPreview(); play.innerHTML = S.ui.icon('play', 14); playing = false; return; }
          listEl.querySelectorAll('.pw-ib.on').forEach((b) => { b.classList.remove('on'); b.innerHTML = S.ui.icon('play', 14); });
          await playPreview(r.id, () => { play.innerHTML = S.ui.icon('play', 14); play.classList.remove('on'); playing = false; });
          play.innerHTML = S.ui.icon('stop', 14); play.classList.add('on'); playing = true;
        };
        const nm = el('span', 'snd-n'); nm.textContent = r.name;
        const du = el('span', 'snd-d'); du.textContent = fmtDur(r.dur);
        const add = el('button', 'btn sm', 'Add'); add.title = 'Drop it on the armed track at the playhead';
        add.onclick = () => M.addToTimeline(r.id);
        const del = el('button', 'pw-ib sm', S.ui.icon('trash', 13)); del.title = 'Remove from your library';
        del.onclick = async () => { await M.del(r.id); bufCache.delete(r.id); draw(); };
        row.append(play, nm, du, el('span', 'pw-sp'), add, del);
        // double-click the name to add quickly
        nm.ondblclick = () => M.addToTimeline(r.id);
        listEl.appendChild(row);
      }
    }
    draw();

    document.body.appendChild(dlg);
    dlg.showModal();
  };
})();
