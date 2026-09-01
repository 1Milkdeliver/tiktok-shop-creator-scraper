// Read-only verification of an electron-updater latest.yml and its staged files.
// Usage: node verify-release-metadata.js [--dist <directory>]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getDist(args) {
  if (args.length === 0) return path.join(__dirname, 'dist');
  if (args.length === 2 && args[0] === '--dist' && args[1]) return path.resolve(args[1]);
  throw new Error('usage: node verify-release-metadata.js [--dist <directory>]');
}

function requiredMatch(text, expression, field) {
  const match = text.match(expression);
  if (!match || !match[1]) throw new Error(`latest.yml is missing ${field}`);
  return match[1].trim();
}

function parseLatest(contents) {
  return {
    version: requiredMatch(contents, /^version:\s*(.+)$/m, 'version'),
    url: requiredMatch(contents, /^\s*- url:\s*(.+)$/m, 'files[0].url'),
    fileSha512: requiredMatch(contents, /^\s+sha512:\s*(.+)$/m, 'files[0].sha512'),
    size: requiredMatch(contents, /^\s+size:\s*(\d+)\s*$/m, 'files[0].size'),
    blockMapSize: requiredMatch(contents, /^\s+blockMapSize:\s*(\d+)\s*$/m, 'files[0].blockMapSize'),
    topLevelPath: requiredMatch(contents, /^path:\s*(.+)$/m, 'path'),
    topLevelSha512: requiredMatch(contents, /^sha512:\s*(.+)$/m, 'sha512'),
  };
}

function main() {
  const dist = getDist(process.argv.slice(2));
  const latestPath = path.join(dist, 'latest.yml');
  if (!fs.existsSync(latestPath)) {
    const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
    const installers = fs.readdirSync(dist).filter((file) => file.endsWith('.exe') && !file.startsWith('__uninstaller-') && file.includes(packageVersion));
    if (installers.length !== 1) throw new Error(`expected one local installer for ${packageVersion}, found ${installers.length}`);
    const installerPath = path.join(dist, installers[0]);
    const blockmapPath = `${installerPath}.blockmap`;
    if (!fs.existsSync(blockmapPath) || fs.statSync(installerPath).size === 0 || fs.statSync(blockmapPath).size === 0) throw new Error('local installer or block map is missing or empty');
    console.log(`verify-release: local installer OK ${installers[0]}`);
    return;
  }
  const latest = parseLatest(fs.readFileSync(latestPath, 'utf8'));
  const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
  if (latest.version !== packageVersion) throw new Error(`metadata version ${latest.version} does not match package.json version ${packageVersion}`);
  const expectedArtifact = `tiktok-shop-creator-scraper-setup-${latest.version}.exe`;
  if (latest.url !== expectedArtifact) throw new Error(`artifact URL ${latest.url} does not match metadata version ${latest.version}`);
  if (latest.url !== latest.topLevelPath) throw new Error(`path ${latest.topLevelPath} does not match files[0].url ${latest.url}`);
  if (latest.fileSha512 !== latest.topLevelSha512) throw new Error('top-level sha512 does not match files[0].sha512');
  if (path.basename(latest.url) !== latest.url || latest.url.includes('..')) throw new Error(`unsafe artifact URL in metadata: ${latest.url}`);

  const artifactPath = path.join(dist, latest.url);
  const blockmapPath = `${artifactPath}.blockmap`;
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) throw new Error(`artifact is missing: ${artifactPath}`);
  if (!fs.existsSync(blockmapPath) || !fs.statSync(blockmapPath).isFile()) throw new Error(`blockmap is missing: ${blockmapPath}`);
  const artifactSize = fs.statSync(artifactPath).size;
  const blockmapSize = fs.statSync(blockmapPath).size;
  const actualSha512 = crypto.createHash('sha512').update(fs.readFileSync(artifactPath)).digest('base64');
  if (String(artifactSize) !== latest.size) throw new Error(`artifact size mismatch: metadata=${latest.size}, actual=${artifactSize}`);
  if (String(blockmapSize) !== latest.blockMapSize) throw new Error(`blockmap size mismatch: metadata=${latest.blockMapSize}, actual=${blockmapSize}`);
  if (actualSha512 !== latest.fileSha512) throw new Error('artifact sha512 does not match latest.yml');
  console.log(`verify-release: OK ${latest.url} (version ${latest.version})`);
}

try { main(); } catch (error) { console.error(`verify-release: ${error.message}`); process.exitCode = 1; }
