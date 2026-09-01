'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const product = require('../product.config');
const { PLATFORM_IDS, PLATFORM_CATALOG } = require('../lib/platforms/catalog');
const { PLATFORM_DATABASE_FILENAMES } = require('../lib/database/router');
const { WORKSPACE_PLATFORM_IDS } = require('../lib/workspace/overview-summary');
const fs = require('node:fs');

test('the desktop product exposes only its configured platform and database', () => {
  assert.deepEqual(PLATFORM_IDS, [product.platformId]);
  assert.deepEqual(PLATFORM_CATALOG.map(platform => platform.id), [product.platformId]);
  assert.deepEqual(WORKSPACE_PLATFORM_IDS, [product.platformId]);
  assert.deepEqual(PLATFORM_DATABASE_FILENAMES, { [product.platformId]: product.databaseFile });
});

test('the monitor is scoped to the configured platform instead of a multi-platform wall', () => {
  const renderer = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.match(renderer, /availableCreatorPlatforms\.map\(platform => platform\.id\)\.slice\(0, 1\)/);
  assert.doesNotMatch(renderer, /tasks\.push\(\{ id: 'next-slot'/);
});
