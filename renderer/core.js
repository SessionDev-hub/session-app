/* Core namespace, plugin registry, small helpers. Loaded first. */
(function () {
  const Studio = (window.Studio = {
    plugins: new Map(),
    events: new EventTarget(),
    STEPS_PER_BAR: 16,
  });

  Studio.on = (name, fn) => Studio.events.addEventListener(name, (e) => fn(e.detail));
  Studio.emit = (name, detail) => Studio.events.dispatchEvent(new CustomEvent(name, { detail }));
  Studio.uid = () => Math.random().toString(36).slice(2, 9);
  Studio.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  Studio.mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  Studio.noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
  Studio.isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);

  /**
   * Plugin registration. Plugin files (renderer/../plugins/*.js or the user plugin
   * folder) call Studio.registerPlugin({...}). See plugins/README.md.
   */
  Studio._regLog = [];
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const EFFECT_ALIASES = ['effect', 'fx', 'audio-effect', 'audioeffect', 'processor', 'filter'];

  /** Fill in anything a third-party plugin left out so the host and the editor never meet NaN or undefined. */
  function normalizeParams(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;
      const p = Object.assign({}, raw);
      p.id = String(p.id);
      p.name = p.name || p.label || p.id;
      const t = String(p.type || '').toLowerCase();
      if (t === 'select' || t === 'enum' || t === 'choice' || Array.isArray(p.options)) {
        p.type = 'select';
        p.options = (Array.isArray(p.options) && p.options.length ? p.options : ['default']).map(String);
        p.default = p.default !== undefined && p.options.includes(String(p.default)) ? String(p.default) : p.options[0];
      } else if (t === 'boolean' || t === 'bool' || t === 'toggle' || t === 'checkbox') {
        p.type = 'boolean';
        p.default = !!p.default;
      } else {
        delete p.type;
        p.min = Number.isFinite(+p.min) && p.min !== null && p.min !== '' ? +p.min : 0;
        p.max = Number.isFinite(+p.max) && p.max !== null && p.max !== '' ? +p.max : p.min + 1;
        if (!(p.max > p.min)) p.max = p.min + 1;
        if (p.scale === 'log' && p.min <= 0) p.scale = 'linear';
        const d = Number.isFinite(+p.default) && p.default !== null && p.default !== '' ? +p.default : p.min;
        p.default = Studio.clamp(d, p.min, p.max);
      }
      out.push(p);
    }
    return out;
  }

  /**
   * Plugin registration. Plugin files (plugins/*.js or the user plugin folder) call
   * Studio.registerPlugin({...}) or export a definition. See plugins/README.md.
   */
  Studio.registerPlugin = (def) => {
    const problems = [];
    if (!def || typeof def !== 'object') problems.push('definition must be an object');
    else {
      if (!def.name && def.id) def.name = String(def.id);
      if ((!def.id || typeof def.id !== 'string') && def.name) def.id = 'user-' + slug(def.name);
      if (!def.id || typeof def.id !== 'string') problems.push('missing string id');
      if (!def.name) problems.push('missing name');
      const t = def.type === undefined ? 'effect' : String(def.type).toLowerCase();
      if (EFFECT_ALIASES.includes(t)) def.type = 'effect';
      else problems.push('type "' + def.type + '" is not supported (only audio effects can go on a track or the master)');
      if (typeof def.create !== 'function') problems.push('missing create(ctx) function');
    }
    if (problems.length) {
      console.warn('[plugin rejected]', def && def.id, problems.join('; '));
      Studio._regLog.push({ ok: false, id: def && def.id, problems });
      Studio.emit('plugin-error', { id: def && def.id, problems });
      return false;
    }
    def.params = normalizeParams(def.params);
    // Give every effect its own personal In/Out level trim (handled by the host gain
    // nodes around each plugin). Added once, and skipped if the plugin already defines them.
    if (def.type === 'effect' && !def.params.some((p) => p.id === '_in' || p.id === '_out')) {
      def.params.push({ id: '_in', name: 'In', unit: 'dB', min: -24, max: 24, step: 0.1, default: 0 });
      def.params.push({ id: '_out', name: 'Out', unit: 'dB', min: -24, max: 24, step: 0.1, default: 0 });
      def.layout = Array.isArray(def.layout) ? def.layout.slice() : [];
      def.layout.push({ title: 'Level', params: ['_in', '_out'] });
    }
    Studio.plugins.set(def.id, def);
    Studio._regLog.push({ ok: true, id: def.id, name: def.name });
    return true;
  };

  /**
   * Plugins that need sample-accurate processing register an AudioWorklet here (name -> source).
   * Studio.prepareContext(ctx) loads them into a context before any plugin instance is created.
   */
  Studio.worklets = new Map();
  Studio.registerWorklet = (name, source) => {
    if (typeof name === 'string' && typeof source === 'string') Studio.worklets.set(name, source);
  };
  const prepared = new WeakMap();
  Studio.prepareContext = async (ctx) => {
    if (!ctx || !ctx.audioWorklet) return;
    if (!prepared.has(ctx)) prepared.set(ctx, new Set());
    const done = prepared.get(ctx);
    for (const [name, src] of Studio.worklets) {
      if (done.has(name)) continue;
      done.add(name);
      try {
        await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(src));
      } catch (e) {
        console.warn('[worklet failed to load]', name, e);
      }
    }
  };

  Studio.pluginsOfType = (type) => [...Studio.plugins.values()].filter((p) => p.type === type);

  Studio.defaultParams = (def, overrides) => {
    const out = {};
    for (const p of def.params) out[p.id] = p.default;
    return Object.assign(out, overrides || {});
  };

  /**
   * Load one plugin from its source text. Accepts:
   *  - classic scripts that call Studio.registerPlugin(...)
   *  - CommonJS style: module.exports = def | [defs] | (Studio) => def
   *  - ES modules: export default def | [defs] | function; or named exports that are definitions
   * Returns { file, ok, names, error }. Never throws.
   */
  Studio.loadPluginSource = async (file, src) => {
    const mark = Studio._regLog.length;
    let error = null;
    try {
      const isModule = /^\s*(import\s*[\w{*'"]|export\s)/m.test(src);
      let exported;
      if (isModule) {
        const url = URL.createObjectURL(new Blob([src + '\n//# sourceURL=plugin-' + file], { type: 'text/javascript' }));
        try {
          const mod = await import(url);
          exported = mod.default !== undefined ? mod.default : mod;
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        const module = { exports: {} };
        const require = (m) => {
          throw new Error('require("' + m + '") is not available: plugins run in the browser, so bundle dependencies into the single file');
        };
        new Function('module', 'exports', 'require', 'Studio', src + '\n//# sourceURL=plugin-' + file).call(window, module, module.exports, require, Studio);
        exported = module.exports;
      }
      const defs = [];
      const walk = (v, depth) => {
        if (!v || depth > 3) return;
        if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
        if (typeof v === 'function') {
          if (/^class[\s{]/.test(Function.prototype.toString.call(v)) || typeof v.prototype?.createInstance === 'function')
            throw new Error('this is a class-based plugin (for example a Web Audio Module); only single-file plugins that register a { create(ctx) } effect are supported');
          return walk(v(Studio), depth + 1);
        }
        if (typeof v !== 'object') return;
        if (typeof v.create === 'function') defs.push(v);
        else if (v.default) walk(v.default, depth + 1);
        else Object.values(v).forEach((x) => walk(x, depth + 1));
      };
      walk(exported && (Object.keys(exported).length || typeof exported === 'function' || Array.isArray(exported)) ? exported : null, 0);
      for (const d of defs) Studio.registerPlugin(d);
    } catch (e) {
      error = (e && e.message) || String(e);
      console.warn('[plugin failed to load]', file, e);
    }
    const mine = Studio._regLog.slice(mark);
    const names = mine.filter((r) => r.ok).map((r) => r.name);
    const rejected = mine.filter((r) => !r.ok);
    if (!error && rejected.length) error = rejected.map((r) => r.problems.join('; ')).join(' | ');
    if (!error && !names.length) error = 'no plugin found: the file must call Studio.registerPlugin({ id, name, create(ctx) {...} }) (see plugins/README.md)';
    const result = { file, ok: !error || names.length > 0, names, error };
    Studio.pluginReport.push(result);
    return result;
  };

  Studio.pluginReport = [];

  Studio.loadPluginUrl = async (url) => {
    const file = decodeURIComponent(String(url).split('/').pop());
    let src;
    try {
      src = await window.studioHost.readPlugin(url);
    } catch (e) {
      const r = { file, ok: false, names: [], error: 'could not read file: ' + ((e && e.message) || e) };
      Studio.pluginReport.push(r);
      return r;
    }
    return Studio.loadPluginSource(file, src);
  };

  /** Load every plugin script the host reports (builtin + user folder). One bad file never blocks the others. */
  Studio.loadPlugins = async () => {
    const urls = await window.studioHost.listPlugins();
    const out = [];
    for (const url of urls) out.push(await Studio.loadPluginUrl(url));
    return out;
  };

  /** Promise-based text prompt (window.prompt is unavailable in Electron). */
  Studio.askText = (title, { password = false, placeholder = '', value = '' } = {}) =>
    new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `<form method="dialog"><h3></h3><input class="txt" ${
        password ? 'type="password"' : 'type="text"'
      } /><div class="row"><button value="cancel" class="btn">Cancel</button><button value="ok" class="btn primary">OK</button></div></form>`;
      dlg.querySelector('h3').textContent = title;
      const input = dlg.querySelector('input');
      input.placeholder = placeholder;
      input.value = value;
      dlg.addEventListener('close', () => {
        const ok = dlg.returnValue === 'ok';
        const v = input.value;
        dlg.remove();
        resolve(ok ? v : null);
      });
      document.body.appendChild(dlg);
      dlg.showModal();
      input.focus();
    });

  Studio.toast = (msg) => {
    if (typeof document === 'undefined' || !document.body) return console.log('[toast]', msg);
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.classList.add('out'); // fade + slide away, then remove
      setTimeout(() => t.remove(), 320);
    }, 3200);
  };
})();
