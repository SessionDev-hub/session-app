/* Headless smoke test: runs the renderer logic against a mock Web Audio API (no GUI, no audio device). */
global.window = global;
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');

// ---- minimal Web Audio mock ----
const calls = [];
const param = () => ({
  value: 0,
  setTargetAtTime() {},
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
  cancelScheduledValues() {},
});
function node(kind) {
  const base = {
    kind,
    connect(n) { return n; },
    disconnect() {},
    start(...a) { calls.push({ kind, a }); },
    stop() {},
    getFloatTimeDomainData() {},
    port: {},
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string') t[k] = param();
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeBuffer(ch, length, sampleRate) {
  const data = Array.from({ length: ch }, () => new Float32Array(length));
  return { numberOfChannels: ch, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
}
function parseFloatWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.strictEqual(dv.getUint16(20, true), 3, 'float WAV expected');
  const nch = dv.getUint16(22, true);
  const sr = dv.getUint32(24, true);
  const len = dv.getUint32(40, true) / (4 * nch);
  const buf = makeBuffer(nch, len, sr);
  for (let i = 0; i < len; i++) for (let c = 0; c < nch; c++) buf.getChannelData(c)[i] = dv.getFloat32(44 + (i * nch + c) * 4, true);
  return buf;
}
class MockCtx {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = node('dest'); }
  createBuffer(c, l, s) { return makeBuffer(c, l, s); }
  decodeAudioData(ab) { return Promise.resolve(parseFloatWav(new Uint8Array(ab))); }
  resume() {}
}
for (const f of ['Gain', 'DynamicsCompressor', 'Analyser', 'StereoPanner', 'BiquadFilter', 'Delay', 'Convolver', 'WaveShaper', 'BufferSource'])
  MockCtx.prototype['create' + f] = function () { return node(f); };
global.OfflineAudioContext = class extends MockCtx {
  constructor(ch, len, sr) { super(); this.len = len; this.sampleRate = sr; }
  startRendering() { return Promise.resolve(makeBuffer(2, this.len, this.sampleRate)); }
};

// ---- load the app modules ----
global.document = { createElement: () => ({}) };
for (const f of ['renderer/core.js', 'renderer/project.js', 'renderer/grid.js', 'renderer/engine.js', 'renderer/dsp.js', 'renderer/history.js', 'renderer/clips.js', 'plugins/effects.js']) require(path.join(root, f));
const S = global.Studio;

(async () => {
  // plugins
  assert.strictEqual(S.plugins.size, 6, 'six built-in effects');
  assert.strictEqual(S.registerPlugin({ id: 'bad', name: 'x', type: 'instrument', create() {} }), false, 'non-effect rejected');
  S.plugins.delete('bad');

  // project + clips
  const ctx = new MockCtx();
  const sine = makeBuffer(1, 44100, 44100);
  sine.getChannelData(0).forEach((_, i, a) => (a[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5));
  const id = S.addAsset('sine', sine);
  const clip = S.addClip(0, id, 2.0);
  assert.strictEqual(S.projectLength(), 3.0);

  // mixer + all effects
  S.project.tracks[0].fx = [...S.plugins.keys()].map((pid) => ({ id: S.uid(), pluginId: pid, params: {}, bypass: false }));
  const eng = new S.Engine(ctx);
  eng.sync(S.project);
  assert.strictEqual(eng.fx.size, 6, 'all effect instances created');
  assert.strictEqual(eng.tracks.size, 4);
  S.project.tracks[0].fx[0].bypass = true;
  eng.sync(S.project); // rebuild with bypass must not throw
  S.project.tracks.pop();
  eng.sync(S.project);
  assert.strictEqual(eng.tracks.size, 3, 'removed track cleaned up');

  // clip scheduling
  calls.length = 0;
  eng.scheduleClips(0, 10);
  let c = calls.filter((x) => x.kind === 'BufferSource');
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual(c[0].a, [12, 0, 1], 'clip starts at startTime + 2s');
  calls.length = 0;
  eng.scheduleClips(2.5, 10);
  c = calls.filter((x) => x.kind === 'BufferSource');
  assert.deepStrictEqual(c[0].a, [10, 0.5, 0.5], 'mid-clip start trims offset and duration');
  calls.length = 0;
  eng.scheduleClips(3.5, 10);
  assert.strictEqual(calls.filter((x) => x.kind === 'BufferSource').length, 0, 'finished clip not scheduled');

  // WAV export
  const wav16 = S.encodeWav(sine);
  assert.strictEqual(wav16.length, 44 + 44100 * 2);
  const mix = await S.renderMixdown(S.project);
  assert.ok(mix.length > 44, 'mixdown rendered');

  // save/open round trip
  const packed = S.packProject();
  const restored = await S.unpackProject(JSON.parse(JSON.stringify(packed)), ctx);
  const back = S.buffers.get(id).getChannelData(0);
  assert.ok(Math.abs(back[100] - sine.getChannelData(0)[100]) < 1e-6, 'float32 audio survives save/open exactly');
  assert.strictEqual(restored.tracks[0].clips[0].start, 2.0);

  // encryption
  const env = JSON.parse(await S.encryptPacked(packed, 'correct horse battery'));
  assert.strictEqual(env.encrypted, true);
  assert.ok(!JSON.stringify(env).includes('sine'), 'no plaintext in encrypted file');
  const dec = await S.decryptPacked(env, 'correct horse battery');
  assert.strictEqual(dec.name, packed.name);
  await assert.rejects(() => S.decryptPacked(env, 'wrong passphrase'), /Wrong passphrase/);

  // clip operations (what the right-click menu calls)
  {
    const tr = S.project.tracks[1];
    const a = S.addAsset('tone', sine); // 1 s long
    const k = S.addClip(1, a, 0);
    const right = S.clipOps.split(tr, k, 0.4);
    assert.ok(right && Math.abs(k.dur - 0.4) < 1e-9 && Math.abs(right.start - 0.4) < 1e-9 && Math.abs(right.offset - 0.4) < 1e-9, 'split');
    assert.strictEqual(S.clipOps.split(tr, k, 0.001), null, 'split near an edge refused');
    S.clipOps.trimStart(right, 0.5);
    assert.ok(Math.abs(right.start - 0.5) < 1e-9 && Math.abs(right.offset - 0.5) < 1e-9 && Math.abs(right.dur - 0.5) < 1e-9, 'trim start keeps audio in place');
    S.clipOps.trimEnd(right, 5);
    assert.ok(Math.abs(right.dur - 0.5) < 1e-9, 'trim end limited to recording length');
    S.clipOps.trimEnd(right, 0.8);
    assert.ok(Math.abs(right.dur - 0.3) < 1e-9, 'trim end');
    // fade / gain handles on the timeline
    S.clipOps.setFadeIn(right, 0.2);
    S.clipOps.setFadeOut(right, 0.25);
    assert.ok(Math.abs(right.fadeIn - 0.2) < 1e-9 && Math.abs(right.fadeOut - 0.1) < 1e-9, 'fade out cannot run into fade in');
    S.clipOps.setFadeIn(right, -1);
    assert.strictEqual(right.fadeIn, 0, 'fade in clamps at 0');
    S.clipOps.setFadeOut(right, 0.003);
    assert.strictEqual(right.fadeOut, 0, 'tiny fades snap to none');
    S.clipOps.setGainDb(right, 6);
    assert.ok(Math.abs(right.gain - Math.pow(10, 6 / 20)) < 1e-9, 'gain in dB');
    S.clipOps.setGainDb(right, 99);
    assert.ok(Math.abs(right.gain - Math.pow(10, 18 / 20)) < 1e-9, 'gain capped at +18 dB');
    S.clipOps.setGainDb(right, 0);
    S.clipOps.setFadeIn(right, 0.25);
    S.clipOps.trimEnd(right, 0.6);
    assert.ok(right.fadeIn <= right.dur + 1e-9 && right.fadeIn + right.fadeOut <= right.dur + 1e-9, 'trimming keeps fades inside the clip');
    S.clipOps.trimEnd(right, 0.8);
    right.fadeIn = 0;

    // snap grid (bars & beats, seconds)
    S.grid.ensure(S.project);
    S.project.bpm = 120;
    S.project.beatsPerBar = 4;
    S.project.grid = { mode: 'bars', div: '1/4', timeDiv: '0.25', snap: true };
    assert.ok(Math.abs(S.grid.step() - 0.5) < 1e-9, '1/4 at 120 BPM = 0.5 s');
    S.project.grid.div = '1/16';
    assert.ok(Math.abs(S.grid.step() - 0.125) < 1e-9, '1/16 = 0.125 s');
    S.project.grid.div = 'bar';
    assert.ok(Math.abs(S.grid.step() - 2) < 1e-9, 'bar = 2 s in 4/4');
    S.project.grid.div = '1/4';
    assert.ok(Math.abs(S.grid.snap(0.74) - 0.5) < 1e-9 && Math.abs(S.grid.snap(0.76) - 1) < 1e-9, 'snap to nearest beat');
    assert.strictEqual(S.grid.snap(0.74, { free: true }), 0.74, 'Alt = no snap');
    assert.ok(Math.abs(S.grid.snap(0.74, { extra: [0.7], pps: 100 }) - 0.7) < 1e-9, 'clip edge magnet wins when close');
    assert.strictEqual(S.grid.bbt(2.75), '2.2.50', 'bar.beat.tick');
    S.project.grid.mode = 'time';
    S.project.grid.timeDiv = '0.1';
    assert.ok(Math.abs(S.grid.snap(0.437) - 0.4) < 1e-9, 'seconds grid');
    S.project.grid.snap = false;
    assert.strictEqual(S.grid.snap(0.437), 0.437, 'snap off');
    S.project.grid = { mode: 'bars', div: '1/4', timeDiv: '0.25', snap: true };
    const legacy = S.validateProject({ version: 2, tracks: [{ clips: [] }], master: {} });
    assert.ok(legacy.bpm === 120 && legacy.grid.mode === 'bars' && legacy.tracks[0].color === 0, 'old sessions get tempo, grid and colours');

    // slice at every grid line + slip edit
    {
      const long = S.addAsset('long', sine);
      const lc = S.addClip(1, long, 0.1, { dur: 0.85 });
      const pieces = S.clipOps.sliceEvery(tr, lc, 0.25);
      assert.deepStrictEqual(pieces.map((p) => +p.start.toFixed(3)), [0.1, 0.25, 0.5, 0.75], 'slice at 0.25 s steps');
      assert.ok(Math.abs(pieces.reduce((a, p) => a + p.dur, 0) - 0.85) < 1e-9, 'slices cover the clip exactly');
      assert.ok(Math.abs(pieces[2].offset - 0.4) < 1e-9, 'slices keep audio in place');
      const sl = pieces[3];
      const off = sl.offset;
      S.clipOps.slip(sl, -0.05);
      assert.ok(Math.abs(sl.offset - (off - 0.05)) < 1e-9 && Math.abs(sl.start - 0.75) < 1e-9, 'slip moves audio, not the clip');
      S.clipOps.slip(sl, 99);
      assert.ok(sl.offset + sl.dur <= 1 + 1e-9, 'slip limited to the recording');
      pieces.forEach((p) => S.clipOps.remove(tr, p));
    }
    const dup = S.clipOps.duplicate(tr, right);
    assert.ok(Math.abs(dup.start - 0.8) < 1e-9 && dup.id !== right.id, 'duplicate lands after original');
    assert.strictEqual(S.clipOps.normalize(right), true);
    assert.ok(Math.abs(right.gain * 0.5 - 0.891) < 0.01, 'normalize to -1 dBFS');
    S.ctx = ctx;
    S.clipOps.reverse(right, ctx);
    assert.ok(S.buffers.has(right.asset) && right.offset === 0, 'reverse makes a new asset');
    const n = tr.clips.length;
    S.clipOps.remove(tr, dup);
    assert.strictEqual(tr.clips.length, n - 1, 'delete');

    // undo / redo
    S.history.clear();
    S.history.push();
    S.clipOps.remove(tr, right);
    const after = tr.clips.length;
    assert.ok(S.history.undo(), 'undo available');
    assert.strictEqual(S.project.tracks[1].clips.length, after + 1, 'undo restores the deleted clip');
    assert.ok(S.history.redo(), 'redo available');
    assert.strictEqual(S.project.tracks[1].clips.length, after, 'redo removes it again');
  }

  // latency: measured value wins over the browser estimate
  {
    const e2 = new S.Engine(ctx);
    ctx.baseLatency = 0.01;
    ctx.outputLatency = 0.02;
    assert.ok(Math.abs(e2.latencySeconds() - 0.03) < 1e-9, 'estimate used before calibration');
    e2.calibrated = 0.12;
    assert.strictEqual(e2.latencySeconds(), 0.12, 'measured value used after calibration');
  }

  // take alignment: recorder started 50 ms before playback, 30 ms measured round trip
  {
    const e3 = new S.Engine(ctx);
    e3.calibrated = 0.03;
    e3.startTime = 1.05;
    e3.rec = { node: { port: {}, disconnect() {} }, silent: { disconnect() {} }, chunks: [new Float32Array(44100)], trackId: 't', startPos: 4, firstFrame: 44100 };
    e3.mic = { source: { disconnect() {} } };
    const r = e3.stopRecording();
    assert.ok(Math.abs(r.compensation - 0.08) < 1e-9, 'trim = recorder lead (50 ms) + latency (30 ms), got ' + r.compensation);
    e3.rec = Object.assign({}, { node: { port: {}, disconnect() {} }, silent: { disconnect() {} }, chunks: [new Float32Array(44100)], trackId: 't', startPos: 4, firstFrame: 44100 });
    e3.latencyOffsetMs = -100; // nudge earlier than the recording allows: take lands later instead
    const r2 = e3.stopRecording();
    assert.ok(Math.abs(r2.startShift - 0.02) < 1e-9 && r2.compensation === 0, 'negative total becomes a later start');
  }

  // key detection, auto-tune, loudness
  {
    const D = S.dsp;
    const sr = 44100;
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const tone = (m, dur, detune = 0) => {
      const n = Math.floor(sr * dur);
      const x = new Float32Array(n);
      for (let h = 1; h <= 10; h++) for (let i = 0; i < n; i++) x[i] += (Math.sin(2 * Math.PI * hz(m + detune / 100) * h * i / sr) / h) * 0.2;
      return x;
    };
    const melody = (notes) => {
      const parts = notes.map((m) => tone(m, 0.4));
      const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      parts.forEach((p) => { out.set(p, o); o += p.length; });
      return out;
    };
    const k = D.detectKey(melody([57, 60, 64, 62, 60, 57, 64, 60, 59, 57, 52, 57]), sr);
    assert.strictEqual(k.name, 'A minor', 'key detection: ' + k.name);
    const k2 = D.detectKey(melody([60, 64, 67, 65, 64, 62, 60, 67, 64, 60, 72, 67]), sr);
    assert.strictEqual(k2.name, 'C major', 'key detection: ' + k2.name);

    const sharp = tone(57, 1.5, 30); // A3, 30 cents sharp
    const tuned = await D.autoTune([sharp], sr, { key: { tonic: 9, mode: 'minor' }, speed: 0, strength: 1 });
    const tr = D.pitchTrack(tuned.channels[0], sr);
    const v = Array.from(tr.f0).filter(Boolean).sort((a, b) => a - b);
    const err = Math.abs(1200 * Math.log2(v[v.length >> 1] / 220));
    assert.ok(err < 3, 'auto-tune lands within 3 cents of A3, got ' + err);
    const same = await D.autoTune([sharp], sr, { key: null, speed: 0, strength: 0 });
    assert.ok(same.channels[0].every((q, i) => Math.abs(q - sharp[i]) < 1e-5), 'strength 0 leaves audio untouched');

    const sine = new Float32Array(sr * 5);
    for (let i = 0; i < sine.length; i++) sine[i] = Math.sin(2 * Math.PI * 997 * i / sr);
    assert.ok(Math.abs(D.measureLoudness([sine], sr).lufs - -3.01) < 0.15, 'loudness reference tone');
  }

  // noise gate processor: opens for signal, closes on noise, keeps levels
  {
    require(path.join(root, 'plugins/gate.js'));
    assert.ok(S.plugins.has('fx-gate'), 'gate registered');
    const vm = require('vm');
    const sr = 44100;
    let Proc;
    vm.runInNewContext(S.worklets.get('ps-gate'), { sampleRate: sr, AudioWorkletProcessor: class {}, registerProcessor: (n, c) => (Proc = c), Math });
    const gp = new Proc();
    const par = (o) => Object.fromEntries(Proc.parameterDescriptors.map((d) => [d.name, [o[d.name] != null ? o[d.name] : d.defaultValue]]));
    const x = new Float32Array(Math.floor((sr * 2) / 128) * 128);
    let seed = 3;
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647;
      const hiss = ((seed / 2147483647) * 2 - 1) * 0.003;
      x[i] = hiss + (i < sr ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr) : 0);
    }
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i += 128) {
      const out = [new Float32Array(128)];
      gp.process([[x.subarray(i, i + 128)]], [out], par({ threshold: -35, range: -60, release: 100 }));
      y.set(out[0], i);
    }
    const rmsDb = (a, s0, s1) => { let t = 0; for (let i = s0; i < s1; i++) t += a[i] * a[i]; return 10 * Math.log10(t / (s1 - s0)); };
    assert.ok(Math.abs(rmsDb(y, 4410, 40000) - rmsDb(x, 4410, 40000)) < 0.1, 'gate leaves the signal alone');
    assert.ok(rmsDb(x, 60000, 80000) - rmsDb(y, 60000, 80000) > 40, 'gate silences the noise');
  }


  // ---- third-party plugin robustness ----
  {
    const sizeBefore = S.plugins.size;
    // 1. CommonJS style, bare AudioNode return, no params, no type, no id
    let r = await S.loadPluginSource('cjs.js', "module.exports = { name: 'Bare Node', create(ctx) { return ctx.createGain(); } };");
    assert.ok(r.ok && r.names[0] === 'Bare Node', 'CommonJS plugin with bare node loads: ' + r.error);
    assert.ok(S.plugins.has('user-bare-node'), 'id derived from name');
    // 2. factory function + array export
    r = await S.loadPluginSource('arr.js', "module.exports = (Studio) => [{ id:'a1', name:'A1', create(c){ const g=c.createGain(); return {input:g,output:g}; } }, { id:'a2', name:'A2', type:'fx', create(c){ const g=c.createGain(); return {input:g,output:g,setParam(){}}; } }];");
    assert.ok(r.ok && r.names.length === 2, 'array/factory export loads');
    // 3. classic script that self-registers, with sloppy params
    r = await S.loadPluginSource('classic.js', "Studio.registerPlugin({ id:'sloppy', name:'Sloppy', params:[{id:'x'},{id:'t',type:'toggle',default:1},{id:'m',type:'select',options:['p','q'],default:'zz'},{id:'bad-range',min:5,max:1,default:99,scale:'log'},{id:'zero-log',min:0,max:10,scale:'log'}], create(c){ const g=c.createGain(); return {input:g,output:g}; } });");
    assert.ok(r.ok, 'classic loads');
    const sl = S.plugins.get('sloppy');
    assert.strictEqual(sl.params[0].max, 1, 'missing max filled');
    assert.strictEqual(sl.params[1].type, 'boolean', 'toggle normalised');
    assert.strictEqual(sl.params[2].default, 'p', 'bad select default fixed');
    assert.ok(sl.params[3].max > sl.params[3].min && sl.params[3].default <= sl.params[3].max, 'bad range repaired');
    assert.strictEqual(sl.params[4].scale, 'linear', 'log scale from 0 falls back to linear');
    // 4. failures are reported, not thrown
    r = await S.loadPluginSource('syntax.js', 'this is not javascript (');
    assert.ok(!r.ok && r.error, 'syntax error reported');
    r = await S.loadPluginSource('empty.js', 'var x = 1;');
    assert.ok(!r.ok && /no plugin found/.test(r.error), 'file with no plugin explained');
    r = await S.loadPluginSource('req.js', "const fs = require('fs');");
    assert.ok(!r.ok && /require/.test(r.error), 'require() explained');
    r = await S.loadPluginSource('inst.js', "module.exports = { id:'inst', name:'Synth', type:'instrument', create(){} };");
    assert.ok(!r.ok && /not supported/.test(r.error), 'instrument plugin explained');
    r = await S.loadPluginSource('wam.js', 'module.exports = class Wam { static createInstance() {} };');
    assert.ok(!r.ok && /class-based/.test(r.error), 'class plugin explained');

    // 5. a plugin that throws in create(), one that returns junk, and a good one must not break the project
    S.registerPlugin({ id: 'boom', name: 'Boom', create() { throw new Error('kaboom'); } });
    S.registerPlugin({ id: 'junk', name: 'Junk', create() { return { nothing: true }; } });
    S.registerPlugin({ id: 'setparam-throws', name: 'SPT', params: [{ id: 'k', min: 0, max: 1, default: 0 }], create(c) { const g = c.createGain(); return { input: g, output: g, setParam() { throw new Error('nope'); } }; } });
    const proj = S.newProject();
    const fxs = ['boom', 'junk', 'setparam-throws', 'user-bare-node', 'sloppy', 'missing-plugin'].map((pluginId) => ({ id: S.uid(), pluginId, params: {}, bypass: false }));
    proj.tracks[0].fx.push(...fxs);
    proj.master.fx = fxs.map((f) => ({ ...f, id: S.uid() }));
    const ctx2 = new MockCtx();
    const eng2 = new S.Engine(ctx2);
    eng2.sync(proj); // must not throw
    eng2.sync(proj); // second sync must not retry the broken plugins
    assert.ok(eng2.broken.size >= 4, 'broken plugins recorded (' + eng2.broken.size + ')');
    assert.ok(eng2.fx.size >= 6, 'good plugins still running');
    eng2.setFxParam(fxs[2].id, 'k', 1); // plugin whose setParam throws is contained
    eng2.reapplyFxParams();
    // re-importing a plugin with the same id replaces the live instance
    const old = eng2.fx.get(fxs[3].id).def;
    S.registerPlugin({ id: 'user-bare-node', name: 'Bare Node v2', create(c) { return c.createGain(); } });
    eng2.reloadChangedPlugins();
    eng2.sync(proj);
    assert.notStrictEqual(eng2.fx.get(fxs[3].id).def, old, 'replaced plugin is re-created');
    // export still works with broken plugins on the project
    S.addAsset('sine2', sine);
    proj.tracks[0].clips.push({ id: S.uid(), asset: id, start: 0, offset: 0, dur: 1, gain: 1, fadeIn: 0, fadeOut: 0, muted: false });
    const out = await S.renderMix(proj);
    assert.ok(out && out.length > 0, 'mixdown renders with broken plugins present');
    assert.ok(S.plugins.size > sizeBefore);
  }

  void clip;
  console.log('smoke test passed');
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE TEST FAILED:', e);
  process.exit(1);
});
