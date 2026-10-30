/* Musical tools: key detection, auto-tune, level balancing, auto-master, loudness check. */
(function () {
  const S = window.Studio;
  const D = S.dsp;
  const T = (S.tools = {});
  const $ = (id) => document.getElementById(id);
  const NOTES = D.NOTE_NAMES;
  const keyName = (k) => (k ? NOTES[k.tonic] + ' ' + k.mode : 'not set');
  const dbFmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

  /* ---------- helpers ---------- */

  /** Sum clips into one mono signal at the context rate. onlyClip = a single clip, otherwise every audible clip. */
  T.projectMono = (onlyClip) => {
    const sr = S.ctx.sampleRate;
    const list = [];
    if (onlyClip) list.push(onlyClip);
    else for (const tr of S.project.tracks) if (!tr.mute) for (const c of tr.clips) if (!c.muted) list.push(c);
    let end = 0;
    for (const c of list) end = Math.max(end, onlyClip ? c.dur : c.start + c.dur);
    end = Math.min(end, 20 * 60);
    const out = new Float32Array(Math.max(1, Math.floor(end * sr)));
    for (const c of list) {
      const buf = S.buffers.get(c.asset);
      if (!buf) continue;
      const ratio = buf.sampleRate / sr;
      const from = Math.floor(c.offset * buf.sampleRate);
      const dst = onlyClip ? 0 : Math.floor(c.start * sr);
      const n = Math.min(Math.floor(c.dur * sr), out.length - dst);
      const chans = [];
      for (let ch = 0; ch < buf.numberOfChannels; ch++) chans.push(buf.getChannelData(ch));
      const k = (c.gain || 1) / chans.length;
      for (let i = 0; i < n; i++) {
        const si = from + Math.round(i * ratio);
        if (si >= buf.length) break;
        let v = 0;
        for (const d of chans) v += d[si];
        out[dst + i] += v * k;
      }
    }
    return out;
  };

  /* ---------- key ---------- */

  function updateKeyUI() {
    const k = S.project.key;
    $('key-tonic').value = k ? String(k.tonic) : '';
    $('key-mode').value = k ? k.mode : 'major';
    $('key-auto').checked = S.project.keyAuto !== false;
    $('btn-autotune').title = 'Pitch-correct the selected clip to ' + (k ? keyName(k) : 'a key you choose');
  }
  T.updateKeyUI = updateKeyUI;

  /** Detect the key (of one clip, or of everything on the timeline) and store it in the project. */
  T.detectKey = ({ clip = null, quiet = false } = {}) => {
    const x = T.projectMono(clip);
    const res = D.detectKey(x, S.ctx.sampleRate);
    if (!res) {
      if (!quiet) S.toast('No audio to analyse yet');
      return null;
    }
    S.project.key = { tonic: res.tonic, mode: res.mode };
    updateKeyUI();
    if (!quiet) {
      const alt = res.ranking[1];
      S.toast('Key: ' + res.name + ' (' + Math.round(res.confidence * 100) + '% sure; next best ' + alt.name + ')');
    }
    return res;
  };

  /** Called after a take or an import lands. */
  T.afterContent = () => {
    if (S.project.keyAuto !== false) T.detectKey({ quiet: true });
  };

  /* ---------- small modal helper ---------- */
  function modal(html) {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = html;
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  const keyOptions = () => NOTES.map((n, i) => `<option value="${i}">${n}</option>`).join('');

  /* ---------- auto-tune ---------- */

  T.autoTuneDialog = (clip) => {
    if (!clip) return S.toast('Select a clip first (click it on the timeline)');
    if (S.engine.isRecording) return S.toast('Stop recording first');
    const pk = S.project.key;
    const dlg = modal(`<h3>Auto-tune</h3>
      <div class="param"><label>Tune to</label><select id="at-key" class="sel">
        <option value="project">Project key (${keyName(pk)})</option>
        <option value="detect">Detect key from this clip</option>
        <option value="manual">Pick a key…</option>
        <option value="chromatic">Any note (nearest semitone)</option></select><span></span></div>
      <div class="param" id="at-manual" hidden><label>Key</label><span style="display:flex;gap:6px"><select id="at-tonic" class="sel">${keyOptions()}</select><select id="at-mode" class="sel"><option>major</option><option>minor</option></select></span><span></span></div>
      <div class="param"><label>Retune speed</label><input type="range" id="at-speed" min="0" max="200" step="1" value="20"><span class="val" id="at-speed-v"></span></div>
      <div class="param"><label>Strength</label><input type="range" id="at-str" min="0" max="100" step="1" value="100"><span class="val" id="at-str-v"></span></div>
      <p class="hint" style="color:var(--dim);margin:8px 0">Works on one voice or one instrument at a time. Fast speed gives the hard, robotic effect; around 100+ ms keeps it natural. You can undo it.</p>
      <div id="at-status" class="hint" style="min-height:1.2em"></div>
      <div class="row"><button class="btn" id="at-cancel">Cancel</button><button class="btn primary" id="at-go">Apply</button></div>`);
    const q = (id) => dlg.querySelector('#' + id);
    if (!pk) q('at-key').value = 'detect';
    if (pk) {
      q('at-tonic').value = pk.tonic;
      q('at-mode').value = pk.mode;
    }
    const sync = () => {
      const sp = +q('at-speed').value;
      q('at-speed-v').textContent = sp === 0 ? 'instant' : sp + ' ms';
      q('at-str-v').textContent = q('at-str').value + '%';
      q('at-manual').hidden = q('at-key').value !== 'manual';
    };
    ['at-speed', 'at-str', 'at-key'].forEach((id) => (q(id).oninput = sync));
    sync();
    q('at-cancel').onclick = () => dlg.close();
    q('at-go').onclick = async () => {
      const buf = S.buffers.get(clip.asset);
      if (!buf) return dlg.close();
      const status = q('at-status');
      q('at-go').disabled = true;
      try {
        const sr = buf.sampleRate;
        const a = Math.max(0, Math.floor(clip.offset * sr));
        const n = Math.max(1, Math.min(buf.length - a, Math.floor(clip.dur * sr)));
        const chans = [];
        for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).slice(a, a + n));

        let key;
        const mode = q('at-key').value;
        if (mode === 'chromatic') key = null;
        else if (mode === 'manual') key = { tonic: +q('at-tonic').value, mode: q('at-mode').value };
        else if (mode === 'project' && pk) key = pk;
        else {
          const det = D.detectKey(D.toMono(chans), sr);
          if (!det) throw new Error('Could not find a key: the clip looks silent');
          key = { tonic: det.tonic, mode: det.mode };
        }

        status.textContent = 'Tuning…';
        const res = await D.autoTune(chans, sr, {
          key,
          speed: +q('at-speed').value,
          strength: +q('at-str').value / 100,
          onProgress: (p) => (status.textContent = 'Tuning… ' + Math.round(p * 100) + '%'),
        });
        if (res.stats.voicedFraction < 0.03) throw new Error('Could not find a clear pitch in this clip. Auto-tune needs a single voice or instrument.');

        const out = S.ctx.createBuffer(chans.length, n, sr);
        res.channels.forEach((ch, i) => out.getChannelData(i).set(ch));
        S.history.push();
        clip.asset = S.addAsset(clip.name + ' (tuned)', out);
        clip.offset = 0;
        clip.dur = out.duration;
        if (mode !== 'chromatic' && mode !== 'project' && !S.project.key) {
          S.project.key = key;
          updateKeyUI();
        }
        S.clips.afterEdit();
        dlg.close();
        S.toast('Tuned to ' + (key ? keyName(key) : 'nearest semitone') + '. Average correction ' + Math.round(res.stats.medianCents) + ' cents.');
      } catch (e) {
        q('at-status').textContent = e.message;
        q('at-go').disabled = false;
      }
    };
  };

  /* ---------- mixing: balance levels ---------- */

  /** Typical loudness of a track's audio, ignoring silence (dB RMS). */
  function trackLevelDb(tr) {
    let energy = 0;
    let frames = 0;
    for (const c of tr.clips) {
      if (c.muted) continue;
      const buf = S.buffers.get(c.asset);
      if (!buf) continue;
      const a = Math.floor(c.offset * buf.sampleRate);
      const b = Math.min(buf.length, a + Math.floor(c.dur * buf.sampleRate));
      const F = 4410;
      for (let p = a; p + F <= b; p += F) {
        let s = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = p; i < p + F; i++) s += d[i] * d[i];
        }
        s = (s / (F * buf.numberOfChannels)) * c.gain * c.gain;
        if (s > 1e-5) {
          energy += s;
          frames++;
        }
      }
    }
    return frames ? 10 * Math.log10(energy / frames) : null;
  }

  const ROLE = [
    [/vocal|vox|voice|lead|sing/i, 3],
    [/kick|drum|bass/i, 0],
    [/pad|string|synth|key|piano|guitar|back|harm/i, -2],
  ];

  /** Set every fader so tracks sit at sensible relative levels (vocals a little forward). */
  T.balanceLevels = () => {
    const rows = [];
    for (const tr of S.project.tracks) {
      const db = trackLevelDb(tr);
      if (db === null) continue;
      const role = (ROLE.find(([re]) => re.test(tr.name)) || [0, 0])[1];
      rows.push({ tr, rel: -20 + role - db });
    }
    if (!rows.length) return S.toast('Nothing to balance: no audio on any track');
    const sorted = rows.map((r) => r.rel).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const raw = rows.map((r) => 0.7 * Math.pow(10, Math.max(-18, Math.min(18, r.rel - med)) / 20));
    const scale = Math.min(1, 1 / Math.max(...raw));
    S.history.push();
    rows.forEach((r, i) => (r.tr.vol = S.clamp(raw[i] * scale, 0.02, 1.2)));
    S.refresh.structure();
    S.toast('Levels balanced on ' + rows.length + ' tracks. Adjust any fader by ear from here.');
  };

  /* ---------- mastering ---------- */

  const STYLES = {
    Balanced: { low: 0.5, mid: 0, high: 1 },
    Warm: { low: 1.5, mid: 0, high: -0.5 },
    Bright: { low: 0, mid: 0.5, high: 2.5 },
  };

  function masterPreset(style, ceiling) {
    const e = STYLES[style] || STYLES.Balanced;
    const fx = (pluginId, params) => ({ id: S.uid(), pluginId, params, bypass: false });
    return [
      fx('fx-filter', { type: 'highpass', cutoff: 30, resonance: 0.7 }),
      fx('fx-eq3', { low: e.low, mid: e.mid, midFreq: 1000, high: e.high }),
      fx('fx-compressor', { threshold: -20, ratio: 2, attack: 0.03, release: 0.25, makeup: 0 }),
      fx('fx-width', { width: 1.1 }),
      fx('fx-limiter', { gain: 0, ceiling, release: 0.12 }),
    ];
  }

  async function measureMix() {
    const buf = await S.renderMix(S.project);
    const m = D.measureLoudness([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
    return m;
  }

  const fmtM = (m) => dbFmt(m.lufs) + ' LUFS, true peak ' + dbFmt(m.truePeakDb) + ' dB';

  T.masterDialog = () => {
    if (S.projectLength() <= 0) return S.toast('Record or import something first');
    if (S.engine.isRecording) return S.toast('Stop recording first');
    const dlg = modal(`<h3>Mix &amp; master</h3>
      <div class="param"><label>Style</label><select id="ms-style" class="sel">${Object.keys(STYLES).map((s) => `<option>${s}</option>`).join('')}</select><span></span></div>
      <div class="param"><label>Loudness target</label><select id="ms-target" class="sel">
        <option value="-14">−14 LUFS: Spotify, YouTube, Tidal</option>
        <option value="-16">−16 LUFS: Apple Music, podcasts</option>
        <option value="-11">−11 LUFS: loud streaming master</option>
        <option value="-9">−9 LUFS: club / very loud</option></select><span></span></div>
      <div class="param"><label>Peak ceiling</label><select id="ms-ceil" class="sel"><option value="-1">−1.0 dB (streaming safe)</option><option value="-0.3">−0.3 dB (CD)</option><option value="-2">−2.0 dB (extra safe)</option></select><span></span></div>
      <p class="hint" style="color:var(--dim);margin:8px 0">Builds a master chain (rumble filter, EQ, gentle glue compression, stereo width, limiter), then raises the limiter until the whole mix hits the target loudness. Everything is editable on the Master strip afterwards, and you can undo it.</p>
      <div id="ms-out" style="white-space:pre-wrap;min-height:3.6em;margin:6px 0"></div>
      <div class="row"><button class="btn" id="ms-measure">Measure only</button><button class="btn" id="ms-clear">Remove master chain</button><button class="btn" id="ms-close">Close</button><button class="btn primary" id="ms-go">Auto master</button></div>`);
    const q = (id) => dlg.querySelector('#' + id);
    const out = q('ms-out');
    const busy = (b) => ['ms-measure', 'ms-clear', 'ms-go'].forEach((id) => (q(id).disabled = b));
    q('ms-close').onclick = () => dlg.close();

    q('ms-measure').onclick = async () => {
      busy(true);
      out.textContent = 'Measuring…';
      try {
        out.textContent = 'Current mix: ' + fmtM(await measureMix());
      } catch (e) {
        out.textContent = e.message;
      }
      busy(false);
    };

    q('ms-clear').onclick = () => {
      S.history.push();
      S.project.master.fx = [];
      S.refresh.structure();
      out.textContent = 'Master chain removed.';
    };

    q('ms-go').onclick = async () => {
      busy(true);
      try {
        const target = +q('ms-target').value;
        const ceiling = +q('ms-ceil').value;
        out.textContent = 'Measuring the mix as it is…';
        const keep = S.project.master.fx;
        S.project.master.fx = [];
        const before = await measureMix();
        if (!Number.isFinite(before.lufs)) {
          S.project.master.fx = keep;
          throw new Error('The mix is silent, so there is nothing to master.');
        }
        S.project.master.fx = keep;
        S.history.push();
        S.project.master.fx = masterPreset(q('ms-style').value, ceiling);
        const lim = S.project.master.fx[S.project.master.fx.length - 1];
        let after = null;
        for (let pass = 1; pass <= 4; pass++) {
          out.textContent = 'Before: ' + fmtM(before) + '\nMastering, pass ' + pass + ' of up to 4…';
          S.engine.sync(S.project);
          after = await measureMix();
          const delta = target - after.lufs;
          if (Math.abs(delta) < 0.3) break;
          lim.params.gain = S.clamp(Math.round((lim.params.gain + delta) * 10) / 10, -12, 24);
          if (lim.params.gain >= 24 || lim.params.gain <= -12) {
            S.engine.sync(S.project);
            after = await measureMix();
            break;
          }
        }
        S.refresh.structure();
        const gotIt = Math.abs(after.lufs - target) < 0.7;
        out.textContent =
          'Before: ' + fmtM(before) + '\nAfter:  ' + fmtM(after) + (gotIt ? '' : '\nCould not reach exactly ' + target + ' LUFS without hitting the limiter limits.');
      } catch (e) {
        out.textContent = e.message;
      }
      busy(false);
    };
  };

  /* ---------- wiring ---------- */

  T.init = () => {
    $('key-tonic').innerHTML = '<option value="">—</option>' + keyOptions();
    $('key-tonic').onchange = () => {
      S.project.key = $('key-tonic').value === '' ? null : { tonic: +$('key-tonic').value, mode: $('key-mode').value };
      S.project.keyAuto = false; // you chose it, so stop second-guessing
      updateKeyUI();
    };
    $('key-mode').onchange = () => {
      if ($('key-tonic').value !== '') {
        S.project.key = { tonic: +$('key-tonic').value, mode: $('key-mode').value };
        S.project.keyAuto = false;
        updateKeyUI();
      }
    };
    $('key-auto').onchange = () => {
      S.project.keyAuto = $('key-auto').checked;
      if (S.project.keyAuto) T.detectKey({ quiet: true });
    };
    $('btn-key').onclick = () => {
      const sel = S.timeline.selectedClipObject && S.timeline.selectedClipObject();
      T.detectKey({ clip: sel || null });
    };
    $('btn-autotune').onclick = () => T.autoTuneDialog(S.timeline.selectedClipObject());
    $('btn-balance').onclick = T.balanceLevels;
    $('btn-master').onclick = T.masterDialog;
    S.on('project-replaced', updateKeyUI);
    updateKeyUI();
  };
})();
