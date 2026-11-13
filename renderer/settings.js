/* Settings — one place for app preferences: Appearance (background), Audio (recording latency),
 * and About. Opened by the gear button in the toolbar. */
(function () {
  const S = window.Studio;
  const G = (S.settings = {});

  // tiny account store, backed by this computer
  const account = (S.account = {
    get() {
      try { return JSON.parse(localStorage.getItem('ps.account')); } catch (e) { return null; }
    },
    set(p) {
      try { p ? localStorage.setItem('ps.account', JSON.stringify(p)) : localStorage.removeItem('ps.account'); } catch (e) {}
      if (S.emit) S.emit('account-changed', p || null);
    },
  });
  // app audio preferences (output device + app volumes), saved on this computer
  const AKEY = 'ps.audio';
  const audioPrefs = (G.audio = {
    get() {
      try { return Object.assign({ outVol: 1, monVol: 1, outputDevice: '' }, JSON.parse(localStorage.getItem(AKEY)) || {}); } catch (e) { return { outVol: 1, monVol: 1, outputDevice: '' }; }
    },
    set(patch) {
      const p = Object.assign(audioPrefs.get(), patch);
      try { localStorage.setItem(AKEY, JSON.stringify(p)); } catch (e) {}
      return p;
    },
  });

  /** Whether to show the "Take aligned…" toast after each recording. Default on. */
  G.alignToast = () => { try { return localStorage.getItem('ps.alignToast') !== '0'; } catch (e) { return true; } };

  /** Push saved audio prefs into the engine. Called at startup and after the audio pane changes them. */
  G.applyAudio = () => {
    if (!S.engine) return;
    const p = audioPrefs.get();
    try { S.engine.setOutputVolume(p.outVol); } catch (e) {}
    try { S.engine.setMonitorVolume(p.monVol); } catch (e) {}
    if (p.outputDevice) { try { S.engine.setOutputDevice(p.outputDevice); } catch (e) {} }
  };

  const discordCfg = () => window.__DISCORD__ || {};
  const inviteUrl = () => discordCfg().invite || 'https://discord.gg/HbkNrPAAm';
  const openLink = (url) => (window.studioHost && window.studioHost.openExternal ? window.studioHost.openExternal(url) : window.open(url, '_blank'));

  // One shared update-event listener drives whatever Updates panel is currently open.
  let upEls = null; // { status, restart, btn }
  let updateWired = false;
  function wireUpdates() {
    if (updateWired || !window.studioHost || !window.studioHost.onUpdate) return;
    updateWired = true;
    const ver = window.__SESSION_VERSION__ || '';
    window.studioHost.onUpdate((m) => {
      if (!m || !upEls) return;
      const { status, restart, btn } = upEls;
      if (m.state === 'checking') status.textContent = 'Checking for updates…';
      else if (m.state === 'none') { status.textContent = 'You’re on the latest version' + (ver ? ' (' + ver + ')' : '') + '.'; btn.disabled = false; }
      else if (m.state === 'available') status.textContent = 'Update ' + (m.version ? 'v' + m.version + ' ' : '') + 'found — downloading…';
      else if (m.state === 'progress') status.textContent = 'Downloading update… ' + m.percent + '%';
      else if (m.state === 'ready') { status.textContent = 'Update ready — restart to finish.'; restart.style.display = ''; btn.disabled = false; }
      else if (m.state === 'error') { status.textContent = 'Couldn’t check right now — try again later.'; btn.disabled = false; }
    });
  }

  const notesList = () => (window.__PATCH_NOTES__ || []);

  /** "What's new" popup for a given notes entry. */
  G.showWhatsNew = (entry) => {
    if (!entry) return;
    const dlg = document.createElement('dialog');
    dlg.className = 'modal whatsnew-dlg';
    dlg.innerHTML =
      '<div class="set-head"><span class="set-ic">' + S.ui.icon('wand', 18) + '</span><h3>What’s new</h3><span class="set-ver">v' + entry.version + '</span></div>' +
      '<ul class="wn-list">' + entry.changes.map((c) => '<li>' + String(c).replace(/[<>]/g, '') + '</li>').join('') + '</ul>' +
      '<div class="row"><button class="btn primary" value="ok">Got it</button></div>';
    dlg.querySelector('button').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  };

  /** On launch: if the version changed since last run, show that version's notes once. */
  G.checkWhatsNew = () => {
    const cur = window.__SESSION_VERSION__;
    if (!cur) return;
    let last = null;
    try { last = localStorage.getItem('ps.lastSeenVersion'); } catch (e) {}
    try { localStorage.setItem('ps.lastSeenVersion', cur); } catch (e) {}
    if (last && last !== cur) {
      const entry = notesList().find((n) => n.version === cur);
      if (entry) setTimeout(() => G.showWhatsNew(entry), 600); // let the app settle first
    }
  };

  G.init = () => {
    const btn = document.getElementById('btn-settings-tab') || document.getElementById('btn-bg'); // the toolbar gear
    if (btn) {
      btn.onclick = () => G.open();
      btn.title = 'Settings: background, recording, and more';
    }
    G.applyAudio();
    // tell the updater whether the user wants automatic updates
    try {
      const v = localStorage.getItem('ps.autoUpdate');
      const on = v === null ? true : v === '1';
      if (window.studioHost && window.studioHost.updateSetAuto) window.studioHost.updateSetAuto(on);
    } catch (e) {}
  };

  G.open = (tab = 'appearance') => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal settings-dlg';
    dlg.innerHTML =
      '<div class="set-head"><span class="set-ic">' +
      S.ui.icon('gear', 18) +
      '</span><h3>Settings</h3><span class="set-ver">v' +
      (window.__SESSION_VERSION__ || '0.10.0') +
      '</span><div class="pw-sp"></div><button class="pw-ib set-x" title="Close">' +
      S.ui.icon('x', 14) +
      '</button></div>' +
      '<div class="set-wrap"><div class="set-tabs"></div><div class="set-body"></div></div>';
    const tabsEl = dlg.querySelector('.set-tabs');
    const body = dlg.querySelector('.set-body');
    dlg.querySelector('.set-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => { upEls = null; dlg.remove(); });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());

    const TABS = [
      ['account', 'Account', 'user'],
      ['appearance', 'Appearance', 'image'],
      ['audio', 'Audio', 'timer'],
      ['about', 'About', 'home'],
    ];
    const tabBtns = {};
    TABS.forEach(([id, label, icon]) => {
      const b = document.createElement('button');
      b.className = 'set-tab';
      b.innerHTML = S.ui.icon(icon, 15) + '<span>' + label + '</span>';
      b.onclick = () => show(id);
      tabsEl.appendChild(b);
      tabBtns[id] = b;
    });

    function show(id) {
      Object.entries(tabBtns).forEach(([k, b]) => b.classList.toggle('on', k === id));
      body.innerHTML = '';
      if (id === 'account') paneAccount();
      else if (id === 'appearance') paneAppearance();
      else if (id === 'audio') paneAudio();
      else paneAbout();
    }

    function paneAccount() {
      const box = document.createElement('div');
      box.className = 'set-pane';
      const acc = account.get();
      const title = document.createElement('div');
      title.className = 'set-sec-t';
      title.textContent = 'Account';
      box.appendChild(title);
      if (acc) {
        const row = document.createElement('div');
        row.className = 'acc-row';
        const av = document.createElement('img');
        av.className = 'acc-av';
        av.src = acc.avatar || '';
        av.referrerPolicy = 'no-referrer';
        av.onerror = () => (av.style.visibility = 'hidden');
        const who = document.createElement('div');
        const nm = document.createElement('div');
        nm.className = 'acc-name';
        nm.textContent = acc.name || 'Signed in';
        const sub = document.createElement('div');
        sub.className = 'hint';
        sub.textContent = 'Signed in with Discord';
        who.append(nm, sub);
        row.append(av, who);
        box.appendChild(row);
        const out = document.createElement('button');
        out.className = 'btn ghost';
        out.style.marginTop = '12px';
        out.textContent = 'Sign out';
        out.onclick = () => { account.set(null); show('account'); };
        box.appendChild(out);
      } else {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'Sign in with Discord to carry your name and avatar in Session and connect with other artists.';
        box.appendChild(p);
        const btn = document.createElement('button');
        btn.className = 'btn primary';
        btn.style.marginTop = '6px';
        btn.innerHTML = S.ui.icon('user', 15) + 'Sign in with Discord';
        btn.onclick = async () => {
          const dc = discordCfg();
          if (!window.studioHost.discordLogin) return S.toast('Sign-in needs the updated app.');
          if (!dc.clientId && window.studioHost.platform !== 'android' && window.studioHost.platform !== 'web')
            return S.toast('Discord sign-in isn’t set up yet. Add your Discord Client ID in updates.config.json (see SETUP-DISCORD.txt).');
          btn.disabled = true;
          btn.textContent = 'Opening Discord…';
          const r = await window.studioHost.discordLogin({ clientId: dc.clientId, redirect: dc.redirect });
          btn.disabled = false;
          if (r && r.ok) { account.set(r.profile); S.toast('Signed in as ' + r.profile.name); show('account'); }
          else { if (r && r.error && r.error !== 'cancelled') S.toast(r.error); show('account'); }
        };
        box.appendChild(btn);
      }
      body.appendChild(box);

      // Community
      const com = document.createElement('div');
      com.className = 'set-pane';
      com.innerHTML = '<div class="set-sec-t">Community</div><p class="hint">Connect with other artists, share songs, and get help — in the Session Discord.</p>';
      const cbtn = document.createElement('button');
      cbtn.className = 'btn accent';
      cbtn.innerHTML = S.ui.icon('vault', 15) + 'Open the community';
      cbtn.onclick = () => openLink(inviteUrl());
      com.appendChild(cbtn);
      body.appendChild(com);
    }

    function paneAppearance() {
      if (S.theme && S.theme.controls) { const th = document.createElement('div'); th.className = 'set-pane'; S.theme.controls(th); body.appendChild(th); }
      const box = document.createElement('div');
      box.className = 'set-pane';
      const h = document.createElement('div');
      h.className = 'set-sec-t';
      h.textContent = 'Background';
      box.appendChild(h);
      const c = document.createElement('div');
      box.appendChild(c);
      body.appendChild(box);
      if (S.background && S.background.controls) S.background.controls(c);
      else c.innerHTML = '<p class="hint">Background controls are unavailable.</p>';
    }

    function paneAudio() {
      // ---- Devices ----
      const dev = document.createElement('div');
      dev.className = 'set-pane';
      dev.innerHTML =
        '<div class="set-sec-t">Devices</div>' +
        '<div class="param"><label>Input (mic)</label><select class="sel" id="set-in"></select><span class="hint">What you record from.</span></div>' +
        '<div class="param"><label>Output</label><select class="sel" id="set-out"></select><span class="hint" id="set-out-hint">Where Session plays sound.</span></div>';
      body.appendChild(dev);

      // ---- Playback behavior ----
      const pb = document.createElement('div');
      pb.className = 'set-pane';
      pb.innerHTML = '<div class="set-sec-t">Playback</div>';
      const row = document.createElement('div');
      row.className = 'su-auto-row';
      row.innerHTML = '<span class="su-auto-l">Return to start when you stop</span>';
      const lab = document.createElement('label'); lab.className = 'su-switch';
      const tog = document.createElement('input'); tog.type = 'checkbox';
      const srOn = (() => { try { const v = localStorage.getItem('ps.stopReturns'); return v === null ? true : v === '1'; } catch (e) { return true; } })();
      tog.checked = srOn;
      const srHint = document.createElement('p'); srHint.className = 'hint';
      const setHint = () => { srHint.textContent = tog.checked ? 'Pressing stop jumps the playhead back to where playback began.' : 'Pressing stop leaves the playhead where it is.'; };
      setHint();
      tog.onchange = () => { try { localStorage.setItem('ps.stopReturns', tog.checked ? '1' : '0'); } catch (e) {} setHint(); };
      lab.appendChild(tog); lab.appendChild(document.createElement('span'));
      row.appendChild(lab); pb.appendChild(row); pb.appendChild(srHint);

      // Alignment toast after each recording
      const row2 = document.createElement('div');
      row2.className = 'su-auto-row';
      row2.innerHTML = '<span class="su-auto-l">Show the “Take aligned” note after recording</span>';
      const lab2 = document.createElement('label'); lab2.className = 'su-switch';
      const tog2 = document.createElement('input'); tog2.type = 'checkbox';
      tog2.checked = G.alignToast();
      const at2Hint = document.createElement('p'); at2Hint.className = 'hint';
      const setAt2 = () => { at2Hint.textContent = tog2.checked ? 'After a take, Session tells you how far it nudged it for latency.' : 'Takes still align automatically — Session just won’t pop the note.'; };
      setAt2();
      tog2.onchange = () => { try { localStorage.setItem('ps.alignToast', tog2.checked ? '1' : '0'); } catch (e) {} setAt2(); };
      lab2.appendChild(tog2); lab2.appendChild(document.createElement('span'));
      row2.appendChild(lab2); pb.appendChild(row2); pb.appendChild(at2Hint);

      body.appendChild(pb);

      const inSel = dev.querySelector('#set-in');
      const outSel = dev.querySelector('#set-out');
      const prefs = audioPrefs.get();

      // Input: mirror the toolbar picker so both stay in sync
      const toolIn = document.getElementById('sel-input');
      async function fillInputs() {
        let devs = [];
        try { devs = await S.engine.listInputs(); } catch (e) {}
        inSel.innerHTML = '<option value="">Default input</option>';
        devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Input ' + (i + 1); inSel.appendChild(o); });
        if (toolIn) inSel.value = toolIn.value || '';
      }
      fillInputs();
      inSel.onchange = async () => {
        if (toolIn) { toolIn.value = inSel.value; toolIn.dispatchEvent(new Event('change', { bubbles: true })); }
        audioPrefs.set({ inputDevice: inSel.value });
        if (S.engine.mic) { try { await S.engine.openInput(inSel.value || undefined); } catch (e) {} }
      };

      // Output: only when the browser can switch sinks
      async function fillOutputs() {
        let devs = [];
        try { devs = await S.engine.listOutputs(); } catch (e) {}
        if (!S.engine.ctx.setSinkId || !devs.length) {
          outSel.disabled = true;
          outSel.innerHTML = '<option>System default</option>';
          dev.querySelector('#set-out-hint').textContent = 'Uses your system’s default output on this device.';
          return;
        }
        outSel.innerHTML = '<option value="">System default</option>';
        devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Output ' + (i + 1); outSel.appendChild(o); });
        outSel.value = prefs.outputDevice || '';
      }
      fillOutputs();
      outSel.onchange = async () => {
        const ok = await S.engine.setOutputDevice(outSel.value);
        if (ok) audioPrefs.set({ outputDevice: outSel.value });
      };

      // ---- Volumes (live) ----
      const vol = document.createElement('div');
      vol.className = 'set-pane';
      vol.innerHTML = '<div class="set-sec-t">Volume</div>';
      const slider = (label, key, val, hint) => {
        const row = document.createElement('div');
        row.className = 'param';
        row.innerHTML = '<label>' + label + '</label><input type="range" min="0" max="150" step="1"><span class="val"></span>';
        const r = row.querySelector('input'), out = row.querySelector('.val');
        r.value = Math.round((val != null ? val : 1) * 100);
        out.textContent = r.value + '%';
        // react on every movement, live
        r.oninput = () => {
          out.textContent = r.value + '%';
          const g = +r.value / 100;
          if (key === 'outVol') S.engine.setOutputVolume(g);
          else if (key === 'monVol') S.engine.setMonitorVolume(g);
          audioPrefs.set({ [key]: g });
        };
        vol.appendChild(row);
        if (hint) { const p = document.createElement('p'); p.className = 'hint'; p.style.margin = '0 0 6px 130px'; p.textContent = hint; vol.appendChild(p); }
      };
      slider('App output', 'outVol', prefs.outVol, 'Overall Session volume before your speakers — turn everything, VST sounds and recordings included, up or down.');
      slider('Input monitor', 'monVol', prefs.monVol, 'How loud you hear yourself while monitoring or recording. Use headphones to avoid echo.');
      body.appendChild(vol);

      // ---- Recording over existing audio ----
      const rec = document.createElement('div');
      rec.className = 'set-pane';
      rec.innerHTML = '<div class="set-sec-t">Recording</div>';
      const rrow = document.createElement('div');
      rrow.className = 'param';
      rrow.innerHTML = '<label>Over existing audio</label><span class="seg rec-seg"></span><span class="hint">Replace = a new take swaps the old one. Layer = keep both (overdub).</span>';
      const segBox = rrow.querySelector('.rec-seg');
      [['replace', 'Replace (retake)'], ['layer', 'Layer']].forEach(([v, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-b' + ((S.recordMode || 'replace') === v ? ' on' : '');
        b.textContent = label;
        b.onclick = () => { S.setRecordMode(v); segBox.querySelectorAll('.seg-b').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
        segBox.appendChild(b);
      });
      rec.appendChild(rrow);
      body.appendChild(rec);

      // ---- Playback buffer ----
      const pbuf = document.createElement('div');
      pbuf.className = 'set-pane';
      pbuf.innerHTML =
        '<div class="set-sec-t">Playback buffer</div>' +
        '<div class="param"><label>Buffer</label><span class="seg rec-seg" id="set-buf"></span></div>' +
        '<p class="hint" id="set-buf-hint"></p>';
      body.appendChild(pbuf);
      const BUF = [['low', 'Lowest delay'], ['balanced', 'Balanced'], ['stable', 'Stable']];
      const bufNow = () => { try { return localStorage.getItem('ps.audioBuffer') || 'low'; } catch (e) { return 'low'; } };
      const bufHint = () => {
        const v = bufNow(), running = S.audioBuffer || 'low';
        const what = { low: 'Smallest buffer: you hear yourself soonest while recording. If playback skips or crackles, pick Balanced or Stable.', balanced: 'A bit more buffer: stops most skipping, adds a few ms when you hear yourself.', stable: 'Biggest buffer: playback never skips, even on a busy or older computer. You hear yourself later while recording (use “My interface — 0 ms” below for that).' }[v];
        pbuf.querySelector('#set-buf-hint').innerHTML = what + (v !== running ? ' <b>Restart Session to apply</b> (save your session first).' : '');
      };
      BUF.forEach(([v, label]) => {
        const b = document.createElement('button'); b.type = 'button';
        b.className = 'seg-b' + (bufNow() === v ? ' on' : ''); b.textContent = label;
        b.onclick = () => { try { localStorage.setItem('ps.audioBuffer', v); } catch (e) {} pbuf.querySelectorAll('.seg-b').forEach((x) => x.classList.remove('on')); b.classList.add('on'); bufHint(); };
        pbuf.querySelector('#set-buf').appendChild(b);
      });
      bufHint();

      // ---- Zero-latency recording ----
      const zl = document.createElement('div');
      zl.className = 'set-pane';
      zl.innerHTML =
        '<div class="set-sec-t">Zero-latency recording</div>' +
        '<div class="param"><label>Hear yourself through</label><span class="seg rec-seg" id="set-mon-src"></span></div>' +
        '<p class="hint" id="set-mon-hint"></p>' +
        '<div class="su-auto-row"><span class="su-auto-l">Low-latency recording</span><label class="su-switch"><input type="checkbox" id="set-lowlat"><span></span></label></div>' +
        '<p class="hint">While you record, plugins that add delay on the other tracks and the master are paused (they come back when you stop), and your own track never waits for delay compensation.</p>' +
        '<div class="param"><label>You hear yourself</label><span id="set-mon-ms" class="val"></span><span></span></div>' +
        '<p class="hint" id="set-mon-tips"></p>';
      body.appendChild(zl);
      const monSeg = zl.querySelector('#set-mon-src'), ll = zl.querySelector('#set-lowlat');
      ll.checked = S.engine.lowLatency !== false;
      const monRead = () => {
        const eng = S.engine, direct = !!eng.directMonitor;
        const armed = S.project.tracks.find((t) => t.arm);
        const ms = Math.round(eng.monitorDelay(armed && armed.id) * 1000);
        zl.querySelector('#set-mon-hint').innerHTML = direct
          ? 'Session stays silent for your mic — turn on <b>Direct Monitor</b> (or the “Mix / Monitor” knob) on your audio interface and you hear yourself with <b>0 ms</b> delay. Your effects are still recorded on playback, you just don’t hear them live.'
          : 'You hear your voice through Session with your effects (Auto-Tune, reverb…). Delay depends on your device — see below.';
        zl.querySelector('#set-mon-ms').textContent = direct ? '0 ms late (direct)' : '≈ ' + ms + ' ms late';
        const tips = [];
        if (!direct && ms > 20) {
          tips.push('Under ~12 ms feels instant; above ~20 ms you start to hear an echo.');
          tips.push('Fastest fixes: wired headphones (never Bluetooth), plug them into your audio interface, and set the interface’s buffer to 64 or 128 samples in its own control panel.');
          if (armed && armed.fx.some((f) => !f.bypass && /^vst3:/.test(f.pluginId || ''))) tips.push('VST3 plugins on the track you record add ~17 ms each — record with Session’s own effects, then switch to the VSTs for the mix.');
          tips.push('Have an interface with a Direct Monitor knob? Pick “My interface” above for true zero latency.');
        }
        zl.querySelector('#set-mon-tips').innerHTML = tips.join('<br>');
      };
      [[false, 'Session (with effects)'], [true, 'My interface — 0 ms']].forEach(([v, label]) => {
        const b = document.createElement('button'); b.type = 'button';
        b.className = 'seg-b' + (!!S.engine.directMonitor === v ? ' on' : ''); b.textContent = label;
        b.onclick = () => {
          S.engine.setDirectMonitor(v);
          try { localStorage.setItem('ps.directMon', v ? '1' : '0'); } catch (e) {}
          monSeg.querySelectorAll('.seg-b').forEach((x) => x.classList.remove('on')); b.classList.add('on'); monRead();
        };
        monSeg.appendChild(b);
      });
      ll.onchange = () => { S.engine.lowLatency = ll.checked; try { localStorage.setItem('ps.lowLatency', ll.checked ? '1' : '0'); } catch (e) {} monRead(); };
      monRead();

      const box = document.createElement('div');
      box.className = 'set-pane';
      box.innerHTML =
        '<div class="set-sec-t">Recording latency</div>' +
        '<p class="hint">Every setup has a small delay between the backing track and the mic. Session sets it for you automatically so your takes land on the beat.</p>' +
        '<div class="su-auto-row"><span class="su-auto-l">Set latency automatically</span><label class="su-switch"><input type="checkbox" id="set-autolat"><span></span></label></div>' +
        '<p class="hint" id="set-autolat-hint"></p>' +
        '<div class="param"><label>Measured delay</label><span id="set-lat-read" class="val"></span><span></span></div>' +
        '<div class="param"><label>&nbsp;</label><button class="btn" id="set-cal">Measure with mic</button><button class="btn" id="set-cal-auto" style="margin-left:8px">Estimate (no mic)</button><span class="hint">On headphones, use Estimate — the mic can’t hear the clicks.</span></div>' +
        '<div class="param"><label>Set delay yourself</label><select class="sel" id="set-lat-pick" style="max-width:220px"><option value="">Pick your setup…</option><option value="8">Audio interface, low buffer (~8 ms)</option><option value="15">Audio interface (~15 ms)</option><option value="25">USB mic (~25 ms)</option><option value="40">Laptop / built-in (~40 ms)</option><option value="60">Phone wired headphones (~60 ms)</option><option value="200">Bluetooth headphones (~200 ms)</option></select><input type="number" id="set-lat-ms" class="txt num" min="0" max="500" step="1" placeholder="ms" style="width:80px;margin-left:8px"><button class="btn" id="set-lat-apply" style="margin-left:8px">Set</button></div>' +
        '<p class="hint">Know your delay? Type it (or pick your setup) and press Set. Measure with mic plays 10 clicks and tells you how solid the result is.</p>' +
        '<div class="param"><label>Recording offset (ms)</label><input type="number" id="set-nudge" class="txt num" step="5"><span class="hint">Added on top of the delay above, and remembered. On an audio interface, set this once so takes land on the beat: if takes sound early use a negative number, if late use positive. (You can also nudge a selected take with [ and ] — hold Shift for 1 s, Alt for 50 ms.)</span></div>';
      body.appendChild(box);
      const al = box.querySelector('#set-autolat'), alHint = box.querySelector('#set-autolat-hint');
      al.checked = S.autoLatencyOn ? S.autoLatencyOn() : true;
      const setAl = () => { alHint.textContent = al.checked ? 'The first time you record with a new mic or output, Session plays a few quiet clicks (about 3 s) and sets the delay. On headphones it uses your device’s own figure instead.' : 'Off — use Measure or the offset box below to line takes up yourself.'; };
      setAl();
      al.onchange = () => { try { localStorage.setItem('ps.autoLatency', al.checked ? '1' : '0'); } catch (e) {} setAl(); };
      const read = document.getElementById('lat-readout');
      const refresh = () => (box.querySelector('#set-lat-read').textContent = (read && read.textContent) || '—');
      refresh();
      box.querySelector('#set-cal').onclick = () => {
        const c = document.getElementById('btn-cal');
        if (c) c.click();
        setTimeout(refresh, 400);
        setTimeout(refresh, 1500);
      };
      box.querySelector('#set-cal-auto').onclick = () => {
        if (S.useAutoLatency) S.useAutoLatency();
        setTimeout(refresh, 100);
      };
      const pick = box.querySelector('#set-lat-pick'), msIn = box.querySelector('#set-lat-ms');
      if (S.latencyInfo) msIn.value = S.latencyInfo().ms;
      pick.onchange = () => { if (pick.value) msIn.value = pick.value; };
      box.querySelector('#set-lat-apply').onclick = () => {
        const v = parseFloat(msIn.value);
        if (!(v >= 0 && v <= 500)) return S.toast('Type a delay between 0 and 500 ms.');
        if (S.setManualLatency) S.setManualLatency(v);
        setTimeout(refresh, 50);
      };
      const nudge = box.querySelector('#set-nudge');
      const lat = document.getElementById('lat');
      if (lat) {
        nudge.value = lat.value || 0;
        nudge.oninput = () => {
          lat.value = nudge.value || 0;
          lat.dispatchEvent(new Event('change', { bubbles: true }));
        };
      }
    }

    function paneAbout() {
      const ver = window.__SESSION_VERSION__ || '0.12.0';
      const box = document.createElement('div');
      box.className = 'set-pane';
      box.innerHTML =
        '<div class="set-sec-t">Session</div>' +
        '<p class="hint">Record, create and share. Version ' + ver + '.</p>';
      body.appendChild(box);

      // Updates panel with a "Check for updates" button
      const up = document.createElement('div');
      up.className = 'set-pane';
      up.innerHTML = '<div class="set-sec-t">Updates</div>';
      const host = window.studioHost || {};
      if (host.updateCheck) {
        const status = document.createElement('p');
        status.className = 'hint';
        // Automatic-update switch
        const auOn = (() => { try { const v = localStorage.getItem('ps.autoUpdate'); return v === null ? true : v === '1'; } catch (e) { return true; } })();
        status.textContent = auOn ? 'Session updates itself automatically. You can also check right now.' : 'Automatic updates are off — use “Check for updates” when you want one.';
        const autoRow = document.createElement('label');
        autoRow.className = 'param su-auto';
        autoRow.innerHTML = '<span class="su-auto-l">Automatic updates</span>';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.className = 'su-switch';
        toggle.checked = auOn;
        toggle.onchange = () => {
          try { localStorage.setItem('ps.autoUpdate', toggle.checked ? '1' : '0'); } catch (e) {}
          if (host.updateSetAuto) try { host.updateSetAuto(toggle.checked); } catch (e) {}
          status.textContent = toggle.checked ? 'Session updates itself automatically. You can also check right now.' : 'Automatic updates are off — use “Check for updates” when you want one.';
        };
        autoRow.appendChild(toggle);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'Check for updates';
        const restart = document.createElement('button');
        restart.className = 'btn primary';
        restart.textContent = 'Restart & update';
        restart.style.display = 'none';
        restart.onclick = () => host.updateInstall && host.updateInstall();
        btn.onclick = () => {
          btn.disabled = true;
          status.textContent = 'Checking for updates…';
          try { host.updateCheck(); } catch (e) {}
          setTimeout(() => (btn.disabled = false), 10000); // safety re-enable if nothing comes back
        };
        row.append(btn, restart);
        up.append(status, autoRow, row);
        upEls = { status, restart, btn };
        wireUpdates();
      } else {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'On this device, get new versions from your releases page.';
        up.appendChild(p);
      }
      body.appendChild(up);

      // Discord Rich Presence (only when the desktop app can talk to Discord)
      if (S.presence && window.studioHost && window.studioHost.setPresence) {
        const dc = document.createElement('div');
        dc.className = 'set-pane';
        dc.innerHTML = '<div class="set-sec-t">Discord</div>';
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = S.presence.enabled()
          ? 'Your Discord shows “Playing Session” and what you’re working on while Session is open.'
          : 'Rich Presence is off — your Discord won’t show that you’re in Session.';
        const row = document.createElement('label');
        row.className = 'param su-auto';
        row.innerHTML = '<span class="su-auto-l">Show Session on Discord</span>';
        const tog = document.createElement('input');
        tog.type = 'checkbox';
        tog.className = 'su-switch';
        tog.checked = S.presence.enabled();
        tog.onchange = () => {
          S.presence.setEnabled(tog.checked);
          hint.textContent = tog.checked
            ? 'Your Discord shows “Playing Session” and what you’re working on while Session is open.'
            : 'Rich Presence is off — your Discord won’t show that you’re in Session.';
        };
        row.appendChild(tog);
        dc.append(hint, row);
        body.appendChild(dc);
      }

      // Patch notes
      const notes = notesList();
      if (notes.length) {
        const nb = document.createElement('div');
        nb.className = 'set-pane';
        nb.innerHTML = '<div class="set-sec-t">What’s new</div>';
        notes.slice(0, 4).forEach((n) => {
          const h = document.createElement('div');
          h.className = 'wn-ver';
          h.textContent = 'v' + n.version + (n.date ? '  ·  ' + n.date : '');
          const ul = document.createElement('ul');
          ul.className = 'wn-list';
          n.changes.forEach((c) => { const li = document.createElement('li'); li.textContent = c; ul.appendChild(li); });
          nb.append(h, ul);
        });
        body.appendChild(nb);
      }
    }

    document.body.appendChild(dlg);
    dlg.showModal();
    show(tab);
  };
})();
