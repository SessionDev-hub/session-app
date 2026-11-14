/* Copy a BandLab preset: drop / paste screenshots of a BandLab effect chain, Session's server has AI read
 * every effect and knob, and rebuilds it with Session's own effects. Apply it to a track or save it as a
 * chain preset. (BandLab has no preset file or public preset link, so a screenshot is the way in.) */
(function () {
  const S = window.Studio;
  const BI = (S.bandlabImport = {});
  const api = () => ((window.__APINATOR__ && window.__APINATOR__.authEndpoint) || 'https://session-collab-auth.fly.dev/v1/collab/auth').replace(/\/collab\/auth$/, '');
  const token = async () => { try { return S.gate && S.gate.getToken ? await S.gate.getToken() : (S.auth && S.auth.token); } catch (e) { return null; } };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Session's own effects, in a compact form the AI can map onto. */
  BI.catalog = () => {
    const out = [];
    for (const d of S.plugins.values()) {
      if (!d || d.native || /^vst3:/.test(d.id)) continue;
      out.push({
        pluginId: d.id, name: d.name, category: d.category || '', does: (d.description || '').slice(0, 140),
        params: (d.params || []).filter((p) => !/^_/.test(p.id)).map((p) => p.type === 'select' ? { id: p.id, name: p.name, options: (p.options || []).map((o) => (o && o.value != null ? o.value : o)) } : p.min == null ? { id: p.id, name: p.name, type: 'on/off', default: p.default } : { id: p.id, name: p.name, unit: p.unit || '', min: p.min, max: p.max, default: p.default }),
      });
    }
    return out;
  };

  /** Keep only effects Session has, and clamp every value into range. */
  BI.clean = (chain) => {
    const fx = [], dropped = [];
    for (const f of Array.isArray(chain) ? chain : []) {
      const d = f && S.plugins.get(f.pluginId);
      if (!d) { dropped.push((f && f.pluginId) || '?'); continue; }
      const params = {};
      for (const p of d.params || []) {
        if (/^_/.test(p.id) || !f.params || !(p.id in f.params)) continue;
        const v = f.params[p.id];
        if (p.type === 'select') {
          const opts = (p.options || []).map((o) => (o && o.value != null ? o.value : o));
          const hit = opts.find((o) => String(o).toLowerCase() === String(v).toLowerCase());
          if (hit != null) params[p.id] = hit;
        } else if (p.min == null) { // on/off switch
          if (typeof v === 'boolean' || typeof v === 'number') params[p.id] = typeof p.default === 'boolean' ? !!v : (v ? 1 : 0);
        } else if (typeof v === 'number' && isFinite(v)) params[p.id] = Math.min(p.max, Math.max(p.min, v));
      }
      fx.push({ pluginId: d.id, params, bypass: !!f.bypass, from: f.from || '' });
    }
    return { fx, dropped };
  };

  /** Turn every effect up or down together: intensity knobs move toward "off", dB boosts/cuts toward 0 dB. */
  const INTENSE = /mix|wet|amount|strength|drive|depth|sat|squeeze|feedback|emph|intens|wobble|harm|gain|makeup|peak|sub|noise|res$/i;
  BI.scale = (fx, k) => fx.map((f) => {
    const d = S.plugins.get(f.pluginId); if (!d || k === 1) return f;
    const params = Object.assign({}, f.params);
    for (const p of d.params || []) {
      if (!(p.id in params) || p.type === 'select' || p.min == null || /^_/.test(p.id)) continue;
      const v = params[p.id];
      if (p.unit === 'dB' && p.min < 0 && p.max > 0) params[p.id] = Math.min(p.max, Math.max(p.min, v * k));           // boosts & cuts toward 0
      else if (INTENSE.test(p.id) && !/freq|hz|time|rate|thresh|attack|release|q$/i.test(p.id)) params[p.id] = Math.min(p.max, Math.max(p.min, p.min + (v - p.min) * k));
    }
    return Object.assign({}, f, { params });
  });

  // Screenshots are shrunk to max 1600 px JPEG: plenty to read knobs, much faster to upload.
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));   // sharp enough to read small knob numbers
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.93));
  }

  BI.open = (track) => {
    const target = () => track || S.project.tracks.find((t) => t.id === (S.selectedTrackId || '')) || S.project.tracks.find((t) => t.arm) || S.project.tracks[0];
    const dlg = document.createElement('dialog');
    dlg.className = 'modal bli';
    dlg.style.width = 'min(620px, 95vw)';
    dlg.innerHTML = `<h3 style="margin:0 0 4px">Copy a BandLab preset</h3>
      <p class="hint" style="margin:0 0 12px">Open the effects in BandLab, screenshot them so every knob and number is visible (up to 4 screenshots for long chains), then drop them here or press <b>Ctrl+V</b>. Session reads every setting and rebuilds the chain with its own effects.</p>
      <div class="bli-drop" tabindex="0"><div class="bli-thumbs"></div><div class="bli-empty">Drop screenshots here, paste with Ctrl+V, or <button type="button" class="btn sm bli-pick">choose files</button></div></div>
      <input type="text" class="txt bli-hint" maxlength="300" placeholder="Optional: anything we can't see, e.g. “Auto-Pitch key is F minor”" style="width:100%;margin-top:10px">
      <div class="bli-out"></div>
      <div class="hint bli-msg" style="min-height:18px;margin-top:8px"></div>
      <div class="row" style="flex-wrap:wrap;gap:8px"><button type="button" class="btn bli-cancel">Close</button><span style="flex:1"></span>
        <button type="button" class="btn bli-save" hidden>Save as chain preset</button><button type="button" class="btn primary bli-apply" hidden>Apply to track</button><button type="button" class="btn primary bli-go">Read preset</button></div>`;
    const $ = (s) => dlg.querySelector(s);
    const files = [];
    let result = null, kStrength = 0.9;   // a touch under 100%: imports tend to come out a little hotter than BandLab
    const drawThumbs = () => {
      const t = $('.bli-thumbs'); t.textContent = '';
      $('.bli-empty').style.display = files.length ? 'none' : '';
      files.forEach((f, i) => {
        const w = document.createElement('div'); w.className = 'bli-th';
        const img = document.createElement('img'); img.src = URL.createObjectURL(f); img.onload = () => URL.revokeObjectURL(img.src);
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = 'Remove'; x.onclick = () => { files.splice(i, 1); drawThumbs(); };
        w.append(img, x); t.appendChild(w);
      });
      if (files.length && files.length < 4) { const add = document.createElement('button'); add.type = 'button'; add.className = 'btn sm'; add.textContent = '＋ Add'; add.onclick = pick; t.appendChild(add); }
    };
    const addFiles = (list) => {
      for (const f of list) if (f && /^image\//.test(f.type) && files.length < 4) files.push(f);
      if ([...list].some((f) => !/^image\//.test(f.type))) $('.bli-msg').textContent = 'Only images (screenshots) can be read. BandLab has no preset file or preset link.';
      drawThumbs();
    };
    const pick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp'; i.multiple = true; i.onchange = () => addFiles(i.files); i.click(); };
    $('.bli-pick').onclick = pick;
    const drop = $('.bli-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
    dlg.addEventListener('paste', (e) => {
      const imgs = [...(e.clipboardData ? e.clipboardData.items : [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile());
      if (imgs.length) { e.preventDefault(); addFiles(imgs); return; }
      const txt = e.clipboardData && e.clipboardData.getData('text');
      if (txt && /bandlab\.com/i.test(txt) && e.target !== $('.bli-hint')) { e.preventDefault(); $('.bli-msg').textContent = 'BandLab links don’t include the preset’s settings, so Session can’t read them. Open the effects in BandLab and paste a screenshot instead.'; }
    });

    const showResult = () => {
      const r = result.raw, c = result.clean;
      const bl = (r.bandlab || []).map((e) => '<li><b>' + esc(e.effect) + '</b>' + (e.bypassed ? ' <i>(off)</i>' : '') + '<span class="bli-set">' + esc(Object.entries(e.settings || {}).map(([k, v]) => k + ' ' + v).join(' · ')) + '</span></li>').join('');
      const ss = c.fx.map((f) => { const d = S.plugins.get(f.pluginId); return '<li><b>' + esc(d.name) + '</b>' + (f.bypass ? ' <i>(off)</i>' : '') + (f.from ? ' <span class="hint">← ' + esc(f.from) + '</span>' : '') + '</li>'; }).join('');
      const notes = (r.notes || []).concat(c.dropped.length ? ['Skipped effects Session doesn’t have: ' + c.dropped.join(', ')] : []);
      $('.bli-out').innerHTML = `<div class="bli-cols"><div><div class="set-sec-t">BandLab (read from your screenshot)</div><ol>${bl || '<li>Nothing read</li>'}</ol></div>
        <div><div class="set-sec-t">Session chain</div><ol>${ss || '<li>No matching effects</li>'}</ol></div></div>
        ${notes.length ? '<ul class="hint bli-notes">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : ''}
        <div class="hint">Read confidence: <b>${esc(r.confidence || 'medium')}</b>. Check the numbers against BandLab before you rely on it.</div>
        <div class="param" style="margin-top:8px"><label>Strength</label><input type="range" class="bli-k" min="40" max="120" step="1" value="${Math.round(kStrength * 100)}"><span class="val bli-kv">${Math.round(kStrength * 100)}%</span></div>
        <p class="hint" style="margin:0">Sounds stronger than in BandLab? Lower this: it turns every effect's amount, drive, mix and EQ boosts down together.</p>`;
      const ks = $('.bli-k'); ks.oninput = () => { kStrength = +ks.value / 100; $('.bli-kv').textContent = ks.value + '%'; };
      const has = c.fx.length > 0;
      $('.bli-apply').hidden = !has; $('.bli-save').hidden = !has;
      const t = target(); $('.bli-apply').textContent = 'Apply to ' + (t ? '“' + (t.name || 'track') + '”' : 'track');
    };

    $('.bli-go').onclick = async () => {
      const msg = $('.bli-msg'), go = $('.bli-go');
      if (!files.length) return (msg.textContent = 'Add a screenshot of the BandLab effects first.');
      const t = await token();
      if (!t) return (msg.textContent = 'Sign in with Discord first (Session for Windows/Mac).');
      go.disabled = true; msg.textContent = 'Reading your preset… (about 10–20 seconds)';
      try {
        const fd = new FormData();
        for (const f of files) fd.append('image', await shrink(f), 'shot.jpg');
        fd.append('catalog', JSON.stringify(BI.catalog()));
        fd.append('hint', $('.bli-hint').value.trim());
        const r = await fetch(api() + '/presets/bandlab', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd });
        let j = {}; try { j = await r.json(); } catch (e) {}
        if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'the server needs the latest update (fly deploy)' : 'error ' + r.status));
        result = { raw: j.result, clean: BI.clean(j.result.chain) };
        showResult();
        msg.textContent = result.clean.fx.length ? 'Done — ' + result.clean.fx.length + ' effect' + (result.clean.fx.length > 1 ? 's' : '') + ' ready.' : 'Couldn’t match any effects — try a clearer screenshot.';
        go.textContent = 'Read again'; go.className = 'btn bli-go';
      } catch (e) { msg.textContent = 'Couldn’t read it: ' + (e.message === 'Failed to fetch' ? 'no connection to Session’s server' : e.message); }
      go.disabled = false;
    };
    $('.bli-apply').onclick = () => {
      const t = target(); if (!t || !result) return;
      const r = S.chainPresets.apply(t, { fx: BI.scale(result.clean.fx, kStrength) });
      S.toast('BandLab preset applied to “' + (t.name || 'track') + '” (' + r.applied + ' effects). Undo with Ctrl+Z.');
      dlg.close();
    };
    $('.bli-save').onclick = async () => {
      if (!result) return;
      const name = ((await S.askText('Name this preset', { value: (result.raw.name || 'BandLab preset').slice(0, 40) })) || '').trim();
      if (!name) return;
      S.chainPresets.save({ fx: BI.scale(result.clean.fx, kStrength) }, name);
      S.toast('Saved “' + name + '” — find it under Chain presets on any track.');
    };
    $('.bli-cancel').onclick = () => dlg.close();
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    drop.focus();
  };

  function style() {
    if (document.getElementById('bli-style')) return;
    const s = document.createElement('style'); s.id = 'bli-style';
    s.textContent = `
    .bli-drop{border:2px dashed var(--line-hi);border-radius:12px;padding:14px;min-height:110px;display:flex;align-items:center;justify-content:center;outline:none}
    .bli-drop.over,.bli-drop:focus{border-color:var(--accent)}
    .bli-empty{color:var(--dim);text-align:center}
    .bli-thumbs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .bli-th{position:relative}.bli-th img{height:90px;max-width:180px;object-fit:cover;border-radius:8px;display:block}
    .bli-th button{position:absolute;top:4px;right:4px;border:0;border-radius:50%;width:20px;height:20px;background:rgba(0,0,0,.7);color:#fff;cursor:pointer;font-size:11px}
    .bli-out{margin-top:12px}.bli-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .bli-out ol{margin:6px 0 0;padding-left:18px;font-size:12.5px}.bli-out li{margin-bottom:5px}
    .bli-set{display:block;color:var(--dim);font-size:11.5px}
    .bli-notes{margin:10px 0 6px;padding-left:18px}
    @media (max-width:560px){.bli-cols{grid-template-columns:1fr}}`;
    document.head.appendChild(s);
  }

  function init() {
    style();
    // "Copy a BandLab preset…" in every Chain presets menu (track right-click + mixer)
    const C = S.chainPresets;
    if (C && C.menuItems && !C.__bli) {
      const orig = C.menuItems; C.__bli = true;
      C.menuItems = (track) => [{ label: 'Copy a BandLab preset (screenshot)…', action: () => BI.open(track) }, { sep: true }].concat(orig(track));
    }
    // and a button in FX & Plugins next to Vocal Vibe
    const vibe = document.getElementById('btn-vibe');
    if (vibe && !document.getElementById('btn-bandlab')) {
      const b = document.createElement('button'); b.className = vibe.className.replace(/\bprimary\b/, '').trim() || 'btn'; b.id = 'btn-bandlab'; b.type = 'button';
      b.title = 'Copy a BandLab preset from a screenshot'; b.textContent = 'BandLab preset…'; b.onclick = () => BI.open();
      vibe.after(b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
