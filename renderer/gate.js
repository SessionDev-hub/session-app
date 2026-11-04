/* Beta access gate — Session requires signing in with Discord and holding the Beta Tester role.
 * Deterrent, not DRM: it ties use to being in the server with the role. Configured in updates.config.json
 * (discord.guildId, discord.betaRoleId, discord.gate). On desktop only; skipped when unconfigured. */
(function () {
  const S = window.Studio;
  const G = (S.gate = {});
  const PASS = 'ps.beta';
  const OFFLINE_GRACE = 7 * 864e5; // 7 days: usable offline after a good online check
  const cfg = () => window.__DISCORD__ || {};
  const host = () => window.studioHost || {};

  // Gate only when it's configured AND we can actually sign in (desktop with the login bridge).
  // The Beta Tester check runs on desktop only. The Android APK (and plain browser) cannot do the
  // Discord sign-in, so gating there left people stuck on the Discord screen; the APK is only handed
  // to testers directly, so it opens straight in.
  const mobile = () => host().platform === 'android' || host().platform === 'web';
  const active = () => !mobile() && cfg().gate !== false && !!cfg().clientId && typeof host().discordLogin === 'function';

  const readCache = () => { try { return JSON.parse(localStorage.getItem(PASS)); } catch (e) { return null; } };
  const savePass = (id) => { try { localStorage.setItem(PASS, JSON.stringify({ ts: Date.now(), id, v: 1 })); } catch (e) {} };
  const clearPass = () => { try { localStorage.removeItem(PASS); } catch (e) {} };
  const openLink = (url) => (host().openExternal ? host().openExternal(url) : window.open(url, '_blank'));
  const icon = (n, s) => (S.ui ? S.ui.icon(n, s) : '');

  let overlay = null, keyTrap = null;

  function mount() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'beta-gate';
    overlay.innerHTML = '<div class="bg-card"></div>';
    document.body.appendChild(overlay);
    // block keyboard shortcuts behind the gate
    keyTrap = (e) => { if (overlay) { e.stopPropagation(); } };
    window.addEventListener('keydown', keyTrap, true);
    // if a song somehow started, keep it silent while gated
    try { S.engine && S.engine.stop && S.engine.stop(); } catch (e) {}
  }
  function unmount() {
    if (keyTrap) { window.removeEventListener('keydown', keyTrap, true); keyTrap = null; }
    if (overlay) { overlay.remove(); overlay = null; }
  }
  const card = () => overlay && overlay.querySelector('.bg-card');

  function render(state, data) {
    mount();
    const c = card();
    if (!c) return;
    const brand = '<div class="bg-brand">' + icon('headphones', 22) + '<span>Session</span><em>Beta</em></div>';
    if (state === 'verifying') {
      c.innerHTML = brand + '<div class="bg-spin"></div><h2>Checking your Beta access…</h2><p>Signing in with Discord.</p>';
    } else if (state === 'signin') {
      c.innerHTML = brand +
        '<h2>Beta testers only</h2><p>Sign in with Discord to use Session. You’ll need the <b>Beta Tester</b> role in our server.</p>' +
        '<div class="bg-row"><button class="btn primary bg-go">' + icon('user', 15) + 'Continue with Discord</button></div>' +
        (data && data.error ? '<p class="bg-err">' + String(data.error).replace(/[<>]/g, '') + '</p>' : '');
      c.querySelector('.bg-go').onclick = verify;
    } else if (state === 'norole') {
      c.innerHTML = brand +
        '<h2>You’re signed in, but not a Beta Tester yet</h2>' +
        '<p>' + (data && data.name ? 'Hi ' + String(data.name).replace(/[<>]/g, '') + ' — ' : '') +
        'your Discord account doesn’t have the <b>Beta Tester</b> role' + (data && data.inGuild === false ? ', and you’re not in the server yet' : '') + '. Join the server and ask for access, then check again.</p>' +
        '<div class="bg-row"><button class="btn accent bg-join">' + icon('vault', 15) + 'Join the server</button>' +
        '<button class="btn primary bg-recheck">I have the role — check again</button></div>' +
        '<div class="bg-row"><button class="btn ghost bg-switch">Use a different account</button></div>';
      c.querySelector('.bg-join').onclick = () => openLink(cfg().invite || 'https://discord.gg/HbkNrPAAm');
      c.querySelector('.bg-recheck').onclick = verify;
      c.querySelector('.bg-switch').onclick = () => { clearPass(); verify(); };
    } else if (state === 'offline') {
      c.innerHTML = brand + '<h2>Connect to the internet</h2><p>Session needs to verify your Beta access with Discord. Reconnect and try again.</p>' +
        '<div class="bg-row"><button class="btn primary bg-retry">Try again</button></div>';
      c.querySelector('.bg-retry').onclick = start;
    }
  }

  async function verify() {
    render('verifying');
    let r;
    try {
      r = await host().discordLogin({ clientId: cfg().clientId, redirect: cfg().redirect, guildId: cfg().guildId });
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    }
    if (!r || !r.ok) {
      if (r && r.error === 'cancelled') return render('signin', { error: 'Sign-in was cancelled. You need to sign in to use Session.' });
      return render('signin', { error: (r && r.error) || 'Sign-in failed. Please try again.' });
    }
    const roleId = cfg().betaRoleId;
    const hasRole = !roleId || (r.inGuild && Array.isArray(r.roles) && r.roles.indexOf(roleId) >= 0);
    if (!hasRole) return render('norole', { name: r.profile && r.profile.name, inGuild: r.inGuild });
    // passed
    savePass(r.profile && r.profile.id);
    setAuth(r.token, r.profile);
    try { if (S.account && S.account.set) S.account.set(r.profile); } catch (e) {}
    unmount();
  }

  /* In-memory Discord auth for the session (used by collab to sign in to the realtime
   * service). The token is a credential: kept only in memory, never written to disk. */
  const auth = (S.auth = S.auth || { token: null, profile: null });
  function setAuth(token, profile) { if (token) auth.token = token; if (profile) auth.profile = profile; }
  // Get a Discord token for the realtime auth endpoint. Reuses the one from launch;
  // if we don't have it (e.g. offline-cached pass), does a quiet re-login to fetch one.
  G.getToken = async () => {
    if (auth.token) return auth.token;
    if (typeof host().discordLogin !== 'function') return null;
    try {
      const r = await host().discordLogin({ clientId: cfg().clientId, redirect: cfg().redirect, guildId: cfg().guildId });
      if (r && r.ok) { setAuth(r.token, r.profile); return r.token || null; }
    } catch (e) {}
    return null;
  };

  /* Silent re-check for a RETURNING user: they already passed once, so let them straight into the
   * app and confirm the role in the background. Only re-gate if Discord explicitly says the role is
   * gone — a network hiccup or a silent-login that needs interaction leaves them in on their pass. */
  async function verifyBackground() {
    let r;
    try { r = await host().discordLogin({ clientId: cfg().clientId, redirect: cfg().redirect, guildId: cfg().guildId }); }
    catch (e) { return; } // transient — keep them in
    if (!r || !r.ok) return; // couldn't confirm silently — keep them in on the cached pass
    const roleId = cfg().betaRoleId;
    const hasRole = !roleId || (r.inGuild && Array.isArray(r.roles) && r.roles.indexOf(roleId) >= 0);
    if (!hasRole) { clearPass(); mount(); return render('norole', { name: r.profile && r.profile.name, inGuild: r.inGuild }); }
    savePass(r.profile && r.profile.id);
    setAuth(r.token, r.profile);
    try { if (S.account && S.account.set) S.account.set(r.profile); } catch (e) {}
  }

  function start() {
    if (!active()) return; // not configured, or not a platform we can gate — let the app run
    const c = readCache();
    // Returning user (passed before): open the app instantly with NO screen, verify silently in the
    // background. First-ever run has no cached pass, so it does the one-time Discord sign-in.
    if (c) {
      if (navigator.onLine) { verifyBackground(); return; } // silent re-check, no screen
      if (Date.now() - c.ts < OFFLINE_GRACE) return;        // trusted recently — allow offline, no screen
      mount(); return render('offline');                    // offline too long — reconnect to re-verify
    }
    mount();
    render('verifying');
    if (!navigator.onLine) return render('offline');
    verify(); // first run, online: the one-time Discord authorization
  }

  G.init = start;
  G.isActive = active;

  // Run as early as possible so the app never shows before access is confirmed.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
