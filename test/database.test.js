'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CreatorDatabase } = require('../lib/database');

test('creator database migrates, deduplicates and filters creators', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-db-test-'));
  const file = path.join(dir, 'creators.db');
  const db = new CreatorDatabase(file);
  t.after(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await db.open();
  const jobId = await db.createScrapeJob({ shopRegion: 'US', keywords: ['beauty'] });

  await db.upsertCreators([{
    creator_oecuid: '123',
    handle: 'first_handle',
    nickname: 'Creator One',
    follower_cnt: '12.5K',
    med_gmv_revenue: { value: '42000' },
    '合作邮箱': 'hello@example.com',
  }], { region: 'US', jobId });

  await db.upsertCreators([{
    creator_oecuid: '123',
    handle: 'updated_handle',
    nickname: '',
    follower_cnt: '13K',
    med_gmv_revenue: '$45K',
  }], { region: 'US', jobId });

  await db.upsertCreators([{
    creator_oecuid: '123',
    handle: 'must_not_replace_handle',
    follower_cnt: '14K',
    med_gmv_revenue: '$99K',
  }], { region: 'US', jobId, updateFields: ['follower_cnt'] });

  const result = await db.listCreators({ region: 'US', search: 'updated', hasEmail: true });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].creator_id, '123');
  assert.deepEqual(await db.listCreatorIds({ region: 'US' }), ['123']);
  assert.equal(result.rows[0].handle, 'updated_handle');
  assert.equal(result.rows[0].nickname, 'Creator One');
  assert.equal(result.rows[0].contact_email, 'hello@example.com');
  assert.equal(result.rows[0].follower_count, 14000);
  assert.equal(result.rows[0].total_gmv, 45000);
  assert.equal(result.rows[0].handle, 'updated_handle');
  assert.equal(result.rows[0].med_gmv_revenue, '$45K');
  assert.deepEqual(await db.getCreatorIds('US'), ['123']);

  const jobs = await db.listScrapeJobs({ region: 'US' });
  assert.equal(jobs.total, 1);
  assert.equal(jobs.rows[0].id, jobId);
  assert.deepEqual(jobs.rows[0].config.keywords, ['beauty']);
  assert.equal(jobs.rows[0].config.cookieFiles, undefined);

  await db.finishScrapeJob(jobId, { ok: true, creators: 1, database: { saved: 1 } });
  const stats = await db.getStats();
  assert.equal(stats.creators, 1);
  assert.equal(stats.with_email, 1);
  assert.equal(stats.jobs.completed, 1);
  assert.ok(stats.bytes > 0);
});

test('creator database groups vertical categories under their observed top-level categories', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-category-tree-test-'));
  const file = path.join(dir, 'creators.db');
  const db = new CreatorDatabase(file);
  t.after(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await db.open();
  await db.upsertCreators([
    { creator_oecuid: 'home-1', category: 'Home Supplies', '垂直类目': 'Bathroom Supplies | Home Decor' },
    { creator_oecuid: 'home-2', category: 'Home Supplies', '垂直类目': 'Home Decor | Laundry Tools' },
    { creator_oecuid: 'beauty-1', category: 'Beauty & Personal Care', '垂直类目': 'Skin Care' },
  ], { region: 'US' });

  assert.deepEqual(await db.getCategoryTree(), [
    { value: 'Beauty & Personal Care', children: ['Skin Care'] },
    { value: 'Home Supplies', children: ['Bathroom Supplies', 'Home Decor', 'Laundry Tools'] },
  ]);

  const verticalMatch = await db.listCreators({
    fieldFilters: { '垂直类目': ['Home Decor'] },
  });
  assert.equal(verticalMatch.total, 2);
  assert.deepEqual(verticalMatch.rows.map(row => row.creator_id).sort(), ['home-1', 'home-2']);
});
