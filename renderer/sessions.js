/* In-app sessions — save and reopen your songs inside Session itself (IndexedDB on this computer),
 * so you don't have to download a .pstudio file every time. Files still work; this is an extra option. */
(function () {
  const S = window.Studio;
  const M = (S.sessions = { currentId: null });
  const DBN = 'session-projects';
  const STORE = 'projects';
  const META = 'meta';

  /* ---------- IndexedDB ----------
   * Two stores:
   *   projects — the full song. New format (v:2) keeps the arrangement as small JSON and every take as
   *              a binary WAV Blob (no giant base64 strings: those hit the ~133 MB value cap on save and
   *              ran the app out of memory on open). Old records ({ data: <packed JSON string> }) still open.
   *   meta     — just { id, name, updated } so the Saved sessions list never loads any audio. */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DBN, 2); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }
  function tx(stores, mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((v) => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const breathe = () => new Promise((r) => setTimeout(r));

  /** List names only. Older saves made before the meta store existed get indexed once, one at a time. */
  M.list = async () => {
    try {
      const [metas, keys] = await tx([STORE, META], 'readonly', (t) => Promise.all([reqP(t.objectStore(META).getAll()), reqP(t.objectStore(STORE).getAllKeys())]));
      const have = new Set(metas.map((m) => m.id));
      for (const id of keys) {
        if (have.has(id)) continue;
        const rec = await tx([STORE], 'readonly', (t) => reqP(t.objectStore(STORE).get(id)));
        if (!rec) continue;
        const m = { id, name: rec.name || 'Untitled Session', updated: rec.updated || 0 };
        await tx([META], 'readwrite', (t) => t.objectStore(META).put(m));
        metas.push(m);
        await breathe();
      }
      return metas.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    } catch (e) { return []; }
  };
  M.getOne = (id) => tx([STORE], 'readonly', (t) => reqP(t.objectStore(STORE).get(id)));
  M.remove = (id) => tx([STORE, META], 'readwrite', (t) => { t.objectStore(STORE).delete(id); t.objectStore(META).delete(id); });
  async function rename(id, name) {
    const rec = await M.getOne(id);
    if (!rec) return;
    rec.name = name;
    await tx([STORE, META], 'readwrite', (t) => { t.objectStore(STORE).put(rec); t.objectStore(META).put({ id, name, updated: rec.updated || Date.now() }); });
  }

  /** Every asset the song actually uses (track clips + custom Beat Lab sounds). */
  function usedAssets() {
    const used = new Set(S.project.tracks.flatMap((t) => (t.clips || []).map((c) => c.asset)));
    if (S.project.beat && Array.isArray(S.project.beat.channels)) for (const c of S.project.beat.channels) if (c && c.assetId) used.add(c.assetId);
    return used;
  }
  /** Write the current song in the new format. Encodes take by take without freezing the app. */
  async function writeCurrent(id, name) {
    const used = usedAssets();
    const assets = {};
    for (const a of used) if (S.project.assets[a]) assets[a] = S.project.assets[a];
    const project = JSON.stringify(Object.assign({}, S.project, { assets }));
    const audio = {};
    for (const a of used) {
      const buf = S.buffers.get(a);
      if (!buf) continue;
      audio[a] = new Blob([await S.encodeWavChunked(buf, { float: true })], { type: 'audio/wav' }); // float = lossless
      await breathe();
    }
    const updated = Date.now();
    await tx([STORE, META], 'readwrite', (t) => {
      t.objectStore(STORE).put({ id, name, updated, v: 2, project, audio });
      t.objectStore(META).put({ id, name, updated });
    });
  }

  /* ---------- save / open ---------- */
  /** Save the current project into the app. Overwrites the one it was opened from, or makes a new one. */
  M.saveCurrent = async (asNew) => {
    let name = S.project.name || 'Untitled Session';
    let id = asNew ? null : M.currentId;
    // always let people name (or rename) what they're saving — prefilled, so Enter keeps the name
    const typed = await S.askText(id ? 'Save session as' : 'Name this session', { value: name, placeholder: 'Song name' });
    if (typed == null) return;
    name = typed.trim() || name;
    if (!id) id = S.uid();
    S.project.name = name;
    const pn = document.getElementById('proj-name');
    if (pn) pn.value = name;
    try {
      if (S.native && S.native.syncStates) await S.native.syncStates();
      S.toast('Saving “' + (S.project.name || name) + '”…');
      await writeCurrent(id, S.project.name || name);
      M.currentId = id;
      S.toast('Saved “' + (S.project.name || name) + '” in the app.');
    } catch (e) {
      S.toast('Could not save in the app: ' + (e.message || e));
    }
  };

  M.open = async (id) => {
    let rec = await M.getOne(id);
    if (!rec) return;
    try {
      S.toast('Opening “' + (rec.name || 'session') + '”…');
      let project, legacy = false;
      if (rec.v === 2) {
        project = S.validateProject(JSON.parse(rec.project));
        const audio = rec.audio || {};
        rec = null; // let go of the record as we decode
        S.buffers.clear();
        for (const a of Object.keys(audio)) {
          try { S.buffers.set(a, await S.ctx.decodeAudioData(await audio[a].arrayBuffer())); } catch (e) { /* skip a take that will not decode */ }
          audio[a] = null;
          await breathe();
        }
        for (const t of project.tracks) t.clips = t.clips.filter((c) => S.buffers.has(c.asset));
      } else {
        const obj = JSON.parse(rec.data);
        rec = null;
        project = await S.unpackProject(obj, S.ctx);
        legacy = true;
      }
      if (S.engine.mic) S.engine.setMonitor(null);
      S.setProject(project);
      S.refresh.structure();
      S.timeline.resize();
      M.currentId = id;
      S.toast('Opened “' + project.name + '”.');
      // quietly upgrade an old-format save so it opens fast (and can grow) from now on
      if (legacy) setTimeout(() => { writeCurrent(id, project.name || 'Untitled Session').catch(() => {}); }, 1500);
    } catch (e) {
      S.toast('Could not open that session: ' + (e.message || e));
    }
  };

  /* ---------- menus + dialog ---------- */
  /** The Save button's menu: in-app save, file save, and the saved-sessions list. */
  M.saveMenu = (x, y, saveToFile) => {
    S.clips.menu(x, y, [
      { label: M.currentId ? 'Save in app' : 'Save in app…', hint: 'kept in Session', action: () => M.saveCurrent(false) },
      ...(M.currentId ? [{ label: 'Save as a new app session…', action: () => M.saveCurrent(true) }] : []),
      { label: 'Save to a file…', hint: 'Ctrl+S', action: saveToFile },
      { sep: true },
      { label: 'Saved sessions…', action: () => M.dialog() },
    ]);
  };

  /** The Open button's menu: open from the app, or from a file. */
  M.openMenu = (x, y, openFile) => {
    S.clips.menu(x, y, [
      { label: 'Open from the app…', action: () => M.dialog() },
      { label: 'Open a file…', hint: 'Ctrl+O', action: openFile },
    ]);
  };

  const when = (ms) => {
    if (!ms) return '';
    const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
    return d.getMonth() + 1 + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  M.dialog = async () => {
    const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
    const dlg = el('dialog', 'modal sounds-dlg');
    dlg.innerHTML =
      '<div class="set-head"><span class="set-ic">' + S.ui.icon('save', 18) + '</span><h3>Saved sessions</h3><div class="pw-sp"></div><button class="pw-ib ss-x" title="Close">' + S.ui.icon('x', 14) + '</button></div>' +
      '<p class="hint">Your songs saved inside Session, on this computer. You can still Save to a file any time.</p>' +
      '<div class="snd-bar"></div>' +
      '<div class="snd-list"></div>';
    const bar = dlg.querySelector('.snd-bar');
    const listEl = dlg.querySelector('.snd-list');
    dlg.querySelector('.ss-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('keydown', (e) => e.stopPropagation());

    const saveBtn = el('button', 'btn primary', S.ui.icon('save', 15) + 'Save current session');
    saveBtn.onclick = async () => { await M.saveCurrent(false); draw(); };
    bar.appendChild(saveBtn);

    async function draw() {
      const rows = await M.list();
      listEl.innerHTML = '';
      if (!rows.length) { listEl.appendChild(el('p', 'hint snd-empty', 'No saved sessions yet. Save the current one to keep it here.')); return; }
      for (const r of rows) {
        const row = el('div', 'snd-row');
        const nm = el('span', 'snd-n'); nm.textContent = r.name + (r.id === M.currentId ? '  •' : '');
        const du = el('span', 'snd-d'); du.textContent = when(r.updated);
        const open = el('button', 'btn sm', 'Open'); open.onclick = async () => { await M.open(r.id); dlg.close(); };
        const ren = el('button', 'pw-ib sm', S.ui.icon('wand', 12)); ren.title = 'Rename';
        ren.onclick = async () => { const n = await S.askText('Rename session', { value: r.name }); if (!n) return; await rename(r.id, n); draw(); };
        const del = el('button', 'pw-ib sm', S.ui.icon('trash', 13)); del.title = 'Delete';
        del.onclick = async () => { if (!confirm('Delete “' + r.name + '” from the app? This cannot be undone.')) return; await M.remove(r.id); if (M.currentId === r.id) M.currentId = null; draw(); };
        row.append(nm, du, el('span', 'pw-sp'), open, ren, del);
        nm.ondblclick = () => open.click();
        listEl.appendChild(row);
      }
    }
    draw();
    document.body.appendChild(dlg);
    dlg.showModal();
  };

  M.init = () => {};
})();
