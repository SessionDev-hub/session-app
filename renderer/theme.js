/* Theme: accent colour (presets or any custom colour) and the Glass / Flat look.
 * Saved on this computer. Applied as early as possible so the app never flashes the old colour. */
(function () {
  const S = window.Studio || (window.Studio = {});
  const T = (S.theme = {});
  const KEY = 'ps.theme';
  T.PRESETS = [
    ['Violet', '#8b7bff'], ['Blue', '#3b82f6'], ['Cyan', '#22d3ee'], ['Mint', '#2dd4bf'], ['Green', '#22c55e'],
    ['Gold', '#fbbf24'], ['Orange', '#ff8a3c'], ['Red', '#ef4444'], ['Pink', '#f472b6'], ['Silver', '#a1a1aa'],
  ];
  const DEF = { accent: '#8b7bff', style: 'glass', tint: 12, flatOpacity: 92 };
  const read = () => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { return Object.assign({}, DEF); } };
  let cfg = read();
  const rgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0x8b7bff; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const css = (c) => c.join(', ');
  function apply() {
    const root = document.documentElement, st = root.style, a = rgb(cfg.accent);
    st.setProperty('--accent', 'rgb(' + css(a) + ')');
    st.setProperty('--accent-rgb', css(a));
    st.setProperty('--accent-light-rgb', css(mix(a, [255, 255, 255], 0.14)));
    st.setProperty('--accent-deep-rgb', css(mix(a, [20, 10, 60], 0.22)));
    st.setProperty('--accent-deeper-rgb', css(mix(a, [10, 5, 40], 0.42)));
    st.setProperty('--accent-soft', 'rgb(' + css(mix(a, [255, 255, 255], 0.62)) + ')');
    // Panels take their colour from the accent: `tint` % of the accent mixed into the dark panel colours.
    const t = Math.max(0, Math.min(40, +cfg.tint || 0)) / 100;
    const BASES = [[16, 17, 22], [23, 24, 30], [31, 33, 41], [42, 44, 54], [53, 56, 69]];
    BASES.forEach((b, i) => st.setProperty('--f-' + i, 'rgb(' + css(mix(b, a, t * (0.55 + i * 0.12))) + ')'));
    const op = Math.max(0.3, Math.min(1, (+cfg.flatOpacity || 92) / 100));
    st.setProperty('--flat-panel', 'rgba(' + css(mix(BASES[1], a, t * 0.7)) + ', ' + op + ')');
    st.setProperty('--panel-tint', 'rgba(' + css(a) + ', ' + (t * 0.45).toFixed(3) + ')');
    root.classList.toggle('ui-flat', cfg.style === 'flat');
  }
  T.get = () => Object.assign({}, cfg);
  T.set = (patch) => { cfg = Object.assign(cfg, patch); try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} apply(); };
  apply();

  /** Settings → Appearance: accent swatches + custom colour, and the Glass / Flat switch. */
  T.controls = (box) => {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="set-sec-t">Accent colour</div><p class="hint">Recolours buttons, highlights, sliders and selections everywhere.</p>' +
      '<div class="th-swatches"></div>' +
      '<div class="set-sec-t" style="margin-top:16px">Style</div><p class="hint">Glass = see-through panels with soft glow. Flat = solid and clean, a bit lighter on older computers.</p>' +
      '<div class="th-seg"><button data-s="glass">Glass</button><button data-s="flat">Flat</button></div>' +
      '<div class="param" style="margin-top:14px"><label>Panel colour</label><input type="range" class="th-tint" min="0" max="40" step="1"><span class="val th-tint-v"></span></div>' +
      '<p class="hint" style="margin:2px 0 0">How much of your accent colour goes into the panels, mixer strips and buttons. 0 = neutral grey.</p>' +
      '<div class="param th-op-row" style="margin-top:10px"><label>Flat panel opacity</label><input type="range" class="th-op" min="30" max="100" step="1"><span class="val th-op-v"></span></div>' +
      '<p class="hint th-op-hint" style="margin:2px 0 0">100% = fully solid panels. Lower lets your background show through (no blur).</p>';
    const sw = wrap.querySelector('.th-swatches');
    const draw = () => {
      sw.innerHTML = '';
      const cur = cfg.accent.toLowerCase();
      for (const [name, hex] of T.PRESETS) {
        const b = document.createElement('button');
        b.className = 'th-sw' + (hex === cur ? ' on' : ''); b.style.background = hex; b.title = name;
        b.onclick = () => { T.set({ accent: hex }); draw(); };
        sw.appendChild(b);
      }
      const lab = document.createElement('label'); lab.className = 'th-custom';
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = cur;
      inp.oninput = () => { T.set({ accent: inp.value }); };
      inp.onchange = () => draw();
      lab.append(inp, document.createTextNode(T.PRESETS.some((p) => p[1] === cur) ? 'Custom…' : 'Custom ' + cur));
      sw.appendChild(lab);
      wrap.querySelectorAll('.th-seg button').forEach((b) => b.classList.toggle('on', b.dataset.s === cfg.style));
    };
    wrap.querySelectorAll('.th-seg button').forEach((b) => (b.onclick = () => { T.set({ style: b.dataset.s }); draw(); syncSliders(); }));
    const tint = wrap.querySelector('.th-tint'), op = wrap.querySelector('.th-op');
    const syncSliders = () => {
      tint.value = cfg.tint; wrap.querySelector('.th-tint-v').textContent = cfg.tint + '%';
      op.value = cfg.flatOpacity; wrap.querySelector('.th-op-v').textContent = cfg.flatOpacity + '%';
      const flat = cfg.style === 'flat';
      op.disabled = !flat; wrap.querySelector('.th-op-row').style.opacity = flat ? 1 : 0.45;
      wrap.querySelector('.th-op-hint').textContent = flat ? '100% = fully solid panels. Lower lets your background show through (no blur).' : 'Switch Style to Flat to use this. (In Glass, use Panel opacity under Background.)';
    };
    tint.oninput = () => { T.set({ tint: +tint.value }); syncSliders(); };
    op.oninput = () => { T.set({ flatOpacity: +op.value }); syncSliders(); };
    syncSliders();
    draw();
    box.appendChild(wrap);
  };
})();
