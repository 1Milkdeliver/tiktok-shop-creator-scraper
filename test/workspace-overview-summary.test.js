'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceOverview } = require('../lib/workspace/overview-summary');

test('workspace overview reports only the TikTok Shop product library', () => {
  const overview = buildWorkspaceOverview({
    cookieCount: 2,
    socialAccounts: [{ platform: 'instagram' }],
    platformStats: {
      tiktok_shop: { creators: 10, with_email: 2, bytes: 100 },
      youtube: { creators: 3, with_email: 1, bytes: 20 },
      instagram: { creators: 4, with_email: 1, bytes: 30 },
      x: { creators: 2, with_email: 0, bytes: 10 },
    },
  });
  assert.deepEqual(overview.platforms.map(platform => platform.id), ['tiktok_shop']);
  assert.equal(overview.totals.creators, 10);
  assert.equal(overview.totals.withEmail, 2);
  assert.equal(overview.totals.bytes, 100);
  assert.equal(overview.totals.connectedPlatforms, 1);
  assert.equal(overview.platforms[0].connection.state, 'connected');
});
