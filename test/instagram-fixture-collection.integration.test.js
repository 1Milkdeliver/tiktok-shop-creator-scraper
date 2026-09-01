'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PlatformDatabaseManager } = require('../lib/database');
const { runInstagramFixtureCollection } = require('../lib/tasks/instagram-fixture-collector');

const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

test('offline Instagram worker persists public profile category/email provenance only into instagram.db', { skip: !pythonAvailable }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-fixture-flow-'));
  const manager = new PlatformDatabaseManager(directory);
  t.after(async () => {
    await manager.closeAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const result = await runInstagramFixtureCollection({ databaseManager: manager, pythonCommand, scenario: 'profile', region: 'US' });
  assert.deepEqual({ ok: result.ok, creators: result.creators, saved: result.database.saved }, { ok: true, creators: 1, saved: 1 });
  assert.equal(result.checkpoints[0].platform, 'instagram');

  const instagram = await manager.getRepository('instagram');
  const youtube = await manager.getRepository('youtube');
  const shop = await manager.getRepository('tiktok_shop');
  const instagramRows = await instagram.listCreators({ region: 'US', limit: 20 });
  assert.equal(instagramRows.total, 1);
  assert.equal((await youtube.listCreators({ region: 'US', limit: 20 })).total, 0);
  assert.equal((await shop.listCreators({ region: 'US', limit: 20 })).total, 0);
  const creator = instagramRows.rows[0];
  assert.equal(creator.creator_id, '884422');
  assert.equal(creator.handle, 'trail.kitchen');
  assert.equal(creator.category, 'Food & Beverage');
  assert.equal(creator.contact_email, 'hello@trailkitchen.example');
  // listCreators intentionally merges persisted raw provenance into its
  // response instead of exposing an implementation-only raw_json column.
  assert.equal(creator.source, 'instagram-fixture');
  assert.equal(creator.contact_email_provenance, 'public_profile');
  assert.equal(creator.category_provenance, 'public_profile');
  assert.ok(fs.existsSync(path.join(directory, 'instagram.db')));
  assert.ok(fs.existsSync(path.join(directory, 'youtube.db')));
  assert.ok(fs.existsSync(path.join(directory, 'creators.db')));
});
