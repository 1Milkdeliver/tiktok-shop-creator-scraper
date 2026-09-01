'use strict';

// Release-gate coverage for the local-first storage boundary.  These tests
// deliberately use a fresh directory: a new platform must neither skip a
// historical migration nor inherit data from another platform database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MIGRATIONS } = require('../lib/database/migrations');
const { PlatformDatabaseManager } = require('../lib/database');
const { WorkerProcessSupervisor } = require('../lib/workers');
const { runInstagramFixtureCollection } = require('../lib/tasks/instagram-fixture-collector');
const { runYouTubeFixtureCollection } = require('../lib/tasks/youtube-fixture-collector');
const { runXFixtureCollection } = require('../lib/tasks/x-fixture-collector');

const platformIds = ['tiktok_shop', 'tiktok', 'instagram', 'youtube', 'x'];
const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;
const workerRoot = path.join(__dirname, '..', 'runtime', 'python', 'workers');

function migrationVersions(database) {
  return database.all('SELECT version FROM schema_migrations ORDER BY version')
    .then(rows => rows.map(row => row.version));
}

test('all five platform databases migrate idempotently and retain isolated rows after reopening', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-migration-gate-'));
  const manager = new PlatformDatabaseManager(directory);
  const expectedMigrations = MIGRATIONS.map(migration => migration.version);
  let reopenedManager = null;
  t.after(async () => {
    await reopenedManager?.closeAll();
    await manager.closeAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const opened = new Map();
  for (const platformId of platformIds) {
    const repository = await manager.getRepository(platformId);
    const database = await manager.getDatabase(platformId);
    opened.set(platformId, database);
    await repository.upsertCreators([{
      creator_oecuid: `${platformId}-native-id`,
      handle: `${platformId}-creator`,
    }], { region: 'US' });

    assert.deepEqual(await migrationVersions(database), expectedMigrations, `${platformId} has every migration once`);
    await database.migrate();
    await database.migrate();
    assert.deepEqual(await migrationVersions(database), expectedMigrations, `${platformId} migrations remain idempotent`);
  }

  await manager.closeAll();
  assert.equal(manager.databases.size, 0);
  assert.equal(manager.repositories.size, 0);
  for (const database of opened.values()) assert.equal(database.db, null, 'manager closes each SQLite handle');

  reopenedManager = new PlatformDatabaseManager(directory);
  for (const platformId of platformIds) {
    const repository = await reopenedManager.getRepository(platformId);
    const database = await reopenedManager.getDatabase(platformId);
    assert.deepEqual(await migrationVersions(database), expectedMigrations, `${platformId} reopens without duplicate migrations`);
    const result = await repository.listCreators({ region: 'US', limit: 10 });
    assert.equal(result.total, 1, `${platformId} retained its own row`);
    assert.equal(result.rows[0].creator_id, `${platformId}-native-id`);
  }
});

function createFixtureSupervisor(platformId) {
  return new WorkerProcessSupervisor({
    command: pythonCommand,
    args: [path.join(workerRoot, `${platformId}_worker.py`)],
    cwd: workerRoot,
    startupTimeoutMs: 2_000,
    shutdownTimeoutMs: 1_000,
    killTimeoutMs: 250,
  });
}

test('fixture collection closes worker children and releases database manager resources', { skip: !pythonAvailable }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-resource-gate-'));
  const manager = new PlatformDatabaseManager(directory);
  const supervisors = [];
  t.after(async () => {
    await Promise.all(supervisors.map(supervisor => supervisor.shutdown().catch(() => {})));
    await manager.closeAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const collections = [
    ['instagram', 'profile', runInstagramFixtureCollection],
    ['youtube', 'pagination', runYouTubeFixtureCollection],
    ['x', 'profile', runXFixtureCollection],
  ];
  for (const [platformId, scenario, collect] of collections) {
    const supervisor = createFixtureSupervisor(platformId);
    supervisors.push(supervisor);
    const result = await collect({
      databaseManager: manager,
      pythonCommand,
      scenario,
      region: 'US',
      supervisor,
    });
    assert.equal(result.ok, true, `${platformId} fixture completed`);
    // The collector owns injected supervisors only for the duration of this
    // call.  A non-null child here would leave a background Python process.
    assert.equal(supervisor.running, false, `${platformId} worker is not running after collection`);
    assert.equal(supervisor.child, null, `${platformId} worker child was released after collection`);
    assert.equal(supervisor.listenerCount('event'), 0, `${platformId} event listener was released after collection`);
  }

  const handles = [...manager.databases.values()];
  await manager.closeAll();
  assert.equal(manager.databases.size, 0);
  assert.equal(manager.repositories.size, 0);
  for (const database of handles) assert.equal(database.db, null, 'manager closed an opened database after fixture collection');
});
