/* Tests the VST3 bridge end to end without Electron or the C++ host:
 * real TCP bridge + a mock host process + the real worklet source + the real engine, on a mock Web Audio API. */
global.window = global;
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const { HostBridge } = require(path.join(root, 'native', 'bridge.js'));

// ---- minimal Web Audio mock ----
const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
function node(kind) {
  const base = { kind, connect(n) { return n; }, disconnect() {}, start() {}, stop() {}, getFloatTimeDomainData() {}, port: {} };
  return new Proxy(base, {
    get(t, k) { if (k in t) return t[k]; if (typeof k === 'string') t[k] = param(); return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
class MockCtx {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.destination = node('dest'); }
  resume() {}
}
for (const f of ['Gain', 'DynamicsCompressor', 'Analyser', 'StereoPanner', 'BiquadFilter', 'Delay', 'Convolver', 'WaveShaper', 'BufferSource'])
  MockCtx.prototype['create' + f] = function () { return node(f); };
global.OfflineAudioContext = class extends MockCtx {};

// ---- AudioWorklet mock that runs the real processor source ----
const processors = new Map();
global.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
global.AudioWorkletNode = class {
  constructor(ctx, name, opts) {
    const Cls = processors.get(name);
    this.proc = new Cls(opts);
    this.port = { onmessage: null, postMessage: (m) => this.proc.port.onmessage && this.proc.port.onmessage({ data: m }) };
    this.proc.port.postMessage = (m) => this.port.onmessage && this.port.onmessage({ data: m });
  }
  connect(n) { return n; }
  disconnect() {}
};

require(path.join(root, 'renderer', 'core.js'));
require(path.join(root, 'renderer', 'project.js'));
require(path.join(root, 'renderer', 'engine.js'));
require(path.join(root, 'renderer', 'native.js'));
const S = global.Studio;
const N = S.native;
for (const name of ['ps-native', 'ps-capture'])
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentFrame', S.worklets.get(name))(
    global.AudioWorkletProcessor, (n, c) => processors.set(n, c), 48000, 0);
global.document = { createElement: () => ({}), body: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what);
    await sleep(5);
  }
};

(async () => {
  // ---- bridge refuses a host with the wrong token, and reports a missing exe ----
  {
    process.env.MOCK_BAD_TOKEN = '1';
    const bad = new HostBridge({ command: process.execPath, argsPrefix: [path.join(root, 'native', 'mock-host.js')], startTimeoutMs: 1500 });
    await assert.rejects(bad.start(), /timed out|exited/, 'wrong token is rejected');
    delete process.env.MOCK_BAD_TOKEN;
    const missing = new HostBridge({ command: path.join(root, 'bin', 'does-not-exist.exe'), startTimeoutMs: 1500 });
    await assert.rejects(missing.start(), /Could not start|timed out|exited/, 'missing host exe reported');
  }

  // ---- real bridge + mock host, wired up like main.js / preload.js do ----
  const bridge = new HostBridge({ command: process.execPath, argsPrefix: [path.join(root, 'native', 'mock-host.js')] });
  let jsonCb, audioCb, exits = 0;
  bridge.on('json', (m) => jsonCb && jsonCb(m));
  bridge.on('audio', (b) => audioCb && audioCb(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
  bridge.on('exit', () => exits++);
  window.studioHost = {
    nativeStart: async () => { await bridge.start(); return { ok: true }; },
    nativeStatus: async () => ({ built: true }),
    nativeCachedList: async () => [],
    nativeJson: (m) => bridge.sendJson(m),
    nativeAudio: (ab) => bridge.sendAudio(Buffer.from(ab)),
    onNativeJson: (cb) => (jsonCb = cb),
    onNativeAudio: (cb) => (audioCb = cb),
  };

  // scanning registers effect definitions
  assert.ok(await N.scan([]));
  await until(() => S.plugins.has('vst3:VST3-MockGain-1'), 'scan result');
  const def = S.plugins.get('vst3:VST3-MockGain-1');
  assert.ok(def.native && def.type === 'effect', 'native effect registered');

  // a project with the plugin on track 1, nothing on track 2
  const ctx = new MockCtx();
  S.ctx = ctx;
  const proj = S.newProject();
  S.project = proj;
  const fx = { id: S.uid(), pluginId: def.id, params: {}, bypass: false };
  proj.tracks[0].fx.push(fx);
  const eng = new S.Engine(ctx);
  S.engine = eng;
  eng.sync(proj); // creates the instance, queues 'create' until the host is up
  const rec = eng.fx.get(fx.id).inst.raw.native;
  await until(() => rec.ready, 'plugin to load');
  assert.strictEqual(rec.latencyFrames, 64);

  // plugin delay compensation: track 2 is delayed by the same amount track 1's plugin adds
  const expected = (N.CHUNK + N.PREFILL + 64) / 48000;
  eng.updateCompensation();
  assert.ok(Math.abs(eng.tracks.get(proj.tracks[0].id).compTarget - 0) < 1e-9, 'plugin track is not delayed');
  assert.ok(Math.abs(eng.tracks.get(proj.tracks[1].id).compTarget - expected) < 1e-9, 'other tracks are delayed to match');
  assert.ok(Math.abs(eng.totalLatency() - expected) < 1e-9);
  // bypass removes the plugin's latency again
  fx.bypass = true; eng.sync(proj);
  assert.strictEqual(eng.totalLatency(), 0, 'bypassed plugin adds no latency');
  fx.bypass = false; eng.sync(proj);

  // ---- audio really goes to the host and back: the mock halves the level ----
  const proc = rec.node.proc;
  const total = 48000;
  const input = new Float32Array(total).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.8);
  const output = new Float32Array(total);
  for (let i = 0; i + 128 <= total; i += 128) {
    const out = [new Float32Array(128), new Float32Array(128)];
    proc.process([[input.subarray(i, i + 128), input.subarray(i, i + 128)]], [out]);
    output.set(out[0], i);
    await sleep(3); // roughly real time, so the host keeps up
  }
  let bestOff = -1, bestErr = Infinity;
  for (let off = 0; off < 3000; off++) {
    let err = 0;
    for (let k = 20000; k < 22000; k++) err += Math.abs(output[k + off] - 0.5 * input[k]);
    if (err < bestErr) { bestErr = err; bestOff = off; }
  }
  assert.ok(bestErr / 2000 < 1e-4, 'processed audio matches the host output (avg err ' + bestErr / 2000 + ')');
  assert.ok(bestOff >= N.PREFILL && bestOff <= N.PREFILL + N.CHUNK * 4, 'delay is about CHUNK+PREFILL (' + bestOff + ' frames)');
  assert.ok(rec.underruns <= 2, 'few underruns (' + rec.underruns + ')');

  // ---- state: saved into the project and restored into a new instance ----
  jsonCb && 0;
  bridge.sendJson({ cmd: 'setState', inst: rec.inst, state: 'QUJD' }); // mock stores it
  await sleep(50);
  await N.syncStates();
  assert.strictEqual(fx.params.__state, 'QUJD', 'plugin state copied into the project');
  const proj2 = JSON.parse(JSON.stringify(proj)); // as a saved/loaded session would be
  eng.sync({ ...proj2, tracks: [] , master: { ...proj2.master, fx: [] } }); // drops the old instance
  S.project = proj2;
  eng.sync(proj2);
  const rec2 = eng.fx.get(proj2.tracks[0].fx[0].id).inst.raw.native;
  await until(() => rec2.ready, 'second instance');
  await sleep(50);
  await N.syncStates();
  assert.strictEqual(proj2.tracks[0].fx[0].params.__state, 'QUJD', 'saved state is applied to a fresh instance');

  // ---- unknown plugin id gives a clear error, not a crash ----
  const errs = [];
  const oldToast = S.toast; S.toast = (m) => errs.push(m);
  S.registerPlugin({ id: 'vst3:ghost', name: 'Ghost', native: { id: 'ghost' }, create: (c) => S.plugins.get('vst3:VST3-MockGain-1').create(c) });
  const g = { id: S.uid(), pluginId: 'vst3:ghost', params: {}, bypass: false };
  proj2.tracks[1].fx.push(g);
  eng.sync(proj2);
  const ghostRec = eng.fx.get(g.id).inst.raw.native;
  ghostRec.def = { native: { id: 'ghost' } };
  N.send({ cmd: 'create', inst: ghostRec.inst, id: 'ghost', sampleRate: 48000, block: 256 });
  await until(() => ghostRec.failed, 'error from host');
  assert.ok(errs.some((m) => /not found/i.test(m)), 'user is told the plugin was not found');
  S.toast = oldToast;

  // ---- export with VST3 plugins in the session: real-time bounce ----
  {
    assert.ok(N.projectUsesNative(proj2));
    await assert.rejects(N.bounce(proj2), /not loaded yet/, 'bounce refuses while a plugin has failed');
    g.bypass = true; // the ghost plugin never loaded; bypassing it makes the session exportable
    eng.sync(proj2);
    const fake = { numberOfChannels: 1, length: 48000, sampleRate: 48000, duration: 1, getChannelData: () => new Float32Array(48000) };
    const assetId = S.addAsset('one-second', fake);
    S.addClip(0, assetId, 0);
    ctx.createBuffer = (c, l) => { const d = Array.from({ length: c }, () => new Float32Array(l)); return { numberOfChannels: c, length: l, getChannelData: (i) => d[i] }; };
    let cap = null;
    const Base = global.AudioWorkletNode;
    global.AudioWorkletNode = class extends Base { constructor(c, n, o) { super(c, n, o); if (n === 'ps-capture') cap = this; } };
    const lat = eng.totalLatency();
    assert.ok(lat > 0, 'session has plugin latency');
    const timer = setInterval(() => { // fake "audio clock": 0.1 s of constant 0.5 per tick
      if (cap) { const b = new Float32Array(4800).fill(0.5); cap.proc.process([[b, b]], []); }
      ctx.currentTime += 0.1;
    }, 2);
    const buf = await N.bounce(proj2);
    clearInterval(timer);
    global.AudioWorkletNode = Base;
    assert.strictEqual(buf.length, Math.round((1 + 2.5) * 48000), 'bounce length = song + tail');
    const L = buf.getChannelData(0);
    assert.ok(Math.abs(L[0] - 0.5) < 1e-6 && Math.abs(L[buf.length - 1] - 0.5) < 1e-6, 'bounce captured the master output');
    assert.ok(!eng.playing, 'transport stopped after bounce');
  }

  // ---- editor / unrelated commands do not break the link ----
  N.openEditor(proj2.tracks[0].fx[0]);
  await sleep(50);
  assert.ok(bridge.alive);

  // ---- host dies: instances fall back to pass-through and the user is told ----
  const msgs = [];
  S.toast = (m) => msgs.push(m);
  bridge.child.kill();
  await until(() => exits === 1, 'exit event');
  jsonCb({ evt: 'hostExit' });
  assert.ok(!rec2.ready && !N.connected);
  assert.ok(msgs.some((m) => /host stopped/i.test(m)));
  const out = [new Float32Array(128), new Float32Array(128)];
  const inb = new Float32Array(128).fill(0.25);
  rec2.node.proc.process([[inb, inb]], [out]);
  assert.strictEqual(out[0][5], 0.25, 'audio passes straight through when the host is gone');

  console.log('native test passed');
  process.exit(0);
})().catch((e) => {
  console.error('NATIVE TEST FAILED:', e);
  process.exit(1);
});
