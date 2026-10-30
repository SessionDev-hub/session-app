/* Undo / redo. Snapshots the editable parts of the session (tracks, clips, effects, master); audio data is shared, not copied. */
(function () {
  const S = window.Studio;
  const LIMIT = 100;
  const undoStack = [];
  const redoStack = [];

  const H = (S.history = {});

  H.snap = () => JSON.stringify({ tracks: S.project.tracks, master: S.project.master });

  /** Call BEFORE making a change. */
  H.push = () => H.commit(H.snap());

  /** Record a previously taken snapshot as an undo point (used by drags that snapshot on mouse-down). */
  H.commit = (snapshot) => {
    undoStack.push(snapshot);
    if (undoStack.length > LIMIT) undoStack.shift();
    redoStack.length = 0;
    S.emit('history-changed');
  };

  H.clear = () => {
    undoStack.length = 0;
    redoStack.length = 0;
    S.emit('history-changed');
  };

  H.canUndo = () => undoStack.length > 0;
  H.canRedo = () => redoStack.length > 0;

  function restore(str) {
    const o = JSON.parse(str);
    const wasMonitor = S.engine && S.engine.monitorTrackId;
    S.project.tracks = o.tracks;
    S.project.master = o.master;
    if (S.timeline) S.timeline.selected = null;
    if (S.engine && wasMonitor && !S.project.tracks.some((t) => t.id === wasMonitor)) S.engine.setMonitor(null);
    if (S.refresh) S.refresh.structure();
    if (S.engine) S.engine.reapplyFxParams();
    if (S.timeline) S.timeline.resize();
  }

  H.undo = () => {
    if (!undoStack.length) return false;
    redoStack.push(H.snap());
    restore(undoStack.pop());
    S.emit('history-changed');
    return true;
  };

  H.redo = () => {
    if (!redoStack.length) return false;
    undoStack.push(H.snap());
    restore(redoStack.pop());
    S.emit('history-changed');
    return true;
  };

  S.on('project-replaced', H.clear);
})();
