/* Writes renderer/update-target.js — the small config baked into the app:
 * the GitHub update target, the app version, and the Discord app settings. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'updates.config.json'), 'utf8')); } catch (e) {}
const gh = cfg.github || {};
const dc = cfg.discord || {};
const out =
  'window.__UPDATE_GITHUB__ = ' + JSON.stringify({ owner: gh.owner || '', repo: gh.repo || '' }) + ';\n' +
  'window.__SESSION_VERSION__ = ' + JSON.stringify(pkg.version) + ';\n' +
  'window.__DISCORD__ = ' + JSON.stringify({ clientId: dc.clientId || '', invite: dc.invite || '', redirect: dc.redirect || 'http://localhost/session-oauth', guildId: dc.guildId || '', betaRoleId: dc.betaRoleId || '', gate: dc.gate !== false }) + ';\n';
fs.writeFileSync(path.join(root, 'renderer', 'update-target.js'), out);
if (require.main === module) console.log('wrote renderer/update-target.js');
module.exports = {};
