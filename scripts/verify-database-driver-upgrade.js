'use strict';
// Cross-driver round trip uses generated fixtures only, never the production library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CreatorDatabase } = require('../lib/database');
const { exportCsv, exportXlsx } = require('../lib/exporter');

(async () => {
  const oldApp = path.resolve(process.argv[2] || '');
  const archive = path.join(oldApp, 'resources', 'app.asar');
  assert(fs.existsSync(archive), 'Pass the previous packaged application directory');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-driver-upgrade-'));
  const databaseFile = path.join(dir, 'synthetic-library.db');
  function oldDriver(mode) {
    const code = `
      const path = require('node:path');
      const archive = process.argv[1], file = process.argv[2], mode = process.argv[3];
      (async () => {
        if(mode === 'create') {
          const { CreatorDatabase } = require(archive + '/lib/database');
          const db = new CreatorDatabase(file);
          await db.open();
          await db.upsertCreators([{ creator_oecuid:'9007199254740993123', handle:'synthetic-a',
            nickname:'测试达人 日本語', follower_cnt:1234, '合作邮箱':'fixture@example.test',
            bio:'line one\\nline two' }], {region:'MY'});
          await db.upsertCreators([{ creator_oecuid:'9007199254740993123', handle:'synthetic-b',
            follower_cnt:5678 }], {region:'US'});
          await db.close();
          console.log(JSON.stringify({created:true}));
        } else {
          const sqlite = require(archive + '/node_modules/sqlite3');
          const db = new sqlite.Database(file, sqlite.OPEN_READONLY);
          const rows = await new Promise((resolve,reject) => db.all('SELECT * FROM creators ORDER BY region',
            (error,rows) => error ? reject(error) : resolve(rows)));
          await new Promise((resolve,reject) => db.close(error => error ? reject(error) : resolve()));
          console.log(JSON.stringify(rows));
        }
      })().catch(error => { console.error(error.message); process.exitCode=1; });
    `;
    const result = spawnSync(path.join(oldApp, 'TikTokShop达人抓取.exe'), ['-e', code, archive, databaseFile, mode],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  }
  oldDriver('create');
  const before = oldDriver('read');
  const db = new CreatorDatabase(databaseFile);
  try {
    await db.open();
    assert.equal((await db.getStats()).creators, 2);
    await db.updateCreatorContacts('MY', '9007199254740993123', {
      whatsapp: '00123456789', line: 'line-fixture', contact_status: '已获取',
    });
    const row = (await db.listCreators({region:'MY',hasWhatsapp:true})).rows[0];
    assert.equal(row.creator_id, '9007199254740993123');
    assert.equal(row.contact_email, 'fixture@example.test');
    const headers = ['creator_id', 'region', 'nickname', 'whatsapp', 'line', 'bio'];
    const csv = path.join(dir, 'synthetic.csv'), xlsx = path.join(dir, 'synthetic.xlsx');
    await exportCsv(csv, [row], headers);
    await exportXlsx(xlsx, [row], headers);
    assert.match(fs.readFileSync(csv,'utf8'), /00123456789/);
    const book = new (require('exceljs').Workbook)();
    await book.xlsx.readFile(xlsx);
    assert.equal(book.worksheets[0].getCell('A2').value, '9007199254740993123');
    assert.equal(book.worksheets[0].getCell('D2').value, '00123456789');
    assert.equal((await db.get('PRAGMA integrity_check')).integrity_check, 'ok');
  } finally { await db.close(); }
  const after = oldDriver('read');
  assert.equal(after.length, 2);
  assert.deepEqual(after.find(row=>row.region==='US'), before.find(row=>row.region==='US'));
  const my = after.find(row=>row.region==='MY');
  assert.equal(JSON.parse(my.raw_json).whatsapp, '00123456789');
  assert.equal(my.nickname, '测试达人 日本語');
  console.log(JSON.stringify({oldDriverCreate:true,newDriverUpdate:true,oldDriverReadback:true,
    unrelatedRowsUnchanged:true,integrityCheck:'ok',csvXlsxRoundTrip:true,fixtureRows:2,productionDbOpened:false}));
})().catch(error => { console.error(error.message); process.exitCode=1; });
