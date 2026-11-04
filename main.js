const { app, BrowserWindow, ipcMain, dialog, shell, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const { HostBridge } = require('./native/bridge');
const vault = require('./native/vault');
const updates = require('./native/updates');
const { DiscordRPC } = require('./native/discord-rpc');

let mainWin = null;

// Baked config (GitHub + Discord app settings). Read once; same file gen-config.js reads.
let _cfg = null;
function appConfig() {
  if (_cfg) return _cfg;
  try { _cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'updates.config.json'), 'utf8')); } catch (e) { _cfg = {}; }
  return _cfg;
}
let bridge = null;
let bridgeStarting = null;

/* ---------- native VST3 host (ps-host.exe, built from native-host/) ---------- */

function hostExePath() {
  const name = process.platform === 'win32' ? 'ps-host.exe' : 'ps-host';
  // Installed / portable exe: resources\bin\ps-host.exe (outside the app.asar archive, so Windows can start it).
  // Running from source (npm start): <app folder>\bin\ps-host.exe.
  const packaged = path.join(process.resourcesPath || '', 'bin', name);
  const source = path.join(__dirname, 'bin', name);
  const candidates = app.isPackaged ? [packaged] : [source, packaged];
  return candidates.find((p) => !p.includes('.asar' + path.sep) && fs.existsSync(p)) || null;
}

function nativeFiles() {
  const dir = path.join(app.getPath('userData'), 'native');
  fs.mkdirSync(dir, { recursive: true });
  return { cache: path.join(dir, 'vst3-known.xml'), pedal: path.join(dir, 'vst3-scan-pedal.txt'), list: path.join(dir, 'vst3-plugins.json') };
}

function ensureBridge() {
  if (bridge && bridge.alive) return Promise.resolve(bridge);
  if (bridgeStarting) return bridgeStarting;
  const exe = hostExePath();
  if (!exe) {
    return Promise.reject(new Error(app.isPackaged ? 'The VST3 plugin host is missing from this copy of Session. Reinstall it, or ask whoever sent it for a copy that includes ps-host.exe.' : 'The plugin host is not built yet. Follow native-host/README.md to build bin/ps-host.exe.'));
  }
  const f = nativeFiles();
  const b = new HostBridge({ command: exe, extraArgs: ['--cache', f.cache, '--pedal', f.pedal, '--list-json', f.list] });
  b.on('json', (m) => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('native:json', m));
  b.on('audio', (buf) => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('native:audio', new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)));
  b.on('exit', () => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('native:json', { evt: 'hostExit' }));
  bridgeStarting = b
    .start()
    .then(() => (bridge = b))
    .finally(() => (bridgeStarting = null));
  return bridgeStarting;
}

const asBuffer = (d) => (d instanceof ArrayBuffer ? Buffer.from(d) : ArrayBuffer.isView(d) ? Buffer.from(d.buffer, d.byteOffset, d.byteLength) : null);
const fromApp = (e) => mainWin && e.sender === mainWin.webContents;

ipcMain.handle('native:start', async (e) => {
  if (!fromApp(e)) return { ok: false, error: 'denied' };
  try {
    await ensureBridge();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('native:status', () => ({ built: !!hostExePath(), running: !!(bridge && bridge.alive) }));
ipcMain.handle('native:cachedList', () => {
  try {
    return JSON.parse(fs.readFileSync(nativeFiles().list, 'utf8'));
  } catch (e) {
    return [];
  }
});
ipcMain.handle('native:pickFolder', async (e) => {
  if (!fromApp(e)) return null;
  const res = await dialog.showOpenDialog({ title: 'Folder that contains VST3 plugins', properties: ['openDirectory'] });
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
});
ipcMain.on('native:json', (e, msg) => {
  if (!fromApp(e) || !bridge || !bridge.alive || !msg || typeof msg.cmd !== 'string') return;
  bridge.sendJson(msg);
});
ipcMain.on('native:audio', (e, data) => {
  if (!fromApp(e) || !bridge || !bridge.alive) return;
  const b = asBuffer(data);
  if (b && b.length >= 12 && b.length < 1024 * 1024) bridge.sendAudio(b);
});
app.on('before-quit', () => { if (bridge) bridge.stop(); if (rpc) try { rpc.destroy(); } catch (e) {} });

function userPluginDir() {
  const dir = path.join(app.getPath('userData'), 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listJs(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(js|mjs|cjs)$/i.test(f))
      .sort()
      .map((f) => pathToFileURL(path.join(dir, f)).href);
  } catch {
    return [];
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 650,
    backgroundColor: '#0a0a0c',
    title: 'Session',
    show: false, // shown once the first frame (the load screen) is painted: no white flash
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWin = win;
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  updates.initAutoUpdate(win, app.isPackaged);
}

ipcMain.handle('update:install', () => updates.quitAndInstall());
ipcMain.handle('update:check', () => updates.checkNow());
ipcMain.handle('update:setAuto', (_e, on) => updates.setAuto(on));
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ---------- Sign in with Discord (implicit grant, no backend/secret) ---------- */
async function discordProfile(token) {
  const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Discord returned ' + r.status);
  const u = await r.json();
  const avatar = u.avatar
    ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=128'
    : 'https://cdn.discordapp.com/embed/avatars/' + (Number((BigInt(u.id) >> 22n) % 6n)) + '.png';
  return { id: u.id, username: u.username, name: u.global_name || u.username, avatar };
}

/** The signed-in user's roles in a guild (needs guilds.members.read). Returns { inGuild, roles }. */
async function discordMember(token, guildId) {
  if (!guildId) return { inGuild: null, roles: [] };
  const r = await fetch('https://discord.com/api/v10/users/@me/guilds/' + guildId + '/member', { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return { inGuild: false, roles: [] }; // not a member of that server
  if (!r.ok) throw new Error('Discord returned ' + r.status + ' checking your roles');
  const m = await r.json();
  return { inGuild: true, roles: Array.isArray(m.roles) ? m.roles : [] };
}

/* Sign in with Discord, WITHOUT the authorize screen on repeat launches.
 * We try a silent pass first (prompt=none) in a hidden window: if the user has already approved
 * Session, Discord redirects straight back with a token and they never see anything. Only when
 * Discord says interaction is actually needed (first time, or they're logged out) do we show the
 * window and ask for consent once. Either way we still read their guild roles to gate the Beta. */
const NEEDS_INTERACTION = /^(consent_required|interaction_required|login_required|account_selection_required)$/;

ipcMain.handle('discord:login', (_e, { clientId, redirect, guildId }) => {
  return new Promise((resolve) => {
    if (!clientId) return resolve({ ok: false, error: 'No Discord Client ID is set yet.' });
    const redir = redirect || 'http://localhost/session-oauth';
    const scope = guildId ? 'identify guilds.members.read' : 'identify';
    const buildUrl = (prompt) =>
      'https://discord.com/oauth2/authorize?response_type=token&client_id=' + encodeURIComponent(clientId) +
      '&scope=' + encodeURIComponent(scope) + '&redirect_uri=' + encodeURIComponent(redir) +
      '&state=' + Math.random().toString(36).slice(2) + (prompt ? '&prompt=' + prompt : '');

    const win = new BrowserWindow({
      width: 520, height: 760, title: 'Sign in with Discord', autoHideMenuBar: true,
      parent: mainWin || undefined, modal: false,
      show: false, // stay invisible during the silent pass; only shown if consent is really needed
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });

    let done = false, interactive = false, revealTimer = null;
    const finish = (res) => {
      if (done) return;
      done = true;
      if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
      try { if (!win.isDestroyed()) win.close(); } catch (e) {}
      resolve(res);
    };
    const reveal = () => { // bring the window forward so the user can complete sign-in
      if (done || interactive) return;
      interactive = true;
      if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
      try { if (!win.isDestroyed()) { win.show(); win.focus(); win.loadURL(buildUrl('consent')); } } catch (e) {}
    };

    const handle = (navUrl) => {
      if (!navUrl || navUrl.indexOf(redir) !== 0) return false;
      const frag = navUrl.split('#')[1] || navUrl.split('?')[1] || '';
      const q = new URLSearchParams(frag);
      const token = q.get('access_token');
      if (token) {
        Promise.all([discordProfile(token), discordMember(token, guildId)])
          .then(([p, mem]) => finish({ ok: true, profile: p, inGuild: mem.inGuild, roles: mem.roles, token: token }))
          .catch((e) => finish({ ok: false, error: String(e.message || e) }));
        return true;
      }
      const err = q.get('error') || '';
      // Silent pass bounced because the user must act — switch to a visible consent prompt once.
      if (!interactive && NEEDS_INTERACTION.test(err)) { reveal(); return true; }
      finish({ ok: false, error: q.get('error_description') || err || 'Sign-in was not completed.' });
      return true;
    };

    win.webContents.on('will-redirect', (e, u) => { if (handle(u)) e.preventDefault(); });
    win.webContents.on('will-navigate', (e, u) => { if (handle(u)) e.preventDefault(); });
    // If Discord shows its own login/authorize page (not a redirect) during the silent pass,
    // that means interaction is needed — reveal the window so the user isn't stuck on a hidden one.
    win.webContents.on('did-stop-loading', () => {
      if (done || interactive) return;
      let u = ''; try { u = win.webContents.getURL(); } catch (e) {}
      // Reveal only if Discord sat us on its login page (user is logged out). The authorize URL is
      // the one we loaded for the silent pass; consent_required comes back as an error redirect
      // (handled above), so neither should reveal here.
      if (/^https:\/\/discord\.com\/login/.test(u)) reveal();
    });
    win.on('closed', () => finish({ ok: false, error: 'cancelled' }));

    // Backstop: if the silent pass neither redirects nor errors within a few seconds, show the window.
    revealTimer = setTimeout(reveal, 4000);
    win.loadURL(buildUrl('none'));
  });
});

/* ---------- Discord Rich Presence (local IPC, no bot token) ---------- */
let rpc = null;
function ensureRpc() {
  if (rpc) return rpc;
  const clientId = (appConfig().discord || {}).clientId;
  if (!clientId) return null;
  rpc = new DiscordRPC(clientId);
  return rpc;
}
// Renderer sends the activity it wants shown (or null to clear). Only the app window may drive it.
ipcMain.handle('discord:presence:set', (e, activity) => {
  if (!fromApp(e)) return { ok: false };
  const r = ensureRpc();
  if (!r) return { ok: false };
  try { activity ? r.setActivity(sanitizeActivity(activity)) : r.clear(); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('discord:presence:clear', (e) => {
  if (!fromApp(e)) return { ok: false };
  if (rpc) try { rpc.clear(); } catch (err) {}
  return { ok: true };
});
// Keep only the fields Discord accepts, and cap string lengths so a long status can't be rejected.
function sanitizeActivity(a) {
  const cut = (s, n) => (typeof s === 'string' ? s.slice(0, n) : undefined);
  const out = {};
  if (a.details) out.details = cut(a.details, 128);
  if (a.state) out.state = cut(a.state, 128);
  if (a.startTimestamp) out.timestamps = { start: Math.floor(Number(a.startTimestamp)) };
  const assets = {};
  if (a.largeImageKey) assets.large_image = cut(a.largeImageKey, 256);
  if (a.largeImageText) assets.large_text = cut(a.largeImageText, 128);
  if (a.smallImageKey) assets.small_image = cut(a.smallImageKey, 256);
  if (a.smallImageText) assets.small_text = cut(a.smallImageText, 128);
  if (Object.keys(assets).length) out.assets = assets;
  if (Array.isArray(a.buttons)) {
    const b = a.buttons.filter((x) => x && x.label && /^https?:\/\//i.test(x.url || '')).slice(0, 2)
      .map((x) => ({ label: cut(x.label, 32), url: x.url }));
    if (b.length) out.buttons = b;
  }
  return out;
}

ipcMain.handle('plugins:list', () => [
  ...listJs(path.join(__dirname, 'plugins')),
  ...listJs(userPluginDir()),
]);

function pluginDirs() {
  return [path.join(__dirname, 'plugins'), userPluginDir()];
}

// Renderer asks for a plugin's source text by URL; only files inside the two plugin folders are served.
ipcMain.handle('plugins:read', (_e, url) => {
  const file = fileURLToPath(String(url));
  const ok = pluginDirs().some((d) => {
    const rel = path.relative(d, file);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!ok) throw new Error('Not a plugin file');
  const st = fs.statSync(file);
  if (st.size > 20 * 1024 * 1024) throw new Error('Plugin file is larger than 20 MB');
  return fs.readFileSync(file, 'utf8');
});

// Pick plugin files anywhere on disk, copy them into the user plugin folder, return their URLs.
ipcMain.handle('plugins:import', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Import plugin',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Plugin script', extensions: ['js', 'mjs', 'cjs'] }],
  });
  if (res.canceled) return [];
  const dir = userPluginDir();
  const out = [];
  for (const src of res.filePaths) {
    const dest = path.join(dir, path.basename(src));
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    out.push(pathToFileURL(dest).href);
  }
  return out;
});

ipcMain.handle('plugins:openFolder', () => shell.openPath(userPluginDir()));

/* ---------- The Vault (song library app) ---------- */
const vaultCall = async (e, fn) => {
  if (!fromApp(e)) return { ok: false, error: 'denied' };
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return { ok: false, error: err.message, busy: err instanceof vault.VaultBusyError };
  }
};
ipcMain.handle('vault:status', (e) => vaultCall(e, () => vault.status()));
ipcMain.handle('vault:send', (e, req) =>
  vaultCall(e, async () => {
    if (!req || !req.bytes || req.bytes.byteLength < 44) throw new Error('No audio to send');
    const song = req.songId
      ? await vault.addVersion({ songId: req.songId, bytes: req.bytes, note: req.note, status: req.status, project: req.project, notes: req.notes })
      : await vault.addSong({ bytes: req.bytes, title: req.title, status: req.status, project: req.project, notes: req.notes });
    return { song };
  })
);
ipcMain.handle('vault:read', (e, id) => vaultCall(e, () => vault.readSong(+id)));
ipcMain.handle('vault:open', (e) =>
  vaultCall(e, async () => {
    const exe = vault.vaultExe();
    if (!exe) throw new Error('The Vault app is not installed on this computer.');
    const err = await shell.openPath(exe);
    if (err) throw new Error(err);
    return {};
  })
);
ipcMain.handle('vault:reveal', (e) => vaultCall(e, async () => (shell.openPath(vault.vaultPaths().files), {})));
ipcMain.handle('vault:bridge', (e, req) => vaultCall(e, async () => ({ data: await vault.bridge((req && req.method) || 'GET', req && req.path, req && req.body) })));
ipcMain.handle('vault:bridgeInfo', (e) => vaultCall(e, async () => ({ info: vault.bridgeInfo() })));
ipcMain.handle('vault:launch', (e, opts) =>
  vaultCall(e, async () => {
    const exe = vault.vaultExe();
    if (!exe) { const err = new Error('The Vault app is not installed on this computer.'); err.notInstalled = true; throw err; }
    const { spawn } = require('child_process');
    const args = opts && opts.hidden ? ['--hidden'] : [];
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return {};
  })
);

ipcMain.handle('file:save', async (_e, { data, defaultName, filters, binary }) => {
  const res = await dialog.showSaveDialog({ defaultPath: defaultName, filters });
  if (res.canceled || !res.filePath) return null;
  const buf = binary ? Buffer.from(data) : Buffer.from(data, 'utf8');
  fs.writeFileSync(res.filePath, buf);
  return res.filePath;
});

ipcMain.handle('file:open', async (_e, { filters }) => {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters });
  if (res.canceled || !res.filePaths[0]) return null;
  return { path: res.filePaths[0], data: fs.readFileSync(res.filePaths[0], 'utf8') };
});

if (process.platform === 'win32') app.setAppUserModelId('Session.PrivateStudio'); // taskbar uses our icon

app.whenReady().then(() => {
  // Allow audio capture AND choosing the audio output device (speaker-selection, which
  // AudioContext.setSinkId needs to switch to headphones/another output). Deny everything else.
  const audioOnly = (details) => !details || !details.mediaTypes || details.mediaTypes.every((t) => t === 'audio');
  const allowed = (permission, details) =>
    (permission === 'media' && audioOnly(details)) || permission === 'speaker-selection';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    // On macOS, mic capture also needs the OS-level TCC grant. Trigger/await the system
    // prompt the first time so the page's getUserMedia actually gets audio (otherwise the
    // mic is silently denied with no prompt — "mic not picking up").
    if (permission === 'media' && audioOnly(details) && process.platform === 'darwin' && systemPreferences.askForMediaAccess) {
      systemPreferences.askForMediaAccess('microphone').then((ok) => cb(ok)).catch(() => cb(true));
      return;
    }
    cb(allowed(permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'speaker-selection');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
