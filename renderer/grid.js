/* Snap grid: musical (bars & beats from the song's BPM) or plain seconds. Settings live in the session. */
(function () {
  const S = window.Studio;
  const G = (S.grid = {});

  /** Bars mode divisions, as fractions of a whole note (1/4 = one beat in 4/4). */
  G.BAR_DIVS = [
    { id: 'bar', label: 'Bar' },
    { id: '1/2', label: '1/2' },
    { id: '1/4', label: '1/4' },
    { id: '1/8', label: '1/8' },
    { id: '1/16', label: '1/16' },
    { id: '1/32', label: '1/32' },
  ];
  G.TIME_DIVS = [
    { id: '1', label: '1 s' },
    { id: '0.5', label: '0.5 s' },
    { id: '0.25', label: '0.25 s' },
    { id: '0.1', label: '0.1 s' },
    { id: '0.05', label: '50 ms' },
    { id: '0.01', label: '10 ms' },
  ];

  G.defaults = () => ({ mode: 'bars', div: '1/4', timeDiv: '0.25', snap: true });

  /** Make sure a project has tempo + grid settings (older sessions don't). */
  G.ensure = (p = S.project) => {
    if (!(p.bpm >= 20 && p.bpm <= 400)) p.bpm = 120;
    if (!(p.beatsPerBar >= 1 && p.beatsPerBar <= 16)) p.beatsPerBar = 4;
    p.grid = Object.assign(G.defaults(), p.grid || {});
    if (!['bars', 'time'].includes(p.grid.mode)) p.grid.mode = 'bars';
    if (!G.BAR_DIVS.some((d) => d.id === p.grid.div)) p.grid.div = '1/4';
    if (!G.TIME_DIVS.some((d) => d.id === p.grid.timeDiv)) p.grid.timeDiv = '0.25';
    return p;
  };

  G.beat = (p = S.project) => 60 / G.ensure(p).bpm;
  G.bar = (p = S.project) => G.beat(p) * p.beatsPerBar;

  /** Seconds between snap points for the current settings. */
  G.step = (p = S.project) => {
    const g = G.ensure(p).grid;
    if (g.mode === 'time') return +g.timeDiv;
    if (g.div === 'bar') return G.bar(p);
    const den = +g.div.split('/')[1];
    return G.beat(p) * (4 / den);
  };

  G.enabled = (p = S.project) => !!G.ensure(p).grid.snap;

  /** Nearest grid line to t (ignores the snap switch). */
  G.round = (t, p = S.project) => {
    const st = G.step(p);
    return Math.max(0, Math.round(t / st) * st);
  };

  /**
   * Snap a time. `extra` = additional magnet points (clip edges, playhead) that win when within `px` pixels.
   * Returns t unchanged when snapping is off or `free` (Alt held) is true.
   */
  G.snap = (t, { free = false, extra = [], pps = 60, px = 8 } = {}) => {
    if (free || !G.enabled()) return Math.max(0, t);
    let best = G.round(t);
    let bestD = Math.abs(best - t);
    const reach = px / pps;
    for (const e of extra) {
      const d = Math.abs(e - t);
      if (d < reach && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return Math.max(0, best);
  };

  /** "bar.beat.tick" position text, 1-based like every DAW. */
  G.bbt = (t, p = S.project) => {
    const beat = G.beat(p);
    const bars = Math.floor(t / G.bar(p));
    const inBar = t - bars * G.bar(p);
    const b = Math.floor(inBar / beat + 1e-9);
    const tick = Math.floor(((inBar - b * beat) / beat) * 100);
    return bars + 1 + '.' + (b + 1) + '.' + String(Math.max(0, tick)).padStart(2, '0');
  };
})();
