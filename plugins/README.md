# Writing a Private Studio plugin

Drop a `.js` file into your plugin folder (menu: **Plugins → Open plugin folder**) and restart the app.
Built-in plugins live in this directory and work the same way.

A plugin file is a plain script that calls `Studio.registerPlugin`:

```js
Studio.registerPlugin({
  id: 'my-gain',          // unique, stable (saved in sessions)
  name: 'My Gain',
  type: 'effect',         // the only type for now
  params: [
    // range param (scale: 'log' for frequencies/times)
    { id: 'gain', name: 'Gain', unit: 'dB', min: -24, max: 12, step: 0.5, default: 0 },
    // select param
    { id: 'mode', name: 'Mode', type: 'select', options: ['a', 'b'], default: 'a' },
  ],
  create(ctx) {
    const g = ctx.createGain();
    return {
      input: g,           // node the track audio connects INTO
      output: g,          // node that feeds the next stage (must be a terminal node)
      setParam(id, value) {
        if (id === 'gain') g.gain.setTargetAtTime(Math.pow(10, value / 20), ctx.currentTime, 0.01);
      },
      destroy() {},       // optional: clean up timers etc.
    };
  },
});
```

## Extras

- **Buttons in the editor**: add `actions: [{ label, title, run({ fx, owner, set, current }) { ...; return 'message to show'; } }]` to your definition. `owner` is the track the effect sits on (or `null` on the master), and `set(id, value)` changes a parameter. Throw an `Error` to show a problem message.
- **AudioWorklet effects** (for sample-accurate processing): call `Studio.registerWorklet('my-processor', sourceString)` at load time. The host loads it into every audio context before your `create(ctx)` runs, so you can build `new AudioWorkletNode(ctx, 'my-processor')` synchronously. Use `parameterDescriptors` with `k-rate` and set values through `node.parameters.get(id).value` so offline export matches live playback. See `gate.js`.

## Accepted file formats

Single-file JavaScript effects, in any of these shapes (use **Import plugin** or the plugin folder):

- classic script calling `Studio.registerPlugin({...})`
- CommonJS: `module.exports = def`, `module.exports = [def, def]` or `module.exports = (Studio) => def`
- ES module: `export default def` (or an array / function), no relative imports (bundle into one file)

Forgiving rules: `type` may be omitted (effect assumed), `id` is derived from `name` if missing, `create` may return a bare `AudioNode` or an AudioWorkletNode (its AudioParams then act as the parameters), param ranges are repaired, and `type: 'boolean'` params get a checkbox. Instrument/generator plugins, native VST/AU/CLAP binaries and class-based Web Audio Modules are rejected with an explanation.

## Rules

- `create(ctx)` receives an `AudioContext` **or** an `OfflineAudioContext` (used for WAV export), so build everything from `ctx` and never assume real-time.
- The host calls `setParam` once per param right after `create` (defaults merged with saved values), so you don't need to read initial values in `create`.
- `output` must not have internal outgoing connections other than to whatever the host connects next. For dry/wet effects, mix both paths into one output `GainNode` (see `effects.js`, `dryWet`).
- Use `setTargetAtTime` (not direct `.value =`) when a param is changed live, to avoid clicks.
- If `registerPlugin` rejects your definition, the reason is printed to the dev console.

## Security note

Plugins run inside the app window with the same privileges as the app UI. They have **no** Node.js or file-system access, but they can read and change the open session. Only load plugin files you trust, and only share sessions with people you trust.

## Making your plugin window look professional (optional)

Every effect gets the Session plugin window automatically (knobs, presets, bypass, meters). Add any of these fields to your definition to customise it:

- `category`: `'EQ' | 'Dynamics' | 'Mastering' | 'Reverb' | 'Delay' | 'Distortion' | 'Filter' | 'Creative' | 'Utility'` (groups it in the effect menu and picks its colour)
- `color`: accent colour, e.g. `'#22d3ee'`
- `description`: one line shown in the menu and the window
- `layout`: `[{ title, params: ['id', ...], toggle: 'boolId', big: 'id' }]`: sections of controls; `toggle` puts an on/off switch in the section title; `big` draws one large knob
- `presets`: `[{ name, params: { id: value } }]`
- `compact: true`: smaller knobs (for many controls)
- params: `hidden: true` (no control), `enabledIf: (values) => boolean` (control dims when it has no effect)
- `visual`: the display at the top. One of:
  - `{ type: 'eq', bands: [{ label, freq, gain, q, on }] }`: your instance should return `getResponse(freqs)` (dB per frequency)
  - `{ type: 'dynamics', threshold, ratio, knee }`: your instance should return `getReduction()` → `[dB]`
  - `{ type: 'bands', labels: [...] }`: `getReduction()` → one value per band
  - `{ type: 'curve', fn: (values, x) => y }`: transfer curve
  - `{ type: 'steps', param: 'bitmaskParamId' }`: 16-step grid; `getStep()` lights the playing step
  - `{ type: 'ir' }` (`getIR()` → `{ env, seconds }`), `{ type: 'taps' }` (`getTaps()`), or nothing (live spectrum)

Tempo-synced effects can read `Studio.project.bpm` / `beatsPerBar`, listen to the `tempo-changed` event, and to `transport` (`{ ctx, ctxTime, pos }`) to know where bar 1 is. `Studio.createDynamics(ctx, { threshold, ratio, knee, attack, release })` gives you the same accurate compressor the Session effects use.
