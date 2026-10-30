/* The Vault link: send the finished mix to The Vault (a private song library app), as a new song or
 * as a new version of a song already there, and bring Vault songs into Session.
 * The file work happens in the main process (native/vault.js); this is the dialog. */
(function () {
  const S = window.Studio;
  const V = (S.vault = {});
  const host = () => window.studioHost || {};

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function seg(options, value, onChange) {
    const box = el('div', 'seg vd-seg');
    const btns = options.map(([val, label]) => {
      const b = el('button', 'seg-b');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => {
        value = val;
        btns.forEach((x, i) => x.classList.toggle('on', options[i][0] === val));
        onChange(val);
      };
      box.appendChild(b);
      return b;
    });
    btns.forEach((x, i) => x.classList.toggle('on', options[i][0] === value));
    return box;
  }

  V.init = () => {
    const b = document.getElementById('btn-vault');
    if (b) b.onclick = () => V.open();
  };

  const VAULT_INSTALL = 'https://discord.gg/HbkNrPAAm';

  /** Shown when The Vault app isn't installed: Session links to it, so you need it first. */
  function installPrompt() {
    const dlg = el('dialog', 'modal vault-dlg');
    dlg.innerHTML =
      '<div class="vd-head"><div class="vd-logo">' +
      S.ui.icon('vault', 22) +
      '</div><div><div class="vd-title">Get The Vault</div><div class="vd-sub">Required for the Vault link</div></div><div class="pw-sp"></div><button class="pw-ib vd-x" title="Close">' +
      S.ui.icon('x', 14) +
      '</button></div><div class="vd-body"><div class="vd-install"><p>The Vault link sends your songs to <b>The Vault</b> — your friend\'s song library app. It isn\'t installed on this computer yet.</p><p>Download and install it, then open this again.</p></div></div>';
    const body = dlg.querySelector('.vd-body');
    dlg.querySelector('.vd-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    const foot = el('div', 'vd-foot');
    const cancel = el('button', 'btn ghost', 'Not now');
    cancel.onclick = () => dlg.close();
    const get = el('button', 'btn primary', S.ui.icon('vault', 15) + 'Get The Vault');
    get.onclick = () => (host().openExternal ? host().openExternal(VAULT_INSTALL) : window.open(VAULT_INSTALL, '_blank'));
    foot.append(el('span', 'pw-sp'), cancel, get);
    body.appendChild(foot);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  V.open = async (tab = 'send') => {
    if (!host().vaultStatus) return S.toast('The Vault link needs the updated app files (main.js / preload.js).');
    let st = await host().vaultStatus();
    if (!st.ok) return S.toast('The Vault: ' + st.error);
    // Require The Vault app to be installed — otherwise point the person to get it.
    if (!st.exe) return installPrompt();

    const dlg = el('dialog', 'modal vault-dlg');
    dlg.innerHTML =
      '<div class="vd-head"><div class="vd-logo">' +
      S.ui.icon('vault', 22) +
      '</div><div><div class="vd-title">The Vault</div><div class="vd-sub"></div></div><div class="pw-sp"></div><button class="pw-ib vd-x" title="Close">' +
      S.ui.icon('x', 14) +
      '</button></div><div class="vd-tabs"></div><div class="vd-body"></div>';
    const sub = dlg.querySelector('.vd-sub');
    const body = dlg.querySelector('.vd-body');
    const setSub = () => {
      sub.textContent = st.found ? st.songs.length + ' song' + (st.songs.length === 1 ? '' : 's') + ' · ' + st.root : 'No library yet · will be created in ' + st.root;
    };
    setSub();
    dlg.querySelector('.vd-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('keydown', (e) => e.stopPropagation());

    const tabs = seg(
      [
        ['send', 'Send this song'],
        ['open', 'Bring a Vault song in'],
      ],
      tab,
      (t) => show(t)
    );
    dlg.querySelector('.vd-tabs').appendChild(tabs);

    function show(t) {
      body.innerHTML = '';
      if (t === 'send') sendPane();
      else openPane();
    }

    /* ---------- send ---------- */
    function sendPane() {
      const link = S.project.vault;
      const linked = link && st.songs.find((s) => s.id === link.songId);
      const f = {
        mode: linked ? 'version' : 'new',
        title: S.project.name && S.project.name !== 'Untitled Session' ? S.project.name : '',
        status: 'Unfinished',
        project: '',
        notes: '',
        songId: linked ? linked.id : st.songs[0] ? st.songs[0].id : null,
        note: '',
        vstatus: '',
      };
      if (!st.songs.length) f.mode = 'new';

      const form = el('div', 'vd-form');
      const modeRow = el('div', 'vd-row');
      modeRow.innerHTML = '<label>Save as</label>';
      modeRow.appendChild(
        seg(
          [
            ['new', 'New song'],
            ['version', 'New version of a song'],
          ],
          f.mode,
          (m) => {
            f.mode = m;
            draw();
          }
        )
      );
      form.appendChild(modeRow);
      const fields = el('div', 'vd-fields');
      form.appendChild(fields);
      body.appendChild(form);

      const input = (label, key, ph, multi) => {
        const r = el('div', 'vd-row');
        r.innerHTML = '<label>' + label + '</label>';
        const i = el(multi ? 'textarea' : 'input', 'txt vd-in');
        i.placeholder = ph || '';
        i.value = f[key];
        i.oninput = () => (f[key] = i.value);
        r.appendChild(i);
        fields.appendChild(r);
        return i;
      };
      const statusRow = (key, opts) => {
        const r = el('div', 'vd-row');
        r.innerHTML = '<label>Status</label>';
        r.appendChild(seg(opts, f[key], (v) => (f[key] = v)));
        fields.appendChild(r);
      };

      function draw() {
        fields.innerHTML = '';
        if (f.mode === 'new') {
          const t = input('Title', 'title', 'Song title');
          statusRow('status', [
            ['Unfinished', 'Unfinished'],
            ['Finished', 'Finished'],
          ]);
          input('Project', 'project', 'Optional, e.g. album or EP name');
          input('Notes', 'notes', 'Optional', true);
          setTimeout(() => t.focus());
        } else {
          if (!st.songs.length) {
            fields.innerHTML = '<p class="vd-empty">There are no songs in The Vault yet. Send this one as a new song first.</p>';
            return;
          }
          const r = el('div', 'vd-row');
          r.innerHTML = '<label>Song</label>';
          const sel = el('select', 'sel vd-in');
          for (const s of st.songs) {
            const o = el('option');
            o.value = s.id;
            o.textContent = s.title + '  ·  ' + s.status + (s.versions ? '  ·  ' + s.versions + ' older version' + (s.versions > 1 ? 's' : '') : '');
            sel.appendChild(o);
          }
          sel.value = String(f.songId);
          sel.onchange = () => (f.songId = +sel.value);
          r.appendChild(sel);
          fields.appendChild(r);
          input('What changed?', 'note', "Optional, e.g. 'new mix, louder vocals'");
          statusRow('vstatus', [
            ['', 'Keep'],
            ['Unfinished', 'Unfinished'],
            ['Finished', 'Finished'],
          ]);
          const hint = el('p', 'vd-hint');
          hint.textContent = 'The current file of this song moves into its History in The Vault, so nothing is lost.';
          fields.appendChild(hint);
        }
      }
      draw();

      const foot = el('div', 'vd-foot');
      foot.innerHTML = '<span class="vd-info">' + S.ui.icon('export', 13) + ' Exports the whole mix as a WAV, the same as Export WAV.</span>';
      const cancel = el('button', 'btn ghost', 'Cancel');
      cancel.onclick = () => dlg.close();
      const go = el('button', 'btn primary', S.ui.icon('vault', 15) + 'Send to Vault');
      foot.append(cancel, go);
      body.appendChild(foot);

      go.onclick = async () => {
        if (f.mode === 'version' && !f.songId) return;
        if (f.mode === 'new' && !f.title.trim()) f.title = S.project.name || 'Untitled';
        if (!S.projectLength()) return S.toast('Nothing to send yet: record or import something first');
        form.classList.add('busy');
        go.disabled = cancel.disabled = true;
        const step = (t) => (foot.querySelector('.vd-info').innerHTML = '<span class="vd-spin"></span>' + esc(t));
        try {
          step('Rendering the mix…');
          const bytes = await S.renderSongWav();
          step('Saving to The Vault…');
          const req = f.mode === 'new' ? { title: f.title.trim(), status: f.status, project: f.project, notes: f.notes, bytes } : { songId: f.songId, note: f.note, status: f.vstatus || null, bytes };
          const res = await host().vaultSend(req);
          if (!res.ok) throw new Error(res.error);
          S.project.vault = { songId: res.song.id, title: res.song.title };
          success(res.song, f.mode === 'version');
        } catch (e) {
          form.classList.remove('busy');
          go.disabled = cancel.disabled = false;
          foot.querySelector('.vd-info').innerHTML = '<span class="vd-err">' + esc(e.message) + '</span>';
        }
      };
    }

    function success(song, isVersion) {
      body.innerHTML =
        '<div class="vd-done"><div class="vd-ok">' +
        S.ui.icon('check', 30) +
        '</div><h3></h3><p></p></div>';
      body.querySelector('h3').textContent = isVersion ? 'New version saved' : 'Sent to The Vault';
      body.querySelector('p').textContent =
        '"' +
        song.title +
        '" is in The Vault' +
        (isVersion ? ' (the previous mix is in its History)' : song.status ? ' under ' + song.status : '') +
        '. If The Vault is already open, switch tabs there to see it. Next time you open Send, this session is linked to the song, so you can save a new version in one click.';
      const foot = el('div', 'vd-foot');
      const reveal = el('button', 'btn ghost', S.ui.icon('folder', 14) + 'Show file');
      reveal.onclick = () => host().vaultReveal();
      const openApp = el('button', 'btn accent', S.ui.icon('vault', 14) + 'Open The Vault');
      openApp.onclick = async () => {
        const r = await host().vaultOpen();
        if (!r.ok) S.toast(r.error);
      };
      if (!st.exe) openApp.disabled = true;
      const done = el('button', 'btn primary', 'Done');
      done.onclick = () => dlg.close();
      foot.append(reveal, el('span', 'pw-sp'), openApp, done);
      body.appendChild(foot);
      host()
        .vaultStatus()
        .then((r) => r.ok && ((st = r), setSub()));
    }

    /* ---------- bring a song in ---------- */
    function openPane() {
      if (!st.songs.length) {
        body.innerHTML = '<p class="vd-empty">No songs in The Vault yet.</p>';
        return;
      }
      const search = el('input', 'txt vd-search');
      search.placeholder = 'Search songs…';
      const list = el('div', 'vd-list');
      body.append(search, list);
      const where = () => {
        const armed = S.project.tracks.find((t) => t.arm);
        return armed ? armed.name : S.project.tracks[0] ? S.project.tracks[0].name : 'a new track';
      };
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        list.innerHTML = '';
        for (const s of st.songs.filter((x) => !q || (x.title + ' ' + x.project).toLowerCase().includes(q))) {
          const row = el('div', 'vd-song');
          row.innerHTML =
            '<div class="vd-s-main"><b></b><small></small></div><span class="vd-chip ' + (s.status === 'Finished' ? 'fin' : '') + '"></span><button class="btn ghost sm">' + S.ui.icon('import', 13) + 'Add to session</button>';
          row.querySelector('b').textContent = s.title;
          row.querySelector('small').textContent = [s.project, 'updated ' + s.updated, s.versions ? s.versions + ' older version' + (s.versions > 1 ? 's' : '') : ''].filter(Boolean).join(' · ');
          row.querySelector('.vd-chip').textContent = s.status;
          const b = row.querySelector('button');
          b.title = 'Adds the song at the playhead on ' + where();
          b.onclick = async () => {
            b.disabled = true;
            b.innerHTML = '<span class="vd-spin"></span>Loading…';
            const r = await host().vaultRead(s.id);
            if (!r.ok) {
              b.disabled = false;
              b.innerHTML = S.ui.icon('import', 13) + 'Add to session';
              return S.toast(r.error);
            }
            await S.importFiles([new File([r.bytes], r.filename)]);
            S.toast('Added "' + r.title + '" from The Vault');
            dlg.close();
          };
          list.appendChild(row);
        }
        if (!list.children.length) list.innerHTML = '<p class="vd-empty">No song matches.</p>';
      };
      search.oninput = draw;
      draw();
      setTimeout(() => search.focus());
    }

    document.body.appendChild(dlg);
    dlg.showModal();
    show(tab);
  };
})();
