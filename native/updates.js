/* Windows auto-update via electron-updater. Reads its feed from app-update.yml,
 * which electron-builder generates from "build.publish" in package.json.
 * Events are forwarded to the renderer, which shows a small banner. */
let autoUpdater = null;

function initAutoUpdate(win, isPackaged) {
  if (!isPackaged || process.platform !== 'win32') return; // only the installed Windows app has a feed
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    return; // electron-updater not bundled (e.g. source run)
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  const send = (m) => win && !win.isDestroyed() && win.webContents.send('update:event', m);
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i && i.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'progress', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i && i.version }));
  autoUpdater.on('error', (e) => send({ state: 'error', message: String((e && e.message) || e) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 4000); // let the window settle first
  setInterval(check, 6 * 60 * 60 * 1000); // and every 6 hours
}

function checkNow() {
  if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {});
}
function quitAndInstall() {
  if (autoUpdater) autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdate, checkNow, quitAndInstall };
