'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PlatformDatabaseManager } = require('../lib/database');
const { runYouTubeFixtureCollection } = require('../lib/tasks/youtube-fixture-collector');

const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

test('offline YouTube worker records persist into youtube.db and never appear in TikTok Shop', { skip: !pythonAvailable }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-fixture-flow-'));
  const manager = new PlatformDatabaseManager(directory);
  t.after(async () => {
    await manager.closeAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const result = await runYouTubeFixtureCollection({
    databaseManager: manager,
    pythonCommand,
    scenario: 'pagination',
    region: 'US',
  });
  assert.deepEqual({ ok: result.ok, creators: result.creators, saved: result.database.saved }, { ok: true, creators: 3, saved: 3 });
  assert.equal(result.checkpoints.length, 3);
  assert.ok(result.checkpoints.every(checkpoint => checkpoint.platform === 'youtube'));

  const youtube = await manager.getRepository('youtube');
  const shop = await manager.getRepository('tiktok_shop');
  const youtubeRows = await youtube.listCreators({ region: 'US', limit: 20 });
  const shopRows = await shop.listCreators({ region: 'US', limit: 20 });
  assert.equal(youtubeRows.total, 3);
  assert.equal(shopRows.total, 0);
  assert.deepEqual(youtubeRows.rows.map(row => row.creator_id).sort(), ['101', 'UC-garden-202', 'UC-studio-303']);
  const garden = youtubeRows.rows.find(row => row.creator_id === 'UC-garden-202');
  assert.equal(garden.nickname, 'Garden Notes');
  assert.equal(garden.follower_count, 2400);
  assert.equal(garden.platform, 'youtube');
  const trail = youtubeRows.rows.find(row => row.creator_id === '101');
  assert.equal(trail.bio, 'Outdoor cooking videos');
  assert.ok(fs.existsSync(path.join(directory, 'youtube.db')));
  assert.ok(fs.existsSync(path.join(directory, 'creators.db')));
});
