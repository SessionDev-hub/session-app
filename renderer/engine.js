/* Audio engine: mixer graph, effect-plugin host, clip playback, mic recording, offline mixdown. */
(function () {
  const S = window.Studio;

  // Captures the mic. Interfaces often put the mic on input 2, so every channel is mixed down
  // (channels that are digital silence are ignored so a single live input keeps its full level).
  const RECORDER_WORKLET = `
    class RecProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const inp = inputs[0];
        let out;
        if (inp && inp.length && inp[0] && inp[0].length) {
          if (inp.length === 1) out = inp[0].slice();
          else {
            const n = inp[0].length;
            out = new Float32Array(n);
            let live = 0;
            for (let c = 0; c < inp.length; c++) {
              const ch = inp[c];
              let any = false;
              for (let i = 0; i < n; i++) {
                const v = ch[i];
                if (v !== 0) any = true;
                out[i] += v;
              }
              if (any) live++;
            }
            if (live > 1) for (let i = 0; i < n; i++) out[i] /= live;
          }
        } else {
          // Input not delivering this quantum (device warming up, or a device that yields no audio).
          // Still emit a silent block so the take keeps the right length and shows up as a (silent)
          // take we can flag — instead of capturing zero chunks and saying "nothing was recorded".
          out = new Float32Array(128);
        }
        this.port.postMessage({ f: currentFrame, d: out });
        return true;
      }
    }
    registerProcessor('rec-processor', RecProcessor);
  `;

  /**
   * Wrap whatever a plugin's create() returned in host-owned input/output gain nodes, so a plugin can
   * never be disconnected wrongly (or leave stray connections) when the chain is rebuilt.
   * Accepts { input, output, setParam, destroy }, a bare AudioNode, or a node-with-parameters.
   */
  function wrapInstance(ctx, raw) {
    const isNode = (n) => n && typeof n.connect === 'function' && typeof n.disconnect === 'function';
    let input, output;
    if (isNode(raw)) {
      input = output = raw;
    } else if (raw && typeof raw === 'object') {
      input = raw.input || raw.inputNode || raw.node;
      output = raw.output || raw.outputNode || raw.node || input;
    }
    if (!isNode(input) || !isNode(output)) throw new Error('create(ctx) must return { input, output } Web Audio nodes');
    const hin = ctx.createGain();
    const hout = ctx.createGain();
    hin.connect(input);
    output.connect(hout);
    return {
      raw,
      input: hin,
      output: hout,
      latencySeconds() {
        try {
          return typeof raw.latencySeconds === 'function' ? +raw.latencySeconds() || 0 : 0;
        } catch (e) {
          return 0;
        }
      },
      setParam(k, v) {
        // universal per-plugin level trim, applied by the host gain nodes around the plugin
        if (k === '_in') { hin.gain.value = Math.pow(10, (+v || 0) / 20); return; }
        if (k === '_out') { hout.gain.value = Math.pow(10, (+v || 0) / 20); return; }
        if (typeof raw.setParam === 'function') return raw.setParam(k, v);
        const p = raw.parameters && raw.parameters.get && raw.parameters.get(k);
        if (p) p.value = typeof v === 'boolean' ? (v ? 1 : 0) : +v;
      },
      destroy() {
        try {
          hin.disconnect();
          hout.disconnect();
        } catch (e) {}
        try {
          output.disconnect();
          if (input !== output) input.disconnect();
        } catch (e) {}
        try {
          if (typeof raw.destroy === 'function') raw.destroy();
        } catch (e) {}
      },
    };
  }

  class Engine {
    constructor(ctx, opts = {}) {
      this.ctx = ctx;
      this.offline = !!opts.offline;
      this.project = null;
      this.tracks = new Map(); // trackId -> { input, pan, vol, analyser, chain }
      this.fx = new Map(); // fxId -> { inst, def, pluginId }
      this.broken = new Map(); // fxId -> def that failed to start (so we do not retry on every sync)
      this.playing = false;
      this.startPos = 0;
      this.startTime = 0;
      this.sources = [];
      this.latencyOffsetMs = 0;
      this._buf = null;
      this.rec = null;
      this.mic = null;

      this.master = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -0.3; // safety net only; use the Limiter effect for mastering
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.1;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.limiter);
      this.masterChain = [];
      this.limiter.connect(this.analyser);
      // App-wide output volume (separate from the mix master fader): the final knob before the speakers.
      this.appOut = ctx.createGain();
      this.analyser.connect(this.appOut);
      this.appOut.connect(ctx.destination);
      this.masterLR = this.stereoMeter(this.limiter);
      this.monitorVol = 1; // how loud you hear yourself while monitoring/recording

      // A device change, system sleep or power event can drop the audio context to
      // 'suspended'/'interrupted' — it then stays SILENT until the context is recreated
      // (i.e. until the app is restarted). Auto-resume whenever that happens so sound
      // comes back on its own.
      try {
        this.ctx.onstatechange = () => {
          const st = this.ctx.state;
          if (st === 'suspended' || st === 'interrupted') this.ctx.resume().catch(() => {});
        };
      } catch (e) {}
    }

    /** Make sure the context is actually running; call before/while playing. */
    ensureRunning() {
      try { if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); } catch (e) {}
    }

    /** Global app output level (0..~1.5). 1 = unity. */
    setOutputVolume(v) {
      this.appOut.gain.setTargetAtTime(Math.max(0, +v || 0), this.ctx.currentTime, 0.01);
    }

    /** How loud live input is monitored (0..~1.5). Applied now and remembered for the next openInput. */
    setMonitorVolume(v) {
      this.monitorVol = Math.max(0, +v || 0);
      if (this.mic) this.mic.monitor.gain.setTargetAtTime(this.monitorVol, this.ctx.currentTime, 0.01);
    }

    /** Available audio OUTPUT devices (needs setSinkId support). */
    async listOutputs() {
      if (!this.ctx.setSinkId) return [];
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        return devs.filter((d) => d.kind === 'audiooutput');
      } catch (e) {
        return [];
      }
    }

    /** Send Session's sound to a chosen output device. '' = system default.
     * Resilient: a stale device id (headphones re-plugged, Windows rotating ids, Bluetooth waking)
     * is re-matched by re-enumerating; if it still can't attach we fall back to the system default
     * so sound keeps playing instead of going silent, and report the real error name. */
    async setOutputDevice(id) {
      if (!this.ctx.setSinkId) return false;
      const want = id || '';
      // a suspended context can reject setSinkId on some drivers — wake it first
      try { if (this.ctx.state === 'suspended') await this.ctx.resume(); } catch (e) {}
      try {
        await this.ctx.setSinkId(want);
        this.outputDevice = want;
        if (want) { try { const d = (await this.listOutputs()).find((o) => o.deviceId === want); if (d) this._lastOutLabel = d.label || null; } catch (e) {} }
        return true;
      } catch (e) {
        // 1) the id may be stale, or the device was briefly busy (AbortError when a headset/BT
        //    device is waking). Re-enumerate, then retry — by id, then by remembered label, and
        //    finally the same id once more after a short wait for a transient failure.
        if (want) {
          try {
            await new Promise((r) => setTimeout(r, 250));
            const outs = await this.listOutputs();
            let d = outs.find((o) => o.deviceId === want);
            if (!d && this._lastOutLabel) d = outs.find((o) => o.label && o.label === this._lastOutLabel);
            const target = d ? d.deviceId : want; // retry the original id too (transient errors)
            await this.ctx.setSinkId(target);
            this.outputDevice = target; this._lastOutLabel = (d && d.label) || this._lastOutLabel;
            return true;
          } catch (e2) {}
        }
        // 2) last resort: fall back to the system default so audio isn't left silent/broken
        let fell = false;
        try { await this.ctx.setSinkId(''); this.outputDevice = ''; fell = true; } catch (e3) {}
        console.warn('[Session] setOutputDevice failed for', want || '(default)', '-', e && e.name, e && e.message);
        S.toast(fell
          ? 'Couldn’t use that output (' + ((e && e.name) || 'error') + ') — back on the system default.'
          : 'Could not switch output device (' + ((e && e.name) || 'error') + ').');
        return false;
      }
    }

    /** Left/right analysers tapped off `node` (for the mixer's stereo meters). */
    stereoMeter(node) {
      const c = this.ctx;
      if (!c.createChannelSplitter) return null;
      const split = c.createChannelSplitter(2);
      const l = c.createAnalyser();
      const r = c.createAnalyser();
      l.fftSize = r.fftSize = 512;
      node.connect(split);
      split.connect(l, 0);
      split.connect(r, 1);
      return [l, r];
    }

    /** [left, right] peak levels of a track (or 'master'). */
    trackLevelsLR(id) {
      const lr = id === 'master' ? this.masterLR : this.tracks.get(id) && this.tracks.get(id).lr;
      if (!lr) {
        const v = this.trackLevel(id);
        return [v, v];
      }
      return [this.peak(lr[0]), this.peak(lr[1])];
    }

    /* ---------- graph / project sync ---------- */

    ensureTrack(id) {
      let t = this.tracks.get(id);
      if (!t) {
        const c = this.ctx;
        t = { input: c.createGain(), pan: c.createStereoPanner(), comp: c.createDelay(1), vol: c.createGain(), analyser: c.createAnalyser(), chain: [], latency: 0, compTarget: 0 };
        t.analyser.fftSize = 512;
        t.pan.connect(t.comp);
        t.comp.connect(t.vol);
        t.vol.connect(this.master);
        t.vol.connect(t.analyser);
        t.lr = this.stereoMeter(t.vol);
        this.tracks.set(id, t);
      }
      return t;
    }

    fxInstance(fx) {
      const def = S.plugins.get(fx.pluginId);
      let rec = this.fx.get(fx.id);
      if (rec && rec.def !== def) {
        this.destroyFx(fx.id);
        rec = null;
      }
      if (rec) return rec.inst;
      if (!def || this.broken.get(fx.id) === def) return null;
      let inst = null;
      try {
        inst = wrapInstance(this.ctx, def.create(this.ctx));
        const merged = S.defaultParams(def, fx.params);
        for (const k of Object.keys(merged)) {
          try {
            inst.setParam(k, merged[k]);
          } catch (e) {
            console.warn('[plugin setParam failed]', def.id, k, e);
          }
        }
      } catch (e) {
        if (inst) inst.destroy();
        this.broken.set(fx.id, def);
        console.warn('[plugin failed to start]', def.id, e);
        S.toast('Plugin "' + def.name + '" failed and was skipped: ' + ((e && e.message) || e));
        return null;
      }
      this.fx.set(fx.id, { inst, def, pluginId: fx.pluginId });
      return inst;
    }

    destroyFx(id) {
      const rec = this.fx.get(id);
      if (!rec) return;
      try {
        rec.inst.destroy();
      } catch (e) {}
      this.fx.delete(id);
    }

    /** After plugins were (re)imported: drop live instances whose definition was replaced or newly available. */
    reloadChangedPlugins() {
      for (const [id, rec] of [...this.fx]) if (S.plugins.get(rec.pluginId) !== rec.def) this.destroyFx(id);
      this.broken.clear();
    }

    rebuildTrack(tr) {
      const t = this.ensureTrack(tr.id);
      t.input.disconnect();
      for (const node of t.chain) {
        try {
          node.disconnect();
        } catch (e) {}
      }
      t.chain = [];
      t.latency = 0;
      let node = t.input;
      for (const fx of tr.fx) {
        const inst = this.fxInstance(fx);
        if (!inst || fx.bypass) continue;
        node.connect(inst.input);
        t.chain.push(inst.output);
        t.latency += inst.latencySeconds();
        node = inst.output;
      }
      node.connect(t.pan);
      if (this.monitorTrackId === tr.id && this.mic) this.mic.monitor.connect(t.input);
    }

    /** Master bus: master fader -> master effects -> safety limiter. */
    rebuildMaster() {
      this.master.disconnect();
      for (const node of this.masterChain) {
        try {
          node.disconnect();
        } catch (e) {}
      }
      this.masterChain = [];
      this.masterLatency = 0;
      let node = this.master;
      for (const fx of this.project.master.fx || []) {
        const inst = this.fxInstance(fx);
        if (!inst || fx.bypass) continue;
        node.connect(inst.input);
        this.masterChain.push(inst.output);
        this.masterLatency += inst.latencySeconds();
        node = inst.output;
      }
      node.connect(this.limiter);
    }

    applyTrackMix(tr) {
      const t = this.ensureTrack(tr.id);
      const anySolo = this.project.tracks.some((x) => x.solo);
      const audible = !tr.mute && (!anySolo || tr.solo);
      const now = this.ctx.currentTime;
      t.vol.gain.setTargetAtTime(audible ? tr.vol : 0, now, 0.01);
      t.pan.pan.setTargetAtTime(tr.pan, now, 0.01);
    }

    applyAllMix() {
      for (const tr of this.project.tracks) this.applyTrackMix(tr);
      this.master.gain.setTargetAtTime(this.project.master.vol, this.ctx.currentTime, 0.01);
    }

    /** Make the audio graph match the project. Call after structural changes. */
    sync(project) {
      this.project = project;
      const ids = new Set(project.tracks.map((t) => t.id));
      for (const [id, t] of [...this.tracks]) {
        if (!ids.has(id)) {
          try {
            t.input.disconnect();
            t.vol.disconnect();
          } catch (e) {}
          this.tracks.delete(id);
        }
      }
      const fxIds = new Set([...project.tracks.flatMap((t) => t.fx.map((f) => f.id)), ...(project.master.fx || []).map((f) => f.id)]);
      for (const id of [...this.fx.keys()]) if (!fxIds.has(id)) this.destroyFx(id);
      for (const id of [...this.broken.keys()]) if (!fxIds.has(id)) this.broken.delete(id);
      for (const tr of project.tracks) this.rebuildTrack(tr);
      this.rebuildMaster();
      this.applyAllMix();
      this.updateCompensation();
    }

    /**
     * Plugin delay compensation: native plugins add delay on their track, so every other track is delayed by the
     * difference. Everything then stays lined up, just a little later than the playhead (see totalLatency()).
     */
    updateCompensation() {
      if (!this.project) return;
      let max = 0;
      for (const tr of this.project.tracks) {
        const t = this.tracks.get(tr.id);
        if (!t) continue;
        t.latency = 0;
        for (const fx of tr.fx) {
          const rec = this.fx.get(fx.id);
          if (rec && !fx.bypass) t.latency += rec.inst.latencySeconds();
        }
        max = Math.max(max, t.latency);
      }
      this.pdcMax = Math.min(max, 0.95);
      let ml = 0;
      for (const fx of this.project.master.fx || []) {
        const rec = this.fx.get(fx.id);
        if (rec && !fx.bypass) ml += rec.inst.latencySeconds();
      }
      this.masterLatency = ml;
      const now = this.ctx.currentTime;
      for (const tr of this.project.tracks) {
        const t = this.tracks.get(tr.id);
        if (!t) continue;
        t.compTarget = Math.max(0, this.pdcMax - Math.min(t.latency, this.pdcMax));
        t.comp.delayTime.setTargetAtTime(t.compTarget, now, 0.02);
      }
    }

    /** How much later than the playhead the mix is heard (longest track chain + master chain). */
    totalLatency() {
      return (this.pdcMax || 0) + (this.masterLatency || 0);
    }

    setFxParam(fxId, k, v) {
      const rec = this.fx.get(fxId);
      if (!rec) return;
      try {
        rec.inst.setParam(k, v);
      } catch (e) {
        console.warn('[plugin setParam failed]', rec.def.id, k, e);
      }
    }

    trackLevel(id) {
      const t = id === 'master' ? { analyser: this.analyser } : this.tracks.get(id);
      return t ? this.peak(t.analyser) : 0;
    }

    peak(analyser) {
      if (!this._buf || this._buf.length < analyser.fftSize) this._buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(this._buf);
      let p = 0;
      for (let i = 0; i < analyser.fftSize; i++) p = Math.max(p, Math.abs(this._buf[i]));
      return p;
    }

    /* ---------- playback ---------- */

    /** Schedule every clip from `fromPos` seconds; clip audio is routed into its track. */
    scheduleClips(fromPos, startTime) {
      const ctx = this.ctx;
      const FADE = 0.005;
      for (const tr of this.project.tracks) {
        const dest = this.ensureTrack(tr.id).input;
        for (const c of tr.clips) {
          const buf = S.buffers.get(c.asset);
          if (!buf || c.muted) continue;
          const end = c.start + c.dur;
          if (end <= fromPos) continue;
          const skip = Math.max(0, fromPos - c.start);
          const when = startTime + Math.max(0, c.start - fromPos);
          const dur = c.dur - skip;
          if (dur <= 0) continue;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const g = ctx.createGain();
          // fades (min 5 ms to avoid clicks), measured from the clip's own start/end
          const fiLen = Math.max(c.fadeIn || 0, FADE);
          const foLen = Math.max(c.fadeOut || 0, FADE);
          const fiRem = Math.max(0, fiLen - skip);
          g.gain.setValueAtTime(skip < fiLen ? c.gain * (skip / fiLen) : c.gain, when);
          if (fiRem > 0) g.gain.linearRampToValueAtTime(c.gain, when + fiRem);
          g.gain.setValueAtTime(c.gain, Math.max(when + fiRem, when + dur - foLen));
          g.gain.linearRampToValueAtTime(0, when + dur);
          src.connect(g);
          g.connect(dest);
          src.start(when, c.offset + skip, dur);
          src.onended = () => {
            try {
              g.disconnect();
            } catch (e) {}
          };
          this.sources.push(src);
        }
      }
    }

    play(from = 0) {
      if (this.playing) this.stop();
      this.ctx.resume();
      this.playing = true;
      this.startPos = from;
      this.startTime = this.ctx.currentTime + 0.05;
      this.sources = [];
      this.scheduleClips(from, this.startTime);
      // tempo-synced effects (pattern gate…) need to know where bar 1 is
      if (S.emit) S.emit('transport', { ctx: this.ctx, ctxTime: this.startTime, pos: from });
    }

    stop() {
      this.playing = false;
      for (const s of this.sources) {
        try {
          s.stop();
        } catch (e) {}
      }
      this.sources = [];
    }

    /** Current transport position in seconds, or null when stopped. */
    position() {
      if (!this.playing) return null;
      return Math.max(this.startPos, this.startPos + this.ctx.currentTime - this.startTime);
    }

    /* ---------- input / recording ---------- */

    async listInputs() {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audioinput');
    }

    async openInput(deviceId) {
      this.closeInput();
      await this.ctx.resume(); // a suspended context delivers no audio, so a take would come out empty
      // Ask the mic to deliver at the ENGINE's sample rate. With processing disabled, Chromium can
      // otherwise hand us the mic at its own hardware rate without resampling to the context — the
      // take then gets tagged at the (higher) context rate and plays back sped up / pitched up.
      const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: this.ctx.sampleRate } };
      const gum = (audio) => navigator.mediaDevices.getUserMedia({ audio });
      let stream;
      try {
        stream = await gum(Object.assign({}, base, deviceId ? { deviceId: { exact: deviceId } } : {}));
      } catch (e) {
        // the chosen device was unplugged or its id changed: fall back to the default input
        if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
          stream = await gum(base);
          S.toast('That input is not available, using the default input.');
        } else throw e;
      }
      const ctx = this.ctx;
      const source = ctx.createMediaStreamSource(stream);
      // Sum the input to mono so you always hear yourself centered in BOTH ears — many
      // interfaces put a mono mic on only the left of a stereo input, which otherwise
      // monitors (and records) on one side only. From mono it upmixes to both ears.
      const input = ctx.createGain();
      input.channelCount = 1;
      input.channelCountMode = 'explicit';
      input.channelInterpretation = 'speakers';
      source.connect(input);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const monitor = ctx.createGain();
      monitor.gain.value = this.monitorVol != null ? this.monitorVol : 1;
      input.connect(analyser);
      input.connect(monitor);
      this.mic = { stream, source, input, analyser, monitor };
      const tr = stream.getAudioTracks()[0];
      // Record the mic's actual rate; if the browser couldn't match it to the engine rate, warn
      // (a mismatch here is what causes sped-up takes — the constraint above usually prevents it).
      try {
        const micRate = tr && tr.getSettings && tr.getSettings().sampleRate;
        this.micSampleRate = micRate || null;
        if (micRate && micRate !== ctx.sampleRate) console.warn('[Session] mic rate', micRate, '≠ engine rate', ctx.sampleRate, '— takes may be off-speed; tell Claude this.');
      } catch (e) { this.micSampleRate = null; }
      if (tr) tr.addEventListener('ended', () => this.mic && this.mic.stream === stream && this.onInputLost && this.onInputLost());
      if (!this.workletReady) {
        const blobUrl = URL.createObjectURL(new Blob([RECORDER_WORKLET], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(blobUrl);
        } catch (err) {
          // Some page origins (e.g. file://) refuse blob: worklets; a data: URL works there.
          await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(RECORDER_WORKLET));
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
        this.workletReady = true;
      }
    }

    closeInput() {
      if (!this.mic) return;
      this.setMonitor(null);
      this.mic.stream.getTracks().forEach((t) => t.stop());
      try {
        this.mic.source.disconnect();
      } catch (e) {}
      this.mic = null;
    }

    inputLevel() {
      return this.mic ? this.peak(this.mic.analyser) : 0;
    }

    /** Route live input through a track's effect chain (use headphones!). null = off. */
    setMonitor(trackId) {
      if (this.mic) {
        try {
          this.mic.monitor.disconnect();
        } catch (e) {}
      }
      this.monitorTrackId = trackId;
      if (trackId && this.mic && this.tracks.has(trackId)) this.mic.monitor.connect(this.tracks.get(trackId).input);
    }

    get isRecording() {
      return !!this.rec;
    }

    async startRecording(trackId, fromPos) {
      if (!this.mic) throw new Error('Open an input first');
      const ctx = this.ctx;
      // The capture worklet only runs while the context is actually running. If the system left it
      // 'suspended'/'interrupted' (device change, sleep), wake it and WAIT — otherwise the take comes
      // out empty and you'd see "nothing was recorded".
      try { if (ctx.state !== 'running') await ctx.resume(); } catch (e) {}
      if (ctx.state !== 'running') throw new Error('Audio is paused by your system. Click in Session once, or re-pick your device in Settings → Audio, then record again.');
      // Make sure the mic is still live (devices get unplugged / ids rotate).
      const micTrack = this.mic.stream && this.mic.stream.getAudioTracks && this.mic.stream.getAudioTracks()[0];
      if (micTrack && micTrack.readyState === 'ended') throw new Error('Your input device went away. Re-select it in Settings → Audio, then record again.');
      const node = new AudioWorkletNode(ctx, 'rec-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' });
      const silent = ctx.createGain();
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(ctx.destination);
      const chunks = [];
      // peaks: one max-level value per PEAK_BLOCK samples, so the timeline can draw the take's
      // waveform live while you record (cheap: a few hundred numbers per second).
      const PEAK_BLOCK = 256;
      const rec = { node, silent, chunks, trackId, startPos: fromPos, firstFrame: null, peaks: [], peakSec: PEAK_BLOCK / ctx.sampleRate, _pk: 0, _pn: 0 };
      node.port.onmessage = (e) => {
        if (rec.firstFrame === null) rec.firstFrame = e.data.f;
        const d = e.data.d;
        chunks.push(d);
        let pk = rec._pk, pn = rec._pn;
        for (let i = 0; i < d.length; i++) {
          const v = d[i] < 0 ? -d[i] : d[i];
          if (v > pk) pk = v;
          if (++pn === PEAK_BLOCK) { rec.peaks.push(pk); pk = 0; pn = 0; }
        }
        rec._pk = pk; rec._pn = pn;
      };
      this.mic.input.connect(node);
      this.rec = rec;
      this.play(fromPos); // overdub against existing clips
    }

    /** Stop and return { buffer, startPos, trackId, compensation } (seconds) or null if nothing captured. */
    stopRecording() {
      const r = this.rec;
      if (!r) return null;
      this.rec = null;
      try {
        this.mic.input.disconnect(r.node);
      } catch (e) {}
      r.node.port.onmessage = null;
      r.node.disconnect();
      r.silent.disconnect();
      this.stop();
      const total = r.chunks.reduce((n, c) => n + c.length, 0);
      if (!total) return null;
      const buffer = this.ctx.createBuffer(1, total, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let o = 0;
      for (const c of r.chunks) {
        data.set(c, o);
        o += c.length;
      }
      // Where does song position `startPos` sit inside this take? The recorder began capturing at
      // `firstFrame`, but playback only started at `startTime` (a little later), so the take begins
      // `lead` seconds BEFORE the song does. On top of that comes the round-trip delay (output +
      // input) plus the manual nudge. Everything before that point is dead air and gets trimmed.
      const sr = this.ctx.sampleRate;
      const lead = r.firstFrame === null ? 0 : Math.max(0, this.startTime - r.firstFrame / sr);
      const latency = this.latencySeconds() + this.totalLatency();
      const shift = lead + latency + this.latencyOffsetMs / 1000;
      const compensation = S.clamp(shift, 0, buffer.duration * 0.5);
      const startShift = shift < 0 ? -shift : 0; // negative nudge: the take lands later instead
      return { buffer, startPos: r.startPos, trackId: r.trackId, compensation, startShift, lead, latency };
    }

    /** Round-trip latency used to align takes: measured value if calibrated, else the browser's estimate. */
    latencySeconds() {
      if (this.calibrated != null) return this.calibrated;
      const raw = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0) + this.inputLatency();
      // Browsers — especially with an audio interface on Windows — sometimes report a wildly inflated
      // output latency (occasionally ~1 s), which would shove every take a full second out of place.
      // Real monitoring round-trip is well under this, so cap the ESTIMATE. A real measured value
      // (Measure with mic) or the manual Nudge offset can still go higher when genuinely needed.
      return Math.min(Math.max(0, raw), 0.25);
    }

    /** The microphone path's own delay, when the browser reports it. */
    inputLatency() {
      try {
        const t = this.mic && this.mic.stream.getAudioTracks()[0];
        const l = t && t.getSettings && t.getSettings().latency;
        return typeof l === 'number' && l >= 0 && l < 0.5 ? l : 0;
      } catch (e) {
        return 0;
      }
    }

    /**
     * Measure real round-trip latency: play short clicks through the speakers and time when the
     * microphone hears them. Needs the input to be able to hear the output (speakers near the mic,
     * or a loopback cable). Returns { seconds, hits }.
     */
    async calibrateLatency() {
      if (!this.mic) throw new Error('Open an input first');
      const ctx = this.ctx;
      await ctx.resume();
      const sr = ctx.sampleRate;
      const node = new AudioWorkletNode(ctx, 'rec-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' });
      const silent = ctx.createGain();
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(ctx.destination);
      const blocks = [];
      node.port.onmessage = (e) => blocks.push(e.data);
      this.mic.input.connect(node);

      // 10 ms click: 2 kHz sine with a fast decay
      const clickLen = Math.floor(sr * 0.01);
      const click = ctx.createBuffer(1, clickLen, sr);
      const cd = click.getChannelData(0);
      for (let i = 0; i < clickLen; i++) cd[i] = Math.sin((2 * Math.PI * 2000 * i) / sr) * Math.exp((-i / clickLen) * 3);

      const N = 8;
      const gap = 0.5;
      const T0 = ctx.currentTime + 0.6;
      const times = [];
      for (let i = 0; i < N; i++) {
        const t = T0 + i * gap;
        times.push(t);
        const src = ctx.createBufferSource();
        src.buffer = click;
        const g = ctx.createGain();
        g.gain.value = 1;
        src.connect(g);
        g.connect(ctx.destination);
        src.start(t);
      }
      await new Promise((r) => setTimeout(r, (T0 + N * gap + 0.5 - ctx.currentTime) * 1000));
      try {
        this.mic.input.disconnect(node);
      } catch (e) {}
      node.port.onmessage = null;
      node.disconnect();
      silent.disconnect();

      // One continuous captured signal, with a sample index -> time map.
      // Noise floor from everything captured before the first click.
      let noise = 1e-6;
      for (const b of blocks) if ((b.f + b.d.length) / sr < T0 - 0.05) for (let i = 0; i < b.d.length; i++) { const a = Math.abs(b.d[i]); if (a > noise) noise = a; }
      const threshold = Math.max(0.02, noise * 8);
      const win = Math.max(4, Math.floor(sr * 0.001)); // ~1 ms smoothing so one noisy sample can't false-trigger

      // Smoothed-envelope onset within each click's window, refined back to the true start.
      const onsetFor = (t) => {
        const lo = t, hi = t + 0.45;
        let env = 0, overStart = -1;
        for (const b of blocks) {
          const bs = b.f / sr;
          if (bs + b.d.length / sr < lo || bs > hi) continue;
          for (let i = 0; i < b.d.length; i++) {
            const at = (b.f + i) / sr;
            if (at < lo || at > hi) continue;
            env += (Math.abs(b.d[i]) - env) / win; // one-pole moving average
            if (env > threshold) { overStart = at; break; }
          }
          if (overStart >= 0) break;
        }
        return overStart < 0 ? null : overStart - t;
      };

      let found = [];
      for (const t of times) {
        const h = onsetFor(t);
        if (h !== null && h >= 0 && h <= 0.45) found.push(h);
      }
      if (found.length < 3) throw new Error('Could not hear the test clicks. Turn the volume up and put the speakers near the mic (or use a loopback cable). With headphones the mic cannot hear anything — skip this and use the Nudge box.');
      // Reject outliers: keep the hits clustered around the median, then average them for precision.
      found.sort((a, b) => a - b);
      const median = found[Math.floor(found.length / 2)];
      const kept = found.filter((h) => Math.abs(h - median) <= 0.02); // within 20 ms of the median
      const use = kept.length >= 3 ? kept : found;
      const seconds = use.reduce((a, b) => a + b, 0) / use.length;
      if (seconds > 0.5) throw new Error('Measured delay looks wrong (' + Math.round(seconds * 1000) + ' ms). Try again in a quieter room.');
      this.calibrated = seconds;
      return { seconds, hits: use.length, spreadMs: Math.round((use[use.length - 1] - use[0]) * 1000) };
    }

    /** Push every effect's saved params back into its live instance (after undo/redo). */
    reapplyFxParams() {
      const all = [...this.project.tracks.flatMap((t) => t.fx), ...(this.project.master.fx || [])];
      for (const fx of all) {
        const rec = this.fx.get(fx.id);
        if (!rec) continue;
        const merged = S.defaultParams(rec.def, fx.params);
        for (const k of Object.keys(merged)) {
          try {
            rec.inst.setParam(k, merged[k]);
          } catch (e) {
            console.warn('[plugin setParam failed]', rec.def.id, k, e);
          }
        }
      }
    }
  }

  S.Engine = Engine;

  /* ---------- WAV encode + offline mixdown ---------- */

  S.encodeWav = (buf, { float = false } = {}) => {
    const nch = buf.numberOfChannels;
    const len = buf.length;
    const bytes = float ? 4 : 2;
    const out = new DataView(new ArrayBuffer(44 + len * nch * bytes));
    const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    out.setUint32(4, 36 + len * nch * bytes, true);
    w(8, 'WAVEfmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, float ? 3 : 1, true);
    out.setUint16(22, nch, true);
    out.setUint32(24, buf.sampleRate, true);
    out.setUint32(28, buf.sampleRate * nch * bytes, true);
    out.setUint16(32, nch * bytes, true);
    out.setUint16(34, bytes * 8, true);
    w(36, 'data');
    out.setUint32(40, len * nch * bytes, true);
    const chans = [];
    for (let c = 0; c < nch; c++) chans.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++)
      for (let c = 0; c < nch; c++) {
        if (float) {
          out.setFloat32(o, chans[c][i], true);
          o += 4;
        } else {
          const v = Math.max(-1, Math.min(1, chans[c][i]));
          out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
          o += 2;
        }
      }
    return new Uint8Array(out.buffer);
  };

  // Same bytes as encodeWav, but yields to the event loop every CHUNK frames so a big buffer never
  // freezes the UI. Used by the live-collab paths (send a session, share audio) where blocking the
  // main thread for a multi-minute recording would lock the whole app.
  S.encodeWavChunked = async (buf, { float = false } = {}) => {
    const nch = buf.numberOfChannels, len = buf.length, bytes = float ? 4 : 2;
    const out = new DataView(new ArrayBuffer(44 + len * nch * bytes));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + len * nch * bytes, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true);
    out.setUint16(20, float ? 3 : 1, true); out.setUint16(22, nch, true); out.setUint32(24, buf.sampleRate, true);
    out.setUint32(28, buf.sampleRate * nch * bytes, true); out.setUint16(32, nch * bytes, true); out.setUint16(34, bytes * 8, true);
    w(36, 'data'); out.setUint32(40, len * nch * bytes, true);
    const chans = []; for (let c = 0; c < nch; c++) chans.push(buf.getChannelData(c));
    let o = 44; const CHUNK = 200000;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nch; c++) {
        if (float) { out.setFloat32(o, chans[c][i], true); o += 4; }
        else { const v = Math.max(-1, Math.min(1, chans[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
      }
      if (i && i % CHUNK === 0) await new Promise((r) => setTimeout(r)); // breathe
    }
    return new Uint8Array(out.buffer);
  };

  /** Render the whole session (tracks, effects, master chain) offline. Returns a stereo AudioBuffer. */
  S.renderMix = async (project, { tail = 2.5, sampleRate = 44100 } = {}) => {
    const length = S.projectLength(project);
    if (length <= 0) throw new Error('Nothing to export: no clips on any track');
    const ctx = new OfflineAudioContext(2, Math.ceil((length + tail) * sampleRate), sampleRate);
    await S.prepareContext(ctx);
    const eng = new Engine(ctx, { offline: true });
    eng.sync(project);
    eng.scheduleClips(0, 0);
    return ctx.startRendering();
  };

  /** Mix the whole session down to a 16-bit stereo WAV (byte array). */
  S.renderMixdown = async (project, opts) => S.encodeWav(await S.renderMix(project, opts));
})();
