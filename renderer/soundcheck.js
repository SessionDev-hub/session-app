/* Soundcheck for Session: the friends home, matching The Vault 5.1.
 *
 *   Soundcheck.mount(containerElement, api)  ->  { show(page, opts), refresh(), destroy() }
 *
 * Pages: "Home" | "Messages" | "Friends" | "Discover" | "Profile".
 *
 * The UI is plain DOM: no framework, no dependencies, and it never touches the network itself. All data comes
 * from `api`, an adapter over Session's existing friends/messages code (the same Connect backend The Vault
 * uses). The full adapter contract is in HANDOFF.md, and mock-api.js is a working example.
 *
 * Text from other people is always set with textContent, never innerHTML.
 */
(function (global) {
  'use strict';

  const PAGES = [['Home', '⌂'], ['Messages', '✉'], ['Friends', '👥'], ['Discover', '◎'], ['Profile', '☺']];
  const PRESENCE = { session: '#8b7bff', vault: '#8b7bff', online: '#34d399', away: '#fbbf24', dnd: '#ff4d5e', offline: '#6b6e7a' };
  const PRESENCE_ORDER = { session: 0, vault: 0, online: 1, away: 2, dnd: 3, offline: 5 };
  const ROLES = { // same order and colors as The Vault's badges
    'Owner': ['★', '#fbbf24'], 'Dev Team': ['◆', '#60a5fa'], 'Head of Support': ['✦', '#f0359a'],
    'Administrator': ['✦', '#ff4938'], 'Moderator': ['✦', '#f9a416'], 'Support Team': ['✦', '#fb923c'],
    'Trial Support': ['✦', '#e9b78e'], 'Beta Tester': ['β', '#34d399'],
  };
  const PROFILE_TAGS = ['Producer', 'Singer', 'Rapper', 'Songwriter', 'Engineer', 'Mixing', 'Mastering', 'Beatmaker',
    'Guitar', 'Keys', 'Open to collabs', 'Looking for vocals', 'Looking for beats'];
  const NOTE_ICONS = { message: '💬', request: '👋', accepted: '🤝', reaction: '✨', group: '👥' };

  // ------------------------------------------------------------------ tiny DOM helper
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const btn = (text, onclick, style = '', title) => h('button', { class: `sk-btn ${style}`, onclick, title, type: 'button' }, text);

  // ------------------------------------------------------------------ people helpers
  const displayName = (c) => (c && ((c.profile || {}).nickname || c.displayName || c.global_name || c.username)) || 'Someone';
  const stateOf = (c) => ((c && c.presence) || {}).state || 'offline';
  function presenceLabel(p) {
    const s = (p || {}).state || 'offline';
    if (s === 'session') return 'In Session';
    if (s === 'vault') return 'In The Vault';
    if (s === 'online') return 'Online' + (p.app ? ` on ${p.app}` : '');
    if (s === 'away') return 'Away';
    if (s === 'dnd') return 'Do not disturb';
    if (p && p.lastSeen) return 'Offline · last seen ' + ago(p.lastSeen);
    return 'Offline';
  }
  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  }
  function topRole(c) {
    const have = new Set((c && c.roles) || []);
    return Object.keys(ROLES).find((r) => have.has(r)) || 'Beta Tester';
  }
  function roleBadge(c) {
    const r = topRole(c);
    const [icon, color] = ROLES[r];
    return h('span', { class: 'sk-role', style: `color:${color};background:${color}22`, text: `${icon} ${r}` });
  }
  function avatar(c, size, group) {
    const name = group ? (c.name || 'Group') : displayName(c);
    const el = h('div', { class: 'sk-av' + (group ? ' group' : ''), style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px` });
    if (!group && c.avatar && /^https:\/\//.test(c.avatar)) el.style.backgroundImage = `url("${c.avatar.replace(/"/g, '')}")`;
    else el.textContent = name.slice(0, 1).toUpperCase();
    if (group && c.color) el.style.background = c.color;
    if (!group) el.append(h('i', { style: `background:${PRESENCE[stateOf(c)] || PRESENCE.offline}` }));
    return el;
  }
  const tags = (list, limit) => (list && list.length ? h('div', { class: 'sk-tags' }, list.slice(0, limit || 99).map((t) => h('span', { class: 'sk-tag', text: t }))) : null);
  function stamp(at) {
    const d = new Date(at);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function preview(api, peer, me, group) {
    const th = (api.thread(peer) || []).filter((m) => !m.event);
    if (!th.length) return { text: group ? `${(group.members || []).length} members` : 'Say hi 👋', last: null };
    const last = th[th.length - 1];
    const p = last.payload || {};
    let text = p.text || (p.file ? '📎 ' + p.file.name : '♫ Shared a song');
    const who = last.from === me ? 'You: ' : (group ? `${api.nameOf ? api.nameOf(last.from) : ''}: ` : '');
    text = (who + text).replace(/\n/g, ' ');
    return { text, last };
  }

  // ------------------------------------------------------------------ the component
  function mount(root, api) {
    const st = { page: 'Home', peer: null, friendsTab: 'Friends', discover: null, discoverQ: '', sigs: {}, filter: '', search: '' };
    root.classList.add('sk');
    root.textContent = '';

    // header
    const head = h('div', { class: 'sk-head' },
      h('div', { class: 'sk-logo', html: null }, meterIcon()),
      h('div', null, h('div', { class: 'sk-title', text: 'Soundcheck' }),
        h('div', { class: 'sk-sub', text: 'Friends, messages and collabs  ·  🔒 end-to-end encrypted' })),
      h('div', { class: 'sk-grow' }),
      api.openNotifications ? btn('🔔', () => api.openNotifications(), '', 'Notifications') : null,
      btn('Invite friends', invite, 'tinted sm'));
    const tabs = h('div', { class: 'sk-tabs' });
    const pages = {};
    for (const [name] of PAGES) pages[name] = h('div', { class: 'sk-page' + (name === 'Messages' ? ' sk-msgs' : '') });
    const card = h('div', { class: 'sk-card' }, head, tabs, Object.values(pages));
    root.append(card);

    // Messages page skeleton (kept between renders so the composer never loses what you're typing)
    const m = {};
    m.filter = h('input', { class: 'sk-input', placeholder: 'Search chats', oninput: (e) => { st.filter = e.target.value; renderConversations(true); } });
    m.list = h('div', { class: 'sk-list' });
    m.head = h('div', { class: 'sk-chat-head' });
    m.thread = h('div', { class: 'sk-thread' });
    m.typing = h('div', { class: 'sk-typing' });
    m.text = h('textarea', { rows: 1, placeholder: 'Message', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }, oninput: () => api.typing && st.peer && api.typing(st.peer) });
    const attach = api.attachFile ? btn('📎', () => st.peer && api.attachFile(st.peer), 'sm', 'Attach a file (up to 25 MB)') : null;
    const song = api.shareSong ? btn('♫', () => st.peer && api.shareSong(st.peer), 'sm', 'Share a song') : null;
    const live = api.startLive ? btn('🎧', () => st.peer && api.startLive(st.peer), 'sm', 'Start a live session — build this track together in real time') : null;
    pages.Messages.append(
      h('div', { class: 'sk-side' },
        h('div', { style: 'display:flex;align-items:center;justify-content:space-between' },
          h('b', { style: 'font-size:16px', text: 'Chats' }), api.newGroup ? btn('＋ Group', () => api.newGroup(), 'tinted sm') : null),
        h('div', { style: 'margin-top:8px' }, m.filter), m.list),
      h('div', { class: 'sk-chat' }, m.head, m.thread, m.typing,
        h('div', { class: 'sk-compose' }, h('div', { class: 'sk-box' }, attach, song, live, m.text), btn('Send', send, 'accent'))));

    // ---------------------------------------------------------------- navigation
    function show(page, opts = {}) {
      if (!PAGES.some(([n]) => n === page)) page = st.page;
      if (opts.peer) st.peer = opts.peer;
      if (opts.friendsTab) st.friendsTab = opts.friendsTab;
      st.page = page;
      for (const [n, el] of Object.entries(pages)) el.classList.toggle('on', n === page);
      st.sigs = {};
      render();
      if (page === 'Messages' && st.peer && api.markRead) api.markRead(st.peer);
    }

    function render() {
      paintTabs();
      ({ Home: renderHome, Messages: renderMessages, Friends: renderFriends, Discover: renderDiscover, Profile: renderProfile })[st.page]();
    }

    // Only rebuild a page when what it shows changed (polls every few seconds shouldn't flicker anything).
    function changed(key, data) {
      const sig = JSON.stringify(data);
      if (st.sigs[key] === sig) return false;
      st.sigs[key] = sig;
      return true;
    }

    function paintTabs() {
      const unread = api.unread() || 0;
      const reqs = (api.requests().incoming || []).length;
      const online = api.contacts().filter((c) => stateOf(c) !== 'offline').length;
      const labels = {
        Home: 'Home', Messages: unread ? `Messages · ${unread}` : 'Messages',
        Friends: reqs ? `Friends · ${reqs} new` : (online ? `Friends  ${online} online` : 'Friends'),
        Discover: 'Discover', Profile: 'Profile',
      };
      if (!changed('tabs', [st.page, labels])) return;
      tabs.textContent = '';
      for (const [name, icon] of PAGES) {
        const hot = (name === 'Messages' && unread) || (name === 'Friends' && reqs);
        tabs.append(btn(`${icon}  ${labels[name]}`, () => show(name), name === st.page ? 'accent' : (hot ? 'tinted' : '')));
      }
    }

    // ---------------------------------------------------------------- Home
    function renderHome() {
      const me = api.me() || {};
      const prof = me.profile || {};
      const contacts = api.contacts();
      const online = contacts.filter((c) => stateOf(c) !== 'offline')
        .sort((a, b) => (PRESENCE_ORDER[stateOf(a)] ?? 5) - (PRESENCE_ORDER[stateOf(b)] ?? 5) || displayName(a).localeCompare(displayName(b)));
      const { incoming } = api.requests();
      const chats = chatPeers().filter((p) => (api.thread(p.id) || []).length).slice(0, 5);
      const notes = (api.notifications ? api.notifications() : []).slice(0, 4);
      const ready = api.ready ? api.ready() : true;
      if (!changed('home', [me, ready, api.error && api.error(), online.map((c) => [c.id, c.presence, c.profile && c.profile.status, c.typing]),
        incoming.map((r) => r.id), chats.map((p) => [p.id, (preview(api, p.id, me.id, p.group).last || {}).id, api.unread(p.id)]),
        notes.map((n) => [n.at, n.read]), contacts.length])) return;
      const el = pages.Home;
      el.textContent = '';
      const name = prof.nickname || me.displayName || me.username || 'there';
      const hr = new Date().getHours();
      el.append(h('div', { class: 'sk-hero' }, avatar(me, 58),
        h('div', { style: 'flex:1;min-width:0' },
          h('h2', { text: `${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, ${name}` }),
          h('div', { class: prof.status ? '' : 'sk-muted', text: prof.status || (prof.appearOffline ? 'Appearing offline' : "Set a status so friends know what you're working on") })),
        btn('Edit profile', editProfile, 'normal sm')));
      if (!ready) { el.append(h('div', { class: api.error && api.error() ? 'sk-error' : 'sk-empty', text: (api.error && api.error()) || 'Connecting securely…' })); return; }
      const unread = api.unread() || 0;
      const tile = (n, label, go) => h('div', { class: 'sk-stat', onclick: go }, h('b', { class: n ? 'hot' : '', text: String(n) }), h('span', { class: 'sk-muted', text: label }));
      el.append(h('div', { class: 'sk-stats' },
        tile(online.length, 'friends online', () => show('Friends', { friendsTab: 'Friends' })),
        tile(unread, 'unread messages', () => show('Messages')),
        tile(incoming.length, 'friend requests', () => show('Friends', { friendsTab: 'Requests' }))));
      if (incoming.length) {
        el.append(section(`FRIEND REQUESTS — ${incoming.length}`));
        for (const r of incoming.slice(0, 3)) el.append(personRow(r, [['Accept', () => api.answerRequest(r.id, true), 'accent sm'], ['Decline', () => api.answerRequest(r.id, false), 'sm']]));
      }
      const left = h('div', null, section('RECENT CHATS', 'All messages →', () => show('Messages')));
      if (!chats.length) left.append(h('div', { class: 'sk-empty', text: 'No chats yet. Message a friend to get started.' }));
      for (const p of chats) {
        const n = api.unread(p.id);
        const pv = preview(api, p.id, me.id, p.group);
        left.append(miniRow(p.group ? avatar(p.group, 34, true) : avatar(p.card, 34), p.name, pv.text, n, () => show('Messages', { peer: p.id })));
      }
      const right = h('div', null, section(`ONLINE NOW — ${online.length}`, 'All friends →', () => show('Friends', { friendsTab: 'Friends' })));
      if (!online.length) right.append(h('div', { class: 'sk-empty', text: contacts.length ? "Nobody's online right now." : 'No friends yet — find people in Discover or invite your collaborators.' }));
      for (const c of online.slice(0, 6)) {
        const status = (c.profile || {}).status;
        right.append(miniRow(avatar(c, 34), displayName(c), c.typing ? 'typing…' : (status || presenceLabel(c.presence)), 0,
          () => openProfile(c.id), btn('Message', (e) => { e.stopPropagation(); show('Messages', { peer: c.id }); }, 'normal sm')));
      }
      el.append(h('div', { class: 'sk-cols' }, left, right));
      el.append(h('div', { class: 'sk-cta' }, h('div', { style: 'flex:1' },
        h('b', { style: 'font-size:14px', text: '◎  Find your next collab' }),
        h('div', { class: 'sk-muted', text: 'Search Beta Testers by name or tag — Producer, Singer, Engineer, Open to collabs…' + (prof.discoverable ? '' : "  (You're not listed yet — turn it on in Edit profile.)") })),
        btn('Open Discover', () => show('Discover'), 'accent sm')));
      if (notes.length) {
        el.append(section('LATEST', api.openNotifications ? 'All notifications →' : null, api.openNotifications));
        for (const n of notes) {
          el.append(h('div', { class: 'sk-note' + (n.read ? '' : ' unread'), onclick: () => openNote(n) },
            h('span', { text: NOTE_ICONS[n.kind] || '🔔' }), h('span', { class: 'sk-mid', style: 'flex:1', text: n.text }),
            h('span', { class: 'sk-muted', style: 'font-size:10px', text: stamp(n.at) })));
        }
      }
    }

    // ---------------------------------------------------------------- Messages
    function chatPeers() {
      const out = api.contacts().map((c) => ({ id: c.id, name: displayName(c), card: c }))
        .concat((api.groups ? api.groups() : []).map((g) => ({ id: g.id, name: g.name || 'Group', group: g })));
      const lastAt = (p) => { const t = api.thread(p.id) || []; return t.length ? t[t.length - 1].at : ((p.group || p.card || {}).createdAt || (p.card || {}).since || 0); };
      return out.sort((a, b) => lastAt(b) - lastAt(a));
    }

    function renderMessages() { renderConversations(); renderChat(); }

    function renderConversations(force) {
      const me = (api.me() || {}).id;
      const peers = chatPeers();
      if (!st.peer && peers.length) st.peer = peers[0].id;
      if (!force && !changed('convs', [st.peer, st.filter, peers.map((p) => [p.id, p.name, stateOf(p.card), p.card && p.card.typing, (preview(api, p.id, me, p.group).last || {}).id, api.unread(p.id)])])) return;
      if (force) st.sigs.convs = null;
      m.list.textContent = '';
      const q = st.filter.trim().toLowerCase();
      for (const p of peers) {
        if (q && !(p.name + ' ' + ((p.card || {}).username || '')).toLowerCase().includes(q)) continue;
        const n = api.unread(p.id);
        const pv = preview(api, p.id, me, p.group);
        const typing = p.card && p.card.typing;
        const row = miniRow(p.group ? avatar(p.group, 38, true) : avatar(p.card, 38), p.name, typing ? 'typing…' : (pv.last ? pv.text : (p.group ? pv.text : presenceLabel(p.card.presence))), n,
          () => { st.peer = p.id; st.sigs = {}; renderMessages(); if (api.markRead) api.markRead(p.id); }, pv.last ? h('span', { class: 'sk-muted', style: 'font-size:10px', text: stamp(pv.last.at) }) : null);
        if (p.id === st.peer) row.classList.add('sel');
        m.list.append(row);
      }
      if (!api.contacts().length) {
        m.list.append(h('div', { class: 'sk-empty', text: 'No friends yet. Find Beta Testers in Discover or add someone by their Discord username.' }),
          btn('Find friends', () => show('Discover'), 'accent sm'));
      }
    }

    function renderChat() {
      const me = (api.me() || {}).id;
      const contact = api.contacts().find((c) => c.id === st.peer);
      const group = (api.groups ? api.groups() : []).find((g) => g.id === st.peer);
      const thread = st.peer ? (api.thread(st.peer) || []) : [];
      if (!changed('chat', [st.peer, contact && [contact.presence, contact.typing], group && group.members, thread.map((x) => [x.id, x.reactions, x.seen])])) return;
      m.head.textContent = '';
      m.thread.textContent = '';
      if (!contact && !group) {
        m.head.append(h('div', { class: 'sk-muted', text: 'Pick a chat on the left.' }));
        m.typing.textContent = '';
        return;
      }
      const who = group || contact;
      m.head.append(...[group ? avatar(group, 40, true) : avatar(contact, 40),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'sk-name', style: 'font-size:16px' }, h('span', { text: group ? group.name : displayName(contact) }), contact ? roleBadge(contact) : null),
          h('div', { class: 'sk-line', text: group ? `${(group.members || []).length} members` : [presenceLabel(contact.presence), (contact.profile || {}).status].filter(Boolean).join('  ·  ') })),
        contact ? btn('Profile', () => openProfile(contact.id), 'xs') : null,
        contact && api.safetyCode ? btn('Safety code', () => api.safetyCode(contact.id), 'xs') : null,
        group && api.groupInfo ? btn('Group info', () => api.groupInfo(group.id), 'xs') : null].filter(Boolean));
      let day = '';
      for (const msg of thread) {
        const d = new Date(msg.at).toDateString();
        if (d !== day) { day = d; m.thread.append(h('div', { class: 'sk-day', text: new Date(msg.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) })); }
        if (msg.event) { m.thread.append(h('div', { class: 'sk-day', text: msg.event })); continue; }
        const mine = msg.from === me;
        const p = msg.payload || {};
        const time = new Date(msg.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (mine && msg.seen ? '  · Seen' : '');
        // Live-session invite ( [[live:room:key]] embedded in the text ): show a Join button.
        const liveM = p.text && p.text.match(/\[\[live:([a-z0-9]+)(?::([a-z0-9]+))?\]\]/i);
        if (liveM) {
          const invite = h('div', { class: 'sk-bubble' + (mine ? ' mine' : '') },
            group && !mine ? h('div', { class: 'sk-who', text: api.nameOf ? api.nameOf(msg.from) : '' }) : null,
            h('div', { style: 'font-weight:700', text: '🎚️ Live session' }),
            mine ? h('div', { class: 'sk-muted', style: 'font-size:11px', text: 'invite sent' })
              : (api.joinLive ? btn('Join', () => api.joinLive(liveM[1], liveM[2] || ''), 'accent sm')
                : h('div', { class: 'sk-muted', style: 'font-size:11px', text: 'Open in Session to join' })),
            h('div', { class: 'sk-time', text: time }));
          m.thread.append(invite);
          continue;
        }
        const body = p.text || (p.file ? `📎 ${p.file.name}` : '♫ ' + ((p.song || {}).title || 'Shared a song'));
        const bubble = h('div', { class: 'sk-bubble' + (mine ? ' mine' : '') },
          group && !mine ? h('div', { class: 'sk-who', text: api.nameOf ? api.nameOf(msg.from) : '' }) : null,
          h('div', { text: body }),
          h('div', { class: 'sk-time', text: time }));
        if (p.file && api.openFile) bubble.addEventListener('click', () => api.openFile(st.peer, msg));
        m.thread.append(bubble);
      }
      m.typing.textContent = contact && contact.typing ? `${displayName(contact)} is typing…` : '';
      requestAnimationFrame(() => { m.thread.scrollTop = m.thread.scrollHeight; });
    }

    async function send() {
      const text = m.text.value.trim();
      if (!text || !st.peer) return;
      m.text.value = '';
      try { await api.send(st.peer, text); } catch (e) { flash(e.message || String(e)); m.text.value = text; }
      st.sigs = {};
      render();
    }

    // ---------------------------------------------------------------- Friends + Discover
    function renderFriends() {
      const contacts = api.contacts();
      const { incoming, outgoing } = api.requests();
      if (!changed('friends', [st.friendsTab, st.search, contacts.map((c) => [c.id, c.presence, c.profile, c.typing, api.unread(c.id)]), incoming.map((r) => r.id), outgoing.map((r) => r.id)])) return;
      const el = pages.Friends;
      const keepFocus = document.activeElement && document.activeElement.dataset.sk === 'fsearch';
      el.textContent = '';
      const online = contacts.filter((c) => stateOf(c) !== 'offline').length;
      el.append(h('div', { style: 'display:flex;gap:4px' },
        btn(contacts.length ? `All friends  ${online}/${contacts.length} online` : 'All friends', () => { st.friendsTab = 'Friends'; st.sigs = {}; renderFriends(); }, st.friendsTab === 'Friends' ? 'tinted sm' : 'sm'),
        btn(incoming.length ? `Requests · ${incoming.length}` : 'Requests', () => { st.friendsTab = 'Requests'; st.sigs = {}; renderFriends(); }, st.friendsTab === 'Requests' ? 'tinted sm' : 'sm')));
      if (st.friendsTab === 'Requests') {
        const name = h('input', { class: 'sk-input', placeholder: 'Discord username', onkeydown: (e) => e.key === 'Enter' && add() });
        const add = async () => { const v = name.value.trim(); if (!v) return; try { await api.sendRequest(v); name.value = ''; flash(`Friend request sent to ${v}.`); } catch (e) { flash(e.message || String(e)); } };
        el.append(h('div', { class: 'sk-tools' }, h('b', { text: 'Add by Discord username' }), name, btn('Send request', add, 'accent sm')));
        if (incoming.length) {
          el.append(section(`RECEIVED — ${incoming.length}`));
          for (const r of incoming) el.append(personRow(r, [['Accept', () => api.answerRequest(r.id, true), 'accent sm'], ['Decline', () => api.answerRequest(r.id, false), 'sm']], ((r.profile || {}).bio || '').slice(0, 140)));
        }
        if (outgoing.length) {
          el.append(section(`SENT — ${outgoing.length}`));
          for (const r of outgoing) el.append(personRow(r, [['Cancel', () => api.answerRequest(r.id, false), 'sm']]));
        }
        if (!incoming.length && !outgoing.length) el.append(h('div', { class: 'sk-empty', text: 'No pending requests.' }));
        return;
      }
      const search = h('input', { class: 'sk-input', placeholder: 'Search friends, names or tags', value: st.search, 'data-sk': 'fsearch', oninput: (e) => { st.search = e.target.value; renderFriends(); } });
      el.append(h('div', { class: 'sk-tools' }, search));
      if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
      if (!contacts.length) { el.append(h('div', { class: 'sk-empty', text: 'No friends yet. Find people in Discover, add someone by their Discord username in Requests, or invite a friend to the beta.' })); return; }
      const q = st.search.trim().toLowerCase();
      const people = contacts.filter((c) => !q || (displayName(c) + ' ' + (c.username || '') + ' ' + ((c.profile || {}).tags || []).join(' ')).toLowerCase().includes(q))
        .sort((a, b) => (PRESENCE_ORDER[stateOf(a)] ?? 5) - (PRESENCE_ORDER[stateOf(b)] ?? 5) || displayName(a).localeCompare(displayName(b)));
      for (const [title, list] of [['ONLINE', people.filter((c) => stateOf(c) !== 'offline')], ['OFFLINE', people.filter((c) => stateOf(c) === 'offline')]]) {
        if (!list.length) continue;
        el.append(section(`${title} — ${list.length}`));
        for (const c of list) {
          const n = api.unread(c.id);
          el.append(personRow(c, [[n ? `Message · ${n}` : 'Message', () => show('Messages', { peer: c.id }), n ? 'accent sm' : 'normal sm'], ['Profile', () => openProfile(c.id), 'sm']]));
        }
      }
    }

    function renderDiscover() {
      const prof = (api.me() || {}).profile || {};
      const { outgoing } = api.requests();
      if (st.discover === null) runDiscover('');
      if (!changed('discover', [st.discover, st.discoverQ, prof.discoverable, outgoing.map((r) => r.id), api.contacts().map((c) => c.id)])) return;
      const el = pages.Discover;
      el.textContent = '';
      el.append(h('div', { style: 'display:flex;align-items:baseline;gap:10px' }, h('b', { style: 'font-size:16px', text: 'Discover Beta Testers' }),
        h('span', { class: 'sk-muted', text: 'Find producers, singers and engineers to collab with' })));
      const q = h('input', { class: 'sk-input', placeholder: 'Names or tags, like Producer', value: st.discoverQ, onkeydown: (e) => e.key === 'Enter' && runDiscover(q.value) });
      el.append(h('div', { class: 'sk-tools' }, q, btn('Search', () => runDiscover(q.value), 'normal sm')));
      if (!prof.discoverable) {
        el.append(h('div', { class: 'sk-hero', style: 'padding:10px 14px;margin:8px 0' },
          h('span', { style: 'flex:1', text: "You're not listed in Discover. Turn it on in your profile so other Beta Testers can find you." }), btn('Edit profile', editProfile, 'normal sm')));
      }
      if (st.discover === null) { el.append(h('div', { class: 'sk-empty', text: 'Loading…' })); return; }
      if (!st.discover.length) el.append(h('div', { class: 'sk-empty', text: 'Nobody found. Try another tag — or invite your collaborators!' }));
      const friends = new Set(api.contacts().map((c) => c.id));
      for (const u of st.discover) {
        let b;
        if (u.friends || friends.has(u.id)) b = [['Message', () => show('Messages', { peer: u.id }), 'normal sm']];
        else if (u.requested || outgoing.some((r) => r.id === u.id)) b = [['Requested', () => {}, 'sm']];
        else b = [['Add friend', async () => { try { await api.sendRequest(u.username); u.requested = true; st.sigs = {}; render(); } catch (e) { flash(e.message || String(e)); } }, 'accent sm']];
        el.append(personRow(u, b, ((u.profile || {}).bio || '').slice(0, 140)));
      }
    }

    async function runDiscover(q) {
      st.discoverQ = q || '';
      try { st.discover = await api.discover(st.discoverQ.trim()); } catch (e) { st.discover = []; flash(e.message || String(e)); }
      if (st.page === 'Discover') renderDiscover();
    }

    // ---------------------------------------------------------------- Profile
    function renderProfile() {
      const me = api.me() || {};
      const prof = me.profile || {};
      const s = api.settings ? api.settings() : {};
      if (!changed('profile', [me, s])) return;
      const el = pages.Profile;
      el.textContent = '';
      const presence = prof.appearOffline ? { state: 'offline' } : (me.presence || { state: 'session' });
      el.append(h('div', { class: 'sk-profile-big' },
        h('div', { class: 'sk-top' }, avatar({ ...me, presence }, 84),
          h('div', { style: 'flex:1' }, h('h2', { text: displayName(me) }), me.username ? h('div', { class: 'sk-muted', text: '@' + me.username }) : null,
            h('div', { style: 'margin:6px 0 4px' }, roleBadge(me)),
            h('div', { style: `color:${PRESENCE[presence.state] || PRESENCE.offline}`, text: '● ' + (prof.appearOffline ? 'Appearing offline' : presenceLabel(presence)) })),
          btn('Edit profile', editProfile, 'accent sm')),
        prof.status ? h('div', { class: 'sk-quote', text: `“${prof.status}”` }) : null,
        tags(prof.tags),
        h('div', { class: 'sk-section', text: 'ABOUT' }),
        h('div', { class: prof.bio ? '' : 'sk-muted', text: prof.bio || 'No bio yet — tell people what you make.' })),
      h('div', { class: 'sk-muted', style: 'margin-top:6px;font-size:11px', text: 'This is the card other Beta Testers see when they open your profile.' }));
      el.append(section('PRIVACY'));
      for (const [label, on] of [['Listed in Discover', !!prof.discoverable], ['Appear offline', !!prof.appearOffline], ['Read receipts', prof.readReceipts !== false]]) {
        el.append(h('div', { class: 'sk-setting' }, h('div', { class: 'sk-mid', text: label }), h('b', { style: `color:${on ? 'var(--ok,#34d399)' : 'var(--dim)'}`, text: on ? 'On' : 'Off' })));
      }
      el.append(h('div', { class: 'sk-muted', style: 'font-size:11px', text: 'Change these in Edit profile.' }));
      if (api.setSetting) {
        el.append(section('NOTIFICATIONS'));
        for (const [key, label, sub, def] of [['dnd', 'Do not disturb', 'No pop-ups or sounds. Messages still arrive.', false],
          ['popups', 'Pop-ups', 'A notice in Session for new messages and requests.', true],
          ['sounds', 'Sounds', 'Sounds for messages, requests and reactions.', true]]) {
          const on = s[key] ?? def;
          el.append(h('div', { class: 'sk-setting' }, h('div', { class: 'sk-mid' }, h('div', { text: label }), h('div', { class: 'sk-muted', style: 'font-size:11px', text: sub })),
            h('div', { class: 'sk-toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), onclick: () => { api.setSetting(key, !on); st.sigs = {}; render(); } })));
        }
      }
    }

    function editProfile() {
      const me = api.me() || {};
      const prof = { ...(me.profile || {}) };
      const chosen = [...(prof.tags || [])];
      const field = (label, value, hint, max) => { const i = h('input', { class: 'sk-input', value: value || '', maxlength: max }); return [h('label', { text: label }), hint ? h('div', { class: 'sk-muted', style: 'font-size:11px', text: hint }) : null, i]; };
      const [l1, h1, nick] = field('Nickname', prof.nickname, 'What people see instead of your Discord name.', 32);
      const [l2, h2, status] = field('Status', prof.status, 'e.g. “Mixing the Night Tape EP” or “Open to collabs 🎤”', 80);
      const bio = h('textarea', { class: 'sk-input', maxlength: 300 });
      bio.value = prof.bio || '';
      const chips = h('div');
      const drawChips = () => {
        chips.textContent = '';
        for (const t of [...new Set([...PROFILE_TAGS, ...chosen])]) {
          chips.append(h('span', { class: 'sk-chip' + (chosen.includes(t) ? ' on' : ''), text: (chosen.includes(t) ? '✓ ' : '') + t,
            onclick: () => { const i = chosen.indexOf(t); if (i >= 0) chosen.splice(i, 1); else if (chosen.length < 8) chosen.push(t); else flash('Up to 8 tags'); drawChips(); } }));
        }
      };
      drawChips();
      const toggles = {};
      const toggleRow = (key, label, sub, def) => {
        let on = prof[key] ?? def;
        const t = h('div', { class: 'sk-toggle' + (on ? ' on' : ''), onclick: () => { on = !on; t.classList.toggle('on', on); toggles[key] = on; } });
        toggles[key] = on;
        return h('div', { class: 'sk-setting' }, h('div', { class: 'sk-mid' }, h('div', { text: label }), h('div', { class: 'sk-muted', style: 'font-size:11px', text: sub })), t);
      };
      const modal = h('div', { class: 'sk-modal', onclick: (e) => e.target === modal && modal.remove() });
      const save = async () => {
        const data = { nickname: nick.value.trim(), status: status.value.trim(), bio: bio.value.trim().slice(0, 300), tags: chosen, ...toggles };
        try { await api.saveProfile(data); modal.remove(); flash('Profile saved ✓'); st.sigs = {}; render(); } catch (e) { flash(e.message || String(e)); }
      };
      modal.append(h('div', { class: 'sk-dialog' },
        h('h3', { text: 'Your profile' }),
        h('div', { class: 'sk-muted', text: "Other Beta Testers see this on your profile card. It isn't encrypted, so keep private things for messages." }),
        l1, h1, nick, l2, h2, status, h('label', { text: 'Bio' }), bio,
        h('label', { text: 'Tags' }), h('div', { class: 'sk-muted', style: 'font-size:11px;margin-bottom:6px', text: 'Pick up to 8 — people can find you by these in Discover.' }), chips,
        toggleRow('discoverable', 'Show me in Discover', 'Beta Testers can find your profile and send you a friend request.', false),
        toggleRow('appearOffline', 'Appear offline', 'Friends always see you as offline.', false),
        toggleRow('readReceipts', 'Read receipts', 'Friends see “Seen” when you’ve read their messages (you see theirs too).', true),
        h('div', { class: 'sk-foot' }, btn('Cancel', () => modal.remove()), btn('Save', save, 'accent'))));
      document.body.append(modal);
      nick.focus();
    }

    // ---------------------------------------------------------------- shared bits
    function section(title, action, onclick) {
      return h('div', { class: 'sk-section' }, h('span', { text: title }), action && onclick ? btn(action, onclick, 'xs') : null);
    }
    function miniRow(av, title, sub, unread, onclick, right) {
      return h('div', { class: 'sk-row', onclick }, av,
        h('div', { class: 'sk-mid' }, h('div', { class: 'sk-name', text: title }), h('div', { class: 'sk-line' + (unread ? ' strong' : ''), text: sub })),
        unread ? h('span', { class: 'sk-badge', text: String(unread) }) : null, right || null);
    }
    function personRow(c, buttons, extra) {
      const prof = c.profile || {};
      const line = c.typing ? 'typing…' : (prof.status || presenceLabel(c.presence));
      return h('div', { class: 'sk-row', style: 'cursor:default' },
        h('div', { style: 'cursor:pointer', onclick: () => openProfile(c.id) }, avatar(c, 44)),
        h('div', { class: 'sk-mid' },
          h('div', { class: 'sk-name' }, h('span', { style: 'cursor:pointer', onclick: () => openProfile(c.id), text: displayName(c) }),
            c.username ? h('span', { class: 'sk-handle', text: '@' + c.username }) : null, roleBadge(c)),
          h('div', { class: 'sk-line', style: prof.status && !c.typing ? 'color:var(--text)' : `color:${PRESENCE[stateOf(c)]}`, text: line }),
          tags(prof.tags, 4), extra ? h('div', { class: 'sk-muted', style: 'font-size:11px;margin-top:4px', text: extra }) : null),
        h('div', { class: 'sk-actions' }, buttons.map(([t, fn, style]) => btn(t, fn, style))));
    }
    async function openProfile(id) {
      const known = api.contacts().find((c) => c.id === id) || [...api.requests().incoming, ...api.requests().outgoing].find((r) => r.id === id);
      let card = known;
      try { card = { ...(known || {}), ...(await api.user(id)) }; } catch (e) { if (!known) { flash(e.message || String(e)); return; } }
      const prof = card.profile || {};
      const isFriend = api.contacts().some((c) => c.id === id);
      const incoming = api.requests().incoming.some((r) => r.id === id);
      const modal = h('div', { class: 'sk-modal', onclick: (e) => e.target === modal && modal.remove() });
      const close = () => modal.remove();
      const actions = isFriend
        ? [btn('Message', () => { close(); show('Messages', { peer: id }); }, 'accent sm'), api.safetyCode ? btn('Safety code', () => api.safetyCode(id), 'sm') : null,
          h('span', { style: 'flex:1' }), btn('Remove friend', async () => { if (confirm(`Remove ${displayName(card)} as a friend?`)) { close(); await api.removeFriend(id); } }, 'danger sm')]
        : incoming ? [btn('Accept', () => { close(); api.answerRequest(id, true); }, 'accent sm'), btn('Decline', () => { close(); api.answerRequest(id, false); }, 'sm')]
          : [btn('Add friend', async () => { close(); try { await api.sendRequest(card.username); flash('Friend request sent.'); } catch (e) { flash(e.message || String(e)); } }, 'accent sm')];
      modal.append(h('div', { class: 'sk-dialog', style: 'width:min(440px,92vw)' },
        h('div', { class: 'sk-top', style: 'display:flex;gap:14px' }, avatar(card, 64),
          h('div', null, h('h3', { text: displayName(card) }), card.username ? h('div', { class: 'sk-muted', text: '@' + card.username }) : null,
            h('div', { style: 'margin:4px 0' }, roleBadge(card)), h('div', { style: `color:${PRESENCE[stateOf(card)]}`, text: '● ' + presenceLabel(card.presence) }))),
        prof.status ? h('div', { class: 'sk-quote', text: `“${prof.status}”` }) : null, tags(prof.tags),
        h('div', { class: 'sk-section', text: 'ABOUT' }), h('div', { class: prof.bio ? '' : 'sk-muted', text: prof.bio || 'No bio yet.' }),
        card.since ? h('div', { class: 'sk-muted', style: 'margin-top:10px;font-size:11px', text: 'Friends since ' + new Date(card.since).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) }) : null,
        h('div', { class: 'sk-foot', style: 'justify-content:flex-start' }, actions)));
      document.body.append(modal);
    }
    function openNote(n) {
      if (api.markNoteRead) api.markNoteRead(n);
      if (n.kind === 'request') show('Friends', { friendsTab: 'Requests' });
      else if (n.peer) show('Messages', { peer: n.peer });
      else show('Friends');
    }
    async function invite() {
      try {
        const res = await api.invite();
        await navigator.clipboard.writeText(res.url);
        flash(`Invite link copied: ${res.url}`);
      } catch (e) { flash(e.message || String(e)); }
    }
    function flash(text) { if (api.toast) api.toast(text); else console.log('[soundcheck]', text); }
    function meterIcon() {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('viewBox', '0 0 22 22');
      [8, 14, 20, 12, 6].forEach((hgt, k) => {
        const l = document.createElementNS(ns, 'line');
        const x = 3 + k * 4;
        l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', 11 - hgt / 2); l.setAttribute('y2', 11 + hgt / 2);
        l.setAttribute('stroke', 'var(--accent, #8b7bff)'); l.setAttribute('stroke-width', '2.2'); l.setAttribute('stroke-linecap', 'round');
        svg.append(l);
      });
      return svg;
    }

    const off = api.onChange ? api.onChange(() => render()) : null;
    show('Home');
    return { show, refresh: render, destroy() { if (typeof off === 'function') off(); root.textContent = ''; root.classList.remove('sk'); } };
  }

  global.Soundcheck = { mount, PAGES: PAGES.map(([n]) => n) };
})(typeof window !== 'undefined' ? window : globalThis);
