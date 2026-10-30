/* Project model for a recording + mixing session, serialization, encrypted sharing. */
(function () {
  const S = window.Studio;
  const DEFAULT_TRACKS = 4;

  /** Decoded audio for every asset id (runtime only; embedded as WAV when saved). */
  S.buffers = new Map();

  S.newTrack = (i) => ({
    id: S.uid(),
    name: 'Track ' + (i + 1),
    vol: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    arm: false,
    color: i % 10, // index into the track colour palette
    fx: [],
    clips: [],
  });

  S.newProject = () => ({
    version: 2,
    name: 'Untitled Session',
    tracks: Array.from({ length: DEFAULT_TRACKS }, (_, i) => S.newTrack(i)),
    master: { vol: 0.85, fx: [] },
    key: null, // { tonic: 0-11, mode: 'major'|'minor' }
    keyAuto: true,
    bpm: 120,
    beatsPerBar: 4,
    grid: { mode: 'bars', div: '1/4', timeDiv: '0.25', snap: true },
    assets: {},
  });

  S.project = S.newProject();
  S.playhead = 0; // seconds

  S.addAsset = (name, audioBuffer) => {
    const id = S.uid();
    S.buffers.set(id, audioBuffer);
    S.project.assets[id] = { name, duration: audioBuffer.duration };
    return id;
  };

  S.addClip = (trackIdx, assetId, start, opts = {}) => {
    const buf = S.buffers.get(assetId);
    const clip = {
      id: S.uid(),
      asset: assetId,
      name: S.project.assets[assetId].name,
      start,
      offset: opts.offset || 0,
      dur: opts.dur != null ? opts.dur : buf.duration,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      muted: false,
    };
    S.project.tracks[trackIdx].clips.push(clip);
    return clip;
  };

  S.projectLength = (p = S.project) => {
    let end = 0;
    for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.dur);
    return end;
  };

  S.setProject = (p) => {
    S.project = p;
    S.playhead = 0;
    S.emit('project-replaced');
    S.emit('project-changed');
  };

  S.changed = (what) => S.emit('project-changed', what);

  S.validateProject = (p) => {
    if (!p || p.version !== 2 || !Array.isArray(p.tracks)) throw new Error('Not a valid Private Studio session');
    p.assets = p.assets || {};
    p.master = p.master || { vol: 0.85 };
    p.master.fx = p.master.fx || [];
    if (p.keyAuto === undefined) p.keyAuto = true;
    if (S.grid) S.grid.ensure(p);
    p.tracks.forEach((t, i) => {
      // color is a preset index (number) or a custom hex string like "#aabbcc"
      const customHex = typeof t.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.color);
      if (!Number.isInteger(t.color) && !customHex) t.color = i % 10;
    });
    for (const t of p.tracks) {
      t.fx = t.fx || [];
      t.clips = t.clips || [];
      t.arm = false;
    }
    return p;
  };

  /* ---------- base64 + (de)serialization ---------- */
  S.b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  S.unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  /** Plain object for saving: the project plus every used asset as 32-bit float WAV. */
  S.packProject = () => {
    const used = new Set(S.project.tracks.flatMap((t) => t.clips.map((c) => c.asset)));
    const assetData = {};
    for (const id of used) {
      const buf = S.buffers.get(id);
      if (buf) assetData[id] = S.b64(S.encodeWav(buf, { float: true }));
    }
    const assets = {};
    for (const id of used) assets[id] = S.project.assets[id];
    return Object.assign({}, S.project, { assets, assetData });
  };

  /** Inverse of packProject: decode audio and return a ready project. */
  S.unpackProject = async (obj, ctx) => {
    const data = obj.assetData || {};
    const project = S.validateProject(Object.assign({}, obj));
    delete project.assetData;
    S.buffers.clear();
    for (const id of Object.keys(data)) {
      const bytes = S.unb64(data[id]);
      const buf = await ctx.decodeAudioData(bytes.buffer);
      S.buffers.set(id, buf);
    }
    for (const t of project.tracks) t.clips = t.clips.filter((c) => S.buffers.has(c.asset));
    return project;
  };

  /* ---------- encryption (AES-GCM, PBKDF2) for private sharing ---------- */
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  S.encryptPacked = async (packed, pass) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(packed)));
    return JSON.stringify({ privateStudio: 2, encrypted: true, salt: S.b64(salt), iv: S.b64(iv), data: S.b64(data) });
  };

  S.decryptPacked = async (envelope, pass) => {
    const key = await deriveKey(pass, S.unb64(envelope.salt));
    try {
      const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: S.unb64(envelope.iv) }, key, S.unb64(envelope.data));
      return JSON.parse(new TextDecoder().decode(buf));
    } catch {
      throw new Error('Wrong passphrase, or the file was modified');
    }
  };
})();
