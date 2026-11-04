/* Beat Lab — sequencer. Holds the pattern (saved in the project), plays it live on a lookahead
 * scheduler locked to the project BPM, and renders it offline to an AudioBuffer for "Add to track".
 *
 * Pattern (project.beat):
 *   { steps:16, bars:1, swing:0, channels:[ channel ] }
 * channel (drum):    { id, type:'drum', kind, name, vol, mute, cells:[bool x steps*bars] }
 * channel (pitched): { id, type:'bass'|'keys'|'custom', name, vol, mute, assetId?, root?, notes:[{step,note,len,vel}] }
 */
(function () {
  const S = window.Studio;
  const B = (S.beat = {});
  const BI = () => S.beatInstruments;

  B.ensure = (project) => {
    project = project || S.project;
    if (!project.beat || typeof project.beat !== 'object') {
      project.beat = { steps: 16, bars: 1, swing: 0, channels: BI().defaultChannels() };
    }
    const b = project.beat;
    b.steps = b.steps || 16; b.bars = b.bars || 1; b.swing = b.swing || 0;
    b.channels = b.channels || [];
    const total = b.steps * b.bars;
    for (const c of b.channels) {
      c.vol = c.vol == null ? 0.9 : c.vol;
      c.mute = !!c.mute;
      if (c.type === 'drum') {
        if (!Array.isArray(c.cells)) c.cells = new Array(total).fill(false);
        if (c.cells.length !== total) { const n = new Array(total).fill(false); for (let i = 0; i < Math.min(total, c.cells.length); i++) n[i] = !!c.cells[i]; c.cells = n; }
      } else {
        if (!Array.isArray(c.notes)) c.notes = [];
        if (c.root == null) c.root = 60;
      }
    }
    return b;
  };

  B.get = () => B.ensure(S.project);
  B.stepsPerBeat = (b) => (b || B.get()).steps / Math.max(1, S.project.beatsPerBar || 4);
  B.stepDur = (b) => (60 / S.clamp(S.project.bpm || 120, 20, 400)) / B.stepsPerBeat(b); // seconds per step
  B.totalSteps = (b) => { b = b || B.get(); return b.steps * b.bars; };
  B.loopDur = (b) => { b = b || B.get(); return B.totalSteps(b) * B.stepDur(b); };

  // swing: push every other step a touch later
  function stepTime(b, step, sd) { return step * sd + ((step % 2) ? (b.swing || 0) * sd * 0.5 : 0); }

  /* ---------- schedule one loop of the pattern into a destination at a base time ---------- */
  function scheduleLoop(ctx, b, insts, dests, baseTime, sd) {
    const total = B.totalSteps(b);
    for (let ci = 0; ci < b.channels.length; ci++) {
      const c = b.channels[ci];
      if (c.mute) continue;
      const inst = insts[ci], dest = dests[ci];
      if (c.type === 'drum') {
        for (let s = 0; s < total; s++) if (c.cells[s]) inst.trigger(dest, baseTime + stepTime(b, s, sd), { vel: c.vol });
      } else {
        for (const n of c.notes || []) {
          if (n.step < 0 || n.step >= total) continue;
          inst.trigger(dest, baseTime + stepTime(b, n.step, sd), { note: n.note, vel: (n.vel == null ? 1 : n.vel) * c.vol, dur: Math.max(1, n.len || 1) * sd });
        }
      }
    }
  }

  // a tanh curve so the final bus can never clip past ±1 (soft saturation on peaks)
  const SOFTCLIP = (() => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.1); } return c; })();

  // build the per-channel gain -> bus -> limiter -> soft-clip graph on a context
  function buildBus(ctx, b) {
    const bus = ctx.createGain(); bus.gain.value = 0.8;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    const clip = ctx.createWaveShaper(); clip.curve = SOFTCLIP; // brickwall safety: output stays within ±1
    bus.connect(lim).connect(clip).connect(ctx.destination);
    const insts = [], dests = [];
    for (const c of b.channels) {
      const g = ctx.createGain(); g.gain.value = 1; g.connect(bus);
      insts.push(BI().make(ctx, c));
      dests.push(g);
    }
    return { bus, insts, dests };
  }

  /* ---------- live preview (its own transport, loops the pattern) ---------- */
  let live = null; // { timer, bus, insts, dests, startTime, sd, loopDur }
  B.currentStep = -1;

  B.isPlaying = () => !!live;
  B.play = () => {
    if (live) return;
    const ctx = S.ctx; if (!ctx) return;
    try { ctx.resume && ctx.resume(); } catch (e) {}
    const b = B.get();
    const sd = B.stepDur(b);
    const parts = buildBus(ctx, b);
    const startTime = ctx.currentTime + 0.08;
    live = Object.assign(parts, { startTime, sd, loopDur: B.loopDur(b), nextLoop: 0 });
    tick();
    live.timer = setInterval(tick, 25);
    updateBtn(true);
  };
  B.stop = () => {
    if (!live) return;
    clearInterval(live.timer);
    try { live.bus.disconnect(); } catch (e) {}
    live = null; B.currentStep = -1;
    updateBtn(false);
    S.emit && S.emit('beat-step', -1);
  };
  B.toggle = () => (live ? B.stop() : B.play());
  B.restart = () => { if (live) { B.stop(); B.play(); } }; // pick up edits/bpm changes

  const LOOKAHEAD = 0.2;
  function tick() {
    if (!live) return;
    const ctx = S.ctx;
    const b = B.get();
    // schedule any loop iterations whose start falls within the lookahead window
    while (live.startTime + live.nextLoop * live.loopDur < ctx.currentTime + LOOKAHEAD) {
      scheduleLoop(ctx, b, live.insts, live.dests, live.startTime + live.nextLoop * live.loopDur, live.sd);
      live.nextLoop++;
    }
    // report the playing step for the UI highlight
    const elapsed = ctx.currentTime - live.startTime;
    if (elapsed >= 0) {
      const step = Math.floor((elapsed % live.loopDur) / live.sd);
      if (step !== B.currentStep) { B.currentStep = step; S.emit && S.emit('beat-step', step); }
    }
  }

  function updateBtn(on) { const el = document.getElementById('bl-play'); if (el) el.classList.toggle('on', on); }

  /* ---------- offline bounce to an AudioBuffer (one or more loops) ---------- */
  B.renderOffline = async (repeats) => {
    const b = B.get();
    repeats = Math.max(1, repeats || 1);
    const sr = (S.ctx && S.ctx.sampleRate) || 44100;
    const sd = B.stepDur(b);
    const lenSec = B.loopDur(b) * repeats + 0.6; // tail for 808/keys release
    const ctx = new OfflineAudioContext(2, Math.ceil(lenSec * sr), sr);
    const parts = buildBus(ctx, b);
    for (let r = 0; r < repeats; r++) scheduleLoop(ctx, b, parts.insts, parts.dests, r * B.loopDur(b), sd);
    return ctx.startRendering();
  };

  /* ---------- channel helpers (used by the UI) ---------- */
  B.addChannel = (type, opts) => {
    const b = B.get();
    const total = B.totalSteps(b);
    const c = Object.assign({ id: S.uid(), type, name: (opts && opts.name) || type, vol: 0.9, mute: false }, opts || {});
    if (type === 'drum') c.cells = new Array(total).fill(false);
    else { c.notes = []; if (c.root == null) c.root = 60; }
    b.channels.push(c);
    return c;
  };
  B.removeChannel = (id) => { const b = B.get(); b.channels = b.channels.filter((c) => c.id !== id); };
  B.resize = (steps, bars) => {
    const b = B.get();
    b.steps = steps; b.bars = bars;
    const total = steps * bars;
    for (const c of b.channels) {
      if (c.type === 'drum') { const n = new Array(total).fill(false); for (let i = 0; i < Math.min(total, c.cells.length); i++) n[i] = c.cells[i]; c.cells = n; }
      else c.notes = (c.notes || []).filter((x) => x.step < total);
    }
    if (live) B.restart();
  };
})();
