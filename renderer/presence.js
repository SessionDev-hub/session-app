/* Discord Rich Presence — shows "Playing Session" on the artist's Discord while the app is open.
 * Driven entirely from local state (status, whether a track is playing, whether a live session is
 * running); no bot, no account data leaves the app. Can be turned off in Settings (privacy).
 * The heavy lifting (talking to Discord) is in the main process; this just decides what to show. */
(function () {
  const S = window.Studio;
  const P = (S.presence = {});
  const host = () => window.studioHost || {};
  const KEY = 'ps.richPresence';
  const START = Date.now();

  const supported = () => typeof host().setPresence === 'function';
  P.enabled = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } };
  P.setEnabled = (on) => {
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    if (on) P.update(); else clear();
    return on;
  };

  let last = ''; // signature of the activity we last pushed, so we don't spam identical updates
  function clear() { last = 'off'; if (supported()) try { host().clearPresence(); } catch (e) {} }

  /** Build the activity from current state. */
  function build() {
    const acct = (S.account && S.account.get && S.account.get()) || null;
    const prof = (acct && acct.profile) || {};
    const playing = !!(S.engine && S.engine.playing);
    const live = !!(S.collab && S.collab.roomId && S.collab.roomId());

    // details = the headline line; state = the second line
    let details, state;
    if (live) { details = 'In a live session'; state = 'Collaborating in real time'; }
    else if (playing) { details = prof.status || 'Working on a track'; state = 'Playing it back'; }
    else { details = prof.status || 'Producing in Session'; state = 'In the studio'; }

    return {
      details: details,
      state: state,
      startTimestamp: Math.floor(START / 1000),
      largeImageKey: 'session',          // optional art uploaded on the Discord app; absent = no image, harmless
      largeImageText: 'Session — record, create and share',
      smallImageKey: live ? 'live' : (playing ? 'play' : ''),
      smallImageText: live ? 'Live session' : (playing ? 'Playing' : ''),
    };
  }

  P.update = () => {
    if (!supported() || !P.enabled()) return;
    const a = build();
    const sig = JSON.stringify(a);
    if (sig === last) return; // nothing changed
    last = sig;
    try { host().setPresence(a); } catch (e) {}
  };

  P.init = () => {
    if (!supported()) return;
    if (!P.enabled()) { clear(); return; }
    P.update();
    // react to the things that change what we show
    try { S.on && S.on('transport', () => P.update()); } catch (e) {}
    try { S.on && S.on('account-changed', () => P.update()); } catch (e) {}
    try { S.on && S.on('collab-changed', () => P.update()); } catch (e) {}
    // a slow heartbeat keeps the elapsed time fresh and recovers if Discord was opened later
    setInterval(() => P.update(), 60000);
  };
})();
