/* Timeline: track headers (DOM) + clip canvas with ruler, snap grid, tools, multi-select and clip editing. */
(function () {
  const S = window.Studio;
  const U = S.ui;
  const ROW = 96;
  const RULER = 34;
  const BLOCK = 256; // samples per waveform peak
  const CLIP_TOP = 4; // clip box inset inside a row
  const CLIP_H = ROW - 9;
  const HEAD_H = 17; // clip title strip

  const TL = (S.timeline = { pps: 60, dirty: true, tool: 'select', hover: null, hoverHandle: null, hoverT: null, hoverRow: -1 });
  let scroll, canvas, g, headers, spacer;
  let drag = null;

  /* ---------- selection (several clips; `selected` = the main one) ---------- */
  let primary = null;
  const sel = new Set();
  Object.defineProperty(TL, 'selected', {
    get: () => primary,
    set: (id) => {
      primary = id || null;
      sel.clear();
      if (primary) sel.add(primary);
      TL.dirty = true;
    },
  });
  TL.isSelected = (id) => sel.has(id);
  TL.selectMany = (ids, { add = false } = {}) => {
    if (!add) sel.clear();
    for (const id of ids) sel.add(id);
    primary = ids.length ? ids[ids.length - 1] : add ? primary : null;
    if (primary && !sel.has(primary)) primary = sel.values().next().value || null;
    TL.dirty = true;
  };
  TL.selectAll = () => TL.selectMany(S.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  TL.selectedClips = () => {
    const out = [];
    for (const track of S.project.tracks) for (const clip of track.clips) if (sel.has(clip.id)) out.push({ clip, track });
    return out;
  };
  function toggleSelect(id) {
    if (sel.has(id)) {
      sel.delete(id);
      if (primary === id) primary = sel.values().next().value || null;
    } else {
      sel.add(id);
      primary = id;
    }
    TL.dirty = true;
  }

  /* ---------- waveform peak cache ----------
   * Peaks are computed once per buffer and cached. For big imports (a full beat), the scan is many
   * millions of samples, so we hand it to a Web Worker and draw the clip without its waveform until
   * the peaks arrive — the UI never freezes. Short takes are scanned inline (instant, no flicker). */
  const peakCache = new WeakMap();
  const peakPending = new WeakMap();
  const peakJobs = new Map(); // request id -> buffer
  let peakWorker, peakSeq = 0;
  const WORKER_MIN = 400000; // ~8 s mono @48k; below this, inline is cheaper than a round-trip

  function peakWorkerInstance() {
    if (peakWorker !== undefined) return peakWorker; // null means "unavailable, use inline"
    try {
      const src =
        'onmessage=function(e){var d=e.data.data,b=e.data.block,id=e.data.id;' +
        'var n=Math.ceil(d.length/b),mn=new Float32Array(n),mx=new Float32Array(n);' +
        'for(var i=0;i<n;i++){var lo=1,hi=-1,end=Math.min(d.length,(i+1)*b);' +
        'for(var k=i*b;k<end;k++){var v=d[k];if(v<lo)lo=v;if(v>hi)hi=v;}mn[i]=lo;mx[i]=hi;}' +
        'postMessage({id:id,min:mn,max:mx},[mn.buffer,mx.buffer]);};';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
      w.onmessage = (e) => {
        const buf = peakJobs.get(e.data.id);
        peakJobs.delete(e.data.id);
        if (buf) { peakCache.set(buf, { min: e.data.min, max: e.data.max, sr: buf.sampleRate }); peakPending.delete(buf); TL.dirty = true; }
      };
      peakWorker = w;
    } catch (e) { peakWorker = null; }
    return peakWorker;
  }

  function peaksInline(buf) {
    const data = buf.getChannelData(0);
    const n = Math.ceil(data.length / BLOCK);
    const min = new Float32Array(n), max = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let lo = 1, hi = -1;
      const end = Math.min(data.length, (i + 1) * BLOCK);
      for (let k = i * BLOCK; k < end; k++) { const v = data[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
      min[i] = lo; max[i] = hi;
    }
    const p = { min, max, sr: buf.sampleRate };
    peakCache.set(buf, p);
    return p;
  }

  function peaksFor(buf) {
    const cached = peakCache.get(buf);
    if (cached) return cached;
    const w = peakWorkerInstance();
    if (!w || buf.length <= WORKER_MIN) return peaksInline(buf); // small/no-worker: inline
    if (!peakPending.get(buf)) {
      peakPending.set(buf, true);
      const id = ++peakSeq;
      peakJobs.set(id, buf);
      let copy;
      try { copy = buf.getChannelData(0).slice(); } catch (e) { return peaksInline(buf); } // copy so we never detach the live buffer
      try { w.postMessage({ id, block: BLOCK, data: copy }, [copy.buffer]); }
      catch (e) { peakPending.delete(buf); peakJobs.delete(id); return peaksInline(buf); }
    }
    return null; // not ready yet — caller draws the clip without its waveform this frame
  }

  /* ---------- init ---------- */
  TL.init = (scrollEl, canvasEl, headersEl) => {
    scroll = scrollEl;
    canvas = canvasEl;
    headers = headersEl;
    spacer = document.getElementById('tl-spacer');
    g = canvas.getContext('2d');
    scroll.addEventListener('scroll', () => (TL.dirty = true));
    new ResizeObserver(() => TL.resize()).observe(scroll);
    // pointer events: mouse, pen and touch all go through the same handlers
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', touchDown, true);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && onHover(e));
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('contextmenu', (e) => {
      // touch: Android's own long-press may arrive first; open the menu once either way
      if (lastWasTouch) {
        e.preventDefault();
        if (longPressFired) return;
        longPressFired = true;
        clearTimeout(longPress);
        drag = null;
        pan = null;
      }
      onContext(e);
    });
    window.addEventListener('pointermove', (e) => !touchMove(e) && onMove(e));
    window.addEventListener('pointerup', (e) => !touchUp(e) && onUp(e));
    window.addEventListener('pointercancel', (e) => {
      touchUp(e);
      onUp(e);
    });
    window.addEventListener('keydown', (e) => e.key === 'Shift' && TL.tool === 'slice' && (TL.dirty = true));
    window.addEventListener('keyup', (e) => e.key === 'Shift' && TL.tool === 'slice' && (TL.dirty = true));
    canvas.addEventListener(
      'wheel',
      (e) => {
        // trackpad horizontal swipe, or Shift+wheel -> scroll along the timeline
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          e.preventDefault();
          scroll.scrollLeft += e.deltaX;
          return;
        }
        if (e.shiftKey) {
          e.preventDefault();
          scroll.scrollLeft += e.deltaY;
          return;
        }
        // plain wheel (or Ctrl+wheel) -> zoom in/out, keeping the point under the cursor still
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const step = Math.min(2, Math.max(1.05, 1 + Math.abs(e.deltaY) / 400)); // smoother with trackpads
        TL.zoom(e.deltaY < 0 ? step : 1 / step, e.clientX - rect.left);
      },
      { passive: false }
    );
    TL.resize();
  };

  TL.height = () => RULER + S.project.tracks.length * ROW;

  TL.resize = () => {
    if (!canvas) return;
    const w = scroll.clientWidth;
    // If the container is momentarily 0-wide (hidden during a tab/layout switch, mid-reflow),
    // DON'T resize — setting canvas.width clears it to a 1px blank, and if a redraw doesn't land
    // the timeline shows the app background straight through. Keep the last good size and retry.
    if (w <= 0) { TL.dirty = true; return; }
    const dpr = window.devicePixelRatio || 1;
    const h = TL.height();
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    scroll.style.height = h + 'px';
    updateExtent();
    TL.dirty = true;
  };

  /** Width of the scrollable area (cheap; used every frame while zooming). */
  function updateExtent() {
    const total = Math.max(scroll.clientWidth, (Math.max(S.projectLength(), 30) + 30) * TL.pps);
    spacer.style.width = total + 'px';
  }

  /* Smooth zoom: the zoom level glides to its target over a few frames, keeping the point under the mouse still. */
  let zoomAnim = null;
  TL.zoom = (factor, atX) => {
    const x = atX == null ? scroll.clientWidth / 2 : atX;
    const target = S.clamp((zoomAnim ? zoomAnim.target : TL.pps) * factor, 4, 800);
    zoomAnim = { target, anchor: (scroll.scrollLeft + x) / TL.pps, x };
    TL.dirty = true;
  };
  function stepZoom() {
    if (!zoomAnim) return false;
    const r = zoomAnim.target / TL.pps;
    if (Math.abs(r - 1) < 0.003) {
      TL.pps = zoomAnim.target;
      zoomAnim = Object.assign(zoomAnim, { done: true });
    } else TL.pps *= Math.pow(r, 0.3);
    updateExtent();
    scroll.scrollLeft = Math.max(0, zoomAnim.anchor * TL.pps - zoomAnim.x);
    if (zoomAnim.done) zoomAnim = null;
    return true;
  }

  /* Eased on-screen positions, so clips glide into place (snap steps, track changes, removed tracks). */
  const vis = new WeakMap();
  const EASE = 0.38;
  let animating = false;

  /* ---------- tools ---------- */
  TL.TOOLS = ['select', 'slice', 'erase', 'mute', 'loop'];
  TL.setTool = (t) => {
    if (!TL.TOOLS.includes(t)) return;
    TL.tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    moveToolThumb();
    canvas && (canvas.style.cursor = cursorFor(null));
    TL.dirty = true;
  };

  /* ---------- loop region ---------- */
  function ensureLoop() {
    if (!S.project.loop) S.project.loop = { start: 0, end: 0, on: false };
    return S.project.loop;
  }
  TL.ensureLoop = ensureLoop;
  /** Turn the loop region on/off (L). If none is set, tells the user how to make one. */
  TL.toggleLoop = () => {
    const lp = ensureLoop();
    if (lp.end - lp.start < 0.05) return S.toast('No loop region yet — pick the Loop tool and drag across the timeline.');
    lp.on = !lp.on;
    S.toast(lp.on ? 'Loop on.' : 'Loop off.');
    if (lp.on && S.engine.playing && !S.engine.isRecording && S.playhead >= lp.end) S.seek(lp.start);
    TL.dirty = true;
  };

  /** The highlight behind the active tool slides over instead of jumping. */
  function moveToolThumb() {
    const btn = document.querySelector('[data-tool].active');
    if (!btn || !btn.parentElement) return;
    const pill = btn.parentElement;
    let thumb = pill.querySelector('.tool-thumb');
    const first = !thumb;
    if (first) {
      thumb = document.createElement('span');
      thumb.className = 'tool-thumb no-anim';
      pill.prepend(thumb);
    }
    thumb.style.width = btn.offsetWidth + 'px';
    thumb.style.height = btn.offsetHeight + 'px';
    thumb.style.transform = 'translate(' + btn.offsetLeft + 'px,' + btn.offsetTop + 'px)';
    if (first) requestAnimationFrame(() => requestAnimationFrame(() => thumb.classList.remove('no-anim')));
  }
  window.addEventListener('resize', () => moveToolThumb());

  const svgCursor = (svg, x, y, fb) => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + x + ' ' + y + ', ' + fb;
  const CUR = {
    slice: svgCursor(
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><g stroke="black" stroke-width="4.5"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></g><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>',
      11,
      11,
      'crosshair'
    ),
    erase: svgCursor(
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21z" fill="#ff4d5e" stroke="black" stroke-width="1.5"/></svg>',
      4,
      19,
      'pointer'
    ),
    mute: svgCursor(
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="#fbbf24" stroke="black" stroke-width="1.5"/><path d="m22 9-6 6M16 9l6 6" stroke="black" stroke-width="4"/><path d="m22 9-6 6M16 9l6 6" stroke="#fbbf24" stroke-width="2"/></svg>',
      6,
      12,
      'pointer'
    ),
  };
  const CURSORS = { fadeIn: 'col-resize', fadeOut: 'col-resize', gain: 'ns-resize', trimL: 'w-resize', trimR: 'e-resize' };
  function cursorFor(mode, hit) {
    if (TL.tool === 'loop') return 'ew-resize';
    if (TL.tool !== 'select') return CUR[TL.tool];
    if (mode) return CURSORS[mode];
    return hit ? 'grab' : 'default';
  }

  /* ---------- track headers ---------- */
  TL.renderHeaders = () => {
    const p = S.project;
    headers.innerHTML = '';
    const sp = document.createElement('div');
    sp.className = 'ruler-spacer';
    sp.innerHTML = '<span class="lbl">Tracks</span><span class="lbl">' + p.tracks.length + '</span>';
    headers.appendChild(sp);

    p.tracks.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'trk' + (t.arm ? ' armed' : '');
      row.style.setProperty('--tc', U.trackColor(t));
      row.oncontextmenu = (e) => {
        if (e.target.closest('input')) return;
        e.preventDefault();
        if (S.match && S.match.trackMenu) S.match.trackMenu(t, e.clientX, e.clientY);
      };

      const top = document.createElement('div');
      top.className = 'top';
      const dot = document.createElement('button');
      dot.className = 'dot';
      dot.title = 'Track colour';
      dot.onclick = (e) => U.colorMenu(t, e.clientX, e.clientY);
      const name = document.createElement('input');
      name.className = 'tname';
      name.value = t.name;
      name.spellcheck = false;
      name.onchange = () => {
        S.history.push();
        t.name = name.value || 'Track';
        S.mixer.render();
      };
      top.append(dot, name);
      row.appendChild(top);

      const btns = document.createElement('div');
      btns.className = 'btns';
      const mk = (txt, title, on, cls, fn) => {
        const b = document.createElement('button');
        b.className = 'tb' + (on ? ' ' + cls : '');
        b.textContent = txt;
        b.title = title;
        b.onclick = fn;
        btns.appendChild(b);
        return b;
      };
      mk('R', 'Arm for recording', t.arm, 'on-r', async () => {
        const turningOn = !t.arm;
        if (turningOn && !(await S.ensureInput())) return;
        p.tracks.forEach((x) => (x.arm = false));
        t.arm = turningOn;
        TL.renderHeaders();
        S.mixer.render();
        TL.dirty = true;
      });
      mk('M', 'Mute', t.mute, 'on-m', () => {
        S.history.push();
        t.mute = !t.mute;
        S.refresh.structure();
      });
      mk('S', 'Solo', t.solo, 'on-s', () => {
        S.history.push();
        t.solo = !t.solo;
        S.refresh.structure();
      });
      const h = mk('', 'Monitor input through this track and its effects (use headphones)', S.engine && S.engine.monitorTrackId === t.id, 'on-h', async () => {
        if (S.engine.monitorTrackId === t.id) S.engine.setMonitor(null);
        else {
          if (!(await S.ensureInput())) return;
          S.engine.setMonitor(t.id);
        }
        TL.renderHeaders();
      });
      h.innerHTML = U.icon('headphones', 12);
      const del = mk('', 'Remove track', false, '', () => {
        if (p.tracks.length <= 1) return S.toast('Keep at least one track');
        if (t.clips.length && !confirm('Remove "' + t.name + '" and its clips? (You can undo this.)')) return;
        S.history.push();
        if (S.engine.monitorTrackId === t.id) S.engine.setMonitor(null);
        p.tracks.splice(p.tracks.indexOf(t), 1);
        S.refresh.structure();
      });
      del.innerHTML = U.icon('trash', 12);
      del.classList.add('del');
      row.appendChild(btns);

      // the track's effect chain: effects live on the track, every clip on it plays through them
      row.appendChild(U.fxChain(t.fx, t, { compact: true }));
      headers.appendChild(row);
    });

    const add = document.createElement('button');
    add.className = 'btn add-track';
    add.innerHTML = U.icon('plus', 14) + 'Add track';
    add.onclick = () => {
      S.history.push();
      p.tracks.push(S.newTrack(p.tracks.length));
      S.refresh.structure();
    };
    headers.appendChild(add);
    TL.resize();
  };

  /* ---------- hit testing ---------- */
  const rowAtY = (y) => Math.floor((y - RULER) / ROW);

  /** Track index under a screen point (for drag-and-drop onto a specific track), or -1. */
  TL.trackAtClient = (cx, cy) => {
    if (!canvas) return -1;
    const r = canvas.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return -1;
    const row = rowAtY(cy - r.top);
    return row >= 0 && row < S.project.tracks.length ? row : -1;
  };

  function findClip(t, row) {
    const tr = S.project.tracks[row];
    if (!tr) return null;
    for (let i = tr.clips.length - 1; i >= 0; i--) {
      const c = tr.clips[i];
      if (t >= c.start && t <= c.start + c.dur) return { clip: c, track: tr };
    }
    return null;
  }

  /** 'trimL' / 'trimR' when the pointer is within 7px of a clip edge (and the clip is wide enough to grab). */
  function edgeAt(clip, t) {
    if (clip.dur * TL.pps < 24) return null;
    if (Math.abs(t - clip.start) * TL.pps <= 7) return 'trimL';
    if (Math.abs(t - (clip.start + clip.dur)) * TL.pps <= 7) return 'trimR';
    return null;
  }

  /* fade and gain handles sit in the clip's title strip (shown on hovered/selected clips) */
  const HANDLE_MIN_W = 40;
  const fadeInX = (c) => c.start * TL.pps + Math.max((c.fadeIn || 0) * TL.pps, 5);
  const fadeOutX = (c) => (c.start + c.dur) * TL.pps - Math.max((c.fadeOut || 0) * TL.pps, 5);
  const gainX = (c) => (c.start + c.dur / 2) * TL.pps;

  function handleAt(clip, row, x, y) {
    const cw = clip.dur * TL.pps;
    if (cw < HANDLE_MIN_W) return null;
    const yIn = y - RULER - row * ROW;
    if (yIn < CLIP_TOP - 1 || yIn > CLIP_TOP + HEAD_H + 2) return null;
    const ax = x + scroll.scrollLeft;
    if (Math.abs(ax - fadeInX(clip)) <= 6) return 'fadeIn';
    if (Math.abs(ax - fadeOutX(clip)) <= 6) return 'fadeOut';
    if (cw >= 70 && Math.abs(ax - gainX(clip)) <= 9) return 'gain';
    return null;
  }

  /** Magnet points while dragging: edges of other clips + the playhead. */
  function magnets(exclude) {
    const pts = [S.playhead];
    for (const tr of S.project.tracks) for (const c of tr.clips) if (!exclude.has(c.id)) pts.push(c.start, c.start + c.dur);
    return pts;
  }
  const snapT = (t, e, extra = []) => S.grid.snap(t, { free: e && e.altKey, extra, pps: TL.pps });

  /* ---------- pointer ---------- */
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const timeAtX = (x) => (x + scroll.scrollLeft) / TL.pps;

  function onHover(e) {
    if (drag) return;
    const { x, y } = local(e);
    const t = timeAtX(x);
    const row = rowAtY(y);
    const hit = y >= RULER ? findClip(t, row) : null;
    const handle = hit && TL.tool === 'select' ? handleAt(hit.clip, row, x, y) : null;
    const mode = hit && TL.tool === 'select' ? handle || edgeAt(hit.clip, t) : null;
    canvas.style.cursor = y < RULER ? 'col-resize' : cursorFor(mode, hit);
    const id = hit ? hit.clip.id : null;
    const needs = TL.tool === 'slice' || id !== TL.hover || handle !== TL.hoverHandle || row !== TL.hoverRow;
    TL.hover = id;
    TL.hoverHandle = handle;
    TL.hoverRow = row;
    TL.hoverT = y >= RULER ? t : null;
    TL.hoverShift = e.shiftKey;
    TL.hoverAlt = e.altKey;
    if (needs) TL.dirty = true;
  }

  function onLeave() {
    if (drag) return;
    TL.hover = TL.hoverHandle = TL.hoverT = null;
    TL.hoverRow = -1;
    TL.dirty = true;
  }

  /** Double-click: reset a handle; on empty space with the select tool, move the playhead there. */
  function onDouble(e) {
    const { x, y } = local(e);
    if (y < RULER || TL.tool !== 'select') return;
    const t = timeAtX(x);
    const row = rowAtY(y);
    const hit = findClip(t, row);
    const handle = hit && handleAt(hit.clip, row, x, y);
    if (!handle) return;
    S.history.push();
    if (handle === 'fadeIn') hit.clip.fadeIn = 0;
    else if (handle === 'fadeOut') hit.clip.fadeOut = 0;
    else hit.clip.gain = 1;
    S.clips.afterEdit();
  }

  /* ---------- touch: swipe empty space to scroll, pinch to zoom, long-press for the clip menu ---------- */
  const touches = new Map(); // pointerId -> {x, y}
  let pinch = null;
  let pan = null;
  let longPress = null;
  const isTouch = (e) => e.pointerType === 'touch';

  /** Runs before onDown. Returns nothing; may stop onDown by setting e.stopImmediatePropagation(). */
  let lastWasTouch = false;
  let longPressFired = false;
  function touchDown(e) {
    lastWasTouch = isTouch(e);
    if (lastWasTouch && touches.size === 0) longPressFired = false;
    if (!isTouch(e)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(longPress);
    if (touches.size === 2) {
      // second finger: pinch zoom (any drag that hadn't really started is dropped)
      if (drag && !drag.moved) drag = null;
      pan = null;
      const [a, b] = [...touches.values()];
      const r = canvas.getBoundingClientRect();
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, pps0: TL.pps, cx: (a.x + b.x) / 2 - r.left };
      e.stopImmediatePropagation();
      return;
    }
    const { x, y } = local(e);
    const sx = e.clientX;
    const sy = e.clientY;
    longPress = setTimeout(() => {
      // long-press = right-click: clip menu (or paste / select menu on empty space)
      if ((drag && drag.moved) || longPressFired) return;
      longPressFired = true;
      drag = null;
      pan = null;
      if (navigator.vibrate) navigator.vibrate(12);
      onContext({ preventDefault() {}, clientX: sx, clientY: sy, _x: x, _y: y });
    }, 480);
    // finger on empty space with the select tool scrolls the timeline instead of drawing a box
    const t = timeAtX(x);
    const row = rowAtY(y);
    if (y >= RULER && TL.tool === 'select' && !findClip(t, row)) {
      const tl = document.getElementById('timeline');
      pan = { x: e.clientX, y: e.clientY, sl: scroll.scrollLeft, st: tl ? tl.scrollTop : 0, tl, moved: false, t };
      e.stopImmediatePropagation();
    }
  }

  /** Returns true when the event was used for a touch gesture. */
  function touchMove(e) {
    if (!isTouch(e) || !touches.has(e.pointerId)) return false;
    const p = touches.get(e.pointerId);
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) clearTimeout(longPress);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: true });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const target = S.clamp(pinch.pps0 * (d / pinch.d0), 4, 800);
      TL.zoom(target / TL.pps, pinch.cx);
      return true;
    }
    if (pan) {
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) pan.moved = true;
      scroll.scrollLeft = pan.sl - dx;
      if (pan.tl) pan.tl.scrollTop = pan.st - dy;
      TL.dirty = true;
      return true;
    }
    return false;
  }

  function touchUp(e) {
    if (!isTouch(e)) return false;
    clearTimeout(longPress);
    touches.delete(e.pointerId);
    if (pinch) {
      if (touches.size < 2) pinch = null;
      return true;
    }
    if (pan) {
      const p = pan;
      pan = null;
      if (!p.moved) {
        // a tap on empty space: deselect and move the playhead there
        TL.selected = null;
        S.seek(S.grid.snap(p.t, { pps: TL.pps }));
      }
      return true;
    }
    return false;
  }

  function onContext(e) {
    e.preventDefault();
    const { x, y } = e._x != null ? { x: e._x, y: e._y } : local(e);
    if (y < RULER) return;
    const t = timeAtX(x);
    const row = S.clamp(rowAtY(y), 0, S.project.tracks.length - 1);
    S.clips.showContextMenu({ x: e.clientX, y: e.clientY, t, row, hit: findClip(t, row) });
  }

  function onDown(e) {
    if (e.button !== 0) return;
    S.clips.closeMenu();
    const { x, y } = local(e);
    const t = timeAtX(x);
    if (TL.tool === 'loop') {
      // drag across the timeline (or ruler) to set the loop region
      const at = Math.max(0, snapT(t, e));
      const lp = ensureLoop();
      lp.start = at; lp.end = at; lp.on = false;
      drag = { loop: true, anchor: at, moved: false };
      TL.dirty = true;
      return;
    }
    if (y < RULER) {
      S.seek(snapT(t, e));
      drag = { seek: true };
      return;
    }
    const row = rowAtY(y);
    const hit = findClip(t, row);

    if (TL.tool === 'slice') {
      const at = snapT(t, e, magnets(new Set()));
      if (e.shiftKey) return sliceAll(at);
      if (!hit) return S.seek(at);
      if (!cuttable(hit.clip, at)) return S.toast('Too close to the edge of the clip to cut there');
      S.history.push();
      TL.selected = S.clipOps.split(hit.track, hit.clip, at).id;
      S.clips.afterEdit();
      return;
    }
    if (TL.tool === 'erase') {
      drag = { erase: true, pre: S.history.snap(), moved: false };
      eraseAt(t, row);
      return;
    }
    if (TL.tool === 'mute') {
      if (!hit) return;
      S.history.push();
      const targets = sel.has(hit.clip.id) ? TL.selectedClips().map((s) => s.clip) : [hit.clip];
      const to = !hit.clip.muted;
      targets.forEach((c) => (c.muted = to));
      S.clips.afterEdit();
      return;
    }

    // select tool
    if (!hit) {
      drag = { marquee: true, x0: x + scroll.scrollLeft, y0: y, x1: x + scroll.scrollLeft, y1: y, add: e.shiftKey || e.ctrlKey || e.metaKey, base: new Set(sel), moved: false, t, e };
      return;
    }
    const clip = hit.clip;
    const ctrl = e.ctrlKey || e.metaKey;
    let toggleOffOnClick = false;
    if (e.shiftKey) {
      toggleSelect(clip.id);
      if (!sel.has(clip.id)) return; // just deselected it
    } else if (ctrl) {
      // Ctrl+click toggles; Ctrl+drag copies (so a selected clip stays selected until we know which)
      if (sel.has(clip.id)) toggleOffOnClick = true;
      else toggleSelect(clip.id);
    } else if (!sel.has(clip.id)) TL.selected = clip.id;
    else primary = clip.id;

    const mode = handleAt(clip, row, x, y) || edgeAt(clip, t) || (e.altKey ? 'slip' : 'move');
    const group = mode === 'move' ? TL.selectedClips() : [hit];
    drag = {
      clip,
      track: hit.track,
      mode,
      grab: t - clip.start,
      grabRow: row,
      moved: false,
      pre: S.history.snap(),
      y0: e.clientY,
      x0: e.clientX,
      db0: 20 * Math.log10(Math.max(clip.gain, 0.0001)),
      off0: clip.offset,
      t0: t,
      copy: ctrl && mode === 'move',
      toggleOffOnClick,
      group: group.map((s) => ({ clip: s.clip, start0: s.clip.start, row0: S.project.tracks.indexOf(s.track) })),
      fiGrab: t - (clip.start + (clip.fadeIn || 0)),
      foGrab: t - (clip.start + clip.dur - (clip.fadeOut || 0)),
    };
    TL.dirty = true;
  }

  function eraseAt(t, row) {
    const hit = findClip(t, row);
    if (!hit) return;
    S.clipOps.remove(hit.track, hit.clip);
    sel.delete(hit.clip.id);
    if (primary === hit.clip.id) primary = null;
    drag.moved = true;
    TL.dirty = true;
  }

  const cuttable = (c, at) => at > c.start + 0.021 && at < c.start + c.dur - 0.021;

  function sliceAll(at) {
    if (!S.project.tracks.some((tr) => tr.clips.some((c) => cuttable(c, at)))) return S.toast('No clip crosses that point');
    S.history.push();
    let n = 0;
    for (const tr of S.project.tracks) for (const c of [...tr.clips]) if (cuttable(c, at) && S.clipOps.split(tr, c, at)) n++;
    S.toast('Cut ' + n + ' clip' + (n > 1 ? 's' : '') + ' at ' + (S.project.grid.mode === 'bars' ? S.grid.bbt(at) : at.toFixed(3) + ' s'));
    S.clips.afterEdit();
  }

  let autoScroll = null;
  function stopAutoScroll() { if (autoScroll) { cancelAnimationFrame(autoScroll.raf); autoScroll = null; } }
  /** While dragging near the left/right edge, scroll the view so the playhead or clip keeps following the pointer. */
  function edgeAutoScroll(e) {
    if (!drag || drag.mode === 'gain') { stopAutoScroll(); return; }
    const rect = scroll.getBoundingClientRect();
    const EDGE = 50;
    let v = 0;
    if (e.clientX < rect.left + EDGE) v = -(rect.left + EDGE - e.clientX);
    else if (e.clientX > rect.right - EDGE) v = e.clientX - (rect.right - EDGE);
    if (!v) { stopAutoScroll(); return; }
    v = Math.sign(v) * Math.min(26, 2 + Math.abs(v) * 0.5);
    autoScroll = autoScroll || {};
    autoScroll.v = v; autoScroll.e = e;
    if (autoScroll.raf) return;
    const step = () => {
      if (!drag || !autoScroll) { stopAutoScroll(); return; }
      const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const ns = S.clamp(scroll.scrollLeft + autoScroll.v, 0, max);
      if (ns !== scroll.scrollLeft) { scroll.scrollLeft = ns; applyDrag(autoScroll.e); TL.dirty = true; }
      autoScroll.raf = requestAnimationFrame(step);
    };
    autoScroll.raf = requestAnimationFrame(step);
  }

  function onMove(e) {
    if (!drag) return;
    edgeAutoScroll(e);
    applyDrag(e);
  }

  function applyDrag(e) {
    if (!drag) return;
    const { x, y } = local(e);
    const t = timeAtX(x);
    if (drag.loop) {
      const at = Math.max(0, snapT(t, e));
      const lp = ensureLoop();
      lp.start = Math.min(drag.anchor, at);
      lp.end = Math.max(drag.anchor, at);
      drag.moved = true;
      TL.dirty = true;
      return;
    }
    if (drag.seek) {
      S.seek(snapT(t, e));
      return;
    }
    if (drag.erase) {
      eraseAt(t, rowAtY(y));
      return;
    }
    if (drag.marquee) {
      drag.x1 = x + scroll.scrollLeft;
      drag.y1 = y;
      if (Math.abs(drag.x1 - drag.x0) + Math.abs(drag.y1 - drag.y0) > 4) drag.moved = true;
      if (drag.moved) marqueeSelect();
      TL.dirty = true;
      return;
    }
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3 && Math.abs(e.clientY - drag.y0) < 3) return;
    const c = drag.clip;
    if (!drag.moved && drag.copy) duplicateForDrag();
    drag.moved = true;

    if (drag.mode === 'fadeIn') S.clipOps.setFadeIn(c, t - drag.fiGrab - c.start);
    else if (drag.mode === 'fadeOut') S.clipOps.setFadeOut(c, c.start + c.dur - (t - drag.foGrab));
    else if (drag.mode === 'gain') {
      // 0.25 dB per pixel, Shift for fine (0.05 dB); snaps to 0 dB when close
      let db = drag.db0 + (drag.y0 - e.clientY) * (e.shiftKey ? 0.05 : 0.25);
      if (!e.shiftKey && Math.abs(db) < 0.4) db = 0;
      S.clipOps.setGainDb(c, db);
    } else if (drag.mode === 'trimL') S.clipOps.trimStart(c, snapT(t, e, magnets(new Set([c.id]))));
    else if (drag.mode === 'trimR') S.clipOps.trimEnd(c, snapT(t, e, magnets(new Set([c.id]))));
    else if (drag.mode === 'slip') {
      // move the audio inside the clip; the clip itself stays put
      c.offset = drag.off0;
      S.clipOps.slip(c, -(t - drag.t0));
    } else moveGroup(t, y, e);
    TL.dirty = true;
  }

  /** Move every selected clip together: time snaps by the clip under the pointer, tracks shift by the same number of rows. */
  function moveGroup(t, y, e) {
    const c = drag.clip;
    const me = drag.group.find((g) => g.clip === c);
    const ids = new Set(drag.group.map((g) => g.clip.id));
    let start = t - drag.grab;
    if (!e.altKey && S.grid.enabled()) {
      const mags = magnets(ids);
      const a = snapT(start, e, mags);
      const b = snapT(start + c.dur, e, mags) - c.dur;
      start = Math.abs(a - start) <= Math.abs(b - start) ? a : b;
    }
    let dt = start - me.start0;
    const minStart = Math.min(...drag.group.map((g) => g.start0));
    if (minStart + dt < 0) dt = -minStart;
    const rows = S.project.tracks.length;
    let dr = S.clamp(rowAtY(y), 0, rows - 1) - drag.grabRow;
    const minRow = Math.min(...drag.group.map((g) => g.row0));
    const maxRow = Math.max(...drag.group.map((g) => g.row0));
    dr = S.clamp(dr, -minRow, rows - 1 - maxRow);
    for (const gItem of drag.group) {
      gItem.clip.start = Math.max(0, gItem.start0 + dt);
      const target = S.project.tracks[gItem.row0 + dr];
      const cur = S.project.tracks.find((tr) => tr.clips.includes(gItem.clip));
      if (cur !== target) {
        cur.clips.splice(cur.clips.indexOf(gItem.clip), 1);
        target.clips.push(gItem.clip);
      }
    }
  }

  /** Ctrl+drag: leave copies where the clips were and drag the originals. */
  function duplicateForDrag() {
    for (const gItem of drag.group) {
      const tr = S.project.tracks[gItem.row0];
      tr.clips.push(Object.assign({}, gItem.clip, { id: S.uid(), start: gItem.start0 }));
    }
  }

  function marqueeSelect() {
    const t0 = Math.min(drag.x0, drag.x1) / TL.pps;
    const t1 = Math.max(drag.x0, drag.x1) / TL.pps;
    const r0 = rowAtY(Math.min(drag.y0, drag.y1));
    const r1 = rowAtY(Math.max(drag.y0, drag.y1));
    const ids = drag.add ? [...drag.base] : [];
    S.project.tracks.forEach((tr, i) => {
      if (i < r0 || i > r1) return;
      for (const c of tr.clips) if (c.start < t1 && c.start + c.dur > t0) ids.push(c.id);
    });
    TL.selectMany(ids);
  }

  function onUp() {
    stopAutoScroll();
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.loop) {
      const lp = ensureLoop();
      if (lp.end - lp.start < 0.05) { lp.on = false; S.toast('Loop cleared.'); }
      else {
        lp.on = true;
        const fmt = S.project.grid.mode === 'bars'
          ? S.grid.bbt(lp.start) + ' → ' + S.grid.bbt(lp.end)
          : lp.start.toFixed(2) + 's → ' + lp.end.toFixed(2) + 's';
        S.toast('Loop on: ' + fmt + '. Press L to toggle it; switch to Select to edit clips.');
        if (S.engine.playing && !S.engine.isRecording && S.playhead >= lp.end) S.seek(lp.start);
      }
      TL.dirty = true;
      return;
    }
    if (d.toggleOffOnClick && !d.moved) toggleSelect(d.clip.id);
    if (d.marquee && !d.moved) {
      if (!d.add) TL.selected = null;
      S.seek(snapT(d.t, d.e));
    }
    if (d.moved && d.pre) {
      S.history.commit(d.pre);
      TL.resize();
      if (S.engine.playing && !S.engine.isRecording) S.engine.play(S.playhead);
    }
    TL.dirty = true;
  }

  /* ---------- commands (toolbar, keys, menus) ---------- */
  function selectedClip() {
    if (!primary) return null;
    for (const tr of S.project.tracks) {
      const c = tr.clips.find((x) => x.id === primary);
      if (c) return { clip: c, track: tr };
    }
    return null;
  }

  TL.selectedClipObject = () => {
    const s = selectedClip();
    return s ? s.clip : null;
  };

  /** Split the selected clips (or every clip under the playhead if nothing is selected). */
  TL.splitSelected = () => {
    const at = S.playhead;
    let list = TL.selectedClips().filter((s) => at > s.clip.start + 0.02 && at < s.clip.start + s.clip.dur - 0.02);
    if (!sel.size) {
      const armed = S.project.tracks.find((t) => t.arm);
      list = [];
      for (const tr of armed ? [armed] : S.project.tracks) for (const c of tr.clips) if (at > c.start + 0.02 && at < c.start + c.dur - 0.02) list.push({ clip: c, track: tr });
    }
    if (!list.length) return S.toast(sel.size ? 'Move the playhead inside the clip to split it' : 'Select a clip, or put the playhead over one');
    S.history.push();
    const rights = list.map((s) => S.clipOps.split(s.track, s.clip, at)).filter(Boolean);
    TL.selectMany(rights.map((r) => r.id));
    S.clips.afterEdit();
  };

  TL.deleteSelected = () => {
    const list = TL.selectedClips();
    if (!list.length) return;
    S.history.push();
    list.forEach((s) => S.clipOps.remove(s.track, s.clip));
    TL.selected = null;
    S.clips.afterEdit();
  };

  /** Duplicate the selection right after itself (keeps the gaps and tracks). */
  TL.duplicateSelected = () => {
    const list = TL.selectedClips();
    if (!list.length) return;
    S.history.push();
    const from = Math.min(...list.map((s) => s.clip.start));
    const to = Math.max(...list.map((s) => s.clip.start + s.clip.dur));
    let span = to - from;
    if (S.grid.enabled()) span = Math.max(S.grid.step(), Math.ceil(span / S.grid.step() - 1e-6) * S.grid.step());
    const copies = list.map((s) => {
      const copy = Object.assign({}, s.clip, { id: S.uid(), start: s.clip.start + span });
      s.track.clips.push(copy);
      return copy.id;
    });
    TL.selectMany(copies);
    S.clips.afterEdit();
  };

  TL.nudgeSelected = (dt) => {
    const list = TL.selectedClips();
    if (!list.length) return S.toast('Select a clip first');
    S.history.push();
    list.forEach((s) => S.clipOps.nudge(s.clip, dt));
    S.clips.afterEdit();
    const c = selectedClip() || list[0];
    S.toast((list.length > 1 ? list.length + ' clips moved ' : 'Clip starts at ' + c.clip.start.toFixed(3) + ' s ') + '(' + (dt > 0 ? '+' : '') + Math.round(dt * 1000) + ' ms)');
  };

  TL.copySelected = () => {
    const list = TL.selectedClips();
    if (list.length) S.clips.copy(list.map((s) => s.clip));
  };

  TL.pasteAtPlayhead = () => {
    const s = selectedClip();
    const armed = S.project.tracks.findIndex((t) => t.arm);
    const idx = s ? S.project.tracks.indexOf(s.track) : Math.max(0, armed);
    S.clips.paste(idx, S.playhead);
  };

  /* ---------- drawing ---------- */
  const timeLabel = (s) => {
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + (Number.isInteger(Math.round(r * 10) / 10) ? Math.round(r).toFixed(0) : r.toFixed(1));
  };
  function tickStep() {
    const target = 90 / TL.pps;
    for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s >= target) return s;
    return 600;
  }

  const dbText = (gain) => {
    const db = 20 * Math.log10(Math.max(gain, 0.0001));
    return (db > 0.05 ? '+' : '') + db.toFixed(1) + ' dB';
  };

  function rr(x, y, w, h, r) {
    g.beginPath();
    g.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, w / 2, h / 2));
  }

  function pill(text, cx, y, fg = '#ffffff') {
    g.font = '600 11px ' + 'Segoe UI, system-ui, sans-serif';
    const tw = g.measureText(text).width + 14;
    const bx = Math.round(cx - tw / 2);
    g.fillStyle = 'rgba(8,9,12,.92)';
    rr(bx, y, tw, 19, 6);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = fg;
    g.textBaseline = 'middle';
    g.fillText(text, bx + 7, y + 10);
  }

  /** shift = canvas x of time 0 (i.e. -scrollLeft). */
  function drawHandles(c, shift, y, cw, active) {
    const hot = (name) => active === name || (!active && TL.hover === c.id && TL.hoverHandle === name);
    const knob = (x, name) => {
      g.fillStyle = hot(name) ? '#22d3ee' : '#ffffff';
      g.strokeStyle = 'rgba(0,0,0,.65)';
      g.lineWidth = 1;
      rr(Math.round(x) - 4, y + CLIP_TOP + 4, 8, 8, 2.5);
      g.fill();
      g.stroke();
    };
    knob(fadeInX(c) + shift, 'fadeIn');
    knob(fadeOutX(c) + shift, 'fadeOut');
    if (cw >= 70) {
      const gx = Math.round(gainX(c) + shift);
      const gy = y + CLIP_TOP + 8;
      g.fillStyle = hot('gain') ? '#22d3ee' : '#ffffff';
      g.beginPath();
      g.moveTo(gx, gy - 5);
      g.lineTo(gx + 5, gy);
      g.lineTo(gx, gy + 5);
      g.lineTo(gx - 5, gy);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.65)';
      g.stroke();
    }
    const which = active && ['fadeIn', 'fadeOut', 'gain'].includes(active) ? active : TL.hover === c.id ? TL.hoverHandle : null;
    if (!which) return;
    if (which === 'gain') pill(dbText(c.gain), gainX(c) + shift, y + CLIP_TOP + HEAD_H + 3);
    else if (which === 'fadeIn') pill('Fade in ' + (c.fadeIn || 0).toFixed(2) + ' s', fadeInX(c) + shift, y + CLIP_TOP + HEAD_H + 3);
    else pill('Fade out ' + (c.fadeOut || 0).toFixed(2) + ' s', fadeOutX(c) + shift, y + CLIP_TOP + HEAD_H + 3);
  }

  function drawGrid(w, h, off) {
    const p = S.project;
    const grid = p.grid;
    // ruler background
    const rg = g.createLinearGradient(0, 0, 0, RULER);
    rg.addColorStop(0, S.background.shade([30, 32, 40]));
    rg.addColorStop(1, S.background.shade([20, 21, 27]));
    g.fillStyle = rg;
    g.fillRect(0, 0, w, RULER);
    g.fillStyle = 'rgba(255,255,255,.07)';
    g.fillRect(0, RULER - 1, w, 1);
    g.textBaseline = 'middle';
    g.font = '600 11px Segoe UI, system-ui, sans-serif';

    // Any grid line closer than this (in px) is invisible, so we never draw past it — and
    // a hard cap guarantees a bad tempo/zoom can never spin a draw loop forever (freeze).
    const MINPX = 2, CAP = 20000;
    if (grid.mode === 'bars') {
      const beat = S.grid.beat();
      const bar = S.grid.bar();
      const step = S.grid.step();
      // fine snap lines
      if (step * TL.pps >= 7 && step < beat - 1e-9) {
        g.fillStyle = 'rgba(255,255,255,.025)';
        for (let i = Math.floor(off / TL.pps / step), n = 0; i * step * TL.pps - off < w && n < CAP; i++, n++) g.fillRect(Math.round(i * step * TL.pps - off), RULER, 1, h - RULER);
      }
      // beats
      if (beat * TL.pps >= 7) {
        for (let i = Math.floor(off / TL.pps / beat), n = 0; i * beat * TL.pps - off < w && n < CAP; i++, n++) {
          const x = Math.round(i * beat * TL.pps - off);
          g.fillStyle = 'rgba(255,255,255,.05)';
          g.fillRect(x, RULER, 1, h - RULER);
          g.fillStyle = 'rgba(255,255,255,.2)';
          g.fillRect(x, RULER - 5, 1, 4);
        }
      }
      // bars, labelled every n bars so labels never collide — only when bars are wide enough to see
      if (bar * TL.pps >= MINPX) {
        const every = Math.max(1, Math.pow(2, Math.ceil(Math.log2(Math.max(1, 40 / (bar * TL.pps))))));
        for (let i = Math.floor(off / TL.pps / bar), n = 0; i * bar * TL.pps - off < w && n < CAP; i++, n++) {
          const x = Math.round(i * bar * TL.pps - off);
          g.fillStyle = 'rgba(255,255,255,.1)';
          g.fillRect(x, RULER, 1, h - RULER);
          if (i % every === 0) {
            g.fillStyle = 'rgba(255,255,255,.45)';
            g.fillRect(x, 4, 1, RULER - 5);
            g.fillStyle = '#d7d9e0';
            g.fillText(String(i + 1), x + 5, 12);
            if (bar * TL.pps * every > 90) {
              g.fillStyle = '#5b5e69';
              g.font = '10px Segoe UI, system-ui, sans-serif';
              g.fillText(timeLabel(i * bar), x + 5, 25);
              g.font = '600 11px Segoe UI, system-ui, sans-serif';
            }
          }
        }
      }
    } else {
      const step = S.grid.step();
      if (step * TL.pps >= 7) {
        g.fillStyle = 'rgba(255,255,255,.035)';
        for (let i = Math.floor(off / TL.pps / step), n = 0; i * step * TL.pps - off < w && n < CAP; i++, n++) g.fillRect(Math.round(i * step * TL.pps - off), RULER, 1, h - RULER);
      }
      const ts = tickStep();
      if (ts > 0 && ts * TL.pps >= MINPX) {
        for (let s = Math.floor(off / TL.pps / ts) * ts, n = 0; s * TL.pps - off < w && n < CAP; s += ts, n++) {
          const x = Math.round(s * TL.pps - off);
          g.fillStyle = 'rgba(255,255,255,.09)';
          g.fillRect(x, RULER, 1, h - RULER);
          g.fillStyle = 'rgba(255,255,255,.4)';
          g.fillRect(x, 4, 1, RULER - 5);
          g.fillStyle = '#d7d9e0';
          g.fillText(timeLabel(s), x + 5, 12);
        }
      }
    }
  }

  function drawClip(c, track, i, rowY, w, off) {
    const col = U.trackColor(track);
    let v = vis.get(c);
    const direct = !v || (drag && drag.clip === c && drag.mode !== 'move');
    if (direct) {
      v = { s: c.start, y: rowY };
      vis.set(c, v);
    } else {
      v.s += (c.start - v.s) * EASE;
      v.y += (rowY - v.y) * EASE;
      if (Math.abs(c.start - v.s) * TL.pps < 0.25) v.s = c.start;
      if (Math.abs(rowY - v.y) < 0.25) v.y = rowY;
      if (v.s !== c.start || v.y !== rowY) animating = true;
    }
    const y = v.y;
    const x0 = v.s * TL.pps - off;
    const cw = c.dur * TL.pps;
    if (x0 > w || x0 + cw < 0) return;
    const isSel = sel.has(c.id);
    const erasing = TL.tool === 'erase' && TL.hover === c.id;
    const top = y + CLIP_TOP;
    g.globalAlpha = c.muted ? 0.38 : 1;

    // body
    if (isSel) {
      g.shadowColor = U.rgba(col, 0.55);
      g.shadowBlur = 14;
    }
    const bg = g.createLinearGradient(0, top, 0, top + CLIP_H);
    bg.addColorStop(0, U.rgba(col, isSel ? 0.34 : 0.24));
    bg.addColorStop(1, U.rgba(col, isSel ? 0.2 : 0.12));
    g.fillStyle = erasing ? 'rgba(255,77,94,.35)' : bg;
    rr(x0, top, cw, CLIP_H, 7);
    g.fill();
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';

    g.save();
    rr(x0, top, cw, CLIP_H, 7);
    g.clip();
    // title strip
    g.fillStyle = U.rgba(col, isSel ? 0.95 : 0.7);
    g.fillRect(x0, top, cw, HEAD_H);

    // waveform (mirrored, filled)
    const buf = S.buffers.get(c.asset);
    const pk = buf ? peaksFor(buf) : null; // null = peaks still computing in the worker
    if (buf && pk) {
      const mid = top + HEAD_H + (CLIP_H - HEAD_H) / 2;
      const amp = (CLIP_H - HEAD_H - 8) / 2;
      const from = Math.max(0, Math.floor(-x0));
      const to = Math.min(Math.ceil(cw), Math.ceil(w - x0));
      const n = Math.max(0, to - from);
      const tops = new Float32Array(n);
      const bots = new Float32Array(n);
      for (let q = 0; q < n; q++) {
        const px = from + q;
        const t0 = c.offset + px / TL.pps;
        const t1 = c.offset + (px + 1) / TL.pps;
        let i0 = Math.floor((t0 * pk.sr) / BLOCK);
        let i1 = Math.max(i0 + 1, Math.ceil((t1 * pk.sr) / BLOCK));
        i0 = Math.max(0, i0);
        i1 = Math.min(pk.min.length, i1);
        let lo = 0;
        let hi = 0;
        for (let k = i0; k < i1; k++) {
          if (pk.min[k] < lo) lo = pk.min[k];
          if (pk.max[k] > hi) hi = pk.max[k];
        }
        // fade envelope shown on the waveform
        const tc = px / TL.pps;
        let env = c.gain;
        if (c.fadeIn > 0 && tc < c.fadeIn) env *= tc / c.fadeIn;
        if (c.fadeOut > 0 && tc > c.dur - c.fadeOut) env *= Math.max(0, (c.dur - tc) / c.fadeOut);
        tops[q] = mid - S.clamp(hi * env, -1, 1) * amp - 0.5;
        bots[q] = mid - S.clamp(lo * env, -1, 1) * amp + 0.5;
      }
      if (n) {
        // one smooth filled outline instead of separate bars
        const wg = g.createLinearGradient(0, mid - amp, 0, mid + amp);
        wg.addColorStop(0, U.rgba(col, 1));
        wg.addColorStop(0.5, U.rgba(col, 0.82));
        wg.addColorStop(1, U.rgba(col, 1));
        g.fillStyle = wg;
        g.beginPath();
        g.moveTo(x0 + from, tops[0]);
        for (let q = 1; q < n; q++) g.lineTo(x0 + from + q + 0.5, tops[q]);
        for (let q = n - 1; q >= 0; q--) g.lineTo(x0 + from + q + 0.5, bots[q]);
        g.closePath();
        g.fill();
      }
      g.fillStyle = U.rgba(col, 0.25);
      g.fillRect(x0, mid, cw, 1);
    }

    // fade shading + curves
    const bodyTop = top + HEAD_H;
    const bottom = top + CLIP_H;
    if (c.fadeIn > 0.01) {
      const fx = x0 + c.fadeIn * TL.pps;
      g.fillStyle = 'rgba(0,0,0,.32)';
      g.beginPath();
      g.moveTo(x0, bodyTop);
      g.lineTo(fx, bodyTop);
      g.lineTo(x0, bottom);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 1.25;
      g.beginPath();
      g.moveTo(x0, bottom);
      g.quadraticCurveTo(x0 + (fx - x0) * 0.35, bodyTop, fx, bodyTop);
      g.stroke();
    }
    if (c.fadeOut > 0.01) {
      const fx = x0 + cw - c.fadeOut * TL.pps;
      g.fillStyle = 'rgba(0,0,0,.32)';
      g.beginPath();
      g.moveTo(fx, bodyTop);
      g.lineTo(x0 + cw, bodyTop);
      g.lineTo(x0 + cw, bottom);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 1.25;
      g.beginPath();
      g.moveTo(fx, bodyTop);
      g.quadraticCurveTo(fx + (x0 + cw - fx) * 0.65, bodyTop, x0 + cw, bottom);
      g.stroke();
    }

    // title
    g.fillStyle = '#0b0b10';
    g.font = '600 11px Segoe UI, system-ui, sans-serif';
    g.textBaseline = 'middle';
    const gainTag = Math.abs(c.gain - 1) > 0.01 ? '  ' + dbText(c.gain) : '';
    g.fillText((c.muted ? '⨯ ' : '') + c.name + gainTag, Math.max(x0, 0) + 7, top + HEAD_H / 2 + 0.5);
    g.restore();

    // outline
    g.strokeStyle = isSel ? '#ffffff' : U.rgba(col, 0.75);
    g.lineWidth = isSel ? 1.6 : 1;
    rr(x0 + 0.5, top + 0.5, cw - 1, CLIP_H - 1, 7);
    g.stroke();

    // handles on the hovered / selected / dragged clip
    const active = drag && drag.clip === c ? drag.mode : null;
    if (TL.tool === 'select' && cw >= HANDLE_MIN_W && (isSel || TL.hover === c.id || active)) drawHandles(c, -off + (v.s - c.start) * TL.pps, y, cw, active);
    g.globalAlpha = 1;
  }

  TL.draw = () => {
    if (!canvas) return;
    const live = S.engine && (S.engine.playing || S.engine.isRecording);
    if (!TL.dirty && !live && !animating && !zoomAnim) return;
    TL.dirty = false;
    animating = false;
    stepZoom();

    const w = scroll.clientWidth;
    const h = TL.height();
    const p = S.project;

    // Container not laid out yet (0-wide while a tab/panel is mid-switch): don't clear the canvas
    // to transparent — leave the last good frame up and try again once it has a real width.
    if (w <= 0) { TL.dirty = true; return; }

    // follow the playhead smoothly: once it passes 55% of the view, the view scrolls with it
    if (live && !drag) {
      const px = S.playhead * TL.pps;
      const cur = scroll.scrollLeft;
      if (px < cur || px > cur + w) scroll.scrollLeft = Math.max(0, px - w * 0.3);
      else if (px > cur + w * 0.55) scroll.scrollLeft = px - w * 0.55;
    }
    const off = scroll.scrollLeft;
    g.clearRect(0, 0, w, h);

    // rows (tinted with the track colour)
    p.tracks.forEach((t, i) => {
      const y = RULER + i * ROW;
      g.fillStyle = S.background.shade(i % 2 ? [15, 16, 20] : [18, 19, 24]);
      g.fillRect(0, y, w, ROW);
      g.fillStyle = U.rgba(U.trackColor(t), t.arm ? 0.07 : 0.025);
      g.fillRect(0, y, w, ROW);
      g.fillStyle = 'rgba(255,255,255,.045)';
      g.fillRect(0, y + ROW - 1, w, 1);
    });

    drawGrid(w, h, off);

    // loop region (behind clips)
    const lp = p.loop;
    if (lp && lp.end - lp.start > 0.001) {
      const lx = lp.start * TL.pps - off;
      const lw = (lp.end - lp.start) * TL.pps;
      const accent = lp.on ? '#34d399' : '#8a8d99';
      g.fillStyle = lp.on ? 'rgba(52,211,153,.10)' : 'rgba(138,141,153,.06)';
      g.fillRect(lx, RULER, lw, h - RULER);
      // ruler band
      g.fillStyle = lp.on ? 'rgba(52,211,153,.9)' : 'rgba(138,141,153,.75)';
      g.fillRect(lx, RULER - 5, lw, 4);
      // boundary lines
      g.save();
      g.setLineDash([5, 3]);
      g.strokeStyle = accent;
      g.lineWidth = 1;
      [lx, lx + lw].forEach((bx) => { const X = Math.round(bx) + 0.5; g.beginPath(); g.moveTo(X, RULER - 5); g.lineTo(X, h); g.stroke(); });
      g.restore();
      if (lp.on) pill('loop', lx + lw / 2 - 14, RULER + 4, '#34d399');
    }

    p.tracks.forEach((t, i) => {
      const y = RULER + i * ROW;
      for (const c of t.clips) drawClip(c, t, i, y, w, off);
    });

    // recording preview
    if (S.engine && S.engine.isRecording) {
      const r = S.engine.rec;
      const row = p.tracks.findIndex((t) => t.id === r.trackId);
      if (row >= 0) {
        const x0 = r.startPos * TL.pps - off;
        const cw = Math.max(2, (S.playhead - r.startPos) * TL.pps);
        g.fillStyle = 'rgba(255,77,94,.22)';
        rr(x0, RULER + row * ROW + CLIP_TOP, cw, CLIP_H, 7);
        g.fill();
        g.strokeStyle = '#ff4d5e';
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = '#ff4d5e';
        g.fillRect(x0, RULER + row * ROW + CLIP_TOP, cw, 3);
      }
    }

    // slice tool guide
    if (TL.tool === 'slice' && TL.hoverT != null && !drag) {
      const at = S.grid.snap(TL.hoverT, { free: TL.hoverAlt, extra: magnets(new Set()), pps: TL.pps });
      const x = Math.round(at * TL.pps - off) + 0.5;
      g.save();
      g.setLineDash([4, 3]);
      g.strokeStyle = '#22d3ee';
      g.lineWidth = 1;
      g.beginPath();
      if (TL.hoverShift) {
        g.moveTo(x, RULER);
        g.lineTo(x, h);
      } else {
        const y = RULER + TL.hoverRow * ROW;
        g.moveTo(x, y + 2);
        g.lineTo(x, y + ROW - 2);
      }
      g.stroke();
      g.restore();
      pill(p.grid.mode === 'bars' ? S.grid.bbt(at) : at.toFixed(3) + ' s', x, RULER + Math.max(0, TL.hoverRow) * ROW + ROW - 26, '#22d3ee');
    }

    // marquee
    if (drag && drag.marquee && drag.moved) {
      const x = Math.min(drag.x0, drag.x1) - off;
      const y = Math.min(drag.y0, drag.y1);
      const mw = Math.abs(drag.x1 - drag.x0);
      const mh = Math.abs(drag.y1 - drag.y0);
      g.fillStyle = 'rgba(139,123,255,.12)';
      g.fillRect(x, y, mw, mh);
      g.strokeStyle = 'rgba(139,123,255,.8)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, mw, mh);
    }

    // playhead
    const dpr = window.devicePixelRatio || 1;
    const px = (Math.round((S.playhead * TL.pps - off) * dpr) + 0.5) / dpr;
    g.save();
    g.shadowColor = 'rgba(255,255,255,.6)';
    g.shadowBlur = 6;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px, RULER - 2);
    g.lineTo(px, h);
    g.stroke();
    g.restore();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(px - 6, RULER - 12);
    g.lineTo(px + 6, RULER - 12);
    g.lineTo(px + 6, RULER - 6);
    g.lineTo(px, RULER);
    g.lineTo(px - 6, RULER - 6);
    g.closePath();
    g.fill();
  };
})();
