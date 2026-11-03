/* Notes & Lyrics — a simple writing pad that lives with your song. Write lyrics, hooks, ideas or
 * a to-do while you work; it saves inside the .session, so it travels when you send the project.
 * It's a floating, draggable panel (not a modal), so you can keep writing while playback runs. */
(function () {
  const S = window.Studio;
  const N = (S.notes = {});
  const MIRROR = 'ps.notes.scratch'; // safety copy for an unsaved project on this computer
  let panel = null, ta = null, saveT = 0;

  function ensureStyle() {
    if (document.getElementById('notes-style')) return;
    const s = document.createElement('style');
    s.id = 'notes-style';
    s.textContent =
      '#notes-panel{position:fixed;top:118px;right:16px;width:360px;max-width:92vw;height:min(62vh,640px);z-index:350;' +
      'display:flex;flex-direction:column;background:var(--panel-solid,#131419);border:1px solid var(--line-hi,rgba(255,255,255,.14));' +
      'border-radius:14px;box-shadow:var(--shadow,0 10px 30px rgba(0,0,0,.45));overflow:hidden}' +
      '#notes-panel .nt-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line,rgba(255,255,255,.08));cursor:move;user-select:none}' +
      '#notes-panel .nt-title{font-weight:700;font-size:13px;flex:1}' +
      '#notes-panel .nt-sub{color:var(--dim,#8a8d99);font-size:11px}' +
      '#notes-panel textarea{flex:1;border:0;outline:0;resize:none;background:transparent;color:var(--text,#e9eaf0);' +
      "font:14px/1.55 var(--font,'Segoe UI',system-ui,sans-serif);padding:12px 14px;white-space:pre-wrap}" +
      '#notes-panel .nt-x{background:transparent;border:0;color:var(--dim,#8a8d99);cursor:pointer;font-size:15px;line-height:1;padding:3px 7px;border-radius:6px}' +
      '#notes-panel .nt-x:hover{background:var(--field-hi,rgba(255,255,255,.08));color:var(--text,#e9eaf0)}';
    document.head.appendChild(s);
  }

  function build() {
    ensureStyle();
    panel = document.createElement('div');
    panel.id = 'notes-panel';
    const head = document.createElement('div');
    head.className = 'nt-head';
    head.innerHTML = '<span class="nt-title">Lyrics &amp; Notes</span><span class="nt-sub">saved with your song</span>';
    const x = document.createElement('button');
    x.className = 'nt-x'; x.title = 'Close'; x.textContent = '✕';
    x.onclick = () => N.close();
    head.appendChild(x);
    ta = document.createElement('textarea');
    ta.placeholder = 'Write your lyrics, hooks, ideas…';
    ta.spellcheck = true;
    ta.addEventListener('input', () => {
      if (S.project) S.project.notes = ta.value;
      clearTimeout(saveT);
      saveT = setTimeout(mirror, 400);
    });
    // typing in here must not fire the app's keyboard shortcuts (space = play, etc.)
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    panel.append(head, ta);
    document.body.appendChild(panel);
    makeDraggable(panel, head);
  }

  function mirror() { try { localStorage.setItem(MIRROR, (S.project && S.project.notes) || ''); } catch (e) {} }

  N.refresh = () => { if (ta) ta.value = (S.project && S.project.notes) || ''; };
  N.isOpen = () => !!panel && panel.style.display !== 'none';
  N.open = () => { if (!panel) build(); panel.style.display = 'flex'; N.refresh(); setBtn(true); setTimeout(() => ta && ta.focus(), 0); };
  N.close = () => { if (panel) panel.style.display = 'none'; setBtn(false); };
  N.toggle = () => (N.isOpen() ? N.close() : N.open());

  function setBtn(on) { const b = document.getElementById('btn-notes'); if (b) b.classList.toggle('on', on); }

  // drag the panel by its header so it never covers what you're working on
  function makeDraggable(box, handle) {
    let sx, sy, ox, oy, drag = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.nt-x')) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = box.getBoundingClientRect(); ox = r.left; oy = r.top;
      box.style.right = 'auto'; box.style.left = ox + 'px'; box.style.top = oy + 'px';
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      box.style.left = Math.max(4, Math.min(window.innerWidth - 80, ox + e.clientX - sx)) + 'px';
      box.style.top = Math.max(4, Math.min(window.innerHeight - 60, oy + e.clientY - sy)) + 'px';
    });
    handle.addEventListener('pointerup', () => { drag = false; });
  }

  N.init = () => {
    const b = document.getElementById('btn-notes');
    if (b) b.onclick = () => N.toggle();
    // when a different song is opened/created, show that song's notes
    try { S.on && S.on('project-replaced', () => N.refresh()); } catch (e) {}
  };
})();
