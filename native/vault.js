/* Bridge to "The Vault" (a private song library app) — main process only.
 *
 * The Vault keeps everything in ~/SongVault:
 *   songs/          the current audio file of every song
 *   old_versions/   previous files, named "<songId>_<YYYYmmdd_HHMMSS_micro>_<old filename>"
 *   trash/          deleted songs
 *   vault.db        SQLite: songs(id, title, status, project, notes, filename, added, updated)
 *                           versions(id, song_id, filename, saved_at, note)
 * This module adds songs and new versions exactly the way The Vault's own Import / Replace buttons do,
 * so The Vault shows them the next time it refreshes its list (switching tabs, searching, reopening).
 * Every database write: refuse if The Vault is mid-write, keep a backup, check integrity before saving. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATUSES = ['Unfinished', 'Finished'];
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Unfinished',
      project TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      added TEXT NOT NULL,
      updated TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
  );`;

let sqlPromise = null;
function sqlEngine() {
  if (!sqlPromise) {
    const init = require('./sqljs/sql-wasm.js');
    sqlPromise = init({ locateFile: (f) => path.join(__dirname, 'sqljs', f) });
  }
  return sqlPromise;
}

function vaultPaths(home = os.homedir()) {
  const root = path.join(home, 'SongVault');
  return { root, db: path.join(root, 'vault.db'), files: path.join(root, 'songs'), versions: path.join(root, 'old_versions'), trash: path.join(root, 'trash') };
}

/** Where The Vault program is installed (per-user installer first). */
function vaultExe(home = os.homedir()) {
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const candidates = [
    path.join(local, 'Programs', 'The Vault', 'The Vault.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'The Vault', 'The Vault.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'The Vault', 'The Vault.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/* ---- the same helpers The Vault uses ---- */
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** "%Y-%m-%d %H:%M" in local time */
function now(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
/** "%Y%m%d_%H%M%S_%f" (microseconds) */
function stamp(d = new Date()) {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '_' + pad(d.getMilliseconds() * 1000, 6);
}
/** Strip characters Windows forbids in file names; trailing dots removed; never empty. */
function safeName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim()
    .replace(/\.+$/, '');
  return cleaned || 'Untitled';
}
/** folder/stem.ext, or "stem (2).ext", "stem (3).ext"… if taken. */
function uniquePath(folder, stem, ext) {
  let p = path.join(folder, stem + ext);
  let n = 2;
  while (fs.existsSync(p)) {
    p = path.join(folder, stem + ' (' + n + ')' + ext);
    n++;
  }
  return p;
}

class VaultBusyError extends Error {}

function ensureFolders(P) {
  for (const d of [P.root, P.files, P.versions, P.trash]) fs.mkdirSync(d, { recursive: true });
}

function rows(db, sql, params) {
  const st = db.prepare(sql);
  if (params) st.bind(params);
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}

async function openDb(P, { create = false } = {}) {
  const SQL = await sqlEngine();
  if (fs.existsSync(P.db + '-journal') || fs.existsSync(P.db + '-wal')) throw new VaultBusyError('The Vault is saving something right now. Try again in a moment.');
  let db;
  if (fs.existsSync(P.db)) db = new SQL.Database(fs.readFileSync(P.db));
  else if (create) db = new SQL.Database();
  else return null;
  db.exec(SCHEMA);
  return db;
}

/** Apply `fn(db)` and save, with a backup and an integrity check. */
async function writeDb(P, fn) {
  ensureFolders(P);
  const db = await openDb(P, { create: true });
  try {
    db.exec('BEGIN');
    const result = fn(db);
    db.exec('COMMIT');
    const check = db.exec('PRAGMA integrity_check');
    if (!check.length || check[0].values[0][0] !== 'ok') throw new Error('Database check failed; nothing was changed.');
    const bytes = Buffer.from(db.export());
    if (fs.existsSync(P.db)) fs.copyFileSync(P.db, P.db + '.session-backup');
    if (fs.existsSync(P.db + '-journal')) throw new VaultBusyError('The Vault started saving at the same moment. Try again.');
    fs.writeFileSync(P.db, bytes);
    return result;
  } finally {
    db.close();
  }
}

/* ---------------- public API ---------------- */

async function status(home) {
  const P = vaultPaths(home);
  const exe = vaultExe(home);
  let songs = [];
  let found = fs.existsSync(P.db);
  if (found) {
    const db = await openDb(P);
    try {
      songs = rows(db, 'SELECT id, title, status, project, notes, filename, added, updated FROM songs ORDER BY updated DESC, id DESC');
      for (const s of songs) s.versions = rows(db, 'SELECT COUNT(*) AS n FROM versions WHERE song_id=?', [s.id])[0].n;
    } finally {
      db.close();
    }
  }
  return { found, root: P.root, exe: !!exe, songs };
}

/** Add a new song (like The Vault's Import button). */
async function addSong({ bytes, title, status: st = 'Unfinished', project = '', notes = '', ext = '.wav' }, home) {
  const P = vaultPaths(home);
  ensureFolders(P);
  if (!STATUSES.includes(st)) st = 'Unfinished';
  const clean = String(title || '').trim() || 'Untitled';
  const dest = uniquePath(P.files, safeName(clean), ext);
  fs.writeFileSync(dest, Buffer.from(bytes), { flag: 'wx' });
  try {
    const id = await writeDb(P, (db) => {
      const t = now();
      db.run('INSERT INTO songs (title, status, project, notes, filename, added, updated) VALUES (?,?,?,?,?,?,?)', [clean, st, String(project || ''), String(notes || ''), path.basename(dest), t, t]);
      return rows(db, 'SELECT last_insert_rowid() AS id')[0].id;
    });
    return { id, title: clean, filename: path.basename(dest), status: st };
  } catch (e) {
    try {
      fs.unlinkSync(dest);
    } catch (_) {}
    throw e;
  }
}

/** Save a new version of an existing song (like The Vault's Replace button: the old file goes to History). */
async function addVersion({ songId, bytes, note = '', status: st = null, project = null, notes = null, ext = '.wav' }, home) {
  const P = vaultPaths(home);
  ensureFolders(P);
  const db0 = await openDb(P);
  if (!db0) throw new Error('The Vault library was not found.');
  let song;
  try {
    song = rows(db0, 'SELECT * FROM songs WHERE id=?', [songId])[0];
  } finally {
    db0.close();
  }
  if (!song) throw new Error('That song is no longer in The Vault.');

  // 1. move the current file into old_versions (exactly how The Vault archives it)
  const current = path.join(P.files, song.filename);
  let archived = null;
  if (fs.existsSync(current)) {
    const vname = song.id + '_' + stamp() + '_' + song.filename;
    try {
      fs.renameSync(current, path.join(P.versions, vname));
    } catch (e) {
      throw new Error('Could not move the old version. If The Vault is playing "' + song.title + '", stop it and try again. (' + e.code + ')');
    }
    archived = vname;
  }
  // 2. write the new file
  const dest = uniquePath(P.files, safeName(song.title), ext);
  try {
    fs.writeFileSync(dest, Buffer.from(bytes), { flag: 'wx' });
  } catch (e) {
    if (archived) fs.renameSync(path.join(P.versions, archived), current);
    throw e;
  }
  // 3. record it
  try {
    await writeDb(P, (db) => {
      const t = now();
      if (archived) db.run('INSERT INTO versions (song_id, filename, saved_at, note) VALUES (?,?,?,?)', [song.id, archived, t, String(note || '')]);
      db.run('UPDATE songs SET filename=?, updated=? WHERE id=?', [path.basename(dest), t, song.id]);
      if (st && STATUSES.includes(st)) db.run('UPDATE songs SET status=? WHERE id=?', [st, song.id]);
      if (project != null || notes != null) db.run('UPDATE songs SET project=?, notes=? WHERE id=?', [project != null ? String(project) : song.project, notes != null ? String(notes) : song.notes, song.id]);
    });
  } catch (e) {
    try {
      fs.unlinkSync(dest);
    } catch (_) {}
    if (archived) {
      try {
        fs.renameSync(path.join(P.versions, archived), current);
      } catch (_) {}
    }
    throw e;
  }
  return { id: song.id, title: song.title, filename: path.basename(dest), archived };
}

/** The audio of a Vault song (to bring it into Session). */
async function readSong(songId, home) {
  const P = vaultPaths(home);
  const db = await openDb(P);
  if (!db) throw new Error('The Vault library was not found.');
  let song;
  try {
    song = rows(db, 'SELECT * FROM songs WHERE id=?', [songId])[0];
  } finally {
    db.close();
  }
  if (!song) throw new Error('That song is no longer in The Vault.');
  const file = path.join(P.files, song.filename);
  if (!path.resolve(file).startsWith(path.resolve(P.files) + path.sep)) throw new Error('Invalid file name in The Vault.');
  return { title: song.title, filename: song.filename, bytes: new Uint8Array(fs.readFileSync(file)) };
}

/* ---- Connect bridge: talk to The Vault's local messaging server (4.7+) ----
 * The Vault, while running, writes SongVault/connect_bridge.json = { port, token, version }.
 * Session calls http://127.0.0.1:<port> with the token; The Vault does all the crypto. */
const http = require('http');

function bridgeInfo(home = os.homedir()) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, 'SongVault', 'connect_bridge.json'), 'utf8'));
    if (j && j.port && j.token) return j;
  } catch (e) {}
  return null;
}

function bridge(method, pathName, body, home = os.homedir()) {
  const info = bridgeInfo(home);
  if (!info) { const e = new Error('The Vault isn’t running or is older than 4.7.'); e.code = 'BRIDGE_OFFLINE'; throw e; }
  const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1', port: info.port, method: method || 'GET', path: pathName, timeout: 30000,
        headers: Object.assign(
          { Authorization: 'Bearer ' + info.token, Accept: 'application/json' },
          payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
        ),
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          let j = null; try { j = d ? JSON.parse(d) : {}; } catch (e) {}
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
          else reject(new Error((j && j.error) || 'The Vault bridge returned ' + res.statusCode));
        });
      }
    );
    req.on('error', () => reject(Object.assign(new Error('The Vault isn’t running.'), { code: 'BRIDGE_OFFLINE' })));
    req.on('timeout', () => req.destroy(new Error('The Vault bridge timed out.')));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { status, addSong, addVersion, readSong, vaultExe, vaultPaths, safeName, uniquePath, now, stamp, VaultBusyError, bridge, bridgeInfo };
