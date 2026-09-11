'use strict';
// Offline audit: open the retained library and pre-run backup read-only.
// Prints aggregate metrics only; never reads sessions or requests platform data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('sqlite3');
const ExcelJS = require('exceljs');
const { normalizeValue } = require('../lib/exporter');

async function main() {
  const [resultsArgument, databaseArgument] = process.argv.slice(2);
  assert(resultsArgument && databaseArgument, 'Pass completed result directory and retained library');
  const directory = path.resolve(resultsArgument), databaseFile = path.resolve(databaseArgument);
  const summary = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8'));
  assert(Number.isFinite(Date.parse(summary.finishedAt)), 'Wait for the live test to finish or safely stop');
  assert.equal(summary.target, 100);
  assert.equal(summary.selected, 100); assert.equal(summary.saved, 100);
  assert.equal(summary.detail, false, 'This audit covers list plus contacts, not detail modules');
  const backupFile = path.join(directory, 'library-before.db');
  assert(fs.existsSync(backupFile) && fs.existsSync(databaseFile));
  const open = file => new Promise((resolve, reject) => {
    const connection = new sqlite.Database(file, sqlite.OPEN_READONLY, error => error ? reject(error) : resolve(connection));
  });
  const db = await open(databaseFile);
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  const get = async (sql, params) => (await all(sql, params))[0];
  try {
    // The backup remains untouched: attachment is used exclusively by SELECTs.
    await all('ATTACH DATABASE ? AS before_test', [backupFile]);
    const changedPriorRows = (await get('SELECT COUNT(*) AS n FROM (SELECT * FROM before_test.creators EXCEPT SELECT * FROM main.creators)')).n;
    assert.equal(changedPriorRows, 0, 'Preexisting creators were changed or removed');
    const retained = await all(`SELECT c.region, c.creator_id, c.raw_json FROM creators c
      JOIN scrape_job_creators j ON j.creator_row_id = c.id WHERE j.job_id = ?`, [summary.jobId]);
    assert.equal(retained.length, 100);
    assert.equal(new Set(retained.map(row => row.region + ':' + row.creator_id)).size, 100);
    const byId = new Map(retained.map(row => [row.creator_id, JSON.parse(row.raw_json)]));
    let checked = 0, pending = 0;
    for (const row of retained) {
      const raw = byId.get(row.creator_id);
      assert.equal(row.region, 'MY');
      assert.equal(raw.selection_region, 'MY');
      assert.equal(String(raw.creator_oecuid), row.creator_id);
      if (raw.contact_checked_at) {
        checked++;
        assert(Date.parse(raw.contact_checked_at) >= Date.parse(summary.startedAt));
        assert(Date.parse(raw.contact_checked_at) <= Date.parse(summary.finishedAt));
        assert(['已获取', '未提供'].includes(raw.contact_status));
      } else {
        pending++;
        assert.match(raw.contact_status, /^待补全/);
      }
    }
    assert.equal(checked, summary.contactSuccesses);
    assert.equal(pending, 100 - summary.contactsSaved);
    const values = [...byId.values()];
    const count = key => values.filter(row => String(row[key] ?? '').trim()).length;
    const whatsapp = count('whatsapp'), email = count('合作邮箱'), line = count('line');
    const notProvided = values.filter(row => row.contact_status === '未提供').length;
    assert.equal(whatsapp, summary.whatsapp); assert.equal(email, summary.email);
    assert.equal(line, summary.line); assert.equal(notProvided, summary.emptyContacts);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(path.join(directory, 'creators-retained.xlsx'));
    const sheet = book.worksheets[0], headers = sheet.getRow(1).values.slice(1);
    assert.equal(sheet.rowCount, 101);
    const idColumn = headers.indexOf('creator_oecuid') + 1;
    assert(idColumn > 0);
    const exportIds = new Set();
    for (let number = 2; number <= sheet.rowCount; number++) {
      const id = sheet.getCell(number, idColumn).value;
      assert.equal(typeof id, 'string', 'Creator ID must not lose numeric precision');
      const raw = byId.get(id); assert(raw); exportIds.add(id);
      headers.forEach((key, index) => assert.equal(
        String(sheet.getCell(number, index + 1).value ?? ''), String(normalizeValue(raw[key])),
        'Export cell must match retained data'));
    }
    assert.equal(exportIds.size, 100);
    const durations = [...summary.contactDurationsMs].sort((a, b) => a - b);
    const audit = {auditedAt:new Date().toISOString(), databaseOpenedReadOnly:true,
      batchRows:100, uniqueCreators:100, region:'MY', preexistingRowsChangedOrRemoved:changedPriorRows,
      whatsapp, email, line, notProvided, contactsChecked:checked, contactsPending:pending,
      allContactsCompleted:summary.completed, contactRequests:summary.contactRequests,
      contactErrors:summary.errors, allContactTimestampsFromThisRun:true, xlsxRows:100,
      allExportCellsMatchDatabase:true, creatorIdsRetainedAsText:true,
      databaseIntegrity:Object.values(await get('PRAGMA quick_check'))[0], elapsedMs:summary.elapsedMs,
      contactResponseMeanMs:Math.round(durations.reduce((total, value) => total + value, 0) / durations.length),
      contactResponseP50Ms:durations[Math.ceil(durations.length * 0.5) - 1],
      contactResponseP95Ms:durations[Math.ceil(durations.length * 0.95) - 1],
      contactIntervalMs:summary.contactIntervalMs, chatPagesOpened:summary.chatPagesOpened,
      detailRequests:summary.detailRequests, discoveryRoute:summary.discoveryRoute};
    assert.equal(audit.databaseIntegrity, 'ok');
    fs.writeFileSync(path.join(directory, 'audit.json'), JSON.stringify(audit, null, 2), {flag:'wx'});
    console.log(JSON.stringify(audit));
  } finally { await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}
main().catch(() => { console.error('Offline audit failed; no session data was read and no library rows were modified.'); process.exitCode = 1; });
