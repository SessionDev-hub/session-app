/* Beat Lab — sequencer. Patterns (like FL's), a simple song arrangement, a lookahead scheduler
 * locked to the project BPM, and an offline render for "Add to track".
 *
 * project.beat (v2):
 *   { v:2, steps:16, swing, mode:'pattern'|'song', cur, channels:[channel], patterns:[pattern], song:[patternIndex] }
 * channel: { id, type:'drum'|'bass'|'keys'|'custom', name, kind?, sound?, preset?, p?, tune, vol, pan, mute, solo, assetId?, root? }
 * pattern: { id, name, bars, data: { [channelId]: { cells:[velocity 0..1] } | { notes:[{step,note,len,vel}] } } }
 * Old (v1) beats are upgraded automatically: their one pattern becomes Pattern 1.
 */
(function () {
  const S = window.Studio;
  const B = (S.beat = {});
  const BI = () => S.beatInstruments;
  const MAX_BARS = 16;

  const newPattern = (name, bars) => ({ id: S.uid(), name, bars: bars || 1, data: {} });

  B.ensure = (project) => {
    project = project || S.project;
    if (!project.beat || typeof project.beat !== 'object') project.beat = { v: 2, steps: 16, swing: 0, mode: 'pattern', cur: 0, channels: BI().defaultChannels(), patterns: [newPattern('Pattern 1', 1)], song: [] };
    const b = project.beat;
    b.steps = b.steps || 16; b.swing = b.swing || 0; b.channels = b.channels || [];
    if (b.v !== 2) { // upgrade a v1 beat: its cells/notes become Pattern 1
      const p = newPattern('Pattern 1', b.bars || 1);
      for (const c of b.channels) {
        if (c.type === 'drum') { p.data[c.id] = { cells: (c.cells || []).map((x) => (x === true ? 1 : +x || 0)) }; if (!c.sound) c.sound = BI().defaultSound(c.kind); }
        else p.data[c.id] = { notes: c.notes || [] };
        delete c.cells; delete c.notes;
      }
      b.patterns = [p]; b.cur = 0; b.song = []; b.mode = 'pattern'; b.v = 2; delete b.bars;
    }
    if (!Array.isArray(b.patterns) || !b.patterns.length) b.patterns = [newPattern('Pattern 1', 1)];
    b.cur = S.clamp(b.cur | 0, 0, b.patterns.length - 1);
    if (!Array.isArray(b.song)) b.song = [];
    b.song = b.song.filter((i) => i >= 0 && i < b.patterns.length);
    if (b.mode !== 'song') b.mode = 'pattern';
    for (const c of b.channels) {
      c.vol = c.vol == null ? 0.9 : c.vol; c.pan = c.pan || 0; c.tune = c.tune || 0;
      c.mute = !!c.mute; c.solo = !!c.solo;
      if (c.type === 'drum' && !c.sound) c.sound = BI().defaultSound(c.kind);
      if (c.type !== 'drum' && c.root == null) c.root = 60;
    }
    for (const p of b.patterns) { p.bars = S.clamp(p.bars | 0 || 1, 1, MAX_BARS); p.data = p.data || {}; }
    return b;
  };

  B.get = () => B.ensure(S.project);
  B.pattern = (b, i) => { b = b || B.get(); return b.patterns[i == null ? b.cur : i]; };
  B.stepsPerBeat = (b) => (b || B.get()).steps / Math.max(1, S.project.beatsPerBar || 4);
  B.stepDur = (b) => (60 / S.clamp(S.project.bpm || 120, 20, 400)) / B.stepsPerBeat(b);
  B.patSteps = (b, p) => (b || B.get()).steps * (p || B.pattern(b)).bars;
  B.totalSteps = (b) => B.patSteps(b);
  B.loopDur = (b) => B.totalSteps(b) * B.stepDur(b);

  /** The cells (drums) or notes (pitched) of a channel in a pattern, created on demand. */
  B.cells = (c, p) => {
    p = p || B.pattern();
    const n = B.patSteps(null, p);
    let d = p.data[c.id];
    if (!d || !Array.isArray(d.cells)) d = p.data[c.id] = { cells: [] };
    if (d.cells.length !== n) { const a = new Array(n).fill(0); for (let i = 0; i < Math.min(n, d.cells.length); i++) a[i] = +d.cells[i] || 0; d.cells = a; }
    return d.cells;
  };
  B.notes = (c, p) => {
    p = p || B.pattern();
    let d = p.data[c.id];
    if (!d || !Array.isArray(d.notes)) d = p.data[c.id] = { notes: [] };
    return d.notes;
  };

  function stepTime(b, step, sd) { return step * sd + ((step % 2) ? (b.swing || 0) * sd * 0.5 : 0); }

  /** Schedule one pattern at baseTime. */
  function schedulePattern(ctx, b, p, chans, baseTime, sd) {
    const total = B.patSteps(b, p);
    const soloOn = b.channels.some((c) => c.solo);
    for (const ch of chans) {
      const c = ch.c;
      if (c.mute || (soloOn && !c.solo)) continue;
      const d = p.data[c.id];
      if (!d) continue;
      if (c.type === 'drum') {
        const cells = d.cells || [];
        for (let s = 0; s < Math.min(total, cells.length); s++) { const v = +cells[s] || 0; if (v > 0) ch.inst.trigger(ch.dest, baseTime + stepTime(b, s, sd), { vel: v }); }
      } else if (c.type === 'bass') {
        // 808: notes that overlap the next one slide into it (one voice, FL-style glide)
        const ns = (d.notes || []).filter((n) => n.step >= 0 && n.step < total).sort((x, y) => x.step - y.step);
        let chain = [];
        const flush = () => { if (chain.length) ch.inst.triggerChain(ch.dest, chain); chain = []; };
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i], t = baseTime + stepTime(b, n.step, sd), dur = Math.max(1, n.len || 1) * sd;
          const prev = chain[chain.length - 1];
          if (prev && t < prev.t + prev.dur - 1e-4 && t > prev.t + 1e-4) chain.push({ t, note: n.note, vel: n.vel == null ? 1 : n.vel, dur });
          else { flush(); chain.push({ t, note: n.note, vel: n.vel == null ? 1 : n.vel, dur }); }
        }
        flush();
      } else {
        for (const n of d.notes || []) {
          if (n.step < 0 || n.step >= total) continue;
          ch.inst.trigger(ch.dest, baseTime + stepTime(b, n.step, sd), { note: n.note, vel: n.vel == null ? 1 : n.vel, dur: Math.max(1, n.len || 1) * sd });
        }
      }
    }
  }

  /** What plays, in order: the current pattern (pattern mode) or the song list (song mode). */
  function sequence(b, mode) {
    const sd = B.stepDur(b);
    const list = mode === 'song' && b.song.length ? b.song : [b.cur];
    let t = 0;
    return { sd, segs: list.map((pi) => { const p = b.patterns[pi]; const dur = B.patSteps(b, p) * sd; const s = { pi, p, start: t, dur }; t += dur; return s; }), total: t };
  }

  const SOFTCLIP = (() => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.1); } return c; })();

  function buildBus(ctx, b) {
    const bus = ctx.createGain(); bus.gain.value = 0.8;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    const clip = ctx.createWaveShaper(); clip.curve = SOFTCLIP;
    bus.connect(lim).connect(clip).connect(ctx.destination);
    const chans = [], gainById = {}, panById = {};
    for (const c of b.channels) {
      const g = ctx.createGain(); g.gain.value = c.vol == null ? 0.9 : c.vol;
      const pn = ctx.createStereoPanner(); pn.pan.value = S.clamp(c.pan || 0, -1, 1);
      g.connect(pn).connect(bus);
      gainById[c.id] = g; panById[c.id] = pn;
      chans.push({ c, inst: BI().make(ctx, c), dest: g });
    }
    return { bus, chans, gainById, panById };
  }

  /* ---------- live playback ---------- */
  let live = null;
  B.currentStep = -1; B.currentSeg = -1;
  B.isPlaying = () => !!live;
  B.play = () => {
    if (live) return;
    const ctx = S.ctx; if (!ctx) return;
    try { ctx.resume && ctx.resume(); } catch (e) {}
    const b = B.get();
    const seq = sequence(b, b.mode);
    if (!(seq.total > 0)) return;
    live = Object.assign(buildBus(ctx, b), { seq, startTime: ctx.currentTime + 0.08, next: 0 });
    tick();
    live.timer = setInterval(tick, 25);
    updateBtn(true);
  };
  B.stop = () => {
    if (!live) return;
    clearInterval(live.timer);
    try { live.bus.disconnect(); } catch (e) {}
    live = null; B.currentStep = -1; B.currentSeg = -1;
    updateBtn(false);
    S.emit && S.emit('beat-step', -1);
  };
  B.toggle = () => (live ? B.stop() : B.play());
  B.restart = () => { if (live) { B.stop(); B.play(); } };

  const LOOKAHEAD = 0.2;
  function tick() {
    if (!live) return;
    const ctx = S.ctx, b = B.get(), seq = live.seq, n = seq.segs.length;
    if (!(seq.total > 0) || !(seq.sd > 0)) { B.stop(); return; }
    // schedule every segment (pattern block) whose start falls inside the lookahead window; loops forever
    for (let guard = 0; guard < 64; guard++) {
      const k = live.next, loop = Math.floor(k / n), seg = seq.segs[k % n];
      const at = live.startTime + loop * seq.total + seg.start;
      if (at >= ctx.currentTime + LOOKAHEAD) break;
      schedulePattern(ctx, b, seg.p, live.chans, at, seq.sd);
      live.next++;
    }
    const el = ctx.currentTime - live.startTime;
    if (el >= 0) {
      const inLoop = el % seq.total;
      let si = 0; while (si < n - 1 && inLoop >= seq.segs[si + 1].start) si++;
      const step = Math.floor((inLoop - seq.segs[si].start) / seq.sd);
      if (step !== B.currentStep || si !== B.currentSeg) { B.currentStep = step; B.currentSeg = si; B.currentPi = seq.segs[si].pi; S.emit && S.emit('beat-step', step); }
    }
  }
  function updateBtn(on) { const el = document.getElementById('bl-play'); if (el) { el.classList.toggle('on', on); el.textContent = on ? '■ Stop' : '▶ Play'; } }

  /** Live time position of the playhead inside the current pattern (for recording notes from the keyboard). */
  B.liveStepFloat = () => {
    if (!live || !S.ctx) return null;
    const seq = live.seq, el = S.ctx.currentTime - live.startTime + 0.005;
    if (el < 0) return null;
    const inLoop = el % seq.total; let si = 0; while (si < seq.segs.length - 1 && inLoop >= seq.segs[si + 1].start) si++;
    return { pi: seq.segs[si].pi, step: (inLoop - seq.segs[si].start) / seq.sd };
  };

  /* ---------- offline render ---------- */
  /** what: 'pattern' (current pattern) or 'song' (the whole arrangement). */
  B.renderOffline = async (repeats, what) => {
    const b = B.get();
    repeats = Math.max(1, repeats || 1);
    const sr = (S.ctx && S.ctx.sampleRate) || 44100;
    const seq = sequence(b, what || b.mode);
    const lenSec = seq.total * repeats + 2.0; // tail for 808s / cymbals
    const ctx = new OfflineAudioContext(2, Math.ceil(lenSec * sr), sr);
    const parts = buildBus(ctx, b);
    for (let r = 0; r < repeats; r++) for (const sg of seq.segs) schedulePattern(ctx, b, sg.p, parts.chans, r * seq.total + sg.start, seq.sd);
    const raw = await ctx.startRendering();
    // the bus limiter looks 6 ms ahead (so it delays everything by 6 ms): trim that off so the beat lands exactly on the grid
    const skip = Math.round(0.006 * sr), out = new AudioBuffer({ numberOfChannels: raw.numberOfChannels, length: raw.length - skip, sampleRate: sr });
    for (let c = 0; c < raw.numberOfChannels; c++) out.getChannelData(c).set(raw.getChannelData(c).subarray(skip));
    return out;
  };

  /* ---------- editing helpers ---------- */
  B.addChannel = (type, opts) => {
    const b = B.get();
    const c = Object.assign({ id: S.uid(), type, name: (opts && opts.name) || type, vol: 0.9, pan: 0, tune: 0, mute: false, solo: false }, opts || {});
    if (type === 'drum' && !c.sound) c.sound = BI().defaultSound(c.kind);
    if (type !== 'drum' && c.root == null) c.root = 60;
    b.channels.push(c);
    if (live) B.restart();
    return c;
  };
  B.removeChannel = (id) => { const b = B.get(); b.channels = b.channels.filter((c) => c.id !== id); for (const p of b.patterns) delete p.data[id]; if (live) B.restart(); };
  B.setChannelVol = (id, v) => {
    const c = B.get().channels.find((x) => x.id === id); if (c) c.vol = v;
    if (live && live.gainById[id] && S.ctx) try { live.gainById[id].gain.setTargetAtTime(v, S.ctx.currentTime, 0.02); } catch (e) {}
  };
  B.setChannelPan = (id, v) => {
    const c = B.get().channels.find((x) => x.id === id); if (c) c.pan = v;
    if (live && live.panById[id] && S.ctx) try { live.panById[id].pan.setTargetAtTime(v, S.ctx.currentTime, 0.02); } catch (e) {}
  };
  // changing a sound/preset/tune needs fresh instruments
  B.channelChanged = () => { if (live) B.restart(); };
  B.clear = () => { const p = B.pattern(); p.data = {}; if (live) B.restart(); };
  B.resize = (steps, bars) => { const b = B.get(); b.steps = steps; B.pattern().bars = S.clamp(bars, 1, MAX_BARS); for (const c of b.channels) if (c.type === 'drum') B.cells(c); if (live) B.restart(); };

  /* ---------- patterns & song ---------- */
  B.selectPattern = (i) => { const b = B.get(); b.cur = S.clamp(i, 0, b.patterns.length - 1); if (live && b.mode === 'pattern') B.restart(); };
  B.addPattern = (copyFrom) => {
    const b = B.get();
    const src = copyFrom != null ? b.patterns[copyFrom] : null;
    const p = src ? JSON.parse(JSON.stringify(src)) : newPattern('', B.pattern(b).bars);
    p.id = S.uid(); p.name = 'Pattern ' + (b.patterns.length + 1);
    b.patterns.push(p); b.cur = b.patterns.length - 1;
    if (live && b.mode === 'pattern') B.restart();
    return p;
  };
  B.removePattern = (i) => {
    const b = B.get(); if (b.patterns.length <= 1) return false;
    b.patterns.splice(i, 1);
    b.song = b.song.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    b.cur = S.clamp(b.cur > i ? b.cur - 1 : b.cur, 0, b.patterns.length - 1);
    if (live) B.restart();
    return true;
  };
  B.setMode = (m) => { const b = B.get(); b.mode = m === 'song' ? 'song' : 'pattern'; if (live) B.restart(); };
  B.songAdd = (pi) => { const b = B.get(); b.song.push(pi); if (live && b.mode === 'song') B.restart(); };
  B.songRemove = (k) => { const b = B.get(); b.song.splice(k, 1); if (live && b.mode === 'song') B.restart(); };
  B.songMove = (k, d) => { const b = B.get(); const j = k + d; if (j < 0 || j >= b.song.length) return; [b.song[k], b.song[j]] = [b.song[j], b.song[k]]; if (live && b.mode === 'song') B.restart(); };
  B.songSeconds = () => { const b = B.get(); return sequence(b, 'song').total; };
})();
