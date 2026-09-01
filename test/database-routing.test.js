'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PLATFORM_DATABASE_FILENAMES,
  getPlatformDatabaseFilename,
  resolvePlatformDatabasePath,
  PlatformDatabaseManager,
} = require('../lib/database');

test('database router gives every supported platform an explicit isolated filename', () => {
  assert.deepEqual(PLATFORM_DATABASE_FILENAMES, {
    tiktok_shop: 'creators.db',
    tiktok: 'tiktok.db',
    instagram: 'instagram.db',
    youtube: 'youtube.db',
    x: 'x.db',
  });
  assert.equal(getPlatformDatabaseFilename('tiktok_shop'), 'creators.db');
  assert.equal(resolvePlatformDatabasePath('C:\\data', 'instagram'), path.join('C:\\data', 'instagram.db'));
  assert.throws(() => getPlatformDatabaseFilename('facebook'), /Unsupported platform ID/);
});

test('platform repositories store identical native IDs in separate physical databases', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-db-routing-test-'));
  const manager = new PlatformDatabaseManager(directory);
  t.after(async () => {
    await manager.closeAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const shop = await manager.getRepository('tiktok_shop');
  const instagram = await manager.getRepository('instagram');
  assert.notEqual(shop.database, instagram.database);
  assert.equal(shop.database.filePath, path.join(directory, 'creators.db'));
  assert.equal(instagram.database.filePath, path.join(directory, 'instagram.db'));

  await shop.upsertCreators([{
    creator_oecuid: 'same-native-id',
    handle: 'shop_creator',
    follower_cnt: '1K',
  }], { region: 'US' });
  await instagram.upsertCreators([{
    creator_oecuid: 'same-native-id',
    handle: 'instagram_creator',
    follower_cnt: '2K',
  }], { region: 'US' });

  const shopRows = await shop.listCreators({ region: 'US' });
  const instagramRows = await instagram.listCreators({ region: 'US' });
  assert.equal(shopRows.total, 1);
  assert.equal(instagramRows.total, 1);
  assert.equal(shopRows.rows[0].handle, 'shop_creator');
  assert.equal(instagramRows.rows[0].handle, 'instagram_creator');

  await shop.upsertCreators([{
    creator_oecuid: 'same-native-id',
    handle: 'shop_creator_updated',
  }], { region: 'US' });
  assert.equal((await shop.listCreators({ region: 'US' })).rows[0].handle, 'shop_creator_updated');
  assert.equal((await instagram.listCreators({ region: 'US' })).rows[0].handle, 'instagram_creator');
  assert.ok(fs.existsSync(path.join(directory, 'creators.db')));
  assert.ok(fs.existsSync(path.join(directory, 'instagram.db')));
});

test('database manager is lazy, caches per-platform instances, and closes an isolated database', async (t) => {
  const created = [];
  const manager = new PlatformDatabaseManager('virtual-data', {
    createDatabase(filePath, platformId) {
      const database = {
        filePath,
        platformId,
        opened: 0,
        closed: 0,
        async open() { this.opened++; },
        async close() { this.closed++; },
      };
      created.push(database);
      return database;
    },
  });
  t.after(() => manager.closeAll());

  const [first, second] = await Promise.all([
    manager.getDatabase('youtube'),
    manager.getDatabase('youtube'),
  ]);
  assert.equal(first, second);
  assert.equal(created.length, 1);
  assert.equal(first.opened, 1);
  await manager.close('youtube');
  assert.equal(first.closed, 1);
  const replacement = await manager.getDatabase('youtube');
  assert.notEqual(replacement, first);
  assert.equal(created.length, 2);
});
