/* Custom background: any colour or your own picture, with adjustable dimming and panel see-through.
 * This is an app preference (saved on this computer), not part of a session file. */
(function () {
  const S = window.Studio;
  const B = (S.background = {});
  const KEY = 'ps.background';
  const DEFAULTS = { color: '#0b0c10', image: null, fit: 'cover', dim: 0.3, glass: 1, live: null, liveSpeed: 1, autoContrast: true };
  const BASE = { panel: [19, 20, 25], panel2: [28, 30, 37], canvas: [13, 14, 18] };
  let cfg = Object.assign({}, DEFAULTS);
  let layer;

  const hexToRgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    const n = m ? parseInt(m[1], 16) : 0x0b0c10;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const tintOf = () => (cfg.color.toLowerCase() === DEFAULTS.color ? 0 : 0.3);

  /** A canvas/CSS colour for a UI surface: the surface's base colour, tinted by the chosen colour, with the panel see-through applied. */
  B.shade = (rgb) => {
    const c = mix(rgb, hexToRgb(cfg.color), tintOf());
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + cfg.glass + ')';
  };
  B.glass = () => cfg.glass;

  /* ---------- keep text readable ----------
   * Panels are see-through, so a bright picture or colour behind them makes the light text hard to read.
   * Measure how bright the background is and darken it just enough that panels stay dark under the text. */
  const lumOf = (rgb) => { const f = (v) => { v /= 255; return v <= 0.04 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  let imgLum = { src: null, v: 0.3 };
  function measureImage(src) {
    if (!src || imgLum.src === src) return;
    imgLum = { src, v: 0.3 };
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
        g.drawImage(im, 0, 0, 32, 32); const d = g.getImageData(0, 0, 32, 32).data;
        let s = 0; for (let i = 0; i < d.length; i += 4) s += lumOf([d[i], d[i + 1], d[i + 2]]);
        if (imgLum.src === src) { imgLum.v = s / (d.length / 4); apply(); }
      } catch (e) {}
    };
    im.src = src;
  }
  /** How much the background must be darkened (0..0.85) so panels stay dark enough for light text. */
  function neededDim() {
    if (cfg.autoContrast === false) return 0;
    const g = cfg.glass;
    if (g >= 0.98) return 0;
    let L = lumOf(hexToRgb(cfg.color));
    if (cfg.image) L = imgLum.v;
    if (cfg.live) L = cfg.live === 'video' ? 0.35 : 0.12;
    const panelL = 0.007, target = 0.06;                  // ≈ a dark grey under the text
    const behind = (target - g * panelL) / Math.max(1e-4, 1 - g);
    if (L <= behind) return 0;
    return Math.min(0.85, 1 - behind / L);
  }
  B.neededDim = neededDim;

  function apply() {
    const root = document.documentElement.style;
    const col = hexToRgb(cfg.color);
    const t = tintOf();
    const solid = (rgb) => {
      const c = mix(rgb, col, t);
      return 'rgb(' + c[0] + ' ' + c[1] + ' ' + c[2] + ')';
    };
    const a = (rgb) => {
      const c = mix(rgb, col, t);
      return 'rgb(' + c[0] + ' ' + c[1] + ' ' + c[2] + ' / ' + cfg.glass + ')';
    };
    root.setProperty('--bg', cfg.color);
    root.setProperty('--panel', a(BASE.panel));
    root.setProperty('--panel-solid', solid(BASE.panel));
    root.setProperty('--panel2', solid(BASE.panel2));
    root.setProperty('--canvas-bg', a(BASE.canvas));
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'bg-layer';
      document.body.prepend(layer);
    }
    const img = cfg.image ? 'url("' + cfg.image + '")' : 'none';
    layer.style.backgroundColor = cfg.color;
    layer.style.backgroundImage = img;
    layer.style.backgroundSize = cfg.fit === 'tile' ? 'auto' : cfg.fit;
    layer.style.backgroundRepeat = cfg.fit === 'tile' ? 'repeat' : 'no-repeat';
    layer.style.backgroundPosition = 'center';
    measureImage(cfg.image);
    const need = neededDim();
    layer.style.setProperty('--dim', Math.max(cfg.image || cfg.live ? cfg.dim : 0, need));
    document.documentElement.classList.toggle('bg-bright', need > 0.05);
    applyLive();
    if (S.timeline) S.timeline.dirty = true;
  }

  /* ---------- live (moving) backgrounds ----------
   * Built-in scenes are big soft colour blobs moved ONLY with CSS transforms, so the GPU compositor animates
   * them on its own thread — the timeline, meters and audio never wait on them. Your own video / GIF plays
   * in a hardware-decoded <video>/<img>. While a live background is on, the glass blur behind panels is
   * switched off (re-blurring a moving picture every frame is what would cost smoothness). */
  const SCENES = {
    aurora: { name: 'Aurora', base: '#05060c', blobs: ['#22d3ee', '#8b5cf6', '#10b981', '#3b82f6'] },
    sunset: { name: 'Sunset Glow', base: '#0d0507', blobs: ['#f97316', '#ec4899', '#facc15', '#ef4444'] },
    ocean: { name: 'Ocean Drift', base: '#03080f', blobs: ['#0ea5e9', '#2563eb', '#14b8a6', '#1e3a8a'] },
    neon: { name: 'Neon Night', base: '#06040d', blobs: ['#d946ef', '#22d3ee', '#a3e635', '#f43f5e'] },
    lava: { name: 'Lava', base: '#0c0403', blobs: ['#dc2626', '#ea580c', '#7f1d1d', '#f59e0b'] },
    accent: { name: 'Accent Glow (follows your accent colour)', base: '#07070b', blobs: ['var(--accent)', 'rgb(var(--accent-deep-rgb))', 'rgb(var(--accent-light-rgb))', 'var(--accent)'] },
  };
  B.SCENES = SCENES;
  let liveEl = null, liveKey = '', mediaUrl = null;
  function clearLive() { if (liveEl) { liveEl.remove(); liveEl = null; } if (mediaUrl) { URL.revokeObjectURL(mediaUrl); mediaUrl = null; } liveKey = ''; document.documentElement.classList.remove('bg-live'); }
  async function applyLive() {
    const key = (cfg.live || '') + '|' + cfg.liveSpeed;
    if (!cfg.live) return clearLive();
    document.documentElement.classList.add('bg-live');
    if (key === liveKey && liveEl) return;
    clearLive(); document.documentElement.classList.add('bg-live'); liveKey = key;
    const box = document.createElement('div'); box.className = 'bg-live-box';
    box.style.setProperty('--bg-speed', String(1 / Math.max(0.25, cfg.liveSpeed || 1)));
    if (cfg.live === 'video') {
      const f = await mediaGet();
      if (!f || liveKey !== key) return;
      mediaUrl = URL.createObjectURL(f.blob);
      const m = document.createElement(/^image\//.test(f.type) ? 'img' : 'video');
      m.className = 'bg-live-media'; m.src = mediaUrl;
      if (m.tagName === 'VIDEO') { m.muted = true; m.loop = true; m.playsInline = true; m.autoplay = true; m.setAttribute('muted', ''); m.playbackRate = Math.max(0.25, Math.min(2, cfg.liveSpeed || 1)); m.play().catch(() => {}); }
      box.appendChild(m);
    } else {
      const sc = SCENES[cfg.live] || SCENES.aurora;
      box.style.background = sc.base;
      sc.blobs.forEach((c, i) => { const b = document.createElement('i'); b.className = 'bg-blob b' + i; b.style.setProperty('--c', c); box.appendChild(b); });
    }
    (layer || document.body).appendChild(box);
    liveEl = box;
  }
  // a hidden window doesn't need a moving background
  document.addEventListener('visibilitychange', () => { const v = liveEl && liveEl.querySelector('video'); if (v) document.hidden ? v.pause() : v.play().catch(() => {}); });

  /* your own video / GIF, kept in IndexedDB (too big for normal settings storage) */
  const db = () => new Promise((res, rej) => { const q = indexedDB.open('session-bg', 1); q.onupgradeneeded = () => q.result.createObjectStore('files'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  async function mediaPut(blob, type) { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put({ blob, type }, 'video'); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  async function mediaGet() { try { const d = await db(); return await new Promise((res) => { const q = d.transaction('files').objectStore('files').get('video'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
  B.setLiveFile = async (file) => {
    if (!file || !/^(video\/|image\/gif)/.test(file.type)) throw new Error('Pick a video (MP4 / WebM) or an animated GIF');
    if (file.size > 300 * 1024 * 1024) throw new Error('That video is over 300 MB — use a shorter or smaller one');
    await mediaPut(file, file.type);
    liveKey = '';
    B.set({ live: 'video', glass: cfg.glass > 0.85 ? 0.72 : cfg.glass });
  };

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
      return true;
    } catch (e) {
      return false;
    }
  }

  B.get = () => Object.assign({}, cfg);

  B.set = (patch) => {
    cfg = Object.assign({}, cfg, patch);
    apply();
    return save();
  };

  B.reset = () => {
    cfg = Object.assign({}, DEFAULTS);
    apply();
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
  };

  /** Shrink a picture so it stays light enough to keep (max 1920 px, JPEG). Returns a data URL. */
  B.prepareImage = async (file) => {
    if (!file || !/^image\//.test(file.type)) throw new Error('That is not a picture file');
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  };

  /** Use a picture file as the background. */
  B.setImageFile = async (file) => {
    const url = await B.prepareImage(file);
    const patch = { image: url };
    if (cfg.glass > 0.85) patch.glass = 0.7; // so the picture actually shows through the panels
    const kept = B.set(patch);
    if (!kept) S.toast('Background applied, but it is too big to remember after you close the app. Try a smaller picture.');
  };

  B.init = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved === 'object') cfg = Object.assign({}, DEFAULTS, saved);
      if (cfg.color === '#1b1e23') cfg.color = DEFAULTS.color; // old default colour -> new default look
    } catch (e) {}
    apply();
    const btn = document.getElementById('btn-bg');
    if (btn) btn.onclick = B.dialog;
  };

  const SWATCHES = ['#0b0c10', '#0f172a', '#1e1b4b', '#3b0764', '#4a044e', '#7f1d1d', '#7c2d12', '#14532d', '#134e4a', '#1e3a5f', '#374151', '#f5f5f4'];

  /** Build the background controls into any container (reused by the Settings tab and the standalone dialog). */
  B.controls = (root) => {
    root.innerHTML = `
      <div class="param"><label>Colour</label><input type="color" id="bg-color" style="width:100%;height:30px;padding:0;background:none;border:1px solid var(--line);border-radius:5px"><span></span></div>
      <div id="bg-sw" style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px 130px"></div>
      <div class="param"><label>Live background</label><select id="bg-live" class="sel"></select><span></span></div>
      <div class="param" id="bg-live-vid-row"><label>Your video / GIF</label><span style="display:flex;gap:6px"><button class="btn" id="bg-live-pick">Choose video or GIF…</button></span><span></span></div>
      <div class="param"><label>Motion speed</label><input type="range" id="bg-live-speed" min="25" max="200" step="5"><span class="val" id="bg-live-speed-v"></span></div>
      <p class="hint" style="color:var(--dim);margin:2px 0 12px">Moving backgrounds run on the graphics card, so the timeline, meters and audio stay just as smooth. Your own video (MP4 / WebM) loops silently — 1080p or smaller keeps it light.</p>
      <input type="file" id="bg-live-file" accept="video/mp4,video/webm,video/*,image/gif" hidden>
      <div class="param"><label>Picture</label><span style="display:flex;gap:6px"><button class="btn" id="bg-pick">Choose picture…</button><button class="btn" id="bg-clear">Remove</button></span><span class="hint">Best around <b>1920×1080</b> (16:9) and set “Fill the window”, so it isn’t stretched or blurry.</span></div>
      <div class="param"><label>Picture fit</label><select id="bg-fit" class="sel"><option value="cover">Fill the window</option><option value="contain">Fit inside</option><option value="tile">Tile</option></select><span></span></div>
      <div class="param"><label>Darken picture</label><input type="range" id="bg-dim" min="0" max="85" step="1"><span class="val" id="bg-dim-v"></span></div>
      <div class="param"><label>Panel opacity</label><input type="range" id="bg-glass" min="25" max="100" step="1"><span class="val" id="bg-glass-v"></span></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin:4px 0 0 130px"><input type="checkbox" id="bg-auto"> Keep text readable (darkens bright backgrounds just enough)</label>
      <p class="hint" style="color:var(--dim);margin:8px 0">Lower the panel opacity to see more of your picture or colour behind the timeline and mixer. You can also drop a picture file onto the window. Saved on this computer only.</p>
      <input type="file" id="bg-file" accept="image/*" hidden>
      <div class="row" style="justify-content:flex-start"><button class="btn" id="bg-reset">Reset background</button></div>`;
    const q = (id) => root.querySelector('#' + id);
    const sync = () => {
      const c = B.get();
      q('bg-color').value = c.color;
      q('bg-fit').value = c.fit;
      q('bg-dim').value = Math.round(c.dim * 100);
      q('bg-dim-v').textContent = Math.round(c.dim * 100) + '%';
      q('bg-glass').value = Math.round(c.glass * 100);
      q('bg-glass-v').textContent = Math.round(c.glass * 100) + '%';
      q('bg-auto').checked = c.autoContrast !== false;
      q('bg-dim').disabled = !c.image && !c.live;
      q('bg-fit').disabled = q('bg-clear').disabled = !c.image;
      q('bg-live').value = c.live || '';
      q('bg-live-speed').value = Math.round((c.liveSpeed || 1) * 100);
      q('bg-live-speed-v').textContent = Math.round((c.liveSpeed || 1) * 100) + '%';
      q('bg-live-speed').disabled = !c.live;
    };
    q('bg-auto').onchange = (e) => { B.set({ autoContrast: e.target.checked }); sync(); };
    const ls = q('bg-live');
    ls.innerHTML = '<option value="">Off</option>' + Object.keys(SCENES).map((k) => '<option value="' + k + '">' + SCENES[k].name + '</option>').join('') + '<option value="video">Your video / GIF</option>';
    ls.onchange = async () => {
      if (ls.value === 'video') { const f = await mediaGet(); if (!f) { q('bg-live-file').click(); sync(); return; } }
      B.set({ live: ls.value || null, glass: ls.value && B.get().glass > 0.85 ? 0.72 : B.get().glass }); sync();
    };
    q('bg-live-pick').onclick = () => q('bg-live-file').click();
    q('bg-live-file').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await B.setLiveFile(f); sync(); } catch (err) { S.toast(err.message); } };
    q('bg-live-speed').oninput = (e) => { B.set({ liveSpeed: e.target.value / 100 }); sync(); };
    for (const col of SWATCHES) {
      const b = document.createElement('button');
      b.title = col;
      b.style.cssText = 'width:22px;height:22px;border-radius:5px;border:1px solid var(--line);cursor:pointer;background:' + col;
      b.onclick = () => {
        B.set({ color: col, glass: B.get().glass > 0.9 ? 0.75 : B.get().glass });
        sync();
      };
      q('bg-sw').appendChild(b);
    }
    q('bg-color').oninput = (e) => {
      B.set({ color: e.target.value, glass: B.get().glass > 0.9 ? 0.75 : B.get().glass });
      sync();
    };
    q('bg-pick').onclick = () => q('bg-file').click();
    q('bg-file').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        await B.setImageFile(f);
        sync();
      } catch (err) {
        S.toast('Could not use that picture: ' + err.message);
      }
    };
    q('bg-clear').onclick = () => {
      B.set({ image: null });
      sync();
    };
    q('bg-fit').onchange = (e) => B.set({ fit: e.target.value });
    q('bg-dim').oninput = (e) => {
      B.set({ dim: e.target.value / 100 });
      sync();
    };
    q('bg-glass').oninput = (e) => {
      B.set({ glass: e.target.value / 100 });
      sync();
    };
    q('bg-reset').onclick = () => {
      B.reset();
      sync();
    };
    sync();
    return { sync };
  };

  /** Standalone Background dialog (kept for direct access; Settings embeds B.controls instead). */
  B.dialog = () => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = '<h3>Background</h3><div class="bg-controls"></div><div class="row"><button class="btn primary" id="bg-done">Done</button></div>';
    B.controls(dlg.querySelector('.bg-controls'));
    dlg.querySelector('#bg-done').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  };
})();
