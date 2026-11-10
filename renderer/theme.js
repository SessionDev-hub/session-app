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
  const DEF = { accent: '#8b7bff', style: 'glass' };
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
      '<div class="th-seg"><button data-s="glass">Glass</button><button data-s="flat">Flat</button></div>';
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
    wrap.querySelectorAll('.th-seg button').forEach((b) => (b.onclick = () => { T.set({ style: b.dataset.s }); draw(); }));
    draw();
    box.appendChild(wrap);
  };
})();
