/* Soundcheck in Session — the adapter that plugs the Soundcheck friends home (soundcheck.js) into
 * Session's real backend: The Vault's local bridge, the same engine Messages already uses. Every
 * message is sealed/opened by The Vault; Session never touches the keys. Profile fields The Vault
 * doesn't store (status, bio, tags, privacy) are kept on this computer.
 *
 * Exposes S.soundcheck.init() (claims the Vault/Messages button) and S.soundcheck.open(page, opts).
 */
(function () {
  const S = window.Studio;
  const SC = (S.soundcheck = {});
  const host = () => window.studioHost || {};
  const DISCORD = () => window.__DISCORD__ || {};

  const PKEY = 'ps.scProfile';   // local profile fields (status/bio/tags/privacy) — Vault has no store for these
  const SKEY = 'ps.scSettings';  // local notification settings

  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  /** Call the Vault bridge. Throws with .offline set when The Vault isn't reachable. */
  async function bridge(method, path, body) {
    if (!host().vaultBridge) { const e = new Error('Messaging needs the desktop app.'); e.offline = true; throw e; }
    const r = await host().vaultBridge(method, path, body);
    if (!r || !r.ok) { const e = new Error((r && r.error) || 'The Vault isn’t running.'); e.offline = /running|older|desktop|offline|install/i.test(e.message); throw e; }
    return r.data;
  }

  /* ---------------------------------------------------------------- the adapter / store ---- */
  function buildAdapter() {
    const store = {
      ready: false, err: '', booted: false,
      me: null,                 // from /status
      contacts: [], incoming: [], outgoing: [],
      unread: {},               // peerId -> count
      threads: {},              // peerId -> [msg]
      threadAt: {},             // peerId -> last fetch time
    };
    const listeners = new Set();
    const fire = () => listeners.forEach((f) => { try { f(); } catch (e) {} });

    // --- local profile + settings (merged onto what the bridge gives) ---
    const localProfile = () => lsGet(PKEY, { tags: [], discoverable: true, readReceipts: true });
    const settings = () => Object.assign({ dnd: false, popups: true, sounds: true }, lsGet(SKEY, {}));

    // --- map a bridge contact/record to a Soundcheck "card" ---
    function card(c, extra) {
      if (!c) return null;
      return Object.assign({
        id: c.id,
        username: c.username,
        displayName: c.displayName || c.global_name || c.username,
        avatar: c.avatar,                         // only used if it's an https URL
        roles: c.roles || [],
        presence: c.presence || { state: c.online ? 'online' : (c.state || 'offline'), lastSeen: c.lastSeen },
        profile: c.profile || { status: c.status, bio: c.bio, tags: c.tags },
        typing: !!c.typing,
        since: c.since,
      }, extra || {});
    }

    // --- normalize a bridge message to the Soundcheck message shape ---
    function mapMsg(m, meId) {
      const payload = m.payload || (m.text != null ? { text: m.text } : m.file ? { file: m.file } : m.song ? { song: m.song } : { text: '' });
      return { id: m.id, from: m.from, at: m.at, payload: payload, seen: m.seen, event: m.event };
    }

    // --- background sync ---
    let poll = 0, active = null, closed = false;
    async function boot() {
      store.booted = true;
      let status = null;
      try { status = await bridge('GET', '/status'); }
      catch (e) {
        // try to start The Vault quietly, then retry a few times
        try { if (host().vaultLaunch) { const r = await host().vaultLaunch({ hidden: true }); if (r && r.ok === false && /not installed/i.test(r.error || '')) { store.err = 'The Vault isn’t installed — install it to use friends and messages.'; fire(); return; } } } catch (_) {}
        status = await waitForStatus(9000);
      }
      if (!status) { store.err = 'Can’t reach The Vault. Open it and try again.'; fire(); return; }
      if (!status.signedIn) { store.err = 'Open The Vault and sign in with Discord, then come back.'; fire(); return; }
      store.me = status.me || store.me;
      store.err = '';
      await sync();
      store.ready = true;
      fire();
      clearInterval(poll);
      poll = setInterval(() => { if (!closed) tick(); }, 4000);
    }
    async function waitForStatus(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end && !closed) {
        try { return await bridge('GET', '/status'); } catch (e) {}
        await new Promise((r) => setTimeout(r, 1500));
      }
      return null;
    }
    async function sync() {
      let data;
      try { data = await bridge('GET', '/sync'); }
      catch (e) { if (e.offline) { store.ready = false; store.err = 'Lost connection to The Vault.'; } return; }
      store.contacts = (data.contacts || []).map((c) => card(c));
      store.incoming = (data.incoming || []).map((c) => card(c));
      store.outgoing = (data.outgoing || []).map((c) => card(c));
      store.unread = {};
      for (const c of (data.contacts || [])) if (c.unread) store.unread[c.id] = c.unread;
      if (data.me) store.me = data.me;
    }
    async function fetchThread(peer) {
      if (!peer) return;
      try {
        const data = await bridge('GET', '/thread?peer=' + encodeURIComponent(peer));
        const meId = (data.me) || (store.me && store.me.id);
        store.threads[peer] = (data.messages || []).map((m) => mapMsg(m, meId));
        store.threadAt[peer] = Date.now();
        if (data.safety) store.safety = store.safety || {}, store.safety[peer] = data.safety;
        // note: unread is cleared only in markRead() (when the chat is actually opened), never on a
        // background prefetch for a preview — otherwise the list would mark everything read on sight.
      } catch (e) { if (e.offline) { store.ready = false; } }
    }
    async function tick() {
      await sync();
      if (active) await fetchThread(active);
      fire();
    }

    // The UI calls thread() synchronously; prefetch in the background and return cached.
    function ensureThread(peer) {
      if (!peer) return;
      const fresh = store.threadAt[peer] && (Date.now() - store.threadAt[peer] < 3000);
      if (!fresh) fetchThread(peer).then(fire);
    }

    const api = {
      ready: () => store.ready,
      error: () => store.err,
      me() {
        const base = store.me || { id: 'me' };
        const prof = Object.assign({}, base.profile, localProfile());
        return { id: base.id, username: base.username, displayName: base.displayName || base.global_name || base.username, avatar: base.avatar, roles: base.roles || [], presence: { state: prof.appearOffline ? 'offline' : 'session' }, profile: prof };
      },
      contacts: () => store.contacts,
      requests: () => ({ incoming: store.incoming, outgoing: store.outgoing }),
      thread(peer) { ensureThread(peer); return store.threads[peer] || []; },
      unread(peer) { return peer ? (store.unread[peer] || 0) : Object.values(store.unread).reduce((a, b) => a + b, 0); },
      async markRead(peer) {
        active = peer;
        if (store.unread[peer]) delete store.unread[peer];
        try { await bridge('POST', '/read', { peer }); } catch (e) {} // best-effort; Vault also reads on /thread
        await fetchThread(peer); fire();
      },
      nameOf(id) { const c = store.contacts.find((x) => x.id === id); return c ? c.displayName : (id === (store.me && store.me.id) ? 'You' : 'Someone'); },

      async send(peer, text) {
        if (!text || !peer) return;
        await bridge('POST', '/send', { peer, text });
        active = peer; await fetchThread(peer); fire();
      },
      async sendRequest(username) {
        if (!username) throw new Error('Type a Discord username.');
        await bridge('POST', '/contact/add', { username });
        await sync(); fire();
      },
      async answerRequest(id, accept) {
        await bridge('POST', accept ? '/contact/accept' : '/contact/decline', { peer: id });
        await sync(); fire();
      },
      async removeFriend(id) {
        try { await bridge('POST', '/contact/remove', { peer: id }); }
        catch (e) { throw new Error(/not found|404|unknown/i.test(e.message) ? 'Removing friends needs the newest Vault.' : e.message); }
        await sync(); fire();
      },
      async discover(q) {
        try {
          const data = await bridge('GET', '/discover?q=' + encodeURIComponent(q || ''));
          const friends = new Set(store.contacts.map((c) => c.id));
          return (data.users || data.results || data || []).map((u) => Object.assign(card(u), { friends: friends.has(u.id), requested: store.outgoing.some((o) => o.id === u.id) }));
        } catch (e) { return []; } // Discover is optional; empty when the Vault doesn't offer it
      },
      async user(id) {
        try { const u = await bridge('GET', '/user?id=' + encodeURIComponent(id)); return card(u); }
        catch (e) { return store.contacts.find((c) => c.id === id) || {}; }
      },
      async saveProfile(data) {
        const cur = localProfile();
        const next = Object.assign({}, cur, data);
        lsSet(PKEY, next);
        // best-effort push to the Vault if it accepts profiles; ignored if unsupported
        try { await bridge('PUT', '/profile', next); } catch (e) {}
        fire();
      },
      settings,
      setSetting(key, value) { const s = settings(); s[key] = value; lsSet(SKEY, s); fire(); },

      async invite() {
        const url = DISCORD().invite || 'https://discord.gg/HbkNrPAAm';
        return { url };
      },
      onChange(cb) { listeners.add(cb); if (!store.booted) boot(); return () => listeners.delete(cb); },
      toast: (t) => S.toast && S.toast(t),

      // optional hooks (buttons only appear when present)
      safetyCode: (peer) => { const code = store.safety && store.safety[peer]; S.toast && S.toast(code ? 'Safety code: #' + code : 'Open the chat first to see its safety code.'); },
      attachFile(peer) {
        const i = document.createElement('input'); i.type = 'file';
        i.onchange = async () => {
          const f = i.files[0]; if (!f) return;
          if (f.size > 25 * 1024 * 1024) return S.toast && S.toast('Files can be up to 25 MB.');
          try { const bytes = await f.arrayBuffer(); await bridge('POST', '/send', { peer, text: '📎 ' + f.name, file: { name: f.name, b64: S.b64(bytes) } }); active = peer; await fetchThread(peer); fire(); }
          catch (e) { S.toast && S.toast(e.message || 'Could not send that file'); }
        };
        i.click();
      },
      async shareSong(peer) {
        if (!S.renderMixdown) return S.toast && S.toast('Nothing to send yet.');
        try { const wav = await S.renderMixdown(S.project); await bridge('POST', '/send', { peer, text: '🎧 ' + (S.project.name || 'Mix'), file: { name: (S.project.name || 'mix') + '.wav', b64: S.b64(wav) } }); active = peer; await fetchThread(peer); fire(); }
        catch (e) { S.toast && S.toast(e.message || 'Could not send the mix'); }
      },
      async openFile(peer, msg) {
        const name = (msg.payload && msg.payload.file && msg.payload.file.name) || 'file';
        const isProj = /\.(session|pstudio)$/i.test(name);
        try {
          const r = await bridge('POST', '/file', { peer, id: Number(msg.id) });
          const bytes = S.unb64(r.b64);
          if (isProj) { if (confirm('Open this session? Your current unsaved work will be replaced.')) { await S.openProjectText(new TextDecoder().decode(bytes)); SC.close(); } return; }
          if (host().saveFile) await host().saveFile({ data: bytes, defaultName: name, binary: true });
        } catch (e) { S.toast && S.toast(/not found|404|update/i.test(e.message) ? 'Opening files needs the newest Vault.' : (e.message || 'Could not get that file')); }
      },
    };

    api._destroy = () => { closed = true; clearInterval(poll); };
    api._setActive = (p) => { active = p; };
    return api;
  }

  /* ---------------------------------------------------------------- mount / overlay ---------- */
  let overlay = null, instance = null, adapter = null;

  SC.open = (page, opts) => {
    if (!window.Soundcheck) return S.messages && S.messages.open && S.messages.open(); // fallback
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sc-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:400;display:flex;flex-direction:column;background:var(--bg,#0b0c10)';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line,rgba(255,255,255,.08))';
      const back = document.createElement('button');
      back.className = 'btn ghost sm';
      back.innerHTML = (S.ui ? S.ui.icon('x', 14) : '') + ' Back to studio';
      back.onclick = () => SC.close();
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:700;opacity:.85';
      title.textContent = 'Soundcheck';
      bar.append(back, title);
      const mountEl = document.createElement('div');
      mountEl.style.cssText = 'flex:1;min-height:0;display:flex';
      overlay.append(bar, mountEl);
      document.body.appendChild(overlay);
      adapter = buildAdapter();
      instance = window.Soundcheck.mount(mountEl, adapter);
      // Esc closes
      overlay._key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); SC.close(); } };
      window.addEventListener('keydown', overlay._key, true);
    }
    overlay.style.display = 'flex';
    if (instance) { if (page) instance.show(page, opts || {}); else instance.refresh(); }
    try { S.presence && S.presence.update && S.presence.update(); } catch (e) {}
  };

  SC.close = () => {
    if (overlay) overlay.style.display = 'none';
  };

  SC.isOpen = () => !!overlay && overlay.style.display !== 'none';

  // Claim the Vault/Messages button so there's one friends UI (like The Vault). Runs after
  // messages.init(), so this wins. Messages (S.messages) stays available as a fallback.
  SC.init = () => {
    const b = document.getElementById('btn-vault');
    if (b) { b.title = 'Soundcheck — friends, messages and live collabs'; b.onclick = () => SC.open(); }
  };
})();
