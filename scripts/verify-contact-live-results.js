'use strict';
// Local-only verification/export of a completed, bounded live-test batch.
// No network access, no Cookie reads and no deletion.
const fs = require('fs'), path = require('path');
const { CreatorDatabase } = require('../lib/database');
const { exportCsv, exportXlsx } = require('../lib/exporter');
(async () => {
  const [samplePath, databasePath, directory] = process.argv.slice(2);
  const samples = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 5) throw new Error('Bounded sample file required');
  const db = new CreatorDatabase(databasePath), display = [];
  try {
    await db.open();
    for (const s of samples) {
      const stored = await db.get('SELECT raw_json FROM creators WHERE region=? AND creator_id=?', [s.region, s.creator_oecuid]);
      const raw = JSON.parse(stored?.raw_json || '{}');
      if (raw.source !== 'partner_contact_live_test' || !raw.contact_checked_at || raw.handle !== s.handle) throw new Error('Not a matching completed live-test sample');
      // Populate the existing app/export Region field using its verified market.
      // Keep every other field and every other creator untouched.
      await db.run('UPDATE creators SET raw_json=json_set(raw_json,?,?) WHERE region=? AND creator_id=?', ['$.selection_region', s.region, s.region, s.creator_oecuid]);
      const row = (await db.listCreators({ region: s.region, search: s.creator_oecuid })).rows.find(r => r.creator_id === s.creator_oecuid);
      if (row.selection_region !== s.region || row.region !== s.region) throw new Error('Region readback mismatch');
      display.push({
        '达人主页': row.handle, '昵称': row.nickname, '达人ID': row.creator_id,
        '地区': row.selection_region, '地区名称': ({ MY: '马来西亚', TH: '泰国', US: '美国' })[row.region] || row.region,
        '粉丝数': row.follower_cnt, '类目': row.category, '合作邮箱': row['合作邮箱'] || '',
        'WhatsApp': row.whatsapp || '', 'WhatsApp 国家码': row.whatsapp_country_code || '', 'LINE': row.line || '',
        '联系方式来源': row.contact_source, '联系方式检查时间': row.contact_checked_at, '联系方式状态': row.contact_status,
      });
    }
    const csv = path.join(directory, '真实抓取结果-含地区.csv'), xlsx = path.join(directory, '真实抓取结果-含地区.xlsx');
    if (fs.existsSync(csv) || fs.existsSync(xlsx)) throw new Error('Do not overwrite an existing export');
    const headers = Object.keys(display[0]);
    await exportCsv(csv, display, headers); await exportXlsx(xlsx, display, headers);
    const ExcelJS = require('exceljs'), book = new ExcelJS.Workbook(); await book.xlsx.readFile(xlsx);
    const verified = display.every((r, i) => headers.every((k, j) => String(book.worksheets[0].getCell(i + 2, j + 1).value ?? '') === String(r[k] ?? '')));
    if (!verified) throw new Error('Spreadsheet readback mismatch');
    console.log(JSON.stringify({ rows: display, regionAndExportVerified: verified, libraryTotal: (await db.get('SELECT count(*) AS n FROM creators')).n, csv, xlsx }));
  } finally { await db.close(); }
})().catch(() => { console.error('Local verification failed; no credentials read.'); process.exitCode = 1; });
