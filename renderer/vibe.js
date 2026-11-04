/* Vocal Vibe — type what you want ("make me sound like Carti", "hard tune in D minor, wetter")
 * and it builds the whole vocal chain on a track out of Session's own effects.
 * Fully offline: a keyword/style engine, no AI service, works on desktop and Android.
 * Follow-ups ("more reverb", "less autotune", "brighter") tweak the chain it built last time. */
(function () {
  const S = window.Studio;
  const V = (S.vibe = {});

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- styles ---------- */
  // tune: retune ms (0 = hard snap); levels are 0..3 (reverb 0..4)
  const T = (retune, strength = 100) => ({ retune, strength });
  const STYLES = [
    { id: 'rage', label: 'Rage (Carti / Ken Carson)', words: ['carti', 'playboi', 'ken carson', 'destroy lonely', 'opium', 'rage', 'homixide', 'yeat', 'whole lotta red', 'wlr'],
      r: { tune: T(0), eq: { hp: 120, mud: -3, presence: 3, air: 4 }, comp: 3, deess: 2, sat: 2, chorus: 1, delay: { amt: 1, sync: '1/8' }, reverb: { amt: 1, type: 'room' } } },
    { id: 'travis', label: 'Dark & wet (Travis)', words: ['travis', 'la flame', 'utopia', 'astroworld', 'cactus jack'],
      r: { tune: T(4), eq: { hp: 110, low: 1, presence: 2, air: 2 }, comp: 2, deess: 2, sat: 1, chorus: 1, delay: { amt: 2, sync: '1/4 dotted' }, reverb: { amt: 3, type: 'hall' } } },
    { id: 'trap', label: 'Trap (Future / Thug / Gunna)', words: ['future', 'young thug', 'thugger', 'gunna', 'lil baby', '21 savage', 'savage', 'durk', 'youngboy', 'nba', 'trap', 'lil tecca', 'rod wave'],
      r: { tune: T(6), eq: { hp: 100, mud: -2, presence: 3, air: 2 }, comp: 2, deess: 2, sat: 1, delay: { amt: 1, sync: '1/8 dotted' }, reverb: { amt: 1, type: 'plate' } } },
    { id: 'melodic', label: 'Melodic emo (Juice WRLD)', words: ['juice', 'wrld', 'emo', 'xxx', 'xxxtentacion', 'laroi', 'iann dior', 'melodic', 'sad', 'lil peep', 'peep'],
      r: { tune: T(12), eq: { hp: 100, presence: 2, air: 3 }, comp: 2, deess: 2, chorus: 1, delay: { amt: 2, sync: '1/8 dotted' }, reverb: { amt: 2, type: 'hall' } } },
    { id: 'rnb', label: 'Smooth R&B (Drake / PND)', words: ['drake', 'pnd', 'partynextdoor', 'party next door', 'bryson', 'tiller', 'weeknd', 'sza', 'brent', 'r&b', 'rnb', 'r and b', 'smooth', 'chris brown', 'summer walker'],
      r: { tune: T(30, 90), eq: { hp: 90, low: 1, mud: -2, presence: 1, air: 3 }, comp: 2, deess: 2, chorus: 1, delay: { amt: 1, sync: '1/4' }, reverb: { amt: 2, type: 'plate' } } },
    { id: 'uzi', label: 'Bright & bouncy (Uzi)', words: ['uzi', 'lil uzi', 'eternal atake'],
      r: { tune: T(2), eq: { hp: 110, presence: 3, air: 4 }, comp: 2, deess: 2, sat: 1, chorus: 2, delay: { amt: 1, sync: '1/16' }, reverb: { amt: 1, type: 'plate' } } },
    { id: 'robot', label: 'Robot / 808s', words: ['robot', 'robotic', 'vocoder', '808s', 'heartbreak', 'kanye', 'ye ', 't-pain', 'tpain', 't pain'],
      r: { tune: T(0), eq: { hp: 120, presence: 2, air: 2 }, comp: 2, deess: 1, chorus: 2, delay: { amt: 1, sync: '1/4' }, reverb: { amt: 2, type: 'hall' } } },
    { id: 'pop', label: 'Clean pop / radio', words: ['pop', 'clean', 'radio ready', 'polished', 'professional', 'ariana', 'billie', 'taylor', 'bieber', 'mainstream', 'studio quality'],
      r: { tune: T(40, 80), eq: { hp: 90, mud: -2, presence: 2, air: 3 }, comp: 2, deess: 2, delay: { amt: 1, sync: '1/4' }, reverb: { amt: 1, type: 'plate' } } },
    { id: 'drill', label: 'Drill', words: ['drill', 'pop smoke', 'central cee', 'sheff', 'fivio', 'kay flock', 'chief keef', 'keef'],
      r: { tune: T(25, 70), eq: { hp: 120, low: 2, mud: -2, presence: 3 }, comp: 3, deess: 2, sat: 2, delay: { amt: 1, sync: '1/8' }, reverb: { amt: 1, type: 'room' } } },
    { id: 'rap', label: 'Raw rap (no tune)', words: ['kendrick', 'cole', 'eminem', 'boom bap', 'lyrical', 'hip hop', 'hip-hop', 'rap vocal', 'rapping', 'nas', 'jay-z'],
      r: { tune: null, eq: { hp: 100, mud: -2, presence: 3, air: 1 }, comp: 3, deess: 2, sat: 1, reverb: { amt: 1, type: 'room' } } },
    { id: 'phone', label: 'Lo-fi phone voice', words: ['lofi', 'lo-fi', 'lo fi', 'phone', 'telephone', 'radio voice', 'walkie', 'old school', 'vintage', 'megaphone', 'intro voice'],
      r: { tune: null, phone: true, comp: 2, sat: 2, reverb: { amt: 1, type: 'room' } } },
    { id: 'adlibs', label: 'Ad-libs / backgrounds', words: ['adlib', 'ad-lib', 'ad lib', 'adlibs', 'background vocal', 'backgrounds', 'bgv', 'doubles', 'stacks', 'harmonies', 'harmony'],
      r: { tune: T(8), eq: { hp: 200, presence: 1, air: 3 }, comp: 2, deess: 2, chorus: 2, delay: { amt: 2, sync: '1/8' }, reverb: { amt: 2, type: 'hall' } } },
    { id: 'dreamy', label: 'Dreamy / spacey', words: ['dreamy', 'ethereal', 'spacey', 'spacy', 'ambient', 'floaty', 'heavenly', 'angelic', 'cloud'],
      r: { tune: T(20, 90), eq: { hp: 120, mud: -2, air: 4 }, comp: 2, deess: 2, chorus: 2, delay: { amt: 2, sync: '1/4 dotted' }, reverb: { amt: 4, type: 'hall' } } },
    { id: 'podcast', label: 'Talking / podcast', words: ['podcast', 'talking', 'voice over', 'voiceover', 'voice-over', 'spoken', 'speech', 'stream', 'narration', 'youtube voice'],
      r: { tune: null, gate: true, mic: 'Broadcast Dynamic', eq: { hp: 90, mud: -2, presence: 2, air: 1 }, comp: 3, deess: 2 } },
  ];
  const BASE = { tune: T(20, 90), eq: { hp: 90, mud: -2, presence: 2, air: 2 }, comp: 2, deess: 2, reverb: { amt: 1, type: 'plate' } };
  V.styles = STYLES;

  const blank = () => ({ tune: null, eq: { hp: 80, low: 0, mud: 0, presence: 0, air: 0 }, comp: 0, deess: 0, sat: 0, dirty: false, chorus: 0, delay: { amt: 0, sync: '1/4' }, reverb: { amt: 0, type: 'plate' }, phone: false, gate: false, mic: null, key: null, style: null });
  const fromStyle = (r) => {
    const o = blank();
    const c = JSON.parse(JSON.stringify(r));
    Object.assign(o, c, { eq: Object.assign(o.eq, c.eq || {}), delay: Object.assign(o.delay, c.delay || {}), reverb: Object.assign(o.reverb, c.reverb || {}) });
    return o;
  };

  /* ---------- understanding the text ---------- */
  const has = (t, words) => words.some((w) => (w.endsWith(' ') ? (' ' + t + ' ').includes(' ' + w) : new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(t)));

  /** Find a key like "in D minor", "key of F#", "Am", "C# major", "Bb min". Returns { key, scale } or null. */
  function findKey(raw) {
    const fix = (n, acc) => {
      let i = NOTES.indexOf(n.toUpperCase());
      if (acc && /^(#|♯|sharp)$/i.test(acc)) i += 1;
      if (acc && /^(b|♭|flat)$/i.test(acc)) i += 11;
      return NOTES[i % 12];
    };
    const scaleOf = (m, t) => (/pent/i.test(t) ? 'Minor pentatonic' : m && /^(m|min|minor)$/i.test(m) ? 'Minor' : 'Major');
    // 1) "in/key of/to D# minor"
    let m = raw.match(/\b(?:in|key(?:\s+of)?|to)\s+([a-gA-G])(?:\s*(#|♯|sharp|♭|flat|b(?![a-z])))?(?:\s*(major|minor|maj|min|m(?![a-z])))?(?![a-z0-9#♯♭])/i);
    // a bare lowercase letter ("in a bit", "to be") is just a word, not a key
    if (m && !m[2] && !m[3] && m[1] !== m[1].toUpperCase()) m = null;
    // 2) "D minor", "F# maj" anywhere
    if (!m) m = raw.match(/\b([a-gA-G])\s*(#|♯|sharp|b|♭|flat)?\s+(major|minor|maj|min)\b/i);
    // 3) "Am", "F#m", "Bbm" — capital letter only, so "am"/"bm" in normal words don't count
    if (!m) m = raw.match(/(?:^|\s)([A-G])(#|♯|b)?(m)(?=\s|$|[,.!])/);
    if (!m) return null;
    return { key: fix(m[1], m[2]), scale: scaleOf(m[3], raw) };
  }

  /** Turn text into a recipe. `prev` is the track's last recipe (for follow-ups). */
  V.understand = (text, prev, projectKey) => {
    const raw = String(text || '').trim();
    const t = ' ' + raw.toLowerCase().replace(/[’']/g, '').replace(/auto[\s-]?tune/g, 'autotune').replace(/\s+/g, ' ') + ' ';
    const said = []; // what we understood, in plain words
    if (!raw) return { error: 'Type what you want first — e.g. “make me sound like Travis, in F minor”.' };
    if (has(t, ['remove everything', 'no effects', 'clear everything', 'remove all', 'clear chain', 'dry vocal', 'no fx'])) return { clear: true, said: ['Removed every effect from the track'] };

    const restart = has(t, ['start over', 'reset', 'from scratch', 'new chain', 'different vibe']);
    const style = STYLES.find((s) => has(t, s.words));
    let r;
    if (style) { r = fromStyle(style.r); r.style = style.id; said.push(style.label + ' style'); }
    else if (prev && !restart) r = fromStyle(prev);
    else { r = fromStyle(BASE); r.style = 'base'; }

    // key
    const k = findKey(raw);
    if (k) { r.key = k; said.push('key ' + k.key + ' ' + k.scale.toLowerCase()); }
    else if (has(t, ['chromatic', 'any key', 'no key', 'every note'])) { r.key = { key: 'C', scale: 'Chromatic' }; said.push('chromatic (every note)'); }
    else if (has(t, ['in key', 'song key', 'beat key', 'project key', 'match the beat', 'match the key', 'detect key', 'same key'])) {
      if (projectKey) { r.key = { key: NOTES[projectKey.tonic], scale: projectKey.mode === 'minor' ? 'Minor' : 'Major' }; said.push('song key ' + r.key.key + ' ' + r.key.scale.toLowerCase()); }
      else said.push('no song key found yet — using chromatic (set it in Tempo & Key)');
    }

    // tuning amount
    const noTune = has(t, ['no autotune', 'no auto tune', 'no auto-tune', 'without autotune', 'without auto tune', 'no tune', 'untuned', 'raw vocal', 'turn off autotune', 'remove autotune']);
    if (noTune) { r.tune = null; said.push('no Auto-Tune'); }
    else {
      const hard = has(t, ['hard tune', 'hard autotune', 'hard auto tune', 'heavy tune', 'heavy autotune', 'max tune', 'snappy', 'full tune', 'hella autotune', 'crazy autotune', 'strong tune', 'hard snap']);
      const natural = has(t, ['natural', 'subtle', 'light tune', 'light autotune', 'soft tune', 'pitch correction', 'fix my pitch', 'fix pitch', 'slight', 'little autotune', 'bit of autotune', 'barely']);
      const more = has(t, ['more autotune', 'more auto tune', 'more tune', 'harder tune', 'tune harder', 'more pitch']);
      const less = has(t, ['less autotune', 'less auto tune', 'less tune', 'softer tune', 'tune less', 'less pitch', 'less robotic', 'less robot']);
      const wantsTune = has(t, ['autotune', 'auto tune', 'auto-tune', 'tuned', 'tune me', 'tune it', 'tune my']);
      if (hard) { r.tune = T(0); said.push('hard Auto-Tune'); }
      else if (natural) { r.tune = T(45, 85); said.push('natural pitch correction'); }
      else if (more) { r.tune = r.tune ? T(Math.round(r.tune.retune * 0.4), 100) : T(10); said.push('more Auto-Tune'); }
      else if (less) { if (r.tune) { r.tune = T(Math.min(120, r.tune.retune + 30), Math.max(55, r.tune.strength - 15)); said.push('less Auto-Tune'); } }
      else if (wantsTune && !r.tune) { r.tune = T(10); said.push('Auto-Tune on'); }
      else if (k && !r.tune) r.tune = T(15);
    }

    // tweaks (work on their own or on top of a style)
    const up = (o, key, n, max) => (o[key] = clamp((o[key] || 0) + n, 0, max));
    if (has(t, ['no reverb', 'remove reverb', 'without reverb', 'dry'])) { r.reverb.amt = 0; said.push('no reverb'); }
    else if (has(t, ['less reverb', 'less wet', 'drier', 'tighter', 'closer'])) { up(r.reverb, 'amt', -1, 4); said.push('less reverb'); }
    else if (has(t, ['wetter', 'wet', 'more reverb', 'reverb', 'spacious', 'more space', 'roomy', 'echoey', 'big', 'huge', 'stadium', 'hall', 'cathedral', 'church'])) {
      up(r.reverb, 'amt', has(t, ['huge', 'stadium', 'cathedral', 'church']) ? 2 : 1, 4);
      if (has(t, ['big', 'huge', 'stadium', 'hall', 'cathedral', 'church'])) r.reverb.type = 'hall';
      said.push('more reverb');
    }
    if (has(t, ['no delay', 'no echo', 'remove delay', 'without delay'])) { r.delay.amt = 0; said.push('no delay'); }
    else if (has(t, ['less delay', 'less echo'])) { up(r.delay, 'amt', -1, 3); said.push('less delay'); }
    else if (has(t, ['slapback', 'slap back', 'slap delay', 'slap'])) { r.delay = { amt: Math.max(1, r.delay.amt), sync: 'slap' }; said.push('slapback delay'); }
    else if (has(t, ['more delay', 'more echo', 'delay', 'echo', 'echoes', 'repeats', 'throws'])) { up(r.delay, 'amt', 1, 3); said.push('more delay'); }
    if (has(t, ['brighter', 'bright', 'crisp', 'crispy', 'airy', 'air', 'clearer', 'clear', 'shine', 'sparkle', 'expensive'])) { up(r.eq, 'air', 2, 6); up(r.eq, 'presence', 1, 5); said.push('brighter'); }
    if (has(t, ['darker', 'dark', 'warmer', 'warm', 'muffled', 'mellow', 'less bright', 'less harsh', 'harsh'])) {
      r.eq.air = clamp((r.eq.air || 0) - 3, -6, 6); r.eq.low = clamp((r.eq.low || 0) + 1, 0, 4);
      if (has(t, ['harsh', 'less harsh'])) { r.eq.presence = clamp((r.eq.presence || 0) - 1, -3, 5); up(r, 'deess', 1, 3); }
      said.push(has(t, ['harsh', 'less harsh']) ? 'less harsh' : 'darker / warmer');
    }
    if (has(t, ['thin', 'muddy', 'boomy', 'boxy', 'less bass', 'less low'])) { r.eq.hp = Math.min(220, (r.eq.hp || 80) + 40); r.eq.mud = clamp((r.eq.mud || 0) - 2, -6, 0); said.push('cleaner low end'); }
    if (has(t, ['fuller', 'thicker', 'thick', 'deeper', 'more body', 'more bass'])) { r.eq.hp = Math.max(60, (r.eq.hp || 80) - 30); r.eq.low = clamp((r.eq.low || 0) + 2, 0, 4); said.push('fuller'); }
    if (has(t, ['louder', 'punchy', 'punchier', 'punch', 'aggressive', 'in your face', 'upfront', 'up front', 'hard hitting', 'stand out', 'cut through', 'on top of the beat', 'more compression', 'compressed'])) { up(r, 'comp', 1, 3); up(r, 'sat', 1, 3); up(r.eq, 'presence', 1, 5); said.push('punchier, more upfront'); }
    if (has(t, ['softer', 'gentle', 'chill', 'relaxed', 'less compression', 'more dynamic'])) { up(r, 'comp', -1, 3); up(r, 'sat', -1, 3); said.push('softer'); }
    if (has(t, ['distorted', 'distortion', 'gritty', 'grit', 'dirty', 'crunchy', 'crunch', 'fuzzy', 'blown out', 'blown', 'overdriven', 'scream'])) { r.dirty = true; said.push('gritty distortion'); }
    if (has(t, ['clean it up', 'no distortion', 'less distortion', 'less grit'])) { r.dirty = false; up(r, 'sat', -1, 3); }
    if (has(t, ['wide', 'wider', 'stereo', 'doubled', 'double', 'doubler', 'thick vocal', 'chorus', 'stacked'])) { up(r, 'chorus', 1, 3); said.push('wider / doubled'); }
    if (has(t, ['mono', 'narrow', 'less wide', 'centered', 'no chorus'])) { r.chorus = 0; said.push('centered'); }
    if (has(t, ['noise', 'hiss', 'background noise', 'fan', 'room noise', 'noisy', 'hum', 'gate'])) { r.gate = true; said.push('noise gate'); }
    if (has(t, ['sibilance', 'sibilant', 'esses', 'harsh s', 'ssss', 'de-ess', 'deess', 'de ess', 'lisp'])) { up(r, 'deess', 1, 3); said.push('tamed S sounds'); }

    // tuning but no key named: follow the song's key when Session knows it (Tempo & Key)
    if (r.tune && !r.key && projectKey && projectKey.tonic != null) { r.key = { key: NOTES[projectKey.tonic], scale: projectKey.mode === 'minor' ? 'Minor' : 'Major' }; said.push('tuned to the song key (' + r.key.key + ' ' + r.key.scale.toLowerCase() + ')'); }
    if (!style && !said.length && !prev) said.push('a clean, polished vocal chain (tip: name an artist, a key, or a vibe)');
    if (!style && !said.length && prev) return { error: 'I didn’t catch that. Try “wetter”, “less Auto-Tune”, “brighter”, “in G minor”, or an artist like “Drake”.' };
    return { recipe: r, said };
  };

  /* ---------- recipe -> real Session effects ---------- */
  const REVERB = { room: { predelay: 10, size: 30, decay: 0.9, damping: 55 }, plate: { predelay: 30, size: 55, decay: 1.8, damping: 40 }, hall: { predelay: 40, size: 80, decay: 3.4, damping: 45 } };
  const REV_MIX = [0, 10, 17, 27, 40];
  V.build = (r) => {
    const out = [];
    const add = (pluginId, params, label) => out.push({ pluginId, params, label });
    if (r.gate) add('fx-gate', { threshold: -50, range: -60, attack: 1, hold: 80, release: 180 }, 'Noise gate');
    if (r.mic) add('ss-micmod', { character: r.mic, amount: 80 }, 'Mic Mod · ' + r.mic);
    if (r.tune) {
      const key = r.key || { key: 'C', scale: 'Chromatic' };
      add('ss-autotune', { key: key.key, scale: key.scale, retune: r.tune.retune, strength: r.tune.strength, mix: 100 },
        'Auto-Tune · ' + (key.scale === 'Chromatic' ? 'chromatic' : key.key + ' ' + key.scale.toLowerCase()) + ' · ' + (r.tune.retune <= 3 ? 'hard' : r.tune.retune < 25 ? 'medium' : 'natural') + ' (' + r.tune.retune + ' ms)');
    }
    const e = r.eq || {};
    const eq = { hpOn: true, hpFreq: e.hp || 80, lsOn: true, lsFreq: 120, lsGain: e.low || 0, p1On: true, p1Freq: 320, p1Gain: e.mud || 0, p1Q: 1.2, p2On: true, p2Freq: 3200, p2Gain: e.presence || 0, p2Q: 0.9, p3On: false, hsOn: true, hsFreq: 10000, hsGain: e.air || 0, lpOn: false, output: 0 };
    if (r.phone) Object.assign(eq, { hpFreq: 500, lsGain: 0, p1Gain: 0, p2Freq: 1800, p2Gain: 5, p2Q: 0.8, hsGain: -6, lpOn: true, lpFreq: 3400 });
    add('ss-eq', eq, r.phone ? 'EQ · phone band (500 Hz – 3.4 kHz)' : 'EQ · low cut ' + eq.hpFreq + ' Hz' + (eq.p2Gain ? ', presence ' + (eq.p2Gain > 0 ? '+' : '') + eq.p2Gain + ' dB' : '') + (eq.hsGain ? ', air ' + (eq.hsGain > 0 ? '+' : '') + eq.hsGain + ' dB' : ''));
    if (r.comp > 0) {
      const c = [null, { threshold: -16, ratio: 2.5, attack: 12, release: 160 }, { threshold: -22, ratio: 4, attack: 6, release: 120 }, { threshold: -28, ratio: 6, attack: 3, release: 90 }][r.comp];
      add('ss-comp', Object.assign({ knee: 6, auto: true, mix: 100, input: 0, makeup: 0 }, c), 'Compressor · ' + ['', 'light', 'medium', 'heavy'][r.comp]);
    }
    if (r.deess > 0) add('ss-deesser', [null, { threshold: -26, range: 7 }, { threshold: -31, range: 11 }, { threshold: -36, range: 15 }][r.deess], 'De-esser · ' + ['', 'light', 'medium', 'strong'][r.deess]);
    if (r.sat > 0) add('ss-clipper', { drive: [0, 3, 6, 10][r.sat], softness: 55, ceiling: -0.5, output: -1, mix: [0, 100, 85, 70][r.sat] }, 'Saturation · ' + ['', 'light', 'medium', 'heavy'][r.sat]);
    if (r.dirty) add('fx-distortion', { drive: 0.35, tone: 6000, mix: 0.35 }, 'Distortion · grit');
    if (r.chorus > 0) add('ss-chorus', { rate: 0.6, depth: 3 + r.chorus, spread: 85, mix: [0, 18, 30, 45][r.chorus] }, 'Chorus / doubler · ' + ['', 'light', 'wide', 'extra wide'][r.chorus]);
    if (r.delay && r.delay.amt > 0) {
      const slap = r.delay.sync === 'slap';
      add('ss-delay', { sync: slap ? 'Free (ms)' : r.delay.sync, time: slap ? 95 : 350, feedback: slap ? 10 : [0, 25, 35, 45][r.delay.amt], pingpong: !slap, lowcut: 300, highcut: 5500, mix: [0, 11, 18, 27][r.delay.amt] },
        'Delay · ' + (slap ? 'slapback' : r.delay.sync) + ' · ' + ['', 'light', 'medium', 'big'][r.delay.amt]);
    }
    if (r.reverb && r.reverb.amt > 0) {
      const rv = REVERB[r.reverb.type] || REVERB.plate;
      add('ss-reverb', Object.assign({ lowcut: 250, highcut: 9500, width: 100, mix: REV_MIX[r.reverb.amt] }, rv), 'Reverb · ' + r.reverb.type + ' · ' + ['', 'light', 'medium', 'wet', 'very wet'][r.reverb.amt]);
    }
    return out;
  };

  /** Understand `text` and put the resulting chain on `track` (replaces its effects; Undo brings them back). */
  V.apply = (track, text) => {
    const res = V.understand(text, track.vibe && track.vibe.recipe, S.project.key);
    if (res.error) return res;
    S.history.push();
    if (res.clear) {
      track.fx = [];
      delete track.vibe;
      S.refresh.structure();
      return { said: res.said, chain: [] };
    }
    const chain = V.build(res.recipe).filter((f) => S.plugins.get(f.pluginId));
    track.fx = chain.map((f) => ({ id: S.uid(), pluginId: f.pluginId, params: Object.assign(S.defaultParams(S.plugins.get(f.pluginId)), f.params), bypass: false }));
    track.vibe = { recipe: res.recipe, last: String(text).slice(0, 200) };
    S.refresh.structure();
    return { said: res.said, chain };
  };

  /* ---------- the window ---------- */
  const EXAMPLES = ['Make me sound like Carti', 'Travis vibe in F minor, wetter', 'Smooth R&B like Drake', 'Hard tune in key', 'Natural pitch correction, clean pop', 'Juice WRLD melodic', 'Lo-fi phone voice', 'Ad-libs, wide and wet'];
  const FOLLOWUPS = ['wetter', 'less Auto-Tune', 'more Auto-Tune', 'brighter', 'darker', 'punchier', 'more delay', 'no reverb'];

  V.open = (track) => {
    const p = S.project;
    if (!p.tracks.length) return S.toast('Add a track first.');
    const armed = p.tracks.find((t) => t.arm);
    let cur = track || armed || p.tracks.find((t) => t.clips.length) || p.tracks[0];
    const dlg = document.createElement('dialog');
    dlg.className = 'modal vibe';
    dlg.innerHTML = `
      <div class="vibe-head"><div class="vibe-logo">✦</div><div><h3>Vocal Vibe</h3><div class="vibe-sub">Say what you want — it builds the whole vocal chain for you.</div></div><button class="btn ghost sm vibe-x" title="Close">✕</button></div>
      <label class="vibe-lbl">Track <select class="sel vibe-track"></select></label>
      <div class="vibe-box"><textarea class="txt vibe-in" rows="2" placeholder="e.g. make me sound like Travis, hard tune in F minor, a bit wetter"></textarea><button class="btn primary vibe-go">Build</button></div>
      <div class="vibe-chips vibe-ex"></div>
      <div class="vibe-out" hidden><div class="vibe-said"></div><ol class="vibe-chain"></ol>
        <div class="vibe-follow-lbl">Tweak it:</div><div class="vibe-chips vibe-fu"></div>
        <div class="vibe-row"><button class="btn sm vibe-undo">Undo</button><span class="vibe-note">Click any effect on the track to fine-tune it.</span></div></div>`;
    const $ = (s) => dlg.querySelector(s);
    const sel = $('.vibe-track'), input = $('.vibe-in');
    p.tracks.forEach((t, i) => { const o = document.createElement('option'); o.value = t.id; o.textContent = (t.name || 'Track ' + (i + 1)) + (t.fx.length ? ' · ' + t.fx.length + ' fx' : ''); sel.appendChild(o); });
    sel.value = cur.id;
    sel.onchange = () => { cur = p.tracks.find((t) => t.id === sel.value) || cur; };
    const chips = (box, list, fill) => list.forEach((x) => { const b = document.createElement('button'); b.className = 'vibe-chip'; b.textContent = x; b.onclick = () => { if (fill) { input.value = x; input.focus(); } else run(x); }; box.appendChild(b); });
    chips($('.vibe-ex'), EXAMPLES, true);
    chips($('.vibe-fu'), FOLLOWUPS, false);
    const run = (text) => {
      // look the track up fresh: Undo swaps in restored track objects
      cur = S.project.tracks.find((t) => t.id === sel.value);
      if (!cur) return S.toast('That track is gone — pick another.');
      const r = V.apply(cur, text != null ? text : input.value);
      if (r.error) return S.toast(r.error);
      $('.vibe-out').hidden = false;
      $('.vibe-said').textContent = 'Got it: ' + r.said.join(' · ');
      const ol = $('.vibe-chain');
      ol.innerHTML = '';
      r.chain.forEach((f) => { const li = document.createElement('li'); li.textContent = f.label; ol.appendChild(li); });
      if (!r.chain.length) { const li = document.createElement('li'); li.textContent = 'No effects — the vocal is dry.'; ol.appendChild(li); }
      if (text == null) input.select();
    };
    $('.vibe-go').onclick = () => run();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } });
    $('.vibe-undo').onclick = () => { if (S.history.canUndo()) { S.history.undo(); $('.vibe-said').textContent = 'Undone — the track’s previous effects are back.'; $('.vibe-chain').innerHTML = ''; } };
    $('.vibe-x').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    input.focus();
  };

  V.init = () => {
    const b = document.getElementById('btn-vibe');
    if (b) b.onclick = () => V.open();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', V.init);
  else V.init();
})();
