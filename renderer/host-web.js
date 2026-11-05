/* Host bridge for Android (Capacitor) and plain browsers.
 * On Windows the Electron preload provides window.studioHost and this file does nothing.
 * Here: files are saved to the phone (Documents/Session) and offered to the share sheet,
 * opened with the system file picker, and imported plugins are kept in the app's storage.
 * VST3 and The Vault are PC-only, so they report "not available". */
(function () {
  if (window.studioHost) return; // Electron (Windows)

  const Cap = window.Capacitor;
  const AND = window.SessionAndroid; // the Session Android app shell
  const isNative = !!AND || !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = (Cap && Cap.Plugins) || {};
  document.documentElement.classList.add('platform-mobile');
  if (isNative) document.documentElement.classList.add('platform-android');

  const USER_PLUGINS = 'ps.userPlugins'; // { fileName: sourceText }
  const readStore = () => {
    try {
      return JSON.parse(localStorage.getItem(USER_PLUGINS)) || {};
    } catch (e) {
      return {};
    }
  };
  const writeStore = (v) => {
    try {
      localStorage.setItem(USER_PLUGINS, JSON.stringify(v));
    } catch (e) {}
  };

  const toB64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };

  /** Let the person pick files with the system picker. */
  function pick(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.multiple = !!multiple;
      inp.style.display = 'none';
      inp.onchange = () => {
        resolve([...inp.files]);
        inp.remove();
      };
      document.body.appendChild(inp);
      inp.click();
    });
  }

  /** Save bytes/text: phone storage (Documents/Session) + share sheet; browser download elsewhere. */
  async function saveFile({ data, defaultName, binary }) {
    const name = String(defaultName || 'session').replace(/[\\/:*?"<>|]+/g, '_');
    const bytes = binary ? new Uint8Array(data) : new TextEncoder().encode(String(data));
    if (AND) {
      // saved in chunks so big WAV exports don't stall the app
      const id = AND.begin(name);
      const CHUNK = 768 * 1024;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        AND.append(id, toB64(bytes.subarray(i, i + CHUNK)));
        if (i && i % (CHUNK * 8) === 0) await new Promise((r) => setTimeout(r));
      }
      return AND.finish(id, true) + '/' + name;
    }
    if (isNative && P.Filesystem) {
      const b64 = toB64(bytes);
      let uri = null;
      let where = 'Documents/Session/' + name;
      try {
        const r = await P.Filesystem.writeFile({ path: 'Session/' + name, data: b64, directory: 'DOCUMENTS', recursive: true });
        uri = r.uri;
      } catch (e) {
        // some phones block public Documents; fall back to the app's own folder
        const r = await P.Filesystem.writeFile({ path: 'Session/' + name, data: b64, directory: 'DATA', recursive: true });
        uri = r.uri;
        where = 'the app folder';
      }
      if (P.Share) {
        try {
          await P.Share.share({ title: name, files: [uri], dialogTitle: 'Save or send ' + name });
        } catch (e) {
          /* closed the share sheet: the file is still saved */
        }
      }
      return where;
    }
    const blob = new Blob([bytes], { type: binary ? 'application/octet-stream' : 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return name;
  }

  async function openFile({ filters }) {
    const exts = (filters || []).flatMap((f) => f.extensions || []).map((e) => '.' + e);
    const [f] = await pick(exts.join(',') || '*/*');
    if (!f) return null;
    return { path: f.name, data: await f.text() };
  }

  const pluginList = fetch('plugin-list.json')
    .then((r) => r.json())
    .catch(() => []);

  const unavailable = (what) => Promise.resolve({ ok: false, error: what + ' is only available in Session for Windows.' });

  window.studioHost = {
    platform: isNative ? 'android' : 'web',
    listPlugins: async () => [...(await pluginList).map((f) => '../fx/' + f), // built-ins live in www/fx (see build-www.js)
      ...Object.keys(readStore()).map((n) => 'user:' + n)],
    readPlugin: async (url) => {
      if (String(url).startsWith('user:')) return readStore()[String(url).slice(5)];
      const r = await fetch(url);
      if (!r.ok) throw new Error('could not read ' + url);
      return r.text();
    },
    importPlugins: async () => {
      const files = await pick('.js,.mjs,.cjs,text/javascript', true);
      const store = readStore();
      const out = [];
      for (const f of files) {
        if (f.size > 5 * 1024 * 1024) continue;
        store[f.name] = await f.text();
        out.push('user:' + f.name);
      }
      writeStore(store);
      return out;
    },
    openPluginFolder: async () => window.Studio && window.Studio.toast('Imported plugins are kept inside the app. Use Import plugin to add more.'),
    saveFile,
    openFile,
    openExternal: (url) => {
      try {
        if (AND && AND.open) AND.open(url);
        else window.open(url, '_blank');
      } catch (e) {}
    },
    discordLogin: async () => ({ ok: false, error: 'Signing in with Discord is available in Session for Windows. On your phone, tap Community to open Discord.' }),
    // VST3 needs the Windows plugin host
    nativeStart: () => unavailable('VST3'),
    nativeStatus: async () => ({ built: false, running: false, unsupported: true }),
    nativeCachedList: async () => [],
    nativePickFolder: async () => null,
    nativeJson() {},
    nativeAudio() {},
    onNativeJson() {},
    onNativeAudio() {},
    // The Vault is a PC app
    vaultStatus: () => unavailable('The Vault link'),
    vaultSend: () => unavailable('The Vault link'),
    vaultRead: () => unavailable('The Vault link'),
    vaultOpen: () => unavailable('The Vault link'),
    vaultReveal: () => unavailable('The Vault link'),
  };
})();
