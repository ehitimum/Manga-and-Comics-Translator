// Generates extension/build-info.json on every build.
// The build ID is a timestamp slug — visible in the popup footer so you can
// confirm at a glance which build is loaded into the browser.

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const now = new Date();

const pad = (n) => String(n).padStart(2, '0');
const buildId = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  '-',
  pad(now.getHours()),
  pad(now.getMinutes()),
  pad(now.getSeconds()),
].join('');

const info = {
  version: pkg.version,
  buildId,
  buildTime: now.toISOString(),
};

const outPath = path.join(__dirname, '..', 'extension', 'build-info.json');
fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n');
console.log('[build-info]', info);
