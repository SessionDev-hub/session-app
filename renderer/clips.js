/* Clip operations (pure model edits) + right-click context menu + clip properties dialog. */
(function () {
  const S = window.Studio;
  const MIN = 0.02; // shortest allowed clip, seconds

  /* ---------- model operations (no DOM) ---------- */
  const ops = (S.clipOps = {
    find(project, clipId) {
      for (const track of project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) return { clip, track };
      }
      return null;
    },

    /** Cut a clip in two at time t. Returns the new right-hand clip, or null if t is too close to an edge. */
    split(track, clip, t) {
      if (t <= clip.start + MIN || t >= clip.start + clip.dur - MIN) return null;
      const right = Object.assign({}, clip, {
        id: S.uid(),
        start: t,
        offset: clip.offset + (t - clip.start),
        dur: clip.start + clip.dur - t,
        fadeIn: 0,
      });
      clip.dur = t - clip.start;
      clip.fadeOut = 0;
      ops.clampFades(clip);
      ops.clampFades(right);
      track.clips.push(right);
      return right;
    },

    /** Move the clip's start edge to t (audio stays in place; the clip just gets shorter or longer). */
    trimStart(clip, t) {
      const delta = S.clamp(t - clip.start, Math.max(-clip.offset, -clip.start), clip.dur - MIN);
      clip.start += delta;
      clip.offset += delta;
      clip.dur -= delta;
      ops.clampFades(clip);
    },

    /** Move the clip's end edge to t, limited by the length of the underlying recording. */
    trimEnd(clip, t) {
      const buf = S.buffers.get(clip.asset);
      const room = buf ? buf.duration - clip.offset : Infinity;
      clip.dur = S.clamp(t - clip.start, MIN, room);
      ops.clampFades(clip);
    },

    /** Keep fades inside the clip: fade in + fade out never exceed its length. */
    clampFades(clip) {
      clip.fadeIn = S.clamp(clip.fadeIn || 0, 0, clip.dur);
      clip.fadeOut = S.clamp(clip.fadeOut || 0, 0, clip.dur - clip.fadeIn);
    },

    /** Fade-in length in seconds, limited so it doesn't run into the fade-out. */
    setFadeIn(clip, s) {
      clip.fadeIn = S.clamp(s, 0, Math.max(0, clip.dur - (clip.fadeOut || 0)));
      if (clip.fadeIn < 0.005) clip.fadeIn = 0;
    },

    setFadeOut(clip, s) {
      clip.fadeOut = S.clamp(s, 0, Math.max(0, clip.dur - (clip.fadeIn || 0)));
      if (clip.fadeOut < 0.005) clip.fadeOut = 0;
    },

    /** Clip gain in dB, same range as the properties dialog (-40 .. +18 dB). */
    setGainDb(clip, db) {
      clip.gain = Math.pow(10, S.clamp(db, -40, 18) / 20);
    },

    /** Shift a clip in time by dt seconds. At time 0 the audio is trimmed instead of going negative. */
    nudge(clip, dt) {
      const to = clip.start + dt;
      if (to >= 0) {
        clip.start = to;
        return;
      }
      const cut = Math.min(-to, clip.dur - MIN);
      clip.start = 0;
      clip.offset += cut;
      clip.dur -= cut;
    },

    /** Slide the audio inside the clip without moving the clip (slip edit). */
    slip(clip, dOffset) {
      const buf = S.buffers.get(clip.asset);
      const maxOff = buf ? Math.max(0, buf.duration - clip.dur) : clip.offset + Math.abs(dOffset);
      clip.offset = S.clamp(clip.offset + dOffset, 0, maxOff);
    },

    /** Cut a clip at every multiple of `step` seconds that falls inside it. Returns all the pieces, left to right. */
    sliceEvery(track, clip, step) {
      const pieces = [clip];
      if (!(step > 0)) return pieces;
      let cur = clip;
      const end = clip.start + clip.dur;
      const first = Math.ceil((clip.start + MIN) / step - 1e-9) * step;
      for (let k = 0, t = first; t < end - MIN; k++, t = first + k * step) {
        if (pieces.length > 512) break;
        const right = ops.split(track, cur, t);
        if (right) {
          pieces.push(right);
          cur = right;
        }
      }
      return pieces;
    },

    duplicate(track, clip) {
      const copy = Object.assign({}, clip, { id: S.uid(), start: clip.start + clip.dur });
      track.clips.push(copy);
      return copy;
    },

    remove(track, clip) {
      track.clips.splice(track.clips.indexOf(clip), 1);
    },

    /** Non-destructive: set clip gain so the loudest sample in the clip peaks at -1 dBFS. */
    normalize(clip) {
      const buf = S.buffers.get(clip.asset);
      if (!buf) return false;
      const a = Math.floor(clip.offset * buf.sampleRate);
      const b = Math.min(buf.length, a + Math.floor(clip.dur * buf.sampleRate));
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(d[i]));
      }
      if (peak < 1e-5) return false;
      clip.gain = Math.min(16, 0.891 / peak);
      return true;
    },

    /** Reverse the audible part of a clip. Makes a new reversed recording; the original stays untouched. */
    reverse(clip, ctx) {
      const buf = S.buffers.get(clip.asset);
      if (!buf) return false;
      const a = Math.floor(clip.offset * buf.sampleRate);
      const n = Math.max(1, Math.min(buf.length - a, Math.floor(clip.dur * buf.sampleRate)));
      const out = (ctx || S.ctx).createBuffer(buf.numberOfChannels, n, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const src = buf.getChannelData(c);
        const dst = out.getChannelData(c);
        for (let i = 0; i < n; i++) dst[i] = src[a + n - 1 - i];
      }
      clip.asset = S.addAsset(clip.name + ' (reversed)', out);
      clip.offset = 0;
      clip.dur = out.duration;
      return true;
    },
  });

  /* ---------- context menu ---------- */
  const C = (S.clips = { clipboard: null });
  let menuEl = null;

  C.closeMenu = () => {
    if (menuEl) menuEl.remove();
    menuEl = null;
  };

  function showMenu(x, y, items) {
    C.closeMenu();
    const el = document.createElement('div');
    el.className = 'ctxmenu';
    for (const it of items) {
      if (it.sep) {
        const hr = document.createElement('div');
        hr.className = 'sep';
        el.appendChild(hr);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '');
      const l = document.createElement('span');
      l.className = 'lbl-wrap';
      if (it.swatch) {
        const sw = document.createElement('i');
        sw.className = 'swatch';
        sw.style.background = it.swatch;
        l.appendChild(sw);
      }
      if (it.checked !== undefined) {
        const ck = document.createElement('i');
        ck.className = 'check' + (it.checked ? ' on' : '');
        l.appendChild(ck);
      }
      l.appendChild(document.createTextNode(it.label));
      const h = document.createElement('span');
      h.className = 'hint';
      h.textContent = it.hint || '';
      row.appendChild(l);
      row.appendChild(h);
      if (!it.disabled)
        row.onclick = () => {
          C.closeMenu();
          it.action();
        };
      el.appendChild(row);
    }
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    el.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    menuEl = el;
    const away = (e) => {
      if (menuEl && !menuEl.contains(e.target)) {
        C.closeMenu();
        window.removeEventListener('mousedown', away, true);
      }
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('blur', C.closeMenu, { once: true });
    window.addEventListener('keydown', (e) => e.key === 'Escape' && C.closeMenu(), { once: true });
  }

  C.menu = showMenu;

  /** After any clip edit: redraw, and if playing, restart from the playhead so the edit is heard immediately. */
  C.afterEdit = () => {
    S.timeline.resize();
    if (S.engine.playing && !S.engine.isRecording) S.engine.play(S.playhead);
  };

  /** Copy one clip or several (keeps their timing and track spacing). */
  C.copy = (clipOrList) => {
    const list = (Array.isArray(clipOrList) ? clipOrList : [clipOrList]).filter(Boolean);
    if (!list.length) return;
    const items = list.map((clip) => {
      const f = ops.find(S.project, clip.id);
      return { clip: JSON.parse(JSON.stringify(clip)), row: f ? S.project.tracks.indexOf(f.track) : 0 };
    });
    C.clipboard = { items, minStart: Math.min(...items.map((i) => i.clip.start)), minRow: Math.min(...items.map((i) => i.row)) };
    S.toast(list.length === 1 ? 'Copied "' + list[0].name + '"' : 'Copied ' + list.length + ' clips');
  };

  C.paste = (trackIdx, at) => {
    if (!C.clipboard) return S.toast('Nothing copied yet');
    const cb = C.clipboard;
    const usable = cb.items.filter((i) => S.buffers.has(i.clip.asset));
    if (!usable.length || !S.project.tracks[trackIdx]) return;
    S.history.push();
    const trackCount = S.project.tracks.length;
    const pasted = [];
    for (const it of usable) {
      const row = trackIdx + (it.row - cb.minRow);
      while (row >= S.project.tracks.length) S.project.tracks.push(S.newTrack(S.project.tracks.length));
      const c = Object.assign({}, it.clip, { id: S.uid(), start: Math.max(0, at + (it.clip.start - cb.minStart)) });
      S.project.tracks[row].clips.push(c);
      pasted.push(c);
    }
    if (S.timeline.selectMany) S.timeline.selectMany(pasted.map((c) => c.id));
    else S.timeline.selected = pasted[0].id;
    if (S.project.tracks.length !== trackCount) S.refresh.structure();
    C.afterEdit();
  };

  C.rename = async (clip) => {
    const name = await S.askText('Rename clip', { value: clip.name });
    if (!name) return;
    S.history.push();
    clip.name = name;
    S.timeline.dirty = true;
  };

  const dbOf = (g) => (g <= 0.0001 ? -60 : 20 * Math.log10(g));

  C.properties = (clip) => {
    S.history.push();
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `<h3></h3>
      <div class="param"><label>Gain</label><input type="range" id="cp-gain" min="-40" max="18" step="0.5"><span class="val" id="cp-gain-v"></span></div>
      <div class="param"><label>Fade in</label><input type="range" id="cp-fi" min="0" max="3" step="0.01"><span class="val" id="cp-fi-v"></span></div>
      <div class="param"><label>Fade out</label><input type="range" id="cp-fo" min="0" max="3" step="0.01"><span class="val" id="cp-fo-v"></span></div>
      <div class="param"><label>Muted</label><input type="checkbox" id="cp-mute"><span></span></div>
      <div class="row"><button class="btn primary close">Done</button></div>`;
    dlg.querySelector('h3').textContent = clip.name;
    const q = (id) => dlg.querySelector('#' + id);
    const sync = () => {
      q('cp-gain-v').textContent = dbOf(clip.gain).toFixed(1) + ' dB';
      q('cp-fi-v').textContent = (clip.fadeIn || 0).toFixed(2) + ' s';
      q('cp-fo-v').textContent = (clip.fadeOut || 0).toFixed(2) + ' s';
    };
    q('cp-gain').value = dbOf(clip.gain);
    q('cp-fi').value = clip.fadeIn || 0;
    q('cp-fo').value = clip.fadeOut || 0;
    q('cp-mute').checked = !!clip.muted;
    sync();
    q('cp-gain').oninput = (e) => {
      clip.gain = Math.pow(10, +e.target.value / 20);
      sync();
      S.timeline.dirty = true;
    };
    q('cp-fi').oninput = (e) => {
      ops.setFadeIn(clip, +e.target.value);
      e.target.value = clip.fadeIn;
      sync();
      S.timeline.dirty = true;
    };
    q('cp-fo').oninput = (e) => {
      ops.setFadeOut(clip, +e.target.value);
      e.target.value = clip.fadeOut;
      sync();
      S.timeline.dirty = true;
    };
    q('cp-mute').onchange = (e) => {
      clip.muted = e.target.checked;
      S.timeline.dirty = true;
    };
    dlg.querySelector('.close').onclick = () => dlg.close();
    dlg.addEventListener('close', () => {
      dlg.remove();
      C.afterEdit();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  };

  /** Build and show the menu for whatever is under the cursor. ctx = { x, y, t, row, hit } */
  C.showContextMenu = (ctx) => {
    const { x, y, t, row, hit } = ctx;
    const TL = S.timeline;
    const edit = (fn) => () => {
      S.history.push();
      fn();
      C.afterEdit();
    };
    const gridName = () => {
      const g = S.project.grid;
      return g.mode === 'time' ? g.timeDiv + ' s' : g.div === 'bar' ? 'bar' : g.div;
    };

    if (!hit) {
      const tr = S.project.tracks[row];
      showMenu(x, y, [
        { label: 'Paste here', hint: 'Ctrl+V', disabled: !C.clipboard, action: () => C.paste(row, S.grid.snap(t, { pps: TL.pps })) },
        { label: 'Move playhead here', action: () => S.seek(S.grid.snap(t, { pps: TL.pps })) },
        { sep: true },
        { label: 'Select all on this track', disabled: !tr || !tr.clips.length, action: () => TL.selectMany(tr.clips.map((c) => c.id)) },
        { label: 'Select all', hint: 'Ctrl+A', action: () => TL.selectAll() },
      ]);
      return;
    }

    const { clip, track } = hit;
    if (!TL.isSelected(clip.id)) TL.selected = clip.id;
    TL.dirty = true;
    const group = TL.selectedClips();
    if (group.length > 1) {
      const anyLoud = group.some((g) => !g.clip.muted);
      showMenu(x, y, [
        { label: group.length + ' clips selected', disabled: true },
        { sep: true },
        { label: 'Duplicate', hint: 'Ctrl+D', action: () => TL.duplicateSelected() },
        { label: 'Copy', hint: 'Ctrl+C', action: () => TL.copySelected() },
        { label: 'Snap to grid (' + gridName() + ')', action: edit(() => group.forEach((g) => (g.clip.start = S.grid.round(g.clip.start)))) },
        { label: 'Slice at every ' + gridName(), action: edit(() => group.forEach((g) => ops.sliceEvery(g.track, g.clip, S.grid.step()))) },
        { label: anyLoud ? 'Mute clips' : 'Unmute clips', action: edit(() => group.forEach((g) => (g.clip.muted = anyLoud))) },
        { label: 'Normalize', action: edit(() => group.forEach((g) => ops.normalize(g.clip))) },
        { sep: true },
        { label: 'Delete ' + group.length + ' clips', hint: 'Del', danger: true, action: () => TL.deleteSelected() },
      ]);
      return;
    }

    const inside = t > clip.start + MIN && t < clip.start + clip.dur - MIN;
    const at = S.grid.snap(t, { pps: TL.pps });
    const atInside = at > clip.start + MIN && at < clip.start + clip.dur - MIN;
    const cut = atInside ? at : t;

    showMenu(x, y, [
      {
        label: 'Split here',
        hint: 'S',
        disabled: !inside,
        action: edit(() => {
          const r = ops.split(track, clip, cut);
          if (r) TL.selected = r.id;
        }),
      },
      { label: 'Slice at every ' + gridName(), hint: 'chop', action: edit(() => TL.selectMany(ops.sliceEvery(track, clip, S.grid.step()).map((c) => c.id))) },
      { label: 'Trim start to here', disabled: !inside, action: edit(() => ops.trimStart(clip, cut)) },
      { label: 'Trim end to here', disabled: !inside, action: edit(() => ops.trimEnd(clip, cut)) },
      { label: 'Snap start to grid', action: edit(() => (clip.start = S.grid.round(clip.start))) },
      { label: 'Nudge 10 ms earlier', hint: '[', action: edit(() => ops.nudge(clip, -0.01)) },
      { label: 'Nudge 10 ms later', hint: ']', action: edit(() => ops.nudge(clip, 0.01)) },
      { sep: true },
      {
        label: 'Duplicate',
        hint: 'Ctrl+D',
        action: edit(() => {
          TL.selected = ops.duplicate(track, clip).id;
        }),
      },
      { label: 'Copy', hint: 'Ctrl+C', action: () => C.copy(clip) },
      { label: 'Paste at playhead', hint: 'Ctrl+V', disabled: !C.clipboard, action: () => C.paste(S.project.tracks.indexOf(track), S.playhead) },
      { sep: true },
      { label: 'Rename…', action: () => C.rename(clip) },
      { label: 'Gain, fades & mute…', action: () => C.properties(clip) },
      { label: clip.muted ? 'Unmute clip' : 'Mute clip', action: edit(() => (clip.muted = !clip.muted)) },
      { label: 'Normalize', action: edit(() => ops.normalize(clip) || S.toast('Clip is silent')) },
      { label: 'Reverse', action: edit(() => ops.reverse(clip)) },
      { sep: true },
      { label: 'Auto-tune…', action: () => S.tools.autoTuneDialog(clip) },
      { label: 'Detect key of this clip', action: () => S.tools.detectKey({ clip }) },
      { sep: true },
      {
        label: 'Delete',
        hint: 'Del',
        danger: true,
        action: edit(() => {
          ops.remove(track, clip);
          TL.selected = null;
        }),
      },
    ]);
  };
})();
