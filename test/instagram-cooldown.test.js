'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertInstagramAvailable, nextInstagramCooldown, normalizeCooldown } = require('../lib/tasks/instagram-cooldown');

test('Instagram cooldown blocks repeated starts until the persisted retry time', () => {
  assert.throws(() => assertInstagramAvailable({ retryAt: 2_000 }, 1_000), error => error.code === 'INSTAGRAM_COOLDOWN' && error.retryAt === 2_000);
  assert.equal(normalizeCooldown({ retryAt: 1_000 }, 1_000), null);
});

test('only known provider throttling creates a persisted Instagram cooldown', () => {
  assert.deepEqual(nextInstagramCooldown({ code: 'THROTTLED' }, 1_000, 60_000), { retryAt: 61_000, code: 'THROTTLED' });
  assert.equal(nextInstagramCooldown({ code: 'AUTH_REQUIRED' }, 1_000), null);
  assert.equal(nextInstagramCooldown({ code: 'HIKER_THROTTLED' }, 1_000), null);
});
