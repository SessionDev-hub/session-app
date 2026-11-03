/* Session Mic Mod — shape a plain mic toward the character of a pro studio microphone.
 * It applies a curated EQ "fingerprint" for each mic character (body, low-mid warmth,
 * presence and air), blended by Amount, with your own Proximity and Air on top. Character
 * names are generic (no brands) — they describe the sound, not a specific product. */
(function () {
  const Studio = window.Studio;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isOffline = (ctx) => typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const set = (param, v, ctx) => (isOffline(ctx) ? (param.value = v) : param.setTargetAtTime(v, ctx.currentTime, 0.02));

  // Each character: [lowShelf dB @120, lowMid peak dB @400, presence peak dB @4k, air shelf dB @11k]
  const CHARACTERS = {
    'Studio Condenser': [-1.5, -0.5, 3.0, 4.0],
    'Vintage Tube': [2.5, 1.5, 1.5, 1.0],
    'Broadcast Dynamic': [-3.0, -1.0, 4.0, 1.5],
    'Ribbon (smooth)': [2.0, 0.5, -1.0, -3.0],
    'Modern Bright': [-1.0, -1.0, 3.5, 6.0],
  };
  const NAMES = Object.keys(CHARACTERS);

  Studio.registerPlugin({
    id: 'ss-micmod',
    name: 'Session Mic Mod',
    type: 'effect',
    category: 'Voice',
    color: '#f59e0b',
    description: 'Emulate pro studio mics — shape your mic toward a chosen character',
    params: [
      { id: 'character', name: 'Mic', type: 'select', options: NAMES, default: NAMES[0] },
      { id: 'amount', name: 'Amount', unit: '%', min: 0, max: 100, step: 1, default: 100 },
      { id: 'proximity', name: 'Proximity', unit: 'dB', min: -6, max: 6, step: 0.1, default: 0 },
      { id: 'air', name: 'Air', unit: 'dB', min: -6, max: 6, step: 0.1, default: 0 },
      { id: 'output', name: 'Output', unit: 'dB', min: -12, max: 12, step: 0.1, default: 0 },
    ],
    layout: [{ title: 'Model', params: ['character', 'amount'] }, { title: 'Shape', params: ['proximity', 'air', 'output'] }],
    presets: [
      { name: 'Bright vocal', params: { character: 'Modern Bright', amount: 80, air: 1.5 } },
      { name: 'Warm & intimate', params: { character: 'Vintage Tube', amount: 90, proximity: 2 } },
      { name: 'Podcast / broadcast', params: { character: 'Broadcast Dynamic', amount: 100 } },
      { name: 'Smooth (de-harsh)', params: { character: 'Ribbon (smooth)', amount: 70 } },
    ],
    create(ctx) {
      const input = ctx.createGain();
      const output = ctx.createGain();
      const lowShelf = ctx.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 120;
      const lowMid = ctx.createBiquadFilter(); lowMid.type = 'peaking'; lowMid.frequency.value = 400; lowMid.Q.value = 0.9;
      const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 4000; presence.Q.value = 0.8;
      const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 11000;
      input.connect(lowShelf); lowShelf.connect(lowMid); lowMid.connect(presence); presence.connect(air); air.connect(output);

      const st = { character: NAMES[0], amount: 1, proximity: 0, air: 0, output: 0 };
      const apply = () => {
        const c = CHARACTERS[st.character] || CHARACTERS[NAMES[0]];
        set(lowShelf.gain, c[0] * st.amount + st.proximity, ctx);
        set(lowMid.gain, c[1] * st.amount, ctx);
        set(presence.gain, c[2] * st.amount, ctx);
        set(air.gain, c[3] * st.amount + st.air, ctx);
        set(output.gain, Math.pow(10, st.output / 20), ctx);
      };
      apply();
      return {
        input, output,
        setParam(id, v) {
          if (id === 'character') st.character = NAMES.indexOf(String(v)) >= 0 ? String(v) : (CHARACTERS[v] ? v : NAMES[Math.max(0, Math.min(NAMES.length - 1, parseInt(v) || 0))]);
          else if (id === 'amount') st.amount = clamp(v, 0, 100) / 100;
          else if (id === 'proximity') st.proximity = v;
          else if (id === 'air') st.air = v;
          else if (id === 'output') st.output = v;
          apply();
        },
      };
    },
  });
})();
