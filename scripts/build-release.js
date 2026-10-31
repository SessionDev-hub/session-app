/* Builds the protected Windows release: scrambles the renderer + plugins, runs electron-builder
 * (publishing to GitHub when --publish is passed), then restores your readable source.
 * Your working files are never left obfuscated, even if the build fails. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const O = require('javascript-obfuscator');

const root = path.join(__dirname, '..');
const DIRS = ['renderer', 'plugins'];
const bak = path.join(root, '.src-backup');

const OPTS = {
  compact: true,
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayThreshold: 0.9,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayEncoding: ['base64'],
  splitStrings: true,
  splitStringsChunkLength: 8,
  numbersToExpressions: true,
  simplify: true,
  transformObjectKeys: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
};

const SKIP = new Set(['lame.min.js', 'apinator.min.js']); // third-party libs: already minified, leave them be
function obfuscateDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) obfuscateDir(p);
    else if (f.endsWith('.js') && !SKIP.has(f)) fs.writeFileSync(p, O.obfuscate(fs.readFileSync(p, 'utf8'), OPTS).getObfuscatedCode());
  }
}

// keep the baked config (version, update target, Discord) in sync with package.json
try { cp.execSync('node ' + JSON.stringify(path.join(__dirname, 'gen-config.js')), { stdio: 'inherit' }); } catch (e) {}

const publish = process.argv.includes('--publish') ? 'always' : 'never';
const dir = process.argv.includes('--dir');
// Platform: macOS when run on a Mac (e.g. in CI), otherwise Windows. --mac/--win can force it.
const mac = process.argv.includes('--mac') || (process.platform === 'darwin' && !process.argv.includes('--win'));
let builderArgs;
if (mac) builderArgs = dir ? '--mac --dir' : '--mac';
else builderArgs = dir ? '--win --dir --x64' : '--win nsis portable --x64';

// Clean up a pasted token: strip surrounding quotes and any stray whitespace/newlines,
// so "set GH_TOKEN=..." with accidental quotes or a trailing space still works.
const env = Object.assign({}, process.env);
if (env.GH_TOKEN) env.GH_TOKEN = env.GH_TOKEN.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
if (env.GITHUB_TOKEN) env.GITHUB_TOKEN = env.GITHUB_TOKEN.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
if (mac) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'; // unsigned Mac build (no Apple Developer cert yet)

fs.rmSync(bak, { recursive: true, force: true });
for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(bak, d), { recursive: true });
let code = 0;
try {
  console.log('Protecting the code…');
  for (const d of DIRS) obfuscateDir(path.join(root, d));
  console.log('Building Session for ' + (mac ? 'macOS' : 'Windows') + '…');
  // Call the locally-installed electron-builder directly (no npx, which can stop to ask to install in CI).
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
  const builder = fs.existsSync(bin) ? JSON.stringify(bin) : 'npx --yes electron-builder';
  cp.execSync(builder + ' ' + builderArgs + ' --publish ' + publish, { cwd: root, stdio: 'inherit', env });
} catch (e) {
  code = 1;
  console.error('Build failed:', e.message);
} finally {
  // always put the readable source back
  for (const d of DIRS) {
    fs.rmSync(path.join(root, d), { recursive: true, force: true });
    fs.cpSync(path.join(bak, d), path.join(root, d), { recursive: true });
  }
  fs.rmSync(bak, { recursive: true, force: true });
  console.log('Source restored.');
}
process.exit(code);
