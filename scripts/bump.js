/* Auto-bump the version so you never have to edit it by hand.
 *
 * Run automatically by ship5.cmd before each release. It:
 *   1. bumps the PATCH number in package.json (0.25.4 -> 0.25.5),
 *   2. turns PATCH-NOTES-NEXT.txt (one change per line) into a new patch-notes entry for this
 *      version only — lines already listed under an older version are dropped — then empties it.
 *      (Still stamps an old-style  version: 'NEXT'  entry if one is there.)
 *   3. regenerates renderer/update-target.js so the baked version matches.
 *
 * It prints the new version on the last line.
 *
 * To jump a minor/major version instead (e.g. 0.25.9 -> 0.26.0), just hand-edit "version" in
 * package.json before shipping; this only ever adds 1 to whatever is there.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.join(__dirname, '..');

// --- 1. bump package.json patch (regex replace keeps the file's formatting + line endings) ---
const pkgPath = path.join(root, 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const m = raw.match(/"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"/);
if (!m) { console.error('bump: could not find a semver "version" in package.json'); process.exit(1); }
const ver = m[1] + '.' + m[2] + '.' + (parseInt(m[3], 10) + 1);
fs.writeFileSync(pkgPath, raw.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, '$1' + ver + '$2'));

// --- 2. patch notes: ONLY what changed in this bump ---
const pnPath = path.join(root, 'renderer', 'patch-notes.js');
const nextPath = path.join(root, 'PATCH-NOTES-NEXT.txt');
const NEXT_HELP = '# What changed in the NEXT release — one line per fix/feature, plain words.\n' +
  '# Lines starting with # are ignored. ship5.cmd moves these into the patch notes and empties this file.\n';
try {
  let pn = fs.readFileSync(pnPath, 'utf8');
  const eol = pn.includes('\r\n') ? '\r\n' : '\n';
  const today = new Date().toISOString().slice(0, 10);
  // old-style pending entry
  if (/^\s*version:\s*'NEXT',/m.test(pn)) {
    pn = pn.replace(/^(\s*version:\s*')NEXT(',)/m, '$1' + ver + '$2')
           .replace(/^(\s*date:\s*')NEXT(',)/m, '$1' + today + '$2');
  }
  // new-style: PATCH-NOTES-NEXT.txt
  let lines = [];
  try {
    lines = fs.readFileSync(nextPath, 'utf8').split(/\r?\n/)
      .map((l) => l.trim().replace(/^[-*•]\s+/, '')).filter((l) => l && !l.startsWith('#'));
  } catch (e) {}
  if (lines.length) {
    // everything already announced in an older version
    const sandbox = { window: {} };
    require('vm').runInNewContext(pn, sandbox);
    const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();
    const seen = new Set((sandbox.window.__PATCH_NOTES__ || []).flatMap((e) => e.changes || []).map(norm));
    const fresh = [];
    for (const l of lines) { const k = norm(l); if (!seen.has(k)) { seen.add(k); fresh.push(l); } }
    if (fresh.length) {
      const q = (t) => "'" + t.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      const entry = ['  {', "    version: '" + ver + "',", "    date: '" + today + "',", '    changes: [',
        ...fresh.map((l) => '      ' + q(l) + ','), '    ],', '  },'].join(eol) + eol;
      const anchor = /window\.__PATCH_NOTES__\s*=\s*\[\r?\n/;
      if (!anchor.test(pn)) throw new Error('patch-notes.js: list start not found');
      pn = pn.replace(anchor, (m) => m + entry);
    }
    fs.writeFileSync(nextPath, NEXT_HELP.replace(/\n/g, eol));
  }
  fs.writeFileSync(pnPath, pn);
} catch (e) { console.error('bump: patch notes skipped — ' + e.message); }

// --- 3. regenerate the baked version/config ---
try { cp.execSync('node ' + JSON.stringify(path.join(__dirname, 'gen-config.js')), { stdio: 'inherit' }); } catch (e) {}

console.log(ver);
