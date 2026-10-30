/* Custom background: any colour or your own picture, with adjustable dimming and panel see-through.
 * This is an app preference (saved on this computer), not part of a session file. */
(function () {
  const S = window.Studio;
  const B = (S.background = {});
  const KEY = 'ps.background';
  const DEFAULTS = { color: '#0b0c10', image: null, fit: 'cover', dim: 0.3, glass: 1 };
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
    layer.style.setProperty('--dim', cfg.image ? cfg.dim : 0);
    if (S.timeline) S.timeline.dirty = true;
  }

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
      <div class="param"><label>Picture</label><span style="display:flex;gap:6px"><button class="btn" id="bg-pick">Choose picture…</button><button class="btn" id="bg-clear">Remove</button></span><span></span></div>
      <div class="param"><label>Picture fit</label><select id="bg-fit" class="sel"><option value="cover">Fill the window</option><option value="contain">Fit inside</option><option value="tile">Tile</option></select><span></span></div>
      <div class="param"><label>Darken picture</label><input type="range" id="bg-dim" min="0" max="85" step="1"><span class="val" id="bg-dim-v"></span></div>
      <div class="param"><label>Panel opacity</label><input type="range" id="bg-glass" min="25" max="100" step="1"><span class="val" id="bg-glass-v"></span></div>
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
      q('bg-dim').disabled = q('bg-fit').disabled = q('bg-clear').disabled = !c.image;
    };
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
