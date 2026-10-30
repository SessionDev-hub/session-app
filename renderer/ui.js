/* Shared UI pieces: icons, track colours, the effect chain (track headers + mixer) and the effect picker. */
(function () {
  const S = window.Studio;
  const U = (S.ui = {});

  /* ---------- icons (24px grid, stroke = currentColor) ---------- */
  const P = {
    record: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    pointer: '<path d="M5 3.5 18.5 12l-6 1.5L9 19.5z" fill="currentColor" fill-opacity=".2"/>',
    eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21z"/><path d="M22 21H7M5.5 12.5l6 6"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    magnet: '<path d="M6 15V8a6 6 0 0 1 12 0v7"/><path d="M6 15a6 6 0 0 0 12 0"/><path d="M6 11h3M15 11h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v11a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 11H7.6a2 2 0 0 0-1.9 1.4L3 20"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    export: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    import: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
    cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    wand: '<path d="m15 4 5 5L9 20l-5-5z"/><path d="m13 6 5 5M5 3v4M3 5h4M19 15v4M17 17h4"/>',
    note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    balance: '<path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
    power: '<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    mixer: '<path d="M6 3v18M12 3v18M18 3v18"/><rect x="3.5" y="13" width="5" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="7" width="5" height="3" rx="1" fill="currentColor"/><rect x="15.5" y="15" width="5" height="3" rx="1" fill="currentColor"/>',
    fx: '<path d="M4 17c3 0 3-10 6-10s3 10 6 10 3-6 4-6"/>',
    home: '<path d="M5 5v14M19 5l-9 7 9 7z" fill="currentColor" fill-opacity=".2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    vault: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5v-1M12 16.5v-1M15.5 12h1M7.5 12h1M7 20v1.5M17 20v1.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  };

  U.icon = (name, size = 16) =>
    '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';

  /** Put the icon named in data-icon in front of each button's label (once). */
  U.applyIcons = (root = document) => {
    for (const el of root.querySelectorAll('[data-icon]')) {
      if (el.querySelector(':scope > svg.ic')) continue;
      el.insertAdjacentHTML('afterbegin', U.icon(el.dataset.icon, +el.dataset.size || 16));
    }
  };

  /* ---------- track colours ---------- */
  U.TRACK_COLORS = ['#8b5cf6', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#a3e635', '#fb7185', '#2dd4bf', '#f97316'];
  const COLOR_NAMES = ['Violet', 'Cyan', 'Mint', 'Amber', 'Pink', 'Blue', 'Lime', 'Rose', 'Teal', 'Orange'];
  // track.color is either a hex string (custom pick) or a number (index into the presets, older projects).
  U.trackColor = (t) => {
    const c = t && t.color;
    if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    const n = U.TRACK_COLORS.length;
    return U.TRACK_COLORS[(((Number(c) || 0) % n) + n) % n];
  };
  U.rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };
  const toHex6 = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : U.TRACK_COLORS[0]);

  // colour maths
  const hsvToRgb = (h, s, v) => {
    h = ((h % 360) + 360) % 360 / 60;
    const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const r = [v, q, p, p, t, v][i % 6], g = [t, v, v, q, p, p][i % 6], b = [p, p, t, v, v, q][i % 6];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  };
  const rgbToHsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  };
  const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');

  /** Popover to recolour a track: a smooth colour wheel + value slider, presets, and a hex box. */
  U.colorMenu = (track, x, y) => {
    if (S.clips && S.clips.closeMenu) S.clips.closeMenu();
    closeColorPop();
    const original = track.color;
    let pushed = false;
    const ensurePush = () => { if (!pushed) { S.history.push(); pushed = true; } };

    let [h, s, v] = rgbToHsv(...hexToRgb(toHex6(U.trackColor(track))));

    const pop = document.createElement('div');
    pop.className = 'ctxmenu color-pop';
    pop.innerHTML =
      '<div class="color-grid"></div>' +
      '<div class="cw">' +
      '  <div class="cw-wheel"><div class="cw-dim"></div><div class="cw-thumb"></div></div>' +
      '  <div class="cw-val"><div class="cw-val-thumb"></div></div>' +
      '</div>' +
      '<div class="color-custom"><i class="color-prev"></i><input class="txt color-hex" maxlength="7" spellcheck="false"></div>';
    const grid = pop.querySelector('.color-grid');
    const wheel = pop.querySelector('.cw-wheel');
    const dim = pop.querySelector('.cw-dim');
    const thumb = pop.querySelector('.cw-thumb');
    const valBar = pop.querySelector('.cw-val');
    const valThumb = pop.querySelector('.cw-val-thumb');
    const prev = pop.querySelector('.color-prev');
    const hex = pop.querySelector('.color-hex');

    const swatches = U.TRACK_COLORS.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-sw';
      b.style.background = c;
      b.title = COLOR_NAMES[i];
      b.onclick = () => { [h, s, v] = rgbToHsv(...hexToRgb(c)); apply(true); };
      grid.appendChild(b);
      return b;
    });

    // live apply: cheap during drag (canvas redraws itself), full sync when committed
    let raf = 0;
    const applyLive = () => {
      ensurePush();
      const hexv = rgbToHex(...hsvToRgb(h, s, v));
      track.color = hexv;
      S.timeline.dirty = true; // the timeline canvas repaints next frame — smooth
      redrawUI(hexv);
    };
    const apply = (commit) => {
      if (raf) cancelAnimationFrame(raf);
      applyLive();
      if (commit) { S.refresh.structure(); closeColorPop(); }
    };
    const scheduleLive = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; applyLive(); }); };

    const R = 84; // wheel radius (matches CSS 168px)
    function redrawUI(hexv) {
      const a = (h * Math.PI) / 180; // 0 = top, clockwise
      const rr = s * R;
      thumb.style.left = R + Math.sin(a) * rr + 'px';
      thumb.style.top = R - Math.cos(a) * rr + 'px';
      dim.style.opacity = String(1 - v);
      const full = rgbToHex(...hsvToRgb(h, s, 1));
      valBar.style.background = 'linear-gradient(to top, #000, ' + full + ')';
      valThumb.style.top = (1 - v) * 100 + '%';
      prev.style.background = hexv;
      thumb.style.background = hexv;
      if (document.activeElement !== hex) hex.value = hexv;
      const cur = hexv.toLowerCase();
      swatches.forEach((b, i) => b.classList.toggle('on', U.TRACK_COLORS[i].toLowerCase() === cur));
    }

    // wheel drag -> hue (angle) + saturation (radius)
    const wheelPick = (e) => {
      const rect = wheel.getBoundingClientRect();
      const dx = e.clientX - (rect.left + R), dy = e.clientY - (rect.top + R);
      h = (Math.atan2(dx, -dy) * 180) / Math.PI;
      s = Math.min(1, Math.hypot(dx, dy) / R);
      scheduleLive();
    };
    wheel.addEventListener('pointerdown', (e) => { wheel.setPointerCapture(e.pointerId); wheelPick(e); });
    wheel.addEventListener('pointermove', (e) => { if (e.buttons) wheelPick(e); });
    wheel.addEventListener('pointerup', () => S.refresh.structure());

    // value slider
    const valPick = (e) => {
      const rect = valBar.getBoundingClientRect();
      v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      scheduleLive();
    };
    valBar.addEventListener('pointerdown', (e) => { valBar.setPointerCapture(e.pointerId); valPick(e); });
    valBar.addEventListener('pointermove', (e) => { if (e.buttons) valPick(e); });
    valBar.addEventListener('pointerup', () => S.refresh.structure());

    hex.oninput = () => {
      let val = hex.value.trim();
      if (val && val[0] !== '#') val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) { [h, s, v] = rgbToHsv(...hexToRgb(val)); applyLive(); }
    };
    hex.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') apply(true); };
    hex.onblur = () => S.refresh.structure();

    redrawUI(rgbToHex(...hsvToRgb(h, s, v)));

    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    pop.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    colorPop = pop;
    const away = (e) => { if (colorPop && !colorPop.contains(e.target)) { S.refresh.structure(); closeColorPop(); } };
    const esc = (e) => {
      if (e.key === 'Escape') {
        if (pushed) { track.color = original; S.refresh.structure(); }
        closeColorPop();
      }
    };
    pop._cleanup = () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
  };

  let colorPop = null;
  function closeColorPop() {
    if (colorPop) {
      colorPop._cleanup && colorPop._cleanup();
      colorPop.remove();
      colorPop = null;
    }
  }
  U.closeColorMenu = closeColorPop;

  /* ---------- effects ---------- */
  const fxArrays = () => [...S.project.tracks.map((t) => t.fx), S.project.master.fx];

  U.addFx = (fxArr, def) => {
    S.history.push();
    const fx = { id: S.uid(), pluginId: def.id, params: S.defaultParams(def), bypass: false };
    fxArr.push(fx);
    S.refresh.structure();
    return fx;
  };

  /** Move an effect to position `index` of `target` (same or another track). */
  U.moveFx = (fxId, target, index) => {
    let src = null;
    let from = -1;
    for (const arr of fxArrays()) {
      const i = arr.findIndex((f) => f.id === fxId);
      if (i >= 0) {
        src = arr;
        from = i;
        break;
      }
    }
    if (!src) return false;
    if (src === target && (index === from || index === from + 1)) return false;
    S.history.push();
    const [fx] = src.splice(from, 1);
    if (src === target && from < index) index--;
    target.splice(S.clamp(index, 0, target.length), 0, fx);
    S.refresh.structure();
    return true;
  };

  /** Searchable list of every effect (built-in, your plugins, VST3). Calls onPick(def). */
  U.fxPicker = (x, y, onPick) => {
    document.querySelectorAll('.fx-picker').forEach((n) => n.remove());
    const box = document.createElement('div');
    box.className = 'fx-picker';
    box.innerHTML = '<div class="fp-search">' + U.icon('search', 14) + '<input placeholder="Search effects…" spellcheck="false"></div><div class="fp-list"></div>';
    const input = box.querySelector('input');
    const list = box.querySelector('.fp-list');
    const all = S.pluginsOfType('effect').sort((a, b) => a.name.localeCompare(b.name));
    let active = 0;
    let shown = [];
    const close = () => {
      box.remove();
      window.removeEventListener('mousedown', away, true);
    };
    const away = (e) => !box.contains(e.target) && close();
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = all.filter((d) => !q || d.name.toLowerCase().includes(q));
      active = S.clamp(active, 0, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      const ORDER = ['EQ', 'Dynamics', 'Mastering', 'Reverb', 'Delay', 'Distortion', 'Filter', 'Creative', 'Utility'];
      const cats = [...new Set(shown.filter((d) => !d.native).map((d) => d.category || 'Other'))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
      const groups = [...cats.map((c) => [c, shown.filter((d) => !d.native && (d.category || 'Other') === c)]), ['VST3 plugins', shown.filter((d) => d.native)]];
      let i = 0;
      for (const [title, defs] of groups) {
        if (!defs.length) continue;
        const h = document.createElement('div');
        h.className = 'fp-group';
        h.textContent = title;
        list.appendChild(h);
        for (const d of defs) {
          const idx = shown.indexOf(d);
          const row = document.createElement('div');
          row.className = 'fp-item' + (idx === active ? ' active' : '');
          row.innerHTML = U.icon(d.native ? 'cube' : 'fx', 14) + '<span class="fp-n"><b></b><small></small></span>';
          row.querySelector('b').textContent = d.name.replace(/ \(VST3\)$/, '');
          row.querySelector('small').textContent = d.description || '';
          if (d.color) row.style.setProperty('--fc', d.color);
          row.onmouseenter = () => {
            active = idx;
            list.querySelectorAll('.fp-item').forEach((n) => n.classList.toggle('active', n === row));
          };
          row.onclick = () => {
            close();
            onPick(d);
          };
          list.appendChild(row);
          i++;
        }
      }
      if (!i) list.innerHTML = '<div class="fp-empty">No effect matches</div>';
    };
    input.oninput = () => {
      active = 0;
      render();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = S.clamp(active + (e.key === 'ArrowDown' ? 1 : -1), 0, shown.length - 1);
        render();
      } else if (e.key === 'Enter' && shown[active]) {
        const d = shown[active];
        close();
        onPick(d);
      }
      e.stopPropagation();
    };
    document.body.appendChild(box);
    render();
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
    box.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
    setTimeout(() => window.addEventListener('mousedown', away, true));
    input.focus();
  };

  /**
   * The effect chain for one track (or the master when owner is null).
   * compact = one row of chips for a track header; otherwise a vertical insert list for a mixer strip.
   * Chips can be dragged to reorder, or onto another track to move the effect there.
   */
  U.fxChain = (fxArr, owner, { compact = false } = {}) => {
    const box = document.createElement('div');
    box.className = compact ? 'fx-chips' : 'fx-inserts';
    const dropIndex = (e) => {
      const items = [...box.querySelectorAll('.fx-chip')];
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (compact ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) return i;
      }
      return items.length;
    };
    box.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-ps-fx')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      box.classList.add('drop');
    });
    box.addEventListener('dragleave', (e) => {
      if (!box.contains(e.relatedTarget)) box.classList.remove('drop');
    });
    box.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('text/x-ps-fx');
      box.classList.remove('drop');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      U.moveFx(id, fxArr, dropIndex(e));
    });

    fxArr.forEach((fx, i) => {
      const def = S.plugins.get(fx.pluginId);
      const chip = document.createElement('div');
      chip.className = 'fx-chip' + (fx.bypass ? ' bypassed' : '') + (def ? '' : ' missing');
      chip.draggable = true;
      chip.title = (def ? def.name : fx.pluginId + ' (missing)') + '\nClick: open · Drag: reorder or move to another track';
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-ps-fx', fx.id);
        e.dataTransfer.effectAllowed = 'move';
        chip.classList.add('dragging');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));

      const pw = document.createElement('button');
      pw.className = 'fx-pw';
      pw.title = fx.bypass ? 'Turn on' : 'Bypass';
      pw.innerHTML = U.icon('power', 11);
      pw.onclick = (e) => {
        e.stopPropagation();
        S.history.push();
        fx.bypass = !fx.bypass;
        S.refresh.structure();
      };
      const name = document.createElement('span');
      name.className = 'fx-name';
      if (!compact) name.dataset.slot = i + 1;
      name.textContent = def ? def.name.replace(/ \(VST3\)$/, '') : fx.pluginId + ' (missing)';
      const rm = document.createElement('button');
      rm.className = 'fx-rm';
      rm.title = 'Remove effect';
      rm.innerHTML = U.icon('x', 11);
      rm.onclick = (e) => {
        e.stopPropagation();
        S.history.push();
        fxArr.splice(fxArr.indexOf(fx), 1);
        S.refresh.structure();
      };
      chip.onclick = () => S.openPluginEditor(fx, owner);
      chip.append(pw, name, rm);
      box.appendChild(chip);
    });

    const add = document.createElement('button');
    add.className = 'fx-add';
    add.title = 'Add an effect to ' + (owner ? '"' + owner.name + '"' : 'the master') + '. It stays on this track and processes every clip on it.';
    add.innerHTML = U.icon('plus', 12) + '<span>' + (compact ? (fxArr.length ? '' : 'FX') : 'Add effect') + '</span>';
    add.onclick = (e) => {
      const r = add.getBoundingClientRect();
      U.fxPicker(r.left, r.bottom + 4, (def) => U.addFx(fxArr, def));
      e.stopPropagation();
    };
    box.appendChild(add);
    return box;
  };
})();
