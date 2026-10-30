/* Copies the app into www/ for the Android build (Capacitor serves www/ inside the app).
 * The Windows build doesn't use this. Run: npm run build:www */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
require('child_process').execSync('node ' + JSON.stringify(path.join(__dirname,'gen-config.js')), { stdio: 'inherit' });
fs.rmSync(www, { recursive: true, force: true });
for (const dir of ['renderer', 'plugins', 'assets']) fs.cpSync(path.join(root, dir), path.join(www, dir), { recursive: true });
const plugins = fs.readdirSync(path.join(root, 'plugins')).filter((f) => /\.(m|c)?js$/.test(f));
fs.writeFileSync(path.join(www, 'renderer', 'plugin-list.json'), JSON.stringify(plugins));
fs.writeFileSync(
  path.join(www, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{background:#060607}</style><script>location.replace("renderer/index.html")</script>\n'
);
console.log('www/ ready:', plugins.length, 'effect files');
