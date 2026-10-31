/* Messages — end-to-end encrypted chat, powered by The Vault's engine over a local bridge.
 * Session never touches the keys or crypto: it calls The Vault (running on this computer) which
 * seals/opens every message. If The Vault isn't running, we offer to launch it. */
(function () {
  const S = window.Studio;
  const M = (S.messages = {});
  const host = () => window.studioHost || {};
  const INVITE = (window.__DISCORD__ && window.__DISCORD__.invite) || 'https://discord.gg/HbkNrPAAm';
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const timeStr = (ms) => { try { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); } catch (e) { return ''; } };

  /** Call the Vault bridge. Throws with .offline when The Vault isn't reachable. */
  async function api(method, path, body) {
    if (!host().vaultBridge) { const e = new Error('Messaging needs the desktop app.'); e.offline = true; throw e; }
    const r = await host().vaultBridge(method, path, body);
    if (!r || !r.ok) { const e = new Error((r && r.error) || 'The Vault isn’t running.'); e.offline = /running|older|desktop|offline/i.test(e.message); throw e; }
    return r.data;
  }

  M.init = () => {
    const b = document.getElementById('btn-vault');
    if (b) { b.title = 'Messages: end-to-end encrypted chat with other artists (via The Vault)'; b.onclick = () => M.open(); }
  };

  M.open = async () => {
    const dlg = el('dialog', 'modal msg-dlg');
    dlg.innerHTML =
      '<div class="set-head"><span class="set-ic">' + S.ui.icon('vault', 18) + '</span><h3>Messages</h3>' +
      '<span class="set-ver msg-ver"></span><div class="pw-sp"></div>' +
      '<button class="pw-ib msg-mix" title="Send the current mix to a Vault song">' + S.ui.icon('vault', 14) + '</button>' +
      '<button class="pw-ib msg-x" title="Close">' + S.ui.icon('x', 14) + '</button></div>' +
      '<div class="msg-wrap"><div class="msg-side"></div><div class="msg-main"></div></div>';
    const verEl = dlg.querySelector('.msg-ver');
    const side = dlg.querySelector('.msg-side');
    const main = dlg.querySelector('.msg-main');
    dlg.querySelector('.msg-x').onclick = () => dlg.close();
    dlg.querySelector('.msg-mix').onclick = () => { if (S.vault && S.vault.open) S.vault.open(); };
    let poll = 0, current = null, closed = false;
    dlg.addEventListener('close', () => { closed = true; clearInterval(poll); dlg.remove(); });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(dlg);
    dlg.showModal();

    function offline(msg, needInstall) {
      side.innerHTML = '';
      main.innerHTML = '';
      const box = el('div', 'msg-empty');
      box.innerHTML = '<div class="msg-empty-ic">' + S.ui.icon('vault', 40) + '</div><h4>' + esc(msg) + '</h4>' +
        '<p class="hint">Messages are end-to-end encrypted and run through The Vault on this computer.</p>';
      const row = el('div', 'bg-row');
      if (needInstall) {
        const get = el('button', 'btn primary', 'Get The Vault');
        get.onclick = () => host().openExternal && host().openExternal(INVITE);
        row.appendChild(get);
      } else {
        const open = el('button', 'btn primary', 'Open The Vault');
        open.onclick = async () => { try { await host().vaultOpen(); } catch (e) {} open.textContent = 'Opening… then press Retry'; };
        const retry = el('button', 'btn', 'Retry');
        retry.onclick = () => boot();
        row.append(open, retry);
      }
      box.appendChild(row);
      main.appendChild(box);
    }

    const spinner = (t) => { main.innerHTML = '<div class="msg-empty"><div class="bg-spin"></div><h4>' + esc(t) + '</h4></div>'; };
    const tryStatus = async () => { try { return await api('GET', '/status'); } catch (e) { return null; } };
    async function waitForStatus(ms) { const end = Date.now() + ms; while (Date.now() < end && !closed) { const s = await tryStatus(); if (s) return s; await new Promise((r) => setTimeout(r, 1500)); } return null; }

    async function boot() {
      spinner('Connecting to The Vault…');
      let status = await tryStatus();
      if (!status) {
        // not running — start The Vault hidden in the background, then wait for it
        spinner('Starting The Vault…');
        let notInstalled = false;
        try { if (host().vaultLaunch) { const r = await host().vaultLaunch({ hidden: true }); if (r && r.ok === false) notInstalled = /not installed/i.test(r.error || ''); } } catch (e) {}
        if (notInstalled) return offline('The Vault isn’t installed', true);
        status = await waitForStatus(9000);
      }
      if (!status) return offline('Update The Vault to 4.7 for Messages', false);
      verEl.textContent = status.version ? 'Vault ' + status.version : '';
      if (!status.signedIn) {
        main.innerHTML = '';
        const box = el('div', 'msg-empty');
        box.innerHTML = '<div class="msg-empty-ic">' + S.ui.icon('user', 40) + '</div><h4>Sign in to The Vault</h4><p class="hint">Open The Vault and sign in with Discord, then come back.</p>';
        const open = el('button', 'btn primary', 'Open The Vault'); open.onclick = () => host().vaultOpen && host().vaultOpen();
        const retry = el('button', 'btn', 'Retry'); retry.onclick = () => boot();
        const row = el('div', 'bg-row'); row.append(open, retry); box.appendChild(row); main.appendChild(box);
        return;
      }
      await refresh(true);
      clearInterval(poll);
      poll = setInterval(() => { if (!closed) refresh(false); }, 4000);
    }

    async function refresh(firstTime) {
      let data;
      try { data = await api('GET', '/sync'); } catch (e) { if (e.offline) { clearInterval(poll); offline('Lost connection to The Vault', false); } return; }
      drawSide(data);
      if (current) drawThread(current, true);
      else if (firstTime && data.contacts && data.contacts[0]) select(data.contacts[0].id, data.contacts[0]);
      else if (firstTime) emptyMain();
    }

    function emptyMain() {
      main.innerHTML = '<div class="msg-empty"><div class="msg-empty-ic">' + S.ui.icon('vault', 40) + '</div><h4>Your messages</h4><p class="hint">Add an artist by their Discord username to start an encrypted chat.</p></div>';
    }

    function drawSide(data) {
      side.innerHTML = '';
      // add contact
      const add = el('div', 'msg-add');
      add.innerHTML = '<input class="sel msg-add-in" placeholder="Add by Discord username…" maxlength="40">';
      const addBtn = el('button', 'btn sm', '+'); addBtn.title = 'Send a contact request';
      const inp = add.querySelector('.msg-add-in');
      const doAdd = async () => { const u = inp.value.trim(); if (!u) return; addBtn.disabled = true; try { await api('POST', '/contact/add', { username: u }); inp.value = ''; S.toast('Request sent to ' + u); refresh(false); } catch (e) { S.toast(e.message); } addBtn.disabled = false; };
      addBtn.onclick = doAdd; inp.onkeydown = (e) => { if (e.key === 'Enter') doAdd(); };
      add.appendChild(addBtn);
      side.appendChild(add);
      // incoming requests
      (data.incoming || []).forEach((c) => {
        const r = el('div', 'msg-req');
        r.innerHTML = '<span class="msg-req-n">' + esc(c.displayName || c.username) + '</span>';
        const ok = el('button', 'btn sm', 'Accept'); ok.onclick = async () => { try { await api('POST', '/contact/accept', { peer: c.id }); refresh(false); } catch (e) { S.toast(e.message); } };
        const no = el('button', 'pw-ib sm', S.ui.icon('x', 12)); no.onclick = async () => { try { await api('POST', '/contact/decline', { peer: c.id }); refresh(false); } catch (e) {} };
        r.append(ok, no); side.appendChild(r);
      });
      // contacts
      (data.contacts || []).forEach((c) => {
        const row = el('div', 'msg-contact' + (current === c.id ? ' on' : ''));
        row.innerHTML = '<span class="msg-c-dot"></span><span class="msg-c-n">' + esc(c.displayName || c.username) + '</span>' +
          (c.unread ? '<span class="msg-c-badge">' + c.unread + '</span>' : '');
        row.onclick = () => select(c.id, c);
        side.appendChild(row);
      });
      if (!(data.contacts || []).length && !(data.incoming || []).length) {
        side.appendChild(el('p', 'hint msg-side-empty', 'No contacts yet. Add someone above.'));
      }
    }

    function select(id, c) { current = id; drawThread(id, false, c); }

    async function drawThread(id, keepScroll, c) {
      let data;
      try { data = await api('GET', '/thread?peer=' + encodeURIComponent(id)); } catch (e) { return; }
      const name = (c && (c.displayName || c.username)) || (data.peer && (data.peer.displayName || data.peer.username)) || 'Chat';
      const atBottom = keepScroll ? isAtBottom() : true;
      main.innerHTML =
        '<div class="msg-head"><span class="msg-head-n">' + esc(name) + '</span>' +
        (data.safety ? '<span class="msg-safety" title="Safety code — compare with your contact to be sure">#' + esc(data.safety) + '</span>' : '') + '</div>' +
        '<div class="msg-log"></div>' +
        '<div class="msg-compose">' +
        '<button class="pw-ib msg-attach" title="Send a file (up to 25 MB)">' + S.ui.icon('import', 16) + '</button>' +
        '<button class="pw-ib msg-mixsend" title="Send the current mix (WAV)">' + S.ui.icon('note', 16) + '</button>' +
        '<button class="pw-ib msg-sessend" title="Send this whole session — they can open it in Session">' + S.ui.icon('file', 16) + '</button>' +
        ((S.collab && S.collab.available()) ? '<button class="pw-ib msg-live" title="Start a live session — build together in real time">' + S.ui.icon('headphones', 16) + '</button>' : '') +
        '<input class="msg-in" placeholder="Message…" maxlength="8000"><button class="btn primary msg-send">Send</button></div>';
      const log = main.querySelector('.msg-log');
      (data.messages || []).forEach((m) => {
        const mine = data.me && m.from === data.me;
        const b = el('div', 'msg-b ' + (mine ? 'me' : 'them'));
        let inner = '';
        const liveM = m.text && m.text.match(/\[\[live:([a-z0-9]+)\]\]/i);
        if (liveM) {
          const mine2 = data.me && m.from === data.me;
          inner += '<div class="msg-live-invite">' + S.ui.icon('headphones', 13) +
            '<span>Live session</span>' +
            (mine2 ? '<em>invite sent</em>' : '<button class="msg-joinbtn" data-room="' + esc(liveM[1]) + '">Join</button>') +
            '</div>';
        } else if (m.text) inner += '<div class="msg-t">' + esc(m.text) + '</div>';
        if (m.file) {
          const isProj = /\.pstudio$/i.test(m.file.name || '');
          inner += '<div class="msg-file">' + S.ui.icon(isProj ? 'file' : 'import', 12) + ' ' + esc(m.file.name) +
            '<button class="msg-fbtn" data-mid="' + m.id + '" data-name="' + esc(m.file.name) + '" data-proj="' + (isProj ? '1' : '0') + '">' + (isProj ? 'Open in Session' : 'Save') + '</button></div>';
        }
        if (m.song) inner += '<div class="msg-file">' + S.ui.icon('note', 12) + ' ' + esc(m.song.title || 'Song') + '</div>';
        if (m.verified === false) inner += '<div class="msg-warn">unverified</div>';
        inner += '<span class="msg-time">' + timeStr(m.at) + '</span>';
        b.innerHTML = inner;
        log.appendChild(b);
      });
      const input = main.querySelector('.msg-in');
      const send = main.querySelector('.msg-send');
      const doSend = async () => {
        const text = input.value.trim(); if (!text) return;
        input.value = ''; send.disabled = true;
        try { await api('POST', '/send', { peer: id, text }); await drawThread(id, false, c); }
        catch (e) { S.toast(e.message); input.value = text; }
        send.disabled = false; input.focus();
      };
      send.onclick = doSend; input.onkeydown = (e) => { if (e.key === 'Enter') doSend(); };
      // attachments + send current mix
      // The Vault requires a text message, so every file goes with a short caption.
      const sendBytes = async (name, bytes, caption) => {
        const len = bytes.byteLength || 0;
        if (len > 25 * 1024 * 1024) return S.toast('Files can be up to 25 MB.');
        if (!len) return S.toast('Nothing to send.');
        await api('POST', '/send', { peer: id, text: caption || ('📎 ' + name), file: { name: name, b64: S.b64(bytes) } });
        await drawThread(id, false, c);
      };
      const attach = main.querySelector('.msg-attach');
      attach.onclick = () => {
        const i = document.createElement('input'); i.type = 'file';
        i.onchange = async () => { const f = i.files[0]; if (!f) return; attach.disabled = true; try { await sendBytes(f.name, await f.arrayBuffer()); } catch (e) { S.toast(e.message || 'Could not send that file'); } attach.disabled = false; };
        i.click();
      };
      const mixsend = main.querySelector('.msg-mixsend');
      mixsend.onclick = async () => {
        if (!S.renderMixdown) return;
        mixsend.disabled = true; const prev = mixsend.innerHTML; mixsend.innerHTML = '…';
        try { const wav = await S.renderMixdown(S.project); await sendBytes((S.project.name || 'mix') + '.wav', wav, '🎧 ' + (S.project.name || 'Mix')); }
        catch (e) { S.toast(e.message || 'Nothing to send'); }
        mixsend.disabled = false; mixsend.innerHTML = prev;
      };
      const sessend = main.querySelector('.msg-sessend');
      sessend.onclick = async () => {
        sessend.disabled = true; const prev = sessend.innerHTML; sessend.innerHTML = '…';
        try {
          if (S.native && S.native.syncStates) { try { await S.native.syncStates(); } catch (e) {} }
          const bytes = new TextEncoder().encode(JSON.stringify(S.packProject()));
          await sendBytes((S.project.name || 'session') + '.pstudio', bytes, '📄 ' + (S.project.name || 'Session'));
          S.toast('Session sent — they can Open it in Session.');
        } catch (e) { S.toast(e.message || 'Could not send the session'); }
        sessend.disabled = false; sessend.innerHTML = prev;
      };
      // start a live session: send the project so they have it, host a room, send the invite
      const live = main.querySelector('.msg-live');
      if (live) live.onclick = async () => {
        if (!S.collab || !S.collab.available()) return S.toast('Live collab isn’t available in this build.');
        live.disabled = true; const prev = live.innerHTML; live.innerHTML = '…';
        let hosting = false;
        try {
          if (S.native && S.native.syncStates) { try { await S.native.syncStates(); } catch (e) {} }
          const bytes = new TextEncoder().encode(JSON.stringify(S.packProject()));
          if (!bytes.byteLength) throw new Error('Nothing to send yet.');
          if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('This session is too big to send (25 MB max).');
          const rid = await S.collab.startHosting();
          hosting = true;
          // one message carries both the project and the join invite (Vault needs the text)
          const invite = '🎚️ Live session — open this session, then tap Join. [[live:' + rid + ']]';
          await api('POST', '/send', { peer: id, text: invite, file: { name: (S.project.name || 'session') + '.pstudio', b64: S.b64(bytes) } });
          await drawThread(id, false, c);
        } catch (e) {
          if (hosting) { try { S.collab.leave(); } catch (_) {} }
          S.toast(e.message || 'Could not start a live session');
        }
        live.disabled = false; live.innerHTML = prev;
      };
      // joining a live session from an invite
      log.querySelectorAll('.msg-joinbtn').forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true; const was = btn.textContent; btn.textContent = '…';
          try { await S.collab.join(btn.dataset.room); dlg.close(); }
          catch (e) { S.toast(e.message || 'Could not join'); btn.disabled = false; btn.textContent = was; }
        };
      });
      // receiving: wire Open / Save buttons on file messages
      log.querySelectorAll('.msg-fbtn').forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true; const was = btn.textContent; btn.textContent = '…';
          try {
            const r = await api('POST', '/file', { peer: id, id: Number(btn.dataset.mid) });
            const bytes = S.unb64(r.b64);
            if (btn.dataset.proj === '1') {
              if (!confirm('Open this session? Your current unsaved work will be replaced.')) { btn.disabled = false; btn.textContent = was; return; }
              await S.openProjectText(new TextDecoder().decode(bytes));
              dlg.close();
              return;
            }
            if (host().saveFile) await host().saveFile({ data: bytes, defaultName: btn.dataset.name, binary: true });
          } catch (e) { S.toast(/not found|404|update/i.test(e.message) ? 'Opening files needs the newest Vault.' : (e.message || 'Could not get that file')); }
          btn.disabled = false; btn.textContent = was;
        };
      });
      if (atBottom) log.scrollTop = log.scrollHeight;
      input.focus();
    }
    function isAtBottom() { const l = main.querySelector('.msg-log'); return !l || l.scrollTop + l.clientHeight >= l.scrollHeight - 40; }

    boot();
  };
})();
