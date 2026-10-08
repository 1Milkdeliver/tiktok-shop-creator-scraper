'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const product = require('../product.config');

const testDirectory = path.join(__dirname, '..', 'test');
const allTests = fs.readdirSync(testDirectory).filter(file => file.endsWith('.test.js')).sort();

// The original source project contained five products.  Standalone packages
// deliberately keep their own release gate: a TikTok Shop release must not
// start Instagram/YouTube/X workers or assert the retired five-tab UI.  Every
// other Shop test remains included, so contacts, profiles, persistence,
// updates and browser stability are still exercised by `npm test`.
const exclusions = {
  tiktok_shop: [
    /^(?:hiker-|instagram-|youtube-|x-|tiktok-adapter|tiktok-fixture)/,
    /^(?:local-python|python-runtime|python-worker|local-automated-gates)/,
    /^(?:database-routing|platform-contract|platform-ui-contract)\.test\.js$/,
  ],
};
const excluded = exclusions[product.platformId] || [];
const files = allTests
  .filter(file => !excluded.some(pattern => pattern.test(file)))
  .map(file => path.join('test', file));

if (!files.length) {
  console.error(`No tests selected for ${product.platformId}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', shell: false });
process.exit(result.status === null ? 1 : result.status);
