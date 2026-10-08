'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { verifySource, verifyPackagedResources } = require('../verify-third-party-release');

test('third-party source inventory is pinned to the dependency and Python locks', () => {
  const result = verifySource(root);
  assert.equal(result.inventory.project.license, 'GPL-3.0');
  assert.equal(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.length, 32);
  assert(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.some(entry => entry.name === 'ytscrape'));
  assert(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.some(entry => entry.name === 'instagrapi'));
  assert(result.inventory.generatedFrom.pythonRequirements.thirdPartyPackages.some(entry => entry.name === 'twscrape'));
});

test('packaged resource gate requires the reviewed notices and inventory', (t) => {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-resources-'));
  t.after(() => fs.rmSync(resources, { recursive: true, force: true }));
  verifySource(root);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party-inventory.json']) {
    fs.writeFileSync(path.join(resources, file), 'fixture');
  }
  assert.equal(verifyPackagedResources(resources, root).ok, true);
  fs.rmSync(path.join(resources, 'THIRD_PARTY_NOTICES.md'));
  assert.throws(() => verifyPackagedResources(resources, root), /packaged resource is missing/);
});
