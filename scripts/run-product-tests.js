'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const product = require('../product.config');

const common = [
  'activity.test.js', 'collection-run-metrics.test.js', 'creator-persistence.test.js',
  'credentials.test.js', 'database.test.js', 'electron-credential-storage.test.js',
  'single-product-isolation.test.js', 'state-directory.test.js', 'worker-process-supervisor.test.js',
  'worker-protocol.test.js',
];
const platform = {
  tiktok_shop: ['task-supervisor.test.js'],
  instagram: ['hiker-instagram-collector.test.js', 'instagram-browser-profile-collector.test.js', 'instagram-collection-lane.test.js', 'instagram-cookie-import.test.js', 'instagram-cooldown.test.js', 'instagram-fixture-collection.integration.test.js', 'instagram-headless-discovery.test.js', 'instagram-idle-coverage-scheduler.test.js', 'instagram-public-discovery.test.js', 'instagram-public-endurance.test.js', 'instagram-worker-fixture.test.js', 'instagram-worker-production.test.js'],
  youtube: ['youtube-fixture-collection.integration.test.js', 'youtube-worker-fixture.test.js', 'youtube-worker-production.test.js'],
  x: ['x-fixture-collection.integration.test.js', 'x-worker-fixture.test.js', 'x-worker-production.test.js'],
  tiktok: ['tiktok-adapter.test.js', 'tiktok-fixture-collection.integration.test.js'],
}[product.platformId] || [];

const files = [...common, ...platform].map(file => path.join('test', file));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', shell: false });
process.exit(result.status === null ? 1 : result.status);
