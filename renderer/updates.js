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

  S.updates = {
    init() {
      initWindows();
      initAndroid();
    },
  };
})();
