'use strict';
// Opt-in bounded real test. Reuses the shipped client, job, DB and exporter.
// Cookie values and contact values never appear in console or summary output.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { PartnerContactClient, ContactJob, ContactError } = require('../lib/partner-contacts');
const { CreatorDatabase } = require('../lib/database');
const { exportCsv, exportXlsx } = require('../lib/exporter');

async function main() {
  const [cookieFile, sampleFile, databaseFile, outputDirectory, approval] = process.argv.slice(2);
  if (approval !== '--write-library' || !outputDirectory) throw new Error('Explicit paths and --write-library are required');
  const samples = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 5 || new Set(samples.map(s => s.creator_oecuid)).size !== samples.length) throw new Error('Use 1-5 distinct observed samples');
  const region = samples[0].region;
  if (samples.some(s => s.region !== region || !/^\d{1,30}$/.test(s.creator_oecuid) || !s.handle)) throw new Error('Observed ID, handle and matching region required');
  const out = path.resolve(outputDirectory);
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(path.join(out, 'summary.json'))) throw new Error('Use a new output directory; never overwrite a prior test');
  const report = { startedAt: new Date().toISOString(), samples: samples.length, region, requests: 0, successes: 0, saved: 0, whatsapp: 0, email: 0, line: 0, empty: 0, intervalMs: 10000, errorCode: null, apiDurationsMs: [], databaseReadbackVerified: false, otherRegionsUnchanged: false, openedChatPagesByCollector: 0, retries: 0 };
  const db = new CreatorDatabase(path.resolve(databaseFile));
  const digest = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const patches = new Map();
  try {
    // Check authorization before making any database changes or contact requests.
    const client = new PartnerContactClient(JSON.parse(fs.readFileSync(cookieFile, 'utf8').replace(/^\uFEFF/, '')));
    await client.resolvePartner(region);
    await db.open();
    report.rowsBefore = (await db.get('SELECT count(*) AS n FROM creators')).n;
    const originalRows = await db.all('SELECT * FROM creators WHERE region <> ? ORDER BY id', [region]);
    const originalDigest = digest(originalRows);
    for (const s of samples) {
      const existing = await db.get('SELECT id FROM creators WHERE region = ? AND creator_id = ?', [region, s.creator_oecuid]);
      if (!existing) await db.upsertCreators([{ ...s, selection_region: region, source: 'partner_contact_live_test', source_observation: 'Partner Center visible profile; no inferred contact fields' }], { region });
    }
    const observedProfiles = await db.all('SELECT creator_id,handle,nickname,follower_count,category,first_seen_at,last_refreshed_at FROM creators WHERE region = ? ORDER BY id', [region]);
    const realFetch = client.fetchContacts.bind(client);
    client.fetchContacts = async (...args) => {
      report.requests++;
      const started = Date.now();
      try {
        const patch = await realFetch(...args);
        report.successes++; patches.set(args[1], patch);
        for (const [key, count] of [['whatsapp', 'whatsapp'], ['合作邮箱', 'email'], ['line', 'line']]) if (patch[key]) report[count]++;
        if (patch.contact_status === '未提供') report.empty++;
        return patch;
      } finally { report.apiDurationsMs.push(Date.now() - started); }
    };
    const job = new ContactJob();
    const started = Date.now();
    job.start({ client, db, region, targets: samples.map(s => s.creator_oecuid) });
    await job.done;
    report.collectionDurationMs = Date.now() - started;
    report.saved = job.state.completed; report.errorCode = job.state.errorCode || null;
    report.profilesUnchanged = digest(observedProfiles) === digest(await db.all('SELECT creator_id,handle,nickname,follower_count,category,first_seen_at,last_refreshed_at FROM creators WHERE region = ? ORDER BY id', [region]));
    await db.close(); await db.open();
    const rows = [];
    for (const [id, patch] of patches) {
      const row = (await db.listCreators({ region, search: id })).rows.find(r => r.creator_id === id);
      if (!row || Object.entries(patch).some(([k, v]) => row[k] !== v)) throw new Error('Database readback mismatch');
      rows.push(row);
    }
    report.databaseReadbackVerified = rows.length === report.saved && report.saved > 0;
    report.otherRegionsUnchanged = originalDigest === digest(await db.all('SELECT * FROM creators WHERE region <> ? ORDER BY id', [region]));
    report.rowsAfter = (await db.get('SELECT count(*) AS n FROM creators')).n;
    report.whatsappFilterMatches = (await db.listCreatorIds({ region, hasWhatsapp: true })).filter(id => patches.has(id)).length;
    if (rows.length) {
      const fields = ['handle', 'creator_oecuid', 'region', '合作邮箱', 'whatsapp', 'whatsapp_country_code', 'line', 'contact_source', 'contact_checked_at', 'contact_status'];
      await exportCsv(path.join(out, 'real-contacts.csv'), rows, fields);
      await exportXlsx(path.join(out, 'real-contacts.xlsx'), rows, fields);
      const ExcelJS = require('exceljs'), book = new ExcelJS.Workbook();
      await book.xlsx.readFile(path.join(out, 'real-contacts.xlsx'));
      report.xlsxReadbackVerified = rows.every((r, i) => String(book.worksheets[0].getCell(i + 2, 5).value || '') === String(r.whatsapp || ''));
    }
    report.rateLimited = report.errorCode === 'RATE_LIMIT'; report.quotaLimited = report.errorCode === 'QUOTA'; report.challenge = report.errorCode === 'CHALLENGE';
    report.databaseIntegrity = Object.values(await db.get('PRAGMA quick_check'))[0];
  } catch (error) {
    report.errorCode = error instanceof ContactError ? error.code : 'LOCAL_VERIFICATION';
    process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (report.errorCode) process.exitCode = 1;
  }
}
main().catch(() => { console.error('Live test preflight failed; no credential or contact data logged.'); process.exitCode = 1; });
