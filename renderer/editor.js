/* Plugin window: a floating, draggable editor for any JavaScript effect.
 * Header (brand, presets, bypass, reset), a live display (EQ curve, compressor graph, gain reduction,
 * reverb decay, delay taps, step pattern, transfer curve or spectrum), rotary knobs in sections,
 * and input / output meters. Plugins describe themselves with optional fields: category, color,
 * description, layout, presets, visual, params[].hidden — see plugins/README.md. */
(function () {
  const S = window.Studio;
  const open = new Map(); // fxId -> window state
  let zTop = 200;
  let cascade = 0;

  const CAT_COLORS = { EQ: '#22d3ee', Dynamics: '#8b7bff', Mastering: '#f59e0b', Reverb: '#60a5fa', Delay: '#34d399', Distortion: '#f97316', Creative: '#fb7185', Filter: '#2dd4bf', Utility: '#94a3b8' };

  /* ---------- formatting ---------- */
  function fmt(v, p) {
    if (typeof v === 'boolean') return v ? 'On' : 'Off';
    if (typeof v !== 'number') return String(v);
    const u = p.unit || '';
    const a = Math.abs(v);
    if (u === 'Hz') return a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
    if (u === 'dB') return (v > 0.05 ? '+' : '') + (Math.abs(v) < 0.05 ? 0 : v).toFixed(1) + ' dB';
    if (u === 'ms') return a >= 1000 ? (v / 1000).toFixed(2) + ' s' : (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ms';
    if (u === 's') return a < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
    if (u === '%') return Math.round(v) + '%';
    if (u === ':1') return (v >= 19.95 ? '∞' : v.toFixed(1)) + ':1';
    if (u === '×') return v.toFixed(2) + '×';
    if (p.step >= 1 && Number.isInteger(p.step)) return Math.round(v) + (u ? ' ' + u : '');
    const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
    return s + (u ? ' ' + u : '');
  }

  const isLog = (p) => p.scale === 'log' && p.min > 0;
  const toPos = (v, p) => S.clamp(isLog(p) ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min), 0, 1);
  function fromPos(t, p) {
    let v = isLog(p) ? p.min * Math.pow(p.max / p.min, t) : p.min + t * (p.max - p.min);
    if (p.step) v = Math.round(v / p.step) * p.step;
    return S.clamp(+v.toFixed(6), p.min, p.max);
  }
  function parseTyped(text, p) {
    let t = String(text).trim().toLowerCase().replace(',', '.');
    let mul = 1;
    if (/k(hz)?$/.test(t)) mul = 1000;
    if (p.unit === 'ms' && /\ds$/.test(t) && !/ms$/.test(t)) mul = 1000;
    const n = parseFloat(t);
    return Number.isFinite(n) ? S.clamp(n * mul, p.min, p.max) : null;
  }

  /* ---------- small DOM helpers ---------- */
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- rotary knob ---------- */
  function knob(p, get, set, begin, { big = false } = {}) {
    const wrap = el('div', 'pk' + (big ? ' big' : ''));
    const label = el('div', 'pk-label');
    label.textContent = p.name;
    const size = big ? 96 : 54;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 60 60');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.classList.add('pk-dial');
    svg.setAttribute('tabindex', '0');
    svg.innerHTML =
      '<circle class="pk-ring" cx="30" cy="30" r="25"/>' +
      '<path class="pk-track" fill="none" stroke-width="4" stroke-linecap="round"/>' +
      '<path class="pk-arc" fill="none" stroke-width="4" stroke-linecap="round"/>' +
      '<circle class="pk-cap" cx="30" cy="30" r="17"/>' +
      '<line class="pk-ptr" x1="30" y1="30" x2="30" y2="17" stroke-width="2.5" stroke-linecap="round"/>';
    const value = el('div', 'pk-value');
    const R = 25;
    const pt = (deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [30 + R * Math.cos(a), 30 + R * Math.sin(a)];
    };
    const arc = (a0, a1) => {
      if (Math.abs(a1 - a0) < 0.5) return '';
      const [x0, y0] = pt(a0);
      const [x1, y1] = pt(a1);
      return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + R + ' ' + R + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
    };
    svg.querySelector('.pk-track').setAttribute('d', arc(-135, 135));
    const bipolar = p.min < 0 && p.max > 0;
    const draw = () => {
      const v = get();
      const t = toPos(v, p);
      const deg = -135 + t * 270;
      const zero = bipolar ? -135 + toPos(0, p) * 270 : -135;
      svg.querySelector('.pk-arc').setAttribute('d', arc(Math.min(zero, deg), Math.max(zero, deg)));
      svg.querySelector('.pk-ptr').setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 30 30)');
      value.textContent = fmt(v, p);
    };
    // drag up/down (Shift = fine), wheel, double-click = default, click the value to type
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      svg.focus();
      svg.setPointerCapture(e.pointerId);
      begin();
      wrap.classList.add('active');
      let y0 = e.clientY;
      let t0 = toPos(get(), p);
      const move = (ev) => {
        const fine = ev.shiftKey ? 0.15 : 1;
        const t = S.clamp(t0 + ((y0 - ev.clientY) / 220) * fine, 0, 1);
        if (ev.shiftKey !== move.shift) {
          // re-anchor when Shift changes so the knob never jumps
          move.shift = ev.shiftKey;
          y0 = ev.clientY;
          t0 = toPos(get(), p);
          return;
        }
        set(fromPos(t, p));
        draw();
      };
      move.shift = e.shiftKey;
      const up = () => {
        wrap.classList.remove('active');
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        svg.removeEventListener('pointercancel', up);
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
    });
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        begin(true);
        const d = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.004 : 0.02);
        set(fromPos(S.clamp(toPos(get(), p) + d, 0, 1), p));
        draw();
      },
      { passive: false }
    );
    svg.addEventListener('dblclick', () => {
      begin();
      set(p.default);
      draw();
    });
    svg.addEventListener('keydown', (e) => {
      const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      begin(true);
      set(fromPos(S.clamp(toPos(get(), p) + k * (e.shiftKey ? 0.005 : 0.025), 0, 1), p));
      draw();
    });
    value.title = 'Click to type a value';
    value.addEventListener('click', () => {
      const inp = el('input', 'pk-input');
      inp.value = String(+get().toFixed(3));
      value.replaceWith(inp);
      inp.focus();
      inp.select();
      const done = (commit) => {
        if (commit) {
          const v = parseTyped(inp.value, p);
          if (v != null) {
            begin();
            set(p.step ? Math.round(v / p.step) * p.step : v);
          }
        }
        inp.replaceWith(value);
        draw();
      };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      inp.addEventListener('blur', () => inp.isConnected && done(true));
    });
    wrap.append(label, svg, value);
    draw();
    return { el: wrap, draw };
  }

  function segmented(p, get, set, begin) {
    const wrap = el('div', 'pk pk-sel');
    const label = el('div', 'pk-label');
    label.textContent = p.name;
    wrap.appendChild(label);
    let draw;
    if (p.options.length <= 4) {
      const seg = el('div', 'seg');
      const btns = p.options.map((o) => {
        const b = el('button', 'seg-b');
        b.textContent = o;
        b.onclick = () => {
          begin();
          set(o);
          draw();
        };
        seg.appendChild(b);
        return b;
      });
      draw = () => btns.forEach((b, i) => b.classList.toggle('on', p.options[i] === String(get())));
      wrap.appendChild(seg);
    } else {
      const sel = el('select', 'sel pw-select');
      for (const o of p.options) {
        const opt = el('option');
        opt.value = o;
        opt.textContent = o;
        sel.appendChild(opt);
      }
      sel.onchange = () => {
        begin();
        set(sel.value);
      };
      draw = () => (sel.value = String(get()));
      wrap.appendChild(sel);
    }
    draw();
    return { el: wrap, draw };
  }

  function toggle(p, get, set, begin) {
    const wrap = el('div', 'pk pk-tog');
    const label = el('div', 'pk-label');
    label.textContent = p.name;
    const b = el('button', 'tog', '<i></i>');
    const value = el('div', 'pk-value');
    const draw = () => {
      b.classList.toggle('on', !!get());
      value.textContent = get() ? 'On' : 'Off';
    };
    b.onclick = () => {
      begin();
      set(!get());
      draw();
    };
    wrap.append(label, b, value);
    draw();
    return { el: wrap, draw };
  }

  /* ---------- canvas helpers ---------- */
  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };
  const F_MIN = 20;
  const F_MAX = 20000;
  const fx2x = (f, w) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
  const x2f = (x, w) => F_MIN * Math.pow(F_MAX / F_MIN, S.clamp(x / w, 0, 1));

  function drawFreqGrid(g, w, h, dbRange) {
    g.font = '10px Segoe UI, system-ui, sans-serif';
    g.textBaseline = 'top';
    for (const f of [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(fx2x(f, w)) + 0.5;
      g.fillStyle = 'rgba(255,255,255,.05)';
      g.fillRect(x, 0, 1, h);
      g.fillStyle = 'rgba(255,255,255,.32)';
      g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, h - 13);
    }
    if (dbRange) {
      g.textBaseline = 'middle';
      for (let db = -dbRange; db <= dbRange; db += 6) {
        const y = Math.round(h / 2 - (db / dbRange) * (h / 2 - 10)) + 0.5;
        g.fillStyle = db === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.045)';
        g.fillRect(0, y, w, 1);
        if (db !== -dbRange && db !== dbRange) {
          g.fillStyle = 'rgba(255,255,255,.3)';
          g.fillText((db > 0 ? '+' : '') + db, 4, y - 6);
        }
      }
    }
  }

  function drawSpectrum(g, w, h, an, color, alpha = 0.18) {
    if (!an) return;
    const n = an.frequencyBinCount;
    if (!an._buf || an._buf.length !== n) an._buf = new Float32Array(n);
    an.getFloatFrequencyData(an._buf);
    const sr = an.context.sampleRate;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 2) {
      const f = x2f(x, w);
      const bin = Math.min(n - 1, Math.round((f / (sr / 2)) * n));
      const db = an._buf[bin];
      const y = h - S.clamp((db + 100) / 90, 0, 1) * h;
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, hexA(color, alpha * 1.6));
    grd.addColorStop(1, hexA(color, alpha * 0.2));
    g.fillStyle = grd;
    g.fill();
  }

  function peakDb(an) {
    if (!an) return -120;
    if (!an._t || an._t.length !== an.fftSize) an._t = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(an._t);
    let m = 0;
    for (let i = 0; i < an._t.length; i++) m = Math.max(m, Math.abs(an._t[i]));
    return m > 1e-6 ? 20 * Math.log10(m) : -120;
  }

  /* ---------- displays ---------- */
  const VIS = {};

  VIS.spectrum = {
    draw(st, g, w, h) {
      drawFreqGrid(g, w, h, 0);
      drawSpectrum(g, w, h, st.anOut, st.color, 0.35);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      g.textBaseline = 'top';
      g.fillText('OUTPUT SPECTRUM', 10, 8);
    },
  };

  VIS.eq = {
    pts(st, w, h) {
      const v = st.def.visual;
      const RNG = 18;
      const resp = st.response;
      return v.bands.map((b, i) => {
        const f = st.val(b.freq);
        const x = fx2x(f, w);
        let y;
        if (b.gain) y = h / 2 - (st.val(b.gain) / RNG) * (h / 2 - 10);
        else {
          const k = Math.round((x / w) * (resp ? resp.length - 1 : 0));
          y = h / 2 - ((resp ? resp[k] : 0) / RNG) * (h / 2 - 10);
        }
        return { b, i, x, y: S.clamp(y, 8, h - 8), on: b.on ? !!st.val(b.on) : true };
      });
    },
    draw(st, g, w, h) {
      const RNG = 18;
      drawFreqGrid(g, w, h, RNG);
      drawSpectrum(g, w, h, st.anOut, st.color, 0.16);
      const raw = st.raw();
      const N = 320;
      if (!st.freqs || st.freqs.length !== N) {
        st.freqs = new Float32Array(N);
        for (let i = 0; i < N; i++) st.freqs[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (N - 1));
      }
      st.response = raw && raw.getResponse ? raw.getResponse(st.freqs) : new Float32Array(N);
      const yOf = (db) => h / 2 - (S.clamp(db, -RNG * 1.3, RNG * 1.3) / RNG) * (h / 2 - 10);
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        i ? g.lineTo(x, yOf(st.response[i])) : g.moveTo(x, yOf(st.response[i]));
      }
      g.save();
      g.lineTo(w, h / 2);
      g.lineTo(0, h / 2);
      g.closePath();
      g.fillStyle = hexA(st.color, 0.13);
      g.fill();
      g.restore();
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        i ? g.lineTo(x, yOf(st.response[i])) : g.moveTo(x, yOf(st.response[i]));
      }
      g.shadowColor = hexA(st.color, 0.8);
      g.shadowBlur = 10;
      g.strokeStyle = st.color;
      g.lineWidth = 2;
      g.stroke();
      g.shadowBlur = 0;
      for (const p of this.pts(st, w, h)) {
        const hot = st.hot === p.i;
        g.beginPath();
        g.arc(p.x, p.y, hot ? 9 : 7.5, 0, Math.PI * 2);
        g.fillStyle = p.on ? (hot ? '#ffffff' : hexA(st.color, 0.9)) : 'rgba(120,124,135,.5)';
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(0,0,0,.6)';
        g.stroke();
        g.fillStyle = p.on ? '#071318' : '#d4d6dd';
        g.font = '700 9px Segoe UI, system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(p.b.label.length > 2 ? p.b.label[0] : p.b.label, p.x, p.y + 0.5);
        g.textAlign = 'left';
      }
      if (st.hot != null) {
        const b = st.def.visual.bands[st.hot];
        const txt = b.label + '  ' + fmt(st.val(b.freq), { unit: 'Hz' }) + (b.gain ? '  ' + fmt(st.val(b.gain), { unit: 'dB' }) : '') + (b.q ? '  Q ' + st.val(b.q).toFixed(2) : '');
        g.font = '600 11px Segoe UI, system-ui, sans-serif';
        const tw = g.measureText(txt).width + 16;
        g.fillStyle = 'rgba(8,9,12,.85)';
        g.beginPath();
        g.roundRect(w - tw - 10, 8, tw, 22, 6);
        g.fill();
        g.fillStyle = '#e9eaf0';
        g.textBaseline = 'middle';
        g.fillText(txt, w - tw - 2, 19);
      }
    },
    hit(st, x, y, w, h) {
      let best = null;
      let bd = 14;
      for (const p of this.pts(st, w, h)) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          best = p.i;
        }
      }
      return best;
    },
    pointer(st, cv) {
      const pos = (e) => {
        const r = cv.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
      };
      cv.addEventListener('pointermove', (e) => {
        if (st.dragBand != null) return;
        const p = pos(e);
        const hot = this.hit(st, p.x, p.y, p.w, p.h);
        st.hot = hot;
        cv.style.cursor = hot != null ? 'grab' : 'default';
      });
      cv.addEventListener('pointerleave', () => st.dragBand == null && (st.hot = null));
      cv.addEventListener('pointerdown', (e) => {
        const p = pos(e);
        const i = this.hit(st, p.x, p.y, p.w, p.h);
        if (i == null) return;
        const b = st.def.visual.bands[i];
        st.begin();
        if (b.on && !st.val(b.on)) st.set(b.on, true);
        st.dragBand = i;
        st.hot = i;
        cv.setPointerCapture(e.pointerId);
        cv.style.cursor = 'grabbing';
        const move = (ev) => {
          const q = pos(ev);
          const pf = st.param(b.freq);
          st.set(b.freq, fromPos(toPos(x2f(q.x, q.w), pf), pf));
          if (b.gain) {
            const pg = st.param(b.gain);
            st.set(b.gain, fromPos(toPos(S.clamp(((q.h / 2 - q.y) / (q.h / 2 - 10)) * 18, pg.min, pg.max), pg), pg));
          }
        };
        const up = () => {
          st.dragBand = null;
          cv.style.cursor = 'grab';
          cv.removeEventListener('pointermove', move);
          cv.removeEventListener('pointerup', up);
        };
        cv.addEventListener('pointermove', move);
        cv.addEventListener('pointerup', up);
      });
      cv.addEventListener(
        'wheel',
        (e) => {
          const p = pos(e);
          const i = this.hit(st, p.x, p.y, p.w, p.h);
          if (i == null) return;
          const b = st.def.visual.bands[i];
          if (!b.q) return;
          e.preventDefault();
          st.begin(true);
          const pq = st.param(b.q);
          st.set(b.q, fromPos(S.clamp(toPos(st.val(b.q), pq) + (e.deltaY < 0 ? 0.03 : -0.03), 0, 1), pq));
        },
        { passive: false }
      );
      cv.addEventListener('dblclick', (e) => {
        const p = pos(e);
        const i = this.hit(st, p.x, p.y, p.w, p.h);
        if (i == null) return;
        const b = st.def.visual.bands[i];
        if (!b.on) return;
        st.begin();
        st.set(b.on, !st.val(b.on));
      });
    },
    hint: 'Drag a point to change frequency and gain · scroll on it for Q · double-click to turn a band on/off',
  };

  function grBars(g, x, y, w, h, values, labels, color) {
    const n = values.length;
    const bw = (w - (n - 1) * 8) / n;
    g.font = '600 10px Segoe UI, system-ui, sans-serif';
    g.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const bx = x + i * (bw + 8);
      g.fillStyle = 'rgba(0,0,0,.4)';
      g.beginPath();
      g.roundRect(bx, y, bw, h - 30, 5);
      g.fill();
      const gr = Math.min(0, values[i]);
      const frac = S.clamp(-gr / 24, 0, 1);
      const grd = g.createLinearGradient(0, y, 0, y + h - 30);
      grd.addColorStop(0, color);
      grd.addColorStop(1, hexA(color, 0.5));
      g.fillStyle = grd;
      g.beginPath();
      g.roundRect(bx, y, bw, (h - 30) * frac, 5);
      g.fill();
      g.fillStyle = '#e9eaf0';
      g.fillText((gr > -0.05 ? 0 : gr).toFixed(1), bx + bw / 2, y + h - 20);
      g.fillStyle = 'rgba(255,255,255,.4)';
      if (labels) g.fillText(labels[i], bx + bw / 2, y + h - 7);
    }
    g.textAlign = 'left';
  }

  VIS.dynamics = {
    draw(st, g, w, h) {
      const v = st.def.visual;
      const raw = st.raw();
      const side = h - 16;
      const ox = 14;
      const oy = 8;
      const toXY = (inDb, outDb) => [ox + ((inDb + 60) / 60) * side, oy + side - ((outDb + 60) / 60) * side];
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(ox, oy, side, side);
      g.strokeStyle = 'rgba(255,255,255,.06)';
      for (let d = -48; d < 0; d += 12) {
        const [x] = toXY(d, 0);
        const [, y] = toXY(0, d);
        g.beginPath();
        g.moveTo(x + 0.5, oy);
        g.lineTo(x + 0.5, oy + side);
        g.moveTo(ox, y + 0.5);
        g.lineTo(ox + side, y + 0.5);
        g.stroke();
      }
      const thr = st.val(v.threshold);
      const ratio = v.ratio ? st.val(v.ratio) : 100;
      const knee = v.knee ? st.val(v.knee) : 0;
      const drive = v.drive ? st.val(v.drive) : 0;
      const curve = (x) => {
        x += drive;
        const d = x - thr;
        if (knee > 0 && Math.abs(d) <= knee / 2) return x + ((1 / ratio - 1) * Math.pow(d + knee / 2, 2)) / (2 * knee);
        return d > 0 ? thr + d / ratio : x;
      };
      g.strokeStyle = 'rgba(255,255,255,.15)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(...toXY(-60, -60));
      g.lineTo(...toXY(0, 0));
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = -60 + i * 0.5;
        const p = toXY(x, S.clamp(curve(x), -60, 6));
        i ? g.lineTo(...p) : g.moveTo(...p);
      }
      g.shadowColor = hexA(st.color, 0.8);
      g.shadowBlur = 8;
      g.strokeStyle = st.color;
      g.lineWidth = 2;
      g.stroke();
      g.shadowBlur = 0;
      // live input dot
      const inDb = S.clamp(st.inDb, -60, 0);
      if (st.inDb > -59) {
        const [dx, dy] = toXY(inDb, S.clamp(curve(inDb), -60, 0));
        g.beginPath();
        g.arc(dx, dy, 5, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
      }
      const [tx] = toXY(thr - drive, 0);
      g.fillStyle = hexA(st.color, 0.6);
      g.fillRect(Math.round(tx), oy, 1, side);
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.textBaseline = 'top';
      g.fillText(v.limiter ? 'IN → OUT (limiter)' : 'IN → OUT', ox + 6, oy + 6);
      // gain reduction
      const gr = raw && raw.getReduction ? raw.getReduction() : [0];
      st.grHold = Math.min(gr[0], (st.grHold || 0) * 0.9 + gr[0] * 0.1);
      const gx = ox + side + 28;
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.fillText('GAIN REDUCTION', gx, oy + 2);
      grBars(g, gx, oy + 22, 54, side - 14, [gr[0]], null, st.color);
      g.font = '700 26px Segoe UI, system-ui, sans-serif';
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      g.fillText((gr[0] > -0.05 ? 0 : gr[0]).toFixed(1) + ' dB', gx + 72, oy + side / 2);
      g.font = '500 11px Segoe UI, system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.fillText(v.limiter ? 'Ceiling ' + fmt(thr, { unit: 'dB' }) : 'Threshold ' + fmt(thr, { unit: 'dB' }) + ' · ' + fmt(ratio, { unit: ':1' }), gx + 72, oy + side / 2 + 26);
    },
  };

  VIS.bands = {
    draw(st, g, w, h) {
      const v = st.def.visual;
      const raw = st.raw();
      const gr = raw && raw.getReduction ? raw.getReduction() : v.labels.map(() => 0);
      const sw = w * 0.62;
      drawFreqGrid(g, sw, h, 0);
      drawSpectrum(g, sw, h, st.anOut, st.color, 0.28);
      if (v.crossovers) {
        for (const id of v.crossovers) {
          const x = Math.round(fx2x(st.val(id), sw)) + 0.5;
          g.fillStyle = st.color;
          g.fillRect(x, 0, 1.5, h);
          g.font = '600 10px Segoe UI, system-ui, sans-serif';
          g.fillText(fmt(st.val(id), { unit: 'Hz' }), x + 4, 10);
        }
      }
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      g.textBaseline = 'top';
      g.fillText('GAIN REDUCTION', sw + 20, 8);
      grBars(g, sw + 20, 26, w - sw - 34, h - 30, gr, v.labels, st.color);
    },
  };

  VIS.ir = {
    draw(st, g, w, h) {
      const raw = st.raw();
      const ir = raw && raw.getIR ? raw.getIR() : null;
      const pre = st.val('predelay') / 1000 || 0;
      const total = Math.max(0.5, (ir ? ir.seconds : 2) + pre) * 1.05;
      g.font = '10px Segoe UI, system-ui, sans-serif';
      g.textBaseline = 'top';
      const stepT = total > 6 ? 2 : total > 3 ? 1 : total > 1.2 ? 0.5 : 0.25;
      for (let t = 0; t <= total; t += stepT) {
        const x = Math.round((t / total) * w) + 0.5;
        g.fillStyle = 'rgba(255,255,255,.05)';
        g.fillRect(x, 0, 1, h);
        g.fillStyle = 'rgba(255,255,255,.3)';
        g.fillText(t.toFixed(stepT < 1 ? 2 : 0) + ' s', x + 3, h - 13);
      }
      if (ir && ir.env) {
        const env = ir.env;
        let m = 0;
        for (const v of env) m = Math.max(m, v);
        const x0 = (pre / total) * w;
        const xw = (ir.seconds / total) * w;
        const mid = h / 2 - 6;
        g.beginPath();
        g.moveTo(x0, mid);
        for (let i = 0; i < env.length; i++) g.lineTo(x0 + (i / env.length) * xw, mid - (env[i] / m) * (mid - 12));
        for (let i = env.length - 1; i >= 0; i--) g.lineTo(x0 + (i / env.length) * xw, mid + (env[i] / m) * (mid - 12));
        g.closePath();
        const grd = g.createLinearGradient(x0, 0, x0 + xw, 0);
        grd.addColorStop(0, hexA(st.color, 0.85));
        grd.addColorStop(1, hexA(st.color, 0.05));
        g.fillStyle = grd;
        g.fill();
        g.fillStyle = 'rgba(255,255,255,.7)';
        g.fillRect(0, mid - 22, 2, 44); // dry hit
      }
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.fillText('DECAY ' + fmt(st.val('decay'), { unit: 's' }) + '   ·   PRE-DELAY ' + fmt(st.val('predelay'), { unit: 'ms' }), 10, 8);
    },
  };

  VIS.taps = {
    draw(st, g, w, h) {
      const raw = st.raw();
      const info = raw && raw.getTaps ? raw.getTaps() : { taps: [], seconds: 0 };
      const span = Math.max(0.4, (info.taps.length ? info.taps[info.taps.length - 1].t : 1) * 1.1);
      const mid = h / 2;
      g.fillStyle = 'rgba(255,255,255,.08)';
      g.fillRect(0, mid, w, 1);
      g.font = '10px Segoe UI, system-ui, sans-serif';
      g.textBaseline = 'top';
      const beat = 60 / ((S.project && S.project.bpm) || 120);
      for (let t = 0; t <= span; t += beat) {
        const x = Math.round((t / span) * w) + 0.5;
        g.fillStyle = 'rgba(255,255,255,.05)';
        g.fillRect(x, 0, 1, h);
      }
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillRect(2, mid - 34, 3, 68);
      for (const tp of info.taps) {
        const x = (tp.t / span) * w;
        const hh = 34 * tp.level;
        g.fillStyle = hexA(st.color, 0.35 + 0.6 * tp.level);
        g.shadowColor = hexA(st.color, 0.7);
        g.shadowBlur = 8;
        if (tp.side === 'L') g.fillRect(x - 2, mid - hh, 4, hh);
        else if (tp.side === 'R') g.fillRect(x - 2, mid, 4, hh);
        else g.fillRect(x - 2, mid - hh, 4, hh * 2);
        g.shadowBlur = 0;
      }
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      const pp = st.val('pingpong');
      g.fillText(pp ? 'L' : '', 8, 8);
      g.fillText(pp ? 'R' : '', 8, h - 18);
      g.textAlign = 'right';
      g.fillText(
        (st.val('sync') !== 'Free (ms)' ? st.val('sync') + ' = ' : '') + Math.round(info.seconds * 1000) + ' ms @ ' + ((S.project && S.project.bpm) || 120) + ' BPM',
        w - 10,
        8
      );
      g.textAlign = 'left';
    },
  };

  VIS.steps = {
    layout(w, h) {
      const pad = 12;
      const cw = (w - pad * 2 - 3 * 10) / 16;
      return { pad, cw, top: 34, ch: h - 52 };
    },
    cellAt(st, x, w, h) {
      const L = this.layout(w, h);
      for (let i = 0; i < 16; i++) {
        const cx = L.pad + i * L.cw + Math.floor(i / 4) * 10;
        if (x >= cx && x <= cx + L.cw) return i;
      }
      return -1;
    },
    draw(st, g, w, h) {
      const L = this.layout(w, h);
      const bits = st.val(st.def.visual.param) | 0;
      const raw = st.raw();
      const cur = raw && raw.getStep && S.engine && S.engine.playing ? raw.getStep() : -1;
      const mode = st.val('mode');
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.textBaseline = 'top';
      g.fillText(
        mode === 'Gate' ? 'LIT STEPS PLAY · DARK STEPS ARE MUTED' : mode === 'Stutter' ? 'LIT STEPS STUTTER (REPEAT) · DARK STEPS PLAY NORMALLY' : 'LIT STEPS DUCK THE VOLUME (PUMP)',
        L.pad,
        12
      );
      for (let i = 0; i < 16; i++) {
        const x = L.pad + i * L.cw + Math.floor(i / 4) * 10;
        const on = (bits >> i) & 1;
        g.beginPath();
        g.roundRect(x + 1, L.top, L.cw - 2, L.ch, 6);
        if (on) {
          const grd = g.createLinearGradient(0, L.top, 0, L.top + L.ch);
          grd.addColorStop(0, st.color);
          grd.addColorStop(1, hexA(st.color, 0.55));
          g.fillStyle = grd;
          g.shadowColor = hexA(st.color, 0.6);
          g.shadowBlur = i === cur ? 18 : 6;
        } else g.fillStyle = 'rgba(255,255,255,.06)';
        g.fill();
        g.shadowBlur = 0;
        if (i === cur) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2;
          g.stroke();
        }
        g.fillStyle = on ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.3)';
        g.textAlign = 'center';
        g.fillText(String(i + 1), x + L.cw / 2, L.top + L.ch - 14);
        g.textAlign = 'left';
      }
    },
    pointer(st, cv) {
      let paint = null;
      const at = (e) => {
        const r = cv.getBoundingClientRect();
        return this.cellAt(st, e.clientX - r.left, r.width, r.height);
      };
      const apply = (i) => {
        if (i < 0) return;
        const id = st.def.visual.param;
        let bits = st.val(id) | 0;
        bits = paint ? bits | (1 << i) : bits & ~(1 << i);
        if (bits !== (st.val(id) | 0)) st.set(id, bits);
      };
      cv.addEventListener('pointerdown', (e) => {
        const i = at(e);
        if (i < 0) return;
        st.begin();
        paint = !((st.val(st.def.visual.param) >> i) & 1);
        cv.setPointerCapture(e.pointerId);
        apply(i);
      });
      cv.addEventListener('pointermove', (e) => {
        cv.style.cursor = at(e) >= 0 ? 'pointer' : 'default';
        if (paint != null) apply(at(e));
      });
      cv.addEventListener('pointerup', () => (paint = null));
    },
    hint: 'Click or drag across steps to draw the pattern · it follows the song tempo',
  };

  VIS.curve = {
    draw(st, g, w, h) {
      const v = st.def.visual;
      const side = h - 16;
      const ox = (w - side) / 2 - 80;
      const oy = 8;
      const toXY = (x, y) => [ox + ((x + 1) / 2) * side, oy + side - ((y + 1) / 2) * side];
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(ox, oy, side, side);
      g.strokeStyle = 'rgba(255,255,255,.07)';
      g.beginPath();
      g.moveTo(...toXY(-1, 0));
      g.lineTo(...toXY(1, 0));
      g.moveTo(...toXY(0, -1));
      g.lineTo(...toXY(0, 1));
      g.stroke();
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(255,255,255,.15)';
      g.beginPath();
      g.moveTo(...toXY(-1, -1));
      g.lineTo(...toXY(1, 1));
      g.stroke();
      g.setLineDash([]);
      const params = st.allValues();
      g.beginPath();
      for (let i = 0; i <= 200; i++) {
        const x = -1 + i / 100;
        const p = toXY(x, S.clamp(v.fn(params, x), -1, 1));
        i ? g.lineTo(...p) : g.moveTo(...p);
      }
      g.shadowColor = hexA(st.color, 0.8);
      g.shadowBlur = 8;
      g.strokeStyle = st.color;
      g.lineWidth = 2;
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      g.textBaseline = 'top';
      g.fillText('TRANSFER CURVE', ox + 6, oy + 6);
      // live output level
      const rx = ox + side + 40;
      g.fillText('OUTPUT PEAK', rx, oy + 2);
      g.font = '700 26px Segoe UI, system-ui, sans-serif';
      const od = st.outShown == null ? st.outDb : st.outShown;
      g.fillStyle = od > -0.2 ? '#ff4d5e' : '#ffffff';
      g.fillText(od > -90 ? od.toFixed(1) + ' dB' : '−∞', rx, oy + 22);
    },
  };

  VIS.transient = {
    draw(st, g, w, h) {
      const raw = st.raw();
      const m = raw && raw.getGainRange ? raw.getGainRange() : { min: 0, max: 0 };
      st.tMin = Math.min(m.min, (st.tMin || 0) * 0.85);
      st.tMax = Math.max(m.max, (st.tMax || 0) * 0.85);
      const mid = w / 2;
      const y = h / 2 - 14;
      const scale = (db) => (db / 18) * (w / 2 - 30);
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath();
      g.roundRect(30, y, w - 60, 28, 8);
      g.fill();
      g.fillStyle = hexA(st.color, 0.9);
      g.fillRect(mid, y + 4, scale(Math.min(18, st.tMax)), 20);
      g.fillStyle = 'rgba(255,77,94,.85)';
      const lo = scale(Math.max(-18, st.tMin));
      g.fillRect(mid + lo, y + 4, -lo, 20);
      g.fillStyle = '#fff';
      g.fillRect(mid - 0.5, y - 6, 1, 40);
      g.font = '600 10px Segoe UI, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,.45)';
      g.fillText('GAIN CHANGE ON EACH HIT', mid, 14);
      g.fillText('−18 dB', 46, y + 44);
      g.fillText('0', mid, y + 44);
      g.fillText('+18 dB', w - 46, y + 44);
      g.font = '700 16px Segoe UI, system-ui, sans-serif';
      g.fillStyle = '#e9eaf0';
      g.fillText('+' + st.tMax.toFixed(1) + ' / ' + st.tMin.toFixed(1) + ' dB', mid, h - 22);
      g.textAlign = 'left';
    },
  };

  /* ---------- window ---------- */
  S.openPluginEditor = (fx, owner) => {
    const def = S.plugins.get(fx.pluginId);
    if (!def) return S.toast('Plugin "' + fx.pluginId + '" is not installed');
    if (def.native) return S.native.openEditor(fx);
    const existing = open.get(fx.id);
    if (existing) {
      existing.win.style.zIndex = ++zTop;
      existing.win.classList.remove('flash');
      void existing.win.offsetWidth;
      existing.win.classList.add('flash');
      return;
    }

    const color = def.color || CAT_COLORS[def.category] || '#8b7bff';
    const params = def.params.filter((p) => !p.hidden);
    const st = {
      def,
      fx,
      owner,
      color,
      inDb: -120,
      outDb: -120,
      hot: null,
      controls: new Map(),
      param: (id) => def.params.find((p) => p.id === id),
      val: (id) => {
        const p = st.param(id);
        return st.fx.params[id] !== undefined ? st.fx.params[id] : p ? p.default : undefined;
      },
      allValues: () => S.defaultParams(def, st.fx.params),
      raw: () => {
        const rec = S.engine && S.engine.fx.get(st.fx.id);
        return rec && rec.inst ? rec.inst.raw : null;
      },
    };
    let gestureAt = 0;
    st.begin = (coalesce) => {
      // one undo step per gesture (wheel / arrow bursts are merged)
      const now = performance.now();
      if (!coalesce || now - gestureAt > 600) S.history.push();
      gestureAt = now;
      markCustom();
    };
    st.set = (id, v) => {
      st.fx.params[id] = v;
      S.engine.setFxParam(st.fx.id, id, v);
      const c = st.controls.get(id);
      if (c) c.draw();
      st.syncEnabled();
    };
    /** Dim controls that do nothing in the current setting (param.enabledIf(values)). */
    st.syncEnabled = () => {
      const vals = S.defaultParams(def, st.fx.params);
      st.controls.forEach((c) => {
        if (c.p && typeof c.p.enabledIf === 'function') c.el.classList.toggle('dim', !c.p.enabledIf(vals));
      });
    };

    const win = el('div', 'pw');
    win.style.setProperty('--pc', color);
    win.style.zIndex = ++zTop;
    win.tabIndex = -1;
    const wide = def.visual && ['eq', 'bands'].includes(def.visual.type);
    if (wide) win.classList.add('wide');

    // header
    const head = el('div', 'pw-head');
    const brand = el('div', 'pw-brand', '<img src="../assets/mark.svg" alt=""><div><div class="pw-maker">SESSION</div><div class="pw-name"></div></div>');
    brand.querySelector('.pw-name').textContent = def.name.replace(/^Session /, '');
    const cat = el('span', 'pw-cat');
    cat.textContent = def.category || 'Effect';
    const presetBox = el('div', 'pw-presets');
    const prevB = el('button', 'pw-ib', S.ui.icon('undo', 13));
    prevB.title = 'Previous preset';
    prevB.innerHTML = '‹';
    const nextB = el('button', 'pw-ib');
    nextB.innerHTML = '›';
    nextB.title = 'Next preset';
    const presetSel = el('select', 'pw-preset');
    const presets = def.presets && def.presets.length ? def.presets : [{ name: 'Default', params: {} }];
    presetSel.innerHTML = '<option value="-1">Custom</option>' + presets.map((p, i) => '<option value="' + i + '"></option>').join('');
    presets.forEach((p, i) => (presetSel.options[i + 1].textContent = p.name));
    presetBox.append(prevB, presetSel, nextB);
    const bypassB = el('button', 'pw-ib pw-power', S.ui.icon('power', 14));
    const resetB = el('button', 'pw-ib', '↺');
    resetB.title = 'Reset all controls';
    const closeB = el('button', 'pw-ib pw-close', S.ui.icon('x', 14));
    closeB.title = 'Close (Esc)';
    head.append(brand, cat, el('div', 'pw-sp'), presetBox, bypassB, resetB, closeB);
    win.appendChild(head);

    const sub = el('div', 'pw-sub');
    win.appendChild(sub);

    // display
    const vtype = (def.visual && VIS[def.visual.type] && def.visual.type) || 'spectrum';
    const vis = VIS[vtype];
    const disp = el('div', 'pw-display');
    const cv = el('canvas');
    disp.appendChild(cv);
    if (vis.hint) {
      const hint = el('div', 'pw-hint');
      hint.textContent = vis.hint;
      disp.appendChild(hint);
    }
    win.appendChild(disp);
    if (vis.pointer) vis.pointer(st, cv);

    // controls
    const body = el('div', 'pw-body');
    win.appendChild(body);
    function buildControls() {
      body.innerHTML = '';
      st.controls.clear();
      const used = new Set();
      const groups = (def.layout || []).map((g) => ({ title: g.title, big: g.big, toggle: g.toggle, params: g.params.map((id) => st.param(id)).filter((p) => p && !p.hidden && p.id !== g.toggle) }));
      groups.forEach((g) => {
        g.params.forEach((p) => used.add(p.id));
        if (g.toggle) used.add(g.toggle);
      });
      const rest = params.filter((p) => !used.has(p.id));
      if (rest.length) groups.push({ title: groups.length ? 'More' : 'Controls', params: rest });
      for (const g of groups) {
        if (!g.params.length) continue;
        const sec = el('div', 'pw-sec');
        const t = el('div', 'pw-sec-t');
        const tt = el('span');
        tt.textContent = g.title;
        t.appendChild(tt);
        const row = el('div', 'pw-sec-c');
        sec.append(t, row);
        if (g.toggle) {
          // a band / section on-off switch lives in the section title
          const tp = st.param(g.toggle);
          const sw = el('button', 'tog sm', '<i></i>');
          sw.title = 'Turn ' + g.title + ' on / off';
          const draw = () => {
            const on = !!st.val(g.toggle);
            sw.classList.toggle('on', on);
            sec.classList.toggle('off', !on);
          };
          sw.onclick = () => {
            st.begin();
            st.set(g.toggle, !st.val(g.toggle));
            draw();
          };
          st.controls.set(tp.id, { el: sw, draw });
          t.appendChild(sw);
          draw();
        }
        for (const p of g.params) {
          const get = () => st.val(p.id);
          const set = (v) => st.set(p.id, v);
          const c = p.type === 'boolean' ? toggle(p, get, set, st.begin) : p.type === 'select' ? segmented(p, get, set, st.begin) : knob(p, get, set, st.begin, { big: g.big === p.id });
          c.p = p;
          st.controls.set(p.id, c);
          row.appendChild(c.el);
        }
        body.appendChild(sec);
      }
      // one-click helpers a plugin can offer (e.g. "Auto threshold")
      if (def.actions && def.actions.length) {
        const bar = el('div', 'pw-actions');
        for (const act of def.actions) {
          const b = el('button', 'btn accent sm');
          b.textContent = act.label;
          if (act.title) b.title = act.title;
          b.onclick = () => {
            try {
              S.history.push();
              const msg = act.run({ fx: st.fx, owner: st.owner, set: st.set, current: () => S.defaultParams(def, st.fx.params) });
              st.controls.forEach((c) => c.draw());
              if (msg) S.toast(msg);
            } catch (e) {
              S.toast(e.message);
            }
          };
          bar.appendChild(b);
        }
        body.appendChild(bar);
      }
    }
    buildControls();
    st.syncEnabled();
    if (def.compact) win.classList.add('compact');

    // footer meters
    const foot = el('div', 'pw-foot');
    foot.innerHTML =
      '<div class="pw-m"><span>IN</span><div class="pw-mb"><i></i></div><b class="pw-mv">−∞</b></div><div class="pw-m"><span>OUT</span><div class="pw-mb"><i></i></div><b class="pw-mv">−∞</b></div><div class="pw-sig">Session · ' +
      (def.category || 'Effect') +
      '</div>';
    win.appendChild(foot);
    const mIn = foot.querySelectorAll('.pw-mb i')[0];
    const mOut = foot.querySelectorAll('.pw-mb i')[1];
    const vIn = foot.querySelectorAll('.pw-mv')[0];
    const vOut = foot.querySelectorAll('.pw-mv')[1];

    function markCustom() {
      presetSel.value = '-1';
      st.fx.preset = null;
    }
    function loadPreset(i) {
      const pr = presets[i];
      if (!pr) return;
      S.history.push();
      const vals = S.defaultParams(def, pr.params);
      st.fx.params = {};
      for (const k of Object.keys(vals)) st.set(k, vals[k]);
      st.fx.preset = pr.name;
      presetSel.value = String(i);
      st.controls.forEach((c) => c.draw());
    }
    presetSel.onchange = () => presetSel.value !== '-1' && loadPreset(+presetSel.value);
    const stepPreset = (d) => {
      const cur = +presetSel.value;
      loadPreset(((cur < 0 ? (d > 0 ? -1 : 0) : cur) + d + presets.length) % presets.length);
    };
    prevB.onclick = () => stepPreset(-1);
    nextB.onclick = () => stepPreset(1);
    const pi = presets.findIndex((p) => p.name === fx.preset);
    presetSel.value = String(pi);

    const syncBypass = () => {
      bypassB.classList.toggle('off', !!st.fx.bypass);
      bypassB.title = st.fx.bypass ? 'Effect is bypassed: click to turn it on' : 'Bypass this effect';
      win.classList.toggle('bypassed', !!st.fx.bypass);
    };
    bypassB.onclick = () => {
      S.history.push();
      st.fx.bypass = !st.fx.bypass;
      syncBypass();
      S.refresh.structure();
    };
    syncBypass();
    resetB.onclick = () => {
      S.history.push();
      st.fx.params = {};
      for (const p of def.params) st.set(p.id, p.default);
      markCustom();
      st.controls.forEach((c) => c.draw());
    };
    const ownerName = () => (st.owner ? st.owner.name : 'Master');
    const syncSub = () => {
      sub.innerHTML = '';
      const on = el('span', 'pw-on');
      on.textContent = 'on ' + ownerName();
      if (st.owner) on.style.setProperty('--tc', S.ui.trackColor(st.owner));
      const desc = el('span', 'pw-desc');
      desc.textContent = def.description || '';
      sub.append(on, desc);
    };
    syncSub();

    // place + drag
    document.body.appendChild(win);
    const r0 = win.getBoundingClientRect();
    const off = (cascade++ % 6) * 26;
    win.style.left = Math.max(10, (innerWidth - r0.width) / 2 + off - 60) + 'px';
    win.style.top = Math.max(10, Math.min(innerHeight - r0.height - 10, (innerHeight - r0.height) / 2 + off - 40)) + 'px';
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, select, input')) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const sx = e.clientX - win.offsetLeft;
      const sy = e.clientY - win.offsetTop;
      win.classList.add('dragging');
      const move = (ev) => {
        win.style.left = S.clamp(ev.clientX - sx, -win.offsetWidth + 120, innerWidth - 120) + 'px';
        win.style.top = S.clamp(ev.clientY - sy, 0, innerHeight - 50) + 'px';
      };
      const up = () => {
        win.classList.remove('dragging');
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    win.addEventListener('pointerdown', () => (win.style.zIndex = ++zTop), true);
    win.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.target.closest('input, select')) e.stopPropagation();
    });

    // meters: tap the host's input/output of this effect
    let tappedInst = null;
    const tap = () => {
      const rec = S.engine && S.engine.fx.get(st.fx.id);
      const inst = rec && rec.inst;
      if (inst === tappedInst) return;
      untap();
      tappedInst = inst;
      if (!inst) return;
      const c = inst.input.context;
      st.anIn = c.createAnalyser();
      st.anOut = c.createAnalyser();
      st.anIn.fftSize = 2048;
      st.anOut.fftSize = 4096;
      st.anOut.smoothingTimeConstant = 0.82;
      inst.input.connect(st.anIn);
      inst.output.connect(st.anOut);
    };
    function untap() {
      if (tappedInst) {
        try {
          tappedInst.input.disconnect(st.anIn);
          tappedInst.output.disconnect(st.anOut);
        } catch (e) {}
      }
      tappedInst = null;
      st.anIn = st.anOut = null;
    }
    const meterW = (db) => S.clamp((db + 60) / 60, 0, 1) * 100 + '%';
    let lastCheck = 0;
    let raf = 0;
    let shownIn = -120;
    let shownOut = -120;
    function frame(now) {
      if (!win.isConnected) return;
      if (now - lastCheck > 400) {
        lastCheck = now;
        // follow undo/redo (the effect object may be replaced) and close if it was removed
        const found = findFx(st.fx.id);
        if (!found) return close();
        if (found.fx !== st.fx || found.owner !== st.owner) {
          st.fx = found.fx;
          st.owner = found.owner;
          buildControls();
          syncBypass();
          syncSub();
          const i2 = presets.findIndex((p) => p.name === st.fx.preset);
          presetSel.value = String(i2);
          st.syncEnabled();
        }
        tap();
      }
      st.inDb = peakDb(st.anIn);
      st.outDb = peakDb(st.anOut);
      shownIn = Math.max(st.inDb, shownIn - 1.2);
      shownOut = Math.max(st.outDb, shownOut - 1.2);
      st.outShown = shownOut;
      mIn.style.width = meterW(shownIn);
      mOut.style.width = meterW(shownOut);
      vIn.textContent = shownIn > -59 ? shownIn.toFixed(1) : '−∞';
      vOut.textContent = shownOut > -59 ? shownOut.toFixed(1) : '−∞';
      vOut.classList.toggle('hot', shownOut > -0.3);
      const { g, w, h } = setupCanvas(cv);
      try {
        vis.draw(st, g, w, h);
      } catch (e) {
        console.warn('[plugin display]', e);
      }
      raf = requestAnimationFrame(frame);
    }
    function close() {
      cancelAnimationFrame(raf);
      untap();
      open.delete(st.fx.id);
      win.classList.add('closing');
      setTimeout(() => win.remove(), 160);
    }
    closeB.onclick = close;
    open.set(fx.id, { win, close });
    tap();
    raf = requestAnimationFrame(frame);
    win.focus();
  };

  function findFx(id) {
    const p = S.project;
    for (const t of p.tracks) {
      const f = t.fx.find((x) => x.id === id);
      if (f) return { fx: f, owner: t };
    }
    const m = (p.master.fx || []).find((x) => x.id === id);
    return m ? { fx: m, owner: null } : null;
  }

  S.closeAllPluginEditors = () => [...open.values()].forEach((w) => w.close());
  if (S.on) S.on('project-replaced', () => S.closeAllPluginEditors());
})();
