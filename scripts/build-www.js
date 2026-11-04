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

// Keep the Android version in step with package.json so you never hand-edit build.gradle.
// versionName is what users see; versionCode MUST increase for every APK or Android refuses to
// install the update. Code = major*10000 + minor*100 + patch (0.25.5 -> 2505, matches the old scheme).
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const [maj = 0, min = 0, pat = 0] = String(pkg.version).split('.').map((n) => parseInt(n, 10) || 0);
  const code = maj * 10000 + min * 100 + pat;
  const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
  if (fs.existsSync(gradlePath)) {
    let g = fs.readFileSync(gradlePath, 'utf8');
    g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code)
         .replace(/versionName\s+"[^"]*"/, 'versionName "' + pkg.version + '"');
    fs.writeFileSync(gradlePath, g);
    console.log('android version synced: ' + pkg.version + ' (code ' + code + ')');
  }
} catch (e) { console.log('android version sync skipped:', e.message); }
