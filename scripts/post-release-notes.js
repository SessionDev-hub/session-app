/* Post a release's patch notes to Discord via a channel webhook.
 *
 *   node scripts/post-release-notes.js [--version X.Y.Z] [--dry]
 *
 * The webhook URL is a SECRET and never lives in the repo. It is read from, in order:
 *   1. env DISCORD_RELEASE_WEBHOOK
 *   2. release-webhook.txt           (gitignored — one line, the webhook URL)
 *   3. updates.config.local.json     (gitignored — { "discord": { "releaseWebhook": "https://..." } })
 *
 * If none is set, this is a no-op (prints a hint and exits 0) so it never breaks a build.
 * build-release.js calls this automatically after a successful --publish.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const flagVersion = (() => { const i = args.indexOf('--version'); return i >= 0 ? args[i + 1] : ''; })();

function readWebhook() {
  const env = (process.env.DISCORD_RELEASE_WEBHOOK || '').trim();
  if (env) return env;
  try { const t = fs.readFileSync(path.join(root, 'release-webhook.txt'), 'utf8').trim(); if (t) return t; } catch (e) {}
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'updates.config.local.json'), 'utf8'));
    const u = ((j.discord || {}).releaseWebhook || '').trim();
    if (u) return u;
  } catch (e) {}
  return '';
}

// Load the patch-notes array (a browser file: assigns window.__PATCH_NOTES__).
function loadNotes() {
  const src = fs.readFileSync(path.join(root, 'renderer', 'patch-notes.js'), 'utf8');
  const sandbox = { window: {} };
  try { new Function('window', src)(sandbox.window); } catch (e) { return []; }
  return sandbox.window.__PATCH_NOTES__ || [];
}

function githubReleaseUrl(version) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'updates.config.json'), 'utf8')).github || {};
    if (cfg.owner && cfg.repo) return 'https://github.com/' + cfg.owner + '/' + cfg.repo + '/releases/tag/v' + version;
  } catch (e) {}
  return '';
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = flagVersion || pkg.version;
  const notes = loadNotes();
  const entry = notes.find((n) => n.version === version) || notes[0];
  if (!entry) { console.log('post-release-notes: no patch notes found; skipping.'); return; }

  const changes = (entry.changes || []).map((c) => '• ' + c).join('\n').slice(0, 4000);
  const relUrl = githubReleaseUrl(entry.version);
  const payload = {
    username: 'Session Updates',
    embeds: [{
      title: '🎧 Session v' + entry.version + ' is out',
      description: changes || 'A new version of Session is available.',
      url: relUrl || undefined,
      color: 0x8b7bff,
      footer: { text: 'Session · record, create and share' },
      timestamp: new Date().toISOString(),
    }],
  };

  if (dry) { console.log('post-release-notes (dry run):\n' + JSON.stringify(payload, null, 2)); return; }

  const webhook = readWebhook();
  if (!webhook) {
    console.log('post-release-notes: no DISCORD_RELEASE_WEBHOOK set (or release-webhook.txt / updates.config.local.json) — skipping Discord post.');
    return;
  }

  const res = await fetch(webhook + (webhook.includes('?') ? '&' : '?') + 'wait=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Discord webhook returned ' + res.status + ' ' + body.slice(0, 300));
  }
  console.log('post-release-notes: posted v' + entry.version + ' notes to Discord.');
}

main().catch((e) => { console.error('post-release-notes failed:', e.message); /* never fail the build */ process.exit(0); });
