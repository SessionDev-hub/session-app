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
    // Never let sign-in hang the app: time it out and surface an error instead of freezing.
    const getTok = S.gate && S.gate.getToken ? S.gate.getToken() : Promise.resolve(S.auth && S.auth.token);
    const token = await Promise.race([
      getTok,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Sign-in timed out — try again.')), 9000)),
    ]);
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

  let connectWatchdog = 0;
  function joinChannel(rid) {
    room = rid;
    const name = 'presence-sess-' + rid;
    channel = client.subscribe(name);
    // Watchdog: if the room never connects (flaky network, auth service cold/unreachable), don't sit
    // there looking frozen — tell the user and tear down so they can try again.
    clearTimeout(connectWatchdog);
    connectWatchdog = setTimeout(() => {
      if (!connected) { try { S.toast && S.toast('Live session couldn’t connect — check your internet and try again.'); } catch (e) {} teardown(); }
    }, 15000);
    channel.bind('realtime:subscription_succeeded', () => {
      clearTimeout(connectWatchdog);
      connected = true; refreshMembers();
      startStateSync();
      // ask the host to sync the newcomer to the current transport + project state
      if (!host) send('client-hello', { at: Date.now() }, 0);
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
    channel.bind('client-state-z', (d) => receiveBig(d, applyState));
    channel.bind('client-rec', (d) => onRemoteRec(d));
    channel.bind('client-asset', (d) => receiveAsset(d));
    channel.bind('client-hello', () => {
      // bring a newcomer fully up to date: current edits, then transport
      diffSend(true);
      broadcastTransport(currentTransport());
      // a newcomer gets every take's audio too (they'll download what they're missing)
      sharedAssets.clear(); scanAssets();
    });
  }

  /* ---- outgoing messages ----
   * The realtime service allows a limited number of small messages per second. Everything goes
   * through one queue: urgent things (play/stop, a live take's audio) jump ahead, and an edit that
   * is still waiting is simply replaced by the newer one, so we never fall behind. */
  const MAX_PER_SEC = 9, MAX_BYTES = 9000;
  let outQ = [], sentAt = [], pumpTimer = 0;
  function send(event, data, prio, coalesceKey) {
    if (!channel || !C.active()) return;
    if (coalesceKey) outQ = outQ.filter((m) => m.key !== coalesceKey);
    outQ.push({ event, data, prio: prio || 0, key: coalesceKey || null, t: performance.now() });
    pump();
  }
  function pump() {
    clearTimeout(pumpTimer); pumpTimer = 0;
    const now = performance.now();
    sentAt = sentAt.filter((t) => now - t < 1000);
    outQ.sort((a, b) => a.prio - b.prio || a.t - b.t);
    while (outQ.length && sentAt.length < MAX_PER_SEC) {
      const m = outQ.shift();
      try { channel && channel.trigger(m.event, m.data); } catch (e) { try { console.warn('[collab] send', m.event, e); } catch (_) {} }
      sentAt.push(now);
    }
    if (outQ.length) pumpTimer = setTimeout(pump, Math.max(10, 1000 - (now - sentAt[0]) + 5));
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  async function pack(obj) { // JSON → gzip → base64 (projects get big; this keeps them ~6-10x smaller)
    const js = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'undefined') return { raw: true, s: b64(js) };
    const z = new Uint8Array(await new Response(new Blob([js]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    return { raw: false, s: b64(z) };
  }
  async function unpack(raw, str) {
    const u8 = unb64(str);
    if (raw) return JSON.parse(new TextDecoder().decode(u8));
    const out = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(out));
  }
  /** Send any size of state: small ones go as-is, big ones compressed and split into parts. */
  let bigSeq = 0;
  async function sendBig(event, obj, prio, coalesceKey) {
    let js; try { js = JSON.stringify(obj); } catch (e) { return; }
    if (js.length < MAX_BYTES - 200) return send(event, obj, prio, coalesceKey);
    const pk = await pack(obj), id = (++bigSeq).toString(36) + Math.random().toString(36).slice(2, 6);
    const CH = MAX_BYTES - 400, n = Math.ceil(pk.s.length / CH);
    if (coalesceKey) outQ = outQ.filter((m) => !(m.key && m.key.startsWith(coalesceKey)));
    for (let i = 0; i < n; i++) send(event + '-z', { id, i, n, raw: pk.raw, z: pk.s.slice(i * CH, (i + 1) * CH) }, prio, coalesceKey ? coalesceKey + ':' + id + ':' + i : null);
  }
  const bigIn = new Map();
  function receiveBig(d, apply) {
    if (!d || !d.id) return;
    let e = bigIn.get(d.id);
    if (!e) { e = { parts: new Array(d.n), got: 0, t: Date.now() }; bigIn.set(d.id, e); }
    if (e.parts[d.i] == null) { e.parts[d.i] = d.z; e.got++; }
    for (const [k, v] of bigIn) if (Date.now() - v.t > 20000) bigIn.delete(k); // forget half-received ones
    if (e.got === d.n) { bigIn.delete(d.id); unpack(d.raw, e.parts.join('')).then(apply).catch((err) => console.warn('[collab] big message', err)); }
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
    send('client-transport', d, 0, 'transport');
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
        // start where they ARE now, not where they were when they pressed play (message travel time)
        const late = d.at ? Math.min(1.5, Math.max(0, (Date.now() - d.at) / 1000)) : 0;
        if (d.pos != null) S.playhead = d.pos + late;
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
  let pollTimer = 0, editTimer = 0, lastSent = '', pendingStructure = false;

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
    sendBig('client-state', JSON.parse(js), 3, 'state');
  }
  /** Same tracks, same effects, same audio — only values moved (faders, pans, knobs, clip positions)? */
  function sameShape(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (!x || !y || x.id !== y.id) return false;
      const fx = x.fx || [], fy = y.fx || [];
      if (fx.length !== fy.length) return false;
      for (let j = 0; j < fx.length; j++) if (fx[j].id !== fy[j].id || fx[j].pluginId !== fy[j].pluginId || !!fx[j].bypass !== !!fy[j].bypass) return false;
      if ((x.name || '') !== (y.name || '') || (x.color || '') !== (y.color || '')) return false;
    }
    return true;
  }
  /** Apply an edit WITHOUT rebuilding the audio graph — smooth, no hiccup in what's playing. */
  function applyInPlace(st) {
    const p = S.project, eng = S.engine;
    let clipsMoved = false, mixMoved = false;
    st.tracks.forEach((nt, i) => {
      const t = p.tracks[i];
      if (t.vol !== nt.vol || t.pan !== nt.pan || !!t.mute !== !!nt.mute || !!t.solo !== !!nt.solo) mixMoved = true;
      t.vol = nt.vol; t.pan = nt.pan; t.mute = nt.mute; t.solo = nt.solo;
      (nt.fx || []).forEach((f, j) => {
        const mine = t.fx[j], np = f.params || {};
        for (const k in np) if (!mine.params || mine.params[k] !== np[k]) { mine.params = mine.params || {}; mine.params[k] = np[k]; if (eng) eng.setFxParam(mine.id, k, np[k]); }
        mine.preset = f.preset;
      });
      if (JSON.stringify(t.clips) !== JSON.stringify(nt.clips || [])) { t.clips = nt.clips || []; clipsMoved = true; }
    });
    if (st.master) {
      const m = p.master;
      if (m.vol !== st.master.vol) mixMoved = true;
      m.vol = st.master.vol;
      (st.master.fx || []).forEach((f, j) => { const mine = (m.fx || [])[j]; if (!mine) return; for (const k in (f.params || {})) if (!mine.params || mine.params[k] !== f.params[k]) { mine.params = mine.params || {}; mine.params[k] = f.params[k]; if (eng) eng.setFxParam(mine.id, k, f.params[k]); } });
    }
    if (st.bpm) p.bpm = st.bpm;
    if (st.bpb) p.beatsPerBar = st.bpb;
    if (st.loop) p.loop = st.loop;
    if (mixMoved && S.refresh.mix) S.refresh.mix();
    if (mixMoved && S.mixer && S.mixer.render) S.mixer.render();
    if (S.timeline) { if (clipsMoved && S.timeline.resize) S.timeline.resize(); S.timeline.dirty = true; }
  }
  function applyState(st) {
    if (!st || !Array.isArray(st.tracks) || applying) return;
    applying = true;
    try {
      // fast path: nothing structural changed, so don't rebuild anything (this is what keeps live edits smooth)
      st.tracks.forEach((t) => { t.fx = t.fx || []; t.clips = t.clips || []; t.arm = false; });
      if (sameShape(S.project.tracks, st.tracks) && (!st.master || sameShape([Object.assign({ id: 'm' }, S.project.master)], [Object.assign({ id: 'm' }, st.master)]))) {
        // keep my own arm/monitor state
        applyInPlace(st);
        try { lastSent = JSON.stringify(buildState()); } catch (e) {}
        applying = false;
        return;
      }
      const armed = (S.project.tracks.find((t) => t.arm) || {}).id;
      if (armed) st.tracks.forEach((t) => { if (t.id === armed) t.arm = true; });
      st.tracks.forEach((t) => { t.fx = t.fx || []; t.clips = t.clips || []; t.arm = false; });
      S.project.tracks = st.tracks;
      if (st.master) S.project.master = st.master;
      // never rebuild the audio graph in the middle of a take — finish the take first
      if (S.engine && S.engine.isRecording) { pendingStructure = true; if (S.timeline) { S.timeline.renderHeaders(); S.timeline.dirty = true; } try { lastSent = JSON.stringify(buildState()); } catch (e) {} applying = false; return; }
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
    pollTimer = setInterval(() => diffSend(false), 120);
  }
  function stopStateSync() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
    if (editTimer) { clearTimeout(editTimer); editTimer = 0; }
  }
  // immediate-ish send after a discrete edit (undo/redo included)
  C.notifyEdit = () => {
    if (!C.active() || applying) return;
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(() => diffSend(false), 16);
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
      // chunked encode so sharing a big recording never freezes the app (16-bit keeps it within the blob cap)
      const wav = S.encodeWavChunked ? await S.encodeWavChunked(buf) : S.encodeWav(buf);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, wav);
      const r = await fetch(base + '/blob', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, await authHeader()), body: ct });
      if (!r.ok) throw new Error('upload ' + r.status);
      const j = await r.json();
      if (channel) send('client-asset', { assetId, name: meta.name || 'audio', duration: meta.duration || buf.duration, blobId: j.id, iv: Array.from(iv, (b) => b.toString(16).padStart(2, '0')).join('') }, 2);
    } catch (e) {
      sharedAssets.delete(assetId); // let a later poll retry
      try { console.warn('[collab] shareAsset', e); } catch (_) {}
    }
  }

  async function receiveAsset(d) {
    if (!d || !d.assetId || !d.blobId) return;
    if (S.buffers.has(d.assetId) && !previewAssets.has(d.assetId)) { sharedAssets.add(d.assetId); return; }
    try {
      const key = await getKey();
      const base = apiBase();
      if (!key || !base) return;
      const r = await fetch(base + '/blob/' + encodeURIComponent(d.blobId), { headers: await authHeader() });
      if (!r.ok) throw new Error('download ' + r.status);
      const ct = await r.arrayBuffer();
      const wav = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(d.iv) }, key, ct);
      const audio = await S.ctx.decodeAudioData(wav.slice(0));
      const wasPreview = previewAssets.delete(d.assetId);
      S.buffers.set(d.assetId, audio);
      S.project.assets[d.assetId] = { name: d.name || 'audio', duration: d.duration || audio.duration };
      sharedAssets.add(d.assetId);
      // the live take was already playable from the streamed preview — just swap in full quality, quietly
      if (wasPreview) { if (S.timeline) S.timeline.dirty = true; return; }
      // audio now exists — refresh so any clip using it draws its waveform and plays
      applying = true;
      try { if (S.refresh && S.refresh.structure) S.refresh.structure(); } catch (e) {}
      applying = false;
      S.toast && S.toast('Received “' + (d.name || 'audio') + '” from the session.');
    } catch (e) { try { console.warn('[collab] receiveAsset', e); } catch (_) {} }
  }

  /* ---- live takes: everyone sees (and gets) a recording WHILE it happens ----
   * The person recording streams their take as it's captured: a waveform update and a few hundred ms of
   * Opus-compressed audio, end-to-end encrypted with the room key, 4 times a second. Everyone else sees a
   * live red box with the waveform growing on that track, and the moment the take stops the audio is
   * already there to play (no waiting for an upload). The full-quality file still follows in the
   * background and silently replaces the streamed copy. */
  const previewAssets = new Set();
  const OPUS_SR = 48000, FRAME = 960, PEAK_SAMPLES = 1200; // 20 ms frames, a waveform point every 25 ms
  let tx = null;                       // the take I'm streaming
  const remote = new Map();            // takes others are streaming: id -> state
  const myName = () => { try { const me = channel && (channel.me || (channel.presence && channel.presence.me)); return (me && me.user_info && me.user_info.name) || 'Someone'; } catch (e) { return 'Someone'; } };
  const canOpus = () => typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined';
  async function seal(u8) { const key = await getKey(); if (!key) return null; const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, u8)); return { iv: b64(iv), a: b64(ct) }; }
  async function unseal(iv, a) { const key = await getKey(); if (!key) return null; return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(a))); }

  const recTap = {
    start(rec, sr) {
      tx = null;
      if (!C.active() || !roomKey) return;
      const id = randomId();
      const t = (tx = { id, trackId: rec.trackId, startPos: rec.startPos, sr, seq: 0, frames: [], fpos: 0, frame: new Float32Array(FRAME), fill: 0, rpos: 0, prev: 0, ts: 0, peaks: [], pk: 0, pn: 0, desc: null, sentDesc: false, enc: null, done: false, assetId: null });
      send('client-rec', { k: 's', id, tr: rec.trackId, sp: rec.startPos, who: myName(), audio: canOpus() }, 0);
      if (canOpus()) {
        try {
          t.enc = new AudioEncoder({
            output: (chunk, meta) => { if (meta && meta.decoderConfig && meta.decoderConfig.description && !t.desc) t.desc = new Uint8Array(meta.decoderConfig.description); const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); t.frames.push(d); },
            error: (e) => { try { console.warn('[collab] encoder', e); } catch (_) {} t.enc = null; },
          });
          t.enc.configure({ codec: 'opus', sampleRate: OPUS_SR, numberOfChannels: 1, bitrate: 64000 });
        } catch (e) { t.enc = null; }
      }
      t.timer = setInterval(() => flushTx(t, false), 250);
    },
    chunk(d, sr) {
      const t = tx; if (!t || t.done) return;
      // resample the mic to 48 kHz (Opus' native rate) on the fly, and keep a running waveform
      const step = sr / OPUS_SR;
      let pos = t.rpos;
      while (pos < d.length) {
        const i = Math.floor(pos), f = pos - i;
        const a = i < 0 ? t.prev : d[i], b = i + 1 < d.length ? d[i + 1] : d[i];
        const v = a + (b - a) * f;
        t.frame[t.fill++] = v;
        const av = v < 0 ? -v : v; if (av > t.pk) t.pk = av;
        if (++t.pn === PEAK_SAMPLES) { t.peaks.push(Math.min(255, Math.round(t.pk * 255))); t.pk = 0; t.pn = 0; }
        if (t.fill === FRAME) {
          if (t.enc) { try { t.enc.encode(new AudioData({ format: 'f32', sampleRate: OPUS_SR, numberOfFrames: FRAME, numberOfChannels: 1, timestamp: t.ts, data: t.frame })); } catch (e) {} }
          t.ts += (FRAME / OPUS_SR) * 1e6; t.frame = new Float32Array(FRAME); t.fill = 0;
        }
        pos += step;
      }
      t.rpos = pos - d.length; t.prev = d[d.length - 1];
    },
    stop() {
      const t = tx; if (!t) return;
      t.done = true; clearInterval(t.timer);
      (async () => {
        if (t.enc) {
          if (t.fill) { try { t.enc.encode(new AudioData({ format: 'f32', sampleRate: OPUS_SR, numberOfFrames: t.fill, numberOfChannels: 1, timestamp: t.ts, data: t.frame.subarray(0, t.fill) })); } catch (e) {} }
          try { await t.enc.flush(); } catch (e) {} try { t.enc.close(); } catch (e) {}
        }
        if (t.pn) t.peaks.push(Math.min(255, Math.round(t.pk * 255)));
        await flushTx(t, true);
        t.flushed = true; sendEnd(t);
        // no take came out of it (too short / cancelled): tell everyone to drop the live box
        setTimeout(() => { if (!t.ended) { t.ended = true; send('client-rec', { k: 'x', id: t.id }, 1); if (tx === t) tx = null; } }, 4000);
      })();
    },
  };
  async function flushTx(t, final) {
    if (t.busy) { if (final) await t.busy; else return; }
    const frames = t.frames.splice(0), peaks = t.peaks.splice(0);
    if (!frames.length && !peaks.length) return;
    const run = (async () => {
      // pack frames: [u16 length][bytes]...
      let n = 0; frames.forEach((f) => (n += 2 + f.length));
      const buf = new Uint8Array(n); let o = 0;
      for (const f of frames) { buf[o++] = f.length >> 8; buf[o++] = f.length & 255; buf.set(f, o); o += f.length; }
      const sealed = frames.length ? await seal(buf) : null;
      const msg = { k: 'd', id: t.id, q: t.seq++, p: b64(Uint8Array.from(peaks)) };
      if (sealed) { msg.iv = sealed.iv; msg.a = sealed.a; }
      if (t.desc && !t.sentDesc) { msg.ds = b64(t.desc); t.sentDesc = true; }
      send('client-rec', msg, 1);
    })();
    t.busy = run; await run; t.busy = null;
  }
  function sendEnd(t) {
    if (!t.flushed || !t.assetId || t.ended) return;
    t.ended = true;
    send('client-rec', { k: 'e', id: t.id, as: t.assetId, n: t.name, dur: t.duration, q: t.seq }, 1);
    // the full-quality file goes up right after (the poll would do it too, this is just sooner)
    setTimeout(() => scanAssets(), 50);
    if (tx === t) tx = null;
  }
  function onTakeAdded(d) {
    if (pendingStructure) { pendingStructure = false; setTimeout(() => { applying = true; try { S.refresh.structure(); } catch (e) {} applying = false; }, 0); }
    const t = tx; if (!t || !d) return;
    t.assetId = d.assetId; t.name = d.name; t.duration = d.duration;
    // its audio is already on its way to everyone — don't also upload it as "missing" before the preview lands
    sendEnd(t);
  }

  /* receiving side */
  function onRemoteRec(d) {
    if (!d || !d.id) return;
    let r = remote.get(d.id);
    if (d.k === 's') {
      remote.set(d.id, (r = { id: d.id, trackId: d.tr, startPos: d.sp || 0, who: d.who || 'Someone', peaks: [], peakSec: PEAK_SAMPLES / OPUS_SR, lastAt: performance.now(), heard: 0, next: 0, waiting: new Map(), pcm: [], dec: null, preskip: 312, ts: 0, audio: d.audio }));
      try { S.toast && S.toast(r.who + ' is recording…'); } catch (e) {}
      kick();
      return;
    }
    if (!r) return;
    if (d.k === 'd') { r.waiting.set(d.q, d); drain(r); return; }
    if (d.k === 'e') {
      r.end = d; drain(r);
      // if a piece never arrives, don't wait forever: finish with what we have (the full file follows anyway)
      setTimeout(() => { if (remote.get(d.id) === r && !r.draining) { r.waiting.clear(); r.next = d.q; drain(r); } }, 4000);
      return;
    }
    if (d.k === 'x') { remote.delete(d.id); if (S.timeline) S.timeline.dirty = true; }
  }
  async function drain(r) {
    if (r.draining) return;
    r.draining = true;
    try {
      while (r.waiting.has(r.next)) {
        const d = r.waiting.get(r.next); r.waiting.delete(r.next); r.next++;
        if (d.p) { const pk = unb64(d.p); for (const v of pk) r.peaks.push(v / 255); r.heard = r.peaks.length * r.peakSec; r.lastAt = performance.now(); }
        if (d.ds && canOpus() && !r.dec) {
          const desc = unb64(d.ds);
          r.preskip = 0; // the decoder reads the encoder delay from this header and trims it itself
          try {
            r.dec = new AudioDecoder({ output: (a) => { const f = new Float32Array(a.numberOfFrames); try { a.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); } catch (e) {} r.pcm.push(f); a.close(); }, error: (e) => { try { console.warn('[collab] decoder', e); } catch (_) {} r.dec = null; } });
            r.dec.configure({ codec: 'opus', sampleRate: OPUS_SR, numberOfChannels: 1, description: desc });
          } catch (e) { r.dec = null; }
        }
        if (d.a && r.dec) {
          const u8 = await unseal(d.iv, d.a);
          if (u8) for (let o = 0; o + 2 <= u8.length;) { const n = (u8[o] << 8) | u8[o + 1]; o += 2; try { r.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: r.ts, data: u8.subarray(o, o + n) })); } catch (e) {} r.ts += (FRAME / OPUS_SR) * 1e6; o += n; }
        }
      }
      if (r.end && r.next >= r.end.q) await finishRemote(r);
    } catch (e) { try { console.warn('[collab] live take', e); } catch (_) {} }
    r.draining = false;
  }
  async function finishRemote(r) {
    remote.delete(r.id);
    const e = r.end;
    if (r.dec) { try { await r.dec.flush(); } catch (err) {} try { r.dec.close(); } catch (err) {} }
    if (r.pcm.length && e.as && !S.buffers.has(e.as)) {
      const total = r.pcm.reduce((n, f) => n + f.length, 0);
      const want = Math.max(1, Math.round((e.dur || total / OPUS_SR) * OPUS_SR));
      const buf = new AudioBuffer({ numberOfChannels: 1, length: want, sampleRate: OPUS_SR });
      const out = buf.getChannelData(0);
      let skip = r.preskip, o = 0;
      for (const f of r.pcm) { let i = 0; if (skip) { const k = Math.min(skip, f.length); skip -= k; i = k; } const n = Math.min(f.length - i, want - o); if (n > 0) { out.set(f.subarray(i, i + n), o); o += n; } }
      S.buffers.set(e.as, buf);
      S.project.assets[e.as] = { name: e.n || 'Take', duration: e.dur || buf.duration };
      previewAssets.add(e.as);
      sharedAssets.add(e.as);   // they'll send the full-quality file; we never upload their take back
      applying = true;
      try { if (!(S.engine && S.engine.isRecording) && S.refresh && S.refresh.structure) S.refresh.structure(); else pendingStructure = true; } catch (err) {}
      applying = false;
    }
    if (S.timeline) S.timeline.dirty = true;
  }
  /** For the timeline: takes other people are recording right now. */
  C.remoteRecs = () => {
    const now = performance.now(), list = [];
    for (const r of remote.values()) {
      // grow smoothly between updates, but never run more than ~0.6 s ahead of what we actually heard
      const est = r.heard + Math.min(0.6, (now - r.lastAt) / 1000);
      list.push({ trackId: r.trackId, startPos: r.startPos, len: r.end ? r.heard : est, peaks: r.peaks, peakSec: r.peakSec, who: r.who });
    }
    return list;
  };
  // keep the timeline animating while someone else records
  let kickRaf = 0;
  function kick() {
    if (kickRaf) return;
    const tick = () => {
      kickRaf = 0;
      const now = performance.now();
      for (const [id, r] of remote) if (!r.end && now - r.lastAt > 15000) remote.delete(id); // they dropped out mid-take
      if (!remote.size) { if (S.timeline) S.timeline.dirty = true; return; } if (S.timeline) S.timeline.dirty = true; kickRaf = requestAnimationFrame(tick); };
    kickRaf = requestAnimationFrame(tick);
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
    clearTimeout(connectWatchdog);
    stopStateSync();
    lastSent = '';
    roomKey = null; cryptoKey = null; sharedAssets.clear();
    outQ = []; clearTimeout(pumpTimer); remote.clear(); if (tx) { clearInterval(tx.timer); tx = null; }
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
    try { S.on && S.on('take-added', (d) => onTakeAdded(d)); } catch (e) {}
    S.recTaps = S.recTaps || new Set();
    S.recTaps.add(recTap);
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
