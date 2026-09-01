'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PlatformDatabaseManager } = require('../lib/database');
const { runLocalPythonCollection } = require('../lib/tasks/local-python-collector');

test('local Python collection resolves the bundled YouTube worker and persists only after item events', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-python-collector-'));
  const manager = new PlatformDatabaseManager(directory);
  t.after(async () => { await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  const result = await runLocalPythonCollection({
    platformId: 'youtube', databaseManager: manager, region: 'US',
    payload: { fixtureMode: true, fixtureScenario: 'pagination' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.database.saved, 3);
  const rows = await (await manager.getRepository('youtube')).listCreators({ region: 'US', limit: 10 });
  assert.equal(rows.total, 3);
});
