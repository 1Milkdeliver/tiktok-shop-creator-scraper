'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CreatorPersistence, CreatorPersistenceError, PERSISTENCE_ERROR_CODES, normalizeYouTubeCreator, normalizeInstagramCreator,
  normalizeXCreator,
} = require('../lib/tasks/creator-persistence');

test('worker checkpoints are created only after a creator item commits', async () => {
  const calls = [];
  const persistence = new CreatorPersistence({
    platformId: 'youtube',
    repository: { upsertCreators: async (rows, options) => { calls.push({ rows, options }); return { inserted: 1, updated: 0 }; } },
  });
  const checkpoint = await persistence.persistItem({
    type: 'item', taskId: 'task-1', seq: 7, payload: { creator: { nativeId: 'UC123', handle: 'channel' } },
  }, { region: 'US', jobId: 'job-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rows[0].creator_oecuid, 'UC123');
  assert.deepEqual(checkpoint.payload, { sourceSequence: 7, nativeId: 'UC123', inserted: 1, updated: 0 });
});

test('YouTube worker fields are normalized into CreatorDatabase-compatible rows', () => {
  assert.deepEqual(normalizeYouTubeCreator({
    nativeId: 'UC-creator',
    displayName: 'Garden Channel',
    handle: '@garden',
    description: 'Plants and tools',
    stats: { subscriberCount: '12500', videoCount: '42' },
  }), {
    nativeId: 'UC-creator',
    displayName: 'Garden Channel',
    handle: '@garden',
    description: 'Plants and tools',
    stats: { subscriberCount: '12500', videoCount: '42' },
    creator_oecuid: 'UC-creator',
    nickname: 'Garden Channel',
    follower_cnt: '12500',
    units_sold: '42',
    简介: 'Plants and tools',
    合作邮箱: '',
    platform: 'youtube',
  });
});

test('Instagram public profile fields retain explicit email and category provenance', () => {
  const row = normalizeInstagramCreator({
    nativeId: '884422', handle: 'trail.kitchen', displayName: 'Trail Kitchen',
    biography: 'Outdoor cooking', followers: '12500', category: 'Food & Beverage',
    contact: { email: 'hello@trailkitchen.example' }, source: 'instagram-fixture',
  });
  assert.equal(row.creator_oecuid, '884422');
  assert.equal(row.follower_cnt, '12500');
  assert.equal(row.category, 'Food & Beverage');
  assert.equal(row['合作邮箱'], 'hello@trailkitchen.example');
  assert.equal(row.contact_email_provenance, 'public_profile');
  assert.equal(row.category_provenance, 'public_profile');
});

test('invalid or failed worker items never generate checkpoints', async () => {
  const persistence = new CreatorPersistence({ platformId: 'youtube', repository: { upsertCreators: async () => { throw new Error('disk failure'); } } });
  await assert.rejects(() => persistence.persistItem({ type: 'item', taskId: 'task', seq: 1, payload: { nativeId: 'UC123' } }), error => error instanceof CreatorPersistenceError && error.code === PERSISTENCE_ERROR_CODES.PERSIST_FAILED);
  await assert.rejects(() => persistence.persistItem({ type: 'item', taskId: 'task', seq: 1, payload: { nativeId: 12 } }), error => error instanceof CreatorPersistenceError && error.code === PERSISTENCE_ERROR_CODES.INVALID_ITEM);
});

test('X creator rows retain public-data provenance but discard account-pool state', () => {
  const normalized = normalizeXCreator({
    nativeId: 'x-creator', displayName: 'Fixture Creator', handle: '@fixture',
    description: 'Home organization and decor',
    stats: { followerCount: '1250', postCount: '33' },
    inferredCategory: 'Home & Living', categoryProvenance: 'fixture:description-keyword',
    publicEmail: 'hello@example.test', emailProvenance: 'fixture:public-profile',
    accountPoolRef: 'x-local-pool', accountState: 'assigned',
  });
  assert.equal(normalized.creator_oecuid, 'x-creator');
  assert.equal(normalized.category, 'Home & Living');
  assert.equal(normalized['垂直类目'], 'Home & Living');
  assert.equal(normalized['合作邮箱'], 'hello@example.test');
  assert.equal(normalized.categoryProvenance, 'fixture:description-keyword');
  assert.equal(normalized.emailProvenance, 'fixture:public-profile');
  assert.equal('accountPoolRef' in normalized, false);
  assert.equal('accountState' in normalized, false);
});
