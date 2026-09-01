'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceOverview } = require('../lib/workspace/overview-summary');

test('workspace overview keeps four platform libraries separate while aggregating safe totals', () => {
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
  assert.deepEqual(overview.platforms.map(platform => platform.id), ['tiktok_shop', 'youtube', 'instagram', 'x']);
  assert.equal(overview.totals.creators, 19);
  assert.equal(overview.totals.withEmail, 4);
  assert.equal(overview.totals.bytes, 160);
  assert.equal(overview.totals.connectedPlatforms, 3);
  assert.equal(overview.platforms.find(platform => platform.id === 'x').connection.state, 'needs_authorization');
});
