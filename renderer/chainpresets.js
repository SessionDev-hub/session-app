/* Chain presets — save EVERY effect on a track (all plugins + their settings) as one named
 * preset, like BandLab's track presets, and drop the whole chain onto any track later.
 * Stored on this computer, reusable across tracks and sessions. */
(function () {
  const S = window.Studio;
  const C = (S.chainPresets = {});
  const KEY = 'ps.chainPresets';

  C.all = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  const write = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} };

  /** Save a track's whole effect chain under a name (overwrites one with the same name). */
  C.save = (track, name) => {
    const fx = (track.fx || []).map((f) => ({
      pluginId: f.pluginId,
      params: Object.assign({}, f.params),
      bypass: !!f.bypass,
      preset: f.preset || null,
    }));
    const list = C.all();
    const ix = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    const entry = { id: ix >= 0 ? list[ix].id : S.uid(), name: name, fx: fx, count: fx.length };
    if (ix >= 0) list[ix] = entry; else list.push(entry);
    write(list);
    return entry;
  };

  C.remove = (id) => write(C.all().filter((p) => p.id !== id));

  /** Replace a track's chain with a saved preset. Plugins you don't have are skipped. */
  C.apply = (track, preset) => {
    S.history.push();
    const fx = [], seen = {};
    let missing = 0;
    for (const f of preset.fx || []) {
      if (S.plugins.get(f.pluginId)) fx.push({ id: S.uid(), pluginId: f.pluginId, params: Object.assign({}, f.params), bypass: !!f.bypass, preset: f.preset || null });
      else { missing++; seen[f.pluginId] = 1; }
    }
    track.fx = fx;
    if (S.refresh && S.refresh.structure) S.refresh.structure();
    return { applied: fx.length, missing: missing };
  };

  /** Shared menu used by the right-click track menu and the mixer "Chains" button. */
  C.menuItems = (track) => {
    const items = [];
    items.push({
      label: 'Save all effects as a preset…',
      hint: (track.fx || []).length + ' effect' + ((track.fx || []).length === 1 ? '' : 's'),
      action: async () => {
        if (!(track.fx || []).length) return S.toast('Add some effects to this track first.');
        const name = (await S.askText('Name this effect chain', { value: 'My chain', placeholder: 'e.g. Main vocal chain' }) || '').trim();
        if (!name) return;
        C.save(track, name);
        S.toast('Saved chain “' + name + '” (' + track.fx.length + ' effects).');
      },
    });
    const list = C.all();
    if (list.length) {
      items.push({ sep: true });
      list.forEach((p) => {
        items.push({
          label: 'Load: ' + p.name,
          hint: (p.count || (p.fx || []).length) + ' fx',
          action: () => {
            const r = C.apply(track, p);
            S.toast('Loaded “' + p.name + '” onto ' + (track.name || 'track') + '.' + (r.missing ? ' ' + r.missing + ' effect(s) skipped (not installed).' : ''));
          },
        });
      });
      items.push({ sep: true });
      list.forEach((p) => {
        items.push({ label: 'Delete: ' + p.name, danger: true, action: () => { C.remove(p.id); S.toast('Deleted chain “' + p.name + '”.'); } });
      });
    }
    return items;
  };
})();
