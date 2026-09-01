'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PlatformDatabaseManager } = require('../lib/database');
const { runXFixtureCollection } = require('../lib/tasks/x-fixture-collector');

const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

test('offline X worker persists public profile fields only into x.db', { skip: !pythonAvailable }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'x-fixture-flow-'));
  const manager = new PlatformDatabaseManager(directory);
  t.after(async () => {
    await manager.closeAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const result = await runXFixtureCollection({
    databaseManager: manager,
    pythonCommand,
    scenario: 'profile',
    region: 'US',
  });
  assert.deepEqual(
    { ok: result.ok, creators: result.creators, saved: result.database.saved },
    { ok: true, creators: 1, saved: 1 },
  );
  assert.equal(result.checkpoints[0].platform, 'x');
  assert.equal(result.checkpoints[0].payload.nativeId, '10001');

  const x = await manager.getRepository('x');
  const [shop, tiktok, instagram, youtube] = await Promise.all([
    manager.getRepository('tiktok_shop'), manager.getRepository('tiktok'),
    manager.getRepository('instagram'), manager.getRepository('youtube'),
  ]);
  const xRows = await x.listCreators({ region: 'US', limit: 20 });
  assert.equal(xRows.total, 1);
  assert.equal(xRows.rows[0].creator_id, '10001');
  assert.equal(xRows.rows[0].category, 'Home & Living');
  assert.equal(xRows.rows[0].vertical_category, 'Home & Living');
  assert.equal(xRows.rows[0].contact_email, 'fixture.creator@example.test');
  assert.equal(xRows.rows[0].categoryProvenance, 'fixture:description-keyword');
  assert.equal(xRows.rows[0].emailProvenance, 'fixture:public-profile');
  assert.equal('accountPoolRef' in xRows.rows[0], false);
  assert.equal('accountState' in xRows.rows[0], false);

  for (const repository of [shop, tiktok, instagram, youtube]) {
    assert.equal((await repository.listCreators({ region: 'US', limit: 20 })).total, 0);
  }
  const raw = await (await manager.getDatabase('x')).get(
    'SELECT raw_json FROM creators WHERE region = ? AND creator_id = ?', ['US', '10001'],
  );
  assert.equal(raw.raw_json.includes('x-local-pool'), false);
  assert.equal(raw.raw_json.includes('accountState'), false);
  assert.ok(fs.existsSync(path.join(directory, 'x.db')));
  assert.ok(fs.existsSync(path.join(directory, 'creators.db')));
});
