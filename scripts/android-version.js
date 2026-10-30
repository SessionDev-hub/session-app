// Maps a semver string "major.minor.patch" to an Android versionCode integer.
// 0.9.0 -> 900, 0.9.1 -> 901, 1.0.0 -> 10000, 1.2.3 -> 10203.
function versionCode(v) {
  const [a = 0, b = 0, c = 0] = String(v).split('.').map((n) => parseInt(n, 10) || 0);
  return a * 10000 + b * 100 + c;
}
if (require.main === module) {
  const pkg = require('../package.json');
  process.stdout.write(String(versionCode(pkg.version)));
}
module.exports = { versionCode };
