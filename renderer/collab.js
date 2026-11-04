/* Live collab — real-time sessions over Apinator (Pusher-compatible presence channels).
 *
 * How it fits together:
 *   - Everyone in a room joins the presence channel  presence-sess-<roomId>.
 *   - Joining is signed by our tiny auth service (fly.dev) using the user's Discord
 *     token — the Apinator SECRET never touches the app. Config is window.__APINATOR__.
 *   - The project itself (with audio) travels over Vault Messages as a .session file —
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
  let roomKey = null, cryptoKey = null;      // M3: shared secret for encrypting shared audio
  const sharedAssets = new Set();            // asset ids we've uploaded or received
  const listeners = new Set();

  C.available = () => !!window.Apinator && !!cfg().appKey;
  C.active = () => connected && !!room;
  C.roomId = () => room;
  C.isHost = () => host;
  C.members = () => members.slice();
  C.onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { listeners.forEach((fn) => { try { fn(); } catch (e) {} }); if (S.collabBar) S.collabBar.render(); try { S.emit && S.emit('collab-changed'); } catch (e) {} };

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
      startStateSync();
      // ask the host to sync the newcomer to the current transport + project state
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
    channel.bind('client-state', (d) => applyState(d));
    channel.bind('client-asset', (d) => receiveAsset(d));
    channel.bind('client-hello', () => {
      // bring a newcomer fully up to date: current edits, then transport
      diffSend(true);
      broadcastTransport(currentTransport());
    });
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

  /* ---- live edit sync (M2) ----
   * We broadcast the editable project state (tracks + master + a few globals) — the same
   * shape the undo history snapshots — minus any audio. The other side applies it with the
   * same refresh path undo/redo uses. Clips whose audio a peer doesn't have yet are kept in
   * the model (shown empty, silent) — never dropped — so a sync can't delete anyone's work.
   * Two triggers: an immediate send right after an edit (history-changed), plus a light poll
   * that catches continuous gestures (dragging a clip, riding a fader). Only changed state
   * is sent. */
  let pollTimer = 0, editTimer = 0, lastSent = '';

  function buildState() {
    const p = S.project;
    return { tracks: p.tracks, master: p.master, bpm: p.bpm, bpb: p.beatsPerBar, loop: p.loop };
  }
  function diffSend(force) {
    if (!C.active() || applying || !channel) return;
    scanAssets(); // M3: push any new audio (recordings/imports) to the room
    let js; try { js = JSON.stringify(buildState()); } catch (e) { return; }
    if (!force && js === lastSent) return;
    lastSent = js;
    try { channel.trigger('client-state', JSON.parse(js)); } catch (e) {}
  }
  function applyState(st) {
    if (!st || !Array.isArray(st.tracks) || applying) return;
    applying = true;
    try {
      st.tracks.forEach((t) => { t.fx = t.fx || []; t.clips = t.clips || []; t.arm = false; });
      S.project.tracks = st.tracks;
      if (st.master) S.project.master = st.master;
      if (st.bpm) S.project.bpm = st.bpm;
      if (st.bpb) S.project.beatsPerBar = st.bpb;
      if (st.loop) S.project.loop = st.loop;
      if (S.timeline) S.timeline.selected = null;
      if (S.refresh && S.refresh.structure) S.refresh.structure();
      if (S.engine && S.engine.reapplyFxParams) S.engine.reapplyFxParams();
      if (S.timeline && S.timeline.resize) S.timeline.resize();
      // record what we now have so the poll doesn't echo it straight back
      try { lastSent = JSON.stringify(buildState()); } catch (e) {}
    } catch (e) { try { console.error('[collab] applyState', e); } catch (_) {} }
    applying = false;
  }
  function startStateSync() {
    stopStateSync();
    try { lastSent = JSON.stringify(buildState()); } catch (e) { lastSent = ''; }
    pollTimer = setInterval(() => diffSend(false), 300);
  }
  function stopStateSync() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
    if (editTimer) { clearTimeout(editTimer); editTimer = 0; }
  }
  // immediate-ish send after a discrete edit (undo/redo included)
  C.notifyEdit = () => {
    if (!C.active() || applying) return;
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(() => diffSend(false), 60);
  };

  /* ---- shared audio (M3) ----
   * Imports and recordings are far too big for realtime events, so they travel as blobs
   * through the collab service. They are ENCRYPTED here with a per-room key that only ever
   * travels in the end-to-end-encrypted Vault invite — the server only stores ciphertext.
   * When a peer is missing a clip's audio, we upload it once and announce it; the peer
   * downloads, decrypts and decodes it, and the clip fills in. */
  function randomHex(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join(''); }
  function hexToBytes(h) { return Uint8Array.from((h || '').match(/.{2}/g) || [], (x) => parseInt(x, 16)); }
  async function getKey() {
    if (cryptoKey) return cryptoKey;
    if (!roomKey) return null;
    try { cryptoKey = await crypto.subtle.importKey('raw', hexToBytes(roomKey), 'AES-GCM', false, ['encrypt', 'decrypt']); } catch (e) { return null; }
    return cryptoKey;
  }
  const apiBase = () => (cfg().authEndpoint || '').replace(/\/auth$/, '');
  async function authHeader() {
    const t = (S.gate && S.gate.getToken) ? await S.gate.getToken() : (S.auth && S.auth.token);
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  function scanAssets() {
    if (!roomKey || !apiBase() || !window.crypto || !crypto.subtle) return;
    const refd = new Set();
    S.project.tracks.forEach((t) => (t.clips || []).forEach((c) => c && refd.add(c.asset)));
    refd.forEach((a) => { if (a && S.buffers.has(a) && !sharedAssets.has(a)) shareAsset(a); });
  }

  async function shareAsset(assetId) {
    if (sharedAssets.has(assetId)) return;
    sharedAssets.add(assetId); // claim up front so the poll doesn't upload twice
    try {
      const buf = S.buffers.get(assetId);
      const key = await getKey();
      const base = apiBase();
      if (!buf || !key || !base) { sharedAssets.delete(assetId); return; }
      const meta = S.project.assets[assetId] || {};
      const wav = S.encodeWav(buf); // 16-bit keeps it within the blob size cap
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, wav);
      const r = await fetch(base + '/blob', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, await authHeader()), body: ct });
      if (!r.ok) throw new Error('upload ' + r.status);
      const j = await r.json();
      if (channel) channel.trigger('client-asset', { assetId, name: meta.name || 'audio', duration: meta.duration || buf.duration, blobId: j.id, iv: Array.from(iv, (b) => b.toString(16).padStart(2, '0')).join('') });
    } catch (e) {
      sharedAssets.delete(assetId); // let a later poll retry
      try { console.warn('[collab] shareAsset', e); } catch (_) {}
    }
  }

  async function receiveAsset(d) {
    if (!d || !d.assetId || !d.blobId) return;
    if (S.buffers.has(d.assetId)) { sharedAssets.add(d.assetId); return; }
    try {
      const key = await getKey();
      const base = apiBase();
      if (!key || !base) return;
      const r = await fetch(base + '/blob/' + encodeURIComponent(d.blobId), { headers: await authHeader() });
      if (!r.ok) throw new Error('download ' + r.status);
      const ct = await r.arrayBuffer();
      const wav = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(d.iv) }, key, ct);
      const audio = await S.ctx.decodeAudioData(wav.slice(0));
      S.buffers.set(d.assetId, audio);
      S.project.assets[d.assetId] = { name: d.name || 'audio', duration: d.duration || audio.duration };
      sharedAssets.add(d.assetId);
      // audio now exists — refresh so any clip using it draws its waveform and plays
      applying = true;
      try { if (S.refresh && S.refresh.structure) S.refresh.structure(); } catch (e) {}
      applying = false;
      S.toast && S.toast('Received “' + (d.name || 'audio') + '” from the session.');
    } catch (e) { try { console.warn('[collab] receiveAsset', e); } catch (_) {} }
  }

  /* ---- room lifecycle ---- */
  C.startHosting = async () => {
    host = true;
    roomKey = randomHex(32); cryptoKey = null; sharedAssets.clear();
    const rid = randomId();
    room = rid; // valid immediately so the invite can go out
    // Connect in the BACKGROUND — a slow/flaky realtime connection (or a token still being fetched)
    // must never stop the invite from being sent. The host joins the channel as soon as it can.
    ensureClient().then(() => joinChannel(rid)).catch((e) => {
      try { console.warn('[collab] host connect:', e && e.message); } catch (_) {}
      S.toast && S.toast('Live session created — invite sent. Still connecting…');
    });
    return { roomId: rid, roomKey };
  };
  C.join = async (rid, rkey) => {
    if (!rid) return;
    if (room === rid && connected) { S.toast && S.toast('You’re already in this session.'); return; }
    await ensureClient();
    host = false;
    roomKey = rkey || null; cryptoKey = null; sharedAssets.clear();
    joinChannel(rid);
  };
  function teardown() {
    stopStateSync();
    lastSent = '';
    roomKey = null; cryptoKey = null; sharedAssets.clear();
    try { if (channel && room) client.unsubscribe('presence-sess-' + room); } catch (e) {}
    channel = null; room = null; host = false; connected = false; members = [];
    emit();
  }
  C.leave = () => {
    teardown();
    try { if (client) { client.disconnect(); client = null; } } catch (e) {}
    S.toast && S.toast('Left the live session.');
  };

  C.init = () => {
    if (S.collabBar) S.collabBar.init();
    // every edit snapshots history — use that as the "something changed" signal to sync live
    try { S.on && S.on('history-changed', () => C.notifyEdit()); } catch (e) {}
  };

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
