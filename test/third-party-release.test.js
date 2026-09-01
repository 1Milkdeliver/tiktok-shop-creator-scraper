'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { verifySource, verifyPackagedResources } = require('../verify-third-party-release');
const { readManifest } = require('../lib/runtime/python-runtime');

test('third-party source inventory is pinned to the dependency and Python locks', () => {
  const result = verifySource(root);
  assert.equal(result.inventory.project.license, 'GPL-3.0');
  assert.equal(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.length, 32);
  assert(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.some(entry => entry.name === 'ytscrape'));
  assert(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.some(entry => entry.name === 'instagrapi'));
  assert(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.some(entry => entry.name === 'twscrape'));
});

test('packaged resource gate requires notices and a complete Python runtime', (t) => {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-resources-'));
  t.after(() => fs.rmSync(resources, { recursive: true, force: true }));
  const source = verifySource(root);
  const manifest = readManifest();
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party-inventory.json']) {
    fs.writeFileSync(path.join(resources, file), 'fixture');
  }
  const runtimeRoot = path.join(resources, manifest.resourceDirectory);
  for (const relativePath of [manifest.executables[process.platform], ...manifest.requiredFiles]) {
    const target = path.join(runtimeRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (relativePath === manifest.executables[process.platform]) {
      fs.copyFileSync(path.join(root, manifest.developmentDirectory, relativePath), target);
    } else fs.writeFileSync(target, 'fixture');
  }
  for (const entry of source.inventory.generatedFrom.pythonRequirements.thirdPartyPackages) {
    const metadata = path.join(runtimeRoot, 'site-packages', `${entry.name.replace(/-/g, '_')}-${entry.lockedVersion}.dist-info`, 'METADATA');
    fs.mkdirSync(path.dirname(metadata), { recursive: true });
    fs.writeFileSync(metadata, `Name: ${entry.name}\nVersion: ${entry.lockedVersion}\n`);
  }
  assert.equal(verifyPackagedResources(resources, root).ok, true);
  const unexpectedMetadata = path.join(runtimeRoot, 'site-packages', 'unexpected-1.0.0.dist-info', 'METADATA');
  fs.mkdirSync(path.dirname(unexpectedMetadata), { recursive: true });
  fs.writeFileSync(unexpectedMetadata, 'Name: unexpected\nVersion: 1.0.0\n');
  assert.throws(() => verifyPackagedResources(resources, root), /exactly match the reviewed Python dependency lock/);
  fs.rmSync(path.dirname(unexpectedMetadata), { recursive: true, force: true });
  fs.rmSync(path.join(resources, 'THIRD_PARTY_NOTICES.md'));
  assert.throws(() => verifyPackagedResources(resources, root), /packaged resource is missing/);
});
