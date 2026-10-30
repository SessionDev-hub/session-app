/* Writes dist/latest.json — the file the Android app checks to learn the newest version. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const { versionCode } = require('./android-version');
const gh = (JSON.parse(fs.readFileSync(path.join(root, 'updates.config.json'), 'utf8')).github) || {};
const ver = pkg.version;
const apk = 'Session-' + ver + '.apk';
const feed = {
  versionCode: versionCode(ver),
  versionName: ver,
  apk: 'https://github.com/' + gh.owner + '/' + gh.repo + '/releases/latest/download/' + apk,
  notes: process.argv.slice(2).join(' ') || '',
};
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'latest.json'), JSON.stringify(feed, null, 2));
console.log('dist/latest.json ->', feed.versionName, '(code ' + feed.versionCode + ')');
