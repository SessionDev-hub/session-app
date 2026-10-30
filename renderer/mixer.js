/* Mixer: one strip per track + master. Effect inserts, pan knob, dB-tapered fader with scale,
 * stereo meters with peak hold, clip indicator, typed dB entry, mute / solo / arm. */
(function () {
  const S = window.Studio;
  const U = S.ui;
  const M = (S.mixer = {});
  let root;
  const meters = new Map(); // id -> { l, r, lh, rh, hold:[l,r], peakEl, ledEl, max }

  /* fader taper: gain = MAXG * pos^3  (0 dB sits at ~79% of the travel, +6 dB at the top) */
  const MAXG = 2;
  const posFromGain = (gn) => Math.cbrt(S.clamp(gn, 0, MAXG) / MAXG);
  const gainFromPos = (p) => MAXG * Math.pow(S.clamp(p, 0, 1), 3);
  const toDb = (v) => (v <= 0.0005 ? -Infinity : 20 * Math.log10(v));
  const dbStr = (v) => (Number.isFinite(toDb(v)) ? (toDb(v) > 0.05 ? '+' : '') + toDb(v).toFixed(1) : '-∞');
  const meterPct = (lin) => (lin > 0.00001 ? S.clamp((20 * Math.log10(lin) + 60) / 66, 0, 1) * 100 : 0); // -60..+6 dB

  M.init = (el) => {
    root = el;
  };

  function button(cls, html, title, fn) {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = html;
    if (title) b.title = title;
    b.onclick = fn;
    return b;
  }

  /* ---------- pan knob ---------- */
  function panKnob(track) {
    const wrap = document.createElement('div');
    wrap.className = 's-pan';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'Pan';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 34 34');
    svg.classList.add('knob');
    svg.innerHTML =
      '<path class="k-track" d="" fill="none" stroke-width="3" stroke-linecap="round"/><path class="k-val" d="" fill="none" stroke-width="3" stroke-linecap="round"/><circle class="k-cap" cx="17" cy="17" r="10"/><line class="k-ptr" x1="17" y1="17" x2="17" y2="9" stroke-width="2" stroke-linecap="round"/>';
    const readout = document.createElement('span');
    readout.className = 'readout';
    const R = 14.5;
    const pt = (deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [17 + R * Math.cos(a), 17 + R * Math.sin(a)];
    };
    const arc = (a0, a1) => {
      const [x0, y0] = pt(a0);
      const [x1, y1] = pt(a1);
      return 'M' + x0 + ' ' + y0 + ' A' + R + ' ' + R + ' 0 ' + (Math.abs(a1 - a0) > 180 ? 1 : 0) + ' ' + (a1 > a0 ? 1 : 0) + ' ' + x1 + ' ' + y1;
    };
    svg.querySelector('.k-track').setAttribute('d', arc(-135, 135));
    const draw = () => {
      const deg = track.pan * 135;
      svg.querySelector('.k-val').setAttribute('d', Math.abs(deg) < 0.5 ? '' : arc(Math.min(0, deg), Math.max(0, deg)));
      svg.querySelector('.k-ptr').setAttribute('transform', 'rotate(' + deg + ' 17 17)');
      const v = Math.round(Math.abs(track.pan) * 100);
      readout.textContent = v === 0 ? 'C' : (track.pan < 0 ? 'L' : 'R') + v;
    };
    const set = (v) => {
      track.pan = Math.round(S.clamp(v, -1, 1) * 100) / 100;
      draw();
      S.refresh.mix();
    };
    svg.title = 'Pan: drag up/down, Shift for fine, double-click to centre';
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      S.history.push();
      const y0 = e.clientY;
      const p0 = track.pan;
      const move = (ev) => set(p0 + ((y0 - ev.clientY) / 120) * (ev.shiftKey ? 0.2 : 1));
      const up = () => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
    });
    svg.addEventListener('dblclick', () => set(0));
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        set(track.pan + (e.deltaY < 0 ? 0.05 : -0.05));
      },
      { passive: false }
    );
    draw();
    wrap.append(lbl, svg, readout);
    return wrap;
  }

  /* ---------- strip ---------- */
  function strip(track, isMaster, index) {
    const p = S.project;
    const target = isMaster ? p.master : track;
    const el = document.createElement('div');
    el.className = 'strip' + (isMaster ? ' master' : '');
    if (!isMaster) el.style.setProperty('--tc', U.trackColor(track));

    const head = document.createElement('div');
    head.className = 's-head';
    head.innerHTML = '<span class="snum"></span><span class="sname"></span>';
    head.querySelector('.snum').textContent = isMaster ? '' : String(index + 1).padStart(2, '0');
    head.querySelector('.sname').textContent = isMaster ? 'Master' : track.name;
    if (!isMaster) {
      head.title = 'Right-click for presets & colour';
      head.oncontextmenu = (e) => {
        e.preventDefault();
        if (S.match && S.match.trackMenu) S.match.trackMenu(track, e.clientX, e.clientY);
        else U.colorMenu(track, e.clientX, e.clientY);
      };
    }
    el.appendChild(head);

    // effect inserts (same chain as the track header)
    el.appendChild(U.fxChain(isMaster ? p.master.fx : track.fx, isMaster ? null : track));

    if (!isMaster) el.appendChild(panKnob(track));

    // fader + scale + stereo meter
    const wrap = document.createElement('div');
    wrap.className = 'fader-wrap';
    const scale = document.createElement('div');
    scale.className = 'scale';
    for (const db of [6, 0, -6, -12, -24, -48]) {
      const s = document.createElement('span');
      s.textContent = db > 0 ? '+' + db : db;
      s.style.top = 'calc(8px + (100% - 16px) * ' + (1 - posFromGain(Math.pow(10, db / 20))) + ')';
      scale.appendChild(s);
    }
    const col = document.createElement('div');
    col.className = 'fader-col';
    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'fader';
    fader.min = 0;
    fader.max = 1000;
    fader.step = 1;
    fader.value = Math.round(posFromGain(target.vol) * 1000);
    fader.title = 'Volume: drag, or scroll; double-click for 0 dB';
    col.appendChild(fader);

    const pair = document.createElement('div');
    pair.className = 'meter-pair';
    const mk = () => {
      const m = document.createElement('div');
      m.className = 'meter';
      m.innerHTML = '<i></i><b></b>';
      pair.appendChild(m);
      return m;
    };
    const ml = mk();
    const mr = mk();
    wrap.append(scale, col, pair);
    el.appendChild(wrap);

    const led = document.createElement('div');
    led.className = 'clipled';
    led.title = 'Clip indicator: lights up when the signal goes over 0 dBFS. Click to reset.';

    const row = document.createElement('div');
    row.className = 'db-row';
    const db = document.createElement('input');
    db.className = 'db';
    db.spellcheck = false;
    db.title = 'Type a level in dB and press Enter';
    db.value = dbStr(target.vol);
    const peak = document.createElement('span');
    peak.className = 'peak';
    peak.textContent = '-∞';
    peak.title = 'Highest peak (dBFS). Click to reset.';
    row.append(db, peak);
    el.appendChild(led);
    el.appendChild(row);

    const setVol = (gn, fromFader) => {
      target.vol = S.clamp(gn, 0, MAXG);
      if (!fromFader) fader.value = Math.round(posFromGain(target.vol) * 1000);
      db.value = dbStr(target.vol);
      S.refresh.mix();
    };
    fader.onpointerdown = () => S.history.push();
    fader.oninput = () => setVol(gainFromPos(fader.value / 1000), true);
    fader.ondblclick = () => {
      S.history.push();
      setVol(1);
    };
    fader.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const d = toDb(target.vol);
        setVol(Math.pow(10, ((Number.isFinite(d) ? d : -60) + (e.deltaY < 0 ? 0.5 : -0.5)) / 20));
      },
      { passive: false }
    );
    db.onfocus = () => db.select();
    db.onkeydown = (e) => {
      if (e.key === 'Enter') db.blur();
      if (e.key === 'Escape') {
        db.value = dbStr(target.vol);
        db.blur();
      }
      e.stopPropagation();
    };
    db.onchange = () => {
      const v = parseFloat(db.value.replace(',', '.').replace('∞', 'Infinity'));
      if (Number.isNaN(v)) return (db.value = dbStr(target.vol));
      S.history.push();
      setVol(v === -Infinity || v < -90 ? 0 : Math.pow(10, Math.min(v, 6) / 20));
    };

    const m = { l: ml.firstChild, r: mr.firstChild, lh: ml.lastChild, rh: mr.lastChild, hold: [0, 0], holdT: [0, 0], max: 0, peakEl: peak, ledEl: led };
    const reset = () => {
      m.max = 0;
      peak.textContent = '-∞';
      peak.classList.remove('hot');
      led.classList.remove('on');
    };
    led.onclick = reset;
    peak.onclick = reset;
    meters.set(isMaster ? 'master' : track.id, m);

    if (!isMaster) {
      const ms = document.createElement('div');
      ms.className = 'ms';
      ms.appendChild(
        button('tb' + (track.mute ? ' on-m' : ''), 'M', 'Mute', () => {
          S.history.push();
          track.mute = !track.mute;
          S.refresh.structure();
        })
      );
      ms.appendChild(
        button('tb' + (track.solo ? ' on-s' : ''), 'S', 'Solo', () => {
          S.history.push();
          track.solo = !track.solo;
          S.refresh.structure();
        })
      );
      ms.appendChild(
        button('tb' + (track.arm ? ' on-r' : ''), U.icon('record', 10), 'Arm for recording', async () => {
          const on = !track.arm;
          if (on && !(await S.ensureInput())) return;
          p.tracks.forEach((x) => (x.arm = false));
          track.arm = on;
          S.timeline.renderHeaders();
          M.render();
        })
      );
      el.appendChild(ms);
    }
    return el;
  }

  M.render = () => {
    if (!root) return;
    const keep = root.scrollLeft;
    meters.clear();
    root.innerHTML = '';
    S.project.tracks.forEach((t, i) => root.appendChild(strip(t, false, i)));
    root.appendChild(strip(null, true));
    root.scrollLeft = keep;
    if (!root._wheel) {
      // mouse wheel scrolls the strips sideways, smoothly
      root._wheel = true;
      root.addEventListener(
        'wheel',
        (e) => {
          if (e.target.closest('input.fader, .knob, .fx-inserts') || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          if (root.scrollWidth <= root.clientWidth) return;
          e.preventDefault();
          root.scrollBy({ left: e.deltaY * 1.2, behavior: 'smooth' });
        },
        { passive: false }
      );
    }
  };

  /* meter ballistics: rise instantly, fall smoothly at ~26 dB per second (like a hardware meter) */
  const FALL_DB_PER_S = 26;
  let lastT = performance.now();

  M.updateMeters = () => {
    if (!S.engine) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const fall = Math.pow(10, (-FALL_DB_PER_S * dt) / 20);
    for (const [id, m] of meters) {
      const lr = S.engine.trackLevelsLR ? S.engine.trackLevelsLR(id) : [S.engine.trackLevel(id), S.engine.trackLevel(id)];
      m.disp = m.disp || [0, 0];
      [m.l, m.r].forEach((bar, k) => {
        const v = lr[k];
        m.disp[k] = Math.max(v, m.disp[k] * fall);
        if (m.disp[k] < 0.0005) m.disp[k] = 0;
        bar.style.clipPath = 'inset(' + (100 - meterPct(m.disp[k])).toFixed(2) + '% 0 0 0)';
        // peak-hold marker: holds 1.2 s, then falls
        if (v >= m.hold[k]) {
          m.hold[k] = v;
          m.holdT[k] = now;
        } else if (now - m.holdT[k] > 1200) m.hold[k] *= fall * fall;
        (k ? m.rh : m.lh).style.bottom = 'calc(' + meterPct(m.hold[k]) + '% - 1px)';
        (k ? m.rh : m.lh).style.display = m.hold[k] > 0.001 ? '' : 'none';
      });
      const top = Math.max(lr[0], lr[1]);
      if (top > m.max) {
        m.max = top;
        const d = 20 * Math.log10(top);
        m.peakEl.textContent = (d > 0 ? '+' : '') + d.toFixed(1);
        m.peakEl.classList.toggle('hot', d > -0.1);
        if (d > 0) m.ledEl.classList.add('on');
      }
    }
  };
})();
