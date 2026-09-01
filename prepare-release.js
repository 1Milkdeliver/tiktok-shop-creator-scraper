// Generate update metadata and stage the ASCII-named assets required by electron-updater.
// Usage: node prepare-release.js <version> [--dist <directory>]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArguments(args) {
  const positional = [];
  let dist = path.join(__dirname, 'dist');
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--dist') {
      const supplied = args[++index];
      if (!supplied) throw new Error('missing directory after --dist');
      dist = path.resolve(supplied);
    } else positional.push(args[index]);
  }
  if (positional.length !== 1) throw new Error('usage: node prepare-release.js <version> [--dist <directory>]');
  return { version: positional[0], dist };
}

function requireRegularFile(filePath, description) {
  let stats;
  try { stats = fs.statSync(filePath); } catch (_) { throw new Error(`${description} is missing: ${filePath}`); }
  if (!stats.isFile()) throw new Error(`${description} is not a file: ${filePath}`);
  if (stats.size === 0) throw new Error(`${description} is empty: ${filePath}`);
  return stats;
}

function getPackageVersion() {
  const packagePath = path.join(__dirname, 'package.json');
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) throw new Error('package.json has no non-empty version');
    return packageJson.version;
  } catch (error) { throw new Error(`cannot read package metadata (${packagePath}): ${error.message}`); }
}

function main() {
  const { version, dist } = parseArguments(process.argv.slice(2));
  const packageVersion = getPackageVersion();
  if (version !== packageVersion) throw new Error(`version argument ${JSON.stringify(version)} does not match package.json version ${JSON.stringify(packageVersion)}`);
  if (!fs.existsSync(dist) || !fs.statSync(dist).isDirectory()) throw new Error(`distribution directory is missing or not a directory: ${dist}`);

  const zhName = `TikTokShop达人抓取安装程序-${version}.exe`;
  const zhPath = path.join(dist, zhName);
  const zhBlockmap = `${zhPath}.blockmap`;
  const asciiName = `tiktok-shop-creator-scraper-setup-${version}.exe`;
  const asciiPath = path.join(dist, asciiName);
  const blockmapPath = `${asciiPath}.blockmap`;
  requireRegularFile(zhPath, 'installer input');
  requireRegularFile(zhBlockmap, 'blockmap input');

  fs.copyFileSync(zhPath, asciiPath);
  const installerStats = requireRegularFile(asciiPath, 'staged installer');
  fs.copyFileSync(zhBlockmap, blockmapPath);
  const blockmapStats = requireRegularFile(blockmapPath, 'staged blockmap');
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(asciiPath)).digest('base64');
  const latest = `version: ${version}
files:
  - url: ${asciiName}
    sha512: ${sha512}
    size: ${installerStats.size}
    blockMapSize: ${blockmapStats.size}
path: ${asciiName}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`;
  fs.writeFileSync(path.join(dist, 'latest.yml'), latest, 'utf8');
  console.log(`prepare-release: staged ${asciiName} and ${path.basename(blockmapPath)}`);
  console.log('prepare-release: wrote latest.yml; run "npm run verify-release -- --dist <directory>" before publishing.');
}

try { main(); } catch (error) { console.error(`prepare-release: ${error.message}`); process.exitCode = 1; }
