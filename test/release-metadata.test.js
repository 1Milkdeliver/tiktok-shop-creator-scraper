'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const prepare = path.join(root, 'prepare-release.js');
const verify = path.join(root, 'verify-release-metadata.js');
const version = require(path.join(root, 'package.json')).version;

function fixture() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'release-metadata-'));
  const installer = `tiktok-shop-creator-scraper-setup-${version}.exe`;
  fs.writeFileSync(path.join(dist, installer), 'fixture installer bytes');
  fs.writeFileSync(path.join(dist, `${installer}.blockmap`), 'fixture blockmap bytes');
  return dist;
}
function run(script, ...args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }

test('prepare-release writes metadata that matches staged artifacts', (t) => {
  const dist = fixture();
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const prepared = run(prepare, version, '--dist', dist);
  assert.equal(prepared.status, 0, prepared.stderr);
  const checked = run(verify, '--dist', dist);
  assert.equal(checked.status, 0, checked.stderr);
});

test('prepare-release rejects a version different from package.json', (t) => {
  const dist = fixture();
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const result = run(prepare, '0.0.0', '--dist', dist);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package\.json version/);
});

test('verify-release rejects metadata with an incorrect sha512', (t) => {
  const dist = fixture();
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const artifact = `tiktok-shop-creator-scraper-setup-${version}.exe`;
  const artifactPath = path.join(dist, artifact);
  const payload = Buffer.from('fixture installer bytes');
  fs.writeFileSync(artifactPath, payload);
  fs.writeFileSync(`${artifactPath}.blockmap`, 'fixture blockmap bytes');
  fs.writeFileSync(path.join(dist, 'latest.yml'), `version: ${version}\nfiles:\n  - url: ${artifact}\n    sha512: incorrect\n    size: ${payload.length}\n    blockMapSize: 22\npath: ${artifact}\nsha512: incorrect\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`);
  const result = run(verify, '--dist', dist);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sha512/);
});

test('verify-release rejects metadata whose version does not match the staged artifact', (t) => {
  const dist = fixture();
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const prepared = run(prepare, version, '--dist', dist);
  assert.equal(prepared.status, 0, prepared.stderr);
  const latestPath = path.join(dist, 'latest.yml');
  fs.writeFileSync(latestPath, fs.readFileSync(latestPath, 'utf8').replace(`version: ${version}`, 'version: 0.0.0'));
  const result = run(verify, '--dist', dist);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /metadata version/);
});
