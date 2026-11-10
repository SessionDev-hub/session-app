/* Native VST3 effects: talks to the C++ host (ps-host.exe) through the main process.
 *
 * Each native effect on a strip is a small AudioWorkletNode. It cuts the track audio into CHUNK-frame blocks,
 * sends them to the host, and plays back the processed blocks after a short jitter buffer (PREFILL frames).
 * Until the host has loaded the plugin the node simply passes audio through.
 * The delay this adds (plus the plugin's own latency) is reported to the engine, which delays the other
 * tracks by the difference so everything stays lined up (plugin delay compensation).
 */
(function () {
  const S = window.Studio;
  const N = (S.native = { instances: new Map(), nextId: 1, queue: [], connected: false, pending: new Map(), nextReq: 1, known: [] });

  const CHUNK = 256; // frames per round trip
  const PREFILL = 512; // frames buffered before output starts (jitter margin)
  N.CHUNK = CHUNK;
  N.PREFILL = PREFILL;

  const WORKLET = `
    class PsNative extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const o = (options && options.processorOptions) || {};
        this.chunk = o.chunk || 256;
        this.prefill = o.prefill || 512;
        this.inL = new Float32Array(this.chunk);
        this.inR = new Float32Array(this.chunk);
        this.inN = 0;
        this.seq = 0;
        this.cap = 16384;
        this.mask = this.cap - 1;
        this.oL = new Float32Array(this.cap);
        this.oR = new Float32Array(this.cap);
        this.r = 0;
        this.w = 0;
        this.fill = 0;
        this.active = false;
        this.primed = false;
        this.underruns = 0;
        this.port.onmessage = (e) => {
          const m = e.data;
          if (m.t === 'out') {
            const f = new Float32Array(m.buf);
            const n = f.length >> 1;
            for (let i = 0; i < n; i++) {
              this.oL[this.w] = f[i];
              this.oR[this.w] = f[n + i];
              this.w = (this.w + 1) & this.mask;
            }
            this.fill += n;
            if (this.fill > this.cap) { this.r = this.w; this.fill = 0; }
          } else if (m.t === 'active') {
            this.active = !!m.v;
            this.r = this.w = this.fill = this.inN = 0;
            this.primed = false;
          }
        };
      }
      process(inputs, outputs) {
        const inp = inputs[0], out = outputs[0];
        const n = out[0].length;
        const iL = inp && inp[0] ? inp[0] : null;
        const iR = inp && inp[1] ? inp[1] : iL;
        if (!this.active) {
          for (let c = 0; c < out.length; c++) {
            const src = c === 0 ? iL : iR;
            if (src) out[c].set(src); else out[c].fill(0);
          }
          return true;
        }
        for (let i = 0; i < n; i++) {
          this.inL[this.inN] = iL ? iL[i] : 0;
          this.inR[this.inN] = iR ? iR[i] : 0;
          if (++this.inN === this.chunk) {
            const b = new Float32Array(this.chunk * 2);
            b.set(this.inL, 0);
            b.set(this.inR, this.chunk);
            this.port.postMessage({ t: 'in', seq: this.seq++, buf: b.buffer }, [b.buffer]);
            this.inN = 0;
          }
        }
        if (!this.primed && this.fill >= this.prefill) this.primed = true;
        if (this.primed && this.fill >= n) {
          for (let i = 0; i < n; i++) {
            out[0][i] = this.oL[this.r];
            if (out[1]) out[1][i] = this.oR[this.r];
            this.r = (this.r + 1) & this.mask;
          }
          this.fill -= n;
        } else {
          for (let c = 0; c < out.length; c++) out[c].fill(0);
          if (this.primed) { this.primed = false; this.underruns++; this.port.postMessage({ t: 'underrun', n: this.underruns }); }
        }
        return true;
      }
    }
    registerProcessor('ps-native', PsNative);
  `;
  const CAPTURE = `
    class PsCapture extends AudioWorkletProcessor {
      process(inputs) {
        const i = inputs[0];
        if (i && i.length) this.port.postMessage({ l: i[0].slice(), r: (i[1] || i[0]).slice() });
        return true;
      }
    }
    registerProcessor('ps-capture', PsCapture);
  `;
  S.registerWorklet('ps-native', WORKLET);
  S.registerWorklet('ps-capture', CAPTURE);

  /* ---------- connection to the host ---------- */

  const host = () => window.studioHost;
  let starting = null;
  let listenersAttached = false;

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    host().onNativeJson((m) => onJson(m));
    host().onNativeAudio((u8) => onAudio(u8));
  }

  N.start = () => {
    if (N.connected) return Promise.resolve(true);
    if (starting) return starting;
    attachListeners();
    starting = host()
      .nativeStart()
      .then((r) => {
        if (!r || !r.ok) throw new Error((r && r.error) || 'could not start the plugin host');
        N.connected = true;
        // (re)create every instance that exists, e.g. after the host was restarted
        for (const rec of N.instances.values()) requestCreate(rec);
        const q = N.queue.splice(0);
        for (const m of q) host().nativeJson(m);
        return true;
      })
      .catch((e) => {
        N.queue.length = 0;
        for (const rec of N.instances.values()) rec.failed = true;
        S.toast('VST3 host: ' + e.message);
        return false;
      })
      .finally(() => (starting = null));
    return starting;
  };

  N.send = (msg) => {
    if (N.connected) host().nativeJson(msg);
    else {
      N.queue.push(msg);
      N.start();
    }
  };

  N.request = (msg, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      const req = N.nextReq++;
      const t = setTimeout(() => {
        N.pending.delete(req);
        reject(new Error('plugin host did not answer'));
      }, timeoutMs);
      N.pending.set(req, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      N.send(Object.assign({ req }, msg));
    });

  function requestCreate(rec) {
    rec.ready = false;
    rec.failed = false;
    N.send({ cmd: 'create', inst: rec.inst, id: rec.def.native.id, sampleRate: rec.sampleRate, block: CHUNK });
  }

  function onJson(m) {
    if (!m || typeof m !== 'object') return;
    const rec = m.inst != null ? N.instances.get(m.inst) : null;
    switch (m.evt) {
      case 'created':
        if (!rec) return;
        rec.ready = true;
        rec.latencyFrames = m.latency || 0;
        rec.hasEditor = !!m.hasEditor;
        if (rec.pendingState) N.send({ cmd: 'setState', inst: rec.inst, state: rec.pendingState });
        if (rec.bypass) N.send({ cmd: 'bypass', inst: rec.inst, on: true });
        rec.node.port.postMessage({ t: 'active', v: true });
        if (S.engine && S.engine.updateCompensation) S.engine.updateCompensation();
        break;
      case 'error':
        if (rec) {
          rec.failed = true;
          rec.ready = false;
          rec.node.port.postMessage({ t: 'active', v: false });
        }
        S.toast('VST3 plugin: ' + (m.message || 'error'));
        break;
      case 'state': {
        const cb = N.pending.get(m.req);
        if (cb) {
          N.pending.delete(m.req);
          cb(m);
        }
        break;
      }
      case 'editorClosed':
        if (rec) N.syncOne(rec).catch(() => {});
        break;
      case 'scanProgress':
        N.onScanProgress && N.onScanProgress(m);
        break;
      case 'plugins':
        N.register(m.plugins || []);
        if (m.done) {
          N.scanning = false;
          N.onScanDone && N.onScanDone(m);
        }
        break;
      case 'hostExit':
        N.connected = false;
        N.scanning = false;
        for (const r of N.instances.values()) {
          r.ready = false;
          r.node.port.postMessage({ t: 'active', v: false });
        }
        if (S.engine && S.engine.updateCompensation) S.engine.updateCompensation();
        S.toast('The VST3 host stopped (a plugin may have crashed). Use the VST3 button to restart it.');
        break;
    }
  }

  function onAudio(u8) {
    if (!u8 || u8.byteLength < 12) return;
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const dv = new DataView(ab);
    const rec = N.instances.get(dv.getUint32(0, true));
    if (!rec || !rec.ready) return;
    rec.node.port.postMessage({ t: 'out', buf: ab.slice(12) }, [ab]);
  }

  function sendAudio(inst, seq, floats) {
    const frames = floats.byteLength / 8; // two planar channels of float32
    const ab = new ArrayBuffer(12 + floats.byteLength);
    const dv = new DataView(ab);
    dv.setUint32(0, inst, true);
    dv.setUint32(4, seq >>> 0, true);
    dv.setUint16(8, 2, true);
    dv.setUint16(10, frames, true);
    new Uint8Array(ab, 12).set(new Uint8Array(floats));
    host().nativeAudio(ab);
  }

  /* ---------- plugin list ---------- */

  /** Turn host scan results into effect definitions the mixer can offer. Existing ones are kept as they are. */
  N.register = (list) => {
    let added = 0;
    for (const d of list) {
      if (!d || !d.id || d.instrument) continue;
      const id = 'vst3:' + d.id;
      if (!N.known.some((k) => k.id === d.id)) N.known.push(d);
      if (S.plugins.has(id)) continue;
      S.registerPlugin({
        id,
        name: d.name + ' (VST3)',
        type: 'effect',
        params: [],
        native: { id: d.id, vendor: d.vendor || '', path: d.path || '' },
        create(ctx) {
          return createNativeEffect(ctx, S.plugins.get(id));
        },
      });
      added++;
    }
    if (added && S.mixer && S.mixer.render && S.project) S.mixer.render();
    return added;
  };

  /** Show previously scanned plugins at start-up without launching the host. */
  N.loadCached = async () => {
    try {
      N.register((await host().nativeCachedList()) || []);
    } catch (e) {}
  };

  N.scan = async (folders) => {
    if (!(await N.start())) return false;
    N.scanning = true;
    N.send({ cmd: 'scan', folders: folders || [] });
    return true;
  };

  /* ---------- effect instances ---------- */

  function createNativeEffect(ctx, def) {
    if (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext) {
      // Native plugins cannot run in the offline renderer; export uses N.bounce (real time) instead.
      const g = ctx.createGain();
      return { input: g, output: g, setParam() {} };
    }
    const inst = N.nextId++;
    const node = new AudioWorkletNode(ctx, 'ps-native', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { chunk: CHUNK, prefill: PREFILL },
    });
    const rec = { inst, node, def, sampleRate: ctx.sampleRate, ready: false, failed: false, latencyFrames: 0, pendingState: null, bypass: false, hasEditor: true, underruns: 0 };
    N.instances.set(inst, rec);
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'in') sendAudio(inst, m.seq, m.buf);
      else if (m.t === 'underrun') rec.underruns = m.n;
    };
    requestCreate(rec);
    return {
      input: node,
      output: node,
      native: rec,
      setParam(k, v) {
        if (k === '__state' && v) {
          rec.pendingState = v;
          if (rec.ready) N.send({ cmd: 'setState', inst, state: v });
        }
      },
      latencySeconds() {
        return rec.ready ? (CHUNK + PREFILL + rec.latencyFrames) / rec.sampleRate : 0;
      },
      destroy() {
        N.send({ cmd: 'destroy', inst });
        N.instances.delete(inst);
        node.port.onmessage = null;
        try {
          node.disconnect();
        } catch (e) {}
      },
    };
  }

  /* ---------- editor, state, export ---------- */

  const recFor = (fx) => {
    const e = S.engine && S.engine.fx.get(fx.id);
    return e && e.inst && e.inst.raw && e.inst.raw.native;
  };

  N.openEditor = (fx) => {
    const rec = recFor(fx);
    if (!rec) return S.toast('That plugin is not running yet');
    if (rec.failed) return S.toast('That plugin failed to load. Check the message from the VST3 host, or rescan.');
    if (!rec.ready) return S.toast('The plugin is still loading, try again in a moment');
    if (!rec.hasEditor) return S.toast('This plugin has no window of its own');
    N.send({ cmd: 'openEditor', inst: rec.inst });
  };

  N.syncOne = async (rec) => {
    if (!rec.ready) return;
    const r = await N.request({ cmd: 'getState', inst: rec.inst });
    rec.pendingState = r.state || null;
    for (const fx of allFx(S.project)) if (recFor(fx) === rec && r.state) fx.params.__state = r.state;
  };

  const allFx = (p) => [...p.tracks.flatMap((t) => t.fx), ...((p.master && p.master.fx) || [])];
  const isNative = (fx) => {
    const d = S.plugins.get(fx.pluginId);
    return !!(d && d.native);
  };

  /** Pull every native plugin's current settings into the project (call before saving). */
  N.syncStates = async () => {
    const jobs = [];
    for (const fx of allFx(S.project)) {
      const rec = isNative(fx) && recFor(fx);
      if (rec && rec.ready) jobs.push(N.syncOne(rec).catch((e) => S.toast('Could not read plugin settings: ' + e.message)));
    }
    await Promise.all(jobs);
  };

  N.projectUsesNative = (p) => allFx(p).some((fx) => !fx.bypass && isNative(fx));

  N.allReady = (p) =>
    allFx(p)
      .filter((fx) => !fx.bypass && isNative(fx))
      .every((fx) => {
        const r = recFor(fx);
        return r && r.ready;
      });

  /**
   * Export when native plugins are in the session: play the mix through the live engine and record the master
   * output. Takes as long as the song. Returns a stereo AudioBuffer.
   */
  N.bounce = async (project, { tail = 2.5, onProgress } = {}) => {
    const eng = S.engine;
    const ctx = S.ctx;
    if (!N.allReady(project)) throw new Error('Some VST3 plugins are not loaded yet (or failed). Wait a moment, or bypass them, then export again.');
    const length = S.projectLength(project);
    if (length <= 0) throw new Error('Nothing to export: no clips on any track');
    const lat = eng.totalLatency();
    const sr = ctx.sampleRate;
    await S.prepareContext(ctx);
    const cap = new AudioWorkletNode(ctx, 'ps-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    cap.connect(sink);
    sink.connect(ctx.destination);
    const blocks = [];
    cap.port.onmessage = (e) => blocks.push(e.data);
    eng.analyser.connect(cap);
    eng.play(0);
    const total = length + tail + lat;
    try {
      while (ctx.currentTime < eng.startTime + total) {
        await new Promise((r) => setTimeout(r, 120));
        if (onProgress) onProgress(Math.min(1, (ctx.currentTime - eng.startTime) / total));
      }
    } finally {
      eng.stop();
      try {
        eng.analyser.disconnect(cap);
      } catch (e) {}
      cap.port.onmessage = null;
      S.killWorkletNode(cap);
      sink.disconnect();
    }
    const skip = Math.round(lat * sr);
    const frames = Math.round((length + tail) * sr);
    const buf = ctx.createBuffer(2, frames, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    let pos = 0;
    for (const b of blocks) {
      for (let i = 0; i < b.l.length; i++, pos++) {
        const o = pos - skip;
        if (o >= 0 && o < frames) {
          L[o] = b.l[i];
          R[o] = b.r[i];
        }
      }
    }
    return buf;
  };

  /* ---------- the "VST3…" dialog ---------- */

  N.openDialog = async () => {
    const status = await host().nativeStatus();
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `<h3>VST3 plugins</h3><p class="vst-info"></p>
      <div class="row" style="justify-content:flex-start"><button class="btn primary scan">Scan default VST3 folders</button><button class="btn folder">Add folder and scan…</button></div>
      <p class="vst-log"></p><div class="row"><button class="btn close primary">Done</button></div>`;
    const info = dlg.querySelector('.vst-info');
    const log = dlg.querySelector('.vst-log');
    const effects = () => N.known.filter((d) => !d.instrument).length;
    const refresh = () => {
      info.textContent = status.built
        ? effects() + ' effect plugin(s) known. They appear under “+ Add effect” on every strip. Click an effect’s name to open its window.'
        : 'The plugin host is not built yet. Follow native-host/README.md to build bin/ps-host.exe, then reopen this window.';
    };
    refresh();
    dlg.querySelector('.scan').disabled = dlg.querySelector('.folder').disabled = !status.built;
    N.onScanProgress = (m) => (log.textContent = 'Scanning… ' + (m.name || '') + (m.found != null ? ' (' + m.found + ' found)' : ''));
    N.onScanDone = () => {
      log.textContent = 'Scan finished.';
      refresh();
    };
    const run = async (folders) => {
      log.textContent = 'Starting the plugin host…';
      if (!(await N.scan(folders))) log.textContent = 'Could not start the plugin host.';
    };
    dlg.querySelector('.scan').onclick = () => run([]);
    dlg.querySelector('.folder').onclick = async () => {
      const f = await host().nativePickFolder();
      if (f) run([f]);
    };
    dlg.querySelector('.close').onclick = () => dlg.close();
    dlg.addEventListener('close', () => {
      N.onScanProgress = N.onScanDone = null;
      dlg.remove();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  };
})();
