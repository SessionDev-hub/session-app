/* Windows auto-update via electron-updater. Reads its feed from app-update.yml,
 * which electron-builder generates from "build.publish" in package.json.
 * Events are forwarded to the renderer, which shows a small banner.
 * Auto-download/-install can be turned off from Settings (setAuto); the manual
 * "Check for updates" button always downloads what it finds. */
let autoUpdater = null;
let autoEnabled = true;  // background auto-download + install-on-quit
let manual = false;      // true while a user-initiated check is in flight

function check(isManual) {
  if (!autoUpdater) return;
  manual = !!isManual;
  autoUpdater.checkForUpdates().catch(() => {});
}

function initAutoUpdate(win, isPackaged) {
  if (!isPackaged || process.platform !== 'win32') return; // only the installed Windows app has a feed
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    return; // electron-updater not bundled (e.g. source run)
  }
  autoUpdater.autoDownload = autoEnabled;
  autoUpdater.autoInstallOnAppQuit = autoEnabled;
  autoUpdater.logger = null;
  const send = (m) => win && !win.isDestroyed() && win.webContents.send('update:event', m);
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => {
    send({ state: 'available', version: i && i.version });
    // If auto-download is off but the user asked (manual check), fetch it anyway so the button works.
    if (!autoUpdater.autoDownload && manual) autoUpdater.downloadUpdate().catch(() => {});
  });
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'progress', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i && i.version }));
  autoUpdater.on('error', (e) => send({ state: 'error', message: String((e && e.message) || e) }));
  if (autoEnabled) setTimeout(() => check(false), 4000); // let the window settle first
  setInterval(() => { if (autoEnabled) check(false); }, 6 * 60 * 60 * 1000); // every 6 hours
}

/** Turn background auto-updates on/off. Manual checks still work either way. */
function setAuto(on) {
  autoEnabled = !!on;
  if (autoUpdater) {
    autoUpdater.autoDownload = autoEnabled;
    autoUpdater.autoInstallOnAppQuit = autoEnabled;
    if (autoEnabled) check(false); // catch up right away when switched on
  }
}

function checkNow() { check(true); }      // manual: always downloads what it finds
function quitAndInstall() { if (autoUpdater) autoUpdater.quitAndInstall(); }

module.exports = { initAutoUpdate, checkNow, quitAndInstall, setAuto };
