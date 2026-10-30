/* Workspace: switch between Playlist, Mixer and Both as tabs, dock the mixer on the bottom or
 * the right, resize it, and keep the choice. Shortcuts: F2 Playlist, F3 Mixer, F4 Both. */
(function () {
  const S = window.Studio;
  const W = (S.workspace = {});
  const read = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch (e) {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  };

  let state = { view: 'both', dock: 'bottom', w: 420 };
  W.current = () => state.view;

  W.init = () => {
    const main = document.querySelector('main');
    if (!main) return;
    const saved = read('ps.workspace');
    if (saved && typeof saved === 'object') state = Object.assign(state, saved);

    const bar = document.createElement('div');
    bar.id = 'view-tabs';
    bar.innerHTML =
      '<div class="vt-seg">' +
      '<button class="vt" data-view="both">' + S.ui.icon('mixer', 14) + '<span>Both</span></button>' +
      '<button class="vt" data-view="playlist">' + S.ui.icon('grid', 14) + '<span>Playlist</span></button>' +
      '<button class="vt" data-view="mixer">' + S.ui.icon('sliders', 14) + '<span>Mixer</span></button>' +
      '</div><span class="vt-sp"></span>' +
      '<button class="btn ghost sm" id="btn-layout" title="Arrange the workspace your way">' + S.ui.icon('sliders', 14) + 'Layout</button>';
    main.parentNode.insertBefore(bar, main);
    bar.querySelectorAll('.vt').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
    document.getElementById('btn-layout').onclick = (e) => layoutMenu(e.clientX, e.clientY);

    apply();

    window.addEventListener('keydown', (e) => {
      const t = e.target || {};
      if (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable) return;
      if (e.key === 'F2') { e.preventDefault(); setView('playlist'); }
      else if (e.key === 'F3') { e.preventDefault(); setView('mixer'); }
      else if (e.key === 'F4') { e.preventDefault(); setView('both'); }
    });

    const split = document.getElementById('mix-split');
    if (split) split.addEventListener('pointerdown', onSplit);
  };

  function setView(v) {
    state.view = v;
    save();
    apply();
  }
  W.setView = setView;

  function save() {
    write('ps.workspace', { view: state.view, dock: state.dock, w: state.w });
  }

  function apply() {
    const main = document.querySelector('main');
    main.classList.remove('mv-both', 'mv-playlist', 'mv-mixer', 'mdock-bottom', 'mdock-right');
    main.classList.add('mv-' + state.view, 'mdock-' + state.dock);
    main.style.setProperty('--mix-w', state.w + 'px');
    if (state.view === 'mixer' && S.showMixer) S.showMixer();
    document.querySelectorAll('#view-tabs .vt').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    // resize the timeline once the layout has settled (two frames = after the CSS transition starts)
    requestAnimationFrame(() => requestAnimationFrame(() => S.timeline && S.timeline.resize()));
  }

  function layoutMenu(x, y) {
    S.clips.menu(x, y, [
      { label: 'Both', hint: 'F4', checked: state.view === 'both', action: () => setView('both') },
      { label: 'Playlist only', hint: 'F2', checked: state.view === 'playlist', action: () => setView('playlist') },
      { label: 'Mixer only', hint: 'F3', checked: state.view === 'mixer', action: () => setView('mixer') },
      { sep: true },
      { label: 'Mixer on the bottom', checked: state.dock === 'bottom', action: () => { state.dock = 'bottom'; save(); apply(); } },
      { label: 'Mixer on the right', checked: state.dock === 'right', action: () => { state.dock = 'right'; save(); apply(); } },
      { sep: true },
      { label: 'Reset layout', action: () => { state = { view: 'both', dock: 'bottom', w: 420 }; save(); apply(); } },
    ]);
  }

  // drag the handle: height when docked bottom, width when docked right
  function onSplit(e) {
    const main = document.querySelector('main');
    const panel = document.getElementById('mix-panel');
    const split = document.getElementById('mix-split');
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    if (panel.classList.contains('collapsed') && S.showMixer) S.showMixer();
    panel.classList.add('resizing');
    const right = state.dock === 'right';
    const start = right ? e.clientX : e.clientY;
    const base = right ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height;
    const move = (ev) => {
      if (right) {
        state.w = S.clamp(base - (ev.clientX - start), 240, Math.max(280, innerWidth - 360));
        main.style.setProperty('--mix-w', state.w + 'px');
      } else {
        panel.style.height = S.clamp(base - (ev.clientY - start), 160, Math.max(200, innerHeight - 260)) + 'px';
      }
      if (S.timeline) S.timeline.dirty = true;
    };
    const up = () => {
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      panel.classList.remove('resizing');
      if (right) save();
      else if (S.setMixerHeight) S.setMixerHeight(parseInt(panel.style.height));
      if (S.timeline) S.timeline.resize();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  }
})();
