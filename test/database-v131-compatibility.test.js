'use strict';

// Regression baseline for databases created before the v1.3.x Creator Library
// changes.  This deliberately uses a v1-shaped SQLite file instead of a fresh
// database so that the real migration path is exercised.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { CreatorDatabase } = require('../lib/database');
const { MIGRATIONS } = require('../lib/database/migrations');

function openSqlite(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, error => error ? reject(error) : resolve(db));
  });
}

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

function close(db) {
  return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

test('v1.3.1 compatibility: default Creator Library path remains under userData/data', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(
    mainSource,
    /new PlatformDatabaseManager\(path\.join\(app\.getPath\('userData'\), 'data'\)\)/,
    'the application must continue opening the existing per-user Creator Library database'
  );
  assert.match(mainSource, /getDatabase\('tiktok_shop'\)/);
  const { resolvePlatformDatabasePath } = require('../lib/database');
  assert.equal(resolvePlatformDatabasePath(path.join('userData', 'data'), 'tiktok_shop'), path.join('userData', 'data', 'creators.db'));
});

test('v1.3.1 compatibility: a v1 database migrates without losing creator or job data', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-db-v131-compat-'));
  const file = path.join(dir, 'creators.db');
  let legacyDb;
  let db;
  t.after(async () => {
    if (legacyDb) await close(legacyDb);
    if (db) await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  legacyDb = await openSqlite(file);
  await exec(legacyDb, MIGRATIONS[0].sql);
  await run(legacyDb,
    'INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)',
    [1, MIGRATIONS[0].name, '2026-01-01T00:00:00.000Z']
  );
  await run(legacyDb,
    'INSERT INTO scrape_jobs(id, status, region, config_json, started_at) VALUES(?, ?, ?, ?, ?)',
    ['legacy-job', 'completed', 'US', JSON.stringify({ shopRegion: 'US', keywords: ['legacy'] }), '2026-01-01T00:00:00.000Z']
  );
  await run(legacyDb, `
    INSERT INTO creators(
      region, creator_id, handle, nickname, category, follower_count, total_gmv,
      units_sold, contact_email, raw_json, first_seen_at, last_seen_at,
      last_refreshed_at, source_job_id
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'US', 'legacy-creator', 'legacy_handle', 'Legacy Creator', 'Beauty', 12000, 3456,
    78, 'legacy@example.com', JSON.stringify({ creator_oecuid: 'legacy-creator', custom_field: 'kept' }),
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'legacy-job',
  ]);
  await close(legacyDb);
  legacyDb = null;

  db = new CreatorDatabase(file);
  await db.open();

  assert.deepEqual(
    (await db.all('SELECT version, name FROM schema_migrations ORDER BY version')).map(row => row.version),
    MIGRATIONS.map(migration => migration.version),
    'all historical migrations must be recorded exactly once'
  );
  const columns = (await db.all('PRAGMA table_info(creators)')).map(row => row.name);
  assert.ok(columns.includes('last_publish_at'));
  assert.ok(columns.includes('activity_status'));
  assert.ok(columns.includes('activity_reason'));
  assert.ok(columns.includes('vertical_category'));

  const legacy = await db.listCreators({ region: 'US', search: 'legacy_handle' });
  assert.equal(legacy.total, 1);
  assert.equal(legacy.rows[0].creator_id, 'legacy-creator');
  assert.equal(legacy.rows[0].contact_email, 'legacy@example.com');
  assert.equal(legacy.rows[0].custom_field, 'kept');
  assert.equal((await db.listScrapeJobs({ region: 'US' })).rows[0].id, 'legacy-job');

  await db.upsertCreators([{
    creator_oecuid: 'current-creator',
    handle: 'current_handle',
    follower_cnt: '2.5K',
    med_gmv_revenue: '$10K',
    '垂直类目': 'Skin Care',
  }], { region: 'US' });
  const current = await db.listCreators({ region: 'US', search: 'current_handle' });
  assert.equal(current.total, 1);
  assert.equal(current.rows[0].follower_count, 2500);
  assert.equal(current.rows[0].total_gmv, 10000);
  assert.equal(current.rows[0].vertical_category, 'Skin Care');
});
