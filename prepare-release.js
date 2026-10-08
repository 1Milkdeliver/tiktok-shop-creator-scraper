// Generate electron-updater metadata for the canonical installer produced by
// electron-builder. Keeping artifact names unchanged enables differential updates.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`prepare-release: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const version = args.shift();
if (!version) fail('usage: node prepare-release.js <version> [--dist <directory>]');

let dist = path.join(__dirname, 'dist');
if (args.length) {
  if (args.length !== 2 || args[0] !== '--dist' || !args[1]) {
    fail('usage: node prepare-release.js <version> [--dist <directory>]');
  }
  dist = path.resolve(args[1]);
}

const packageVersion = require('./package.json').version;
if (version !== packageVersion) {
  fail(`requested version ${version} does not match package.json version ${packageVersion}`);
}

const artifact = `tiktok-shop-creator-scraper-setup-${version}.exe`;
const artifactPath = path.join(dist, artifact);
const blockmapPath = `${artifactPath}.blockmap`;
if (!fs.existsSync(artifactPath)) fail(`installer not found: ${artifactPath}`);
if (!fs.existsSync(blockmapPath)) fail(`blockmap not found: ${blockmapPath}`);

const artifactSize = fs.statSync(artifactPath).size;
const blockMapSize = fs.statSync(blockmapPath).size;
const sha512 = crypto.createHash('sha512').update(fs.readFileSync(artifactPath)).digest('base64');
const latest = `version: ${version}
files:
  - url: ${artifact}
    sha512: ${sha512}
    size: ${artifactSize}
    blockMapSize: ${blockMapSize}
path: ${artifact}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`;
fs.writeFileSync(path.join(dist, 'latest.yml'), latest, 'utf8');
console.log(`prepare-release: staged ${artifact} (${artifactSize} bytes)`);
console.log(`prepare-release: staged ${path.basename(blockmapPath)} (${blockMapSize} bytes)`);
console.log('prepare-release: wrote latest.yml with differential-update metadata');
