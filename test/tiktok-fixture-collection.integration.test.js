'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PlatformDatabaseManager } = require('../lib/database');
const { runTikTokFixtureCollection } = require('../lib/tasks/tiktok-fixture-collector');

test('public TikTok fixture records persist only in tiktok.db', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-fixture-flow-'));
  const manager = new PlatformDatabaseManager(directory);
  t.after(async () => { await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  const result = await runTikTokFixtureCollection({ databaseManager: manager, region: 'US' });
  assert.equal(result.ok, true);
  assert.equal(result.creators, 2);
  const tiktok = await manager.getRepository('tiktok');
  const shop = await manager.getRepository('tiktok_shop');
  const rows = await tiktok.listCreators({ region: 'US', limit: 10 });
  assert.equal(rows.total, 2);
  assert.equal((await shop.listCreators({ region: 'US', limit: 10 })).total, 0);
  const garden = rows.rows.find(row => row.creator_id === 'tt-public-101');
  assert.equal(garden.contact_email, 'hello@gardenday.example');
  assert.equal(garden.follower_count, 18200);
  assert.ok(fs.existsSync(path.join(directory, 'tiktok.db')));
});
