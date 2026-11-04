/* Auto-bump the version so you never have to edit it by hand.
 *
 * Run automatically by ship5.cmd before each release. It:
 *   1. bumps the PATCH number in package.json (0.25.4 -> 0.25.5),
 *   2. stamps the pending patch-notes entry — the one written as  version: 'NEXT', date: 'NEXT'
 *      — with the new version and today's date (if there is one),
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

// --- 2. stamp the pending patch-notes entry, if present ---
const pnPath = path.join(root, 'renderer', 'patch-notes.js');
try {
  let pn = fs.readFileSync(pnPath, 'utf8');
  // Anchor to the start of a line (^ with /m) so we hit the real entry, never a mention in a comment.
  if (/^\s*version:\s*'NEXT',/m.test(pn)) {
    const today = new Date().toISOString().slice(0, 10);
    pn = pn.replace(/^(\s*version:\s*')NEXT(',)/m, '$1' + ver + '$2')
           .replace(/^(\s*date:\s*')NEXT(',)/m, '$1' + today + '$2');
    fs.writeFileSync(pnPath, pn);
  }
} catch (e) { /* no patch notes is fine */ }

// --- 3. regenerate the baked version/config ---
try { cp.execSync('node ' + JSON.stringify(path.join(__dirname, 'gen-config.js')), { stdio: 'inherit' }); } catch (e) {}

console.log(ver);
