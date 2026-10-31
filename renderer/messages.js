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

    async function boot() {
      main.innerHTML = '<div class="msg-empty"><div class="bg-spin"></div><h4>Connecting to The Vault…</h4></div>';
      let status;
      try { status = await api('GET', '/status'); }
      catch (e) {
        if (host().vaultBridgeInfo) { const r = await host().vaultBridgeInfo(); /* info may still be null */ }
        // distinguish not-installed vs not-running isn't exact here; offer to open, with Get fallback
        return offline('The Vault isn’t running', false);
      }
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
        '<div class="msg-compose"><input class="msg-in" placeholder="Message…" maxlength="8000"><button class="btn primary msg-send">Send</button></div>';
      const log = main.querySelector('.msg-log');
      (data.messages || []).forEach((m) => {
        const mine = data.me && m.from === data.me;
        const b = el('div', 'msg-b ' + (mine ? 'me' : 'them'));
        let inner = '';
        if (m.text) inner += '<div class="msg-t">' + esc(m.text) + '</div>';
        if (m.file) inner += '<div class="msg-file">' + S.ui.icon('import', 12) + ' ' + esc(m.file.name) + '</div>';
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
      if (atBottom) log.scrollTop = log.scrollHeight;
      input.focus();
    }
    function isAtBottom() { const l = main.querySelector('.msg-log'); return !l || l.scrollTop + l.clientHeight >= l.scrollHeight - 40; }

    boot();
  };
})();
