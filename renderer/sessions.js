/* In-app sessions — save and reopen your songs inside Session itself (IndexedDB on this computer),
 * so you don't have to download a .pstudio file every time. Files still work; this is an extra option. */
(function () {
  const S = window.Studio;
  const M = (S.sessions = { currentId: null });
  const DBN = 'session-projects';
  const STORE = 'projects';

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
      let out;
      Promise.resolve(fn(t.objectStore(STORE))).then((v) => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  M.list = () => tx('readonly', (s) => reqP(s.getAll())).then((r) => (r || []).sort((a, b) => (b.updated || 0) - (a.updated || 0))).catch(() => []);
  M.getOne = (id) => tx('readonly', (s) => reqP(s.get(id)));
  M.remove = (id) => tx('readwrite', (s) => s.delete(id));
  const putRec = (rec) => tx('readwrite', (s) => s.put(rec));

  /* ---------- save / open ---------- */
  /** Save the current project into the app. Overwrites the one it was opened from, or makes a new one. */
  M.saveCurrent = async (asNew) => {
    let name = S.project.name || 'Untitled Session';
    let id = asNew ? null : M.currentId;
    if (!id) {
      const typed = await S.askText('Name this session', { value: name });
      if (!typed) return;
      name = typed;
      id = S.uid();
      S.project.name = name;
    }
    try {
      if (S.native && S.native.syncStates) await S.native.syncStates();
      const data = JSON.stringify(S.packProject());
      await putRec({ id, name: S.project.name || name, data, updated: Date.now() });
      M.currentId = id;
      S.toast('Saved “' + (S.project.name || name) + '” in the app.');
    } catch (e) {
      S.toast('Could not save in the app: ' + (e.message || e));
    }
  };

  M.open = async (id) => {
    const rec = await M.getOne(id);
    if (!rec) return;
    try {
      const project = await S.unpackProject(JSON.parse(rec.data), S.ctx);
      if (S.engine.mic) S.engine.setMonitor(null);
      S.setProject(project);
      S.refresh.structure();
      S.timeline.resize();
      M.currentId = id;
      S.toast('Opened “' + project.name + '”.');
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
        ren.onclick = async () => { const n = await S.askText('Rename session', { value: r.name }); if (!n) return; await putRec(Object.assign({}, r, { name: n })); draw(); };
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
