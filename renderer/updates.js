/* Update notices.
 * Windows: the installed app downloads updates in the background (electron-updater in main.js);
 *   this listens for those events and shows a banner, with a Restart button when one is ready.
 * Android: there is no store, so we check a small JSON on the GitHub release and, if a newer
 *   build exists, offer a one-tap Download that opens the APK (the person taps Install). */
(function () {
  const S = window.Studio;
  const host = () => window.studioHost || {};

  let bar = null;
  function banner(html, actions) {
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.className = 'update-bar';
    const msg = document.createElement('div');
    msg.className = 'update-msg';
    msg.innerHTML = html;
    bar.appendChild(msg);
    const wrap = document.createElement('div');
    wrap.className = 'update-actions';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.primary ? 'primary' : 'ghost') + ' sm';
      b.textContent = a.label;
      b.onclick = a.onClick;
      wrap.appendChild(b);
    });
    bar.appendChild(wrap);
    document.body.appendChild(bar);
    return bar;
  }
  function dismiss() {
    if (bar) bar.remove();
    bar = null;
  }

  /* ---------- Windows (electron-updater events) ---------- */
  function initWindows() {
    if (!host().onUpdate) return;
    host().onUpdate((m) => {
      if (!m) return;
      if (m.state === 'available') banner('Downloading update ' + (m.version ? 'v' + m.version : '') + '…');
      else if (m.state === 'progress') banner('Downloading update… ' + m.percent + '%');
      else if (m.state === 'ready')
        banner('Update ' + (m.version ? 'v' + m.version + ' ' : '') + 'ready.', [
          { label: 'Later', onClick: dismiss },
          { label: 'Restart & update', primary: true, onClick: () => host().updateInstall() },
        ]);
      else if (m.state === 'none' || m.state === 'error') dismiss();
    });
  }

  /* ---------- Android (JSON feed on the GitHub release) ---------- */
  async function initAndroid() {
    const AND = window.SessionAndroid;
    const target = window.__UPDATE_GITHUB__;
    if (!AND || !target || !target.owner || target.owner === 'YOUR_GITHUB_USERNAME') return;
    let current = 0;
    try {
      current = +AND.versionCode();
    } catch (e) {
      return;
    }
    const feed = 'https://github.com/' + target.owner + '/' + target.repo + '/releases/latest/download/latest.json';
    let j;
    try {
      const r = await fetch(feed, { cache: 'no-store' });
      if (!r.ok) return;
      j = await r.json();
    } catch (e) {
      return; // offline or no release yet
    }
    if (!j || !(+j.versionCode > current) || !j.apk) return;
    banner('Session ' + (j.versionName ? 'v' + j.versionName : 'update') + ' is available.' + (j.notes ? ' <span class="update-notes">' + String(j.notes).replace(/[<>]/g, '') + '</span>' : ''), [
      { label: 'Not now', onClick: dismiss },
      {
        label: 'Download update',
        primary: true,
        onClick: () => {
          try {
            AND.open(j.apk);
          } catch (e) {}
        },
      },
    ]);
  }

  /* ---------- Mac (no auto-update without code signing: notify + open the download) ---------- */
  function newer(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
    return false;
  }
  async function initMac() {
    // desktop Electron app only (onUpdate is exposed by the Electron preload, not the web host)
    if (!host().onUpdate || !host().openExternal) return;
    if (!/Macintosh|Mac OS X/i.test(navigator.userAgent)) return; // Windows handles itself via events
    const target = window.__UPDATE_GITHUB__;
    const cur = window.__SESSION_VERSION__ || '0.0.0';
    if (!target || !target.owner || target.owner === 'YOUR_GITHUB_USERNAME') return;
    const base = 'https://github.com/' + target.owner + '/' + target.repo + '/releases';
    let ver = '';
    try {
      // latest-mac.yml is published by electron-builder for the mac zip target; it names the newest version
      const r = await fetch(base + '/latest/download/latest-mac.yml', { cache: 'no-store' });
      if (!r.ok) return;
      const m = (await r.text()).match(/version:\s*([0-9][0-9.]*)/i);
      ver = m && m[1];
    } catch (e) { return; } // offline or no mac release yet
    if (!ver || !newer(ver, cur)) return;
    banner('Session v' + ver + ' is available for Mac.', [
      { label: 'Not now', onClick: dismiss },
      { label: 'Download', primary: true, onClick: () => { try { host().openExternal(base + '/latest'); } catch (e) {} dismiss(); } },
    ]);
  }

  S.updates = {
    init() {
      initWindows();
      initAndroid();
      initMac();
    },
  };
})();
