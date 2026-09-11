// prepare-release.js — generate latest.yml with blockMapSize + stage assets for release
// Usage: node prepare-release.js <version>   (e.g. node prepare-release.js 1.1.12)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const version = process.argv[2];
if (!version) { console.error('usage: node prepare-release.js <version>'); process.exit(1); }

const dist = path.join(__dirname, 'dist');
// installer produced by electron-builder (Chinese artifact name)
const zhName = `TikTokShop达人抓取安装程序-${version}.exe`;
const zhPath = path.join(dist, zhName);
if (!fs.existsSync(zhPath)) { console.error('not found:', zhPath); process.exit(1); }

// canonical ASCII name used by electron-updater (must match latest.yml "url")
const asciiName = `tiktok-shop-creator-scraper-setup-${version}.exe`;
const asciiPath = path.join(dist, asciiName);
const blockmapPath = asciiPath + '.blockmap';

// 1) copy installer to the ASCII name the updater expects
fs.copyFileSync(zhPath, asciiPath);
console.log('staged', asciiName, fs.statSync(asciiPath).size, 'bytes');

// 2) copy the blockmap that electron-builder generated for the zh installer
const zhBlockmap = path.join(dist, zhName + '.blockmap');
if (!fs.existsSync(zhBlockmap)) { console.error('missing blockmap:', zhBlockmap); process.exit(1); }
fs.copyFileSync(zhBlockmap, blockmapPath);
console.log('staged', path.basename(blockmapPath), fs.statSync(blockmapPath).size, 'bytes');

// 3) compute sha512 (base64) of the installer
const sha512 = crypto.createHash('sha512').update(fs.readFileSync(asciiPath)).digest('base64');

// 4) write latest.yml with blockMapSize so electron-updater can do differential updates
const latest = `version: ${version}
files:
  - url: ${asciiName}
    sha512: ${sha512}
    size: ${fs.statSync(asciiPath).size}
    blockMapSize: ${fs.statSync(blockmapPath).size}
path: ${asciiName}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`;
fs.writeFileSync(path.join(dist, 'latest.yml'), latest, 'utf8');
console.log('wrote latest.yml (with blockMapSize)');
console.log('---');
console.log(latest);
console.log('Release assets ready: ', [asciiName, path.basename(blockmapPath), 'latest.yml'].join(' + '));
