/* Live collab — real-time sessions over Apinator (Pusher-compatible presence channels).
 *
 * How it fits together:
 *   - Everyone in a room joins the presence channel  presence-sess-<roomId>.
 *   - Joining is signed by our tiny auth service (fly.dev) using the user's Discord
 *     token — the Apinator SECRET never touches the app. Config is window.__APINATOR__.
 *   - The project itself (with audio) travels over Vault Messages as a .pstudio file —
 *     NOT over the realtime channel. The channel carries only small control events:
 *     transport (play/stop/seek) now, and edits in a later milestone.
 *   - Presence tells everyone who's in the room.
 *
 * M1 scope: join from a Vault message, see who's here, shared transport (play/stop/seek). */
(function () {
  const S = window.Studio;
  const C = (S.collab = {});
  const cfg = () => window.__APINATOR__ || {};

  let client = null, channel = null, room = null, host = false;
  let connected = false, applying = false;
  let members = [];
  const listeners = new Set();

  C.available = () => !!window.Apinator && !!cfg().appKey;
  C.active = () => connected && !!room;
  C.roomId = () => room;
  C.isHost = () => host;
  C.members = () => members.slice();
  C.onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { listeners.forEach((fn) => { try { fn(); } catch (e) {} }); if (S.collabBar) S.collabBar.render(); };

  function randomId() {
    try { const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
    catch (e) { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
  }

  async function ensureClient() {
    if (!window.Apinator) throw new Error('Live collab isn’t available in this build.');
    const c = cfg();
    if (!c.appKey || !c.authEndpoint) throw new Error('Live collab isn’t configured yet.');
    const token = S.gate && S.gate.getToken ? await S.gate.getToken() : (S.auth && S.auth.token);
    if (!token) throw new Error('Sign in with Discord first.');
    if (client) return client;
    client = new window.Apinator({
      cluster: c.cluster || 'us',
      appKey: c.appKey,
      authEndpoint: c.authEndpoint,
      authHeaders: { Authorization: 'Bearer ' + token },
      authEncoding: 'json',
    });
    client.connect();
    return client;
  }

  function joinChannel(rid) {
    room = rid;
    const name = 'presence-sess-' + rid;
    channel = client.subscribe(name);
    channel.bind('realtime:subscription_succeeded', () => {
      connected = true; refreshMembers();
      // ask the host to sync the newcomer to the current transport state
      if (!host) { try { channel.trigger('client-hello', { at: Date.now() }); } catch (e) {} }
      S.toast && S.toast(host ? 'Live session started — invite sent.' : 'Joined the live session.');
      emit();
    });
    channel.bind('realtime:subscription_error', (data) => {
      let detail = '';
      try {
        if (data && (data.error || data.status)) detail = (data.status ? '[' + data.status + '] ' : '') + (data.error || '');
        else if (typeof data === 'string') detail = data;
        else if (data) detail = JSON.stringify(data).slice(0, 160);
      } catch (e) {}
      try { console.error('[collab] subscription_error:', data); } catch (e) {}
      S.toast && S.toast('Couldn’t join the live session' + (detail ? ' — ' + detail : ' (access).'));
      teardown();
    });
    channel.bind('realtime:member_added', () => refreshMembers());
    channel.bind('realtime:member_removed', () => refreshMembers());
    // control events
    channel.bind('client-transport', (d) => applyTransport(d));
    channel.bind('client-hello', () => { broadcastTransport(currentTransport()); });
  }

  function refreshMembers() {
    try { members = (channel && channel.getMembers) ? channel.getMembers() : []; } catch (e) { members = []; }
    emit();
  }

  /* ---- transport sync ---- */
  function currentTransport() {
    const playing = !!(S.engine && S.engine.playing && !S.engine.isRecording);
    return { t: playing ? 'play' : 'stop', pos: S.playhead || 0, at: Date.now() };
  }
  function broadcastTransport(d) {
    if (!C.active() || !channel) return;
    try { channel.trigger('client-transport', d); } catch (e) {}
  }
  // called from app.js when the local user drives transport
  C.notifyTransport = (type, pos) => {
    if (!C.active() || applying) return;
    broadcastTransport({ t: type, pos: pos != null ? pos : (S.playhead || 0), at: Date.now() });
  };
  function applyTransport(d) {
    if (!d || applying) return;
    applying = true;
    try {
      if (d.t === 'play') {
        if (d.pos != null) S.playhead = d.pos;
        if (S.play) S.play();
      } else if (d.t === 'stop') {
        if (S.engine && S.engine.playing && S.stopTransport) S.stopTransport();
        if (d.pos != null) { S.playhead = d.pos; if (S.timeline) S.timeline.dirty = true; }
      } else if (d.t === 'seek') {
        if (d.pos != null && S.seek) S.seek(d.pos);
      }
    } catch (e) {}
    applying = false;
  }

  /* ---- room lifecycle ---- */
  C.startHosting = async () => {
    await ensureClient();
    host = true;
    const rid = randomId();
    joinChannel(rid);
    return rid;
  };
  C.join = async (rid) => {
    if (!rid) return;
    if (room === rid && connected) { S.toast && S.toast('You’re already in this session.'); return; }
    await ensureClient();
    host = false;
    joinChannel(rid);
  };
  function teardown() {
    try { if (channel && room) client.unsubscribe('presence-sess-' + room); } catch (e) {}
    channel = null; room = null; host = false; connected = false; members = [];
    emit();
  }
  C.leave = () => {
    teardown();
    try { if (client) { client.disconnect(); client = null; } } catch (e) {}
    S.toast && S.toast('Left the live session.');
  };

  C.init = () => { if (S.collabBar) S.collabBar.init(); };

  /* ---- presence bar: a small banner showing who's in the room ---- */
  const bar = (S.collabBar = {});
  let barEl = null;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  bar.init = () => {
    if (barEl) return;
    barEl = document.createElement('div');
    barEl.id = 'collab-bar';
    barEl.hidden = true;
    document.body.appendChild(barEl);
    bar.render();
  };

  bar.render = () => {
    if (!barEl) return;
    if (!C.active()) { barEl.hidden = true; barEl.innerHTML = ''; return; }
    // one entry per real person (the same person on two devices shares a Discord id)
    const seen = {}, ms = [];
    C.members().forEach((m) => {
      const info = (m && m.user_info) || {};
      const key = info.id || m.user_id || Math.random();
      if (seen[key]) return; seen[key] = 1; ms.push(m);
    });
    const dots = ms.map((m) => {
      const info = (m && m.user_info) || {};
      const name = info.name || 'Artist';
      const av = info.avatar
        ? '<img src="' + esc(info.avatar) + '" alt="">'
        : '<span class="cb-ini">' + esc(String(name).slice(0, 1).toUpperCase()) + '</span>';
      return '<span class="cb-av" title="' + esc(name) + '">' + av + '</span>';
    }).join('');
    const count = ms.length || 1;
    barEl.innerHTML =
      '<span class="cb-live"><span class="cb-pulse"></span>LIVE</span>' +
      '<span class="cb-role">' + (C.isHost() ? 'Hosting' : 'In session') + '</span>' +
      '<span class="cb-avs">' + dots + '</span>' +
      '<span class="cb-count">' + count + ' here</span>' +
      '<button class="cb-leave" title="Leave the live session">' + (S.ui ? S.ui.icon('x', 13) : 'Leave') + '</button>';
    barEl.hidden = false;
    const lv = barEl.querySelector('.cb-leave');
    if (lv) lv.onclick = () => C.leave();
  };
})();
